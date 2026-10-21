export type TransactionType = "income" | "expense" | "transfer";

export type TransactionCategory =
  | "repair"
  | "parts_sale"
  | "rent"
  | "salary"
  | "equipment"
  | "marketing"
  | "software"
  | "taxes"
  | "other_income"
  | "other_expense";

export type AccountType = "cash" | "bank" | "acquiring";

export interface AccountBalance {
  id: string;
  name: string;
  currency: string;
  balance: number;
}

export interface Transaction {
  id: string;
  date: string;
  type: TransactionType;
  category: TransactionCategory;
  amount: number;
  account_id: string;
  account_name: string;
  description: string;
  linked_entity_id: string | null;
  linked_entity_type: string | null;
  linked_entity_label: string | null;
  counterparty: string;
}

const CATEGORY_LABELS: Record<TransactionCategory, string> = {
  repair: "Услуги ремонта",
  parts_sale: "Продажа запчастей",
  rent: "Аренда",
  salary: "Заработная плата",
  equipment: "Оборудование и инструмент",
  marketing: "Маркетинг и реклама",
  software: "ПО и сервисы",
  taxes: "Налоги и сборы",
  other_income: "Прочие доходы",
  other_expense: "Прочие расходы",
};

export const INCOME_CATEGORIES = [
  { value: "repair" as const, label: "Услуги ремонта" },
  { value: "parts_sale" as const, label: "Продажа запчастей" },
  { value: "other_income" as const, label: "Прочие доходы" },
];

export const EXPENSE_CATEGORIES = [
  { value: "rent" as const, label: "Аренда" },
  { value: "salary" as const, label: "Заработная плата" },
  { value: "equipment" as const, label: "Оборудование и инструмент" },
  { value: "marketing" as const, label: "Маркетинг и реклама" },
  { value: "software" as const, label: "ПО и сервисы" },
  { value: "taxes" as const, label: "Налоги и сборы" },
  { value: "other_expense" as const, label: "Прочие расходы" },
];

const TYPE_ICONS: Record<TransactionType, string> = {
  income: "bg-emerald-50 text-emerald-700 border-emerald-200",
  expense: "bg-rose-50 text-rose-700 border-rose-200",
  transfer: "bg-sky-50 text-sky-700 border-sky-200",
};

const TYPE_LABELS: Record<TransactionType, string> = {
  income: "Доход",
  expense: "Расход",
  transfer: "Перевод",
};

const ACCOUNT_LABELS: Record<AccountType, string> = {
  cash: "Наличные (касса)",
  bank: "Расчётный счёт",
  acquiring: "Эквайринг",
};

export function getCategoryLabel(category: TransactionCategory): string {
  return CATEGORY_LABELS[category];
}

export function getTypeColors(type: TransactionType): string {
  return TYPE_ICONS[type];
}

export function getTypeLabel(type: TransactionType): string {
  return TYPE_LABELS[type];
}

export function getAccountLabel(type: AccountType): string {
  return ACCOUNT_LABELS[type];
}