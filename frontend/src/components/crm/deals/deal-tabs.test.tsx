import { describe, expect, it } from "vitest";

import {
  dealTabContents,
  DEAL_TAB_IDS,
  type DealStageInfo,
} from "@/components/crm/deals/deal-tabs";
import {
  FALLBACK_PAGE_LAYOUT_TABS,
  resolvePageLayoutTabs,
} from "@/components/crm/shared/resolve-page-layout-tabs";
import type { DealDTO } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";

// ---------------------------------------------------------------------------
// Реестр содержимого сделки + тот же состав, что сид `page_layout_tabs`.
//
// Раньше `dealTabs` отдавал готовый список. Теперь состав приходит из БД, а
// здесь проверяется реестр ключей и совпадение с запасным сидом — иначе
// полоса вкладок на панели и на странице снова разъедется.
// ---------------------------------------------------------------------------

function deal(overrides: Partial<DealDTO> = {}): DealDTO {
  return {
    id: "deal-1",
    pipelineId: "pipe-1",
    stageId: "stage-1",
    contactId: "contact-1",
    companyId: null,
    title: "Заявка из Telegram",
    description: "",
    budget: 0,
    currency: "RUB",
    customFields: {},
    createdBy: "user-1",
    ownerId: "user-1",
    closeDate: null,
    position: 0,
    closedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    companyName: null,
    contactName: "Иван Петров",
    ownerName: "Менеджер",
    ...overrides,
  };
}

function context(stages: Map<string, DealStageInfo> = new Map()) {
  return {
    usersById: new Map<string, TenantUserDTO>(),
    pipelines: [{ id: "pipe-1", name: "Основная", sortOrder: 0 }],
    stagesById: stages,
  };
}

describe("dealTabContents", () => {
  it("реестр содержит все объявленные идентификаторы", () => {
    const contents = dealTabContents(deal(), context());
    expect(Object.keys(contents).sort()).toEqual([...DEAL_TAB_IDS].sort());
  });

  it("с запасным сидом даёт порядок Главная → Чат → Таймлайн → Аналитика → Источник → История → Задачи → Заметки", () => {
    // files в сиде is_active=false — на телефоне не занимает место в ряду.
    const tabs = resolvePageLayoutTabs(
      FALLBACK_PAGE_LAYOUT_TABS.deal,
      dealTabContents(deal(), context()),
      { installedModules: [], hasPermission: () => true },
    );

    expect(tabs.map((tab) => tab.id)).toEqual([
      "home",
      "chat",
      "timeline",
      "analytics",
      "source",
      "contact-history",
      "tasks",
      "notes",
    ]);
    expect(tabs.map((tab) => tab.label)).toEqual([
      "Главная",
      "Чат",
      "Таймлайн",
      "Аналитика",
      "Источник",
      "История",
      "Задачи",
      "Заметки",
    ]);
  });

  it("прячет чат без deals:write", () => {
    const tabs = resolvePageLayoutTabs(
      FALLBACK_PAGE_LAYOUT_TABS.deal,
      dealTabContents(deal(), context()),
      { installedModules: [], hasPermission: (p) => p !== "deals:write" },
    );

    expect(tabs.map((tab) => tab.id)).toEqual([
      "home",
      "timeline",
      "analytics",
      "source",
      "contact-history",
      "tasks",
      "notes",
    ]);
  });

  it("показывает вкладку СЦ между Чат и Таймлайн при установленном модуле service_center", () => {
    const tabs = resolvePageLayoutTabs(
      FALLBACK_PAGE_LAYOUT_TABS.deal,
      dealTabContents(deal(), context()),
      { installedModules: [{ slug: "service_center" }], hasPermission: () => true },
    );

    expect(tabs.map((tab) => tab.id)).toEqual([
      "home",
      "chat",
      "repairs",
      "timeline",
      "analytics",
      "source",
      "contact-history",
      "tasks",
      "notes",
    ]);
    expect(tabs.find((tab) => tab.id === "repairs")?.label).toBe("СЦ");
  });

  it("не зависит от наличия справочника этапов", () => {
    const withoutStages = Object.keys(dealTabContents(deal(), context())).sort();
    const withStages = Object.keys(
      dealTabContents(
        deal(),
        context(new Map([["stage-1", { name: "Новый лид", isWon: false, isLost: false }]])),
      ),
    ).sort();

    expect(withoutStages).toEqual(withStages);
  });
});
