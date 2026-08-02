/**
 * Opportunity RU defaults that GraphQL cannot fully apply on standard objects:
 * - isLabelSyncedWithName is rejected by Twenty metadata API
 * - INDEX view «Канбан»: must be type=KANBAN + stage groupBy (not TABLE with
 *   kanban icon — that shows a list while the picker says Канбан; INC-081).
 * - Secondary list view «Списком»: GraphQL updateView often writes type/icon into
 *   view.overrides while columns stay TABLE/IconList — UI then shows a second
 *   kanban labelled «All Сделки». SQL clears those overrides.
 * - Stage pipeline matching john-crm golden board (enum + fieldMetadata.options
 *   + viewGroups): Новый лид → … → Успешная сделка → Сделка провалена.
 * - Locked stages (Новый лид / Успешная / Провалена) protected by PG trigger
 *   `trg_voxly_lock_opportunity_stage_options` — middle stages remain editable.
 * - openRecordIn = SIDE_PANEL on Opportunity INDEX/list views.
 *
 * GraphQL still sets labelSingular/labelPlural via applyWorkspaceDefaults;
 * this SQL locks sync=false + Сделка/Сделки + Канбан + Списком + stages.
 */
import pg from 'pg';

/** Locked system stages — must not be renamed/deleted (AI/CRM sync depends on them). */
export const VOXLY_LOCKED_OPPORTUNITY_STAGES = [
  {
    id: '20202020-8e01-4afd-9c39-d2063097587a',
    color: 'red',
    label: 'Новый лид',
    value: 'NOVYY_LID',
    position: 0,
  },
  {
    id: '20202020-0bb5-4a6f-a8b2-774bbad21104',
    color: 'green',
    label: 'Успешная сделка',
    value: 'USPESHNAYA_SDELKA',
    position: 4,
  },
  {
    id: 'bb012687-b6a9-4e1a-8f52-dcce5e0f310a',
    color: 'red',
    label: 'Сделка провалена',
    value: 'SDELKA_PROVALENA',
    position: 5,
  },
] as const;

/** Default middle stages (editable by tenant after provision). */
export const VOXLY_DEFAULT_MIDDLE_OPPORTUNITY_STAGES = [
  {
    id: '20202020-e685-4671-ac32-26d304dacb6e',
    color: 'purple',
    label: 'Screening',
    value: 'SCREENING',
    position: 1,
  },
  {
    id: '20202020-dde9-4acc-b5ca-f6531a8ecb4a',
    color: 'sky',
    label: 'Meeting',
    value: 'MEETING',
    position: 2,
  },
  {
    id: '20202020-696e-4f6b-91bc-f413e9b2f654',
    color: 'turquoise',
    label: 'Proposal',
    value: 'PROPOSAL',
    position: 3,
  },
] as const;

/** Full john-crm seed (locked + default middle). */
export const VOXLY_OPPORTUNITY_STAGE_OPTIONS = [
  VOXLY_LOCKED_OPPORTUNITY_STAGES[0],
  ...VOXLY_DEFAULT_MIDDLE_OPPORTUNITY_STAGES,
  VOXLY_LOCKED_OPPORTUNITY_STAGES[1],
  VOXLY_LOCKED_OPPORTUNITY_STAGES[2],
] as const;

