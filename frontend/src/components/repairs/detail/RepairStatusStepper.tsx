"use client";

import { memo, useCallback } from "react";
import { Check, Circle } from "lucide-react";
import type { RepairStatus } from "@/lib/repairs/repairs.types";
import { STATUS_ORDER, getRepairStatusLabel } from "@/lib/repairs/repairs.types";
import { cn } from "@/lib/utils";

interface RepairStatusStepperProps {
  current: RepairStatus;
  onAdvance: () => void;
  disabled?: boolean;
}

export const RepairStatusStepper = memo(function RepairStatusStepper({
  current,
  onAdvance,
  disabled = false,
}: RepairStatusStepperProps) {
  const currentIdx = STATUS_ORDER.indexOf(current);
  const hasReachedEnd = current === "issued" || current === "rejected";

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-[#666666] uppercase tracking-wider">Статус</span>
        {!hasReachedEnd && (
          <button
            type="button"
            onClick={onAdvance}
            disabled={disabled}
            className="rounded-[8px] border border-[#4a38f5]/30 bg-[#4a38f5]/10 px-3 py-1.5 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Далее → {getRepairStatusLabel(STATUS_ORDER[Math.min(currentIdx + 1, STATUS_ORDER.length - 1)])}
          </button>
        )}
      </div>

      {/*
        Шесть шагов с подписями `whitespace-nowrap` в 360px не помещаются:
        `flex-1` сжимал бы соединители до нуля, но сами узлы (40px) и подписи
        («In Progress», «Diagnostics») дают минимум около 400px. Прокрутка
        сохраняет шаг читаемым; `min-w-max` не даёт flex сжать содержимое.
      */}
      <div className="overflow-x-auto">
        <div className="flex min-w-max items-center md:min-w-0">
        {STATUS_ORDER.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isPending = idx > currentIdx;

          return (
            <div key={step} className="flex shrink-0 items-center md:flex-1 md:shrink">
              {/* Node */}
              <div className="flex flex-col items-center relative">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300",
                    isCompleted && "border-emerald-600 bg-emerald-600 text-white",
                    isCurrent && "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]",
                    isPending && "border-[#e5e5e5] bg-[#fafafa] text-[#888888]",
                  )}
                >
                  {isCompleted ? <Check className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                </div>
                <span
                  className={cn(
                    "mt-1.5 text-xs font-medium text-center leading-tight whitespace-nowrap",
                    isCompleted && "text-emerald-700",
                    isCurrent && "text-[#4a38f5]",
                    isPending && "text-[#888888]",
                  )}
                >
                  {getRepairStatusLabel(step)}
                </span>
              </div>
              {/* Connector */}
              {idx < STATUS_ORDER.length - 1 && (
                // При прокрутке `flex-1` не растягивает соединитель (у контейнера
                // `min-w-max`), поэтому нужна явная минимальная длина: без неё
                // шаги слипаются вплотную. С md: снова работает `flex-1`.
                <div className="w-8 shrink-0 mx-1 mb-5 md:w-auto md:flex-1 md:shrink">
                  <div
                    className={cn(
                      "h-0.5 rounded-full transition-all duration-500",
                      idx < currentIdx ? "bg-emerald-600" : "bg-[#e5e5e5]",
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
        </div>
      </div>
    </div>
  );
});