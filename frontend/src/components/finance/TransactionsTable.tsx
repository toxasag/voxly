"use client";

import { memo, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  Search,
  Wrench,
  Package,
  Briefcase,
  Banknote,
  BookOpen,
  AlertCircle,
  Copy,
  Download,
  Trash2,
  Pencil,
  Building2,
  User,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { Transaction, TransactionCategory } from "@/lib/finance/finance.types";
import { getCategoryLabel, getTypeLabel } from "@/lib/finance/finance.types";
import { RecordTable, type RecordColumn } from "@/components/crm/shared/RecordTable";
import { RecordCellShell } from "@/components/crm/shared/RecordCell";
import { TableBulkBar } from "@/components/crm/shared/TableBulkBar";
import { WarehousePagination } from "@/components/warehouse/WarehousePagination";
import { useTableSelection } from "@/lib/hooks/use-table-selection";
import { TagPill } from "@/components/ui/tag";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  useBulkDeleteTransactions,
  useBulkDuplicateTransactions,
  useDeleteTransaction,
} from "@/lib/api/use-invoices";
import { EditTransactionModal } from "./EditTransactionModal";
import { cn } from "@/lib/utils";

interface TransactionsTableProps {
  transactions: Transaction[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterType: "all" | "income" | "expense";
  onFilterTypeChange: (type: "all" | "income" | "expense") => void;
  totalCount?: number;
  page?: number;
  limit?: number;
  onPageChange?: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  sortColumn?: string | null;
  sortAsc?: boolean;
  onSortChange?: (columnId: string | null, asc: boolean) => void;
  serverSort?: boolean;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
  onOpenCategories?: () => void;
}

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  repair: Wrench,
  parts_sale: Package,
  rent: Briefcase,
  salary: Banknote,
  equipment: BookOpen,
  marketing: Briefcase,
  software: BookOpen,
  taxes: Banknote,
  other_income: Banknote,
  other_expense: Banknote,
};

function formatDateTime(iso: string): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const datePart = new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
    }).format(d);
    const timePart = new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
    return `${datePart} ${timePart}`;
  } catch {
    return iso;
  }
}

function formatAmount(amount: number, type: string): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
  return type === "expense" ? `− ${formatted}` : `+ ${formatted}`;
}

