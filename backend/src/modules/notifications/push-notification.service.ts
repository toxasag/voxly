// ---------------------------------------------------------------------------
// Push Notifications & Notification Center Service (W3C Web Push / VAPID).
//
// Реализует:
// 1. Управление подписками браузеров и PWA (push_subscriptions) с RLS.
// 2. Отправку фоновых Web Push через web-push (VAPID) с чисткой 410/404.
// 3. Хранение истории уведомлений (inapp_notifications) для выпадающего списка колокольчика.
// 4. Realtime шину событий notificationEventBus для In-App Toaster и SSE.
// ---------------------------------------------------------------------------

import { EventEmitter } from "node:events";
import webpush from "web-push";
import { query, queryOne, runWithTenantContext } from "../../db/client.js";
import { notificationPreferencesService } from "./notification-preferences.service.js";

// VAPID ключи с fallback по умолчанию
const DEFAULT_VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ||
  "BNIMsubaD4xUSSlfH7ZONwaVybX86Ib32AarQvjRS1u3sf-NhBf2j0pc4cBqzV5u6dZZUuOw_zMqdMyZyM1B5Wo";
const DEFAULT_VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY || "g8-kUIx9SVd7ku9-n6A0pwZO-UcCxwN15ps1VbW7__M";
const DEFAULT_VAPID_SUBJECT =
  process.env.VAPID_SUBJECT || "mailto:support@getvoxly.ru";

// Инициализируем VAPID в web-push
try {
  webpush.setVapidDetails(
    DEFAULT_VAPID_SUBJECT,
    DEFAULT_VAPID_PUBLIC_KEY,
    DEFAULT_VAPID_PRIVATE_KEY,
  );
} catch (err) {
  console.warn("[WebPush] Failed to set VAPID details:", err);
}

export interface WebPushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  data?: {
    type?: string;
    id?: string;
    url?: string;
    [key: string]: unknown;
  };
}

export interface PushSubscriptionKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: PushSubscriptionKeys;
  userAgent?: string;
}

export interface PushSubscriptionDTO {
  id: string;
  tenantId: string;
  userId: string;
  endpoint: string;
  createdAt: string;
}

export interface InAppNotificationRow {
  id: string;
  tenant_id: string;
  user_id: string | null;
  category: string;
  entity_type: string;
  entity_id: string;
  title: string;
  description: string;
  data: Record<string, unknown>;
  is_read: boolean;
  read_at: Date | string | null;
  created_at: Date | string;
}

export interface InAppNotificationDTO {
  id: string;
  category: "message" | "lead" | "task" | "repair" | "payment" | "system";
  entity_type: "deal" | "lead" | "chat" | "task" | "repair" | "invoice" | "contact" | "system";
  entity_id: string;
  title: string;
  description: string;
  data?: Record<string, unknown>;
  created_at: string;
  read: boolean;
}

export interface CreateInAppNotificationParams {
  tenantId: string;
  userId?: string | null;
  category: "message" | "lead" | "task" | "repair" | "payment" | "system";
  entityType: "deal" | "lead" | "chat" | "task" | "repair" | "invoice" | "contact" | "system";
  entityId: string;
  title: string;
  description: string;
  data?: Record<string, unknown>;
  url?: string;
}

export interface NotificationReadEvent {
  ids?: string[];
  all?: boolean;
}

class NotificationEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
  }

  emitNotification(tenantId: string, userId: string | null, notification: InAppNotificationDTO): void {
    if (userId) {
      this.emit(`user:${tenantId}:${userId}`, notification);
      return;
    }
    this.emit(`tenant:${tenantId}`, notification);
  }

  emitRead(tenantId: string, userId: string | null, payload: NotificationReadEvent): void {
    if (userId) {
      this.emit(`read:user:${tenantId}:${userId}`, payload);
      return;
    }
    this.emit(`read:tenant:${tenantId}`, payload);
  }

  subscribeTenant(tenantId: string, listener: (notification: InAppNotificationDTO) => void): () => void {
    const channel = `tenant:${tenantId}`;
    this.on(channel, listener);
    return () => {
      this.off(channel, listener);
    };
  }

  subscribeUser(tenantId: string, userId: string, listener: (notification: InAppNotificationDTO) => void): () => void {
    const channel = `user:${tenantId}:${userId}`;
    this.on(channel, listener);
    return () => {
      this.off(channel, listener);
    };
  }

  subscribeRead(
    tenantId: string,
    userId: string,
    listener: (payload: NotificationReadEvent) => void,
  ): () => void {
    const tenantChannel = `read:tenant:${tenantId}`;
    const userChannel = `read:user:${tenantId}:${userId}`;
    this.on(tenantChannel, listener);
    this.on(userChannel, listener);
    return () => {
      this.off(tenantChannel, listener);
      this.off(userChannel, listener);
    };
  }
}

