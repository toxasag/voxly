"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, ListChecks, LayoutGrid, List, Check, Circle,
  AlertCircle, RefreshCw, Pencil, Trash2, Search, X, Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { Guard } from "@/components/shared/Guard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { TaskModal } from "@/components/crm/tasks/TaskModal";
import { TaskCalendarView } from "@/components/crm/tasks/TaskCalendarView";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { type RecordColumn } from "@/components/crm/shared/RecordTable";
import { SyncedRecordTable } from "@/components/crm/shared/SyncedRecordTable";
import {
  useTask,
  useTasks,
  useToggleTaskStatus,
  useCreateTask,
  useUpdateTask,
  useDeleteTask,
  type TaskDTO,
  type TaskStatus,
} from "@/lib/api/use-tasks";
import { useTenantUsers, indexTenantUsers } from "@/lib/api/use-tenant-users";
import { useAuth } from "@/lib/auth/use-auth";
import type { CreateTaskPayload } from "@/schemas/task.schema";
import { cn } from "@/lib/utils";
import { useRecordParam } from "@/lib/utils/use-record-param";

type View = "table" | "kanban" | "calendar";
type TaskPresetView = "all" | "todo" | "in_progress" | "my" | "overdue" | "high_priority" | "done";

interface PresetTab {
  id: TaskPresetView;
  label: string;
}

const PRESET_TABS: PresetTab[] = [
  { id: "all", label: "Все задачи" },
  { id: "todo", label: "К выполнению" },
  { id: "in_progress", label: "В работе" },
  { id: "my", label: "Мои задачи" },
  { id: "overdue", label: "Просроченные" },
  { id: "high_priority", label: "Высокий приоритет" },
  { id: "done", label: "Выполненные" },
];

/** Display-only labels; the stored priority/status values stay untouched. */
const PRIORITY_LABELS: Record<string, string> = { high: "Высокий", medium: "Средний", low: "Низкий" };
/**
 * Вес приоритета для сортировки.
 *
 * По алфавиту «Высокий» шёл бы перед «Низким», а «Средний» между ними — то есть
 * случайно верно для двух значений из трёх. Числа делают порядок осмысленным.
 */
const PRIORITY_ORDER: Record<string, number> = { high: 3, medium: 2, low: 1 };
const STATUS_LABELS: Record<TaskStatus, string> = { todo: "К выполнению", in_progress: "В работе", done: "Выполнено" };
const LINK_LABELS: Record<string, string> = { deal: "Сделка", contact: "Контакт", company: "Компания" };

const formatDue = (value: string | null) => value ? new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(value)) : "—";

/** Заполняет форму правки из DTO: связь собирается обратно в пару поле+значение. */
function toTaskFormValues(task: TaskDTO): CreateTaskPayload {
  return {
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    due_date: task.dueDate ?? "",
    assignee_id: task.assigneeId,
    linked_entity_type: task.linkedEntityType ?? "",
    linked_entity_id: task.linkedEntityId ?? "",
  };
}

