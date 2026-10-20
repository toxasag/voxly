"use client";

import { KpiCards } from "@/components/analytics/KpiCards";
import { PnlChart } from "@/components/analytics/PnlChart";
import { FunnelChart, TopRepairsChart, MasterLoadChart } from "@/components/analytics/Charts";
import { useAnalyticsOverview } from "@/lib/api/use-analytics";
import { Skeleton } from "@/components/shared/Skeleton";
import { RefreshCw } from "lucide-react";

export default function AnalyticsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useAnalyticsOverview();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-7 w-48" />
          <Skeleton className="mt-2 h-4 w-96" />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Skeleton className="h-28 w-full rounded-[8px]" />
          <Skeleton className="h-28 w-full rounded-[8px]" />
          <Skeleton className="h-28 w-full rounded-[8px]" />
          <Skeleton className="h-28 w-full rounded-[8px]" />
        </div>

        <Skeleton className="h-72 w-full rounded-[8px]" />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 w-full rounded-[8px]" />
          <Skeleton className="h-64 w-full rounded-[8px]" />
          <Skeleton className="h-64 w-full rounded-[8px]" />
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-[#111111]">Аналитика</h1>
          <p className="mt-1 text-sm text-[#666666]">
            Выручка, воронка, ремонты и эффективность команды
          </p>
        </div>

        <div role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 p-6">
          <p className="text-sm font-semibold text-rose-900">
            Не удалось загрузить данные аналитики
          </p>
          <p className="mt-1 text-sm text-rose-700">
            {error instanceof Error ? error.message : "Неизвестная ошибка сервера"}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Повторить попытку
          </button>
        </div>
      </div>
    );
  }

  const { kpis, pnl, funnel, top_repairs, master_load } = data;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#111111]">Аналитика</h1>
          <p className="mt-1 text-sm text-[#666666]">
            Выручка, воронка, ремонты и эффективность команды в реальном времени
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-[#4a38f5]" : "text-[#666666]"}`} />
          Обновить
        </button>
      </div>

      {/* KPI Cards */}
      <KpiCards
        revenue={kpis.revenue}
        revenueChange={kpis.revenue_change}
        netProfit={kpis.net_profit}
        profitChange={kpis.profit_change}
        closedRepairs={kpis.closed_repairs}
        repairsChange={kpis.repairs_change}
        avgTicket={kpis.avg_ticket}
        ticketChange={kpis.ticket_change}
      />

      {/* P&L Chart — full width */}
      <PnlChart data={pnl} />

      {/* Bottom Grid: Funnel + TopRepairs + MasterLoad */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FunnelChart data={funnel} />
        <TopRepairsChart data={top_repairs} />
        <MasterLoadChart data={master_load} />
      </div>
    </div>
  );
}