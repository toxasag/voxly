import argon2 from "argon2";
import { hashToken } from "../../lib/crypto.utils.js";
import { toDate } from "../../lib/date.utils.js";
import { queryOne, transaction } from "../../db/client.js";
import { AppError } from "../../plugins/errorHandler.js";
import { ROLE_LABELS } from "../../config/permissions.js";
import type { Role } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Принятие приглашения сотрудником.
//
// Отдельно от password-reset.service: там меняется пароль существующего
// пользователя, здесь неактивная учётная запись впервые становится активной —
// задаётся пароль и телефон, гасится токен приглашения.
//
// Эндпоинты публичные по необходимости: приглашённый ещё не может войти.
// ---------------------------------------------------------------------------

export interface InvitePreviewDTO {
  email: string | null;
  phone?: string | null;
  fullName: string;
  companyName: string;
  role: Role;
  roleLabel: string;
}

export class InvalidInviteError extends AppError {
  constructor() {
    super(
      400,
      "INVALID_INVITE_TOKEN",
      "Ссылка приглашения недействительна или устарела. Попросите администратора отправить новую.",
    );
  }
}

export class InviteService {
  /**
   * Данные приглашения для формы: имя компании и роль показываются до ввода
   * пароля, иначе человек не понимает, куда его пригласили.
   */
  async preview(token: string): Promise<InvitePreviewDTO> {
    const hashed = hashToken(token);
    const row = await queryOne<{
      email: string | null;
      phone: string | null;
      name: string;
      role: Role;
      company_name: string;
      invite_expires_at: Date | string | null;
    }>(
      `SELECT u.email, u.phone, u.name, u.role, t.name AS company_name, u.invite_expires_at
       FROM users u
       JOIN tenants t ON t.id = u.tenant_id
       WHERE (u.invite_token_hash = $1 OR u.invite_token = $2)
         AND u.deleted_at IS NULL AND u.activated_at IS NULL`,
      [hashed, token],
    );

    if (row === null) throw new InvalidInviteError();
    if (row.invite_expires_at === null) throw new InvalidInviteError();
    if (toDate(row.invite_expires_at).getTime() < Date.now()) throw new InvalidInviteError();

    return {
      email: row.email,
      phone: row.phone,
      fullName: row.name,
      companyName: row.company_name,
      role: row.role,
      roleLabel: ROLE_LABELS[row.role] ?? row.role,
    };
  }

  /**
   * Активирует учётную запись: задаёт пароль и телефон, гасит токен.
   *
   * Телефон обязателен — он используется для доставки кода второго фактора при
   * входе, и без него сотрудник не смог бы войти.
   */
  async accept(input: {
    token: string;
    password: string;
    phone: string;
    email?: string | null;
  }): Promise<{ message: string }> {
    const passwordHash = await argon2.hash(input.password);
    const phoneDigits = input.phone.replace(/\D/g, "");
    const cleanEmail = input.email ? input.email.trim().toLowerCase() : null;
    const hashed = hashToken(input.token);

    await transaction(async (tx) => {
      // FOR UPDATE сериализует параллельные переходы по одной ссылке: иначе два
      // запроса могли бы оба увидеть непогашенный токен.
      const row = await tx.queryOne<{
        id: string;
        tenant_id: string;
        phone: string | null;
        email: string | null;
        invite_expires_at: Date | string | null;
      }>(
        `SELECT id, tenant_id, phone, email, invite_expires_at
         FROM users
         WHERE (invite_token_hash = $1 OR invite_token = $2)
           AND deleted_at IS NULL AND activated_at IS NULL
         FOR UPDATE`,
        [hashed, input.token],
      );

      if (row === null) throw new InvalidInviteError();
      if (row.invite_expires_at === null) throw new InvalidInviteError();
      if (toDate(row.invite_expires_at).getTime() < Date.now()) throw new InvalidInviteError();

      // Телефон уникален в пределах арендатора (частичный индекс по живым строкам)
      const phoneTaken = await tx.queryOne<{ id: string }>(
        `SELECT id FROM users
         WHERE tenant_id = $1 AND phone = $2 AND deleted_at IS NULL AND id <> $3`,
        [row.tenant_id, phoneDigits, row.id],
      );

      if (phoneTaken !== null) {
        throw new AppError(409, "PHONE_TAKEN", "Этот номер уже используется", {
          phone: ["Этот номер уже привязан к другому сотруднику компании"],
        });
      }

      // Если указан e-mail, проверяем его уникальность
      if (cleanEmail) {
        const emailTaken = await tx.queryOne<{ id: string }>(
          `SELECT id FROM users
           WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL AND id <> $3`,
          [row.tenant_id, cleanEmail, row.id],
        );
        if (emailTaken !== null) {
          throw new AppError(409, "EMAIL_TAKEN", "Этот e-mail уже используется", {
            email: ["Этот e-mail уже привязан к другому сотруднику компании"],
          });
        }
      }

      await tx.query(
        `UPDATE users
         SET password_hash = $2,
             phone = $3,
             email = COALESCE($4, email),
             activated_at = now(),
             invite_token = NULL,
             invite_token_hash = NULL,
             invite_expires_at = NULL,
             updated_at = now()
         WHERE id = $1`,
        [row.id, passwordHash, phoneDigits, cleanEmail],
      );
    });

    return { message: "Учётная запись активирована. Войдите с новым паролем." };
  }
}
