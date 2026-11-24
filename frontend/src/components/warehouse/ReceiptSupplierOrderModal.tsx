"use client";

import { useEffect, useMemo, useState } from "react";
import {
  X,
  Loader2,
  ArrowDownToLine,
  CheckCircle2,
  Wallet,
  Building2,
  Plus,
  Trash2,
  Truck,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCreateReceiptFromSupplierOrder,
  type LandedCostAllocationMethod,
  type SupplierOrderDTO,
} from "@/lib/api/use-warehouse";
import { useAccounts, useFinanceCategories } from "@/lib/api/use-invoices";
import { previewLandedCostAllocation } from "@/lib/warehouse/landed-cost";
import { formatRub } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface ReceiptSupplierOrderModalProps {
  open: boolean;
  onClose: () => void;
  order: SupplierOrderDTO | null;
  onSuccess: () => void;
}

interface ExtraCostRowState {
  uid: string;
  description: string;
  amount: string;
  categoryId: string;
  cashAccountId: string;
}

const ALLOCATION_OPTIONS: { value: LandedCostAllocationMethod; label: string; hint: string }[] = [
  { value: "by_value", label: "По сумме", hint: "Пропорционально стоимости позиций" },
  { value: "by_quantity", label: "По количеству", hint: "Пропорционально числу единиц" },
  { value: "manual", label: "Вручную", hint: "Точная сумма на каждую строку" },
];

function parsePositiveNumber(raw: string): number {
  const normalized = raw.replace(",", ".").trim();
  if (!normalized) return 0;
  const val = Number(normalized);
  return Number.isFinite(val) && val > 0 ? val : 0;
}

