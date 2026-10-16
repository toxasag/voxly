import type { FastifyInstance } from "fastify";
import { randomBytes, randomInt } from "node:crypto";
import argon2 from "argon2";
import { query, queryOne, transaction, type TransactionClient } from "../../db/client.js";
import { AppError, UnauthorizedError } from "../../plugins/errorHandler.js";
import { getEnv } from "../../config/env.js";
import { activeUserPredicate } from "./auth.service.js";
import { TelegramService } from "./telegram.service.js";
import { MaxService } from "../../services/max.service.js";

// ---------------------------------------------------------------------------
// Сессии подтверждения (OTP) для регистрации и второго фактора входа.
//
// Отдельно от otp_codes: та таблица ключуется по телефону существующего
// пользователя и не подходит для регистрации, когда пользователя ещё нет.
// Здесь хранится связка «телефон + e-mail + канал» и признак доставки.
//
// Канал — параметр, а не ветка в каждой функции: Telegram и MAX проходят один
// и тот же путь (найти привязанного адресата → отправить код либо выдать
// deep-link → привязать по /start → отправить код), различаясь только
// транспортом и колонкой адресата. Прежняя версия жёстко ссылалась на Telegram
// и отвечала `503` на любой запрос через MAX.
// ---------------------------------------------------------------------------

export type AuthChannel = "telegram" | "max";

/**
 * Назначение сессии подтверждения.
 *
 * `link` — привязка канала уже вошедшим пользователем из `/settings/profile`.
 * Отличается от `login` тем, что владелец известен заранее и передаётся явно, а
 * не выводится из телефона или e-mail, которые задаёт вызывающий публичного
 * `/auth/code/request`. Именно поэтому запрос кода для `link` живёт на
 * аутентифицированном маршруте (`/api/v1/profile/channels/:channel/link`).
 */
export type AuthPurpose = "register" | "login" | "link";

export interface RequestCodeResult {
  session_id: string;
  channel: AuthChannel;
  /** Код уже отправлен в чат. */
  delivered: boolean;
  /**
   * Заполняется, когда чат ещё не привязан: пользователь должен открыть бота,
   * после /start код придёт автоматически.
   */
  deep_link: string | null;
  bot_username: string;
  expires_in_minutes: number;
}

interface SessionRow {
  id: string;
  purpose: AuthPurpose;
  channel: AuthChannel;
  phone: string;
  email: string | null;
  /** Заполнен для `link` и `login`; у `register` пользователя ещё нет. */
  user_id: string | null;
  code_hash: string | null;
  attempts: number;
  telegram_chat_id: string | null;
  max_user_id: string | null;
  verified_at: Date | string | null;
  consumed_at: Date | string | null;
  expires_at: Date | string;
}

/** Адресат подтверждённой сессии — привязывается к создаваемому пользователю. */
export interface VerifiedRecipient {
  telegram_chat_id: number | null;
  max_user_id: string | null;
}

/**
 * Исход проверки кода, возвращаемый из транзакции значением.
 *
 * Нужен потому, что записи-«штрафы» (инкремент попыток, гашение исчерпанной
 * сессии) обязаны коммититься, а исключение из тела транзакции откатывает их
 * вместе с полезной работой. Ошибка формируется вызывающим уже после коммита.
 */
type VerifyCodeOutcome =
  | { kind: "ok"; row: SessionRow }
  | { kind: "unknown" }
  | { kind: "consumed" }
  | { kind: "not_delivered" }
  | { kind: "attempts_exceeded" }
  | { kind: "expired" }
  | { kind: "wrong_code" };

const SESSION_COLUMNS = `id, purpose, channel, phone, email, user_id, code_hash, attempts,
          telegram_chat_id::text, max_user_id, verified_at, consumed_at, expires_at`;

class CodeNotDeliveredError extends AppError {
  constructor() {
    super(
      409,
      "CODE_NOT_DELIVERED",
      "Код ещё не отправлен: откройте бота и нажмите «Start», код придёт автоматически.",
    );
  }
}

class SessionAttemptsExceededError extends AppError {
  constructor() {
    super(429, "OTP_ATTEMPTS_EXCEEDED", "Слишком много попыток. Запросите новый код.");
  }
}

