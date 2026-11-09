"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Handshake } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { Guard } from "@/components/shared/Guard";
import {
  DealKanban,
  DealKanbanError,
  type KanbanStageOps,
} from "@/components/crm/deals/DealKanban";
import { DealListView } from "@/components/crm/deals/DealListView";
import { DealsCalendarView } from "@/components/crm/deals/DealsCalendarView";
import { useDealsViewMode } from "@/components/crm/deals/use-deals-view-mode";
import { CreateDealModal } from "@/components/crm/deals/CreateDealModal";
import { DealDrawer } from "@/components/crm/deals/DealDrawer";
import {
  DealsToolbar,
  type DealSortKey,
  type DuplicateGroup,
} from "@/components/crm/deals/DealsToolbar";
import type { DealCardOptions } from "@/components/crm/deals/DealCard";
import {
  defaultDealCardFields,
  normalizeDealCardFields,
} from "@/components/crm/deals/deal-card-fields";
import {
  useCreateDeal,
  useCreateStage,
  useDeleteStage,
  useKanban,
  usePipelines,
  useUpdateStage,
  type KanbanColumnDTO,
} from "@/lib/api/use-deals";
import { useTenantUsers, indexTenantUsers } from "@/lib/api/use-tenant-users";
import { useRecordParam } from "@/lib/utils/use-record-param";
import { cn } from "@/lib/utils";
import type { CreateDealPayload } from "@/schemas/deal.schema";

const APPEARANCE_KEY = "getvoxly.dealcard";

