"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ListChecks, User, Calendar, AlertCircle, Link2, Loader2, Send } from "lucide-react";
import { createTaskSchema, type CreateTaskPayload } from "@/schemas/task.schema";
import { ApiClientError } from "@/lib/api/apiClient";
import { useTenantUsers } from "@/lib/api/use-tenant-users";
import { useContacts, contactFullName } from "@/lib/api/use-contacts";
import { useCompanies } from "@/lib/api/use-companies";
import { useDeals } from "@/lib/api/use-deals";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Форма задачи.
//
// Образец — создание Task в Twenty: заголовок, описание, срок, статус,
// приоритет, исполнитель и связь с записью. Отличие от прежней версии здесь в
// двух местах, где раньше был заглушечный ввод:
//  - исполнитель выбирается из пользователей тенанта, а не жёстко берётся
//    текущий: у Twenty `assignee` — обычное relation-поле;
//  - связанная запись выбирается вместе с самой записью, а не только типом:
//    бэкенд требует пару linked_entity_type + linked_entity_id, и выбор одного
//    типа отклонялся валидацией.
// ---------------------------------------------------------------------------

import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";

interface TaskModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateTaskPayload) => Promise<unknown>;
  /** Текущий пользователь: исполнитель по умолчанию. */
  assigneeId: string;
  /** Заполненные значения — режим правки существующей задачи. */
  initial?: CreateTaskPayload;
  title?: string;
}

const PRIORITIES = [
  { value: "high" as const, label: "Высокий", color: "border-rose-200 bg-rose-50 text-rose-700" },
  { value: "medium" as const, label: "Средний", color: "border-amber-200 bg-amber-50 text-amber-700" },
  { value: "low" as const, label: "Низкий", color: "border-slate-200 bg-slate-50 text-slate-700" },
];

const STATUSES = [
  { value: "todo" as const, label: "К выполнению" },
  { value: "in_progress" as const, label: "В работе" },
  { value: "done" as const, label: "Выполнено" },
];

const EMPTY: CreateTaskPayload = {
  title: "",
  description: "",
  priority: "medium",
  status: "todo",
  due_date: "",
  assignee_id: "",
  linked_entity_type: "",
  linked_entity_id: "",
  notify_telegram: false,
};

const INPUT_CLASS =
  "w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 transition-colors";

function message(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : undefined;
}

