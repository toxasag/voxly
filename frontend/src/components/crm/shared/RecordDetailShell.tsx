"use client";

import { useState, type ReactNode } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useHorizontalResize } from "@/lib/utils/use-horizontal-resize";
import {
  MAX_SIDE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  useSidePanelWidth,
} from "@/lib/utils/use-side-panel-width";

// ---------------------------------------------------------------------------
// Оболочка карточки записи по образцу record page в Twenty.
//
// Их структура (`PageLayoutTabsRenderer`): слева закреплённая вкладка Home с
// summary-карточкой и полями, справа — остальные вкладки. В боковой панели
// (`isInSidePanel`) закреплённой колонки нет и все вкладки уходят в общий
// список — здесь именно этот режим, поэтому вкладки идут одной полосой.
//
// Состав вкладок взят из их шаблонов `standard-page-layout-tabs.template.ts`
// (Home 10, Timeline 20, Tasks 30, Notes 40, Files 50). Вкладка не рисуется,
// если для неё нет содержимого: у Twenty это делает `getTabsWithVisibleWidgets`
// — вкладка без виджетов скрывается, а не показывает пустой экран.
// ---------------------------------------------------------------------------

export interface RecordDetailTab {
  id: string;
  label: string;
  content: ReactNode;
}

interface RecordDetailShellProps {
  /** Имя записи — заголовок и источник цвета аватара. */
  name: string;
  subtitle?: string;
  createdAt: string;
  tabs: readonly RecordDetailTab[];
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  /** Кнопки действий рядом с «Все поля» — у Twenty это командное меню записи. */
  headerActions?: ReactNode;
  ariaLabel: string;
}

export function RecordDetailShell({
  name,
  subtitle,
  createdAt,
  tabs,
  onClose,
  onEdit,
  onDelete,
  isDeleting = false,
  headerActions,
  ariaLabel,
}: RecordDetailShellProps) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? "");
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const stored = useSidePanelWidth();
  const { width, startResize } = useHorizontalResize({
    value: stored.width,
    min: MIN_SIDE_PANEL_WIDTH,
    max: MAX_SIDE_PANEL_WIDTH,
    onCommit: stored.setWidth,
    invert: true,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end bg-slate-950/60"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      {/*
        Ширина 500px — их theme.sidePanelWidth, но только с `md:`: на 360px экране
        ограничение ничего не даёт, а рамка слева выглядит как обрезанное окно. На
        телефоне карточка занимает весь экран.
      */}
      <div
        className="relative flex h-full w-full flex-col bg-slate-900 shadow-2xl md:w-[var(--side-panel-width)] md:border-l md:border-slate-800"
        style={{ ["--side-panel-width" as string]: `${width}px` }}
      >
        <button
          type="button"
          aria-label="Изменить ширину панели"
          onPointerDown={startResize}
          className="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize hover:bg-black/20 md:block"
        />
        {/* Summary card: аватар, имя, «добавлено N назад» — их ShowPageSummaryCard. */}
        <div className="flex items-start justify-between gap-3 border-b border-[#e5e5e5] px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <EntityChip name={name} size="md" />
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-100">{name}</h2>
              <p className="truncate text-xs text-slate-500">
                {subtitle !== undefined && subtitle !== "" ? `${subtitle} · ` : ""}
                Добавлено {timeAgo(createdAt)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {headerActions}
            {onEdit !== undefined && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
              >
                Все поля
              </button>
            )}
            {onDelete !== undefined && (
              <button
                type="button"
                onClick={onDelete}
                disabled={isDeleting}
                aria-label="Удалить запись"
                className="rounded-lg border border-rose-500/30 p-1.5 text-rose-400 transition-colors hover:bg-rose-500/10 disabled:opacity-50"
              >
                {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            )}
            {/*
              Область нажатия 44×44px на мобильном — минимум для касания; с `md:`
              возвращается компактный размер, там курсор точнее пальца. Это
              единственный способ закрыть карточку на телефоне: клик по фону
              недоступен, потому что фона не видно.
            */}
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть панель"
              className="flex h-11 w-11 items-center justify-center rounded-[8px] text-[#666666] transition-colors hover:bg-black/[0.04] hover:text-[#000000] md:h-8 md:w-8"
            >
              <X className="h-5 w-5 md:h-4 md:w-4" />
            </button>
          </div>
        </div>

        {/* Полоса вкладок: высота 40px — их TabListHeight. */}
        {tabs.length > 1 && (
          <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-[#e5e5e5] px-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "shrink-0 border-b-2 px-2 py-2 text-xs font-medium transition-colors",
                  tab.id === active?.id
                    ? "border-[#000000] text-[#000000]"
                    : "border-transparent text-[#666666] hover:text-[#000000]",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">{active?.content}</div>
      </div>
    </div>
  );
}
