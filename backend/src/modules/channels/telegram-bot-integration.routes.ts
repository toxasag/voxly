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
   * Вызывается Telegram при:
   * - business_connection (привязка бота к аккаунту владельца в "Автоматизации чатов" / Telegram Business)
   * - business_message / edited_business_message (сообщения в личных чатах аккаунта в режиме секретаря)
   * - message / edited_message (прямые сообщения и команды /start боту)
   */
  app.post("/webhook/:id", async (request, reply) => {
    const { id } = accountParamsSchema.parse(request.params);
    const update = request.body as Record<string, unknown> | null;
    if (!update || typeof update !== "object") {
      return reply.status(200).send({ ok: true });
    }

    const updateKeys = Object.keys(update);
    request.log.info(
      {
        accountId: id,
        updateId: update.update_id,
        updateKeys,
      },
      "Telegram bot webhook update received",
    );

    const account = await runWithPlatformScope(() =>
      queryOne<{
        id: string;
        tenant_id: string;
        status: string;
        credentials: {
          token?: string;
          business_connection_id?: string;
          business_user_id?: string;
          business_username?: string;
          [key: string]: unknown;
        } | null;
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

    // 1. Событие подключения Telegram Business Chatbot ("Автоматизация чатов")
    const businessConnection = update.business_connection as Record<string, unknown> | undefined;
    if (businessConnection && typeof businessConnection === "object") {
      const connId = String(businessConnection.id);
      const user = businessConnection.user as Record<string, unknown> | undefined;
      const userId = user?.id ? String(user.id) : undefined;
      const username = typeof user?.username === "string" ? user.username.replace(/^@/, "").trim() : undefined;
      const canReply = Boolean(businessConnection.can_reply);
      const isEnabled = Boolean(businessConnection.is_enabled);

      request.log.info(
        { accountId: id, connId, userId, username, canReply, isEnabled },
        "Telegram Bot business_connection update received",
      );

      await runWithTenantContext(tenantId, async () => {
        const { query: dbQuery } = await import("../../db/client.js");
        const creds = { ...(account.credentials || {}) };
        if (isEnabled) {
          creds.business_connection_id = connId;
        } else {
          delete creds.business_connection_id;
        }
        if (userId) creds.business_user_id = userId;
        if (username) creds.business_username = username;
        creds.business_can_reply = canReply;
        creds.business_is_enabled = isEnabled;
        account.credentials = creds;
        await dbQuery(
          `UPDATE channel_accounts SET credentials = $1 WHERE id = $2 AND tenant_id = $3`,
          [JSON.stringify(creds), id, tenantId],
        );
      });

      return reply.status(200).send({ ok: true });
    }

    // 2. Определение сообщения: business_message (режим секретаря) или обычное message боту
    const isBusiness = Boolean(update.business_message || update.edited_business_message);
    const message = (
      update.business_message ||
      update.edited_business_message ||
      update.message ||
      update.edited_message
    ) as Record<string, unknown> | undefined;

    if (!message || typeof message !== "object") {
      request.log.info({ accountId: id, updateKeys }, "Telegram bot webhook: no message in update");
      return reply.status(200).send({ ok: true });
    }

    const from = message.from as Record<string, unknown> | undefined;
    if (!from || from.is_bot === true) {
      return reply.status(200).send({ ok: true });
    }

    const chat = message.chat as Record<string, unknown> | undefined;
    if (!chat || (chat.type !== "private" && chat.type !== undefined)) {
      request.log.info({ accountId: id, chatType: chat?.type }, "Telegram bot webhook: ignoring non-private chat");
      return reply.status(200).send({ ok: true });
    }

    const chatId = String(chat.id);
    const senderId = String(from.id);

    // business_connection_id извлекается из business_message или из credentials
    const rawConnId = typeof message.business_connection_id === "string" ? message.business_connection_id.trim() : "";
    const businessConnectionId = isBusiness
      ? (rawConnId || (account.credentials?.business_connection_id as string | undefined))
      : undefined;

    // Если получили свежий business_connection_id из входящего business_message, сохраняем в аккаунте
    if (businessConnectionId && account.credentials?.business_connection_id !== businessConnectionId) {
      account.credentials = { ...(account.credentials || {}), business_connection_id: businessConnectionId };
      void runWithTenantContext(tenantId, async () => {
        const { query: dbQuery } = await import("../../db/client.js");
        await dbQuery(
          `UPDATE channel_accounts SET credentials = $1 WHERE id = $2 AND tenant_id = $3`,
          [JSON.stringify(account.credentials), id, tenantId],
        ).catch(() => null);
      });
    }

    const chatFirstName = typeof chat.first_name === "string" ? chat.first_name.trim() : "";
    const chatLastName = typeof chat.last_name === "string" ? chat.last_name.trim() : "";
    const chatUsername = typeof chat.username === "string" ? chat.username.replace(/^@/, "").trim() : undefined;

    const fromFirstName = typeof from.first_name === "string" ? from.first_name.trim() : "";
    const fromLastName = typeof from.last_name === "string" ? from.last_name.trim() : "";
    const fromUsername = typeof from.username === "string" ? from.username.replace(/^@/, "").trim() : undefined;

    let mediaTypeLabel = "";
    if (message.voice) mediaTypeLabel = "[Голосовое сообщение]";
    else if (message.video_note) mediaTypeLabel = "[Видеосообщение]";
    else if (message.photo) mediaTypeLabel = "[Фотография]";
    else if (message.document) mediaTypeLabel = "[Документ]";
    else if (message.video) mediaTypeLabel = "[Видео]";
    else if (message.audio) mediaTypeLabel = "[Аудиозапись]";
    else if (message.sticker) mediaTypeLabel = "[Стикер]";

    const rawText = typeof message.text === "string"
      ? message.text.trim()
      : typeof message.caption === "string"
        ? message.caption.trim()
        : mediaTypeLabel;

    const externalMessageId = typeof message.message_id === "number" ? String(message.message_id) : undefined;
    const messageTimestamp = typeof message.date === "number" ? new Date(message.date * 1000) : new Date();

    // 3. Проверка: отправлено ли сообщение оператором/владельцем аккаунта (исходящее оператора)
    let isFromOperator = false;
    if (isBusiness) {
      const bizUserId = account.credentials?.business_user_id;
      // В Telegram Business в приватном чате:
      // Если senderId !== chatId, значит сообщение отправлено владельцем бизнес-аккаунта (оператором).
      // Если senderId === String(bizUserId), значит отправитель — владелец бизнес-аккаунта.
      if (senderId !== chatId || (bizUserId && senderId === String(bizUserId))) {
        isFromOperator = true;
        if (!bizUserId) {
          account.credentials = { ...(account.credentials || {}), business_user_id: senderId };
          void runWithTenantContext(tenantId, async () => {
            const { query: dbQuery } = await import("../../db/client.js");
            await dbQuery(
              `UPDATE channel_accounts SET credentials = $1 WHERE id = $2 AND tenant_id = $3`,
              [JSON.stringify(account.credentials), id, tenantId],
            ).catch(() => null);
          });
        }
      } else {
        const ownCheck = await runWithPlatformScope(() =>
          queryOne<{ id: string }>(
            `SELECT id FROM (
               SELECT id::text FROM channel_accounts
               WHERE tenant_id = $1 AND status = 'connected' AND deleted_at IS NULL
                 AND (
                   (credentials->>'tgUserId' IS NOT NULL AND credentials->>'tgUserId' = $2)
                   OR (credentials->>'business_user_id' IS NOT NULL AND credentials->>'business_user_id' = $2)
                 )
               UNION ALL
               SELECT id::text FROM users
               WHERE tenant_id = $1 AND deleted_at IS NULL
                 AND telegram_chat_id IS NOT NULL AND telegram_chat_id::text = $2
             ) own LIMIT 1`,
            [tenantId, senderId],
          ),
        ).catch(() => null);
        if (ownCheck) isFromOperator = true;
      }
    }

    // 4. Обработка исходящих сообщений оператора в режиме секретаря:
    // Первое сообщение с аккаунта НЕ создает контакт и сделку.
    // AI агент НЕ должен отвечать на реплики оператора.
    if (isFromOperator) {
      request.log.info(
        { accountId: id, chatId, senderId, text: rawText, isBusiness, businessConnectionId },
        "Telegram Bot business message: operator outbound message received",
      );

      const existingDeal = await runWithTenantContext(tenantId, () =>
        queryOne<{ id: string; contact_id: string | null }>(
          `SELECT d.id, d.contact_id FROM deals d
           LEFT JOIN contacts c ON d.contact_id = c.id
           WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
             AND (d.chat_thread_id = $2 OR c.telegram_chat_id = $2)
           ORDER BY d.created_at DESC LIMIT 1`,
          [tenantId, chatId],
        ),
      ).catch(() => null);

      if (existingDeal) {
        // Сделка уже существует — добавляем реплику оператора и ставим вечную паузу AI бота
        await runWithTenantContext(tenantId, async () => {
          const { query: dbQuery } = await import("../../db/client.js");
          await dbQuery(
            `INSERT INTO deal_messages (tenant_id, deal_id, channel, source, direction, sender_name, content, channel_account_id, delivery_status, metadata, created_at)
             VALUES ($1, $2, 'telegram_bot', 'manager', 'outbound', $3, $4, $5, 'sent', $6, $7)`,
            [
              tenantId,
              existingDeal.id,
              account.credentials?.business_username || "Оператор",
              rawText || "(вложение)",
              account.id,
              JSON.stringify({ external_message_id: externalMessageId }),
              messageTimestamp,
            ],
          );
          await dbQuery(
            `UPDATE deals
             SET ai_paused_until = '9999-12-31 23:59:59+00'::timestamptz,
                 custom_fields = jsonb_set(
                   COALESCE(custom_fields, '{}'::jsonb),
                   '{ai_paused_reason}',
                   to_jsonb('messenger_takeover'::text),
                   true
                 ),
                 updated_at = now()
             WHERE tenant_id = $1 AND (id = $2 OR ($3::uuid IS NOT NULL AND contact_id = $3::uuid AND deleted_at IS NULL))`,
            [tenantId, existingDeal.id, existingDeal.contact_id],
          );
        }).catch((err) => {
          request.log.warn({ err, dealId: existingDeal.id }, "Failed to append operator business message to deal");
        });
      } else {
        // Сделки нет — НЕ создаем контакт и сделку. Буферизуем реплику оператора в Redis,
        // чтобы при входящем ответе клиента привязать ее к созданной сделке.
        try {
          const { getRedisClient, isRedisAvailable } = await import("../../infrastructure/redis.js");
          const redis = isRedisAvailable() ? getRedisClient() : null;
          if (redis) {
            const bufferKey = `tg_biz_pending:${id}:${chatId}`;
            const existingRaw = await redis.get(bufferKey);
            const list = existingRaw ? (JSON.parse(existingRaw) as unknown[]) : [];
            list.push({
              text: rawText,
              externalMessageId,
              timestamp: messageTimestamp.toISOString(),
            });
            await redis.set(bufferKey, JSON.stringify(list), "EX", 86400 * 7);
            request.log.info({ accountId: id, chatId, count: list.length }, "Buffered operator message in Redis");
          }
        } catch (err) {
          request.log.warn({ err, chatId }, "Failed to buffer pending operator message in Redis");
        }
      }

      return reply.status(200).send({ ok: true });
    }

    // 5. Входящее сообщение от клиента / собеседника:
    const effectiveFirstName = fromFirstName || chatFirstName;
    const effectiveLastName = fromLastName || chatLastName;
    const effectiveUsername = fromUsername || chatUsername;
    const senderName = [effectiveFirstName, effectiveLastName].filter(Boolean).join(" ") || effectiveUsername || chatId;

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

    request.log.info(
      {
        accountId: id,
        chatId,
        senderId,
        senderName: contactName || senderName,
        text: effectiveText,
        isBusiness,
        businessConnectionId,
      },
      "Telegram bot: processing client incoming message",
    );

    const crmPipeline = new CrmPipelineService(request.log);
    const crmResult = await runWithTenantContext(tenantId, () =>
      crmPipeline.processIncoming({
        tenantId,
        channel: "telegram_bot",
        channelAccountId: account.id,
        chatId,
        chatThreadId: chatId,
        text: effectiveText,
        senderName: contactName || senderName,
        senderTelegramChatId: senderId,
        senderTelegramUsername: effectiveUsername,
        senderPhone: contactPhone,
        profile: {
          firstName: effectiveFirstName || undefined,
          lastName: effectiveLastName || undefined,
          username: effectiveUsername,
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

    request.log.info(
      { accountId: id, chatId, crmResult },
      "Telegram bot: CRM pipeline processIncoming finished",
    );

    if (!crmResult || crmResult.isPersonal || crmResult.isBot) {
      return reply.status(200).send({ ok: true });
    }

    if (crmResult.dealId) {
      // Подтягиваем ранее буферизованные сообщения оператора из Redis
      try {
        const { getRedisClient, isRedisAvailable } = await import("../../infrastructure/redis.js");
        const redis = isRedisAvailable() ? getRedisClient() : null;
        if (redis) {
          const bufferKey = `tg_biz_pending:${id}:${chatId}`;
          const bufferedRaw = await redis.get(bufferKey);
          if (bufferedRaw) {
            const buffered = JSON.parse(bufferedRaw) as Array<{ text: string; externalMessageId?: string; timestamp: string }>;
            if (buffered.length > 0) {
              const { query: dbQuery } = await import("../../db/client.js");
              await runWithTenantContext(tenantId, async () => {
                for (const p of buffered) {
                  await dbQuery(
                    `INSERT INTO deal_messages (tenant_id, deal_id, channel, source, direction, sender_name, content, channel_account_id, delivery_status, metadata, created_at)
                     VALUES ($1, $2, 'telegram_bot', 'manager', 'outbound', $3, $4, $5, 'sent', $6, $7)`,
                    [
                      tenantId,
                      crmResult.dealId!,
                      account.credentials?.business_username || "Оператор",
                      p.text || "(сообщение)",
                      account.id,
                      JSON.stringify({ external_message_id: p.externalMessageId }),
                      new Date(p.timestamp),
                    ],
                  );
                }
              });
              await redis.del(bufferKey);
              request.log.info(
                { dealId: crmResult.dealId, count: buffered.length },
                "Flushed pending operator messages from Redis to deal",
              );
            }
          }
        }
      } catch (bufErr) {
        request.log.warn({ bufErr, dealId: crmResult.dealId }, "Failed to flush pending operator messages to deal");
      }

      // Проверка паузы AI бота
      const isPaused = await runWithTenantContext(tenantId, () =>
        queryOne<{ id: string }>(
          `SELECT id FROM deals WHERE tenant_id = $1 AND id = $2 AND ai_paused_until > now() LIMIT 1`,
          [tenantId, crmResult.dealId!],
        ),
      ).catch(() => null);

      if (isPaused) {
        request.log.info({ dealId: crmResult.dealId }, "Telegram bot: AI reply skipped because deal is paused");
      } else {
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

          request.log.info(
            { dealId: crmResult.dealId, outcomeKind: outcome.kind },
            "Telegram bot: agent prepareReply outcome",
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
              const sendResult = await service.sendMessage(account.credentials!.token!, chatId, msg, {
                business_connection_id: businessConnectionId,
              });
              request.log.info(
                {
                  chatId,
                  businessConnectionId,
                  sendResult,
                },
                "Telegram bot: sent reply message result",
              );
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
