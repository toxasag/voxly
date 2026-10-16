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
  repair: "Repair Services",
  parts_sale: "Parts Sales",
  rent: "Rent",
  salary: "Salary",
  equipment: "Equipment Purchase",
  marketing: "Marketing",
  software: "Software & Licenses",
  taxes: "Taxes",
  other_income: "Other Income",
  other_expense: "Other Expense",
};

const TYPE_ICONS: Record<TransactionType, string> = {
  income: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  expense: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  transfer: "bg-sky-500/10 text-sky-400 border-sky-500/30",
};

const TYPE_LABELS: Record<TransactionType, string> = {
  income: "Income",
  expense: "Expense",
  transfer: "Transfer",
};

const ACCOUNT_LABELS: Record<AccountType, string> = {
  cash: "Cash",
  bank: "Bank Account",
  acquiring: "Acquiring",
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