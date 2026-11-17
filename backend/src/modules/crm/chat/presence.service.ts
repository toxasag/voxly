import { query, queryOne } from "../../../db/client.js";
import { getRedisClient, isRedisAvailable } from "../../../infrastructure/redis.js";
import { chatEventBus } from "./chat-events.js";

export interface PresenceDTO {
  entityType: "deal" | "contact" | "user";
  entityId: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  statusText?: string;
}

export class PresenceService {
  private static readonly REDIS_USER_TTL_SECONDS = 90;
  private static readonly REDIS_CONTACT_TTL_SECONDS = 180;
  private static readonly ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 минуты активности = онлайн

  /**
   * Фиксация сердцебиения (heartbeat) оператора/менеджера CRM.
   */
  async recordUserHeartbeat(tenantId: string, userId: string): Promise<void> {
    const now = new Date();
    const iso = now.toISOString();

    if (isRedisAvailable()) {
      const redis = getRedisClient();
      if (redis) {
        await redis.set(
          `presence:user:${tenantId}:${userId}`,
          iso,
          "EX",
          PresenceService.REDIS_USER_TTL_SECONDS,
        ).catch(() => {});
      }
    }

    // Сохранение в Postgres
    await query(
      `UPDATE users
       SET last_seen_at = $3, is_online = true
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, userId, iso],
    ).catch(() => {});

    chatEventBus.emitChatEvent({
      type: "presence_updated",
      tenantId,
      dealId: "",
      data: {
        entityType: "user",
        entityId: userId,
        isOnline: true,
        lastSeenAt: iso,
      },
      timestamp: iso,
    });
  }

  /**
   * Фиксация активности контакта (клиента) — входящее сообщение, открытие чата, звонок.
   */
  async recordContactActivity(tenantId: string, contactId: string, dealId?: string): Promise<void> {
    const now = new Date();
    const iso = now.toISOString();

    if (isRedisAvailable()) {
      const redis = getRedisClient();
      if (redis) {
        await redis.set(
          `presence:contact:${tenantId}:${contactId}`,
          iso,
          "EX",
          PresenceService.REDIS_CONTACT_TTL_SECONDS,
        ).catch(() => {});
      }
    }

    await query(
      `UPDATE contacts
       SET last_seen_at = $3, is_online = true
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, contactId, iso],
    ).catch(() => {});

    chatEventBus.emitChatEvent({
      type: "presence_updated",
      tenantId,
      dealId: dealId ?? "",
      data: {
        entityType: "contact",
        entityId: contactId,
        isOnline: true,
        lastSeenAt: iso,
      },
      timestamp: iso,
    });
  }

  /**
   * Получение статуса присутствия для сущности (сделки, контакта или пользователя).
   */
  async getPresence(
    tenantId: string,
    entityType: "deal" | "contact" | "user",
    entityId: string,
  ): Promise<PresenceDTO> {
    const nowMs = Date.now();

    if (entityType === "deal") {
      // Для сделки определяем присутствие клиента (контакта сделки)
      const dealRow = await queryOne<{ contact_id: string | null }>(
        `SELECT contact_id FROM deals WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, entityId],
      );

      const contactId = dealRow?.contact_id;
      if (!contactId) {
        // Контакта нет — проверяем последнее сообщение по сделке
        const lastMsg = await queryOne<{ created_at: Date | string }>(
          `SELECT created_at FROM deal_messages
           WHERE tenant_id = $1 AND deal_id = $2
           ORDER BY created_at DESC LIMIT 1`,
          [tenantId, entityId],
        );
        const lastSeen = lastMsg?.created_at ? new Date(lastMsg.created_at).toISOString() : null;
        return {
          entityType: "deal",
          entityId,
          isOnline: false,
          lastSeenAt: lastSeen,
        };
      }

      return this.resolveContactPresence(tenantId, contactId, entityId);
    }

    if (entityType === "contact") {
      return this.resolveContactPresence(tenantId, entityId);
    }

    // Для пользователя (оператора CRM)
    let isOnline = false;
    let lastSeenAt: string | null = null;

    if (isRedisAvailable()) {
      const redis = getRedisClient();
      if (redis) {
        const val = await redis.get(`presence:user:${tenantId}:${entityId}`).catch(() => null);
        if (val) {
          isOnline = true;
          lastSeenAt = val;
        }
      }
    }

    if (!isOnline) {
      const userRow = await queryOne<{ last_seen_at: Date | string | null }>(
        `SELECT last_seen_at FROM users WHERE tenant_id = $1 AND id = $2`,
        [tenantId, entityId],
      );
      if (userRow?.last_seen_at) {
        const lastDate = new Date(userRow.last_seen_at);
        lastSeenAt = lastDate.toISOString();
        if (nowMs - lastDate.getTime() < PresenceService.ONLINE_THRESHOLD_MS) {
          isOnline = true;
        }
      }
    }

    return {
      entityType: "user",
      entityId,
      isOnline,
      lastSeenAt,
    };
  }

  private async resolveContactPresence(
    tenantId: string,
    contactId: string,
    dealIdForContext?: string,
  ): Promise<PresenceDTO> {
    const nowMs = Date.now();
    let isOnline = false;
    let lastSeenAt: string | null = null;

    // 1. Проверяем Redis ключ активности
    if (isRedisAvailable()) {
      const redis = getRedisClient();
      if (redis) {
        const val = await redis.get(`presence:contact:${tenantId}:${contactId}`).catch(() => null);
        if (val) {
          isOnline = true;
          lastSeenAt = val;
        }
      }
    }

    // 2. Если в Redis нет активного ключа — проверяем DB contacts.last_seen_at
    const contactRow = await queryOne<{ last_seen_at: Date | string | null }>(
      `SELECT last_seen_at FROM contacts WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, contactId],
    );

    if (contactRow?.last_seen_at) {
      const contactDate = new Date(contactRow.last_seen_at);
      const contactIso = contactDate.toISOString();
      if (!lastSeenAt || contactDate.getTime() > new Date(lastSeenAt).getTime()) {
        lastSeenAt = contactIso;
      }
      if (nowMs - contactDate.getTime() < PresenceService.ONLINE_THRESHOLD_MS) {
        isOnline = true;
      }
    }

    // 3. Дополнительная эвристика: последнее входящее сообщение от клиента по всем сделкам контакта
    const lastInbound = await queryOne<{ created_at: Date | string }>(
      `SELECT m.created_at
       FROM deal_messages m
       JOIN deals d ON d.id = m.deal_id AND d.tenant_id = m.tenant_id
       WHERE m.tenant_id = $1 AND d.contact_id = $2
         AND (m.direction = 'inbound' OR m.source = 'client')
       ORDER BY m.created_at DESC LIMIT 1`,
      [tenantId, contactId],
    );

    if (lastInbound?.created_at) {
      const inboundDate = new Date(lastInbound.created_at);
      const inboundIso = inboundDate.toISOString();
      if (!lastSeenAt || inboundDate.getTime() > new Date(lastSeenAt).getTime()) {
        lastSeenAt = inboundIso;
      }
      // Если клиент написал в течение последних 3 минут — он точно онлайн
      if (nowMs - inboundDate.getTime() < 3 * 60 * 1000) {
        isOnline = true;
      }
    }

    return {
      entityType: dealIdForContext ? "deal" : "contact",
      entityId: dealIdForContext ?? contactId,
      isOnline,
      lastSeenAt,
    };
  }
}

export const presenceService = new PresenceService();
