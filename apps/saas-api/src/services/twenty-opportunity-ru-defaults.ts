/**
 * Opportunity RU defaults that GraphQL cannot fully apply on standard objects:
 * - isLabelSyncedWithName is rejected by Twenty metadata API
 * - INDEX view name «Канбан» (seeded All Opportunities / By Stage)
 * - Secondary list view «Списком»: GraphQL updateView often writes type/icon into
 *   view.overrides while columns stay TABLE/IconList — UI then shows a second
 *   kanban labelled «All Сделки». SQL clears those overrides.
 *
 * GraphQL still sets labelSingular/labelPlural via applyWorkspaceDefaults;
 * this SQL locks sync=false + Сделка/Сделки + Канбан + Списком for the workspace.
 */
import pg from 'pg';

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

    const kanbanViews = await client.query(
      `UPDATE core.view AS v
       SET name = 'Канбан',
           icon = 'IconLayoutKanban',
           "updatedAt" = now()
       FROM core."objectMetadata" AS o
       WHERE v."objectMetadataId" = o.id
         AND o."workspaceId" = $1::uuid
         AND o."nameSingular" = 'opportunity'
         AND v."deletedAt" IS NULL
         AND v.key = 'INDEX'
         AND (
           v.name IS DISTINCT FROM 'Канбан'
           OR v.icon IS DISTINCT FROM 'IconLayoutKanban'
         )
       RETURNING v.id, v.name, v.type, v.key, v.icon`,
      [workspaceId],
    );

    const listViews = await client.query(
      `UPDATE core.view AS v
       SET name = 'Списком',
           type = 'TABLE',
           icon = 'IconList',
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

    console.log(
      `[provisioning] Opportunity RU defaults: labels=${labels.rowCount}`
        + ` kanban=${kanbanViews.rowCount} list=${listViews.rowCount}`
        + ` deduped=${deduped.rowCount} workspaceId=${workspaceId}`,
    );
    return (labels.rowCount ?? 0) > 0;
  } finally {
    await client.end();
  }
}
