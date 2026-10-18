"use client";

import { memo, useMemo } from "react";
import { Banknote, Receipt, TrendingUp, TrendingDown, Wrench, Package } from "lucide-react";
import type { WorkItem, PartItem } from "@/lib/repairs/repairs.types";
import { cn } from "@/lib/utils";

interface FinancialSummaryProps {
  workItems: WorkItem[];
  parts: PartItem[];
  hasFinanceModule: boolean;
  onGenerateInvoice: () => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export const FinancialSummary = memo(function FinancialSummary({
  workItems,
  parts,
  hasFinanceModule,
  onGenerateInvoice,
}: FinancialSummaryProps) {
  const summary = useMemo(() => {
    const totalWork = workItems.reduce((sum, w) => sum + w.cost, 0);
    const totalPartsRetail = parts.reduce((sum, p) => sum + p.retail_price * p.quantity, 0);
    const totalPartsCost = parts.reduce((sum, p) => sum + p.cost_price * p.quantity, 0);
    const totalClient = totalWork + totalPartsRetail;
    const totalCost = totalPartsCost;
    const grossProfit = totalClient - totalCost;
    const marginPct = totalClient > 0 ? Math.round((grossProfit / totalClient) * 100) : 0;

    return { totalWork, totalPartsRetail, totalPartsCost, totalClient, totalCost, grossProfit, marginPct };
  }, [workItems, parts]);

  const hasData = workItems.length > 0 || parts.length > 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex items-center gap-2 mb-4">
        <Banknote className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-200">Финансовый итог</span>
      </div>

      {!hasData ? (
        <p className="text-sm text-slate-600 py-4">Добавьте работы и запчасти, чтобы увидеть финансовую разбивку.</p>
      ) : (
        <div className="space-y-3">
          {/* Work */}
          {workItems.length > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-slate-950/50 border border-slate-800 px-4 py-3">
              <div className="flex items-center gap-2">
                <Wrench className="h-3.5 w-3.5 text-slate-500" />
                <span className="text-sm text-slate-400">Работы ({workItems.length})</span>
              </div>
              <span className="text-sm font-semibold text-slate-200">{formatCost(summary.totalWork)}</span>
            </div>
          )}

          {/* Parts */}
          {parts.length > 0 && (
            <div className="rounded-lg bg-slate-950/50 border border-slate-800 divide-y divide-slate-800 px-4 py-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-3.5 w-3.5 text-slate-500" />
                  <span className="text-sm text-slate-400">Запчасти ({parts.length})</span>
                </div>
                <span className="text-sm font-semibold text-slate-200">{formatCost(summary.totalPartsRetail)}</span>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-500 pl-6">Закупочная цена запчастей</span>
                <span className="text-xs text-slate-500">{formatCost(summary.totalPartsCost)}</span>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-emerald-500/80 pl-6">Наценка на запчасти</span>
                <span className="text-xs font-semibold text-emerald-400">
                  {formatCost(summary.totalPartsRetail - summary.totalPartsCost)}
                </span>
              </div>
            </div>
          )}

          {/* Divider */}
          <div className="h-px bg-slate-800" />

          {/* Total for Client */}
          <div className="flex items-center justify-between rounded-lg border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-4 py-3.5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-amber-400" />
              <span className="text-sm font-semibold text-amber-400">Итого к оплате (клиент)</span>
            </div>
            <span className="text-lg font-bold text-amber-400">{formatCost(summary.totalClient)}</span>
          </div>

          {/* Gross Profit / Margin */}
          <div className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-4 py-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              <span className="text-sm font-semibold text-emerald-400">Валовая прибыль</span>
            </div>
            <div className="text-right">
              <span className="text-lg font-bold text-emerald-400">{formatCost(summary.grossProfit)}</span>
              <span className="block text-xs text-emerald-500/70">
                наценка {summary.marginPct}%
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Button */}
      {hasData && hasFinanceModule && (
        <button
          type="button"
          onClick={onGenerateInvoice}
          className={cn(
            "mt-4 w-full flex items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition-colors",
            "bg-emerald-600 text-white hover:bg-emerald-500",
          )}
        >
          <Receipt className="h-4 w-4" />
          Сформировать счёт
        </button>
      )}

      {hasData && !hasFinanceModule && (
        <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3 text-center">
          <p className="text-xs text-slate-500">
            Модуль «Финансы» не установлен. Установите его, чтобы формировать счета.
          </p>
        </div>
      )}
    </div>
  );
});