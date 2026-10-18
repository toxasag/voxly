"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2, Banknote, AlertCircle, FileText } from "lucide-react";
import { createCompanySchema, type CreateCompanyPayload } from "@/schemas/company.schema";
import { ApiClientError } from "@/lib/api/apiClient";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (p: CreateCompanyPayload) => Promise<unknown>;
  initial?: CreateCompanyPayload;
}

const EMPTY: CreateCompanyPayload = {
  name: "",
  phone: "",
  email: "",
  inn: "",
  ogrn: "",
  bik: "",
  account_number: "",
  legal_address: "",
  manager_name: "",
  manager_id: "",
  notes: "",
  custom_fields: {},
};

const FIELDS = new Set<keyof CreateCompanyPayload>([
  "name",
  "phone",
  "email",
  "inn",
  "ogrn",
  "bik",
  "account_number",
  "legal_address",
  "manager_name",
  "manager_id",
  "notes",
  "custom_fields",
]);

function fieldMessage(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "message" in error && typeof error.message === "string"
    ? error.message
    : undefined;
}
export function CompanyModal({ open, onClose, onSubmit, initial }: Props) {
  const form = useForm<CreateCompanyPayload>({
    resolver: zodResolver(createCompanySchema),
    defaultValues: initial ?? EMPTY,
    mode: "onChange",
  });

  useOverlay(open, { onEscape: onClose });

  useEffect(() => {
    if (open) form.reset(initial ?? EMPTY);
  }, [open, form, initial]);

  const submit = useCallback(
    async (p: CreateCompanyPayload) => {
      try {
        await onSubmit(p);
        form.reset(EMPTY);
        onClose();
      } catch (e) {
        if (e instanceof ApiClientError && e.isValidationError) {
          const errors = e.fieldErrors();
          let matched = false;
          for (const [k, msg] of Object.entries(errors)) {
            if (FIELDS.has(k as keyof CreateCompanyPayload)) {
              form.setError(k as keyof CreateCompanyPayload, { type: "server", message: msg });
              matched = true;
            }
          }
          if (!matched) form.setError("root", { type: "server", message: errors._root ?? e.message });
          return;
        }
        form.setError("root", { type: "server", message: e instanceof Error ? e.message : "Не удалось сохранить компанию" });
      }
    },
    [onSubmit, form, onClose],
  );

  if (!open) return null;
  const { errors, isValid, isSubmitting } = form.formState;

  const input = (field: keyof CreateCompanyPayload, label: string, placeholder = "", type = "text") => (
    <div className="space-y-1.5">
      <label htmlFor={`company-${field}`} className="block text-xs font-medium text-[#666666]">
        {label}
      </label>
      <input
        id={`company-${field}`}
        type={type}
        placeholder={placeholder}
        {...form.register(field as "name")}
        className={cn(
          "w-full rounded-[8px] border bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 transition-colors",
          errors[field] ? "border-rose-500" : "border-[#e5e5e5]",
        )}
      />
      {fieldMessage(errors[field]) && <p className="text-xs text-rose-600">{fieldMessage(errors[field])}</p>}
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} width="w-[580px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">{initial ? "Изменить компанию" : "Новая компания"}</h2>
            <p className="text-xs text-[#666666]">Реквизиты проверяются перед отправкой</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(submit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {errors.root?.message && (
              <div role="alert" className="flex gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
                {errors.root.message}
              </div>
            )}

            {input("name", "Название *", "ООО «Акме»")}

            <div className="grid grid-cols-2 gap-4">
              {input("phone", "Телефон", "+7 495 123 45 67")}
              {input("email", "E-mail", "info@company.ru")}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {input("manager_name", "Ответственный", "Иван Петров")}
              {input("manager_id", "UUID ответственного", "Необязательный UUID")}
            </div>

            <fieldset className="space-y-3 rounded-[8px] border border-[#e5e5e5] p-3.5">
              <legend className="flex items-center gap-1.5 text-xs font-medium text-[#666666]">
                <Banknote className="h-3 w-3 text-[#888888]" />
                Реквизиты для счетов
              </legend>
              <div className="grid grid-cols-2 gap-3">
                {input("inn", "ИНН", "10 или 12 цифр")}
                {input("ogrn", "ОГРН", "13 или 15 цифр")}
                {input("bik", "БИК", "9 цифр")}
                {input("account_number", "Расчётный счёт", "20 цифр")}
              </div>
              {input("legal_address", "Юридический адрес", "Москва, Тверская 15")}
            </fieldset>

            <div className="space-y-1.5">
              <label htmlFor="company-notes" className="flex items-center gap-1 text-xs font-medium text-[#666666]">
                <FileText className="h-3 w-3 text-[#888888]" />
                Заметки
              </label>
              <textarea
                id="company-notes"
                rows={3}
                placeholder="Внутренние заметки..."
                {...form.register("notes")}
                className="w-full resize-none rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 transition-colors"
              />
            </div>
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
              disabled={!isValid || isSubmitting}
              className="flex h-8 items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <span>{initial ? "Сохранить" : "Добавить компанию"}</span>
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
