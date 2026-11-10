import { query, queryOneOrThrow, withTenant, type SqlParam } from "../../db/client.js";
import {
  purchaseRequestStatusSchema,
  type CreatePurchaseRequestPayload,
  type CreateWarehouseItemPayload,
  IntakeBatchPayload,
  PurchaseRequestDTO,
  PurchaseRequestRow,
  UpdatePurchaseRequestPayload,
  UpdateWarehouseItemPayload,
  WarehouseBatchDTO,
  WarehouseBatchRow,
  WarehouseItemDTO,
  WarehouseItemRow,
  WarehouseMovementDTO,
  WarehouseMovementRow,
} from "./warehouse.types.js";

function toIso(val: Date | string | null | undefined): string {
  if (!val) return new Date().toISOString();
  return typeof val === "string" ? new Date(val).toISOString() : val.toISOString();
}

export class WarehouseService {
  async listItems(tenantId: string, search?: string): Promise<WarehouseItemDTO[]> {
    const params: (string | number)[] = [tenantId];
    let searchFilter = "";

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      searchFilter = `AND (lower(i.name) LIKE $${params.length} OR lower(i.sku) LIKE $${params.length})`;
    }

    const rows = await query<WarehouseItemRow>(
      `SELECT i.id, i.tenant_id, i.sku, i.name, i.category, i.unit,
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
      return {
        id: r.id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        unit: r.unit,
        minStock: Number(r.min_stock ?? 0),
        retailPrice: Number(r.retail_price ?? 0),
        costPrice: Number(r.cost_price ?? 0),
        totalStock: total,
        reservedStock: reserved,
        availableStock: Math.max(total - reserved, 0),
        createdAt: toIso(r.created_at),
        updatedAt: toIso(r.updated_at),
      };
    });
  }

  async createItem(tenantId: string, payload: CreateWarehouseItemPayload): Promise<WarehouseItemDTO> {
    const row = await queryOneOrThrow<WarehouseItemRow>(
      `INSERT INTO warehouse_items
         (tenant_id, sku, name, category, unit, min_stock, retail_price, cost_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tenant_id, sku, name, category, unit, min_stock, retail_price, cost_price, created_at, updated_at`,
      [
        tenantId,
        payload.sku ?? "",
        payload.name,
        payload.category ?? "",
        payload.unit ?? "шт",
        payload.min_stock ?? 0,
        payload.retail_price ?? 0,
        payload.cost_price ?? 0,
      ],
    );

    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
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
    userId: string,
    payload: IntakeBatchPayload,
  ): Promise<WarehouseBatchDTO> {
    return withTenant(tenantId, async (tx) => {
      let itemId = payload.item_id;

      // Если деталь не выбрана, находим по артикулу или создаем
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

      // Обновляем последнюю закупочную цену детали
      await tx.query(
        `UPDATE warehouse_items
         SET cost_price = $1,
             retail_price = CASE WHEN $2::numeric IS NOT NULL THEN $2::numeric ELSE retail_price END,
             updated_at = now()
         WHERE tenant_id = $3 AND id = $4`,
        [payload.purchase_price, payload.retail_price ?? null, tenantId, itemId],
      );

      // Создаем партию
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

      // Запись в журнал движений
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

      // Фиксация расхода в ДДС при включенном флаге
      if (payload.record_finance_expense && payload.cash_account_id) {
        const totalAmount = payload.purchase_price * payload.quantity;
        if (totalAmount > 0) {
          // Находим категорию "Закупка запчастей и комплектующих"
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

            // Списание с баланса кассы
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

  async listPurchaseRequests(
    tenantId: string,
    status?: string,
    repairOrderId?: string,
  ): Promise<PurchaseRequestDTO[]> {
    const params: (string | number)[] = [tenantId];
    const filters: string[] = [];

    if (status) {
      params.push(status);
      filters.push(`pr.status = $${params.length}`);
    }
    if (repairOrderId) {
      params.push(repairOrderId);
      filters.push(`pr.repair_order_id = $${params.length}`);
    }

    const whereExtra = filters.length > 0 ? `AND ${filters.join(" AND ")}` : "";

    const rows = await query<PurchaseRequestRow>(
      `SELECT pr.id, pr.tenant_id, pr.repair_order_id, pr.item_id, pr.item_name, pr.sku,
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
      repairTicketNumber: r.repair_ticket_number,
      itemId: r.item_id,
      itemName: r.item_name,
      sku: r.sku,
      quantity: Number(r.quantity),
      unit: r.unit,
      estimatedPrice: Number(r.estimated_price),
      status: purchaseRequestStatusSchema.safeParse(r.status).data ?? "pending",
      comment: r.comment,
      createdByName: r.created_by_name,
      createdAt: toIso(r.created_at),
      updatedAt: toIso(r.updated_at),
    }));
  }

  async createPurchaseRequest(
    tenantId: string,
    userId: string,
    payload: CreatePurchaseRequestPayload,
  ): Promise<PurchaseRequestDTO> {
    const row = await queryOneOrThrow<PurchaseRequestRow>(
      `INSERT INTO purchase_requests
         (tenant_id, repair_order_id, item_id, item_name, sku, quantity, unit, estimated_price, comment, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, tenant_id, repair_order_id, item_id, item_name, sku, quantity, unit,
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
      repairTicketNumber: null,
      itemId: row.item_id,
      itemName: row.item_name,
      sku: row.sku,
      quantity: Number(row.quantity),
      unit: row.unit,
      estimatedPrice: Number(row.estimated_price),
      status: "pending",
      comment: row.comment,
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

  /**
   * Списание партий по наряду по правилу FIFO.
   * Вызывается при переходе наряда в статус "completed" или "delivered".
   */
  async consumePartsForOrder(tenantId: string, orderId: string, userId: string): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      // Ищем детали в наряде
      const parts = await tx.query<{
        id: string;
        warehouse_item_id: string | null;
        name: string;
        quantity: number;
        retail_price: string;
      }>(
        `SELECT id, warehouse_item_id, name, quantity, retail_price
         FROM repair_parts
         WHERE tenant_id = $1 AND repair_order_id = $2`,
        [tenantId, orderId],
      );

      for (const part of parts) {
        if (!part.warehouse_item_id) continue;

        let needed = Number(part.quantity);

        // Получаем доступные партии FIFO (самые ранние)
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

        // Освобождаем / закрываем активные резервы
        await tx.query(
          `UPDATE warehouse_reservations
           SET status = 'consumed', updated_at = now()
           WHERE tenant_id = $1 AND repair_order_id = $2 AND item_id = $3 AND status = 'reserved'`,
          [tenantId, orderId, part.warehouse_item_id],
        );
      }
    });
  }

  /**
   * Снятие резервов при отмене наряда
   */
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
}

export const warehouseService = new WarehouseService();
