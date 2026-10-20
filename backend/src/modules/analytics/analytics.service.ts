import { query, queryOne } from "../../db/client.js";
import type {
  AnalyticsKpiDTO,
  AnalyticsOverviewDTO,
  FunnelStepDTO,
  MasterLoadDTO,
  MonthlyPnLDTO,
  TopRepairDefectDTO,
} from "./analytics.types.js";

const MONTH_NAMES = [
  "Янв",
  "Фев",
  "Мар",
  "Апр",
  "Май",
  "Июн",
  "Июл",
  "Авг",
  "Сен",
  "Окт",
  "Ноя",
  "Дек",
];

export class AnalyticsService {
  async getOverview(tenantId: string): Promise<AnalyticsOverviewDTO> {
    const [kpis, pnl, funnel, topRepairs, masterLoad] = await Promise.all([
      this.getKpis(tenantId),
      this.getPnl(tenantId),
      this.getFunnel(tenantId),
      this.getTopRepairs(tenantId),
      this.getMasterLoad(tenantId),
    ]);

    return {
      kpis,
      pnl,
      funnel,
      top_repairs: topRepairs,
      master_load: masterLoad,
    };
  }

  private async getKpis(tenantId: string): Promise<AnalyticsKpiDTO> {
    // 1. Выручка из оплаченных счетов за текущий месяц
    interface RevenueRow {
      curr_rev: string | null;
      prev_rev: string | null;
      curr_cnt: string;
      prev_cnt: string;
    }

    const revRow = await queryOne<RevenueRow>(
      `SELECT
         COALESCE(SUM(CASE WHEN issue_date >= date_trunc('month', CURRENT_DATE) THEN total END), 0) AS curr_rev,
         COALESCE(SUM(CASE WHEN issue_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
                            AND issue_date < date_trunc('month', CURRENT_DATE) THEN total END), 0) AS prev_rev,
         COUNT(CASE WHEN issue_date >= date_trunc('month', CURRENT_DATE) THEN 1 END) AS curr_cnt,
         COUNT(CASE WHEN issue_date >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
                         AND issue_date < date_trunc('month', CURRENT_DATE) THEN 1 END) AS prev_cnt
       FROM invoices
       WHERE tenant_id = $1 AND status = 'paid'`,
      [tenantId],
    );

    const currRev = Number(revRow?.curr_rev ?? 0);
    const prevRev = Number(revRow?.prev_rev ?? 0);
    const currInvoicesCount = Number(revRow?.curr_cnt ?? 0);
    const prevInvoicesCount = Number(revRow?.prev_cnt ?? 0);

    // 2. Закрытые ремонты за текущий и прошлый месяцы
    interface RepairsRow {
      curr_closed: string;
      prev_closed: string;
      curr_repair_sum: string | null;
      prev_repair_sum: string | null;
    }

    const repairsRow = await queryOne<RepairsRow>(
      `SELECT
         COUNT(CASE WHEN COALESCE(completed_at, updated_at) >= date_trunc('month', CURRENT_DATE) THEN 1 END) AS curr_closed,
         COUNT(CASE WHEN COALESCE(completed_at, updated_at) >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
                     AND COALESCE(completed_at, updated_at) < date_trunc('month', CURRENT_DATE) THEN 1 END) AS prev_closed,
         COALESCE(SUM(CASE WHEN COALESCE(completed_at, updated_at) >= date_trunc('month', CURRENT_DATE)
                           THEN COALESCE(final_cost, estimated_cost, 0) END), 0) AS curr_repair_sum,
         COALESCE(SUM(CASE WHEN COALESCE(completed_at, updated_at) >= date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
                           AND COALESCE(completed_at, updated_at) < date_trunc('month', CURRENT_DATE)
                           THEN COALESCE(final_cost, estimated_cost, 0) END), 0) AS prev_repair_sum
       FROM repair_orders
       WHERE tenant_id = $1 AND status IN ('ready', 'issued')`,
      [tenantId],
    );

    const currClosedRepairs = Number(repairsRow?.curr_closed ?? 0);
    const prevClosedRepairs = Number(repairsRow?.prev_closed ?? 0);
    const currRepairSum = Number(repairsRow?.curr_repair_sum ?? 0);
    const prevRepairSum = Number(repairsRow?.prev_repair_sum ?? 0);

    // Если выручка по счетам 0, но есть выполненные ремонты, берём сумму ремонтов
    const totalCurrentRevenue = currRev > 0 ? currRev : currRepairSum;
    const totalPrevRevenue = prevRev > 0 ? prevRev : prevRepairSum;

    const revenueChange =
      totalPrevRevenue > 0
        ? Number((((totalCurrentRevenue - totalPrevRevenue) / totalPrevRevenue) * 100).toFixed(1))
        : totalCurrentRevenue > 0
          ? 100
          : 0;

    // Чистая прибыль (оценка ~35% маржи сервисного бизнеса)
    const netProfit = Math.round(totalCurrentRevenue * 0.35);
    const prevNetProfit = Math.round(totalPrevRevenue * 0.35);
    const profitChange =
      prevNetProfit > 0
        ? Number((((netProfit - prevNetProfit) / prevNetProfit) * 100).toFixed(1))
        : netProfit > 0
          ? 100
          : 0;

    const repairsChange =
      prevClosedRepairs > 0
        ? Number((((currClosedRepairs - prevClosedRepairs) / prevClosedRepairs) * 100).toFixed(1))
        : currClosedRepairs > 0
          ? 100
          : 0;

    // Средний чек
    const operationsCount = currInvoicesCount > 0 ? currInvoicesCount : currClosedRepairs;
    const prevOperationsCount = prevInvoicesCount > 0 ? prevInvoicesCount : prevClosedRepairs;
    const avgTicket = operationsCount > 0 ? Math.round(totalCurrentRevenue / operationsCount) : 0;
    const prevAvgTicket =
      prevOperationsCount > 0 ? Math.round(totalPrevRevenue / prevOperationsCount) : 0;
    const ticketChange =
      prevAvgTicket > 0
        ? Number((((avgTicket - prevAvgTicket) / prevAvgTicket) * 100).toFixed(1))
        : avgTicket > 0
          ? 100
          : 0;

    return {
      revenue: totalCurrentRevenue,
      revenue_change: revenueChange,
      net_profit: netProfit,
      profit_change: profitChange,
      closed_repairs: currClosedRepairs,
      repairs_change: repairsChange,
      avg_ticket: avgTicket,
      ticket_change: ticketChange,
    };
  }

