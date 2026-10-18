"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowRightLeft, Wallet, Building2, CreditCard, Loader2 } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const transferSchema = z
  .object({
    from_account_id: z.string().min(1, "Укажите счёт списания"),
    to_account_id: z.string().min(1, "Укажите счёт зачисления"),
    amount: z.number({ invalid_type_error: "Сумма должна быть числом" }).min(1, "Минимум 1 RUB"),
  })
  .refine((d) => d.from_account_id !== d.to_account_id, {
    message: "Нельзя перевести на тот же счёт",
    path: ["to_account_id"],
  });

type TransferPayload = z.infer<typeof transferSchema>;

interface TransferModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: TransferPayload) => void;
  accounts: { id: string; name: string; balance: number }[];
}

const ICONS: Record<string, typeof Wallet> = {
  cash: Wallet,
  bank: Building2,
  acquiring: CreditCard,
};

export function TransferModal({ open, onClose, onSubmit, accounts }: TransferModalProps) {
  const form = useForm<TransferPayload>({
    resolver: zodResolver(transferSchema),
    defaultValues: { from_account_id: "", to_account_id: "", amount: 0 },
    mode: "onChange",
  });

  const handleSubmit = useCallback(
    (v: TransferPayload) => {
      onSubmit(v);
      form.reset();
      onClose();
    },
    [onSubmit, form, onClose],
  );

  useEffect(() => {
    if (open) form.reset();
  }, [open, form]);

  if (!open) return null;
  const { errors, isValid } = form.formState;

  return (
    <Sheet open={open} onClose={onClose} width="w-[500px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <ArrowRightLeft className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Перевод</h2>
            <p className="text-xs text-[#666666]">Между вашими счетами</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {(["from_account_id", "to_account_id"] as const).map((field) => (
              <div key={field} className="space-y-1.5">
                <label className="block text-xs font-medium text-slate-700">
                  {field === "from_account_id" ? "Откуда" : "Куда"}
                </label>
                <div className="flex flex-col gap-2">
                  {accounts.map((a) => {
                    const Icon = ICONS[a.name] ?? Wallet;
                    const isSelected = form.watch(field) === a.id;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => form.setValue(field, a.id, { shouldValidate: true })}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer text-left",
                          isSelected
                            ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                            : "border-[#e5e5e5] bg-white text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span>{a.name}</span>
                        <span className="ml-auto text-slate-500 font-mono">
                          {new Intl.NumberFormat("ru-RU", {
                            style: "currency",
                            currency: "RUB",
                            maximumFractionDigits: 0,
                          }).format(a.balance)}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {errors[field] && (
                  <p className="text-xs text-rose-500">{errors[field]?.message}</p>
                )}
              </div>
            ))}

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">Сумма (RUB) *</label>
              <input
                type="number"
                min={1}
                value={form.watch("amount") === 0 ? "" : form.watch("amount")}
                onChange={(e) =>
                  form.setValue("amount", e.target.value === "" ? 0 : Number(e.target.value), {
                    shouldValidate: true,
                  })
                }
                className={cn(
                  "w-full rounded-lg border bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                  errors.amount ? "border-rose-500" : "border-[#e5e5e5]",
                )}
              />
              {errors.amount && <p className="text-xs text-rose-500">{errors.amount.message}</p>}
            </div>
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
                  Выполняем...
                </>
              ) : (
                "Перевести"
              )}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}