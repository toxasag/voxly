/**
 * Flush Twenty workspace Redis flat-map cache (INC-086).
 * After SQL view/nav/metadata fixes the SPA can show a blank kanban while PG is correct.
 */
import IORedis from 'ioredis';
import pg from 'pg';

export async function flushTwentyWorkspaceRedisCache(
  workspaceId: string,
): Promise<{ keysDeleted: number; metadataVersion: number | null }> {
  const redisUrl = process.env.REDIS_URL?.trim() || 'redis://localhost:6379';
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: 1 });
  let keysDeleted = 0;

  try {
    const patterns = [
      `engine:workspace:flat-maps:*:${workspaceId}*`,
      `*${workspaceId}*flat-map*`,
    ];

    for (const pattern of patterns) {
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          keysDeleted += await redis.del(...keys);
        }
      } while (cursor !== '0');
    }
  } finally {
    await redis.quit().catch(() => undefined);
  }

  let metadataVersion: number | null = null;
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (connectionString) {
    const client = new pg.Client({ connectionString });
    await client.connect();
    try {
      const bumped = await client.query<{ metadataVersion: number }>(
        `UPDATE core.workspace
         SET "metadataVersion" = "metadataVersion" + 1,
             "updatedAt" = now()
         WHERE id = $1::uuid
         RETURNING "metadataVersion"`,
        [workspaceId],
      );
      metadataVersion = bumped.rows[0]?.metadataVersion ?? null;
    } finally {
      await client.end();
    }
  }

  console.log(
    `[provisioning] redis flush workspace=${workspaceId} keysDeleted=${keysDeleted}`
      + ` metadataVersion=${metadataVersion ?? 'n/a'}`,
  );

  return { keysDeleted, metadataVersion };
}
