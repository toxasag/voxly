import type { FastifyInstance } from "fastify";

import { ensureTenantDefaults } from "../../tenant/tenant-defaults.js";
import {
  pageLayoutObjectTypeSchema,
  updatePageLayoutTabSchema,
} from "./page-layout-tabs.types.js";
import { PageLayoutTabsService } from "./page-layout-tabs.service.js";

/**
 * Вкладки карточек: состав, порядок и условия показа.
 *
 * GET /crm/page-layouts/:objectType/tabs — список вкладок для типа (contact |
 * company | deal). Отдаётся в порядке `position ASC`. Модуль-слаг и право
 * передаются клиенту, фильтр — на фронте (три условия: модуль установлен →
 * `requiredPermission` → устройство).
 *
 * PATCH /crm/page-layouts/:objectType/tabs/:tabKey — обновить одну вкладку:
 * заголовок, иконку, позицию, активность. `moduleSlug` и `requiredPermission` не
 * меняются: они задаются при вставке и определяют семантику вкладки.
 *
 * Создание и удаление вкладок — пока не нужно: вкладки засеяны миграцией, и
 * менять их состав будет админка модулей.
 *
 * Валидация — Zod в хендлере, как у `record-table-layouts`: Fastify schema
 * ждёт JSON Schema, а не Zod-объект.
 */

export async function pageLayoutTabsRoutes(app: FastifyInstance): Promise<void> {
  const service = new PageLayoutTabsService();

  app.get("/:objectType/tabs", async (request, reply) => {
    const { tenant_id } = request;
    const { objectType: rawObjectType } = request.params as { objectType: string };
    const objectType = pageLayoutObjectTypeSchema.parse(rawObjectType);

    // Новый арендатор после регистрации ещё без строк: сид идемпотентен.
    await ensureTenantDefaults(tenant_id);

    const tabs = await service.list(tenant_id, objectType);
    return reply.send({ data: tabs });
  });

  app.patch("/:objectType/tabs/:tabKey", async (request, reply) => {
    const { tenant_id, authUser } = request;
    const { objectType: rawObjectType, tabKey } = request.params as {
      objectType: string;
      tabKey: string;
    };
    const objectType = pageLayoutObjectTypeSchema.parse(rawObjectType);
    const payload = updatePageLayoutTabSchema.parse(request.body);

    const tab = await service.update(tenant_id, objectType, tabKey, payload);

    if (tab === null) {
      return reply.status(404).send({
        error: { code: "TAB_NOT_FOUND", message: "Tab not found or nothing to update" },
      });
    }

    app.log.info(
      { tenant_id, user_id: authUser.id, objectType, tabKey, payload },
      "Updated page layout tab",
    );

    return reply.send({ data: tab });
  });
}
