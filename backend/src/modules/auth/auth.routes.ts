import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { Role, PlatformRole } from "../../types/index.js";
import { AuthService } from "./auth.service.js";
import { AuthSessionService } from "./auth-session.service.js";
import { PasswordResetService } from "./password-reset.service.js";
import { InviteService } from "../tenant/invite.service.js";
import { TelegramService, escapeHtml } from "./telegram.service.js";
import { MaxService } from "../../services/max.service.js";
import { EmailService } from "../../services/email.service.js";
import { getEnv } from "../../config/env.js";
import { query, queryOne } from "../../db/client.js";
import { UnauthorizedError, PermissionDeniedError, NotFoundError } from "../../plugins/errorHandler.js";
import { attributionEngineService } from "../analytics/attribution-engine.service.js";
import {
  setAuthCookies,
  clearAuthCookies,
  parseCookies,
  REFRESH_COOKIE_NAME,
  AUTH_COOKIE_NAME,
} from "./auth-cookie.js";

const phoneField = z
  .string()
  .min(10, "Phone must be at least 10 characters")
  .max(20, "Phone must be at most 20 characters");

const sendOtpBody = z.object({
  phone: phoneField,
});

const verifyOtpBody = z.object({
  phone: phoneField,
  code: z.string().length(6, "Code must be exactly 6 digits").regex(/^\d{6}$/, "Code must be digits only"),
});

const loginBody = z.object({
  email: z.string().email("Invalid email"),
  password: z.string().min(1, "Password is required"),
});

const refreshBody = z.object({
  refresh_token: z.string().min(1, "Refresh token is required"),
});

/**
 * Subdomain label. Must stay in sync with the `tenants_slug_format` CHECK in
 * schema.sql and with SLUG_PATTERN in auth.service.ts — the value becomes a
 * hostname, so it is validated at every layer rather than trusted from the UI.
 */
const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Минимум 3 символа")
  .max(63, "Максимум 63 символа")
  .regex(
    /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/,
    "Допустимы латиница, цифры и дефис (не в начале и не в конце)",
  );

/**
 * Регистрация сведена к минимуму: поддомен, e-mail, пароль, телефон и код из
 * бота. Название компании и имя владельца больше не спрашиваются — они
 * выводятся из slug и e-mail и меняются в настройках арендатора.
 */
const registerBody = z.object({
  slug: slugField,
  email: z.string().trim().toLowerCase().email("Некорректный e-mail"),
  phone: phoneField,
  password: z.string().min(8, "Пароль должен быть не короче 8 символов").max(200),
  session_id: z.string().uuid("Некорректная сессия подтверждения"),
  code: z.string().length(6, "Код состоит из 6 цифр").regex(/^\d{6}$/, "Только цифры"),
});

const slugQuery = z.object({ slug: slugField });

const channelField = z.enum(["telegram", "max"], {
  errorMap: () => ({ message: "Выберите Telegram или MAX" }),
});

/**
 * Запрос кода. Для `register` телефон вводит пользователь; для `login` он
 * неизвестен форме и резолвится по e-mail на сервере, поэтому `phone`
 * необязателен, а требование «хоть что-то одно» проверяется явно.
 */
const requestCodeBody = z
  .object({
    purpose: z.enum(["register", "login"]),
    channel: channelField,
    phone: z.string().trim().optional(),
    email: z.string().trim().toLowerCase().email("Некорректный e-mail").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.purpose === "register") {
      if (value.phone === undefined || value.phone.replace(/\D/g, "").length < 10) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["phone"],
          message: "Укажите номер телефона",
        });
      }
      return;
    }

    if (value.email === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "Укажите e-mail",
      });
    }
  });

const sessionQuery = z.object({ session_id: z.string().uuid() });

/**
 * Проверка секрета webhook.
 *
 * Отсутствие ожидаемого значения трактуется как отказ, а не как «проверка не
 * требуется»: публичный эндпоинт без секрета позволил бы любому, кто узнает URL,
 * привязать произвольный аккаунт к сессии подтверждения. Сравнение
 * constant-time — заголовок подконтролен вызывающему, и посимвольный выход
 * раскрывал бы секрет по времени ответа.
 */
function verifyWebhookSecret(provided: unknown, expected: string | undefined): boolean {
  if (expected === undefined || expected.length === 0) return false;
  if (typeof provided !== "string") return false;
  return AuthService.safeEqual(provided, expected);
}

