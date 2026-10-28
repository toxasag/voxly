import { query, runWithPlatformScope, withTenant, type TransactionClient } from "../../db/client.js";

export interface ModulePurgeMaintenanceReport {
  journals: number;
  rows: number;
  skipped: number;
}

interface PendingPurgeRow {
  id: string;
  tenant_id: string;
  slug: string;
}

const DELETE_ORDER: Record<string, readonly string[]> = {
  service_center: ["repair_orders"],
  finance: ["transactions", "invoices", "cash_accounts"],
  telegram: ["channel_accounts"],
  whatsapp: ["channel_accounts"],
  max: ["channel_accounts"],
  avito: ["channel_accounts"],
  instagram: ["channel_accounts"],
};

function channelCondition(slug: string, table: string): { sql: string; params: string[] } {
  return table === "channel_accounts"
    ? { sql: " AND channel = $2", params: [slug] }
    : { sql: "", params: [] };
}

async function purgeJournal(tx: TransactionClient, row: PendingPurgeRow): Promise<number> {
  const tables = DELETE_ORDER[row.slug];
  if (tables === undefined) return 0;

  let deleted = 0;
  for (const table of tables) {
    const condition = channelCondition(row.slug, table);
    const params: string[] = [row.tenant_id, ...condition.params];
    const rows = await tx.query<{ id: string }>(
      `DELETE FROM ${table}
       WHERE tenant_id = $1 AND deleted_at IS NOT NULL${condition.sql}
       RETURNING id`,
      params,
    );
    deleted += rows.length;
  }

  await tx.query(
    `UPDATE module_data_purges
     SET purged_at = now()
     WHERE id = $1 AND restored_at IS NULL AND purged_at IS NULL`,
    [row.id],
  );
  return deleted;
}

/** Окончательно удаляет мягко скрытые данные после 30-дневного окна. */
export async function runModuleDataPurgeMaintenance(): Promise<ModulePurgeMaintenanceReport> {
  const pending = await runWithPlatformScope(() => query<PendingPurgeRow>(
    `SELECT id, tenant_id, slug
     FROM module_data_purges
     WHERE restored_at IS NULL AND purged_at IS NULL
       AND purge_after <= now()
     ORDER BY purge_after ASC
     LIMIT 100`,
  ));

  let rows = 0;
  let journals = 0;
  let skipped = 0;

  for (const journal of pending) {
    const deleted = await withTenant(journal.tenant_id, async (tx) => purgeJournal(tx, journal));
    if (DELETE_ORDER[journal.slug] === undefined) {
      skipped += 1;
    } else {
      journals += 1;
      rows += deleted;
    }
  }

  return { journals, rows, skipped };
}

interface MaintenanceLogger {
  info: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

const INTERVAL_MS = 24 * 60 * 60 * 1000;
const INITIAL_DELAY_MS = 60_000;

export function scheduleModuleDataPurgeMaintenance(log: MaintenanceLogger): () => void {
  let stopped = false;
  let interval: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      const report = await runModuleDataPurgeMaintenance();
      log.info(report, "Module data purge maintenance completed");
    } catch (error) {
      log.error({ error }, "Module data purge maintenance failed");
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
