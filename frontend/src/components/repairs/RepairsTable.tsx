"use client";

import { memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Wrench,
  Search,
  Printer,
  User,
  Loader2,
  AlertCircle,
} from "lucide-react";
import type { RepairTicket, RepairStatus, RepairFilterStatus } from "@/lib/repairs/repairs.types";
import { getRepairStatusLabel, getRepairStatusColors } from "@/lib/repairs/repairs.types";
import { MOCK_MASTERS } from "@/lib/repairs/mock-repairs";
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

const TABLE_COLUMNS = [
  { key: "ticket_number", label: "Наряд №", width: "w-[110px]" },
  { key: "received_at", label: "Принят", width: "w-[90px]" },
  { key: "customer_name", label: "Клиент", width: "" },
  { key: "equipment", label: "Оборудование", width: "" },
  { key: "defect_description", label: "Неисправность", width: "min-w-[140px] max-w-[200px]" },
  { key: "status", label: "Статус", width: "w-[110px]" },
  { key: "master_name", label: "Мастер", width: "w-[110px]" },
  { key: "estimated_cost", label: "Сумма", width: "w-[100px]" },
  { key: "actions", label: "", width: "w-[48px]" },
] as const;

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

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <div className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-slate-500 animate-pulse">
              Загрузка...
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {ALL_STATUSES.map((st) => (
              <div key={st.value} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-900/50">
                {st.label}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <div className="divide-y divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-3.5 flex items-center gap-4">
                <div className="h-4 w-16 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 w-20 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 w-32 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 w-40 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 flex-1 bg-slate-800 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-rose-400" />
        <div>
          <p className="text-sm font-medium text-rose-400">Не удалось загрузить наряд-заказы</p>
          <p className="text-xs text-slate-500 mt-1">{error?.message ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Bar: Search + Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по наряду, клиенту, бренду..."
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          />
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {ALL_STATUSES.map((st) => (
            <button
              key={st.value}
              type="button"
              onClick={() => onFilterStatusChange(st.value)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                filterStatus === st.value
                  ? "border-amber-500 bg-amber-500/10 text-amber-400"
                  : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
              )}
            >
              {st.label}
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs text-slate-600">
          {tickets.length} наряд-заказов
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                {TABLE_COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap",
                      col.width,
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {tickets.length === 0 && (
                <tr>
                  <td colSpan={TABLE_COLUMNS.length} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Wrench className="h-8 w-8 text-slate-700" />
                      <p className="text-sm text-slate-600">Нет наряд-заказов</p>
                    </div>
                  </td>
                </tr>
              )}
              {tickets.map((ticket) => (
                <tr
                  key={ticket.id}
                  onClick={() => handleRowClick(ticket.id)}
                  className="transition-colors hover:bg-slate-800/50 cursor-pointer"
                >
                  {/* Ticket № */}
                  <td className="px-4 py-3.5">
                    <span className="text-sm font-mono font-semibold text-slate-200">
                      {ticket.ticket_number}
                    </span>
                  </td>

                  {/* Received Date */}
                  <td className="px-4 py-3.5">
                    <span className="text-xs text-slate-400">
                      {formatDate(ticket.received_at)}
                    </span>
                  </td>

                  {/* Client */}
                  <td className="px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-slate-200 truncate max-w-[160px]">
                        {ticket.customer_name}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {ticket.customer_phone}
                      </p>
                    </div>
                  </td>

                  {/* Equipment */}
                  <td className="px-4 py-3.5">
                    <div>
                      <p className="text-sm text-slate-300 truncate max-w-[180px]">
                        {ticket.equipment.brand} {ticket.equipment.model}
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {ticket.equipment.type} · S/N: {ticket.equipment.serial_number}
                      </p>
                    </div>
                  </td>

                  {/* Defect */}
                  <td className="px-4 py-3.5">
                    <p className="text-xs text-slate-400 line-clamp-2 max-w-[200px] leading-relaxed">
                      {ticket.defect_description}
                    </p>
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                        getRepairStatusColors(ticket.status),
                      )}
                    >
                      {getRepairStatusLabel(ticket.status)}
                    </span>
                  </td>

                  {/* Master */}
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3 w-3 text-slate-500" />
                      <span className="text-xs text-slate-400 truncate max-w-[90px]">
                        {ticket.master_name}
                      </span>
                    </div>
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-3.5">
                    <span className={cn(
                      "text-sm font-semibold",
                      ticket.final_cost
                        ? "text-emerald-400"
                        : "text-amber-400",
                    )}>
                      {formatCost(ticket.final_cost ?? ticket.estimated_cost)}
                    </span>
                  </td>

                  {/* Actions: Print Receipt */}
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPrintReceipt(ticket);
                      }}
                      className="rounded-md p-1.5 text-slate-500 hover:text-amber-400 hover:bg-slate-800 transition-colors"
                      title="Печать квитанции"
                    >
                      <Printer className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});