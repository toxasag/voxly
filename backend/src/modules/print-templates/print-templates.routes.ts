import type { FastifyInstance } from "fastify";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { printTemplatesService } from "./print-templates.service.js";
import { updatePrintTemplateSchema } from "./print-templates.types.js";

export async function printTemplatesRoutes(app: FastifyInstance) {
  await app.register(authenticatePlugin);

  // Список доступных шаблонов
  app.get("/", async (request, reply) => {
    const { tenant_id } = request;
    const list = await printTemplatesService.list(tenant_id);
    return reply.send({ data: list });
  });

  // Получение шаблона по слагу
  app.get("/:slug", async (request, reply) => {
    const { tenant_id } = request;
    const { slug } = request.params as { slug: string };
    const tpl = await printTemplatesService.getBySlug(tenant_id, slug);
    if (!tpl) {
      return reply.status(404).send({ error: "Print template not found" });
    }
    return reply.send({ data: tpl });
  });

  // Обновление шаблона
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
  app.get("/:slug/render", async (request, reply) => {
    const { tenant_id } = request;
    const { slug } = request.params as { slug: string };
    const { orderId } = request.query as { orderId?: string };

    if (!orderId) {
      return reply.status(400).send({ error: "orderId is required" });
    }

    const html = await printTemplatesService.renderForOrder(tenant_id, slug, orderId);
    reply.header("Content-Type", "text/html; charset=utf-8");
    return reply.send(html);
  });
}
