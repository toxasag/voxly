"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, GripVertical, Lock, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { DealCard, type DealCardOptions } from "@/components/crm/deals/DealCard";
import { TagPill } from "@/components/ui/tag";
import { STAGE_COLOR_KEYS, STAGE_COLORS, stageColor, stageTagColor } from "@/components/crm/deals/stage-colors";
import { useKanbanColumnWidth } from "@/components/crm/deals/use-kanban-column-width";
import { useCreateDeal, useMoveDealStage, type KanbanColumnDTO, type StageColorKey } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { useHorizontalResize } from "@/lib/utils/use-horizontal-resize";
import { useIsMobile } from "@/lib/utils/use-is-mobile";
import { cn } from "@/lib/utils";

export interface KanbanStageOps {
  onCreateStage: (name: string) => void;
  onUpdateStage: (stageId: string, patch: { name?: string; color?: StageColorKey; sort_order?: number }) => void;
  onDeleteStage: (stageId: string) => void;
  /** Обмен местами с соседней колонкой — двумя PATCH sort_order. */
  onMoveStageOrder: (index: number, direction: -1 | 1) => void;
  pending: boolean;
}

interface Props {
  pipelineId: string;
  columns: KanbanColumnDTO[];
  usersById: Map<string, TenantUserDTO>;
  onOpenDeal?: (id: string) => void;
  configure?: boolean;
  stageOps?: KanbanStageOps;
  cardOptions?: DealCardOptions;
}

/**
 * Заголовок колонки в режиме редактирования: переименование по Enter/блюру,
 * палитра из пресетов, стрелки перестановки и удаление пустой пользовательской
 * стадии (успех/провал и непустые бэкенд отклоняет — текст ошибки придёт в toast).
 */
