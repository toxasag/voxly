import type { FastifyInstance } from "fastify";
import { queryOne, transaction } from "../../db/client.js";
import { AppError, NotFoundError, UnauthorizedError } from "../../plugins/errorHandler.js";
import { AuthService } from "../auth/auth.service.js";
import type { AuthChannel } from "../auth/auth-session.service.js";
import type { Role } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Личный профиль пользователя.
//
// До этого модуля данные о себе клиент получал только из ответа на вход
// (`/auth/login`, `/auth/refresh`) — то есть менять их было нечем, а привязки
// каналов и аватар вообще не покидали БД.
//
// Аватар хранится как Base64 data-URI в TEXT: загрузки файлов в проекте нет ни
// в каком виде (ни multipart-плагина, ни S3/MinIO, ни тома для медиа, ни раздачи
// статики), поэтому клиент сжимает изображение в canvas до 256×256, а сервер
// проверяет тип и размер строки. Это осознанный компромисс, а не незнание: он
// закрывает сценарий «выбрать файл с диска» без новой инфраструктуры и
// переносится на объектное хранилище заменой одного поля.
// ---------------------------------------------------------------------------

/** Предел длины data-URI. 256×256 WebP при q=0.8 даёт ~15–25 КБ; 512 КБ — запас. */
export const MAX_AVATAR_BYTES = 512 * 1024;

/** Допустимые форматы. SVG исключён: он исполняет скрипты при рендере. */
const ALLOWED_AVATAR_MIME = new Set(["image/webp", "image/jpeg", "image/png"]);

const AVATAR_DATA_URI = /^data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=]+)$/;

export interface ChannelBindingDTO {
  channel: AuthChannel;
  linked: boolean;
  /** Идентификатор чата; показывается пользователю для сверки. */
  externalId: string | null;
  botUsername: string;
  /** Настроен ли транспорт на сервере; иначе привязка невозможна. */
  available: boolean;
}

export interface ProfileDTO {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  avatarUrl: string | null;
  createdAt: string;
  /** Может ли пользователь сменить пароль: у приглашённого его ещё нет. */
  hasPassword: boolean;
  channels: ChannelBindingDTO[];
}

interface ProfileRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  avatar_url: string | null;
  password_hash: string | null;
  telegram_chat_id: string | null;
  max_user_id: string | null;
  created_at: Date | string;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Проверка аватара.
 *
 * Валидируется и MIME, и фактический размер декодированных данных: заголовок
 * data-URI задаёт клиент, поэтому доверять ему нельзя, а без проверки длины в БД
 * попала бы строка произвольного размера — она возвращается в каждом ответе
 * профиля и раздула бы их все.
 */
function assertValidAvatar(dataUri: string): void {
  const match = AVATAR_DATA_URI.exec(dataUri);

  if (match === null) {
    throw new AppError(400, "VALIDATION_ERROR", "Некорректный формат изображения", {
      avatar_url: ["Ожидается изображение в формате data:image/…;base64,…"],
    });
  }

  const mime = match[1] ?? "";
  const base64 = match[2] ?? "";

  if (!ALLOWED_AVATAR_MIME.has(mime)) {
    throw new AppError(400, "VALIDATION_ERROR", "Неподдерживаемый формат изображения", {
      avatar_url: ["Допустимы WebP, JPEG и PNG"],
    });
  }

  // Длина base64 → байты: каждые 4 символа кодируют 3 байта.
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor((base64.length * 3) / 4) - padding;

  if (bytes > MAX_AVATAR_BYTES) {
    throw new AppError(400, "VALIDATION_ERROR", "Изображение слишком большое", {
      avatar_url: [`Максимум ${Math.round(MAX_AVATAR_BYTES / 1024)} КБ после сжатия`],
    });
  }
}

export class ProfileService {
  constructor(
    private readonly app: FastifyInstance,
    private readonly channelAvailability: Record<AuthChannel, { available: boolean; bot: string }>,
  ) {}

