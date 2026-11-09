import { query, queryOne, runWithPlatformScope, runWithTenantContext } from "../../db/client.js";
import type { FastifyBaseLogger } from "fastify";

// ---------------------------------------------------------------------------
// DTOs & Интерфейсы аналитики онлайн-виджетов
// ---------------------------------------------------------------------------

export type WidgetEventType = "VISIT" | "WIDGET_OPEN" | "CHAT_START" | "LEAD_CAPTURED";

export interface TrackWidgetEventInput {
  widgetId: string;
  sessionId: string;
  visitorId: string;
  eventType: WidgetEventType;
  metadata?: Record<string, unknown>;
}

export interface WidgetFunnelStageDTO {
  key: "visit" | "open" | "chat" | "lead" | "won";
  label: string;
  count: number;
  conversionRateToPrevious: number; // % от предыдущего этапа
  conversionRateToFirst: number; // % от посетителей (сквозная конверсия)
  dropOffCount: number;
  dropOffRate: number; // % отвала
}

export interface WidgetDailyDynamicDTO {
  date: string; // YYYY-MM-DD
  visitors: number;
  opens: number;
  chats: number;
  leads: number;
  won: number;
  revenue: number;
}

export interface WidgetFunnelStatsDTO {
  widgetId: string;
  widgetLabel: string;
  siteDomain: string;
  period: string;
  startDate: string;
  endDate: string;
  stages: WidgetFunnelStageDTO[];
  summary: {
    totalVisitors: number;
    totalOpens: number;
    totalChats: number;
    totalLeads: number;
    totalWonDeals: number;
    totalWonRevenue: number;
    overallConversionRate: number;
  };
  daily: WidgetDailyDynamicDTO[];
}

export interface GetWidgetFunnelQuery {
  tenantId: string;
  widgetId: string;
  period?: "today" | "7d" | "30d" | "all" | "custom";
  from?: string;
  to?: string;
}

export class WidgetAnalyticsService {
  constructor(private readonly log?: FastifyBaseLogger) {}

  /**
   * Публичный трекинг событий воронки виджета (с сайта клиента).
   * Вызывается анонимно через sendBeacon / fetch без cookie авторизации.
   */
  async trackPublicEvent(input: TrackWidgetEventInput): Promise<{ success: boolean; id?: string }> {
    const { widgetId, sessionId, visitorId, eventType, metadata = {} } = input;

    // Валидация существования виджета и получение tenant_id (через platform_scope для анонимного запроса)
    const account = await runWithPlatformScope(() =>
      queryOne<{ id: string; tenant_id: string }>(
        `SELECT id, tenant_id FROM channel_accounts
         WHERE (id::text = $1 OR external_id = $1 OR label = $1)
           AND channel = 'webchat'
           AND deleted_at IS NULL
           AND status = 'connected'
         LIMIT 1`,
        [widgetId],
      ),
    );

    if (!account) {
      this.log?.warn({ widgetId, eventType }, "[WIDGET_ANALYTICS] Widget account not found or inactive");
      return { success: false };
    }

    try {
      const res = await runWithTenantContext(account.tenant_id, async () => {
        return queryOne<{ id: string }>(
          `INSERT INTO widget_analytics_events
             (tenant_id, widget_id, session_id, visitor_id, event_type, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, now())
           ON CONFLICT (widget_id, session_id, event_type) DO UPDATE
             SET metadata = widget_analytics_events.metadata || EXCLUDED.metadata
           RETURNING id`,
          [
            account.tenant_id,
            account.id,
            sessionId.trim(),
            visitorId.trim(),
            eventType,
            JSON.stringify(metadata),
          ],
        );
      });

      return { success: true, id: res?.id };
    } catch (err) {
      this.log?.error(
        { err, widgetId, eventType, sessionId },
        "[WIDGET_ANALYTICS] Failed to record event",
      );
      return { success: false };
    }
  }

