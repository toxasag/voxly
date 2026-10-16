import type { FastifyInstance } from "fastify";
import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { queryOne, transaction } from "../../db/client.js";
import { AppError } from "../../plugins/errorHandler.js";
import { getEnv } from "../../config/env.js";
import { EmailService } from "../../services/email.service.js";
import { activeUserPredicate } from "./auth.service.js";

// ---------------------------------------------------------------------------
// Восстановление пароля по ссылке из письма.
//
// Отдельно от auth_sessions: та таблица подтверждает связку «телефон + канал» и
// доставляет код в бота, тогда как здесь адресатом является e-mail, а допуском —
// одноразовая ссылка. Смешивание двух механизмов означало бы, что код из бота
// можно предъявить для смены пароля.
//
// Токен хранится только как SHA-256, как refresh-токены: дамп таблицы нельзя
// переиграть как переход по ссылке. argon2 здесь не нужен — в токене 32
// случайных байта, перебор невозможен, а быстрый хеш позволяет найти строку по
// индексу.
// ---------------------------------------------------------------------------

/** Срок жизни ссылки. Час — компромисс: письмо успевает дойти, окно узкое. */
const RESET_TTL_MINUTES = 60;

interface ResetTokenRow {
  id: string;
  user_id: string;
  tenant_id: string;
  consumed_at: Date | string | null;
  expires_at: Date | string;
}

export class InvalidResetTokenError extends AppError {
  constructor() {
    super(
      400,
      "INVALID_RESET_TOKEN",
      "Ссылка недействительна или устарела. Запросите восстановление пароля заново.",
    );
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export class PasswordResetService {
  constructor(private readonly app: FastifyInstance) {}

  /**
   * Создаёт ссылку сброса и отправляет письмо.
   *
   * Ответ вызывающему **всегда** одинаков: иначе эндпоинт стал бы инструментом
   * проверки, зарегистрирован ли адрес. По той же причине неизвестный e-mail не
   * порождает ни строки, ни письма, а отказ SMTP только логируется.
   */
  async request(input: { email: string; ip?: string }): Promise<{ message: string }> {
    const env = getEnv();

    // Отбор совпадает с выборками входа (`AuthService.findByEmail`,
    // `resolveLoginTarget`) через общий предикат. Без него ссылка попадала не в
    // ту строку: `idx_users_tenant_email_active` частичный (`WHERE deleted_at IS
    // NULL`), поэтому увольнение с повторным приглашением того же адреса
    // законно оставляет старую удалённую строку рядом с новой живой, а
    // `ORDER BY created_at LIMIT 1` выбирал именно удалённую. Пользователь
    // получал письмо, переходил по ссылке, пароль менялся у мёртвой строки — а
    // его настоящий аккаунт оставался с прежним паролем при уже погашенной
    // ссылке. Тот же запрос матчил и приглашённого с `password_hash IS NULL`,
    // где сброс задавал пароль аккаунту, который вход всё равно отвергает.
    const user = await queryOne<{ id: string; tenant_id: string; email: string; name: string }>(
      `SELECT u.id, u.tenant_id, u.email, u.name
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE lower(u.email) = lower($1)
         AND ${activeUserPredicate("u")}
       ORDER BY u.created_at
       LIMIT 1`,
      [input.email],
    );

    if (user !== null) {
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000);

      await transaction(async (tx) => {
        // Прежние невыданные ссылки гасятся: активной остаётся одна, поэтому
        // старое письмо нельзя использовать после запроса нового.
        await tx.query(
          `UPDATE password_reset_tokens SET consumed_at = now()
           WHERE user_id = $1 AND consumed_at IS NULL`,
          [user.id],
        );

        await tx.query(
          `INSERT INTO password_reset_tokens (user_id, tenant_id, token_hash, expires_at, requested_ip)
           VALUES ($1, $2, $3, $4, $5)`,
          [user.id, user.tenant_id, hashToken(token), expiresAt, input.ip ?? null],
        );
      });

      const link = `${env.PUBLIC_APP_URL.replace(/\/+$/, "")}/reset-password?token=${token}`;

      // Отправка НЕ ожидается.
      //
      // Тело ответа было одинаковым и раньше, но время — нет: для известного
      // адреса запрос ждал SMTP-обмен (у внешнего провайдера это сотни
      // миллисекунд, при недоступности — секунды таймаута), а для неизвестного
      // возвращался сразу. Разница измерима с клиента, поэтому эндпоинт
      // оставался оракулом существования адреса, несмотря на единый текст.
      //
      // Разница не устранена полностью: известный адрес всё ещё выполняет
      // транзакцию записи токена, и это единицы миллисекунд против одного
      // SELECT. Устранён именно измеримый разрыв — сетевой обмен с внешним
      // SMTP. Полное выравнивание потребовало бы фиктивной записи для
      // неизвестных адресов, то есть роста таблицы от чужого перебора.
      //
      // Отказ SMTP по-прежнему только логируется: письмо вторично, а ошибка в
      // ответе снова раскрыла бы, что адрес существует.
      void EmailService.sendPasswordResetEmail(user.email, link, RESET_TTL_MINUTES).then(
        (sent) => {
          if (!sent.sent) {
            this.app.log.error(
              { email: user.email, reason: sent.error },
              "Password reset email failed",
            );
          }
        },
        (error: unknown) => {
          // `.then` без второго аргумента оставил бы отказ необработанным:
          // в Node 22 это завершает процесс по умолчанию.
          this.app.log.error({ email: user.email, error }, "Password reset email threw");
        },
      );
    }

    return {
      message: "Если такой e-mail зарегистрирован, ссылка для восстановления отправлена.",
    };
  }

  /**
   * Меняет пароль по токену из ссылки и завершает все активные сессии.
   *
   * Отзыв refresh-токенов обязателен: сброс пароля используют и когда доступ
   * подозревают скомпрометированным, а уцелевшая сессия обесценила бы смену.
   */
  async confirm(input: { token: string; password: string }): Promise<{ message: string }> {
    const passwordHash = await argon2.hash(input.password);

    const userId = await transaction(async (tx) => {
      // FOR UPDATE сериализует параллельные переходы по одной ссылке: без него
      // два запроса могли бы оба увидеть непогашенный токен.
      const row = await tx.queryOne<ResetTokenRow>(
        `SELECT id, user_id, tenant_id, consumed_at, expires_at
         FROM password_reset_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [hashToken(input.token)],
      );

      if (row === null || row.consumed_at !== null) throw new InvalidResetTokenError();
      if (toDate(row.expires_at).getTime() < Date.now()) throw new InvalidResetTokenError();

      await tx.query(
        `UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1`,
        [row.user_id, passwordHash],
      );

      await tx.query(`UPDATE password_reset_tokens SET consumed_at = now() WHERE id = $1`, [row.id]);

      await tx.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [row.user_id],
      );

      return row.user_id;
    });

    this.app.log.info({ userId }, "Password reset completed");

    return { message: "Пароль обновлён. Войдите с новым паролем." };
  }
}
