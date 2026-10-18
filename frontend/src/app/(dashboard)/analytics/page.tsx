"use client";

import { KpiCards } from "@/components/analytics/KpiCards";
import { PnlChart } from "@/components/analytics/PnlChart";
import { FunnelChart, TopRepairsChart, MasterLoadChart } from "@/components/analytics/Charts";
import {
  MOCK_KPIS,
  MOCK_PNL_DATA,
  MOCK_FUNNEL,
  MOCK_TOP_REPAIRS,
  MOCK_MASTER_LOAD,
} from "@/lib/analytics/mock-analytics";

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-bold text-[#111111]">Аналитика</h1>
        <p className="mt-1 text-sm text-[#666666]">
          Выручка, воронка, ремонты и эффективность команды
        </p>
      </div>

      {/* KPI Cards */}
      <KpiCards
        revenue={MOCK_KPIS.revenue}
        revenueChange={MOCK_KPIS.revenue_change}
        netProfit={MOCK_KPIS.net_profit}
        profitChange={MOCK_KPIS.profit_change}
        closedRepairs={MOCK_KPIS.closed_repairs}
        repairsChange={MOCK_KPIS.repairs_change}
        avgTicket={MOCK_KPIS.avg_ticket}
        ticketChange={MOCK_KPIS.ticket_change}
      />

      {/* P&L Chart — full width */}
      <PnlChart data={MOCK_PNL_DATA} />

      {/* Bottom Grid: Funnel + TopRepairs + MasterLoad */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FunnelChart data={MOCK_FUNNEL} />
        <TopRepairsChart data={MOCK_TOP_REPAIRS} />
        <MasterLoadChart data={MOCK_MASTER_LOAD} />
      </div>
    </div>
  );
}