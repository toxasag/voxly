import { z } from "zod";

// ---------------------------------------------------------------------------
// Контакт.
//
// Модель телефонов и соцсетей взята из composite-типов Twenty
// (packages/twenty-shared/src/types/composite-types/phones.composite-type.ts):
// основной номер отдельными полями (number / countryCode / callingCode) плюс
// массив дополнительных. Обязательность полей — тоже их: на Person nullable всё,
// кроме идентификатора, а имя требуется уже интерфейсом.
//
// Что здесь обязательно: `first_name`. Фамилия, отчество, телефон и компания —
// нет. Клиент из входящего сообщения известен часто только именем, у физлица нет
// компании, а номер может быть скрыт настройками приватности мессенджера.
// ---------------------------------------------------------------------------

export const contactChannelSchema = z.enum(["telegram", "whatsapp", "rumax", "phone", "email"]);

const optionalUuid = z.string().uuid().optional().or(z.literal(""));

/**
 * Номер телефона в E.164 без разделителей.
 *
 * Форматирование остаётся клиенту (у Twenty тем же занимается
 * `libphonenumber-js` в PhonesFieldInput), а в БД номер лежит нормализованным:
 * иначе поиск контакта по входящему звонку не находил бы «+7 916 …», записанный
 * как «8 (916) …». Разделители снимаются трансформацией до валидации, чтобы
 * пользовательский ввод с пробелами не отклонялся.
 */
const phoneNumberSchema = z
  .string()
  .transform((value) => value.replace(/[\s()\-.]/g, ""))
  .pipe(
    z
      .string()
      .min(5, "Phone is too short")
      .max(20, "Phone is too long")
      .regex(/^\+?\d+$/, "Phone may contain digits and a leading plus only"),
  );

/** Twenty: AdditionalPhoneMetadata — { number, countryCode, callingCode }. */
export const contactPhoneSchema = z.object({
  number: phoneNumberSchema,
  /** ISO-2 код страны: 'RU'. Нужен для флага — код звонка неоднозначен (+1). */
  country_code: z.string().max(2).optional().or(z.literal("")),
  /** Префикс набора со знаком плюс: '+7'. */
  calling_code: z
    .string()
    .max(6)
    .regex(/^(\+\d+)?$/, "Calling code must look like +7")
    .optional()
    .or(z.literal("")),
});

export const socialKindSchema = z.enum([
  "telegram",
  "whatsapp",
  "max",
  "viber",
  "vk",
  "instagram",
  "other",
]);

/**
 * Соцсеть/мессенджер контакта.
 *
 * У Twenty под каждую сеть отдельное поле LINKS, добавляемое миграцией
 * метаданных. Здесь список: набор мессенджеров у российского клиента меняется
 * чаще, чем можно выпускать миграции, и пользователь добавляет их сам.
 */
export const contactSocialSchema = z.object({
  kind: socialKindSchema,
  /** Username, номер или ссылка — по каждой сети формат свой. */
  value: z.string().min(1, "Value is required").max(200),
});

export const createContactSchema = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().max(100).optional().or(z.literal("")),
  /** Отчество: русская специфика, в FULL_NAME у Twenty его нет. */
  middle_name: z.string().max(100).optional().or(z.literal("")),
  /**
   * Телефоны списком. Первый элемент — основной (Twenty: primaryPhone*),
   * остальные уходят в additional_phones. Пустой список допустим.
   */
  phones: z.array(contactPhoneSchema).max(10, "Too many phone numbers").optional(),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  /** Мессенджеры и соцсети списком. */
  socials: z.array(contactSocialSchema).max(20, "Too many social profiles").optional(),
  telegram_chat_id: z.string().max(30).optional().or(z.literal("")),
  job_title: z.string().max(150).optional().or(z.literal("")),
  /** Компания необязательна: у физлица её нет. */
  company_name: z.string().max(200).optional().or(z.literal("")),
  company_id: optionalUuid,
  channel: contactChannelSchema.default("phone"),
  /**
   * Twenty: person.linkedinLink, группа social.
   *
   * Валидируется как URL, но принимает и пустую строку: поле необязательное, а
   * z.string().url() на "" отдаёт ошибку, которую пользователь читает как
   * «уберите поле», хотя он просто его не заполнил.
   */
  linkedin_link: z.string().url("Invalid URL").max(300).optional().or(z.literal("")),
  notes: z.string().max(4000).optional().or(z.literal("")),
  custom_fields: z.record(z.unknown()).optional(),
});

