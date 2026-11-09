import argon2 from "argon2";
import { query, queryOne, transaction } from "../../db/client.js";
import { AppError } from "../../plugins/errorHandler.js";
import { OWNER_PERMISSIONS } from "../../config/permissions.js";
import { ensureTenantDefaults } from "../tenant/tenant-defaults.js";
import { tenantProvisioningQueue } from "../tenant/tenant-provisioning.queue.js";
import type {
  CreatePartnerTenantInput,
  AuthSettings,
  PartnerChildTenantDTO,
} from "./partner.types.js";

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  parent_tenant_id: string | null;
  auth_settings: AuthSettings;
  custom_pricing: Record<string, unknown> | null;
  custom_price_rubles: number | null;
  users_count?: number;
  contacts_count?: number;
  deals_count?: number;
  admin_id?: string | null;
  admin_email?: string | null;
  admin_name?: string | null;
  admin_phone?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export class PartnerService {
  /**
   * Создание нового дочернего тенанта (портала клиента/партнера).
   * Выполняется транзакционно: создание тенанта -> создание суперадмина ->
   * привязка тарифа в subscriptions -> инициализация дефолтных сущностей (воронки, кассы, вкладки).
   */
  async createChildTenant(
    parentTenantId: string,
    input: CreatePartnerTenantInput,
  ): Promise<{
    tenant: PartnerChildTenantDTO;
    admin: {
      id: string;
      email: string;
      name: string;
      role: string;
    };
  }> {
    const slug = input.slug.trim().toLowerCase();
    const adminEmail = input.admin_email.trim().toLowerCase();

    // 1. Проверка резервированных поддоменов
    const reserved = await queryOne<{ slug: string }>(
      `SELECT slug FROM reserved_slugs WHERE slug = $1`,
      [slug],
    );
    if (reserved !== null) {
      throw new AppError(409, "SLUG_RESERVED", "Этот поддомен зарезервирован системой", {
        slug: ["Этот поддомен зарезервирован системой, выберите другой"],
      });
    }

    // 2. Проверка занятости слага среди существующих тенантов
    const existingTenant = await queryOne<{ id: string }>(
      `SELECT id FROM tenants WHERE slug = $1`,
      [slug],
    );
    if (existingTenant !== null) {
      throw new AppError(409, "SLUG_TAKEN", "Поддомен уже занят", {
        slug: ["Этот поддомен уже занят, выберите другой"],
      });
    }

    // 3. Проверка уникальности e-mail суперадмина
    const existingUser = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1) AND deleted_at IS NULL`,
      [adminEmail],
    );
    if (existingUser !== null) {
      throw new AppError(400, "EMAIL_TAKEN", "E-mail уже зарегистрирован", {
        admin_email: ["Пользователь с таким e-mail уже существует на платформе"],
      });
    }

    // 4. Расчет партнерского ценообразования
    const priceRubles = input.is_complimentary ? 0 : (input.price_override ?? null);
    const customPricing: Record<string, unknown> = {
      is_complimentary: input.is_complimentary ?? false,
      monthly_price_rubles: priceRubles,
      base_plan: input.plan ?? "pro",
      partner_tenant_id: parentTenantId,
      ...(input.custom_pricing || {}),
    };

    const authSettings: AuthSettings = {
      require_telegram_auth: input.auth_settings?.require_telegram_auth ?? false,
      allow_password_auth: input.auth_settings?.allow_password_auth ?? true,
    };

    const passwordHash = await argon2.hash(input.admin_password);
    const telegramChatId = input.telegram_id
      ? String(input.telegram_id).trim()
      : null;

    try {
      const result = await transaction(async (tx) => {
        // Создаем запись в tenants с указанием parent_tenant_id
        const tenant = await tx.queryOneOrThrow<{
          id: string;
          name: string;
          slug: string;
          plan: string;
          status: string;
          parent_tenant_id: string | null;
          auth_settings: AuthSettings;
          custom_pricing: Record<string, unknown> | null;
          custom_price_rubles: number | null;
          created_at: Date;
          updated_at: Date;
        }>(
          `INSERT INTO tenants (
             name, slug, plan, status, parent_tenant_id,
             custom_pricing, custom_price_rubles, auth_settings, trial_ends_at, ai_balance_kopecks
           )
           VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, now() + INTERVAL '365 days', 500000)
           RETURNING id, name, slug, plan, status, parent_tenant_id, auth_settings, custom_pricing, custom_price_rubles, created_at, updated_at`,
          [
            input.name.trim(),
            slug,
            input.plan ?? "pro",
            parentTenantId,
            JSON.stringify(customPricing),
            priceRubles,
            JSON.stringify(authSettings),
          ],
        );

        // Переключаем контекст транзакции на только что созданный дочерний тенант,
        // чтобы RLS-политики (например, subscriptions) разрешали вставку дочерних записей.
        await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);

        // Начисляем стартовый баланс на AI-агентов
        await tx.query(
          `INSERT INTO ai_balance_topups (tenant_id, amount_kopecks, source, comment)
           VALUES ($1, 500000, 'bonus', 'Стартовый баланс для AI-ботов')`,
          [tenant.id],
        );

        // Создаем первого суперадмина дочернего портала
        const user = await tx.queryOneOrThrow<{
          id: string;
          email: string;
          name: string;
          role: string;
          created_at: Date;
        }>(
          `INSERT INTO users (
             tenant_id, email, phone, name, role, password_hash,
             permissions, telegram_chat_id, activated_at
           )
           VALUES ($1, $2, $3, $4, 'owner', $5, $6, $7, now())
           RETURNING id, email, name, role, created_at`,
          [
            tenant.id,
            adminEmail,
            (input.admin_phone || "").trim(),
            (input.admin_name || "Администратор").trim(),
            passwordHash,
            [...OWNER_PERMISSIONS],
            telegramChatId,
          ],
        );

        // Создаем активную подписку
        await tx.query(
          `INSERT INTO subscriptions (
             tenant_id, product_code, period_months, seats_included, starts_at, ends_at, status
           )
           VALUES ($1, $2, 12, 10, now(), now() + INTERVAL '1 year', 'active')`,
          [tenant.id, input.plan ?? "pro"],
        );

        return { tenant, user };
      });

      // Инициализируем базовые сущности CRM для нового тенанта (воронка, касса, карточные табы)
      try {
        await ensureTenantDefaults(result.tenant.id);
      } catch (err) {
        // Логируем, но не блокируем создание
        console.error("Failed to seed tenant defaults:", err);
      }

      // Отправка приветственного письма с учетными данными администратора через BullMQ очередь
      void tenantProvisioningQueue
        .enqueueWelcomeCredentials({
          to: adminEmail,
          subdomain: slug,
          companyName: input.name.trim(),
          adminName: (input.admin_name || "Администратор").trim(),
          loginEmail: adminEmail,
          password: input.admin_password,
        })
        .catch((err) => {
          console.error("Failed to enqueue welcome credentials email:", err);
        });

      return {
        tenant: {
          id: result.tenant.id,
          name: result.tenant.name,
          slug: result.tenant.slug,
          plan: result.tenant.plan,
          status: result.tenant.status,
          parent_tenant_id: result.tenant.parent_tenant_id,
          auth_settings: result.tenant.auth_settings,
          custom_pricing: result.tenant.custom_pricing,
          custom_price_rubles: result.tenant.custom_price_rubles,
          users_count: 1,
          contacts_count: 0,
          deals_count: 0,
          admin: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            phone: input.admin_phone || "",
          },
          created_at: new Date(result.tenant.created_at).toISOString(),
          updated_at: new Date(result.tenant.updated_at).toISOString(),
        },
        admin: {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name,
          role: result.user.role,
        },
      };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error) {
        if ((error as { code?: unknown }).code === "23505") {
          const constraint = String((error as { constraint?: unknown }).constraint ?? "");
          if (constraint.includes("slug")) {
            throw new AppError(409, "SLUG_TAKEN", "Поддомен уже занят");
          }
          if (constraint.includes("email")) {
            throw new AppError(400, "EMAIL_TAKEN", "E-mail уже зарегистрирован");
          }
        }
      }
      throw error;
    }
  }

  /**
   * Список дочерних тенантов для тенанта-партнера.
   */
  async listChildTenants(parentTenantId: string): Promise<PartnerChildTenantDTO[]> {
    const rows = await query<TenantRow>(
      `SELECT t.id, t.name, t.slug, t.plan, t.status, t.parent_tenant_id,
              t.auth_settings, t.custom_pricing, t.custom_price_rubles,
              t.created_at, t.updated_at,
              (SELECT count(*) FROM users u WHERE u.tenant_id = t.id AND u.deleted_at IS NULL)::int AS users_count,
              (SELECT count(*) FROM contacts c WHERE c.tenant_id = t.id)::int AS contacts_count,
              (SELECT count(*) FROM deals d WHERE d.tenant_id = t.id)::int AS deals_count,
              u_admin.id AS admin_id,
              u_admin.email AS admin_email,
              u_admin.name AS admin_name,
              u_admin.phone AS admin_phone
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT u.id, u.email, u.name, u.phone
         FROM users u
         WHERE u.tenant_id = t.id AND u.role = 'owner' AND u.deleted_at IS NULL
         ORDER BY u.created_at ASC
         LIMIT 1
       ) u_admin ON true
       WHERE t.parent_tenant_id = $1
       ORDER BY t.created_at DESC`,
      [parentTenantId],
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      plan: r.plan,
      status: r.status,
      parent_tenant_id: r.parent_tenant_id,
      auth_settings: r.auth_settings ?? {
        require_telegram_auth: false,
        allow_password_auth: true,
      },
      custom_pricing: r.custom_pricing,
      custom_price_rubles: r.custom_price_rubles,
      users_count: Number(r.users_count || 0),
      contacts_count: Number(r.contacts_count || 0),
      deals_count: Number(r.deals_count || 0),
      admin: r.admin_id
        ? {
            id: r.admin_id,
            email: r.admin_email ?? "",
            name: r.admin_name ?? "",
            phone: r.admin_phone ?? "",
          }
        : null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
    }));
  }

  /**
   * Обновление настроек аутентификации дочернего тенанта.
   */
  async updateAuthSettings(
    parentTenantId: string,
    targetTenantId: string,
    settings: AuthSettings,
    isPlatformOwner = false,
  ): Promise<PartnerChildTenantDTO> {
    const tenant = await queryOne<TenantRow>(
      `SELECT t.id, t.name, t.slug, t.plan, t.status, t.parent_tenant_id,
              t.auth_settings, t.custom_pricing, t.custom_price_rubles,
              t.created_at, t.updated_at
       FROM tenants t
       WHERE t.id = $1 AND ($2 = true OR t.parent_tenant_id = $3)`,
      [targetTenantId, isPlatformOwner, parentTenantId],
    );

    if (tenant === null) {
      throw new AppError(404, "TENANT_NOT_FOUND", "Дочерний тенант не найден или нет доступа");
    }

    const updated = await queryOne<TenantRow>(
      `UPDATE tenants
       SET auth_settings = $1, updated_at = now()
       WHERE id = $2
       RETURNING id, name, slug, plan, status, parent_tenant_id, auth_settings, custom_pricing, custom_price_rubles, created_at, updated_at`,
      [JSON.stringify(settings), targetTenantId],
    );

    if (updated === null) {
      throw new AppError(500, "UPDATE_FAILED", "Не удалось обновить настройки аутентификации");
    }

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      plan: updated.plan,
      status: updated.status,
      parent_tenant_id: updated.parent_tenant_id,
      auth_settings: updated.auth_settings,
      custom_pricing: updated.custom_pricing,
      custom_price_rubles: updated.custom_price_rubles,
      created_at: new Date(updated.created_at).toISOString(),
      updated_at: new Date(updated.updated_at).toISOString(),
    };
  }
}
