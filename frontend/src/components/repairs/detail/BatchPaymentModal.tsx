"use client";

import { memo, useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import { CheckCircle2, Wallet, Tag, Loader2, Check, Wrench, Package, Split } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { useDealActs } from "@/lib/api/use-repairs";
import {
  useAccounts,
  useBatchPayment,
  useFinanceCategories,
  type FinanceCategoryDTO,
} from "@/lib/api/use-invoices";
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

function pickDefaultCategory(
  categories: FinanceCategoryDTO[],
  patterns: string[],
): string {
  for (const p of patterns) {
    const found = categories.find((c) => c.name.toLowerCase().includes(p));
    if (found) return found.id;
  }
  return categories[0]?.id ?? "";
}

export const BatchPaymentModal = memo(function BatchPaymentModal({
  open,
  onClose,
  repairOrderId,
  onSuccess,
}: BatchPaymentModalProps) {
  const { data: acts = [], isLoading: isLoadingActs } = useDealActs(open ? repairOrderId : null);
  const { data: accounts = [], isLoading: isLoadingAccounts } = useAccounts();
  const { data: incomeCategories = [], isLoading: isLoadingCategories } = useFinanceCategories("income");
  const batchPayment = useBatchPayment();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [splitWorksAndParts, setSplitWorksAndParts] = useState<boolean>(true);
  const [singleCategoryId, setSingleCategoryId] = useState<string>("");
  const [worksCategoryId, setWorksCategoryId] = useState<string>("");
  const [partsCategoryId, setPartsCategoryId] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  const masterCheckboxRef = useRef<HTMLInputElement>(null);

  const selectableActs = useMemo(
    () => acts.filter((a) => a.totalAmount > 0),
    [acts],
  );

  // Инициализация выбранных актов (только с ценой > 0)
  useEffect(() => {
    if (open && acts.length > 0) {
      const pricedActs = acts.filter((a) => a.totalAmount > 0);
      const unpaidPricedIds = pricedActs
        .filter((a) => a.paymentStatus !== "paid")
        .map((a) => a.id);
      const currentIsPriced = pricedActs.some((a) => a.id === repairOrderId);
      setSelectedIds(
        unpaidPricedIds.length > 0
          ? unpaidPricedIds
          : currentIsPriced
            ? [repairOrderId]
            : pricedActs.map((a) => a.id),
      );
    } else if (open) {
      setSelectedIds([]);
    }
  }, [open, acts, repairOrderId]);

  // Автовыбор счёта/кассы по умолчанию
  useEffect(() => {
    if (open && accounts.length > 0 && !selectedAccountId) {
      const defaultAcc = accounts.find((a) => a.isDefault) || accounts[0];
      if (defaultAcc) setSelectedAccountId(defaultAcc.id);
    }
  }, [open, accounts, selectedAccountId]);

  // Автоподбор реальных статей доходов из /finance
  useEffect(() => {
    if (!open || incomeCategories.length === 0) return;

    if (!worksCategoryId || !incomeCategories.some((c) => c.id === worksCategoryId)) {
      setWorksCategoryId(
        pickDefaultCategory(incomeCategories, ["выполненн", "работ", "услуг", "ремонт"]),
      );
    }
    if (!partsCategoryId || !incomeCategories.some((c) => c.id === partsCategoryId)) {
      setPartsCategoryId(
        pickDefaultCategory(incomeCategories, ["запчаст", "товар", "оборудован"]),
      );
    }
    if (!singleCategoryId || !incomeCategories.some((c) => c.id === singleCategoryId)) {
      setSingleCategoryId(
        pickDefaultCategory(incomeCategories, ["выполненн", "работ", "услуг"]),
      );
    }
  }, [open, incomeCategories, worksCategoryId, partsCategoryId, singleCategoryId]);

  const isAllSelected =
    selectableActs.length > 0 && selectedIds.length === selectableActs.length;
  const isIndeterminate =
    selectedIds.length > 0 && selectedIds.length < selectableActs.length;

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableActs.map((a) => a.id));
    }
  };

  const handleToggleRow = (id: string, isSelectable: boolean) => {
    if (!isSelectable) return;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const { worksSum, partsSum, totalSum } = useMemo(() => {
    const selected = acts.filter((a) => selectedIds.includes(a.id));
    const works = selected.reduce((sum, a) => sum + (a.worksTotal || 0), 0);
    const parts = selected.reduce((sum, a) => sum + (a.partsTotal || 0), 0);
    const total = selected.reduce((sum, a) => sum + a.totalAmount, 0);
    return { worksSum: works, partsSum: parts, totalSum: total };
  }, [acts, selectedIds]);

  const hasBothWorksAndParts = worksSum > 0 && partsSum > 0;

  const handleSubmit = async () => {
    if (!selectedAccountId) {
      toast.error("Выберите кассу или счёт зачисления");
      return;
    }
    if (selectedIds.length === 0) {
      toast.error("Выберите хотя бы один акт для оплаты");
      return;
    }

    const useSplit = splitWorksAndParts && hasBothWorksAndParts;

    try {
      await batchPayment.mutateAsync({
        repair_order_ids: selectedIds,
        cash_account_id: selectedAccountId,
        category_id: useSplit
          ? worksCategoryId || singleCategoryId || undefined
          : singleCategoryId || undefined,
        works_category_id: useSplit
          ? worksCategoryId || undefined
          : worksSum > 0 && partsSum === 0
            ? singleCategoryId || undefined
            : undefined,
        parts_category_id: useSplit
          ? partsCategoryId || undefined
          : partsSum > 0 && worksSum === 0
            ? singleCategoryId || undefined
            : undefined,
        split_works_and_parts: useSplit,
        description: description.trim() || undefined,
      });

      toast.success(
        useSplit
          ? `Оплата ${formatCost(totalSum)} принята (работы и запчасти разнесены по статьям)`
          : `Оплата на сумму ${formatCost(totalSum)} успешно принята`,
      );
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Не удалось принять оплату";
      toast.error(message);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} width="w-[620px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Принять оплату по актам из сделки</h2>
            <p className="text-xs text-[#666666]">
              Выберите акты, кассу и статьи доходов из справочника «Финансы»
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="p-6 flex flex-col justify-between min-h-[calc(100%-60px)]">
        <div className="space-y-5">
          {/* Acts list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#666666]">
                Акты ремонта ({acts.length})
              </span>
              <span className="text-xs text-[#888888]">
                Выбрано: {selectedIds.length} из {selectableActs.length} доступных
              </span>
            </div>

            {isLoadingActs ? (
              <div className="flex items-center justify-center py-8 border border-[#e5e5e5] rounded-[8px] bg-[#fafafa]">
                <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
              </div>
            ) : (
              <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden">
                {/* Master checkbox header */}
                <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-xs font-medium text-[#666666]">
                  <label className={cn("flex items-center gap-2.5 select-none", selectableActs.length > 0 ? "cursor-pointer" : "opacity-50 cursor-not-allowed")}>
                    <input
                      ref={masterCheckboxRef}
                      type="checkbox"
                      checked={isAllSelected}
                      disabled={selectableActs.length === 0}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5] disabled:opacity-40"
                    />
                    <span>Выбрать все с ценой ({selectableActs.length})</span>
                  </label>
                  <span>Сумма к оплате</span>
                </div>

                {/* Rows */}
                <div className="divide-y divide-[#f0f0f0] max-h-[220px] overflow-y-auto">
                  {acts.map((act) => {
                    const hasPrice = act.totalAmount > 0;
                    const checked = hasPrice && selectedIds.includes(act.id);
                    const isPaid = act.paymentStatus === "paid";

                    return (
                      <label
                        key={act.id}
                        title={hasPrice ? undefined : "Акт без указанной стоимости (0 ₽) нельзя оплатить"}
                        className={cn(
                          "flex items-center justify-between px-3 py-2.5 transition-colors",
                          hasPrice ? "cursor-pointer hover:bg-[#f8f9fa]" : "opacity-55 bg-[#fafafa] cursor-not-allowed",
                          checked && "bg-[#4a38f5]/[0.03]",
                        )}
                      >
                        <div className="flex items-start gap-2.5 min-w-0 pr-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!hasPrice}
                            onChange={() => handleToggleRow(act.id, hasPrice)}
                            className="mt-0.5 h-4 w-4 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5] disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-[#111111] font-mono">
                                {act.ticketNumber}
                              </span>
                              {act.isCurrent && (
                                <span className="rounded bg-[#f0f0f0] px-1.5 py-0.5 text-[10px] font-medium text-[#666666]">
                                  текущий
                                </span>
                              )}
                              <span className="text-xs text-[#666666] truncate">
                                {[act.equipmentType, act.equipmentBrand, act.equipmentModel]
                                  .filter(Boolean)
                                  .join(" ")}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                              {!hasPrice ? (
                                <span className="inline-flex items-center rounded-full border border-[#e5e5e5] bg-white px-2 py-0.5 text-[10px] font-medium text-[#888888]">
                                  Без цены — недоступно
                                </span>
                              ) : isPaid ? (
                                <TagPill color="emerald">Оплачен</TagPill>
                              ) : act.paymentStatus === "invoiced" ? (
                                <TagPill color="sky">Выставлен счёт</TagPill>
                              ) : (
                                <TagPill color="amber">Не оплачен</TagPill>
                              )}
                              {act.worksTotal > 0 && (
                                <span className="text-[11px] text-[#888888]">
                                  Работы: {formatCost(act.worksTotal)}
                                </span>
                              )}
                              {act.partsTotal > 0 && (
                                <span className="text-[11px] text-[#888888]">
                                  Запчасти: {formatCost(act.partsTotal)}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <span className={cn("text-xs font-semibold font-mono shrink-0", hasPrice ? "text-[#111111]" : "text-[#888888]")}>
                          {formatCost(act.totalAmount)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Account */}
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

          {/* Income categories synced with /finance + works/parts split */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-[#111111]">
                <Tag className="h-3.5 w-3.5 text-[#4a38f5]" />
                Статьи доходов (справочник «Финансы»)
              </span>

              {hasBothWorksAndParts && (
                <label className="flex items-center gap-1.5 text-xs text-[#666666] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={splitWorksAndParts}
                    onChange={(e) => setSplitWorksAndParts(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
                  />
                  <Split className="h-3 w-3 text-[#4a38f5]" />
                  <span>Разбить работы и запчасти</span>
                </label>
              )}
            </div>

            {isLoadingCategories ? (
              <div className="flex items-center gap-2 text-xs text-[#888888] py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Загрузка статей из раздела «Финансы»...
              </div>
            ) : incomeCategories.length === 0 ? (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-[6px] px-2.5 py-2">
                В разделе «Финансы → Статьи» пока нет статей доходов. Создайте статьи в модуле «Финансы».
              </p>
            ) : splitWorksAndParts && hasBothWorksAndParts ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="flex items-center justify-between text-xs font-medium text-[#666666]">
                    <span className="inline-flex items-center gap-1">
                      <Wrench className="h-3 w-3 text-[#4a38f5]" />
                      Работы
                    </span>
                    <span className="font-mono font-semibold text-[#111111]">
                      {formatCost(worksSum)}
                    </span>
                  </label>
                  <select
                    value={worksCategoryId}
                    onChange={(e) => setWorksCategoryId(e.target.value)}
                    className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  >
                    {incomeCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="flex items-center justify-between text-xs font-medium text-[#666666]">
                    <span className="inline-flex items-center gap-1">
                      <Package className="h-3 w-3 text-emerald-600" />
                      Запчасти
                    </span>
                    <span className="font-mono font-semibold text-[#111111]">
                      {formatCost(partsSum)}
                    </span>
                  </label>
                  <select
                    value={partsCategoryId}
                    onChange={(e) => setPartsCategoryId(e.target.value)}
                    className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  >
                    {incomeCategories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Статья доходов</label>
                <select
                  value={singleCategoryId}
                  onChange={(e) => setSingleCategoryId(e.target.value)}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                >
                  {incomeCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-4 py-3 space-y-1.5">
            {hasBothWorksAndParts && (
              <div className="flex items-center justify-between text-xs text-[#666666]">
                <span>
                  Работы: <strong className="font-mono text-[#111111]">{formatCost(worksSum)}</strong>
                  {" • "}
                  Запчасти: <strong className="font-mono text-[#111111]">{formatCost(partsSum)}</strong>
                </span>
                {splitWorksAndParts && (
                  <span className="text-[11px] text-[#4a38f5] font-medium">2 операции в ДДС</span>
                )}
              </div>
            )}
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs text-[#666666]">Итого к оплате по выбранным актам</span>
                <p className="text-xs text-[#888888] mt-0.5">Выбрано актов: {selectedIds.length}</p>
              </div>
              <span className="text-lg font-bold font-mono text-[#111111]">
                {formatCost(totalSum)}
              </span>
            </div>
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
