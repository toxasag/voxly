"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Banknote,
  TrendingUp,
  TrendingDown,
  Loader2,
  Wallet,
  Building2,
  CreditCard,
  type LucideIcon,
} from "lucide-react";
import {
  createTransactionSchema,
  type CreateTransactionPayload,
} from "@/schemas/finance.schema";
import {
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  type AccountType,
} from "@/lib/finance/finance.types";
import { useAccounts } from "@/lib/api/use-invoices";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface CreateTransactionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateTransactionPayload) => void;
  accounts?: { id: string; name: string; currency: string; balance: number }[];
}

const ACCOUNT_ICONS: Record<string, LucideIcon> = {
  cash: Wallet,
  bank: Building2,
  acquiring: CreditCard,
};

export function CreateTransactionModal({
  open,
  onClose,
  onSubmit,
  accounts: propAccounts,
}: CreateTransactionModalProps) {
  const { data: apiAccounts = [] } = useAccounts();
  const accounts = propAccounts ?? apiAccounts;

  const form = useForm<CreateTransactionPayload>({
    resolver: zodResolver(createTransactionSchema),
    defaultValues: {
      type: "income",
      category_name: "",
      category_id: "",
      amount: 0,
      account_id: "",
      description: "",
      counterparty_name: "",
      counterparty_inn: "",
      deal_id: "",
      repair_order_id: "",
      invoice_id: "",
      occurred_at: new Date().toISOString().slice(0, 16),
    },
    mode: "onChange",
  });

  const handleSubmit = useCallback(
    (values: CreateTransactionPayload) => {
      onSubmit(values);
      form.reset();
      onClose();
    },
    [onSubmit, form, onClose],
  );

  useEffect(() => {
    if (open) {
      form.reset();
    }
  }, [open, form]);

  if (!open) return null;

  const { errors, isValid } = form.formState;
  const txType = form.watch("type");
  const isIncome = txType === "income";
  const categories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const amountValue = form.watch("amount");

  return (
    <Sheet open={open} onClose={onClose} width="w-[560px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg",
              isIncome ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600",
            )}
          >
            <Banknote className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              {isIncome ? "Новый доход" : "Новый расход"}
            </h2>
            <p className="text-xs text-[#666666]">Ручное добавление операции</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {/* Type Toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  form.setValue("type", "income", { shouldValidate: true });
                  form.setValue("category_name", "", { shouldValidate: true });
                  form.setValue("category_id", "", { shouldValidate: true });
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer",
                  isIncome
                    ? "border-emerald-500 bg-emerald-50 text-emerald-700 shadow-sm"
                    : "border-[#e5e5e5] bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                <TrendingUp className="h-4 w-4" />
                Доход
              </button>
              <button
                type="button"
                onClick={() => {
                  form.setValue("type", "expense", { shouldValidate: true });
                  form.setValue("category_name", "", { shouldValidate: true });
                  form.setValue("category_id", "", { shouldValidate: true });
                }}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium transition-colors cursor-pointer",
                  !isIncome
                    ? "border-rose-500 bg-rose-50 text-rose-700 shadow-sm"
                    : "border-[#e5e5e5] bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                <TrendingDown className="h-4 w-4" />
                Расход
              </button>
            </div>

            {/* Amount */}
            <div className="space-y-1.5">
              <label htmlFor="tx-amount" className="block text-xs font-medium text-slate-700">
                Сумма (RUB) *
              </label>
              <div className="relative">
                <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  id="tx-amount"
                  type="number"
                  min={0}
                  step={0.01}
                  placeholder="0"
                  value={amountValue === 0 ? "" : amountValue}
                  onChange={(e) =>
                    form.setValue(
                      "amount",
                      e.target.value === "" ? 0 : parseFloat(e.target.value),
                      { shouldValidate: true },
                    )
                  }
                  className={cn(
                    "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 pl-10 pr-4 text-sm text-[#111111] placeholder:text-slate-400 transition-colors",
                    "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                    "[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                    errors.amount && "border-rose-500",
                  )}
                />
              </div>
              {errors.amount && <p className="text-xs text-rose-500">{errors.amount.message}</p>}
            </div>

            {/* Category */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">Категория *</label>
              <select
                value={form.watch("category_name")}
                onChange={(e) => {
                  form.setValue("category_name", e.target.value, { shouldValidate: true });
                  form.setValue("category_id", e.target.value, { shouldValidate: true });
                }}
                className={cn(
                  "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] appearance-none transition-colors",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                  errors.category_name && "border-rose-500",
                )}
              >
                <option value="" disabled>
                  Выберите категорию...
                </option>
                {categories.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
              {errors.category_name && (
                <p className="text-xs text-rose-500">{errors.category_name.message}</p>
              )}
            </div>

            {/* Account */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">Счёт *</label>
              <div className="grid grid-cols-3 gap-2">
                {accounts.map((acc) => {
                  const AccountIcon = ACCOUNT_ICONS[acc.name as AccountType] ?? Wallet;
                  const isSelected = form.watch("account_id") === acc.id;
                  return (
                    <button
                      key={acc.id}
                      type="button"
                      onClick={() =>
                        form.setValue("account_id", acc.id, { shouldValidate: true })
                      }
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors cursor-pointer",
                        isSelected
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-slate-700 hover:bg-slate-50",
                      )}
                    >
                      <AccountIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{acc.name}</span>
                    </button>
                  );
                })}
              </div>
              {errors.account_id && (
                <p className="text-xs text-rose-500">{errors.account_id.message}</p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label htmlFor="tx-desc" className="block text-xs font-medium text-slate-700">
                Описание
              </label>
              <input
                id="tx-desc"
                type="text"
                placeholder="Замена экрана — iPhone 15 Pro"
                value={form.watch("description")}
                onChange={(e) =>
                  form.setValue("description", e.target.value, { shouldValidate: true })
                }
                className={cn(
                  "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 transition-colors",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                  errors.description && "border-rose-500",
                )}
              />
              {errors.description && (
                <p className="text-xs text-rose-500">{errors.description.message}</p>
              )}
            </div>

            {/* Counterparty */}
            <div className="space-y-1.5">
              <label htmlFor="tx-counterparty" className="block text-xs font-medium text-slate-700">
                Контрагент
              </label>
              <input
                id="tx-counterparty"
                type="text"
                placeholder="Имя клиента / Поставщик / Внутренняя"
                value={form.watch("counterparty_name")}
                onChange={(e) =>
                  form.setValue("counterparty_name", e.target.value, { shouldValidate: true })
                }
                className={cn(
                  "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 transition-colors",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                  errors.counterparty_name && "border-rose-500",
                )}
              />
            </div>

            {/* Date */}
            <div className="space-y-1.5">
              <label htmlFor="tx-date" className="block text-xs font-medium text-slate-700">
                Дата и время
              </label>
              <input
                id="tx-date"
                type="datetime-local"
                value={form.watch("occurred_at")}
                onChange={(e) =>
                  form.setValue("occurred_at", e.target.value, { shouldValidate: true })
                }
                className={cn(
                  "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] transition-colors",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                  errors.occurred_at && "border-rose-500",
                )}
              />
            </div>
          </div>

          {/* Actions */}
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
              className={cn(
                "flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold transition-colors text-white",
                isIncome
                  ? "bg-emerald-600 hover:bg-emerald-500"
                  : "bg-rose-600 hover:bg-rose-500",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Сохраняем...
                </>
              ) : (
                `Сохранить ${isIncome ? "доход" : "расход"}`
              )}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
