import { withTenant, queryOne, type TransactionClient } from "../../db/client.js";

// ---------------------------------------------------------------------------
// Tenant default seeding.
//
// A fresh tenant has no pipeline, so the Kanban board and deal creation have
// nothing to point at, and no cash account, so finance cannot record anything.
// This helper provisions the minimum set of default entities the CRM needs to
// be usable, idempotently: each block first checks for existing rows and skips
// if the tenant already has them, so calling it repeatedly is safe.
// ---------------------------------------------------------------------------

/** Ordered stages of the default pipeline. Terminal flags drive `closed_at`. */
const DEFAULT_STAGES: ReadonlyArray<{
  name: string;
  isWon: boolean;
  isLost: boolean;
  isSystem: boolean;
  color: string;
}> = [
  // Системные этапы: вход янтарный, успех зелёный предпоследним, провал красный последним.
  { name: "Новый лид", isWon: false, isLost: false, isSystem: true, color: "amber" },
  { name: "Квалификация", isWon: false, isLost: false, isSystem: false, color: "sky" },
  { name: "Согласование", isWon: false, isLost: false, isSystem: false, color: "violet" },
  { name: "В работе", isWon: false, isLost: false, isSystem: false, color: "orange" },
  { name: "Успешно реализовано", isWon: true, isLost: false, isSystem: true, color: "emerald" },
  { name: "Закрыто и не реализовано", isWon: false, isLost: true, isSystem: true, color: "rose" },
];

/** Default income/expense categories. */
const DEFAULT_CATEGORIES: ReadonlyArray<{ name: string; type: "income" | "expense" }> = [
  { name: "Продажи", type: "income" },
  { name: "Услуги", type: "income" },
  { name: "Прочие доходы", type: "income" },
  { name: "Закупка товаров", type: "expense" },
  { name: "Зарплата", type: "expense" },
  { name: "Аренда", type: "expense" },
  { name: "Налоги", type: "expense" },
  { name: "Прочие расходы", type: "expense" },
];

const DEFAULT_CASH_ACCOUNT = { name: "Основная касса (Наличные)", currency: "RUB" };

/** Стандартные вкладки карточек — тот же состав, что миграция 0025. */
const DEFAULT_PAGE_LAYOUT_TABS: ReadonlyArray<{
  objectType: "contact" | "company" | "deal";
  tabKey: string;
  title: string;
  icon: string;
  position: number;
  isActive: boolean;
  requiredPermission: string | null;
}> = [
  { objectType: "contact", tabKey: "home", title: "Главная", icon: "Home", position: 10, isActive: true, requiredPermission: null },
  { objectType: "contact", tabKey: "chat", title: "Чат", icon: "MessageCircle", position: 15, isActive: true, requiredPermission: "contacts:write" },
  { objectType: "contact", tabKey: "tasks", title: "Задачи", icon: "ListChecks", position: 30, isActive: true, requiredPermission: null },
  { objectType: "contact", tabKey: "notes", title: "Заметки", icon: "StickyNote", position: 40, isActive: true, requiredPermission: null },
  { objectType: "company", tabKey: "home", title: "Главная", icon: "Home", position: 10, isActive: true, requiredPermission: null },
  { objectType: "company", tabKey: "tasks", title: "Задачи", icon: "ListChecks", position: 30, isActive: true, requiredPermission: null },
  { objectType: "company", tabKey: "notes", title: "Заметки", icon: "StickyNote", position: 40, isActive: true, requiredPermission: null },
  { objectType: "deal", tabKey: "home", title: "Главная", icon: "Home", position: 10, isActive: true, requiredPermission: null },
  { objectType: "deal", tabKey: "chat", title: "Чат", icon: "MessageCircle", position: 15, isActive: true, requiredPermission: "deals:write" },
  { objectType: "deal", tabKey: "tasks", title: "Задачи", icon: "ListChecks", position: 30, isActive: true, requiredPermission: null },
  { objectType: "deal", tabKey: "notes", title: "Заметки", icon: "StickyNote", position: 40, isActive: true, requiredPermission: null },
  { objectType: "deal", tabKey: "files", title: "Файлы", icon: "Paperclip", position: 50, isActive: false, requiredPermission: null },
];

