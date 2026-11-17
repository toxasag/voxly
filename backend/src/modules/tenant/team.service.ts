import { createHash, randomBytes } from "node:crypto";
import { query, queryOne, transaction } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { getEnv } from "../../config/env.js";
import { ASSIGNABLE_ROLES, ALL_PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, toPermissions } from "../../config/permissions.js";
import { EmailService } from "../../services/email.service.js";
import type { Permission, Role } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Управление сотрудниками арендатора.
//
// Омниканальный механизм приглашений: Email, Телефон, Telegram, WhatsApp.
//
// Статус сотрудника («Активен» / «Приглашён») выводится из `invited_at` и
// `activated_at`, а не хранится отдельной колонкой: два источника истины
// разошлись бы при первом же входе.
//
// Место в тарифе занимает любая не удалённая строка, включая приглашённую:
// иначе лимит обходился бы рассылкой приглашений, а счёт вырос бы неожиданно в
// момент, когда сотрудники начали принимать их.
// ---------------------------------------------------------------------------

/** Срок жизни ссылки-приглашения. */
const INVITE_TTL_HOURS = 72;

/** Слаг базовой CRM: именно её тариф определяет число включённых мест. */
const CORE_CRM_SLUG = "core_crm";

/** Резервные значения, если базовая CRM не подключена как модуль. */
const FALLBACK_INCLUDED_SEATS = 10;
const FALLBACK_SEAT_PRICE = 200;

export type TeamMemberStatus = "active" | "invited";

export interface TeamMemberDTO {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  role: Role;
  /** Base64 data-URI либо null; при null интерфейс показывает инициалы. */
  avatarUrl: string | null;
  permissions: Permission[];
  status: TeamMemberStatus;
  /** Владельца нельзя удалить или понизить — на нём держится доступ к биллингу. */
  isOwner: boolean;
  /** Текущий пользователь: себя нельзя удалить или сменить себе роль. */
  isSelf: boolean;
  invitedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
}

export interface PendingInviteDTO {
  id: string;
  email: string | null;
  phone: string | null;
  name: string;
  role: Role;
  roleLabel: string;
  token: string | null;
  inviteUrl: string | null;
  telegramShareUrl: string | null;
  whatsappShareUrl: string | null;
  status: "pending" | "accepted" | "expired" | "revoked";
  deliveryStatus: "sent" | "failed" | "pending";
  deliveryError: string | null;
  createdAt: string;
  expiresAt: string | null;
  isExpired: boolean;
}

/** Сколько мест занято и во что обойдётся следующее. */
export interface SeatUsageDTO {
  used: number;
  included: number;
  /** Сколько мест сверх включённых уже оплачивается. */
  extra: number;
  extraSeatPrice: number;
  /** Стоимость следующего сотрудника: 0, пока есть включённые места. */
  nextSeatPrice: number;
}

export interface TeamListDTO {
  members: TeamMemberDTO[];
  invites: PendingInviteDTO[];
  seats: SeatUsageDTO;
  /** Роли, доступные для назначения (без `owner`). */
  assignableRoles: Role[];
  /** Права, доступные для точечной настройки сотрудника. */
  availablePermissions: Permission[];
}

interface MemberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: Role;
  avatar_url: string | null;
  permissions: string[] | null;
  invited_at: Date | string | null;
  activated_at: Date | string | null;
  created_at: Date | string;
  invite_token?: string | null;
  invite_expires_at?: Date | string | null;
  invite_delivery_status?: string | null;
  invite_delivery_error?: string | null;
}

