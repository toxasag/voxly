import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { authenticatePlugin } from "../../plugins/authenticate.js";
import { ChannelsService } from "./channels.service.js";
import {
  channelSlugSchema,
  createChannelAccountSchema,
  updateChannelAccountSchema,
} from "./channels.types.js";

// ---------------------------------------------------------------------------
// Каналы связи, смонтированы в app.ts под /api/v1/channels.
//
// Одна группа на пять каналов: слаг приходит параметром `:channel` и проверяется
// Zod-схемой по закрытому множеству. Гейт `requireModuleFromParam` закрывает
// доступ к каналу, не подключённому в маркетплейсе — 403 MODULE_NOT_INSTALLED,
// тот же код, что у остальных модулей.
//
// Права: чтение под `tenant:admin`, как и сам маркетплейс. Подключение канала —
// тарифное и техническое действие (токены ботов, авторизация аккаунтов), а не
// рядовая работа с клиентами, поэтому отдельных `channels:read/write` не
// вводится: они дублировали бы `tenant:admin` без практической разницы.
// ---------------------------------------------------------------------------

const channelParams = z.object({ channel: channelSlugSchema });

const accountParams = z.object({
  channel: channelSlugSchema,
  id: z.string().uuid("id must be a UUID"),
});

export default async function channelsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new ChannelsService();

  // Порядок важен: сначала право, затем установка модуля. Иначе рядовой
  // сотрудник по URL отключённого канала узнавал бы состав модулей арендатора.
  const guards = [app.requirePermission("tenant:admin"), app.requireModuleFromParam("channel")];

  app.get("/:channel/accounts", { onRequest: guards }, async (request, reply) => {
    const { channel } = channelParams.parse(request.params);

    const [items, summary] = await Promise.all([
      service.list(request.tenant_id, channel),
      service.summary(request.tenant_id, channel),
    ]);

    return reply.send({ data: items, meta: { total: items.length, summary } });
  });

  app.post("/:channel/accounts", { onRequest: guards }, async (request, reply) => {
    const { channel } = channelParams.parse(request.params);
    const body = createChannelAccountSchema.parse(request.body);

    const account = await service.create(request.tenant_id, channel, body);

    return reply.status(201).send({ data: account });
  });

  app.patch("/:channel/accounts/:id", { onRequest: guards }, async (request, reply) => {
    const { channel, id } = accountParams.parse(request.params);
    const body = updateChannelAccountSchema.parse(request.body);

    const account = await service.update(request.tenant_id, channel, id, body);

    return reply.send({ data: account });
  });

  app.delete("/:channel/accounts/:id", { onRequest: guards }, async (request, reply) => {
    const { channel, id } = accountParams.parse(request.params);

    await service.remove(request.tenant_id, channel, id);

    return reply.status(204).send();
  });
}
