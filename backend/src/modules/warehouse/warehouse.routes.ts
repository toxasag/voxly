import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { warehouseService } from "./warehouse.service.js";
import {
  bulkDeleteIdsSchema,
  bulkDeleteWarehouseItemsSchema,
  bulkUpdateWarehouseItemsSchema,
  createPurchaseRequestSchema,
  createSupplierOrderSchema,
  createWarehouseItemSchema,
  exportWarehouseItemsSchema,
  importCommitSchema,
  importValidateSchema,
  intakeBatchSchema,
  intakeDocumentSchema,
  paySupplierOrderSchema,
  receiptSupplierOrderSchema,
  updatePurchaseRequestSchema,
  updateSupplierOrderSchema,
  updateWarehouseBatchSchema,
  updateWarehouseItemSchema,
  updateWarehouseMovementSchema,
  updateWarehouseSettingsSchema,
  warehousePaginationQuerySchema,
} from "./warehouse.types.js";

export async function warehouseRoutes(app: FastifyInstance) {
  await app.register(authenticatePlugin);

  const moduleGuard = app.requireAnyModule(["products_services", "service_center"]);
  const canRead = [moduleGuard, app.requireAnyPermission(["deals:read", "service_center:read"])];
  const canWrite = [moduleGuard, app.requireAnyPermission(["deals:write", "service_center:write"])];
  const canPay = [moduleGuard, app.requireAnyPermission(["finance:write", "tenant:admin"])];
  const canAdmin = [moduleGuard, app.requirePermission("tenant:admin")];

  // Экспорт номенклатуры (XLSX / CSV)
  app.post("/export", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const body = exportWarehouseItemsSchema.parse(request.body ?? {});
    const { buffer, filename, contentType } = await warehouseService.exportItems(tenant_id, body);
    return reply
      .header("Content-Type", contentType)
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`)
      .send(buffer);
  });

  // Парсинг загруженного файла импорта (XLSX / CSV)
  app.post("/import/parse", { onRequest: canWrite }, async (request, reply) => {
    if (request.isMultipart()) {
      const file = await request.file({ limits: { fileSize: 20 * 1024 * 1024 } });
      if (!file) {
        return reply.status(400).send({ error: "Файл не передан" });
      }
      const buffer = await file.toBuffer();
      const delimiter =
        typeof file.fields?.delimiter === "object" && file.fields.delimiter && "value" in file.fields.delimiter
          ? String(file.fields.delimiter.value)
          : undefined;
      const parsed = await warehouseService.parseImportFile(buffer, file.filename, delimiter);
      return reply.send({ data: parsed });
    }

    const body = request.body as
      | { fileBase64?: string; csvText?: string; filename?: string; delimiter?: string }
      | undefined;
    if (body?.fileBase64) {
      const buffer = Buffer.from(body.fileBase64, "base64");
      const filename = body.filename || "import.xlsx";
      const parsed = await warehouseService.parseImportFile(buffer, filename, body.delimiter);
      return reply.send({ data: parsed });
    }

    if (body?.csvText) {
      const buffer = Buffer.from(body.csvText, "utf8");
      const parsed = await warehouseService.parseImportFile(buffer, "import.csv", body.delimiter);
      return reply.send({ data: parsed });
    }

    return reply.status(400).send({ error: "Не передан файл для парсинга" });
  });

  // Валидация колонок и поиск дубликатов
  app.post("/import/validate", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = importValidateSchema.parse(request.body);
    const result = await warehouseService.validateImport(tenant_id, body);
    return reply.send({ data: result });
  });

  // Выполнение импорта с учетом стратегий коллизий
  app.post("/import/commit", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = importCommitSchema.parse(request.body);
    const result = await warehouseService.commitImport(tenant_id, body);
    return reply.send({ data: result });
  });

  // Массовое редактирование позиций
  app.post("/items/bulk-update", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = bulkUpdateWarehouseItemsSchema.parse(request.body);
    const result = await warehouseService.bulkUpdateItems(tenant_id, body);
    return reply.send({ data: result });
  });

  // Массовое удаление позиций
  app.post("/items/bulk-delete", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = bulkDeleteWarehouseItemsSchema.parse(request.body);
    const result = await warehouseService.bulkDeleteItems(tenant_id, body);
    return reply.send({ data: result });
  });

  // Настройки склада (продажа в минус и политики остатков)
  app.get("/settings", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const settings = await warehouseService.getSettings(tenant_id);
    return reply.send({ data: settings });
  });

  app.patch("/settings", { onRequest: canAdmin }, async (request, reply) => {
    const { tenant_id } = request;
    const body = updateWarehouseSettingsSchema.parse(request.body);
    const updated = await warehouseService.updateSettings(tenant_id, body);
    return reply.send({ data: updated });
  });

  // Список деталей с остатками (корень)
  app.get("/", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const query = warehousePaginationQuerySchema.parse(request.query ?? {});
    const modelIds = query.model_ids ?? query.modelIds;
    const result = await warehouseService.listItems(tenant_id, query.search, {
      page: query.page,
      limit: query.limit,
      all: query.all,
      modelIds,
    });
    return reply.send(result);
  });

  // Список деталей с остатками
  app.get("/items", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const query = warehousePaginationQuerySchema.parse(request.query ?? {});
    const modelIds = query.model_ids ?? query.modelIds;
    const result = await warehouseService.listItems(tenant_id, query.search, {
      page: query.page,
      limit: query.limit,
      all: query.all,
      category: query.category,
      brand: query.brand,
      modelIds,
    });
    return reply.send(result);
  });

  // Получение одной позиции
  app.get("/items/:id", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const item = await warehouseService.getItem(tenant_id, id);
    if (!item) {
      return reply.status(404).send({ error: "Item not found" });
    }
    return reply.send({ data: item, ...item });
  });

  // Создание номенклатуры
  app.post("/items", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = createWarehouseItemSchema.parse(request.body);
    const item = await warehouseService.createItem(tenant_id, body);
    return reply.status(201).send({ data: item, ...item });
  });

  // Обновление номенклатуры
  app.patch("/items/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updateWarehouseItemSchema.parse(request.body);
    const updated = await warehouseService.updateItem(tenant_id, id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Item not found" });
    }
    return reply.send({ data: updated, ...updated });
  });

  // Удаление номенклатуры (с поддержкой force=true для каскадной очистки партий, резервов и движений)
  app.delete("/items/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const { force } = (request.query as { force?: string }) ?? {};
    const isForce = force === "true" || force === "1";
    const ok = await warehouseService.deleteItem(tenant_id, id, isForce);
    return reply.send({ data: { success: ok, id }, success: ok });
  });

  // Справочник категорий склада
  app.get("/categories", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const categories = await warehouseService.listCategories(tenant_id);
    return reply.send({ data: categories });
  });

  app.post("/categories", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = z.object({ name: z.string().min(1).max(100) }).parse(request.body);
    const category = await warehouseService.createCategory(tenant_id, body.name.trim());
    return reply.status(201).send({ data: category });
  });

  // Справочник брендов склада
  app.get("/brands", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const brands = await warehouseService.listBrands(tenant_id);
    return reply.send({ data: brands });
  });

  app.post("/brands", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = z.object({ name: z.string().min(1).max(100) }).parse(request.body);
    const brand = await warehouseService.createBrand(tenant_id, body.name.trim());
    return reply.status(201).send({ data: brand });
  });

  // Справочник моделей склада
  app.get("/models", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const q = request.query as { brand_id?: string; brand?: string };
    const models = await warehouseService.listModels(tenant_id, q.brand_id, q.brand);
    return reply.send({ data: models });
  });

  app.post("/models", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = z.object({
      name: z.string().min(1).max(200),
      brand_id: z.string().uuid().optional(),
      brand_name: z.string().max(200).optional(),
    }).parse(request.body);
    const model = await warehouseService.createModel(tenant_id, body);
    return reply.status(201).send({ data: model });
  });

  app.patch("/models/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = z.object({ name: z.string().min(1).max(200) }).parse(request.body);
    const updated = await warehouseService.renameModel(tenant_id, id, body.name);
    return reply.send({ data: updated });
  });

  app.delete("/models/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const result = await warehouseService.deleteModel(tenant_id, id);
    return reply.send({ data: result });
  });

  // Получение одной позиции (прямой алиас /:id)
  app.get("/:id", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const reserved = [
      "settings",
      "batches",
      "movements",
      "purchases",
      "purchase-requests",
      "supplier-orders",
      "export",
      "import",
      "intake",
      "items",
      "categories",
      "brands",
      "models",
    ];
    if (reserved.includes(id)) {
      return reply.status(404).send({ error: "Not found" });
    }
    const item = await warehouseService.getItem(tenant_id, id);
    if (!item) {
      return reply.status(404).send({ error: "Item not found" });
    }
    return reply.send({ data: item, ...item });
  });

  // Обновление позиции (прямой алиас /:id)
  app.patch("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const reserved = [
      "settings",
      "batches",
      "movements",
      "purchases",
      "purchase-requests",
      "supplier-orders",
      "export",
      "import",
      "intake",
      "items",
      "categories",
      "brands",
      "models",
    ];
    if (reserved.includes(id)) {
      return reply.status(404).send({ error: "Not found" });
    }
    const body = updateWarehouseItemSchema.parse(request.body);
    const updated = await warehouseService.updateItem(tenant_id, id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Item not found" });
    }
    return reply.send({ data: updated, ...updated });
  });

  // Оприходование партии
  app.post("/intake", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const userId = request.authUser?.id ?? null;
    const body = intakeBatchSchema.parse(request.body);
    const batch = await warehouseService.intakeBatch(tenant_id, userId, body);
    return reply.status(201).send({ data: batch });
  });

  // Оприходование приходной накладной / акта (многострочное, с основаниями и связью с финансами)
  app.post("/intake-document", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const userId = request.authUser?.id ?? null;
    const body = intakeDocumentSchema.parse(request.body);
    const result = await warehouseService.intakeDocument(tenant_id, userId, body);
    return reply.status(201).send({ data: result });
  });

  // Список партий
  app.get("/batches", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { item_id } = request.query as { item_id?: string };
    const batches = await warehouseService.listBatches(tenant_id, item_id);
    return reply.send({ data: batches });
  });

  // Редактирование партии
  app.patch("/batches/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updateWarehouseBatchSchema.parse(request.body);
    const updated = await warehouseService.updateBatch(tenant_id, id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Batch not found" });
    }
    return reply.send({ data: updated });
  });

  // Удаление партии с каскадной очисткой движений, резервов и аллокаций
  app.delete("/batches/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const deleted = await warehouseService.deleteBatch(tenant_id, id);
    if (!deleted) {
      return reply.status(404).send({ error: "Batch not found" });
    }
    return reply.send({ data: { deleted: true, id } });
  });

  // Массовое удаление партий
  app.post("/batches/bulk-delete", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = bulkDeleteIdsSchema.parse(request.body);
    const result = await warehouseService.bulkDeleteBatches(tenant_id, body.ids);
    return reply.send({ data: result });
  });

  // Журнал движений
  app.get("/movements", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { limit } = request.query as { limit?: string };
    const movements = await warehouseService.listMovements(tenant_id, limit ? parseInt(limit, 10) : 100);
    return reply.send({ data: movements });
  });

  // Редактирование движения склада
  app.patch("/movements/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updateWarehouseMovementSchema.parse(request.body);
    const updated = await warehouseService.updateMovement(tenant_id, id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Movement not found" });
    }
    return reply.send({ data: updated });
  });

  // Удаление движения склада с откатом влияния на партии/резервы/аллокации
  app.delete("/movements/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const deleted = await warehouseService.deleteMovement(tenant_id, id);
    if (!deleted) {
      return reply.status(404).send({ error: "Movement not found" });
    }
    return reply.send({ data: { deleted: true, id } });
  });

  // Массовое удаление движений склада
  app.post("/movements/bulk-delete", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = bulkDeleteIdsSchema.parse(request.body);
    const result = await warehouseService.bulkDeleteMovements(tenant_id, body.ids);
    return reply.send({ data: result });
  });

  // Список заявок на закупку (индивидуальные строки)
  app.get("/purchases", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { status, repair_order_id, deal_id } = request.query as {
      status?: string;
      repair_order_id?: string;
      deal_id?: string;
    };
    const list = await warehouseService.listPurchaseRequests(tenant_id, status, repair_order_id, deal_id);
    return reply.send({ data: list });
  });

  // Агрегированные заявки на закупку (сводка по номенклатуре с перечнем номеров заказ-нарядов)
  app.get("/purchase-requests", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { status } = request.query as { status?: string };
    const list = await warehouseService.listAggregatedPurchaseRequests(tenant_id, status);
    return reply.send({ data: list });
  });

  // Создание заявок на закупку (одиночное или массовое по массиву itemIds)
  app.post("/purchase-requests", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const userId = request.authUser?.id ?? null;
    const body = request.body as Record<string, unknown>;

    if (Array.isArray(body?.itemIds) && body.itemIds.length > 0) {
      const created = await warehouseService.createBulkPurchaseRequests(
        tenant_id,
        userId,
        {
          itemIds: body.itemIds as string[],
          status: typeof body.status === "string" ? body.status : undefined,
          comment: typeof body.comment === "string" ? body.comment : undefined,
          repair_order_id: typeof body.repair_order_id === "string" ? body.repair_order_id : undefined,
          deal_id: typeof body.deal_id === "string" ? body.deal_id : undefined,
        },
      );
      return reply.status(201).send({ data: created });
    }

    const parsed = createPurchaseRequestSchema.parse(request.body);
    const created = await warehouseService.createPurchaseRequest(tenant_id, userId, parsed);
    return reply.status(201).send({ data: created });
  });

  // Создание заявки на закупку
  app.post("/purchases", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const userId = request.authUser?.id ?? null;
    const body = createPurchaseRequestSchema.parse(request.body);
    const created = await warehouseService.createPurchaseRequest(tenant_id, userId, body);
    return reply.status(201).send({ data: created });
  });

  // Обновление заявки на закупку
  app.patch("/purchases/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updatePurchaseRequestSchema.parse(request.body);
    const updated = await warehouseService.updatePurchaseRequest(tenant_id, id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Purchase request not found" });
    }
    return reply.send({ data: updated });
  });

  // Удаление заявки на закупку
  app.delete("/purchases/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const deleted = await warehouseService.deletePurchaseRequest(tenant_id, id);
    if (!deleted) {
      return reply.status(404).send({ error: "Purchase request not found" });
    }
    return reply.send({ data: { deleted: true, id } });
  });

  // Массовое удаление заявок на закупку
  app.post("/purchases/bulk-delete", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = bulkDeleteIdsSchema.parse(request.body);
    const result = await warehouseService.bulkDeletePurchaseRequests(tenant_id, body.ids);
    return reply.send({ data: result });
  });

  // -------------------------------------------------------------------------
  // Заказы поставщикам (Supplier Orders)
  // -------------------------------------------------------------------------

  app.get("/supplier-orders", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { status } = request.query as { status?: string };
    const list = await warehouseService.listSupplierOrders(tenant_id, status);
    return reply.send({ data: list });
  });

  app.post("/supplier-orders", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const userId = request.authUser?.id ?? null;
    const body = createSupplierOrderSchema.parse(request.body);
    const created = await warehouseService.createSupplierOrder(tenant_id, userId, body);
    return reply.status(201).send({ data: created });
  });

  app.get("/supplier-orders/:id", { onRequest: canRead }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const order = await warehouseService.getSupplierOrder(tenant_id, id);
    if (!order) {
      return reply.status(404).send({ error: "Supplier order not found" });
    }
    return reply.send({ data: order });
  });

  app.patch("/supplier-orders/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updateSupplierOrderSchema.parse(request.body);
    const updated = await warehouseService.updateSupplierOrder(tenant_id, id, body);
    return reply.send({ data: updated });
  });

  app.delete("/supplier-orders/:id", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    await warehouseService.deleteSupplierOrder(tenant_id, id);
    return reply.send({ data: { success: true, id }, success: true });
  });

  app.post("/supplier-orders/bulk-delete", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const body = bulkDeleteIdsSchema.parse(request.body);
    const result = await warehouseService.bulkDeleteSupplierOrders(tenant_id, body.ids);
    return reply.send({ data: result });
  });

  app.post("/supplier-orders/:id/pay", { onRequest: canPay }, async (request, reply) => {
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

  app.post("/supplier-orders/:id/create-receipt", { onRequest: canWrite }, async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const userId = request.authUser?.id ?? null;
    const body = receiptSupplierOrderSchema.parse(request.body ?? {});
    const res = await warehouseService.createReceiptFromSupplierOrder(tenant_id, id, userId, body);
    return reply.send({ data: res });
  });
}
