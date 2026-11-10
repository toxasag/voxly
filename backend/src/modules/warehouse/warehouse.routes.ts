import type { FastifyInstance } from "fastify";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { warehouseService } from "./warehouse.service.js";
import {
  createPurchaseRequestSchema,
  createSupplierOrderSchema,
  createWarehouseItemSchema,
  intakeBatchSchema,
  paySupplierOrderSchema,
  updatePurchaseRequestSchema,
  updateWarehouseItemSchema,
  updateWarehouseSettingsSchema,
} from "./warehouse.types.js";

export async function warehouseRoutes(app: FastifyInstance) {
  await app.register(authenticatePlugin);

  // Настройки склада (продажа в минус и политики остатков)
  app.get("/settings", async (request, reply) => {
    const { tenant_id } = request;
    const settings = await warehouseService.getSettings(tenant_id);
    return reply.send({ data: settings });
  });

  app.patch("/settings", async (request, reply) => {
    const { tenant_id } = request;
    const body = updateWarehouseSettingsSchema.parse(request.body);
    const updated = await warehouseService.updateSettings(tenant_id, body);
    return reply.send({ data: updated });
  });

  // Список деталей с остатками
  app.get("/items", async (request, reply) => {
    const { tenant_id } = request;
    const { search } = request.query as { search?: string };
    const items = await warehouseService.listItems(tenant_id, search);
    return reply.send({ data: items });
  });

  // Создание номенклатуры
  app.post("/items", async (request, reply) => {
    const { tenant_id } = request;
    const body = createWarehouseItemSchema.parse(request.body);
    const item = await warehouseService.createItem(tenant_id, body);
    return reply.status(201).send({ data: item });
  });

  // Обновление номенклатуры
  app.patch("/items/:id", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updateWarehouseItemSchema.parse(request.body);
    const updated = await warehouseService.updateItem(tenant_id, id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Item not found" });
    }
    return reply.send({ data: updated });
  });

  // Удаление номенклатуры
  app.delete("/items/:id", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const ok = await warehouseService.deleteItem(tenant_id, id);
    return reply.send({ success: ok });
  });

  // Оприходование партии
  app.post("/intake", async (request, reply) => {
    const { tenant_id } = request;
    const userId = request.authUser?.id ?? null;
    const body = intakeBatchSchema.parse(request.body);
    const batch = await warehouseService.intakeBatch(tenant_id, userId, body);
    return reply.status(201).send({ data: batch });
  });

  // Список партий
  app.get("/batches", async (request, reply) => {
    const { tenant_id } = request;
    const { item_id } = request.query as { item_id?: string };
    const batches = await warehouseService.listBatches(tenant_id, item_id);
    return reply.send({ data: batches });
  });

  // Журнал движений
  app.get("/movements", async (request, reply) => {
    const { tenant_id } = request;
    const { limit } = request.query as { limit?: string };
    const movements = await warehouseService.listMovements(tenant_id, limit ? parseInt(limit, 10) : 100);
    return reply.send({ data: movements });
  });

  // Список заявок на закупку (индивидуальные строки)
  app.get("/purchases", async (request, reply) => {
    const { tenant_id } = request;
    const { status, repair_order_id } = request.query as { status?: string; repair_order_id?: string };
    const list = await warehouseService.listPurchaseRequests(tenant_id, status, repair_order_id);
    return reply.send({ data: list });
  });

  // Агрегированные заявки на закупку (сводка по номенклатуре с перечнем номеров заказ-нарядов)
  app.get("/purchase-requests", async (request, reply) => {
    const { tenant_id } = request;
    const { status } = request.query as { status?: string };
    const list = await warehouseService.listAggregatedPurchaseRequests(tenant_id, status);
    return reply.send({ data: list });
  });

  // Создание заявки на закупку
  app.post("/purchases", async (request, reply) => {
    const { tenant_id } = request;
    const userId = request.authUser?.id ?? null;
    const body = createPurchaseRequestSchema.parse(request.body);
    const created = await warehouseService.createPurchaseRequest(tenant_id, userId, body);
    return reply.status(201).send({ data: created });
  });

  // Обновление статуса заявки
  app.patch("/purchases/:id", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updatePurchaseRequestSchema.parse(request.body);
    const updated = await warehouseService.updatePurchaseRequest(tenant_id, id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Purchase request not found" });
    }
    return reply.send({ data: updated });
  });

  // -------------------------------------------------------------------------
  // Заказы поставщикам (Supplier Orders)
  // -------------------------------------------------------------------------

  app.get("/supplier-orders", async (request, reply) => {
    const { tenant_id } = request;
    const { status } = request.query as { status?: string };
    const list = await warehouseService.listSupplierOrders(tenant_id, status);
    return reply.send({ data: list });
  });

  app.post("/supplier-orders", async (request, reply) => {
    const { tenant_id } = request;
    const userId = request.authUser?.id ?? null;
    const body = createSupplierOrderSchema.parse(request.body);
    const created = await warehouseService.createSupplierOrder(tenant_id, userId, body);
    return reply.status(201).send({ data: created });
  });

  app.get("/supplier-orders/:id", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const order = await warehouseService.getSupplierOrder(tenant_id, id);
    if (!order) {
      return reply.status(404).send({ error: "Supplier order not found" });
    }
    return reply.send({ data: order });
  });

  app.post("/supplier-orders/:id/pay", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const userId = request.authUser?.id ?? null;
    const body = paySupplierOrderSchema.parse(request.body ?? {});
    const res = await warehouseService.paySupplierOrder(tenant_id, id, userId, body);
    return reply.send({
      data: res.order,
      status: "PAID",
      transaction_id: res.transactionId,
    });
  });

  app.post("/supplier-orders/:id/create-receipt", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const userId = request.authUser?.id ?? null;
    const res = await warehouseService.createReceiptFromSupplierOrder(tenant_id, id, userId);
    return reply.send({ data: res });
  });
}
