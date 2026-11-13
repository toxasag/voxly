"use client";

import { memo, useMemo } from "react";
import { TrendingUp, TrendingDown, DollarSign } from "lucide-react";
import type { Transaction } from "@/lib/finance/finance.types";
import { useFinanceCategories } from "@/lib/api/use-invoices";
import { cn } from "@/lib/utils";

interface ProfitLossViewProps {
  transactions: Transaction[];
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(amount);
}

export const ProfitLossView = memo(function ProfitLossView({ transactions }: ProfitLossViewProps) {
  const { data: dbCategories = [] } = useFinanceCategories();

  const { incomeByCategory, expenseByCategory, totalIncome, totalExpense, profit, margin, incomeCategories, expenseCategories } = useMemo(() => {
    const inc: Record<string, number> = {};
    const exp: Record<string, number> = {};
    const incCats = new Set<string>();
    const expCats = new Set<string>();

    dbCategories.forEach((c) => {
      if (c.type === "income") {
        incCats.add(c.name);
        inc[c.name] = 0;
      } else {
        expCats.add(c.name);
        exp[c.name] = 0;
      }
    });

    transactions.forEach((t) => {
      const cat = t.category || "Прочие операции";
      if (t.type === "income") {
        incCats.add(cat);
        inc[cat] = (inc[cat] ?? 0) + t.amount;
      }
      if (t.type === "expense") {
        expCats.add(cat);
        exp[cat] = (exp[cat] ?? 0) + t.amount;
      }
    });

    const totalInc = Object.values(inc).reduce((s, v) => s + v, 0);
    const totalExp = Object.values(exp).reduce((s, v) => s + v, 0);
    const p = totalInc - totalExp;

    return {
      incomeByCategory: inc,
      expenseByCategory: exp,
      totalIncome: totalInc,
      totalExpense: totalExp,
      profit: p,
      margin: totalInc > 0 ? Math.round((p / totalInc) * 100) : 0,
      incomeCategories: Array.from(incCats),
      expenseCategories: Array.from(expCats),
    };
  }, [dbCategories, transactions]);

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
          {incomeCategories.length === 0 ? (
            <p className="text-xs text-[#888888]">Нет статей доходов</p>
          ) : (
            incomeCategories.map((cat) => {
              const val = incomeByCategory[cat] ?? 0;
              const pct = totalIncome > 0 ? Math.round((val / totalIncome) * 100) : 0;
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#666666] font-medium">{cat}</span>
                    <span className="text-[#111111] font-medium font-mono">{formatCost(val)} <span className="text-[#888888] font-normal font-sans">({pct}%)</span></span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#f0f0f0] overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-600 transition-all duration-500" style={{ width: `${Math.max(val > 0 ? 1 : 0, (val / maxValue) * 100)}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Expense breakdown */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
        <h3 className="text-sm font-semibold text-[#111111] mb-4">Структура расходов</h3>
        <div className="space-y-2.5">
          {expenseCategories.length === 0 ? (
            <p className="text-xs text-[#888888]">Нет статей расходов</p>
          ) : (
            expenseCategories.map((cat) => {
              const val = expenseByCategory[cat] ?? 0;
              const pct = totalExpense > 0 ? Math.round((val / totalExpense) * 100) : 0;
              return (
                <div key={cat} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#666666] font-medium">{cat}</span>
                    <span className="text-[#111111] font-medium font-mono">{formatCost(val)} <span className="text-[#888888] font-normal font-sans">({pct}%)</span></span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-[#f0f0f0] overflow-hidden">
                    <div className="h-full rounded-full bg-rose-600 transition-all duration-500" style={{ width: `${Math.max(val > 0 ? 1 : 0, (val / maxValue) * 100)}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
});