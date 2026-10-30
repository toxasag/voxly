import { describe, expect, it } from "vitest";

import {
  FALLBACK_PAGE_LAYOUT_TABS,
  resolvePageLayoutTabs,
  splitPinnedTabs,
} from "@/components/crm/shared/resolve-page-layout-tabs";
import type { PageLayoutTabDTO } from "@/lib/api/use-page-layout-tabs";

function row(overrides: Partial<PageLayoutTabDTO> & Pick<PageLayoutTabDTO, "tabKey">): PageLayoutTabDTO {
  return {
    title: overrides.tabKey,
    icon: "Home",
    position: 10,
    isActive: true,
    moduleSlug: null,
    requiredPermission: null,
    updatedAt: "",
    ...overrides,
  };
}

describe("resolvePageLayoutTabs", () => {
  it("orders by position and uses titles from the server", () => {
    const tabs = resolvePageLayoutTabs(
      [
        row({ tabKey: "notes", position: 40, title: "Заметки" }),
        row({ tabKey: "home", position: 10, title: "Главная" }),
        row({ tabKey: "tasks", position: 30, title: "Задачи" }),
      ],
      { home: "H", tasks: "T", notes: "N" },
      { installedModules: [], hasPermission: () => true },
    );

    expect(tabs.map((tab) => tab.id)).toEqual(["home", "tasks", "notes"]);
    expect(tabs.map((tab) => tab.label)).toEqual(["Главная", "Задачи", "Заметки"]);
  });

  it("skips unknown tab keys silently", () => {
    const tabs = resolvePageLayoutTabs(
      [
        row({ tabKey: "home", position: 10 }),
        row({ tabKey: "legacy_timeline", position: 20 }),
        row({ tabKey: "tasks", position: 30 }),
      ],
      { home: "H", tasks: "T" },
      { installedModules: [], hasPermission: () => true },
    );

    expect(tabs.map((tab) => tab.id)).toEqual(["home", "tasks"]);
  });

  it("hides inactive tabs and module-gated tabs without the module", () => {
    const tabs = resolvePageLayoutTabs(
      [
        row({ tabKey: "home", position: 10 }),
        row({ tabKey: "files", position: 50, isActive: false }),
        row({ tabKey: "finance", position: 60, moduleSlug: "finance" }),
      ],
      { home: "H", files: "F", finance: "Fin" },
      { installedModules: [], hasPermission: () => true },
    );

    expect(tabs.map((tab) => tab.id)).toEqual(["home"]);
  });

  it("shows a module tab when the module is installed", () => {
    const tabs = resolvePageLayoutTabs(
      [row({ tabKey: "repairs", position: 20, moduleSlug: "service_center" })],
      { repairs: "R" },
      { installedModules: [{ slug: "service_center" }], hasPermission: () => true },
    );

    expect(tabs.map((tab) => tab.id)).toEqual(["repairs"]);
  });

  it("hides tabs the user cannot open", () => {
    const tabs = resolvePageLayoutTabs(
      [
        row({ tabKey: "home", position: 10 }),
        row({ tabKey: "chat", position: 15, requiredPermission: "deals:write" }),
      ],
      { home: "H", chat: "C" },
      { installedModules: [], hasPermission: () => false },
    );

    expect(tabs.map((tab) => tab.id)).toEqual(["home"]);
  });

  it("splitPinnedTabs выносит первую вкладку, остальные сохраняют порядок", () => {
    const tabs = resolvePageLayoutTabs(
      FALLBACK_PAGE_LAYOUT_TABS.deal,
      { home: "H", chat: "C", tasks: "T", notes: "N" },
      { installedModules: [], hasPermission: () => true },
    );
    const { pinned, rest } = splitPinnedTabs(tabs);

    expect(pinned?.id).toBe("home");
    expect(rest.map((tab) => tab.id)).toEqual(["chat", "tasks", "notes"]);
  });

  it("splitPinnedTabs на пустом списке не выдумывает закреплённую вкладку", () => {
    expect(splitPinnedTabs([])).toEqual({ pinned: undefined, rest: [] });
  });

  it("fallback deal seed matches the migration positions", () => {
    expect(FALLBACK_PAGE_LAYOUT_TABS.deal.map((tab) => [tab.tabKey, tab.position, tab.isActive])).toEqual([
      ["home", 10, true],
      ["chat", 15, true],
      ["timeline", 20, true],
      ["analytics", 22, true],
      ["source", 24, true],
      ["contact-history", 25, true],
      ["tasks", 30, true],
      ["notes", 40, true],
      ["files", 50, false],
    ]);
  });
});
