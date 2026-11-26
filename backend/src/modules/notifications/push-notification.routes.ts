// ---------------------------------------------------------------------------
// Маршруты Push-уведомлений и центра нотификаций (Fastify 5).
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { registerSseStream } from "../../infrastructure/sse-registry.js";
import {
  pushNotificationService,
  notificationEventBus,
  type InAppNotificationDTO,
} from "./push-notification.service.js";
import { notificationQueue } from "./notification.queue.js";
import { notificationPreferencesService } from "./notification-preferences.service.js";

const updatePreferencesSchema = z.object({
  notifications_enabled: z.boolean().optional(),
  sound_enabled: z.boolean().optional(),
  inapp_enabled: z.boolean().optional(),
  push_enabled: z.boolean().optional(),
});

const subscribeSchema = z.object({
  endpoint: z.string().url("Некорректный endpoint подписки"),
  keys: z.object({
    p256dh: z.string().min(1, "Отсутствует ключ p256dh"),
    auth: z.string().min(1, "Отсутствует ключ auth"),
  }),
  userAgent: z.string().optional(),
});

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1, "Отсутствует endpoint"),
});

const testNotificationSchema = z.object({
  title: z.string().max(120).optional(),
  body: z.string().max(250).optional(),
  url: z.string().max(500).optional(),
});

const idParamSchema = z.object({
  id: z.string().uuid("Некорректный идентификатор уведомления"),
});

