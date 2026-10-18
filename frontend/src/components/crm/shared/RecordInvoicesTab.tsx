"use client";

import Link from "next/link";
import { Receipt } from "lucide-react";

import { EntityChip } from "@/components/crm/shared/EntityChip";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { useInvoices, type InvoiceStatus } from "@/lib/api/use-invoices";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const statusClass: Record<InvoiceStatus, string> = {
  draft: "bg-[#f5f5f5] text-[#666666] border-[#e5e5e5]",
  sent: "bg-sky-50 text-sky-700 border-sky-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  overdue: "bg-rose-50 text-rose-700 border-rose-200",
  cancelled: "bg-[#f5f5f5] text-[#888888] border-[#e5e5e5]",
};

const statusLabel: Record<InvoiceStatus, string> = {
  draft: "Черновик",
  sent: "Отправлен",
  paid: "Оплачен",
  overdue: "Просрочен",
  cancelled: "Отменён",
};

interface RecordInvoicesTabProps {
  companyId: string;
}

export function RecordInvoicesTab({ companyId }: RecordInvoicesTabProps) {
  const invoices = useInvoices({ companyId, limit: 20 });
  const items = invoices.data?.items ?? [];

  if (invoices.isLoading) {
    return (
      <div className="space-y-2 px-5 py-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="Счетов нет"
        description="Счета этой компании появятся здесь"
      />
    );
  }

  return (
    <ul className="divide-y divide-[#f0f0f0] px-2 py-2">
      {items.map((invoice) => (
        <li key={invoice.id}>
          <Link
            href={`/finance?invoice=${invoice.id}`}
            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left hover:bg-[#f5f5f5]"
          >
            <EntityChip name={invoice.invoiceNumber} icon={Receipt} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#111111]">
              {invoice.invoiceNumber}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                statusClass[invoice.status],
              )}
            >
              {statusLabel[invoice.status]}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-[#666666]">
              {money.format(invoice.total)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
