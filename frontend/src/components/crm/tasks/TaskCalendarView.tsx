"use client";

import { memo, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Check,
  Circle,
  AlertCircle,
  Clock,
} from "lucide-react";
import type { TaskDTO, TaskPriority } from "@/lib/api/use-tasks";
import { cn } from "@/lib/utils";

interface TaskCalendarViewProps {
  tasks: TaskDTO[];
  onTaskClick: (task: TaskDTO) => void;
  onToggleStatus: (task: TaskDTO) => void;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] as const;

const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

const PRIORITY_DOT: Record<TaskPriority, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-500",
  low: "bg-slate-300",
};

/**
 * Возвращает массив дней для отображения сетки месяца (с ведущими и завершающими
 * днями соседних месяцев для заполнения полных 7-дневных недель).
 */
function getCalendarDays(year: number, month: number): { date: Date; isCurrentMonth: boolean }[] {
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  // День недели первого дня: 0 (Вс) -> 6, 1 (Пн) -> 0
  const firstDayWeekday = (firstDayOfMonth.getDay() + 6) % 7;
  const daysInMonth = lastDayOfMonth.getDate();

  const days: { date: Date; isCurrentMonth: boolean }[] = [];

  // Дни предыдущего месяца
  const prevMonthLastDay = new Date(year, month, 0).getDate();
  for (let i = firstDayWeekday - 1; i >= 0; i--) {
    days.push({
      date: new Date(year, month - 1, prevMonthLastDay - i),
      isCurrentMonth: false,
    });
  }

  // Дни текущего месяца
  for (let day = 1; day <= daysInMonth; day++) {
    days.push({
      date: new Date(year, month, day),
      isCurrentMonth: true,
    });
  }

  // Дни следующего месяца до завершения недели
  const remaining = (7 - (days.length % 7)) % 7;
  for (let day = 1; day <= remaining; day++) {
    days.push({
      date: new Date(year, month + 1, day),
      isCurrentMonth: false,
    });
  }

  return days;
}

