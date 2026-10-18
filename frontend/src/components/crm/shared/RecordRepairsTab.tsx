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
  intake: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  diagnostics: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
  approval: "bg-orange-400/10 text-orange-400 border-orange-400/30",
  in_progress: "bg-[#4a38f5]/10 text-[#4a38f5] border-[#4a38f5]/30",
  ready: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  issued: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  rejected: "bg-rose-500/10 text-rose-400 border-rose-500/30",
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
    <ul className="divide-y divide-slate-800 px-2 py-2">
      {items.map((order) => (
        <li key={order.id}>
          <Link
            href={`/repairs/${order.id}`}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-left hover:bg-slate-800/60"
          >
            <EntityChip name={order.ticketNumber} icon={Wrench} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm text-slate-200">
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
            <span className="shrink-0 text-xs tabular-nums text-amber-400">
              {money.format(order.estimatedCost)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
