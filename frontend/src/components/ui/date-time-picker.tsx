"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Calendar, Clock, X } from "lucide-react";
import { useClickOutside } from "@/lib/hooks/use-click-outside";
import { cn, toLocalDateTimeInput } from "@/lib/utils";

export interface DateTimePickerProps {
  /** Значение в формате `YYYY-MM-DDTHH:mm` или ISO-8601, либо пустая строка. */
  value?: string | null;
  /** Возвращает локальную строку `YYYY-MM-DDTHH:mm` либо `""` при сбросе. */
  onChange: (nextValue: string) => void;
  id?: string;
  ariaLabel?: string;
  placeholder?: string;
  variant?: "default" | "compact";
  error?: boolean;
  disabled?: boolean;
  className?: string;
}

const DEFAULT_TIME = "12:00";

const TIME_PRESETS: Array<{ label: string; kind: "fixed" | "offset"; value: string | number }> = [
  { label: "09:00", kind: "fixed", value: "09:00" },
  { label: "12:00", kind: "fixed", value: "12:00" },
  { label: "15:00", kind: "fixed", value: "15:00" },
  { label: "18:00", kind: "fixed", value: "18:00" },
  { label: "+1 ч", kind: "offset", value: 60 },
  { label: "+3 ч", kind: "offset", value: 180 },
];

