"use client";

import { useMemo, useState } from "react";
import {
  BellRing,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { useCheckTaskReminders, type TaskDTO } from "@/lib/api/use-tasks";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { cn } from "@/lib/utils";

interface TasksCalendarViewProps {
  tasks: TaskDTO[];
  usersById: Map<string, TenantUserDTO>;
  onTaskClick: (task: TaskDTO) => void;
  onToggleStatus: (task: TaskDTO) => void;
}

const WEEK_DAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

const PRIORITY_COLORS: Record<string, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-500",
  low: "bg-slate-400",
};

function formatIsoDate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export function TasksCalendarView({
  tasks,
  usersById,
  onTaskClick,
  onToggleStatus,
}: TasksCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [showUnscheduled, setShowUnscheduled] = useState(false);

  const checkReminders = useCheckTaskReminders();

  const handleCheckReminders = async () => {
    try {
      const res = await checkReminders.mutateAsync();
      toast.success(
        `Проверка напоминаний: проверено ${res.checked}, отправлено ${res.sent}`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось проверить напоминания",
      );
    }
  };

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

  // Calendar cells generation
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Monday is 0, Sunday is 6 in Russian week
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

    // Next month filler days to complete rows (multiple of 7)
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

  // Group tasks by date string (YYYY-MM-DD)
  const { tasksByDate, unscheduledTasks } = useMemo(() => {
    const map = new Map<string, TaskDTO[]>();
    const unscheduled: TaskDTO[] = [];

    for (const task of tasks) {
      if (!task.dueDate) {
        unscheduled.push(task);
        continue;
      }

      const datePart = task.dueDate.slice(0, 10);
      const existing = map.get(datePart) ?? [];
      existing.push(task);
      map.set(datePart, existing);
    }

    return { tasksByDate: map, unscheduledTasks: unscheduled };
  }, [tasks]);

  const goToPrevMonth = () => {
    setCurrentDate(new Date(year, month - 1, 1));
  };

  const goToNextMonth = () => {
    setCurrentDate(new Date(year, month + 1, 1));
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  return (
    <div className="space-y-4">
      {/* Calendar Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-white p-3 shadow-2xs">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={goToPrevMonth}
              aria-label="Предыдущий месяц"
              className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={goToNextMonth}
              aria-label="Следующий месяц"
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

        <div className="flex items-center gap-2">
          {unscheduledTasks.length > 0 && (
            <button
              type="button"
              onClick={() => setShowUnscheduled(!showUnscheduled)}
              className={cn(
                "flex items-center gap-1.5 rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors",
                showUnscheduled
                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111]",
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              Без срока ({unscheduledTasks.length})
            </button>
          )}

          <button
            type="button"
            onClick={handleCheckReminders}
            disabled={checkReminders.isPending}
            title="Проверить и отправить напоминания о дедлайнах"
            className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#666666] hover:border-[#cccccc] hover:text-[#111111] transition-colors disabled:opacity-50"
          >
            {checkReminders.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <BellRing className="h-3.5 w-3.5 text-[#888888]" />
            )}
            <span>Напоминания</span>
          </button>
        </div>
      </div>

      {/* Unscheduled tasks drawer */}
      {showUnscheduled && unscheduledTasks.length > 0 && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3 shadow-2xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-[#666666]">
              Задачи без указанного срока ({unscheduledTasks.length})
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {unscheduledTasks.map((task) => {
              const isDone = task.status === "done";
              const assignee = usersById.get(task.assigneeId);

              return (
                <div
                  key={task.id}
                  onClick={() => onTaskClick(task)}
                  className={cn(
                    "group flex cursor-pointer items-center justify-between gap-2 rounded-[6px] border border-[#e5e5e5] bg-white p-2 shadow-2xs hover:border-[#cccccc] transition-colors",
                    isDone && "bg-[#fafafa] opacity-60",
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStatus(task);
                      }}
                      className={cn(
                        "shrink-0",
                        isDone
                          ? "text-[#15803d]"
                          : "text-[#888888] hover:text-[#15803d]",
                      )}
                    >
                      {isDone ? (
                        <Check className="h-3.5 w-3.5 stroke-[2.5]" />
                      ) : (
                        <Circle className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <span
                      className={cn(
                        "truncate text-xs font-medium",
                        isDone ? "text-[#888888] line-through" : "text-[#111111]",
                      )}
                    >
                      {task.title}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        PRIORITY_COLORS[task.priority] ?? "bg-slate-400",
                      )}
                    />
                    <UserAvatar user={assignee} size="sm" />
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

        {/* Days cells */}
        <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-[#e5e5e5]">
          {calendarDays.map((day) => {
            const dayTasks = tasksByDate.get(day.dateStr) ?? [];

            return (
              <div
                key={day.dateStr}
                className={cn(
                  "min-h-[110px] p-1.5 transition-colors",
                  day.isCurrentMonth ? "bg-white" : "bg-[#fafafa]/60 text-[#bbbbbb]",
                  day.isToday && "bg-[#4a38f5]/[0.02]",
                )}
              >
                {/* Date header */}
                <div className="mb-1 flex items-center justify-between">
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
                  {dayTasks.length > 0 && (
                    <span className="text-[10px] font-mono text-[#888888]">
                      {dayTasks.length}
                    </span>
                  )}
                </div>

                {/* Day tasks */}
                <div className="space-y-1">
                  {dayTasks.slice(0, 4).map((task) => {
                    const isDone = task.status === "done";
                    const assignee = usersById.get(task.assigneeId);

                    return (
                      <div
                        key={task.id}
                        onClick={() => onTaskClick(task)}
                        title={`${task.title}${task.isOverdue ? " (Просрочено!)" : ""}`}
                        className={cn(
                          "group flex cursor-pointer items-center justify-between gap-1 rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-1 text-left shadow-2xs hover:border-[#cccccc] transition-colors",
                          isDone && "bg-[#fafafa] opacity-60",
                          task.isOverdue && !isDone && "border-rose-200 bg-rose-50/50",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onToggleStatus(task);
                            }}
                            className={cn(
                              "shrink-0",
                              isDone
                                ? "text-[#15803d]"
                                : "text-[#888888] hover:text-[#15803d]",
                            )}
                          >
                            {isDone ? (
                              <Check className="h-3 w-3 stroke-[2.5]" />
                            ) : (
                              <Circle className="h-3 w-3" />
                            )}
                          </button>
                          <span
                            className={cn(
                              "truncate text-[11px] font-medium leading-tight",
                              isDone ? "text-[#888888] line-through" : "text-[#111111]",
                            )}
                          >
                            {task.title}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              PRIORITY_COLORS[task.priority] ?? "bg-slate-400",
                            )}
                          />
                          <UserAvatar user={assignee} size="sm" />
                        </div>
                      </div>
                    );
                  })}

                  {dayTasks.length > 4 && (
                    <div className="pt-0.5 text-center text-[10px] text-[#888888]">
                      + ещё {dayTasks.length - 4}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
