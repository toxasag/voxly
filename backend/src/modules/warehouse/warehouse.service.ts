import { toIsoOrNow as toIso } from "../../lib/date.utils.js";
import { query, queryOne, queryOneOrThrow, withTenant, type SqlParam, type TransactionClient } from "../../db/client.js";
import { ValidationError } from "../../plugins/errorHandler.js";
import {
  allocateLandedCost,
  type LandedCostAllocationMethod,
} from "./landed-cost.utils.js";
import {
  type AggregatedPurchaseRequestDTO,
  type BulkDeleteWarehouseItemsPayload,
  type BulkUpdateWarehouseItemsPayload,
  type CreatePurchaseRequestPayload,
  type CreateSupplierOrderPayload,
  type CreateWarehouseItemPayload,
  type ExportWarehouseItemsPayload,
  type ImportCommitPayload,
  type ImportCommitResultDTO,
  type ImportDuplicateConflictDTO,
  type ImportParsedItem,
  type ImportParseResultDTO,
  type ImportValidatePayload,
  type ImportValidateResultDTO,
  type IntakeBatchPayload,
  type IntakeDocumentPayload,
  type IntakeDocumentResultDTO,
  type PaginatedWarehouseItemsDTO,
  type PaySupplierOrderPayload,
  type PurchaseRequestDTO,
  type PurchaseRequestRow,
  type PurchaseRequestStatus,
  type ReceiptSupplierOrderPayload,
  type SupplierOrderDTO,
  type SupplierOrderItemDTO,
  type SupplierOrderItemRow,
  type SupplierOrderReceiptCostDTO,
  type SupplierOrderReceiptDTO,
  type SupplierOrderReceiptItemDTO,
  type SupplierOrderRow,
  type SupplierOrderStatus,
  type UpdatePurchaseRequestPayload,
  type UpdateSupplierOrderPayload,
  type UpdateWarehouseBatchPayload,
  type UpdateWarehouseItemPayload,
  type UpdateWarehouseMovementPayload,
  type UpdateWarehouseSettingsPayload,
  type WarehouseBatchDTO,
  type WarehouseBatchRow,
  type WarehouseItemDTO,
  type WarehouseItemModelDTO,
  type WarehouseItemRow,
  type WarehouseMovementDTO,
  type WarehouseMovementRow,
  type WarehouseSettingsDTO,
} from "./warehouse.types.js";
import {
  buildCsvBuffer,
  buildXlsxBuffer,
  parseCsvText,
  parseXlsxBuffer,
  suggestFieldMapping,
  type ExportColumnDef,
} from "./warehouse-io.service.js";

function toNullableIso(val: Date | string | null | undefined): string | null {
  if (!val) return null;
  return typeof val === "string" ? new Date(val).toISOString() : val.toISOString();
}

function parseCleanNumber(val: unknown): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const str = String(val)
    .replace(/\s+/g, "")
    .replace(/[^\d.,-]/g, "")
    .replace(/,/g, ".");
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function safeUuid(val: unknown): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

const DEFAULT_PARTS_PURCHASE_CATEGORY_NAME = "Закупка запчастей";
const DEFAULT_EXTRA_COST_CATEGORY_NAME = "Доставка и логистика";

/**
 * Находит или создаёт расходную категорию для доп. расхода приёмки (доставка, курьер и др.).
 */
