"use client";

import { memo, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Wrench,
  Search,
  Printer,
  User,
  AlertCircle,
} from "lucide-react";
import type { RepairTicket, RepairStatus, RepairFilterStatus } from "@/lib/repairs/repairs.types";
import { getRepairStatusLabel } from "@/lib/repairs/repairs.types";
import { RecordTable, type RecordColumn } from "@/components/crm/shared/RecordTable";
import { RecordCellShell } from "@/components/crm/shared/RecordCell";
import { TagPill, type TagColor } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

interface RepairsTableProps {
  tickets: RepairTicket[];
  filterStatus: RepairFilterStatus;
  onFilterStatusChange: (status: RepairFilterStatus) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onPrintReceipt: (ticket: RepairTicket) => void;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
}

const ALL_STATUSES: { value: RepairFilterStatus; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "intake", label: "Приёмка" },
  { value: "diagnostics", label: "Диагностика" },
  { value: "approval", label: "Согласование" },
  { value: "in_progress", label: "В работе" },
  { value: "ready", label: "Готов" },
  { value: "issued", label: "Выдан" },
  { value: "rejected", label: "Отказ" },
];

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(iso));
}

function formatCost(amount: number | null): string {
  if (amount === null) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

function repairStatusColor(status: RepairStatus): TagColor {
  switch (status) {
    case "ready":
      return "emerald";
    case "in_progress":
      return "cyan";
    case "approval":
      return "amber";
    case "diagnostics":
      return "violet";
    case "intake":
      return "sky";
    case "issued":
      return "slate";
    case "rejected":
      return "rose";
    default:
      return "slate";
  }
}

export const RepairsTable = memo(function RepairsTable({
  tickets,
  filterStatus,
  onFilterStatusChange,
  searchQuery,
  onSearchChange,
  onPrintReceipt,
  isLoading,
  isError,
  error,
}: RepairsTableProps) {
  const router = useRouter();

  const handleRowClick = useCallback(
    (id: string) => {
      router.push(`/repairs/${id}`);
    },
    [router],
  );

  const columns = useMemo<RecordColumn<RepairTicket>[]>(
    () => [
      {
        id: "ticket_number",
        header: "Наряд №",
        width: 120,
        sortValue: (t) => t.ticket_number,
        render: (ticket) => (
          <RecordCellShell isLabelIdentifier>
            <span className="font-mono text-xs font-medium text-[#111111]">
              {ticket.ticket_number}
            </span>
          </RecordCellShell>
        ),
      },
      {
        id: "received_at",
        header: "Принят",
        width: 104,
        sortValue: (t) => t.received_at,
        render: (ticket) => (
          <RecordCellShell>
            <span className="text-xs text-[#666666]">{formatDate(ticket.received_at)}</span>
          </RecordCellShell>
        ),
      },
      {
        id: "customer_name",
        header: "Клиент",
        width: 180,
        sortValue: (t) => t.customer_name,
        render: (ticket) => (
          <RecordCellShell>
            <div className="truncate text-xs">
              <span className="font-medium text-[#111111]">{ticket.customer_name}</span>
              <span className="ml-1.5 text-[#888888]">{ticket.customer_phone}</span>
            </div>
          </RecordCellShell>
        ),
      },
      {
        id: "equipment",
        header: "Оборудование",
        width: 200,
        sortValue: (t) => `${t.equipment.brand} ${t.equipment.model}`,
        render: (ticket) => (
          <RecordCellShell>
            <span className="truncate text-xs text-[#111111]">
              {ticket.equipment.brand} {ticket.equipment.model}
            </span>
          </RecordCellShell>
        ),
      },
      {
        id: "defect_description",
        header: "Неисправность",
        width: 220,
        render: (ticket) => (
          <RecordCellShell>
            <span className="truncate text-xs text-[#666666]">{ticket.defect_description}</span>
          </RecordCellShell>
        ),
      },
      {
        id: "status",
        header: "Статус",
        width: 130,
        sortValue: (t) => t.status,
        render: (ticket) => (
          <RecordCellShell>
            <TagPill color={repairStatusColor(ticket.status)}>
              {getRepairStatusLabel(ticket.status)}
            </TagPill>
          </RecordCellShell>
        ),
      },
      {
        id: "master_name",
        header: "Мастер",
        width: 130,
        sortValue: (t) => t.master_name,
        render: (ticket) => (
          <RecordCellShell>
            <div className="flex items-center gap-1.5 truncate text-xs text-[#666666]">
              <User className="h-3 w-3 shrink-0 text-[#888888]" />
              <span className="truncate">{ticket.master_name}</span>
            </div>
          </RecordCellShell>
        ),
      },
      {
        id: "cost",
        header: "Сумма",
        width: 120,
        align: "right",
        sortValue: (t) => t.final_cost ?? t.estimated_cost ?? 0,
        render: (ticket) => (
          <RecordCellShell align="right">
            <span className="font-mono text-xs font-medium text-[#111111]">
              {formatCost(ticket.final_cost ?? ticket.estimated_cost)}
            </span>
          </RecordCellShell>
        ),
      },
      {
        id: "actions",
        header: "",
        width: 48,
        render: (ticket) => (
          <RecordCellShell>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPrintReceipt(ticket);
              }}
              className="rounded p-1 text-[#888888] hover:text-[#111111] hover:bg-black/[0.04] transition-colors"
              title="Печать квитанции"
            >
              <Printer className="h-3.5 w-3.5" />
            </button>
          </RecordCellShell>
        ),
      },
    ],
    [onPrintReceipt],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <div className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-2 pl-10 pr-4 text-xs text-[#888888] animate-pulse">
              Загрузка...
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {ALL_STATUSES.map((st) => (
              <div key={st.value} className="rounded-[8px] border border-[#e5e5e5] px-2.5 py-1 text-xs text-[#888888] bg-white">
                {st.label}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-4">
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 w-full bg-[#f5f5f5] rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-[16px] border border-rose-500/30 bg-rose-500/5 p-6 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-rose-500" />
        <div>
          <p className="text-xs font-medium text-rose-600">Не удалось загрузить наряд-заказы</p>
          <p className="text-xs text-[#888888] mt-1">{error?.message ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Top Bar: Search + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по наряду, клиенту, бренду..."
            className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-9 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
          />
        </div>

        <div className="flex items-center gap-1 flex-wrap">
          {ALL_STATUSES.map((st) => (
            <button
              key={st.value}
              type="button"
              onClick={() => onFilterStatusChange(st.value)}
              className={cn(
                "rounded-[8px] border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                filterStatus === st.value
                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
              )}
            >
              {st.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-[#888888]">
          {tickets.length} наряд-заказов
        </span>
      </div>

      {/* RecordTable */}
      <RecordTable
        rows={tickets}
        columns={columns}
        getRowId={(ticket) => ticket.id}
        tableId="repairs"
        onRowClick={(ticket) => handleRowClick(ticket.id)}
        emptyState={
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Wrench className="h-8 w-8 text-[#888888]" />
            <p className="text-xs text-[#666666]">Нет наряд-заказов</p>
          </div>
        }
      />
    </div>
  );
});