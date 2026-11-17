"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  TrendingUp,
  TrendingDown,
  Loader2,
  Wallet,
  Building2,
  CreditCard,
  ShieldCheck,
  Plus,
  FolderTree,
  Calendar,
  FileText,
  Link as LinkIcon,
  HelpCircle,
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
import {
  useAccounts,
  useFinanceCategories,
  type AccountDTO,
} from "@/lib/api/use-invoices";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { CreateAccountModal } from "./CreateAccountModal";
import { CounterpartyCombobox } from "./CounterpartyCombobox";
import { cn } from "@/lib/utils";

interface CreateTransactionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateTransactionPayload) => void;
  accounts?: AccountDTO[];
  onOpenCategories?: () => void;
}

const ACCOUNT_ICONS: Record<AccountType, LucideIcon> = {
  cash: Wallet,
  bank: Building2,
  acquiring: CreditCard,
  safe: ShieldCheck,
};

function formatAmount(val: number): string {
  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(val);
}

export function CreateTransactionModal({
  open,
  onClose,
  onSubmit,
  accounts: propAccounts,
  onOpenCategories,
}: CreateTransactionModalProps) {
  const { data: apiAccounts = [] } = useAccounts();
  const accounts = propAccounts ?? apiAccounts;

  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [showLinks, setShowLinks] = useState(false);

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

  const txType = form.watch("type");
  const isIncome = txType === "income";

  // Categories from DB or fallbacks
  const { data: dbCategories = [] } = useFinanceCategories(txType);
  const fallbackCategories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const categoriesList = useMemo(() => {
    if (dbCategories.length > 0) {
      return dbCategories.map((c) => ({ id: c.id, name: c.name }));
    }
    return fallbackCategories.map((c) => ({ id: c.value, name: c.label }));
  }, [dbCategories, fallbackCategories]);

  // Set default account when accounts change or on open
  useEffect(() => {
    if (open && accounts.length > 0 && !form.getValues("account_id")) {
      const defaultAcc = accounts.find((a) => a.isDefault) || accounts[0];
      if (defaultAcc) {
        form.setValue("account_id", defaultAcc.id, { shouldValidate: true });
      }
    }
  }, [open, accounts, form]);

  // When type changes, clear category selection
  useEffect(() => {
    if (categoriesList.length > 0 && !form.getValues("category_id")) {
      form.setValue("category_id", categoriesList[0].id, { shouldValidate: true });
      form.setValue("category_name", categoriesList[0].name);
    }
  }, [txType, categoriesList, form]);

  const handleSubmit = useCallback(
    (values: CreateTransactionPayload) => {
      // Ensure category_name is populated
      const matchedCat = categoriesList.find((c) => c.id === values.category_id);
      const payload: CreateTransactionPayload = {
        ...values,
        category_name: matchedCat?.name || values.category_name || "Прочее",
      };
      onSubmit(payload);
      form.reset();
      onClose();
    },
    [onSubmit, form, onClose, categoriesList],
  );

  useEffect(() => {
    if (open) {
      form.reset({
        type: "income",
        category_name: "",
        category_id: "",
        amount: 0,
        account_id: accounts.find((a) => a.isDefault)?.id || accounts[0]?.id || "",
        description: "",
        counterparty_name: "",
        counterparty_inn: "",
        deal_id: "",
        repair_order_id: "",
        invoice_id: "",
        occurred_at: new Date().toISOString().slice(0, 16),
      });
      setShowLinks(false);
    }
  }, [open, form, accounts]);

  if (!open) return null;

  const { errors, isValid, isSubmitting } = form.formState;
  const amountValue = Number(form.watch("amount") || 0);
  const selectedAccountId = form.watch("account_id");
  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  return (
    <>
      <Sheet open={open} onClose={onClose} width="w-[840px]" resizable>
        <SheetHeader onClose={onClose}>
          <div className="flex items-center gap-2.5">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors",
                isIncome
                  ? "bg-emerald-50 text-emerald-600 border border-emerald-200"
                  : "bg-rose-50 text-rose-600 border border-rose-200",
              )}
            >
              {isIncome ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">
                {isIncome ? "Новая доходная операция" : "Новый расход"}
              </h2>
              <p className="text-xs text-[#666666]">
                Внесение транзакции с автоматическим изменением баланса счёта
              </p>
            </div>
          </div>
        </SheetHeader>

        <SheetContent>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col h-full">
            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              {/* Type Switcher Segmented Control */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#111111]">
                  Тип финансовой операции *
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-[8px] bg-[#f5f5f5] p-1 border border-[#e5e5e5]">
                  <button
                    type="button"
                    onClick={() => {
                      form.setValue("type", "income", { shouldValidate: true });
                      form.setValue("category_id", "");
                    }}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-[6px] py-2 text-xs font-semibold transition-all cursor-pointer",
                      isIncome
                        ? "bg-white text-emerald-700 shadow-xs border border-emerald-200 ring-1 ring-emerald-500/20"
                        : "text-[#666666] hover:text-[#111111]",
                    )}
                  >
                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                    <span>Доход (Поступление)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      form.setValue("type", "expense", { shouldValidate: true });
                      form.setValue("category_id", "");
                    }}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-[6px] py-2 text-xs font-semibold transition-all cursor-pointer",
                      !isIncome
                        ? "bg-white text-rose-700 shadow-xs border border-rose-200 ring-1 ring-rose-500/20"
                        : "text-[#666666] hover:text-[#111111]",
                    )}
                  >
                    <TrendingDown className="h-4 w-4 text-rose-600" />
                    <span>Расход (Списание)</span>
                  </button>
                </div>
              </div>

              {/* 2-Column Responsive Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* LEFT COLUMN: Amount, Account, Date */}
                <div className="space-y-4">
                  {/* Amount Field */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#111111]">
                      Сумма операции *
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        placeholder="0.00"
                        className={cn(
                          "h-10 w-full rounded-[8px] border bg-white pl-3 pr-12 font-mono text-base font-semibold tabular-nums text-[#111111] transition-all placeholder:text-[#888888] focus:outline-none",
                          errors.amount
                            ? "border-rose-400 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
                            : "border-[#e5e5e5] focus:border-[#4a38f5] focus:ring-1 focus:ring-[#4a38f5]/20",
                        )}
                        {...form.register("amount", { valueAsNumber: true })}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-sm font-semibold text-[#888888]">
                        ₽
                      </span>
                    </div>
                    {errors.amount && (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {errors.amount.message || "Укажите сумму больше нуля"}
                      </p>
                    )}
                  </div>

                  {/* Account Selection with Inline + Button */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#111111]">
                        {isIncome ? "Счёт зачисления *" : "Счёт списания *"}
                      </label>
                      <button
                        type="button"
                        onClick={() => setCreateAccountOpen(true)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />
                        Добавить счёт / кассу
                      </button>
                    </div>

                    {accounts.length === 0 ? (
                      <div className="rounded-[8px] border border-dashed border-[#e5e5e5] p-3 text-center">
                        <p className="text-xs text-[#666666] mb-2">У вас ещё нет счетов или касс</p>
                        <button
                          type="button"
                          onClick={() => setCreateAccountOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#3d2ee0]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Создать первый счёт
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <select
                          className={cn(
                            "h-9 w-full rounded-[8px] border bg-white px-3 text-xs text-[#111111] transition-all focus:outline-none cursor-pointer",
                            errors.account_id
                              ? "border-rose-400 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
                              : "border-[#e5e5e5] focus:border-[#4a38f5] focus:ring-1 focus:ring-[#4a38f5]/20",
                          )}
                          {...form.register("account_id")}
                        >
                          <option value="">Выберите счёт или кассу...</option>
                          {accounts.map((acc) => {
                            const typeLabel =
                              acc.accountType === "bank"
                                ? "Безнал"
                                : acc.accountType === "cash"
                                ? "Касса"
                                : acc.accountType === "acquiring"
                                ? "Эквайринг"
                                : acc.accountType === "safe"
                                ? "Сейф"
                                : "Счёт";
                            return (
                              <option key={acc.id} value={acc.id}>
                                {acc.name} ({typeLabel}) — {formatAmount(acc.balance)} {acc.currency}
                              </option>
                            );
                          })}
                        </select>

                        {/* Selected Account Balance preview pill */}
                        {selectedAccount && (
                          <div className="flex items-center justify-between rounded-[6px] bg-[#fafafa] px-2.5 py-1.5 border border-[#e5e5e5] text-xs">
                            <div className="flex items-center gap-1.5 text-[#666666]">
                              {(() => {
                                const Icon = ACCOUNT_ICONS[selectedAccount.accountType || "cash"] || Wallet;
                                return <Icon className="h-3.5 w-3.5 text-[#4a38f5]" />;
                              })()}
                              <span>Текущий остаток:</span>
                            </div>
                            <span className="font-mono font-semibold tabular-nums text-[#111111]">
                              {formatAmount(selectedAccount.balance)} {selectedAccount.currency}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {errors.account_id && (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {errors.account_id.message || "Выберите счёт"}
                      </p>
                    )}
                  </div>

                  {/* Date & Time */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#111111]">
                      Дата и время операции *
                    </label>
                    <div className="relative">
                      <input
                        type="datetime-local"
                        className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] transition-all focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 cursor-pointer"
                        {...form.register("occurred_at")}
                      />
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN: Category, Counterparty, CRM Links */}
                <div className="space-y-4">
                  {/* Category Selection */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#111111]">
                        Статья {isIncome ? "дохода" : "расхода"} *
                      </label>
                      {onOpenCategories && (
                        <button
                          type="button"
                          onClick={onOpenCategories}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors cursor-pointer"
                        >
                          <FolderTree className="h-3 w-3" />
                          Категории
                        </button>
                      )}
                    </div>
                    <select
                      className={cn(
                        "h-9 w-full rounded-[8px] border bg-white px-3 text-xs text-[#111111] transition-all focus:outline-none cursor-pointer",
                        errors.category_id
                          ? "border-rose-400 focus:border-rose-500 focus:ring-1 focus:ring-rose-500/20"
                          : "border-[#e5e5e5] focus:border-[#4a38f5] focus:ring-1 focus:ring-[#4a38f5]/20",
                      )}
                      value={form.watch("category_id") || ""}
                      onChange={(e) => {
                        const catId = e.target.value;
                        const matched = categoriesList.find((c) => c.id === catId);
                        form.setValue("category_id", catId, { shouldValidate: true });
                        form.setValue("category_name", matched ? matched.name : "");
                      }}
                    >
                      <option value="">Выберите категорию статьи...</option>
                      {categoriesList.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                    {errors.category_id && (
                      <p className="text-[11px] text-rose-600 font-medium">
                        {errors.category_id.message || "Выберите категорию"}
                      </p>
                    )}
                  </div>

                  {/* Counterparty Autocomplete from CRM */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#111111]">
                        Контрагент (Клиент / Поставщик)
                      </label>
                      <span className="text-[11px] text-[#888888]">CRM контакты и компании</span>
                    </div>
                    <CounterpartyCombobox
                      value={form.watch("counterparty_name") || ""}
                      inn={form.watch("counterparty_inn") || ""}
                      onChange={(name, inn) => {
                        form.setValue("counterparty_name", name, { shouldValidate: true });
                        form.setValue("counterparty_inn", inn || "");
                      }}
                      placeholder="Поиск по контактам, компаниям или ввести вручную..."
                    />
                  </div>

                  {/* Optional CRM Entity Links toggle */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={() => setShowLinks(!showLinks)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      <LinkIcon className="h-3.5 w-3.5 text-[#888888]" />
                      <span>{showLinks ? "Скрыть привязку к сущностям CRM" : "+ Привязать к сделке или заказ-наряду"}</span>
                    </button>

                    {showLinks && (
                      <div className="mt-2.5 space-y-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 animate-in fade-in duration-150">
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-[#666666]">ID Сделки (CRM)</label>
                          <input
                            type="text"
                            placeholder="Например, deal_123..."
                            className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                            {...form.register("deal_id")}
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[11px] font-medium text-[#666666]">ID Заказ-наряда (Сервис)</label>
                          <input
                            type="text"
                            placeholder="Например, ro_456..."
                            className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                            {...form.register("repair_order_id")}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Full-width Description */}
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-[#111111]">
                  Назначение платежа / Комментарий
                </label>
                <textarea
                  rows={3}
                  placeholder="Укажите назначение платежа, номер счёта или договора, примечание для бухгалтерии..."
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-xs text-[#111111] transition-all placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 resize-none"
                  {...form.register("description")}
                />
              </div>
            </div>

            {/* Footer with Summary & Actions */}
            <div className="flex items-center justify-between border-t border-[#e5e5e5] bg-[#fafafa] px-6 py-4">
              <div className="text-xs">
                <span className="text-[#666666]">Итого к {isIncome ? "поступлению" : "списанию"}: </span>
                <span
                  className={cn(
                    "font-mono text-sm font-semibold tabular-nums ml-1",
                    isIncome ? "text-emerald-700" : "text-rose-700",
                  )}
                >
                  {isIncome ? "+" : "-"}
                  {formatAmount(amountValue)} ₽
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={!isValid || isSubmitting || amountValue <= 0}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-[8px] px-4 text-xs font-semibold text-white shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
                    isIncome
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-[#4a38f5] hover:bg-[#3d2ee0]",
                  )}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>Сохранение...</span>
                    </>
                  ) : (
                    <>
                      {isIncome ? (
                        <>
                          <TrendingUp className="h-3.5 w-3.5" />
                          <span>Зачислить {amountValue > 0 ? `${formatAmount(amountValue)} ₽` : ""}</span>
                        </>
                      ) : (
                        <>
                          <TrendingDown className="h-3.5 w-3.5" />
                          <span>Списать {amountValue > 0 ? `${formatAmount(amountValue)} ₽` : ""}</span>
                        </>
                      )}
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      {/* Nested Create Account Modal */}
      <CreateAccountModal
        open={createAccountOpen}
        onClose={() => setCreateAccountOpen(false)}
        onCreated={(newAccount) => {
          form.setValue("account_id", newAccount.id, { shouldValidate: true });
        }}
      />
    </>
  );
}
