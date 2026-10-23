import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { computeCheck } from "telegram/Password.js";
import { RPCError } from "telegram/errors/index.js";
import { LogLevel } from "telegram/extensions/Logger.js";
import QRCode from "qrcode";

import { getEnv } from "../../config/env.js";
import { AppError } from "../../plugins/errorHandler.js";

// ---------------------------------------------------------------------------
// Подключение пользовательских аккаунтов Telegram через MTProto (GramJS).
//
// Это НЕ бот. Bot API (`modules/auth/telegram.service.ts`) доставляет коды входа
// в саму CRM и работает с чужими сообщениями только там, где бот добавлен.
// Здесь пользователь передаёт доступ к своему аккаунту, чтобы CRM видела личную
// переписку с клиентами — для этого существует только MTProto.
//
// Почему не высокоуровневый `client.signInUser()`: он принимает колбэки
// (`phoneCode: () => Promise<string>`) и рассчитан на интерактивный CLI, который
// ждёт ввода в том же процессе. HTTP-обмен разорван на два запроса, между ними
// нет живого стека, поэтому используются низкоуровневые `Api.auth.SignIn` и
// `Api.auth.CheckPassword`. Задание называет `client.signIn(...)` — такого метода
// в GramJS 2.26 нет (проверено по типам), ближайший колбэчный не подходит по той
// же причине.
//
// Состояние между шагами: MTProto привязывает `phone_code_hash` к auth_key
// конкретного соединения. Новый клиент с пустой сессией получил бы
// PHONE_CODE_INVALID на верный код, поэтому StringSession сохраняется в БД между
// запросами (таблица `telegram_auth_sessions`, миграция 0013).
// ---------------------------------------------------------------------------

/** Сколько ждать ответа Telegram, прежде чем считать вызов неудачным. */
const CONNECTION_TIMEOUT_MS = 20_000;
const CONNECTION_RETRIES = 3;

export class TelegramMtprotoUnavailableError extends AppError {
  constructor() {
    super(
      503,
      "TELEGRAM_MTPROTO_UNAVAILABLE",
      "Подключение Telegram не настроено на платформе: отсутствуют TELEGRAM_API_ID и TELEGRAM_API_HASH. Обратитесь к администратору.",
    );
  }
}

/** Требуется облачный пароль. Отдельный класс: это не ошибка, а следующий шаг. */
export class TelegramPasswordRequiredError extends AppError {
  constructor(public readonly hint: string | null) {
    super(409, "TELEGRAM_2FA_REQUIRED", "Требуется облачный пароль (2FA)");
  }
}

export interface SendCodeOutcome {
  phoneCodeHash: string;
  /** Код пришёл в приложение Telegram (true) или SMS (false). */
  isCodeViaApp: boolean;
  /** Состояние клиента, которое нужно сохранить до второго шага. */
  sessionState: string;
}

export interface SignInOutcome {
  sessionState: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    username: string | null;
    phone: string | null;
  };
}

/**
 * Перевод ошибок Telegram в понятные пользователю сообщения.
 *
 * Без него интерфейс показывал бы `PHONE_CODE_INVALID` — строку из протокола,
 * которая ничего не говорит человеку, вводящему код.
 */
function translateRpcError(error: RPCError): AppError {
  const message = error.errorMessage;

  // FLOOD_WAIT_x: Telegram сообщает, сколько секунд ждать. Показываем именно
  // это, иначе пользователь повторяет попытки и продлевает блокировку.
  const flood = /^FLOOD_WAIT_(\d+)$/.exec(message);
  if (flood !== null) {
    const seconds = Number(flood[1] ?? 0);
    const minutes = Math.ceil(seconds / 60);
    return new AppError(
      429,
      "TELEGRAM_FLOOD_WAIT",
      seconds < 60
        ? `Telegram временно ограничил попытки. Повторите через ${seconds} с.`
        : `Telegram временно ограничил попытки. Повторите через ${minutes} мин.`,
    );
  }

  switch (message) {
    case "PHONE_NUMBER_INVALID":
      return new AppError(400, "TELEGRAM_PHONE_INVALID", "Telegram не принял этот номер телефона");
    case "PHONE_NUMBER_BANNED":
      return new AppError(403, "TELEGRAM_PHONE_BANNED", "Этот номер заблокирован в Telegram");
    case "PHONE_CODE_INVALID":
      return new AppError(400, "TELEGRAM_CODE_INVALID", "Неверный код из Telegram");
    case "PHONE_CODE_EXPIRED":
      return new AppError(
        410,
        "TELEGRAM_CODE_EXPIRED",
        "Код истёк. Запросите новый код.",
      );
    case "PASSWORD_HASH_INVALID":
      return new AppError(400, "TELEGRAM_PASSWORD_INVALID", "Неверный облачный пароль (2FA)");
    case "PHONE_PASSWORD_FLOOD":
      return new AppError(
        429,
        "TELEGRAM_FLOOD_WAIT",
        "Слишком много попыток ввода пароля. Повторите позже.",
      );
    case "AUTH_RESTART":
      return new AppError(
        409,
        "TELEGRAM_AUTH_RESTART",
        "Telegram прервал авторизацию. Начните подключение заново.",
      );
    case "SESSION_PASSWORD_NEEDED":
      // Обрабатывается вызывающим до этой функции; сюда попадать не должно.
      return new TelegramPasswordRequiredError(null);
    default:
      return new AppError(
        502,
        "TELEGRAM_MTPROTO_ERROR",
        `Telegram отклонил запрос: ${message}`,
      );
  }
}

