"use client";

import { memo, useState, useRef, useEffect } from "react";
import { Check, Circle, AlertTriangle, ChevronDown } from "lucide-react";
import type { RepairStatus } from "@/lib/repairs/repairs.types";
import { getRepairStatusLabel } from "@/lib/repairs/repairs.types";
import { cn } from "@/lib/utils";

interface RepairStatusStepperProps {
  current: RepairStatus;
  onChangeStatus: (status: RepairStatus) => void;
  disabled?: boolean;
}

// 4 ключевых статуса согласно требованиям
const PRIMARY_STATUSES: { status: RepairStatus; label: string }[] = [
  { status: "intake", label: "Принят" },
  { status: "waiting_parts", label: "Заказ запчастей" },
  { status: "ready", label: "Готов" },
  { status: "issued", label: "Выдан" },
];

// Дополнительные статусы для дропдауна
const SECONDARY_STATUSES: { status: RepairStatus; label: string }[] = [
  { status: "diagnostics", label: "Диагностика" },
  { status: "in_progress", label: "В работе" },
  { status: "approval", label: "Согласование" },
  { status: "rejected", label: "Отказ / возврат" },
];

export const RepairStatusStepper = memo(function RepairStatusStepper({
  current,
  onChangeStatus,
  disabled = false,
}: RepairStatusStepperProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [dropdownOpen]);

  // Индекс в первичном списке (если текущий статус там есть)
  const primaryIdx = PRIMARY_STATUSES.findIndex((s) => s.status === current);
  const isSecondaryActive = SECONDARY_STATUSES.some((s) => s.status === current);
  const isRejected = current === "rejected";

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 shadow-2xs min-h-[38px]">
      {/* Горизонтальная компактная лента основных статусов */}
      <div className="flex items-center gap-1.5 overflow-x-auto min-w-0 flex-1 py-0.5">
        <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider mr-1 shrink-0 hidden sm:inline">
          Статус:
        </span>

        <div className="flex items-center gap-1 min-w-0 flex-1">
          {PRIMARY_STATUSES.map((step, idx) => {
            const isCurrent = current === step.status;
            // Пройденными считаются шаги до текущего (если текущий входит в цепочку)
            const isCompleted = primaryIdx > -1 && idx < primaryIdx;

            return (
              <div key={step.status} className="flex items-center gap-1 flex-1 min-w-max">
                <button
                  type="button"
                  onClick={() => !disabled && onChangeStatus(step.status)}
                  disabled={disabled}
                  title={`Перевести в статус «${step.label}»`}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-all cursor-pointer select-none",
                    "focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/30",
                    isCurrent && "bg-[#4a38f5] text-white shadow-2xs font-semibold",
                    isCompleted && "bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100",
                    !isCurrent && !isCompleted && "bg-[#fafafa] text-[#666666] border border-[#e5e5e5] hover:bg-[#f0f0f0] hover:text-[#111111]",
                    disabled && "opacity-50 cursor-not-allowed hover:bg-transparent",
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  ) : isCurrent ? (
                    <Circle className="h-2 w-2 fill-current shrink-0" />
                  ) : (
                    <Circle className="h-2 w-2 text-[#cccccc] shrink-0" />
                  )}
                  <span className="whitespace-nowrap">{step.label}</span>
                </button>

                {/* Тонкий соединительный разделитель между шагами */}
                {idx < PRIMARY_STATUSES.length - 1 && (
                  <div className="h-px w-3 bg-[#e5e5e5] shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Правая часть: кнопка/дропдаун для доп. статусов и отказа */}
      <div className="flex items-center gap-1.5 shrink-0 relative" ref={dropdownRef}>
        {isRejected ? (
          <span className="inline-flex items-center gap-1 rounded-[6px] border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-700">
            <AlertTriangle className="h-3 w-3" />
            Отказ / возврат
          </span>
        ) : isSecondaryActive ? (
          <span className="inline-flex items-center gap-1 rounded-[6px] border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
            {getRepairStatusLabel(current)}
          </span>
        ) : null}

        <div className="relative">
          <button
            type="button"
            onClick={() => !disabled && setDropdownOpen(!dropdownOpen)}
            disabled={disabled}
            className="flex items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs text-[#666666] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors"
            title="Другие статусы наряда"
          >
            <span>Ещё</span>
            <ChevronDown className={cn("h-3 w-3 transition-transform", dropdownOpen && "rotate-180")} />
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg text-xs">
              <div className="px-2 py-1 text-[10px] font-semibold text-[#888888] uppercase tracking-wider">
                Дополнительно
              </div>
              {SECONDARY_STATUSES.map((item) => {
                const isSelected = current === item.status;
                return (
                  <button
                    key={item.status}
                    type="button"
                    onClick={() => {
                      onChangeStatus(item.status);
                      setDropdownOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[4px] px-2 py-1.5 text-left text-xs transition-colors",
                      isSelected
                        ? "bg-[#4a38f5]/10 text-[#4a38f5] font-semibold"
                        : item.status === "rejected"
                        ? "text-rose-600 hover:bg-rose-50"
                        : "text-[#111111] hover:bg-[#f5f5f5]",
                    )}
                  >
                    <span>{item.label}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-[#4a38f5]" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
