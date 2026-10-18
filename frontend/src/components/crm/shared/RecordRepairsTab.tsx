"use client";

import Link from "next/link";
import { Wrench } from "lucide-react";

import { EntityChip } from "@/components/crm/shared/EntityChip";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { useRepairs, type RepairStatus } from "@/lib/api/use-repairs";
import { getRepairStatusLabel } from "@/lib/repairs/repairs.types";
import { cn } from "@/lib/utils";

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

const statusClass: Record<RepairStatus, string> = {
  intake: "bg-sky-50 text-sky-700 border-sky-200",
  diagnostics: "bg-amber-50 text-amber-700 border-amber-200",
  approval: "bg-orange-50 text-orange-700 border-orange-200",
  in_progress: "bg-indigo-50 text-indigo-700 border-indigo-200",
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  issued: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};

interface RecordRepairsTabProps {
  customerId: string;
}

export function RecordRepairsTab({ customerId }: RecordRepairsTabProps) {
  const repairs = useRepairs({ customerId, limit: 20 });
  const items = repairs.data?.items ?? [];

  if (repairs.isLoading) {
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
        icon={Wrench}
        title="Ремонтов нет"
        description="Заказ-наряды этого контакта появятся здесь"
      />
    );
  }

  return (
    <ul className="divide-y divide-[#f0f0f0] px-2 py-2">
      {items.map((order) => (
        <li key={order.id}>
          <Link
            href={`/repairs/${order.id}`}
            className="flex w-full items-center gap-2 rounded-[8px] px-3 py-2 text-left hover:bg-[#f5f5f5]"
          >
            <EntityChip name={order.ticketNumber} icon={Wrench} size="sm" />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#111111]">
              {order.equipment.brand} {order.equipment.model}
            </span>
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                statusClass[order.status],
              )}
            >
              {getRepairStatusLabel(order.status)}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-[#666666]">
              {money.format(order.estimatedCost)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