async function seedPipeline(tx: TransactionClient, tenantId: string): Promise<boolean> {
  const existing = await tx.queryOne<{ id: string }>(
    `SELECT id FROM pipelines WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (existing !== null) return false;

  const pipeline = await tx.queryOneOrThrow<{ id: string }>(
    `INSERT INTO pipelines (tenant_id, name, sort_order) VALUES ($1, $2, 0) RETURNING id`,
    [tenantId, "Основная"],
  );

  // Sequential inserts preserve stage order; a single multi-row insert would
  // not guarantee the returned/stored order without an explicit sort column.
  for (let index = 0; index < DEFAULT_STAGES.length; index += 1) {
    const stage = DEFAULT_STAGES[index];
    if (stage === undefined) continue;
    await tx.query(
      `INSERT INTO stages (pipeline_id, name, sort_order, is_won, is_lost, is_system, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [pipeline.id, stage.name, index, stage.isWon, stage.isLost, stage.isSystem, stage.color],
    );
  }

  return true;
}

async function seedCashAccount(tx: TransactionClient, tenantId: string): Promise<boolean> {
  const existing = await tx.queryOne<{ id: string }>(
    `SELECT id FROM cash_accounts WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (existing !== null) return false;

  await tx.query(
    `INSERT INTO cash_accounts (tenant_id, name, currency, balance, is_default)
     VALUES ($1, $2, $3, 0, true)`,
    [tenantId, DEFAULT_CASH_ACCOUNT.name, DEFAULT_CASH_ACCOUNT.currency],
  );

  return true;
}

async function seedFinanceCategories(tx: TransactionClient, tenantId: string): Promise<boolean> {
  const existing = await tx.queryOne<{ id: string }>(
    `SELECT id FROM finance_categories WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (existing !== null) return false;

  for (const category of DEFAULT_CATEGORIES) {
    await tx.query(
      `INSERT INTO finance_categories (tenant_id, name, type) VALUES ($1, $2, $3)`,
      [tenantId, category.name, category.type],
    );
  }

  return true;
}

async function seedPageLayoutTabs(tx: TransactionClient, tenantId: string): Promise<boolean> {
  const existing = await tx.queryOne<{ tab_key: string }>(
    `SELECT tab_key FROM page_layout_tabs WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  if (existing !== null) return false;

  for (const tab of DEFAULT_PAGE_LAYOUT_TABS) {
    await tx.query(
      `INSERT INTO page_layout_tabs
         (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)
       ON CONFLICT (tenant_id, object_type, tab_key) DO NOTHING`,
      [
        tenantId,
        tab.objectType,
        tab.tabKey,
        tab.title,
        tab.icon,
        tab.position,
        tab.isActive,
        tab.requiredPermission,
      ],
    );
  }

  return true;
}

export interface TenantDefaultsResult {
  pipelineCreated: boolean;
  cashAccountCreated: boolean;
  categoriesCreated: boolean;
  pageLayoutTabsCreated: boolean;
}

/**
 * Ensures a tenant has the default pipeline, cash account, finance
 * categories and card tabs. Idempotent and safe to call on every relevant
 * request; runs inside `withTenant` so RLS applies and all inserts share one
 * transaction.
 */
export async function ensureTenantDefaults(tenantId: string): Promise<TenantDefaultsResult> {
  return withTenant(tenantId, async (tx) => {
    const pipelineCreated = await seedPipeline(tx, tenantId);
    const cashAccountCreated = await seedCashAccount(tx, tenantId);
    const categoriesCreated = await seedFinanceCategories(tx, tenantId);
    const pageLayoutTabsCreated = await seedPageLayoutTabs(tx, tenantId);

    return { pipelineCreated, cashAccountCreated, categoriesCreated, pageLayoutTabsCreated };
  });
}

/** Cheap existence probe used to decide whether seeding is needed at all. */
export async function tenantHasPipeline(tenantId: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM pipelines WHERE tenant_id = $1 LIMIT 1`,
    [tenantId],
  );
  return row !== null;
}
