import { query, runWithPlatformScope, transaction } from "../../../db/client.js";

// ---------------------------------------------------------------------------
// Фоновое обслуживание сделок CRM (Deal Maintenance Service).
//
// 1. Автозакрытие сделок на этапе «Первый контакт» по истечении 5 суток (120 часов):
//    Анонимные посетители сайта, начавшие диалог через онлайн-виджет, но не
//    оставившие контактов в течение 5 суток, автоматически закрываются как
//    «Закрыто и не реализовано» (is_lost = true) с системным событием в таймлайне.
// 2. Идемпотентность и защита от дублей: периодическая очистка выполняется
//    в platform_scope для всех тенантов и безопасна при многократном запуске.
// ---------------------------------------------------------------------------

export interface DealMaintenanceReport {
  expiredFirstContactDeals: number;
}

interface MaintenanceLogger {
  info: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

/**
 * Закрывает сделки на этапе «Первый контакт», которые не обновлялись более 5 суток.
 */
export async function expireStaleFirstContactDeals(): Promise<DealMaintenanceReport> {
  return runWithPlatformScope(async () => {
    const staleDeals = await query<{
      id: string;
      tenant_id: string;
      pipeline_id: string;
    }>(
      `SELECT d.id, d.tenant_id, d.pipeline_id
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE s.name = 'Первый контакт'
         AND s.is_won = false
         AND s.is_lost = false
         AND d.deleted_at IS NULL
         AND d.updated_at < now() - INTERVAL '5 days'`,
    );

    let closedCount = 0;

    for (const deal of staleDeals) {
      await transaction(async (tx) => {
        const lostStage = await tx.queryOne<{ id: string }>(
          `SELECT id FROM stages
           WHERE pipeline_id = $1 AND is_lost = true
           ORDER BY sort_order DESC
           LIMIT 1`,
          [deal.pipeline_id],
        );

        if (!lostStage) return;

        await tx.query(
          `UPDATE deals
           SET stage_id = $1, closed_at = now(), updated_at = now()
           WHERE id = $2 AND tenant_id = $3`,
          [lostStage.id, deal.id, deal.tenant_id],
        );

        await tx.query(
          `INSERT INTO deal_messages (tenant_id, deal_id, source, direction, sender_name, content, channel, delivery_status, created_at)
           VALUES ($1, $2, 'system', 'neutral', 'Система', 'Сделка автоматически закрыта: истёк срок ожидания контакта (5 суток без активности).', 'system', 'neutral', now())`,
          [deal.tenant_id, deal.id],
        );

        closedCount++;
      });
    }

    return { expiredFirstContactDeals: closedCount };
  });
}

const INTERVAL_MS = 15 * 60_000; // каждые 15 минут
const INITIAL_DELAY_MS = 10_000; // через 10 секунд после старта сервера

/**
 * Запускает периодическую проверку и автозакрытие просроченных анонимных сделок.
 */
export function scheduleDealMaintenance(log: MaintenanceLogger): () => void {
  let stopped = false;
  let interval: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const report = await expireStaleFirstContactDeals();
      if (report.expiredFirstContactDeals > 0) {
        log.info(report, "Deal maintenance completed: closed stale first-contact deals");
      }
    } catch (error) {
      log.error({ error }, "Deal maintenance failed");
    }
  };

  const initial = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), INTERVAL_MS);
    interval.unref();
  }, INITIAL_DELAY_MS);

  initial.unref();

  return () => {
    stopped = true;
    clearTimeout(initial);
    if (interval !== null) clearInterval(interval);
  };
}
