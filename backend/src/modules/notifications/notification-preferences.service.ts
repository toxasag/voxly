// ---------------------------------------------------------------------------
// Сервис персональных настроек уведомлений пользователя (Notification Preferences)
// Мастер-выключатель и гранулярные каналы (звук, in-app, web push).
// ---------------------------------------------------------------------------

import { query, queryOne, runWithTenantContext } from "../../db/client.js";

export interface UserNotificationPreferencesDTO {
  notifications_enabled: boolean;
  sound_enabled: boolean;
  inapp_enabled: boolean;
  push_enabled: boolean;
  updated_at?: string;
}

export interface UpdateUserNotificationPreferencesPayload {
  notifications_enabled?: boolean;
  sound_enabled?: boolean;
  inapp_enabled?: boolean;
  push_enabled?: boolean;
}

interface UserNotificationSettingsRow {
  id: string;
  tenant_id: string;
  user_id: string;
  notifications_enabled: boolean;
  sound_enabled: boolean;
  inapp_enabled: boolean;
  push_enabled: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export class NotificationPreferencesService {
  /**
   * Получает персональные настройки уведомлений пользователя.
   * Если пользователь ещё не менял настройки, возвращаются значения по умолчанию (все включены = true).
   */
  async getUserPreferences(
    tenantId: string,
    userId: string,
  ): Promise<UserNotificationPreferencesDTO> {
    return runWithTenantContext(tenantId, async () => {
      // 1. Проверяем наличие детальной записи в user_notification_settings
      const row = await queryOne<UserNotificationSettingsRow>(
        `SELECT id, tenant_id, user_id, notifications_enabled, sound_enabled,
                inapp_enabled, push_enabled, updated_at
         FROM user_notification_settings
         WHERE tenant_id = $1 AND user_id = $2`,
        [tenantId, userId],
      );

      if (row) {
        return {
          notifications_enabled: row.notifications_enabled,
          sound_enabled: row.sound_enabled,
          inapp_enabled: row.inapp_enabled,
          push_enabled: row.push_enabled,
          updated_at:
            row.updated_at instanceof Date
              ? row.updated_at.toISOString()
              : String(row.updated_at),
        };
      }

      // 2. Если отдельной строки нет, проверяем флаг в таблице users
      const userRow = await queryOne<{ notifications_enabled: boolean | null }>(
        `SELECT notifications_enabled FROM users WHERE id = $1 AND tenant_id = $2`,
        [userId, tenantId],
      );

      const isEnabled = userRow?.notifications_enabled !== false;

      return {
        notifications_enabled: isEnabled,
        sound_enabled: isEnabled,
        inapp_enabled: isEnabled,
        push_enabled: isEnabled,
      };
    });
  }

  /**
   * Обновляет настройки пользователя (UPSERT в user_notification_settings + синхронизация с users).
   */
  async updateUserPreferences(
    tenantId: string,
    userId: string,
    payload: UpdateUserNotificationPreferencesPayload,
  ): Promise<UserNotificationPreferencesDTO> {
    return runWithTenantContext(tenantId, async () => {
      const current = await this.getUserPreferences(tenantId, userId);

      const nextNotificationsEnabled =
        payload.notifications_enabled !== undefined
          ? payload.notifications_enabled
          : current.notifications_enabled;

      const nextSoundEnabled =
        payload.sound_enabled !== undefined
          ? payload.sound_enabled
          : current.sound_enabled;

      const nextInAppEnabled =
        payload.inapp_enabled !== undefined
          ? payload.inapp_enabled
          : current.inapp_enabled;

      const nextPushEnabled =
        payload.push_enabled !== undefined
          ? payload.push_enabled
          : current.push_enabled;

      const row = await queryOne<UserNotificationSettingsRow>(
        `INSERT INTO user_notification_settings (
           tenant_id, user_id, notifications_enabled, sound_enabled,
           inapp_enabled, push_enabled, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (tenant_id, user_id)
         DO UPDATE SET
           notifications_enabled = EXCLUDED.notifications_enabled,
           sound_enabled = EXCLUDED.sound_enabled,
           inapp_enabled = EXCLUDED.inapp_enabled,
           push_enabled = EXCLUDED.push_enabled,
           updated_at = now()
         RETURNING id, tenant_id, user_id, notifications_enabled, sound_enabled,
                   inapp_enabled, push_enabled, updated_at`,
        [
          tenantId,
          userId,
          nextNotificationsEnabled,
          nextSoundEnabled,
          nextInAppEnabled,
          nextPushEnabled,
        ],
      );

      // Синхронизируем прямой флаг в таблице users
      await query(
        `UPDATE users
         SET notifications_enabled = $3, updated_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [userId, tenantId, nextNotificationsEnabled],
      );

      return {
        notifications_enabled: row ? row.notifications_enabled : nextNotificationsEnabled,
        sound_enabled: row ? row.sound_enabled : nextSoundEnabled,
        inapp_enabled: row ? row.inapp_enabled : nextInAppEnabled,
        push_enabled: row ? row.push_enabled : nextPushEnabled,
        updated_at:
          row?.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : row?.updated_at
              ? String(row.updated_at)
              : new Date().toISOString(),
      };
    });
  }

  /**
   * Быстрая проверка: разрешены ли уведомления для конкретного пользователя.
   */
  async isUserNotificationsEnabled(
    tenantId: string,
    userId: string,
    channel?: "push" | "inapp" | "sound",
  ): Promise<boolean> {
    return runWithTenantContext(tenantId, async () => {
      const prefs = await this.getUserPreferences(tenantId, userId);
      if (!prefs.notifications_enabled) {
        return false;
      }
      if (channel === "push") return prefs.push_enabled;
      if (channel === "inapp") return prefs.inapp_enabled;
      if (channel === "sound") return prefs.sound_enabled;
      return true;
    });
  }
}

export const notificationPreferencesService = new NotificationPreferencesService();
