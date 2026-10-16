import { query } from "../../db/client.js";
import type { Role } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Tenant user catalog.
//
// Used by the frontend to render assignee/manager pickers and to resolve a
// user id to a display name and avatar. `avatar_url` появился в миграции 0009 и
// хранит Base64 data-URI; при NULL интерфейс показывает инициалы.
// ---------------------------------------------------------------------------

interface TenantUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar_url: string | null;
}

export interface TenantUserDTO {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  /** Base64 data-URI либо null; при null интерфейс показывает инициалы. */
  avatarUrl: string | null;
}

function toTenantUserDTO(row: TenantUserRow): TenantUserDTO {
  return {
    id: row.id,
    fullName: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatar_url,
  };
}

interface TenantModuleRow {
  slug: string;
  name: string;
  installed_at: Date | string;
  quantity: number;
  trial_ends_at: Date | string | null;
}

export interface TenantModuleDTO {
  slug: string;
  name: string;
  installedAt: string;
  quantity: number;
  trialEndsAt: string | null;
}

function toTenantModuleDTO(row: TenantModuleRow): TenantModuleDTO {
  return {
    slug: row.slug,
    name: row.name,
    installedAt: row.installed_at instanceof Date ? row.installed_at.toISOString() : row.installed_at,
    quantity: row.quantity,
    trialEndsAt:
      row.trial_ends_at === null
        ? null
        : row.trial_ends_at instanceof Date
          ? row.trial_ends_at.toISOString()
          : row.trial_ends_at,
  };
}

export class TenantService {
  /** All users of the tenant, ordered by name for stable picker rendering. */
  async listUsers(tenantId: string): Promise<TenantUserDTO[]> {
    // `deleted_at IS NULL`: уволенный сотрудник не должен появляться в
    // выпадающих списках исполнителей.
    const rows = await query<TenantUserRow>(
      `SELECT id, name, email, role, avatar_url
       FROM users
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY name ASC, created_at ASC`,
      [tenantId],
    );

    return rows.map(toTenantUserDTO);
  }

  /**
   * Установленные модули текущего арендатора.
   *
   * Это единственный источник истины для клиентской навигации и UI-guard'ов:
   * до него frontend подставлял три захардкоженных модуля, из-за чего отключение
   * в маркетплейсе не меняло ни Sidebar, ни доступность экрана.
   */
  async listModules(tenantId: string): Promise<TenantModuleDTO[]> {
    const rows = await query<TenantModuleRow>(
      `SELECT slug, name, installed_at, quantity, trial_ends_at
       FROM installed_modules
       WHERE tenant_id = $1
       ORDER BY installed_at ASC, slug ASC`,
      [tenantId],
    );

    return rows.map(toTenantModuleDTO);
  }
}
