/**
 * Per-tenant storage + platform resource snapshot for superadmin CRM page.
 * Disk per tenant is measured (Twenty schema + control plane + AI files).
 * RAM is platform-wide only — no per-tenant measurement (shared Docker/Postgres stack).
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { Prisma, type PrismaClient } from '@voxly/db';

export type PlatformResources = {
  collectedAt: string;
  memory: {
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
  };
  disk: {
    mountPath: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
  };
};

export type TenantResourceUsage = {
  tenantId: string;
  slug: string;
  diskBytes: number;
  diskBreakdown: {
    twentySchemaBytes: number;
    controlPlaneBytes: number;
    knowledgeFilesBytes: number;
  };
  /** Share of platform disk total (tenant data / host volume) */
  diskPercentOfPlatform: number;
};

export type TenantResourcesPayload = {
  platform: PlatformResources;
  tenants: TenantResourceUsage[];
  totals: {
    tenantsDiskBytes: number;
  };
};

async function readLinuxMemory(): Promise<PlatformResources['memory']> {
  try {
    const { readFile } = await import('node:fs/promises');
    const meminfo = await readFile('/proc/meminfo', 'utf8');
    const kb = (key: string) => {
      const m = new RegExp(`${key}:\\s+(\\d+)`).exec(meminfo);
      return m ? parseInt(m[1], 10) * 1024 : 0;
    };
    const totalBytes = kb('MemTotal');
    const availableBytes = kb('MemAvailable') || kb('MemFree');
    const usedBytes = Math.max(0, totalBytes - availableBytes);
    return { totalBytes, usedBytes, availableBytes };
  } catch {
    return { totalBytes: 0, usedBytes: 0, availableBytes: 0 };
  }
}

async function readDiskUsage(mountPath: string): Promise<PlatformResources['disk']> {
  try {
    const { statfs } = await import('node:fs/promises');
    const s = await statfs(mountPath);
    const totalBytes = s.blocks * s.bsize;
    const freeBytes = s.bavail * s.bsize;
    const usedBytes = Math.max(0, totalBytes - freeBytes);
    return { mountPath, totalBytes, usedBytes, freeBytes };
  } catch {
    return { mountPath, totalBytes: 0, usedBytes: 0, freeBytes: 0 };
  }
}

async function dirSizeBytes(root: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(root, ent.name);
      if (ent.isDirectory()) {
        total += await dirSizeBytes(p);
      } else if (ent.isFile()) {
        const st = await stat(p);
        total += st.size;
      }
    }
  } catch {
    /* missing dir */
  }
  return total;
}

async function fetchTwentySchemaSizes(
  workspaceIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (workspaceIds.length === 0) return result;

  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) return result;

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const rows = await client.query<{ workspace_id: string; schema_bytes: string }>(
      `SELECT w.id AS workspace_id,
              COALESCE((
                SELECT SUM(pg_total_relation_size(format('%I.%I', ns.nspname, cls.relname)::regclass))
                FROM pg_class cls
                JOIN pg_namespace ns ON ns.oid = cls.relnamespace
                WHERE ns.nspname = w."databaseSchema"
                  AND cls.relkind IN ('r', 'm', 'i', 't', 'f', 'p')
              ), 0)::bigint AS schema_bytes
       FROM core.workspace w
       WHERE w.id = ANY($1::uuid[])
         AND w."databaseSchema" IS NOT NULL`,
      [workspaceIds],
    );
    for (const row of rows.rows) {
      result.set(row.workspace_id, Number(row.schema_bytes) || 0);
    }
  } finally {
    await client.end();
  }
  return result;
}

