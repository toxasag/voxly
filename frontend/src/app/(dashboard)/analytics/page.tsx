"use client";

import { useState } from "react";
import { RefreshCw, BarChart2, Radio } from "lucide-react";
import { KpiCards } from "@/components/analytics/KpiCards";
import { PnlChart } from "@/components/analytics/PnlChart";
import { FunnelChart, TopRepairsChart, MasterLoadChart } from "@/components/analytics/Charts";
import { ServerConversionIntegrationsView } from "@/components/analytics/ServerConversionIntegrationsView";
import { useAnalyticsOverview } from "@/lib/api/use-analytics";
import { Skeleton } from "@/components/shared/Skeleton";

export default function AnalyticsPage() {
  const [activeTab, setActiveTab] = useState<"overview" | "conversions">("overview");
  const { data, isLoading, isError, error, refetch, isFetching } = useAnalyticsOverview();

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#111111]">Аналитика</h1>
          <p className="mt-1 text-sm text-[#666666]">
            Выручка, воронка, ремонты и сквозные серверные конверсии в рекламные каналы
          </p>
        </div>
        {activeTab === "overview" && (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-[#4a38f5]" : "text-[#666666]"}`}
            />
            Обновить
          </button>
        )}
      </div>

      {/* Вкладки: Сводка / Серверные конверсии и пиксели */}
      <div className="flex items-center gap-2 border-b border-[#e5e5e5]">
        <button
          type="button"
          onClick={() => setActiveTab("overview")}
          className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
            activeTab === "overview"
              ? "border-[#4a38f5] text-[#4a38f5]"
              : "border-transparent text-[#666666] hover:text-[#111111]"
          }`}
        >
          <BarChart2 className="h-4 w-4" />
          Сводка показателей
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("conversions")}
          className={`flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors ${
            activeTab === "conversions"
              ? "border-[#4a38f5] text-[#4a38f5]"
              : "border-transparent text-[#666666] hover:text-[#111111]"
          }`}
        >
          <Radio className="h-4 w-4" />
          Серверные конверсии и пиксели
        </button>
      </div>

      {activeTab === "conversions" ? (
        <ServerConversionIntegrationsView />
      ) : (
        <>
          {isLoading && (
            <div className="space-y-6">
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
          )}

          {(isError || !data) && !isLoading && (
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
          )}

          {data && (
            <>
              {/* KPI Cards */}
              <KpiCards
                revenue={data.kpis.revenue}
                revenueChange={data.kpis.revenue_change}
                netProfit={data.kpis.net_profit}
                profitChange={data.kpis.profit_change}
                closedRepairs={data.kpis.closed_repairs}
                repairsChange={data.kpis.repairs_change}
                avgTicket={data.kpis.avg_ticket}
                ticketChange={data.kpis.ticket_change}
              />

              {/* P&L Chart — full width */}
              <PnlChart data={data.pnl} />

              {/* Bottom Grid: Funnel + TopRepairs + MasterLoad */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <FunnelChart data={data.funnel} />
                <TopRepairsChart data={data.top_repairs} />
                <MasterLoadChart data={data.master_load} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
