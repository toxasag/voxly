import { z } from "zod";

// Зеркалит inviteBody и acceptInviteBody в бэкенде: расхождение означало бы,
// что форма принимает данные, которые сервер отклонит.

/** Роли, доступные для назначения. `owner` исключён: он создаётся только при регистрации. */
export const assignableRoleSchema = z.enum(["admin", "manager", "technician", "viewer"]);

export const inviteMemberSchema = z.object({
  name: z.string().trim().min(2, "Укажите имя сотрудника").max(120),
  email: z.string().trim().toLowerCase().email("Некорректный e-mail"),
  role: assignableRoleSchema,
});

export type InviteMemberValues = z.infer<typeof inviteMemberSchema>;

/**
 * Активация по приглашению.
 *
 * Телефон обязателен: по нему приходит код второго фактора при входе, и без
 * него сотрудник не смог бы войти.
 */
export const acceptInviteSchema = z
  .object({
    password: z.string().min(8, "Пароль не короче 8 символов").max(200),
    password_confirm: z.string().min(1, "Повторите пароль"),
    phone: z
      .string()
      .trim()
      .refine((value) => value.replace(/\D/g, "").length >= 10, "Укажите корректный телефон"),
  })
  .refine((data) => data.password === data.password_confirm, {
    message: "Пароли не совпадают",
    path: ["password_confirm"],
  });

export type AcceptInviteValues = z.infer<typeof acceptInviteSchema>;