  private async getPnl(tenantId: string): Promise<MonthlyPnLDTO[]> {
    interface PnlRow {
      month_date: string;
      month_idx: number;
      revenue: string | null;
      repair_revenue: string | null;
    }

    const rows = await query<PnlRow>(
      `WITH months AS (
         SELECT generate_series(
           date_trunc('month', CURRENT_DATE - INTERVAL '5 months'),
           date_trunc('month', CURRENT_DATE),
           '1 month'::interval
         ) AS m
       )
       SELECT
         to_char(months.m, 'YYYY-MM') AS month_date,
         EXTRACT(MONTH FROM months.m)::int - 1 AS month_idx,
         COALESCE((
           SELECT SUM(total)
           FROM invoices
           WHERE tenant_id = $1
             AND status = 'paid'
             AND date_trunc('month', issue_date) = months.m
         ), 0) AS revenue,
         COALESCE((
           SELECT SUM(COALESCE(final_cost, estimated_cost, 0))
           FROM repair_orders
           WHERE tenant_id = $1
             AND status IN ('ready', 'issued')
             AND date_trunc('month', COALESCE(completed_at, updated_at)) = months.m
         ), 0) AS repair_revenue
       FROM months
       ORDER BY months.m ASC`,
      [tenantId],
    );

    return rows.map((r) => {
      const invRev = Number(r.revenue ?? 0);
      const repRev = Number(r.repair_revenue ?? 0);
      const rev = invRev > 0 ? invRev : repRev;
      const expenses = Math.round(rev * 0.65);
      const profit = rev - expenses;
      const monthLabel = MONTH_NAMES[r.month_idx] ?? "Мес";

      return {
        month: monthLabel,
        revenue: rev,
        expenses,
        profit,
      };
    });
  }

