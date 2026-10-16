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
  low: "border-l-slate-600",
};

const PRIORITY_BADGE: Record<TaskPriority, string> = {
  high: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  medium: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  low: "bg-slate-800 text-slate-400 border-slate-700",
};

function formatDue(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const formatted = new Intl.DateTimeFormat("ru-RU", { month: "short", day: "2-digit" }).format(d);
  if (diffDays < 0) return `${formatted} · overdue`;
  if (diffDays === 0) return `${formatted} · today`;
  if (diffDays === 1) return `${formatted} · tomorrow`;
  return formatted;
}

export const TaskCard = memo(function TaskCard({ task, onToggle }: TaskCardProps) {
  const handleToggle = useCallback(() => onToggle(task.id), [onToggle, task.id]);
  const isDone = task.status === "done";

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-800 bg-slate-900 p-3.5 transition-all duration-200 border-l-[3px] cursor-pointer hover:border-slate-700 hover:bg-slate-800/50",
        PRIORITY_COLORS[task.priority],
        isDone && "opacity-60 grayscale",
      )}
      onClick={handleToggle}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleToggle(); }}
          className={cn(
            "mt-0.5 shrink-0 rounded-full transition-all duration-300 ease-out",
            isDone ? "text-emerald-400 scale-110" : "text-slate-600 hover:text-emerald-400",
          )}
        >
          {isDone ? <Check className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
        </button>
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className={cn("text-sm font-medium leading-snug", isDone ? "text-slate-500 line-through" : "text-slate-200")}>
            {task.title}
          </p>
          {task.description && !isDone && <p className="text-xs text-slate-500 line-clamp-2">{task.description}</p>}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium border-slate-700 text-slate-400"><AlertCircle className="h-2.5 w-2.5" />{task.priority}</span>
            {task.due_date && <span className={cn("flex items-center gap-1 text-xs", new Date(task.due_date).getTime() < Date.now() && !isDone ? "text-rose-400" : "text-slate-500")}><Calendar className="h-3 w-3" />{formatDue(task.due_date)}</span>}
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-xs text-slate-500"><User className="h-3 w-3" />{task.assignee_name}</span>
            {task.linked_entity_label && <span className="flex items-center gap-1 text-xs text-slate-500"><Link2 className="h-3 w-3" />{task.linked_entity_label}</span>}
          </div>
        </div>
      </div>
    </div>
  );
});