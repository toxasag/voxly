"use client";

import { useState } from "react";
import { Calendar, Check, Circle, ExternalLink, Loader2, ListChecks, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { TaskModal } from "@/components/crm/tasks/TaskModal";
import {
  useCreateTask,
  useDeleteTask,
  useTasks,
  useToggleTaskStatus,
  useUpdateTask,
  type LinkedEntityType,
  type TaskDTO,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/api/use-tasks";
import { useTenantUsers, indexTenantUsers } from "@/lib/api/use-tenant-users";
import { useAuth } from "@/lib/auth/use-auth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Вкладка «Задачи» карточки записи (сделка, контакт, компания).
//
// Образец — вкладка Tasks в Twenty (`TasksCardContent` + `TaskList`): список
// задач записи с чекбоксом завершения, созданием и редактированием. Задача
// создаётся уже привязанной к текущей записи. При создании в сделке связь
// автоматически наследуется прикреплёнными контактом и компанией.
// ---------------------------------------------------------------------------

interface RecordTasksTabProps {
  targetType: LinkedEntityType;
  targetId: string;
  canWrite?: boolean;
  dealId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  high: "Высокий",
  medium: "Средний",
  low: "Низкий",
};

const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-[#e5e5e5] bg-[#fafafa] text-[#666666]",
};

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "К выполнению",
  in_progress: "В работе",
  done: "Выполнено",
};

const STATUS_CLASSES: Record<TaskStatus, string> = {
  todo: "border-slate-200 bg-slate-50 text-slate-700",
  in_progress: "border-sky-200 bg-sky-50 text-sky-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

function formatDue(value: string | null): string {
  if (value === null) return "без срока";

  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long" }).format(new Date(value));
}

export function RecordTasksTab({
  targetType,
  targetId,
  canWrite = true,
  dealId,
  contactId,
  companyId,
}: RecordTasksTabProps) {
  const { user } = useAuth();
  const tasks = useTasks({ linkedEntityType: targetType, linkedEntityId: targetId });
  const tenantUsers = useTenantUsers();
  const create = useCreateTask();
  const update = useUpdateTask();
  const toggle = useToggleTaskStatus();
  const remove = useDeleteTask();

  const [composing, setComposing] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskDTO | null>(null);

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
        deal_id: targetType === "deal" ? targetId : dealId ?? undefined,
        contact_id: targetType === "contact" ? targetId : contactId ?? undefined,
        company_id: targetType === "company" ? targetId : companyId ?? undefined,
      },
      {
        onSuccess: () => {
          setTitle("");
          setDueDate("");
          setPriority("medium");
          setComposing(false);
          toast.success("Задача создана");
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
          "group flex items-start gap-2.5 rounded-[8px] border border-[#e5e5e5] bg-white p-3 transition-colors hover:border-[#cccccc]",
          done && "opacity-60 bg-[#fafafa]",
        )}
      >
        <button
          type="button"
          disabled={!canWrite}
          onClick={(e) => {
            e.stopPropagation();
            toggle.mutate(
              { id: task.id, status: done ? "todo" : "done" },
              { onError: (error) => toast.error(error.message) },
            );
          }}
          aria-label={done ? "Вернуть в работу" : "Завершить задачу"}
          className={cn("mt-0.5 shrink-0", done ? "text-[#15803d]" : "text-[#888888] hover:text-[#15803d]")}
        >
          {done ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
        </button>

        <div
          className={cn("min-w-0 flex-1", canWrite && "cursor-pointer")}
          onClick={() => canWrite && setEditingTask(task)}
        >
          <div className="flex items-center gap-2">
            <p className={cn("text-[13px] font-medium leading-snug", done ? "text-[#888888] line-through" : "text-[#111111]")}>
              {task.title}
            </p>
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-medium leading-tight", STATUS_CLASSES[task.status])}>
              {STATUS_LABELS[task.status]}
            </span>
          </div>

          {task.description ? (
            <p className="mt-1 line-clamp-1 text-xs text-[#666666]">{task.description}</p>
          ) : null}

          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[#888888]">
            <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", PRIORITY_CLASSES[task.priority])}>
              {PRIORITY_LABELS[task.priority]}
            </span>
            <span className={cn("inline-flex items-center gap-1", task.isOverdue && "font-medium text-rose-600")}>
              <Calendar className="h-3 w-3" />{formatDue(task.dueDate)}
            </span>
            {assignee !== undefined && <UserAvatar user={assignee} size="sm" />}
          </div>
        </div>

        {canWrite && (
          <div className="flex items-center gap-1 shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setEditingTask(task);
              }}
              aria-label="Редактировать задачу"
              className="rounded p-1 text-[#888888] hover:text-[#4a38f5] transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                remove.mutate(task.id, { onError: (error) => toast.error(error.message) });
              }}
              aria-label="Удалить задачу"
              className="rounded p-1 text-[#888888] hover:text-rose-600 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="space-y-3 p-4">
      {canWrite && (
        composing ? (
          <div className="space-y-2 rounded-[16px] border border-[#e5e5e5] bg-white p-3 shadow-2xs">
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
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            <div className="flex items-center gap-2">
              <select
                aria-label="Приоритет"
                value={priority}
                onChange={(event) => setPriority(event.target.value as TaskPriority)}
                className="rounded-[8px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
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
                className="rounded-[8px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <button
                type="button"
                onClick={() => {
                  setComposing(false);
                  setCreateModalOpen(true);
                }}
                className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-xs text-[#666666] hover:text-[#4a38f5] transition-colors"
                title="Открыть подробную форму создания"
              >
                <ExternalLink className="h-3 w-3" />
                Форма
              </button>
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setComposing(false); setTitle(""); }}
                  className="rounded-[8px] px-2.5 py-1 text-xs text-[#666666] hover:text-[#111111]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={create.isPending || title.trim() === "" || user === null}
                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
                >
                  {create.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                  Создать
                </button>
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setComposing(true)}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
            >
              <Plus className="h-3.5 w-3.5" />
              Новая задача
            </button>
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="inline-flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-xs font-medium text-[#666666] transition-colors hover:text-[#111111]"
            >
              <ExternalLink className="h-3 w-3" />
              Подробная форма
            </button>
          </div>
        )
      )}

      {tasks.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : tasks.isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
          <p className="text-sm font-medium text-rose-800">Не удалось загрузить задачи</p>
          <button
            type="button"
            onClick={() => void tasks.refetch()}
            className="mt-1.5 text-xs font-medium text-rose-700 hover:text-rose-900"
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

      {editingTask !== null && (
        <TaskModal
          open
          onClose={() => setEditingTask(null)}
          onSubmit={async (payload) => {
            await update.mutateAsync({
              id: editingTask.id,
              payload: {
                title: payload.title,
                description: payload.description,
                priority: payload.priority,
                status: payload.status,
                due_date: payload.due_date,
                assignee_id: payload.assignee_id,
                linked_entity_type: payload.linked_entity_type,
                linked_entity_id: payload.linked_entity_id,
                deal_id: targetType === "deal" ? targetId : dealId ?? undefined,
                contact_id: targetType === "contact" ? targetId : contactId ?? undefined,
                company_id: targetType === "company" ? targetId : companyId ?? undefined,
              },
            });
            toast.success("Задача обновлена");
            setEditingTask(null);
          }}
          assigneeId={user?.id ?? ""}
          initial={{
            title: editingTask.title,
            description: editingTask.description,
            priority: editingTask.priority,
            status: editingTask.status,
            due_date: editingTask.dueDate ?? "",
            assignee_id: editingTask.assigneeId,
            linked_entity_type: (editingTask.linkedEntityType ?? targetType) as LinkedEntityType,
            linked_entity_id: editingTask.linkedEntityId ?? targetId,
          }}
          title="Редактировать задачу"
        />
      )}

      {createModalOpen && (
        <TaskModal
          open
          onClose={() => setCreateModalOpen(false)}
          onSubmit={async (payload) => {
            await create.mutateAsync({
              ...payload,
              deal_id: targetType === "deal" ? targetId : dealId ?? undefined,
              contact_id: targetType === "contact" ? targetId : contactId ?? undefined,
              company_id: targetType === "company" ? targetId : companyId ?? undefined,
            });
            toast.success("Задача создана");
            setCreateModalOpen(false);
          }}
          assigneeId={user?.id ?? ""}
          initial={{
            title: title,
            description: "",
            priority: priority,
            status: "todo",
            due_date: dueDate === "" ? "" : new Date(`${dueDate}T12:00:00`).toISOString(),
            assignee_id: user?.id ?? "",
            linked_entity_type: targetType,
            linked_entity_id: targetId,
          }}
          title="Новая задача"
        />
      )}
    </div>
  );
}