/** `datetime-local` не принимает ISO с зоной — нужен вид «YYYY-MM-DDTHH:mm». */
function toLocalInput(iso: string | undefined): string {
  if (iso === undefined || iso === "") return "";

  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";

  const pad = (value: number): string => String(value).padStart(2, "0");

  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

export function TaskModal({ open, onClose, onSubmit, assigneeId, initial, title }: TaskModalProps) {
  const defaults = useMemo<CreateTaskPayload>(
    () => (initial === undefined
      ? { ...EMPTY, assignee_id: assigneeId }
      : { ...initial, due_date: toLocalInput(initial.due_date) }),
    [initial, assigneeId],
  );

  const form = useForm<CreateTaskPayload>({
    resolver: zodResolver(createTaskSchema),
    defaultValues: defaults,
    mode: "onChange",
  });

  const users = useTenantUsers();
  const linkedType = form.watch("linked_entity_type") ?? "";

  const contacts = useContacts({ limit: 100 });
  const companies = useCompanies({ limit: 100 });
  const deals = useDeals({ limit: 100 });

  const linkOptions = useMemo<Array<{ id: string; label: string }>>(() => {
    if (linkedType === "contact") {
      return (contacts.data?.items ?? []).map((contact) => ({ id: contact.id, label: contactFullName(contact) }));
    }
    if (linkedType === "company") {
      return (companies.data?.items ?? []).map((company) => ({ id: company.id, label: company.name }));
    }
    if (linkedType === "deal") {
      return (deals.data?.items ?? []).map((deal) => ({ id: deal.id, label: deal.title }));
    }
    return [];
  }, [linkedType, contacts.data, companies.data, deals.data]);

  useEffect(() => {
    if (open) form.reset(defaults);
  }, [open, defaults, form]);

  const submit = useCallback(async (values: CreateTaskPayload) => {
    try {
      await onSubmit({
        ...values,
        due_date: values.due_date === undefined || values.due_date === ""
          ? ""
          : new Date(values.due_date).toISOString(),
      });
      form.reset({ ...EMPTY, assignee_id: assigneeId });
      onClose();
    } catch (error) {
      if (error instanceof ApiClientError && error.isValidationError) {
        const fields = error.fieldErrors();
        for (const [field, text] of Object.entries(fields)) {
          if (field === "_root") form.setError("root", { type: "server", message: text });
          else form.setError(field as keyof CreateTaskPayload, { type: "server", message: text });
        }
        return;
      }
      form.setError("root", {
        type: "server",
        message: error instanceof Error ? error.message : "Не удалось сохранить задачу",
      });
    }
  }, [onSubmit, assigneeId, form, onClose]);

  if (!open) return null;
  const { errors, isSubmitting } = form.formState;

  return (
    <Sheet open={open} onClose={onClose} width="w-[560px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <ListChecks className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              {title ?? (initial === undefined ? "Новая задача" : "Изменить задачу")}
            </h2>
            <p className="text-xs text-[#666666]">Поставьте задачу команде</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(submit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {message(errors.root) && (
              <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                {message(errors.root)}
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="task-title" className="block text-xs font-medium text-[#666666]">
                Название *
              </label>
              <input
                id="task-title"
                autoFocus
                placeholder="Позвонить клиенту, подготовить отчёт..."
                {...form.register("title")}
                className={cn(INPUT_CLASS, errors.title ? "border-rose-500" : "border-[#e5e5e5]")}
              />
              {message(errors.title) && <p className="text-xs text-rose-600">{message(errors.title)}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="task-description" className="block text-xs font-medium text-[#666666]">
                Описание
              </label>
              <textarea
                id="task-description"
                rows={3}
                placeholder="Дополнительные детали задачи..."
                {...form.register("description")}
                className={cn(INPUT_CLASS, "resize-none")}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-medium text-[#666666]">
                  <AlertCircle className="h-3 w-3 text-[#888888]" />
                  Приоритет
                </span>
                <div className="flex gap-1.5">
                  {PRIORITIES.map((priority) => (
                    <button
                      key={priority.value}
                      type="button"
                      onClick={() => form.setValue("priority", priority.value, { shouldValidate: true })}
                      className={cn(
                        "flex-1 rounded-[8px] border px-2 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                        form.watch("priority") === priority.value
                          ? priority.color
                          : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]",
                      )}
                    >
                      {priority.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="task-due" className="flex items-center gap-1.5 text-xs font-medium text-[#666666]">
                  <Calendar className="h-3 w-3 text-[#888888]" />
                  Срок
                </label>
                <input
                  id="task-due"
                  type="datetime-local"
                  {...form.register("due_date")}
                  className={cn(INPUT_CLASS, errors.due_date ? "border-rose-500" : "border-[#e5e5e5]")}
                />
                {message(errors.due_date) && <p className="text-xs text-rose-600">{message(errors.due_date)}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="task-assignee" className="flex items-center gap-1.5 text-xs font-medium text-[#666666]">
                  <User className="h-3 w-3 text-[#888888]" />
                  Ответственный *
                </label>
                <select
                  id="task-assignee"
                  {...form.register("assignee_id")}
                  className={cn(INPUT_CLASS, errors.assignee_id ? "border-rose-500" : "border-[#e5e5e5]")}
                >
                  <option value="">Выберите сотрудника</option>
                  {(users.data ?? []).map((user) => (
                    <option key={user.id} value={user.id}>{user.fullName}</option>
                  ))}
                </select>
                {message(errors.assignee_id) && <p className="text-xs text-rose-600">{message(errors.assignee_id)}</p>}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="task-status" className="block text-xs font-medium text-[#666666]">
                  Статус
                </label>
                <select id="task-status" {...form.register("status")} className={INPUT_CLASS}>
                  {STATUSES.map((status) => (
                    <option key={status.value} value={status.value}>{status.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="task-link-type" className="flex items-center gap-1.5 text-xs font-medium text-[#666666]">
                <Link2 className="h-3 w-3 text-[#888888]" />
                Связанная запись
              </label>
              <div className="grid grid-cols-2 gap-4">
                <select
                  id="task-link-type"
                  value={linkedType}
                  onChange={(event) => {
                    form.setValue("linked_entity_type", event.target.value as CreateTaskPayload["linked_entity_type"], { shouldValidate: true });
                    form.setValue("linked_entity_id", "", { shouldValidate: true });
                  }}
                  className={INPUT_CLASS}
                >
                  <option value="">Без связи</option>
                  <option value="deal">Сделка</option>
                  <option value="contact">Контакт</option>
                  <option value="company">Компания</option>
                </select>

                {linkedType !== "" && (
                  <select
                    aria-label="Запись"
                    {...form.register("linked_entity_id")}
                    className={cn(INPUT_CLASS, message(errors.linked_entity_id) ? "border-rose-500" : "border-[#e5e5e5]")}
                  >
                    <option value="">Выберите запись</option>
                    {linkOptions.map((option) => (
                      <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                  </select>
                )}
              </div>
              {message(errors.linked_entity_id) && <p className="text-xs text-rose-600">{message(errors.linked_entity_id)}</p>}
            </div>

            {initial === undefined && (
              <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#0088cc]/10 text-[#0088cc]">
                    <Send className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#111111]">
                      Уведомление в Telegram-бот
                    </div>
                    <div className="text-[11px] text-[#666666]">
                      Отправить карточку задачи в @GetVoxlybot
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={Boolean(form.watch("notify_telegram"))}
                  onClick={() => form.setValue("notify_telegram", !form.watch("notify_telegram"), { shouldValidate: true })}
                  className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/40 cursor-pointer",
                    form.watch("notify_telegram") ? "bg-[#4a38f5]" : "bg-[#d4d4d4]",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform",
                      form.watch("notify_telegram") ? "translate-x-[18px]" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[#e5e5e5] bg-white px-6 py-4 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-[8px] border border-[#e5e5e5] px-4 text-xs font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex h-8 items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{initial === undefined ? "Создать задачу" : "Сохранить"}</span>
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