  private toDTO(row: ProfileRow): ProfileDTO {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      role: row.role,
      avatarUrl: row.avatar_url,
      createdAt: toIso(row.created_at),
      hasPassword: row.password_hash !== null,
      channels: [
        {
          channel: "telegram",
          linked: row.telegram_chat_id !== null,
          externalId: row.telegram_chat_id,
          botUsername: this.channelAvailability.telegram.bot,
          available: this.channelAvailability.telegram.available,
        },
        {
          channel: "max",
          linked: row.max_user_id !== null,
          externalId: row.max_user_id,
          botUsername: this.channelAvailability.max.bot,
          available: this.channelAvailability.max.available,
        },
      ],
    };
  }

  private static readonly COLUMNS = `id, name, email, phone, role, avatar_url, password_hash,
          telegram_chat_id::text, max_user_id, created_at`;

  async get(userId: string): Promise<ProfileDTO> {
    const row = await queryOne<ProfileRow>(
      `SELECT ${ProfileService.COLUMNS} FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    if (row === null) throw new NotFoundError("Пользователь не найден");
    return this.toDTO(row);
  }

  /**
   * Обновляет имя, телефон и аватар.
   *
   * E-mail сознательно не меняется: он служит логином и адресом для
   * восстановления пароля, поэтому смена требует подтверждения владения новым
   * адресом — отдельного сценария, которого пока нет. Молча позволить смену
   * означало бы дать увести учётную запись через профиль.
   */
  async update(input: {
    userId: string;
    tenantId: string;
    name?: string;
    phone?: string;
    /** `null` — снять аватар, строка — заменить, `undefined` — не трогать. */
    avatarUrl?: string | null;
  }): Promise<ProfileDTO> {
    if (input.avatarUrl !== undefined && input.avatarUrl !== null) {
      assertValidAvatar(input.avatarUrl);
    }

    const phoneDigits = input.phone === undefined ? undefined : input.phone.replace(/\D/g, "");

    if (phoneDigits !== undefined && phoneDigits.length > 0) {
      // Телефон уникален среди живых строк арендатора (частичный индекс из
      // миграции 0008), поэтому занятый номер отклоняется ошибкой поля, а не 500.
      const taken = await queryOne<{ id: string }>(
        `SELECT id FROM users
         WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL AND id <> $3`,
        [input.tenantId, phoneDigits, input.userId],
      );

      if (taken !== null) {
        throw new AppError(409, "PHONE_TAKEN", "Этот номер уже используется", {
          phone: ["Этот номер уже привязан к другому сотруднику компании"],
        });
      }
    }

    const row = await queryOne<ProfileRow>(
      `UPDATE users
       SET name = COALESCE($2, name),
           phone = COALESCE($3, phone),
           -- Три состояния аватара кодируются двумя параметрами: $5 отличает
           -- «снять» от «не трогать», потому что COALESCE не различает NULL-
           -- значение и отсутствие значения.
           avatar_url = CASE WHEN $5 THEN $4 ELSE avatar_url END,
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${ProfileService.COLUMNS}`,
      [
        input.userId,
        input.name ?? null,
        phoneDigits === undefined || phoneDigits.length === 0 ? null : phoneDigits,
        input.avatarUrl ?? null,
        input.avatarUrl !== undefined,
      ],
    );

    if (row === null) throw new NotFoundError("Пользователь не найден");

    this.app.log.info({ userId: input.userId }, "Profile updated");
    return this.toDTO(row);
  }

  /**
   * Смена пароля с проверкой текущего.
   *
   * Отличается от сброса по ссылке: там владение доказано письмом, здесь —
   * знанием действующего пароля. Без этой проверки перехваченная сессия
   * позволяла бы сменить пароль и закрепиться в учётной записи.
   *
   * Отзываются все сессии, **кроме текущей**: смена пароля должна вытеснить
   * того, кто вошёл на другом устройстве, но выкидывать самого пользователя
   * сразу после успешного действия — потеря контекста без причины. Текущая
   * сессия исключается по хешу её refresh-токена, который передаёт клиент.
   */
  async changePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    /** Хеш refresh-токена текущей сессии; она не отзывается. */
    keepRefreshTokenHash?: string;
  }): Promise<void> {
    const row = await queryOne<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [input.userId],
    );

    if (row === null) throw new NotFoundError("Пользователь не найден");

    if (row.password_hash === null) {
      throw new AppError(
        409,
        "PASSWORD_NOT_SET",
        "Пароль ещё не задан. Примите приглашение по ссылке из письма.",
      );
    }

    if (!(await AuthService.verifyPassword(row.password_hash, input.currentPassword))) {
      throw new AppError(401, "INVALID_CURRENT_PASSWORD", "Текущий пароль указан неверно", {
        current_password: ["Неверный текущий пароль"],
      });
    }

    if (await AuthService.verifyPassword(row.password_hash, input.newPassword)) {
      throw new AppError(400, "VALIDATION_ERROR", "Новый пароль совпадает с текущим", {
        password: ["Новый пароль должен отличаться от текущего"],
      });
    }

    const newHash = await AuthService.hashPassword(input.newPassword);

    await transaction(async (tx) => {
      await tx.query(`UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`, [
        input.userId,
        newHash,
      ]);

      await tx.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL
           AND ($2::text IS NULL OR token_hash <> $2)`,
        [input.userId, input.keepRefreshTokenHash ?? null],
      );
    });

    this.app.log.info({ userId: input.userId }, "Password changed from profile");
  }

  /**
   * Снимает привязку канала.
   *
   * Последний канал снять нельзя: код второго фактора доставляется только в
   * бота, и учётная запись без привязок осталась бы без способа войти, пока
   * заново не открыть бота по ссылке. Отказ здесь честнее, чем неработающий вход.
   */
  async unlinkChannel(input: { userId: string; channel: AuthChannel }): Promise<ProfileDTO> {
    const current = await queryOne<{
      telegram_chat_id: string | null;
      max_user_id: string | null;
    }>(
      `SELECT telegram_chat_id::text, max_user_id
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [input.userId],
    );

    if (current === null) throw new NotFoundError("Пользователь не найден");

    const linked = [current.telegram_chat_id, current.max_user_id].filter(
      (value) => value !== null,
    ).length;

    const isLinked =
      input.channel === "telegram" ? current.telegram_chat_id !== null : current.max_user_id !== null;

    if (!isLinked) {
      throw new AppError(409, "CHANNEL_NOT_LINKED", "Этот канал не привязан");
    }

    if (linked <= 1) {
      throw new AppError(
        409,
        "LAST_CHANNEL",
        "Нельзя отвязать единственный канал: в него приходит код подтверждения при входе. Сначала привяжите второй.",
      );
    }

    const column = input.channel === "telegram" ? "telegram_chat_id" : "max_user_id";
    const nameColumn = input.channel === "telegram" ? "telegram_username" : "max_username";

    const row = await queryOne<ProfileRow>(
      `UPDATE users SET ${column} = NULL, ${nameColumn} = NULL, updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING ${ProfileService.COLUMNS}`,
      [input.userId],
    );

    if (row === null) throw new NotFoundError("Пользователь не найден");

    this.app.log.info({ userId: input.userId, channel: input.channel }, "Channel unlinked");
    return this.toDTO(row);
  }

  /** Проверяет, что канал ещё не привязан — до выдачи deep-link. */
  async assertChannelUnlinked(userId: string, channel: AuthChannel): Promise<void> {
    const row = await queryOne<{ telegram_chat_id: string | null; max_user_id: string | null }>(
      `SELECT telegram_chat_id::text, max_user_id
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );

    if (row === null) throw new UnauthorizedError("Пользователь не найден");

    const linked =
      channel === "telegram" ? row.telegram_chat_id !== null : row.max_user_id !== null;

    if (linked) {
      throw new AppError(
        409,
        "CHANNEL_ALREADY_LINKED",
        "Этот канал уже привязан. Сначала отвяжите его.",
      );
    }
  }
}