export class TelegramMtprotoService {
  private readonly apiId: number | undefined;
  private readonly apiHash: string | undefined;

  constructor() {
    const env = getEnv();
    this.apiId = env.TELEGRAM_API_ID;
    this.apiHash = env.TELEGRAM_API_HASH;
  }

  get isConfigured(): boolean {
    return this.apiId !== undefined && this.apiHash !== undefined;
  }

  public credentials(): { apiId: number; apiHash: string } {
    if (this.apiId === undefined || this.apiHash === undefined) {
      throw new TelegramMtprotoUnavailableError();
    }
    return { apiId: this.apiId, apiHash: this.apiHash };
  }

  /**
   * Создаёт клиент на переданном состоянии сессии.
   *
   * Логгер GramJS приглушён до ошибок: на уровне info он печатает содержимое
   * пакетов MTProto, включая фрагменты авторизации, в общий stdout контейнера.
   */
  private async client(sessionState: string): Promise<TelegramClient> {
    const { apiId, apiHash } = this.credentials();
    const session = new StringSession(sessionState);

    const client = new TelegramClient(session, apiId, apiHash, {
      connectionRetries: CONNECTION_RETRIES,
      timeout: Math.floor(CONNECTION_TIMEOUT_MS / 1000),
      // Без этого GramJS считает себя устаревшим клиентом на некоторых DC.
      deviceModel: "GETVOXLY CRM",
      systemVersion: "1.0",
      appVersion: "1.0",
      useWSS: false,
    });

    client.setLogLevel(LogLevel.ERROR);
    await client.connect();

    return client;
  }

  /**
   * Первый шаг: запрос кода на номер.
   *
   * Возвращает состояние сессии, которое обязано сохраниться до второго шага —
   * иначе `phone_code_hash` окажется выдан другому auth_key.
   */
  async sendCode(phone: string): Promise<SendCodeOutcome> {
    const { apiId, apiHash } = this.credentials();
    const session = new StringSession("");
    const client = await this.client(session.save());

    try {
      const result = await client.sendCode({ apiId, apiHash }, phone);
      const state = (client.session as StringSession).save();

      return {
        phoneCodeHash: result.phoneCodeHash,
        isCodeViaApp: result.isCodeViaApp,
        sessionState: state,
      };
    } catch (error) {
      throw error instanceof RPCError ? translateRpcError(error) : error;
    } finally {
      // Соединение закрывается всегда: иначе каждый запрос кода оставлял бы
      // открытый сокет к DC, и процесс со временем упирался бы в лимит дескрипторов.
      await this.close(client);
    }
  }

  /**
   * Создаёт подключённый клиент и запрашивает первичный QR-код.
   * Клиент остаётся подключённым и возвращается вызывающему коду для ожидания события `UpdateLoginToken`.
   */
  async createQrClient(): Promise<{
    client: TelegramClient;
    token: Buffer;
    expires: number;
    qrUrl: string;
    qrBase64: string;
  }> {
    const { apiId, apiHash } = this.credentials();
    const client = await this.client("");

    try {
      const result = await client.invoke(
        new Api.auth.ExportLoginToken({
          apiId,
          apiHash,
          exceptIds: [],
        }),
      );

      if (!(result instanceof Api.auth.LoginToken)) {
        throw new Error("Неожиданный ответ Telegram при генерации QR-кода");
      }

      const token = Buffer.from(result.token);
      const tokenB64Url = token.toString("base64url");
      const qrUrl = `tg://login?token=${tokenB64Url}`;
      const qrBase64 = await QRCode.toDataURL(qrUrl, { margin: 1, width: 300 });

      return {
        client,
        token,
        expires: result.expires,
        qrUrl,
        qrBase64,
      };
    } catch (err) {
      await this.close(client);
      throw err;
    }
  }

