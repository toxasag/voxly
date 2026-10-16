import { z } from "zod";

// Зеркалит updateProfileBody и changePasswordBody в
// backend/src/modules/profile/profile.routes.ts: расхождение означало бы, что
// форма принимает данные, которые сервер отклонит.

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя").max(120),
  phone: z
    .string()
    .trim()
    .refine((value) => value.replace(/\D/g, "").length >= 10, "Укажите корректный телефон"),
});

export type UpdateProfileValues = z.infer<typeof updateProfileSchema>;

/**
 * Смена пароля.
 *
 * Совпадение нового с текущим проверяется и здесь, и на сервере: клиентская
 * проверка избавляет от лишнего запроса, серверная — обязательна, потому что
 * форму можно обойти.
 */
export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, "Введите текущий пароль"),
    password: z.string().min(8, "Пароль не короче 8 символов").max(200),
    password_confirm: z.string().min(1, "Повторите новый пароль"),
  })
  .refine((data) => data.password === data.password_confirm, {
    message: "Пароли не совпадают",
    path: ["password_confirm"],
  })
  .refine((data) => data.password !== data.current_password, {
    message: "Новый пароль должен отличаться от текущего",
    path: ["password"],
  });

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;