  /**
   * Расчет полной 5-ступенчатой воронки конверсий для конкретного виджета:
   * 1. Посетители (VISIT)
   * 2. Запуски виджета (WIDGET_OPEN)
   * 3. Начатые диалоги (CHAT_START)
   * 4. Заявки / Лиды (LEAD_CAPTURED)
   * 5. Продажи / Выигранные сделки (WON)
   */
  async getWidgetFunnelStats(queryInput: GetWidgetFunnelQuery): Promise<WidgetFunnelStatsDTO> {
    const { tenantId, widgetId, period = "30d", from, to } = queryInput;

    // 1. Проверяем наличие виджета в рамках арендатора
    const widget = await queryOne<{ id: string; label: string; external_id: string }>(
      `SELECT id, label, external_id
       FROM channel_accounts
       WHERE id = $1 AND tenant_id = $2 AND channel = 'webchat'
       LIMIT 1`,
      [widgetId, tenantId],
    );

    if (!widget) {
      throw new Error("Виджет не найден");
    }

    // 2. Границы дат
    const now = new Date();
    let startDate: Date;
    let endDate: Date = now;

    if (period === "today") {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    } else if (period === "7d") {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === "30d") {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === "all") {
      startDate = new Date("2020-01-01T00:00:00.000Z");
    } else if (period === "custom" && from && to) {
      startDate = new Date(from);
      endDate = new Date(to);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        endDate = now;
      }
    } else {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // 3. Агрегация событий воронки по этапам 1-4 из widget_analytics_events
    const eventCounts = await queryOne<{
      visitors: string;
      opens: string;
      chats: string;
      leads: string;
    }>(
      `SELECT
         COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'VISIT') AS visitors,
         COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'WIDGET_OPEN') AS opens,
         COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'CHAT_START') AS chats,
         COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'LEAD_CAPTURED') AS leads
       FROM widget_analytics_events
       WHERE tenant_id = $1 AND widget_id = $2
         AND created_at >= $3 AND created_at <= $4`,
      [tenantId, widgetId, startDate.toISOString(), endDate.toISOString()],
    );

    // Дополнительно учитываем сделки и контакты, созданные через веб-чат в CRM
    const crmLeads = await queryOne<{ crm_leads_count: string }>(
      `SELECT COUNT(DISTINCT d.id) AS crm_leads_count
       FROM deals d
       WHERE d.tenant_id = $1
         AND (d.source_widget_id = $2 OR EXISTS (
           SELECT 1 FROM deal_messages dm
           WHERE dm.tenant_id = $1 AND dm.deal_id = d.id AND dm.channel_account_id = $2
         ))
         AND d.created_at >= $3 AND d.created_at <= $4`,
      [tenantId, widgetId, startDate.toISOString(), endDate.toISOString()],
    );

    let rawVisitors = Number(eventCounts?.visitors ?? 0);
    let rawOpens = Number(eventCounts?.opens ?? 0);
    let rawChats = Number(eventCounts?.chats ?? 0);
    let rawLeads = Math.max(Number(eventCounts?.leads ?? 0), Number(crmLeads?.crm_leads_count ?? 0));

    // Обеспечение логической монотонности воронки (если клиент сразу написал или оставил лид)
    if (rawChats < rawLeads) rawChats = rawLeads;
    if (rawOpens < rawChats) rawOpens = rawChats;
    if (rawVisitors < rawOpens) rawVisitors = rawOpens;

    // 4. Этап 5: Продажи / Выигранные сделки в CRM
    const wonData = await queryOne<{ won_count: string; won_revenue: string }>(
      `SELECT
         COUNT(DISTINCT d.id) AS won_count,
         COALESCE(SUM(d.budget), 0) AS won_revenue
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1
         AND (d.source_widget_id = $2 OR EXISTS (
           SELECT 1 FROM deal_messages dm
           WHERE dm.tenant_id = $1 AND dm.deal_id = d.id AND dm.channel_account_id = $2
         ))
         AND s.is_won = true
         AND d.created_at >= $3 AND d.created_at <= $4`,
      [tenantId, widgetId, startDate.toISOString(), endDate.toISOString()],
    );

    const rawWon = Number(wonData?.won_count ?? 0);
    const wonRevenue = Number(wonData?.won_revenue ?? 0);

    // 5. Расчет метрик и конверсий по этапам
    const calcCr = (num: number, denom: number): number => {
      if (denom <= 0) return 0;
      return Math.round((num / denom) * 1000) / 10; // округление до 1 знака после запятой
    };

    const stages: WidgetFunnelStageDTO[] = [
      {
        key: "visit",
        label: "Посетители сайта",
        count: rawVisitors,
        conversionRateToPrevious: 100,
        conversionRateToFirst: 100,
        dropOffCount: Math.max(0, rawVisitors - rawOpens),
        dropOffRate: calcCr(Math.max(0, rawVisitors - rawOpens), rawVisitors),
      },
      {
        key: "open",
        label: "Запуски виджета",
        count: rawOpens,
        conversionRateToPrevious: calcCr(rawOpens, rawVisitors),
        conversionRateToFirst: calcCr(rawOpens, rawVisitors),
        dropOffCount: Math.max(0, rawOpens - rawChats),
        dropOffRate: calcCr(Math.max(0, rawOpens - rawChats), rawOpens),
      },
      {
        key: "chat",
        label: "Начатые диалоги",
        count: rawChats,
        conversionRateToPrevious: calcCr(rawChats, rawOpens),
        conversionRateToFirst: calcCr(rawChats, rawVisitors),
        dropOffCount: Math.max(0, rawChats - rawLeads),
        dropOffRate: calcCr(Math.max(0, rawChats - rawLeads), rawChats),
      },
      {
        key: "lead",
        label: "Заявки / Лиды",
        count: rawLeads,
        conversionRateToPrevious: calcCr(rawLeads, rawChats),
        conversionRateToFirst: calcCr(rawLeads, rawVisitors),
        dropOffCount: Math.max(0, rawLeads - rawWon),
        dropOffRate: calcCr(Math.max(0, rawLeads - rawWon), rawLeads),
      },
      {
        key: "won",
        label: "Продажи / Успешно",
        count: rawWon,
        conversionRateToPrevious: calcCr(rawWon, rawLeads),
        conversionRateToFirst: calcCr(rawWon, rawVisitors),
        dropOffCount: 0,
        dropOffRate: 0,
      },
    ];

    // 6. Динамика по дням (time-series)
    // Ограничиваем интервал для generate_series максимум 90 днями
    const maxDaysAgo = new Date(endDate.getTime() - 90 * 24 * 60 * 60 * 1000);
    const effectiveSeriesStart = startDate < maxDaysAgo ? maxDaysAgo : startDate;

    const dailyRows = await query<{
      date: string;
      visitors: number;
      opens: number;
      chats: number;
      leads: number;
      won: number;
      revenue: string;
    }>(
      `WITH dates AS (
         SELECT generate_series(
           date_trunc('day', $3::timestamptz),
           date_trunc('day', $4::timestamptz),
           interval '1 day'
         )::date AS day
       ),
       events_daily AS (
         SELECT
           date_trunc('day', created_at)::date AS day,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'VISIT') AS visitors,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'WIDGET_OPEN') AS opens,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'CHAT_START') AS chats,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'LEAD_CAPTURED') AS leads
         FROM widget_analytics_events
         WHERE tenant_id = $1 AND widget_id = $2
           AND created_at >= $3 AND created_at <= $4
         GROUP BY date_trunc('day', created_at)::date
       ),
       deals_daily AS (
         SELECT
           date_trunc('day', d.created_at)::date AS day,
           COUNT(DISTINCT d.id) AS crm_leads
         FROM deals d
         WHERE d.tenant_id = $1
           AND (d.source_widget_id = $2 OR EXISTS (
             SELECT 1 FROM deal_messages dm
             WHERE dm.tenant_id = $1 AND dm.deal_id = d.id AND dm.channel_account_id = $2
           ))
           AND d.created_at >= $3 AND d.created_at <= $4
         GROUP BY date_trunc('day', d.created_at)::date
       ),
       won_daily AS (
         SELECT
           date_trunc('day', d.created_at)::date AS day,
           COUNT(DISTINCT d.id) AS won,
           COALESCE(SUM(d.budget), 0) AS revenue
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE d.tenant_id = $1
           AND (d.source_widget_id = $2 OR EXISTS (
             SELECT 1 FROM deal_messages dm
             WHERE dm.tenant_id = $1 AND dm.deal_id = d.id AND dm.channel_account_id = $2
           ))
           AND s.is_won = true
           AND d.created_at >= $3 AND d.created_at <= $4
         GROUP BY date_trunc('day', d.created_at)::date
       )
       SELECT
         to_char(dt.day, 'YYYY-MM-DD') AS date,
         COALESCE(e.visitors, 0)::int AS visitors,
         COALESCE(e.opens, 0)::int AS opens,
         COALESCE(e.chats, 0)::int AS chats,
         GREATEST(COALESCE(e.leads, 0), COALESCE(dl.crm_leads, 0))::int AS leads,
         COALESCE(w.won, 0)::int AS won,
         COALESCE(w.revenue, 0)::numeric AS revenue
       FROM dates dt
       LEFT JOIN events_daily e ON e.day = dt.day
       LEFT JOIN deals_daily dl ON dl.day = dt.day
       LEFT JOIN won_daily w ON w.day = dt.day
       ORDER BY dt.day ASC`,
      [tenantId, widgetId, effectiveSeriesStart.toISOString(), endDate.toISOString()],
    );

    const daily: WidgetDailyDynamicDTO[] = dailyRows.map((r) => ({
      date: r.date,
      visitors: Number(r.visitors),
      opens: Number(r.opens),
      chats: Number(r.chats),
      leads: Number(r.leads),
      won: Number(r.won),
      revenue: Number(r.revenue),
    }));

    return {
      widgetId,
      widgetLabel: widget.label,
      siteDomain: widget.external_id,
      period,
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      stages,
      summary: {
        totalVisitors: rawVisitors,
        totalOpens: rawOpens,
        totalChats: rawChats,
        totalLeads: rawLeads,
        totalWonDeals: rawWon,
        totalWonRevenue: wonRevenue,
        overallConversionRate: calcCr(rawWon, rawVisitors),
      },
      daily,
    };
  }
}
