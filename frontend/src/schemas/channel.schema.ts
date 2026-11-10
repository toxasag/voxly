import { z } from "zod";

// Зеркалит backend/src/modules/channels/channels.types.ts: расхождение означало
// бы, что форма принимает данные, которые сервер отклонит.

export const channelStatusSchema = z.enum(["pending", "connected", "error", "disabled"]);

export type ChannelStatus = z.infer<typeof channelStatusSchema>;

/**
 * Подключение аккаунта канала.
 *
 * `credentials` в форме не участвует: токены задаются на шаге авторизации,
 * который у каждого канала свой (M7.5.3). Здесь заводится сама запись —
 * название и идентификатор аккаунта.
 */
export const createChannelAccountSchema = z.object({
  label: z.string().trim().min(1, "Укажите название подключения").max(120),
  external_id: z.string().trim().min(1, "Укажите идентификатор аккаунта").max(200),
  credentials: z.record(z.unknown()).optional(),
  agent_id: z.string().uuid().nullable().optional(),
});

export type CreateChannelAccountValues = z.infer<typeof createChannelAccountSchema>;

export const updateChannelAccountSchema = z
  .object({
    label: z.string().trim().min(1, "Укажите название подключения").max(120).optional(),
    status: channelStatusSchema.optional(),
    status_message: z.string().max(500).optional(),
    credentials: z.record(z.unknown()).optional(),
    agent_id: z.string().uuid().nullable().optional(),
    is_enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Не указаны поля для обновления",
  });

export type UpdateChannelAccountValues = z.infer<typeof updateChannelAccountSchema>;

/**
 * Клонирование существующего виджета под новый сайт.
 * Домен очищается и валидируется, название по умолчанию формируется с суффиксом (Копия).
 */
export const cloneChannelAccountSchema = z.object({
  label: z.string().trim().min(1, "Укажите название виджета").max(120),
  external_id: z
    .string()
    .trim()
    .min(1, "Укажите адрес или домен сайта")
    .max(200)
    .refine((val) => {
      const cleaned = val
        .replace(/^[a-z]+:\/\//i, "")
        .replace(/[/?#].*$/, "")
        .trim();
      return cleaned.length > 0;
    }, "Укажите корректный адрес сайта"),
  agent_id: z.string().uuid("Некорректный ID агента").nullable().optional(),
});

export type CloneChannelAccountValues = z.infer<typeof cloneChannelAccountSchema>;

// ---------------------------------------------------------------------------
// Подключение аккаунта Telegram через MTProto.
//
// Зеркалит backend/src/modules/channels/telegram-auth.types.ts.
// ---------------------------------------------------------------------------

/** Шаг 1: название подключения и номер телефона. */
export const telegramSendCodeSchema = z.object({
  name: z.string().trim().min(1, "Укажите название подключения").max(120),
  phone: z
    .string()
    .trim()
    // Приводим к `+` и цифрам так же, как сервер: пользователь вводит номер с
    // пробелами и дефисами, Telegram принимает только +79055342403.
    .refine(
      (value) => /^\+?\d{10,15}$/.test(value.replace(/[^\d+]/g, "")),
      "Укажите номер в формате +7 900 000-00-00",
    ),
});

export type TelegramSendCodeValues = z.infer<typeof telegramSendCodeSchema>;

/** Шаг 2: код из приложения Telegram. Пять цифр, но допускаем шесть на будущее. */
export const telegramCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{5,6}$/, "Код состоит из 5 цифр"),
});

export type TelegramCodeValues = z.infer<typeof telegramCodeSchema>;

/** Шаг 3: облачный пароль, если у аккаунта включена двухэтапная проверка. */
export const telegramPasswordSchema = z.object({
  password: z.string().min(1, "Введите облачный пароль").max(200),
});

export type TelegramPasswordValues = z.infer<typeof telegramPasswordSchema>;
