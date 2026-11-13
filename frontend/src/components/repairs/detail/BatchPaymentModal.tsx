"use client";

import { memo, useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import { CheckCircle2, Wallet, Tag, Loader2, Check } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { useDealActs } from "@/lib/api/use-repairs";
import { useAccounts, useBatchPayment } from "@/lib/api/use-invoices";
import { INCOME_CATEGORIES } from "@/lib/finance/finance.types";
import { TagPill } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

interface BatchPaymentModalProps {
  open: boolean;
  onClose: () => void;
  repairOrderId: string;
  onSuccess?: () => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export const BatchPaymentModal = memo(function BatchPaymentModal({
  open,
  onClose,
  repairOrderId,
  onSuccess,
}: BatchPaymentModalProps) {
  const { data: acts = [], isLoading: isLoadingActs } = useDealActs(open ? repairOrderId : null);
  const { data: accounts = [], isLoading: isLoadingAccounts } = useAccounts();
  const batchPayment = useBatchPayment();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [categoryName, setCategoryName] = useState<string>("repair");
  const [description, setDescription] = useState<string>("");

  const masterCheckboxRef = useRef<HTMLInputElement>(null);

  // Initialize selected acts and default account when dialog opens
  useEffect(() => {
    if (open && acts.length > 0) {
      const unpaidIds = acts.filter((a) => a.paymentStatus !== "paid").map((a) => a.id);
      setSelectedIds(unpaidIds.length > 0 ? unpaidIds : [repairOrderId]);
    }
  }, [open, acts, repairOrderId]);

  useEffect(() => {
    if (open && accounts.length > 0 && !selectedAccountId) {
      const defaultAcc = accounts.find((a) => a.isDefault) || accounts[0];
      if (defaultAcc) setSelectedAccountId(defaultAcc.id);
    }
  }, [open, accounts, selectedAccountId]);

  // Master checkbox state
  const isAllSelected = acts.length > 0 && selectedIds.length === acts.length;
  const isIndeterminate = selectedIds.length > 0 && selectedIds.length < acts.length;

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(acts.map((a) => a.id));
    }
  };

  const handleToggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const totalSum = useMemo(() => {
    return acts
      .filter((a) => selectedIds.includes(a.id))
      .reduce((sum, a) => sum + a.totalAmount, 0);
  }, [acts, selectedIds]);

  const handleSubmit = async () => {
    if (!selectedAccountId) {
      toast.error("Выберите кассу или счет зачисления");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("Выберите хотя бы один акт для оплаты");
      return;
    }

    try {
      await batchPayment.mutateAsync({
        repair_order_ids: selectedIds,
        cash_account_id: selectedAccountId,
        description: description.trim() || undefined,
        category_id: undefined,
      });

      toast.success(`Оплата на сумму ${formatCost(totalSum)} успешно принята`);
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Не удалось принять оплату";
      toast.error(message);
    }
  };

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} width="w-[620px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              Принять оплату по актам из сделки
            </h2>
            <p className="text-xs text-[#666666]">
              Выберите акты для внесения оплаты и целевую кассу
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col justify-between p-6">
        <div className="space-y-5">
          {/* Acts Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase text-[#666666] tracking-wider">
                Акты ремонта ({acts.length})
              </label>
              <span className="text-xs text-[#888888]">
                Выбрано: {selectedIds.length} из {acts.length}
              </span>
            </div>

            {isLoadingActs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
              </div>
            ) : acts.length === 0 ? (
              <div className="rounded-[8px] border border-[#e5e5e5] p-4 text-center text-xs text-[#888888]">
                Акты не найдены
              </div>
            ) : (
              <div className="rounded-[8px] border border-[#e5e5e5] overflow-hidden">
                <div className="bg-[#fafafa] border-b border-[#e5e5e5] px-3 py-2 flex items-center justify-between text-xs font-medium text-[#666666]">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      ref={masterCheckboxRef}
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    <span>Выбрать все</span>
                  </label>
                  <span>Сумма к оплате</span>
                </div>

                <div className="divide-y divide-[#f0f0f0] max-h-56 overflow-y-auto">
                  {acts.map((act) => {
                    const isChecked = selectedIds.includes(act.id);
                    const isPaid = act.paymentStatus === "paid";
                    return (
                      <div
                        key={act.id}
                        onClick={() => handleToggleRow(act.id)}
                        className={cn(
                          "px-3 py-2.5 flex items-center justify-between transition-colors cursor-pointer text-xs",
                          isChecked ? "bg-[#4a38f5]/5" : "hover:bg-[#fafafa]",
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleRow(act.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                          />
                          <div>
                            <div className="flex items-center gap-1.5 font-medium text-[#111111]">
                              <span>{act.ticketNumber}</span>
                              {act.isCurrent && (
                                <span className="rounded bg-[#f0f0f0] px-1.5 py-0.2 text-[10px] text-[#666666]">
                                  текущий
                                </span>
                              )}
                              <span className="text-[#888888] font-normal">
                                {act.equipmentType} {act.equipmentBrand} {act.equipmentModel}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {isPaid ? (
                                <TagPill color="emerald">Оплачен</TagPill>
                              ) : act.paymentStatus === "invoiced" ? (
                                <TagPill color="sky">Выставлен счет</TagPill>
                              ) : (
                                <TagPill color="amber">Не оплачен</TagPill>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="font-semibold text-sm font-mono text-[#111111]">
                            {formatCost(act.totalAmount)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Account and Category */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#666666]">
                <Wallet className="h-3.5 w-3.5" />
                Касса / Счёт зачисления *
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                disabled={isLoadingAccounts}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({formatCost(acc.balance)})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#666666]">
                <Tag className="h-3.5 w-3.5" />
                Статья доходов
              </label>
              <select
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              >
                {INCOME_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[#666666]">Примечание к платежу</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Например: Оплата наличными в офисе"
              className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          {/* Total Bar */}
          <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-4 py-3">
            <div>
              <span className="text-xs text-[#666666]">Итого к оплате по выбранным актам</span>
              <p className="text-xs text-[#888888] mt-0.5">
                Выбрано актов: {selectedIds.length}
              </p>
            </div>
            <span className="text-lg font-bold font-mono text-[#111111]">
              {formatCost(totalSum)}
            </span>
          </div>
        </div>

        {/* Footer actions */}
        <div className="pt-4 border-t border-[#e5e5e5] flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={batchPayment.isPending || selectedIds.length === 0}
            className={cn(
              "h-8 rounded-[8px] px-4 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5",
              "bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {batchPayment.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Проведение...
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                Принять оплату ({formatCost(totalSum)})
              </>
            )}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
});
