import { z } from "zod";

// ---------------------------------------------------------------------------
// Contact schemas.
//
// Держатся в шаге с backend/src/modules/crm/contacts/contacts.types.ts — сервер
// перевалидирует каждый payload, и более слабая клиентская схема даёт 400,
// который пользователь прочитать не может.
//
// Модель телефонов и соцсетей взята у Twenty (phones.composite-type.ts):
// список номеров, первый — основной; у каждого номер, ISO-код страны и код
// звонка. Обязательно только имя — на Person у Twenty nullable всё остальное.
// ---------------------------------------------------------------------------

export const contactChannelSchema = z.enum(["telegram", "whatsapp", "rumax", "phone", "email"]);

export const socialKindSchema = z.enum([
  "telegram",
  "whatsapp",
  "max",
  "viber",
  "vk",
  "instagram",
  "other",
]);

/** Optional UUID field: empty string means "not set", matching the backend. */
const optionalUuid = z.union([z.string().uuid("Выберите компанию из списка"), z.literal("")]).optional();

/**
 * Номер в E.164 без разделителей.
 *
 * Разделители снимаются трансформацией до проверки: в поле ввода номер стоит с
 * пробелами и скобками (их расставляет форматтер), а в БД он должен лежать
 * нормализованным — иначе поиск контакта по входящему звонку не найдёт «+7 916…»,
 * записанный как «8 (916)…».
 */
const phoneNumberSchema = z
  .string()
  .transform((value) => value.replace(/[\s()\-.]/g, ""))
  .pipe(
    z
      .string()
      .min(5, "Номер слишком короткий")
      .max(20, "Номер слишком длинный")
      .regex(/^\+?\d+$/, "Только цифры и знак «+» в начале"),
  );

export const contactPhoneSchema = z.object({
  number: phoneNumberSchema,
  /** ISO-2 код страны: 'RU'. Отдельно от кода звонка — по нему рисуется флаг. */
  country_code: z.string().max(2).optional().or(z.literal("")),
  /** Префикс набора: '+7'. */
  calling_code: z
    .string()
    .max(6)
    .regex(/^(\+\d+)?$/, "Код страны выглядит как +7")
    .optional()
    .or(z.literal("")),
});

export const contactSocialSchema = z.object({
  kind: socialKindSchema,
  value: z.string().min(1, "Укажите значение").max(200),
});

export const createContactSchema = z.object({
  first_name: z.string().min(1, "Имя обязательно").max(100),
  last_name: z.string().max(100).optional().or(z.literal("")),
  middle_name: z.string().max(100).optional().or(z.literal("")),
  phones: z.array(contactPhoneSchema).max(10, "Слишком много номеров").optional(),
  email: z.string().email("Некорректный e-mail").optional().or(z.literal("")),
  socials: z.array(contactSocialSchema).max(20, "Слишком много профилей").optional(),
  job_title: z.string().max(150).optional().or(z.literal("")),
  company_name: z.string().max(200).optional().or(z.literal("")),
  company_id: optionalUuid,
  channel: contactChannelSchema,
  /** Twenty: person.linkedinLink. Пустая строка разрешена — поле необязательное. */
  linkedin_link: z.string().url("Некорректная ссылка").max(300).optional().or(z.literal("")),
  notes: z.string().max(4000).optional().or(z.literal("")),
  custom_fields: z.record(z.string()).optional(),
});

export const updateContactSchema = createContactSchema.partial();

export type CreateContactPayload = z.infer<typeof createContactSchema>;
export type UpdateContactPayload = z.infer<typeof updateContactSchema>;
export type ContactChannel = z.infer<typeof contactChannelSchema>;
export type ContactPhoneInput = z.infer<typeof contactPhoneSchema>;
export type ContactSocialInput = z.infer<typeof contactSocialSchema>;
export type SocialKind = z.infer<typeof socialKindSchema>;
