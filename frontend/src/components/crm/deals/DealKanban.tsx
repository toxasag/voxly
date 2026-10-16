"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, GripVertical, Lock, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { DealCard, type DealCardOptions } from "@/components/crm/deals/DealCard";
import { STAGE_COLOR_KEYS, STAGE_COLORS, stageColor } from "@/components/crm/deals/stage-colors";
import { useKanbanColumnWidth } from "@/components/crm/deals/use-kanban-column-width";
import { useMoveDealStage, type KanbanColumnDTO, type StageColorKey } from "@/lib/api/use-deals";
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
      <div className="flex h-[68px] items-center gap-2 border-b border-slate-800 px-3">
        <Lock className="h-3.5 w-3.5 shrink-0 text-slate-600" />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider",
            column.isWon ? "text-emerald-400" : column.isLost ? "text-rose-400" : "text-amber-400",
          )}
        >
          {column.stageName}
        </span>
        <span className="shrink-0 text-xs text-slate-600">системный</span>
      </div>
    );
  }

  return (
    <div className="flex h-[68px] flex-col justify-center gap-2 border-b border-slate-800 px-3">
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && dirty) ops.onUpdateStage(column.stageId, { name: name.trim() });
            if (event.key === "Escape") setName(column.stageName);
          }}
          onBlur={() => { if (dirty) ops.onUpdateStage(column.stageId, { name: name.trim() }); }}
          className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs font-semibold text-slate-100 focus:border-amber-500 focus:outline-none"
        />
        {/* Границы движения — соседи-системные этапы: влево нельзя встать перед
            входом в воронку, вправо — за «успех» и «провал». */}
        <button
          type="button"
          onClick={() => ops.onMoveStageOrder(index, -1)}
          disabled={ops.pending || !canMoveLeft}
          title="Сдвинуть влево"
          className="shrink-0 rounded bg-slate-800 px-1.5 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => ops.onMoveStageOrder(index, 1)}
          disabled={ops.pending || !canMoveRight}
          title="Сдвинуть вправо"
          className="shrink-0 rounded bg-slate-800 px-1.5 py-1 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40"
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
                column.stageColor === key && "ring-2 ring-slate-300 ring-offset-1 ring-offset-slate-900",
              )}
            >
              {column.stageColor === key && <Check className="h-2.5 w-2.5 text-slate-950" />}
            </button>
          ))}
        </div>
        {!column.isWon && !column.isLost && (
          <button
            type="button"
            title="Удалить стадию"
            onClick={() => ops.onDeleteStage(column.stageId)}
            disabled={ops.pending}
            className="ml-auto rounded p-1 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-40"
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
  const { width: storedWidth, setWidth: commitWidth } = useKanbanColumnWidth();
  const { width, startResize } = useHorizontalResize({
    value: storedWidth,
    min: 200,
    max: 480,
    onCommit: commitWidth,
  });
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
  // `auto-fit` + `1fr` растягивал колонки и переносил лишние на второй ряд —
  // шесть этапов «ломались» на две линии, шапки не стояли в ряд.
  return (
    <div className="-mx-1 flex min-h-[60vh] items-start gap-3 overflow-x-auto px-1 pb-3">
      {ordered.map((col, index) => {
        const accent = stageColor(col.stageColor);
        return (
          <div
            key={col.stageId}
            data-kanban-column=""
            onDragOver={configure ? undefined : (event) => { event.preventDefault(); setOver(col.stageId); }}
            onDragLeave={() => setOver(null)}
            onDrop={configure ? undefined : (event) => drop(event, col)}
            className={cn(
              "relative flex shrink-0 flex-col rounded-xl border border-t-2 border-slate-800 bg-slate-900/50 transition-colors",
              accent.border,
              over === col.stageId && "border-amber-500 bg-amber-500/5",
            )}
            style={{ width }}
          >
            {configure && stageOps ? (
              <StageHeaderEditor
                column={col}
                index={index}
                ops={stageOps}
                canMoveLeft={ordered[index - 1]?.isSystem === false}
                canMoveRight={ordered[index + 1]?.isSystem === false}
              />
            ) : (
              // Фиксированная высота шапки и `shrink-0` у иконок: раньше высота
              // зависела от длины названия, а иконка сжималась — колонки стояли
              // на разной высоте, и заголовки «скакали».
              <div className="flex h-[68px] items-center gap-2 border-b border-slate-800 px-3">
                <GripVertical className="h-4 w-4 shrink-0 text-slate-600" />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wider leading-none",
                    col.isWon ? "text-emerald-400" : col.isLost ? "text-rose-400" : "text-slate-300",
                  )}
                >
                  {col.stageName}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-slate-600">{col.dealCount}</span>
              </div>
            )}
            <div className="flex-1 space-y-2 p-2">
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
              {col.deals.length === 0 && <p className="py-10 text-center text-xs text-slate-600">{over === col.stageId ? "Отпустите здесь" : "Нет сделок"}</p>}
            </div>
            {move.isPending && !configure && (
              <div className="flex items-center gap-1 border-t border-slate-800 px-3 py-2 text-xs text-slate-500"><RefreshCw className="h-3 w-3 animate-spin" />Сохранение…</div>
            )}
            {!isMobile && (
              <button
                type="button"
                aria-label="Изменить ширину колонки"
                onPointerDown={startResize}
                className="absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize hover:bg-amber-500/40 md:block"
              />
            )}
          </div>
        );
      })}

      {configure && stageOps && (
        <div
          className="flex shrink-0 flex-col justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-3"
          style={{ width }}
        >
          {newStageName === "" ? (
            <button
              type="button"
              onClick={() => setNewStageName("Новый этап")}
              className="flex items-center justify-center gap-2 rounded-lg py-6 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800/50 hover:text-amber-400"
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
                className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
              />
              <div className="flex gap-1.5">
                <button type="submit" disabled={stageOps.pending} className="flex-1 rounded-lg bg-amber-500 px-2 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50">Создать</button>
                <button type="button" onClick={() => setNewStageName("")} className="rounded-lg bg-slate-800 px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700"><X className="h-3.5 w-3.5" /></button>
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
    <div className="flex gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
      <AlertCircle className="h-5 w-5 text-rose-400" />
      <div><p className="text-sm font-semibold text-slate-200">Не удалось загрузить воронку</p><p className="mt-1 text-sm text-slate-400">{message}</p><button type="button" onClick={onRetry} className="mt-3 text-xs text-slate-300">Повторить</button></div>
    </div>
  );
}
