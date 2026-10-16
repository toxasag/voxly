"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X, Receipt, Building2, User, Phone, Calendar, Plus, Trash2, Loader2, Wrench, Handshake, Percent, FileText } from "lucide-react";
import { createInvoiceSchema, type CreateInvoicePayload } from "@/schemas/invoice.schema";
import { MOCK_COMPANIES } from "@/lib/finance/mock-invoices";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

interface InvoiceCreateModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: PrefilledInvoicePayload) => void;
  prefilled?: { description: string; unit_price: number; source: "repair_work" | "repair_part"; source_label: string }[];
}

export type PrefilledInvoicePayload = CreateInvoicePayload;

export function InvoiceCreateModal({ open, onClose, onSubmit, prefilled }: InvoiceCreateModalProps) {
  const form = useForm<CreateInvoicePayload>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: { company_id: "", contact_name: "", contact_phone: "", due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16), vat_rate: 20, notes: "", line_items: [] },
    mode: "onChange",
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: "line_items" });

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose });

  useEffect(() => {
    if (open) {
      form.reset({ company_id: "", contact_name: "", contact_phone: "", due_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16), vat_rate: 20, notes: "", line_items: prefilled ? prefilled.map(p => ({ description: p.description, quantity: 1, unit_price: p.unit_price })) : [] });
    }
  }, [open, form, prefilled]);

  const handleSubmit = useCallback((v: CreateInvoicePayload) => { onSubmit(v); form.reset(); onClose(); }, [onSubmit, form, onClose]);
  const backdrop = useCallback((e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); }, [onClose]);



  if (!open) return null;
  const { errors, isValid } = form.formState;
  const lineItems = form.watch("line_items");
  const vatRate = form.watch("vat_rate");
  const subtotal = lineItems.reduce((s, li) => s + li.unit_price * li.quantity, 0);
  const vatAmount = vatRate > 0 ? Math.round(subtotal * (vatRate / 100)) : 0;
  const grandTotal = subtotal + vatAmount;

  const fmtAmt = (v: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(v);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto" onClick={backdrop}>
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl my-8">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10"><Receipt className="h-4 w-4 text-emerald-400" /></div><div><h2 className="text-sm font-semibold text-slate-100">Новый счёт</h2><p className="text-xs text-slate-500">{prefilled ? "Заполнено из наряд-заказа" : "Создать и отправить клиенту"}</p></div></div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="p-6 space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400">Компания-плательщик</label>
            <select value={form.watch("company_id")} onChange={e => { form.setValue("company_id", e.target.value, { shouldValidate: true }); const c = MOCK_COMPANIES.find(x => x.id === e.target.value); if (c) { form.setValue("contact_name", c.contact_name); form.setValue("contact_phone", c.contact_phone); } }}
              className={cn("w-full rounded-lg border bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 appearance-none focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20", errors.company_id ? "border-rose-500" : "border-slate-700")}>
              <option value="" disabled>Выберите компанию...</option>
              {MOCK_COMPANIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><label className="text-xs font-medium text-slate-400">Контакт</label><input type="text" value={form.watch("contact_name")} onChange={e => form.setValue("contact_name", e.target.value, { shouldValidate: true })} className={cn("w-full rounded-lg border bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20", errors.contact_name ? "border-rose-500" : "border-slate-700")} /></div>
            <div className="space-y-2"><label className="text-xs font-medium text-slate-400">Телефон</label><input type="text" value={form.watch("contact_phone")} onChange={e => form.setValue("contact_phone", e.target.value, { shouldValidate: true })} className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><label className="text-xs font-medium text-slate-400">Срок оплаты</label><input type="datetime-local" value={form.watch("due_date")} onChange={e => form.setValue("due_date", e.target.value, { shouldValidate: true })} className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20" /></div>
            <div className="space-y-2"><label className="text-xs font-medium text-slate-400">НДС</label><div className="flex gap-2">{[0, 10, 20].map(r => <button key={r} type="button" onClick={() => form.setValue("vat_rate", r, { shouldValidate: true })} className={cn("flex-1 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors", vatRate === r ? "border-amber-500 bg-amber-500/10 text-amber-400" : "border-slate-700 text-slate-500 hover:border-slate-600")}>{r === 0 ? "0%" : `${r}%`}</button>)}</div></div>
          </div>
          {/* Line Items */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-slate-400">Позиции ({fields.length})</label>
            <div className="space-y-1.5">
              {fields.map((f, i) => (
                <div key={f.id} className="flex items-center gap-2">
                  <input type="text" value={form.watch(`line_items.${i}.description`)} onChange={e => form.setValue(`line_items.${i}.description`, e.target.value, { shouldValidate: true })} placeholder="Описание" className="flex-1 rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none" />
                  <input type="number" value={form.watch(`line_items.${i}.quantity`) || ""} onChange={e => form.setValue(`line_items.${i}.quantity`, Number(e.target.value), { shouldValidate: true })} className="w-16 rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-center text-slate-100 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  <input type="number" value={form.watch(`line_items.${i}.unit_price`) || ""} onChange={e => form.setValue(`line_items.${i}.unit_price`, Number(e.target.value), { shouldValidate: true })} className="w-[110px] rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-right text-slate-100 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                  <span className="text-xs text-slate-400 w-[90px] text-right">{fmtAmt((form.watch(`line_items.${i}.unit_price`) || 0) * (form.watch(`line_items.${i}.quantity`) || 0))}</span>
                  <button type="button" onClick={() => remove(i)} className="rounded p-1 text-slate-600 hover:text-rose-400 transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => append({ description: "", quantity: 1, unit_price: 0, source: "manual", source_label: "" })} className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-600 transition-colors"><Plus className="h-3 w-3" />Добавить позицию</button>
          </div>
          {errors.line_items && <p className="text-xs text-rose-400">{errors.line_items.message ?? errors.line_items.root?.message}</p>}
          <div className="space-y-2"><label className="text-xs font-medium text-slate-400">Примечания</label><textarea rows={2} value={form.watch("notes") ?? ""} onChange={e => form.setValue("notes", e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 resize-none focus:border-amber-500 focus:outline-none" /></div>
          {fields.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-slate-400">Подытог</span><span className="text-slate-200">{fmtAmt(subtotal)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-400">НДС ({vatRate}%)</span><span className="text-slate-200">{fmtAmt(vatAmount)}</span></div>
              <div className="flex justify-between border-t border-slate-800 pt-2"><span className="font-semibold text-slate-200">Итого</span><span className="font-bold text-amber-400">{fmtAmt(grandTotal)}</span></div>
            </div>
          )}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">Отмена</button>
            <button type="submit" disabled={!isValid} className={cn("flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed")}>
              {form.formState.isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />Создаём...</> : "Создать счёт"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}