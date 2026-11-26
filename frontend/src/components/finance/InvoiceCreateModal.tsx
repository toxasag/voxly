"use client";

import { useCallback, useEffect } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Receipt, Plus, Trash2, Loader2, Building2 } from "lucide-react";
import { createInvoiceSchema, type CreateInvoicePayload } from "@/schemas/invoice.schema";
import { useCompanies } from "@/lib/api/use-companies";
import { useFinanceOrganizations, type VatMode } from "@/lib/api/use-invoices";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { cn, toLocalDateTimeInput } from "@/lib/utils";

const VAT_RATES: { rate: number; mode: VatMode; label: string }[] = [
  { rate: 0, mode: "none", label: "Без НДС" },
  { rate: 5, mode: "included_5", label: "5%" },
  { rate: 7, mode: "included_7", label: "7%" },
  { rate: 10, mode: "included_10", label: "10%" },
  { rate: 20, mode: "included_20", label: "20%" },
];

interface InvoiceCreateModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: PrefilledInvoicePayload) => void;
  prefilled?: { description: string; unit_price: number; source: "repair_work" | "repair_part"; source_label: string }[];
}

export type PrefilledInvoicePayload = CreateInvoicePayload;

export function InvoiceCreateModal({ open, onClose, onSubmit, prefilled }: InvoiceCreateModalProps) {
  const companiesQuery = useCompanies({ limit: 100 });
  const companies = companiesQuery.data?.items ?? [];
  const { data: organizations = [] } = useFinanceOrganizations();
  const defaultOrg = organizations.find((o) => o.isDefault) ?? organizations[0];

  const form = useForm<CreateInvoicePayload>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: {
      issuer_organization_id: "",
      company_id: "",
      company_name: "",
      company_inn: "",
      company_address: "",
      contact_name: "",
      contact_phone: "",
      due_date: toLocalDateTimeInput(new Date(Date.now() + 7 * 86400000)),
      vat_mode: "none",
      vat_rate: 0,
      notes: "",
      line_items: [],
    },
    mode: "onChange",
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "line_items" });

  useEffect(() => {
    if (open) {
      form.reset({
        issuer_organization_id: defaultOrg?.id ?? "",
        company_id: "",
        company_name: "",
        company_inn: "",
        company_address: "",
        contact_name: "",
        contact_phone: "",
        due_date: toLocalDateTimeInput(new Date(Date.now() + 7 * 86400000)),
        vat_mode: defaultOrg?.vatMode ?? "none",
        vat_rate: defaultOrg?.vatRate ?? 0,
        notes: "",
        line_items: prefilled
          ? prefilled.map((p) => ({
              description: p.description,
              quantity: 1,
              unit_price: p.unit_price,
              source: p.source,
              source_label: p.source_label,
            }))
          : [],
      });
    }
  }, [open, form, prefilled, defaultOrg?.id, defaultOrg?.vatMode, defaultOrg?.vatRate]);

  const handleSubmit = useCallback(
    (v: CreateInvoicePayload) => {
      onSubmit(v);
      form.reset();
      onClose();
    },
    [onSubmit, form, onClose],
  );

  if (!open) return null;
  const { errors, isValid } = form.formState;
  const lineItems = form.watch("line_items");
  const vatRate = form.watch("vat_rate");
  const subtotal = lineItems.reduce((s, li) => s + li.unit_price * li.quantity, 0);
  const vatAmount = vatRate > 0 ? Math.round(((subtotal * vatRate) / (100 + vatRate)) * 100) / 100 : 0;
  const grandTotal = subtotal;

  const fmtAmt = (v: number) =>
    new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(v);

  return (
    <Sheet open={open} onClose={onClose} width="w-[640px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
            <Receipt className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Новый счёт</h2>
            <p className="text-xs text-[#666666]">
              {prefilled ? "Заполнено из наряд-заказа" : "Создать и отправить клиенту"}
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {organizations.length > 0 && (
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Building2 className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Организация-поставщик (от кого счёт)
                </label>
                <select
                  value={form.watch("issuer_organization_id") ?? ""}
                  onChange={(e) => {
                    const orgId = e.target.value;
                    form.setValue("issuer_organization_id", orgId, { shouldValidate: true });
                    const picked = organizations.find((o) => o.id === orgId);
                    if (picked) {
                      form.setValue("vat_mode", picked.vatMode, { shouldValidate: true });
                      form.setValue("vat_rate", picked.vatRate, { shouldValidate: true });
                    }
                  }}
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                >
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}{org.inn ? ` (ИНН ${org.inn})` : ""}{org.isDefault ? " — основная" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">Компания-плательщик *</label>
              <select
                value={form.watch("company_id")}
                onChange={(e) => {
                  form.setValue("company_id", e.target.value, { shouldValidate: true });
                  const c = companies.find((x) => x.id === e.target.value);
                  if (c) {
                    form.setValue("contact_name", c.managerName || c.name);
                    form.setValue("contact_phone", c.phone || "");
                  }
                }}
                className={cn(
                  "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] appearance-none focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                  errors.company_id && "border-rose-500",
                )}
              >
                <option value="" disabled>
                  {companiesQuery.isLoading ? "Загрузка компаний..." : "Выберите компанию..."}
                </option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} {c.requisites?.inn ? `(ИНН ${c.requisites.inn})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">Контакт</label>
                <input
                  type="text"
                  value={form.watch("contact_name")}
                  onChange={(e) => form.setValue("contact_name", e.target.value, { shouldValidate: true })}
                  className={cn(
                    "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                    errors.contact_name && "border-rose-500",
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">Телефон</label>
                <input
                  type="text"
                  value={form.watch("contact_phone")}
                  onChange={(e) => form.setValue("contact_phone", e.target.value, { shouldValidate: true })}
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">Срок оплаты</label>
                <input
                  type="datetime-local"
                  value={form.watch("due_date")}
                  onChange={(e) => form.setValue("due_date", e.target.value, { shouldValidate: true })}
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-700">НДС (в т.ч.)</label>
                <div className="flex flex-wrap gap-1.5">
                  {VAT_RATES.map((opt) => (
                    <button
                      key={opt.mode}
                      type="button"
                      onClick={() => {
                        form.setValue("vat_mode", opt.mode, { shouldValidate: true });
                        form.setValue("vat_rate", opt.rate, { shouldValidate: true });
                      }}
                      className={cn(
                        "flex-1 min-w-[54px] rounded-lg border px-2 py-2 text-xs font-medium transition-colors cursor-pointer",
                        vatRate === opt.rate
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-slate-700">Позиции ({fields.length})</label>
              <div className="space-y-1.5">
                {fields.map((f, i) => (
                  <div key={f.id} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={form.watch(`line_items.${i}.description`)}
                      onChange={(e) =>
                        form.setValue(`line_items.${i}.description`, e.target.value, { shouldValidate: true })
                      }
                      placeholder="Описание"
                      className="flex-1 rounded-lg border border-[#e5e5e5] bg-white py-1.5 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none"
                    />
                    <input
                      type="number"
                      value={form.watch(`line_items.${i}.quantity`) || ""}
                      onChange={(e) =>
                        form.setValue(`line_items.${i}.quantity`, Number(e.target.value), { shouldValidate: true })
                      }
                      className="w-16 rounded-lg border border-[#e5e5e5] bg-white py-1.5 px-2 text-sm text-center text-[#111111] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <input
                      type="number"
                      value={form.watch(`line_items.${i}.unit_price`) || ""}
                      onChange={(e) =>
                        form.setValue(`line_items.${i}.unit_price`, Number(e.target.value), { shouldValidate: true })
                      }
                      className="w-[100px] rounded-lg border border-[#e5e5e5] bg-white py-1.5 px-2 text-sm text-right text-[#111111] [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-xs text-slate-600 w-[80px] text-right font-mono">
                      {fmtAmt(
                        (form.watch(`line_items.${i}.unit_price`) || 0) *
                          (form.watch(`line_items.${i}.quantity`) || 0),
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => remove(i)}
                      className="rounded p-1 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  append({ description: "", quantity: 1, unit_price: 0, source: "manual", source_label: "" })
                }
                className="flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                Добавить позицию
              </button>
            </div>
            {errors.line_items && (
              <p className="text-xs text-rose-500">
                {errors.line_items.message ?? errors.line_items.root?.message}
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-700">Примечания</label>
              <textarea
                rows={2}
                value={form.watch("notes") ?? ""}
                onChange={(e) => form.setValue("notes", e.target.value)}
                className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 resize-none focus:border-[#4a38f5] focus:outline-none"
              />
            </div>

            {fields.length > 0 && (
              <div className="rounded-lg border border-[#e5e5e5] bg-slate-50 p-4 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Подытог</span>
                  <span className="text-[#111111] font-mono">{fmtAmt(subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">НДС ({vatRate}%)</span>
                  <span className="text-[#111111] font-mono">{fmtAmt(vatAmount)}</span>
                </div>
                <div className="flex justify-between border-t border-[#e5e5e5] pt-2">
                  <span className="font-semibold text-[#111111]">Итого</span>
                  <span className="font-bold text-[#4a38f5] font-mono">{fmtAmt(grandTotal)}</span>
                </div>
              </div>
            )}
          </div>

          <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-[#e5e5e5] bg-white px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className="flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-colors bg-[#4a38f5] text-white hover:bg-[#3b2be0] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Создаём...
                </>
              ) : (
                "Создать счёт"
              )}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}