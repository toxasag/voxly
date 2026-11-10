import type { FastifyInstance } from "fastify";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { printTemplatesService } from "./print-templates.service.js";
import {
  createPrintTemplateSchema,
  updatePrintTemplateSchema,
  updatePrintTemplateSettingsSchema,
} from "./print-templates.types.js";

export async function printTemplatesRoutes(app: FastifyInstance) {
  await app.register(authenticatePlugin);

  // Список доступных шаблонов (с фильтрацией по типу документа)
  app.get("/", async (request, reply) => {
    const { tenant_id } = request;
    const { type, document_type } = request.query as {
      type?: string;
      document_type?: string;
    };
    const filterType = document_type || type;
    const list = await printTemplatesService.list(tenant_id, filterType);
    return reply.send({ data: list, templates: list });
  });

  // Настройки печати тенанта (реквизиты, брендинг, правила, нумерация)
  app.get("/settings", async (request, reply) => {
    const { tenant_id } = request;
    const settings = await printTemplatesService.getSettings(tenant_id);
    return reply.send({ data: settings });
  });

  app.put("/settings", async (request, reply) => {
    const { tenant_id } = request;
    const body = updatePrintTemplateSettingsSchema.parse(request.body);
    const updated = await printTemplatesService.updateSettings(tenant_id, body);
    return reply.send({ data: updated });
  });

  app.patch("/settings", async (request, reply) => {
    const { tenant_id } = request;
    const body = updatePrintTemplateSettingsSchema.parse(request.body);
    const updated = await printTemplatesService.updateSettings(tenant_id, body);
    return reply.send({ data: updated });
  });

  // Создание / клонирование нового шаблона
  app.post("/", async (request, reply) => {
    const { tenant_id } = request;
    const body = createPrintTemplateSchema.parse(request.body);
    const created = await printTemplatesService.create(tenant_id, body);
    return reply.status(201).send({ data: created });
  });

  // Установка шаблона по умолчанию для его типа документа
  app.post("/:id/set-default", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const updated = await printTemplatesService.setDefault(tenant_id, id);
    return reply.send({ success: true, data: updated });
  });

  // Удаление кастомного шаблона
  app.delete("/:id", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const result = await printTemplatesService.delete(tenant_id, id);
    return reply.send(result);
  });

  // Получение шаблона по ID или слагу
  app.get("/:idOrSlug", async (request, reply) => {
    const { tenant_id } = request;
    const { idOrSlug } = request.params as { idOrSlug: string };
    const tpl = await printTemplatesService.getBySlug(tenant_id, idOrSlug);
    if (!tpl) {
      return reply.status(404).send({ error: "Print template not found" });
    }
    return reply.send({ data: tpl });
  });

  // Обновление шаблона по ID
  app.put("/:id", async (request, reply) => {
    const { tenant_id } = request;
    const { id } = request.params as { id: string };
    const body = updatePrintTemplateSchema.parse(request.body);
    const updated = await printTemplatesService.update(tenant_id, id, body);
    if (!updated) {
      return reply.status(404).send({ error: "Print template not found" });
    }
    return reply.send({ data: updated });
  });

  // Рендер шаблона для наряда (возвращает готовый HTML)
  app.get("/:idOrSlug/render", async (request, reply) => {
    const { tenant_id } = request;
    const { idOrSlug } = request.params as { idOrSlug: string };
    const { orderId } = request.query as { orderId?: string };

    if (!orderId) {
      return reply.status(400).send({ error: "orderId is required" });
    }

    const html = await printTemplatesService.renderForOrder(tenant_id, idOrSlug, orderId);
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });
}
