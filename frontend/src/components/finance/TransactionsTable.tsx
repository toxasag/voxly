"use client";

import { memo, useMemo } from "react";
import {
  Search,
  Wrench,
  Package,
  Briefcase,
  Banknote,
  BookOpen,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import type { Transaction, TransactionCategory } from "@/lib/finance/finance.types";
import { getCategoryLabel, getTypeLabel } from "@/lib/finance/finance.types";
import { RecordTable, type RecordColumn } from "@/components/crm/shared/RecordTable";
import { RecordCellShell } from "@/components/crm/shared/RecordCell";
import { TagPill } from "@/components/ui/tag";
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
}

const CATEGORY_ICONS: Record<TransactionCategory, LucideIcon> = {
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

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(iso));
}

function formatAmount(amount: number, type: string): string {
  const formatted = new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
  return type === "expense" ? `− ${formatted}` : `+ ${formatted}`;
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
}: TransactionsTableProps) {
  const filtered = useMemo(() => {
    return transactions.filter((t) => {
      if (filterType !== "all" && t.type !== filterType) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matches =
          t.description.toLowerCase().includes(q) ||
          t.counterparty.toLowerCase().includes(q) ||
          t.account_name.toLowerCase().includes(q) ||
          (t.linked_entity_label ?? "").toLowerCase().includes(q);
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

  const columns = useMemo<RecordColumn<Transaction>[]>(
    () => [
      {
        id: "date",
        header: "Дата",
        width: 104,
        sortValue: (tx) => tx.date,
        render: (tx) => (
          <RecordCellShell isLabelIdentifier>
            <span className="font-mono text-xs text-[#111111]">{formatDate(tx.date)}</span>
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
            <span className="truncate text-xs text-[#666666]">{tx.description}</span>
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
                "font-mono text-xs font-medium tabular-nums",
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
        width: 130,
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
        width: 160,
        render: (tx) => (
          <RecordCellShell>
            <div className="truncate text-xs text-[#666666]">
              {tx.counterparty || tx.linked_entity_label || "—"}
            </div>
          </RecordCellShell>
        ),
      },
    ],
    [],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <div className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-2 pl-10 pr-4 text-xs text-[#888888] animate-pulse">Загрузка...</div>
          </div>
          <div className="flex items-center gap-1.5">
            {(["all", "income", "expense"] as const).map((f) => (
              <div key={f} className="rounded-[8px] border border-[#e5e5e5] px-2.5 py-1 text-xs text-[#888888] bg-white">
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
      {/* Top Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по описанию, контрагенту..."
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

        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-xs font-medium text-emerald-600">
            {new Intl.NumberFormat("ru-RU", {
              style: "currency",
              currency: "RUB",
              maximumFractionDigits: 0,
            }).format(totalIncome)}
          </span>
          <span className="font-mono text-xs font-medium text-rose-600">
            {new Intl.NumberFormat("ru-RU", {
              style: "currency",
              currency: "RUB",
              maximumFractionDigits: 0,
            }).format(totalExpense)}
          </span>
        </div>
      </div>

      {/* RecordTable */}
      <RecordTable
        rows={filtered}
        columns={columns}
        getRowId={(tx) => tx.id}
        tableId="transactions"
        emptyState={
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Banknote className="h-8 w-8 text-[#888888]" />
            <p className="text-xs text-[#666666]">Нет операций</p>
          </div>
        }
      />
    </div>
  );
});