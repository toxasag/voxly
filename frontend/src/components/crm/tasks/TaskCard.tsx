"use client";

import { memo, useCallback } from "react";
import { Check, Circle, Calendar, User, AlertCircle, Link2 } from "lucide-react";
import type { CrmTask, TaskPriority } from "@/types";
import { cn } from "@/lib/utils";

interface TaskCardProps {
  task: CrmTask;
  onToggle: (id: string) => void;
}

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  high: "border-l-rose-500",
  medium: "border-l-amber-500",
  low: "border-l-slate-300",
};

const PRIORITY_BADGE: Record<TaskPriority, string> = {
  high: "bg-rose-50 text-rose-700 border-rose-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

function formatDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const formatted = new Intl.DateTimeFormat("ru-RU", { month: "short", day: "2-digit" }).format(d);
  if (diffDays < 0) return `${formatted} · просрочено`;
  if (diffDays === 0) return `${formatted} · сегодня`;
  if (diffDays === 1) return `${formatted} · завтра`;
  return formatted;
}

export const TaskCard = memo(function TaskCard({ task, onToggle }: TaskCardProps) {
  const handleToggle = useCallback(() => onToggle(task.id), [onToggle, task.id]);
  const isDone = task.status === "done";

  return (
    <div
      className={cn(
        "rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 transition-all duration-200 border-l-[3px] cursor-pointer hover:border-[#cccccc] hover:shadow-2xs",
        PRIORITY_COLORS[task.priority],
        isDone && "opacity-60 bg-[#fafafa]",
      )}
      onClick={handleToggle}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleToggle(); }}
          className={cn(
            "mt-0.5 shrink-0 rounded-full transition-all duration-300 ease-out",
            isDone ? "text-[#15803d] scale-110" : "text-[#888888] hover:text-[#15803d]",
          )}
        >
          {isDone ? <Check className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
        </button>
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className={cn("text-[13px] font-medium leading-snug", isDone ? "text-[#888888] line-through" : "text-[#111111]")}>
            {task.title}
          </p>
          {task.description && !isDone && <p className="text-xs text-[#666666] line-clamp-2">{task.description}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-xs font-medium", PRIORITY_BADGE[task.priority])}>
              <AlertCircle className="h-2.5 w-2.5" />
              {PRIORITY_LABELS[task.priority]}
            </span>
            {task.due_date && (
              <span className={cn("flex items-center gap-1 text-xs", new Date(task.due_date).getTime() < Date.now() && !isDone ? "text-rose-600 font-medium" : "text-[#888888]")}>
                <Calendar className="h-3 w-3" />
                {formatDue(task.due_date)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-xs text-[#888888]">
            <span className="flex items-center gap-1"><User className="h-3 w-3" />{task.assignee_name}</span>
            {task.linked_entity_label && <span className="flex items-center gap-1"><Link2 className="h-3 w-3" />{task.linked_entity_label}</span>}
          </div>
        </div>
      </div>
    </div>
  );
});