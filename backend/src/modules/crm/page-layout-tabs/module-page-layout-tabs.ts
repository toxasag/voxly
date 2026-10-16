import type { PageLayoutObjectType } from "./page-layout-tabs.types.js";

/**
 * Вкладки, которые модуль вставляет в карточки CRM при установке.
 *
 * Позиции — между стандартными шагами 10: repairs 20 (между Главной и Задачами).
 * Отключение не удаляет строку: is_active=false, повторная установка не плодит
 * дубли и не затирает title/position, если арендатор их правил.
 */
export interface ModulePageLayoutTabSpec {
  objectType: PageLayoutObjectType;
  tabKey: string;
  title: string;
  icon: string;
  position: number;
  requiredPermission: string | null;
}

export const MODULE_PAGE_LAYOUT_TABS: Readonly<Record<string, readonly ModulePageLayoutTabSpec[]>> = {
  service_center: [
    {
      objectType: "contact",
      tabKey: "repairs",
      title: "Ремонты",
      icon: "Wrench",
      position: 20,
      requiredPermission: "service_center:read",
    },
  ],
  finance: [
    {
      objectType: "company",
      tabKey: "invoices",
      title: "Счета",
      icon: "Receipt",
      position: 20,
      requiredPermission: "finance:read",
    },
  ],
};

export function tabsForModule(slug: string): readonly ModulePageLayoutTabSpec[] {
  return MODULE_PAGE_LAYOUT_TABS[slug] ?? [];
}
