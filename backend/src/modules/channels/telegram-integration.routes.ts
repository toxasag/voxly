import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticatePlugin } from "../../plugins/authenticate.js";
import { TelegramAuthService } from "./telegram-auth.service.js";
import { TelegramMtprotoUnavailableError } from "./telegram-mtproto.service.js";
import { sendCodeSchema, signInSchema } from "./telegram-auth.types.js";

// ---------------------------------------------------------------------------
// Подключение пользовательских аккаунтов Telegram, смонтировано в app.ts под
// /api/v1/integrations/telegram.
//
// Отдельный префикс от /api/v1/channels: там общий CRUD подключений для пяти
// каналов, здесь — специфика MTProto-авторизации, которой нет ни у одного
// другого канала.
//
// Гейты те же, что у каналов: `tenant:admin` плюс установленный модуль
// `telegram`. Право владельца/администратора обязательно — пользователь передаёт
// доступ к своему аккаунту Telegram, и это не рядовое действие.
// ---------------------------------------------------------------------------

const accountParams = z.object({ id: z.string().uuid("id must be a UUID") });

export default async function telegramIntegrationRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new TelegramAuthService(app);

  const guards = [
    app.requirePermission("tenant:admin"),
    app.requireModule("telegram"),
  ];

  /**
   * Отказ на старте, а не при первом обращении к Telegram: без ключей MTProto
   * канал неработоспособен, и честный 503 понятнее таймаута соединения.
   */
  const assertConfigured = (): void => {
    if (!service.isConfigured) throw new TelegramMtprotoUnavailableError();
  };

  app.post("/auth/send-code", { onRequest: guards }, async (request, reply) => {
    assertConfigured();

    const body = sendCodeSchema.parse(request.body);

    const result = await service.sendCode({
      tenantId: request.tenant_id,
      actorId: request.authUser.id,
      phone: body.phone,
      label: body.name,
    });

    return reply.send({ data: result });
  });

  app.post("/auth/sign-in", { onRequest: guards }, async (request, reply) => {
    assertConfigured();

    const body = signInSchema.parse(request.body);

    const result = await service.signIn({
      tenantId: request.tenant_id,
      tempSessionId: body.tempSessionId,
      code: body.code,
      password: body.password,
    });

    // 200 и в случае запроса пароля: код принят, авторизация продолжается — это
    // следующий шаг мастера, а не ошибка запроса. Задание допускает оба варианта
    // (400 или 200); выбран 200, потому что 4xx в интерфейсе выглядел бы как
    // неверный ввод и попадал бы в обработчик ошибок.
    return reply.send({ data: result });
  });

  /**
   * Проверка живости сохранённой сессии.
   *
   * Нужна потому, что пользователь может отозвать сеанс в приложении Telegram, и
   * подключение продолжало бы отображаться как активное.
   */
  app.post("/accounts/:id/check", { onRequest: guards }, async (request, reply) => {
    assertConfigured();

    const { id } = accountParams.parse(request.params);
    const result = await service.refreshAccountStatus(request.tenant_id, id);

    return reply.send({ data: result });
  });
}