function TasksContent() {
  const { user } = useAuth();
  const [view, setView] = useState<View>("table");
  const [presetView, setPresetView] = useState<TaskPresetView>("all");
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<TaskDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TaskDTO | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickStatus, setQuickStatus] = useState<TaskStatus | null>(null);

  /**
   * У задачи нет отдельной страницы: карточка выражается параметром `?record=`,
   * как у контактов и компаний. Это делает ссылку из палитры поиска рабочей и
   * даёт на телефоне привычное «назад закрывает карточку».
   */
  const {
    recordId: taskRecordId,
    openRecord: openTaskRecord,
    closeRecord: closeTaskRecord,
  } = useRecordParam();
  const taskRecord = useTask(taskRecordId);

  const query = useTasks({ limit: 200 });
  const tenantUsers = useTenantUsers();
  const toggle = useToggleTaskStatus();
  const create = useCreateTask();
  const update = useUpdateTask();
  const remove = useDeleteTask();

  const tasks = query.data?.items ?? [];
  const usersById = useMemo(() => indexTenantUsers(tenantUsers.data), [tenantUsers.data]);

  const presetCounts = useMemo(() => {
    return {
      all: tasks.length,
      todo: tasks.filter((t) => t.status === "todo").length,
      in_progress: tasks.filter((t) => t.status === "in_progress").length,
      my: tasks.filter((t) => t.assigneeId === user?.id && t.status !== "done").length,
      overdue: tasks.filter((t) => t.isOverdue && t.status !== "done").length,
      high_priority: tasks.filter((t) => t.priority === "high" && t.status !== "done").length,
      done: tasks.filter((t) => t.status === "done").length,
    };
  }, [tasks, user?.id]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    switch (presetView) {
      case "todo":
        result = result.filter((t) => t.status === "todo");
        break;
      case "in_progress":
        result = result.filter((t) => t.status === "in_progress");
        break;
      case "my":
        result = result.filter((t) => t.assigneeId === user?.id && t.status !== "done");
        break;
      case "overdue":
        result = result.filter((t) => t.isOverdue && t.status !== "done");
        break;
      case "high_priority":
        result = result.filter((t) => t.priority === "high" && t.status !== "done");
        break;
      case "done":
        result = result.filter((t) => t.status === "done");
        break;
      case "all":
      default:
        break;
    }

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q),
      );
    }

    return result;
  }, [tasks, presetView, user?.id, search]);

  const handleQuickCreate = useCallback(async (status: TaskStatus) => {
    const trimmed = quickTitle.trim();
    if (!trimmed) {
      setQuickStatus(null);
      return;
    }
    try {
      await create.mutateAsync({
        title: trimmed,
        status,
        priority: "medium",
        due_date: "",
        assignee_id: user?.id ?? "",
      });
      toast.success("Задача создана");
      setQuickTitle("");
      setQuickStatus(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось создать задачу");
    }
  }, [create, quickTitle, user?.id]);

  const change = useCallback((task: TaskDTO) => {
    toggle.mutate({ id: task.id, status: task.status === "done" ? "todo" : "done" }, { onError: (error) => toast.error(error.message) });
  }, [toggle]);

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null) return;

    try {
      await remove.mutateAsync(deleteTarget.id);
      toast.success("Задача удалена");
      setDeleteTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить задачу");
    }
  }, [deleteTarget, remove]);

  const editInitial = useMemo(
    () => (editTarget === null ? undefined : toTaskFormValues(editTarget)),
    [editTarget],
  );

  // Внешняя ссылка может указывать на задачу, которой нет в текущем фильтре, поэтому
  // читаем её отдельным запросом, а не ищем только в `tasks` текущего списка.
  useEffect(() => {
    if (taskRecord.data !== undefined) setEditTarget(taskRecord.data);
  }, [taskRecord.data]);

  /**
   * Карточка задачи для канбана.
   *
   * Табличная строка отсюда ушла: её место заняли колонки `RecordTable`, поэтому
   * функция больше не ветвится по `card` — вид выбирается там, где он нужен.
   */
  const renderCard = (task: TaskDTO) => {
    const done = task.status === "done";
    const assignee = usersById.get(task.assigneeId);

    return (
      <div key={task.id} className={cn("group rounded-[8px] border border-[#e5e5e5] bg-white p-3 hover:border-[#cccccc] transition-colors shadow-2xs", done && "opacity-60 bg-[#fafafa]")}>
        <div className="flex gap-2.5">
          <button type="button" onClick={() => change(task)} aria-label={done ? "Вернуть в работу" : "Завершить"} className={done ? "text-[#15803d]" : "text-[#888888] hover:text-[#15803d]"}>{done ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}</button>
          <div className="min-w-0 flex-1">
            <p className={cn("text-[13px] font-medium leading-snug", done ? "text-[#888888] line-through" : "text-[#111111]")}>{task.title}</p>
            <p className="mt-1 text-xs text-[#888888]">Срок {formatDue(task.dueDate)} · {PRIORITY_LABELS[task.priority] ?? task.priority}</p>
            <div className="mt-1.5"><UserAvatar user={assignee} size="sm" /></div>
          </div>
          <Guard requiredPermission="tasks:write">
            {/* На мобильном кнопки видны всегда: `opacity-0 group-hover` рассчитан
                на курсор, которого на телефоне нет. */}
            <span className="flex shrink-0 flex-col gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
              <button type="button" onClick={() => openTaskRecord(task.id)} aria-label="Изменить задачу" className="rounded p-1 text-[#888888] hover:text-[#111111]"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => setDeleteTarget(task)} aria-label="Удалить задачу" className="rounded p-1 text-[#888888] hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
            </span>
          </Guard>
        </div>
      </div>
    );
  };

  /**
   * Колонки таблицы задач.
   *
   * Прежде здесь была своя `<table>` с шестью жёсткими `<th>`, из-за чего страницу
   * обходил весь мобильный режим `RecordTable` — схлопывание первой колонки,
   * отключение ресайза и перетаскивания, адаптивное меню колонок, — и не работали
   * десктопные возможности: выбор видимых колонок, порядок и ширины между визитами.
   *
   * Отметка выполнения идёт первой колонкой, а не отдельной ячейкой слева: у
   * `RecordTable` служебная колонка только одна — чекбоксы выделения, — а
   * идентификатором записи считается первая колонка описания. Поэтому статус и
   * название живут вместе: так строка остаётся опознаваемой и при схлопывании до
   * 38px виден хотя бы значок выполнения.
   */
  const taskColumns = useMemo<RecordColumn<TaskDTO>[]>(() => [
    {
      id: "title",
      header: "Задача",
      width: 300,
      sortValue: (task) => task.title,
      render: (task) => {
        const done = task.status === "done";

        return (
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); change(task); }}
              aria-label={done ? "Вернуть в работу" : "Завершить"}
              className={cn("shrink-0", done ? "text-[#15803d]" : "text-[#888888] hover:text-[#15803d]")}
            >
              {done ? <Check className="h-4 w-4" /> : <Circle className="h-4 w-4" />}
            </button>
            <div className="min-w-0">
              <p className={cn("truncate text-sm font-medium", done ? "text-[#888888] line-through" : "text-[#111111]")}>{task.title}</p>
              {task.description !== "" && <p className="truncate text-xs text-[#888888]">{task.description}</p>}
            </div>
          </div>
        );
      },
    },
    {
      id: "priority",
      header: "Приоритет",
      width: 130,
      hideable: true,
      sortValue: (task) => PRIORITY_ORDER[task.priority] ?? 0,
      render: (task) => (
        <span className={cn(
          "rounded-full border px-2 py-0.5 text-xs font-medium",
          task.priority === "high" ? "border-rose-200 bg-rose-50 text-rose-700"
            : task.priority === "medium" ? "border-amber-200 bg-amber-50 text-amber-700"
            : "border-[#e5e5e5] bg-[#fafafa] text-[#666666]",
        )}>
          {PRIORITY_LABELS[task.priority] ?? task.priority}
        </span>
      ),
    },
    {
      id: "due",
      header: "Срок",
      width: 110,
      hideable: true,
      // Пустой срок сортируется в конец: задача без даты не «самая срочная».
      sortValue: (task) => task.dueDate ?? "9999-12-31",
      render: (task) => (
        <span className={cn("text-xs", task.isOverdue ? "font-medium text-rose-600" : "text-[#666666]")}>
          {formatDue(task.dueDate)}
        </span>
      ),
    },
    {
      id: "assignee",
      header: "Ответственный",
      width: 160,
      hideable: true,
      sortValue: (task) => usersById.get(task.assigneeId)?.fullName ?? "",
      render: (task) => <UserAvatar user={usersById.get(task.assigneeId)} size="sm" />,
    },
    {
      id: "link",
      header: "Связь",
      width: 120,
      hideable: true,
      sortValue: (task) => task.linkedEntityType ?? "",
      render: (task) => (
        <span className="text-xs text-[#888888]">
          {task.linkedEntityType === null ? "—" : LINK_LABELS[task.linkedEntityType] ?? task.linkedEntityType}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      width: 90,
      hideable: true,
      render: (task) => (
        <Guard requiredPermission="tasks:write">
          {/* Как в канбане: на мобильном кнопки видны без наведения. */}
          <span className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
            <button type="button" onClick={(event) => { event.stopPropagation(); openTaskRecord(task.id); }} aria-label="Изменить задачу" className="rounded p-1 text-[#888888] hover:text-[#111111]"><Pencil className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={(event) => { event.stopPropagation(); setDeleteTarget(task); }} aria-label="Удалить задачу" className="rounded p-1 text-[#888888] hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
          </span>
        </Guard>
      ),
    },
  ], [change, usersById]);

  if (query.isLoading) return <SkeletonTable rows={7} columns={6} />;
  if (query.isError) return (
    <div role="alert" className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-6">
      <AlertCircle className="h-5 w-5 text-rose-600" />
      <div><p className="text-sm font-medium text-rose-950">Не удалось загрузить задачи</p><p className="text-sm text-rose-700">{query.error.message}</p><button type="button" onClick={() => void query.refetch()} className="mt-3 flex gap-1 text-xs text-rose-800 hover:text-rose-950 font-medium"><RefreshCw className="h-3.5 w-3.5" />Повторить</button></div>
    </div>
  );

  const groups: Record<TaskStatus, TaskDTO[]> = {
    todo: filteredTasks.filter((task) => task.status === "todo"),
    in_progress: filteredTasks.filter((task) => task.status === "in_progress"),
    done: filteredTasks.filter((task) => task.status === "done"),
  };

  return (
    <div className="space-y-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#111111]">Задачи</h1>
          <p className="mt-1 text-sm text-[#666666]">
            Открытых: {tasks.filter((task) => task.status !== "done").length} · в текущем виде: {filteredTasks.length}
          </p>
        </div>
        <Guard requiredPermission="tasks:write">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            disabled={!user}
            className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-3.5 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Добавить задачу
          </button>
        </Guard>
      </div>

      {/* Тулбар поиска и переключения вида */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию или описанию..."
            className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-8 pr-7 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 transition-colors"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#111111]"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Переключатель Таблица / Канбан / Календарь */}
          <div className="flex rounded-[8px] border border-[#e5e5e5] bg-white p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setView("table")}
              aria-label="Таблица"
              className={cn(
                "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer",
                view === "table"
                  ? "bg-[#4a38f5] text-white shadow-2xs"
                  : "text-[#666666] hover:text-[#111111] hover:bg-black/[0.04]",
              )}
            >
              <List className="h-3.5 w-3.5" />
              <span>Таблица</span>
            </button>
            <button
              type="button"
              onClick={() => setView("kanban")}
              aria-label="Канбан"
              className={cn(
                "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer",
                view === "kanban"
                  ? "bg-[#4a38f5] text-white shadow-2xs"
                  : "text-[#666666] hover:text-[#111111] hover:bg-black/[0.04]",
              )}
            >
              <LayoutGrid className="h-3.5 w-3.5" />
              <span>Канбан</span>
            </button>
            <button
              type="button"
              onClick={() => setView("calendar")}
              aria-label="Календарь"
              className={cn(
                "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer",
                view === "calendar"
                  ? "bg-[#4a38f5] text-white shadow-2xs"
                  : "text-[#666666] hover:text-[#111111] hover:bg-black/[0.04]",
              )}
            >
              <Calendar className="h-3.5 w-3.5" />
              <span>Календарь</span>
            </button>
          </div>
        </div>
      </div>

      {/* Панель сохранённых срезов (Saved Views) в стиле Twenty CRM */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 text-xs">
        <span className="text-[#888888] text-[11px] font-medium mr-1 uppercase tracking-wider shrink-0">Срез:</span>
        {PRESET_TABS.map((tab) => {
          const active = presetView === tab.id;
          const count = presetCounts[tab.id];
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPresetView(tab.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer shrink-0",
                active
                  ? "bg-white border border-[#e5e5e5] text-[#111111] shadow-2xs"
                  : "text-[#666666] hover:bg-black/[0.04] hover:text-[#111111]",
              )}
            >
              <span>{tab.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[10px] tabular-nums font-mono",
                  active ? "bg-[#f5f5f5] text-[#111111]" : "text-[#888888]",
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {filteredTasks.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="Нет задач"
          description={
            search.trim()
              ? "По запросу ничего не найдено. Попробуйте изменить поиск."
              : presetView === "all"
                ? "Задачи ещё не создавались."
                : "В этом срезе пока нет задач."
          }
        />
      ) : view === "table" ? (
        <SyncedRecordTable
          rows={filteredTasks}
          columns={taskColumns}
          getRowId={(task) => task.id}
          tableId="tasks"
          onRowClick={(task) => openTaskRecord(task.id)}
        />
      ) : view === "calendar" ? (
        <TaskCalendarView
          tasks={filteredTasks}
          onTaskClick={(task) => openTaskRecord(task.id)}
          onToggleStatus={(task) => change(task)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {(["todo", "in_progress", "done"] as TaskStatus[]).map((status) => (
            <div key={status} className="flex flex-col rounded-xl border border-[#e5e5e5] bg-[#fbfbfb] p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-[#666666]">{STATUS_LABELS[status]}</span>
                <span className="rounded-full bg-white border border-[#e5e5e5] px-2 py-0.5 text-[11px] font-mono text-[#888888] tabular-nums">{groups[status].length}</span>
              </div>
              <div className="space-y-2 flex-1">
                {groups[status].map((task) => renderCard(task))}
                {groups[status].length === 0 && (
                  <div className="rounded-[8px] border border-dashed border-[#e5e5e5] p-4 text-center text-xs text-[#888888]">
                    Нет задач в этой колонке
                  </div>
                )}
              </div>

              {/* Инлайн-создание задачи в стиле Twenty CRM */}
              {quickStatus === status ? (
                <div className="mt-2 rounded-[8px] border border-[#4a38f5] bg-white p-2 shadow-2xs">
                  <input
                    type="text"
                    autoFocus
                    value={quickTitle}
                    onChange={(e) => setQuickTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleQuickCreate(status);
                      }
                      if (e.key === "Escape") {
                        setQuickStatus(null);
                        setQuickTitle("");
                      }
                    }}
                    placeholder="Название задачи, Enter..."
                    className="w-full text-[13px] text-[#111111] placeholder:text-[#888888] focus:outline-none"
                  />
                  <div className="mt-2 flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setQuickStatus(null);
                        setQuickTitle("");
                      }}
                      className="rounded px-2 py-0.5 text-[11px] text-[#666666] hover:bg-[#f5f5f5]"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      disabled={!quickTitle.trim() || create.isPending}
                      onClick={() => handleQuickCreate(status)}
                      className="rounded bg-[#4a38f5] px-2 py-0.5 text-[11px] font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
                    >
                      {create.isPending ? "Создание..." : "Добавить"}
                    </button>
                  </div>
                </div>
              ) : (
                <Guard requiredPermission="tasks:write">
                  <button
                    type="button"
                    onClick={() => {
                      setQuickStatus(status);
                      setQuickTitle("");
                    }}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[#e5e5e5] py-1.5 text-xs font-medium text-[#666666] transition-colors hover:border-[#cccccc] hover:bg-white hover:text-[#111111] cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Добавить задачу
                  </button>
                </Guard>
              )}
            </div>
          ))}
        </div>
      )}

      <TaskModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={async (payload) => { await create.mutateAsync(payload); toast.success("Задача создана"); }}
        assigneeId={user?.id ?? ""}
      />

      {editTarget !== null && (
        <TaskModal
          open
          onClose={() => { setEditTarget(null); closeTaskRecord(); }}
          onSubmit={async (payload) => {
            await update.mutateAsync({
              id: editTarget.id,
              payload: {
                title: payload.title,
                description: payload.description,
                priority: payload.priority,
                status: payload.status,
                due_date: payload.due_date,
                assignee_id: payload.assignee_id,
                // Связь передаётся парой: форма позволяет её менять, и без этих
                // полей выбор пользователя молча терялся.
                linked_entity_type: payload.linked_entity_type,
                linked_entity_id: payload.linked_entity_id,
              },
             });
             toast.success("Задача обновлена");
             setEditTarget(null);
             closeTaskRecord();
           }}
          assigneeId={user?.id ?? ""}
          initial={editInitial}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Удалить задачу"
        description={`Удалить «${deleteTarget?.title ?? ""}»? Действие нельзя отменить.`}
        confirmLabel="Удалить"
        variant="destructive"
        isPending={remove.isPending}
      />
    </div>
  );
}

export default function TasksPage() {
  return <Guard requiredPermission="tasks:read" fallback={<EmptyState icon={ListChecks} title="Нет доступа к задачам" description="Запросите право tasks:read у администратора." />}><TasksContent /></Guard>;
}
