"use client";

import { History, Wrench, Calendar, Banknote, User, CheckCircle2, AlertCircle } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { TagPill, type TagColor } from "@/components/ui/tag";
import type { EquipmentHistoryItemDTO } from "@/lib/api/use-repairs";

interface EquipmentRepairHistorySheetProps {
  open: boolean;
  onClose: () => void;
  equipment: {
    type: string;
    brand: string;
    model: string;
    serial: string;
  } | null;
  history: EquipmentHistoryItemDTO[];
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return dateStr;
  }
}

function formatCurrency(amount: number | null | undefined): string {
  if (amount == null) return "—";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

function getStatusBadge(status: string): { label: string; color: TagColor } {
  switch (status.toLowerCase()) {
    case "received":
      return { label: "Принят", color: "slate" };
    case "diagnostics":
      return { label: "Диагностика", color: "sky" };
    case "in_progress":
    case "in-progress":
      return { label: "В работе", color: "sky" };
    case "waiting_parts":
      return { label: "Ожидает запчастей", color: "amber" };
    case "ready":
    case "completed":
      return { label: "Готов", color: "emerald" };
    case "delivered":
      return { label: "Выдан клиенту", color: "emerald" };
    case "cancelled":
      return { label: "Отменён", color: "rose" };
    default:
      return { label: status, color: "slate" };
  }
}

export function EquipmentRepairHistorySheet({
  open,
  onClose,
  equipment,
  history,
}: EquipmentRepairHistorySheetProps) {
  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} width="w-[580px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <History className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              История ремонтов оборудования
            </h2>
            <p className="text-xs text-[#666666]">
              {equipment?.brand} {equipment?.model} (S/N: {equipment?.serial || "не указан"})
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111] overflow-y-auto p-6 space-y-5">
        {/* Карточка оборудования */}
        {equipment && (
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-2">
            <span className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
              Паспорт устройства
            </span>
            <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
              <div>
                <span className="text-[#888888]">Тип:</span>{" "}
                <span className="font-medium text-[#111111]">{equipment.type || "—"}</span>
              </div>
              <div>
                <span className="text-[#888888]">Бренд:</span>{" "}
                <span className="font-medium text-[#111111]">{equipment.brand || "—"}</span>
              </div>
              <div>
                <span className="text-[#888888]">Модель:</span>{" "}
                <span className="font-medium text-[#111111]">{equipment.model || "—"}</span>
              </div>
              <div>
                <span className="text-[#888888]">Серийный номер:</span>{" "}
                <span className="font-mono tabular-nums font-semibold text-[#111111]">
                  {equipment.serial || "—"}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Список прошлых ремонтов */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
              Прошлые обращения ({history.length})
            </h3>
          </div>

          {history.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-[#e5e5e5] p-6 text-center text-xs text-slate-400">
              Предыдущих обращений по данному серийному номеру не найдено.
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((item) => {
                const badge = getStatusBadge(item.status);

                return (
                  <div
                    key={item.id}
                    className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs hover:border-[#cccccc] transition-colors space-y-3"
                  >
                    {/* Шапка квитанции */}
                    <div className="flex items-center justify-between pb-2 border-b border-[#f0f0f0]">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#111111]">
                          {item.ticketNumber}
                        </span>
                        <TagPill color={badge.color}>{badge.label}</TagPill>
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-[#666666]">
                        <Calendar className="h-3.5 w-3.5 text-slate-400" />
                        <span>{formatDate(item.receivedAt)}</span>
                      </div>
                    </div>

                    {/* Неисправности */}
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-medium text-[#888888]">
                        Заявленные дефекты:
                      </span>
                      {item.malfunctions && item.malfunctions.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {item.malfunctions.map((m) => (
                            <span
                              key={m}
                              className="rounded-[4px] bg-slate-100 border border-slate-200/80 px-1.5 py-0.5 text-[11px] text-slate-700 font-medium"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {item.defectDescription && (
                        <p className="text-xs text-[#333333] bg-[#fafafa] p-2 rounded-[4px] border border-[#f0f0f0]">
                          {item.defectDescription}
                        </p>
                      )}
                    </div>

                    {/* Мастер и стоимость */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#f0f0f0] text-xs">
                      <div className="flex items-center gap-1.5 text-[#666666]">
                        <User className="h-3.5 w-3.5 text-slate-400" />
                        <span>Мастер: <strong className="text-[#111111] font-medium">{item.masterName || "—"}</strong></span>
                      </div>

                      <div className="flex items-center justify-end gap-1.5 text-[#666666]">
                        <Banknote className="h-3.5 w-3.5 text-slate-400" />
                        <span>
                          Стоимость:{" "}
                          <strong className="font-mono tabular-nums text-[#111111]">
                            {item.finalCost != null
                              ? formatCurrency(item.finalCost)
                              : formatCurrency(item.estimatedCost)}
                          </strong>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