class SeatLimitError extends AppError {
  constructor(message: string) {
    super(409, "SEAT_LIMIT_CONFIRMATION_REQUIRED", message);
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function buildInviteUrl(token: string): string {
  return `${getEnv().PUBLIC_APP_URL.replace(/\/+$/, "")}/accept-invite?token=${encodeURIComponent(token)}`;
}

function buildTelegramShareUrl(link: string, name: string, companyName: string): string {
  const text = `Здравствуйте, ${name}! Приглашаем вас присоединиться к команде «${companyName}» в GETVOXLY:\n${link}`;
  return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
}

function buildWhatsappShareUrl(link: string, name: string, companyName: string, phone?: string | null): string {
  const text = `Здравствуйте, ${name}! Приглашаем вас присоединиться к команде «${companyName}» в GETVOXLY: ${link}`;
  const cleanDigits = phone ? phone.replace(/\D/g, "") : "";
  const phoneParam = cleanDigits ? `phone=${encodeURIComponent(cleanDigits)}&` : "";
  return `https://api.whatsapp.com/send?${phoneParam}text=${encodeURIComponent(text)}`;
}

function toMemberDTO(row: MemberRow, ownerId: string | null, selfId: string): TeamMemberDTO {
  return {
    id: row.id,
    fullName: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    avatarUrl: row.avatar_url,
    permissions: toPermissions(row.permissions),
    status: row.activated_at === null ? "invited" : "active",
    isOwner: row.role === "owner" || row.id === ownerId,
    isSelf: row.id === selfId,
    invitedAt: toIsoOrNull(row.invited_at),
    activatedAt: toIsoOrNull(row.activated_at),
    createdAt: toIso(row.created_at),
  };
}

export class TeamService {
  /**
   * Тариф мест берётся из каталога маркетплейса, а не из константы: цена и
   * число включённых пользователей заданы в `marketplace_modules`, и
   * захардкоженные 10/200 разошлись бы с биллингом при первом изменении тарифа.
   */
  private async seatPricing(): Promise<{ included: number; unitPrice: number }> {
    const row = await queryOne<{ included_units: number; unit_price: string }>(
      `SELECT included_units, unit_price
       FROM marketplace_modules
       WHERE slug = $1`,
      [CORE_CRM_SLUG],
    );

    if (row === null) {
      return { included: FALLBACK_INCLUDED_SEATS, unitPrice: FALLBACK_SEAT_PRICE };
    }

    return { included: row.included_units, unitPrice: Number(row.unit_price) };
  }

  /** Число занятых мест: активные и приглашённые, кроме удалённых. */
  private async countSeats(tenantId: string): Promise<number> {
    const row = await queryOne<{ total: string }>(
      `SELECT count(*)::text AS total
       FROM users
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );
    return Number(row?.total ?? 0);
  }

  private async seatUsage(tenantId: string): Promise<SeatUsageDTO> {
    const tenant = await queryOne<{ custom_price_rubles: number | null; plan: string }>(
      `SELECT custom_price_rubles, plan FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const isFreeCustom =
      (tenant?.custom_price_rubles !== null && Number(tenant?.custom_price_rubles) === 0) ||
      tenant?.plan === "custom_free";

    const [used, pricing] = await Promise.all([this.countSeats(tenantId), this.seatPricing()]);

    if (isFreeCustom) {
      return {
        used,
        included: 999999,
        extra: 0,
        extraSeatPrice: 0,
        nextSeatPrice: 0,
      };
    }

    const extra = Math.max(0, used - pricing.included);

    return {
      used,
      included: pricing.included,
      extra,
      extraSeatPrice: pricing.unitPrice,
      nextSeatPrice: used >= pricing.included ? pricing.unitPrice : 0,
    };
  }

  /** Владелец арендатора — его нельзя удалить или понизить в роли. */
  private async ownerId(tenantId: string): Promise<string | null> {
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM users
       WHERE tenant_id = $1 AND role = 'owner' AND deleted_at IS NULL
       ORDER BY created_at
       LIMIT 1`,
      [tenantId],
    );
    return row?.id ?? null;
  }

  /** Список ожидающих (не принятых) приглашений арендатора. */
  async listPendingInvites(tenantId: string): Promise<PendingInviteDTO[]> {
    const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [tenantId]);
    const companyName = tenant?.name ?? "GETVOXLY";

    const rows = await query<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      role: Role;
      invite_token: string | null;
      invited_at: Date | string | null;
      invite_expires_at: Date | string | null;
      invite_delivery_status: string | null;
      invite_delivery_error: string | null;
      activated_at: Date | string | null;
      deleted_at: Date | string | null;
      created_at: Date | string;
    }>(
      `SELECT id, name, email, phone, role, invite_token, invited_at, invite_expires_at,
              invite_delivery_status, invite_delivery_error, activated_at, deleted_at, created_at
       FROM users
       WHERE tenant_id = $1 AND deleted_at IS NULL AND activated_at IS NULL
         AND (invited_at IS NOT NULL OR invite_token_hash IS NOT NULL)
       ORDER BY invited_at DESC NULLS LAST, created_at DESC`,
      [tenantId],
    );

    return rows.map((row) => {
      const isExpired = row.invite_expires_at !== null && toDate(row.invite_expires_at).getTime() < Date.now();
      const status: PendingInviteDTO["status"] =
        row.deleted_at !== null ? "revoked" : row.activated_at !== null ? "accepted" : isExpired ? "expired" : "pending";
      const deliveryStatus = (row.invite_delivery_status as PendingInviteDTO["deliveryStatus"]) || "pending";
      const inviteUrl = row.invite_token ? buildInviteUrl(row.invite_token) : null;
      const telegramShareUrl = inviteUrl ? buildTelegramShareUrl(inviteUrl, row.name, companyName) : null;
      const whatsappShareUrl = inviteUrl ? buildWhatsappShareUrl(inviteUrl, row.name, companyName, row.phone) : null;

      return {
        id: row.id,
        email: row.email,
        phone: row.phone,
        name: row.name,
        role: row.role,
        roleLabel: ROLE_LABELS[row.role] ?? row.role,
        token: row.invite_token,
        inviteUrl,
        telegramShareUrl,
        whatsappShareUrl,
        status,
        deliveryStatus,
        deliveryError: row.invite_delivery_error,
        createdAt: toIso(row.invited_at ?? row.created_at),
        expiresAt: toIsoOrNull(row.invite_expires_at),
        isExpired,
      };
    });
  }

  async list(tenantId: string, currentUserId: string): Promise<TeamListDTO> {
    const [rows, invites, seats, owner] = await Promise.all([
      query<MemberRow>(
        `SELECT id, name, email, phone, role, avatar_url, permissions, invited_at, activated_at, created_at
         FROM users
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY
           CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2
                     WHEN 'technician' THEN 3 ELSE 4 END,
           name ASC, created_at ASC`,
        [tenantId],
      ),
      this.listPendingInvites(tenantId),
      this.seatUsage(tenantId),
      this.ownerId(tenantId),
    ]);

    return {
      members: rows.map((row) => toMemberDTO(row, owner, currentUserId)),
      invites,
      seats,
      assignableRoles: [...ASSIGNABLE_ROLES],
      availablePermissions: [...ALL_PERMISSIONS],
    };
  }

  /**
   * Приглашает сотрудника: создаёт неактивную строку, генерирует омниканальные ссылки
   * и отправляет письмо, если указан e-mail.
   *
   * Всегда возвращает рабочую ссылку-приглашение и ссылки для Telegram / WhatsApp!
   */
  async invite(input: {
    tenantId: string;
    actorId: string;
    name: string;
    email?: string | null;
    phone?: string | null;
    role: Role;
    confirmExtraSeat: boolean;
  }): Promise<{
    member: TeamMemberDTO;
    invite: PendingInviteDTO;
    seats: SeatUsageDTO;
    emailSent: boolean;
    inviteUrl: string;
    telegramShareUrl: string;
    whatsappShareUrl: string;
  }> {
    if (!ASSIGNABLE_ROLES.includes(input.role)) {
      throw new AppError(400, "VALIDATION_ERROR", "Недопустимая роль", {
        role: ["Роль нельзя назначить приглашаемому сотруднику"],
      });
    }

    const cleanEmail = input.email ? input.email.trim().toLowerCase() : null;
    const rawPhone = input.phone ? input.phone.trim() : null;
    const cleanPhone = rawPhone ? rawPhone.replace(/\D/g, "") : null;

    if (!cleanEmail && (!cleanPhone || cleanPhone.length < 10)) {
      throw new AppError(400, "VALIDATION_ERROR", "Укажите e-mail или корректный номер телефона (от 10 цифр)", {
        email: ["Укажите e-mail или номер телефона сотрудника"],
      });
    }

    const seatsBefore = await this.seatUsage(input.tenantId);

    if (seatsBefore.used >= seatsBefore.included && !input.confirmExtraSeat) {
      throw new SeatLimitError(
        `Базовый лимит (${seatsBefore.included} пользователей) исчерпан. ` +
          `Стоимость увеличится на +${seatsBefore.extraSeatPrice} ₽/мес за нового пользователя.`,
      );
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);

    const created = await transaction(async (tx) => {
      // Повторное приглашение того же адреса или телефона обновляет существующую строку
      const existing = await tx.queryOne<{ id: string; activated_at: Date | string | null }>(
        `SELECT id, activated_at FROM users
         WHERE tenant_id = $1 AND deleted_at IS NULL AND (
           ($2::text IS NOT NULL AND lower(email) = lower($2)) OR
           ($3::text IS NOT NULL AND (phone = $3 OR regexp_replace(phone, '\\D', '', 'g') = $3))
         )
         FOR UPDATE`,
        [input.tenantId, cleanEmail, cleanPhone],
      );

      if (existing !== null && existing.activated_at !== null) {
        throw new AppError(409, "USER_ALREADY_EXISTS", "Сотрудник с таким контактом уже работает", {
          email: ["Этот контакт уже занят активным сотрудником"],
        });
      }

      const permissions = [...ROLE_PERMISSIONS[input.role]];

      if (existing !== null) {
        return tx.queryOneOrThrow<MemberRow>(
          `UPDATE users
           SET name = $3,
               email = COALESCE($4, email),
               phone = COALESCE($5, phone),
               role = $6,
               permissions = $7,
               invite_token = $8,
               invite_token_hash = $9,
               invited_at = now(),
               invite_expires_at = $10,
               invited_by = $11,
               invite_delivery_status = 'pending',
               invite_delivery_error = NULL,
               updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING id, name, email, phone, role, avatar_url, permissions, invited_at, activated_at, created_at, invite_token, invite_expires_at`,
          [
            existing.id,
            input.tenantId,
            input.name,
            cleanEmail,
            cleanPhone,
            input.role,
            permissions,
            token,
            hashToken(token),
            expiresAt,
            input.actorId,
          ],
        );
      }

      return tx.queryOneOrThrow<MemberRow>(
        `INSERT INTO users
           (tenant_id, email, phone, name, role, permissions, invite_token, invite_token_hash,
            invited_at, invite_expires_at, invited_by, invite_delivery_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10, 'pending')
         RETURNING id, name, email, phone, role, avatar_url, permissions, invited_at, activated_at, created_at, invite_token, invite_expires_at`,
        [
          input.tenantId,
          cleanEmail,
          cleanPhone,
          input.name,
          input.role,
          permissions,
          token,
          hashToken(token),
          expiresAt,
          input.actorId,
        ],
      );
    });

    const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
      input.tenantId,
    ]);
    const companyName = tenant?.name ?? "GETVOXLY";

    const link = buildInviteUrl(token);
    let emailSent = false;
    let deliveryStatus: "sent" | "failed" | "pending" = "pending";
    let deliveryError: string | null = null;

    if (created.email) {
      try {
        const sent = await EmailService.sendTeamInviteEmail({
          to: created.email,
          inviteeName: created.name,
          companyName,
          roleLabel: ROLE_LABELS[created.role],
          link,
          expiresInHours: INVITE_TTL_HOURS,
        });
        emailSent = sent.sent;
        deliveryStatus = sent.sent ? "sent" : "failed";
        deliveryError = sent.sent ? null : (sent.error ?? "Ошибка отправки SMTP");
      } catch (err) {
        emailSent = false;
        deliveryStatus = "failed";
        deliveryError = err instanceof Error ? err.message : String(err);
      }

      await query(
        `UPDATE users
         SET invite_delivery_status = $2, invite_delivery_error = $3
         WHERE id = $1`,
        [created.id, deliveryStatus, deliveryError],
      );
    }

    const telegramShareUrl = buildTelegramShareUrl(link, created.name, companyName);
    const whatsappShareUrl = buildWhatsappShareUrl(link, created.name, companyName, created.phone);

    const [seats, owner] = await Promise.all([
      this.seatUsage(input.tenantId),
      this.ownerId(input.tenantId),
    ]);

    const inviteDTO: PendingInviteDTO = {
      id: created.id,
      email: created.email,
      phone: created.phone,
      name: created.name,
      role: created.role,
      roleLabel: ROLE_LABELS[created.role] ?? created.role,
      token,
      inviteUrl: link,
      telegramShareUrl,
      whatsappShareUrl,
      status: "pending",
      deliveryStatus,
      deliveryError,
      createdAt: toIso(created.invited_at ?? new Date()),
      expiresAt: toIso(expiresAt),
      isExpired: false,
    };

    return {
      member: toMemberDTO(created, owner, input.actorId),
      invite: inviteDTO,
      seats,
      emailSent,
      inviteUrl: link,
      telegramShareUrl,
      whatsappShareUrl,
    };
  }

  /** Смена роли и/или точечных прав сотрудника. */
  async changeRole(input: {
    tenantId: string;
    actorId: string;
    userId: string;
    role: Role;
    permissions?: Permission[];
  }): Promise<TeamMemberDTO> {
    if (!ASSIGNABLE_ROLES.includes(input.role)) {
      throw new AppError(400, "VALIDATION_ERROR", "Недопустимая роль", {
        role: ["Эту роль нельзя назначить"],
      });
    }

    if (input.userId === input.actorId) {
      throw new AppError(409, "CANNOT_MODIFY_SELF", "Нельзя изменить собственную роль");
    }

    const owner = await this.ownerId(input.tenantId);
    if (owner === input.userId) {
      throw new AppError(409, "CANNOT_MODIFY_OWNER", "Роль владельца изменить нельзя");
    }

    const permissions = input.permissions === undefined
      ? [...ROLE_PERMISSIONS[input.role]]
      : toPermissions(input.permissions);
    const rolePermissions = new Set(ROLE_PERMISSIONS[input.role]);
    if (permissions.some((permission) => !rolePermissions.has(permission))) {
      throw new AppError(400, "VALIDATION_ERROR", "Нельзя выдать право вне набора роли", {
        permissions: ["Выберите права, совместимые с ролью сотрудника"],
      });
    }

    const updated = await queryOne<MemberRow>(
      `UPDATE users
       SET role = $3, permissions = $4, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id, name, email, phone, role, avatar_url, permissions, invited_at, activated_at, created_at`,
      [input.userId, input.tenantId, input.role, permissions],
    );

    if (updated === null) throw new NotFoundError("Сотрудник не найден");
    return toMemberDTO(updated, owner, input.actorId);
  }

  /**
   * Мягкое удаление сотрудника и отзыв его сессий.
   */
  async remove(input: {
    tenantId: string;
    actorId: string;
    userId: string;
  }): Promise<{ seats: SeatUsageDTO }> {
    if (input.userId === input.actorId) {
      throw new AppError(409, "CANNOT_MODIFY_SELF", "Нельзя удалить собственную учётную запись");
    }

    const owner = await this.ownerId(input.tenantId);
    if (owner === input.userId) {
      throw new AppError(409, "CANNOT_MODIFY_OWNER", "Владельца компании удалить нельзя");
    }

    await transaction(async (tx) => {
      const removed = await tx.queryOne<{ id: string }>(
        `UPDATE users
         SET deleted_at = now(), invite_token = NULL, invite_token_hash = NULL, updated_at = now()
         WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [input.userId, input.tenantId],
      );

      if (removed === null) throw new NotFoundError("Сотрудник не найден");

      await tx.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [input.userId],
      );
    });

