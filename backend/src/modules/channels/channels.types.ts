import { z } from "zod";

import { CHANNEL_SLUGS, type ChannelSlug } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Подключения каналов связи.
//
// Один модуль на пять каналов, а не пять почти одинаковых: набор полей у них
// совпадает, различается только способ авторизации, который лежит в
// `credentials JSONB`. Слаг канала приходит параметром маршрута и проверяется по
// закрытому множеству `CHANNEL_SLUGS` — то же значение используется гейтом
// `requireModule`, поэтому канал, не подключённый в маркетплейсе, отдаёт 403.
// ---------------------------------------------------------------------------

export const channelSlugSchema = z.enum(CHANNEL_SLUGS);

/**
 * Состояние соединения.
 *
 * `pending` отделён от `error`: аккаунт создан, но авторизация не завершена — это
 * исходное состояние, а не сбой, и в интерфейсе они выглядят по-разному
 * («Требуется авторизация» против «Ошибка соединения»).
 */
export const channelStatusSchema = z.enum(["pending", "connected", "error", "disabled"]);

export type ChannelStatus = z.infer<typeof channelStatusSchema>;

/**
 * Создание подключения.
 *
 * `credentials` принимается как `Record<string, unknown>`: набор полей зависит от
 * канала (bot token у Telegram, номер у WhatsApp), и единой схемы для всех пяти
 * не существует. Значение никогда не возвращается наружу.
 */
export const createChannelAccountSchema = z.object({
  label: z.string().trim().min(1, "Укажите название подключения").max(120),
  external_id: z.string().trim().min(1, "Укажите идентификатор аккаунта").max(200),
  credentials: z.record(z.unknown()).optional(),
  agent_id: z.string().uuid().nullable().optional(),
});

export type CreateChannelAccountPayload = z.infer<typeof createChannelAccountSchema>;

export const updateChannelAccountSchema = z
  .object({
    label: z.string().trim().min(1, "Укажите название подключения").max(120).optional(),
    status: channelStatusSchema.optional(),
    status_message: z.string().max(500).optional(),
    credentials: z.record(z.unknown()).optional(),
    agent_id: z.string().uuid().nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Нечего обновлять: не передано ни одного поля",
  });

export type UpdateChannelAccountPayload = z.infer<typeof updateChannelAccountSchema>;

/**
 * DTO подключения.
 *
 * `credentials` отсутствует намеренно для внешних каналов (токены не покидают сервер).
 * Для webchat возвращаются безопасные параметры внешнего вида виджета.
 */
export interface ChannelAccountDTO {
  id: string;
  channel: ChannelSlug;
  label: string;
  externalId: string;
  status: ChannelStatus;
  statusMessage: string;
  hasCredentials: boolean;
  credentials?: Record<string, unknown>;
  /** Числовой id пользователя на стороне канала; у Telegram — tgUserId. */
  remoteUserId: string | null;
  lastSyncAt: string | null;
  connectedAt: string | null;
  createdAt: string;
  boundAgentId?: string | null;
  boundAgentName?: string | null;
}

/** Сводка по каналу для шапки страницы. */
export interface ChannelSummaryDTO {
  channel: ChannelSlug;
  /** Сколько аккаунтов оплачено по тарифу (`installed_modules.quantity`). */
  quantity: number;
  /** Сколько фактически подключено. */
  connectedCount: number;
  total: number;
  trialEndsAt: string | null;
  trialActive: boolean;
}