export async function pushNotificationRoutes(app: FastifyInstance): Promise<void> {
  // Публичный эндпоинт VAPID-ключа (для регистрации Service Worker до или после авторизации)
  const sendVapidKey = async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      data: {
        publicKey: pushNotificationService.getVapidPublicKey(),
      },
    });
  };

  app.get("/notifications/vapid-public-key", sendVapidKey);
  app.get("/notifications/vapid-key", sendVapidKey);

  // Авторизованная группа
  await app.register(async (authApp) => {
    authApp.register(authenticatePlugin);

    // Подписка устройства на Push
    authApp.post(
      "/notifications/subscribe",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = subscribeSchema.parse(request.body);
        const sub = await pushNotificationService.subscribe(
          request.tenant_id,
          request.authUser.id,
          body,
        );
        return reply.status(201).send({ data: sub });
      },
    );

    // Отписка устройства
    authApp.post(
      "/notifications/unsubscribe",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = unsubscribeSchema.parse(request.body);
        const ok = await pushNotificationService.unsubscribe(
          request.tenant_id,
          body.endpoint,
        );
        return reply.send({ data: { success: ok } });
      },
    );

    // Список in-app уведомлений (по умолчанию только непрочитанные)
    authApp.get(
      "/notifications",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { limit?: string; include_read?: string };
        const limit = Math.min(parseInt(query.limit ?? "30", 10) || 30, 100);
        const includeRead = query.include_read === "true" || query.include_read === "1";

        const result = await pushNotificationService.listInAppNotifications(
          request.tenant_id,
          request.authUser.id,
          limit,
          { includeRead },
        );

        return reply.send({
          data: result.items,
          meta: {
            unreadCount: result.unreadCount,
          },
        });
      },
    );

    // Пометить все как прочитанные
    authApp.post(
      "/notifications/mark-all-read",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const count = await pushNotificationService.markAllRead(
          request.tenant_id,
          request.authUser.id,
        );
        return reply.send({ data: { success: true, count } });
      },
    );

    // Пометить прочитанными все уведомления по конкретной сущности (сделка, контакт, задача, наряд)
    authApp.post(
      "/notifications/read-by-entity",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = z
          .object({
            entity_type: z.enum(["deal", "lead", "chat", "task", "repair", "invoice", "contact", "system"]),
            entity_id: z.string().min(1).max(120),
            categories: z
              .array(z.enum(["message", "lead", "task", "repair", "payment", "system"]))
              .optional(),
          })
          .parse(request.body ?? {});

        const ids =
          body.entity_type === "contact"
            ? await pushNotificationService.markContactNotificationsRead(
                request.tenant_id,
                request.authUser.id,
                body.entity_id,
                body.categories,
              )
            : await pushNotificationService.markEntityNotificationsRead(
                request.tenant_id,
                request.authUser.id,
                {
                  entityTypes:
                    body.entity_type === "deal" || body.entity_type === "chat" || body.entity_type === "lead"
                      ? ["deal", "chat", "lead"]
                      : [body.entity_type],
                  entityIds: [body.entity_id],
                  categories: body.categories,
                },
              );

        return reply.send({ data: { success: true, count: ids.length, ids } });
      },
    );

    // Пометить одно как прочитанное
    authApp.post(
      "/notifications/:id/read",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = idParamSchema.parse(request.params);
        const ok = await pushNotificationService.markNotificationRead(
          request.tenant_id,
          request.authUser.id,
          id,
        );
        return reply.send({ data: { success: ok } });
      },
    );

    // Отправка тестового уведомления на текущее устройство
    authApp.post(
      "/notifications/test",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = testNotificationSchema.parse(request.body ?? {});
        await notificationQueue.dispatchTestNotification({
          tenantId: request.tenant_id,
          userId: request.authUser.id,
          title: body.title,
          body: body.body,
          url: body.url,
        });

        return reply.send({
          data: {
            success: true,
            message: "Тестовое уведомление поставлено в очередь",
          },
        });
      },
    );

    // Получение настроек пользователя (мастер-выключатель, звук, in-app, push)
    authApp.get(
      "/notifications/preferences",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const prefs = await notificationPreferencesService.getUserPreferences(
          request.tenant_id,
          request.authUser.id,
        );
        return reply.send({ data: prefs, ...prefs });
      },
    );

    authApp.patch(
      "/notifications/preferences",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = updatePreferencesSchema.parse(request.body ?? {});
        const updated = await notificationPreferencesService.updateUserPreferences(
          request.tenant_id,
          request.authUser.id,
          body,
        );
        return reply.send({ data: updated, ...updated });
      },
    );

    authApp.get(
      "/notifications/settings",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const prefs = await notificationPreferencesService.getUserPreferences(
          request.tenant_id,
          request.authUser.id,
        );
        return reply.send({ data: prefs, ...prefs });
      },
    );

    authApp.patch(
      "/notifications/settings",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const body = updatePreferencesSchema.parse(request.body ?? {});
        const updated = await notificationPreferencesService.updateUserPreferences(
          request.tenant_id,
          request.authUser.id,
          body,
        );
        return reply.send({ data: updated, ...updated });
      },
    );

    // Realtime SSE поток уведомлений для активных вкладок браузера (In-App Toaster & Bell badge)
    authApp.get(
      "/notifications/stream",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const tenantId = request.tenant_id;
        const userId = request.authUser.id;

        reply.raw.setHeader("Content-Type", "text/event-stream");
        reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
        reply.raw.setHeader("Connection", "keep-alive");
        reply.raw.setHeader("X-Accel-Buffering", "no");

        reply.raw.write(`: connected\n\n`);

        const onNotification = async (notification: InAppNotificationDTO) => {
          if (reply.raw.destroyed) return;
          try {
            const isEnabled = await notificationPreferencesService.isUserNotificationsEnabled(
              tenantId,
              userId,
              "inapp",
            );
            if (!isEnabled) {
              return; // Пользователь отключил уведомления
            }
            reply.raw.write(`event: notification\ndata: ${JSON.stringify(notification)}\n\n`);
          } catch {
            // Безопасный перехват
          }
        };

        const unsubUser = notificationEventBus.subscribeUser(tenantId, userId, (n) => {
          void onNotification(n);
        });
        const unsubTenant = notificationEventBus.subscribeTenant(tenantId, (n) => {
          void onNotification(n);
        });
        const unsubRead = notificationEventBus.subscribeRead(tenantId, userId, (evt) => {
          if (reply.raw.destroyed) return;
          try {
            reply.raw.write(`event: read\ndata: ${JSON.stringify(evt)}\n\n`);
          } catch {
            // Безопасный перехват
          }
        });

        const unregisterStream = registerSseStream(reply.raw);

        const pingInterval = setInterval(() => {
          if (!reply.raw.destroyed) {
            reply.raw.write(`: ping\n\n`);
          }
        }, 15_000);
        pingInterval.unref?.();

        request.raw.on("close", () => {
          clearInterval(pingInterval);
          unsubUser();
          unsubTenant();
          unsubRead();
          unregisterStream();
        });

        return reply;
      },
    );
  });
}
