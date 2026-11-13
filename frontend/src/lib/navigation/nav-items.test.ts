import { describe, expect, it } from "vitest";

import {
  CORE_NAV,
  MARKETPLACE_NAV,
  MODULE_NAV,
  CHANNEL_NAV,
  PLATFORM_NAV,
  TENANT_MENU,
  isNavItemVisible,
  visibleChannelNav,
  visibleMainNav,
  type NavItem,
} from "@/lib/navigation/nav-items";
import type { Permission } from "@/types";

// ---------------------------------------------------------------------------
// Навигационные списки и правило видимости.
//
// Модуль появился как предварительное условие мобильного меню: до него списки и
// предикат `isVisible` жили внутри `Sidebar.tsx` (556 строк). Маршрут `/menu`
// показывает те же разделы, и без выноса в нём возникла бы вторая копия правил —
// расхождение вопрос времени, а не вероятности: скрытый в сайдбаре раздел остался
// бы видимым в мобильном меню.
//
// Правило видимости здесь не косметика: оно уже один раз чинилось (`M0.14.x`) —
// менеджер видел в меню «Финансы», проходил по ссылке и получал «нет доступа».
// Поэтому проверяются все ветки, включая `tenant:admin` как надмножество и
// `permissions === null` во время восстановления сессии.
// ---------------------------------------------------------------------------

function permissionSet(...items: Permission[]): Set<string> {
  return new Set<string>(items);
}

/** Пункт модуля: виден при установленном модуле и наличии права. */
function moduleItem(overrides: Partial<NavItem> = {}): NavItem {
  return {
    label: "Финансы",
    href: "/modules/finance",
    icon: MARKETPLACE_NAV.icon,
    always: false,
    moduleSlug: "finance",
    permission: "finance:read",
    ...overrides,
  };
}

describe("Состав навигации", () => {
  it("базовая CRM не зависит от установленных модулей", () => {
    // Эти разделы входят в базовый тариф: гейт по установке к ним не применяется.
    expect(CORE_NAV.every((item) => item.always)).toBe(true);
    expect(CORE_NAV.map((item) => item.href)).toEqual([
      "/dashboard",
      "/analytics",
      "/crm/deals",
      "/crm/contacts",
      "/crm/companies",
      "/crm/tasks",
    ]);
  });

  it("маркетплейс виден всегда", () => {
    // Без него отключённый модуль нельзя вернуть — тупик в интерфейсе.
    expect(MARKETPLACE_NAV.always).toBe(true);
    expect(isNavItemVisible(MARKETPLACE_NAV, new Set(), permissionSet())).toBe(true);
  });

  it("разделы модулей и каналов собраны из общего реестра", () => {
    // Не перечислены заново: связь «модуль ↔ пункт меню» уже однажды жила только
    // в сайдбаре, и пять каналов в неё не попали — маркетплейс их продавал, а
    // меню о них не знало.
    expect(MODULE_NAV.length).toBeGreaterThan(0);
    expect(CHANNEL_NAV.length).toBeGreaterThan(0);
    expect(MODULE_NAV.every((item) => item.moduleSlug !== undefined)).toBe(true);
    expect(CHANNEL_NAV.every((item) => item.moduleSlug !== undefined)).toBe(true);
  });

  it("платформенные разделы и меню компании непусты", () => {
    expect(PLATFORM_NAV.length).toBe(5);
    expect(TENANT_MENU.length).toBe(4);
    // У пунктов меню компании есть описание: оно показывается в выпадающем блоке
    // и на мобильном экране меню.
    expect(TENANT_MENU.every((item) => item.description.length > 0)).toBe(true);
  });
});

describe("isNavItemVisible", () => {
  it("скрывает раздел неустановленного модуля", () => {
    const visible = isNavItemVisible(
      moduleItem(),
      new Set(),
      permissionSet("finance:read"),
    );

    expect(visible).toBe(false);
  });

  it("показывает раздел установленного модуля при наличии права", () => {
    const visible = isNavItemVisible(
      moduleItem(),
      new Set(["finance"]),
      permissionSet("finance:read"),
    );

    expect(visible).toBe(true);
  });

  it("скрывает раздел без права, даже если модуль установлен", () => {
    // Ровно тот дефект, который правило закрывает: менеджер видел «Финансы»,
    // проходил по ссылке и получал заглушку «нет доступа».
    const visible = isNavItemVisible(
      moduleItem(),
      new Set(["finance"]),
      permissionSet("contacts:read"),
    );

    expect(visible).toBe(false);
  });

  it("трактует tenant:admin как надмножество прав", () => {
    // Так же в `useHasPermission` и в `requirePermission` на сервере: иначе меню
    // скрывало бы то, что API разрешает.
    const visible = isNavItemVisible(
      moduleItem(),
      new Set(["finance"]),
      permissionSet("tenant:admin"),
    );

    expect(visible).toBe(true);
  });

  it("не скрывает ничего, пока права неизвестны", () => {
    // `null` — сессия ещё восстанавливается. Скрытие в этот момент давало бы
    // мигание меню при каждой перезагрузке страницы.
    const visible = isNavItemVisible(moduleItem(), new Set(["finance"]), null);

    expect(visible).toBe(true);
  });

  it("пункт без права проверяется только по установке модуля", () => {
    const item = moduleItem({ permission: undefined });

    expect(isNavItemVisible(item, new Set(["finance"]), permissionSet())).toBe(true);
    expect(isNavItemVisible(item, new Set(), permissionSet())).toBe(false);
  });
});

describe("visibleMainNav / visibleChannelNav", () => {
  it("собирает ядро, доступные модули и маркетплейс в одном порядке", () => {
    const nav = visibleMainNav(new Set(), permissionSet());

    // Порядок фиксирован: ядро → модули → маркетплейс. Мобильное меню опирается
    // на тот же порядок, поэтому он часть контракта, а не деталь вёрстки.
    expect(nav.slice(0, CORE_NAV.length)).toEqual(CORE_NAV);
    expect(nav[nav.length - 1]).toEqual(MARKETPLACE_NAV);
  });

  it("добавляет разделы установленных модулей", () => {
    const withoutModules = visibleMainNav(new Set(), permissionSet("tenant:admin"));
    const withFinance = visibleMainNav(new Set(["finance"]), permissionSet("tenant:admin"));

    expect(withFinance.length).toBe(withoutModules.length + 1);
    expect(withFinance.some((item) => item.moduleSlug === "finance")).toBe(true);
  });

  it("каналы отфильтрованы тем же правилом", () => {
    const none = visibleChannelNav(new Set(), permissionSet("tenant:admin"));
    const one = visibleChannelNav(new Set(["telegram"]), permissionSet("tenant:admin"));

    expect(none.map((item) => item.label)).toEqual(["Сайты"]);
    expect(one.map((item) => item.label)).toEqual(["Сайты", "Telegram"]);
  });
});
