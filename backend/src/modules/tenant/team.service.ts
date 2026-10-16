import { createHash, randomBytes } from "node:crypto";
import { query, queryOne, transaction } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { getEnv } from "../../config/env.js";
import { ASSIGNABLE_ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from "../../config/permissions.js";
import { EmailService } from "../../services/email.service.js";
import type { Role } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Управление сотрудниками арендатора.
//
// Раньше единственным способом появления строки в `users` была регистрация
// владельца, поэтому экран «Сотрудники» показывал бы список из одного человека
// без возможности что-либо изменить.
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
  email: string;
  phone: string | null;
  role: Role;
  /** Base64 data-URI либо null; при null интерфейс показывает инициалы. */
  avatarUrl: string | null;
  status: TeamMemberStatus;
  /** Владельца нельзя удалить или понизить — на нём держится доступ к биллингу. */
  isOwner: boolean;
  /** Текущий пользователь: себя нельзя удалить или сменить себе роль. */
  isSelf: boolean;
  invitedAt: string | null;
  activatedAt: string | null;
  createdAt: string;
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
  seats: SeatUsageDTO;
  /** Роли, доступные для назначения (без `owner`). */
  assignableRoles: Role[];
}

interface MemberRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: Role;
  avatar_url: string | null;
  invited_at: Date | string | null;
  activated_at: Date | string | null;
  created_at: Date | string;
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

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function toMemberDTO(row: MemberRow, ownerId: string | null, selfId: string): TeamMemberDTO {
  return {
    id: row.id,
    fullName: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    avatarUrl: row.avatar_url,
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
    const [used, pricing] = await Promise.all([this.countSeats(tenantId), this.seatPricing()]);
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

  async list(tenantId: string, currentUserId: string): Promise<TeamListDTO> {
    const [rows, seats, owner] = await Promise.all([
      query<MemberRow>(
        `SELECT id, name, email, phone, role, avatar_url, invited_at, activated_at, created_at
         FROM users
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY
           CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'manager' THEN 2
                     WHEN 'technician' THEN 3 ELSE 4 END,
           name ASC, created_at ASC`,
        [tenantId],
      ),
      this.seatUsage(tenantId),
      this.ownerId(tenantId),
    ]);

    return {
      members: rows.map((row) => toMemberDTO(row, owner, currentUserId)),
      seats,
      assignableRoles: [...ASSIGNABLE_ROLES],
    };
  }

  /**
   * Приглашает сотрудника: создаёт неактивную строку и отправляет ссылку.
   *
   * `confirmExtraSeat` обязателен, когда включённые места исчерпаны: без явного
   * подтверждения счёт вырос бы молча. Клиент показывает предупреждение с ценой
   * и повторяет запрос с этим флагом — проверка на сервере, а не только в UI,
   * потому что запрос можно отправить и минуя интерфейс.
   */
  async invite(input: {
    tenantId: string;
    actorId: string;
    name: string;
    email: string;
    role: Role;
    confirmExtraSeat: boolean;
  }): Promise<{ member: TeamMemberDTO; seats: SeatUsageDTO; emailSent: boolean }> {
    if (!ASSIGNABLE_ROLES.includes(input.role)) {
      throw new AppError(400, "VALIDATION_ERROR", "Недопустимая роль", {
        role: ["Роль нельзя назначить приглашаемому сотруднику"],
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
      // Повторное приглашение того же адреса обновляет существующую строку, а не
      // создаёт вторую: частичный уникальный индекс по (tenant_id,
      // lower(email)) иначе отклонил бы вставку ошибкой 23505.
      const existing = await tx.queryOne<{ id: string; activated_at: Date | string | null }>(
        `SELECT id, activated_at FROM users
         WHERE tenant_id = $1 AND lower(email) = lower($2) AND deleted_at IS NULL
         FOR UPDATE`,
        [input.tenantId, input.email],
      );

      if (existing !== null && existing.activated_at !== null) {
        throw new AppError(409, "USER_ALREADY_EXISTS", "Сотрудник с таким e-mail уже работает", {
          email: ["Этот e-mail уже занят активным сотрудником"],
        });
      }

      const permissions = [...ROLE_PERMISSIONS[input.role]];

      if (existing !== null) {
        return tx.queryOneOrThrow<MemberRow>(
          `UPDATE users
           SET name = $3, role = $4, permissions = $5, invite_token_hash = $6,
               invited_at = now(), invite_expires_at = $7, invited_by = $8, updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING id, name, email, phone, role, avatar_url, invited_at, activated_at, created_at`,
          [
            existing.id,
            input.tenantId,
            input.name,
            input.role,
            permissions,
            hashToken(token),
            expiresAt,
            input.actorId,
          ],
        );
      }

      return tx.queryOneOrThrow<MemberRow>(
        `INSERT INTO users
           (tenant_id, email, name, role, permissions, invite_token_hash,
            invited_at, invite_expires_at, invited_by)
         VALUES ($1, $2, $3, $4, $5, $6, now(), $7, $8)
         RETURNING id, name, email, phone, role, avatar_url, invited_at, activated_at, created_at`,
        [
          input.tenantId,
          input.email,
          input.name,
          input.role,
          permissions,
          hashToken(token),
          expiresAt,
          input.actorId,
        ],
      );
    });

    const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
      input.tenantId,
    ]);

    const link = `${getEnv().PUBLIC_APP_URL.replace(/\/+$/, "")}/accept-invite?token=${token}`;
    const sent = await EmailService.sendTeamInviteEmail({
      to: created.email,
      inviteeName: created.name,
      companyName: tenant?.name ?? "GETVOXLY",
      roleLabel: ROLE_LABELS[created.role],
      link,
      expiresInHours: INVITE_TTL_HOURS,
    });

    const [seats, owner] = await Promise.all([
      this.seatUsage(input.tenantId),
      this.ownerId(input.tenantId),
    ]);

    return {
      member: toMemberDTO(created, owner, input.actorId),
      seats,
      emailSent: sent.sent,
    };
  }

  /** Смена роли. Права приводятся к новой роли, иначе они остались бы от прежней. */
  async changeRole(input: {
    tenantId: string;
    actorId: string;
    userId: string;
    role: Role;
  }): Promise<TeamMemberDTO> {
    if (!ASSIGNABLE_ROLES.includes(input.role)) {
      throw new AppError(400, "VALIDATION_ERROR", "Недопустимая роль", {
        role: ["Эту роль нельзя назначить"],
      });
    }

    if (input.userId === input.actorId) {
      // Иначе администратор мог бы понизить себя и потерять доступ к разделу,
      // оставив арендатора без управления сотрудниками.
      throw new AppError(409, "CANNOT_MODIFY_SELF", "Нельзя изменить собственную роль");
    }

    const owner = await this.ownerId(input.tenantId);
    if (owner === input.userId) {
      throw new AppError(409, "CANNOT_MODIFY_OWNER", "Роль владельца изменить нельзя");
    }

    const updated = await queryOne<MemberRow>(
      `UPDATE users
       SET role = $3, permissions = $4, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL
       RETURNING id, name, email, phone, role, avatar_url, invited_at, activated_at, created_at`,
      [input.userId, input.tenantId, input.role, [...ROLE_PERMISSIONS[input.role]]],
    );

    if (updated === null) throw new NotFoundError("Сотрудник не найден");

    return toMemberDTO(updated, owner, input.actorId);
  }

  /**
   * Мягкое удаление сотрудника и отзыв его сессий.
   *
   * Хард-делит невозможен: на `users(id)` ссылаются сделки, задачи, счёта и
   * записи ремонтов без `ON DELETE`, поэтому Postgres отклонил бы удаление
   * любого сотрудника, успевшего создать хоть одну запись. Отзыв
   * refresh-токенов обязателен — иначе уволенный сотрудник продолжал бы
   * работать по действующей сессии.
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
         SET deleted_at = now(), invite_token_hash = NULL, updated_at = now()
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

  /** Повторная отправка приглашения с новым токеном. */
  async resendInvite(input: {
    tenantId: string;
    userId: string;
  }): Promise<{ emailSent: boolean }> {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3_600_000);

    const row = await queryOne<{ email: string; name: string; role: Role }>(
      `UPDATE users
       SET invite_token_hash = $3, invited_at = now(), invite_expires_at = $4, updated_at = now()
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL AND activated_at IS NULL
       RETURNING email, name, role`,
      [input.userId, input.tenantId, hashToken(token), expiresAt],
    );

    if (row === null) throw new NotFoundError("Приглашение не найдено или уже принято");

    const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [
      input.tenantId,
    ]);

    const link = `${getEnv().PUBLIC_APP_URL.replace(/\/+$/, "")}/accept-invite?token=${token}`;
    const sent = await EmailService.sendTeamInviteEmail({
      to: row.email,
      inviteeName: row.name,
      companyName: tenant?.name ?? "GETVOXLY",
      roleLabel: ROLE_LABELS[row.role],
      link,
      expiresInHours: INVITE_TTL_HOURS,
    });

    return { emailSent: sent.sent };
  }
}