const DEFAULT_APPEARANCE: DealCardOptions = defaultDealCardFields();

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function DealsContent() {
  const searchParams = useSearchParams();
  const pipelines = usePipelines();
  const tenantUsers = useTenantUsers();
  const createDeal = useCreateDeal();

  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  /**
   * Открытая сделка живёт в адресе (`?record=`), как у контактов и компаний
   * (пункт 17 плана). С локальным состоянием системная кнопка «назад» на
   * телефоне уводила со страницы сделок вместо закрытия карточки, а ссылку на
   * сделку из таблицы нельзя было отправить.
   */
  const {
    recordId: drawerDealId,
    openRecord: openDrawerDeal,
    closeRecord: closeDrawerDeal,
  } = useRecordParam();

  /**
   * Вид сохраняется в серверном представлении, а не в локальном состоянии: раньше
   * `useState("kanban")` сбрасывал выбор при каждом заходе, и менеджер, работающий
   * списком, каждый раз возвращался в канбан.
   */
  const { viewMode: view, setViewMode: setView } = useDealsViewMode();
  type DealPresetView = "all" | "active" | "high_value" | "won";
  const [presetView, setPresetView] = useState<DealPresetView>("all");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<DealSortKey>("created");
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [configureMode, setConfigureMode] = useState(false);
  const [bulkEnabled, setBulkEnabled] = useState(false);
  const [appearance, setAppearance] = useState<DealCardOptions>(DEFAULT_APPEARANCE);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (pipelineId === null && pipelines.data?.[0]) setPipelineId(pipelines.data[0].id);
  }, [pipelineId, pipelines.data]);

  useEffect(() => {
    if (searchParams.get("create") === "1") setCreateOpen(true);
  }, [searchParams]);

  useEffect(() => {
    const handler = () => setCreateOpen(true);
    window.addEventListener("open-create-deal", handler);
    return () => window.removeEventListener("open-create-deal", handler);
  }, []);

  // Опции внешнего вида карточки читаются после монтирования: localStorage
  // недоступен при SSR, а чтение в инициализаторе сломало бы гидратацию.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(APPEARANCE_KEY);
      // `normalizeDealCardFields` дополняет запись новыми полями кода: иначе
      // поле, добавленное после сохранения настроек, осталось бы скрытым навсегда
      // (в записи его ключа нет, а `undefined` читался бы как «выключено»).
      if (raw !== null) setAppearance(normalizeDealCardFields(JSON.parse(raw)));
    } catch {
      // Повреждённый JSON не должен ломать страницу — остаёмся на дефолтах.
    }
  }, []);

  const updateAppearance = useCallback((options: DealCardOptions) => {
    setAppearance(options);
    try {
      window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(options));
    } catch {
      // Приватный режим браузера может запретить запись — вид просто не сохранится.
    }
  }, []);

  // ⌘K на странице сделок фокусирует локальный поиск вместо глобальной палитры:
  // capture-фаза перехватывает событие раньше обработчика CommandMenu.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopPropagation();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const kanban = useKanban(pipelineId);
  const usersById = useMemo(() => indexTenantUsers(tenantUsers.data), [tenantUsers.data]);

  // Автообновление воронки каждые 30 секунд — опционально из меню •••.
  useEffect(() => {
    if (!autoRefresh || pipelineId === null) return;
    const timer = setInterval(() => void kanban.refetch(), 30_000);
    return () => clearInterval(timer);
  }, [autoRefresh, pipelineId, kanban]);

  const columns = useMemo(() => [...(kanban.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [kanban.data]);

  /** Имена и цвета этапов для карточки рекорда в дровере. */
  const stagesById = useMemo(() => {
    const map = new Map<string, { name: string; colorKey?: string; isWon: boolean; isLost: boolean }>();
    for (const column of columns) {
      map.set(column.stageId, {
        name: column.stageName,
        colorKey: column.stageColor,
        isWon: column.isWon,
        isLost: column.isLost,
      });
    }
    return map;
  }, [columns]);

  /** Счётчики по срезам (Saved Views) */
  const presetCounts = useMemo(() => {
    const all = columns.flatMap((column) => column.deals);
    const activeStageIds = new Set(columns.filter((c) => !c.isWon && !c.isLost).map((c) => c.stageId));
    const wonStageIds = new Set(columns.filter((c) => c.isWon).map((c) => c.stageId));
    return {
      all: all.length,
      active: all.filter((d) => activeStageIds.has(d.stageId)).length,
      high_value: all.filter((d) => d.budget >= 100000).length,
      won: all.filter((d) => wonStageIds.has(d.stageId)).length,
    };
  }, [columns]);

  /** Плоский список сделок воронки с учётом активного среза и поиска. */
  const filteredDeals = useMemo(() => {
    const query = search.trim().toLowerCase();
    let all = columns.flatMap((column) => column.deals);
    if (presetView === "active") {
      const activeStageIds = new Set(columns.filter((c) => !c.isWon && !c.isLost).map((c) => c.stageId));
      all = all.filter((d) => activeStageIds.has(d.stageId));
    } else if (presetView === "high_value") {
      all = all.filter((d) => d.budget >= 100000);
    } else if (presetView === "won") {
      const wonStageIds = new Set(columns.filter((c) => c.isWon).map((c) => c.stageId));
      all = all.filter((d) => wonStageIds.has(d.stageId));
    }

    if (query === "") return all;
    return all.filter(
      (deal) =>
        deal.title.toLowerCase().includes(query) ||
        deal.description.toLowerCase().includes(query),
    );
  }, [columns, presetView, search]);

  /**
   * Колонки канбана с учётом активного среза и поиска.
   */
  const filteredColumns = useMemo(() => {
    const query = search.trim().toLowerCase();

    return columns.map((column) => {
      let deals = column.deals;
      if (presetView === "active" && (column.isWon || column.isLost)) {
        deals = [];
      } else if (presetView === "high_value") {
        deals = deals.filter((d) => d.budget >= 100000);
      } else if (presetView === "won" && !column.isWon) {
        deals = [];
      }

      if (query !== "") {
        deals = deals.filter(
          (deal) =>
            deal.title.toLowerCase().includes(query) ||
            deal.description.toLowerCase().includes(query),
        );
      }

      if (deals.length > 1) {
        deals = [...deals].sort((a, b) => {
          switch (sortBy) {
            case "last_message":
            case "last_event":
              return b.updatedAt.localeCompare(a.updatedAt);
            case "created":
              return b.createdAt.localeCompare(a.createdAt);
            case "title":
              return a.title.localeCompare(b.title, "ru");
            case "budget":
              return b.budget - a.budget;
            default:
              return (a.position ?? 0) - (b.position ?? 0);
          }
        });
      }

      return {
        ...column,
        deals,
        dealCount: deals.length,
        budgetTotal: deals.reduce((total, deal) => total + deal.budget, 0),
      };
    });
  }, [columns, presetView, search, sortBy]);

  const sortedDeals = useMemo(() => {
    const deals = [...filteredDeals];
    switch (sortBy) {
      case "last_message":
      case "last_event":
        deals.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        break;
      case "created":
        deals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case "title":
        deals.sort((a, b) => a.title.localeCompare(b.title, "ru"));
        break;
      case "budget":
        deals.sort((a, b) => b.budget - a.budget);
        break;
    }
    return deals;
  }, [filteredDeals, sortBy]);

  const summary = useMemo(() => ({
    count: filteredDeals.length,
    sum: filteredDeals.reduce((total, deal) => total + deal.budget, 0),
  }), [filteredDeals]);

  const duplicates = useMemo<DuplicateGroup[]>(() => {
    const groups = new Map<string, DuplicateGroup>();
    for (const deal of columns.flatMap((column) => column.deals)) {
      const key = normalizeTitle(deal.title);
      if (key.length === 0) continue;
      const existing = groups.get(key);
      if (existing === undefined) {
        groups.set(key, { title: deal.title, count: 1, stages: [] });
      } else {
        existing.count += 1;
      }
    }
    const stageById = new Map(columns.map((column) => [column.stageId, column.stageName]));
    const result: DuplicateGroup[] = [];
    for (const group of groups.values()) {
      if (group.count < 2) continue;
      group.stages = columns
        .filter((column) => column.deals.some((deal) => normalizeTitle(deal.title) === normalizeTitle(group.title)))
        .map((column) => stageById.get(column.stageId) ?? "")
        .filter((name, index, array) => name !== "" && array.indexOf(name) === index);
      result.push(group);
    }
    return result;
  }, [columns]);

  const handleExport = useCallback(() => {
    const header = ["Название", "Этап", "Бюджет", "Валюта", "Создана"];
    const stageOfDeal = (deal: (typeof filteredDeals)[number]): string =>
      columns.find((column) => column.stageId === deal.stageId)?.stageName ?? "";
    const lines = [
      header.map(csvEscape).join(";"),
      ...sortedDeals.map((deal) =>
        [
          csvEscape(deal.title),
          csvEscape(stageOfDeal(deal)),
          String(deal.budget),
          deal.currency,
          new Intl.DateTimeFormat("ru-RU").format(new Date(deal.createdAt)),
        ].join(";"),
      ),
    ];
    const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `deals-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [columns, sortedDeals]);

  // -------------------------------------------------------------------------
  // Редактор стадий («НАСТРОИТЬ»)
  // -------------------------------------------------------------------------

  const createStage = useCreateStage(pipelineId ?? "");
  const updateStage = useUpdateStage(pipelineId ?? "");
  const deleteStage = useDeleteStage(pipelineId ?? "");
  const stageOpsPending = createStage.isPending || updateStage.isPending || deleteStage.isPending;

  const handleConfigureToggle = useCallback(() => {
    setConfigureMode((prev) => {
      if (!prev) setView("kanban");
      return !prev;
    });
  }, []);

  const stageOps: KanbanStageOps | undefined = configureMode && pipelineId !== null
    ? {
        onCreateStage: (name) => {
          createStage.mutate({ name }, { onError: (error) => toast.error(error.message) });
        },
        onUpdateStage: (stageId, patch) => {
          updateStage.mutate({ stageId, ...patch }, { onError: (error) => toast.error(error.message) });
        },
        onDeleteStage: (stageId) => {
          deleteStage.mutate({ stageId }, { onError: (error) => toast.error(error.message) });
        },
        onMoveStageOrder: (index, direction) => {
          const targetIndex = index + direction;
          const left = columns[index];
          const right = columns[targetIndex];
          if (left === undefined || right === undefined || stageOpsPending) return;

          // Обмен значениями sort_order двумя запросами; порядок ответов не
          // важен — итоговое состояние канбана приходит через invalidate.
          Promise.all([
            updateStage.mutateAsync({ stageId: left.stageId, sort_order: right.sortOrder }),
            updateStage.mutateAsync({ stageId: right.stageId, sort_order: left.sortOrder }),
          ]).catch((error: unknown) => {
            toast.error(error instanceof Error ? error.message : "Не удалось переставить этапы");
          });
        },
        pending: stageOpsPending,
      }
    : undefined;

  const handleCreate = useCallback(async (payload: CreateDealPayload) => {
    await createDeal.mutateAsync(payload);
    toast.success(`Сделка «${payload.title}» создана`);
  }, [createDeal]);

  const handleOpenDeal = useCallback((id: string) => {
    openDrawerDeal(id);
  }, [openDrawerDeal]);

  const handleCloseDrawer = useCallback(() => {
    closeDrawerDeal();
  }, [closeDrawerDeal]);

  if (pipelines.isLoading) return <SkeletonTable rows={4} columns={3} />;
  if (pipelines.isError) return (
    <div role="alert" className="flex gap-3 rounded-[8px] border border-rose-200 bg-rose-50 p-6">
      <Handshake className="h-5 w-5 text-rose-600" />
      <div>
        <p className="text-sm font-semibold text-rose-700">Не удалось загрузить воронки</p>
        <button type="button" onClick={() => void pipelines.refetch()} className="mt-2 text-xs font-medium text-rose-600 hover:text-rose-800">
          Повторить
        </button>
      </div>
    </div>
  );
  if ((pipelines.data ?? []).length === 0) return <EmptyState icon={Handshake} title="Воронки не настроены" description="Не удалось создать воронку по умолчанию. Обратитесь в поддержку, если проблема повторяется." />;

  return (
    <div className="space-y-3">
      <DealsToolbar
        pipelines={pipelines.data ?? []}
        pipelineId={pipelineId ?? ""}
        onPipelineChange={(id) => { setPipelineId(id); setConfigureMode(false); }}
        view={view}
        onViewChange={setView}
        search={search}
        onSearchChange={setSearch}
        searchInputRef={searchInputRef}
        summaryCount={summary.count}
        summarySum={summary.sum}
        sortBy={sortBy}
        onSortChange={setSortBy}
        autoRefresh={autoRefresh}
        onAutoRefreshChange={setAutoRefresh}
        appearance={appearance}
        onAppearanceChange={updateAppearance}
        bulkEnabled={bulkEnabled}
        onBulkToggle={() => setBulkEnabled((prev) => !prev)}
        configureMode={configureMode}
        onConfigureToggle={handleConfigureToggle}
        onExport={handleExport}
        duplicates={duplicates}
        onCreateDeal={() => setCreateOpen(true)}
      />

      {/* Сохранённые срезы (Saved Views) в стиле Twenty CRM — строго single-line touch скролл */}
      <div className="relative w-full min-w-0">
        <div
          role="tablist"
          aria-label="Срезы сделок"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar scroll-smooth touch-pan-x overscroll-x-contain py-1 -my-1 text-xs select-none pr-6 md:pr-0 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
        >
          <span className="shrink-0 whitespace-nowrap text-[#888888] text-[11px] font-medium mr-1 uppercase tracking-wider select-none">
            Срез:
          </span>
          {(
            [
              { id: "all", label: "Все сделки", count: presetCounts.all },
              { id: "active", label: "В работе", count: presetCounts.active },
              { id: "high_value", label: "Крупные (> 100к)", count: presetCounts.high_value },
              { id: "won", label: "Успешные", count: presetCounts.won },
            ] as const
          ).map((tab) => {
            const active = presetView === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setPresetView(tab.id)}
                className={cn(
                  "shrink-0 whitespace-nowrap inline-flex items-center gap-1.5 h-8 min-h-[32px] rounded-[6px] px-3 text-xs font-medium transition-colors cursor-pointer select-none border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#4a38f5]",
                  active
                    ? "bg-white border-[#e5e5e5] text-[#111111] shadow-2xs font-semibold"
                    : "bg-transparent border-transparent text-[#666666] hover:bg-black/[0.04] hover:text-[#111111]",
                )}
              >
                <span className="shrink-0 whitespace-nowrap">{tab.label}</span>
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-mono tabular-nums leading-none transition-colors",
                    active
                      ? "bg-[#f5f5f5] text-[#111111] font-semibold"
                      : "bg-black/[0.04] text-[#888888]",
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
        {/* Градиентное затухание справа на мобильных экранах как визуальный хинт о наличии скролла */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white to-transparent md:hidden"
        />
      </div>

      {configureMode && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-800">
          Режим редактирования: переименуйте этап (Enter — сохранить), смените цвет, переставьте стрелками или удалите пустой этап; последний блок добавляет новый.
        </p>
      )}

      {kanban.isLoading ? <SkeletonTable rows={5} columns={6} /> : kanban.isError ? <DealKanbanError message={kanban.error.message} onRetry={() => void kanban.refetch()} /> :
        view === "kanban" ? (
          <DealKanban
            pipelineId={pipelineId ?? ""}
            columns={filteredColumns}
            usersById={usersById}
            onOpenDeal={configureMode ? undefined : handleOpenDeal}
            configure={configureMode}
            stageOps={stageOps}
            cardOptions={appearance}
          />
        ) : view === "calendar" ? (
          <DealsCalendarView
            deals={sortedDeals}
            stagesById={stagesById}
            usersById={usersById}
            onOpenDeal={configureMode ? undefined : handleOpenDeal}
          />
        ) : (
          <DealListView
            deals={sortedDeals}
            columns={kanban.data ?? []}
            pipelineId={pipelineId ?? ""}
            usersById={usersById}
            onOpenDeal={configureMode ? undefined : handleOpenDeal}
            bulkEnabled={bulkEnabled && !configureMode}
          />
        )}

      <CreateDealModal open={createOpen} onClose={() => setCreateOpen(false)} onSubmit={handleCreate} defaultPipelineId={pipelineId ?? undefined} />

      <DealDrawer
        dealId={drawerDealId}
        open={drawerDealId !== null}
        onClose={handleCloseDrawer}
        usersById={usersById}
        pipelines={pipelines.data ?? []}
        stagesById={stagesById}
      />
    </div>
  );
}

export default function DealsPage() {
  return (
    <Guard requiredPermission="deals:read" fallback={<EmptyState icon={Handshake} title="Нет доступа к сделкам" description="Запросите право deals:read у администратора." />}>
      <Suspense fallback={<SkeletonTable rows={4} columns={3} />}>
        <DealsContent />
      </Suspense>
    </Guard>
  );
}