async function fetchControlPlaneSizes(
  prisma: PrismaClient,
  tenantIds: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (tenantIds.length === 0) return map;

  const rows = await prisma.$queryRaw<
    Array<{ tenant_id: string; control_bytes: bigint }>
  >`
    SELECT t.id AS tenant_id,
      (
        COALESCE((
          SELECT SUM(octet_length(m.content))
          FROM "ChatMessage" m
          JOIN "Conversation" c ON c.id = m."conversationId"
          WHERE c."tenantId" = t.id
        ), 0)
        + COALESCE((
          SELECT SUM(octet_length(COALESCE(m.attachments::text, '')))
          FROM "ChatMessage" m
          JOIN "Conversation" c ON c.id = m."conversationId"
          WHERE c."tenantId" = t.id
        ), 0)
        + COALESCE((
          SELECT SUM("sizeBytes") FROM "AiKnowledgeFile" WHERE "tenantId" = t.id
        ), 0)
        + COALESCE((
          SELECT COUNT(*) * 512 FROM "GiftSubscriber" WHERE "tenantId" = t.id
        ), 0)
        + COALESCE((
          SELECT COUNT(*) * 256 FROM "TenantMember" WHERE "tenantId" = t.id
        ), 0)
      )::bigint AS control_bytes
    FROM "Tenant" t
    WHERE t.id IN (${Prisma.join(tenantIds.map((id) => Prisma.sql`${id}`))})
  `;

  for (const row of rows) {
    map.set(row.tenant_id, Number(row.control_bytes) || 0);
  }
  return map;
}

function formatBytesHuman(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

export { formatBytesHuman };

export async function collectTenantResourceUsage(
  prisma: PrismaClient,
): Promise<TenantResourcesPayload> {
  const knowledgeRoot = process.env.AI_KNOWLEDGE_DIR || '/voxly/data/ai-knowledge';
  const diskMount = process.env.VOXLY_DISK_MOUNT || '/';

  const [platformMem, platformDisk, tenants] = await Promise.all([
    readLinuxMemory(),
    readDiskUsage(diskMount),
    prisma.tenant.findMany({
      where: { twentyWorkspaceId: { not: null } },
      select: { id: true, slug: true, twentyWorkspaceId: true },
      orderBy: { slug: 'asc' },
    }),
  ]);

  const tenantIds = tenants.map((t) => t.id);
  const workspaceIds = tenants
    .map((t) => t.twentyWorkspaceId)
    .filter((id): id is string => Boolean(id));

  const [twentySizes, controlSizes] = await Promise.all([
    fetchTwentySchemaSizes(workspaceIds),
    fetchControlPlaneSizes(prisma, tenantIds),
  ]);

  const knowledgeSizes = new Map<string, number>();
  await Promise.all(
    tenants.map(async (t) => {
      const bytes = await dirSizeBytes(path.join(knowledgeRoot, t.id));
      knowledgeSizes.set(t.id, bytes);
    }),
  );

  const tenantRows: TenantResourceUsage[] = tenants.map((t) => {
    const twentySchemaBytes = t.twentyWorkspaceId
      ? twentySizes.get(t.twentyWorkspaceId) ?? 0
      : 0;
    const controlPlaneBytes = controlSizes.get(t.id) ?? 0;
    const knowledgeFilesBytes = knowledgeSizes.get(t.id) ?? 0;
    const diskBytes = twentySchemaBytes + controlPlaneBytes + knowledgeFilesBytes;
    return {
      tenantId: t.id,
      slug: t.slug,
      diskBytes,
      diskBreakdown: {
        twentySchemaBytes,
        controlPlaneBytes,
        knowledgeFilesBytes,
      },
      diskPercentOfPlatform:
        platformDisk.totalBytes > 0
          ? Math.round((diskBytes / platformDisk.totalBytes) * 10000) / 100
          : 0,
    };
  });

  const tenantsDiskBytes = tenantRows.reduce((s, t) => s + t.diskBytes, 0);

  return {
    platform: {
      collectedAt: new Date().toISOString(),
      memory: platformMem,
      disk: platformDisk,
    },
    tenants: tenantRows.sort((a, b) => b.diskBytes - a.diskBytes),
    totals: {
      tenantsDiskBytes,
    },
  };
}
