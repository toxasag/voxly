import { queryOne, queryOneOrThrow } from "../../../db/client.js";
import {
  recordTableLayoutSchema,
  toRecordTableLayoutDTO,
  type RecordTableId,
  type RecordTableLayout,
  type RecordTableLayoutDTO,
  type RecordTableLayoutRow,
} from "./record-table-layouts.types.js";

export class RecordTableLayoutsService {
  async get(
    tenantId: string,
    userId: string,
    tableId: RecordTableId,
  ): Promise<RecordTableLayoutDTO | null> {
    const row = await queryOne<RecordTableLayoutRow>(
      `SELECT table_id, layout, updated_at
       FROM record_table_layouts
       WHERE tenant_id = $1 AND user_id = $2 AND table_id = $3`,
      [tenantId, userId, tableId],
    );

    return row === null ? null : toRecordTableLayoutDTO(row);
  }

  async upsert(
    tenantId: string,
    userId: string,
    tableId: RecordTableId,
    layout: RecordTableLayout,
  ): Promise<RecordTableLayoutDTO> {
    const stored = recordTableLayoutSchema.parse(layout);

    const row = await queryOneOrThrow<RecordTableLayoutRow>(
      `INSERT INTO record_table_layouts (tenant_id, user_id, table_id, layout)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (tenant_id, user_id, table_id)
       DO UPDATE SET layout = EXCLUDED.layout
       RETURNING table_id, layout, updated_at`,
      [tenantId, userId, tableId, JSON.stringify(stored)],
    );

    return toRecordTableLayoutDTO(row);
  }
}
