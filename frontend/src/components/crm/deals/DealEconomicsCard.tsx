"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronUp,
  Plus,
  TrendingUp,
  TrendingDown,
  Receipt,
  Wrench,
  Loader2,
} from "lucide-react";
import type { DealDTO } from "@/lib/api/use-deals";
import {
  useDealEconomics,
  useCreateTransaction,
} from "@/lib/api/use-invoices";
import { useAuth } from "@/lib/auth/use-auth";
import { isModuleInstalled } from "@/lib/context/tenant";
import { CreateTransactionModal } from "@/components/finance/CreateTransactionModal";
import { Guard } from "@/components/shared/Guard";
import type { CreateTransactionPayload } from "@/schemas/finance.schema";
import { cn } from "@/lib/utils";

function formatRub(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export function DealEconomicsCard({ deal }: { deal: DealDTO }) {
  const { tenant } = useAuth();
  const hasFinance = isModuleInstalled(tenant?.installedModules ?? [], "finance");

  const [sectionOpen, setSectionOpen] = useState(true);
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);

  const { data: economics, isLoading, refetch } = useDealEconomics(deal.id, hasFinance);
  const createTransaction = useCreateTransaction();

  const handleCreateExpense = useCallback(
    async (payload: CreateTransactionPayload) => {
      await createTransaction.mutateAsync(payload);
      toast.success("Расход добавлен и учтён в прибыли сделки");
      void refetch();
    },
    [createTransaction, refetch],
  );

  if (!hasFinance) return null;

  const revenue = economics?.revenue ?? deal.budget ?? 0;
  const cogs = economics?.cogs ?? 0;
  const directExpenses = economics?.directExpenses ?? 0;
  const netProfit = economics?.netProfit ?? revenue - cogs - directExpenses;
  const netMarginPercent = economics?.netMarginPercent ?? (revenue > 0 ? Math.round((netProfit / revenue) * 1000) / 10 : 0);
  const expenses = economics?.expenses ?? [];
  const isLoss = netProfit < 0;

  return (
    <div className="mt-2 border-t border-[#f0f0f0] pt-2">
      <div className="flex items-center justify-between px-4 py-1.5">
        <button
          type="button"
          title="Свернуть / развернуть секцию «Экономика сделки»"
          onClick={() => setSectionOpen((prev) => !prev)}
          className="flex items-center gap-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
        >
          <span>Экономика сделки</span>
          <ChevronUp
            className={cn(
              "h-3.5 w-3.5 text-[#888888] transition-transform",
              !sectionOpen && "rotate-180",
            )}
          />
        </button>

        <Guard requiredPermission="finance:write">
          <button
            type="button"
            onClick={() => setExpenseModalOpen(true)}
            className="inline-flex items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] font-medium text-[#111111] hover:border-[#cccccc] hover:bg-[#fafafa] transition-colors cursor-pointer"
          >
            <Plus className="h-3 w-3 text-[#4a38f5]" />
            <span>Расход</span>
          </button>
        </Guard>
      </div>

      {sectionOpen && (
        <div className="px-4 pb-2 pt-1 space-y-2.5">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-3 text-xs text-[#888888]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
              <span>Расчёт экономики...</span>
            </div>
          ) : (
            <>
              {/* Компактная KPI-сетка */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-2">
                  <div className="text-[11px] text-[#666666]">Выручка</div>
                  <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#111111]">
                    {formatRub(revenue)}
                  </div>
                </div>

                <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-2">
                  <div className="text-[11px] text-[#666666]">Себестоимость</div>
                  <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#111111]">
                    {formatRub(cogs)}
                  </div>
                </div>

                <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-2">
                  <div className="text-[11px] text-[#666666]">Прямые расходы</div>
                  <div
                    className={cn(
                      "mt-0.5 text-[13px] font-semibold tabular-nums",
                      directExpenses > 0 ? "text-rose-700" : "text-[#666666]",
                    )}
                  >
                    {directExpenses > 0 ? `−${formatRub(directExpenses)}` : formatRub(0)}
                  </div>
                </div>

                <div
                  className={cn(
                    "rounded-[8px] border px-2.5 py-2",
                    isLoss
                      ? "border-rose-200 bg-rose-50"
                      : "border-emerald-200 bg-emerald-50",
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center gap-1 text-[11px] font-medium",
                      isLoss ? "text-rose-700" : "text-emerald-700",
                    )}
                  >
                    {isLoss ? (
                      <TrendingDown className="h-3 w-3 shrink-0" />
                    ) : (
                      <TrendingUp className="h-3 w-3 shrink-0" />
                    )}
                    <span>Чистая прибыль</span>
                  </div>
                  <div className="mt-0.5 flex items-baseline justify-between gap-1">
                    <span
                      className={cn(
                        "text-[13px] font-semibold tabular-nums",
                        isLoss ? "text-rose-700" : "text-emerald-700",
                      )}
                    >
                      {formatRub(netProfit)}
                    </span>
                    {revenue > 0 && (
                      <span
                        className={cn(
                          "text-[10px] tabular-nums",
                          isLoss ? "text-rose-700/80" : "text-emerald-700/80",
                        )}
                      >
                        {netMarginPercent}%
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Список привязанных прямых расходов */}
              {expenses.length > 0 && (
                <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] divide-y divide-[#f0f0f0]">
                  {expenses.map((exp) => (
                    <div
                      key={exp.id}
                      className="flex items-start justify-between gap-2 px-2.5 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Receipt className="h-3 w-3 shrink-0 text-rose-600" />
                          <span className="font-medium text-[#111111] truncate">
                            {exp.categoryName}
                          </span>
                          {exp.repairOrderId && exp.repairTicketNumber && (
                            <Link
                              href={`/repairs/${exp.repairOrderId}`}
                              className="inline-flex items-center gap-0.5 rounded-[4px] border border-sky-200 bg-sky-50 px-1.5 py-0.25 text-[10px] font-medium text-sky-700 hover:bg-sky-100 transition-colors tabular-nums"
                            >
                              <Wrench className="h-2.5 w-2.5" />
                              {exp.repairTicketNumber}
                            </Link>
                          )}
                        </div>
                        {(exp.description || exp.counterpartyName) && (
                          <div className="mt-0.5 truncate text-[11px] text-[#666666]">
                            {[exp.counterpartyName, exp.description].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-semibold tabular-nums text-rose-700">
                          −{formatRub(exp.amount)}
                        </div>
                        <div className="text-[10px] text-[#888888]">
                          {formatShortDate(exp.occurredAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <CreateTransactionModal
        open={expenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
        onSubmit={handleCreateExpense}
        defaultType="expense"
        defaultDealId={deal.id}
        defaultDealTitle={deal.title}
        defaultCounterpartyName={deal.companyName || deal.contactName || ""}
      />
    </div>
  );
}
