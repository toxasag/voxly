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
  | "budget"
  | "description"
  | "owner"
  | "closeDate"
  | "stage"
  | "createdAt"
  | "updatedAt"
  | "closedAt"
  | "currency";

export interface DealCardFieldSpec {
  id: DealCardFieldId;
  label: string;
  /** Включено по умолчанию: то, что было видно до появления выбора полей. */
  defaultVisible: boolean;
}

export const DEAL_CARD_FIELDS: readonly DealCardFieldSpec[] = [
  { id: "company", label: "Компания", defaultVisible: true },
  { id: "contact", label: "Контакт", defaultVisible: true },
  { id: "budget", label: "Бюджет", defaultVisible: true },
  { id: "description", label: "Описание", defaultVisible: true },
  { id: "owner", label: "Ответственный", defaultVisible: true },
  { id: "closeDate", label: "Дата закрытия", defaultVisible: false },
  { id: "stage", label: "Этап", defaultVisible: false },
  { id: "currency", label: "Валюта", defaultVisible: false },
  { id: "createdAt", label: "Создана", defaultVisible: false },
  { id: "updatedAt", label: "Обновлена", defaultVisible: false },
  { id: "closedAt", label: "Закрыта", defaultVisible: false },
];

/** Видимость полей карточки: ключ поля → показывать или нет. */
export type DealCardFieldVisibility = Record<DealCardFieldId, boolean>;

export function defaultDealCardFields(): DealCardFieldVisibility {
  const result = {} as DealCardFieldVisibility;
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
  const result = {} as DealCardFieldVisibility;
  for (const field of DEAL_CARD_FIELDS) {
    const value = candidate[field.id];
    result[field.id] = typeof value === "boolean" ? value : field.defaultVisible;
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
    case "budget":
      return deal.budget > 0;
    case "description":
      return deal.description !== "";
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