  /**
   * Проверяет или завершает QR-авторизацию на открытом клиенте:
   * 1. Если отсканировано и нет 2FA -> "connected" + user
   * 2. Если аккаунт на другом DC -> мигрирует DC и завершает -> "connected" + user
   * 3. Если требуется 2FA -> "requires_2fa" + passwordHint
   * 4. Если токен ещё ждёт сканирования или обновился -> "waiting" + refreshedQr
   */
  async checkOrCompleteQr(client: TelegramClient): Promise<{
    status: "waiting" | "connected" | "requires_2fa";
    sessionState?: string;
    user?: SignInOutcome["user"];
    passwordHint?: string | null;
    refreshedQr?: { qrBase64: string; expires: number };
  }> {
    const { apiId, apiHash } = this.credentials();

    try {
      const result = await client.invoke(
        new Api.auth.ExportLoginToken({
          apiId,
          apiHash,
          exceptIds: [],
        }),
      );

      // 1. Успешная авторизация (без 2FA)
      if (result instanceof Api.auth.LoginTokenSuccess) {
        const user = this.extractUser(result.authorization);
        return {
          status: "connected",
          sessionState: (client.session as StringSession).save(),
          user: this.toUserInfo(user),
        };
      }

      // 2. Миграция на другой DC (если аккаунт пользователя на другом датацентре)
      if (result instanceof Api.auth.LoginTokenMigrateTo) {
        await client._switchDC(result.dcId);
        const migrated = await client.invoke(
          new Api.auth.ImportLoginToken({
            token: result.token,
          }),
        );
        if (migrated instanceof Api.auth.LoginTokenSuccess) {
          const user = this.extractUser(migrated.authorization);
          return {
            status: "connected",
            sessionState: (client.session as StringSession).save(),
            user: this.toUserInfo(user),
          };
        }
      }

      // 3. Токен ожидает сканирования
      if (result instanceof Api.auth.LoginToken) {
        const token = Buffer.from(result.token);
        const qrUrl = `tg://login?token=${token.toString("base64url")}`;
        const qrBase64 = await QRCode.toDataURL(qrUrl, { margin: 1, width: 300 });
        return {
          status: "waiting",
          refreshedQr: {
            qrBase64,
            expires: result.expires,
          },
        };
      }

      return { status: "waiting" };
    } catch (error: unknown) {
      if (error instanceof RPCError && error.errorMessage === "SESSION_PASSWORD_NEEDED") {
        const passwordInfo = await client.invoke(new Api.account.GetPassword());
        return {
          status: "requires_2fa",
          sessionState: (client.session as StringSession).save(),
          passwordHint: passwordInfo.hint ?? null,
        };
      }
      throw error instanceof RPCError ? translateRpcError(error) : error;
    }
  }

  /**
   * Обновляет QR-токен на существующем клиенте (если истёк срок ~30 сек до сканирования).
   */
  async refreshQrToken(client: TelegramClient): Promise<{
    qrBase64: string;
    expires: number;
  }> {
    const { apiId, apiHash } = this.credentials();
    const result = await client.invoke(
      new Api.auth.ExportLoginToken({
        apiId,
        apiHash,
        exceptIds: [],
      }),
    );

    if (!(result instanceof Api.auth.LoginToken)) {
      throw new Error("Не удалось обновить QR-код Telegram");
    }

    const token = Buffer.from(result.token);
    const qrUrl = `tg://login?token=${token.toString("base64url")}`;
    const qrBase64 = await QRCode.toDataURL(qrUrl, { margin: 1, width: 300 });

    return {
      qrBase64,
      expires: result.expires,
    };
  }

  /**
   * Ввод 2FA пароля на уже существующем подключённом клиенте.
   */
  async submitPasswordWithClient(client: TelegramClient, password: string): Promise<SignInOutcome> {
    const authorization = await this.checkPassword(client, password);

    return {
      sessionState: (client.session as StringSession).save(),
      user: this.toUserInfo(authorization),
    };
  }

