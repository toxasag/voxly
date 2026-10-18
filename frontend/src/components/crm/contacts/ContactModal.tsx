"use client";

import { useCallback, useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  X, User, Phone, Mail, MessageCircle, Hash, Building2, Loader2, FileText, Tag, AlertCircle,
  Linkedin, Briefcase,
} from "lucide-react";
import { createContactSchema, type CreateContactPayload } from "@/schemas/contact.schema";
import { ApiClientError } from "@/lib/api/apiClient";
import { useCompanies } from "@/lib/api/use-companies";
import { PhonesInput } from "@/components/crm/shared/PhonesInput";
import { SocialsInput } from "@/components/crm/shared/SocialsInput";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

// ---------------------------------------------------------------------------
// Форма контакта («Все поля» на карточке).
//
// Обязательно только имя. У Twenty на Person nullable всё, кроме идентификатора
// (person.workspace-entity.ts), и обязательность фамилии, телефона и компании
// была нашей выдумкой: клиент из мессенджера известен часто одним именем, у
// физлица нет компании, а номер бывает скрыт настройками приватности.
//
// Компания выбирается из существующих или вводится названием: бэкенд по названию
// находит компанию тенанта, а если её нет — создаёт. Раньше название оставалось
// строкой у контакта и в списке компаний не появлялось.
// ---------------------------------------------------------------------------

import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";

interface ContactModalProps {
  open: boolean;
  onClose: () => void;
  /** Rejects on failure so the modal can surface backend field errors. */
  onSubmit: (payload: CreateContactPayload) => Promise<unknown>;
  initial?: CreateContactPayload;
}

const CHANNELS = [
  { value: "telegram" as const, icon: MessageCircle, label: "Telegram" },
  { value: "whatsapp" as const, icon: MessageCircle, label: "WhatsApp" },
  { value: "rumax" as const, icon: Hash, label: "RuMAX" },
  { value: "phone" as const, icon: Phone, label: "Телефон" },
  { value: "email" as const, icon: Mail, label: "E-mail" },
];

const EMPTY_VALUES: CreateContactPayload = {
  first_name: "",
  last_name: "",
  middle_name: "",
  phones: [],
  email: "",
  socials: [],
  job_title: "",
  company_name: "",
  company_id: "",
  channel: "telegram",
  linkedin_link: "",
  notes: "",
  custom_fields: {},
};

/** Fields the form can actually focus; anything else goes to the form-level banner. */
const FORM_FIELDS = new Set<keyof CreateContactPayload>([
  "first_name",
  "last_name",
  "middle_name",
  "phones",
  "email",
  "socials",
  "job_title",
  "company_name",
  "company_id",
  "channel",
  "linkedin_link",
  "notes",
  "custom_fields",
]);

function isFormField(key: string): key is keyof CreateContactPayload {
  return FORM_FIELDS.has(key as keyof CreateContactPayload);
}

/** Достаёт текст ошибки у полей-массивов: RHF кладёт его на разной глубине. */
function messageOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  if ("message" in error && typeof error.message === "string") return error.message;
  return undefined;
}

const INPUT_CLASS =
  "w-full rounded-[4px] border border-[#e5e5e5] bg-white py-2 px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20";

