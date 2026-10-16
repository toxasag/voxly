"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { X, ArrowRightLeft, Wallet, Building2, CreditCard, Loader2 } from "lucide-react";
import type { AccountType } from "@/lib/finance/finance.types";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

const transferSchema = z.object({
  from_account_id: z.string().min(1, "Укажите счёт списания"),
  to_account_id: z.string().min(1, "Укажите счёт зачисления"),
  amount: z.number({ invalid_type_error: "Сумма должна быть числом" }).min(1, "Минимум 1 RUB"),
}).refine(d => d.from_account_id !== d.to_account_id, { message: "Нельзя перевести на тот же счёт", path: ["to_account_id"] });

type TransferPayload = z.infer<typeof transferSchema>;

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: TransferPayload) => void;
  accounts: { id: string; name: string; balance: number }[];
}

const ICONS: Record<string, typeof Wallet> = { cash: Wallet, bank: Building2, acquiring: CreditCard };

export function TransferModal({ open, onClose, onSubmit, accounts }: TransferModalProps) {
  const form = useForm<TransferPayload>({ resolver: zodResolver(transferSchema), defaultValues: { from_account_id: "", to_account_id: "", amount: 0 }, mode: "onChange" });
  const handleSubmit = useCallback((v: TransferPayload) => { onSubmit(v); form.reset(); onClose(); }, [onSubmit, form, onClose]);
  const backdrop = useCallback((e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); }, [onClose]);
  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose });

  useEffect(() => { if (open) form.reset(); }, [open, form]);

  if (!open) return null;
  const { errors, isValid } = form.formState;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4" onClick={backdrop}>
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10"><ArrowRightLeft className="h-4 w-4 text-sky-400" /></div><div><h2 className="text-sm font-semibold text-slate-100">Перевод</h2><p className="text-xs text-slate-500">Между вашими счетами</p></div></div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={form.handleSubmit(handleSubmit)} className="p-6 space-y-4">
          {(["from_account_id", "to_account_id"] as const).map(field => (
            <div key={field} className="space-y-2">
              <label className="block text-xs font-medium text-slate-400">{field === "from_account_id" ? "Откуда" : "Куда"}</label>
              <div className="flex flex-wrap gap-2">
                 {accounts.map(a => { const Icon = ICONS[a.name as string] ?? Wallet;
                   return (<button key={a.id} type="button" onClick={() => form.setValue(field, a.id, { shouldValidate: true })}
                     className={cn("flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors flex-1", form.watch(field) === a.id ? "border-amber-500 bg-amber-500/10 text-amber-400" : "border-slate-700 text-slate-500 hover:border-slate-600")}>
                     <Icon className="h-3.5 w-3.5" />{a.name}<span className="ml-auto text-slate-400">{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(a.balance)}</span></button>);
                 })}
              </div>
              {errors[field] && <p className="text-xs text-rose-400">{errors[field]?.message}</p>}
            </div>
          ))}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400">Сумма (RUB)</label>
            <input type="number" min={1} value={form.watch("amount") === 0 ? "" : form.watch("amount")} onChange={e => form.setValue("amount", e.target.value === "" ? 0 : Number(e.target.value), { shouldValidate: true })}
              className={cn("w-full rounded-lg border bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none", errors.amount ? "border-rose-500" : "border-slate-700")} />
            {errors.amount && <p className="text-xs text-rose-400">{errors.amount.message}</p>}
          </div>
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">Отмена</button>
            <button type="submit" disabled={!isValid} className={cn("flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed")}>
              {form.formState.isSubmitting ? <><Loader2 className="h-4 w-4 animate-spin" />Выполняем...</> : "Перевести"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}