"use client";

import { memo, useMemo, useState, useCallback } from "react";
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
  isLoading,
  isError,
  error,
  onOpenCategories,
}: TransactionsTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState<Transaction | null>(null);

  const bulkDeleteMutation = useBulkDeleteTransactions();
  const bulkDuplicateMutation = useBulkDuplicateTransactions();
  const singleDeleteMutation = useDeleteTransaction();

  const filtered = useMemo(() => {
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
  }, [transactions, filterType, searchQuery]);

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
    if (selectedIds.size === 0) return;
    try {
      const ids = Array.from(selectedIds);
      await bulkDuplicateMutation.mutateAsync(ids);
      toast.success(
        ids.length === 1
          ? "Операция успешно скопирована"
          : `Скопировано операций: ${ids.length}`,
      );
      setSelectedIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось скопировать операции");
    }
  }, [selectedIds, bulkDuplicateMutation]);

  const handleExportSelected = useCallback(() => {
    const selectedTransactions = filtered.filter((t) => selectedIds.has(t.id));
    if (selectedTransactions.length === 0) return;
    exportToCsv(selectedTransactions);
    toast.success(`Экспортировано ${selectedTransactions.length} операций`);
  }, [filtered, selectedIds]);

  const handleDeleteConfirmed = useCallback(async () => {
    if (selectedIds.size === 0) return;
    try {
      const ids = Array.from(selectedIds);
      await bulkDeleteMutation.mutateAsync(ids);
      toast.success(
        ids.length === 1 ? "Операция удалена" : `Удалено операций: ${ids.length}`,
      );
      setSelectedIds(new Set());
      setConfirmDeleteOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить операции");
    }
  }, [selectedIds, bulkDeleteMutation]);

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
          return (
            <RecordCellShell>
              <div className="flex items-center gap-1.5 truncate text-xs text-[#111111]">
                <CategoryIcon className="h-3 w-3 shrink-0 text-[#888888]" />
                <span className="truncate">{getCategoryLabel(tx.category)}</span>
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
        width: 180,
        render: (tx) => {
          const hasCounterparty = Boolean(tx.counterparty);
          const hasInn = Boolean(tx.counterparty_inn);

          if (!hasCounterparty && !tx.linked_entity_label) {
            return (
              <RecordCellShell>
                <span className="text-xs text-[#888888]">—</span>
              </RecordCellShell>
            );
          }

          return (
            <RecordCellShell>
              <div className="flex items-center gap-1.5 truncate text-xs">
                {hasCounterparty ? (
                  hasInn ? (
                    <Building2 className="h-3 w-3 shrink-0 text-[#4a38f5]" />
                  ) : (
                    <User className="h-3 w-3 shrink-0 text-[#4a38f5]" />
                  )
                ) : null}
                <div className="flex flex-col truncate leading-tight">
                  <span className="truncate text-[#111111] font-medium">
                    {tx.counterparty || tx.linked_entity_label}
                  </span>
                  {hasInn && (
                    <span className="font-mono text-[10px] text-[#888888]">
                      ИНН {tx.counterparty_inn}
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
      <div className="flex items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-2 shadow-xs animate-in fade-in duration-150">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-[#111111]">
            Выбрано: <span className="font-mono tabular-nums text-[#4a38f5]">{selectedIds.size}</span>
          </span>
          <span className="text-[#cccccc]">|</span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-xs text-[#666666] hover:text-[#111111] hover:underline cursor-pointer"
          >
            Снять выделение
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Copy / Duplicate button */}
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

          {/* Export button */}
          <button
            type="button"
            onClick={handleExportSelected}
            className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer"
            title="Экспортировать выбранные операции в CSV"
          >
            <Download className="h-3.5 w-3.5 text-[#666666]" />
            <span>Экспорт (CSV)</span>
          </button>

          {/* Delete button */}
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={bulkDeleteMutation.isPending}
            className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-700 shadow-2xs hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50"
            title="Удалить выбранные операции"
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-600" />
            <span>Удалить</span>
          </button>
        </div>
      </div>
    );
  }, [
    selectedIds,
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
        {filtered.length > 0 && selectedIds.size === 0 && (
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
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={setSelectedIds}
        bulkBar={bulkBar}
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
          selectedIds.size === 1
            ? "Удалить операцию?"
            : `Удалить ${selectedIds.size} операций?`
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
