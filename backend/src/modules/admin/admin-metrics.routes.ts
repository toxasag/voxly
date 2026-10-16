import type { FastifyInstance } from "fastify";
import { queryOne } from "../../db/client.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";

interface CountsRow {
  tenants_total: string;
  tenants_active: string;
  tenants_trial: string;
  tenants_suspended: string;
  users_total: string;
  contacts_total: string;
  deals_total: string;
  repair_orders_total: string;
  messages_total: string;
}

interface DbStatsRow {
  db_size: string;
  connections: string;
  uptime_seconds: string;
}

function toInt(value: string): number {
  return Number(value);
}

/**
 * Платформенные метрики для superadmin-панели, /api/v1/admin/metrics.
 *
 * Очередь сообщений (BullMQ) в стеке ещё нет — как только появится, её
 * глубина добавится сюда тем же конвертом; пока панель показывает «n/a».
 */
export default async function adminMetricsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const platformOwner = app.requirePlatformOwner();

  app.get("/metrics", { onRequest: platformOwner }, async (_request, reply) => {
    const counts = await queryOne<CountsRow>(`
      SELECT
        (SELECT count(*) FROM tenants) AS tenants_total,
        (SELECT count(*) FROM tenants WHERE status = 'active') AS tenants_active,
        (SELECT count(*) FROM tenants WHERE status = 'trial') AS tenants_trial,
        (SELECT count(*) FROM tenants WHERE status = 'suspended') AS tenants_suspended,
        (SELECT count(*) FROM users) AS users_total,
        (SELECT count(*) FROM contacts) AS contacts_total,
        (SELECT count(*) FROM deals) AS deals_total,
        (SELECT count(*) FROM repair_orders) AS repair_orders_total,
        (SELECT count(*) FROM deal_messages) AS messages_total
    `);

    const dbStats = await queryOne<DbStatsRow>(`
      SELECT
        pg_database_size(current_database())::text AS db_size,
        (SELECT count(*)::text FROM pg_stat_activity WHERE datname = current_database()) AS connections,
        (EXTRACT(EPOCH FROM now() - pg_postmaster_start_time()))::bigint::text AS uptime_seconds
    `);

    if (counts === null || dbStats === null) {
      return reply.status(500).send({ error: { code: "INTERNAL", message: "Metrics unavailable" } });
    }

    return reply.send({
      data: {
        counts: {
          tenants_total: toInt(counts.tenants_total),
          tenants_active: toInt(counts.tenants_active),
          tenants_trial: toInt(counts.tenants_trial),
          tenants_suspended: toInt(counts.tenants_suspended),
          users_total: toInt(counts.users_total),
          contacts_total: toInt(counts.contacts_total),
          deals_total: toInt(counts.deals_total),
          repair_orders_total: toInt(counts.repair_orders_total),
          messages_total: toInt(counts.messages_total),
        },
        database: {
          size_bytes: toInt(dbStats.db_size),
          connections: toInt(dbStats.connections),
          uptime_seconds: toInt(dbStats.uptime_seconds),
        },
        // Физической очереди (BullMQ/Redis) в стеке нет — M6.x. Поле держит
        // форму конверта, чтобы фронт не менялся при её появлении.
        queue: {
          implemented: false,
          pending: 0,
          failed: 0,
        },
        generated_at: new Date().toISOString(),
      },
    });
  });
}