function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const TaskCalendarView = memo(function TaskCalendarView({
  tasks,
  onTaskClick,
  onToggleStatus,
}: TaskCalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [showUnscheduled, setShowUnscheduled] = useState(false);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const today = useMemo(() => new Date(), []);

  const calendarDays = useMemo(() => getCalendarDays(year, month), [year, month]);

  // Индексируем задачи по дням
  const { tasksByDay, unscheduledTasks, monthTaskCount } = useMemo(() => {
    const map = new Map<string, TaskDTO[]>();
    const unscheduled: TaskDTO[] = [];
    let countInMonth = 0;

    for (const task of tasks) {
      if (!task.dueDate) {
        unscheduled.push(task);
        continue;
      }
      const due = new Date(task.dueDate);
      if (Number.isNaN(due.getTime())) {
        unscheduled.push(task);
        continue;
      }

      if (due.getFullYear() === year && due.getMonth() === month) {
        countInMonth++;
      }

      const key = toDateKey(due);
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    }

    return { tasksByDay: map, unscheduledTasks: unscheduled, monthTaskCount: countInMonth };
  }, [tasks, year, month]);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToToday = () => setCurrentDate(new Date());

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden flex flex-col">
      {/* Шапка управления месяцем */}
      <div className="flex flex-wrap items-center justify-between border-b border-[#e5e5e5] bg-white px-4 py-2.5 gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold text-[#111111]">
              {MONTH_NAMES[month]} {year}
            </h2>
            <span className="rounded-full bg-[#f5f5f5] px-2 py-0.5 text-[11px] font-mono text-[#666666] tabular-nums">
              {monthTaskCount}
            </span>
          </div>
          <button
            type="button"
            onClick={goToToday}
            className="rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
          >
            Сегодня
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Предыдущий месяц"
            className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Следующий месяц"
            className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Дни недели */}
      <div className="grid grid-cols-7 border-b border-[#e5e5e5] bg-[#fafafa]">
        {WEEKDAYS.map((name, index) => (
          <div
            key={name}
            className={cn(
              "py-1.5 text-center text-[11px] font-semibold tracking-wider uppercase",
              index >= 5 ? "text-[#888888]" : "text-[#666666]",
            )}
          >
            {name}
          </div>
        ))}
      </div>

      {/* Сетка календаря */}
      <div className="grid grid-cols-7 auto-rows-fr divide-x divide-y divide-[#e5e5e5]">
        {calendarDays.map(({ date, isCurrentMonth }, idx) => {
          const key = toDateKey(date);
          const dayTasks = tasksByDay.get(key) ?? [];
          const isToday = isSameDay(date, today);

          return (
            <div
              key={idx}
              className={cn(
                "min-h-[110px] p-1.5 transition-colors flex flex-col group",
                isCurrentMonth ? "bg-white" : "bg-[#fbfbfb]/80",
                !isCurrentMonth && "opacity-60",
              )}
            >
              {/* Число дня */}
              <div className="flex items-center justify-between mb-1 px-1">
                <span
                  className={cn(
                    "text-xs font-mono",
                    isToday
                      ? "flex h-5 w-5 items-center justify-center rounded-full bg-[#4a38f5] font-bold text-white shadow-2xs"
                      : isCurrentMonth
                        ? "font-medium text-[#111111]"
                        : "text-[#888888]",
                  )}
                >
                  {date.getDate()}
                </span>
                {dayTasks.length > 0 && (
                  <span className="text-[10px] font-mono text-[#888888]">
                    {dayTasks.length}
                  </span>
                )}
              </div>

              {/* Карточки задач дня */}
              <div className="space-y-1 flex-1 overflow-y-auto max-h-[120px]">
                {dayTasks.map((task) => {
                  const isDone = task.status === "done";
                  return (
                    <div
                      key={task.id}
                      onClick={() => onTaskClick(task)}
                      className={cn(
                        "group/task flex items-center gap-1.5 rounded-[4px] border border-[#e5e5e5] px-1.5 py-1 text-[11px] transition-all cursor-pointer",
                        isDone
                          ? "bg-[#fafafa] text-[#888888] line-through border-transparent"
                          : "bg-white hover:border-[#cccccc] hover:shadow-2xs text-[#111111]",
                      )}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onToggleStatus(task);
                        }}
                        className={cn(
                          "shrink-0 transition-colors",
                          isDone ? "text-[#15803d]" : "text-[#888888] hover:text-[#15803d]",
                        )}
                      >
                        {isDone ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                      </button>

                      <span
                        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])}
                      />

                      <span className="truncate flex-1 font-medium leading-tight">
                        {task.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Панель задач без дедлайна */}
      {unscheduledTasks.length > 0 && (
        <div className="border-t border-[#e5e5e5] bg-[#fafafa] p-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowUnscheduled((prev) => !prev)}
              className="flex items-center gap-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
            >
              <Clock className="h-3.5 w-3.5 text-[#888888]" />
              <span>Без срока исполнения ({unscheduledTasks.length})</span>
            </button>
          </div>

          {showUnscheduled && (
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
              {unscheduledTasks.map((task) => {
                const isDone = task.status === "done";
                return (
                  <div
                    key={task.id}
                    onClick={() => onTaskClick(task)}
                    className={cn(
                      "flex items-center gap-2 rounded-[6px] border border-[#e5e5e5] bg-white p-2 text-xs transition-colors cursor-pointer hover:border-[#cccccc] shadow-2xs",
                      isDone && "opacity-60 bg-[#fafafa]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleStatus(task);
                      }}
                      className={cn(
                        "shrink-0 transition-colors",
                        isDone ? "text-[#15803d]" : "text-[#888888] hover:text-[#15803d]",
                      )}
                    >
                      {isDone ? <Check className="h-3.5 w-3.5" /> : <Circle className="h-3.5 w-3.5" />}
                    </button>
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", PRIORITY_DOT[task.priority])} />
                    <span className={cn("truncate flex-1 font-medium", isDone && "line-through text-[#888888]")}>
                      {task.title}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
