"use client";

import { useState } from "react";
import { Calendar, Check, Circle, Loader2, ListChecks, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { UserAvatar } from "@/components/shared/UserAvatar";
import {
  useCreateTask,
  useDeleteTask,
  useTasks,
  useToggleTaskStatus,
  type LinkedEntityType,
  type TaskDTO,
  type TaskPriority,
} from "@/lib/api/use-tasks";
import { useTenantUsers, indexTenantUsers } from "@/lib/api/use-tenant-users";
import { useAuth } from "@/lib/auth/use-auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Вкладка «Задачи» карточки записи.
//
// Образец — вкладка Tasks в Twenty (`TasksCardContent` + `TaskList`): список
// задач записи с чекбоксом завершения и созданием прямо здесь. Как у них, задача
// создаётся уже привязанной к текущей записи — связь не спрашивается, потому что
// она известна из контекста карточки.
//
// Исполнителем по умолчанию становится текущий пользователь: у Twenty
// `assigneeId` при создании из карточки тоже берётся из сессии.
// ---------------------------------------------------------------------------

interface RecordTasksTabProps {
  targetType: LinkedEntityType;
  targetId: string;
  canWrite?: boolean;
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  high: "border-rose-500/30 bg-rose-500/10 text-rose-400",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  low: "border-slate-700 bg-slate-800 text-slate-400",
};

function formatDue(value: string | null): string {
  if (value === null) return "без срока";

  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long" }).format(new Date(value));
}

export function RecordTasksTab({ targetType, targetId, canWrite = true }: RecordTasksTabProps) {
  const { user } = useAuth();
  const tasks = useTasks({ linkedEntityType: targetType, linkedEntityId: targetId });
  const tenantUsers = useTenantUsers();
  const create = useCreateTask();
  const toggle = useToggleTaskStatus();
  const remove = useDeleteTask();

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [dueDate, setDueDate] = useState("");

  const usersById = indexTenantUsers(tenantUsers.data);

  const submit = (): void => {
    const trimmed = title.trim();
    if (trimmed === "" || user === null || user === undefined) return;

    create.mutate(
      {
        title: trimmed,
        priority,
        // Дата из <input type="date"> приходит без времени; бэкенд ждёт ISO 8601.
        due_date: dueDate === "" ? undefined : new Date(`${dueDate}T12:00:00`).toISOString(),
        assignee_id: user.id,
        linked_entity_type: targetType,
        linked_entity_id: targetId,
      },
      {
        onSuccess: () => {
          setTitle("");
          setDueDate("");
          setPriority("medium");
          setComposing(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const renderTask = (task: TaskDTO) => {
    const done = task.status === "done";
    const assignee = usersById.get(task.assigneeId);

    return (
      <article
        key={task.id}
        className={cn(
          "group flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3",
          done && "opacity-60",
        )}
      >
        <button
          type="button"
          disabled={!canWrite}
          onClick={() => toggle.mutate(
            { id: task.id, status: done ? "todo" : "done" },
            { onError: (error) => toast.error(error.message) },
          )}
          aria-label={done ? "Вернуть в работу" : "Завершить задачу"}
          className={cn("mt-0.5 shrink-0", done ? "text-emerald-400" : "text-slate-600 hover:text-emerald-400")}
        >
          {done ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1">
          <p className={cn("text-sm", done ? "text-slate-500 line-through" : "text-slate-200")}>{task.title}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className={cn("rounded-full border px-1.5 py-0.5", PRIORITY_CLASSES[task.priority])}>
              {PRIORITY_LABELS[task.priority]}
            </span>
            <span className={cn("inline-flex items-center gap-1", task.isOverdue && "font-medium text-rose-400")}>
              <Calendar className="h-3 w-3" />{formatDue(task.dueDate)}
            </span>
            {assignee !== undefined && <UserAvatar user={assignee} size="sm" />}
          </div>
        </div>

        {canWrite && (
          <button
            type="button"
            onClick={() => remove.mutate(task.id, { onError: (error) => toast.error(error.message) })}
            aria-label="Удалить задачу"
            className="shrink-0 rounded p-1 text-slate-600 opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-3 p-4">
      {canWrite && (
        composing ? (
          <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-950/60 p-2">
            <input
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setComposing(false);
                }
              }}
              placeholder="Что нужно сделать?"
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <select
                aria-label="Приоритет"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              >
                <option value="high">Высокий</option>
                <option value="medium">Средний</option>
                <option value="low">Низкий</option>
              </select>
              <input
                type="date"
                aria-label="Срок"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
                className="rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs text-slate-100 focus:border-amber-500 focus:outline-none"
              />
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setComposing(false); setTitle(""); }}
                  className="rounded px-2 py-1 text-xs text-slate-400 hover:text-slate-200"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={create.isPending || title.trim() === "" || user === null}
                  className="inline-flex items-center gap-1.5 rounded bg-amber-500 px-2.5 py-1 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-50"
                >
                  {create.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Создать
                </button>
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800"
          >
            <Plus className="h-3.5 w-3.5" />
            Новая задача
          </button>
        )
      )}

      {tasks.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : tasks.isError ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="text-sm text-slate-200">Не удалось загрузить задачи</p>
          <button
            type="button"
            onClick={() => void tasks.refetch()}
            className="mt-1.5 text-xs text-slate-300 hover:text-slate-100"
          >
            Повторить
          </button>
        </div>
      ) : tasks.data === undefined || tasks.data.items.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Задач нет"
          description="Задачи по этой записи появятся здесь"
        />
      ) : (
        <div className="space-y-2">{tasks.data.items.map(renderTask)}</div>
      )}
    </div>
  );
}