async function resolveExtraCostCategoryInTx(
  tx: TransactionClient,
  tenantId: string,
  categoryId?: string | null,
  categoryName?: string | null,
): Promise<{ id: string; name: string }> {
  const validId = safeUuid(categoryId);
  if (validId) {
    const byId = await tx.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM finance_categories WHERE tenant_id = $1 AND id = $2`,
      [tenantId, validId],
    );
    if (byId) return byId;
  }

  const trimmedName = categoryName?.trim();
  if (trimmedName) {
    const byName = await tx.queryOne<{ id: string; name: string }>(
      `SELECT id, name
       FROM finance_categories
       WHERE tenant_id = $1 AND type = 'expense' AND lower(btrim(name)) = lower($2)
       LIMIT 1`,
      [tenantId, trimmedName],
    );
    if (byName) return byName;

    return tx.queryOneOrThrow<{ id: string; name: string }>(
      `INSERT INTO finance_categories (tenant_id, name, type)
       VALUES ($1, $2, 'expense')
       RETURNING id, name`,
      [tenantId, trimmedName],
    );
  }

  const existingDelivery = await tx.queryOne<{ id: string; name: string }>(
    `SELECT id, name
     FROM finance_categories
     WHERE tenant_id = $1
       AND type = 'expense'
       AND (lower(name) LIKE '%доставк%' OR lower(name) LIKE '%логистик%' OR lower(name) LIKE '%курьер%')
     ORDER BY created_at ASC
     LIMIT 1`,
    [tenantId],
  );
  if (existingDelivery) return existingDelivery;

  return tx.queryOneOrThrow<{ id: string; name: string }>(
    `INSERT INTO finance_categories (tenant_id, name, type)
     VALUES ($1, $2, 'expense')
     RETURNING id, name`,
    [tenantId, DEFAULT_EXTRA_COST_CATEGORY_NAME],
  );
}

/**
 * Находит или создаёт расходную категорию «Закупка запчастей» в рамках тенанта.
 * Приоритет: точное совпадение «Закупка запчастей», затем любая расходная категория со словом «запчаст».
 */
async function resolvePartsPurchaseCategoryInTx(
  tx: TransactionClient,
  tenantId: string,
): Promise<{ id: string; name: string }> {
  const existing = await tx.queryOne<{ id: string; name: string }>(
    `SELECT id, name
     FROM finance_categories
     WHERE tenant_id = $1
       AND type = 'expense'
       AND lower(name) LIKE '%запчаст%'
     ORDER BY CASE WHEN lower(btrim(name)) = 'закупка запчастей' THEN 0 ELSE 1 END,
              created_at ASC
     LIMIT 1`,
    [tenantId],
  );
  if (existing) return existing;

  return tx.queryOneOrThrow<{ id: string; name: string }>(
    `INSERT INTO finance_categories (tenant_id, name, type)
     VALUES ($1, $2, 'expense')
     RETURNING id, name`,
    [tenantId, DEFAULT_PARTS_PURCHASE_CATEGORY_NAME],
  );
}

/**
 * Пересчитывает баланс кассового счёта по всем активным (не удалённым) операциям.
 */
async function recalculateCashAccountBalanceInTx(
  tx: TransactionClient,
  tenantId: string,
  accountId: string,
): Promise<void> {
  await tx.query(
    `UPDATE cash_accounts
     SET balance = COALESCE((
       SELECT SUM(CASE WHEN direction = 'income' THEN amount ELSE -amount END)
       FROM transactions
       WHERE tenant_id = $1 AND cash_account_id = $2 AND deleted_at IS NULL
     ), 0)
     WHERE tenant_id = $1 AND id = $2`,
    [tenantId, accountId],
  );
}

/**
 * Если все позиции заказа поставщику, привязанные к наряду, относятся к одному наряду — возвращает его ID.
 */
async function resolveSupplierOrderRepairIdInTx(
  tx: TransactionClient,
  tenantId: string,
  supplierOrderId: string,
): Promise<string | null> {
  const rows = await tx.query<{ repair_order_id: string }>(
    `SELECT DISTINCT repair_order_id
     FROM supplier_order_items
     WHERE tenant_id = $1
       AND supplier_order_id = $2
       AND repair_order_id IS NOT NULL`,
    [tenantId, supplierOrderId],
  );
  return rows.length === 1 ? (rows[0]?.repair_order_id ?? null) : null;
}

function extractRowFields(
  row: string[],
  mapping: Record<string, string>,
  headers?: string[],
) {
  const item: Record<string, string> = {
    sku: "",
    name: "",
    brand: "",
    category: "",
    unit: "шт",
    cost_price: "0",
    retail_price: "0",
    min_stock: "0",
  };

  for (const [key, value] of Object.entries(mapping)) {
    if (!value || value === "skip") continue;
    if (/^\d+$/.test(key)) {
      const idx = parseInt(key, 10);
      if (idx >= 0 && idx < row.length && row[idx] !== undefined) {
        item[value] = row[idx] ?? "";
      }
    } else if (item[key] !== undefined) {
      if (/^\d+$/.test(value)) {
        const idx = parseInt(value, 10);
        if (idx >= 0 && idx < row.length && row[idx] !== undefined) {
          item[key] = row[idx] ?? "";
        }
      } else if (headers) {
        const idx = headers.indexOf(value);
        if (idx >= 0 && idx < row.length && row[idx] !== undefined) {
          item[key] = row[idx] ?? "";
        }
      }
    } else if (headers) {
      const idx = headers.indexOf(key);
      if (idx >= 0 && idx < row.length && row[idx] !== undefined) {
        item[value] = row[idx] ?? "";
      }
    }
  }

  let sku = (item.sku ?? "").trim();
  let name = (item.name ?? "").trim();
  let brand = (item.brand ?? "").trim();
  const category = (item.category ?? "").trim();
  const unit = (item.unit ?? "").trim() || "шт";

  // Fallback if name is empty but brand or sku has text
  if (!name && brand) {
    name = brand;
    brand = "";
  } else if (!name && sku) {
    name = sku;
    sku = "";
  }

  return {
    sku,
    name,
    brand,
    category,
    unit,
    costPrice: Math.max(0, Math.min(999999999.99, parseCleanNumber(item.cost_price))),
    retailPrice: Math.max(0, Math.min(999999999.99, parseCleanNumber(item.retail_price))),
    minStock: Math.max(0, Math.min(999999999.99, parseCleanNumber(item.min_stock))),
  };
}

export class WarehouseService {
  // ---------------------------------------------------------------------------
  // Warehouse Settings (Продажа в минус и политики складов)
  // ---------------------------------------------------------------------------

  async getSettings(tenantId: string): Promise<WarehouseSettingsDTO> {
    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOne<{ allow_negative_stock: boolean }>(
        `SELECT allow_negative_stock FROM warehouse_settings WHERE tenant_id = $1`,
        [tenantId],
      );
      if (row) {
        return { allowNegativeStock: Boolean(row.allow_negative_stock) };
      }
      await tx.query(
        `INSERT INTO warehouse_settings (tenant_id, allow_negative_stock)
         VALUES ($1, false)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId],
      );
      return { allowNegativeStock: false };
    });
  }

  async updateSettings(
    tenantId: string,
    payload: UpdateWarehouseSettingsPayload,
  ): Promise<WarehouseSettingsDTO> {
    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOneOrThrow<{ allow_negative_stock: boolean }>(
        `INSERT INTO warehouse_settings (tenant_id, allow_negative_stock)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id) DO UPDATE
           SET allow_negative_stock = EXCLUDED.allow_negative_stock,
               updated_at = now()
         RETURNING allow_negative_stock`,
        [tenantId, payload.allow_negative_stock],
      );
      return { allowNegativeStock: Boolean(row.allow_negative_stock) };
    });
  }

  // ---------------------------------------------------------------------------
  // Warehouse Items & Batches
  // ---------------------------------------------------------------------------

  private async syncItemModels(
    tx: TransactionClient,
    tenantId: string,
    itemId: string,
    brandName?: string,
    modelIds?: string[],
    modelNames?: string[],
  ): Promise<void> {
    if (modelIds === undefined && modelNames === undefined) return;

    await tx.query(
      `DELETE FROM warehouse_item_models WHERE tenant_id = $1 AND item_id = $2`,
      [tenantId, itemId],
    );

    const targetModelIds = new Set<string>();

    if (modelIds && modelIds.length > 0) {
      for (const mid of modelIds) {
        if (mid) targetModelIds.add(mid);
      }
    }

    if (modelNames && modelNames.length > 0) {
      for (const name of modelNames) {
        const trimmed = name.trim();
        if (!trimmed) continue;

        let modelRow = await tx.queryOne<{ id: string }>(
          `SELECT id FROM equipment_models WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
          [tenantId, trimmed],
        );

        if (!modelRow) {
          const bName = brandName?.trim() || "Общий";
          let brandRow = await tx.queryOne<{ id: string }>(
            `SELECT id FROM equipment_brands WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
            [tenantId, bName],
          );
          if (!brandRow) {
            brandRow = await tx.queryOneOrThrow<{ id: string }>(
              `INSERT INTO equipment_brands (tenant_id, name) VALUES ($1, $2)
               ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
               RETURNING id`,
              [tenantId, bName],
            );
          }

          modelRow = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO equipment_models (tenant_id, brand_id, brand_name, name)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, brand_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
             RETURNING id`,
            [tenantId, brandRow.id, bName, trimmed],
          );
        }

        targetModelIds.add(modelRow.id);
      }
    }

    for (const mid of targetModelIds) {
      await tx.query(
        `INSERT INTO warehouse_item_models (tenant_id, item_id, model_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [tenantId, itemId, mid],
      );
    }
  }

  async listItems(
    tenantId: string,
    search?: string,
    options?: {
      page?: number;
      limit?: number;
      all?: boolean;
      category?: string;
      brand?: string;
      modelIds?: string[];
    },
  ): Promise<PaginatedWarehouseItemsDTO> {
    const page = Math.max(1, options?.page ?? 1);
    const limit = options?.limit ?? 25;
    const all = Boolean(options?.all);

    const params: (string | number | string[])[] = [tenantId];
    let searchFilter = "";

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      searchFilter += ` AND (lower(i.name) LIKE $${params.length} OR lower(i.sku) LIKE $${params.length} OR lower(COALESCE(i.brand, '')) LIKE $${params.length})`;
    }
    if (options?.category && options.category.trim()) {
      params.push(options.category.trim());
      searchFilter += ` AND i.category = $${params.length}`;
    }
    if (options?.brand && options.brand.trim()) {
      params.push(options.brand.trim());
      searchFilter += ` AND i.brand = $${params.length}`;
    }
    const modelIds = (options?.modelIds ?? []).filter((id) => typeof id === "string" && id.trim().length > 0);
    if (modelIds.length > 0) {
      params.push(modelIds);
      searchFilter += ` AND EXISTS (
        SELECT 1 FROM warehouse_item_models wim
        WHERE wim.tenant_id = i.tenant_id
          AND wim.item_id = i.id
          AND wim.model_id = ANY($${params.length}::uuid[])
      )`;
    }

    const settings = await this.getSettings(tenantId);

    return withTenant(tenantId, async (tx) => {
      // 1. Подсчет общего количества позиций для текущего тенанта с учетом поиска и фильтров
      const countRow = await tx.queryOne<{ count: string | number }>(
        `SELECT count(*)::int AS count
         FROM warehouse_items i
         WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
         ${searchFilter}`,
        params,
      );
      const total = typeof countRow?.count === "number" ? countRow.count : parseInt(String(countRow?.count || 0), 10);
      const pages = total === 0 ? 0 : Math.ceil(total / limit);

      const summaryRow = await tx.queryOne<{ total_valuation: string | number; low_stock_count: string | number }>(
        `SELECT
           COALESCE((
             SELECT SUM(b.remaining_quantity * b.purchase_price)
             FROM warehouse_batches b
             JOIN warehouse_items wi ON wi.id = b.item_id AND wi.tenant_id = b.tenant_id AND wi.deleted_at IS NULL
             WHERE b.tenant_id = $1 AND b.remaining_quantity > 0
           ), 0)::numeric(14,2) AS total_valuation,
           COALESCE((
             SELECT COUNT(*)
             FROM (
               SELECT i.id, i.min_stock,
                      COALESCE(SUM(b.remaining_quantity), 0)
                      - COALESCE((
                        SELECT SUM(r.quantity) FROM warehouse_reservations r
                        WHERE r.tenant_id = i.tenant_id AND r.item_id = i.id AND r.status = 'reserved'
                      ), 0) AS avail
               FROM warehouse_items i
               LEFT JOIN warehouse_batches b ON b.tenant_id = i.tenant_id AND b.item_id = i.id
               WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
               GROUP BY i.id, i.min_stock
             ) s
             WHERE s.avail <= s.min_stock
           ), 0)::int AS low_stock_count`,
        [tenantId],
      );
      const totalValuation = Math.round(Number(summaryRow?.total_valuation ?? 0) * 100) / 100;
      const lowStockCount = Number(summaryRow?.low_stock_count ?? 0);

      const offset = (page - 1) * limit;

      // Если в выборке 0 позиций или запрошенная страница превышает общее число
      if (total === 0 || (!all && offset >= total)) {
        return {
          data: [],
          meta: {
            total,
            page,
            limit: all ? total : limit,
            pages: all ? (total > 0 ? 1 : 0) : pages,
            totalValuation,
            lowStockCount,
          },
        };
      }

      const itemParams = [...params];
      let limitClause = "";
      if (!all) {
        itemParams.push(limit, offset);
        limitClause = `LIMIT $${itemParams.length - 1} OFFSET $${itemParams.length}`;
      }

      const rows = await tx.query<WarehouseItemRow>(
        `SELECT i.id, i.tenant_id, i.sku, i.name, COALESCE(i.brand, '') AS brand, i.category, i.unit,
                i.min_stock, i.retail_price, i.cost_price, COALESCE(i.reserved, false) AS reserved, i.created_at, i.updated_at,
                COALESCE(SUM(b.remaining_quantity), 0) AS total_stock,
                COALESCE(SUM(CASE WHEN b.remaining_quantity > 0 THEN b.remaining_quantity * b.purchase_price ELSE 0 END), 0)::numeric(14,2) AS stock_valuation,
                COUNT(CASE WHEN b.remaining_quantity > 0 THEN 1 END)::int AS active_batches_count,
                (
                  SELECT b2.purchase_price
                  FROM warehouse_batches b2
                  WHERE b2.tenant_id = i.tenant_id AND b2.item_id = i.id AND b2.remaining_quantity > 0
                  ORDER BY b2.received_at ASC, b2.created_at ASC
                  LIMIT 1
                ) AS fifo_cost_price,
                COALESCE((
                  SELECT SUM(r.quantity)
                  FROM warehouse_reservations r
                  WHERE r.tenant_id = i.tenant_id AND r.item_id = i.id AND r.status = 'reserved'
                ), 0) AS reserved_stock,
                COALESCE((
                  SELECT json_agg(json_build_object('id', em.id, 'name', em.name, 'brandId', em.brand_id, 'brandName', em.brand_name) ORDER BY em.name ASC)
                  FROM warehouse_item_models wim
                  JOIN equipment_models em ON em.id = wim.model_id AND em.tenant_id = wim.tenant_id
                  WHERE wim.tenant_id = i.tenant_id AND wim.item_id = i.id
                ), '[]'::json) AS models_json
         FROM warehouse_items i
         LEFT JOIN warehouse_batches b ON b.tenant_id = i.tenant_id AND b.item_id = i.id
         WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
         ${searchFilter}
         GROUP BY i.id
         ORDER BY i.name ASC
         ${limitClause}`,
        itemParams,
      );

      const data = rows.map((r) => {
        const totalStock = Number(r.total_stock ?? 0);
        const reserved = Number(r.reserved_stock ?? 0);
        const available = settings.allowNegativeStock
          ? totalStock - reserved
          : Math.max(totalStock - reserved, 0);

        const retailPrice = Number(r.retail_price ?? 0);
        const costPrice = Number(r.cost_price ?? 0);
        const stockValuation = Math.round(Number(r.stock_valuation ?? 0) * 100) / 100;
        const activeBatchesCount = Number(r.active_batches_count ?? 0);
        const fifoCostPrice =
          r.fifo_cost_price !== null && r.fifo_cost_price !== undefined
            ? Number(r.fifo_cost_price)
            : costPrice;
        const avgBatchCostPrice =
          totalStock > 0 ? Math.round((stockValuation / totalStock) * 100) / 100 : costPrice;
        const models = (r.models_json as WarehouseItemModelDTO[]) ?? [];
        const isReserved = reserved > 0 || Boolean(r.reserved);
        const status: "reserved" | "in_stock" | "out_of_stock" = isReserved
          ? "reserved"
          : available > 0
            ? "in_stock"
            : "out_of_stock";

        return {
          id: r.id,
          sku: r.sku,
          name: r.name,
          brand: r.brand ?? "",
          category: r.category ?? "",
          unit: r.unit,
          minStock: Number(r.min_stock ?? 0),
          retailPrice,
          price: retailPrice,
          costPrice,
          fifoCostPrice,
          avgBatchCostPrice,
          stockValuation,
          activeBatchesCount,
          totalStock: totalStock,
          quantity: totalStock,
          reservedStock: reserved,
          availableStock: available,
          reserved: isReserved,
          status,
          stockStatus: status,
          models,
          modelIds: models.map((m) => m.id),
          modelNames: models.map((m) => m.name),
          createdAt: toIso(r.created_at),
          updatedAt: toIso(r.updated_at),
        };
      });

      return {
        data,
        meta: {
          total,
          page,
          limit: all ? total : limit,
          pages: all ? (total > 0 ? 1 : 0) : pages,
          totalValuation,
          lowStockCount,
        },
      };
    });
  }

  async getItem(tenantId: string, itemId: string): Promise<WarehouseItemDTO | null> {
    const settings = await this.getSettings(tenantId);

    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query<WarehouseItemRow>(
        `SELECT i.id, i.tenant_id, i.sku, i.name, COALESCE(i.brand, '') AS brand, i.category, i.unit,
                i.min_stock, i.retail_price, i.cost_price, COALESCE(i.reserved, false) AS reserved, i.created_at, i.updated_at,
                COALESCE(SUM(b.remaining_quantity), 0) AS total_stock,
                COALESCE(SUM(CASE WHEN b.remaining_quantity > 0 THEN b.remaining_quantity * b.purchase_price ELSE 0 END), 0)::numeric(14,2) AS stock_valuation,
                COUNT(CASE WHEN b.remaining_quantity > 0 THEN 1 END)::int AS active_batches_count,
                (
                  SELECT b2.purchase_price
                  FROM warehouse_batches b2
                  WHERE b2.tenant_id = i.tenant_id AND b2.item_id = i.id AND b2.remaining_quantity > 0
                  ORDER BY b2.received_at ASC, b2.created_at ASC
                  LIMIT 1
                ) AS fifo_cost_price,
                COALESCE((
                  SELECT SUM(r.quantity)
                  FROM warehouse_reservations r
                  WHERE r.tenant_id = i.tenant_id AND r.item_id = i.id AND r.status = 'reserved'
                ), 0) AS reserved_stock,
                COALESCE((
                  SELECT json_agg(json_build_object('id', em.id, 'name', em.name, 'brandId', em.brand_id, 'brandName', em.brand_name) ORDER BY em.name ASC)
                  FROM warehouse_item_models wim
                  JOIN equipment_models em ON em.id = wim.model_id AND em.tenant_id = wim.tenant_id
                  WHERE wim.tenant_id = i.tenant_id AND wim.item_id = i.id
                ), '[]'::json) AS models_json
         FROM warehouse_items i
         LEFT JOIN warehouse_batches b ON b.tenant_id = i.tenant_id AND b.item_id = i.id
         WHERE i.tenant_id = $1 AND i.id = $2 AND i.deleted_at IS NULL
         GROUP BY i.id`,
        [tenantId, itemId],
      );

      if (rows.length === 0 || !rows[0]) return null;
      const r = rows[0];

      const total = Number(r.total_stock ?? 0);
      const reserved = Number(r.reserved_stock ?? 0);
      const available = settings.allowNegativeStock
        ? total - reserved
        : Math.max(total - reserved, 0);

      const retailPrice = Number(r.retail_price ?? 0);
      const costPrice = Number(r.cost_price ?? 0);
      const stockValuation = Math.round(Number(r.stock_valuation ?? 0) * 100) / 100;
      const activeBatchesCount = Number(r.active_batches_count ?? 0);
      const fifoCostPrice =
        r.fifo_cost_price !== null && r.fifo_cost_price !== undefined
          ? Number(r.fifo_cost_price)
          : costPrice;
      const avgBatchCostPrice =
        total > 0 ? Math.round((stockValuation / total) * 100) / 100 : costPrice;
      const models = (r.models_json as WarehouseItemModelDTO[]) ?? [];
      const isReserved = reserved > 0 || Boolean(r.reserved);
      const status: "reserved" | "in_stock" | "out_of_stock" = isReserved
        ? "reserved"
        : available > 0
          ? "in_stock"
          : "out_of_stock";

      return {
        id: r.id,
        sku: r.sku,
        name: r.name,
        brand: r.brand ?? "",
        category: r.category ?? "",
        unit: r.unit,
        minStock: Number(r.min_stock ?? 0),
        retailPrice,
        price: retailPrice,
        costPrice,
        fifoCostPrice,
        avgBatchCostPrice,
        stockValuation,
        activeBatchesCount,
        totalStock: total,
        quantity: total,
        reservedStock: reserved,
        availableStock: available,
        reserved: isReserved,
        status,
        stockStatus: status,
        models,
        modelIds: models.map((m) => m.id),
        modelNames: models.map((m) => m.name),
        createdAt: toIso(r.created_at),
        updatedAt: toIso(r.updated_at),
      };
    });
  }

  async createItem(tenantId: string, payload: CreateWarehouseItemPayload): Promise<WarehouseItemDTO> {
    const row = await withTenant(tenantId, async (tx) => {
      const inserted = await tx.queryOneOrThrow<WarehouseItemRow>(
        `INSERT INTO warehouse_items
           (tenant_id, sku, name, brand, category, unit, min_stock, retail_price, cost_price, reserved)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id, tenant_id, sku, name, brand, category, unit, min_stock, retail_price, cost_price, reserved, created_at, updated_at`,
        [
          tenantId,
          payload.sku ?? "",
          payload.name,
          payload.brand ?? "",
          payload.category ?? "",
          payload.unit ?? "шт",
          payload.min_stock ?? 0,
          payload.retail_price ?? 0,
          payload.cost_price ?? 0,
          Boolean(payload.reserved),
        ],
      );

      if (payload.model_ids !== undefined || payload.models !== undefined) {
        await this.syncItemModels(tx, tenantId, inserted.id, payload.brand, payload.model_ids, payload.models);
      }

      return inserted;
    });

    const item = await this.getItem(tenantId, row.id);
    if (!item) throw new Error("Failed to retrieve created warehouse item");
    return item;
  }

  async updateItem(
    tenantId: string,
    itemId: string,
    payload: UpdateWarehouseItemPayload,
  ): Promise<WarehouseItemDTO | null> {
    const fields: string[] = [];
    const params: SqlParam[] = [tenantId, itemId];

    const add = (col: string, val: SqlParam) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };

    if (payload.sku !== undefined) add("sku", payload.sku);
    if (payload.name !== undefined) add("name", payload.name);
    if (payload.brand !== undefined) add("brand", payload.brand);
    if (payload.category !== undefined) add("category", payload.category);
    if (payload.unit !== undefined) add("unit", payload.unit);
    if (payload.min_stock !== undefined) add("min_stock", payload.min_stock);
    if (payload.retail_price !== undefined) add("retail_price", payload.retail_price);
    if (payload.cost_price !== undefined) add("cost_price", payload.cost_price);
    if (payload.reserved !== undefined) add("reserved", Boolean(payload.reserved));

    await withTenant(tenantId, async (tx) => {
      if (fields.length > 0) {
        add("updated_at", new Date());
        await tx.query(
          `UPDATE warehouse_items SET ${fields.join(", ")}
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          params,
        );
      }
      if (payload.model_ids !== undefined || payload.models !== undefined) {
        await this.syncItemModels(tx, tenantId, itemId, payload.brand, payload.model_ids, payload.models);
      }
    });

    return this.getItem(tenantId, itemId);
  }

  // ---------------------------------------------------------------------------
  // Справочник Модели
  // ---------------------------------------------------------------------------

  async listModels(
    tenantId: string,
    brandId?: string,
    brandName?: string,
  ): Promise<WarehouseItemModelDTO[]> {
    return withTenant(tenantId, async (tx) => {
      let filter = "";
      const params: (string | number)[] = [tenantId];
      if (brandId) {
        params.push(brandId);
        filter += ` AND em.brand_id = $${params.length}`;
      } else if (brandName && brandName.trim()) {
        params.push(brandName.trim());
        filter += ` AND lower(em.brand_name) = lower($${params.length})`;
      }

      const rows = await tx.query<{ id: string; name: string; brand_id: string; brand_name: string }>(
        `SELECT em.id, em.name, em.brand_id, COALESCE(eb.name, em.brand_name) AS brand_name
         FROM equipment_models em
         LEFT JOIN equipment_brands eb ON eb.id = em.brand_id
         WHERE em.tenant_id = $1 ${filter}
         ORDER BY em.name ASC`,
        params,
      );

      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        brandId: r.brand_id,
        brandName: r.brand_name,
      }));
    });
  }

  async createModel(
    tenantId: string,
    payload: { name: string; brand_id?: string; brand_name?: string },
  ): Promise<WarehouseItemModelDTO> {
    const trimmed = payload.name.trim();
    if (!trimmed) throw new Error("Model name is required");

    return withTenant(tenantId, async (tx) => {
      let brandId = payload.brand_id;
      let brandName = payload.brand_name?.trim();

      if (brandId) {
        const brandRow = await tx.queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 AND id = $2`,
          [tenantId, brandId],
        );
        if (brandRow) brandName = brandRow.name;
      } else if (brandName) {
        let brandRow = await tx.queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 AND lower(name) = lower($2)`,
          [tenantId, brandName],
        );
        if (!brandRow) {
          brandRow = await tx.queryOneOrThrow<{ id: string; name: string }>(
            `INSERT INTO equipment_brands (tenant_id, name) VALUES ($1, $2)
             ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id, name`,
            [tenantId, brandName],
          );
        }
        brandId = brandRow.id;
      } else {
        let brandRow = await tx.queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 ORDER BY name ASC LIMIT 1`,
          [tenantId],
        );
        if (!brandRow) {
          brandRow = await tx.queryOneOrThrow<{ id: string; name: string }>(
            `INSERT INTO equipment_brands (tenant_id, name) VALUES ($1, 'Общий')
             ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
             RETURNING id, name`,
            [tenantId],
          );
        }
        brandId = brandRow.id;
        brandName = brandRow.name;
      }

      const row = await tx.queryOneOrThrow<{ id: string; name: string; brand_id: string }>(
        `INSERT INTO equipment_models (tenant_id, brand_id, brand_name, name)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, brand_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, name, brand_id`,
        [tenantId, brandId, brandName ?? "", trimmed],
      );

      return {
        id: row.id,
        name: row.name,
        brandId: row.brand_id,
        brandName,
      };
    });
  }

  async renameModel(tenantId: string, id: string, name: string): Promise<WarehouseItemModelDTO> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Model name is required");

    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOne<{ id: string; name: string; brand_id: string; brand_name: string }>(
        `UPDATE equipment_models
         SET name = $1
         WHERE tenant_id = $2 AND id = $3
         RETURNING id, name, brand_id, brand_name`,
        [trimmed, tenantId, id],
      );
      if (!row) throw new Error("Model not found");
      return {
        id: row.id,
        name: row.name,
        brandId: row.brand_id,
        brandName: row.brand_name,
      };
    });
  }

  async deleteModel(tenantId: string, id: string): Promise<{ success: boolean; id: string }> {
    return withTenant(tenantId, async (tx) => {
      await tx.query(`DELETE FROM equipment_models WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
      return { success: true, id };
    });
  }

  async deleteItem(tenantId: string, itemId: string, force = false): Promise<boolean> {
    return withTenant(tenantId, async (tx) => {
      if (force) {
        const batches = await tx.query<{ id: string }>(
          `SELECT id FROM warehouse_batches WHERE tenant_id = $1 AND item_id = $2`,
          [tenantId, itemId],
        );
        if (batches.length > 0) {
          await this.deleteBatchesInTx(
            tx,
            tenantId,
            batches.map((b) => b.id),
          );
        }
        // Дочищаем резервы и движения по товару, у которых batch_id = NULL
        await tx.query(
          `DELETE FROM warehouse_reservations WHERE tenant_id = $1 AND item_id = $2`,
          [tenantId, itemId],
        );
        await tx.query(
          `DELETE FROM warehouse_movements WHERE tenant_id = $1 AND item_id = $2`,
          [tenantId, itemId],
        );
      }

      const res = await tx.query(
        `UPDATE warehouse_items SET deleted_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id`,
        [tenantId, itemId],
      );
      return res.length > 0;
    });
  }

  async intakeBatch(
    tenantId: string,
    userId: string | null,
    payload: IntakeBatchPayload,
  ): Promise<WarehouseBatchDTO> {
    return withTenant(tenantId, async (tx) => {
      let itemId = payload.item_id;

      if (!itemId) {
        if (payload.sku) {
          const existingBySku = await tx.queryOne<{ id: string }>(
            `SELECT id FROM warehouse_items WHERE tenant_id = $1 AND lower(sku) = lower($2) AND deleted_at IS NULL`,
            [tenantId, payload.sku],
          );
          if (existingBySku) itemId = existingBySku.id;
        }

        if (!itemId) {
          const newItem = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO warehouse_items (tenant_id, sku, name, category, unit, cost_price, retail_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id`,
            [
              tenantId,
              payload.sku ?? "",
              payload.name,
              payload.category ?? "",
              payload.unit ?? "шт",
              payload.purchase_price,
              payload.retail_price ?? payload.purchase_price * 1.4,
            ],
          );
          itemId = newItem.id;
        }
      }

      await tx.query(
        `UPDATE warehouse_items
         SET cost_price = $1,
             retail_price = CASE WHEN $2::numeric IS NOT NULL THEN $2::numeric ELSE retail_price END,
             updated_at = now()
         WHERE tenant_id = $3 AND id = $4`,
        [payload.purchase_price, payload.retail_price ?? null, tenantId, itemId],
      );

      const batch = await tx.queryOneOrThrow<WarehouseBatchRow>(
        `INSERT INTO warehouse_batches
           (tenant_id, item_id, batch_number, supplier_name, purchase_price, initial_quantity, remaining_quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, tenant_id, item_id, batch_number, supplier_name, purchase_price, initial_quantity, remaining_quantity, received_at, created_at`,
        [
          tenantId,
          itemId,
          payload.batch_number ?? "",
          payload.supplier_name ?? "",
          payload.purchase_price,
          payload.quantity,
          payload.quantity,
        ],
      );

      await tx.query(
        `INSERT INTO warehouse_movements
           (tenant_id, item_id, batch_id, type, quantity, cost_price, description, created_by)
         VALUES ($1, $2, $3, 'intake', $4, $5, $6, $7)`,
        [
          tenantId,
          itemId,
          batch.id,
          payload.quantity,
          payload.purchase_price,
          `Оприходование партии №${payload.batch_number || batch.id.slice(0, 8)} (${payload.supplier_name || "Поставщик"})`,
          userId,
        ],
      );

      if (payload.record_finance_expense && payload.cash_account_id) {
        const totalAmount = payload.purchase_price * payload.quantity;
        if (totalAmount > 0) {
          const cat = await resolvePartsPurchaseCategoryInTx(tx, tenantId);

          await tx.query(
            `INSERT INTO transactions
               (tenant_id, cash_account_id, category_id, category_name, amount, direction, description, counterparty_name, occurred_at, created_by)
             VALUES ($1, $2, $3, $4, $5, 'expense', $6, $7, now(), $8)`,
            [
              tenantId,
              payload.cash_account_id,
              cat.id,
              cat.name,
              totalAmount,
              `Оприходование запчастей: ${payload.name} (${payload.quantity} ${payload.unit || "шт"})`,
              payload.supplier_name || "",
              safeUuid(userId),
            ],
          );

          await recalculateCashAccountBalanceInTx(tx, tenantId, payload.cash_account_id);
        }
      }

      return {
        id: batch.id,
        itemId: batch.item_id,
        itemName: payload.name,
        batchNumber: batch.batch_number,
        supplierName: batch.supplier_name,
        purchasePrice: Number(batch.purchase_price),
        initialQuantity: Number(batch.initial_quantity),
        remainingQuantity: Number(batch.remaining_quantity),
        receivedAt: toIso(batch.received_at),
        createdAt: toIso(batch.created_at),
      };
    });
  }

  async intakeDocument(
    tenantId: string,
    userId: string | null,
    payload: IntakeDocumentPayload,
  ): Promise<IntakeDocumentResultDTO> {
    if (!payload.items || payload.items.length === 0) {
      throw new Error("Укажите хотя бы один товар для оприходования");
    }

    return withTenant(tenantId, async (tx) => {
      let docNumber = payload.incoming_document_number?.trim();
      const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
      const randSuffix = Math.floor(100 + Math.random() * 900);

      let supplierOrderRow: SupplierOrderRow | null = null;
      if (payload.basis === "supplier_order" && payload.supplier_order_id) {
        supplierOrderRow = await tx.queryOne<SupplierOrderRow>(
          `SELECT * FROM supplier_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
          [tenantId, payload.supplier_order_id],
        );
        if (supplierOrderRow && !docNumber) {
          docNumber = supplierOrderRow.order_number;
        }
      }

      if (!docNumber) {
        if (payload.basis === "initial_balance") {
          docNumber = `НАЧ-${dateStr}-${randSuffix}`;
        } else if (payload.basis === "inventory_adjustment") {
          docNumber = `ИЗЛ-${dateStr}-${randSuffix}`;
        } else {
          docNumber = `ПХ-${dateStr}-${randSuffix}`;
        }
      }

      const supplierName =
        payload.supplier_name?.trim() ||
        supplierOrderRow?.supplier_name ||
        (payload.basis === "initial_balance"
          ? "Ввод начальных остатков"
          : payload.basis === "inventory_adjustment"
          ? "Инвентаризация (излишки)"
          : "Поставщик");

      let totalQty = 0;
      let totalAmount = 0;
      let batchesCount = 0;

      for (const it of payload.items) {
        const qty = Number(it.quantity);
        const price = Number(it.purchase_price);
        totalQty += qty;
        totalAmount += qty * price;

        let itemId = it.item_id;
        if (!itemId) {
          if (it.sku && it.sku.trim()) {
            const existingBySku = await tx.queryOne<{ id: string }>(
              `SELECT id FROM warehouse_items WHERE tenant_id = $1 AND lower(sku) = lower($2) AND deleted_at IS NULL`,
              [tenantId, it.sku.trim()],
            );
            if (existingBySku) itemId = existingBySku.id;
          }
          if (!itemId) {
            const existingByName = await tx.queryOne<{ id: string }>(
              `SELECT id FROM warehouse_items WHERE tenant_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL LIMIT 1`,
              [tenantId, it.name.trim()],
            );
            if (existingByName) itemId = existingByName.id;
          }
          if (!itemId) {
            const newItem = await tx.queryOneOrThrow<{ id: string }>(
              `INSERT INTO warehouse_items (tenant_id, sku, name, category, unit, cost_price, retail_price)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id`,
              [
                tenantId,
                it.sku?.trim() ?? "",
                it.name.trim(),
                it.category?.trim() ?? "Запчасти",
                it.unit?.trim() ?? "шт",
                price,
                it.retail_price && it.retail_price > 0 ? it.retail_price : Math.round(price * 1.4),
              ],
            );
            itemId = newItem.id;
          }
        }

        // Обновляем себестоимость и при наличии розницу
        const updates: string[] = ["cost_price = $1", "updated_at = now()"];
        const updateParams: SqlParam[] = [price, tenantId, itemId];
        if (it.retail_price !== undefined && it.retail_price > 0) {
          updateParams.push(it.retail_price);
          updates.push(`retail_price = $${updateParams.length}`);
        }
        await tx.query(
          `UPDATE warehouse_items SET ${updates.join(", ")} WHERE tenant_id = $2 AND id = $3`,
          updateParams,
        );

        const itemBatchNum = it.batch_number?.trim() || docNumber;
        const receivedAt = payload.document_date ? new Date(payload.document_date) : new Date();

        const batch = await tx.queryOneOrThrow<WarehouseBatchRow>(
          `INSERT INTO warehouse_batches
             (tenant_id, item_id, supplier_order_id, batch_number, supplier_name, purchase_price, initial_quantity, remaining_quantity, received_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING *`,
          [
            tenantId,
            itemId,
            payload.basis === "supplier_order" ? supplierOrderRow?.id ?? null : null,
            itemBatchNum,
            supplierName,
            price,
            qty,
            qty,
            receivedAt,
          ],
        );
        batchesCount++;

        let desc = "";
        if (payload.basis === "initial_balance") {
          desc = `Ввод начальных остатков: ${it.name} (${qty} ${it.unit || "шт"}) [партия ${itemBatchNum}]`;
        } else if (payload.basis === "inventory_adjustment") {
          desc = `Оприходование излишков: ${it.name} (${qty} ${it.unit || "шт"}) [акт ${itemBatchNum}]`;
        } else if (payload.basis === "supplier_order" && supplierOrderRow) {
          desc = `Поступление по заказу поставщику ${supplierOrderRow.order_number}: ${it.name} (${qty} ${it.unit || "шт"})`;
        } else {
          desc = `Поступление по документу ${docNumber}: ${it.name} (${qty} ${it.unit || "шт"}) [${supplierName}]`;
        }

        await tx.query(
          `INSERT INTO warehouse_movements
             (tenant_id, item_id, batch_id, type, quantity, cost_price, description, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tenantId,
            itemId,
            batch.id,
            payload.basis === "inventory_adjustment" ? "adjustment" : "intake",
            qty,
            price,
            desc,
            userId,
          ],
        );

        // Если это оприходование по заказу поставщику — связываем с заявками под наряды (repair_orders)
        if (payload.basis === "supplier_order" && supplierOrderRow) {
          const linkedRequests = await tx.query<PurchaseRequestRow>(
            `SELECT * FROM purchase_requests
             WHERE tenant_id = $1 AND supplier_order_id = $2
               AND (item_id = $3 OR lower(btrim(item_name)) = lower(btrim($4)))
               AND status IN ('ordered', 'pending')`,
            [tenantId, supplierOrderRow.id, itemId, it.name],
          );

          let remainingToReserve = qty;
          for (const req of linkedRequests) {
            if (remainingToReserve <= 0) break;
            const reqQty = Number(req.quantity);
            const reserveQty = Math.min(remainingToReserve, reqQty);

            if (req.repair_order_id && reserveQty > 0) {
              await tx.query(
                `INSERT INTO warehouse_reservations
                   (tenant_id, repair_order_id, item_id, batch_id, quantity, status)
                 VALUES ($1, $2, $3, $4, $5, 'reserved')`,
                [tenantId, req.repair_order_id, itemId, batch.id, reserveQty],
              );

              await tx.query(
                `INSERT INTO warehouse_movements
                   (tenant_id, item_id, batch_id, repair_order_id, type, quantity, cost_price, description, created_by)
                 VALUES ($1, $2, $3, $4, 'reserve', $5, $6, $7, $8)`,
                [
                  tenantId,
                  itemId,
                  batch.id,
                  req.repair_order_id,
                  reserveQty,
                  price,
                  `Резерв под наряд по заказу ${supplierOrderRow.order_number} (${it.name})`,
                  userId,
                ],
              );

              await tx.query(
                `UPDATE repair_parts
                 SET warehouse_item_id = $1, cost_price = $2, status = 'reserved'
                 WHERE tenant_id = $3 AND repair_order_id = $4
                   AND (warehouse_item_id = $1 OR lower(btrim(name)) = lower(btrim($5)))`,
                [itemId, price, tenantId, req.repair_order_id, it.name],
              );
            }

            await tx.query(
              `UPDATE purchase_requests
               SET status = 'received', item_id = COALESCE(item_id, $3), updated_at = now()
               WHERE tenant_id = $1 AND id = $2`,
              [tenantId, req.id, itemId],
            );

            if (req.deal_id) {
              await this.fulfillWonDealIfReadyInTx(
                tx,
                tenantId,
                req.deal_id,
                req.deal_item_id ?? null,
                itemId,
                userId,
              );
            }

            remainingToReserve -= reserveQty;
          }
        }
      }

      let transactionId: string | undefined;

      // ФИНАНСОВЫЙ КОНТУР:
      // При 'initial_balance' и 'inventory_adjustment' списание средств никогда не производится!
      if (payload.basis === "supplier_order" && supplierOrderRow) {
        await tx.query(
          `UPDATE supplier_orders SET status = 'received', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, supplierOrderRow.id],
        );

        const isAlreadyPaid =
          Boolean(supplierOrderRow.paid_at) ||
          Boolean(supplierOrderRow.finance_transaction_id) ||
          supplierOrderRow.status === "paid";
        if (!isAlreadyPaid && payload.record_finance_expense && payload.cash_account_id) {
          const cashAccountId = payload.cash_account_id;
          const cat = await resolvePartsPurchaseCategoryInTx(tx, tenantId);
          const linkedRepairOrderId = await resolveSupplierOrderRepairIdInTx(
            tx,
            tenantId,
            supplierOrderRow.id,
          );

          const desc =
            payload.payment_comment?.trim() ||
            `Оплата заказа поставщику ${supplierOrderRow.order_number} (${supplierName})`;

          const txRow = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO transactions
               (tenant_id, cash_account_id, category_id, category_name, amount, direction, description, counterparty_name, supplier_order_id, repair_order_id, occurred_at, created_by)
             VALUES ($1, $2, $3, $4, $5, 'expense', $6, $7, $8, $9, now(), $10)
             RETURNING id`,
            [
              tenantId,
              cashAccountId,
              cat.id,
              cat.name,
              totalAmount,
              desc,
              supplierName,
              supplierOrderRow.id,
              linkedRepairOrderId,
              safeUuid(userId) ?? safeUuid(supplierOrderRow.created_by),
            ],
          );
          transactionId = txRow.id;

          await recalculateCashAccountBalanceInTx(tx, tenantId, cashAccountId);

          await tx.query(
            `UPDATE supplier_orders
             SET paid_at = now(), cash_account_id = $1, finance_transaction_id = $2, updated_at = now()
             WHERE tenant_id = $3 AND id = $4`,
            [cashAccountId, txRow.id, tenantId, supplierOrderRow.id],
          );
        }
      } else if (
        payload.basis === "direct_purchase" &&
        payload.record_finance_expense &&
        payload.cash_account_id
      ) {
        const cashAccountId = payload.cash_account_id;
        const cat = await resolvePartsPurchaseCategoryInTx(tx, tenantId);

        const desc =
          payload.payment_comment?.trim() ||
          `Оприходование товаров по накладной ${docNumber} (${supplierName})`;

        const txRow = await tx.queryOneOrThrow<{ id: string }>(
          `INSERT INTO transactions
             (tenant_id, cash_account_id, category_id, category_name, amount, direction, description, counterparty_name, occurred_at, created_by)
           VALUES ($1, $2, $3, $4, $5, 'expense', $6, $7, now(), $8)
           RETURNING id`,
          [
            tenantId,
            cashAccountId,
            cat.id,
            cat.name,
            totalAmount,
            desc,
            supplierName,
            safeUuid(userId),
          ],
        );
        transactionId = txRow.id;

        await recalculateCashAccountBalanceInTx(tx, tenantId, cashAccountId);
      }

      return {
        success: true,
        documentNumber: docNumber,
        basis: payload.basis,
        batchesCreated: batchesCount,
        totalQuantity: totalQty,
        totalAmount,
        transactionId,
        supplierOrderId: supplierOrderRow?.id ?? undefined,
      };
    });
  }

  async listBatches(tenantId: string, itemId?: string): Promise<WarehouseBatchDTO[]> {
    const params: string[] = [tenantId];
    let filter = "";

    if (itemId) {
      params.push(itemId);
      filter = `AND b.item_id = $2`;
    }

    const rows = await query<WarehouseBatchRow>(
      `SELECT b.id, b.tenant_id, b.item_id, b.supplier_order_id, b.receipt_id, b.batch_number, b.supplier_name,
              b.purchase_price,
              COALESCE(b.base_purchase_price, b.purchase_price) AS base_purchase_price,
              COALESCE(b.landed_cost_per_unit, 0) AS landed_cost_per_unit,
              COALESCE(b.landed_cost_total, 0) AS landed_cost_total,
              b.initial_quantity, b.remaining_quantity,
              b.received_at, b.created_at, i.name AS item_name
       FROM warehouse_batches b
       JOIN warehouse_items i ON i.id = b.item_id AND i.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1 ${filter}
       ORDER BY b.received_at DESC`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      supplierOrderId: r.supplier_order_id ?? null,
      receiptId: r.receipt_id ?? null,
      itemName: r.item_name,
      batchNumber: r.batch_number,
      supplierName: r.supplier_name,
      purchasePrice: Number(r.purchase_price),
      basePurchasePrice: Number(r.base_purchase_price ?? r.purchase_price),
      landedCostPerUnit: Number(r.landed_cost_per_unit ?? 0),
      landedCostTotal: Number(r.landed_cost_total ?? 0),
      initialQuantity: Number(r.initial_quantity),
      remainingQuantity: Number(r.remaining_quantity),
      receivedAt: toIso(r.received_at),
      createdAt: toIso(r.created_at),
    }));
  }

  /**
   * Пересчитывает себестоимость позиции наряда/сделки после изменения или удаления аллокаций партий.
   */
  private async recalculateAffectedCostEntitiesInTx(
    tx: TransactionClient,
    tenantId: string,
    repairPartIds: string[],
    dealItemIds: string[],
    warehouseItemIds: string[],
  ): Promise<void> {
    for (const partId of repairPartIds) {
      const agg = await tx.queryOne<{ qty: string; cost: string; cnt: string }>(
        `SELECT COALESCE(SUM(quantity), 0)::numeric(10,2)::text AS qty,
                COALESCE(SUM(total_cost), 0)::numeric(12,2)::text AS cost,
                COUNT(*)::text AS cnt
         FROM repair_part_batch_allocations
         WHERE tenant_id = $1 AND repair_part_id = $2`,
        [tenantId, partId],
      );
      const cnt = Number(agg?.cnt ?? 0);
      const qty = Number(agg?.qty ?? 0);
      const cost = Number(agg?.cost ?? 0);
      if (cnt > 0 && qty > 0) {
        const unitCost = Math.round((cost / qty) * 100) / 100;
        await tx.query(
          `UPDATE repair_parts SET cost_price = $1 WHERE tenant_id = $2 AND id = $3`,
          [unitCost, tenantId, partId],
        );
      } else {
        await tx.query(
          `UPDATE repair_parts
           SET consumed_at = NULL, cost_source = 'manual'
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, partId],
        );
      }
    }

    for (const dealItemId of dealItemIds) {
      const agg = await tx.queryOne<{ qty: string; cost: string; cnt: string }>(
        `SELECT COALESCE(SUM(quantity), 0)::numeric(10,2)::text AS qty,
                COALESCE(SUM(total_cost), 0)::numeric(12,2)::text AS cost,
                COUNT(*)::text AS cnt
         FROM deal_item_batch_allocations
         WHERE tenant_id = $1 AND deal_item_id = $2`,
        [tenantId, dealItemId],
      );
      const cnt = Number(agg?.cnt ?? 0);
      const qty = Number(agg?.qty ?? 0);
      const cost = Number(agg?.cost ?? 0);
      if (cnt > 0 && qty > 0) {
        const unitCost = Math.round((cost / qty) * 100) / 100;
        await tx.query(
          `UPDATE deal_items SET cost_price = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
          [unitCost, tenantId, dealItemId],
        );
      } else {
        await tx.query(
          `UPDATE deal_items
           SET consumed_at = NULL, cost_source = 'manual', updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, dealItemId],
        );
      }
    }

    for (const itemId of warehouseItemIds) {
      const latest = await tx.queryOne<{ purchase_price: string }>(
        `SELECT purchase_price::text
         FROM warehouse_batches
         WHERE tenant_id = $1 AND item_id = $2
         ORDER BY received_at DESC, created_at DESC
         LIMIT 1`,
        [tenantId, itemId],
      );
      if (latest) {
        await tx.query(
          `UPDATE warehouse_items SET cost_price = $1, updated_at = now() WHERE tenant_id = $2 AND id = $3`,
          [Number(latest.purchase_price), tenantId, itemId],
        );
      }
    }
  }

  async updateBatch(
    tenantId: string,
    batchId: string,
    payload: UpdateWarehouseBatchPayload,
  ): Promise<WarehouseBatchDTO | null> {
    return withTenant(tenantId, async (tx) => {
      const existing = await tx.queryOne<WarehouseBatchRow>(
        `SELECT * FROM warehouse_batches WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, batchId],
      );
      if (!existing) return null;

      const batchNumber =
        payload.batch_number !== undefined ? payload.batch_number.trim() : existing.batch_number;
      const supplierName =
        payload.supplier_name !== undefined ? payload.supplier_name.trim() : existing.supplier_name;
      const purchasePrice =
        payload.purchase_price !== undefined ? Number(payload.purchase_price) : Number(existing.purchase_price);
      const initialQty =
        payload.initial_quantity !== undefined
          ? Number(payload.initial_quantity)
          : Number(existing.initial_quantity);

      let remainingQty =
        payload.remaining_quantity !== undefined
          ? Number(payload.remaining_quantity)
          : Number(existing.remaining_quantity);

      // Если изменили initial_quantity, но не передали remaining_quantity — сдвигаем остаток на дельту
      if (payload.initial_quantity !== undefined && payload.remaining_quantity === undefined) {
        const delta = initialQty - Number(existing.initial_quantity);
        remainingQty = Math.max(0, Math.round((remainingQty + delta) * 100) / 100);
      }
      if (remainingQty > initialQty) {
        remainingQty = initialQty;
      }

      const receivedAt =
        payload.received_at && payload.received_at.trim()
          ? new Date(payload.received_at).toISOString()
          : existing.received_at instanceof Date
            ? existing.received_at.toISOString()
            : String(existing.received_at);

      const updated = await tx.queryOneOrThrow<WarehouseBatchRow>(
        `UPDATE warehouse_batches
         SET batch_number = $3,
             supplier_name = $4,
             purchase_price = $5,
             initial_quantity = $6,
             remaining_quantity = $7,
             received_at = $8
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [
          tenantId,
          batchId,
          batchNumber,
          supplierName,
          purchasePrice,
          initialQty,
          remainingQty,
          receivedAt,
        ],
      );

      // Синхронизируем движение прихода (intake) и цены во всех движениях этой партии
      await tx.query(
        `UPDATE warehouse_movements
         SET quantity = $3, cost_price = $4
         WHERE tenant_id = $1 AND batch_id = $2 AND type = 'intake'`,
        [tenantId, batchId, initialQty, purchasePrice],
      );

      const priceChanged = purchasePrice !== Number(existing.purchase_price);
      if (priceChanged) {
        await tx.query(
          `UPDATE warehouse_movements
           SET cost_price = $3
           WHERE tenant_id = $1 AND batch_id = $2`,
          [tenantId, batchId, purchasePrice],
        );

        const rpRows = await tx.query<{ repair_part_id: string }>(
          `UPDATE repair_part_batch_allocations
           SET unit_cost = $3, total_cost = ROUND((quantity * $3)::numeric, 2)
           WHERE tenant_id = $1 AND batch_id = $2
           RETURNING repair_part_id`,
          [tenantId, batchId, purchasePrice],
        );

        const diRows = await tx.query<{ deal_item_id: string }>(
          `UPDATE deal_item_batch_allocations
           SET unit_cost = $3, total_cost = ROUND((quantity * $3)::numeric, 2)
           WHERE tenant_id = $1 AND batch_id = $2
           RETURNING deal_item_id`,
          [tenantId, batchId, purchasePrice],
        );

        await this.recalculateAffectedCostEntitiesInTx(
          tx,
          tenantId,
          Array.from(new Set(rpRows.map((r) => r.repair_part_id))),
          Array.from(new Set(diRows.map((r) => r.deal_item_id))),
          [existing.item_id],
        );
      }

      const itemRow = await tx.queryOne<{ name: string }>(
        `SELECT name FROM warehouse_items WHERE tenant_id = $1 AND id = $2`,
        [tenantId, updated.item_id],
      );

      return {
        id: updated.id,
        itemId: updated.item_id,
        supplierOrderId: updated.supplier_order_id ?? null,
        itemName: itemRow?.name,
        batchNumber: updated.batch_number,
        supplierName: updated.supplier_name,
        purchasePrice: Number(updated.purchase_price),
        initialQuantity: Number(updated.initial_quantity),
        remainingQuantity: Number(updated.remaining_quantity),
        receivedAt: toIso(updated.received_at),
        createdAt: toIso(updated.created_at),
      };
    });
  }

  /**
   * Транзакционное удаление партий с полной очисткой связанных аллокаций, резервов и движений.
   */
  async deleteBatchesInTx(
    tx: TransactionClient,
    tenantId: string,
    batchIds: string[],
  ): Promise<{ deletedCount: number }> {
    const uniqueIds = Array.from(new Set(batchIds));
    if (uniqueIds.length === 0) return { deletedCount: 0 };

    const batches = await tx.query<{ id: string; item_id: string }>(
      `SELECT id, item_id
       FROM warehouse_batches
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       FOR UPDATE`,
      [tenantId, uniqueIds],
    );
    if (batches.length === 0) return { deletedCount: 0 };
    const existingIds = batches.map((b) => b.id);
    const affectedItemIds = Array.from(new Set(batches.map((b) => b.item_id)));

    // 1. Удаляем FIFO-аллокации нарядов и сделок, запоминая затронутые позиции для пересчёта
    const deletedRpAllocs = await tx.query<{ repair_part_id: string }>(
      `DELETE FROM repair_part_batch_allocations
       WHERE tenant_id = $1 AND batch_id = ANY($2::uuid[])
       RETURNING repair_part_id`,
      [tenantId, existingIds],
    );
    const deletedDiAllocs = await tx.query<{ deal_item_id: string }>(
      `DELETE FROM deal_item_batch_allocations
       WHERE tenant_id = $1 AND batch_id = ANY($2::uuid[])
       RETURNING deal_item_id`,
      [tenantId, existingIds],
    );

    // 2. Удаляем резервы под эти партии и возвращаем статус зарезервированных деталей нарядов
    const deletedReservations = await tx.query<{ repair_order_id: string; item_id: string }>(
      `DELETE FROM warehouse_reservations
       WHERE tenant_id = $1 AND batch_id = ANY($2::uuid[])
       RETURNING repair_order_id, item_id`,
      [tenantId, existingIds],
    );
    for (const resv of deletedReservations) {
      const stillReserved = await tx.queryOne<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM warehouse_reservations
         WHERE tenant_id = $1 AND repair_order_id = $2 AND item_id = $3 AND status = 'reserved'`,
        [tenantId, resv.repair_order_id, resv.item_id],
      );
      if (Number(stillReserved?.cnt ?? 0) === 0) {
        await tx.query(
          `UPDATE repair_parts
           SET status = 'ordered'
           WHERE tenant_id = $1 AND repair_order_id = $2 AND warehouse_item_id = $3 AND status = 'reserved'`,
          [tenantId, resv.repair_order_id, resv.item_id],
        );
      }
    }

    // 3. Удаляем все движения склада, привязанные к этим партиям (intake, reserve, write_off)
    await tx.query(
      `DELETE FROM warehouse_movements
       WHERE tenant_id = $1 AND batch_id = ANY($2::uuid[])`,
      [tenantId, existingIds],
    );

    // 4. Удаляем сами партии
    const deletedBatches = await tx.query<{ id: string }>(
      `DELETE FROM warehouse_batches
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       RETURNING id`,
      [tenantId, existingIds],
    );

    // 5. Пересчитываем себестоимость/флаги затронутых позиций и номенклатуры
    await this.recalculateAffectedCostEntitiesInTx(
      tx,
      tenantId,
      Array.from(new Set(deletedRpAllocs.map((r) => r.repair_part_id))),
      Array.from(new Set(deletedDiAllocs.map((r) => r.deal_item_id))),
      affectedItemIds,
    );

    return { deletedCount: deletedBatches.length };
  }

  async deleteBatch(tenantId: string, batchId: string): Promise<boolean> {
    return withTenant(tenantId, async (tx) => {
      const { deletedCount } = await this.deleteBatchesInTx(tx, tenantId, [batchId]);
      return deletedCount > 0;
    });
  }

  async bulkDeleteBatches(tenantId: string, ids: string[]): Promise<{ deletedCount: number }> {
    return withTenant(tenantId, async (tx) => {
      return this.deleteBatchesInTx(tx, tenantId, ids);
    });
  }

  async updateMovement(
    tenantId: string,
    movementId: string,
    payload: UpdateWarehouseMovementPayload,
  ): Promise<WarehouseMovementDTO | null> {
    return withTenant(tenantId, async (tx) => {
      const existing = await tx.queryOne<
        WarehouseMovementRow & { repair_part_id?: string | null }
      >(
        `SELECT * FROM warehouse_movements WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, movementId],
      );
      if (!existing) return null;

      const newQty =
        payload.quantity !== undefined ? Number(payload.quantity) : Number(existing.quantity);
      const newCost =
        payload.cost_price !== undefined ? Number(payload.cost_price) : Number(existing.cost_price);
      const newDesc =
        payload.description !== undefined ? payload.description.trim() : existing.description;

      const deltaQty = Math.round((newQty - Number(existing.quantity)) * 100) / 100;

      // Корректируем связанную партию/резерв/аллокации при изменении количества или цены
      if (existing.batch_id) {
        if (existing.type === "intake") {
          await tx.query(
            `UPDATE warehouse_batches
             SET initial_quantity = GREATEST(0, initial_quantity + $3),
                 remaining_quantity = GREATEST(0, remaining_quantity + $3),
                 purchase_price = $4
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, existing.batch_id, deltaQty, newCost],
          );
        } else if (
          existing.type === "write_off" ||
          existing.type === "consume" ||
          existing.type === "repair_consumption"
        ) {
          if (deltaQty !== 0) {
            await tx.query(
              `UPDATE warehouse_batches
               SET remaining_quantity = LEAST(initial_quantity, GREATEST(0, remaining_quantity - $3))
               WHERE tenant_id = $1 AND id = $2`,
              [tenantId, existing.batch_id, deltaQty],
            );
          }
          if (existing.repair_part_id) {
            await tx.query(
              `UPDATE repair_part_batch_allocations
               SET quantity = $4, unit_cost = $5, total_cost = ROUND(($4 * $5)::numeric, 2)
               WHERE tenant_id = $1 AND repair_part_id = $2 AND batch_id = $3`,
              [tenantId, existing.repair_part_id, existing.batch_id, newQty, newCost],
            );
            await this.recalculateAffectedCostEntitiesInTx(tx, tenantId, [existing.repair_part_id], [], []);
          }
          if (existing.deal_item_id) {
            await tx.query(
              `UPDATE deal_item_batch_allocations
               SET quantity = $4, unit_cost = $5, total_cost = ROUND(($4 * $5)::numeric, 2)
               WHERE tenant_id = $1 AND deal_item_id = $2 AND batch_id = $3`,
              [tenantId, existing.deal_item_id, existing.batch_id, newQty, newCost],
            );
            await this.recalculateAffectedCostEntitiesInTx(tx, tenantId, [], [existing.deal_item_id], []);
          }
        }
      }

      if (existing.type === "reserve" && existing.repair_order_id && deltaQty !== 0) {
        await tx.query(
          `UPDATE warehouse_reservations
           SET quantity = GREATEST(0, quantity + $4), updated_at = now()
           WHERE id = (
             SELECT id FROM warehouse_reservations
             WHERE tenant_id = $1 AND repair_order_id = $2 AND item_id = $3 AND status = 'reserved'
               AND ($5::uuid IS NULL OR batch_id = $5)
             ORDER BY created_at DESC
             LIMIT 1
           )`,
          [tenantId, existing.repair_order_id, existing.item_id, deltaQty, existing.batch_id],
        );
      }

      await tx.query(
        `UPDATE warehouse_movements
         SET description = $3, quantity = $4, cost_price = $5
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, movementId, newDesc, newQty, newCost],
      );

      const refreshed = await tx.queryOne<WarehouseMovementRow>(
        `SELECT m.id, m.tenant_id, m.item_id, m.batch_id, m.repair_order_id,
                m.deal_id, m.deal_item_id,
                m.type, m.quantity, m.cost_price, m.description, m.created_by, m.created_at,
                i.name AS item_name,
                ro.ticket_number AS repair_ticket_number,
                d.title AS deal_title,
                u.name AS created_by_name
         FROM warehouse_movements m
         JOIN warehouse_items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
         LEFT JOIN repair_orders ro ON ro.id = m.repair_order_id AND ro.tenant_id = m.tenant_id
         LEFT JOIN deals d ON d.id = m.deal_id AND d.tenant_id = m.tenant_id
         LEFT JOIN users u ON u.id = m.created_by AND u.tenant_id = m.tenant_id
         WHERE m.tenant_id = $1 AND m.id = $2`,
        [tenantId, movementId],
      );
      if (!refreshed) return null;

      return {
        id: refreshed.id,
        itemId: refreshed.item_id,
        itemName: refreshed.item_name,
        batchId: refreshed.batch_id,
        repairOrderId: refreshed.repair_order_id,
        repairTicketNumber: refreshed.repair_ticket_number,
        dealId: refreshed.deal_id ?? null,
        dealItemId: refreshed.deal_item_id ?? null,
        dealTitle: refreshed.deal_title ?? null,
        type: refreshed.type,
        quantity: Number(refreshed.quantity),
        costPrice: Number(refreshed.cost_price),
        description: refreshed.description,
        createdByName: refreshed.created_by_name,
        createdAt: toIso(refreshed.created_at),
      };
    });
  }

  /**
   * Транзакционное удаление записей журнала движений с откатом их влияния на партии, резервы и аллокации.
   */
  async deleteMovementsInTx(
    tx: TransactionClient,
    tenantId: string,
    movementIds: string[],
  ): Promise<{ deletedCount: number }> {
    const uniqueIds = Array.from(new Set(movementIds));
    if (uniqueIds.length === 0) return { deletedCount: 0 };

    const movements = await tx.query<
      WarehouseMovementRow & { repair_part_id?: string | null }
    >(
      `SELECT *
       FROM warehouse_movements
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       ORDER BY created_at DESC
       FOR UPDATE`,
      [tenantId, uniqueIds],
    );
    if (movements.length === 0) return { deletedCount: 0 };

    const affectedRepairPartIds = new Set<string>();
    const affectedDealItemIds = new Set<string>();
    const affectedItemIds = new Set<string>();
    const emptyBatchIdsToDelete = new Set<string>();

    for (const m of movements) {
      const qty = Number(m.quantity);
      affectedItemIds.add(m.item_id);

      if (m.type === "intake" && m.batch_id) {
        const updatedBatch = await tx.queryOne<{ initial_quantity: string; remaining_quantity: string }>(
          `UPDATE warehouse_batches
           SET initial_quantity = GREATEST(0, initial_quantity - $3),
               remaining_quantity = GREATEST(0, remaining_quantity - $3)
           WHERE tenant_id = $1 AND id = $2
           RETURNING initial_quantity::text, remaining_quantity::text`,
          [tenantId, m.batch_id, qty],
        );
        if (updatedBatch && Number(updatedBatch.initial_quantity) <= 0) {
          emptyBatchIdsToDelete.add(m.batch_id);
        }
      } else if (m.type === "reserve" && m.repair_order_id) {
        await tx.query(
          `DELETE FROM warehouse_reservations
           WHERE id = (
             SELECT id FROM warehouse_reservations
             WHERE tenant_id = $1 AND repair_order_id = $2 AND item_id = $3 AND status = 'reserved'
               AND ($4::uuid IS NULL OR batch_id = $4)
             ORDER BY created_at DESC
             LIMIT 1
           )`,
          [tenantId, m.repair_order_id, m.item_id, m.batch_id],
        );
        const stillReserved = await tx.queryOne<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM warehouse_reservations
           WHERE tenant_id = $1 AND repair_order_id = $2 AND item_id = $3 AND status = 'reserved'`,
          [tenantId, m.repair_order_id, m.item_id],
        );
        if (Number(stillReserved?.cnt ?? 0) === 0) {
          await tx.query(
            `UPDATE repair_parts
             SET status = 'ordered'
             WHERE tenant_id = $1 AND repair_order_id = $2 AND warehouse_item_id = $3 AND status = 'reserved'`,
            [tenantId, m.repair_order_id, m.item_id],
          );
        }
      } else if (
        m.type === "write_off" ||
        m.type === "consume" ||
        m.type === "repair_consumption"
      ) {
        if (m.batch_id) {
          await tx.query(
            `UPDATE warehouse_batches
             SET remaining_quantity = LEAST(initial_quantity, remaining_quantity + $3)
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, m.batch_id, qty],
          );
        }
        if (m.repair_part_id) {
          await tx.query(
            `DELETE FROM repair_part_batch_allocations
             WHERE id = (
               SELECT id FROM repair_part_batch_allocations
               WHERE tenant_id = $1 AND repair_part_id = $2
                 AND (($3::uuid IS NULL AND batch_id IS NULL) OR batch_id = $3)
               ORDER BY created_at DESC
               LIMIT 1
             )`,
            [tenantId, m.repair_part_id, m.batch_id],
          );
          affectedRepairPartIds.add(m.repair_part_id);
        }
        if (m.deal_item_id) {
          await tx.query(
            `DELETE FROM deal_item_batch_allocations
             WHERE id = (
               SELECT id FROM deal_item_batch_allocations
               WHERE tenant_id = $1 AND deal_item_id = $2
                 AND (($3::uuid IS NULL AND batch_id IS NULL) OR batch_id = $3)
               ORDER BY created_at DESC
               LIMIT 1
             )`,
            [tenantId, m.deal_item_id, m.batch_id],
          );
          affectedDealItemIds.add(m.deal_item_id);
        }
      }
    }

    const deletedRows = await tx.query<{ id: string }>(
      `DELETE FROM warehouse_movements
       WHERE tenant_id = $1 AND id = ANY($2::uuid[])
       RETURNING id`,
      [tenantId, movements.map((m) => m.id)],
    );

    if (emptyBatchIdsToDelete.size > 0) {
      await this.deleteBatchesInTx(tx, tenantId, Array.from(emptyBatchIdsToDelete));
    }

    await this.recalculateAffectedCostEntitiesInTx(
      tx,
      tenantId,
      Array.from(affectedRepairPartIds),
      Array.from(affectedDealItemIds),
      Array.from(affectedItemIds),
    );

    return { deletedCount: deletedRows.length };
  }

  async deleteMovement(tenantId: string, movementId: string): Promise<boolean> {
    return withTenant(tenantId, async (tx) => {
      const { deletedCount } = await this.deleteMovementsInTx(tx, tenantId, [movementId]);
      return deletedCount > 0;
    });
  }

  async bulkDeleteMovements(tenantId: string, ids: string[]): Promise<{ deletedCount: number }> {
    return withTenant(tenantId, async (tx) => {
      return this.deleteMovementsInTx(tx, tenantId, ids);
    });
  }

  async listMovements(tenantId: string, limit: number = 100): Promise<WarehouseMovementDTO[]> {
    const rows = await query<WarehouseMovementRow>(
      `SELECT m.id, m.tenant_id, m.item_id, m.batch_id, m.repair_order_id,
              m.deal_id, m.deal_item_id,
              m.type, m.quantity, m.cost_price, m.description, m.created_by, m.created_at,
              i.name AS item_name,
              ro.ticket_number AS repair_ticket_number,
              d.title AS deal_title,
              u.name AS created_by_name
       FROM warehouse_movements m
       JOIN warehouse_items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
       LEFT JOIN repair_orders ro ON ro.id = m.repair_order_id AND ro.tenant_id = m.tenant_id
       LEFT JOIN deals d ON d.id = m.deal_id AND d.tenant_id = m.tenant_id
       LEFT JOIN users u ON u.id = m.created_by AND u.tenant_id = m.tenant_id
       WHERE m.tenant_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2`,
      [tenantId, limit],
    );

    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      itemName: r.item_name,
      batchId: r.batch_id,
      repairOrderId: r.repair_order_id,
      repairTicketNumber: r.repair_ticket_number,
      dealId: r.deal_id ?? null,
      dealItemId: r.deal_item_id ?? null,
      dealTitle: r.deal_title ?? null,
      type: r.type,
      quantity: Number(r.quantity),
      costPrice: Number(r.cost_price),
      description: r.description,
      createdByName: r.created_by_name,
      createdAt: toIso(r.created_at),
    }));
  }

  // ---------------------------------------------------------------------------
  // Purchase Requests & Aggregation
  // ---------------------------------------------------------------------------

  async listPurchaseRequests(
    tenantId: string,
    status?: string,
    repairOrderId?: string,
    dealId?: string,
  ): Promise<PurchaseRequestDTO[]> {
    const params: (string | number)[] = [tenantId];
    const filters: string[] = [];

    if (status && status !== "all") {
      params.push(status);
      filters.push(`pr.status = $${params.length}`);
    }
    if (repairOrderId) {
      params.push(repairOrderId);
      filters.push(`pr.repair_order_id = $${params.length}`);
    }
    if (dealId) {
      params.push(dealId);
      filters.push(`pr.deal_id = $${params.length}`);
    }

    const whereExtra = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

    const rows = await query<PurchaseRequestRow>(
      `SELECT pr.id, pr.tenant_id, pr.repair_order_id, pr.deal_id, pr.deal_item_id,
              pr.supplier_order_id, pr.item_id, pr.item_name, pr.sku,
              pr.quantity, pr.unit, pr.estimated_price, pr.status, pr.comment,
              pr.created_by, pr.created_at, pr.updated_at,
              ro.ticket_number AS repair_ticket_number,
              d.title AS deal_title,
              u.name AS created_by_name
       FROM purchase_requests pr
       LEFT JOIN repair_orders ro ON ro.id = pr.repair_order_id AND ro.tenant_id = pr.tenant_id
       LEFT JOIN deals d ON d.id = pr.deal_id AND d.tenant_id = pr.tenant_id
       LEFT JOIN users u ON u.id = pr.created_by AND u.tenant_id = pr.tenant_id
       WHERE pr.tenant_id = $1 ${whereExtra}
       ORDER BY pr.created_at DESC`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      repairOrderId: r.repair_order_id,
      dealId: r.deal_id ?? null,
      dealItemId: r.deal_item_id ?? null,
      supplierOrderId: r.supplier_order_id,
      repairTicketNumber: r.repair_ticket_number,
      dealTitle: r.deal_title ?? null,
      itemId: r.item_id,
      itemName: r.item_name,
      sku: r.sku,
      quantity: Number(r.quantity),
      unit: r.unit,
      estimatedPrice: Number(r.estimated_price),
      status: (r.status as PurchaseRequestStatus) || "pending",
      comment: r.comment,
      createdByName: r.created_by_name,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    }));
  }

  /**
   * Агрегированный список заявок на закупку (группировка по деталям)
   * Суммирует количество и собирает наряды и сделки через запятую (#1042, Сделка: ...)
   */
  async listAggregatedPurchaseRequests(
    tenantId: string,
    status?: string,
  ): Promise<AggregatedPurchaseRequestDTO[]> {
    const params: (string | number)[] = [tenantId];
    let statusFilter = "";
    if (status && status !== "all") {
      params.push(status);
      statusFilter = `AND pr.status = $${params.length}`;
    }

    const rows = await query<{
      id: string;
      item_id: string | null;
      item_name: string;
      sku: string;
      unit: string;
      quantity: string | number;
      estimated_price: string | number;
      status: string;
      repair_orders: string | null;
      request_ids: string[];
      total_stock: string | number;
      reserved_stock: string | number;
    }>(
      `SELECT 
         MIN(pr.id::text)::uuid AS id,
         pr.item_id,
         pr.item_name,
         COALESCE(pr.sku, '') AS sku,
         COALESCE(pr.unit, 'шт') AS unit,
         SUM(pr.quantity)::numeric AS quantity,
         COALESCE(AVG(pr.estimated_price), 0)::numeric AS estimated_price,
         pr.status,
         COALESCE(
           STRING_AGG(
             DISTINCT COALESCE(
               ro.ticket_number,
               CASE WHEN d.title IS NOT NULL THEN 'Сделка: ' || d.title ELSE NULL END
             ),
             ', '
             ORDER BY COALESCE(
               ro.ticket_number,
               CASE WHEN d.title IS NOT NULL THEN 'Сделка: ' || d.title ELSE NULL END
             )
           ),
           '—'
         ) AS repair_orders,
         ARRAY_AGG(pr.id) AS request_ids,
         COALESCE((
           SELECT SUM(b.remaining_quantity)
           FROM warehouse_batches b
           WHERE b.tenant_id = pr.tenant_id AND b.item_id = pr.item_id
         ), 0)::numeric AS total_stock,
         COALESCE((
           SELECT SUM(r.quantity)
           FROM warehouse_reservations r
           WHERE r.tenant_id = pr.tenant_id AND r.item_id = pr.item_id AND r.status = 'reserved'
         ), 0)::numeric AS reserved_stock
       FROM purchase_requests pr
       LEFT JOIN repair_orders ro ON ro.id = pr.repair_order_id AND ro.tenant_id = pr.tenant_id
       LEFT JOIN deals d ON d.id = pr.deal_id AND d.tenant_id = pr.tenant_id
       WHERE pr.tenant_id = $1 ${statusFilter}
       GROUP BY pr.tenant_id, pr.item_id, pr.item_name, pr.sku, pr.unit, pr.status
       ORDER BY pr.item_name ASC`,
      params,
    );

    return rows.map((r) => {
      const totalStock = Number(r.total_stock ?? 0);
      const reservedStock = Number(r.reserved_stock ?? 0);
      const repairOrders = r.repair_orders || "—";
      return {
        id: r.id,
        itemId: r.item_id,
        itemName: r.item_name,
        sku: r.sku,
        unit: r.unit,
        quantity: Number(r.quantity),
        estimatedPrice: Number(r.estimated_price),
        status: (r.status as PurchaseRequestStatus) || "pending",
        repairOrders,
        repair_orders: repairOrders,
        requestIds: r.request_ids,
        totalStock,
        availableStock: totalStock - reservedStock,
      };
    });
  }

  async createPurchaseRequest(
    tenantId: string,
    userId: string | null,
    payload: CreatePurchaseRequestPayload,
  ): Promise<PurchaseRequestDTO> {
    const row = await queryOneOrThrow<PurchaseRequestRow>(
      `INSERT INTO purchase_requests
         (tenant_id, repair_order_id, deal_id, deal_item_id, item_id, item_name, sku, quantity, unit, estimated_price, comment, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, tenant_id, repair_order_id, deal_id, deal_item_id, supplier_order_id, item_id, item_name, sku, quantity, unit,
                 estimated_price, status, comment, created_by, created_at, updated_at`,
      [
        tenantId,
        payload.repair_order_id ?? null,
        payload.deal_id ?? null,
        payload.deal_item_id ?? null,
        payload.item_id ?? null,
        payload.item_name,
        payload.sku ?? "",
        payload.quantity,
        payload.unit ?? "шт",
        payload.estimated_price ?? 0,
        payload.comment ?? "",
        userId,
      ],
    );

    return {
      id: row.id,
      repairOrderId: row.repair_order_id,
      dealId: row.deal_id ?? null,
      dealItemId: row.deal_item_id ?? null,
      supplierOrderId: row.supplier_order_id,
      repairTicketNumber: null,
      dealTitle: null,
      itemId: row.item_id,
      itemName: row.item_name,
      sku: row.sku,
      quantity: Number(row.quantity),
      unit: row.unit,
      estimatedPrice: Number(row.estimated_price),
      status: "pending",
      comment: row.comment,
      createdByName: null,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
  }

  async isReserved(tenantId: string, itemId: string): Promise<boolean> {
    const row = await queryOne<{ count: string | number }>(
      `SELECT count(*)::int AS count
       FROM warehouse_reservations
       WHERE tenant_id = $1 AND item_id = $2 AND status = 'reserved'`,
      [tenantId, itemId],
    );
    return Number(row?.count ?? 0) > 0;
  }

  async createBulkPurchaseRequests(
    tenantId: string,
    userId: string | null,
    payload: {
      itemIds: string[];
      status?: string;
      comment?: string;
      repair_order_id?: string;
      deal_id?: string;
    },
  ): Promise<PurchaseRequestDTO[]> {
    const uniqueIds = Array.from(new Set(payload.itemIds.filter(Boolean)));
    const results: PurchaseRequestDTO[] = [];

    for (const itemId of uniqueIds) {
      const item = await this.getItem(tenantId, itemId);
      if (!item) continue;

      const neededQty =
        item.reservedStock > 0
          ? item.reservedStock
          : item.availableStock < 0
            ? Math.abs(item.availableStock)
            : 1;

      const created = await this.createPurchaseRequest(tenantId, userId, {
        item_id: item.id,
        item_name: item.name,
        sku: item.sku,
        quantity: neededQty,
        unit: item.unit || "шт",
        estimated_price: item.costPrice > 0 ? item.costPrice : item.retailPrice,
        comment: payload.comment || "Сформировано из массовых действий склада",
        repair_order_id: payload.repair_order_id,
        deal_id: payload.deal_id,
      });

      if (payload.status && payload.status !== "pending") {
        const validStatus = payload.status as PurchaseRequestStatus;
        await this.updatePurchaseRequest(tenantId, created.id, {
          status: validStatus,
        });
        created.status = validStatus;
      }

      results.push(created);
    }

    return results;
  }

  async updatePurchaseRequest(
    tenantId: string,
    requestId: string,
    payload: UpdatePurchaseRequestPayload,
  ): Promise<PurchaseRequestDTO | null> {
    const fields: string[] = [];
    const params: SqlParam[] = [tenantId, requestId];

    if (payload.item_name !== undefined) {
      params.push(payload.item_name.trim());
      fields.push(`item_name = $${params.length}`);
    }
    if (payload.sku !== undefined) {
      params.push(payload.sku.trim());
      fields.push(`sku = $${params.length}`);
    }
    if (payload.quantity !== undefined) {
      params.push(payload.quantity);
      fields.push(`quantity = $${params.length}`);
    }
    if (payload.unit !== undefined) {
      params.push(payload.unit.trim());
      fields.push(`unit = $${params.length}`);
    }
    if (payload.estimated_price !== undefined) {
      params.push(payload.estimated_price);
      fields.push(`estimated_price = $${params.length}`);
    }
    if (payload.status) {
      params.push(payload.status);
      fields.push(`status = $${params.length}`);
    }
    if (payload.comment !== undefined) {
      params.push(payload.comment.trim());
      fields.push(`comment = $${params.length}`);
    }

    if (fields.length === 0) return null;

    params.push(new Date());
    fields.push(`updated_at = $${params.length}`);

    return withTenant(tenantId, async (tx) => {
      const updatedRows = await tx.query<{ id: string }>(
        `UPDATE purchase_requests SET ${fields.join(", ")}
         WHERE tenant_id = $1 AND id = $2
         RETURNING id`,
        params,
      );
      if (updatedRows.length === 0) return null;

      const row = await tx.queryOne<PurchaseRequestRow>(
        `SELECT pr.id, pr.tenant_id, pr.repair_order_id, pr.deal_id, pr.deal_item_id,
                pr.supplier_order_id, pr.item_id, pr.item_name, pr.sku,
                pr.quantity, pr.unit, pr.estimated_price, pr.status, pr.comment,
                pr.created_by, pr.created_at, pr.updated_at,
                ro.ticket_number AS repair_ticket_number,
                d.title AS deal_title,
                u.name AS created_by_name
         FROM purchase_requests pr
         LEFT JOIN repair_orders ro ON ro.id = pr.repair_order_id AND ro.tenant_id = pr.tenant_id
         LEFT JOIN deals d ON d.id = pr.deal_id AND d.tenant_id = pr.tenant_id
         LEFT JOIN users u ON u.id = pr.created_by AND u.tenant_id = pr.tenant_id
         WHERE pr.tenant_id = $1 AND pr.id = $2`,
        [tenantId, requestId],
      );
      if (!row) return null;

      // Если заявка под закрытую (won) сделку поступила на склад — дописываем дефицит FIFO
      if (payload.status === "received" && row.deal_id) {
        await this.fulfillWonDealIfReadyInTx(
          tx,
          tenantId,
          row.deal_id,
          row.deal_item_id ?? null,
          row.item_id,
          row.created_by,
        );
      }

      return {
        id: row.id,
        repairOrderId: row.repair_order_id,
        dealId: row.deal_id ?? null,
        dealItemId: row.deal_item_id ?? null,
        supplierOrderId: row.supplier_order_id,
        repairTicketNumber: row.repair_ticket_number,
        dealTitle: row.deal_title ?? null,
        itemId: row.item_id,
        itemName: row.item_name,
        sku: row.sku,
        quantity: Number(row.quantity),
        unit: row.unit,
        estimatedPrice: Number(row.estimated_price),
        status: (row.status as PurchaseRequestStatus) || "pending",
        comment: row.comment,
        createdByName: row.created_by_name,
        createdAt: toIso(row.created_at),
        updatedAt: toIso(row.updated_at),
      };
    });
  }

  async deletePurchaseRequest(tenantId: string, requestId: string): Promise<boolean> {
    const { deletedCount } = await this.bulkDeletePurchaseRequests(tenantId, [requestId]);
    return deletedCount > 0;
  }

  async bulkDeletePurchaseRequests(
    tenantId: string,
    requestIds: string[],
  ): Promise<{ deletedCount: number }> {
    const uniqueIds = Array.from(new Set(requestIds));
    if (uniqueIds.length === 0) return { deletedCount: 0 };

    return withTenant(tenantId, async (tx) => {
      // Очищаем ссылки в позициях заказов поставщикам (FK purchase_request_id + массив purchase_request_ids)
      await tx.query(
        `UPDATE supplier_order_items
         SET purchase_request_id = CASE WHEN purchase_request_id = ANY($2::uuid[]) THEN NULL ELSE purchase_request_id END,
             purchase_request_ids = ARRAY(
               SELECT elem FROM unnest(COALESCE(purchase_request_ids, ARRAY[]::uuid[])) AS elem
               WHERE NOT (elem = ANY($2::uuid[]))
             )
         WHERE tenant_id = $1
           AND (purchase_request_id = ANY($2::uuid[]) OR purchase_request_ids && $2::uuid[])`,
        [tenantId, uniqueIds],
      );

      const deletedRows = await tx.query<{ id: string }>(
        `DELETE FROM purchase_requests
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])
         RETURNING id`,
        [tenantId, uniqueIds],
      );
      return { deletedCount: deletedRows.length };
    });
  }

  // ---------------------------------------------------------------------------
  // Supplier Orders (Заказы поставщикам)
  // ---------------------------------------------------------------------------

  async createSupplierOrder(
    tenantId: string,
    userId: string | null,
    payload: CreateSupplierOrderPayload,
  ): Promise<SupplierOrderDTO> {
    return withTenant(tenantId, async (tx) => {
      // Генерируем номер заказа поставщику: ЗП-YYYY-XXXX
      const year = new Date().getFullYear();
      const countRow = await tx.queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM supplier_orders WHERE tenant_id = $1`,
        [tenantId],
      );
      const nextNum = (Number(countRow?.count ?? 0) + 1).toString().padStart(4, "0");
      const orderNumber = `ЗП-${year}-${nextNum}`;

      const statusToSet = payload.status && ["draft", "pending_payment"].includes(payload.status)
        ? payload.status
        : "pending_payment";

      const orderRow = await tx.queryOneOrThrow<SupplierOrderRow>(
        `INSERT INTO supplier_orders
           (tenant_id, order_number, supplier_name, supplier_company_id, status, total_amount, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
         RETURNING *`,
        [
          tenantId,
          orderNumber,
          payload.supplier_name,
          safeUuid(payload.supplier_company_id),
          statusToSet,
          payload.notes ?? "",
          userId,
        ],
      );

      let totalAmount = 0;
      const createdItems: SupplierOrderItemDTO[] = [];
      const linkedRequestIds: string[] = [];

      // Подготовка позиций без дублирования
      let itemsToProcess = payload.items;
      if (!itemsToProcess || itemsToProcess.length === 0) {
        if (payload.purchase_request_ids && payload.purchase_request_ids.length > 0) {
          const requests = await tx.query<PurchaseRequestRow>(
            `SELECT * FROM purchase_requests
             WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
            [tenantId, payload.purchase_request_ids],
          );
          itemsToProcess = requests.map((req) => ({
            purchase_request_id: req.id,
            purchase_request_ids: [req.id],
            item_id: req.item_id ?? undefined,
            item_name: req.item_name,
            sku: req.sku || "",
            requested_quantity: Number(req.quantity),
            extra_quantity: 0,
            quantity: Number(req.quantity),
            unit: req.unit || "шт",
            price: Number(req.estimated_price || 0),
            repair_order_id: req.repair_order_id ?? undefined,
          }));
        }
      }

      if (itemsToProcess && itemsToProcess.length > 0) {
        for (const it of itemsToProcess) {
          const reqQty = Number(it.requested_quantity ?? 0);
          const totalQty = Number(it.quantity);
          const extraQty = Number(it.extra_quantity ?? Math.max(0, totalQty - reqQty));
          const unitPrice = Number(it.price || 0);
          const itemTotal = totalQty * unitPrice;
          totalAmount += itemTotal;

          const reqIds: string[] = [];
          if (it.purchase_request_ids && it.purchase_request_ids.length > 0) {
            reqIds.push(...it.purchase_request_ids);
          } else if (it.purchase_request_id) {
            reqIds.push(it.purchase_request_id);
          }
          linkedRequestIds.push(...reqIds);

          const safeItemId = safeUuid(it.item_id);
          const safeRepairOrderId = safeUuid(it.repair_order_id);
          const primaryReqId = safeUuid(reqIds[0] ?? it.purchase_request_id);
          const validReqIds = reqIds.map(safeUuid).filter((id): id is string => id !== null);

          const itemRow = await tx.queryOneOrThrow<SupplierOrderItemRow>(
            `INSERT INTO supplier_order_items
               (tenant_id, supplier_order_id, purchase_request_id, item_id, item_name, sku,
                requested_quantity, extra_quantity, quantity, unit, price, total_price,
                repair_order_id, purchase_request_ids)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING *`,
            [
              tenantId,
              orderRow.id,
              primaryReqId,
              safeItemId,
              it.item_name,
              it.sku ?? "",
              reqQty,
              extraQty,
              totalQty,
              it.unit ?? "шт",
              unitPrice,
              itemTotal,
              safeRepairOrderId,
              validReqIds,
            ],
          );

          createdItems.push({
            id: itemRow.id,
            supplierOrderId: itemRow.supplier_order_id,
            purchaseRequestId: itemRow.purchase_request_id,
            itemId: itemRow.item_id,
            itemName: itemRow.item_name,
            sku: itemRow.sku,
            requestedQuantity: reqQty,
            extraQuantity: extraQty,
            repairOrderId: itemRow.repair_order_id ?? null,
            purchaseRequestIds: reqIds,
            repairOrders: it.repair_orders,
            quantity: totalQty,
            receivedQuantity: 0,
            remainingQuantity: totalQty,
            unit: itemRow.unit,
            price: unitPrice,
            totalPrice: itemTotal,
            createdAt: toIso(itemRow.created_at),
          });
        }
      }

      // Обновляем статус исходных заявок на 'ordered'
      const uniqueRequestIds = Array.from(new Set(linkedRequestIds));
      if (uniqueRequestIds.length > 0) {
        await tx.query(
          `UPDATE purchase_requests
           SET status = 'ordered', supplier_order_id = $1, updated_at = now()
           WHERE tenant_id = $2 AND id = ANY($3::uuid[])`,
          [orderRow.id, tenantId, uniqueRequestIds],
        );
      }

      // Фиксируем итоговую сумму заказа
      await tx.query(
        `UPDATE supplier_orders SET total_amount = $1, updated_at = now()
         WHERE tenant_id = $2 AND id = $3`,
        [totalAmount, tenantId, orderRow.id],
      );

      return {
        id: orderRow.id,
        orderNumber: orderRow.order_number,
        supplierName: orderRow.supplier_name,
        supplierCompanyId: orderRow.supplier_company_id ?? null,
        status: (orderRow.status as SupplierOrderStatus) || "pending_payment",
        totalAmount,
        cashAccountId: orderRow.cash_account_id,
        financeTransactionId: orderRow.finance_transaction_id,
        notes: orderRow.notes,
        paidAt: toNullableIso(orderRow.paid_at),
        receivedAt: toNullableIso(orderRow.received_at),
        createdBy: orderRow.created_by,
        items: createdItems,
        createdAt: toIso(orderRow.created_at),
        updatedAt: toIso(orderRow.updated_at),
      };
    });
  }

  async updateSupplierOrder(
    tenantId: string,
    id: string,
    payload: UpdateSupplierOrderPayload,
  ): Promise<SupplierOrderDTO> {
    return withTenant(tenantId, async (tx) => {
      const order = await tx.queryOne<SupplierOrderRow>(
        `SELECT * FROM supplier_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );
      if (!order) {
        throw new Error("Заказ поставщику не найден");
      }

      const isReceived = order.status === "received" || order.status === "partially_received";
      const updates: string[] = [];
      const params: (string | number | null)[] = [tenantId, id];

      if (payload.supplier_name !== undefined) {
        params.push(payload.supplier_name);
        updates.push(`supplier_name = $${params.length}`);
      }
      if (payload.supplier_company_id !== undefined) {
        params.push(payload.supplier_company_id);
        updates.push(`supplier_company_id = $${params.length}`);
      }
      if (payload.notes !== undefined) {
        params.push(payload.notes);
        updates.push(`notes = $${params.length}`);
      }
      if (payload.status !== undefined && !isReceived) {
        params.push(payload.status);
        updates.push(`status = $${params.length}`);
      }

      let newTotalAmount = Number(order.total_amount);

      if (!isReceived && payload.items && payload.items.length > 0) {
        await tx.query(
          `DELETE FROM supplier_order_items WHERE tenant_id = $1 AND supplier_order_id = $2`,
          [tenantId, id],
        );

        let totalAmount = 0;
        const linkedRequestIds: string[] = [];

        for (const it of payload.items) {
          const reqQty = Number(it.requested_quantity ?? 0);
          const totalQty = Number(it.quantity);
          const extraQty = Number(it.extra_quantity ?? Math.max(0, totalQty - reqQty));
          const unitPrice = Number(it.price || 0);
          const itemTotal = totalQty * unitPrice;
          totalAmount += itemTotal;

          const reqIds: string[] = [];
          if (it.purchase_request_ids && it.purchase_request_ids.length > 0) {
            reqIds.push(...it.purchase_request_ids);
          } else if (it.purchase_request_id) {
            reqIds.push(it.purchase_request_id);
          }
          linkedRequestIds.push(...reqIds);

          await tx.query(
            `INSERT INTO supplier_order_items
               (tenant_id, supplier_order_id, purchase_request_id, item_id, item_name, sku,
                requested_quantity, extra_quantity, quantity, unit, price, total_price,
                repair_order_id, purchase_request_ids)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              tenantId,
              id,
              reqIds[0] ?? it.purchase_request_id ?? null,
              it.item_id ?? null,
              it.item_name,
              it.sku ?? "",
              reqQty,
              extraQty,
              totalQty,
              it.unit ?? "шт",
              unitPrice,
              itemTotal,
              it.repair_order_id ?? null,
              reqIds,
            ],
          );
        }

        const uniqueReqIds = Array.from(new Set(linkedRequestIds));
        if (uniqueReqIds.length > 0) {
          await tx.query(
            `UPDATE purchase_requests
             SET status = 'ordered', supplier_order_id = $1, updated_at = now()
             WHERE tenant_id = $2 AND id = ANY($3::uuid[])`,
            [id, tenantId, uniqueReqIds],
          );
        }

        newTotalAmount = totalAmount;
        params.push(totalAmount);
        updates.push(`total_amount = $${params.length}`);
      }

      updates.push(`updated_at = now()`);

      await tx.query(
        `UPDATE supplier_orders SET ${updates.join(", ")} WHERE tenant_id = $1 AND id = $2`,
        params,
      );

      // Синхронизируем поставщика в связанных партиях (для received)
      if (isReceived && payload.supplier_name !== undefined && payload.supplier_name !== order.supplier_name) {
        await tx.query(
          `UPDATE warehouse_batches
           SET supplier_name = $3
           WHERE tenant_id = $1
             AND (supplier_order_id = $2 OR (batch_number = $4 AND supplier_name = $5))`,
          [tenantId, id, payload.supplier_name, order.order_number, order.supplier_name],
        );
      }

      // Синхронизируем кассовую проводку, если заказ уже был оплачен
      if (order.finance_transaction_id || order.paid_at) {
        if (payload.status === "cancelled" && !isReceived) {
          const cancelledTxs = await tx.query<{ cash_account_id: string }>(
            `UPDATE transactions
             SET deleted_at = now()
             WHERE tenant_id = $1
               AND deleted_at IS NULL
               AND (id = $2 OR supplier_order_id = $3)
             RETURNING cash_account_id`,
            [tenantId, order.finance_transaction_id, order.id],
          );
          await tx.query(
            `UPDATE supplier_orders
             SET paid_at = NULL, finance_transaction_id = NULL, updated_at = now()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, order.id],
          );
          const affectedAccs = Array.from(new Set(cancelledTxs.map((r) => r.cash_account_id)));
          for (const accId of affectedAccs) {
            await recalculateCashAccountBalanceInTx(tx, tenantId, accId);
          }
        } else if (order.finance_transaction_id) {
          const txRow = await tx.queryOne<{ amount: string; cash_account_id: string | null }>(
            `SELECT amount::text, cash_account_id
             FROM transactions
             WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
            [tenantId, order.finance_transaction_id],
          );
          if (txRow) {
            await tx.query(
              `UPDATE transactions
               SET amount = $3,
                   counterparty_name = COALESCE($4, counterparty_name)
               WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
              [tenantId, order.finance_transaction_id, newTotalAmount, payload.supplier_name ?? null],
            );
            const targetAccountId = txRow.cash_account_id || order.cash_account_id;
            if (targetAccountId) {
              await recalculateCashAccountBalanceInTx(tx, tenantId, targetAccountId);
            }
          }
        }
      }

      const refreshed = await this.getSupplierOrder(tenantId, id);
      return refreshed!;
    });
  }

  /**
   * Транзакционное удаление заказов поставщикам (включая оприходованные `received`):
   * 1. Находит и каскадно откатывает все созданные заказом партии (`deleteBatchesInTx` -> движения, резервы, аллокации).
   * 2. Возвращает связанные заявки на закупку в статус `pending`.
   * 3. Удаляет связанную кассовую проводку и возвращает точную сумму на баланс счёта.
   * 4. Удаляет позиции и сам заказ.
   */
  async deleteSupplierOrdersInTx(
    tx: TransactionClient,
    tenantId: string,
    orderIds: string[],
  ): Promise<{ deletedCount: number; rolledBackBatchesCount: number }> {
    const uniqueIds = Array.from(new Set(orderIds));
    if (uniqueIds.length === 0) return { deletedCount: 0, rolledBackBatchesCount: 0 };

    const orders = await tx.query<SupplierOrderRow>(
      `SELECT * FROM supplier_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
      [tenantId, uniqueIds],
    );
    if (orders.length === 0) return { deletedCount: 0, rolledBackBatchesCount: 0 };

    let rolledBackBatchesCount = 0;

    for (const order of orders) {
      // 1. Откатываем все партии, созданные этим заказом (по прямому FK и по историческому совпадению номера)
      const linkedBatches = await tx.query<{ id: string }>(
        `SELECT id
         FROM warehouse_batches
         WHERE tenant_id = $1
           AND (
             supplier_order_id = $2
             OR (supplier_order_id IS NULL AND batch_number <> '' AND batch_number = $3 AND supplier_name = $4)
           )`,
        [tenantId, order.id, order.order_number, order.supplier_name],
      );
      if (linkedBatches.length > 0) {
        const res = await this.deleteBatchesInTx(
          tx,
          tenantId,
          linkedBatches.map((b) => b.id),
        );
        rolledBackBatchesCount += res.deletedCount;
      }

      // 2. Возвращаем связанные заявки на закупку в статус 'pending'
      await tx.query(
        `UPDATE purchase_requests
         SET status = 'pending', supplier_order_id = NULL, updated_at = now()
         WHERE tenant_id = $1
           AND (
             supplier_order_id = $2
             OR id IN (
               SELECT purchase_request_id FROM supplier_order_items
               WHERE tenant_id = $1 AND supplier_order_id = $2 AND purchase_request_id IS NOT NULL
             )
             OR id IN (
               SELECT unnest(COALESCE(purchase_request_ids, ARRAY[]::uuid[]))
               FROM supplier_order_items
               WHERE tenant_id = $1 AND supplier_order_id = $2
             )
           )`,
        [tenantId, order.id],
      );

      // 3. Мягко удаляем все связанные кассовые проводки (оплата заказа + доп. расходы приёмок) и пересчитываем баланс
      const removedTxs = await tx.query<{ cash_account_id: string }>(
        `UPDATE transactions
         SET deleted_at = now()
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND (
             id = $2
             OR supplier_order_id = $3
             OR supplier_order_receipt_id IN (
               SELECT id FROM supplier_order_receipts
               WHERE tenant_id = $1 AND supplier_order_id = $3
             )
           )
         RETURNING cash_account_id`,
        [tenantId, order.finance_transaction_id, order.id],
      );
      const affectedAccs = Array.from(
        new Set([
          ...removedTxs.map((r) => r.cash_account_id),
          ...(order.cash_account_id ? [order.cash_account_id] : []),
        ]),
      );
      for (const accId of affectedAccs) {
        await recalculateCashAccountBalanceInTx(tx, tenantId, accId);
      }
    }

    const existingIds = orders.map((o) => o.id);
    await tx.query(
      `DELETE FROM supplier_order_items WHERE tenant_id = $1 AND supplier_order_id = ANY($2::uuid[])`,
      [tenantId, existingIds],
    );
    const deletedOrders = await tx.query<{ id: string }>(
      `DELETE FROM supplier_orders WHERE tenant_id = $1 AND id = ANY($2::uuid[]) RETURNING id`,
      [tenantId, existingIds],
    );

    return { deletedCount: deletedOrders.length, rolledBackBatchesCount };
  }

  async deleteSupplierOrder(tenantId: string, id: string): Promise<boolean> {
    return withTenant(tenantId, async (tx) => {
      const { deletedCount } = await this.deleteSupplierOrdersInTx(tx, tenantId, [id]);
      if (deletedCount === 0) {
        throw new Error("Заказ поставщику не найден");
      }
      return true;
    });
  }

  async bulkDeleteSupplierOrders(
    tenantId: string,
    ids: string[],
  ): Promise<{ deletedCount: number; rolledBackBatchesCount: number }> {
    return withTenant(tenantId, async (tx) => {
      return this.deleteSupplierOrdersInTx(tx, tenantId, ids);
    });
  }

  async listSupplierOrders(tenantId: string, status?: string): Promise<SupplierOrderDTO[]> {
    const params: (string | number)[] = [tenantId];
    let filter = "";

    if (status && status !== "all") {
      params.push(status);
      filter = `AND o.status = $${params.length}`;
    }

    const orderRows = await query<SupplierOrderRow>(
      `SELECT o.*, u.name AS created_by_name
       FROM supplier_orders o
       LEFT JOIN users u ON u.id = o.created_by AND u.tenant_id = o.tenant_id
       WHERE o.tenant_id = $1 ${filter}
       ORDER BY o.created_at DESC`,
      params,
    );

    if (orderRows.length === 0) return [];

    const orderIds = orderRows.map((o) => o.id);
    const itemRows = await query<
      SupplierOrderItemRow & { repair_ticket_number?: string | null }
    >(
      `SELECT soi.*,
              COALESCE(ro.ticket_number, pr_ro.ticket_number) AS repair_ticket_number
       FROM supplier_order_items soi
       LEFT JOIN repair_orders ro ON ro.id = soi.repair_order_id AND ro.tenant_id = soi.tenant_id
       LEFT JOIN purchase_requests pr ON pr.id = soi.purchase_request_id AND pr.tenant_id = soi.tenant_id
       LEFT JOIN repair_orders pr_ro ON pr_ro.id = pr.repair_order_id AND pr_ro.tenant_id = soi.tenant_id
       WHERE soi.tenant_id = $1 AND soi.supplier_order_id = ANY($2::uuid[])
       ORDER BY soi.created_at ASC`,
      [tenantId, orderIds],
    );

    const itemsByOrder = new Map<string, SupplierOrderItemDTO[]>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.supplier_order_id) ?? [];
      const totalQty = Number(item.quantity);
      const receivedQty = Number(item.received_quantity || 0);
      const remainingQty = Math.max(0, Math.round((totalQty - receivedQty) * 100) / 100);
      const reqQty = Number(item.requested_quantity || 0);
      const extraQty = Number(item.extra_quantity || Math.max(0, totalQty - reqQty));
      list.push({
        id: item.id,
        supplierOrderId: item.supplier_order_id,
        purchaseRequestId: item.purchase_request_id,
        itemId: item.item_id,
        itemName: item.item_name,
        sku: item.sku,
        requestedQuantity: reqQty,
        extraQuantity: extraQty,
        repairOrderId: item.repair_order_id ?? null,
        purchaseRequestIds: item.purchase_request_ids || [],
        repairOrders: item.repair_ticket_number ? `№${item.repair_ticket_number}` : undefined,
        quantity: totalQty,
        receivedQuantity: receivedQty,
        remainingQuantity: remainingQty,
        unit: item.unit,
        price: Number(item.price),
        totalPrice: Number(item.total_price),
        createdAt: toIso(item.created_at),
      });
      itemsByOrder.set(item.supplier_order_id, list);
    }

    // Загружаем историю приёмок и доп. расходов одним пакетным запросом
    const receiptRows = await query<{
      id: string;
      supplier_order_id: string;
      receipt_number: string;
      allocation_method: string;
      extra_costs_total: string | number;
      notes: string;
      created_by: string | null;
      created_by_name?: string | null;
      created_at: Date | string;
    }>(
      `SELECT r.*, COALESCE(u.name, u.email, '') AS created_by_name
       FROM supplier_order_receipts r
       LEFT JOIN users u ON u.id = r.created_by AND u.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1 AND r.supplier_order_id = ANY($2::uuid[])
       ORDER BY r.created_at DESC`,
      [tenantId, orderIds],
    );

    const receiptIds = receiptRows.map((r) => r.id);
    const receiptItemsByReceipt = new Map<string, SupplierOrderReceiptItemDTO[]>();
    const receiptCostsByReceipt = new Map<string, SupplierOrderReceiptCostDTO[]>();

    if (receiptIds.length > 0) {
      const rItems = await query<{
        id: string;
        receipt_id: string;
        supplier_order_item_id: string;
        batch_id: string | null;
        item_id: string | null;
        item_name: string;
        quantity: string | number;
        base_unit_price: string | number;
        allocated_extra_cost: string | number;
        unit_landed_cost: string | number;
        effective_unit_price: string | number;
        created_at: Date | string;
      }>(
        `SELECT * FROM supplier_order_receipt_items
         WHERE tenant_id = $1 AND receipt_id = ANY($2::uuid[])
         ORDER BY created_at ASC`,
        [tenantId, receiptIds],
      );
      for (const ri of rItems) {
        const arr = receiptItemsByReceipt.get(ri.receipt_id) ?? [];
        arr.push({
          id: ri.id,
          receiptId: ri.receipt_id,
          supplierOrderItemId: ri.supplier_order_item_id,
          batchId: ri.batch_id,
          itemId: ri.item_id,
          itemName: ri.item_name,
          quantity: Number(ri.quantity),
          baseUnitPrice: Number(ri.base_unit_price),
          allocatedExtraCost: Number(ri.allocated_extra_cost),
          unitLandedCost: Number(ri.unit_landed_cost),
          effectiveUnitPrice: Number(ri.effective_unit_price),
          createdAt: toIso(ri.created_at),
        });
        receiptItemsByReceipt.set(ri.receipt_id, arr);
      }

      const rCosts = await query<{
        id: string;
        receipt_id: string;
        description: string;
        amount: string | number;
        category_id: string | null;
        category_name: string;
        cash_account_id: string | null;
        transaction_id: string | null;
        created_at: Date | string;
      }>(
        `SELECT * FROM supplier_order_receipt_costs
         WHERE tenant_id = $1 AND receipt_id = ANY($2::uuid[])
         ORDER BY created_at ASC`,
        [tenantId, receiptIds],
      );
      for (const rc of rCosts) {
        const arr = receiptCostsByReceipt.get(rc.receipt_id) ?? [];
        arr.push({
          id: rc.id,
          receiptId: rc.receipt_id,
          description: rc.description,
          amount: Number(rc.amount),
          categoryId: rc.category_id,
          categoryName: rc.category_name,
          cashAccountId: rc.cash_account_id,
          transactionId: rc.transaction_id,
          createdAt: toIso(rc.created_at),
        });
        receiptCostsByReceipt.set(rc.receipt_id, arr);
      }
    }

    const receiptsByOrder = new Map<string, SupplierOrderReceiptDTO[]>();
    for (const r of receiptRows) {
      const arr = receiptsByOrder.get(r.supplier_order_id) ?? [];
      arr.push({
        id: r.id,
        supplierOrderId: r.supplier_order_id,
        receiptNumber: r.receipt_number,
        allocationMethod:
          r.allocation_method === "by_quantity" || r.allocation_method === "manual"
            ? r.allocation_method
            : "by_value",
        extraCostsTotal: Number(r.extra_costs_total),
        notes: r.notes || "",
        createdBy: r.created_by,
        createdByName: r.created_by_name || null,
        items: receiptItemsByReceipt.get(r.id) ?? [],
        costs: receiptCostsByReceipt.get(r.id) ?? [],
        createdAt: toIso(r.created_at),
      });
      receiptsByOrder.set(r.supplier_order_id, arr);
    }

    return orderRows.map((o) => {
      const orderItems = itemsByOrder.get(o.id) ?? [];
      const orderReceipts = receiptsByOrder.get(o.id) ?? [];
      const orderedQuantityTotal =
        Math.round(orderItems.reduce((s, it) => s + it.quantity, 0) * 100) / 100;
      const receivedQuantityTotal =
        Math.round(orderItems.reduce((s, it) => s + it.receivedQuantity, 0) * 100) / 100;
      const extraCostsTotal =
        Math.round(orderReceipts.reduce((s, r) => s + r.extraCostsTotal, 0) * 100) / 100;

      return {
        id: o.id,
        orderNumber: o.order_number,
        supplierName: o.supplier_name,
        supplierCompanyId: o.supplier_company_id ?? null,
        status: (o.status as SupplierOrderStatus) || "pending_payment",
        totalAmount: Number(o.total_amount),
        cashAccountId: o.cash_account_id,
        financeTransactionId: o.finance_transaction_id,
        notes: o.notes,
        paidAt: toNullableIso(o.paid_at),
        receivedAt: toNullableIso(o.received_at),
        createdBy: o.created_by,
        createdByName: o.created_by_name,
        items: orderItems,
        orderedQuantityTotal,
        receivedQuantityTotal,
        extraCostsTotal,
        receipts: orderReceipts,
        createdAt: toIso(o.created_at),
        updatedAt: toIso(o.updated_at),
      };
    });
  }

  async getSupplierOrder(tenantId: string, id: string): Promise<SupplierOrderDTO | null> {
    const list = await this.listSupplierOrders(tenantId);
    return list.find((o) => o.id === id) ?? null;
  }

  /**
   * Оплата заказа поставщику через кассу (формирование РКО)
   */
  async paySupplierOrder(
    tenantId: string,
    id: string,
    userId: string | null,
    payload: PaySupplierOrderPayload,
  ): Promise<{ order: SupplierOrderDTO; transactionId: string; status: string }> {
    const payResult = await withTenant(tenantId, async (tx) => {
      const order = await tx.queryOneOrThrow<SupplierOrderRow>(
        `SELECT * FROM supplier_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );

      if (order.status === "cancelled") {
        throw new ValidationError("Нельзя оплатить отменённый заказ поставщику");
      }

      if (order.finance_transaction_id) {
        const existingTx = await tx.queryOne<{ id: string }>(
          `SELECT id FROM transactions WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, order.finance_transaction_id],
        );
        if (existingTx) {
          throw new ValidationError("Заказ поставщику уже оплачен");
        }
      }

      const totalAmount = Number(order.total_amount);

      // Определяем кассовый счет
      let cashAccountId = payload.cash_account_id || order.cash_account_id;
      if (!cashAccountId) {
        const defaultCash = await tx.queryOne<{ id: string }>(
          `SELECT id FROM cash_accounts WHERE tenant_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
          [tenantId],
        );
        if (defaultCash) {
          cashAccountId = defaultCash.id;
        } else {
          const newCash = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO cash_accounts (tenant_id, name, is_default, balance)
             VALUES ($1, 'Основная касса', true, 0)
             RETURNING id`,
            [tenantId],
          );
          cashAccountId = newCash.id;
        }
      }

      // Категория расхода: «Закупка запчастей» (существующая категория тенанта или автосоздание)
      const cat = await resolvePartsPurchaseCategoryInTx(tx, tenantId);
      const linkedRepairOrderId = await resolveSupplierOrderRepairIdInTx(tx, tenantId, order.id);
      const authorId = safeUuid(userId) ?? safeUuid(order.created_by);

      // Проводка в transactions (РКО) с category_id, category_name, supplier_order_id и created_by
      const description =
        payload.comment || `Оплата заказа поставщику ${order.order_number} (${order.supplier_name})`;
      const txRow = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO transactions
           (tenant_id, cash_account_id, category_id, category_name, amount, direction, description, counterparty_name, supplier_order_id, repair_order_id, occurred_at, created_by)
         VALUES ($1, $2, $3, $4, $5, 'expense', $6, $7, $8, $9, now(), $10)
         RETURNING id`,
        [
          tenantId,
          cashAccountId,
          cat.id,
          cat.name,
          totalAmount,
          description,
          order.supplier_name,
          order.id,
          linkedRepairOrderId,
          authorId,
        ],
      );

      // Пересчитываем баланс кассы по активным операциям
      await recalculateCashAccountBalanceInTx(tx, tenantId, cashAccountId);

      // Переводим заказ в статус 'paid' (если уже 'received' или 'partially_received' — сохраняем статус приёмки)
      const nextStatus =
        order.status === "received" || order.status === "partially_received"
          ? order.status
          : "paid";
      await tx.query(
        `UPDATE supplier_orders
         SET status = $1, cash_account_id = $2, finance_transaction_id = $3, paid_at = now(), updated_at = now()
         WHERE tenant_id = $4 AND id = $5`,
        [nextStatus, cashAccountId, txRow.id, tenantId, id],
      );

      return { transactionId: txRow.id };
    });

    const refreshed = await this.getSupplierOrder(tenantId, id);
    return {
      order: refreshed!,
      transactionId: payResult.transactionId,
      status: "PAID",
    };
  }

  /**
   * Полное или частичное оприходование по заказу поставщику с распределением доп. расходов (Landed Cost),
   * историей приёмок, созданием FIFO-партий, резервированием под наряды и отражением доп. расходов в Финансах.
   */
  async createReceiptFromSupplierOrder(
    tenantId: string,
    id: string,
    userId: string | null,
    payload?: ReceiptSupplierOrderPayload,
  ): Promise<{
    success: boolean;
    order: SupplierOrderDTO;
    batchesCreated: number;
    receiptId: string;
    status: SupplierOrderStatus;
    extraCostsTotal: number;
    transactionId?: string;
  }> {
    const receiptResult = await withTenant(tenantId, async (tx) => {
      const order = await tx.queryOneOrThrow<SupplierOrderRow>(
        `SELECT * FROM supplier_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );

      if (order.status === "cancelled") {
        throw new ValidationError("Нельзя оприходовать отменённый заказ поставщику");
      }
      if (order.status === "received") {
        throw new ValidationError("Заказ поставщику уже полностью оприходован");
      }

      const items = await tx.query<SupplierOrderItemRow>(
        `SELECT *
         FROM supplier_order_items
         WHERE tenant_id = $1 AND supplier_order_id = $2
         ORDER BY created_at ASC
         FOR UPDATE`,
        [tenantId, id],
      );

      if (items.length === 0) {
        throw new ValidationError("В заказе поставщику нет позиций для оприходования");
      }

      const itemsById = new Map(items.map((it) => [it.id, it]));

      // Формируем список строк к приёмке с жёсткой проверкой остатка под FOR UPDATE
      const linesToReceive: Array<{
        row: SupplierOrderItemRow;
        deltaQty: number;
        manualExtraCost?: number;
      }> = [];

      if (payload?.items && payload.items.length > 0) {
        const seenItemIds = new Set<string>();
        for (const reqLine of payload.items) {
          if (seenItemIds.has(reqLine.supplier_order_item_id)) {
            throw new ValidationError("Дублирующаяся позиция в запросе приёмки");
          }
          seenItemIds.add(reqLine.supplier_order_item_id);

          const row = itemsById.get(reqLine.supplier_order_item_id);
          if (!row) {
            throw new ValidationError("Позиция заказа поставщику не найдена");
          }

          const deltaQty = Math.round(Number(reqLine.quantity) * 100) / 100;
          if (deltaQty <= 0) continue;

          const orderedQty = Number(row.quantity);
          const alreadyReceived = Number(row.received_quantity || 0);
          const remainingQty = Math.max(0, Math.round((orderedQty - alreadyReceived) * 100) / 100);

          if (deltaQty > remainingQty + 0.0001) {
            throw new ValidationError(
              `Количество к приёмке по позиции «${row.item_name}» превышает остаток (осталось ${remainingQty}, запрошено ${deltaQty})`,
            );
          }

          linesToReceive.push({
            row,
            deltaQty,
            manualExtraCost: reqLine.manual_extra_cost,
          });
        }
      } else {
        // Обратная совместимость: приёмка всего оставшегося остатка по заказу
        for (const row of items) {
          const orderedQty = Number(row.quantity);
          const alreadyReceived = Number(row.received_quantity || 0);
          const remainingQty = Math.max(0, Math.round((orderedQty - alreadyReceived) * 100) / 100);
          if (remainingQty > 0) {
            linesToReceive.push({ row, deltaQty: remainingQty });
          }
        }
      }

      if (linesToReceive.length === 0) {
        throw new ValidationError("Укажите количество больше 0 хотя бы для одной позиции");
      }

      // Расчёт и валидация дополнительных расходов (Landed Cost)
      const extraCostsInput = (payload?.extra_costs ?? []).filter((c) => Number(c.amount) > 0);
      const extraCostsTotal =
        Math.round(extraCostsInput.reduce((s, c) => s + Number(c.amount), 0) * 100) / 100;
      const allocationMethod: LandedCostAllocationMethod = payload?.allocation_method ?? "by_value";

      let allocations;
      try {
        allocations = allocateLandedCost(
          linesToReceive.map((l) => ({
            id: l.row.id,
            quantity: l.deltaQty,
            baseUnitPrice: Number(l.row.price),
            manualExtraCost: l.manualExtraCost,
          })),
          extraCostsTotal,
          allocationMethod,
        );
      } catch (err) {
        throw new ValidationError(
          err instanceof Error ? err.message : "Ошибка распределения доп. расходов",
        );
      }
      const allocationByItemId = new Map(allocations.map((a) => [a.id, a]));

      // Нумерация приёмки в рамках заказа: ЗП-2026-0001/1, /2, ...
      const prevReceiptsCountRow = await tx.queryOne<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
         FROM supplier_order_receipts
         WHERE tenant_id = $1 AND supplier_order_id = $2`,
        [tenantId, order.id],
      );
      const nextReceiptIndex = Number(prevReceiptsCountRow?.cnt ?? 0) + 1;
      const receiptNumber = `${order.order_number}/${nextReceiptIndex}`;
      const authorId = safeUuid(userId) ?? safeUuid(order.created_by);

      // Записываем заголовок приёмки
      const receiptRow = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO supplier_order_receipts
           (tenant_id, supplier_order_id, receipt_number, allocation_method, extra_costs_total, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          tenantId,
          order.id,
          receiptNumber,
          allocationMethod,
          extraCostsTotal,
          payload?.comment?.trim() || "",
          authorId,
        ],
      );

      // Проводим доп. расходы в Финансы (отдельной операцией расхода под выбранной категорией, is_capitalized_cost = true)
      if (extraCostsInput.length > 0) {
        const defaultCash = await tx.queryOne<{ id: string }>(
          `SELECT id FROM cash_accounts WHERE tenant_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
          [tenantId],
        );

        const touchedCashAccounts = new Set<string>();
        const linkedRepairOrderId = await resolveSupplierOrderRepairIdInTx(tx, tenantId, order.id);

        for (const cost of extraCostsInput) {
          let costAccountId =
            safeUuid(cost.cash_account_id) ||
            safeUuid(payload?.cash_account_id) ||
            order.cash_account_id ||
            defaultCash?.id ||
            null;

          if (!costAccountId) {
            const createdCash = await tx.queryOneOrThrow<{ id: string }>(
              `INSERT INTO cash_accounts (tenant_id, name, is_default, balance)
               VALUES ($1, 'Основная касса', true, 0)
               RETURNING id`,
              [tenantId],
            );
            costAccountId = createdCash.id;
          }

          const resolvedCat = await resolveExtraCostCategoryInTx(
            tx,
            tenantId,
            cost.category_id,
            cost.category_name,
          );
          const costAmount = Math.round(Number(cost.amount) * 100) / 100;
          const costDesc =
            cost.description?.trim() ||
            `Доп. расход (${resolvedCat.name}) к приёмке ${receiptNumber}`;
          const costCounterparty = cost.counterparty_name?.trim() || order.supplier_name;

          const costTxRow = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO transactions
               (tenant_id, cash_account_id, category_id, category_name, amount, direction, description,
                counterparty_name, supplier_order_id, supplier_order_receipt_id, repair_order_id,
                is_capitalized_cost, occurred_at, created_by)
             VALUES ($1, $2, $3, $4, $5, 'expense', $6, $7, $8, $9, $10, true, now(), $11)
             RETURNING id`,
            [
              tenantId,
              costAccountId,
              resolvedCat.id,
              resolvedCat.name,
              costAmount,
              costDesc,
              costCounterparty,
              order.id,
              receiptRow.id,
              linkedRepairOrderId,
              authorId,
            ],
          );

          touchedCashAccounts.add(costAccountId);

          await tx.query(
            `INSERT INTO supplier_order_receipt_costs
               (tenant_id, receipt_id, description, amount, category_id, category_name, cash_account_id, transaction_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              tenantId,
              receiptRow.id,
              costDesc,
              costAmount,
              resolvedCat.id,
              resolvedCat.name,
              costAccountId,
              costTxRow.id,
            ],
          );
        }

        for (const accId of touchedCashAccounts) {
          await recalculateCashAccountBalanceInTx(tx, tenantId, accId);
        }
      }

      let batchesCount = 0;

      for (const { row: it, deltaQty } of linesToReceive) {
        const alloc = allocationByItemId.get(it.id)!;
        const basePrice = alloc.baseUnitPrice;
        const effectiveUnitPrice = alloc.effectiveUnitPrice;
        const unitLandedCost = alloc.unitLandedCost;
        const allocatedExtraCost = alloc.allocatedExtraCost;

        let itemId = it.item_id;

        if (!itemId) {
          if (it.sku) {
            const found = await tx.queryOne<{ id: string }>(
              `SELECT id FROM warehouse_items WHERE tenant_id = $1 AND lower(sku) = lower($2) AND deleted_at IS NULL`,
              [tenantId, it.sku],
            );
            if (found) itemId = found.id;
          }

          if (!itemId) {
            const newItem = await tx.queryOneOrThrow<{ id: string }>(
              `INSERT INTO warehouse_items (tenant_id, sku, name, category, unit, cost_price, retail_price)
               VALUES ($1, $2, $3, 'Запчасти', $4, $5, $6)
               RETURNING id`,
              [
                tenantId,
                it.sku ?? "",
                it.item_name,
                it.unit ?? "шт",
                effectiveUnitPrice,
                Math.round(effectiveUnitPrice * 1.4 * 100) / 100,
              ],
            );
            itemId = newItem.id;
          }
        }

        // Обновляем себестоимость в номенклатуре с учётом Landed Cost
        await tx.query(
          `UPDATE warehouse_items
           SET cost_price = $1, updated_at = now()
           WHERE tenant_id = $2 AND id = $3`,
          [effectiveUnitPrice, tenantId, itemId],
        );

        // Создаём партию FIFO на фактически поступившее количество с точной удельной себестоимостью
        const batch = await tx.queryOneOrThrow<WarehouseBatchRow>(
          `INSERT INTO warehouse_batches
             (tenant_id, item_id, supplier_order_id, receipt_id, batch_number, supplier_name,
              purchase_price, base_purchase_price, landed_cost_per_unit, landed_cost_total,
              initial_quantity, remaining_quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING *`,
          [
            tenantId,
            itemId,
            order.id,
            receiptRow.id,
            receiptNumber,
            order.supplier_name,
            effectiveUnitPrice,
            basePrice,
            unitLandedCost,
            allocatedExtraCost,
            deltaQty,
            deltaQty,
          ],
        );

        // Фиксируем поступление на склад (intake) с эффективной себестоимостью
        const intakeDesc =
          allocatedExtraCost > 0
            ? `Поступление ${receiptNumber} (${order.supplier_name}, база ${basePrice} ₽ + доп. расх. ${allocatedExtraCost} ₽)`
            : `Поступление по заказу поставщику ${receiptNumber} (${order.supplier_name})`;

        await tx.query(
          `INSERT INTO warehouse_movements
             (tenant_id, item_id, batch_id, type, quantity, cost_price, description, created_by)
           VALUES ($1, $2, $3, 'intake', $4, $5, $6, $7)`,
          [tenantId, itemId, batch.id, deltaQty, effectiveUnitPrice, intakeDesc, authorId],
        );

        // Сохраняем строку истории приёмки
        await tx.query(
          `INSERT INTO supplier_order_receipt_items
             (tenant_id, receipt_id, supplier_order_item_id, batch_id, item_id, item_name,
              quantity, base_unit_price, allocated_extra_cost, unit_landed_cost, effective_unit_price)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            tenantId,
            receiptRow.id,
            it.id,
            batch.id,
            itemId,
            it.item_name,
            deltaQty,
            basePrice,
            allocatedExtraCost,
            unitLandedCost,
            effectiveUnitPrice,
          ],
        );

        // Обновляем накопленное принятое количество по строке заказа
        await tx.query(
          `UPDATE supplier_order_items
           SET received_quantity = received_quantity + $1,
               item_id = COALESCE(item_id, $2)
           WHERE tenant_id = $3 AND id = $4`,
          [deltaQty, itemId, tenantId, it.id],
        );

        batchesCount++;

        // Резервируем под связанные заявки на закупку в пределах фактически поступившего deltaQty
        const reqQty = Number(it.requested_quantity || 0);
        const linkedReqIds: string[] = [];
        if (it.purchase_request_ids && it.purchase_request_ids.length > 0) {
          linkedReqIds.push(...it.purchase_request_ids);
        } else if (it.purchase_request_id) {
          linkedReqIds.push(it.purchase_request_id);
        }

        let linkedRequests: PurchaseRequestRow[] = [];
        if (linkedReqIds.length > 0) {
          linkedRequests = await tx.query<PurchaseRequestRow>(
            `SELECT * FROM purchase_requests
             WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND status <> 'received'
             ORDER BY created_at ASC`,
            [tenantId, linkedReqIds],
          );
        } else if (reqQty > 0) {
          linkedRequests = await tx.query<PurchaseRequestRow>(
            `SELECT * FROM purchase_requests
             WHERE tenant_id = $1 AND supplier_order_id = $2 AND status <> 'received'
               AND (item_id = $3 OR lower(btrim(item_name)) = lower(btrim($4)))
             ORDER BY created_at ASC`,
            [tenantId, id, itemId, it.item_name],
          );
        }

        let availableToReserve = deltaQty;
        for (const req of linkedRequests) {
          if (availableToReserve <= 0) break;
          const partQty = Number(req.quantity);

          if (req.repair_order_id && partQty > 0) {
            const alreadyReservedRow = await tx.queryOne<{ qty: string }>(
              `SELECT COALESCE(SUM(quantity), 0)::text AS qty
               FROM warehouse_reservations
               WHERE tenant_id = $1 AND repair_order_id = $2 AND item_id = $3 AND status = 'reserved'`,
              [tenantId, req.repair_order_id, itemId],
            );
            const alreadyReserved = Number(alreadyReservedRow?.qty ?? 0);
            const stillNeeded = Math.max(0, Math.round((partQty - alreadyReserved) * 100) / 100);
            const reserveNow = Math.min(availableToReserve, stillNeeded);

            if (reserveNow > 0) {
              await tx.query(
                `INSERT INTO warehouse_reservations
                   (tenant_id, repair_order_id, item_id, batch_id, quantity, status)
                 VALUES ($1, $2, $3, $4, $5, 'reserved')`,
                [tenantId, req.repair_order_id, itemId, batch.id, reserveNow],
              );

              await tx.query(
                `INSERT INTO warehouse_movements
                   (tenant_id, item_id, batch_id, repair_order_id, type, quantity, cost_price, description, created_by)
                 VALUES ($1, $2, $3, $4, 'reserve', $5, $6, $7, $8)`,
                [
                  tenantId,
                  itemId,
                  batch.id,
                  req.repair_order_id,
                  reserveNow,
                  effectiveUnitPrice,
                  `Резерв под наряд по приёмке ${receiptNumber} (${it.item_name})`,
                  authorId,
                ],
              );

              await tx.query(
                `UPDATE repair_parts
                 SET warehouse_item_id = $1, cost_price = $2, status = 'reserved'
                 WHERE tenant_id = $3 AND repair_order_id = $4
                   AND (warehouse_item_id = $1 OR lower(btrim(name)) = lower(btrim($5)))`,
                [itemId, effectiveUnitPrice, tenantId, req.repair_order_id, it.item_name],
              );

              availableToReserve = Math.max(0, Math.round((availableToReserve - reserveNow) * 100) / 100);
            }

            if (alreadyReserved + reserveNow >= partQty - 0.0001) {
              await tx.query(
                `UPDATE purchase_requests
                 SET status = 'received', item_id = COALESCE(item_id, $3), updated_at = now()
                 WHERE tenant_id = $1 AND id = $2`,
                [tenantId, req.id, itemId],
              );
            }
          } else {
            const consumedForReq = Math.min(availableToReserve, partQty);
            availableToReserve = Math.max(0, Math.round((availableToReserve - consumedForReq) * 100) / 100);
            if (consumedForReq >= partQty - 0.0001) {
              await tx.query(
                `UPDATE purchase_requests
                 SET status = 'received', item_id = COALESCE(item_id, $3), updated_at = now()
                 WHERE tenant_id = $1 AND id = $2`,
                [tenantId, req.id, itemId],
              );
            }
          }

          if (req.deal_id) {
            await this.fulfillWonDealIfReadyInTx(
              tx,
              tenantId,
              req.deal_id,
              req.deal_item_id ?? null,
              itemId,
              authorId,
            );
          }
        }
      }

      let paidTransactionId: string | undefined;

      // Если в модалке подтвердили оплату заказа при оприходовании (и заказ ещё не оплачен активной проводкой):
      const hasActivePaymentTx = order.finance_transaction_id
        ? Boolean(
            await tx.queryOne<{ id: string }>(
              `SELECT id FROM transactions WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
              [tenantId, order.finance_transaction_id],
            ),
          )
        : false;

      if ((payload?.mark_paid || safeUuid(payload?.cash_account_id)) && !hasActivePaymentTx) {
        let cashAccountId = safeUuid(payload?.cash_account_id) || order.cash_account_id;
        if (!cashAccountId) {
          const defaultCash = await tx.queryOne<{ id: string }>(
            `SELECT id FROM cash_accounts WHERE tenant_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
            [tenantId],
          );
          cashAccountId = defaultCash?.id ?? null;
        }

        if (cashAccountId) {
          const cat = await resolvePartsPurchaseCategoryInTx(tx, tenantId);
          const linkedRepairOrderId = await resolveSupplierOrderRepairIdInTx(tx, tenantId, order.id);

          const desc =
            payload?.comment ||
            `Оплата при оприходовании заказа ${order.order_number} (${order.supplier_name})`;
          const txRow = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO transactions
               (tenant_id, cash_account_id, category_id, category_name, amount, direction, description, counterparty_name, supplier_order_id, repair_order_id, occurred_at, created_by)
             VALUES ($1, $2, $3, $4, $5, 'expense', $6, $7, $8, $9, now(), $10)
             RETURNING id`,
            [
              tenantId,
              cashAccountId,
              cat.id,
              cat.name,
              Number(order.total_amount),
              desc,
              order.supplier_name,
              order.id,
              linkedRepairOrderId,
              authorId,
            ],
          );

          await recalculateCashAccountBalanceInTx(tx, tenantId, cashAccountId);

          paidTransactionId = txRow.id;

          await tx.query(
            `UPDATE supplier_orders
             SET paid_at = now(), cash_account_id = $1, finance_transaction_id = $2
             WHERE tenant_id = $3 AND id = $4`,
            [cashAccountId, txRow.id, tenantId, id],
          );
        }
      }

      // Определяем итоговый статус заказа: полностью принят или частично оприходован
      const remainingRows = await tx.query<{ remaining: string }>(
        `SELECT GREATEST(quantity - received_quantity, 0)::text AS remaining
         FROM supplier_order_items
         WHERE tenant_id = $1 AND supplier_order_id = $2`,
        [tenantId, id],
      );
      const isFullyReceived = remainingRows.every((r) => Number(r.remaining) <= 0.0001);
      const nextStatus: SupplierOrderStatus = isFullyReceived ? "received" : "partially_received";

      await tx.query(
        `UPDATE supplier_orders
         SET status = $1,
             received_at = CASE WHEN $1 = 'received' THEN now() ELSE received_at END,
             updated_at = now()
         WHERE tenant_id = $2 AND id = $3`,
        [nextStatus, tenantId, id],
      );

      return {
        batchesCreated: batchesCount,
        receiptId: receiptRow.id,
        status: nextStatus,
        extraCostsTotal,
        transactionId: paidTransactionId,
      };
    });

    const refreshed = await this.getSupplierOrder(tenantId, id);

    return {
      success: true,
      order: refreshed!,
      batchesCreated: receiptResult.batchesCreated,
      receiptId: receiptResult.receiptId,
      status: receiptResult.status,
      extraCostsTotal: receiptResult.extraCostsTotal,
      transactionId: receiptResult.transactionId,
    };
  }

  // ---------------------------------------------------------------------------
  // Repair Order FIFO Consumption & Deficit Write-off
  // ---------------------------------------------------------------------------

  /**
   * Рассчитывает ожидаемую FIFO-себестоимость за единицу для запрошенного количества
   * по непустым партиям товара (ORDER BY received_at ASC).
   */
  async estimateFifoUnitCost(
    tx: TransactionClient,
    tenantId: string,
    itemId: string,
    quantity: number,
  ): Promise<{ unitCost: number; hasBatches: boolean; itemCostPrice: number }> {
    const itemRow = await tx.queryOne<{ cost_price: string }>(
      `SELECT cost_price FROM warehouse_items WHERE tenant_id = $1 AND id = $2`,
      [tenantId, itemId],
    );
    const fallbackCost = Number(itemRow?.cost_price ?? 0);

    const batches = await tx.query<{ remaining_quantity: string; purchase_price: string }>(
      `SELECT remaining_quantity, purchase_price
       FROM warehouse_batches
       WHERE tenant_id = $1 AND item_id = $2 AND remaining_quantity > 0
       ORDER BY received_at ASC, created_at ASC`,
      [tenantId, itemId],
    );

    if (batches.length === 0 || quantity <= 0) {
      return { unitCost: fallbackCost, hasBatches: false, itemCostPrice: fallbackCost };
    }

    let remaining = quantity;
    let totalCost = 0;

    for (const batch of batches) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, Number(batch.remaining_quantity));
      totalCost += take * Number(batch.purchase_price);
      remaining -= take;
    }

    if (remaining > 0) {
      const lastBatchPrice = Number(batches[batches.length - 1]?.purchase_price ?? fallbackCost);
      totalCost += remaining * lastBatchPrice;
    }

    return {
      unitCost: Math.round((totalCost / quantity) * 100) / 100,
      hasBatches: true,
      itemCostPrice: fallbackCost,
    };
  }

  /**
   * Идемпотентное списание запчастей наряда по партиям (FIFO) внутри открытой транзакции.
   * Приоритизирует явно зарезервированные под наряд партии (batch_id), затем остальные по received_at ASC.
   * Фиксирует разбивку в repair_part_batch_allocations, движения write_off с repair_part_id
   * и обновляет repair_parts.cost_price фактической средневзвешенной себестоимостью списания.
   */
  async consumePartsForOrderInTx(
    tx: TransactionClient,
    tenantId: string,
    orderId: string,
    userId: string,
  ): Promise<void> {
    const parts = await tx.query<{
      id: string;
      warehouse_item_id: string | null;
      name: string;
      quantity: number;
      retail_price: string;
      cost_price: string;
      consumed_at: Date | string | null;
    }>(
      `SELECT id, warehouse_item_id, name, quantity, retail_price, cost_price, consumed_at
       FROM repair_parts
       WHERE tenant_id = $1 AND repair_order_id = $2
       FOR UPDATE`,
      [tenantId, orderId],
    );

    const settingsRow = await tx.queryOne<{ allow_negative_stock: boolean }>(
      `SELECT allow_negative_stock FROM warehouse_settings WHERE tenant_id = $1`,
      [tenantId],
    );
    const allowNegativeStock = Boolean(settingsRow?.allow_negative_stock);

    for (const part of parts) {
      if (!part.warehouse_item_id || part.consumed_at !== null) continue;

      const totalQty = Number(part.quantity);
      if (totalQty <= 0) continue;

      let needed = totalQty;
      let totalCost = 0;
      let consumedFromBatches = 0;

      // Сначала собираем явно зарезервированные партии под этот наряд
      const reservedBatches = await tx.query<{ batch_id: string }>(
        `SELECT DISTINCT batch_id
         FROM warehouse_reservations
         WHERE tenant_id = $1 AND repair_order_id = $2 AND item_id = $3
           AND status = 'reserved' AND batch_id IS NOT NULL`,
        [tenantId, orderId, part.warehouse_item_id],
      );
      const reservedBatchIds = reservedBatches.map((r) => r.batch_id);

      const batches = await tx.query<{ id: string; remaining_quantity: string; purchase_price: string }>(
        `SELECT id, remaining_quantity, purchase_price
         FROM warehouse_batches
         WHERE tenant_id = $1 AND item_id = $2 AND remaining_quantity > 0
         ORDER BY
           CASE WHEN id = ANY($3::uuid[]) THEN 0 ELSE 1 END ASC,
           received_at ASC,
           created_at ASC
         FOR UPDATE`,
        [tenantId, part.warehouse_item_id, reservedBatchIds],
      );

      for (const batch of batches) {
        if (needed <= 0) break;
        const rem = Number(batch.remaining_quantity);
        const take = Math.min(needed, rem);
        const unitCost = Number(batch.purchase_price);
        const allocCost = Math.round(take * unitCost * 100) / 100;

        await tx.query(
          `UPDATE warehouse_batches
           SET remaining_quantity = remaining_quantity - $1
           WHERE tenant_id = $2 AND id = $3`,
          [take, tenantId, batch.id],
        );

        await tx.query(
          `INSERT INTO warehouse_movements
             (tenant_id, item_id, batch_id, repair_order_id, repair_part_id, type, quantity, cost_price, description, created_by)
           VALUES ($1, $2, $3, $4, $5, 'write_off', $6, $7, $8, $9)`,
          [
            tenantId,
            part.warehouse_item_id,
            batch.id,
            orderId,
            part.id,
            take,
            unitCost,
            `Списание в заказ-наряд (${part.name})`,
            userId,
          ],
        );

        await tx.query(
          `INSERT INTO repair_part_batch_allocations
             (tenant_id, repair_order_id, repair_part_id, warehouse_item_id, batch_id, quantity, unit_cost, total_cost)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            tenantId,
            orderId,
            part.id,
            part.warehouse_item_id,
            batch.id,
            take,
            unitCost,
            allocCost,
          ],
        );

        totalCost += allocCost;
        consumedFromBatches += take;
        needed -= take;
      }

      // Если остался дефицит (продажа в минус / пересорт)
      let costSource: "fifo_batch" | "negative_stock" = "fifo_batch";
      if (needed > 0) {
        costSource = "negative_stock";
        const fallbackUnitCost = Number(part.cost_price || 0);
        const deficitCost = Math.round(needed * fallbackUnitCost * 100) / 100;
        totalCost += deficitCost;

        if (allowNegativeStock) {
          await tx.query(
            `INSERT INTO warehouse_movements
               (tenant_id, item_id, repair_order_id, repair_part_id, type, quantity, cost_price, description, created_by)
             VALUES ($1, $2, $3, $4, 'write_off', $5, $6, $7, $8)`,
            [
              tenantId,
              part.warehouse_item_id,
              orderId,
              part.id,
              needed,
              fallbackUnitCost,
              `Списание в заказ-наряд (дефицит/продажа в минус: ${part.name})`,
              userId,
            ],
          );

          await tx.query(
            `INSERT INTO repair_part_batch_allocations
               (tenant_id, repair_order_id, repair_part_id, warehouse_item_id, batch_id, quantity, unit_cost, total_cost)
             VALUES ($1, $2, $3, $4, NULL, $5, $6, $7)`,
            [
              tenantId,
              orderId,
              part.id,
              part.warehouse_item_id,
              needed,
              fallbackUnitCost,
              deficitCost,
            ],
          );
        }
      }

      const effectiveUnitCost =
        consumedFromBatches > 0 || allowNegativeStock
          ? Math.round((totalCost / totalQty) * 100) / 100
          : Number(part.cost_price || 0);

      await tx.query(
        `UPDATE repair_parts
         SET cost_price = $1,
             status = 'used',
             consumed_at = now(),
             cost_source = $2
         WHERE tenant_id = $3 AND id = $4`,
        [effectiveUnitCost, costSource, tenantId, part.id],
      );

      await tx.query(
        `UPDATE warehouse_reservations
         SET status = 'consumed', updated_at = now()
         WHERE tenant_id = $1 AND repair_order_id = $2 AND item_id = $3 AND status = 'reserved'`,
        [tenantId, orderId, part.warehouse_item_id],
      );
    }
  }

  async consumePartsForOrder(tenantId: string, orderId: string, userId: string): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      await this.consumePartsForOrderInTx(tx, tenantId, orderId, userId);
    });
  }

  /**
   * Атомарное, идемпотентное списание товаров сделки CRM по FIFO при переходе в стадию `won`.
   * - Списывает доступные партии (received_at ASC) и сохраняет аллокации в deal_item_batch_allocations.
   * - Записывает движения write_off в warehouse_movements (с deal_id, deal_item_id) — попадает в P&L COGS.
   * - Если товара нет на складе (или не хватает количества) — автоматически формирует заявку на закупку
   *   в purchase_requests на странице /warehouse (без дублей при повторных вызовах).
   */
  async consumeDealItemsInTx(
    tx: TransactionClient,
    tenantId: string,
    dealId: string,
    userId: string | null,
  ): Promise<{ consumedItemsCount: number; purchaseRequestsCreated: number }> {
    const dealRow = await tx.queryOne<{ id: string; title: string }>(
      `SELECT id, title FROM deals WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, dealId],
    );
    if (!dealRow) {
      return { consumedItemsCount: 0, purchaseRequestsCreated: 0 };
    }

    const items = await tx.query<{
      id: string;
      item_id: string | null;
      name: string;
      sku: string | null;
      unit: string | null;
      quantity: string | number;
      cost_price: string | number;
      consumed_at: Date | string | null;
    }>(
      `SELECT id, item_id, name, sku, unit, quantity, cost_price, consumed_at
       FROM deal_items
       WHERE tenant_id = $1 AND deal_id = $2 AND item_type = 'product' AND consumed_at IS NULL
       ORDER BY sort_order ASC, created_at ASC
       FOR UPDATE`,
      [tenantId, dealId],
    );

    if (items.length === 0) {
      return { consumedItemsCount: 0, purchaseRequestsCreated: 0 };
    }

    let consumedItemsCount = 0;
    let purchaseRequestsCreated = 0;

    for (const item of items) {
      const totalQty = Number(item.quantity);
      if (totalQty <= 0) continue;

      // Проверяем сколько уже списано по этой позиции (защита от двойного списания при частичном дефиците)
      const prevAlloc = await tx.queryOne<{ qty: string; cost: string }>(
        `SELECT
           COALESCE(SUM(quantity), 0)::numeric(10,2)::text AS qty,
           COALESCE(SUM(total_cost), 0)::numeric(12,2)::text AS cost
         FROM deal_item_batch_allocations
         WHERE tenant_id = $1 AND deal_item_id = $2 AND batch_id IS NOT NULL`,
        [tenantId, item.id],
      );
      const alreadyConsumedQty = Number(prevAlloc?.qty ?? 0);
      const alreadyConsumedCost = Number(prevAlloc?.cost ?? 0);

      let needed = Math.round((totalQty - alreadyConsumedQty) * 100) / 100;
      if (needed <= 0) {
        const avgCost =
          alreadyConsumedQty > 0
            ? Math.round((alreadyConsumedCost / alreadyConsumedQty) * 100) / 100
            : Number(item.cost_price || 0);
        await tx.query(
          `UPDATE deal_items
           SET cost_price = $1, cost_source = 'fifo_batch', consumed_at = now(), updated_at = now()
           WHERE tenant_id = $2 AND id = $3`,
          [avgCost, tenantId, item.id],
        );
        consumedItemsCount++;
        continue;
      }

      let newlyConsumedQty = 0;
      let newlyConsumedCost = 0;
      let warehouseItemCostPrice = Number(item.cost_price || 0);

      if (item.item_id) {
        const whItem = await tx.queryOne<{ cost_price: string }>(
          `SELECT cost_price::text FROM warehouse_items WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, item.item_id],
        );
        if (whItem && warehouseItemCostPrice <= 0) {
          warehouseItemCostPrice = Number(whItem.cost_price || 0);
        }

        const batches = await tx.query<{ id: string; remaining_quantity: string; purchase_price: string }>(
          `SELECT id, remaining_quantity, purchase_price
           FROM warehouse_batches
           WHERE tenant_id = $1 AND item_id = $2 AND remaining_quantity > 0
           ORDER BY received_at ASC, created_at ASC
           FOR UPDATE`,
          [tenantId, item.item_id],
        );

        for (const batch of batches) {
          if (needed <= 0) break;
          const rem = Number(batch.remaining_quantity);
          const take = Math.min(needed, rem);
          const unitCost = Number(batch.purchase_price);
          const allocCost = Math.round(take * unitCost * 100) / 100;

          await tx.query(
            `UPDATE warehouse_batches
             SET remaining_quantity = remaining_quantity - $1
             WHERE tenant_id = $2 AND id = $3`,
            [take, tenantId, batch.id],
          );

          await tx.query(
            `INSERT INTO warehouse_movements
               (tenant_id, item_id, batch_id, deal_id, deal_item_id, type, quantity, cost_price, description, created_by)
             VALUES ($1, $2, $3, $4, $5, 'write_off', $6, $7, $8, $9)`,
            [
              tenantId,
              item.item_id,
              batch.id,
              dealId,
              item.id,
              take,
              unitCost,
              `Продажа по сделке «${dealRow.title}» (${item.name})`,
              userId,
            ],
          );

          await tx.query(
            `INSERT INTO deal_item_batch_allocations
               (tenant_id, deal_id, deal_item_id, warehouse_item_id, batch_id, quantity, unit_cost, total_cost)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              tenantId,
              dealId,
              item.id,
              item.item_id,
              batch.id,
              take,
              unitCost,
              allocCost,
            ],
          );

          newlyConsumedCost += allocCost;
          newlyConsumedQty += take;
          needed = Math.round((needed - take) * 100) / 100;
        }
      }

      const totalConsumedQty = Math.round((alreadyConsumedQty + newlyConsumedQty) * 100) / 100;
      const totalConsumedCost = Math.round((alreadyConsumedCost + newlyConsumedCost) * 100) / 100;

      if (needed > 0) {
        // Нехватка на складе (или товар вне каталога): создаём заявку на закупку на /warehouse, если активной ещё нет
        const existingReq = await tx.queryOne<{ id: string }>(
          `SELECT id
           FROM purchase_requests
           WHERE tenant_id = $1 AND deal_item_id = $2 AND status IN ('pending', 'ordered')
           LIMIT 1`,
          [tenantId, item.id],
        );

        if (!existingReq) {
          const reason = item.item_id
            ? `Автозаявка: дефицит на складе при закрытии сделки «${dealRow.title}»`
            : `Автозаявка: товар вне каталога склада при закрытии сделки «${dealRow.title}»`;
          await tx.query(
            `INSERT INTO purchase_requests
               (tenant_id, deal_id, deal_item_id, item_id, item_name, sku, quantity, unit, estimated_price, status, comment, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11)`,
            [
              tenantId,
              dealId,
              item.id,
              item.item_id,
              item.name,
              item.sku ?? "",
              needed,
              item.unit ?? "шт",
              warehouseItemCostPrice,
              reason,
              userId,
            ],
          );
          purchaseRequestsCreated++;
        }

        const estTotalCost = totalConsumedCost + needed * warehouseItemCostPrice;
        const effectiveUnitCost =
          totalQty > 0 ? Math.round((estTotalCost / totalQty) * 100) / 100 : warehouseItemCostPrice;

        await tx.query(
          `UPDATE deal_items
           SET cost_price = $1, cost_source = 'pending_purchase', updated_at = now()
           WHERE tenant_id = $2 AND id = $3`,
          [effectiveUnitCost, tenantId, item.id],
        );
      } else {
        const effectiveUnitCost =
          totalConsumedQty > 0
            ? Math.round((totalConsumedCost / totalConsumedQty) * 100) / 100
            : warehouseItemCostPrice;

        await tx.query(
          `UPDATE deal_items
           SET cost_price = $1, cost_source = 'fifo_batch', consumed_at = now(), updated_at = now()
           WHERE tenant_id = $2 AND id = $3`,
          [effectiveUnitCost, tenantId, item.id],
        );
        consumedItemsCount++;
      }
    }

    return { consumedItemsCount, purchaseRequestsCreated };
  }

  /**
   * Если заявка на закупку под сделку оприходована, а сделка уже в стадии won —
   * привязываем item_id к позиции сделки (если его не было) и дописываем дефицит FIFO.
   */
  private async fulfillWonDealIfReadyInTx(
    tx: TransactionClient,
    tenantId: string,
    dealId: string,
    dealItemId: string | null,
    warehouseItemId: string | null,
    userId: string | null,
  ): Promise<void> {
    if (dealItemId && warehouseItemId) {
      await tx.query(
        `UPDATE deal_items
         SET item_id = COALESCE(item_id, $3), updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, dealItemId, warehouseItemId],
      );
    }

    const wonDeal = await tx.queryOne<{ id: string }>(
      `SELECT d.id
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL AND s.is_won = true`,
      [tenantId, dealId],
    );

    if (wonDeal) {
      await this.consumeDealItemsInTx(tx, tenantId, dealId, userId);
    }
  }

  async releaseReservationsForOrder(tenantId: string, orderId: string): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE warehouse_reservations
         SET status = 'released', updated_at = now()
         WHERE tenant_id = $1 AND repair_order_id = $2 AND status = 'reserved'`,
        [tenantId, orderId],
      );
    });
  }

  // ---------------------------------------------------------------------------
  // Export, Import, Bulk Operations
  // ---------------------------------------------------------------------------

  async exportItems(
    tenantId: string,
    payload: ExportWarehouseItemsPayload,
  ): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
    const result = await this.listItems(tenantId, payload.search, { all: true });
    let items = result.data;
    if (payload.ids && payload.ids.length > 0) {
      const idSet = new Set(payload.ids);
      items = items.filter((i) => idSet.has(i.id));
    }

    const columns: ExportColumnDef<WarehouseItemDTO>[] = [
      { header: "Артикул", key: "sku", width: 16 },
      { header: "Наименование", key: "name", width: 35 },
      { header: "Бренд", key: "brand", width: 18 },
      { header: "Категория", key: "category", width: 20 },
      { header: "Ед. изм.", key: "unit", width: 10 },
      { header: "Остаток", key: (i) => i.totalStock, width: 12 },
      { header: "Доступно", key: (i) => i.availableStock, width: 12 },
      { header: "Мин. остаток", key: (i) => i.minStock, width: 14 },
      { header: "Себестоимость", key: (i) => i.costPrice, width: 15 },
      { header: "Цена розница", key: (i) => i.retailPrice, width: 15 },
    ];

    const dateStr = new Date().toISOString().slice(0, 10);
    if (payload.format === "csv") {
      const buffer = buildCsvBuffer(columns, items, ";");
      return {
        buffer,
        filename: `catalog_${dateStr}.csv`,
        contentType: "text/csv; charset=utf-8",
      };
    }

    const buffer = await buildXlsxBuffer(columns, items, "Номенклатура");
    return {
      buffer,
      filename: `catalog_${dateStr}.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  async parseImportFile(
    buffer: Buffer,
    filename: string,
    delimiter?: string,
  ): Promise<ImportParseResultDTO> {
    const isCsv =
      filename.toLowerCase().endsWith(".csv") ||
      filename.toLowerCase().endsWith(".txt");

    let rows: string[][] = [];
    let detectedDelimiter: string | undefined = delimiter;

    if (isCsv) {
      const parsed = parseCsvText(buffer.toString("utf8"), delimiter);
      rows = parsed.rows;
      detectedDelimiter = parsed.detectedDelimiter;
    } else {
      rows = await parseXlsxBuffer(buffer);
    }

    if (rows.length === 0) {
      return {
        headers: [],
        sampleRows: [],
        rows: [],
        totalRows: 0,
        detectedDelimiter,
        suggestedMapping: {},
      };
    }

    const headers = rows[0] || [];
    const sampleRows = rows.slice(1, 6);
    const suggestedMapping: Record<string, string> = {};

    headers.forEach((h, idx) => {
      const matched = suggestFieldMapping(h);
      if (matched) {
        suggestedMapping[String(idx)] = matched;
      }
    });

    return {
      headers,
      sampleRows,
      rows,
      totalRows: rows.length,
      detectedDelimiter,
      suggestedMapping,
    };
  }

  async validateImport(
    tenantId: string,
    payload: ImportValidatePayload,
  ): Promise<ImportValidateResultDTO> {
    const allRows = payload.rows;
    if (allRows.length === 0) {
      return {
        totalRows: 0,
        validCount: 0,
        duplicateCount: 0,
        errorCount: 0,
        duplicates: [],
        sampleValid: [],
        errors: [],
      };
    }

    const headers = payload.skipFirstRow ? allRows[0] : undefined;
    const dataRows = payload.skipFirstRow ? allRows.slice(1) : allRows;

    const existingRows = await withTenant(tenantId, async (tx) => {
      return tx.query<WarehouseItemRow>(
        `SELECT i.id, i.sku, i.name, COALESCE(i.brand, '') AS brand, i.category, i.unit,
                i.min_stock, i.retail_price, i.cost_price,
                COALESCE(SUM(b.remaining_quantity), 0) AS total_stock
         FROM warehouse_items i
         LEFT JOIN warehouse_batches b ON b.tenant_id = i.tenant_id AND b.item_id = i.id
         WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
         GROUP BY i.id`,
        [tenantId],
      );
    });

    const existingBySku = new Map<string, WarehouseItemRow>();
    const existingByName = new Map<string, WarehouseItemRow>();

    for (const item of existingRows) {
      if (item.sku && item.sku.trim()) {
        existingBySku.set(item.sku.trim().toLowerCase(), item);
      }
      if (item.name && item.name.trim()) {
        existingByName.set(item.name.trim().toLowerCase(), item);
      }
    }

    const duplicates: ImportDuplicateConflictDTO[] = [];
    const sampleValid: ImportParsedItem[] = [];
    const errors: { rowNumber: number; message: string }[] = [];
    let validCount = 0;

    dataRows.forEach((row, idx) => {
      const rowNumber = (payload.skipFirstRow ? 2 : 1) + idx;
      const parsed = extractRowFields(row, payload.mapping, headers);

      if (!parsed.name) {
        errors.push({
          rowNumber,
          message: "Не заполнено обязательное поле «Наименование»",
        });
        return;
      }

      const incomingItem: ImportParsedItem = {
        rowNumber,
        ...parsed,
      };

      let existingMatch: WarehouseItemRow | undefined;
      let reason: "sku_match" | "name_match" | undefined;
      let matchKey = "";

      if (parsed.sku && existingBySku.has(parsed.sku.toLowerCase())) {
        existingMatch = existingBySku.get(parsed.sku.toLowerCase());
        reason = "sku_match";
        matchKey = `sku:${parsed.sku.toLowerCase()}`;
      } else if (existingByName.has(parsed.name.toLowerCase())) {
        existingMatch = existingByName.get(parsed.name.toLowerCase());
        reason = "name_match";
        matchKey = `name:${parsed.name.toLowerCase()}`;
      }

      if (existingMatch && reason) {
        duplicates.push({
          rowNumber,
          reason,
          matchKey,
          existing: {
            id: existingMatch.id,
            sku: existingMatch.sku,
            name: existingMatch.name,
            brand: existingMatch.brand ?? "",
            category: existingMatch.category,
            unit: existingMatch.unit,
            costPrice: Number(existingMatch.cost_price ?? 0),
            retailPrice: Number(existingMatch.retail_price ?? 0),
            minStock: Number(existingMatch.min_stock ?? 0),
            totalStock: Number(existingMatch.total_stock ?? 0),
          },
          incoming: incomingItem,
        });
      } else {
        validCount++;
        if (sampleValid.length < 10) {
          sampleValid.push(incomingItem);
        }
      }
    });

    return {
      totalRows: dataRows.length,
      validCount,
      duplicateCount: duplicates.length,
      errorCount: errors.length,
      duplicates,
      sampleValid,
      errors,
    };
  }

  async commitImport(
    tenantId: string,
    payload: ImportCommitPayload,
  ): Promise<ImportCommitResultDTO> {
    const allRows = payload.rows;
    if (allRows.length === 0) {
      return { importedCount: 0, updatedCount: 0, skippedCount: 0, errorCount: 0 };
    }

    const headers = payload.skipFirstRow ? allRows[0] : undefined;
    const dataRows = payload.skipFirstRow ? allRows.slice(1) : allRows;

    return withTenant(tenantId, async (tx) => {
      const existingRows = await tx.query<WarehouseItemRow>(
        `SELECT id, sku, name, brand, category, unit, min_stock, retail_price, cost_price
         FROM warehouse_items
         WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId],
      );

      const existingBySku = new Map<string, WarehouseItemRow>();
      const existingByName = new Map<string, WarehouseItemRow>();

      for (const item of existingRows) {
        if (item.sku && item.sku.trim()) {
          existingBySku.set(item.sku.trim().toLowerCase(), item);
        }
        if (item.name && item.name.trim()) {
          existingByName.set(item.name.trim().toLowerCase(), item);
        }
      }

      let importedCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const errors: { rowNumber: number; reason: string }[] = [];

      for (let idx = 0; idx < dataRows.length; idx++) {
        const row = dataRows[idx];
        if (!row) continue;
        const rowNumber = (payload.skipFirstRow ? 2 : 1) + idx;
        const parsed = extractRowFields(row, payload.mapping, headers);

        if (!parsed.name) {
          errorCount++;
          errors.push({
            rowNumber,
            reason: "Не заполнено обязательное поле «Наименование»",
          });
          continue;
        }

        let existingMatch: WarehouseItemRow | undefined;
        let matchKey = "";

        if (parsed.sku && existingBySku.has(parsed.sku.toLowerCase())) {
          existingMatch = existingBySku.get(parsed.sku.toLowerCase());
          matchKey = `sku:${parsed.sku.toLowerCase()}`;
        } else if (existingByName.has(parsed.name.toLowerCase())) {
          existingMatch = existingByName.get(parsed.name.toLowerCase());
          matchKey = `name:${parsed.name.toLowerCase()}`;
        }

        if (existingMatch) {
          const res =
            payload.resolutions?.[matchKey] ||
            payload.resolutions?.[String(rowNumber)] ||
            payload.defaultResolution ||
            "skip";

          if (res === "skip") {
            skippedCount++;
            continue;
          }

          if (res === "overwrite") {
            const spName = `sp_up_${idx}`;
            await tx.query(`SAVEPOINT ${spName}`);
            try {
              await tx.query(
                `UPDATE warehouse_items
                 SET name = $1, brand = $2, category = $3, unit = $4,
                     cost_price = $5, retail_price = $6, min_stock = $7,
                     updated_at = now()
                 WHERE tenant_id = $8 AND id = $9`,
                [
                  parsed.name,
                  parsed.brand,
                  parsed.category,
                  parsed.unit,
                  parsed.costPrice,
                  parsed.retailPrice,
                  parsed.minStock,
                  tenantId,
                  existingMatch.id,
                ],
              );
              await tx.query(`RELEASE SAVEPOINT ${spName}`);
              updatedCount++;
            } catch (err) {
              await tx.query(`ROLLBACK TO SAVEPOINT ${spName}`);
              errorCount++;
              errors.push({
                rowNumber,
                reason: err instanceof Error ? err.message : "Ошибка обновления позиции",
              });
            }
            continue;
          }

          // keep_both: fall through to insert
        }

        const spName = `sp_in_${idx}`;
        await tx.query(`SAVEPOINT ${spName}`);
        try {
          const inserted = await tx.queryOneOrThrow<WarehouseItemRow>(
            `INSERT INTO warehouse_items
               (tenant_id, sku, name, brand, category, unit, cost_price, retail_price, min_stock)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, sku, name, brand, category, unit, cost_price, retail_price, min_stock`,
            [
              tenantId,
              parsed.sku,
              parsed.name,
              parsed.brand,
              parsed.category,
              parsed.unit,
              parsed.costPrice,
              parsed.retailPrice,
              parsed.minStock,
            ],
          );

          if (parsed.sku) {
            existingBySku.set(parsed.sku.toLowerCase(), inserted);
          }
          existingByName.set(parsed.name.toLowerCase(), inserted);
          await tx.query(`RELEASE SAVEPOINT ${spName}`);
          importedCount++;
        } catch (err) {
          await tx.query(`ROLLBACK TO SAVEPOINT ${spName}`);
          errorCount++;
          errors.push({
            rowNumber,
            reason: err instanceof Error ? err.message : "Ошибка создания позиции",
          });
        }
      }

      return {
        importedCount,
        updatedCount,
        skippedCount,
        errorCount,
        total: dataRows.length,
        errors: errors.slice(0, 100),
      };
    });
  }

  async bulkUpdateItems(
    tenantId: string,
    payload: BulkUpdateWarehouseItemsPayload,
  ): Promise<{ updatedCount: number }> {
    if (!payload.ids || payload.ids.length === 0) {
      return { updatedCount: 0 };
    }

    return withTenant(tenantId, async (tx) => {
      const updates: string[] = [];
      const params: SqlParam[] = [tenantId, payload.ids];

      const addParam = (val: SqlParam) => {
        params.push(val);
        return `$${params.length}`;
      };

      if (payload.category !== undefined) {
        updates.push(`category = ${addParam(payload.category)}`);
      }
      if (payload.brand !== undefined) {
        updates.push(`brand = ${addParam(payload.brand)}`);
      }
      if (payload.unit !== undefined) {
        updates.push(`unit = ${addParam(payload.unit)}`);
      }
      if (payload.min_stock !== undefined) {
        updates.push(`min_stock = ${addParam(payload.min_stock)}`);
      }

      if (payload.retail_price_action) {
        const { mode, value } = payload.retail_price_action;
        if (mode === "set") {
          updates.push(`retail_price = ${addParam(Math.max(0, value))}`);
        } else if (mode === "percent") {
          const factor = addParam(1 + value / 100);
          updates.push(`retail_price = ROUND(GREATEST(0, retail_price * ${factor})::numeric, 2)`);
        } else if (mode === "delta") {
          const delta = addParam(value);
          updates.push(`retail_price = GREATEST(0, retail_price + ${delta})`);
        }
      }

      if (payload.cost_price_action) {
        const { mode, value } = payload.cost_price_action;
        if (mode === "set") {
          updates.push(`cost_price = ${addParam(Math.max(0, value))}`);
        } else if (mode === "percent") {
          const factor = addParam(1 + value / 100);
          updates.push(`cost_price = ROUND(GREATEST(0, cost_price * ${factor})::numeric, 2)`);
        } else if (mode === "delta") {
          const delta = addParam(value);
          updates.push(`cost_price = GREATEST(0, cost_price + ${delta})`);
        }
      }

      const hasModelsUpdate =
        payload.models !== undefined ||
        payload.model_ids !== undefined ||
        payload.modelIds !== undefined;

      if (hasModelsUpdate) {
        const targetModelIds = new Set<string>();
        const rawModelIds = payload.model_ids ?? payload.modelIds ?? [];
        for (const mid of rawModelIds) {
          if (mid) targetModelIds.add(mid);
        }

        if (payload.models && payload.models.length > 0) {
          for (const name of payload.models) {
            const trimmed = name.trim();
            if (!trimmed) continue;

            let modelRow = await tx.queryOne<{ id: string }>(
              `SELECT id FROM equipment_models WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
              [tenantId, trimmed],
            );

            if (!modelRow) {
              const bName = payload.brand?.trim() || "Общий";
              let brandRow = await tx.queryOne<{ id: string }>(
                `SELECT id FROM equipment_brands WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
                [tenantId, bName],
              );
              if (!brandRow) {
                brandRow = await tx.queryOneOrThrow<{ id: string }>(
                  `INSERT INTO equipment_brands (tenant_id, name) VALUES ($1, $2)
                   ON CONFLICT (tenant_id, name) DO UPDATE SET name = EXCLUDED.name
                   RETURNING id`,
                  [tenantId, bName],
                );
              }

              modelRow = await tx.queryOneOrThrow<{ id: string }>(
                `INSERT INTO equipment_models (tenant_id, brand_id, brand_name, name)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (tenant_id, brand_id, lower(name)) DO UPDATE SET name = EXCLUDED.name
                 RETURNING id`,
                [tenantId, brandRow.id, bName, trimmed],
              );
            }

            targetModelIds.add(modelRow.id);
          }
        }

        const modelsMode = payload.models_mode ?? payload.modelsMode ?? "replace";

        if (modelsMode === "replace") {
          await tx.query(
            `DELETE FROM warehouse_item_models WHERE tenant_id = $1 AND item_id = ANY($2::uuid[])`,
            [tenantId, payload.ids],
          );
          if (targetModelIds.size > 0) {
            await tx.query(
              `INSERT INTO warehouse_item_models (tenant_id, item_id, model_id)
               SELECT $1, i.item_id, m.model_id
               FROM unnest($2::uuid[]) AS i(item_id)
               CROSS JOIN unnest($3::uuid[]) AS m(model_id)
               ON CONFLICT DO NOTHING`,
              [tenantId, payload.ids, Array.from(targetModelIds)],
            );
          }
        } else if (modelsMode === "add") {
          if (targetModelIds.size > 0) {
            await tx.query(
              `INSERT INTO warehouse_item_models (tenant_id, item_id, model_id)
               SELECT $1, i.item_id, m.model_id
               FROM unnest($2::uuid[]) AS i(item_id)
               CROSS JOIN unnest($3::uuid[]) AS m(model_id)
               ON CONFLICT DO NOTHING`,
              [tenantId, payload.ids, Array.from(targetModelIds)],
            );
          }
        } else if (modelsMode === "remove") {
          if (targetModelIds.size > 0) {
            await tx.query(
              `DELETE FROM warehouse_item_models
               WHERE tenant_id = $1 AND item_id = ANY($2::uuid[]) AND model_id = ANY($3::uuid[])`,
              [tenantId, payload.ids, Array.from(targetModelIds)],
            );
          }
        }
      }

      if (updates.length === 0 && !hasModelsUpdate) {
        return { updatedCount: 0 };
      }

      if (updates.length > 0) {
        updates.push("updated_at = now()");

        const res = await tx.query(
          `UPDATE warehouse_items
           SET ${updates.join(", ")}
           WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
          params,
        );

        return { updatedCount: res.length };
      } else {
        const res = await tx.query(
          `UPDATE warehouse_items
           SET updated_at = now()
           WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
          [tenantId, payload.ids],
        );
        return { updatedCount: res.length };
      }
    });
  }

  async bulkDeleteItems(
    tenantId: string,
    payload: BulkDeleteWarehouseItemsPayload,
  ): Promise<{ deletedCount: number; errors?: string[] }> {
    if (!payload.ids || payload.ids.length === 0) {
      return { deletedCount: 0 };
    }

    return withTenant(tenantId, async (tx) => {
      if (payload.force) {
        const batches = await tx.query<{ id: string }>(
          `SELECT id FROM warehouse_batches WHERE tenant_id = $1 AND item_id = ANY($2::uuid[])`,
          [tenantId, payload.ids],
        );
        if (batches.length > 0) {
          await this.deleteBatchesInTx(
            tx,
            tenantId,
            batches.map((b) => b.id),
          );
        }
        await tx.query(
          `DELETE FROM warehouse_reservations WHERE tenant_id = $1 AND item_id = ANY($2::uuid[])`,
          [tenantId, payload.ids],
        );
        await tx.query(
          `DELETE FROM warehouse_movements WHERE tenant_id = $1 AND item_id = ANY($2::uuid[])`,
          [tenantId, payload.ids],
        );

        const res = await tx.query<{ id: string }>(
          `UPDATE warehouse_items
           SET deleted_at = now()
           WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
           RETURNING id`,
          [tenantId, payload.ids],
        );
        return { deletedCount: res.length };
      }

      const itemsWithStock = await tx.query<{ id: string; name: string; total_stock: string }>(
        `SELECT i.id, i.name, COALESCE(SUM(b.remaining_quantity), 0) AS total_stock
         FROM warehouse_items i
         LEFT JOIN warehouse_batches b ON b.tenant_id = i.tenant_id AND b.item_id = i.id
         WHERE i.tenant_id = $1 AND i.id = ANY($2) AND i.deleted_at IS NULL
         GROUP BY i.id
         HAVING COALESCE(SUM(b.remaining_quantity), 0) > 0`,
        [tenantId, payload.ids],
      );

      const blockedIds = new Set(itemsWithStock.map((i) => i.id));
      const deletableIds = payload.ids.filter((id) => !blockedIds.has(id));

      let deletedCount = 0;
      if (deletableIds.length > 0) {
        const res = await tx.query<{ id: string }>(
          `UPDATE warehouse_items
           SET deleted_at = now()
           WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL
           RETURNING id`,
          [tenantId, deletableIds],
        );
        deletedCount = res.length;
      }

      const errors = itemsWithStock.map(
        (i) => `Позиция «${i.name}» не может быть удалена, так как на складе числится остаток (${Number(i.total_stock)})`,
      );

      return { deletedCount, errors: errors.length > 0 ? errors : undefined };
    });
  }

  /**
   * Returns all categories for the tenant: combines categories from warehouse_categories
   * table and distinct categories from existing warehouse_items.
   */
  async listCategories(tenantId: string): Promise<string[]> {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query<{ name: string }>(
        `SELECT DISTINCT btrim(name) AS name
         FROM (
           SELECT name FROM warehouse_categories WHERE tenant_id = $1
           UNION
           SELECT name FROM equipment_types WHERE tenant_id = $1
           UNION
           SELECT category AS name FROM warehouse_items WHERE tenant_id = $1 AND category <> '' AND deleted_at IS NULL
         ) sub
         WHERE btrim(name) <> ''
         ORDER BY name ASC`,
        [tenantId],
      );

      const list = rows.map((r) => r.name);
      if (list.length === 0) {
        return [
          "Запчасти",
          "Расходники",
          "Дисплеи",
          "Аккумуляторы",
          "Корпуса",
          "Шлейфы",
          "Инструменты",
          "Оборудование",
          "Аксессуары",
          "Химия и пайка",
        ];
      }
      return list;
    });
  }

  /**
   * Creates or ensures a warehouse category for the tenant.
   */
  async createCategory(tenantId: string, name: string): Promise<{ id: string; name: string }> {
    const trimmed = name.trim();
    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOneOrThrow<{ id: string; name: string }>(
        `INSERT INTO warehouse_categories (tenant_id, name)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id, name) DO UPDATE SET updated_at = now()
         RETURNING id, name`,
        [tenantId, trimmed],
      );
      return { id: row.id, name: row.name };
    });
  }

  /**
   * Returns all brands for the tenant: combines equipment_brands
   * and distinct brands from warehouse_items.
   */
  async listBrands(tenantId: string): Promise<string[]> {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query<{ name: string }>(
        `SELECT DISTINCT btrim(name) AS name
         FROM (
           SELECT name FROM equipment_brands WHERE tenant_id = $1
           UNION
           SELECT brand AS name FROM warehouse_items WHERE tenant_id = $1 AND brand <> '' AND deleted_at IS NULL
         ) sub
         WHERE btrim(name) <> ''
         ORDER BY name ASC`,
        [tenantId],
      );

      const list = rows.map((r) => r.name);
      if (list.length === 0) {
        return ["Apple", "Samsung", "Xiaomi", "Huawei", "Honor", "Realme", "Toua", "Makita", "Bosch", "DeWalt"];
      }
      return list;
    });
  }

  /**
   * Creates or ensures a brand in equipment_brands for the tenant.
   */
  async createBrand(tenantId: string, name: string): Promise<{ id: string; name: string }> {
    const trimmed = name.trim();
    return withTenant(tenantId, async (tx) => {
      const existing = await tx.queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM equipment_brands WHERE tenant_id = $1 AND lower(name) = lower($2) LIMIT 1`,
        [tenantId, trimmed],
      );
      if (existing) {
        return existing;
      }
      const row = await tx.queryOneOrThrow<{ id: string; name: string }>(
        `INSERT INTO equipment_brands (tenant_id, name)
         VALUES ($1, $2)
         RETURNING id, name`,
        [tenantId, trimmed],
      );
      return { id: row.id, name: row.name };
    });
  }
}

export const warehouseService = new WarehouseService();
