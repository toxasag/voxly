import type { DealDTO } from "@/lib/api/use-deals";

// ---------------------------------------------------------------------------
// Какие поля сделки показывать на карточке канбана.
//
// Раньше выбор был из трёх флажков — «Бюджет», «Описание», «Компактно», —
// то есть настроить можно было два поля из четырнадцати, а «Компактно» меняло
// отступы, а не состав. Теперь в меню перечислены все поля сделки, и каждое
// включается отдельно, как выбор колонок в списке.
//
// Порядок в реестре = порядок на карточке: заголовок первым, системные поля в
// конце. Состав повторяет `DealDTO` без служебных идентификаторов (`id`,
// `pipelineId`, `stageId`, `position`) — их пользователю показывать нечего.
// ---------------------------------------------------------------------------

export type DealCardFieldId =
  | "company"
  | "contact"
  | "tasks"
  | "budget"
  | "latestNote"
  | "owner"
  | "closeDate"
  | "stage"
  | "createdAt"
  | "updatedAt"
  | "closedAt"
  | "currency";

export type ContactSubfieldId = "name" | "jobTitle" | "phone" | "email";
export type CompanySubfieldId = "name" | "phone" | "email" | "website" | "city";

export interface SubfieldSpec<T extends string> {
  id: T;
  label: string;
  defaultVisible: boolean;
}

export const CONTACT_SUBFIELDS: readonly SubfieldSpec<ContactSubfieldId>[] = [
  { id: "name", label: "Имя / ФИО", defaultVisible: true },
  { id: "jobTitle", label: "Должность", defaultVisible: true },
  { id: "phone", label: "Телефон", defaultVisible: true },
  { id: "email", label: "E-mail", defaultVisible: true },
];

export const COMPANY_SUBFIELDS: readonly SubfieldSpec<CompanySubfieldId>[] = [
  { id: "name", label: "Название", defaultVisible: true },
  { id: "phone", label: "Телефон", defaultVisible: true },
  { id: "email", label: "E-mail", defaultVisible: true },
  { id: "website", label: "Сайт", defaultVisible: true },
  { id: "city", label: "Город", defaultVisible: true },
];

export interface DealCardFieldSpec {
  id: DealCardFieldId;
  label: string;
  /** Включено по умолчанию: то, что было видно до появления выбора полей. */
  defaultVisible: boolean;
}

export const DEAL_CARD_FIELDS: readonly DealCardFieldSpec[] = [
  { id: "company", label: "Компания", defaultVisible: true },
  { id: "contact", label: "Контакт", defaultVisible: true },
  { id: "tasks", label: "Задачи", defaultVisible: true },
  { id: "budget", label: "Бюджет", defaultVisible: true },
  { id: "latestNote", label: "Заметка", defaultVisible: true },
  { id: "owner", label: "Ответственный", defaultVisible: true },
  { id: "closeDate", label: "Дата закрытия", defaultVisible: false },
  { id: "stage", label: "Этап", defaultVisible: false },
  { id: "currency", label: "Валюта", defaultVisible: false },
  { id: "createdAt", label: "Создана", defaultVisible: false },
  { id: "updatedAt", label: "Обновлена", defaultVisible: false },
  { id: "closedAt", label: "Закрыта", defaultVisible: false },
];

export interface DealCardFieldVisibility extends Record<DealCardFieldId, boolean> {
  contactFields?: Record<ContactSubfieldId, boolean>;
  companyFields?: Record<CompanySubfieldId, boolean>;
}

export function defaultContactSubfields(): Record<ContactSubfieldId, boolean> {
  return {
    name: true,
    jobTitle: true,
    phone: true,
    email: true,
  };
}

export function defaultCompanySubfields(): Record<CompanySubfieldId, boolean> {
  return {
    name: true,
    phone: true,
    email: true,
    website: true,
    city: true,
  };
}

export function defaultDealCardFields(): DealCardFieldVisibility {
  const result = {
    contactFields: defaultContactSubfields(),
    companyFields: defaultCompanySubfields(),
  } as DealCardFieldVisibility;
  for (const field of DEAL_CARD_FIELDS) {
    result[field.id] = field.defaultVisible;
  }
  return result;
}

/**
 * Дополняет сохранённый набор новыми полями.
 *
 * Без этого поле, добавленное в код после сохранения настроек, было бы
 * невидимым навсегда: в записи пользователя его ключа нет, а `undefined`
 * читался бы как «скрыто».
 */
export function normalizeDealCardFields(stored: unknown): DealCardFieldVisibility {
  const defaults = defaultDealCardFields();
  if (typeof stored !== "object" || stored === null) return defaults;

  const candidate = stored as Record<string, unknown>;
  const result = {
    contactFields: defaultContactSubfields(),
    companyFields: defaultCompanySubfields(),
  } as DealCardFieldVisibility;

  for (const field of DEAL_CARD_FIELDS) {
    const value = candidate[field.id];
    result[field.id] = typeof value === "boolean" ? value : field.defaultVisible;
  }

  // Восстанавливаем подполя контактов
  if (typeof candidate.contactFields === "object" && candidate.contactFields !== null) {
    const cf = candidate.contactFields as Record<string, unknown>;
    result.contactFields = {
      name: typeof cf.name === "boolean" ? cf.name : true,
      jobTitle: typeof cf.jobTitle === "boolean" ? cf.jobTitle : true,
      phone: typeof cf.phone === "boolean" ? cf.phone : true,
      email: typeof cf.email === "boolean" ? cf.email : true,
    };
  }

  // Восстанавливаем подполя компании
  if (typeof candidate.companyFields === "object" && candidate.companyFields !== null) {
    const cof = candidate.companyFields as Record<string, unknown>;
    result.companyFields = {
      name: typeof cof.name === "boolean" ? cof.name : true,
      phone: typeof cof.phone === "boolean" ? cof.phone : true,
      email: typeof cof.email === "boolean" ? cof.email : true,
      website: typeof cof.website === "boolean" ? cof.website : true,
      city: typeof cof.city === "boolean" ? cof.city : true,
    };
  }

  return result;
}

/** Есть ли у сделки значение для поля — пустые не занимают место на карточке. */
export function hasDealFieldValue(deal: DealDTO, field: DealCardFieldId): boolean {
  switch (field) {
    case "company":
      return deal.companyName !== null && deal.companyName !== "";
    case "contact":
      return deal.contactName !== null && deal.contactName !== "";
    case "tasks":
      return Boolean(deal.tasksCount && deal.tasksCount > 0);
    case "budget":
      return deal.budget > 0;
    case "latestNote":
      return typeof deal.latestNote === "string" && deal.latestNote.trim().length > 0;
    case "owner":
      return deal.ownerName !== null && deal.ownerName !== "";
    case "closeDate":
      return deal.closeDate !== null;
    case "closedAt":
      return deal.closedAt !== null;
    case "currency":
      return deal.currency !== "";
    case "stage":
    case "createdAt":
    case "updatedAt":
      return true;
  }
}
