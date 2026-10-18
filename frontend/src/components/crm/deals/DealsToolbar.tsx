"use client";

import { useState, type RefObject } from "react";
import {
  Check,
  CheckSquare,
  ChevronDown,
  Columns3,
  CopyCheck,
  Download,
  List as ListIcon,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { PipelineDTO } from "@/lib/api/use-deals";
import {
  DropdownMenu,
  MenuCheckboxItem,
  MenuItem,
  MenuLabel,
  MenuSeparator,
} from "@/components/ui/dropdown-menu";
import type { DealCardOptions } from "@/components/crm/deals/DealCard";
import { DEAL_CARD_FIELDS } from "@/components/crm/deals/deal-card-fields";
import { cn } from "@/lib/utils";

export type DealSortKey = "last_message" | "last_event" | "created" | "title" | "budget";

export interface DuplicateGroup {
  title: string;
  count: number;
  stages: string[];
}

interface Props {
  pipelines: PipelineDTO[];
  pipelineId: string;
  onPipelineChange: (id: string) => void;

  view: "kanban" | "table";
  onViewChange: (view: "kanban" | "table") => void;

  search: string;
  onSearchChange: (value: string) => void;
  /** Реф на поле поиска: ⌘K страницы фокусирует его вместо палитры команд. */
  searchInputRef: RefObject<HTMLInputElement | null>;

  summaryCount: number;
  summarySum: number;

  sortBy: DealSortKey;
  onSortChange: (key: DealSortKey) => void;

  autoRefresh: boolean;
  onAutoRefreshChange: (enabled: boolean) => void;

  appearance: DealCardOptions;
  onAppearanceChange: (options: DealCardOptions) => void;

  bulkEnabled: boolean;
  onBulkToggle: () => void;

  configureMode: boolean;
  onConfigureToggle: () => void;

  onExport: () => void;
  duplicates: DuplicateGroup[];
  onCreateDeal: () => void;
}

const SORT_OPTIONS: { key: DealSortKey; label: string }[] = [
  { key: "last_message", label: "По последнему сообщению" },
  { key: "last_event", label: "По последнему событию" },
  { key: "created", label: "По дате создания" },
  { key: "title", label: "По названию" },
  { key: "budget", label: "По бюджету" },
];

function dealPlural(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "сделка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сделки";
  return "сделок";
}

const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

/**
 * Верхняя строка управления воронкой. Все данные приходят готовыми от страницы:
 * тулбар не знает про TanStack Query и только вызывает колбэки.
 */
export function DealsToolbar(props: Props) {
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const currentPipeline = props.pipelines.find((pipeline) => pipeline.id === props.pipelineId);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/*
        Левая / центральная группа.

        На мобильном в ряду остаются только поиск и переключатель вида: в этом ряду
        восемь контролов (воронка, вид, поиск, сводка, «⋯», «НАСТРОИТЬ», «НОВАЯ
        СДЕЛКА»), и на 360px они переносятся в четыре строки, вытесняя саму доску за
        пределы экрана. Воронка, сводка и «НАСТРОИТЬ» уходят в меню «⋯» — оно и так
        есть, отдельной кнопки «Ещё» не требуется.
      */}
      <div className="relative hidden md:block">
        <select
          value={props.pipelineId}
          onChange={(event) => props.onPipelineChange(event.target.value)}
          className="h-8 appearance-none rounded-md border border-[#e5e5e5] bg-white pl-2.5 pr-7 text-[13px] font-medium text-[#000000] hover:bg-[#fafafa] focus:border-[#888888] focus:outline-none cursor-pointer"
        >
          {props.pipelines.map((pipeline) => (
            <option key={pipeline.id} value={pipeline.id}>{pipeline.name}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
      </div>

      <div className="flex overflow-hidden rounded-md border border-[#e5e5e5] bg-[#ffffff]">
        <button
          type="button"
          title="Канбан"
          onClick={() => props.onViewChange("kanban")}
          className={cn("flex h-8 w-9 items-center justify-center transition-colors", props.view === "kanban" ? "bg-black/[0.07] text-[#000000]" : "text-[#666666] hover:bg-black/[0.03] hover:text-[#000000]")}
        >
          <Columns3 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Список"
          onClick={() => props.onViewChange("table")}
          className={cn("flex h-8 w-9 items-center justify-center border-l border-[#e5e5e5] transition-colors", props.view === "table" ? "bg-black/[0.07] text-[#000000]" : "text-[#666666] hover:bg-black/[0.03] hover:text-[#000000]")}
        >
          <ListIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* `order-first` на мобильном: поиск — главный контрол страницы, и он должен
          быть первым, а не после переключателя вида. `min-w-[220px]` снят до `md:`:
          на 360px он вместе с переключателем не оставлял места. */}
      <div className="relative order-first w-full flex-1 md:order-none md:min-w-[220px] md:max-w-md">
        <input
          ref={props.searchInputRef}
          value={props.search}
          onChange={(event) => props.onSearchChange(event.target.value)}
          placeholder="Поиск и фильтр"
          className="h-8 w-full rounded-md border border-[#e5e5e5] bg-white pl-3 pr-12 text-[13px] text-[#000000] placeholder:text-[#888888] focus:border-[#888888] focus:outline-none"
        />
        {props.search !== "" ? (
          <button
            type="button"
            onClick={() => props.onSearchChange("")}
            aria-label="Очистить поиск"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#888888] hover:text-[#000000]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded bg-[#f4f4f5] border border-[#e5e5e5] px-1 py-0.5 text-[10px] text-[#888888]">⌘K</kbd>
        )}
      </div>

      {/* Правая группа */}
      <div className="ml-auto flex flex-wrap items-center gap-2.5">
        {/* Сводка «N сделок: сумма» на мобильном уходит в меню «⋯»: она отвечает на
            вопрос «сколько денег в воронке» и должна остаться доступной, но в ряду
            занимает половину ширины экрана. */}
        <div className="hidden rounded-md border border-slate-800 bg-[#fafafa] px-2.5 py-1 text-xs whitespace-nowrap md:block">
          <span className="font-medium text-[#111111]">{props.summaryCount}</span>
          <span className="text-[#666666]"> {dealPlural(props.summaryCount)}: </span>
          <span className="font-medium text-[#111111]">{money.format(props.summarySum)}</span>
        </div>

        <DropdownMenu
          trigger={
            <button type="button" aria-label="Дополнительные действия" className="flex h-8 w-8 items-center justify-center rounded-md border border-[#e5e5e5] bg-white text-[#666666] transition-colors hover:bg-[#fafafa] hover:text-[#000000]">
              ⋯
            </button>
          }
        >
          {/*
            Воронка и сводка на мобильном скрыты из ряда, поэтому появляются здесь —
            иначе выбор воронки и ответ на вопрос «сколько денег в воронке» стали бы
            недоступны на телефоне. С `md:` блок скрыт: там они есть в ряду, и
            дублировать их в меню значило бы предлагать два пути к одному.
          */}
          <div className="md:hidden">
            <MenuLabel>Воронка</MenuLabel>
            {props.pipelines.map((pipeline) => (
              <MenuItem
                key={pipeline.id}
                label={pipeline.name}
                onSelect={() => props.onPipelineChange(pipeline.id)}
                activeArrow={props.pipelineId === pipeline.id}
              />
            ))}

            <MenuSeparator />

            <div className="px-3.5 py-2 text-sm">
              <span className="font-semibold text-slate-200">{props.summaryCount}</span>
              <span className="text-slate-500"> {dealPlural(props.summaryCount)}: </span>
              <span className="font-semibold text-amber-400">{money.format(props.summarySum)}</span>
            </div>

            <MenuSeparator />
          </div>

          <MenuItem icon={Download} label="Экспорт" hint="CSV" onSelect={props.onExport} />

          {/* Подблок внешнего вида раскрывается внутри меню и не закрывает его */}
          <div>
            <button
              type="button"
              role="menuitem"
              onClick={(event) => { event.stopPropagation(); setAppearanceOpen((prev) => !prev); }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="flex-1 truncate">Внешний вид карточки</span>
              <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform", appearanceOpen && "rotate-180")} />
            </button>
            {appearanceOpen && (
              <>
                {/* Все поля сделки, а не два из них: состав карточки настраивается
                    так же, как набор колонок в списке. */}
                {DEAL_CARD_FIELDS.map((field) => (
                  <MenuCheckboxItem
                    key={field.id}
                    label={field.label}
                    checked={props.appearance[field.id]}
                    onToggle={() =>
                      props.onAppearanceChange({
                        ...props.appearance,
                        [field.id]: !props.appearance[field.id],
                      })
                    }
                  />
                ))}
              </>
            )}
          </div>

          <MenuItem icon={CopyCheck} label="Поиск дублей" onSelect={() => setDuplicatesOpen(true)} />
          <MenuCheckboxItem icon={CheckSquare} label="Массовые действия" checked={props.bulkEnabled} onToggle={props.onBulkToggle} />

          <MenuSeparator />

          <MenuLabel>Сортировка</MenuLabel>
          {SORT_OPTIONS.map((option) => (
            <MenuItem key={option.key} label={option.label} onSelect={() => props.onSortChange(option.key)} activeArrow={props.sortBy === option.key} />
          ))}

          <MenuSeparator />

          <MenuCheckboxItem icon={RefreshCw} label="Автообновление" checked={props.autoRefresh} onToggle={() => props.onAutoRefreshChange(!props.autoRefresh)} />
        </DropdownMenu>

        {/* Режим настройки этапов на мобильном недоступен: он строится на
            перетаскивании и inline-правке названий в узких колонках доски. */}
        <button
          type="button"
          onClick={props.onConfigureToggle}
          className={cn(
            "hidden h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium tracking-normal transition-colors md:flex",
            props.configureMode
              ? "border-emerald-500/50 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "border-[#e5e5e5] bg-white text-[#111111] hover:bg-[#f7f7f7]",
          )}
        >
          {props.configureMode && <Check className="h-3.5 w-3.5" />}
          {props.configureMode ? "ГОТОВО" : "НАСТРОИТЬ"}
        </button>

        <button
          type="button"
          onClick={props.onCreateDeal}
          className="flex h-8 items-center gap-1.5 rounded-md bg-[#111111] px-3 text-xs font-medium text-white shadow-none transition-colors hover:bg-[#222222]"
        >
          <Plus className="h-3.5 w-3.5" />
          {/* Подпись только с md:: на мобильном она занимает треть ряда, а иконка
              «плюс» узнаваема сама. */}
          <span className="hidden md:inline">НОВАЯ СДЕЛКА</span>
        </button>
      </div>

      {duplicatesOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm" onClick={() => setDuplicatesOpen(false)}>
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="text-sm font-semibold text-slate-100">Возможные дубли</h2>
              <button type="button" onClick={() => setDuplicatesOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300"><X className="h-4 w-4" /></button>
            </div>
            <div className="max-h-80 space-y-2 overflow-y-auto px-6 py-4">
              {props.duplicates.length === 0 ? (
                <p className="py-6 text-center text-sm text-emerald-400">Дублей не найдено — все названия уникальны.</p>
              ) : (
                props.duplicates.map((group) => (
                  <div key={group.title} className="rounded-lg border border-yellow-400/30 bg-yellow-400/5 p-3">
                    <p className="truncate text-sm font-medium text-slate-100">{group.title}</p>
                    <p className="mt-1 text-xs text-slate-400">{group.count} сделки на этапах: {group.stages.join(", ")}</p>
                  </div>
                ))
              )}
            </div>
            <p className="border-t border-slate-800 px-6 py-3 text-xs text-slate-600">Поиск сравнивает нормализованные названия сделок текущей воронки.</p>
          </div>
        </div>
      )}
    </div>
  );
}
