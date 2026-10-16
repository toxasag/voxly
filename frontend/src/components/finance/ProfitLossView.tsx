"use client";

import { memo, useMemo } from "react";
import { TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import type { Transaction, TransactionCategory } from "@/lib/finance/finance.types";
import { getCategoryLabel } from "@/lib/finance/finance.types";
import { cn } from "@/lib/utils";

interface ProfitLossViewProps {
  transactions: Transaction[];
}

const INCOME_CATEGORIES: TransactionCategory[] = ["repair", "parts_sale", "other_income"];
const EXPENSE_CATEGORIES: TransactionCategory[] = ["rent", "salary", "equipment", "marketing", "software", "taxes", "other_expense"];

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(amount);
}

export const ProfitLossView = memo(function ProfitLossView({ transactions }: ProfitLossViewProps) {
  const { incomeByCategory, expenseByCategory, totalIncome, totalExpense, profit, margin } = useMemo(() => {
    const inc: Record<string, number> = {};
    const exp: Record<string, number> = {};
    transactions.forEach(t => {
      if (t.type === "income") inc[t.category] = (inc[t.category] ?? 0) + t.amount;
      if (t.type === "expense") exp[t.category] = (exp[t.category] ?? 0) + t.amount;
    });
    const totalInc = Object.values(inc).reduce((s, v) => s + v, 0);
    const totalExp = Object.values(exp).reduce((s, v) => s + v, 0);
    const p = totalInc - totalExp;
    return { incomeByCategory: inc, expenseByCategory: exp, totalIncome: totalInc, totalExpense: totalExp, profit: p, margin: totalInc > 0 ? Math.round((p / totalInc) * 100) : 0 };
  }, [transactions]);

  const maxValue = Math.max(totalIncome, totalExpense, 1);

  return (
    <div className="space-y-5">
      {/* Summary KPI */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-2"><div className="rounded-lg bg-emerald-500/10 p-1.5"><TrendingUp className="h-4 w-4 text-emerald-400" /></div><span className="text-xs font-medium text-slate-500">Доходы</span></div>
          <p className="mt-2 text-2xl font-bold text-slate-100">{formatCost(totalIncome)}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-2"><div className="rounded-lg bg-rose-500/10 p-1.5"><TrendingDown className="h-4 w-4 text-rose-400" /></div><span className="text-xs font-medium text-slate-500">Расходы</span></div>
          <p className="mt-2 text-2xl font-bold text-slate-100">{formatCost(totalExpense)}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-2"><div className="rounded-lg bg-amber-500/10 p-1.5"><DollarSign className="h-4 w-4 text-amber-400" /></div><span className="text-xs font-medium text-slate-500">Чистая прибыль</span></div>
          <p className={cn("mt-2 text-2xl font-bold", profit >= 0 ? "text-emerald-400" : "text-rose-400")}>{formatCost(profit)}<span className="text-xs ml-1.5 text-slate-500">наценка {margin}%</span></p>
        </div>
      </div>

      {/* Income breakdown */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">Структура доходов</h3>
        <div className="space-y-2.5">
          {INCOME_CATEGORIES.map(cat => {
            const val = incomeByCategory[cat] ?? 0;
            const pct = totalIncome > 0 ? Math.round((val / totalIncome) * 100) : 0;
            return (
              <div key={cat} className="space-y-1">
                <div className="flex items-center justify-between text-xs"><span className="text-slate-400">{getCategoryLabel(cat)}</span><span className="text-slate-300">{formatCost(val)} <span className="text-slate-500">({pct}%)</span></span></div>
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${Math.max(1, (val / maxValue) * 100)}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expense breakdown */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h3 className="text-sm font-semibold text-slate-200 mb-4">Структура расходов</h3>
        <div className="space-y-2.5">
          {EXPENSE_CATEGORIES.map(cat => {
            const val = expenseByCategory[cat] ?? 0;
            const pct = totalExpense > 0 ? Math.round((val / totalExpense) * 100) : 0;
            return (
              <div key={cat} className="space-y-1">
                <div className="flex items-center justify-between text-xs"><span className="text-slate-400">{getCategoryLabel(cat)}</span><span className="text-slate-300">{formatCost(val)} <span className="text-slate-500">({pct}%)</span></span></div>
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-rose-500 transition-all duration-500" style={{ width: `${Math.max(1, (val / maxValue) * 100)}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});