  /**
   * Старт авторизации через QR-код.
   * Возвращает sessionState, token, qr (data:image/png;base64,...), expires (timestamp в сек).
   */
  async exportLoginToken(): Promise<{
    sessionState: string;
    token: Buffer;
    expires: number;
    qrUrl: string;
    qrBase64: string;
  }> {
    const { apiId, apiHash } = this.credentials();
    const session = new StringSession("");
    const client = await this.client(session.save());

    try {
      const result = await client.invoke(
        new Api.auth.ExportLoginToken({
          apiId,
          apiHash,
          exceptIds: [],
        }),
      );

      if (!(result instanceof Api.auth.LoginToken)) {
        throw new Error("Неожиданный ответ Telegram при генерации QR-кода");
      }

      const token = Buffer.from(result.token);
      const tokenB64Url = token.toString("base64url");
      const qrUrl = `tg://login?token=${tokenB64Url}`;
      const qrBase64 = await QRCode.toDataURL(qrUrl, { margin: 1, width: 300 });

      return {
        sessionState: (client.session as StringSession).save(),
        token,
        expires: result.expires,
        qrUrl,
        qrBase64,
      };
    } finally {
      await this.close(client);
    }
  }

  /**
   * Проверка состояния QR-авторизации:
   * возвращает статус ожидания, авторизации (с объектом пользователя) или требование 2FA.
   */
  async checkQrStatus(sessionState: string): Promise<{
    status: "waiting" | "connected" | "requires_2fa";
    sessionState?: string;
    user?: SignInOutcome["user"];
    passwordHint?: string | null;
    refreshedQr?: {
      qrBase64: string;
      expires: number;
    };
  }> {
    const { apiId, apiHash } = this.credentials();
    const client = await this.client(sessionState);

    try {
      const result = await client.invoke(
        new Api.auth.ExportLoginToken({
          apiId,
          apiHash,
          exceptIds: [],
        }),
      );

      // 1. Успешная авторизация
      if (result instanceof Api.auth.LoginTokenSuccess) {
        const user = this.extractUser(result.authorization);
        return {
          status: "connected",
          sessionState: (client.session as StringSession).save(),
          user: this.toUserInfo(user),
        };
      }

      // 2. Миграция на другой DC (если аккаунт пользователя на другом датацентре)
      if (result instanceof Api.auth.LoginTokenMigrateTo) {
        await client._switchDC(result.dcId);
        const migrated = await client.invoke(
          new Api.auth.ImportLoginToken({
            token: result.token,
          }),
        );
        if (migrated instanceof Api.auth.LoginTokenSuccess) {
          const user = this.extractUser(migrated.authorization);
          return {
            status: "connected",
            sessionState: (client.session as StringSession).save(),
            user: this.toUserInfo(user),
          };
        }
      }

      // 3. Всё ещё ожидает сканирования
      if (result instanceof Api.auth.LoginToken) {
        const token = Buffer.from(result.token);
        const qrUrl = `tg://login?token=${token.toString("base64url")}`;
        const qrBase64 = await QRCode.toDataURL(qrUrl, { margin: 1, width: 300 });
        return {
          status: "waiting",
          sessionState: (client.session as StringSession).save(),
          refreshedQr: {
            qrBase64,
            expires: result.expires,
          },
        };
      }

      return {
        status: "waiting",
        sessionState: (client.session as StringSession).save(),
      };
    } catch (error: unknown) {
      if (error instanceof RPCError && error.errorMessage === "SESSION_PASSWORD_NEEDED") {
        const passwordInfo = await client.invoke(new Api.account.GetPassword());
        return {
          status: "requires_2fa",
          sessionState: (client.session as StringSession).save(),
          passwordHint: passwordInfo.hint ?? null,
        };
      }
      throw error instanceof RPCError ? translateRpcError(error) : error;
    } finally {
      await this.close(client);
    }
  }