    return { seats: await this.seatUsage(input.tenantId) };
  }

  /** Отзыв неподтверждённого приглашения. */
  async revokeInvite(input: {
    tenantId: string;
    userId: string;
  }): Promise<{ seats: SeatUsageDTO }> {
    const revoked = await queryOne<{ id: string }>(
      `UPDATE users
       SET deleted_at = now(), invite_token = NULL, invite_token_hash = NULL, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND activated_at IS NULL
       RETURNING id`,
      [input.userId, input.tenantId],
    );

    if (revoked === null) throw new NotFoundError("Приглашение не найдено или уже принято");

    return { seats: await this.seatUsage(input.tenantId) };
  }

  /** Повторная отправка приглашения с новым токеном. */
  async resendInvite(input: {
    tenantId: string;
    userId: string;
  }): Promise<{
    emailSent: boolean;
    inviteUrl: string;
    telegramShareUrl: string;
    whatsappShareUrl: string;
    deliveryStatus: "sent" | "failed" | "pending";
    deliveryError: string | null;
  }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);

    const row = await queryOne<{ email: string | null; phone: string | null; name: string; role: Role }>(
      `UPDATE users
       SET invite_token = $3, invite_token_hash = $4, invited_at = now(), invite_expires_at = $5,
           invite_delivery_status = 'pending', invite_delivery_error = NULL, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND activated_at IS NULL
       RETURNING email, phone, name, role`,
      [input.userId, input.tenantId, token, hashToken(token), expiresAt],
    );

    if (row === null) throw new NotFoundError("Приглашение не найдено или уже принято");

    const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
      input.tenantId,
    ]);
    const companyName = tenant?.name ?? "GETVOXLY";

    const link = buildInviteUrl(token);
    let emailSent = false;
    let deliveryStatus: "sent" | "failed" | "pending" = "pending";
    let deliveryError: string | null = null;

    if (row.email) {
      try {
        const sent = await EmailService.sendTeamInviteEmail({
          to: row.email,
          inviteeName: row.name,
          companyName,
          roleLabel: ROLE_LABELS[row.role],
          link,
          expiresInHours: INVITE_TTL_HOURS,
        });
        emailSent = sent.sent;
        deliveryStatus = sent.sent ? "sent" : "failed";
        deliveryError = sent.sent ? null : (sent.error ?? "Ошибка отправки SMTP");
      } catch (err) {
        emailSent = false;
        deliveryStatus = "failed";
        deliveryError = err instanceof Error ? err.message : String(err);
      }

      await query(
        `UPDATE users
         SET invite_delivery_status = $2, invite_delivery_error = $3
         WHERE id = $1`,
        [input.userId, deliveryStatus, deliveryError],
      );
    }

    const telegramShareUrl = buildTelegramShareUrl(link, row.name, companyName);
    const whatsappShareUrl = buildWhatsappShareUrl(link, row.name, companyName, row.phone);

    return {
      emailSent,
      inviteUrl: link,
      telegramShareUrl,
      whatsappShareUrl,
      deliveryStatus,
      deliveryError,
    };
  }
}
