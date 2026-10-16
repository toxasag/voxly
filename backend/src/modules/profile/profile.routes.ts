import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { AppError } from "../../plugins/errorHandler.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { TelegramService } from "../auth/telegram.service.js";
import { MaxService } from "../../services/max.service.js";
import { ProfileService } from "./profile.service.js";

// ---------------------------------------------------------------------------
// Личный профиль: /api/v1/profile.
//
// Отдельная группа, а не расширение `/auth`: та группа сознательно не
// регистрирует `authenticatePlugin` (все её пути публичные), тогда как каждое
// действие здесь выполняется от имени вошедшего пользователя. Прав не требуется
// — это собственные данные, а не чужие: `tenant:admin` закрыл бы профиль от
// рядового сотрудника.
// ---------------------------------------------------------------------------

const channelSchema = z.enum(["telegram", "max"]);

const updateProfileBody = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(120).optional(),
  phone: z
    .string()
    .trim()
    .refine((value) => value.replace(/\D/g, "").length >= 10, "Укажите корректный телефон")
    .optional(),
  // null — снять аватар. Длина ограничена с запасом: точная проверка размера
  // декодированных данных и MIME выполняется в сервисе.
  avatar_url: z.string().max(1_400_000).nullable().optional(),
});

const changePasswordBody = z.object({
  current_password: z.string().min(1, "Введите текущий пароль").max(200),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов").max(200),
  /**
   * Refresh-токен текущей сессии. Передаётся, чтобы она не была отозвана вместе
   * с остальными: подтверждение владения им же служит признаком «это я здесь и
   * сейчас», а не просто удобством.
   */
  keep_refresh_token: z.string().min(10).max(512).optional(),
});

const verifyLinkBody = z.object({
  session_id: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, "Код состоит из 6 цифр"),
});

const channelParams = z.object({ channel: channelSchema });

/** Тот же алгоритм, что в auth.service: refresh-токены хранятся как SHA-256. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export default async function profileRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const sessions = new AuthSessionService(app);
  const telegram = new TelegramService();
  const max = new MaxService();

  // Доступность канала и имя бота читаются один раз: они заданы окружением и в
  // пределах процесса не меняются.
  const service = new ProfileService(app, {
    telegram: { available: telegram.isConfigured, bot: telegram.username },
    max: { available: max.isConfigured, bot: max.username },
  });

  app.get("/", async (request, reply) => {
    const data = await service.get(request.authUser.id);
    return reply.send({ data });
  });

  app.patch("/", async (request, reply) => {
    const body = updateProfileBody.parse(request.body);

    const data = await service.update({
      userId: request.authUser.id,
      tenantId: request.tenant_id,
      ...(body.name !== undefined && { name: body.name }),
      ...(body.phone !== undefined && { phone: body.phone }),
      ...(body.avatar_url !== undefined && { avatarUrl: body.avatar_url }),
    });

    return reply.send({ data });
  });

  /**
   * Смена пароля. Лимит строже общего: эндпоинт принимает текущий пароль, и
   * общие 100/мин оставляли бы слишком широкое окно для его подбора по
   * перехваченной сессии.
   */
  app.post(
    "/password",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = changePasswordBody.parse(request.body);

      await service.changePassword({
        userId: request.authUser.id,
        currentPassword: body.current_password,
        newPassword: body.password,
        // Клиент передаёт свой refresh-токен, чтобы его сессия не была отозвана
        // вместе с остальными: иначе успешная смена пароля выкидывала бы
        // пользователя из интерфейса.
        ...(body.keep_refresh_token !== undefined && {
          keepRefreshTokenHash: hashToken(body.keep_refresh_token),
        }),
      });

      return reply.send({
        data: {
          message:
            "Пароль обновлён. Сессии на других устройствах завершены — там потребуется войти заново.",
        },
      });
    },
  );

  /**
   * Запрос привязки канала: выдаёт deep-link на бота.
   *
   * Адресат по телефону НЕ ищется (в отличие от входа): цель — привязать
   * конкретный чат, поэтому ссылка выдаётся всегда, и канал получит тот аккаунт,
   * который её откроет. Владелец берётся из токена, а не из тела запроса —
   * иначе можно было бы привязать канал к чужой учётной записи.
   */
  app.post("/channels/:channel/link", async (request, reply) => {
    const { channel } = channelParams.parse(request.params);

    await service.assertChannelUnlinked(request.authUser.id, channel);

    const result = await sessions.requestCode({
      purpose: "link",
      channel,
      userId: request.authUser.id,
    });

    return reply.send({ data: result });
  });

  /**
   * Подтверждение привязки кодом из бота.
   *
   * Код обязателен, хотя пользователь уже аутентифицирован: без него достаточно
   * было бы открыть чужую ссылку, а код доказывает, что открывший владеет именно
   * этим чатом.
   */
  app.post(
    "/channels/verify",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = verifyLinkBody.parse(request.body);

      await sessions.verifyCode(body.session_id, body.code);
      await sessions.consumeLinkSession({
        sessionId: body.session_id,
        userId: request.authUser.id,
      });

      const outcome = await sessions.linkVerifiedRecipient({
        sessionId: body.session_id,
        userId: request.authUser.id,
      });

      // `taken` означает срабатывание частичного уникального индекса: этот чат
      // принадлежит другой учётной записи. Отдаём 409, а не общий 500, чтобы
      // интерфейс объяснил причину.
      if (outcome === "taken") {
        throw new AppError(
          409,
          "CHANNEL_TAKEN",
          "Этот аккаунт уже привязан к другой учётной записи платформы",
        );
      }

      const data = await service.get(request.authUser.id);
      return reply.send({ data });
    },
  );

  app.delete("/channels/:channel", async (request, reply) => {
    const { channel } = channelParams.parse(request.params);
    const data = await service.unlinkChannel({ userId: request.authUser.id, channel });
    return reply.send({ data });
  });

  /** Опрос доставки кода — тот же смысл, что публичный `/auth/code/status`. */
  app.get("/channels/status", async (request, reply) => {
    const { session_id } = z.object({ session_id: z.string().uuid() }).parse(request.query);
    const data = await sessions.status(session_id);
    return reply.send({ data });
  });
}
