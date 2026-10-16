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
  vat_rate: number;
  vat_amount: number;
  total: number;
  currency: string;
  notes: string;
  created_by: string;
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<InvoiceStatus, string> = {
  draft: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  sent: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  paid: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  overdue: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  cancelled: "bg-slate-500/10 text-slate-500 border-slate-500/30 line-through",
};

export type InvoiceFilterStatus = InvoiceStatus | "all";

export function getInvoiceStatusLabel(status: InvoiceStatus): string {
  return STATUS_LABELS[status];
}

export function getInvoiceStatusColors(status: InvoiceStatus): string {
  return STATUS_COLORS[status];
}