export function ReceiptSupplierOrderModal({
  open,
  onClose,
  order,
  onSuccess,
}: ReceiptSupplierOrderModalProps) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [manualAllocations, setManualAllocations] = useState<Record<string, string>>({});
  const [allocationMethod, setAllocationMethod] = useState<LandedCostAllocationMethod>("by_value");
  const [extraCosts, setExtraCosts] = useState<ExtraCostRowState[]>([]);
  const [markPaid, setMarkPaid] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [paymentComment, setPaymentComment] = useState("");

  const { data: accounts = [] } = useAccounts();
  const { data: expenseCategories = [] } = useFinanceCategories("expense");
  const createReceiptMutation = useCreateReceiptFromSupplierOrder();

  const defaultLogisticsCategoryId = useMemo(() => {
    const logistics = expenseCategories.find((c) => {
      const lower = c.name.toLowerCase();
      return lower.includes("достав") || lower.includes("логист") || lower.includes("курьер");
    });
    return logistics?.id ?? expenseCategories[0]?.id ?? "";
  }, [expenseCategories]);

  const defaultCashAccountId = useMemo(() => {
    return order?.cashAccountId ?? accounts[0]?.id ?? "";
  }, [accounts, order?.cashAccountId]);

  useEffect(() => {
    if (!open || !order) return;
    const initQty: Record<string, string> = {};
    for (const item of order.items ?? []) {
      const alreadyReceived = Number(item.receivedQuantity ?? 0);
      const remaining = Math.max(0, Number(item.remainingQuantity ?? item.quantity - alreadyReceived));
      initQty[item.id] = remaining > 0 ? String(remaining) : "0";
    }
    setQuantities(initQty);
    setManualAllocations({});
    setAllocationMethod("by_value");
    setExtraCosts([]);
    setMarkPaid(false);
    setSelectedAccountId(order.cashAccountId ?? "");
    setPaymentComment("");
  }, [open, order]);

  const orderItems = useMemo(() => order?.items ?? [], [order]);

  const itemMeta = useMemo(() => {
    return orderItems.map((it) => {
      const ordered = Number(it.quantity ?? 0);
      const alreadyReceived = Number(it.receivedQuantity ?? 0);
      const remaining = Math.max(0, Number(it.remainingQuantity ?? ordered - alreadyReceived));
      const rawInput = quantities[it.id] ?? "0";
      const parsed = parsePositiveNumber(rawInput);
      const clampedQty = Math.min(remaining, parsed);
      const isOverLimit = parsed > remaining + 0.0001;
      return {
        item: it,
        ordered,
        alreadyReceived,
        remaining,
        inputQty: parsed,
        effectiveQty: clampedQty,
        isOverLimit,
      };
    });
  }, [orderItems, quantities]);

  const totalExtraCost = useMemo(() => {
    return extraCosts.reduce((sum, row) => sum + parsePositiveNumber(row.amount), 0);
  }, [extraCosts]);

  const preview = useMemo(() => {
    const lines = itemMeta.map((m) => ({
      id: m.item.id,
      quantity: m.effectiveQty,
      baseUnitPrice: Number(m.item.price ?? 0),
      manualExtraCost: parsePositiveNumber(manualAllocations[m.item.id] ?? "0"),
    }));
    return previewLandedCostAllocation(lines, totalExtraCost, allocationMethod);
  }, [itemMeta, manualAllocations, totalExtraCost, allocationMethod]);

  const summary = useMemo(() => {
    let receivingQty = 0;
    let remainingTotal = 0;
    let goodsSum = 0;
    for (const m of itemMeta) {
      remainingTotal += m.remaining;
      receivingQty += m.effectiveQty;
      goodsSum += m.effectiveQty * Number(m.item.price ?? 0);
    }
    const isPartialAfterReceipt = receivingQty > 0 && receivingQty + 0.0001 < remainingTotal;
    return {
      receivingQty,
      remainingTotal,
      goodsSum: Math.round(goodsSum * 100) / 100,
      effectiveTotal: Math.round((goodsSum + totalExtraCost) * 100) / 100,
      isPartialAfterReceipt,
    };
  }, [itemMeta, totalExtraCost]);

  if (!open || !order) return null;

  const isAlreadyPaid = Boolean(order.paidAt) || order.status === "paid";
  const hasOverLimit = itemMeta.some((m) => m.isOverLimit);
  const hasInvalidExtraCost = extraCosts.some(
    (row) => parsePositiveNumber(row.amount) > 0 && row.description.trim().length === 0,
  );
  const manualMismatch =
    allocationMethod === "manual" &&
    totalExtraCost > 0 &&
    Math.abs(preview.manualUnallocated) > 0.01;

  const canSubmit =
    !createReceiptMutation.isPending &&
    summary.receivingQty > 0 &&
    !hasOverLimit &&
    !hasInvalidExtraCost &&
    !manualMismatch;

  const handleReceiveAll = () => {
    const next: Record<string, string> = {};
    for (const m of itemMeta) {
      next[m.item.id] = m.remaining > 0 ? String(m.remaining) : "0";
    }
    setQuantities(next);
  };

  const handleClearQuantities = () => {
    const next: Record<string, string> = {};
    for (const m of itemMeta) {
      next[m.item.id] = "0";
    }
    setQuantities(next);
  };

  const handleAddExtraCost = () => {
    setExtraCosts((prev) => [
      ...prev,
      {
        uid: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        description: prev.length === 0 ? "Доставка / курьер" : "",
        amount: "",
        categoryId: defaultLogisticsCategoryId,
        cashAccountId: defaultCashAccountId,
      },
    ]);
  };

  const handleUpdateExtraCost = (uid: string, patch: Partial<ExtraCostRowState>) => {
    setExtraCosts((prev) => prev.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
  };

  const handleRemoveExtraCost = (uid: string) => {
    setExtraCosts((prev) => prev.filter((row) => row.uid !== uid));
  };

  const handleConfirmReceipt = async () => {
    if (!canSubmit) return;

    const payloadItems = itemMeta
      .filter((m) => m.effectiveQty > 0)
      .map((m) => ({
        supplier_order_item_id: m.item.id,
        quantity: m.effectiveQty,
        ...(allocationMethod === "manual" && totalExtraCost > 0
          ? { manual_extra_cost: parsePositiveNumber(manualAllocations[m.item.id] ?? "0") }
          : {}),
      }));

    const payloadExtraCosts = extraCosts
      .filter((row) => parsePositiveNumber(row.amount) > 0)
      .map((row) => {
        const selectedCat = expenseCategories.find((c) => c.id === row.categoryId);
        return {
          description: row.description.trim() || "Доставка / доп. расход",
          amount: parsePositiveNumber(row.amount),
          category_id: row.categoryId || null,
          category_name: selectedCat?.name || "Доставка и логистика",
          cash_account_id: row.cashAccountId || null,
        };
      });

    try {
      const res = await createReceiptMutation.mutateAsync({
        id: order.id,
        payload: {
          mark_paid: markPaid && !isAlreadyPaid,
          cash_account_id: markPaid && !isAlreadyPaid ? selectedAccountId || undefined : undefined,
          comment: paymentComment.trim() || undefined,
          items: payloadItems,
          allocation_method: allocationMethod,
          ...(payloadExtraCosts.length > 0 ? { extra_costs: payloadExtraCosts } : {}),
        },
      });

      const isFullyReceived = res.order?.status === "received";
      const extraSuffix =
        totalExtraCost > 0
          ? ` Доп. расходы ${formatRub(totalExtraCost)} распределены на себестоимость партий и проведены в Финансах.`
          : "";
      toast.success(
        isFullyReceived
          ? `Заказ №${order.orderNumber} полностью оприходован: создано ${res.batchesCreated} партий.${extraSuffix}`
          : `Частичная приёмка по заказу №${order.orderNumber}: создано ${res.batchesCreated} партий.${extraSuffix}`,
      );
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось оприходовать заказ");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-in fade-in-0 duration-150">
      <div className="w-full max-w-3xl rounded-2xl border border-[#e5e5e5] bg-white shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4a38f5]/10 text-[#4a38f5] border border-[#4a38f5]/20">
              <ArrowDownToLine className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#111111]">
                {order.status === "partially_received"
                  ? "Доприходование на склад"
                  : "Оприходование на склад"}
              </h2>
              <p className="text-xs text-[#666666]">
                Приёмка товаров по заказу <span className="font-mono">{order.orderNumber}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно оприходования"
            className="rounded-lg p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Поставщик и сумма заказа */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#666666]" />
              <div>
                <span className="text-[#888888]">Поставщик:</span>{" "}
                <span className="font-semibold text-[#111111]">{order.supplierName}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {typeof order.receivedQuantityTotal === "number" &&
                typeof order.orderedQuantityTotal === "number" &&
                order.receivedQuantityTotal > 0 && (
                  <span className="rounded-[4px] border border-[#4a38f5]/25 bg-[#4a38f5]/8 px-2 py-0.5 text-[11px] font-medium text-[#4a38f5]">
                    Ранее принято: {order.receivedQuantityTotal} из {order.orderedQuantityTotal}
                  </span>
                )}
              <div className="font-mono tabular-nums font-bold text-sm text-[#111111]">
                {formatRub(order.totalAmount)}
              </div>
            </div>
          </div>

          {/* Список позиций с частичным количеством */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2">
              <span className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                Позиции к приёмке ({orderItems.length} поз.)
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleReceiveAll}
                  className="text-[11px] font-medium text-[#4a38f5] hover:text-[#3d2ee0] cursor-pointer"
                >
                  Принять весь остаток
                </button>
                <span className="text-[#e5e5e5]">|</span>
                <button
                  type="button"
                  onClick={handleClearQuantities}
                  className="text-[11px] font-medium text-[#666666] hover:text-[#111111] cursor-pointer"
                >
                  Очистить
                </button>
              </div>
            </div>

            <div className="divide-y divide-[#f0f0f0] max-h-64 overflow-y-auto">
              {itemMeta.map((m) => {
                const alloc = preview.allocations.get(m.item.id);
                const fullyReceived = m.remaining <= 0;
                const hasExtra = (alloc?.allocatedExtraCost ?? 0) > 0;

                return (
                  <div
                    key={m.item.id}
                    className={cn(
                      "px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors",
                      fullyReceived ? "bg-[#fbfbfb] opacity-70" : "hover:bg-[#fafafa]",
                    )}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-[13px] text-[#111111] truncate">
                          {m.item.itemName}
                        </span>
                        {fullyReceived && (
                          <span className="inline-flex items-center gap-1 rounded-[4px] border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" />
                            Принято полностью
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap text-[11px] text-[#666666]">
                        {m.item.sku && <span className="font-mono">{m.item.sku}</span>}
                        <span className="font-mono tabular-nums">
                          Заказано: {m.ordered} {m.item.unit}
                        </span>
                        {m.alreadyReceived > 0 && (
                          <span className="font-mono tabular-nums text-[#4a38f5]">
                            Принято: {m.alreadyReceived} {m.item.unit}
                          </span>
                        )}
                        {!fullyReceived && (
                          <span className="font-mono tabular-nums text-[#111111] font-medium">
                            Остаток: {m.remaining} {m.item.unit}
                          </span>
                        )}
                        {m.item.repairOrders && (
                          <span className="text-sky-700">Наряды: {m.item.repairOrders}</span>
                        )}
                      </div>

                      {/* Live-предпросмотр себестоимости с учётом landed cost */}
                      {!fullyReceived && m.effectiveQty > 0 && (
                        <div className="flex items-center gap-2 flex-wrap text-[11px] font-mono tabular-nums pt-0.5">
                          <span className="text-[#666666]">
                            База: {formatRub(m.item.price)}/{m.item.unit}
                          </span>
                          {hasExtra && alloc && (
                            <>
                              <span className="text-[#4a38f5] font-medium">
                                +{formatRub(alloc.unitLandedCost)}/{m.item.unit} доп.
                              </span>
                              <span className="text-[#111111] font-semibold">
                                → Себестоимость: {formatRub(alloc.effectiveUnitPrice)}/{m.item.unit}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Ручное распределение доп. расхода по строке */}
                      {!fullyReceived &&
                        allocationMethod === "manual" &&
                        totalExtraCost > 0 &&
                        m.effectiveQty > 0 && (
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] text-[#666666] mb-0.5">Доп. расход, ₽</span>
                            <input
                              type="number"
                              min={0}
                              step="0.01"
                              value={manualAllocations[m.item.id] ?? ""}
                              onChange={(e) =>
                                setManualAllocations((prev) => ({
                                  ...prev,
                                  [m.item.id]: e.target.value,
                                }))
                              }
                              placeholder="0"
                              aria-label={`Доп. расход для ${m.item.itemName}`}
                              className="w-24 h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-right font-mono tabular-nums text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                            />
                          </div>
                        )}

                      {/* Количество к приёмке */}
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-[#666666] mb-0.5">
                          Принять ({m.item.unit})
                        </span>
                        <input
                          type="number"
                          min={0}
                          max={m.remaining}
                          step="1"
                          disabled={fullyReceived}
                          value={quantities[m.item.id] ?? "0"}
                          onChange={(e) =>
                            setQuantities((prev) => ({
                              ...prev,
                              [m.item.id]: e.target.value,
                            }))
                          }
                          aria-label={`Количество к приёмке для ${m.item.itemName}`}
                          className={cn(
                            "w-20 h-8 rounded-[6px] border px-2 text-center font-mono tabular-nums text-xs focus:outline-none",
                            fullyReceived
                              ? "border-[#e5e5e5] bg-[#fafafa] text-[#888888] cursor-not-allowed"
                              : m.isOverLimit
                                ? "border-rose-400 bg-rose-50 text-rose-700"
                                : "border-[#e5e5e5] bg-white text-[#111111] focus:border-[#4a38f5]",
                          )}
                        />
                        {m.isOverLimit && (
                          <span className="text-[10px] text-rose-600 mt-0.5">
                            Макс. {m.remaining}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Дополнительные расходы (Landed Cost) */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Truck className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span className="text-[11px] font-semibold text-[#111111] uppercase tracking-wider">
                  Дополнительные расходы (доставка, курьер и др.)
                </span>
              </div>
              <button
                type="button"
                onClick={handleAddExtraCost}
                className="inline-flex items-center gap-1 rounded-[6px] border border-[#4a38f5]/30 bg-white px-2.5 py-1 text-[11px] font-medium text-[#4a38f5] hover:bg-[#4a38f5]/5 transition-colors cursor-pointer"
              >
                <Plus className="h-3 w-3" />
                Добавить расход
              </button>
            </div>

            {extraCosts.length === 0 ? (
              <div className="px-4 py-3 text-xs text-[#666666]">
                Нет дополнительных расходов. Нажмите «Добавить расход», чтобы включить доставку или
                курьера в себестоимость принимаемых партий.
              </div>
            ) : (
              <div className="p-4 space-y-3">
                <div className="space-y-2.5">
                  {extraCosts.map((row) => (
                    <div
                      key={row.uid}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-start rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-2.5"
                    >
                      <div className="sm:col-span-4">
                        <label className="block text-[10px] font-medium text-[#666666] mb-0.5">
                          Описание расхода
                        </label>
                        <input
                          type="text"
                          value={row.description}
                          onChange={(e) =>
                            handleUpdateExtraCost(row.uid, { description: e.target.value })
                          }
                          placeholder="Например: Курьер СДЭК"
                          className="w-full h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-medium text-[#666666] mb-0.5">
                          Сумма, ₽
                        </label>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={row.amount}
                          onChange={(e) =>
                            handleUpdateExtraCost(row.uid, { amount: e.target.value })
                          }
                          placeholder="0"
                          aria-label="Сумма дополнительного расхода"
                          className="w-full h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-right font-mono tabular-nums text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block text-[10px] font-medium text-[#666666] mb-0.5">
                          Статья расхода
                        </label>
                        <select
                          value={row.categoryId}
                          onChange={(e) =>
                            handleUpdateExtraCost(row.uid, { categoryId: e.target.value })
                          }
                          aria-label="Статья расхода"
                          className="w-full h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                        >
                          <option value="">Доставка и логистика (авто)</option>
                          {expenseCategories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-medium text-[#666666] mb-0.5">
                          Счёт оплаты
                        </label>
                        <select
                          value={row.cashAccountId}
                          onChange={(e) =>
                            handleUpdateExtraCost(row.uid, { cashAccountId: e.target.value })
                          }
                          aria-label="Счёт оплаты доп. расхода"
                          className="w-full h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                        >
                          <option value="">Основной</option>
                          {accounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="sm:col-span-1 flex justify-end sm:pt-4">
                        <button
                          type="button"
                          onClick={() => handleRemoveExtraCost(row.uid)}
                          aria-label="Удалить расход"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Способ распределения на себестоимость */}
                {totalExtraCost > 0 && (
                  <div className="space-y-2 pt-2 border-t border-[#f0f0f0]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#111111]">
                        Распределение на себестоимость партий:
                      </span>
                      <div className="inline-flex rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-0.5">
                        {ALLOCATION_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setAllocationMethod(opt.value)}
                            title={opt.hint}
                            className={cn(
                              "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                              allocationMethod === opt.value
                                ? "bg-[#4a38f5] text-white shadow-2xs"
                                : "text-[#666666] hover:text-[#111111]",
                            )}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {allocationMethod === "manual" && (
                      <div
                        className={cn(
                          "rounded-[6px] border px-3 py-1.5 text-xs flex items-center justify-between font-mono tabular-nums",
                          manualMismatch
                            ? "border-rose-200 bg-rose-50 text-rose-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700",
                        )}
                      >
                        <span>
                          {manualMismatch
                            ? "Сумма ручного распределения не совпадает с доп. расходами"
                            : "Сумма доп. расходов распределена полностью"}
                        </span>
                        <span className="font-semibold">
                          Остаток: {formatRub(preview.manualUnallocated)}
                        </span>
                      </div>
                    )}

                    <div className="flex items-start gap-2 rounded-[6px] border border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2 text-[11px] text-[#666666]">
                      <Info className="h-3.5 w-3.5 text-[#4a38f5] shrink-0 mt-0.5" />
                      <span>
                        По каждому доп. расходу создастся отдельная операция в «Финансах» со
                        списанием со счёта, а его сумма распределится на цену складских партий (в
                        P&amp;L попадёт один раз через себестоимость списания FIFO).
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Опция оплаты заказа поставщику (если заказ ещё не оплачен) */}
          {!isAlreadyPaid ? (
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-4 space-y-3">
              <label className="flex items-start gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={markPaid}
                  onChange={(e) => setMarkPaid(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                />
                <div className="text-xs">
                  <div className="font-semibold text-[#111111] flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5 text-[#4a38f5]" />
                    Провести оплату заказа поставщику ({formatRub(order.totalAmount)})
                  </div>
                  <p className="text-[#666666] mt-0.5">
                    Сформируется расходный ордер по статье «Закупка запчастей» со списанием с
                    выбранного счёта.
                  </p>
                </div>
              </label>

              {markPaid && (
                <div className="pl-6 space-y-2.5 pt-1">
                  <div>
                    <label className="block text-[11px] font-medium text-[#666666] mb-1">
                      Счёт / Касса списания
                    </label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      className="w-full h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    >
                      <option value="">Основной счёт (по умолчанию)</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({formatRub(acc.balance)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[8px] border border-emerald-200 bg-emerald-50/70 p-3 flex items-center gap-2 text-xs text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>
                Заказ уже оплачен. При приёмке будут созданы складские партии (и отдельные расходы
                по доп. затратам, если они указаны).
              </span>
            </div>
          )}

          {/* Комментарий к приёмке */}
          <div>
            <label className="block text-[11px] font-medium text-[#666666] mb-1">
              Комментарий к приёмке (необязательно)
            </label>
            <input
              type="text"
              value={paymentComment}
              onChange={(e) => setPaymentComment(e.target.value)}
              placeholder="Номер накладной, поставка часть 1/2, примечание..."
              className="w-full h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e5e5e5] px-6 py-3.5 bg-white shrink-0">
          <div className="text-xs text-[#666666] space-y-0.5">
            <div>
              К приёмке:{" "}
              <span className="font-mono tabular-nums font-semibold text-[#111111]">
                {summary.receivingQty} шт
              </span>{" "}
              на{" "}
              <span className="font-mono tabular-nums font-semibold text-[#111111]">
                {formatRub(summary.goodsSum)}
              </span>
              {totalExtraCost > 0 && (
                <>
                  {" "}
                  + доп.{" "}
                  <span className="font-mono tabular-nums font-semibold text-[#4a38f5]">
                    {formatRub(totalExtraCost)}
                  </span>
                </>
              )}
            </div>
            {totalExtraCost > 0 && (
              <div className="text-[11px] text-[#666666]">
                Итоговая себестоимость партий:{" "}
                <span className="font-mono tabular-nums font-bold text-[#111111]">
                  {formatRub(summary.effectiveTotal)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleConfirmReceipt}
              disabled={!canSubmit}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {createReceiptMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ArrowDownToLine className="h-3.5 w-3.5" />
              )}
              {summary.isPartialAfterReceipt
                ? "Оприходовать частично"
                : "Подтвердить оприходование"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