/** Install DB trigger that restores locked stage options if CRM Settings edits them. */
async function ensureOpportunityStageLockTrigger(client: pg.Client): Promise<void> {
  await client.query(`
CREATE OR REPLACE FUNCTION core.voxly_merge_locked_opportunity_stages(opts jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $fn$
DECLARE
  locked_first jsonb := '{"id":"20202020-8e01-4afd-9c39-d2063097587a","color":"red","label":"Новый лид","value":"NOVYY_LID","position":0}'::jsonb;
  locked_won jsonb := '{"id":"20202020-0bb5-4a6f-a8b2-774bbad21104","color":"green","label":"Успешная сделка","value":"USPESHNAYA_SDELKA","position":4}'::jsonb;
  locked_lost jsonb := '{"id":"bb012687-b6a9-4e1a-8f52-dcce5e0f310a","color":"red","label":"Сделка провалена","value":"SDELKA_PROVALENA","position":5}'::jsonb;
  locked_ids text[] := ARRAY[
    '20202020-8e01-4afd-9c39-d2063097587a',
    '20202020-0bb5-4a6f-a8b2-774bbad21104',
    'bb012687-b6a9-4e1a-8f52-dcce5e0f310a'
  ];
  default_middle jsonb := '[
    {"id":"20202020-e685-4671-ac32-26d304dacb6e","color":"purple","label":"Screening","value":"SCREENING","position":1},
    {"id":"20202020-dde9-4acc-b5ca-f6531a8ecb4a","color":"sky","label":"Meeting","value":"MEETING","position":2},
    {"id":"20202020-696e-4f6b-91bc-f413e9b2f654","color":"turquoise","label":"Proposal","value":"PROPOSAL","position":3}
  ]'::jsonb;
  middle jsonb := '[]'::jsonb;
  elem jsonb;
  i int := 0;
  result jsonb;
BEGIN
  IF opts IS NULL OR jsonb_typeof(opts) IS DISTINCT FROM 'array' OR jsonb_array_length(opts) = 0 THEN
    middle := default_middle;
  ELSE
    FOR elem IN SELECT value FROM jsonb_array_elements(opts)
    LOOP
      IF NOT (elem->>'id' = ANY (locked_ids)) THEN
        middle := middle || jsonb_build_array(
          jsonb_set(elem, '{position}', to_jsonb(i + 1), true)
        );
        i := i + 1;
      END IF;
    END LOOP;
    IF jsonb_array_length(middle) = 0 THEN
      middle := default_middle;
      i := jsonb_array_length(middle);
    END IF;
  END IF;

  locked_won := jsonb_set(locked_won, '{position}', to_jsonb(i + 1), true);
  locked_lost := jsonb_set(locked_lost, '{position}', to_jsonb(i + 2), true);
  result := jsonb_build_array(locked_first) || middle || jsonb_build_array(locked_won, locked_lost);
  RETURN result;
END;
$fn$;

CREATE OR REPLACE FUNCTION core.voxly_lock_opportunity_stage_options()
RETURNS trigger
LANGUAGE plpgsql
AS $tg$
BEGIN
  IF NEW.name IS DISTINCT FROM 'stage' THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM core."objectMetadata" o
    WHERE o.id = NEW."objectMetadataId"
      AND o."nameSingular" = 'opportunity'
  ) THEN
    RETURN NEW;
  END IF;
  NEW.options := core.voxly_merge_locked_opportunity_stages(NEW.options);
  RETURN NEW;
END;
$tg$;

DROP TRIGGER IF EXISTS trg_voxly_lock_opportunity_stage_options ON core."fieldMetadata";
CREATE TRIGGER trg_voxly_lock_opportunity_stage_options
  BEFORE INSERT OR UPDATE OF options ON core."fieldMetadata"
  FOR EACH ROW
  EXECUTE FUNCTION core.voxly_lock_opportunity_stage_options();
`);
}

function isSafeSchema(schema: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema);
}

