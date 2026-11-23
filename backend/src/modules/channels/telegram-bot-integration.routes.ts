import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { queryOne, runWithPlatformScope, runWithTenantContext } from "../../db/client.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { CrmPipelineService } from "../crm/crm-pipeline.service.js";
import { AgentPipelineService } from "../ai/agent-pipeline.service.js";
import { TelegramBotService } from "./telegram-bot.service.js";
import {
  autoActivateBotSchema,
  botCreateSchema,
  telegramBotCompleteManagedSchema,
  telegramBotConnectSchema,
  telegramBotCreateManagedSchema,
  telegramBotVerifySchema,
} from "./telegram-bot.types.js";

const accountParamsSchema = z.object({
  id: z.string().uuid("id должен быть валидным UUID"),
});

// ---------------------------------------------------------------------------
// Маршруты интеграции официального Telegram-бота (/api/v1/integrations/telegram-bot):
// 1. Верификация токена бота через Telegram Bot API (getMe)
// 2. Получение метаданных платформенного Bot Manager (Managed Bots)
// 3. Подключение существующего бота по токену @BotFather
// 4. Создание нового бота через Telegram Bot Manager
// 5. Завершение привязки токена для бота в статусе pending
// ---------------------------------------------------------------------------

export default async function telegramBotIntegrationRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new TelegramBotService();

  const guards = [
    app.requirePermission("tenant:admin"),
    app.requireModule("telegram_bot"),
  ];

  /** Информация о Bot Manager и доступных функциях создания. */
  app.get("/manager-info", { onRequest: guards }, async () => {
    const info = service.getManagerInfo();
    return { data: info };
  });

  /**
   * Публичный вебхук для получения сообщений от официального Telegram Bot API.
   * Вызывается Telegram при входящих сообщениях и командах (/start).
   */
  app.post("/webhook/:id", async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    const update = request.body as Record<string, unknown> | null;
    if (!update || typeof update !== "object") {
      return reply.status(200).send({ ok: true });
    }

    const message = (update.message || update.edited_message) as Record<string, unknown> | undefined;
    if (!message || typeof message !== "object") {
      return reply.status(200).send({ ok: true });
    }

    const from = message.from as Record<string, unknown> | undefined;
    if (!from || from.is_bot === true) {
      return reply.status(200).send({ ok: true });
    }

    const chat = message.chat as Record<string, unknown> | undefined;
    if (!chat || (chat.type !== "private" && chat.type !== undefined)) {
      return reply.status(200).send({ ok: true });
    }

    const account = await runWithPlatformScope(() =>
      queryOne<{
        id: string;
        tenant_id: string;
        status: string;
        credentials: { token?: string } | null;
        label: string;
        external_id: string;
      }>(
        `SELECT id, tenant_id, status, credentials, label, external_id
         FROM channel_accounts
         WHERE id = $1 AND channel = 'telegram_bot' AND deleted_at IS NULL`,
        [id],
      ),
    );

    if (!account || account.status !== "connected" || !account.credentials?.token) {
      request.log.warn({ accountId: id }, "Telegram bot webhook: account not connected or missing token");
      return reply.status(200).send({ ok: true });
    }

    const tenantId = account.tenant_id;
    const chatId = String(chat.id);
    const senderId = String(from.id);
    const senderUsername = typeof from.username === "string" ? from.username.replace(/^@/, "").trim() : undefined;
    const firstName = typeof from.first_name === "string" ? from.first_name.trim() : "";
    const lastName = typeof from.last_name === "string" ? from.last_name.trim() : "";
    const senderName = [firstName, lastName].filter(Boolean).join(" ") || senderUsername || chatId;

    const rawText = typeof message.text === "string" ? message.text.trim() : typeof message.caption === "string" ? message.caption.trim() : "";
    const externalMessageId = typeof message.message_id === "number" ? String(message.message_id) : undefined;
    const messageTimestamp = typeof message.date === "number" ? new Date(message.date * 1000) : new Date();

    const contactObj = message.contact as Record<string, unknown> | undefined;
    let contactPhone: string | undefined = undefined;
    let contactName: string | undefined = undefined;
    if (contactObj && typeof contactObj === "object") {
      contactPhone = typeof contactObj.phone_number === "string"
        ? (contactObj.phone_number.startsWith("+") ? contactObj.phone_number : `+${contactObj.phone_number}`)
        : undefined;
      contactName = [contactObj.first_name, contactObj.last_name].filter(Boolean).join(" ") || undefined;
    }

    const effectiveText = rawText || (contactPhone ? `Контакт: ${contactName || "Без имени"} (${contactPhone})` : "Начало диалога");

    const crmPipeline = new CrmPipelineService(request.log);
    const crmResult = await runWithTenantContext(tenantId, () =>
      crmPipeline.processIncoming({
        tenantId,
        channel: "telegram_bot",
        channelAccountId: account.id,
        chatId,
        text: effectiveText,
        senderName: contactName || senderName,
        senderTelegramChatId: senderId,
        senderTelegramUsername: senderUsername,
        senderPhone: contactPhone,
        profile: {
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          username: senderUsername,
          phone: contactPhone,
          isBot: false,
        },
        externalMessageId,
        messageTimestamp,
      }),
    ).catch((err) => {
      request.log.error({ err, accountId: id, chatId }, "Telegram bot webhook: failed to process CRM incoming");
      return null;
    });

    if (!crmResult || crmResult.isPersonal || crmResult.isBot) {
      return reply.status(200).send({ ok: true });
    }

    if (crmResult.dealId) {
      const isPaused = await runWithTenantContext(tenantId, () =>
        queryOne<{ id: string }>(
          `SELECT id FROM deals WHERE tenant_id = $1 AND id = $2 AND ai_paused_until > now() LIMIT 1`,
          [tenantId, crmResult.dealId!],
        ),
      ).catch(() => null);

      if (!isPaused) {
        try {
          const agentService = new AgentPipelineService(request.log);
          const outcome = await runWithTenantContext(tenantId, () =>
            agentService.prepareReply({
              tenantId,
              channelAccountId: account.id,
              chatId,
              text: effectiveText,
              channelType: "Telegram Bot",
              dealId: crmResult.dealId!,
            }),
          );

          if (outcome.kind === "replied") {
            await runWithTenantContext(tenantId, () =>
              crmPipeline.saveAgentReply({
                tenantId,
                dealId: crmResult.dealId!,
                reply: outcome.reply,
                channel: "telegram_bot",
                channelAccountId: account.id,
              }),
            );

            for (const msg of outcome.reply.messages) {
              await service.sendMessage(account.credentials!.token!, chatId, msg);
            }
          }
        } catch (agentErr) {
          request.log.error({ agentErr, dealId: crmResult.dealId }, "Telegram bot webhook: agent reply failed");
        }
      }
    }

    return reply.status(200).send({ ok: true });
  });

  /** Быстрая проверка токена бота без создания записи в базе данных. */
  app.post("/verify", { onRequest: guards }, async (request, reply) => {
    const body = telegramBotVerifySchema.parse(request.body);
    const botInfo = await service.getMe(body.token);
    return reply.send({ data: botInfo });
  });

  /** Подключение существующего бота по токену. */
  app.post("/connect", { onRequest: guards }, async (request, reply) => {
    const body = telegramBotConnectSchema.parse(request.body);
    const account = await service.connectExisting(request.tenant_id, body);
    return reply.status(201).send({ data: account });
  });

  /** Создание нового бота через Telegram Bot Manager. */
  app.post("/create-managed", { onRequest: guards }, async (request, reply) => {
    const body = telegramBotCreateManagedSchema.parse(request.body);
    const result = await service.createManaged(request.tenant_id, body);
    return reply.status(201).send({ data: result });
  });

  /** Завершение настройки созданного через Bot Manager бота (ввод токена). */
  app.post("/accounts/:id/complete", { onRequest: guards }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    const body = telegramBotCompleteManagedSchema.parse(request.body);
    const account = await service.completeManaged(request.tenant_id, id, body);
    return reply.send({ data: account });
  });

  /**
   * Полностью автоматическая регистрация нового бота (voxlyN_bot).
   * Создает уникального бота в статусе connected в один шаг без лишних экранов.
   */
  app.post("/create-auto", { onRequest: guards }, async (request, reply) => {
    const body = botCreateSchema.parse(request.body);
    const config = await service.autoRegisterBot(request.tenant_id, body);
    return reply.status(201).send({ data: config });
  });

  /**
   * Мгновенная автоматическая активация зависшего в pending бота со скриншота.
   */
  app.post("/accounts/:id/auto-activate", { onRequest: guards }, async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    const body = autoActivateBotSchema.parse(request.body ?? {});
    const account = await service.autoActivatePending(
      request.tenant_id,
      id,
      body.name,
      body.token,
      body.bot_id,
    );
    return reply.send({ data: account });
  });
}
