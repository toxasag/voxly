/**
 * Opportunity kanban card presentation + note chip text.
 *
 * Twenty relation chips use Note.labelIdentifier as a string. bodyV2 is RICH_TEXT
 * → "[object Object]"; we keep label on TEXT `title` and mirror body → title
 * (INC-021). GraphQL alone cannot install PG triggers — this must run on
 * provision + reapply-crm-defaults (same SQL as docker/set-opportunity-kanban-card-defaults.sql).
 */
import pg from 'pg';

export async function ensureOpportunityKanbanCardDefaults(
  workspaceId?: string,
): Promise<void> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) {
    console.warn(
      '[provisioning] TWENTY_DATABASE_URL unset — skip kanban card SQL defaults',
    );
    return;
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
UPDATE core.view v
SET overrides = COALESCE(v.overrides, '{}'::jsonb) || '{"kanbanColumnWidth": 320}'::jsonb
FROM core."objectMetadata" o
WHERE o.id = v."objectMetadataId"
  AND o."nameSingular" = 'opportunity'
  AND v.key = 'INDEX'
  AND v.type = 'KANBAN'
  AND v."deletedAt" IS NULL
  AND ($1::uuid IS NULL OR v."workspaceId" = $1::uuid)
  AND COALESCE(v.overrides->>'kanbanColumnWidth', '') IS DISTINCT FROM '320'
`, [workspaceId ?? null]);

    await client.query(`
UPDATE core.view v
SET "kanbanColumnWidth" = 320
FROM core."objectMetadata" o
WHERE o.id = v."objectMetadataId"
  AND o."nameSingular" = 'opportunity'
  AND v.key = 'INDEX'
  AND v.type = 'KANBAN'
  AND v."deletedAt" IS NULL
  AND ($1::uuid IS NULL OR v."workspaceId" = $1::uuid)
  AND (v."kanbanColumnWidth" IS NULL OR v."kanbanColumnWidth" <> 320)
`, [workspaceId ?? null]);

    await client.query(`
UPDATE core."viewField" vf
SET size = 280
FROM core.view v,
     core."objectMetadata" o,
     core."fieldMetadata" f
WHERE vf."viewId" = v.id
  AND o.id = v."objectMetadataId"
  AND f.id = vf."fieldMetadataId"
  AND o."nameSingular" = 'opportunity'
  AND v.key = 'INDEX'
  AND v.type = 'KANBAN'
  AND v."deletedAt" IS NULL
  AND f.name = 'noteTargets'
  AND ($1::uuid IS NULL OR v."workspaceId" = $1::uuid)
  AND vf.size IS DISTINCT FROM 280
`, [workspaceId ?? null]);

    await client.query(`
UPDATE core."objectMetadata" o
SET "labelIdentifierFieldMetadataId" = f.id
FROM core."fieldMetadata" f
WHERE f."objectMetadataId" = o.id
  AND o."nameSingular" = 'note'
  AND f.name = 'title'
  AND ($1::uuid IS NULL OR o."workspaceId" = $1::uuid)
  AND o."labelIdentifierFieldMetadataId" IS DISTINCT FROM f.id
`, [workspaceId ?? null]);

    await client.query(`
CREATE OR REPLACE FUNCTION core.voxly_sync_note_title_from_body()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  body_text text;
BEGIN
  body_text := NULLIF(btrim(COALESCE(NEW."bodyV2Markdown", '')), '');
  IF body_text IS NOT NULL THEN
    NEW.title := left(body_text, 2000);
  END IF;
  RETURN NEW;
END;
$$;
`);

    await client.query(`
CREATE OR REPLACE FUNCTION core.voxly_note_target_latest_first()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.position := -EXTRACT(EPOCH FROM clock_timestamp());
  RETURN NEW;
END;
$$;
`);

    const schemas = await client.query<{ databaseSchema: string }>(
      `SELECT w."databaseSchema"
       FROM core.workspace w
       WHERE w."deletedAt" IS NULL
         AND w."activationStatus" = 'ACTIVE'
         AND w."databaseSchema" IS NOT NULL
         AND ($1::uuid IS NULL OR w.id = $1::uuid)`,
      [workspaceId ?? null],
    );

    for (const { databaseSchema: sch } of schemas.rows) {
      await client.query(
        `UPDATE ${quoteIdent(sch)}.note n
         SET title = left(btrim(n."bodyV2Markdown"), 2000)
         WHERE n."deletedAt" IS NULL
           AND n."bodyV2Markdown" IS NOT NULL
           AND btrim(n."bodyV2Markdown") <> ''
           AND n.title IS DISTINCT FROM left(btrim(n."bodyV2Markdown"), 2000)`,
      );

      await client.query(
        `UPDATE ${quoteIdent(sch)}."noteTarget" nt
         SET position = ranked.new_pos
         FROM (
           SELECT nt2.id,
             (ROW_NUMBER() OVER (
               PARTITION BY
                 nt2."targetOpportunityId",
                 nt2."targetPersonId",
                 nt2."targetCompanyId"
               ORDER BY n2."createdAt" DESC NULLS LAST
             ) - 1)::float8 AS new_pos
           FROM ${quoteIdent(sch)}."noteTarget" nt2
           JOIN ${quoteIdent(sch)}.note n2 ON n2.id = nt2."noteId"
           WHERE nt2."deletedAt" IS NULL
             AND n2."deletedAt" IS NULL
         ) ranked
         WHERE nt.id = ranked.id
           AND nt.position IS DISTINCT FROM ranked.new_pos`,
      );

      await client.query(
        `DROP TRIGGER IF EXISTS voxly_sync_note_title_from_body ON ${quoteIdent(sch)}.note`,
      );
      await client.query(
        `CREATE TRIGGER voxly_sync_note_title_from_body
           BEFORE INSERT OR UPDATE
           ON ${quoteIdent(sch)}.note
           FOR EACH ROW
           EXECUTE FUNCTION core.voxly_sync_note_title_from_body()`,
      );

      await client.query(
        `DROP TRIGGER IF EXISTS voxly_note_target_latest_first ON ${quoteIdent(sch)}."noteTarget"`,
      );
      await client.query(
        `CREATE TRIGGER voxly_note_target_latest_first
           BEFORE INSERT
           ON ${quoteIdent(sch)}."noteTarget"
           FOR EACH ROW
           EXECUTE FUNCTION core.voxly_note_target_latest_first()`,
      );
    }

    await client.query(
      `UPDATE core.workspace
       SET "metadataVersion" = "metadataVersion" + 1
       WHERE "activationStatus" = 'ACTIVE'
         AND ($1::uuid IS NULL OR id = $1::uuid)`,
      [workspaceId ?? null],
    );
  } finally {
    await client.end();
  }
}

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid schema name: ${name}`);
  }
  return `"${name}"`;
}
