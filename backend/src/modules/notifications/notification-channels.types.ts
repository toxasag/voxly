// ---------------------------------------------------------------------------
// Типы и DTO каналов доставки уведомлений о лидах / заявках.
// ---------------------------------------------------------------------------

export type NotificationChannelType = "email" | "telegram" | "whatsapp" | "bitrix24";

export interface NotificationChannelRow {
  id: string;
  tenant_id: string;
  channel_type: NotificationChannelType;
  destination: string;
  extra_meta: Record<string, unknown>;
  is_active: boolean;
  is_verified: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface NotificationChannelDTO {
  id: string;
  tenant_id: string;
  channel_type: NotificationChannelType;
  destination: string;
  target_value: string; // Синоним для обратной совместимости контрактов
  extra_meta: Record<string, unknown>;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  updated_at?: string;
}

export interface CreateNotificationChannelPayload {
  channel_type: NotificationChannelType;
  destination?: string;
  target_value?: string;
  extra_meta?: Record<string, unknown>;
  is_active?: boolean;
}
