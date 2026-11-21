import type { InvoiceIssuerSnapshot, VatMode } from "@/lib/api/use-invoices";

export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue" | "cancelled";

export interface InvoiceLineItem {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  source: "manual" | "repair_work" | "repair_part" | "deal";
  source_label: string | null;
}

export interface Invoice {
  id: string;
  invoice_number: string;
  status: InvoiceStatus;
  issue_date: string;
  due_date: string;
  company_name: string;
  company_inn: string;
  company_address: string;
  contact_name: string;
  contact_phone: string;
  line_items: InvoiceLineItem[];
  subtotal: number;
  vat_mode?: VatMode;
  vat_rate: number;
  vat_amount: number;
  total: number;
  currency: string;
  notes: string;
  created_by: string;
  issuer_organization_id?: string | null;
  issuer_snapshot?: InvoiceIssuerSnapshot | null;
  elba_bill_id?: string;
  elba_synced_at?: string | null;
  elba_sync_error?: string;
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Черновик",
  sent: "Выставлен",
  paid: "Оплачен",
  overdue: "Просрочен",
  cancelled: "Отменён",
};

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "bg-[#f5f5f5] text-[#666666] border-[#e5e5e5]",
  sent: "bg-sky-50 text-sky-700 border-sky-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  overdue: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-[#f5f5f5] text-[#888888] border-[#e5e5e5] line-through",
};

export type InvoiceFilterStatus = InvoiceStatus | "all";

export function getInvoiceStatusLabel(status: InvoiceStatus): string {
  return STATUS_LABELS[status];
}

export function getInvoiceStatusColors(status: InvoiceStatus): string {
  return STATUS_COLORS[status];
}