function exportToCsv(items: Transaction[]) {
  const headers = [
    "ID",
    "Дата и время",
    "Тип",
    "Категория",
    "Описание",
    "Сумма",
    "Валюта",
    "Счёт",
    "Контрагент",
    "ИНН",
    "Автор",
  ];

  const rows = items.map((t) => [
    t.id,
    new Date(t.date).toLocaleString("ru-RU"),
    t.type === "income" ? "Доход" : "Расход",
    getCategoryLabel(t.category),
    `"${(t.description || "").replace(/"/g, '""')}"`,
    t.amount.toString(),
    "RUB",
    `"${(t.account_name || "").replace(/"/g, '""')}"`,
    `"${(t.counterparty || "").replace(/"/g, '""')}"`,
    t.counterparty_inn || "",
    `"${(t.created_by_name || "").replace(/"/g, '""')}"`,
  ]);

  const csvContent =
    "\uFEFF" + [headers.join(";"), ...rows.map((r) => r.join(";"))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const TransactionsTable = memo(function TransactionsTable({
  transactions,
  searchQuery,
  onSearchChange,
  filterType,
  onFilterTypeChange,
  totalCount,
  page,
  limit,
  onPageChange,
  onLimitChange,
  sortColumn,
  sortAsc,
  onSortChange,
  serverSort = false,
  isLoading,
  isError,
  error,
  onOpenCategories,
}: TransactionsTableProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);

  const bulkDeleteMutation = useBulkDeleteTransactions();
  const bulkDuplicateMutation = useBulkDuplicateTransactions();
  const singleDeleteMutation = useDeleteTransaction();

  const filtered = useMemo(() => {
    if (onPageChange) return transactions;
    return transactions.filter((t) => {
      if (filterType !== "all" && t.type !== filterType) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matches =
          t.description.toLowerCase().includes(q) ||
          t.counterparty.toLowerCase().includes(q) ||
          (t.counterparty_inn ?? "").toLowerCase().includes(q) ||
          t.account_name.toLowerCase().includes(q) ||
          (t.linked_entity_label ?? "").toLowerCase().includes(q) ||
          (t.created_by_name ?? "").toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [transactions, filterType, searchQuery, onPageChange]);

  const effectiveTotal = totalCount ?? filtered.length;
  const pageTxIds = useMemo(() => filtered.map((t) => t.id), [filtered]);
  const filtersScope = useMemo(
    () => ({
      type: filterType !== "all" ? filterType : undefined,
      search: searchQuery.trim() || undefined,
    }),
    [filterType, searchQuery],
  );
  const selection = useTableSelection({
    filterKey: JSON.stringify(filtersScope),
    totalCount: effectiveTotal,
  });

  const totalIncome = useMemo(
    () => filtered.filter((t) => t.type === "income").reduce((sum, t) => sum + t.amount, 0),
    [filtered],
  );
  const totalExpense = useMemo(
    () => filtered.filter((t) => t.type === "expense").reduce((sum, t) => sum + t.amount, 0),
    [filtered],
  );

  // Bulk actions handlers
  const handleDuplicateSelected = useCallback(async () => {
    const count = selection.effectiveSelectedCount;
    if (count === 0) return;
    try {
      const payload = selection.buildBulkPayload(filtersScope);
      const res = await bulkDuplicateMutation.mutateAsync(payload);
      toast.success(
        res.count === 1
          ? "Операция успешно скопирована"
          : `Скопировано операций: ${res.count}`,
      );
      selection.clear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось скопировать операции");
    }
  }, [selection, filtersScope, bulkDuplicateMutation]);

  const handleExportSelected = useCallback(() => {
    const selectedTransactions = filtered.filter((t) => selection.isRowSelected(t.id));
    if (selectedTransactions.length === 0) return;
    exportToCsv(selectedTransactions);
    toast.success(`Экспортировано ${selectedTransactions.length} операций`);
  }, [filtered, selection]);

  const handleDeleteConfirmed = useCallback(async () => {
    const count = selection.effectiveSelectedCount;
    if (count === 0) return;
    try {
      const payload = selection.buildBulkPayload(filtersScope);
      const res = await bulkDeleteMutation.mutateAsync(payload);
      toast.success(
        res.count === 1 ? "Операция удалена" : `Удалено операций: ${res.count}`,
      );
      selection.clear();
      setConfirmDeleteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить операции");
    }
  }, [selection, filtersScope, bulkDeleteMutation]);

  const handleSingleDeleteConfirmed = useCallback(async () => {
    if (!deletingTx) return;
    try {
      await singleDeleteMutation.mutateAsync(deletingTx.id);
      toast.success("Операция успешно удалена");
      setDeletingTx(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить операцию");
    }
  }, [deletingTx, singleDeleteMutation]);

  const columns = useMemo<RecordColumn<Transaction>[]>(
    () => [
      {
        id: "date",
        header: "Дата",
        width: 125,
        sortValue: (tx) => tx.date,
        render: (tx) => (
          <RecordCellShell isLabelIdentifier>
            <span className="font-mono text-xs text-[#111111]">{formatDateTime(tx.date)}</span>
          </RecordCellShell>
        ),
      },
      {
        id: "type",
        header: "Тип",
        width: 104,
        sortValue: (tx) => tx.type,
        render: (tx) => (
          <RecordCellShell>
            <TagPill color={tx.type === "income" ? "emerald" : "rose"}>
              {getTypeLabel(tx.type)}
            </TagPill>
          </RecordCellShell>
        ),
      },
      {
        id: "category",
        header: "Категория",
        width: 160,
        sortValue: (tx) => tx.category,
        render: (tx) => {
          const CategoryIcon = CATEGORY_ICONS[tx.category] ?? Banknote;
          const label = getCategoryLabel(tx.category).trim();
          return (
            <RecordCellShell>
              <div className="flex items-center gap-1.5 truncate text-xs text-[#111111]">
                <CategoryIcon className="h-3 w-3 shrink-0 text-[#888888]" />
                <span className={cn("truncate", !label && "text-[#888888]")}>
                  {label || "Без категории"}
                </span>
              </div>
            </RecordCellShell>
          );
        },
      },
      {
        id: "description",
        header: "Описание",
        width: 240,
        render: (tx) => (
          <RecordCellShell>
            <span className="truncate text-xs text-[#666666]">{tx.description || "—"}</span>
          </RecordCellShell>
        ),
      },
      {
        id: "amount",
        header: "Сумма",
        width: 130,
        align: "right",
        sortValue: (tx) => tx.amount,
        render: (tx) => (
          <RecordCellShell align="right">
            <span
              className={cn(
                "font-mono text-xs font-semibold tabular-nums",
                tx.type === "income" ? "text-emerald-600" : "text-rose-600",
              )}
            >
              {formatAmount(tx.amount, tx.type)}
            </span>
          </RecordCellShell>
        ),
      },
      {
        id: "account",
        header: "Счёт",
        width: 140,
        sortValue: (tx) => tx.account_name,
        render: (tx) => (
          <RecordCellShell>
            <span className="truncate text-xs text-[#666666]">{tx.account_name}</span>
          </RecordCellShell>
        ),
      },
      {
        id: "counterparty",
        header: "Контрагент / Связь",
        width: 220,
        render: (tx) => {
          const hasCounterparty = Boolean(tx.counterparty);
          const hasInn = Boolean(tx.counterparty_inn);
          const hasDeal = Boolean(tx.deal_id);
          const hasRepair = Boolean(tx.repair_order_id);

          if (!hasCounterparty && !hasDeal && !hasRepair && !tx.linked_entity_label) {
            return (
              <RecordCellShell>
                <span className="text-xs text-[#888888]">—</span>
              </RecordCellShell>
            );
          }

          return (
            <RecordCellShell>
              <div className="flex items-center gap-1.5 min-w-0 text-xs">
                {hasCounterparty ? (
                  hasInn ? (
                    <Building2 className="h-3 w-3 shrink-0 text-[#4a38f5]" />
                  ) : (
                    <User className="h-3 w-3 shrink-0 text-[#4a38f5]" />
                  )
                ) : hasDeal ? (
                  <Briefcase className="h-3 w-3 shrink-0 text-[#4a38f5]" />
                ) : hasRepair ? (
                  <Wrench className="h-3 w-3 shrink-0 text-[#4a38f5]" />
                ) : null}
                <div className="flex items-center gap-1.5 min-w-0">
                  {hasCounterparty && (
                    <span className="truncate text-[#111111] font-medium" title={hasInn ? `${tx.counterparty} (ИНН ${tx.counterparty_inn})` : tx.counterparty}>
                      {tx.counterparty}
                    </span>
                  )}
                  {hasDeal && (
                    <Link
                      href={`/crm/deals?record=${tx.deal_id}`}
                      onClick={(e) => e.stopPropagation()}
                      title={tx.deal_title ? `Сделка: ${tx.deal_title}` : "Открыть сделку"}
                      className="inline-flex items-center gap-1 rounded-[4px] border border-[#4a38f5]/20 bg-[#4a38f5]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#4a38f5] hover:bg-[#4a38f5]/15 transition-colors max-w-[130px] truncate shrink-0"
                    >
                      <span className="truncate">{tx.deal_title || "Сделка"}</span>
                    </Link>
                  )}
                  {hasRepair && (
                    <Link
                      href={`/repairs/${tx.repair_order_id}`}
                      onClick={(e) => e.stopPropagation()}
                      title={tx.repair_ticket_number ? `Наряд ${tx.repair_ticket_number}` : "Открыть наряд"}
                      className="inline-flex items-center gap-1 rounded-[4px] border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 hover:bg-sky-100 transition-colors shrink-0 tabular-nums"
                    >
                      {tx.repair_ticket_number || "Наряд"}
                    </Link>
                  )}
                  {!hasCounterparty && !hasDeal && !hasRepair && tx.linked_entity_label && (
                    <span className="truncate text-[#111111] font-medium">
                      {tx.linked_entity_label}
                    </span>
                  )}
                </div>
              </div>
            </RecordCellShell>
          );
        },
      },
      {
        id: "author",
        header: "Автор",
        width: 130,
        sortValue: (tx) => tx.created_by_name || "",
        render: (tx) => (
          <RecordCellShell>
            {tx.created_by_name ? (
              <div className="flex items-center gap-1.5 truncate text-xs text-[#666666]">
                <User className="h-3 w-3 shrink-0 text-[#888888]" />
                <span className="truncate">{tx.created_by_name}</span>
              </div>
            ) : (
              <span className="text-xs text-[#888888]">—</span>
            )}
          </RecordCellShell>
        ),
      },
      {
        id: "actions",
        header: "",
        width: 76,
        sortable: false,
        render: (tx) => (
          <RecordCellShell>
            <div
              className="flex items-center gap-1 justify-end w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                title="Редактировать операцию"
                onClick={() => setEditingTx(tx)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] border border-transparent text-[#666666] hover:border-[#e5e5e5] hover:bg-white hover:text-[#4a38f5] transition-colors cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Удалить операцию"
                onClick={() => setDeletingTx(tx)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] border border-transparent text-[#888888] hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </RecordCellShell>
        ),
      },
    ],
    [],
  );

  // Floating Action Bar (bulk actions)
  const bulkBar = useMemo(() => {
    return (
      <TableBulkBar
        selectedCount={selection.effectiveSelectedCount}
        totalCount={effectiveTotal}
        isAllSelected={selection.isAllSelected}
        excludedCount={selection.excludedCount}
        entityNamePlural="операций"
        pageItemCount={filtered.length}
        onSelectAll={selection.selectAllAcrossPages}
        onClearSelection={selection.clear}
        onDelete={() => setConfirmDeleteOpen(true)}
        isDeleting={bulkDeleteMutation.isPending}
      >
        <button
          type="button"
          onClick={handleDuplicateSelected}
          disabled={bulkDuplicateMutation.isPending}
          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer disabled:opacity-50"
          title="Дублировать выбранные операции сегодняшним числом"
        >
          <Copy className="h-3.5 w-3.5 text-[#666666]" />
          <span>{bulkDuplicateMutation.isPending ? "Копирование..." : "Копировать"}</span>
        </button>

        <button
          type="button"
          onClick={handleExportSelected}
          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer"
          title="Экспортировать отмеченные операции текущей страницы в CSV"
        >
          <Download className="h-3.5 w-3.5 text-[#666666]" />
          <span>Экспорт (CSV)</span>
        </button>
      </TableBulkBar>
    );
  }, [
    selection.effectiveSelectedCount,
    selection.isAllSelected,
    selection.excludedCount,
    selection.selectAllAcrossPages,
    selection.clear,
    effectiveTotal,
    filtered.length,
    handleDuplicateSelected,
    handleExportSelected,
    bulkDuplicateMutation.isPending,
    bulkDeleteMutation.isPending,
  ]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <div className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-2 pl-10 pr-4 text-xs text-[#888888] animate-pulse">
              Загрузка...
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {(["all", "income", "expense"] as const).map((f) => (
              <div
                key={f}
                className="rounded-[8px] border border-[#e5e5e5] px-2.5 py-1 text-xs text-[#888888] bg-white"
              >
                {f === "all" ? "Все" : f === "income" ? "Доходы" : "Расходы"}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-4">
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 w-full bg-[#f5f5f5] rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-[16px] border border-rose-500/30 bg-rose-500/5 p-6 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-rose-500" />
        <div>
          <p className="text-xs font-medium text-rose-600">Не удалось загрузить операции</p>
          <p className="text-xs text-[#888888] mt-1">{error?.message ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Top Bar with Search & Filter Tabs & Aggregates */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по описанию, контрагенту, ИНН..."
            className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-9 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
          />
        </div>

        <div className="flex items-center gap-1">
          {([
            { value: "all", label: "Все" },
            { value: "income", label: "Доходы" },
            { value: "expense", label: "Расходы" },
          ] as const).map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => onFilterTypeChange(f.value)}
              className={cn(
                "rounded-[8px] border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                filterType === f.value
                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Export All button if no selection */}
        {filtered.length > 0 && selection.effectiveSelectedCount === 0 && (
          <button
            type="button"
            onClick={() => {
              exportToCsv(filtered);
              toast.success(`Экспортировано ${filtered.length} операций`);
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#666666] hover:border-[#cccccc] hover:text-[#111111] transition-colors cursor-pointer"
            title="Экспортировать весь текущий список в CSV"
          >
            <Download className="h-3.5 w-3.5 text-[#888888]" />
            <span>Экспорт в CSV</span>
          </button>
        )}

        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-xs font-semibold text-emerald-600">
            {new Intl.NumberFormat("ru-RU", {
              style: "currency",
              currency: "RUB",
              maximumFractionDigits: 0,
            }).format(totalIncome)}
          </span>
          <span className="font-mono text-xs font-semibold text-rose-600">
            {new Intl.NumberFormat("ru-RU", {
              style: "currency",
              currency: "RUB",
              maximumFractionDigits: 0,
            }).format(totalExpense)}
          </span>
        </div>
      </div>

      {/* RecordTable with multi-selection & bulkBar */}
      <RecordTable
        rows={filtered}
        columns={columns}
        getRowId={(tx) => tx.id}
        tableId="transactions"
        serverSort={serverSort}
        sortColumn={sortColumn}
        sortAsc={sortAsc}
        onSortChange={onSortChange}
        selectable={true}
        selectedIds={selection.getPageSelectedIds(pageTxIds)}
        onSelectionChange={(next) => selection.onPageSelectionChange(next, pageTxIds)}
        bulkBar={bulkBar}
        pagination={
          onPageChange && page !== undefined && limit !== undefined ? (
            <WarehousePagination
              total={effectiveTotal}
              page={page}
              pages={Math.max(1, Math.ceil(effectiveTotal / limit))}
              limit={limit}
              entityLabel="операций"
              onPageChange={onPageChange}
              onLimitChange={(newLimit) => onLimitChange?.(newLimit)}
              disabled={isLoading}
            />
          ) : undefined
        }
        onRowClick={(tx) => setEditingTx(tx)}
        emptyState={
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Banknote className="h-8 w-8 text-[#888888]" />
            <p className="text-xs text-[#666666]">Нет операций</p>
          </div>
        }
      />

      {/* Edit Transaction Modal */}
      <EditTransactionModal
        open={Boolean(editingTx)}
        transaction={editingTx}
        onClose={() => setEditingTx(null)}
        onOpenCategories={onOpenCategories}
        onDelete={(tx) => {
          setEditingTx(null);
          setDeletingTx(tx);
        }}
      />

      {/* Single Delete Confirm Dialog */}
      <ConfirmDialog
        open={Boolean(deletingTx)}
        onClose={() => setDeletingTx(null)}
        onConfirm={handleSingleDeleteConfirmed}
        title="Удалить операцию?"
        description={
          deletingTx
            ? `Операция от ${formatDateTime(deletingTx.date)} на сумму ${formatAmount(
                deletingTx.amount,
                deletingTx.type,
              )} будет удалена, а баланс счёта автоматически пересчитан. Это действие необратимо.`
            : "Операция будет удалена, а баланс счёта пересчитан."
        }
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="destructive"
        isPending={singleDeleteMutation.isPending}
      />

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={handleDeleteConfirmed}
        title={
          selection.effectiveSelectedCount === 1
            ? "Удалить операцию?"
            : `Удалить ${selection.effectiveSelectedCount} операций?`
        }
        description="Выбранные финансовые операции будут удалены, а балансы связанных счетов автоматически пересчитаны. Это действие необратимо."
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="destructive"
        isPending={bulkDeleteMutation.isPending}
      />
    </div>
  );
});
