/**
 * Migrate Person social TEXT fields → LINKS (clickable wa.me / t.me / …).
 * Called after ensureSocialFields / workspace defaults. Never invents t.me/+phone.
 */
import pg from 'pg';

const SOCIAL_FIELDS = [
  'telegram',
  'whatsapp',
  'odnoklassniki',
  'vkontakte',
  'instagram',
  'facebook',
  'threads',
  'website',
] as const;

export async function migratePersonSocialFieldsToLinks(
  workspaceId: string,
): Promise<{ ok: boolean; migrated: string[]; error?: string }> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString || !workspaceId) {
    return { ok: false, migrated: [], error: 'no_db_or_workspace' };
  }
  const client = new pg.Client({ connectionString });
  const migrated: string[] = [];
  try {
    await client.connect();
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
      return { ok: false, migrated: [], error: 'no_schema' };
    }

    for (const fieldName of SOCIAL_FIELDS) {
      const urlCol = `"${fieldName}PrimaryLinkUrl"`;
      const labelCol = `"${fieldName}PrimaryLinkLabel"`;
      const secCol = `"${fieldName}SecondaryLinks"`;
      await client.query(
        `ALTER TABLE "${schema}".person ADD COLUMN IF NOT EXISTS ${urlCol} text`,
      );
      await client.query(
        `ALTER TABLE "${schema}".person ADD COLUMN IF NOT EXISTS ${labelCol} text`,
      );
      await client.query(
        `ALTER TABLE "${schema}".person ADD COLUMN IF NOT EXISTS ${secCol} jsonb`,
      );

      const hasText = await client.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = $1 AND table_name = 'person' AND column_name = $2
         ) AS exists`,
        [schema, fieldName],
      );
      if (!hasText.rows[0]?.exists) {
        // Still flip metadata if TEXT
        await client.query(
          `UPDATE core."fieldMetadata" SET type = 'LINKS'
           WHERE "workspaceId" = $1::uuid AND name = $2 AND type = 'TEXT'`,
          [workspaceId, fieldName],
        );
        migrated.push(fieldName);
        continue;
      }

      if (fieldName === 'whatsapp') {
        await client.query(
          `UPDATE "${schema}".person
           SET ${urlCol} = CASE
             WHEN ${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> '' THEN ${urlCol}
             WHEN whatsapp ~* '^https?://' THEN whatsapp
             WHEN regexp_replace(COALESCE(whatsapp,''), '\\D', '', 'g') ~ '^\\d{10,15}$'
               THEN 'https://wa.me/' || regexp_replace(whatsapp, '\\D', '', 'g')
             ELSE ${urlCol}
           END
           WHERE "deletedAt" IS NULL
             AND (
               (whatsapp IS NOT NULL AND BTRIM(whatsapp) <> '')
               OR (${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> '')
             )`,
        );
        // Visible label = full URL (not generic "WhatsApp").
        await client.query(
          `UPDATE "${schema}".person
           SET ${labelCol} = ${urlCol}
           WHERE "deletedAt" IS NULL
             AND ${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> ''
             AND (
               ${labelCol} IS NULL OR BTRIM(${labelCol}) = ''
               OR lower(BTRIM(${labelCol})) IN ('whatsapp', 'telegram', 'сайт', 'website', 'instagram', 'facebook', 'vkontakte', 'odnoklassniki', 'threads')
               OR ${labelCol} <> ${urlCol}
             )`,
        );
      } else if (fieldName === 'telegram') {
        // Never keep invented t.me/+phone deep-links.
        await client.query(
          `UPDATE "${schema}".person
           SET ${urlCol} = NULL, ${labelCol} = NULL
           WHERE "deletedAt" IS NULL
             AND (
               ${urlCol} ~* 't\\.me/\\+\\d'
               OR telegram ~* 't\\.me/\\+\\d'
             )`,
        );
        await client.query(
          `UPDATE "${schema}".person
           SET ${urlCol} = CASE
             WHEN ${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> '' THEN ${urlCol}
             WHEN telegram ~* '^https?://' AND telegram !~* 't\\.me/\\+' THEN telegram
             WHEN telegram ~ '^@?[A-Za-z0-9_]{5,}$'
               THEN 'https://t.me/' || regexp_replace(telegram, '^@', '')
             ELSE ${urlCol}
           END
           WHERE "deletedAt" IS NULL
             AND (
               (telegram IS NOT NULL AND BTRIM(telegram) <> '' AND telegram !~* 't\\.me/\\+')
               OR (${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> '')
             )`,
        );
        // Keep label = tg://user?id=… when URL is the HTTPS open-bridge (Twenty can't click raw tg://).
        await client.query(
          `UPDATE "${schema}".person
           SET ${labelCol} = ${urlCol}
           WHERE "deletedAt" IS NULL
             AND ${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> ''
             AND NOT (
               ${urlCol} ~* '/open/tg/\\d+$'
               AND ${labelCol} ~* '^tg://user\\?id=\\d+$'
             )
             AND (
               ${labelCol} IS NULL OR BTRIM(${labelCol}) = ''
               OR lower(BTRIM(${labelCol})) IN ('whatsapp', 'telegram', 'сайт', 'website', 'instagram', 'facebook', 'vkontakte', 'odnoklassniki', 'threads')
               OR ${labelCol} <> ${urlCol}
             )`,
        );
      } else if (fieldName === 'website') {
        await client.query(
          `UPDATE "${schema}".person
           SET ${urlCol} = CASE
             WHEN ${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> '' THEN ${urlCol}
             WHEN website ~* '^https?://' THEN website
             WHEN website IS NOT NULL AND website LIKE '%.%'
               THEN 'https://' || regexp_replace(website, '^https?://', '', 'i')
             ELSE ${urlCol}
           END
           WHERE "deletedAt" IS NULL
             AND (
               (website IS NOT NULL AND BTRIM(website) <> '')
               OR (${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> '')
             )`,
        );
        await client.query(
          `UPDATE "${schema}".person
           SET ${labelCol} = ${urlCol}
           WHERE "deletedAt" IS NULL
             AND ${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> ''
             AND (
               ${labelCol} IS NULL OR BTRIM(${labelCol}) = ''
               OR lower(BTRIM(${labelCol})) IN ('сайт', 'website')
               OR ${labelCol} <> ${urlCol}
             )`,
        );
      } else {
        const host =
          fieldName === 'instagram'
            ? 'instagram.com'
            : fieldName === 'facebook'
              ? 'facebook.com'
              : fieldName === 'vkontakte'
                ? 'vk.com'
                : fieldName === 'odnoklassniki'
                  ? 'ok.ru'
                  : fieldName === 'threads'
                    ? 'threads.net'
                    : null;
        if (host) {
          await client.query(
            `UPDATE "${schema}".person
             SET ${urlCol} = CASE
               WHEN ${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> '' THEN ${urlCol}
               WHEN "${fieldName}" ~* '^https?://' THEN "${fieldName}"
               WHEN "${fieldName}" IS NOT NULL AND BTRIM("${fieldName}") <> ''
                 THEN 'https://${host}/' || regexp_replace(BTRIM("${fieldName}"), '^@', '')
               ELSE ${urlCol}
             END
             WHERE "deletedAt" IS NULL
               AND (
                 ("${fieldName}" IS NOT NULL AND BTRIM("${fieldName}") <> '')
                 OR (${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> '')
               )`,
          );
          await client.query(
            `UPDATE "${schema}".person
             SET ${labelCol} = ${urlCol}
             WHERE "deletedAt" IS NULL
               AND ${urlCol} IS NOT NULL AND BTRIM(${urlCol}) <> ''
               AND (
                 ${labelCol} IS NULL OR BTRIM(${labelCol}) = ''
                 OR lower(BTRIM(${labelCol})) = lower($1)
                 OR ${labelCol} <> ${urlCol}
               )`,
            [fieldName],
          );
        }
      }

      await client.query(
        `UPDATE core."fieldMetadata" SET type = 'LINKS'
         WHERE "workspaceId" = $1::uuid AND name = $2 AND type = 'TEXT'`,
        [workspaceId, fieldName],
      );
      migrated.push(fieldName);
    }

    return { ok: true, migrated };
  } catch (err) {
    return {
      ok: false,
      migrated,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
