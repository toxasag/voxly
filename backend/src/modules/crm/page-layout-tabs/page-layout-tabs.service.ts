import { query } from "../../../db/client.js";
import type { TransactionClient } from "../../../db/client.js";
import { tabsForModule } from "./module-page-layout-tabs.js";
import {
  toPageLayoutTabDTO,
  type PageLayoutObjectType,
  type PageLayoutTabDTO,
  type PageLayoutTabRow,
  type UpdatePageLayoutTab,
} from "./page-layout-tabs.types.js";

/**
 * Сервис вкладок карточек.
 *
 * Работает с `page_layout_tabs` — состав, порядок и условия показа вкладок
 * карточки контакта/компании/сделки. Вкладка живёт в БД, компонент остаётся в
 * коде (фабрика «ключ → React-компонент»).
 */

export class PageLayoutTabsService {
  async list(tenantId: string, objectType: PageLayoutObjectType): Promise<PageLayoutTabDTO[]> {
    const rows = await query<PageLayoutTabRow>(
      `SELECT tab_key, title, icon, position, is_active, module_slug, required_permission, updated_at
       FROM page_layout_tabs
       WHERE tenant_id = $1 AND object_type = $2
       ORDER BY position ASC`,
      [tenantId, objectType],
    );

    return rows.map(toPageLayoutTabDTO);
  }

  async update(
    tenantId: string,
    objectType: PageLayoutObjectType,
    tabKey: string,
    payload: UpdatePageLayoutTab,
  ): Promise<PageLayoutTabDTO | null> {
    if (Object.keys(payload).length === 0) return null;

    // $1 tenant, $2 object_type, $3 tab_key — SET начинается с $4.
    const setClauses: string[] = [];
    const values: (string | number | boolean)[] = [tenantId, objectType, tabKey];
    let idx = 4;

    if (payload.title !== undefined) {
      setClauses.push(`title = $${idx}`);
      values.push(payload.title);
      idx += 1;
    }
    if (payload.icon !== undefined) {
      setClauses.push(`icon = $${idx}`);
      values.push(payload.icon);
      idx += 1;
    }
    if (payload.position !== undefined) {
      setClauses.push(`position = $${idx}`);
      values.push(payload.position);
      idx += 1;
    }
    if (payload.isActive !== undefined) {
      setClauses.push(`is_active = $${idx}`);
      values.push(payload.isActive);
      idx += 1;
    }

    const sql = `
      UPDATE page_layout_tabs
      SET ${setClauses.join(", ")}, updated_at = now()
      WHERE tenant_id = $1 AND object_type = $2 AND tab_key = $3
      RETURNING tab_key, title, icon, position, is_active, module_slug, required_permission, updated_at
    `;

    const [row] = await query<PageLayoutTabRow>(sql, values);

    return row !== undefined ? toPageLayoutTabDTO(row) : null;
  }

  /**
   * Установка модуля: вставляет вкладки, не затирая уже существующие строки.
   * Повторный install после uninstall только включает is_active.
   */
  async applyModuleInstall(tx: TransactionClient, tenantId: string, slug: string): Promise<void> {
    for (const tab of tabsForModule(slug)) {
      await tx.query(
        `INSERT INTO page_layout_tabs
           (tenant_id, object_type, tab_key, title, icon, position, is_active, module_slug, required_permission)
         VALUES ($1, $2, $3, $4, $5, $6, true, $7, $8)
         ON CONFLICT (tenant_id, object_type, tab_key) DO UPDATE
           SET is_active = true, module_slug = EXCLUDED.module_slug,
               required_permission = EXCLUDED.required_permission`,
        [
          tenantId,
          tab.objectType,
          tab.tabKey,
          tab.title,
          tab.icon,
          tab.position,
          slug,
          tab.requiredPermission,
        ],
      );
    }
  }

  /** Отключение модуля: вкладки остаются, но скрываются. */
  async applyModuleUninstall(tx: TransactionClient, tenantId: string, slug: string): Promise<void> {
    await tx.query(
      `UPDATE page_layout_tabs
       SET is_active = false, updated_at = now()
       WHERE tenant_id = $1 AND module_slug = $2 AND is_active = true`,
      [tenantId, slug],
    );
  }
}
