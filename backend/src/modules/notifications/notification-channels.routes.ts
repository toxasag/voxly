// ---------------------------------------------------------------------------
// Эндпоинты настроек каналов уведомлений о лидах: /api/v1/settings/notifications
// ---------------------------------------------------------------------------

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { NotificationChannelsService } from "./notification-channels.service.js";
import { notificationPreferencesService } from "./notification-preferences.service.js";

const updatePreferencesBody = z.object({
  notifications_enabled: z.boolean().optional(),
  sound_enabled: z.boolean().optional(),
  inapp_enabled: z.boolean().optional(),
  push_enabled: z.boolean().optional(),
});

const channelTypeSchema = z.enum(["email", "telegram", "whatsapp", "bitrix24"]);

const createChannelBody = z
  .object({
    channel_type: channelTypeSchema,
    destination: z.string().optional(),
    target_value: z.string().optional(),
    extra_meta: z.record(z.unknown()).optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (data) =>
      Boolean(
        (data.destination && data.destination.trim()) ||
          (data.target_value && data.target_value.trim()),
      ),
    {
      message: "Укажите destination или target_value",
      path: ["destination"],
    },
  );

const updateChannelBody = z.object({
  destination: z.string().optional(),
  target_value: z.string().optional(),
  extra_meta: z.record(z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

const testChannelBody = z.object({
  id: z.string().uuid().optional(),
  channel_type: channelTypeSchema.optional(),
  destination: z.string().optional(),
  target_value: z.string().optional(),
});

const channelParams = z.object({
  id: z.string().uuid("id must be a UUID"),
});

export default async function notificationChannelsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);
  const service = new NotificationChannelsService();
  const admin = app.requirePermission("tenant:admin");

  app.get("/", { onRequest: admin }, async (request, reply) => {
    const channels = await service.listChannels(request.tenant_id);
    return reply.send({ data: channels, channels });
  });

  app.post("/", { onRequest: admin }, async (request, reply) => {
    const body = createChannelBody.parse(request.body);
    const channel = await service.createChannel(request.tenant_id, {
      channel_type: body.channel_type,
      destination: body.destination ?? body.target_value,
      extra_meta: body.extra_meta,
      is_active: body.is_active,
    });
    return reply.status(201).send({ data: channel, channel });
  });

  app.delete("/:id", { onRequest: admin }, async (request, reply) => {
    const { id } = channelParams.parse(request.params);
    const deleted = await service.deleteChannel(request.tenant_id, id);
    return reply.send({ data: { ok: deleted }, ok: deleted });
  });

  app.put("/:id", { onRequest: admin }, async (request, reply) => {
    const { id } = channelParams.parse(request.params);
    const body = updateChannelBody.parse(request.body);
    const channel = await service.updateChannel(request.tenant_id, id, body);
    return reply.send({ data: channel, channel });
  });

  app.patch("/:id", { onRequest: admin }, async (request, reply) => {
    const { id } = channelParams.parse(request.params);
    const body = updateChannelBody.parse(request.body);
    const channel = await service.updateChannel(request.tenant_id, id, body);
    return reply.send({ data: channel, channel });
  });

  app.post("/test", { onRequest: admin }, async (request, reply) => {
    const body = testChannelBody.parse(request.body ?? {});
    const result = await service.sendTestNotification(request.tenant_id, {
      id: body.id,
      channel_type: body.channel_type,
      destination: body.destination ?? body.target_value,
    });
    return reply.send({ data: result, ok: result.delivered, ...result });
  });

  app.post("/:id/test", { onRequest: admin }, async (request, reply) => {
    const { id } = channelParams.parse(request.params);
    const result = await service.sendTestNotification(request.tenant_id, { id });
    return reply.send({ data: result, ok: result.delivered, ...result });
  });

  app.get("/telegram/bind-link", { onRequest: admin }, async (request, reply) => {
    const linkInfo = service.getTelegramBindLink(request.tenant_id);
    return reply.send({ data: linkInfo, ok: true, ...linkInfo });
  });

  // Персональные настройки пользователя (мастер-выключатель, звук, in-app, push)
  app.get("/preferences", async (request, reply) => {
    const prefs = await notificationPreferencesService.getUserPreferences(
      request.tenant_id,
      request.authUser.id,
    );
    return reply.send({ data: prefs, ...prefs });
  });

  app.patch("/preferences", async (request, reply) => {
    const body = updatePreferencesBody.parse(request.body ?? {});
    const updated = await notificationPreferencesService.updateUserPreferences(
      request.tenant_id,
      request.authUser.id,
      body,
    );
    return reply.send({ data: updated, ...updated });
  });

  app.put("/preferences", async (request, reply) => {
    const body = updatePreferencesBody.parse(request.body ?? {});
    const updated = await notificationPreferencesService.updateUserPreferences(
      request.tenant_id,
      request.authUser.id,
      body,
    );
    return reply.send({ data: updated, ...updated });
  });
}