/**
 * Потолок для webhook-ов вместо полного отсутствия лимита.
 *
 * Общий лимит (100/мин на IP) для них не годится: платформы повторяют
 * недоставленное обновление, а MAX отписывает бота после 8 часов неудач, поэтому
 * троттлинг отключил бы канал. Но и безлимитный публичный обработчик, делающий
 * записи в БД, оставлять нельзя — берём заведомо больше реального трафика бота
 * (MAX держит не более 30 rps на весь домен).
 */
const WEBHOOK_RATE_LIMIT = { max: 600, timeWindow: "1 minute" } as const;

const loginWithCodeBody = z.object({
  email: z.string().trim().toLowerCase().email("Некорректный e-mail"),
  password: z.string().min(1, "Введите пароль"),
  session_id: z.string().uuid("Некорректная сессия подтверждения"),
  code: z.string().length(6, "Код состоит из 6 цифр").regex(/^\d{6}$/, "Только цифры"),
});

/**
 * Telegram-обновление. Разбирается вручную и мягко: Bot API добавляет поля со
 * временем, и строгая схема отклоняла бы валидные апдейты, из-за чего
 * привязка чата просто перестала бы работать.
 */
const telegramUpdate = z.object({
  message: z
    .object({
      chat: z.object({
        id: z.number(),
        title: z.string().optional(),
        type: z.string().optional(),
      }),
      from: z
        .object({
          id: z.number().optional(),
          username: z.string().optional(),
          first_name: z.string().optional(),
          last_name: z.string().optional(),
        })
        .optional(),
      text: z.string().optional(),
    })
    .optional(),
});

/**
 * Обновление MAX (объект `Update`). Разбирается так же мягко и так же по
 * минимуму, но структура иная: событие называется `update_type`, отправитель
 * лежит в `user` (`bot_started`) либо в `message.sender` (`message_created`), а
 * идентификатор — числовой `user_id`, а не `chat.id`.
 *
 * Payload от `bot_started` содержит то, что было после `?start=` в ссылке, —
 * это основной путь привязки; текст сообщения разбирается дополнительно, потому
 * что клиент MAX может прислать `/start auth_<token>` обычным сообщением.
 */
const maxUpdate = z.object({
  update_type: z.string().optional(),
  payload: z.string().optional(),
  user: z
    .object({
      user_id: z.number(),
      username: z.string().nullish(),
    })
    .optional(),
  message: z
    .object({
      sender: z
        .object({
          user_id: z.number(),
          username: z.string().nullish(),
        })
        .optional(),
      body: z.object({ text: z.string().nullish() }).optional(),
    })
    .optional(),
});

const forgotPasswordBody = z.object({
  email: z.string().trim().toLowerCase().email("Некорректный e-mail"),
});

const inviteTokenQuery = z.object({
  token: z.string().min(10, "Некорректная ссылка приглашения").max(512),
});

const acceptInviteBody = z.object({
  token: z.string().min(10, "Некорректная ссылка приглашения").max(512),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов").max(200),
  phone: z
    .string()
    .trim()
    .refine((value) => value.replace(/\D/g, "").length >= 10, "Укажите корректный телефон"),
});

const resetPasswordBody = z.object({
  token: z.string().min(10, "Некорректная ссылка восстановления").max(512),
  password: z.string().min(8, "Пароль должен быть не короче 8 символов").max(200),
});

/**
 * Public auth routes, mounted at /auth by app.ts.
 *
 * No authenticate hook here by design: these endpoints mint the credentials
 * that the protected groups then require.
 */
