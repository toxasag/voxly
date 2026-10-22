import { z } from "zod";

// ---------------------------------------------------------------------------
// Подключение пользовательского аккаунта Telegram через MTProto.
// ---------------------------------------------------------------------------

/**
 * Телефон в международном формате.
 *
 * Нормализуется до `+` и цифр: пользователь вводит `+7 905 534-24-03`, а
 * Telegram принимает только `+79055342403`. Приведение здесь, а не в браузере —
 * запрос можно отправить и минуя интерфейс.
 */
export const telegramPhoneSchema = z
  .string()
  .trim()
  .transform((value) => {
    const digits = value.replace(/[^\d]/g, "");
    return digits.length > 0 ? `+${digits}` : "";
  })
  .refine((value) => /^\+\d{10,15}$/.test(value), "Укажите номер в формате +7 900 000-00-00");

export const sendCodeSchema = z.object({
  phone: telegramPhoneSchema,
  /** Название подключения, которое увидит пользователь в списке аккаунтов. */
  name: z.string().trim().min(1, "Укажите название подключения").max(120),
});

export type SendCodePayload = z.infer<typeof sendCodeSchema>;

/**
 * Второй шаг.
 *
 * `tempSessionId` идентифицирует незавершённую авторизацию; `phone`,
 * `phoneCodeHash` и `name` в теле НЕ принимаются — они уже сохранены на первом
 * шаге. Иначе подменой этих полей можно было бы завершить подключение под чужим
 * номером или названием, а `phoneCodeHash` от другой сессии сломал бы вход.
 * Задание перечисляет их в теле; отклонение сделано осознанно, ради этого
 * инварианта.
 */
export const signInSchema = z.object({
  tempSessionId: z.string().uuid("tempSessionId must be a UUID"),
  code: z
    .string()
    .trim()
    .regex(/^\d{5,6}$/, "Код состоит из 5 цифр")
    .optional(),
  /** Облачный пароль. Передаётся только когда Telegram запросил второй фактор. */
  password: z.string().min(1).max(200).optional(),
});

export type SignInPayload = z.infer<typeof signInSchema>;

export interface SendCodeResultDTO {
  tempSessionId: string;
  phoneCodeHash: string;
  /** Код пришёл в приложение Telegram, а не по SMS — влияет на текст подсказки. */
  isCodeViaApp: boolean;
  /** Когда истекает попытка подключения (ISO). */
  expiresAt: string;
}

/**
 * Результат второго шага.
 *
 * Дискриминированное объединение вместо флага `requires2FA` в одном объекте:
 * клиенту нужно либо показать шаг пароля, либо перейти к списку аккаунтов, и
 * необязательные поля в общем типе позволяли бы прочитать `account` там, где его
 * нет.
 */
export type SignInResultDTO =
  | {
      status: "password_required";
      requires2FA: true;
      /** Подсказка к паролю, заданная владельцем аккаунта в Telegram. */
      passwordHint: string | null;
      message: string;
    }
  | {
      status: "connected";
      requires2FA: false;
      accountId: string;
    };

export const qrStartSchema = z.object({
  name: z.string().trim().min(1, "Укажите название подключения").max(120).default("Telegram"),
});

export const qrStatusSchema = z.object({
  tempSessionId: z.string().uuid("tempSessionId must be a UUID"),
});

export const qrPasswordSchema = z.object({
  tempSessionId: z.string().uuid("tempSessionId must be a UUID"),
  password: z.string().min(1, "Введите пароль").max(200),
});

export type QrStartPayload = z.infer<typeof qrStartSchema>;
export type QrStatusPayload = z.infer<typeof qrStatusSchema>;
export type QrPasswordPayload = z.infer<typeof qrPasswordSchema>;

export interface QrStartResultDTO {
  tempSessionId: string;
  qr: string;
  expires: number;
}

export type QrStatusResultDTO =
  | {
      status: "waiting";
      qr?: string;
      expires?: number;
    }
  | {
      status: "requires_2fa";
      passwordHint: string | null;
    }
  | {
      status: "connected";
      accountId: string;
      user: {
        id: string;
        firstName: string;
        lastName: string;
        username: string | null;
        phone: string | null;
      };
    };
