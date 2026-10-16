"use client";

import { memo, useMemo } from "react";
import {
  Search,
  Wrench,
  Package,
  Briefcase,
  Banknote,
  BookOpen,
  Loader2,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";
import type { Transaction, TransactionCategory } from "@/lib/finance/finance.types";
import { getCategoryLabel, getTypeLabel, getTypeColors } from "@/lib/finance/finance.types";
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
  // Хуки объявлены до любых early return: React требует одинакового порядка
  // вызовов на каждом рендере, а прежняя версия вызывала useMemo уже после
  // ветвей `isLoading`/`isError`, из-за чего сборка падала на
  // react-hooks/rules-of-hooks, а порядок хуков менялся при первой загрузке.
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

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <div className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-slate-500 animate-pulse">Загрузка...</div>
          </div>
          <div className="flex items-center gap-1.5">
            {(["all", "income", "expense"] as const).map((f) => (
              <div key={f} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-900/50">{f === "all" ? "Все" : f === "income" ? "Доходы" : "Расходы"}</div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <div className="divide-y divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-3.5 flex items-center gap-4">
                <div className="h-4 w-16 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 w-20 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 w-32 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 flex-1 bg-slate-800 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-rose-400" />
        <div>
          <p className="text-sm font-medium text-rose-400">Не удалось загрузить операции</p>
          <p className="text-xs text-slate-500 mt-1">{error?.message ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по описанию, контрагенту..."
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          />
        </div>

        <div className="flex items-center gap-1.5">
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
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                filterType === f.value
                  ? "border-amber-500 bg-amber-500/10 text-amber-400"
                  : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs font-medium text-emerald-400">
            {new Intl.NumberFormat("ru-RU", {
              style: "currency",
              currency: "RUB",
              maximumFractionDigits: 0,
            }).format(totalIncome)}
          </span>
          <span className="text-xs font-medium text-rose-400">
            {new Intl.NumberFormat("ru-RU", {
              style: "currency",
              currency: "RUB",
              maximumFractionDigits: 0,
            }).format(totalExpense)}
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[85px]">
                  Дата
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[90px]">
                  Тип
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Категория
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Описание
                </th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-[110px]">
                  Сумма
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[100px]">
                  Счёт
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[110px]">
                  Связь
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Banknote className="h-8 w-8 text-slate-700" />
                      <p className="text-sm text-slate-600">Нет операций</p>
                    </div>
                  </td>
                </tr>
              )}
              {filtered.map((tx) => {
                const CategoryIcon = CATEGORY_ICONS[tx.category] ?? Banknote;
                return (
                  <tr
                    key={tx.id}
                    className="transition-colors hover:bg-slate-800/50"
                  >
                    {/* Date */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-slate-400">{formatDate(tx.date)}</span>
                    </td>

                    {/* Type Badge */}
                    <td className="px-4 py-3.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                          getTypeColors(tx.type),
                        )}
                      >
                        {getTypeLabel(tx.type)}
                      </span>
                    </td>

                    {/* Category */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <CategoryIcon className="h-3.5 w-3.5 text-slate-500" />
                        <span className="text-sm text-slate-300">
                          {getCategoryLabel(tx.category)}
                        </span>
                      </div>
                    </td>

                    {/* Description + Counterparty */}
                    <td className="px-4 py-3.5">
                      <div>
                        <p className="text-sm text-slate-200 truncate max-w-[280px]">
                          {tx.description}
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{tx.counterparty}</p>
                      </div>
                    </td>

                    {/* Amount */}
                    <td className="px-4 py-3.5 text-right">
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          tx.type === "income" && "text-emerald-400",
                          tx.type === "expense" && "text-rose-400",
                          tx.type === "transfer" && "text-sky-400",
                        )}
                      >
                        {formatAmount(tx.amount, tx.type)}
                      </span>
                    </td>

                    {/* Account */}
                    <td className="px-4 py-3.5">
                      <span className="text-xs text-slate-400">{tx.account_name}</span>
                    </td>

                    {/* Linked Entity */}
                    <td className="px-4 py-3.5">
                      {tx.linked_entity_label ? (
                        <span className="inline-flex items-center rounded-md bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-xs font-mono font-medium text-amber-400">
                          {tx.linked_entity_label}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});