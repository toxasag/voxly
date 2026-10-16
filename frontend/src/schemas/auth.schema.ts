import { z } from "zod";

// Сообщения на русском: это единственный источник текста ошибок для форм
// входа и регистрации, и раньше пользователь видел их по-английски.

export const phoneSchema = z.object({
  phone: z
    .string()
    .min(1, "Укажите номер телефона")
    .regex(/^\+7\s\d{3}\s\d{3}\s\d{2}\s\d{2}$/, "Формат: +7 999 999 99 99"),
  channel: z.enum(["telegram", "whatsapp", "rumax", "sms"], {
    errorMap: () => ({ message: "Выберите способ доставки кода" }),
  }),
});

export type PhoneFormValues = z.infer<typeof phoneSchema>;

export const otpSchema = z.object({
  code: z
    .string()
    .length(6, "Код состоит из 6 цифр")
    .regex(/^\d{6}$/, "Только цифры"),
});

export type OtpFormValues = z.infer<typeof otpSchema>;

export const emailLoginSchema = z.object({
  email: z.string().min(1, "Укажите e-mail").email("Некорректный e-mail"),
  password: z.string().min(6, "Пароль не короче 6 символов"),
});

export type EmailLoginValues = z.infer<typeof emailLoginSchema>;

// ---------------------------------------------------------------------------
// Регистрация компании
// ---------------------------------------------------------------------------

/**
 * Поддомен компании: {slug}.getvoxly.ru.
 *
 * Правила совпадают с CHECK-ограничением `tenants_slug_format` в схеме БД и с
 * `SLUG_PATTERN` на бэкенде. Дублирование намеренное: значение попадает в имя
 * хоста, поэтому проверяется на каждом слое, а не только в UI.
 */
export const slugSchema = z
  .string()
  .min(3, "Минимум 3 символа")
  .max(63, "Максимум 63 символа")
  .regex(/^[a-z0-9-]+$/, "Только латиница в нижнем регистре, цифры и дефис")
  .regex(/^[a-z0-9]/, "Должен начинаться с буквы или цифры")
  .regex(/[a-z0-9]$/, "Не может заканчиваться дефисом");

/** Канал доставки кода. `max` заявлен в UI; транспорт ещё не подключён. */
export const authChannelSchema = z.enum(["telegram", "max"], {
  errorMap: () => ({ message: "Выберите Telegram или MAX" }),
});

export const phoneField = z
  .string()
  .min(1, "Укажите номер телефона")
  .regex(/^\+7\s\d{3}\s\d{3}\s\d{2}\s\d{2}$/, "Формат: +7 999 999 99 99");

/**
 * Регистрация: только поддомен, e-mail, пароль (дважды), телефон и канал.
 * Название компании и имя владельца сознательно убраны — они выводятся из slug
 * и e-mail, а меняются позже в настройках арендатора.
 */
export const registerSchema = z
  .object({
    slug: slugSchema,
    email: z.string().min(1, "Укажите e-mail").email("Некорректный e-mail"),
    password: z.string().min(8, "Пароль не короче 8 символов").max(200),
    password_confirm: z.string().min(1, "Повторите пароль"),
    phone: phoneField,
    channel: authChannelSchema,
    code: z.string().regex(/^\d{6}$/, "Код состоит из 6 цифр"),
  })
  .refine((data) => data.password === data.password_confirm, {
    message: "Пароли не совпадают",
    path: ["password_confirm"],
  });

export type RegisterFormValues = z.infer<typeof registerSchema>;

/**
 * Поля регистрации без кода — для шага «Получить код», когда кода ещё нет и
 * полная схема не прошла бы валидацию.
 */
export const registerDetailsSchema = registerSchema.innerType().omit({ code: true });

export type RegisterDetailsValues = z.infer<typeof registerDetailsSchema>;

/** Вход: e-mail, пароль и код из бота. */
export const loginWithCodeSchema = z.object({
  email: z.string().min(1, "Укажите e-mail").email("Некорректный e-mail"),
  password: z.string().min(1, "Введите пароль"),
  channel: authChannelSchema,
  code: z.string().regex(/^\d{6}$/, "Код состоит из 6 цифр"),
});

export type LoginWithCodeValues = z.infer<typeof loginWithCodeSchema>;

// ---------------------------------------------------------------------------
// Восстановление пароля
// ---------------------------------------------------------------------------

/** Запрос ссылки восстановления. */
export const forgotPasswordSchema = z.object({
  email: z.string().min(1, "Укажите e-mail").email("Некорректный e-mail"),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

/**
 * Новый пароль по ссылке из письма.
 *
 * Минимум 8 символов — то же правило, что в `registerSchema` и в
 * `resetPasswordBody` на бэкенде: расхождение означало бы, что форма принимает
 * пароль, который сервер отклонит.
 */
export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Пароль не короче 8 символов").max(200),
    password_confirm: z.string().min(1, "Повторите пароль"),
  })
  .refine((data) => data.password === data.password_confirm, {
    message: "Пароли не совпадают",
    path: ["password_confirm"],
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