export const updateContactSchema = createContactSchema.partial();

export type CreateContactPayload = z.infer<typeof createContactSchema>;
export type UpdateContactPayload = z.infer<typeof updateContactSchema>;
export type ContactChannel = z.infer<typeof contactChannelSchema>;
export type ContactPhonePayload = z.infer<typeof contactPhoneSchema>;
export type ContactSocialPayload = z.infer<typeof contactSocialSchema>;
export type SocialKind = z.infer<typeof socialKindSchema>;

/** Форма элемента в колонке additional_phones (camelCase, как отдаётся наружу). */
export interface ContactPhoneJson {
  number: string;
  countryCode: string;
  callingCode: string;
}

export interface ContactSocialJson {
  kind: SocialKind;
  value: string;
}

export interface ContactRow {
  id: string;
  tenant_id: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  phone: string;
  phone_country_code: string;
  phone_calling_code: string;
  additional_phones: ContactPhoneJson[];
  email: string | null;
  telegram_username: string | null;
  telegram_chat_id: string | null;
  whatsapp: string | null;
  socials: ContactSocialJson[];
  job_title: string;
  company_name: string;
  company_id: string | null;
  channel: ContactChannel;
  linkedin_link: string;
  custom_fields: Record<string, unknown>;
  notes: string;
  is_personal?: boolean;
  suppress_deal_creation?: boolean;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  /** Число сделок, где контакт указан контактным лицом (JOIN в выборке списка). */
  deals_count?: string | null;
  /** Число задач по контакту (JOIN там же). */
  tasks_count?: string | null;
  /** Имя создателя приходит LEFT JOIN на users; NULL, если запись создана системой. */
  created_by_name?: string | null;
}

export interface ContactPhoneDTO {
  number: string;
  countryCode: string;
  callingCode: string;
  /** true у первого номера: у Twenty primary — это позиция 0 в списке. */
  isPrimary: boolean;
}

export interface ContactSocialDTO {
  kind: SocialKind;
  value: string;
}

export interface ContactDTO {
  id: string;
  firstName: string;
  lastName: string;
  middleName: string;
  /** Основной номер: первый в `phones`. Оставлен отдельным полем — по нему ищет транспорт. */
  phone: string;
  /** Все номера, основной первым. */
  phones: ContactPhoneDTO[];
  email: string | null;
  telegramUsername: string | null;
  telegramChatId: string | null;
  whatsapp: string | null;
  socials: ContactSocialDTO[];
  jobTitle: string;
  companyName: string;
  companyId: string | null;
  channel: ContactChannel;
  linkedinLink: string;
  customFields: Record<string, unknown>;
  notes: string;
  isPersonal?: boolean;
  suppressDealCreation?: boolean;
  createdBy: string | null;
  /** Отображаемое имя создателя для группы «Система» на карточке. */
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  dealsCount: number;
  tasksCount: number;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Собирает список номеров: основной из плоских колонок, остальные из JSONB.
 *
 * Хранение раздельное, потому что основной номер участвует в поиске и в
 * автосвязке входящих сообщений — по индексируемой колонке, а не по JSONB.
 * Наружу же карточке нужен один список, где primary просто стоит первым: у
 * Twenty ровно так, `parseArrayToPhonesValue` берёт нулевой элемент за primary.
 */
function collectPhones(row: ContactRow): ContactPhoneDTO[] {
  const phones: ContactPhoneDTO[] = [];

  if (row.phone !== "") {
    phones.push({
      number: row.phone,
      countryCode: row.phone_country_code,
      callingCode: row.phone_calling_code,
      isPrimary: true,
    });
  }

  // Колонка объявлена NOT NULL DEFAULT '[]', но у строк, прочитанных до
  // миграции, и в тестовых фикстурах поле может отсутствовать.
  const additional = Array.isArray(row.additional_phones) ? row.additional_phones : [];

  for (const entry of additional) {
    if (typeof entry?.number !== "string" || entry.number === "") continue;

    phones.push({
      number: entry.number,
      countryCode: typeof entry.countryCode === "string" ? entry.countryCode : "",
      callingCode: typeof entry.callingCode === "string" ? entry.callingCode : "",
      // primary остаётся только у основного номера, даже если основного нет:
      // иначе «первый дополнительный» вёл бы себя как основной, не будучи им в БД.
      isPrimary: false,
    });
  }

  return phones;
}

function collectSocials(row: ContactRow): ContactSocialDTO[] {
  const socials = Array.isArray(row.socials) ? row.socials : [];

  return socials
    .filter((entry): entry is ContactSocialJson =>
      typeof entry?.kind === "string" && typeof entry?.value === "string" && entry.value !== "")
    .map((entry) => ({ kind: entry.kind, value: entry.value }));
}

export function toContactDTO(row: ContactRow): ContactDTO {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    middleName: row.middle_name,
    phone: row.phone,
    phones: collectPhones(row),
    email: row.email,
    telegramUsername: row.telegram_username,
    telegramChatId: row.telegram_chat_id,
    whatsapp: row.whatsapp,
    socials: collectSocials(row),
    jobTitle: row.job_title,
    companyName: row.company_name,
    companyId: row.company_id,
    channel: row.channel,
    linkedinLink: row.linkedin_link,
    customFields: row.custom_fields,
    notes: row.notes,
    isPersonal: Boolean(row.is_personal),
    suppressDealCreation: Boolean(row.suppress_deal_creation),
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    // COUNT приходит строкой: pg не приводит bigint к number.
    dealsCount: Number(row.deals_count ?? 0),
    tasksCount: Number(row.tasks_count ?? 0),
  };
}