const authRoutes = async (app: FastifyInstance): Promise<void> => {
  const service = new AuthService(app);
  const sessions = new AuthSessionService(app);
  const passwordReset = new PasswordResetService(app);
  const invites = new InviteService();
  const telegram = new TelegramService();
  const max = new MaxService();

  /**
   * Запрос кода подтверждения через бота.
   *
   * Ответ одинаков для известного и неизвестного номера: иначе эндпоинт стал бы
   * инструментом перебора зарегистрированных пользователей.
   */
  app.post(
    "/code/request",
    {
      // Строже общего лимита (100/мин): каждый вызов отправляет сообщение в
      // Telegram, поэтому эндпоинт иначе стал бы средством спама в чужой чат и
      // перебора зарегистрированных номеров.
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = requestCodeBody.parse(request.body);
      const result = await sessions.requestCode(body);
      return reply.status(200).send({ data: result });
    },
  );

  /**
   * Опрос состояния сессии: код мог быть доставлен уже после ответа на
   * /code/request — в момент, когда пользователь нажал Start в боте.
   */
  app.get("/code/status", async (request, reply) => {
    const { session_id } = sessionQuery.parse(request.query);
    const result = await sessions.status(session_id);
    return reply.status(200).send({ data: result });
  });

  /**
   * Webhook Telegram. Публичный по необходимости — его вызывает Telegram, — но
   * защищён секретом из заголовка `X-Telegram-Bot-Api-Secret-Token`: без него
   * любой, кто узнает URL, мог бы привязать произвольный chat_id к сессии.
   */
  app.post("/telegram/webhook", { config: { rateLimit: WEBHOOK_RATE_LIMIT } }, async (request, reply) => {
    if (
      !verifyWebhookSecret(
        request.headers["x-telegram-bot-api-secret-token"],
        getEnv().TELEGRAM_WEBHOOK_SECRET,
      )
    ) {
      // 401 без подробностей: подсказывать причину постороннему не нужно.
      return reply.status(401).send({ ok: false });
    }

    const parsed = telegramUpdate.safeParse(request.body);

    // Telegram повторяет доставку при не-2xx. Некорректный апдейт повторять
    // бессмысленно, поэтому отвечаем 200 и просто игнорируем его.
    if (!parsed.success || parsed.data.message === undefined) {
      return reply.status(200).send({ ok: true });
    }

    const message = parsed.data.message;
    const chatId = message.chat.id;
    const text = message.text ?? "";
    const startMatch = /^\/start(?:\s+([A-Za-z0-9_-]+))?/.exec(text);

    if (startMatch === null) {
      // Пользователь отправил обычное текстовое сообщение: фиксируем квалифицированное первое сообщение
      if (text.length > 0) {
        await attributionEngineService.handleIncomingMessage(
          "telegram",
          String(message.from?.id || chatId),
          text,
          {
            username: message.from?.username ?? null,
            chatId: String(chatId),
          },
        );
      }
      return reply.status(200).send({ ok: true });
    }

    const token = startMatch[1];

    if (token === undefined) {
      await telegram.sendGreeting(chatId);
      return reply.status(200).send({ ok: true });
    }

    // Регистрация запуска бота по маркетинговому deep link: ref_<token>
    // ВНИМАНИЕ: На этом этапе конверсия НЕ отправляется, чтобы не сливать бюджет за пустые клики
    if (token.startsWith("ref_")) {
      await attributionEngineService.handleBotStart(
        token,
        "telegram",
        String(message.from?.id || chatId),
        message.from?.username ?? null,
        String(chatId),
      );
      await telegram.sendGreeting(chatId);
      return reply.status(200).send({ ok: true });
    }

    // Привязка канала уведомлений о лидах: bind_<tenantId> или tenant_<tenantId>
    if (token.startsWith("bind_") || token.startsWith("tenant_")) {
      const rawTenantId = token.replace(/^(?:bind_|tenant_)/, "");
      const tenant = await queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
        [rawTenantId],
      );

      if (tenant) {
        await query(
          `INSERT INTO tenant_notification_channels (
             tenant_id, channel_type, destination, extra_meta, is_active, is_verified
           )
           VALUES ($1, 'telegram', $2, $3, true, true)
           ON CONFLICT (tenant_id, channel_type, destination) DO UPDATE
           SET is_active = true,
               is_verified = true,
               extra_meta = $3,
               updated_at = NOW()`,
          [
            tenant.id,
            String(chatId),
            JSON.stringify({
              username: message.from?.username ?? null,
              first_name: message.from?.first_name ?? null,
              last_name: message.from?.last_name ?? null,
              title: message.chat.title ?? null,
              chat_type: message.chat.type,
            }),
          ],
        );

        await telegram.sendMessage(
          chatId,
          `<b>GETVOXLY — Уведомления о заявках</b>\n\n` +
            `Канал успешно подключен к компании <b>${escapeHtml(tenant.name)}</b>!\n\n` +
            `Сюда будут мгновенно поступать уведомления о новых лидах и заявках с контактными данными клиентов. Антибан-защита активна: бот работает через официальный Bot API платформы без риска блокировок.`,
        );

        return reply.status(200).send({ ok: true });
      } else {
        await telegram.sendLinkExpired(chatId);
        return reply.status(200).send({ ok: true });
      }
    }

    const authToken = token.startsWith("auth_") ? token.slice(5) : token;
    const bound = await sessions.bindTelegramChat({
      token: authToken,
      chatId,
      ...(message.from?.username !== undefined && { username: message.from.username }),
    });

    if (!bound.bound) await telegram.sendLinkExpired(chatId);

    return reply.status(200).send({ ok: true });
  });

  /**
   * Webhook MAX. Публичный по необходимости — его вызывает платформа, — но
   * защищён секретом из заголовка `X-Max-Bot-Api-Secret`: без него любой, кто
   * узнает URL, мог бы привязать произвольный аккаунт к сессии.
   *
   * Токен привязки приходит двумя путями: в `payload` события `bot_started`
   * (переход по deep-link) и в тексте сообщения `/start auth_<token>`, если
   * клиент отправил команду обычным сообщением.
   */
  app.post("/max/webhook", { config: { rateLimit: WEBHOOK_RATE_LIMIT } }, async (request, reply) => {
    // Секрет обязателен, а не «проверяется, если задан»: пропуск проверки при
    // пустом значении делал бы публичный эндпоинт открытым для подделки
    // обновлений. Обязательность гарантируется схемой env (см. superRefine), но
    // здесь она подтверждается ещё раз — 401 безопаснее, чем молчаливый пропуск.
    if (!verifyWebhookSecret(request.headers["x-max-bot-api-secret"], getEnv().MAX_WEBHOOK_SECRET)) {
      // 401 без подробностей: подсказывать причину постороннему не нужно.
      return reply.status(401).send({ ok: false });
    }

    const parsed = maxUpdate.safeParse(request.body);

    // MAX повторяет доставку при не-2xx до 10 раз и отписывает бота после 8
    // часов неудач. Некорректный апдейт повторять бессмысленно, поэтому
    // отвечаем 200 и просто игнорируем его.
    if (!parsed.success) return reply.status(200).send({ ok: true });

    const update = parsed.data;
    const sender = update.user ?? update.message?.sender;

    if (sender === undefined) return reply.status(200).send({ ok: true });

    const maxUserId = String(sender.user_id);
    const username = sender.username ?? undefined;

    // `payload` события bot_started содержит всё, что стояло после `?start=`.
    const fromPayload = /^auth_([A-Za-z0-9_-]+)$/.exec(update.payload ?? "")?.[1];
    const fromText = /^\/start(?:\s+auth_([A-Za-z0-9_-]+))?/.exec(
      update.message?.body?.text ?? "",
    );

    const token = fromPayload ?? fromText?.[1];

    if (token === undefined) {
      // Приветствие только на явный старт, чтобы бот не отвечал на каждое
      // сообщение в диалоге.
      if (update.update_type === "bot_started" || fromText !== null) {
        await max.sendGreeting(maxUserId);
      }
      return reply.status(200).send({ ok: true });
    }

    const bound = await sessions.bindMaxUser({
      token,
      maxUserId,
      ...(username !== undefined && { username }),
    });

    if (!bound.bound) await max.sendLinkExpired(maxUserId);

    return reply.status(200).send({ ok: true });
  });

  /**
   * Вход с обязательным кодом из бота (второй фактор).
   *
   * Пароль проверяется первым: код без пароля не должен пускать в систему, а
   * пароль без кода — тем более.
   */
  app.post(
    "/login/verify",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = loginWithCodeBody.parse(request.body);
      const meta = {
        userAgent: request.headers["user-agent"],
        ip: request.ip,
      };
      const result = await service.loginWithPasswordAndCode(sessions, body, meta);
      setAuthCookies(request, reply, result);
      return reply.status(200).send({ data: result });
    },
  );

  app.post("/otp/send", async (request, reply) => {
    const body = sendOtpBody.parse(request.body);
    const result = await service.sendOtp(body.phone);
    return reply.status(200).send({ data: result });
  });

  app.post("/otp/verify", async (request, reply) => {
    const body = verifyOtpBody.parse(request.body);
    const meta = {
      userAgent: request.headers["user-agent"],
      ip: request.ip,
    };
    const result = await service.verifyOtp(body.phone, body.code, meta);
    setAuthCookies(request, reply, result);
    return reply.status(200).send({ data: result });
  });

  app.post(
    "/login",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = loginBody.parse(request.body);
      const meta = {
        userAgent: request.headers["user-agent"],
        ip: request.ip,
      };
      const result = await service.loginWithPassword(body.email, body.password, meta);
      setAuthCookies(request, reply, result);
      return reply.status(200).send({ data: result });
    },
  );

  /**
   * Public self-service registration: creates the tenant, its subdomain and
   * the owner account, then signs the owner in.
   */
  app.post("/register", async (request, reply) => {
    const body = registerBody.parse(request.body);

    // Код проверяется до создания арендатора: иначе неподтверждённый номер мог
    // бы занять поддомен.
    await sessions.verifyCode(body.session_id, body.code);

    const recipient = await sessions.verifiedRecipient(body.session_id);

    // Гашение сессии передаётся внутрь транзакции создания арендатора, а не
    // выполняется здесь. При `SLUG_TAKEN`, занятом e-mail или уже привязанном
    // Telegram транзакция откатывается вместе с гашением, и пользователь
    // исправляет поле тем же кодом. Прежде код гасился до вставок, поэтому
    // ошибка в одном поле требовала нового кода и повторного открытия бота
    // (`M0.12.8`).
    const result = await service.register({
      slug: body.slug,
      email: body.email,
      phone: body.phone,
      password: body.password,
      telegram_chat_id: recipient.telegram_chat_id,
      max_user_id: recipient.max_user_id,
      consumeSession: (tx) =>
        sessions.consumeVerifiedIn(tx, {
          sessionId: body.session_id,
          purpose: "register",
          phone: body.phone,
          email: body.email,
        }),
    });

    // Приветственное письмо вторично: арендатор уже создан, и недоступность
    // SMTP не должна превращать успешную регистрацию в ошибку. Поэтому
    // отправка не ожидается и её отказ только логируется.
    void EmailService.sendWelcomeEmail(body.email, body.slug).then((sent) => {
      if (!sent.sent) {
        app.log.warn({ email: body.email, reason: sent.error }, "Welcome email not sent");
      }
    });

    setAuthCookies(request, reply, result);
    return reply.status(201).send({ data: result });
  });

  /**
   * Live availability check for the subdomain field.
   *
   * Advisory only — two registrations can pass this check concurrently, and the
   * unique index on `tenants.slug` is what actually resolves the race.
   */
  app.get("/slug-available", async (request, reply) => {
    const { slug } = slugQuery.parse(request.query);
    const result = await service.isSlugAvailable(slug);
    return reply.status(200).send({ data: result });
  });

  /**
   * Запрос ссылки восстановления пароля.
   *
   * Ответ одинаков для известного и неизвестного адреса: иначе эндпоинт стал бы
   * инструментом проверки, зарегистрирован ли e-mail. Лимит строже общего —
   * каждый вызов отправляет письмо.
   */
  app.post(
    "/forgot-password",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = forgotPasswordBody.parse(request.body);
      const result = await passwordReset.request({ email: body.email, ip: request.ip });
      return reply.status(200).send({ data: result });
    },
  );

  /**
   * Смена пароля по токену из письма. Лимит строже общего: эндпоинт принимает
   * токен, и общий 100/мин оставлял бы слишком широкое окно для подбора.
   */
  app.post(
    "/reset-password",
    {
      config: {
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = resetPasswordBody.parse(request.body);
      const result = await passwordReset.confirm({ token: body.token, password: body.password });
      return reply.status(200).send({ data: result });
    },
  );

  /**
   * Данные приглашения для формы активации.
   *
   * Публичный по необходимости: приглашённый сотрудник ещё не может войти.
   * Наружу отдаются только имя компании, роль и e-mail — идентификаторы и хеши
   * остаются внутри.
   */
  app.get(
    "/invite",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const { token } = inviteTokenQuery.parse(request.query);
      const data = await invites.preview(token);
      return reply.send({ data });
    },
  );

  /** Активация учётной записи по приглашению: пароль и телефон. */
  app.post(
    "/invite/accept",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const body = acceptInviteBody.parse(request.body);
      const result = await invites.accept({
        token: body.token,
        password: body.password,
        phone: body.phone,
      });
      return reply.send({ data: result });
    },
  );

  /**
   * Получение данных текущей сессии без ротации refresh-токена.
   * Позволяет Next.js восстанавливать профиль на старте без гонок и сброса сессий.
   */
  app.get(
    "/me",
    {
      config: {
        rateLimit: {
          max: 200,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const authHeader = request.headers.authorization;
      const cookies = parseCookies(request.headers.cookie);
      let token: string | null = null;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice("Bearer ".length);
      } else if (cookies[AUTH_COOKIE_NAME]) {
        token = cookies[AUTH_COOKIE_NAME];
      }

      if (!token) {
        throw new UnauthorizedError("Missing bearer token");
      }

      let payload: { sub: string; tenant_id: string; typ?: string };
      try {
        payload = app.jwt.verify(token) as { sub: string; tenant_id: string; typ?: string };
      } catch {
        throw new UnauthorizedError("Invalid or expired token");
      }

      if (payload.typ !== undefined && payload.typ !== "access") {
        throw new UnauthorizedError("Invalid token type");
      }

      const data = await service.getMe(payload.sub, payload.tenant_id);
      return reply.status(200).send({ data });
    },
  );

  app.post(
    "/refresh",
    {
      config: {
        rateLimit: {
          max: 120,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const cookies = parseCookies(request.headers.cookie);
      let candidateToken: string | undefined;

      if (request.body && typeof request.body === "object") {
        const parsed = refreshBody.safeParse(request.body);
        if (parsed.success) {
          candidateToken = parsed.data.refresh_token;
        }
      }

      const refreshToken = candidateToken || cookies[REFRESH_COOKIE_NAME] || cookies["getvoxly_refresh_token"];
      if (!refreshToken || typeof refreshToken !== "string" || refreshToken.trim().length === 0) {
        clearAuthCookies(request, reply);
        throw new UnauthorizedError("Refresh token is required");
      }

      const meta = {
        userAgent: request.headers["user-agent"],
        ip: request.ip,
      };
      try {
        const result = await service.refreshToken(refreshToken.trim(), meta);
        setAuthCookies(request, reply, result);
        return reply.status(200).send({ data: result });
      } catch (err) {
        clearAuthCookies(request, reply);
        throw err;
      }
    },
  );

  const handleExitImpersonation = async (request: FastifyRequest, reply: FastifyReply) => {
    let candidateRefresh: string | undefined;
    let candidateAccess: string | undefined;

    if (request.body && typeof request.body === "object") {
      const parsed = z
        .object({
          admin_refresh_token: z.string().optional(),
          admin_access_token: z.string().optional(),
        })
        .safeParse(request.body);
      if (parsed.success) {
        candidateRefresh = parsed.data.admin_refresh_token;
        candidateAccess = parsed.data.admin_access_token;
      }
    }

    const cookies = parseCookies(request.headers.cookie);
    const cookieRefresh = cookies[REFRESH_COOKIE_NAME] || cookies["getvoxly_refresh_token"];
    const headerToken = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");

    const meta = {
      userAgent: request.headers["user-agent"],
      ip: request.ip,
    };

    const tokens = await service.exitImpersonation(
      {
        adminRefreshToken: candidateRefresh,
        adminAccessToken: candidateAccess || headerToken,
        cookieRefreshToken: cookieRefresh,
      },
      meta,
    );

    setAuthCookies(request, reply, tokens);
    return reply.status(200).send({ success: true, data: tokens });
  };

  app.post(
    "/exit-impersonation",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    handleExitImpersonation,
  );

  app.post(
    "/revert-impersonation",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    handleExitImpersonation,
  );

  const impersonateBodySchema = z
    .object({
      tenant_id: z.string().uuid().optional(),
      slug: z.string().min(1).optional(),
    })
    .refine((data) => data.tenant_id !== undefined || data.slug !== undefined, {
      message: "Необходимо передать tenant_id или slug",
    });

  app.post(
    "/impersonate",
    {
      config: {
        rateLimit: {
          max: 60,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const cookies = parseCookies(request.headers.cookie);
      const rawToken =
        (request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim() ||
        cookies[AUTH_COOKIE_NAME] ||
        cookies["getvoxly_auth_token"] ||
        "";
      if (!rawToken) {
        throw new UnauthorizedError("Необходима авторизация");
      }
      let payload: { sub: string; tenant_id: string; typ?: string; impersonator_id?: string };
      try {
        payload = app.jwt.verify(rawToken);
      } catch {
        throw new UnauthorizedError("Недействительный токен");
      }
      const callerUser = await queryOne<{
        id: string;
        tenant_id: string;
        email: string;
        name: string;
        role: Role;
        platform_role: PlatformRole | null;
        is_partner: boolean;
        tenant_is_partner: boolean;
      }>(
        `SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.platform_role, u.is_partner, t.is_partner AS tenant_is_partner
         FROM users u
         JOIN tenants t ON t.id = u.tenant_id
         WHERE u.id = $1 AND u.deleted_at IS NULL`,
        [payload.sub],
      );
      if (!callerUser) {
        throw new UnauthorizedError("Пользователь не найден");
      }

      let impersonatorUser: {
        id: string;
        tenant_id: string;
        platform_role: PlatformRole | null;
        is_partner: boolean;
        role: Role;
      } | null = null;

      if (typeof payload.impersonator_id === "string") {
        impersonatorUser = await queryOne(
          `SELECT u.id, u.tenant_id, u.platform_role, u.is_partner, u.role, t.is_partner AS tenant_is_partner
           FROM users u
           JOIN tenants t ON t.id = u.tenant_id
           WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [payload.impersonator_id],
        );
      }

      const body = impersonateBodySchema.parse(request.body);
      let targetTenant: {
        id: string;
        name: string;
        slug: string;
        parent_tenant_id: string | null;
        owner_partner_id: string | null;
      } | null = null;

      if (body.tenant_id) {
        targetTenant = await queryOne(
          `SELECT id, name, slug, parent_tenant_id, owner_partner_id FROM tenants WHERE id = $1`,
          [body.tenant_id],
        );
      } else if (body.slug) {
        targetTenant = await queryOne(
          `SELECT id, name, slug, parent_tenant_id, owner_partner_id FROM tenants WHERE lower(slug) = lower($1)`,
          [body.slug.trim()],
        );
      }

      if (!targetTenant) {
        throw new NotFoundError("Компания не найдена");
      }

      const isPlatformOwner =
        callerUser.platform_role === "platform_owner" ||
        impersonatorUser?.platform_role === "platform_owner";

      const partnerTenantId = impersonatorUser ? impersonatorUser.tenant_id : callerUser.tenant_id;
      const isPartner =
        callerUser.is_partner === true ||
        callerUser.role === "partner" ||
        callerUser.tenant_is_partner === true ||
        impersonatorUser?.is_partner === true ||
        impersonatorUser?.role === "partner";

      const isTargetChildOfPartner =
        (targetTenant.parent_tenant_id !== null && targetTenant.parent_tenant_id === partnerTenantId) ||
        (targetTenant.owner_partner_id !== null && targetTenant.owner_partner_id === partnerTenantId);

      if (!isPlatformOwner && !(isPartner && isTargetChildOfPartner)) {
        throw new PermissionDeniedError("Недостаточно прав для входа в пространство клиента");
      }

      const actorId = isPlatformOwner
        ? callerUser.platform_role === "platform_owner"
          ? callerUser.id
          : impersonatorUser?.id || callerUser.id
        : impersonatorUser?.id || callerUser.id;

      if (!actorId) {
        throw new UnauthorizedError("Не удалось определить идентификатор администратора или партнера");
      }

      const tokens = await service.impersonateTenant(targetTenant.id, actorId);
      setAuthCookies(request, reply, tokens);

      const adminRefreshToken = cookies[REFRESH_COOKIE_NAME] || cookies["getvoxly_refresh_token"] || "";
      const adminAccessToken = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");

      return reply.send({
        success: true,
        data: {
          ...tokens,
          admin_refresh_token: adminRefreshToken,
          admin_access_token: adminAccessToken,
          admin_user: {
            id: actorId,
            email: callerUser.email,
            name: callerUser.name,
          },
        },
      });
    },
  );

  app.post(
    "/logout",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const cookies = parseCookies(request.headers.cookie);
      let candidateToken: string | undefined;

      if (request.body && typeof request.body === "object") {
        const parsed = refreshBody.safeParse(request.body);
        if (parsed.success) {
          candidateToken = parsed.data.refresh_token;
        }
      }

      const refreshToken = candidateToken || cookies[REFRESH_COOKIE_NAME] || cookies["getvoxly_refresh_token"];
      let result = { message: "Logged out" };
      if (refreshToken && typeof refreshToken === "string" && refreshToken.trim().length > 0) {
        result = await service.logout(refreshToken.trim());
      }

      clearAuthCookies(request, reply);
      return reply.status(200).send({ data: result });
    },
  );
};

export default authRoutes;
