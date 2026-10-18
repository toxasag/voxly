export type Role = "owner" | "admin" | "manager" | "technician" | "viewer";

/**
 * Глобальная (платформенная) роль — в отличие от Role, не привязана к тенанту.
 * Держатели platform_owner видят superadmin-панель; всем остальным
 * платформенные роуты отвечают 403 независимо от тенантной роли.
 */
export type PlatformRole = "platform_owner";

/**
 * Слаги каналов связи.
 *
 * Без префикса `integration_`: именно эти значения лежат в `marketplace_modules`
 * и в `installed_modules` у существующих арендаторов, а также в `entity_id`
 * журнала `tenant_audit_log`, по которому определяется, начислялся ли пробный
 * период. Переименование потребовало бы миграции данных в трёх таблицах ради
 * косметики — тот же довод, по которому `ai_bots` не стал `ai_agents`.
 *
 * Категория `integration` в каталоге уже отделяет каналы от остальных модулей,
 * поэтому префикс в слаге не несёт информации.
 */
export const BASE_MODULE_SLUG = "core_crm";

export const CHANNEL_SLUGS = [
  "telegram",
  "whatsapp",
  "max",
  "avito",
  "instagram",
  "webchat",
  "telegram_bot",
  "max_bot",
] as const;

export type ChannelSlug = (typeof CHANNEL_SLUGS)[number];

/**
 * Модули с собственными разделами интерфейса и гейтом `requireModule`.
 *
 * Каналы входят сюда с появлением страниц `/integrations/*`: до этого они были
 * только тарифными позициями маркетплейса, и `requireModule` к ним не
 * применялся.
 */
export const MODULE_SLUGS = ["service_center", "finance", "ai_bots", ...CHANNEL_SLUGS] as const;

export type ModuleSlug = (typeof MODULE_SLUGS)[number];

export function isChannelSlug(value: string): value is ChannelSlug {
  return (CHANNEL_SLUGS as readonly string[]).includes(value);
}

export type Permission =
  | "contacts:read"
  | "contacts:write"
  | "contacts:delete"
  | "companies:read"
  | "companies:write"
  | "companies:delete"
  | "deals:read"
  | "deals:write"
  | "tasks:read"
  | "tasks:write"
  | "service_center:read"
  | "service_center:write"
  | "finance:read"
  | "finance:write"
  | "finance:admin"
  | "ai_bots:read"
  | "ai_bots:configure"
  | "tenant:admin"
  | "billing:manage"
  | "billing:view"
  | "stories:read"
  | "stories:write"
  | "stories:publish"
  | "chat:read"
  | "chat:write";

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  phone: string;
  name: string;
  role: Role;
  /** Глобальная платформенная роль; null у обычных пользователей CRM. */
  platform_role: PlatformRole | null;
  permissions: Permission[];
  created_at: string;
  updated_at: string;
}

export interface Tenant {
  id: string;
  name: string;
  plan: string;
  status: "trial" | "active" | "past_due" | "suspended";
  created_at: string;
  updated_at: string;
}

export interface InstalledModule {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  installed_at: string;
}

export interface FastifyRequestWithAuth {
  user: User;
  tenant_id: string;
  permissions: Set<Permission>;
  installed_modules: string[];
}

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginationMeta {
  limit: number;
  offset: number;
  total: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: Record<string, string[]>;
  };
}

/** Wire format produced by errorHandler: ApiError plus a discriminant. */
export interface ApiErrorEnvelope extends ApiError {
  status: "error";
}