export const notificationEventBus = new NotificationEventBus();

export class PushNotificationService {
  private static instance: PushNotificationService | null = null;

  public static getInstance(): PushNotificationService {
    if (!PushNotificationService.instance) {
      PushNotificationService.instance = new PushNotificationService();
    }
    return PushNotificationService.instance;
  }

  getVapidPublicKey(): string {
    return DEFAULT_VAPID_PUBLIC_KEY;
  }

  /**
   * Сохраняет или обновляет Web Push подписку для пользователя арендатора.
   */
  async subscribe(
    tenantId: string,
    userId: string,
    input: PushSubscriptionInput,
  ): Promise<PushSubscriptionDTO> {
    return runWithTenantContext(tenantId, async () => {
      const row = await queryOne<{ id: string; created_at: Date }>(
        `INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth, user_agent, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (endpoint) DO UPDATE SET
           tenant_id = EXCLUDED.tenant_id,
           user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           updated_at = now()
         RETURNING id, created_at`,
        [
          tenantId,
          userId,
          input.endpoint,
          input.keys.p256dh,
          input.keys.auth,
          input.userAgent ?? null,
        ],
      );

      if (!row) {
        throw new Error("Failed to save push subscription");
      }

      return {
        id: row.id,
        tenantId,
        userId,
        endpoint: input.endpoint,
        createdAt: new Date(row.created_at).toISOString(),
      };
    });
  }

  /**
   * Отписывает устройство по его endpoint.
   */
  async unsubscribe(tenantId: string, endpoint: string): Promise<boolean> {
    return runWithTenantContext(tenantId, async () => {
      const deleted = await query<{ id: string }>(
        `DELETE FROM push_subscriptions WHERE tenant_id = $1 AND endpoint = $2 RETURNING id`,
        [tenantId, endpoint],
      );
      return deleted.length > 0;
    });
  }

