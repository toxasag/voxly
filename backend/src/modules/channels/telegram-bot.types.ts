import { z } from "zod";
import type { ChannelAccountDTO } from "./channels.types.js";

// ---------------------------------------------------------------------------
// Схемы валидации и типы для интеграции официальных Telegram-ботов
// (существующие боты через токен @BotFather или управляемые через Bot Manager).
// ---------------------------------------------------------------------------

/** Проверка формата токена бота Telegram (например: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_1234567). */
export const telegramBotTokenSchema = z
  .string()
  .trim()
  .min(10, "Токен бота слишком короткий")
  .max(128, "Токен бота слишком длинный")
  .regex(/^\d+:[A-Za-z0-9_-]+$/, "Неверный формат токена Telegram бота (ожидается <id>:<hash>)");

/** Запрос верификации токена без сохранения в БД. */
export const telegramBotVerifySchema = z.object({
  token: telegramBotTokenSchema,
});

export type TelegramBotVerifyInput = z.infer<typeof telegramBotVerifySchema>;

/** Подключение уже существующего бота по токену. */
export const telegramBotConnectSchema = z.object({
  label: z.string().trim().min(1, "Укажите название подключения").max(120),
  token: telegramBotTokenSchema,
  agent_id: z.string().uuid("Некорректный ID AI-агента").nullable().optional(),
});

export type TelegramBotConnectInput = z.infer<typeof telegramBotConnectSchema>;

/** Создание нового бота через Telegram Bot Manager (Managed Bots). */
export const telegramBotCreateManagedSchema = z.object({
  name: z.string().trim().min(1, "Укажите имя бота").max(64),
  username: z
    .string()
    .trim()
    .min(5, "Username должен содержать от 5 до 32 символов")
    .max(32, "Username должен содержать от 5 до 32 символов")
    .regex(/^[a-zA-Z0-9_]+$/, "Username может содержать только латинские буквы, цифры и подчеркивание")
    .refine(
      (val) => val.toLowerCase().endsWith("bot"),
      "Username бота Telegram обязан заканчиваться на 'bot' (например, my_company_bot)",
    ),
  token: telegramBotTokenSchema.optional(),
  agent_id: z.string().uuid("Некорректный ID AI-агента").nullable().optional(),
});

export type TelegramBotCreateManagedInput = z.infer<typeof telegramBotCreateManagedSchema>;

/** Завершение привязки токена для созданного через Bot Manager аккаунта в статусе pending. */
export const telegramBotCompleteManagedSchema = z.object({
  token: telegramBotTokenSchema,
});

export type TelegramBotCompleteManagedInput = z.infer<typeof telegramBotCompleteManagedSchema>;

/** Верифицированные данные о боте из метода getMe Bot API. */
export interface TelegramBotInfoDTO {
  id: number;
  isBot: boolean;
  firstName: string;
  username: string;
  canJoinGroups?: boolean;
  canReadAllGroupMessages?: boolean;
  supportsInlineQueries?: boolean;
}

/** Информация о платформенном Bot Manager. */
export interface TelegramBotManagerInfoDTO {
  configured: boolean;
  managerUsername: string;
  deepLinkTemplate: string;
  features: {
    managedBots: boolean;
    directCreation: boolean;
    tokenRotation: boolean;
  };
}

/** Данные о бизнес-подключении бота (Telegram Business Chatbot / Автоматизация чатов). */
export interface TelegramBusinessConnectionDTO {
  id: string;
  user_id: string;
  username?: string;
  first_name?: string;
  last_name?: string;
  can_reply: boolean;
  is_enabled: boolean;
  date?: number;
  updated_at?: string;
}

/** Результат создания / инициализации управляемого бота. */
export interface TelegramBotCreateManagedResultDTO {
  account: ChannelAccountDTO;
  deepLink: string;
  isPending: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Автоматическая регистрация нового бота (POST /api/bots/create).
// ---------------------------------------------------------------------------

export const botNameSchema = z
  .string()
  .trim()
  .min(1, "Укажите имя бота")
  .max(120, "Имя бота не должно превышать 120 символов");

export const botCreateSchema = z.object({
  name: botNameSchema,
  desired_username: z.string().trim().max(64).optional(),
  agent_id: z.string().uuid("Некорректный ID AI-агента").nullable().optional(),
});

export type BotCreateInput = z.infer<typeof botCreateSchema>;

export const autoActivateBotSchema = z.object({
  name: z.string().trim().max(120).optional(),
  token: z.string().trim().optional(),
  bot_id: z.union([z.number(), z.string()]).optional(),
});

export type AutoActivateBotInput = z.infer<typeof autoActivateBotSchema>;

export interface BotConfigDTO {
  id: string;
  tenantId: string;
  name: string;
  username: string;
  externalId: string;
  token?: string | null;
  status: "connected" | "pending" | "error" | "disabled";
  channelAccountId: string;
  channelAccount?: ChannelAccountDTO;
  agentId?: string | null;
  deepLink?: string;
  createdAt: string;
  updatedAt: string;
}