async function enumHasLabel(
  client: pg.Client,
  schema: string,
  label: string,
): Promise<boolean> {
  const res = await client.query(
    `SELECT 1
     FROM pg_enum e
     JOIN pg_type t ON t.oid = e.enumtypid
     JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = $1
       AND t.typname = 'opportunity_stage_enum'
       AND e.enumlabel = $2
     LIMIT 1`,
    [schema, label],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Align PG enum + metadata options + kanban columns with john-crm board. */
async function ensureOpportunityStagePipeline(
  client: pg.Client,
  workspaceId: string,
): Promise<{ enum: boolean; options: number; groups: number }> {
  await ensureOpportunityStageLockTrigger(client);

  const ws = await client.query<{ databaseSchema: string | null }>(
    `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
    [workspaceId],
  );
  const schema = ws.rows[0]?.databaseSchema;
  if (!schema || !isSafeSchema(schema)) {
    return { enum: false, options: 0, groups: 0 };
  }

  let enumTouched = false;

  // NEW → NOVYY_LID (Twenty seed first stage)
  if (
    (await enumHasLabel(client, schema, 'NEW')) &&
    !(await enumHasLabel(client, schema, 'NOVYY_LID'))
  ) {
    await client.query(
      `ALTER TYPE "${schema}".opportunity_stage_enum RENAME VALUE 'NEW' TO 'NOVYY_LID'`,
    );
    enumTouched = true;
  }

  // CUSTOMER → USPESHNAYA_SDELKA
  if (
    (await enumHasLabel(client, schema, 'CUSTOMER')) &&
    !(await enumHasLabel(client, schema, 'USPESHNAYA_SDELKA'))
  ) {
    await client.query(
      `ALTER TYPE "${schema}".opportunity_stage_enum RENAME VALUE 'CUSTOMER' TO 'USPESHNAYA_SDELKA'`,
    );
    enumTouched = true;
  }

  // Lost deal column (john)
  if (!(await enumHasLabel(client, schema, 'SDELKA_PROVALENA'))) {
    await client.query(
      `ALTER TYPE "${schema}".opportunity_stage_enum ADD VALUE IF NOT EXISTS 'SDELKA_PROVALENA'`,
    );
    enumTouched = true;
  }

  // Merge locked stages into current options (preserves tenant-edited middle stages).
  const options = await client.query(
    `UPDATE core."fieldMetadata" AS fm
     SET options = core.voxly_merge_locked_opportunity_stages(fm.options),
         "updatedAt" = now()
     FROM core."objectMetadata" AS o
     WHERE fm."objectMetadataId" = o.id
       AND o."workspaceId" = $1::uuid
       AND o."nameSingular" = 'opportunity'
       AND fm.name = 'stage'
       AND fm.options IS DISTINCT FROM core.voxly_merge_locked_opportunity_stages(fm.options)
     RETURNING fm.id`,
    [workspaceId],
  );

  // viewGroups: rename seed → locked values
  await client.query(
    `UPDATE core."viewGroup" AS vg
     SET "fieldValue" = 'NOVYY_LID',
         "updatedAt" = now()
     FROM core.view AS v
     JOIN core."objectMetadata" AS o ON o.id = v."objectMetadataId"
     WHERE vg."viewId" = v.id
       AND o."workspaceId" = $1::uuid
       AND o."nameSingular" = 'opportunity'
       AND v.key = 'INDEX'
       AND v.type = 'KANBAN'
       AND v."deletedAt" IS NULL
       AND vg."deletedAt" IS NULL
       AND vg."fieldValue" = 'NEW'`,
    [workspaceId],
  );

  await client.query(
    `UPDATE core."viewGroup" AS vg
     SET "fieldValue" = 'USPESHNAYA_SDELKA',
         "updatedAt" = now()
     FROM core.view AS v
     JOIN core."objectMetadata" AS o ON o.id = v."objectMetadataId"
     WHERE vg."viewId" = v.id
       AND o."workspaceId" = $1::uuid
       AND o."nameSingular" = 'opportunity'
       AND v.key = 'INDEX'
       AND v.type = 'KANBAN'
       AND v."deletedAt" IS NULL
       AND vg."deletedAt" IS NULL
       AND vg."fieldValue" = 'CUSTOMER'`,
    [workspaceId],
  );

  // Ensure locked columns exist (middle stages remain tenant-editable)
  const groups = await client.query(
    `WITH index_views AS (
       SELECT
         v.id AS view_id,
         v."workspaceId" AS workspace_id,
         COALESCE(
           (
             SELECT vg."applicationId"
             FROM core."viewGroup" vg
             WHERE vg."viewId" = v.id
               AND vg."deletedAt" IS NULL
             LIMIT 1
           ),
           v."applicationId"
         ) AS application_id
       FROM core.view AS v
       JOIN core."objectMetadata" AS o ON o.id = v."objectMetadataId"
       WHERE o."workspaceId" = $1::uuid
         AND o."nameSingular" = 'opportunity'
         AND v.key = 'INDEX'
         AND v.type = 'KANBAN'
         AND v."deletedAt" IS NULL
     ),
     wanted(value, pos) AS (
       VALUES
         ('NOVYY_LID', 0::float8),
         ('USPESHNAYA_SDELKA', 9000::float8),
         ('SDELKA_PROVALENA', 9001::float8)
     ),
     inserted AS (
       INSERT INTO core."viewGroup" (
         id,
         "universalIdentifier",
         "fieldValue",
         position,
         "isVisible",
         "viewId",
         "workspaceId",
         "applicationId",
         "createdAt",
         "updatedAt"
       )
       SELECT
         gen_random_uuid(),
         gen_random_uuid(),
         w.value,
         w.pos,
         true,
         iv.view_id,
         iv.workspace_id,
         iv.application_id,
         now(),
         now()
       FROM index_views iv
       CROSS JOIN wanted w
       WHERE iv.application_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM core."viewGroup" vg
           WHERE vg."viewId" = iv.view_id
             AND vg."deletedAt" IS NULL
             AND vg."fieldValue" = w.value
         )
       RETURNING id
     )
     SELECT count(*)::int AS n FROM inserted`,
    [workspaceId],
  );

  // Pin locked columns: first / near-end (do not rewrite middle positions)
  await client.query(
    `UPDATE core."viewGroup" AS vg
     SET position = w.pos,
         "isVisible" = true,
         "updatedAt" = now()
     FROM core.view AS v
     JOIN core."objectMetadata" AS o ON o.id = v."objectMetadataId"
     JOIN (
       VALUES
         ('NOVYY_LID', 0::float8),
         ('USPESHNAYA_SDELKA', 9000::float8),
         ('SDELKA_PROVALENA', 9001::float8)
     ) AS w(value, pos) ON TRUE
     WHERE vg."viewId" = v.id
       AND vg."fieldValue" = w.value
       AND o."workspaceId" = $1::uuid
       AND o."nameSingular" = 'opportunity'
       AND v.key = 'INDEX'
       AND v.type = 'KANBAN'
       AND v."deletedAt" IS NULL
       AND vg."deletedAt" IS NULL`,
    [workspaceId],
  );

  return {
    enum: enumTouched,
    options: options.rowCount ?? 0,
    groups: Number(groups.rows[0]?.n ?? 0),
  };
}

export async function ensureOpportunityRuDefaults(
  workspaceId: string,
): Promise<boolean> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) {
    console.warn(
      '[provisioning] TWENTY_DATABASE_URL unset — skip Opportunity RU SQL defaults',
    );
    return false;
  }

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const labels = await client.query(
      `UPDATE core."objectMetadata"
       SET "labelSingular" = 'Сделка',
           "labelPlural" = 'Сделки',
           "isLabelSyncedWithName" = false,
           "updatedAt" = now()
       WHERE "workspaceId" = $1::uuid
         AND "nameSingular" = 'opportunity'
       RETURNING id, "labelSingular", "labelPlural", "isLabelSyncedWithName"`,
      [workspaceId],
    );

    // INDEX must be a real KANBAN (not TABLE renamed «Канбан» — INC-081).
    // GraphQL updateView often fails or only writes overrides; SQL is SoT.
    const kanbanViews = await client.query(
      `UPDATE core.view AS v
       SET name = 'Канбан',
           type = 'KANBAN',
           icon = 'IconLayoutKanban',
           "openRecordIn" = 'SIDE_PANEL',
           "mainGroupByFieldMetadataId" = COALESCE(
             v."mainGroupByFieldMetadataId",
             (
               SELECT fm.id
               FROM core."fieldMetadata" fm
               WHERE fm."objectMetadataId" = o.id
                 AND fm.name = 'stage'
               LIMIT 1
             )
           ),
           "kanbanColumnWidth" = COALESCE(v."kanbanColumnWidth", 320),
           overrides = (
             COALESCE(v.overrides, '{}'::jsonb)
             - 'type'
             - 'icon'
             - 'mainGroupByFieldMetadataId'
           ) || '{"kanbanColumnWidth": 320}'::jsonb,
           "updatedAt" = now()
       FROM core."objectMetadata" AS o
       WHERE v."objectMetadataId" = o.id
         AND o."workspaceId" = $1::uuid
         AND o."nameSingular" = 'opportunity'
         AND v."deletedAt" IS NULL
         AND v.key = 'INDEX'
         AND (
           v.type IS DISTINCT FROM 'KANBAN'
           OR v.name IS DISTINCT FROM 'Канбан'
           OR v.icon IS DISTINCT FROM 'IconLayoutKanban'
           OR v."openRecordIn" IS DISTINCT FROM 'SIDE_PANEL'
           OR v."mainGroupByFieldMetadataId" IS NULL
           OR COALESCE(v.overrides->>'kanbanColumnWidth', '') IS DISTINCT FROM '320'
           OR COALESCE(v.overrides->>'type', '') <> ''
         )
       RETURNING v.id, v.name, v.type, v.key, v.icon, v."mainGroupByFieldMetadataId"`,
      [workspaceId],
    );

    // Seed all pipeline columns when INDEX board has none (stage pipeline
    // insert previously required an existing viewGroup for applicationId).
    await client.query(
      `WITH index_views AS (
         SELECT
           v.id AS view_id,
           v."workspaceId" AS workspace_id,
           v."applicationId" AS application_id
         FROM core.view AS v
         JOIN core."objectMetadata" AS o ON o.id = v."objectMetadataId"
         WHERE o."workspaceId" = $1::uuid
           AND o."nameSingular" = 'opportunity'
           AND v.key = 'INDEX'
           AND v.type = 'KANBAN'
           AND v."deletedAt" IS NULL
           AND v."applicationId" IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM core."viewGroup" vg
             WHERE vg."viewId" = v.id AND vg."deletedAt" IS NULL
           )
       ),
       wanted(value, pos) AS (
         VALUES
           ('NOVYY_LID', 0::float8),
           ('SCREENING', 1::float8),
           ('MEETING', 2::float8),
           ('PROPOSAL', 3::float8),
           ('USPESHNAYA_SDELKA', 4::float8),
           ('SDELKA_PROVALENA', 5::float8)
       )
       INSERT INTO core."viewGroup" (
         id, "universalIdentifier", "fieldValue", position, "isVisible",
         "viewId", "workspaceId", "applicationId", "createdAt", "updatedAt"
       )
       SELECT
         gen_random_uuid(), gen_random_uuid(), w.value, w.pos, true,
         iv.view_id, iv.workspace_id, iv.application_id, now(), now()
       FROM index_views iv
       CROSS JOIN wanted w`,
      [workspaceId],
    );

    const listViews = await client.query(
      `UPDATE core.view AS v
       SET name = 'Списком',
           type = 'TABLE',
           icon = 'IconList',
           "openRecordIn" = 'SIDE_PANEL',
           "mainGroupByFieldMetadataId" = NULL,
           "kanbanColumnWidth" = NULL,
           overrides = CASE
             WHEN v.overrides IS NULL THEN NULL
             ELSE (
               v.overrides
               - 'type'
               - 'icon'
               - 'mainGroupByFieldMetadataId'
               - 'kanbanColumnWidth'
               - 'kanbanAggregateOperation'
               - 'kanbanAggregateOperationFieldMetadataId'
             )
           END,
           position = GREATEST(COALESCE(v.position, 0), 1),
           "updatedAt" = now()
       FROM core."objectMetadata" AS o
       WHERE v."objectMetadataId" = o.id
         AND o."workspaceId" = $1::uuid
         AND o."nameSingular" = 'opportunity'
         AND v."deletedAt" IS NULL
         AND v.key IS DISTINCT FROM 'INDEX'
         AND v.type IN ('TABLE', 'KANBAN')
         AND (
           v.name ILIKE 'All%'
           OR v.name ILIKE 'Все%'
           OR v.name ILIKE '%Opportunit%'
           OR v.name ILIKE '%Возможност%'
           OR v.name ILIKE '%{objectLabelPlural}%'
           OR v.name IN ('Список', 'Списком', 'List', 'Table')
           OR COALESCE(v.overrides->>'type', '') = 'KANBAN'
           OR COALESCE(v.overrides->>'icon', '') ILIKE '%Kanban%'
           OR v.icon ILIKE '%Kanban%'
           OR v.icon = 'LayoutKanban'
         )
       RETURNING v.id, v.name, v.type, v.key, v.icon`,
      [workspaceId],
    );

    const deduped = await client.query(
      `WITH ranked AS (
         SELECT
           v.id,
           ROW_NUMBER() OVER (
             PARTITION BY v."objectMetadataId"
             ORDER BY
               CASE WHEN v.name = 'Списком' AND v.type = 'TABLE' THEN 0 ELSE 1 END,
               v."isCustom" ASC,
               v."createdAt" ASC,
               v.id ASC
           ) AS rn
         FROM core.view AS v
         JOIN core."objectMetadata" AS o ON o.id = v."objectMetadataId"
         WHERE o."workspaceId" = $1::uuid
           AND o."nameSingular" = 'opportunity'
           AND v."deletedAt" IS NULL
           AND v.key IS DISTINCT FROM 'INDEX'
           AND v.type = 'TABLE'
           AND (
             v.name = 'Списком'
             OR v.name = 'Список'
             OR v.name ILIKE 'All%'
             OR v.name ILIKE '%{objectLabelPlural}%'
           )
       )
       UPDATE core.view AS v
       SET "deletedAt" = now(),
           "updatedAt" = now()
       FROM ranked AS r
       WHERE v.id = r.id
         AND r.rn > 1
       RETURNING v.id`,
      [workspaceId],
    );

    const stages = await ensureOpportunityStagePipeline(client, workspaceId);

    console.log(
      `[provisioning] Opportunity RU defaults: labels=${labels.rowCount}`
        + ` kanban=${kanbanViews.rowCount} list=${listViews.rowCount}`
        + ` deduped=${deduped.rowCount}`
        + ` stageEnum=${stages.enum} stageOptions=${stages.options}`
        + ` stageGroups+=${stages.groups}`
        + ` workspaceId=${workspaceId}`,
    );
    return (labels.rowCount ?? 0) > 0;
  } finally {
    await client.end();
  }
}
