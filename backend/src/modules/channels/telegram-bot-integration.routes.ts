import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticatePlugin } from "../../plugins/authenticate.js";
import { TelegramBotService } from "./telegram-bot.service.js";
import {
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
}
