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
  | "billing:manage";

export type Role = "owner" | "admin" | "partner" | "manager" | "technician" | "viewer";

/** Глобальная платформенная роль (superadmin); null у обычных пользователей CRM. */
export type PlatformRole = "platform_owner";

/**
 * Слаги каналов связи. Зеркалит `CHANNEL_SLUGS` бэкенда.
 *
 * Без префикса `integration_`: именно эти значения лежат в `marketplace_modules`
 * и в `installed_modules` у существующих арендаторов. Категория `integration` в
 * каталоге уже отделяет каналы от прочих модулей, поэтому префикс в слаге не
 * добавил бы информации, а переименование потребовало бы миграции данных.
 */
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

/** Модули с собственными разделами интерфейса. Зеркалит `MODULE_SLUGS` бэкенда. */
export const MODULE_SLUGS = ["service_center", "finance", "ai_bots", ...CHANNEL_SLUGS] as const;

export type ModuleSlug = (typeof MODULE_SLUGS)[number];

export function isModuleSlug(value: string): value is ModuleSlug {
  return (MODULE_SLUGS as readonly string[]).includes(value);
}

export function isChannelSlug(value: string): value is ChannelSlug {
  return (CHANNEL_SLUGS as readonly string[]).includes(value);
}

export interface InstalledModule {
  slug: ModuleSlug;
  name: string;
  installed_at: string;
}

export interface CurrentUser {
  id: string;
  email: string;
  phone: string;
  name: string;
  role: Role;
  platform_role: PlatformRole | null;
  permissions: Set<Permission>;
}

export interface Tenant {
  tenantId: string;
  tenantName: string;
  /** Personal subdomain: {slug}.getvoxly.ru. */
  slug: string;
  plan: string;
  installedModules: InstalledModule[];
}

// ---------------------------------------------------------------------------
// CRM Domain Types
// ---------------------------------------------------------------------------

export type ContactChannel = "telegram" | "whatsapp" | "rumax" | "phone" | "email";

export interface ContactCustomFields {
  [key: string]: string | number;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  telegram_username: string;
  whatsapp: string;
  company_name: string;
  company_id: string | null;
  channel: ContactChannel;
  custom_fields: ContactCustomFields;
  notes: string;
  created_at: string;
  updated_at: string;
  deals_count: number;
  tasks_count: number;
}

export interface CompanyRequisites {
  inn: string;
  ogrn: string;
  bik: string;
  account_number: string;
  legal_address: string;
}

export interface Company {
  id: string;
  name: string;
  phone: string;
  email: string;
  requisites: CompanyRequisites;
  manager_name: string;
  manager_id: string;
  contacts_count: number;
  deals_count: number;
  created_at: string;
  updated_at: string;
}

export type TaskPriority = "high" | "medium" | "low";
export type TaskStatus = "todo" | "in_progress" | "done";

export interface CrmTask {
  id: string;
  title: string;
  description: string;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string;
  assignee_name: string;
  assignee_id: string;
  linked_entity_type: "deal" | "contact" | "company" | null;
  linked_entity_id: string | null;
  linked_entity_label: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Marketplace & AI Agent Types
// ---------------------------------------------------------------------------

export type TenantSubscriptionStatus = "trial" | "active" | "past_due" | "suspended" | "cancelled";

export interface MarketplaceModule {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  price: string;
  price_period: string;
  features: string[];
  installed: boolean;
  category: "crm" | "service" | "finance" | "ai" | "integration";
}

export type AiAgentMode = "suggester" | "autoreply" | "disabled";

export interface AiAgentConfig {
  id: string;
  name: string;
  model: string;
  system_prompt: string;
  mode: AiAgentMode;
  temperature: number;
  tokens_used: number;
  tokens_limit: number;
  created_at: string;
  updated_at: string;
}

export interface ReferralStats {
  referral_code: string;
  referral_link: string;
  total_invited: number;
  total_earned: number;
  available_payout: number;
}

export interface ReferralPayout {
  id: string;
  amount: number;
  currency: string;
  status: "pending" | "completed";
  method: string;
  created_at: string;
  paid_at: string | null;
}

// ---------------------------------------------------------------------------
// Notification Types
// ---------------------------------------------------------------------------

export type NotificationCategory = "message" | "repair" | "payment" | "system";

export type NotificationEntityType = "deal" | "repair" | "invoice" | "contact" | "system";

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  entity_type: NotificationEntityType;
  entity_id: string;
  title: string;
  description: string;
  created_at: string;
  read: boolean;
}

export interface NotificationGroup {
  category: NotificationCategory;
  label: string;
  notifications: AppNotification[];
}