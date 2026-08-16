// Auto-update of the voxly-crm-chat app in every provisioned workspace when
// the tarball baked into the saas-api image changes on deploy.
//
// Twenty installs a private-registry app ONCE per workspace (at provisioning
// time) and then serves the built front/logic bundle from its local-storage
// forever. Without this refresh, existing tenants keep a stale chat UI after
// each deploy (e.g. missing write-first channel selector, INC-2026-08-16).

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import IORedis from 'ioredis';
import { prisma } from '@voxly/db';
import { withSchedulerLock } from '../jobs/scheduler-lock.js';
import { refreshCrmChatAppForTenant } from './purge-tenant.js';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const MARKER_KEY = 'voxly:crmchat-app:tarball-sha1';

export type AutoRefreshResult =
  | 'no-tarball'
  | 'skipped'
  | 'ran'
  | 'partial'
  | 'unlocked-error';

/** Pure decision (unit-tested): refresh only when the baked tarball changed. */
export function shouldRefreshApp(
  storedSha1: string | null,
  tarballSha1: string | null,
): boolean {
  if (!tarballSha1) return false;
  return storedSha1 !== tarballSha1;
}

/**
 * Pure outcome (unit-tested): persist the marker only when every workspace
 * reinstall succeeded, so failed tenants retry on the next worker boot.
 */
export function shouldPersistMarker(results: { ok: boolean }[]): boolean {
  return results.length > 0 && results.every((r) => r.ok);
}

export async function readTarballSha1(path: string): Promise<string | null> {
  try {
    const buf = await readFile(path);
    return createHash('sha1').update(buf).digest('hex');
  } catch {
    return null;
  }
}

let markerRedis: IORedis | null = null;

function getMarkerRedis(): IORedis {
  if (!markerRedis) {
    markerRedis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      enableOfflineQueue: false,
    });
  }
  return markerRedis;
}

export async function readInstalledTarballSha1(): Promise<string | null> {
  const redis = getMarkerRedis();
  try {
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => undefined);
    }
    return (await redis.get(MARKER_KEY)) || null;
  } catch {
    // Redis down → treat as unknown; reinstall is idempotent and cheap.
    return null;
  }
}

export async function persistInstalledTarballSha1(sha1: string): Promise<void> {
  const redis = getMarkerRedis();
  try {
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => undefined);
    }
    await redis.set(MARKER_KEY, sha1);
  } catch (err) {
    console.warn(
      '[crmchat-refresh] marker persist failed (will re-run next boot):',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Test helper — closes the lazy Redis connection. */
export async function closeAutoRefreshRedis(): Promise<void> {
  if (markerRedis) {
    await markerRedis.quit().catch(() => undefined);
    markerRedis = null;
  }
}

let running = false;

/**
 * Boot-time hook for saas-worker: when the baked tarball hash differs from the
 * last successfully installed one, force-reinstall the CRM chat app in every
 * provisioned workspace. Guarded by a scheduler lock so replicas don't stampede.
 */
export async function refreshCrmChatAppsIfTarballChanged(): Promise<AutoRefreshResult> {
  if (running) return 'skipped';
  const tarballPath = process.env.VOXLY_CRM_CHAT_TARBALL?.trim();
  if (!tarballPath) return 'no-tarball';

  const tarballSha1 = await readTarballSha1(tarballPath);
  if (!tarballSha1) {
    console.warn(`[crmchat-refresh] tarball not readable at ${tarballPath}, skip`);
    return 'no-tarball';
  }

  const stored = await readInstalledTarballSha1();
  if (!shouldRefreshApp(stored, tarballSha1)) {
    console.log('[crmchat-refresh] tarball unchanged since last install, skip');
    return 'skipped';
  }
  console.log(
    `[crmchat-refresh] tarball changed (${stored ?? 'none'} → ${tarballSha1}), refreshing workspaces`,
  );

  running = true;
  try {
    return await withSchedulerLock('crmchat-app-refresh', 900, async () => {
      const tenants = await prisma.tenant.findMany({
        where: {
          twentyWorkspaceId: { not: null },
          twentyOwnerPasswordEncrypted: { not: null },
        },
        select: { id: true, slug: true },
      });

      const results: { ok: boolean }[] = [];
      for (const tenant of tenants) {
        try {
          await refreshCrmChatAppForTenant({ tenantId: tenant.id });
          results.push({ ok: true });
          console.log(`[crmchat-refresh] OK ${tenant.slug}`);
        } catch (err) {
          results.push({ ok: false });
          console.error(
            `[crmchat-refresh] FAIL ${tenant.slug}:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      }

      if (shouldPersistMarker(results)) {
        await persistInstalledTarballSha1(tarballSha1);
        console.log(`[crmchat-refresh] all ${results.length} workspaces updated`);
      } else {
        console.warn(
          '[crmchat-refresh] partial failure — marker NOT persisted, will retry next boot',
        );
      }
    });
  } finally {
    running = false;
  }
}
