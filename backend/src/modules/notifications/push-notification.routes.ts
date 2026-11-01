// ---------------------------------------------------------------------------
// Маршруты Push-уведомлений и центра нотификаций (Fastify 5).
// ---------------------------------------------------------------------------

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import {
  pushNotificationService,
  notificationEventBus,
  type InAppNotificationDTO,
} from "./push-notification.service.js";
import { notificationQueue } from "./notification.queue.js";

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
  app.get("/notifications/vapid-public-key", async (_request, reply) => {
    return reply.send({
      data: {
        publicKey: pushNotificationService.getVapidPublicKey(),
      },
    });
  });

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

    // Список in-app уведомлений
    authApp.get(
      "/notifications",
      async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as { limit?: string };
        const limit = Math.min(parseInt(query.limit ?? "30", 10) || 30, 100);

        const result = await pushNotificationService.listInAppNotifications(
          request.tenant_id,
          request.authUser.id,
          limit,
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

        const onNotification = (notification: InAppNotificationDTO) => {
          if (!reply.raw.destroyed) {
            reply.raw.write(`event: notification\ndata: ${JSON.stringify(notification)}\n\n`);
          }
        };

        const unsubUser = notificationEventBus.subscribeUser(tenantId, userId, onNotification);
        const unsubTenant = notificationEventBus.subscribeTenant(tenantId, (n) => {
          // Если это broadcast-уведомление без конкретного userId
          onNotification(n);
        });

        const pingInterval = setInterval(() => {
          if (!reply.raw.destroyed) {
            reply.raw.write(`: ping\n\n`);
          }
        }, 15_000);

        request.raw.on("close", () => {
          clearInterval(pingInterval);
          unsubUser();
          unsubTenant();
        });

        return reply;
      },
    );
  });
}
