"use client";

import { useCallback, useMemo, useState } from "react";
import { Building2, Handshake, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import type { DealDTO, KanbanColumnDTO } from "@/lib/api/use-deals";
import { useDeleteDeal, useMoveDealStage, useUpdateDeal } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { TableEmptyState } from "@/components/crm/shared/CrmTable";
import { type RecordColumn } from "@/components/crm/shared/RecordTable";
import { SyncedRecordTable } from "@/components/crm/shared/SyncedRecordTable";
import { RecordCellShell, RecordCellEditor, RecordCellSelectEditor } from "@/components/crm/shared/RecordCell";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { TagPill } from "@/components/ui/tag";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
import { timeAgo } from "@/lib/utils";

interface DealListViewProps {
  deals: DealDTO[];
  columns: KanbanColumnDTO[];
  pipelineId: string;
  usersById: Map<string, TenantUserDTO>;
  onOpenDeal?: (id: string) => void;
  bulkEnabled: boolean;
}

const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

/** Какая ячейка какой строки сейчас в режиме правки. */
type EditTarget = { rowId: string; columnId: string } | null;

/**
 * Таблица сделок по образцу Opportunities в Twenty.
 *
 * Колонки повторяют их набор: название (чип, залипающая колонка), этап тэгом,
 * сумма справа, компания и контактное лицо чипами-связями, ответственный,
 * дата закрытия, создана. Название, сумма, этап и дата закрытия правятся
 * прямо в ячейке — двойной клик или Enter на сфокусированной ячейке.
 */
export function DealListView({ deals, columns, pipelineId, usersById, onOpenDeal, bulkEnabled }: DealListViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editing, setEditing] = useState<EditTarget>(null);

  const move = useMoveDealStage();
  const remove = useDeleteDeal();
  const update = useUpdateDeal();

  const orderedColumns = useMemo(() => [...columns].sort((a, b) => a.sortOrder - b.sortOrder), [columns]);
  const stageById = useMemo(() => new Map(orderedColumns.map((column) => [column.stageId, column])), [orderedColumns]);

  const stageOptions = useMemo(
    () => orderedColumns.map((column) => ({ value: column.stageId, label: column.stageName })),
    [orderedColumns],
  );

  const isEditing = useCallback(
    (rowId: string, columnId: string): boolean => editing?.rowId === rowId && editing.columnId === columnId,
    [editing],
  );

  const commit = useCallback(
    (deal: DealDTO, payload: Parameters<typeof update.mutate>[0]["payload"]) => {
      setEditing(null);
      update.mutate(
        { id: deal.id, pipelineId, payload },
        { onError: (error) => toast.error(error.message) },
      );
    },
    [update, pipelineId],
  );

  const tableColumns = useMemo<RecordColumn<DealDTO>[]>(() => [
    {
      id: "title",
      header: "Сделка",
      width: 260,
      sortValue: (deal) => deal.title,
      render: (deal) =>
        isEditing(deal.id, "title") ? (
          <RecordCellEditor
            value={deal.title}
            onCancel={() => setEditing(null)}
            onCommit={(value) => {
              const trimmed = value.trim();
              if (trimmed.length === 0) {
                toast.error("Название не может быть пустым");
                setEditing(null);
                return;
              }
              commit(deal, { title: trimmed });
            }}
          />
        ) : (
          <RecordCellShell
            editable
            isLabelIdentifier
            onStartEdit={() => setEditing({ rowId: deal.id, columnId: "title" })}
          >
            <EntityChip name={deal.title} />
            <span className="truncate font-medium text-slate-100">{deal.title}</span>
          </RecordCellShell>
        ),
    },
    {
      id: "stage",
      header: "Этап",
      width: 170,
      sortValue: (deal) => stageById.get(deal.stageId)?.sortOrder ?? 999,
      render: (deal) => {
        const stage = stageById.get(deal.stageId);
        return isEditing(deal.id, "stage") ? (
          <RecordCellSelectEditor
            value={deal.stageId}
            options={stageOptions}
            onCancel={() => setEditing(null)}
            onCommit={(stageId) => {
              setEditing(null);
              if (stageId === deal.stageId) return;
              // Смена этапа идёт через отдельный эндпоинт: он пишет историю
              // переходов и ставит closed_at на терминальных стадиях.
              move.mutate(
                { id: deal.id, stageId, pipelineId },
                { onError: (error) => toast.error(error.message) },
              );
            }}
          />
        ) : (
          <RecordCellShell editable onStartEdit={() => setEditing({ rowId: deal.id, columnId: "stage" })}>
            <TagPill color={stage?.isWon ? "emerald" : stage?.isLost ? "rose" : stageTagColor(stage?.stageColor)}>
              {stage?.stageName ?? "—"}
            </TagPill>
          </RecordCellShell>
        );
      },
    },
    {
      id: "budget",
      header: "Сумма",
      width: 140,
      align: "right",
      sortValue: (deal) => deal.budget,
      render: (deal) =>
        isEditing(deal.id, "budget") ? (
          <RecordCellEditor
            value={String(deal.budget)}
            type="number"
            align="right"
            onCancel={() => setEditing(null)}
            onCommit={(value) => {
              const parsed = Number(value);
              if (!Number.isFinite(parsed) || parsed < 0) {
                toast.error("Сумма должна быть неотрицательным числом");
                setEditing(null);
                return;
              }
              commit(deal, { budget: parsed });
            }}
          />
        ) : (
          <RecordCellShell align="right" editable onStartEdit={() => setEditing({ rowId: deal.id, columnId: "budget" })}>
            <span className="font-medium tabular-nums text-amber-400">{money.format(deal.budget)}</span>
          </RecordCellShell>
        ),
    },
    {
      id: "company",
      header: "Компания",
      width: 190,
      sortValue: (deal) => deal.companyName ?? "",
      render: (deal) => (
        <RecordCellShell isEmpty={deal.companyName === null} emptyLabel="компанию">
          {deal.companyName !== null && (
            <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
          )}
        </RecordCellShell>
      ),
    },
    {
      id: "contact",
      header: "Контактное лицо",
      width: 190,
      sortValue: (deal) => deal.contactName ?? "",
      render: (deal) => (
        <RecordCellShell isEmpty={deal.contactName === null} emptyLabel="контакт">
          {deal.contactName !== null && (
            <EntityChip name={deal.contactName} label={deal.contactName} icon={User} size="sm" />
          )}
        </RecordCellShell>
      ),
    },
    {
      id: "owner",
      header: "Ответственный",
      width: 180,
      sortValue: (deal) => deal.ownerName ?? "",
      render: (deal) => {
        const owner = deal.ownerId !== null ? usersById.get(deal.ownerId) : undefined;
        const label = owner?.fullName ?? deal.ownerName;
        return (
          <RecordCellShell isEmpty={label === null || label === undefined} emptyLabel="ответственного">
            {label !== null && label !== undefined && (
              <EntityChip name={label} label={label} size="sm" />
            )}
          </RecordCellShell>
        );
      },
    },
    {
      id: "closeDate",
      header: "Дата закрытия",
      width: 140,
      sortValue: (deal) => deal.closeDate ?? "",
      render: (deal) =>
        isEditing(deal.id, "closeDate") ? (
          <RecordCellEditor
            value={deal.closeDate ?? ""}
            type="date"
            onCancel={() => setEditing(null)}
            onCommit={(value) => commit(deal, { close_date: value })}
          />
        ) : (
          <RecordCellShell
            editable
            isEmpty={deal.closeDate === null}
            emptyLabel="дату"
            onStartEdit={() => setEditing({ rowId: deal.id, columnId: "closeDate" })}
          >
            {deal.closeDate !== null && (
              <span className="text-slate-300">
                {new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "2-digit" }).format(new Date(deal.closeDate))}
              </span>
            )}
          </RecordCellShell>
        ),
    },
    {
      id: "created",
      header: "Создана",
      width: 120,
      align: "right",
      sortValue: (deal) => deal.createdAt,
      render: (deal) => (
        <RecordCellShell align="right">
          <span
            title={new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(deal.createdAt))}
            className="text-slate-500"
          >
            {timeAgo(deal.createdAt)}
          </span>
        </RecordCellShell>
      ),
    },
  ], [isEditing, commit, stageById, stageOptions, move, pipelineId, usersById]);

  const bulkMoveTo = useCallback(async (stageId: string) => {
    for (const id of selected) {
      try {
        await move.mutateAsync({ id, stageId, pipelineId });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось переместить сделку");
        break;
      }
    }
    setSelected(new Set());
  }, [selected, move, pipelineId]);

  const bulkDelete = useCallback(async () => {
    setDeleteConfirmOpen(false);
    for (const id of selected) {
      try {
        await remove.mutateAsync(id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось удалить сделку");
        break;
      }
    }
    setSelected(new Set());
  }, [selected, remove]);

  const totals = useMemo(
    () => ({
      count: deals.length,
      sum: deals.reduce((total, deal) => total + deal.budget, 0),
    }),
    [deals],
  );

  return (
    <>
      <SyncedRecordTable
        rows={deals}
        columns={tableColumns}
        getRowId={(deal) => deal.id}
        // Клик по строке открывает карточку, но не когда правится ячейка:
        // иначе двойной клик по значению одновременно открывал бы дровер.
        onRowClick={onOpenDeal === undefined || editing !== null ? undefined : (deal) => onOpenDeal(deal.id)}
        tableId="deals"
        onCellEdit={(deal, columnId) => setEditing({ rowId: deal.id, columnId })}
        selectable={bulkEnabled}
        selectedIds={selected}
        onSelectionChange={setSelected}
        footerCells={{
          title: `${totals.count} записей`,
          budget: <span className="font-semibold text-amber-400 tabular-nums">{money.format(totals.sum)}</span>,
        }}
        emptyState={<TableEmptyState icon={Handshake} title="Сделок нет" description="Под текущий фильтр не попала ни одна сделка" />}
        bulkBar={
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-2.5">
            <span className="text-sm text-amber-400">Выбрано: {selected.size}</span>
            <select
              defaultValue=""
              disabled={move.isPending || remove.isPending}
              onChange={(event) => { if (event.target.value !== "") void bulkMoveTo(event.target.value); event.target.value = ""; }}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200"
            >
              <option value="" disabled>Переместить в этап…</option>
              {orderedColumns.map((column) => (
                <option key={column.stageId} value={column.stageId}>{column.stageName}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={move.isPending || remove.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />Удалить
            </button>
          </div>
        }
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={bulkDelete}
        title={`Удалить сделки: ${selected.size}?`}
        description="Сделки будут скрыты из воронки (мягкое удаление). Действие необратимо через интерфейс."
        confirmLabel="Удалить"
        variant="destructive"
        isPending={remove.isPending}
      />
    </>
  );
}
