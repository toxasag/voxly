"use client";

import { useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  TrendingUp,
  X,
} from "lucide-react";
import type { DealDTO } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { stageColor } from "@/components/crm/deals/stage-colors";
import { cn } from "@/lib/utils";

export interface DealsCalendarViewProps {
  deals: DealDTO[];
  stagesById: Map<
    string,
    { name: string; colorKey?: string; isWon: boolean; isLost: boolean }
  >;
  usersById: Map<string, TenantUserDTO>;
  onOpenDeal?: (id: string) => void;
}

const WEEK_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function formatIsoDate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function getDealCalendarDate(deal: DealDTO): string | null {
  if (deal.closeDate) {
    return deal.closeDate.slice(0, 10);
  }
  if (deal.closedAt) {
    return deal.closedAt.slice(0, 10);
  }
  return null;
}

export function DealsCalendarView({
  deals,
  stagesById,
  usersById,
  onOpenDeal,
}: DealsCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [showUnscheduled, setShowUnscheduled] = useState(false);
  const [selectedDayModal, setSelectedDayModal] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const todayStr = useMemo(() => {
    const now = new Date();
    return formatIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  const monthName = useMemo(() => {
    return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
      currentDate,
    );
  }, [currentDate]);

  // Calendar cells generation (Monday-first)
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    let firstDayIndex = firstDayOfMonth.getDay() - 1;
    if (firstDayIndex === -1) firstDayIndex = 6;

    const totalDaysInMonth = lastDayOfMonth.getDate();
    const prevMonthLastDay = new Date(year, month, 0).getDate();

    const days: {
      dateStr: string;
      dayNumber: number;
      isCurrentMonth: boolean;
      isToday: boolean;
    }[] = [];

    // Previous month filler days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i;
      const prevDate = new Date(year, month - 1, d);
      const str = formatIsoDate(prevDate.getFullYear(), prevDate.getMonth(), d);
      days.push({
        dateStr: str,
        dayNumber: d,
        isCurrentMonth: false,
        isToday: str === todayStr,
      });
    }

    // Current month days
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const str = formatIsoDate(year, month, d);
      days.push({
        dateStr: str,
        dayNumber: d,
        isCurrentMonth: true,
        isToday: str === todayStr,
      });
    }

    // Next month filler days to complete multiple of 7 rows
    const remaining = 7 - (days.length % 7);
    if (remaining < 7) {
      for (let d = 1; d <= remaining; d++) {
        const nextDate = new Date(year, month + 1, d);
        const str = formatIsoDate(nextDate.getFullYear(), nextDate.getMonth(), d);
        days.push({
          dateStr: str,
          dayNumber: d,
          isCurrentMonth: false,
          isToday: str === todayStr,
        });
      }
    }

    return days;
  }, [year, month, todayStr]);

  // Group deals by calendar date (YYYY-MM-DD)
  const { dealsByDate, unscheduledDeals, monthStats } = useMemo(() => {
    const map = new Map<string, DealDTO[]>();
    const unscheduled: DealDTO[] = [];

    let totalMonthBudget = 0;
    let totalMonthDeals = 0;
    let wonMonthBudget = 0;
    let wonMonthDeals = 0;

    const currentMonthPrefix = `${year}-${String(month + 1).padStart(2, "0")}`;

    for (const deal of deals) {
      const datePart = getDealCalendarDate(deal);
      if (!datePart) {
        unscheduled.push(deal);
        continue;
      }

      const existing = map.get(datePart) ?? [];
      existing.push(deal);
      map.set(datePart, existing);

      if (datePart.startsWith(currentMonthPrefix)) {
        totalMonthDeals += 1;
        totalMonthBudget += deal.budget;

        const stage = stagesById.get(deal.stageId);
        if (stage?.isWon) {
          wonMonthDeals += 1;
          wonMonthBudget += deal.budget;
        }
      }
    }

    return {
      dealsByDate: map,
      unscheduledDeals: unscheduled,
      monthStats: {
        totalDeals: totalMonthDeals,
        totalBudget: totalMonthBudget,
        wonDeals: wonMonthDeals,
        wonBudget: wonMonthBudget,
      },
    };
  }, [deals, month, stagesById, year]);

  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const selectedDayDeals = selectedDayModal ? (dealsByDate.get(selectedDayModal) ?? []) : [];

  return (
    <div className="space-y-3">
      {/* Calendar Header Controls & Month Metrics */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-white p-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goToPrevMonth}
              aria-label="Предыдущий месяц"
              title="Предыдущий месяц"
              className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToNextMonth}
              aria-label="Следующий месяц"
              title="Следующий месяц"
              className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <span className="text-sm font-semibold capitalize text-[#111111]">
            {monthName}
          </span>

          <button
            type="button"
            onClick={goToToday}
            className="ml-2 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors"
          >
            Сегодня
          </button>
        </div>

        {/* Stats for current month */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1">
            <CalendarIcon className="h-3.5 w-3.5 text-[#888888]" />
            <span className="text-[#666666]">В месяце:</span>
            <span className="font-semibold text-[#111111]">{monthStats.totalDeals}</span>
            <span className="font-mono text-[#111111] tabular-nums">
              ({moneyFormatter.format(monthStats.totalBudget)})
            </span>
          </div>

          {monthStats.wonDeals > 0 && (
            <div className="flex items-center gap-1.5 rounded-[6px] border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-emerald-800">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
              <span>Выиграно:</span>
              <span className="font-semibold">{monthStats.wonDeals}</span>
              <span className="font-mono tabular-nums">
                ({moneyFormatter.format(monthStats.wonBudget)})
              </span>
            </div>
          )}

          {unscheduledDeals.length > 0 && (
            <button
              type="button"
              onClick={() => setShowUnscheduled(!showUnscheduled)}
              className={cn(
                "flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                showUnscheduled
                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111]",
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>Без даты ({unscheduledDeals.length})</span>
            </button>
          )}
        </div>
      </div>

      {/* Unscheduled Deals Drawer / Panel */}
      {showUnscheduled && unscheduledDeals.length > 0 && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3 shadow-2xs">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-[#888888]" />
              <span className="text-xs font-semibold text-[#111111]">
                Сделки без ожидаемой даты закрытия ({unscheduledDeals.length})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setShowUnscheduled(false)}
              className="rounded p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {unscheduledDeals.map((deal) => {
              const stage = stagesById.get(deal.stageId);
              const colorPreset = stageColor(stage?.colorKey);
              const owner = deal.ownerId ? usersById.get(deal.ownerId) : undefined;

              return (
                <div
                  key={deal.id}
                  onClick={() => onOpenDeal?.(deal.id)}
                  className="group flex cursor-pointer flex-col justify-between rounded-[6px] border border-[#e5e5e5] bg-white p-2.5 shadow-2xs hover:border-[#cccccc] transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="flex items-center gap-1.5 text-[11px] text-[#666666]">
                        <span className={cn("h-1.5 w-1.5 rounded-full", colorPreset.dot)} />
                        <span className="truncate max-w-[120px]">{stage?.name ?? "Без этапа"}</span>
                      </span>
                      <span className="font-mono text-xs font-semibold text-[#111111] tabular-nums">
                        {moneyFormatter.format(deal.budget)}
                      </span>
                    </div>

                    <p className="truncate text-xs font-medium text-[#111111] group-hover:text-[#4a38f5] transition-colors">
                      {deal.title}
                    </p>
                  </div>

                  <div className="mt-2 flex items-center justify-between pt-1.5 border-t border-[#f0f0f0] text-[11px] text-[#888888]">
                    <span className="truncate max-w-[120px]">
                      {deal.companyName || deal.contactName || "—"}
                    </span>
                    <UserAvatar user={owner} size="sm" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Calendar Grid */}
      <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
        {/* Days of week header */}
        <div className="grid grid-cols-7 border-b border-[#e5e5e5] bg-[#fbfbfb]">
          {WEEK_DAYS.map((day) => (
            <div
              key={day}
              className="py-2 text-center text-xs font-medium text-[#666666]"
            >
              {day}
            </div>
          ))}
        </div>

        {/* Calendar Day Cells */}
        <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-[#e5e5e5]">
          {calendarDays.map((day) => {
            const dayDeals = dealsByDate.get(day.dateStr) ?? [];
            const dayBudget = dayDeals.reduce((sum, d) => sum + d.budget, 0);

            return (
              <div
                key={day.dateStr}
                className={cn(
                  "min-h-[120px] p-1.5 transition-colors flex flex-col justify-between",
                  day.isCurrentMonth ? "bg-white" : "bg-[#fafafa]/60 text-[#bbbbbb]",
                  day.isToday && "bg-[#4a38f5]/[0.02]",
                )}
              >
                {/* Date Header */}
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium tabular-nums",
                        day.isToday
                          ? "bg-[#4a38f5] font-semibold text-white"
                          : day.isCurrentMonth
                            ? "text-[#111111]"
                            : "text-[#aaaaaa]",
                      )}
                    >
                      {day.dayNumber}
                    </span>

                    {dayDeals.length > 0 && (
                      <div className="flex items-center gap-1 text-[10px]">
                        <span className="font-mono font-medium text-[#111111] tabular-nums">
                          {moneyFormatter.format(dayBudget)}
                        </span>
                        <span className="rounded bg-[#f0f0f0] px-1 py-0.2 font-mono text-[#666666]">
                          {dayDeals.length}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Deals Pills */}
                  <div className="space-y-1">
                    {dayDeals.slice(0, 3).map((deal) => {
                      const stage = stagesById.get(deal.stageId);
                      const colorPreset = stageColor(stage?.colorKey);
                      const isWon = stage?.isWon ?? false;
                      const isLost = stage?.isLost ?? false;

                      return (
                        <div
                          key={deal.id}
                          onClick={() => onOpenDeal?.(deal.id)}
                          title={`${deal.title} (${moneyFormatter.format(deal.budget)}) — ${stage?.name ?? ""}`}
                          className={cn(
                            "group flex cursor-pointer items-center justify-between gap-1 rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-1 text-left shadow-2xs hover:border-[#cccccc] transition-colors",
                            isWon && "border-emerald-200 bg-emerald-50/50",
                            isLost && "bg-[#fafafa] opacity-60",
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 shrink-0 rounded-full",
                                colorPreset.dot,
                              )}
                            />
                            <span
                              className={cn(
                                "truncate text-[11px] font-medium leading-tight",
                                isWon
                                  ? "text-emerald-900"
                                  : isLost
                                    ? "text-[#888888] line-through"
                                    : "text-[#111111] group-hover:text-[#4a38f5]",
                              )}
                            >
                              {deal.title}
                            </span>
                          </div>

                          <span className="shrink-0 font-mono text-[10px] text-[#666666] tabular-nums">
                            {moneyFormatter.format(deal.budget)}
                          </span>
                        </div>
                      );
                    })}

                    {dayDeals.length > 3 && (
                      <button
                        type="button"
                        onClick={() => setSelectedDayModal(day.dateStr)}
                        className="w-full pt-0.5 text-center text-[10px] font-medium text-[#4a38f5] hover:underline"
                      >
                        + ещё {dayDeals.length - 3} сделок
                      </button>
                    )}
                  </div>
                </div>

                {/* Day bottom hint */}
                <div />
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Day Deals Modal */}
      {selectedDayModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
          onClick={() => setSelectedDayModal(null)}
        >
          <div
            className="w-full max-w-lg rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3">
              <div>
                <h3 className="text-sm font-semibold text-[#111111]">
                  Сделки на{" "}
                  {new Intl.DateTimeFormat("ru-RU", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  }).format(new Date(selectedDayModal))}
                </h3>
                <p className="text-xs text-[#666666]">
                  Всего {selectedDayDeals.length} сделок на сумму{" "}
                  {moneyFormatter.format(
                    selectedDayDeals.reduce((sum, d) => sum + d.budget, 0),
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDayModal(null)}
                className="rounded-[6px] p-1 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-96 space-y-2 overflow-y-auto p-4">
              {selectedDayDeals.map((deal) => {
                const stage = stagesById.get(deal.stageId);
                const colorPreset = stageColor(stage?.colorKey);
                const owner = deal.ownerId ? usersById.get(deal.ownerId) : undefined;

                return (
                  <div
                    key={deal.id}
                    onClick={() => {
                      setSelectedDayModal(null);
                      onOpenDeal?.(deal.id);
                    }}
                    className="flex cursor-pointer items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-white p-3 shadow-2xs hover:border-[#cccccc] transition-colors"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className={cn("h-2 w-2 rounded-full", colorPreset.dot)} />
                        <span className="text-xs font-medium text-[#666666]">
                          {stage?.name ?? "Без этапа"}
                        </span>
                      </div>
                      <p className="truncate text-sm font-semibold text-[#111111]">
                        {deal.title}
                      </p>
                      <p className="text-xs text-[#888888]">
                        {deal.companyName || deal.contactName || "Контакт не указан"}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span className="font-mono text-sm font-semibold text-[#111111] tabular-nums">
                        {moneyFormatter.format(deal.budget)}
                      </span>
                      <UserAvatar user={owner} size="sm" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
