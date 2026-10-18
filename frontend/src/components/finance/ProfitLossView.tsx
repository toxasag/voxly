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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2"><div className="rounded-lg bg-emerald-50 p-1.5"><TrendingUp className="h-4 w-4 text-emerald-700" /></div><span className="text-xs font-medium text-[#666666]">Доходы</span></div>
          <p className="mt-2 text-2xl font-bold text-[#111111]">{formatCost(totalIncome)}</p>
        </div>
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2"><div className="rounded-lg bg-rose-50 p-1.5"><TrendingDown className="h-4 w-4 text-rose-700" /></div><span className="text-xs font-medium text-[#666666]">Расходы</span></div>
          <p className="mt-2 text-2xl font-bold text-[#111111]">{formatCost(totalExpense)}</p>
        </div>
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2"><div className="rounded-lg bg-[#4a38f5]/10 p-1.5"><DollarSign className="h-4 w-4 text-[#4a38f5]" /></div><span className="text-xs font-medium text-[#666666]">Чистая прибыль</span></div>
          <p className={cn("mt-2 text-2xl font-bold", profit >= 0 ? "text-emerald-700" : "text-rose-700")}>{formatCost(profit)}<span className="text-xs ml-1.5 text-[#666666]">наценка {margin}%</span></p>
        </div>
      </div>

      {/* Income breakdown */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
        <h3 className="text-sm font-semibold text-[#111111] mb-4">Структура доходов</h3>
        <div className="space-y-2.5">
          {INCOME_CATEGORIES.map(cat => {
            const val = incomeByCategory[cat] ?? 0;
            const pct = totalIncome > 0 ? Math.round((val / totalIncome) * 100) : 0;
            return (
              <div key={cat} className="space-y-1">
                <div className="flex items-center justify-between text-xs"><span className="text-[#666666]">{getCategoryLabel(cat)}</span><span className="text-[#111111] font-medium">{formatCost(val)} <span className="text-[#888888]">({pct}%)</span></span></div>
                <div className="h-2 w-full rounded-full bg-[#f0f0f0] overflow-hidden"><div className="h-full rounded-full bg-emerald-600 transition-all duration-500" style={{ width: `${Math.max(1, (val / maxValue) * 100)}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Expense breakdown */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
        <h3 className="text-sm font-semibold text-[#111111] mb-4">Структура расходов</h3>
        <div className="space-y-2.5">
          {EXPENSE_CATEGORIES.map(cat => {
            const val = expenseByCategory[cat] ?? 0;
            const pct = totalExpense > 0 ? Math.round((val / totalExpense) * 100) : 0;
            return (
              <div key={cat} className="space-y-1">
                <div className="flex items-center justify-between text-xs"><span className="text-[#666666]">{getCategoryLabel(cat)}</span><span className="text-[#111111] font-medium">{formatCost(val)} <span className="text-[#888888]">({pct}%)</span></span></div>
                <div className="h-2 w-full rounded-full bg-[#f0f0f0] overflow-hidden"><div className="h-full rounded-full bg-rose-600 transition-all duration-500" style={{ width: `${Math.max(1, (val / maxValue) * 100)}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});