import { toIsoOrNow as toIso } from "../../lib/date.utils.js";
import { escapeLikePattern, tokenizeSearchQuery } from "../../lib/string.utils.js";
import {
  buildSortOrderBy,
  nullableTextExpr,
  type SortDirection,
} from "../../lib/table-query.js";
import { withTenant, type SqlParam } from "../../db/client.js";
import { NotFoundError, ValidationError } from "../../plugins/errorHandler.js";
import type {
  CreateServicePayload,
  ServiceItemDTO,
  ServiceItemRow,
  UpdateServicePayload,
} from "./services.types.js";

function mapRowToDTO(row: ServiceItemRow): ServiceItemDTO {
  const price = Number(row.default_price ?? 0);
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    price,
    defaultPrice: price,
    unit: row.unit ?? "усл",
    durationMinutes:
      row.duration_minutes !== null && row.duration_minutes !== undefined
        ? Number(row.duration_minutes)
        : null,
    createdAt: toIso(row.created_at),
    updatedAt: row.updated_at ? toIso(row.updated_at) : undefined,
  };
}

export class ServicesService {
  async list(tenantId: string, search?: string): Promise<ServiceItemDTO[]> {
    const res = await this.listPaginated(tenantId, { search });
    return res.data;
  }

  async listPaginated(
    tenantId: string,
    options?: {
      search?: string;
      page?: number;
      limit?: number;
      sortBy?: string;
      sortDir?: SortDirection;
    },
  ): Promise<{
    data: ServiceItemDTO[];
    meta: { total: number; page: number; limit: number; pages: number };
  }> {
    return withTenant(tenantId, async (tx) => {
      const conditions: string[] = ["tenant_id = $1"];
      const params: SqlParam[] = [tenantId];

      for (const token of tokenizeSearchQuery(options?.search)) {
        params.push(`%${escapeLikePattern(token)}%`);
        const paramRef = `$${params.length}`;
        conditions.push(
          `(name ILIKE ${paramRef} ESCAPE '\\' OR COALESCE(description, '') ILIKE ${paramRef} ESCAPE '\\')`,
        );
      }

      const whereSql = conditions.join(" AND ");
      const countRow = await tx.queryOne<{ total: string | number }>(
        `SELECT COUNT(*)::int AS total FROM repair_services_catalog WHERE ${whereSql}`,
        params,
      );
      const total = Number(countRow?.total ?? 0);

      const paginated = options?.page !== undefined;
      const page = Math.max(1, options?.page ?? 1);
      const limit = paginated ? (options?.limit ?? 25) : Math.max(1, total);
      const pages = paginated ? (total === 0 ? 0 : Math.ceil(total / limit)) : (total > 0 ? 1 : 0);

      const orderBy = buildSortOrderBy({
        sortBy: options?.sortBy,
        sortDir: options?.sortDir,
        columns: {
          name: nullableTextExpr("name"),
          description: { expr: nullableTextExpr("description"), nullable: true },
          price: "default_price",
          default_price: "default_price",
          unit: nullableTextExpr("unit"),
          duration_minutes: { expr: "duration_minutes", nullable: true },
          created_at: "created_at",
        },
        defaultOrderBy: "name ASC",
        tieBreaker: "id DESC",
      });

      const queryParams = [...params];
      let limitClause = "";
      if (paginated) {
        const offset = (page - 1) * limit;
        queryParams.push(limit, offset);
        limitClause = `LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`;
      }

      const rows = await tx.query<ServiceItemRow>(
        `SELECT id, tenant_id, name, description, default_price, unit, duration_minutes, created_at, updated_at
         FROM repair_services_catalog
         WHERE ${whereSql}
         ORDER BY ${orderBy}
         ${limitClause}`,
        queryParams,
      );
      return {
        data: rows.map(mapRowToDTO),
        meta: { total, page, limit, pages },
      };
    });
  }

  async getById(tenantId: string, id: string): Promise<ServiceItemDTO> {
    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOne<ServiceItemRow>(
        `SELECT id, tenant_id, name, description, default_price, unit, duration_minutes, created_at, updated_at
         FROM repair_services_catalog
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );

      if (!row) {
        throw new NotFoundError("Услуга не найдена");
      }

      return mapRowToDTO(row);
    });
  }

  async create(tenantId: string, payload: CreateServicePayload): Promise<ServiceItemDTO> {
    const trimmedName = payload.name.trim();
    if (!trimmedName) {
      throw new ValidationError("Название услуги не может быть пустым", {});
    }

    const price = payload.price ?? payload.default_price ?? 0;

    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOneOrThrow<ServiceItemRow>(
        `INSERT INTO repair_services_catalog (tenant_id, name, description, default_price, unit, duration_minutes, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (tenant_id, name)
         DO UPDATE SET default_price = EXCLUDED.default_price,
                       description = EXCLUDED.description,
                       unit = EXCLUDED.unit,
                       duration_minutes = EXCLUDED.duration_minutes,
                       updated_at = now()
         RETURNING id, tenant_id, name, description, default_price, unit, duration_minutes, created_at, updated_at`,
        [
          tenantId,
          trimmedName,
          payload.description?.trim() ?? "",
          price,
          payload.unit?.trim() ?? "усл",
          payload.duration_minutes ?? null,
        ],
      );

      return mapRowToDTO(row);
    });
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdateServicePayload,
  ): Promise<ServiceItemDTO> {
    return withTenant(tenantId, async (tx) => {
      const existing = await tx.queryOne<ServiceItemRow>(
        `SELECT id, name FROM repair_services_catalog WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );

      if (!existing) {
        throw new NotFoundError("Услуга не найдена");
      }

      const updates: string[] = ["updated_at = now()"];
      const params: SqlParam[] = [tenantId, id];

      if (payload.name !== undefined) {
        const trimmed = payload.name.trim();
        if (!trimmed) {
          throw new ValidationError("Название услуги не может быть пустым", {});
        }
        params.push(trimmed);
        updates.push(`name = $${params.length}`);
      }

      if (payload.description !== undefined) {
        params.push(payload.description.trim());
        updates.push(`description = $${params.length}`);
      }

      const price = payload.price ?? payload.default_price;
      if (price !== undefined) {
        params.push(price);
        updates.push(`default_price = $${params.length}`);
      }

      if (payload.unit !== undefined) {
        params.push(payload.unit.trim());
        updates.push(`unit = $${params.length}`);
      }

      if (payload.duration_minutes !== undefined) {
        params.push(payload.duration_minutes);
        updates.push(`duration_minutes = $${params.length}`);
      }

      const query = `
        UPDATE repair_services_catalog
        SET ${updates.join(", ")}
        WHERE tenant_id = $1 AND id = $2
        RETURNING id, tenant_id, name, description, default_price, unit, duration_minutes, created_at, updated_at
      `;

      const row = await tx.queryOneOrThrow<ServiceItemRow>(query, params);
      return mapRowToDTO(row);
    });
  }

  async delete(tenantId: string, id: string): Promise<{ success: boolean; id: string }> {
    return withTenant(tenantId, async (tx) => {
      await tx.query(
        `DELETE FROM repair_services_catalog WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );
      return { success: true, id };
    });
  }
}

export const servicesService = new ServicesService();