export function ContactModal({ open, onClose, onSubmit, initial }: ContactModalProps) {
  const form = useForm<CreateContactPayload>({
    resolver: zodResolver(createContactSchema),
    defaultValues: initial ?? EMPTY_VALUES,
    mode: "onChange",
  });

  const companies = useCompanies({ limit: 100 });

  const handleSubmit = useCallback(
    async (values: CreateContactPayload) => {
      try {
        await onSubmit(values);
        form.reset(EMPTY_VALUES);
        onClose();
      } catch (error) {
        if (error instanceof ApiClientError && error.isValidationError) {
          const fields = error.fieldErrors();
          let matched = false;

          for (const [field, message] of Object.entries(fields)) {
            if (isFormField(field)) {
              form.setError(field, { type: "server", message });
              matched = true;
            }
          }

          if (!matched) {
            form.setError("root", {
              type: "server",
              message: fields._root ?? error.message,
            });
          }
          return;
        }

        form.setError("root", {
          type: "server",
          message:
            error instanceof ApiClientError
              ? error.message
              : "Не удалось сохранить контакт. Проверьте соединение и попробуйте снова.",
        });
      }
    },
    [onSubmit, form, onClose],
  );

  useOverlay(open, { onEscape: onClose });

  useEffect(() => {
    if (open) form.reset(initial ?? EMPTY_VALUES);
  }, [open, form, initial]);

  const phones = form.watch("phones") ?? [];
  const socials = form.watch("socials") ?? [];
  const companyId = form.watch("company_id") ?? "";
  const channel = form.watch("channel");

  const companyOptions = useMemo(
    () => [...(companies.data?.items ?? [])].sort((left, right) => left.name.localeCompare(right.name, "ru")),
    [companies.data],
  );

  if (!open) return null;
  const { errors, isSubmitting } = form.formState;
  const rootError = errors.root?.message;

  return (
    <Sheet open={open} onClose={onClose} width="w-[580px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <User className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">{initial ? "Изменить контакт" : "Новый контакт"}</h2>
            <p className="text-xs text-[#666666]">{initial ? "Обновите данные контакта" : "Добавьте контакт в CRM"}</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {rootError && (
              <div className="flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3" role="alert">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
                <p className="text-xs text-rose-600">{rootError}</p>
              </div>
            )}

            {/* ФИО */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label htmlFor="contact-last-name" className="block text-xs font-medium text-slate-700">Фамилия</label>
                <input id="contact-last-name" type="text" placeholder="Петров" {...form.register("last_name")}
                  className={cn(INPUT_CLASS, errors.last_name ? "border-rose-500" : "border-[#e5e5e5]")} />
                {errors.last_name && <p className="text-xs text-rose-500">{errors.last_name.message}</p>}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="contact-first-name" className="block text-xs font-medium text-slate-700">Имя *</label>
                  <input id="contact-first-name" type="text" placeholder="Иван" autoFocus {...form.register("first_name")}
                    className={cn(INPUT_CLASS, errors.first_name ? "border-rose-500" : "border-[#e5e5e5]")} />
                  {errors.first_name && <p className="text-xs text-rose-500">{errors.first_name.message}</p>}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="contact-middle-name" className="block text-xs font-medium text-slate-700">Отчество</label>
                  <input id="contact-middle-name" type="text" placeholder="Сергеевич" {...form.register("middle_name")}
                    className={cn(INPUT_CLASS, errors.middle_name ? "border-rose-500" : "border-[#e5e5e5]")} />
                  {errors.middle_name && <p className="text-xs text-rose-500">{errors.middle_name.message}</p>}
                </div>
              </div>
            </div>

            <PhonesInput
              value={phones}
              onChange={(next) => form.setValue("phones", next, { shouldValidate: true, shouldDirty: true })}
              error={messageOf(errors.phones)}
            />

            <div className="space-y-1.5">
              <label htmlFor="contact-email" className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Mail className="h-3 w-3 text-slate-400" /> E-mail
              </label>
              <input id="contact-email" type="text" placeholder="ivan@company.ru" {...form.register("email")}
                className={cn(INPUT_CLASS, errors.email ? "border-rose-500" : "border-[#e5e5e5]")} />
              {errors.email && <p className="text-xs text-rose-500">{errors.email.message}</p>}
            </div>

            <SocialsInput
              value={socials}
              onChange={(next) => form.setValue("socials", next, { shouldValidate: true, shouldDirty: true })}
              error={messageOf(errors.socials)}
            />

            <div className="space-y-1.5">
              <label htmlFor="contact-company-id" className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Building2 className="h-3 w-3 text-slate-400" /> Компания
              </label>
              <select
                id="contact-company-id"
                value={companyId}
                onChange={(event) => {
                  const nextId = event.target.value;
                  form.setValue("company_id", nextId, { shouldValidate: true, shouldDirty: true });
                  const picked = companyOptions.find((company) => company.id === nextId);
                  form.setValue("company_name", picked?.name ?? "", { shouldDirty: true });
                }}
                className={cn(INPUT_CLASS, "border-[#e5e5e5]")}
              >
                <option value="">Без компании</option>
                {companyOptions.map((company) => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>
              {companyId === "" && (
                <input
                  type="text"
                  placeholder="Или введите название новой компании"
                  {...form.register("company_name")}
                  className={cn(INPUT_CLASS, errors.company_name ? "border-rose-500" : "border-[#e5e5e5]")}
                />
              )}
              {errors.company_name && <p className="text-xs text-rose-500">{errors.company_name.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="contact-job-title" className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Briefcase className="h-3 w-3 text-slate-400" /> Должность
              </label>
              <input id="contact-job-title" type="text" placeholder="Технический директор" {...form.register("job_title")}
                className={cn(INPUT_CLASS, errors.job_title ? "border-rose-500" : "border-[#e5e5e5]")} />
              {errors.job_title && <p className="text-xs text-rose-500">{errors.job_title.message}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="contact-linkedin" className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Linkedin className="h-3 w-3 text-slate-400" /> LinkedIn
              </label>
              <input id="contact-linkedin" type="text" placeholder="https://linkedin.com/in/..." {...form.register("linkedin_link")}
                className={cn(INPUT_CLASS, errors.linkedin_link ? "border-rose-500" : "border-[#e5e5e5]")} />
              {errors.linkedin_link && <p className="text-xs text-rose-500">{errors.linkedin_link.message}</p>}
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-700">Канал связи</span>
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.map(({ value, icon: Icon, label }) => (
                  <button key={value} type="button" onClick={() => form.setValue("channel", value, { shouldValidate: true })}
                    className={cn("flex items-center gap-1.5 rounded-[6px] border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                      channel === value
                        ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5]")}>
                    <Icon className="h-3.5 w-3.5" />{label}
                  </button>
                ))}
              </div>
            </div>

            <fieldset className="space-y-3 rounded-[8px] border border-[#e5e5e5] p-3.5">
              <legend className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Tag className="h-3 w-3 text-slate-400" /> Дополнительные поля
              </legend>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="contact-cf-department" className="text-xs text-[#666666]">Отдел</label>
                  <input id="contact-cf-department" type="text" placeholder="Разработка" {...form.register("custom_fields.department")}
                    className={INPUT_CLASS} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="contact-cf-source" className="text-xs text-[#666666]">Источник</label>
                  <input id="contact-cf-source" type="text" placeholder="Рекомендация" {...form.register("custom_fields.source")}
                    className={INPUT_CLASS} />
                </div>
              </div>
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor="contact-notes" className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <FileText className="h-3 w-3 text-slate-400" /> Описание
              </label>
              <textarea id="contact-notes" rows={2} placeholder="Внутренние заметки..." {...form.register("notes")}
                className={cn(INPUT_CLASS, "resize-none")} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 border-t border-[#e5e5e5] bg-white px-6 py-4 shrink-0">
            <button type="button" onClick={onClose}
              className="rounded-[8px] border border-[#e5e5e5] px-4 py-2 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer">
              Отмена
            </button>
            <button type="submit" disabled={isSubmitting}
              className="flex items-center gap-2 rounded-[8px] px-5 py-2 text-xs font-medium transition-colors bg-[#4a38f5] text-white hover:bg-[#3b2be0] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
              {isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Сохраняем...</> : (initial ? "Сохранить" : "Создать контакт")}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
