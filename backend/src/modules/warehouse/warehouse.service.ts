import { query, queryOneOrThrow, withTenant, type SqlParam } from "../../db/client.js";
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
  type PaySupplierOrderPayload,
  type PurchaseRequestDTO,
  type PurchaseRequestRow,
  type PurchaseRequestStatus,
  type SupplierOrderDTO,
  type SupplierOrderItemDTO,
  type SupplierOrderItemRow,
  type SupplierOrderRow,
  type SupplierOrderStatus,
  type UpdatePurchaseRequestPayload,
  type UpdateWarehouseItemPayload,
  type UpdateWarehouseSettingsPayload,
  type WarehouseBatchDTO,
  type WarehouseBatchRow,
  type WarehouseItemDTO,
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

function toIso(val: Date | string | null | undefined): string {
  if (!val) return new Date().toISOString();
  return typeof val === "string" ? new Date(val).toISOString() : val.toISOString();
}

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

  return {
    sku: (item.sku ?? "").trim(),
    name: (item.name ?? "").trim(),
    brand: (item.brand ?? "").trim(),
    category: (item.category ?? "").trim(),
    unit: (item.unit ?? "").trim() || "шт",
    costPrice: Math.max(0, parseCleanNumber(item.cost_price)),
    retailPrice: Math.max(0, parseCleanNumber(item.retail_price)),
    minStock: Math.max(0, parseCleanNumber(item.min_stock)),
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

  async listItems(tenantId: string, search?: string): Promise<WarehouseItemDTO[]> {
    const params: (string | number)[] = [tenantId];
    let searchFilter = "";

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      searchFilter = `AND (lower(i.name) LIKE $${params.length} OR lower(i.sku) LIKE $${params.length} OR lower(COALESCE(i.brand, '')) LIKE $${params.length})`;
    }

    const settings = await this.getSettings(tenantId);

    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query<WarehouseItemRow>(
        `SELECT i.id, i.tenant_id, i.sku, i.name, COALESCE(i.brand, '') AS brand, i.category, i.unit,
                i.min_stock, i.retail_price, i.cost_price, i.created_at, i.updated_at,
                COALESCE(SUM(b.remaining_quantity), 0) AS total_stock,
                COALESCE((
                  SELECT SUM(r.quantity)
                  FROM warehouse_reservations r
                  WHERE r.tenant_id = i.tenant_id AND r.item_id = i.id AND r.status = 'reserved'
                ), 0) AS reserved_stock
         FROM warehouse_items i
         LEFT JOIN warehouse_batches b ON b.tenant_id = i.tenant_id AND b.item_id = i.id
         WHERE i.tenant_id = $1 AND i.deleted_at IS NULL
         ${searchFilter}
         GROUP BY i.id
         ORDER BY i.name ASC`,
        params,
      );

      return rows.map((r) => {
        const total = Number(r.total_stock ?? 0);
        const reserved = Number(r.reserved_stock ?? 0);
        const available = settings.allowNegativeStock
          ? total - reserved
          : Math.max(total - reserved, 0);

        return {
          id: r.id,
          sku: r.sku,
          name: r.name,
          brand: r.brand ?? "",
          category: r.category,
          unit: r.unit,
          minStock: Number(r.min_stock ?? 0),
          retailPrice: Number(r.retail_price ?? 0),
          costPrice: Number(r.cost_price ?? 0),
          totalStock: total,
          reservedStock: reserved,
          availableStock: available,
          createdAt: toIso(r.created_at),
          updatedAt: toIso(r.updated_at),
        };
      });
    });
  }

  async createItem(tenantId: string, payload: CreateWarehouseItemPayload): Promise<WarehouseItemDTO> {
    const row = await withTenant(tenantId, async (tx) => {
      return tx.queryOneOrThrow<WarehouseItemRow>(
        `INSERT INTO warehouse_items
           (tenant_id, sku, name, brand, category, unit, min_stock, retail_price, cost_price)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, tenant_id, sku, name, brand, category, unit, min_stock, retail_price, cost_price, created_at, updated_at`,
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
        ],
      );
    });

    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      brand: row.brand ?? "",
      category: row.category,
      unit: row.unit,
      minStock: Number(row.min_stock),
      retailPrice: Number(row.retail_price),
      costPrice: Number(row.cost_price),
      totalStock: 0,
      reservedStock: 0,
      availableStock: 0,
      createdAt: toIso(row.created_at),
      updatedAt: toIso(row.updated_at),
    };
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

    if (fields.length === 0) {
      const items = await this.listItems(tenantId);
      return items.find((i) => i.id === itemId) ?? null;
    }

    add("updated_at", new Date());

    return withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE warehouse_items SET ${fields.join(", ")}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        params,
      );

      const items = await this.listItems(tenantId);
      return items.find((i) => i.id === itemId) ?? null;
    });
  }

  async deleteItem(tenantId: string, itemId: string): Promise<boolean> {
    return withTenant(tenantId, async (tx) => {
      const res = await tx.query(
        `UPDATE warehouse_items SET deleted_at = now()
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
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
          let cat = await tx.queryOne<{ id: string }>(
            `SELECT id FROM finance_categories
             WHERE tenant_id = $1 AND type = 'expense' AND lower(name) LIKE '%запчаст%'
             LIMIT 1`,
            [tenantId],
          );

          if (!cat) {
            cat = await tx.queryOne<{ id: string }>(
              `INSERT INTO finance_categories (tenant_id, name, type)
               VALUES ($1, 'Закупка запчастей и комплектующих', 'expense')
               RETURNING id`,
              [tenantId],
            );
          }

          if (cat) {
            await tx.query(
              `INSERT INTO transactions
                 (tenant_id, cash_account_id, category_id, amount, direction, description, counterparty_name)
               VALUES ($1, $2, $3, $4, 'expense', $5, $6)`,
              [
                tenantId,
                payload.cash_account_id,
                cat.id,
                totalAmount,
                `Оприходование запчастей: ${payload.name} (${payload.quantity} ${payload.unit || "шт"})`,
                payload.supplier_name || "",
              ],
            );

            await tx.query(
              `UPDATE cash_accounts SET balance = balance - $1 WHERE tenant_id = $2 AND id = $3`,
              [totalAmount, tenantId, payload.cash_account_id],
            );
          }
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

  async listBatches(tenantId: string, itemId?: string): Promise<WarehouseBatchDTO[]> {
    const params: string[] = [tenantId];
    let filter = "";

    if (itemId) {
      params.push(itemId);
      filter = `AND b.item_id = $2`;
    }

    const rows = await query<WarehouseBatchRow>(
      `SELECT b.id, b.tenant_id, b.item_id, b.batch_number, b.supplier_name,
              b.purchase_price, b.initial_quantity, b.remaining_quantity,
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
      itemName: r.item_name,
      batchNumber: r.batch_number,
      supplierName: r.supplier_name,
      purchasePrice: Number(r.purchase_price),
      initialQuantity: Number(r.initial_quantity),
      remainingQuantity: Number(r.remaining_quantity),
      receivedAt: toIso(r.received_at),
      createdAt: toIso(r.created_at),
    }));
  }

  async listMovements(tenantId: string, limit: number = 100): Promise<WarehouseMovementDTO[]> {
    const rows = await query<WarehouseMovementRow>(
      `SELECT m.id, m.tenant_id, m.item_id, m.batch_id, m.repair_order_id,
              m.type, m.quantity, m.cost_price, m.description, m.created_by, m.created_at,
              i.name AS item_name,
              ro.ticket_number AS repair_ticket_number,
              u.name AS created_by_name
       FROM warehouse_movements m
       JOIN warehouse_items i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
       LEFT JOIN repair_orders ro ON ro.id = m.repair_order_id AND ro.tenant_id = m.tenant_id
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

    const whereExtra = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

    const rows = await query<PurchaseRequestRow>(
      `SELECT pr.id, pr.tenant_id, pr.repair_order_id, pr.supplier_order_id, pr.item_id, pr.item_name, pr.sku,
              pr.quantity, pr.unit, pr.estimated_price, pr.status, pr.comment,
              pr.created_by, pr.created_at, pr.updated_at,
              ro.ticket_number AS repair_ticket_number,
              u.name AS created_by_name
       FROM purchase_requests pr
       LEFT JOIN repair_orders ro ON ro.id = pr.repair_order_id AND ro.tenant_id = pr.tenant_id
       LEFT JOIN users u ON u.id = pr.created_by AND u.tenant_id = pr.tenant_id
       WHERE pr.tenant_id = $1 ${whereExtra}
       ORDER BY pr.created_at DESC`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      repairOrderId: r.repair_order_id,
      supplierOrderId: r.supplier_order_id,
      repairTicketNumber: r.repair_ticket_number,
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
   * Суммирует количество и собирает наряды через запятую (#1042, #1055, ...)
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
         COALESCE(STRING_AGG(DISTINCT ro.ticket_number, ', ' ORDER BY ro.ticket_number), '—') AS repair_orders,
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
         (tenant_id, repair_order_id, item_id, item_name, sku, quantity, unit, estimated_price, comment, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, tenant_id, repair_order_id, supplier_order_id, item_id, item_name, sku, quantity, unit,
                 estimated_price, status, comment, created_by, created_at, updated_at`,
      [
        tenantId,
        payload.repair_order_id ?? null,
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
      supplierOrderId: row.supplier_order_id,
      repairTicketNumber: null,
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

  async updatePurchaseRequest(
    tenantId: string,
    requestId: string,
    payload: UpdatePurchaseRequestPayload,
  ): Promise<PurchaseRequestDTO | null> {
    const fields: string[] = [];
    const params: SqlParam[] = [tenantId, requestId];

    if (payload.status) {
      params.push(payload.status);
      fields.push(`status = $${params.length}`);
    }
    if (payload.comment !== undefined) {
      params.push(payload.comment);
      fields.push(`comment = $${params.length}`);
    }

    if (fields.length === 0) return null;

    params.push(new Date());
    fields.push(`updated_at = $${params.length}`);

    return withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE purchase_requests SET ${fields.join(", ")}
         WHERE tenant_id = $1 AND id = $2`,
        params,
      );

      const list = await this.listPurchaseRequests(tenantId);
      return list.find((r) => r.id === requestId) ?? null;
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

      const orderRow = await tx.queryOneOrThrow<SupplierOrderRow>(
        `INSERT INTO supplier_orders
           (tenant_id, order_number, supplier_name, status, total_amount, notes, created_by)
         VALUES ($1, $2, $3, 'pending_payment', 0, $4, $5)
         RETURNING *`,
        [tenantId, orderNumber, payload.supplier_name, payload.notes ?? "", userId],
      );

      let totalAmount = 0;
      const createdItems: SupplierOrderItemDTO[] = [];

      // Вариант 1: Формирование из purchase_request_ids
      if (payload.purchase_request_ids && payload.purchase_request_ids.length > 0) {
        const requests = await tx.query<PurchaseRequestRow>(
          `SELECT * FROM purchase_requests
           WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [tenantId, payload.purchase_request_ids],
        );

        for (const req of requests) {
          const qty = Number(req.quantity);
          const price = Number(req.estimated_price || 0);
          const itemTotal = qty * price;
          totalAmount += itemTotal;

          const itemRow = await tx.queryOneOrThrow<SupplierOrderItemRow>(
            `INSERT INTO supplier_order_items
               (tenant_id, supplier_order_id, purchase_request_id, item_id, item_name, sku, quantity, unit, price, total_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
              tenantId,
              orderRow.id,
              req.id,
              req.item_id,
              req.item_name,
              req.sku,
              qty,
              req.unit,
              price,
              itemTotal,
            ],
          );

          createdItems.push({
            id: itemRow.id,
            supplierOrderId: itemRow.supplier_order_id,
            purchaseRequestId: itemRow.purchase_request_id,
            itemId: itemRow.item_id,
            itemName: itemRow.item_name,
            sku: itemRow.sku,
            quantity: Number(itemRow.quantity),
            unit: itemRow.unit,
            price: Number(itemRow.price),
            totalPrice: Number(itemRow.total_price),
            createdAt: toIso(itemRow.created_at),
          });
        }

        // Обновляем статус исходных заявок на 'ordered'
        await tx.query(
          `UPDATE purchase_requests
           SET status = 'ordered', supplier_order_id = $1, updated_at = now()
           WHERE tenant_id = $2 AND id = ANY($3::uuid[])`,
          [orderRow.id, tenantId, payload.purchase_request_ids],
        );
      }

      // Вариант 2: Прямая передача позиций
      if (payload.items && payload.items.length > 0) {
        for (const it of payload.items) {
          const itemTotal = it.quantity * it.price;
          totalAmount += itemTotal;

          const itemRow = await tx.queryOneOrThrow<SupplierOrderItemRow>(
            `INSERT INTO supplier_order_items
               (tenant_id, supplier_order_id, purchase_request_id, item_id, item_name, sku, quantity, unit, price, total_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             RETURNING *`,
            [
              tenantId,
              orderRow.id,
              it.purchase_request_id ?? null,
              it.item_id ?? null,
              it.item_name,
              it.sku ?? "",
              it.quantity,
              it.unit ?? "шт",
              it.price,
              itemTotal,
            ],
          );

          createdItems.push({
            id: itemRow.id,
            supplierOrderId: itemRow.supplier_order_id,
            purchaseRequestId: itemRow.purchase_request_id,
            itemId: itemRow.item_id,
            itemName: itemRow.item_name,
            sku: itemRow.sku,
            quantity: Number(itemRow.quantity),
            unit: itemRow.unit,
            price: Number(itemRow.price),
            totalPrice: Number(itemRow.total_price),
            createdAt: toIso(itemRow.created_at),
          });
        }
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
    const itemRows = await query<SupplierOrderItemRow>(
      `SELECT * FROM supplier_order_items
       WHERE tenant_id = $1 AND supplier_order_id = ANY($2::uuid[])
       ORDER BY created_at ASC`,
      [tenantId, orderIds],
    );

    const itemsByOrder = new Map<string, SupplierOrderItemDTO[]>();
    for (const item of itemRows) {
      const list = itemsByOrder.get(item.supplier_order_id) ?? [];
      list.push({
        id: item.id,
        supplierOrderId: item.supplier_order_id,
        purchaseRequestId: item.purchase_request_id,
        itemId: item.item_id,
        itemName: item.item_name,
        sku: item.sku,
        quantity: Number(item.quantity),
        unit: item.unit,
        price: Number(item.price),
        totalPrice: Number(item.total_price),
        createdAt: toIso(item.created_at),
      });
      itemsByOrder.set(item.supplier_order_id, list);
    }

    return orderRows.map((o) => ({
      id: o.id,
      orderNumber: o.order_number,
      supplierName: o.supplier_name,
      status: (o.status as SupplierOrderStatus) || "pending_payment",
      totalAmount: Number(o.total_amount),
      cashAccountId: o.cash_account_id,
      financeTransactionId: o.finance_transaction_id,
      notes: o.notes,
      paidAt: toNullableIso(o.paid_at),
      receivedAt: toNullableIso(o.received_at),
      createdBy: o.created_by,
      createdByName: o.created_by_name,
      items: itemsByOrder.get(o.id) ?? [],
      createdAt: toIso(o.created_at),
      updatedAt: toIso(o.updated_at),
    }));
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
    _userId: string | null,
    payload: PaySupplierOrderPayload,
  ): Promise<{ order: SupplierOrderDTO; transactionId: string; status: string }> {
    return withTenant(tenantId, async (tx) => {
      const order = await tx.queryOneOrThrow<SupplierOrderRow>(
        `SELECT * FROM supplier_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );

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

      // Категория расхода
      let cat = await tx.queryOne<{ id: string }>(
        `SELECT id FROM finance_categories
         WHERE tenant_id = $1 AND type = 'expense' AND lower(name) LIKE '%запчаст%'
         LIMIT 1`,
        [tenantId],
      );
      if (!cat) {
        cat = await tx.queryOne<{ id: string }>(
          `INSERT INTO finance_categories (tenant_id, name, type)
           VALUES ($1, 'Закупка запчастей и комплектующих', 'expense')
           RETURNING id`,
          [tenantId],
        );
      }

      // Проводка в transactions (РКО)
      const description = payload.comment || `Оплата заказа поставщику ${order.order_number} (${order.supplier_name})`;
      const txRow = await tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO transactions
           (tenant_id, cash_account_id, category_id, amount, direction, description, counterparty_name)
         VALUES ($1, $2, $3, $4, 'expense', $5, $6)
         RETURNING id`,
        [
          tenantId,
          cashAccountId,
          cat?.id ?? null,
          totalAmount,
          description,
          order.supplier_name,
        ],
      );

      // Списание с кассы
      await tx.query(
        `UPDATE cash_accounts SET balance = balance - $1 WHERE tenant_id = $2 AND id = $3`,
        [totalAmount, tenantId, cashAccountId],
      );

      // Переводим заказ в статус 'paid'
      const updatedOrder = await tx.queryOneOrThrow<SupplierOrderRow>(
        `UPDATE supplier_orders
         SET status = 'paid', cash_account_id = $1, finance_transaction_id = $2, paid_at = now(), updated_at = now()
         WHERE tenant_id = $3 AND id = $4
         RETURNING *`,
        [cashAccountId, txRow.id, tenantId, id],
      );

      const items = await tx.query<SupplierOrderItemRow>(
        `SELECT * FROM supplier_order_items WHERE tenant_id = $1 AND supplier_order_id = $2`,
        [tenantId, id],
      );

      const orderDto: SupplierOrderDTO = {
        id: updatedOrder.id,
        orderNumber: updatedOrder.order_number,
        supplierName: updatedOrder.supplier_name,
        status: "paid",
        totalAmount,
        cashAccountId,
        financeTransactionId: txRow.id,
        notes: updatedOrder.notes,
        paidAt: toIso(updatedOrder.paid_at),
        receivedAt: toNullableIso(updatedOrder.received_at),
        createdBy: updatedOrder.created_by,
        items: items.map((i) => ({
          id: i.id,
          supplierOrderId: i.supplier_order_id,
          purchaseRequestId: i.purchase_request_id,
          itemId: i.item_id,
          itemName: i.item_name,
          sku: i.sku,
          quantity: Number(i.quantity),
          unit: i.unit,
          price: Number(i.price),
          totalPrice: Number(i.total_price),
          createdAt: toIso(i.created_at),
        })),
        createdAt: toIso(updatedOrder.created_at),
        updatedAt: toIso(updatedOrder.updated_at),
      };

      return {
        order: orderDto,
        transactionId: txRow.id,
        status: "PAID",
      };
    });
  }

  /**
   * Оприходование по заказу поставщику (создание партий и журнала движений)
   */
  async createReceiptFromSupplierOrder(
    tenantId: string,
    id: string,
    userId: string | null,
  ): Promise<{ success: boolean; order: SupplierOrderDTO; batchesCreated: number }> {
    return withTenant(tenantId, async (tx) => {
      const order = await tx.queryOneOrThrow<SupplierOrderRow>(
        `SELECT * FROM supplier_orders WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
        [tenantId, id],
      );

      const items = await tx.query<SupplierOrderItemRow>(
        `SELECT * FROM supplier_order_items WHERE tenant_id = $1 AND supplier_order_id = $2`,
        [tenantId, id],
      );

      let batchesCount = 0;

      for (const it of items) {
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
                it.price,
                Number(it.price) * 1.4,
              ],
            );
            itemId = newItem.id;
          }
        }

        const qty = Number(it.quantity);
        const price = Number(it.price);

        // Обновляем закупочную цену детали
        await tx.query(
          `UPDATE warehouse_items
           SET cost_price = $1, updated_at = now()
           WHERE tenant_id = $2 AND id = $3`,
          [price, tenantId, itemId],
        );

        // Создаем партию
        const batch = await tx.queryOneOrThrow<WarehouseBatchRow>(
          `INSERT INTO warehouse_batches
             (tenant_id, item_id, batch_number, supplier_name, purchase_price, initial_quantity, remaining_quantity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            tenantId,
            itemId,
            order.order_number,
            order.supplier_name,
            price,
            qty,
            qty,
          ],
        );

        // Движение на склад
        await tx.query(
          `INSERT INTO warehouse_movements
             (tenant_id, item_id, batch_id, type, quantity, cost_price, description, created_by)
           VALUES ($1, $2, $3, 'intake', $4, $5, $6, $7)`,
          [
            tenantId,
            itemId,
            batch.id,
            qty,
            price,
            `Поступление по заказу поставщику ${order.order_number} (${order.supplier_name})`,
            userId,
          ],
        );

        batchesCount++;

        // Если заявка была привязана, переводим ее в 'received'
        if (it.purchase_request_id) {
          await tx.query(
            `UPDATE purchase_requests
             SET status = 'received', updated_at = now()
             WHERE tenant_id = $1 AND id = $2`,
            [tenantId, it.purchase_request_id],
          );
        }
      }

      // Переводим заказ в статус 'received'
      const updatedOrder = await tx.queryOneOrThrow<SupplierOrderRow>(
        `UPDATE supplier_orders
         SET status = 'received', received_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = $2
         RETURNING *`,
        [tenantId, id],
      );

      const orderDto: SupplierOrderDTO = {
        id: updatedOrder.id,
        orderNumber: updatedOrder.order_number,
        supplierName: updatedOrder.supplier_name,
        status: "received",
        totalAmount: Number(updatedOrder.total_amount),
        cashAccountId: updatedOrder.cash_account_id,
        financeTransactionId: updatedOrder.finance_transaction_id,
        notes: updatedOrder.notes,
        paidAt: toNullableIso(updatedOrder.paid_at),
        receivedAt: toIso(updatedOrder.received_at),
        createdBy: updatedOrder.created_by,
        items: items.map((i) => ({
          id: i.id,
          supplierOrderId: i.supplier_order_id,
          purchaseRequestId: i.purchase_request_id,
          itemId: i.item_id,
          itemName: i.item_name,
          sku: i.sku,
          quantity: Number(i.quantity),
          unit: i.unit,
          price: Number(i.price),
          totalPrice: Number(i.total_price),
          createdAt: toIso(i.created_at),
        })),
        createdAt: toIso(updatedOrder.created_at),
        updatedAt: toIso(updatedOrder.updated_at),
      };

      return {
        success: true,
        order: orderDto,
        batchesCreated: batchesCount,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Repair Order FIFO Consumption & Deficit Write-off
  // ---------------------------------------------------------------------------

  async consumePartsForOrder(tenantId: string, orderId: string, userId: string): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      const parts = await tx.query<{
        id: string;
        warehouse_item_id: string | null;
        name: string;
        quantity: number;
        retail_price: string;
        cost_price: string;
      }>(
        `SELECT id, warehouse_item_id, name, quantity, retail_price, cost_price
         FROM repair_parts
         WHERE tenant_id = $1 AND repair_order_id = $2`,
        [tenantId, orderId],
      );

      for (const part of parts) {
        if (!part.warehouse_item_id) continue;

        let needed = Number(part.quantity);

        const batches = await tx.query<{ id: string; remaining_quantity: string; purchase_price: string }>(
          `SELECT id, remaining_quantity, purchase_price
           FROM warehouse_batches
           WHERE tenant_id = $1 AND item_id = $2 AND remaining_quantity > 0
           ORDER BY received_at ASC
           FOR UPDATE`,
          [tenantId, part.warehouse_item_id],
        );

        for (const batch of batches) {
          if (needed <= 0) break;
          const rem = Number(batch.remaining_quantity);
          const take = Math.min(needed, rem);

          await tx.query(
            `UPDATE warehouse_batches
             SET remaining_quantity = remaining_quantity - $1
             WHERE tenant_id = $2 AND id = $3`,
            [take, tenantId, batch.id],
          );

          await tx.query(
            `INSERT INTO warehouse_movements
               (tenant_id, item_id, batch_id, repair_order_id, type, quantity, cost_price, description, created_by)
             VALUES ($1, $2, $3, $4, 'write_off', $5, $6, $7, $8)`,
            [
              tenantId,
              part.warehouse_item_id,
              batch.id,
              orderId,
              take,
              Number(batch.purchase_price),
              `Списание в заказ-наряд (${part.name})`,
              userId,
            ],
          );

          needed -= take;
        }

        // Если остался дефицит (продажа в минус / пересорт)
        if (needed > 0) {
          const settings = await this.getSettings(tenantId);
          if (settings.allowNegativeStock) {
            await tx.query(
              `INSERT INTO warehouse_movements
                 (tenant_id, item_id, repair_order_id, type, quantity, cost_price, description, created_by)
               VALUES ($1, $2, $3, 'write_off', $4, $5, $6, $7)`,
              [
                tenantId,
                part.warehouse_item_id,
                orderId,
                needed,
                Number(part.cost_price || 0),
                `Списание в заказ-наряд (дефицит/продажа в минус: ${part.name})`,
                userId,
              ],
            );
          }
        }

        await tx.query(
          `UPDATE warehouse_reservations
           SET status = 'consumed', updated_at = now()
           WHERE tenant_id = $1 AND repair_order_id = $2 AND item_id = $3 AND status = 'reserved'`,
          [tenantId, orderId, part.warehouse_item_id],
        );
      }
    });
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
    let items = await this.listItems(tenantId, payload.search);
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

      for (let idx = 0; idx < dataRows.length; idx++) {
        const row = dataRows[idx];
        if (!row) continue;
        const rowNumber = (payload.skipFirstRow ? 2 : 1) + idx;
        const parsed = extractRowFields(row, payload.mapping, headers);

        if (!parsed.name) {
          errorCount++;
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
            updatedCount++;
            continue;
          }

          // keep_both: fall through to insert
        }

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
        importedCount++;
      }

      return { importedCount, updatedCount, skippedCount, errorCount };
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

      if (updates.length === 0) {
        return { updatedCount: 0 };
      }

      updates.push("updated_at = now()");

      const res = await tx.query(
        `UPDATE warehouse_items
         SET ${updates.join(", ")}
         WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
        params,
      );

      return { updatedCount: res.length };
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
        const res = await tx.query(
          `UPDATE warehouse_items
           SET deleted_at = now()
           WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
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
}

export const warehouseService = new WarehouseService();
