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
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  updateTransactionSchema,
  type UpdateTransactionPayload,
} from "@/schemas/finance.schema";
import {
  INCOME_CATEGORIES,
  EXPENSE_CATEGORIES,
  type AccountType,
  type Transaction,
} from "@/lib/finance/finance.types";
import {
  useAccounts,
  useFinanceCategories,
  useUpdateTransaction,
  type AccountDTO,
} from "@/lib/api/use-invoices";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { CreateAccountModal } from "./CreateAccountModal";
import { CounterpartyCombobox } from "./CounterpartyCombobox";
import { TransactionEntityPickers } from "./TransactionEntityPickers";
import { cn } from "@/lib/utils";

interface EditTransactionModalProps {
  open: boolean;
  onClose: () => void;
  transaction: Transaction | null;
  accounts?: AccountDTO[];
  onOpenCategories?: () => void;
  onDelete?: (tx: Transaction) => void;
}

const ACCOUNT_ICONS: Record<AccountType, LucideIcon> = {
  cash: Wallet,
  bank: Building2,
  acquiring: CreditCard,
  safe: ShieldCheck,
};

function formatIsoForInput(isoString?: string): string {
  if (!isoString) return new Date().toISOString().slice(0, 16);
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 16);
    // YYYY-MM-DDTHH:mm
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const mins = String(d.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hours}:${mins}`;
  } catch {
    return new Date().toISOString().slice(0, 16);
  }
}

export function EditTransactionModal({
  open,
  onClose,
  transaction,
  accounts: propAccounts,
  onOpenCategories,
  onDelete,
}: EditTransactionModalProps) {
  const { data: apiAccounts = [] } = useAccounts();
  const accounts = propAccounts ?? apiAccounts;
  const updateMutation = useUpdateTransaction();

  const [createAccountOpen, setCreateAccountOpen] = useState(false);

  const form = useForm<UpdateTransactionPayload>({
    resolver: zodResolver(updateTransactionSchema),
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
      occurred_at: "",
    },
    mode: "onChange",
  });

  const txType = form.watch("type") ?? (transaction?.type === "income" ? "income" : "expense");
  const isIncome = txType === "income";

  // Categories from DB or fallbacks
  const { data: dbCategories = [] } = useFinanceCategories(isIncome ? "income" : "expense");
  const fallbackCategories = isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const categoriesList = useMemo(() => {
    if (dbCategories.length > 0) {
      return dbCategories.map((c) => ({ id: c.id, name: c.name }));
    }
    return fallbackCategories.map((c) => ({ id: c.value, name: c.label }));
  }, [dbCategories, fallbackCategories]);

  // Pre-fill form once when modal opens for a transaction
  useEffect(() => {
    if (open && transaction) {
      const type: "income" | "expense" = transaction.type === "income" ? "income" : "expense";
      form.reset({
        type,
        amount: transaction.amount,
        account_id: transaction.account_id,
        category_name: transaction.category || "",
        category_id: transaction.category_id || "",
        description: transaction.description || "",
        counterparty_name: transaction.counterparty || "",
        counterparty_inn: transaction.counterparty_inn || "",
        deal_id:
          transaction.deal_id ||
          (transaction.linked_entity_type === "deal" ? transaction.linked_entity_id || "" : ""),
        repair_order_id:
          transaction.repair_order_id ||
          (transaction.linked_entity_type === "repair" ? transaction.linked_entity_id || "" : ""),
        occurred_at: formatIsoForInput(transaction.date),
      });
    }
  }, [open, transaction, form]);

  // Match category_id by category name once categories finish loading without resetting user edits
  useEffect(() => {
    if (!open || !transaction || categoriesList.length === 0) return;
    const currentId = form.getValues("category_id");
    if (currentId && categoriesList.some((c) => c.id === currentId)) return;

    const currentName = (form.getValues("category_name") || transaction.category || "").trim().toLowerCase();
    if (!currentName) return;

    const matched = categoriesList.find((c) => c.name.trim().toLowerCase() === currentName);
    if (matched) {
      form.setValue("category_id", matched.id);
    }
  }, [open, transaction, categoriesList, form]);

  const handleSubmit = useCallback(
    async (values: UpdateTransactionPayload) => {
      if (!transaction) return;
      try {
        const selectedCatId = values.category_id?.trim() || "";
        const matchedCat = categoriesList.find((c) => c.id === selectedCatId);
        const payload: UpdateTransactionPayload = {
          ...values,
          category_id: selectedCatId ? selectedCatId : undefined,
          category_name: matchedCat?.name || values.category_name || transaction.category || "Прочее",
          deal_id: values.deal_id ? values.deal_id.trim() : null,
          repair_order_id: values.repair_order_id ? values.repair_order_id.trim() : null,
          occurred_at: values.occurred_at
            ? new Date(values.occurred_at).toISOString()
            : undefined,
        };
        await updateMutation.mutateAsync({ id: transaction.id, payload });
        toast.success("Операция успешно обновлена");
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить изменения");
      }
    },
    [transaction, categoriesList, updateMutation, onClose],
  );

  if (!open || !transaction) return null;

  const { errors, isSubmitting } = form.formState;
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
                Редактирование операции
              </h2>
              <p className="text-xs text-[#666666]">
                Изменение реквизитов операции с автоматическим пересчётом баланса
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

                    <div className="space-y-2">
                      <select
                        className="h-10 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                        {...form.register("account_id")}
                      >
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(a.balance)})
                          </option>
                        ))}
                      </select>
                      {selectedAccount && (
                        <div className="flex items-center gap-2 rounded-[6px] bg-[#fafafa] p-2 border border-[#f0f0f0]">
                          {(() => {
                            const Icon = ACCOUNT_ICONS[selectedAccount.accountType || "cash"] || Wallet;
                            return <Icon className="h-4 w-4 text-[#4a38f5]" />;
                          })()}
                          <span className="text-xs text-[#666666]">
                            Текущий баланс:{" "}
                            <span className="font-mono font-semibold text-[#111111]">
                              {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(selectedAccount.balance)}
                            </span>
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Date & Time Field */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#111111]">
                      Дата и время операции
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
                      <input
                        type="datetime-local"
                        className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-9 pr-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                        {...form.register("occurred_at")}
                      />
                    </div>
                  </div>
                </div>

                {/* RIGHT COLUMN: Category, Description, Counterparty */}
                <div className="space-y-4">
                  {/* Category Field */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[#111111]">
                        Статья ДДС (Категория) *
                      </label>
                      {onOpenCategories && (
                        <button
                          type="button"
                          onClick={onOpenCategories}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors cursor-pointer"
                        >
                          <FolderTree className="h-3 w-3" />
                          Управление статьями
                        </button>
                      )}
                    </div>
                    <select
                      className="h-10 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      value={form.watch("category_id") || ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        form.setValue("category_id", val);
                        const found = categoriesList.find((c) => c.id === val);
                        if (found) {
                          form.setValue("category_name", found.name);
                        }
                      }}
                    >
                      <option value="">{form.watch("category_name") || "Выберите категорию..."}</option>
                      {categoriesList.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Counterparty Combobox */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#111111]">
                      Контрагент / Клиент / Поставщик
                    </label>
                    <CounterpartyCombobox
                      value={form.watch("counterparty_name") || ""}
                      inn={form.watch("counterparty_inn") || ""}
                      onChange={(name, inn) => {
                        form.setValue("counterparty_name", name);
                        form.setValue("counterparty_inn", inn || "");
                      }}
                    />
                  </div>

                  {/* Привязка к сделке и заказ-наряду */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#111111]">
                      Привязка к сделке / наряду
                    </label>
                    <TransactionEntityPickers
                      dealId={form.watch("deal_id") || ""}
                      repairOrderId={form.watch("repair_order_id") || ""}
                      initialDealTitle={transaction.deal_title ?? null}
                      initialRepairTicketNumber={transaction.repair_ticket_number ?? null}
                      onDealChange={(nextDealId) => {
                        form.setValue("deal_id", nextDealId, { shouldDirty: true });
                      }}
                      onRepairOrderChange={(nextRepairId) => {
                        form.setValue("repair_order_id", nextRepairId, { shouldDirty: true });
                      }}
                    />
                  </div>

                  {/* Description / Comment */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-[#111111]">
                      Назначение платежа / Комментарий
                    </label>
                    <div className="relative">
                      <FileText className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#888888]" />
                      <textarea
                        rows={3}
                        placeholder="Оплата счёта, аренда, закупка расходных материалов..."
                        className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-2 pl-9 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                        {...form.register("description")}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer with Delete and Submit */}
            <div className="flex items-center justify-between border-t border-[#e5e5e5] bg-[#fafafa] px-6 py-3.5">
              <div>
                {onDelete && (
                  <button
                    type="button"
                    onClick={() => onDelete(transaction)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50 hover:border-rose-300 transition-colors cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                    <span>Удалить операцию</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || updateMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
                >
                  {(isSubmitting || updateMutation.isPending) && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  <span>Сохранить изменения</span>
                </button>
              </div>
            </div>
          </form>
        </SheetContent>
      </Sheet>

      <CreateAccountModal
        open={createAccountOpen}
        onClose={() => setCreateAccountOpen(false)}
        onCreated={(newAcc) => {
          form.setValue("account_id", newAcc.id, { shouldValidate: true });
        }}
      />
    </>
  );
}