const DATE_PRESETS: Array<{ label: string; daysOffset: number }> = [
  { label: "Сегодня", daysOffset: 0 },
  { label: "Завтра", daysOffset: 1 },
  { label: "+3 дня", daysOffset: 3 },
  { label: "Неделя", daysOffset: 7 },
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function formatTimeInput(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatTriggerLabel(datePart: string, timePart: string, compact: boolean): string {
  const [y, m, d] = datePart.split("-").map(Number);
  if (!y || !m || !d) return "";
  const time = timePart || DEFAULT_TIME;
  const sameYear = y === new Date().getFullYear();

  if (compact) {
    const dateStr = sameYear ? `${pad2(d)}.${pad2(m)}` : `${pad2(d)}.${pad2(m)}.${y}`;
    return `${dateStr}, ${time}`;
  }

  return `${pad2(d)}.${pad2(m)}.${y}, ${time}`;
}

/**
 * Единый выбор даты и времени (Twenty CRM Light Canvas).
 * Поддерживает точный ввод даты и времени (`HH:mm`), быстрые пресеты и очистку.
 */
export function DateTimePicker({
  value,
  onChange,
  id,
  ariaLabel = "Срок (дата и время)",
  placeholder = "Укажите дату и время",
  variant = "default",
  error = false,
  disabled = false,
  className,
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useClickOutside(containerRef, () => setOpen(false), open);

  const normalized = useMemo(() => toLocalDateTimeInput(value ?? ""), [value]);
  const [datePart, timePart] = useMemo(() => {
    if (!normalized) return ["", ""];
    const [d = "", t = ""] = normalized.split("T");
    return [d, t.slice(0, 5)];
  }, [normalized]);

  const isCompact = variant === "compact";
  const hasValue = Boolean(datePart);
  const displayLabel = hasValue ? formatTriggerLabel(datePart, timePart, isCompact) : "";

  const commit = useCallback(
    (nextDate: string, nextTime: string) => {
      if (!nextDate) {
        onChange("");
        return;
      }
      const safeTime = /^\d{2}:\d{2}$/.test(nextTime) ? nextTime : DEFAULT_TIME;
      onChange(`${nextDate}T${safeTime}`);
    },
    [onChange],
  );

  const handleDateChange = (nextDate: string) => {
    if (!nextDate) {
      onChange("");
      return;
    }
    // Сохраняем выбранное время или подставляем 12:00 при первом выборе даты
    commit(nextDate, timePart || DEFAULT_TIME);
  };

  const handleTimeChange = (nextTime: string) => {
    if (!nextTime) return;
    const baseDate = datePart || formatDateInput(new Date());
    commit(baseDate, nextTime);
  };

  const applyDatePreset = (daysOffset: number) => {
    const target = new Date();
    target.setDate(target.getDate() + daysOffset);
    commit(formatDateInput(target), timePart || DEFAULT_TIME);
  };

  const applyTimePreset = (preset: (typeof TIME_PRESETS)[number]) => {
    if (preset.kind === "fixed") {
      const baseDate = datePart || formatDateInput(new Date());
      commit(baseDate, String(preset.value));
      return;
    }
    const base = datePart ? new Date(`${datePart}T${timePart || formatTimeInput(new Date())}:00`) : new Date();
    const target = Number.isNaN(base.getTime()) ? new Date() : base;
    target.setMinutes(target.getMinutes() + Number(preset.value));
    commit(formatDateInput(target), formatTimeInput(target));
  };

  return (
    <div ref={containerRef} className={cn("relative inline-block", !isCompact && "w-full", className)}>
      <div className="relative flex items-center">
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            "flex items-center gap-1.5 border bg-white text-left transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer",
            isCompact
              ? "h-7 rounded-[8px] px-2 text-xs"
              : "w-full rounded-[8px] px-3 py-2 text-[13px]",
            hasValue && "pr-7",
            error
              ? "border-rose-500"
              : open
                ? "border-[#4a38f5] ring-1 ring-[#4a38f5]/20"
                : "border-[#e5e5e5] hover:border-[#cccccc]",
          )}
        >
          <Calendar className={cn("shrink-0 text-[#888888]", isCompact ? "h-3.5 w-3.5" : "h-3.5 w-3.5")} />
          {hasValue ? (
            <span className={cn("font-mono tabular-nums text-[#111111]", isCompact ? "text-xs" : "text-[13px]")}>
              {displayLabel}
            </span>
          ) : (
            <span className="truncate text-[#888888]">{placeholder}</span>
          )}
        </button>

        {hasValue && !disabled && (
          <button
            type="button"
            aria-label="Сбросить срок"
            title="Сбросить срок"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="absolute right-1.5 flex h-4 w-4 items-center justify-center rounded text-[#888888] hover:bg-black/[0.06] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && (
        <div
          role="dialog"
          aria-label="Выбор даты и времени"
          className={cn(
            "absolute z-50 mt-1.5 w-[296px] max-w-[calc(100vw-2rem)] rounded-[12px] border border-[#e5e5e5] bg-white p-3 shadow-lg space-y-3",
            isCompact ? "left-0" : "right-0 sm:left-0 sm:right-auto",
          )}
        >
          {/* Пресеты даты */}
          <div className="space-y-1.5">
            <span className="block text-[11px] font-medium text-[#666666]">Быстрая дата</span>
            <div className="grid grid-cols-4 gap-1">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyDatePreset(preset.daysOffset)}
                  className="h-6 rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-1.5 text-[11px] font-medium text-[#333333] hover:border-[#4a38f5]/40 hover:bg-[#4a38f5]/5 hover:text-[#4a38f5] transition-colors cursor-pointer"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Точный ввод даты и времени */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-[11px] font-medium text-[#666666]">
                <Calendar className="h-3 w-3 text-[#888888]" />
                Дата
              </label>
              <input
                type="date"
                aria-label="Дата срока"
                value={datePart}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div className="space-y-1">
              <label className="flex items-center gap-1 text-[11px] font-medium text-[#666666]">
                <Clock className="h-3 w-3 text-[#888888]" />
                Время
              </label>
              <input
                type="time"
                aria-label="Время срока"
                value={timePart || (hasValue ? DEFAULT_TIME : "")}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          {/* Пресеты времени */}
          <div className="space-y-1.5">
            <span className="block text-[11px] font-medium text-[#666666]">Время</span>
            <div className="grid grid-cols-3 gap-1">
              {TIME_PRESETS.map((preset) => {
                const isActive =
                  preset.kind === "fixed" && hasValue && (timePart || DEFAULT_TIME) === preset.value;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyTimePreset(preset)}
                    className={cn(
                      "h-6 rounded-[6px] border px-1.5 text-[11px] font-mono font-medium transition-colors cursor-pointer",
                      isActive
                        ? "border-[#4a38f5] bg-[#4a38f5] text-white"
                        : "border-[#e5e5e5] bg-white text-[#333333] hover:border-[#4a38f5]/40 hover:bg-[#4a38f5]/5 hover:text-[#4a38f5]",
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Действия */}
          <div className="flex items-center justify-between border-t border-[#f0f0f0] pt-2">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              className="rounded-[6px] px-2 py-1 text-[11px] font-medium text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
            >
              Без срока
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-[6px] bg-[#4a38f5] px-3 py-1 text-[11px] font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer"
            >
              Готово
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
