import type { ReactNode } from "react";

import type { PageLayoutTabDTO } from "@/lib/api/use-page-layout-tabs";
import type { RecordDetailTab } from "@/components/crm/shared/RecordDetailShell";

// ---------------------------------------------------------------------------
// Сборка вкладок карточки из строк БД + реестра компонентов.
//
// Паттерн Twenty: состав/порядок из данных, компонент — из кода. Неизвестный
// tab_key пропускается молча — откат фронта на старую версию не должен ломать
// карточку целиком. Три фильтра: is_active → module → permission.
// ---------------------------------------------------------------------------

export interface ResolvePageLayoutTabsOptions {
  installedModules: ReadonlyArray<{ slug: string }>;
  hasPermission: (permission: string) => boolean;
}

export function resolvePageLayoutTabs(
  rows: readonly PageLayoutTabDTO[],
  contents: Readonly<Record<string, ReactNode>>,
  options: ResolvePageLayoutTabsOptions,
): RecordDetailTab[] {
  const installed = new Set(options.installedModules.map((module) => module.slug));

  return [...rows]
    .filter((row) => row.isActive)
    .filter((row) => row.moduleSlug === null || installed.has(row.moduleSlug))
    .filter(
      (row) =>
        row.requiredPermission === null || options.hasPermission(row.requiredPermission),
    )
    .filter((row) => Object.prototype.hasOwnProperty.call(contents, row.tabKey))
    .sort((left, right) => left.position - right.position)
    .map((row) => ({
      id: row.tabKey,
      label: row.title,
      content: contents[row.tabKey],
    }));
}

/**
 * Twenty: на широком экране первая вкладка уходит в закреплённую колонку,
 * остальные — в ряд. На мобильном и в боковой панели закрепления нет
 * (`pinnedLeftTab: undefined`). Режем список здесь, показ колонки — CSS `md:`.
 */
export function splitPinnedTabs(tabs: readonly RecordDetailTab[]): {
  pinned: RecordDetailTab | undefined;
  rest: RecordDetailTab[];
} {
  const [first, ...rest] = tabs;
  if (first === undefined) return { pinned: undefined, rest: [] };
  return { pinned: first, rest };
}

/** Запасной состав, пока GET не ответил — тот же порядок, что в сиде. */
export const FALLBACK_PAGE_LAYOUT_TABS: Record<
  "contact" | "company" | "deal",
  readonly PageLayoutTabDTO[]
> = {
  contact: [
    { tabKey: "home", title: "Главная", icon: "Home", position: 10, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "chat", title: "Чат", icon: "MessageCircle", position: 15, isActive: true, moduleSlug: null, requiredPermission: "contacts:write", updatedAt: "" },
    { tabKey: "deals-history", title: "История обращений / Сделки", icon: "Briefcase", position: 18, isActive: true, moduleSlug: null, requiredPermission: "deals:read", updatedAt: "" },
    { tabKey: "timeline", title: "Таймлайн", icon: "Activity", position: 20, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "tasks", title: "Задачи", icon: "ListChecks", position: 30, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "notes", title: "Заметки", icon: "StickyNote", position: 40, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
  ],
  company: [
    { tabKey: "home", title: "Главная", icon: "Home", position: 10, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "timeline", title: "Таймлайн", icon: "Activity", position: 20, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "tasks", title: "Задачи", icon: "ListChecks", position: 30, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "notes", title: "Заметки", icon: "StickyNote", position: 40, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
  ],
  deal: [
    { tabKey: "home", title: "Главная", icon: "Home", position: 10, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "chat", title: "Чат", icon: "MessageCircle", position: 15, isActive: true, moduleSlug: null, requiredPermission: "deals:write", updatedAt: "" },
    { tabKey: "timeline", title: "Таймлайн", icon: "Activity", position: 20, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "analytics", title: "Аналитика", icon: "BarChart3", position: 22, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "contact-history", title: "История контакта", icon: "History", position: 25, isActive: true, moduleSlug: null, requiredPermission: "contacts:read", updatedAt: "" },
    { tabKey: "tasks", title: "Задачи", icon: "ListChecks", position: 30, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "notes", title: "Заметки", icon: "StickyNote", position: 40, isActive: true, moduleSlug: null, requiredPermission: null, updatedAt: "" },
    { tabKey: "files", title: "Файлы", icon: "Paperclip", position: 50, isActive: false, moduleSlug: null, requiredPermission: null, updatedAt: "" },
  ],
};