  private async getFunnel(tenantId: string): Promise<FunnelStepDTO[]> {
    interface StageFunnelRow {
      name: string;
      position: number;
      deals_count: string;
    }

    const rows = await query<StageFunnelRow>(
      `SELECT
         s.name,
         s.position,
         COUNT(d.id)::text AS deals_count
       FROM stages s
       JOIN pipelines p ON p.id = s.pipeline_id AND p.tenant_id = $1
       LEFT JOIN deals d ON d.stage_id = s.id AND d.tenant_id = $1
       WHERE s.tenant_id = $1
       GROUP BY s.id, s.name, s.position
       ORDER BY s.position ASC`,
      [tenantId],
    );

    if (rows.length === 0) {
      return [
        { name: "Новые", count: 0, percentage: 100 },
        { name: "В работе", count: 0, percentage: 0 },
        { name: "Согласование", count: 0, percentage: 0 },
        { name: "Оплата", count: 0, percentage: 0 },
        { name: "Успешно закрыто", count: 0, percentage: 0 },
      ];
    }

    const firstCount = Number(rows[0]?.deals_count ?? 0);

    return rows.map((r) => {
      const count = Number(r.deals_count);
      const percentage = firstCount > 0 ? Math.round((count / firstCount) * 100) : 0;
      return {
        name: r.name,
        count,
        percentage,
      };
    });
  }

  private async getTopRepairs(tenantId: string): Promise<TopRepairDefectDTO[]> {
    interface TopRow {
      name: string;
      count: string;
      avg_cost: string;
    }

    const rows = await query<TopRow>(
      `SELECT
         equipment_type AS name,
         COUNT(id)::text AS count,
         COALESCE(AVG(COALESCE(final_cost, estimated_cost, 0)), 0)::text AS avg_cost
       FROM repair_orders
       WHERE tenant_id = $1
       GROUP BY equipment_type
       ORDER BY COUNT(id) DESC
       LIMIT 5`,
      [tenantId],
    );

    if (rows.length === 0) {
      return [
        { name: "Смартфоны", count: 0, avg_cost: 0 },
        { name: "Ноутбуки", count: 0, avg_cost: 0 },
        { name: "Планшеты", count: 0, avg_cost: 0 },
      ];
    }

    return rows.map((r) => ({
      name: r.name || "Устройство",
      count: Number(r.count),
      avg_cost: Math.round(Number(r.avg_cost)),
    }));
  }

  private async getMasterLoad(tenantId: string): Promise<MasterLoadDTO[]> {
    interface LoadRow {
      name: string;
      active: string;
      completed: string;
    }

    const rows = await query<LoadRow>(
      `SELECT
         u.full_name AS name,
         COUNT(CASE WHEN r.status IN ('intake', 'diagnostic', 'in_progress', 'waiting_parts') THEN 1 END)::text AS active,
         COUNT(CASE WHEN r.status IN ('ready', 'issued') THEN 1 END)::text AS completed
       FROM users u
       JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = $1
       LEFT JOIN repair_orders r ON r.master_id = u.id AND r.tenant_id = $1
       WHERE tu.tenant_id = $1
       GROUP BY u.id, u.full_name
       ORDER BY (COUNT(CASE WHEN r.status IN ('ready', 'issued') THEN 1 END) +
                 COUNT(CASE WHEN r.status IN ('intake', 'diagnostic', 'in_progress', 'waiting_parts') THEN 1 END)) DESC
       LIMIT 5`,
      [tenantId],
    );

    if (rows.length === 0) {
      return [];
    }

    return rows.map((r) => ({
      name: r.name,
      active: Number(r.active),
      completed: Number(r.completed),
    }));
  }
}
