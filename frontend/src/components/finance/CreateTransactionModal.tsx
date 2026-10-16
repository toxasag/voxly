"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  X,
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
  MOCK_ACCOUNTS,
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
} from "@/lib/finance/mock-finance";
import type { AccountType } from "@/lib/finance/finance.types";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

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

export function CreateTransactionModal({ open, onClose, onSubmit, accounts = MOCK_ACCOUNTS }: CreateTransactionModalProps) {
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

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose });

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                isIncome ? "bg-emerald-500/10" : "bg-rose-500/10",
              )}
            >
              <Banknote
                className={cn("h-4 w-4", isIncome ? "text-emerald-400" : "text-rose-400")}
              />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {isIncome ? "Новый доход" : "Новый расход"}
              </h2>
              <p className="text-xs text-slate-500">Ручное добавление операции</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={form.handleSubmit(handleSubmit)} className="p-6 space-y-4">
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
                "flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                isIncome
                  ? "border-emerald-500 bg-emerald-500/10 text-emerald-400"
                  : "border-slate-700 text-slate-500 hover:border-slate-600",
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
                "flex items-center justify-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium transition-colors",
                !isIncome
                  ? "border-rose-500 bg-rose-500/10 text-rose-400"
                  : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
              )}
            >
              <TrendingDown className="h-4 w-4" />
              Расход
            </button>
          </div>

          {/* Amount */}
          <div className="space-y-2">
            <label htmlFor="tx-amount" className="block text-xs font-medium text-slate-400">
              Сумма
            </label>
            <div className="relative">
              <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
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
                  "w-full rounded-lg border bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                  "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                  "[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                  errors.amount ? "border-rose-500" : "border-slate-700",
                )}
              />
            </div>
            {errors.amount && <p className="text-xs text-rose-400">{errors.amount.message}</p>}
          </div>

          {/* Category */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400">Категория</label>
            <select
              value={form.watch("category_name")}
              onChange={(e) => {
                form.setValue("category_name", e.target.value, { shouldValidate: true });
                form.setValue("category_id", e.target.value, { shouldValidate: true });
              }}
              className={cn(
                "w-full rounded-lg border bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 appearance-none transition-colors",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                errors.category_name ? "border-rose-500" : "border-slate-700",
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
              <p className="text-xs text-rose-400">{errors.category_name.message}</p>
            )}
          </div>

          {/* Account */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400">Счёт</label>
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
                      "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors",
                      isSelected
                        ? "border-amber-500 bg-amber-500/10 text-amber-400"
                        : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
                    )}
                  >
                    <AccountIcon className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{acc.name}</span>
                  </button>
                );
              })}
            </div>
            {errors.account_id && (
              <p className="text-xs text-rose-400">{errors.account_id.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label htmlFor="tx-desc" className="block text-xs font-medium text-slate-400">
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
                "w-full rounded-lg border bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                errors.description ? "border-rose-500" : "border-slate-700",
              )}
            />
            {errors.description && (
              <p className="text-xs text-rose-400">{errors.description.message}</p>
            )}
          </div>

          {/* Counterparty */}
          <div className="space-y-2">
            <label htmlFor="tx-counterparty" className="block text-xs font-medium text-slate-400">
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
                "w-full rounded-lg border bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                errors.counterparty_name ? "border-rose-500" : "border-slate-700",
              )}
            />
            {errors.counterparty_name && (
              <p className="text-xs text-rose-400">{errors.counterparty_name.message}</p>
            )}
          </div>

          {/* Date */}
          <div className="space-y-2">
            <label htmlFor="tx-date" className="block text-xs font-medium text-slate-400">
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
                "w-full rounded-lg border bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 transition-colors",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                "scheme-dark",
                errors.occurred_at ? "border-rose-500" : "border-slate-700",
              )}
            />
            {errors.occurred_at && <p className="text-xs text-rose-400">{errors.occurred_at.message}</p>}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className={cn(
                "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors",
                isIncome
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "bg-rose-600 text-white hover:bg-rose-500",
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
      </div>
    </div>
  );
}