/** Полное имя в порядке «Фамилия Имя Отчество» — как читают ФИО в русском UI. */
export function contactFullName(contact: ContactDTO): string {
  return [contact.lastName, contact.firstName, contact.middleName]
    .filter((part) => part !== "")
    .join(" ");
}

// ---------------------------------------------------------------------------
// Раскладка списка телефонов и соцсетей на колонки
// ---------------------------------------------------------------------------

export interface PhoneColumns {
  phone: string;
  countryCode: string;
  callingCode: string;
  additional: ContactPhoneJson[];
}

/**
 * Делит список на основной номер и дополнительные.
 *
 * Дубликаты снимаются по номеру: клиент присылает список целиком при каждом
 * сохранении, и один и тот же номер, введённый дважды, иначе попал бы в
 * additional_phones вместе с основным.
 */
export function splitPhones(phones: ContactPhonePayload[]): PhoneColumns {
  const seen = new Set<string>();
  const unique: ContactPhonePayload[] = [];

  for (const entry of phones) {
    if (entry.number === "" || seen.has(entry.number)) continue;
    seen.add(entry.number);
    unique.push(entry);
  }

  const [primary, ...rest] = unique;

  return {
    phone: primary?.number ?? "",
    countryCode: primary?.country_code ?? "",
    callingCode: primary?.calling_code ?? "",
    additional: rest.map((entry) => ({
      number: entry.number,
      countryCode: entry.country_code ?? "",
      callingCode: entry.calling_code ?? "",
    })),
  };
}

/** Снимает дубли пар (kind, value) — тот же случай, что и с телефонами. */
export function normalizeSocials(socials: ContactSocialPayload[]): ContactSocialJson[] {
  const seen = new Set<string>();
  const result: ContactSocialJson[] = [];

  for (const entry of socials) {
    const value = entry.value.trim();
    if (value === "") continue;

    // Технические числовые ID каналов не должны попадать в socials:
    // с ними пользователь ничего сделать не может, а для роутинга есть custom_fields и telegram_chat_id.
    if (entry.kind === "max") {
      if (value.startsWith("max://")) continue;
      if (/^\d{1,10}$/.test(value)) continue;
      if (/^\+\d{1,10}$/.test(value)) continue;
    }
    if (entry.kind === "telegram" && /^\d+$/.test(value)) {
      continue;
    }

    const key = `${entry.kind}:${value.toLowerCase()}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push({ kind: entry.kind, value });
  }

  return result;
}

/**
 * Значение для колонки конкретной сети.
 *
 * Колонки telegram_username и whatsapp сохраняются рядом со списком: по ним
 * ищет транспорт каналов (`crm-pipeline.findContact`) и запросы интеграций, и
 * перевод их на JSONB потребовал бы менять эти пути одновременно. Здесь они
 * поддерживаются в согласии со списком — первое значение нужной сети.
 */
export function socialValue(socials: ContactSocialJson[], kind: SocialKind): string | null {
  return socials.find((entry) => entry.kind === kind)?.value ?? null;
}