  /**
   * Второй шаг: подтверждение кода, при необходимости — облачный пароль.
   *
   * `SESSION_PASSWORD_NEEDED` не ошибка ввода: код уже принят, Telegram просит
   * второй фактор. Поэтому вызывающий получает `TelegramPasswordRequiredError`
   * вместе с подсказкой к паролю, а состояние сессии сохраняется — повторно
   * отправлять код не нужно.
   */
  async signIn(input: {
    sessionState: string;
    phone: string;
    phoneCodeHash: string;
    code: string;
    password?: string | undefined;
  }): Promise<SignInOutcome> {
    const client = await this.client(input.sessionState);

    try {
      let authorization: Api.TypeUser | null = null;

      try {
        const result = await client.invoke(
          new Api.auth.SignIn({
            phoneNumber: input.phone,
            phoneCodeHash: input.phoneCodeHash,
            phoneCode: input.code,
          }),
        );

        authorization = this.extractUser(result);
      } catch (error) {
        if (!(error instanceof RPCError) || error.errorMessage !== "SESSION_PASSWORD_NEEDED") {
          throw error instanceof RPCError ? translateRpcError(error) : error;
        }

        // Пароль ещё не введён — сообщаем клиенту, что нужен второй шаг, и
        // отдаём подсказку. Состояние сессии при этом уже продвинулось, поэтому
        // вызывающий обязан его сохранить.
        if (input.password === undefined || input.password.length === 0) {
          const passwordInfo = await client.invoke(new Api.account.GetPassword());
          throw new TelegramPasswordRequiredError(passwordInfo.hint ?? null);
        }

        authorization = await this.checkPassword(client, input.password);
      }

      const user = this.toUserInfo(authorization);

      return {
        sessionState: (client.session as StringSession).save(),
        user,
      };
    } finally {
      await this.close(client);
    }
  }

  /**
   * Ввод облачного пароля.
   *
   * SRP считается библиотечным `computeCheck`: пароль не передаётся в Telegram
   * ни в открытом виде, ни хешем — протокол требует доказательства знания.
   */
  private async checkPassword(client: TelegramClient, password: string): Promise<Api.TypeUser> {
    try {
      const passwordInfo = await client.invoke(new Api.account.GetPassword());
      const srp = await computeCheck(passwordInfo, password);
      const result = await client.invoke(new Api.auth.CheckPassword({ password: srp }));

      return this.extractUser(result);
    } catch (error) {
      throw error instanceof RPCError ? translateRpcError(error) : error;
    }
  }

  /**
   * Продолжение авторизации, когда код уже подтверждён и остался только пароль.
   *
   * Отдельный метод, потому что повторный `auth.SignIn` с тем же кодом Telegram
   * отклоняет: код одноразовый.
   */
  async submitPassword(input: {
    sessionState: string;
    password: string;
  }): Promise<SignInOutcome> {
    const client = await this.client(input.sessionState);

    try {
      const authorization = await this.checkPassword(client, input.password);

      return {
        sessionState: (client.session as StringSession).save(),
        user: this.toUserInfo(authorization),
      };
    } finally {
      await this.close(client);
    }
  }

  /** Проверяет, что сохранённая сессия ещё действительна (пользователь не разлогинил её). */
  async validateSession(sessionState: string): Promise<{ alive: boolean; reason?: string }> {
    let client: TelegramClient | null = null;

    try {
      client = await this.client(sessionState);
      const authorized = await client.checkAuthorization();

      return authorized ? { alive: true } : { alive: false, reason: "Сессия отозвана в Telegram" };
    } catch (error) {
      return {
        alive: false,
        reason: error instanceof RPCError ? error.errorMessage : "Не удалось подключиться к Telegram",
      };
    } finally {
      if (client !== null) await this.close(client);
    }
  }

  /**
   * `auth.SignIn` может вернуть `AuthorizationSignUpRequired` — это номер, за
   * которым нет аккаунта Telegram. Регистрацию нового аккаунта здесь не
   * поддерживаем: подключать нужно существующий.
   */
  private extractUser(result: Api.auth.TypeAuthorization): Api.TypeUser {
    if (result instanceof Api.auth.AuthorizationSignUpRequired) {
      throw new AppError(
        400,
        "TELEGRAM_SIGNUP_REQUIRED",
        "За этим номером нет аккаунта Telegram. Сначала зарегистрируйте его в приложении Telegram.",
      );
    }

    return result.user;
  }

  private toUserInfo(user: Api.TypeUser): SignInOutcome["user"] {
    if (!(user instanceof Api.User)) {
      throw new AppError(
        502,
        "TELEGRAM_MTPROTO_ERROR",
        "Telegram вернул неожиданный тип пользователя",
      );
    }

    return {
      id: user.id.toString(),
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      username: user.username ?? null,
      phone: user.phone ?? null,
    };
  }

  /**
   * Закрытие клиента.
   *
   * Ошибки отключения проглатываются намеренно: авторизация к этому моменту уже
   * завершена, и сбой при закрытии сокета не должен превращать успешное
   * подключение в ошибку для пользователя.
   */
  /** Закрывает клиент MTProto. */
  async close(client: TelegramClient): Promise<void> {
    try {
      await client.destroy();
    } catch {
      /* соединение всё равно отбрасывается */
    }
  }
}