function StageHeaderEditor({
  column,
  index,
  ops,
  canMoveLeft,
  canMoveRight,
}: {
  column: KanbanColumnDTO;
  index: number;
  ops: KanbanStageOps;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}) {
  const [name, setName] = useState(column.stageName);

  useEffect(() => setName(column.stageName), [column.stageName]);

  const dirty = name.trim().length > 0 && name !== column.stageName;

  // Системный этап не правится: вход в воронку и закрывающие этапы держат
  // семантику (куда попадает новая сделка, что считать закрытым) и обязаны
  // стоять первым, предпоследним и последним. Показываем то же, что в обычном
  // режиме, плюс подпись «системный» — иначе пустая строка ввода выглядела бы
  // как поломка.
  if (column.isSystem) {
    return (
      <div className="flex h-9 items-center gap-2 px-1 mb-2">
        <Lock className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider",
            column.isWon ? "text-emerald-700" : column.isLost ? "text-rose-700" : "text-[#111111]",
          )}
        >
          {column.stageName}
        </span>
        <span className="shrink-0 text-xs text-[#888888]">системный</span>
      </div>
    );
  }

  return (
    <div className="flex h-auto flex-col justify-center gap-2 border border-[#e5e5e5] bg-white rounded-[8px] p-2.5 mb-2">
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && dirty) ops.onUpdateStage(column.stageId, { name: name.trim() });
            if (event.key === "Escape") setName(column.stageName);
          }}
          onBlur={() => { if (dirty) ops.onUpdateStage(column.stageId, { name: name.trim() }); }}
          className="min-w-0 flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-medium text-[#000000] focus:border-[#888888] focus:outline-none"
        />
        {/* Границы движения — соседи-системные этапы: влево нельзя встать перед
            входом в воронку, вправо — за «успех» и «провал». */}
        <button
          type="button"
          onClick={() => ops.onMoveStageOrder(index, -1)}
          disabled={ops.pending || !canMoveLeft}
          title="Сдвинуть влево"
          className="shrink-0 rounded border border-[#e5e5e5] bg-white px-1.5 py-1 text-xs text-[#666666] hover:bg-[#fafafa] hover:text-[#000000] disabled:opacity-40"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => ops.onMoveStageOrder(index, 1)}
          disabled={ops.pending || !canMoveRight}
          title="Сдвинуть вправо"
          className="shrink-0 rounded border border-[#e5e5e5] bg-white px-1.5 py-1 text-xs text-[#666666] hover:bg-[#fafafa] hover:text-[#000000] disabled:opacity-40"
        >
          →
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {STAGE_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              title={STAGE_COLORS[key].label}
              onClick={() => ops.onUpdateStage(column.stageId, { color: key })}
              className={cn(
                "flex h-4 w-4 items-center justify-center rounded-full",
                STAGE_COLORS[key].swatch,
                column.stageColor === key && "ring-2 ring-slate-400 ring-offset-1 ring-offset-white",
              )}
            >
              {column.stageColor === key && <Check className="h-2.5 w-2.5 text-white" />}
            </button>
          ))}
        </div>
        {!column.isWon && !column.isLost && (
          <button
            type="button"
            title="Удалить стадию"
            onClick={() => ops.onDeleteStage(column.stageId)}
            disabled={ops.pending}
            className="ml-auto rounded p-1 text-[#888888] transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function DealKanban({
  pipelineId,
  columns,
  usersById,
  onOpenDeal,
  configure = false,
  stageOps,
  cardOptions,
}: Props) {
  const [over, setOver] = useState<string | null>(null);
  const move = useMoveDealStage();
  const ordered = [...columns].sort((a, b) => a.sortOrder - b.sortOrder);
  const [newStageName, setNewStageName] = useState("");
  const { width: defaultWidth, columnWidths, setColumnWidth } = useKanbanColumnWidth();
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const resizeRef = useRef<{ stageId: string; startX: number; startWidth: number } | null>(null);

  const createDeal = useCreateDeal();
  const [inlineStageId, setInlineStageId] = useState<string | null>(null);
  const [inlineTitle, setInlineTitle] = useState("");
  const [inlineBudget, setInlineBudget] = useState("");

  const handleInlineSubmit = useCallback((stageId: string) => {
    const trimmed = inlineTitle.trim();
    if (!trimmed) {
      setInlineStageId(null);
      return;
    }
    const numBudget = Number(inlineBudget.replace(/\D/g, "")) || 0;
    createDeal.mutate(
      {
        title: trimmed,
        budget: numBudget,
        currency: "RUB",
        pipeline_id: pipelineId,
        stage_id: stageId,
      },
      {
        onSuccess: (deal) => {
          toast.success(`Сделка «${deal.title}» создана`);
          setInlineTitle("");
          setInlineBudget("");
          setInlineStageId(null);
        },
        onError: (err) => {
          toast.error(err.message || "Не удалось создать сделку");
        },
      },
    );
  }, [inlineTitle, inlineBudget, createDeal, pipelineId]);

  const startColumnResize = useCallback((event: React.PointerEvent, stageId: string, currentWidth: number) => {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = { stageId, startX: event.clientX, startWidth: currentWidth };

    const onMove = (moveEvent: PointerEvent): void => {
      const state = resizeRef.current;
      if (!state) return;
      const next = Math.min(480, Math.max(200, Math.round(state.startWidth + (moveEvent.clientX - state.startX))));
      setLiveWidths((prev) => ({ ...prev, [state.stageId]: next }));
    };

    const onUp = (upEvent: PointerEvent): void => {
      const state = resizeRef.current;
      resizeRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!state) return;
      const finalWidth = Math.min(480, Math.max(200, Math.round(state.startWidth + (upEvent.clientX - state.startX))));
      setColumnWidth(state.stageId, finalWidth);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [setColumnWidth]);

  const isMobile = useIsMobile();

  const doMove = useCallback((id: string, direction: -1 | 1) => {
    const col = ordered.find((c) => c.deals.some((d) => d.id === id));
    if (!col) return;
    const index = ordered.findIndex((c) => c.stageId === col.stageId);
    const target = ordered[index + direction];
    if (!target) return;
    move.mutate({ id, stageId: target.stageId, pipelineId }, { onError: (error) => toast.error(error.message) });
  }, [ordered, move, pipelineId]);

  const drop = useCallback((event: React.DragEvent<HTMLDivElement>, target: KanbanColumnDTO) => {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/plain");
    if (!id) return;
    const source = ordered.find((c) => c.deals.some((d) => d.id === id));
    if (!source || source.stageId === target.stageId) return;
    move.mutate({ id, stageId: target.stageId, pipelineId }, { onError: (error) => toast.error(error.message) });
  }, [ordered, move, pipelineId]);

  // Один горизонтальный ряд фиксированной ширины, как RecordBoard у Twenty:
  // непрерывные свимлейны от края до края с вертикальными разделителями.
  return (
    <div className="-mx-4 md:-mx-5 flex min-h-[calc(100vh-170px)] items-stretch overflow-x-auto border-t border-[#e5e5e5] bg-white">
      {ordered.map((col, index) => {
        const colWidth = liveWidths[col.stageId] ?? columnWidths[col.stageId] ?? defaultWidth;
        return (
          <div
            key={col.stageId}
            data-kanban-column=""
            onDragOver={configure ? undefined : (event) => { event.preventDefault(); setOver(col.stageId); }}
            onDragLeave={() => setOver(null)}
            onDrop={configure ? undefined : (event) => drop(event, col)}
            className={cn(
              "relative flex shrink-0 flex-col border-r border-[#e5e5e5] bg-white transition-colors",
              over === col.stageId && "bg-[#f8fafc]",
            )}
            style={{ width: colWidth }}
          >
            {configure && stageOps ? (
              <div className="p-2 border-b border-[#f0f0f0]">
                <StageHeaderEditor
                  column={col}
                  index={index}
                  ops={stageOps}
                  canMoveLeft={ordered[index - 1]?.isSystem === false}
                  canMoveRight={ordered[index + 1]?.isSystem === false}
                />
              </div>
            ) : (
              <div className="flex h-10 items-center justify-between px-3 py-2 border-b border-[#f0f0f0]">
                <div className="flex items-center gap-2 min-w-0">
                  <TagPill color={col.isWon ? "emerald" : col.isLost ? "rose" : stageTagColor(col.stageColor)}>
                    {col.stageName}
                  </TagPill>
                  <span className="text-xs text-[#666666] font-normal tabular-nums shrink-0">
                    {col.deals.length > 0 && col.budgetTotal
                      ? new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(col.budgetTotal)
                      : col.dealCount}
                  </span>
                </div>
              </div>
            )}
            <div className="flex-1 space-y-2 p-2 overflow-y-auto">
              {col.deals.map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  stageName={col.stageName}
                  stageColorKey={configure ? undefined : col.stageColor}
                  isWon={col.isWon}
                  isLost={col.isLost}
                  manager={usersById.get(deal.createdBy)}
                  onMove={doMove}
                  canMoveLeft={index > 0}
                  canMoveRight={index < ordered.length - 1}
                  onOpen={onOpenDeal}
                  options={cardOptions}
                />
              ))}
              {col.deals.length === 0 && over === col.stageId && (
                <div className="py-8 text-center text-xs text-[#888888]">
                  Отпустите здесь
                </div>
              )}
            </div>
            {!configure && (
              <div className="p-2 pt-0">
                {inlineStageId === col.stageId ? (
                  <div className="rounded-[8px] border border-[#4a38f5] bg-white p-2.5 shadow-2xs space-y-2">
                    <input
                      autoFocus
                      value={inlineTitle}
                      onChange={(e) => setInlineTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleInlineSubmit(col.stageId);
                        } else if (e.key === "Escape") {
                          setInlineStageId(null);
                          setInlineTitle("");
                          setInlineBudget("");
                        }
                      }}
                      placeholder="Название сделки (Enter)..."
                      className="w-full rounded-[4px] border border-[#e5e5e5] px-2 py-1 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                    />
                    <div className="flex items-center gap-1.5">
                      <input
                        value={inlineBudget}
                        onChange={(e) => setInlineBudget(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleInlineSubmit(col.stageId);
                          } else if (e.key === "Escape") {
                            setInlineStageId(null);
                          }
                        }}
                        placeholder="Бюджет ₽"
                        className="w-24 rounded-[4px] border border-[#e5e5e5] px-2 py-1 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                      />
                      <div className="flex-1 flex justify-end items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setInlineStageId(null);
                            setInlineTitle("");
                            setInlineBudget("");
                          }}
                          className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
                          title="Отмена"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={createDeal.isPending || !inlineTitle.trim()}
                          onClick={() => handleInlineSubmit(col.stageId)}
                          className="rounded-[6px] bg-[#4a38f5] px-2 py-1 text-xs font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50 transition-colors"
                        >
                          {createDeal.isPending ? "..." : "Добавить"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setInlineStageId(col.stageId);
                      setInlineTitle("");
                      setInlineBudget("");
                    }}
                    className="flex items-center gap-1.5 text-xs text-[#888888] hover:text-[#111111] py-1.5 px-2 rounded-[6px] hover:bg-black/[0.04] transition-colors w-full font-medium cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Быстрая сделка</span>
                  </button>
                )}
              </div>
            )}
            {move.isPending && !configure && (
              <div className="flex items-center gap-1 border-t border-[#e5e5e5] px-3 py-2 text-xs text-[#888888]"><RefreshCw className="h-3 w-3 animate-spin" />Сохранение…</div>
            )}
            {!isMobile && (
              <button
                type="button"
                aria-label="Изменить ширину колонки"
                onPointerDown={(event) => startColumnResize(event, col.stageId, colWidth)}
                className="absolute inset-y-0 -right-1 z-20 hidden w-2 cursor-col-resize hover:bg-[#3b82f6]/40 transition-colors md:block"
              />
            )}
          </div>
        );
      })}

      {configure && stageOps && (
        <div
          className="flex shrink-0 flex-col justify-center rounded-xl border border-dashed border-[#e5e5e5] bg-white p-3"
          style={{ width: defaultWidth }}
        >
          {newStageName === "" ? (
            <button
              type="button"
              onClick={() => setNewStageName("Новый этап")}
              className="flex items-center justify-center gap-2 rounded-lg py-6 text-sm font-medium text-[#666666] transition-colors hover:bg-[#fafafa] hover:text-[#000000]"
            >
              <Plus className="h-4 w-4" />Добавить этап
            </button>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const trimmed = newStageName.trim();
                if (trimmed.length === 0) return;
                stageOps.onCreateStage(trimmed);
                setNewStageName("");
              }}
              className="space-y-2"
            >
              <input
                autoFocus
                value={newStageName}
                onChange={(event) => setNewStageName(event.target.value)}
                placeholder="Название этапа"
                className="w-full rounded border border-[#e5e5e5] bg-white px-2 py-1.5 text-sm text-[#000000] focus:border-[#888888] focus:outline-none"
              />
              <div className="flex gap-1.5">
                <button type="submit" disabled={stageOps.pending} className="flex-1 rounded-md bg-[#111111] px-2 py-1.5 text-xs font-medium text-white hover:bg-[#222222] disabled:opacity-50">Создать</button>
                <button type="button" onClick={() => setNewStageName("")} className="rounded-md border border-[#e5e5e5] bg-white px-2 py-1.5 text-xs text-[#666666] hover:bg-[#fafafa]"><X className="h-3.5 w-3.5" /></button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

export function DealKanbanError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex gap-3 rounded-[8px] border border-rose-200 bg-rose-50 p-6">
      <AlertCircle className="h-5 w-5 text-rose-600" />
      <div>
        <p className="text-sm font-semibold text-rose-700">Не удалось загрузить воронку</p>
        <p className="mt-1 text-sm text-[#666666]">{message}</p>
        <button type="button" onClick={onRetry} className="mt-3 text-xs font-medium text-rose-600 hover:text-rose-800">
          Повторить
        </button>
      </div>
    </div>
  );
}