  /**
   * Отправляет Web Push уведомление конкретному пользователю на все его устройства.
   */
  async sendNotificationToUser(
    tenantId: string,
    userId: string,
    payload: WebPushPayload,
  ): Promise<number> {
    return runWithTenantContext(tenantId, async () => {
      // Проверяем мастер-выключатель уведомлений пользователя
      const allowed = await notificationPreferencesService.isUserNotificationsEnabled(
        tenantId,
        userId,
        "push",
      );
      if (!allowed) {
        return 0;
      }

      const subscriptions = await query<{
        id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }>(
        `SELECT id, endpoint, p256dh, auth
         FROM push_subscriptions
         WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId],
      );

      if (subscriptions.length === 0) {
        return 0;
      }

      let deliveredCount = 0;
      const jsonPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || "/icon-192.png",
        badge: payload.badge || "/favicon-32.png",
        url: payload.url || "/dashboard",
        data: payload.data || { url: payload.url || "/dashboard" },
      });

      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            jsonPayload,
          );
          deliveredCount++;
        } catch (error: unknown) {
          const err = error as { statusCode?: number };
          // 410 Gone или 404 Not Found — клиент удалил подписку или отозвал разрешение
          if (err.statusCode === 410 || err.statusCode === 404) {
            console.log(`[WebPush] Subscription expired (${err.statusCode}), removing: ${sub.id}`);
            await query(
              `DELETE FROM push_subscriptions WHERE tenant_id = $1 AND id = $2`,
              [tenantId, sub.id],
            );
          } else {
            console.warn(`[WebPush] Error sending to ${sub.id}:`, error);
          }
        }
      }

      return deliveredCount;
    });
  }

  /**
   * Отправляет Web Push уведомление всем активным устройствам арендатора.
   */
  async sendNotificationToTenant(
    tenantId: string,
    payload: WebPushPayload,
    excludeUserId?: string,
  ): Promise<number> {
    return runWithTenantContext(tenantId, async () => {
      // Исключаем подписки пользователей, у которых выключены уведомления
      const subscriptions = await query<{
        id: string;
        endpoint: string;
        p256dh: string;
        auth: string;
      }>(
        `SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth
         FROM push_subscriptions ps
         JOIN users u ON u.id = ps.user_id AND u.tenant_id = ps.tenant_id
         LEFT JOIN user_notification_settings uns ON uns.user_id = ps.user_id AND uns.tenant_id = ps.tenant_id
         WHERE ps.tenant_id = $1
           AND ($2::uuid IS NULL OR ps.user_id <> $2::uuid)
           AND (u.notifications_enabled IS NOT FALSE)
           AND (uns.notifications_enabled IS NULL OR uns.notifications_enabled = true)
           AND (uns.push_enabled IS NULL OR uns.push_enabled = true)`,
        [tenantId, excludeUserId ?? null],
      );

      if (subscriptions.length === 0) {
        return 0;
      }

      let deliveredCount = 0;
      const jsonPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || "/icon-192.png",
        badge: payload.badge || "/favicon-32.png",
        url: payload.url || "/dashboard",
        data: payload.data || { url: payload.url || "/dashboard" },
      });

      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            jsonPayload,
          );
          deliveredCount++;
        } catch (error: unknown) {
          const err = error as { statusCode?: number };
          if (err.statusCode === 410 || err.statusCode === 404) {
            console.log(`[WebPush] Subscription expired (${err.statusCode}), removing: ${sub.id}`);
            await query(
              `DELETE FROM push_subscriptions WHERE tenant_id = $1 AND id = $2`,
              [tenantId, sub.id],
            );
          } else {
            console.warn(`[WebPush] Error sending to ${sub.id}:`, error);
          }
        }
      }

      return deliveredCount;
    });
  }

  /**
   * Создает запись уведомления в inapp_notifications и пушит в SSE шину.
   */
  async createInAppNotification(
    params: CreateInAppNotificationParams,
  ): Promise<InAppNotificationDTO> {
    return runWithTenantContext(params.tenantId, async () => {
      // Если адресовано конкретному пользователю — проверяем его мастер-выключатель
      if (params.userId) {
        const allowed = await notificationPreferencesService.isUserNotificationsEnabled(
          params.tenantId,
          params.userId,
          "inapp",
        );
        if (!allowed) {
          return {
            id: "skipped",
            category: params.category,
            entity_type: params.entityType,
            entity_id: params.entityId,
            title: params.title,
            description: params.description,
            data: params.data,
            created_at: new Date().toISOString(),
            read: true,
          };
        }
      }

      const row = await queryOne<InAppNotificationRow>(
        `INSERT INTO inapp_notifications (
           tenant_id, user_id, category, entity_type, entity_id,
           title, description, data, is_read, created_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, false, now())
         RETURNING id, tenant_id, user_id, category, entity_type, entity_id,
                   title, description, data, is_read, read_at, created_at`,
        [
          params.tenantId,
          params.userId ?? null,
          params.category,
          params.entityType,
          params.entityId,
          params.title,
          params.description,
          JSON.stringify(params.data ?? { url: params.url }),
        ],
      );

      if (!row) {
        throw new Error("Failed to create in-app notification");
      }

      const dto: InAppNotificationDTO = {
        id: row.id,
        category: row.category as InAppNotificationDTO["category"],
        entity_type: row.entity_type as InAppNotificationDTO["entity_type"],
        entity_id: row.entity_id,
        title: row.title,
        description: row.description,
        data: row.data,
        created_at: new Date(row.created_at).toISOString(),
        read: row.is_read,
      };

      // Пушим в шину реального времени для активных вкладок браузера
      notificationEventBus.emitNotification(params.tenantId, params.userId ?? null, dto);

      return dto;
    });
  }

  /**
   * Получает список уведомлений для пользователя и счётчик непрочитанных.
   * По умолчанию возвращает только непрочитанные уведомления (is_read = false).
   */
  async listInAppNotifications(
    tenantId: string,
    userId: string,
    limit: number = 30,
    options?: { includeRead?: boolean },
  ): Promise<{ items: InAppNotificationDTO[]; unreadCount: number }> {
    const includeRead = Boolean(options?.includeRead);
    return runWithTenantContext(tenantId, async () => {
      const result = await query<InAppNotificationRow>(
        `SELECT id, tenant_id, user_id, category, entity_type, entity_id,
                title, description, data, is_read, read_at, created_at
         FROM inapp_notifications
         WHERE tenant_id = $1
           AND (user_id = $2 OR user_id IS NULL)
           ${includeRead ? "" : "AND is_read = false"}
         ORDER BY created_at DESC
         LIMIT $3`,
        [tenantId, userId, limit],
      );

      const unreadRow = await queryOne<{ count: string }>(
        `SELECT count(*)::text as count
         FROM inapp_notifications
         WHERE tenant_id = $1
           AND (user_id = $2 OR user_id IS NULL)
           AND is_read = false`,
        [tenantId, userId],
      );

      const items: InAppNotificationDTO[] = result.map((row) => ({
        id: row.id,
        category: row.category as InAppNotificationDTO["category"],
        entity_type: row.entity_type as InAppNotificationDTO["entity_type"],
        entity_id: row.entity_id,
        title: row.title,
        description: row.description,
        data: row.data,
        created_at: new Date(row.created_at).toISOString(),
        read: row.is_read,
      }));

      const unreadCount = parseInt(unreadRow?.count ?? "0", 10);

      return { items, unreadCount };
    });
  }

  /**
   * Помечает одно уведомление как прочитанное.
   */
  async markNotificationRead(
    tenantId: string,
    userId: string,
    id: string,
  ): Promise<boolean> {
    return runWithTenantContext(tenantId, async () => {
      const updated = await query<{ id: string; user_id: string | null }>(
        `UPDATE inapp_notifications
         SET is_read = true, read_at = now()
         WHERE tenant_id = $1
           AND id = $2
           AND (user_id = $3 OR user_id IS NULL)
           AND is_read = false
         RETURNING id, user_id`,
        [tenantId, id, userId],
      );
      if (updated.length > 0) {
        const isTenantWide = updated.some((r) => r.user_id === null);
        notificationEventBus.emitRead(tenantId, isTenantWide ? null : userId, {
          ids: updated.map((r) => r.id),
        });
      }
      return updated.length > 0;
    });
  }

  /**
   * Помечает все уведомления пользователя как прочитанные.
   */
  async markAllRead(tenantId: string, userId: string): Promise<number> {
    return runWithTenantContext(tenantId, async () => {
      const updated = await query<{ id: string; user_id: string | null }>(
        `UPDATE inapp_notifications
         SET is_read = true, read_at = now()
         WHERE tenant_id = $1
           AND (user_id = $2 OR user_id IS NULL)
           AND is_read = false
         RETURNING id, user_id`,
        [tenantId, userId],
      );
      if (updated.length > 0) {
        const isTenantWide = updated.some((r) => r.user_id === null);
        notificationEventBus.emitRead(tenantId, isTenantWide ? null : userId, {
          all: true,
        });
      }
      return updated.length;
    });
  }

  /**
   * Помечает все непрочитанные уведомления по указанным сущностям как прочитанные
   * (например, когда менеджер открыл чат сделки, ответил клиенту или обновил задачу).
   */
  async markEntityNotificationsRead(
    tenantId: string,
    userId: string | null,
    params: {
      entityTypes: string[];
      entityIds: string[];
      categories?: string[];
    },
  ): Promise<string[]> {
    const entityTypes = Array.from(new Set(params.entityTypes.filter(Boolean)));
    const entityIds = Array.from(new Set(params.entityIds.filter(Boolean)));
    if (entityTypes.length === 0 || entityIds.length === 0) return [];

    const categories = params.categories?.filter(Boolean) ?? [];

    return runWithTenantContext(tenantId, async () => {
      const updated =
        categories.length > 0
          ? await query<{ id: string; user_id: string | null }>(
              `UPDATE inapp_notifications
               SET is_read = true, read_at = now()
               WHERE tenant_id = $1
                 AND ($2::uuid IS NULL OR user_id = $2 OR user_id IS NULL)
                 AND is_read = false
                 AND entity_type = ANY($3::text[])
                 AND entity_id = ANY($4::text[])
                 AND category = ANY($5::text[])
               RETURNING id, user_id`,
              [tenantId, userId, entityTypes, entityIds, categories],
            )
          : await query<{ id: string; user_id: string | null }>(
              `UPDATE inapp_notifications
               SET is_read = true, read_at = now()
               WHERE tenant_id = $1
                 AND ($2::uuid IS NULL OR user_id = $2 OR user_id IS NULL)
                 AND is_read = false
                 AND entity_type = ANY($3::text[])
                 AND entity_id = ANY($4::text[])
               RETURNING id, user_id`,
              [tenantId, userId, entityTypes, entityIds],
            );

      const ids = updated.map((r) => r.id);
      if (ids.length > 0) {
        const isTenantWide = updated.some((r) => r.user_id === null);
        notificationEventBus.emitRead(tenantId, isTenantWide ? null : userId, { ids });
      }
      return ids;
    });
  }

  /**
   * Помечает прочитанными уведомления по контакту и всем его активным сделкам.
   */
  async markContactNotificationsRead(
    tenantId: string,
    userId: string | null,
    contactId: string,
    categories?: string[],
  ): Promise<string[]> {
    if (!contactId) return [];
    return runWithTenantContext(tenantId, async () => {
      const dealRows = await query<{ id: string }>(
        `SELECT id::text AS id
         FROM deals
         WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL`,
        [tenantId, contactId],
      );
      const entityIds = [contactId, ...dealRows.map((d) => d.id)];
      return this.markEntityNotificationsRead(tenantId, userId, {
        entityTypes: ["contact", "deal", "chat", "lead"],
        entityIds,
        categories,
      });
    });
  }
}

export const pushNotificationService = PushNotificationService.getInstance();