/** Только цифры — тот же формат, что использует AuthService. */
function normalisePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export class AuthSessionService {
  private readonly telegram: TelegramService;
  private readonly max: MaxService;

  constructor(private readonly app: FastifyInstance) {
    this.telegram = new TelegramService();
    this.max = new MaxService();
  }

  /** Настроен ли транспорт канала; иначе запрос кода отклоняется с 503. */
  private assertChannelConfigured(channel: AuthChannel): void {
    if (channel === "telegram" && !this.telegram.isConfigured) {
      throw new AppError(
        503,
        "TELEGRAM_UNAVAILABLE",
        "Telegram-бот не настроен. Обратитесь к администратору платформы.",
      );
    }

    if (channel === "max" && !this.max.isConfigured) {
      throw new AppError(
        503,
        "MAX_UNAVAILABLE",
        "MAX-бот не настроен. Обратитесь к администратору платформы.",
      );
    }
  }

  private botUsername(channel: AuthChannel): string {
    return channel === "telegram" ? this.telegram.username : this.max.username;
  }

  private deepLink(channel: AuthChannel, token: string): string {
    return channel === "telegram" ? this.telegram.deepLink(token) : this.max.deepLink(token);
  }

  /**
   * Владелец сессии входа: тот самый пользователь, которого затем найдёт
   * `AuthService.findByEmail`.
   *
   * Ключом служит e-mail, а не телефон. Телефон уникален только внутри
   * арендатора (`UNIQUE (tenant_id, phone)` по живым строкам), поэтому один и
   * тот же номер законно существует у сотрудников разных компаний. Прежний
   * резолв брал первую строку с этим номером по `created_at` — и при совпадении
   * номера код входа уходил в чат чужого аккаунта, а его владелец получал
   * сообщение о входе, которого не совершал. Дополнение к этому: адресат теперь
   * читается из той же строки, что и телефон, поэтому «телефон одного, чат
   * другого» стало невозможно по построению.
   *
   * Отбор совпадает с выборками входа (`activeUserPredicate`): удалённый или
   * ещё не активированный однофамилец иначе перехватывал бы выборку, а войти
   * всё равно не мог.
   */
  private async resolveLoginTarget(email: string): Promise<{
    id: string;
    phone: string;
    telegram_chat_id: string | null;
    max_user_id: string | null;
  } | null> {
    return queryOne<{
      id: string;
      phone: string;
      telegram_chat_id: string | null;
      max_user_id: string | null;
    }>(
      `SELECT u.id,
              regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g') AS phone,
              u.telegram_chat_id::text,
              u.max_user_id
       FROM users u
       WHERE lower(u.email) = lower($1)
         AND ${activeUserPredicate("u")}
       ORDER BY u.created_at
       LIMIT 1`,
      [email],
    );
  }

  /** Отправка кода выбранным транспортом. */
  private async deliver(
    channel: AuthChannel,
    recipient: string,
    code: string,
    purpose: AuthPurpose,
  ): Promise<{ delivered: boolean; reason?: string }> {
    if (channel === "telegram") {
      return this.telegram.sendCode(Number(recipient), code, purpose);
    }
    return this.max.sendOtpMessage(recipient, code, purpose);
  }

  /**
   * Создаёт сессию подтверждения и, если возможно, сразу доставляет код.
   *
   * Адресат (Telegram chat_id или MAX user_id) переиспользуется только при
   * входе и только из строки пользователя, найденной по e-mail. Если адресата
   * нет — код не генерируется до привязки: отправлять его некуда, а
   * сгенерированный и недоставленный код только расходовал бы попытки.
   */
  async requestCode(input: {
    purpose: AuthPurpose;
    channel: AuthChannel;
    phone?: string;
    email?: string;
    /** Обязателен для `link`: владелец берётся из сессии, а не из тела запроса. */
    userId?: string;
  }): Promise<RequestCodeResult> {
    const env = getEnv();
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MINUTES * 60_000);
    const { channel, purpose } = input;

    this.assertChannelConfigured(channel);

    if (purpose === "link" && input.userId === undefined) {
      // Защита от ошибки программиста: CHECK в схеме отклонил бы такую строку,
      // но с невнятной ошибкой БД вместо явного сообщения.
      throw new AppError(500, "INTERNAL_SERVER_ERROR", "Привязка канала требует пользователя");
    }

    // При входе форма не знает телефон — он резолвится по e-mail. При
    // неизвестном адресе подставляется заглушка, чтобы **хранимая строка** не
    // выдавала, нашёлся ли пользователь.
    //
    // Оговорка, чтобы заглушка не выглядела полной защитой: форма ответа всё
    // ещё различима. Адрес с уже привязанным ботом отвечает
    // `{ delivered: true, deep_link: null }`, неизвестный — `{ delivered: false,
    // deep_link: "…" }`, поэтому эндпоинт остаётся оракулом существования для
    // пользователей, привязавших канал. Лимит 5/мин ограничивает скорость
    // перебора, но не сам сигнал. Выравнивание потребовало бы всегда возвращать
    // deep-link и сообщать доставку только через `/auth/code/status` — это
    // отдельная задача, затрагивающая поток в интерфейсе.
    let phone = normalisePhone(input.phone ?? "");

    /**
     * Адресат уже привязанного чата.
     *
     * Заполняется только для `login` и только из той же строки `users`, из
     * которой взят телефон, — сцепка «телефон одного пользователя, чат другого»
     * стала невозможной по построению.
     *
     * `register` сознательно всегда идёт через deep-link: учётной записи ещё
     * нет, законной существующей привязки быть не может, а прежний поиск по
     * номеру отправлял код регистрации в чат постороннего человека, у которого
     * этот номер уже зарегистрирован в другой компании. Плюс такой путь всё
     * равно был тупиковым: `idx_users_telegram_chat_id` уникален, поэтому
     * перенос чужого чата на создаваемого владельца завершался
     * `TELEGRAM_ALREADY_LINKED` уже после погашения кода.
     *
     * `link` тоже без поиска: цель — привязать конкретный чат, а не
     * воспользоваться существующей привязкой.
     */
    let recipient: string | null = null;

    /**
     * Владелец сессии входа. Служит ключом гашения прежних сессий — телефон для
     * этого не годится, он не уникален между арендаторами (см. ниже).
     */
    let ownerId: string | null = null;

    if (purpose === "login") {
      const target = await this.resolveLoginTarget(input.email ?? "");

      // Заглушка вместо реального номера, когда пользователь не найден либо у
      // него нет телефона.
      //
      // Проверка идёт на **пустую строку**, а не только на null: SQL оборачивает
      // колонку в `coalesce(u.phone, '')`, поэтому у пользователя без телефона
      // (приглашённый сотрудник, очищенное поле в профиле) возвращается `''`, а
      // `??` на строку не реагирует. Без этого все такие сессии делили бы ключ
      // `''`.
      const resolvedPhone = target?.phone ?? "";
      phone =
        resolvedPhone.length > 0
          ? resolvedPhone
          : `unknown-${randomBytes(8).toString("hex")}`;

      if (target !== null) {
        ownerId = target.id;
        recipient =
          (channel === "telegram" ? target.telegram_chat_id : target.max_user_id) ?? null;
      }
    }

    if (purpose === "link") {
      // Телефон читается с сервера по идентификатору из токена: значение из тела
      // запроса позволило бы подставить чужой номер и получить его адресата.
      const owner = await queryOne<{ phone: string | null }>(
        `SELECT regexp_replace(coalesce(phone, ''), '\\D', '', 'g') AS phone
         FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [input.userId ?? ""],
      );

      phone = owner?.phone ?? "";
    }

    const code = recipient === null ? null : generateCode();
    const deepLinkToken = recipient === null ? randomBytes(16).toString("base64url") : null;

    // Хеш считается до открытия транзакции: argon2 занимает десятки миллисекунд
    // CPU (64 MiB, t=3) на пуле libuv из 4 потоков, и внутри транзакции всё это
    // время удерживались бы соединение из пула (max 10) и взятые блокировки.
    const codeHash = code === null ? null : await argon2.hash(code);

    // Владелец сессии: для `link` приходит из токена, для `login` резолвится по
    // e-mail. Для `register` его нет — пользователя ещё не существует.
    const sessionUserId = purpose === "link" ? (input.userId ?? null) : ownerId;

    const session = await transaction(async (tx) => {
      // Гасим прежние незавершённые сессии того же назначения: иначе старый код
      // остался бы валидным и «Получить код заново» не инвалидировал бы его.
      //
      // Ключ — пользователь, а не телефон, всюду, где пользователь известен
      // (`link` и `login`). Телефон для этого негоден: `users.phone` уникален
      // только внутри арендатора (`idx_users_tenant_phone_active`), поэтому один
      // номер законно принадлежит сотрудникам разных компаний, и гашение по нему
      // снимало непогашенную сессию входа однофамильца из другой компании — её
      // код перестал бы работать, а опрос `/auth/code/status` навсегда остался бы
      // в состоянии «не доставлено».
      //
      // `register` остаётся на телефоне: пользователя ещё нет, а номер — то
      // единственное, чем сессия идентифицируется. Двум арендаторам он там не
      // принадлежит: строка появится только после успешной регистрации.
      if (sessionUserId !== null) {
        await tx.query(
          `UPDATE auth_sessions SET consumed_at = now()
           WHERE user_id = $1 AND purpose = $2
             AND consumed_at IS NULL AND verified_at IS NULL`,
          [sessionUserId, purpose],
        );
      } else {
        await tx.query(
          `UPDATE auth_sessions SET consumed_at = now()
           WHERE phone = $1 AND purpose = $2 AND consumed_at IS NULL AND verified_at IS NULL`,
          [phone, purpose],
        );
      }

      return tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO auth_sessions
           (purpose, channel, phone, email, user_id, code_hash, telegram_chat_id, max_user_id,
            deep_link_token, delivered_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          purpose,
          channel,
          phone,
          input.email ?? null,
          sessionUserId,
          codeHash,
          channel === "telegram" && recipient !== null ? Number(recipient) : null,
          channel === "max" ? recipient : null,
          deepLinkToken,
          code === null ? null : new Date(),
          expiresAt,
        ],
      );
    });

    let delivered = false;

    if (recipient !== null && code !== null) {
      const result = await this.deliver(channel, recipient, code, purpose);
      delivered = result.delivered;

      if (!result.delivered) {
        // Бот заблокирован или диалог удалён. Сбрасываем привязку у сессии и
        // выдаём deep-link, иначе пользователь ждал бы код, которого не будет.
        this.app.log.warn({ channel, recipient, reason: result.reason }, "Code delivery failed");

        const token = randomBytes(16).toString("base64url");
        await query(
          `UPDATE auth_sessions
           SET telegram_chat_id = NULL, max_user_id = NULL, code_hash = NULL,
               delivered_at = NULL, deep_link_token = $2
           WHERE id = $1`,
          [session.id, token],
        );

        return {
          session_id: session.id,
          channel,
          delivered: false,
          deep_link: this.deepLink(channel, token),
          bot_username: this.botUsername(channel),
          expires_in_minutes: env.OTP_TTL_MINUTES,
        };
      }
    }

    return {
      session_id: session.id,
      channel,
      delivered,
      deep_link: deepLinkToken === null ? null : this.deepLink(channel, deepLinkToken),
      bot_username: this.botUsername(channel),
      expires_in_minutes: env.OTP_TTL_MINUTES,
    };
  }

  /**
   * Состояние сессии для опроса из UI: код мог быть доставлен уже после ответа
   * на requestCode, когда пользователь нажал Start в боте.
   */
  async status(
    sessionId: string,
  ): Promise<{ delivered: boolean; verified: boolean; expired: boolean }> {
    const row = await queryOne<{
      delivered_at: Date | string | null;
      verified_at: Date | string | null;
      expires_at: Date | string;
    }>(`SELECT delivered_at, verified_at, expires_at FROM auth_sessions WHERE id = $1`, [sessionId]);

    if (row === null) throw new UnauthorizedError("Session not found");

    return {
      delivered: row.delivered_at !== null,
      verified: row.verified_at !== null,
      expired: toDate(row.expires_at).getTime() < Date.now(),
    };
  }

  /**
   * Привязывает адресата к сессии по deep-link токену и сразу отправляет код.
   *
   * Вызывается из webhook-обработчика /start. Идемпотентна по токену: он
   * гасится сразу, поэтому повторный /start по той же ссылке не выдаст код
   * второй раз — но только когда код действительно ушёл. Если доставка
   * сорвалась, шаг откатывается целиком и токен возвращается, чтобы повторный
   * /start остался рабочим (см. ветку отказа ниже). Сессия ищется вместе с
   * проверкой канала — токен, выданный для Telegram, не должен привязывать
   * MAX-аккаунт и наоборот.
   */
  private async bindRecipient(input: {
    channel: AuthChannel;
    token: string;
    recipient: string;
    username?: string;
  }): Promise<{ bound: boolean }> {
    const { channel, recipient } = input;
    const code = generateCode();

    // Хеш считается до открытия транзакции: argon2 занимает десятки
    // миллисекунд CPU, и внутри транзакции соединение из пула (max 10) и
    // блокировка FOR UPDATE удерживались бы всё это время.
    const codeHash = await argon2.hash(code);

    const session = await transaction(async (tx) => {
      const row = await tx.queryOne<{
        id: string;
        purpose: AuthPurpose;
        email: string | null;
        expires_at: Date | string;
      }>(
        `SELECT id, purpose, email, expires_at
         FROM auth_sessions
         WHERE deep_link_token = $1 AND channel = $2
           AND consumed_at IS NULL AND verified_at IS NULL
         FOR UPDATE`,
        [input.token, channel],
      );

      if (row === null) return null;
      if (toDate(row.expires_at).getTime() < Date.now()) return null;

      const column = channel === "telegram" ? "telegram_chat_id" : "max_user_id";

      await tx.query(
        `UPDATE auth_sessions
         SET ${column} = $2, code_hash = $3, delivered_at = now(), deep_link_token = NULL
         WHERE id = $1`,
        [row.id, channel === "telegram" ? Number(recipient) : recipient, codeHash],
      );

      return row;
    });

    if (session === null) return { bound: false };

    const result = await this.deliver(channel, recipient, code, session.purpose);

    if (!result.delivered) {
      this.app.log.error(
        { channel, recipient, reason: result.reason },
        "Code delivery failed right after /start",
      );

      // Полный откат шага привязки, а не только `delivered_at = NULL`.
      //
      // Прежняя версия оставляла `code_hash` заполненным при уже погашенном
      // deep-link токене. Последствия были двойные: `verifyCode` видел
      // непустой хеш, поэтому вместо честного `CODE_NOT_DELIVERED` списывал
      // попытки за код, которого пользователь не получал (пять таких попыток
      // гасили сессию целиком), а повторное нажатие «Start» по той же ссылке
      // уже ничего не находило — токен был снят.
      //
      // Токен возвращается тот же самый, а не новый: ссылка, показанная в
      // браузере, должна продолжать работать. Значение свободно — строка
      // единственная, кто им владел, а частичный уникальный индекс проверяет
      // только не-NULL значения.
      const column = channel === "telegram" ? "telegram_chat_id" : "max_user_id";

      await query(
        `UPDATE auth_sessions
         SET ${column} = NULL, code_hash = NULL, delivered_at = NULL, deep_link_token = $2
         WHERE id = $1`,
        [session.id, input.token],
      );

      return { bound: false };
    }

    // Адресат СОЗНАТЕЛЬНО не записывается в `users` на этом шаге.
    //
    // В момент /start известно лишь то, что кто-то открыл бота по ссылке; ни
    // телефон, ни e-mail сессии ещё не подтверждены — оба свободно задаются
    // вызывающим `/auth/code/request`. Прежняя версия писала адресата в `users`
    // по совпадению одного номера телефона, из-за чего достаточно было знать
    // чужой номер: запросить код, открыть deep-link своим ботом — и
    // `telegram_chat_id`/`max_user_id` жертвы указывал бы на чужой чат, куда
    // затем уходили её коды входа. Условие `IS NULL` от этого не защищало: у
    // ещё не привязанного пользователя колонка как раз пуста.
    //
    // Привязка сохраняется позже и только после доказательства владения
    // аккаунтом: `linkVerifiedRecipient` вызывается из успешного входа (пароль +
    // код), а при регистрации адресат переносится на создаваемого владельца из
    // подтверждённой сессии (`verifiedRecipient`).
    return { bound: true };
  }

  /**
   * Результат записи привязки. Различать исходы необходимо для
   * `/settings/profile`: там пользователь сознательно привязывает канал и должен
   * понимать, почему это не сработало.
   */
  private static readonly LINK_OUTCOMES = ["linked", "already_linked", "taken", "skipped"] as const;

  /**
   * Запоминает адресата подтверждённой сессии у пользователя, чтобы следующий
   * код ушёл сразу, без открытия бота.
   *
   * Вызывается после доказанного владения аккаунтом: из успешного входа (пароль
   * + код) либо из явной привязки в настройках (сессия + код).
   *
   * Исключение уникального индекса не пробрасывается наружу, а превращается в
   * исход `taken`: при входе привязка второстепенна и не должна ломать вход, а в
   * настройках вызывающий сам решит, показать это ошибкой или нет.
   */
  async linkVerifiedRecipient(input: {
    sessionId: string;
    userId: string;
  }): Promise<(typeof AuthSessionService.LINK_OUTCOMES)[number]> {
    const row = await queryOne<{
      channel: AuthChannel;
      telegram_chat_id: string | null;
      max_user_id: string | null;
    }>(
      `SELECT channel, telegram_chat_id::text, max_user_id
       FROM auth_sessions
       WHERE id = $1 AND verified_at IS NOT NULL`,
      [input.sessionId],
    );

    if (row === null) return "skipped";

    const recipient = row.channel === "telegram" ? row.telegram_chat_id : row.max_user_id;
    if (recipient === null) return "skipped";

    const idColumn = row.channel === "telegram" ? "telegram_chat_id" : "max_user_id";
    const value = row.channel === "telegram" ? Number(recipient) : recipient;

    try {
      // `IS NULL` в WHERE не ставится: тогда повторная привязка того же чата
      // выглядела бы как отказ. Вместо этого различаем «уже был этот же» и
      // «занято другим» по результату.
      const updated = await queryOne<{ id: string }>(
        `UPDATE users
         SET ${idColumn} = $2, updated_at = now()
         WHERE id = $1 AND (${idColumn} IS NULL OR ${idColumn} = $2)
         RETURNING id`,
        [input.userId, value],
      );

      if (updated !== null) return "linked";

      // Строка не обновилась: колонка занята другим значением у этого же
      // пользователя — канал уже привязан к другому чату.
      return "already_linked";
    } catch (error) {
      // 23505 на частичном уникальном индексе: этот чат принадлежит другой
      // учётной записи.
      if (typeof error === "object" && error !== null && "code" in error) {
        if ((error as { code?: unknown }).code === "23505") return "taken";
      }

      this.app.log.warn(
        { channel: row.channel, userId: input.userId, error },
        "Could not persist bot link on user",
      );
      return "skipped";
    }
  }

  /**
   * Гасит подтверждённую сессию привязки, сверяя владельца.
   *
   * Отдельно от `consumeVerified`: та сверяет телефон и e-mail, но у
   * приглашённого сотрудника телефон может быть пустым, а e-mail в
   * `link`-сессии не хранится. Здесь достаточным и более строгим признаком
   * служит `user_id` — сессию, созданную для другого пользователя, предъявить
   * нельзя.
   */
  async consumeLinkSession(input: { sessionId: string; userId: string }): Promise<void> {
    await transaction(async (tx) => {
      const row = await tx.queryOne<{
        id: string;
        purpose: AuthPurpose;
        user_id: string | null;
        verified_at: Date | string | null;
        consumed_at: Date | string | null;
      }>(
        `SELECT id, purpose, user_id, verified_at, consumed_at
         FROM auth_sessions WHERE id = $1 FOR UPDATE`,
        [input.sessionId],
      );

      if (row === null || row.verified_at === null) {
        throw new UnauthorizedError("Подтвердите код из бота");
      }
      if (row.consumed_at !== null) throw new UnauthorizedError("Код уже использован");
      if (row.purpose !== "link") throw new UnauthorizedError("Код выдан для другой операции");
      if (row.user_id !== input.userId) {
        throw new UnauthorizedError("Код выдан для другой учётной записи");
      }

      await tx.query(`UPDATE auth_sessions SET consumed_at = now() WHERE id = $1`, [row.id]);
    });
  }

  /** Привязка Telegram-чата по deep-link токену (webhook /start). */
  bindTelegramChat(input: {
    token: string;
    chatId: number;
    username?: string;
  }): Promise<{ bound: boolean }> {
    return this.bindRecipient({
      channel: "telegram",
      token: input.token,
      recipient: String(input.chatId),
      ...(input.username !== undefined && { username: input.username }),
    });
  }

  /** Привязка MAX-аккаунта по deep-link токену (webhook bot_started/message). */
  bindMaxUser(input: {
    token: string;
    maxUserId: string;
    username?: string;
  }): Promise<{ bound: boolean }> {
    return this.bindRecipient({
      channel: "max",
      token: input.token,
      recipient: input.maxUserId,
      ...(input.username !== undefined && { username: input.username }),
    });
  }

  /**
   * Проверяет код и помечает сессию подтверждённой.
   *
   * Не потребляет сессию: её потребляют register/login, чтобы код нельзя было
   * проверить, а затем использовать повторно для второй регистрации.
   *
   * Исход возвращается из транзакции значением, а исключение бросается **после**
   * её коммита. Прежняя версия бросала изнутри, и `transaction()` откатывал
   * записи, сделанные в той же транзакции: инкремент `attempts` и гашение
   * исчерпанной сессии не сохранялись. Практический итог — счётчик попыток не
   * работал вовсе, и код можно было подбирать без ограничения. Обнаружено
   * тестом «расходует попытку на неверный код»: шестая попытка отвечала 200
   * вместо 429.
   *
   * `FOR UPDATE` при этом сохраняется: запись идёт в той же транзакции, что и
   * чтение под блокировкой, поэтому параллельные проверки по-прежнему
   * сериализуются. Вынести инкремент за пределы транзакции было бы хуже — два
   * одновременных запроса прочитали бы одно значение и записали одно и то же.
   */
  async verifyCode(sessionId: string, code: string): Promise<SessionRow> {
    const env = getEnv();

    const outcome = await transaction<VerifyCodeOutcome>(async (tx) => {
      // FOR UPDATE сериализует параллельные проверки: иначе счётчик попыток
      // можно было бы обойти одновременными запросами.
      const row = await tx.queryOne<SessionRow>(
        `SELECT ${SESSION_COLUMNS}
         FROM auth_sessions
         WHERE id = $1
         FOR UPDATE`,
        [sessionId],
      );

      if (row === null) return { kind: "unknown" };
      if (row.consumed_at !== null) return { kind: "consumed" };
      if (row.code_hash === null) return { kind: "not_delivered" };

      if (row.attempts >= env.OTP_MAX_ATTEMPTS) {
        await tx.query(`UPDATE auth_sessions SET consumed_at = now() WHERE id = $1`, [row.id]);
        return { kind: "attempts_exceeded" };
      }

      if (toDate(row.expires_at).getTime() < Date.now()) {
        await tx.query(`UPDATE auth_sessions SET consumed_at = now() WHERE id = $1`, [row.id]);
        return { kind: "expired" };
      }

      if (!(await argon2.verify(row.code_hash, code))) {
        await tx.query(`UPDATE auth_sessions SET attempts = attempts + 1 WHERE id = $1`, [row.id]);
        return { kind: "wrong_code" };
      }

      await tx.query(`UPDATE auth_sessions SET verified_at = now() WHERE id = $1`, [row.id]);

      return { kind: "ok", row: { ...row, verified_at: new Date() } };
    });

    switch (outcome.kind) {
      case "ok":
        return outcome.row;
      case "consumed":
        throw new UnauthorizedError("Код уже использован");
      case "not_delivered":
        throw new CodeNotDeliveredError();
      case "attempts_exceeded":
        throw new SessionAttemptsExceededError();
      case "expired":
        throw new UnauthorizedError("Срок действия кода истёк");
      // Неизвестная сессия и неверный код отвечают одинаково: различие
      // подсказывало бы, существует ли сессия с таким идентификатором.
      case "unknown":
      case "wrong_code":
        throw new UnauthorizedError("Неверный код подтверждения");
    }
  }

  /**
   * Проверяет, что сессия подтверждена и соответствует заявленным телефону и
   * e-mail, затем гасит её — в **переданной** транзакции.
   *
   * Отдельный метод, принимающий `tx`, нужен регистрации: гашение обязано
   * коммититься вместе с созданием арендатора. Прежде `/auth/register` гасил
   * сессию своей транзакцией до вставок, и любая последующая ошибка
   * (`SLUG_TAKEN`, занятый e-mail, занятый Telegram) оставляла код
   * израсходованным: чтобы исправить одно поле формы, пользователь был обязан
   * запрашивать новый код и снова открывать бота.
   *
   * Сверка полей обязательна: без неё подтверждённую сессию можно было бы
   * предъявить для регистрации на другой номер или адрес.
   */
  async consumeVerifiedIn(
    tx: TransactionClient,
    input: {
      sessionId: string;
      purpose: AuthPurpose;
      /** Может быть пустым или NULL у сотрудника, очистившего телефон в профиле. */
      phone: string | null;
      email?: string;
      /**
       * Владелец, доказавший права (вход). Когда передан и сессия знает
       * владельца, сверка идёт по нему, а не по телефону.
       */
      userId?: string;
    },
  ): Promise<void> {
    const row = await tx.queryOne<SessionRow>(
      `SELECT ${SESSION_COLUMNS}
       FROM auth_sessions
       WHERE id = $1
       FOR UPDATE`,
      [input.sessionId],
    );

    if (row === null || row.verified_at === null) {
      throw new UnauthorizedError("Подтвердите код из бота");
    }
    if (row.consumed_at !== null) throw new UnauthorizedError("Код уже использован");
    if (row.purpose !== input.purpose) throw new UnauthorizedError("Код выдан для другой операции");

    // Сверка владельца там, где он известен обеим сторонам, — строже и надёжнее
    // телефона: `user_id` уникален глобально, тогда как один номер законно
    // принадлежит сотрудникам разных арендаторов. Дополнительно это снимает
    // отказ у пользователя без телефона: у него в сессии стоит заглушка
    // `unknown-…`, и сравнение по номеру не совпало бы никогда.
    if (input.userId !== undefined && row.user_id !== null) {
      if (row.user_id !== input.userId) {
        throw new UnauthorizedError("Код выдан для другой учётной записи");
      }
    } else {
      const phone = normalisePhone(input.phone ?? "");
      if (row.phone !== phone) throw new UnauthorizedError("Код выдан для другого номера");
    }

    if (
      input.email !== undefined &&
      row.email !== null &&
      row.email.toLowerCase() !== input.email.toLowerCase()
    ) {
      throw new UnauthorizedError("Код выдан для другого e-mail");
    }

    await tx.query(`UPDATE auth_sessions SET consumed_at = now() WHERE id = $1`, [row.id]);
  }

  /**
   * Та же проверка с гашением, но в собственной транзакции.
   *
   * Используется входом: там за гашением следует только выдача токенов, и
   * откатывать нечего.
   */
  async consumeVerified(input: {
    sessionId: string;
    purpose: AuthPurpose;
    phone: string | null;
    email?: string;
    userId?: string;
  }): Promise<void> {
    await transaction((tx) => this.consumeVerifiedIn(tx, input));
  }

  /** Адресат подтверждённой сессии — привязывается к создаваемому пользователю. */
  async verifiedRecipient(sessionId: string): Promise<VerifiedRecipient> {
    const row = await queryOne<{ telegram_chat_id: string | null; max_user_id: string | null }>(
      `SELECT telegram_chat_id::text, max_user_id FROM auth_sessions WHERE id = $1`,
      [sessionId],
    );

    if (row === null) return { telegram_chat_id: null, max_user_id: null };

    return {
      telegram_chat_id: row.telegram_chat_id === null ? null : Number(row.telegram_chat_id),
      max_user_id: row.max_user_id,
    };
  }
}
