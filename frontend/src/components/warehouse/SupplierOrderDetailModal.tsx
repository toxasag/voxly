"use client";

import {
  X,
  Truck,
  CreditCard,
  ArrowDownToLine,
  Trash2,
  Edit2,
  CheckCircle2,
  Clock,
  Building2,
  User,
  Receipt,
} from "lucide-react";
import { type SupplierOrderDTO } from "@/lib/api/use-warehouse";
import { formatRub } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

interface SupplierOrderDetailModalProps {
  open: boolean;
  onClose: () => void;
  order: SupplierOrderDTO | null;
  onEdit: (order: SupplierOrderDTO) => void;
  onPay: (order: SupplierOrderDTO) => void;
  onReceipt: (order: SupplierOrderDTO) => void;
  onDelete: (order: SupplierOrderDTO) => void;
}

const ALLOCATION_LABELS: Record<string, string> = {
  by_value: "по сумме",
  by_quantity: "по количеству",
  manual: "вручную",
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

export function SupplierOrderDetailModal({
  open,
  onClose,
  order,
  onEdit,
  onPay,
  onReceipt,
  onDelete,
}: SupplierOrderDetailModalProps) {
  if (!open || !order) return null;

  const isReceived = order.status === "received";
  const isPartiallyReceived = order.status === "partially_received";
  const isPaid = Boolean(order.paidAt) || order.status === "paid";
  const orderedQtyTotal =
    order.orderedQuantityTotal ??
    (order.items ?? []).reduce((s, it) => s + Number(it.quantity ?? 0), 0);
  const receivedQtyTotal =
    order.receivedQuantityTotal ??
    (order.items ?? []).reduce((s, it) => s + Number(it.receivedQuantity ?? 0), 0);
  const extraCostsTotal = Number(order.extraCostsTotal ?? 0);
  const receipts = order.receipts ?? [];

  const statusMap: Record<string, { label: string; color: string }> = {
    draft: { label: "Черновик", color: "bg-neutral-100 text-neutral-700 border-neutral-300" },
    pending_payment: { label: "Ожидает оплаты", color: "bg-amber-50 text-amber-700 border-amber-200" },
    paid: { label: "Оплачен", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    partially_received: { label: "Частично оприходован", color: "bg-indigo-50 text-[#4a38f5] border-indigo-200" },
    received: { label: "Поступил на склад", color: "bg-sky-50 text-sky-700 border-sky-200" },
    cancelled: { label: "Отменен", color: "bg-rose-50 text-rose-700 border-rose-200" },
  };

  const st = statusMap[order.status] ?? {
    label: order.status,
    color: "bg-neutral-100 text-neutral-700 border-neutral-200",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-in fade-in-0 duration-150">
      <div className="w-full max-w-3xl rounded-2xl border border-[#e5e5e5] bg-white shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 border border-sky-200">
              <Truck className="h-4.5 w-4.5 text-sky-700" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#111111] font-mono">
                  {order.orderNumber}
                </h2>
                <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-semibold border", st.color)}>
                  {st.label}
                </span>
              </div>
              <p className="text-xs text-[#666666]">
                Создан: {formatDate(order.createdAt)}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть детали заказа"
            className="rounded-lg p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Блок параметров поставщика и статусов */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* Поставщик */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3.5 space-y-1">
              <div className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-[#666666]" />
                Поставщик
              </div>
              <div className="font-semibold text-[13px] text-[#111111]">
                {order.supplierName}
              </div>
              {order.createdByName && (
                <div className="text-[11px] text-[#666666] flex items-center gap-1">
                  <User className="h-3 w-3" />
                  Создал: {order.createdByName}
                </div>
              )}
            </div>

            {/* Оплата */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3.5 space-y-1">
              <div className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider flex items-center gap-1.5">
                <CreditCard className="h-3.5 w-3.5 text-[#666666]" />
                Оплата
              </div>
              {order.paidAt ? (
                <div className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Оплачен: {formatDate(order.paidAt)}
                </div>
              ) : (
                <div className="text-xs font-medium text-amber-700 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Ожидает оплаты
                </div>
              )}
              <div className="text-[11px] font-mono tabular-nums text-[#666666]">
                Товары: {formatRub(order.totalAmount)}
                {extraCostsTotal > 0 ? ` · Доп.: ${formatRub(extraCostsTotal)}` : ""}
              </div>
            </div>

            {/* Оприходование */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3.5 space-y-1">
              <div className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider flex items-center gap-1.5">
                <ArrowDownToLine className="h-3.5 w-3.5 text-[#666666]" />
                Поступление на склад
              </div>
              {order.receivedAt ? (
                <div className="text-xs font-medium text-sky-700 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Оприходован: {formatDate(order.receivedAt)}
                </div>
              ) : isPartiallyReceived ? (
                <div className="text-xs font-medium text-[#4a38f5] flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Частично принят ({receipts.length} приём.)
                </div>
              ) : (
                <div className="text-xs font-medium text-neutral-600 flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" />
                  Ожидает оприходования
                </div>
              )}
              <div className="text-[11px] font-mono tabular-nums text-[#666666]">
                Принято: {receivedQtyTotal} из {orderedQtyTotal} шт
              </div>
            </div>
          </div>

          {/* Таблица позиций */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
            <div className="border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5 text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
              Состав заказа ({order.items?.length || 0} поз.)
            </div>
            <div className="divide-y divide-[#f0f0f0]">
              {(order.items || []).map((it, idx) => {
                const reqQty = it.requestedQuantity || 0;
                const totalQty = it.quantity;
                const receivedQty = Number(it.receivedQuantity ?? (isReceived ? totalQty : 0));
                const remainingQty = Math.max(0, Number(it.remainingQuantity ?? totalQty - receivedQty));
                const extraQty = it.extraQuantity ?? Math.max(0, totalQty - reqQty);

                return (
                  <div key={it.id || idx} className="p-3.5 flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="font-medium text-[13px] text-[#111111]">
                        {it.itemName}
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[#666666] flex-wrap">
                        {it.sku && <span className="font-mono text-[11px]">{it.sku}</span>}
                        <span
                          className={cn(
                            "inline-flex items-center rounded-[4px] border px-2 py-0.5 text-[11px] font-mono tabular-nums font-medium",
                            remainingQty <= 0
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : receivedQty > 0
                                ? "border-indigo-200 bg-indigo-50 text-[#4a38f5]"
                                : "border-[#e5e5e5] bg-[#fbfbfb] text-[#666666]",
                          )}
                        >
                          Принято {receivedQty} / {totalQty} {it.unit}
                        </span>
                        {reqQty > 0 && (
                          <span className="inline-flex items-center rounded-[4px] border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                            {reqQty} {it.unit} в наряд {it.repairOrders || ""}
                          </span>
                        )}
                        {extraQty > 0 && (
                          <span className="inline-flex items-center rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            +{extraQty} {it.unit} на склад (свободный остаток)
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono tabular-nums text-[13px] font-bold text-[#111111]">
                        {formatRub(it.totalPrice)}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-[#666666]">
                        {it.quantity} {it.unit} × {formatRub(it.price)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* История приёмок и доп. расходов */}
          {receipts.length > 0 && (
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
              <div className="border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5 text-[11px] font-semibold text-[#666666] uppercase tracking-wider flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Receipt className="h-3.5 w-3.5 text-[#4a38f5]" />
                  История приёмок ({receipts.length})
                </span>
                {extraCostsTotal > 0 && (
                  <span className="font-mono tabular-nums text-[#4a38f5]">
                    Доп. расходы: {formatRub(extraCostsTotal)}
                  </span>
                )}
              </div>
              <div className="divide-y divide-[#f0f0f0]">
                {receipts.map((rc) => (
                  <div key={rc.id} className="p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono font-semibold text-[#111111]">
                          {rc.receiptNumber}
                        </span>
                        <span className="text-[#666666]">{formatDate(rc.createdAt)}</span>
                        {rc.createdByName && (
                          <span className="text-[#666666]">· {rc.createdByName}</span>
                        )}
                      </div>
                      {rc.extraCostsTotal > 0 && (
                        <span className="rounded-[4px] border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[11px] font-mono tabular-nums text-[#4a38f5]">
                          +{formatRub(rc.extraCostsTotal)} ({ALLOCATION_LABELS[rc.allocationMethod] ?? rc.allocationMethod})
                        </span>
                      )}
                    </div>

                    <div className="space-y-1">
                      {rc.items.map((ri) => (
                        <div
                          key={ri.id}
                          className="flex items-center justify-between gap-2 text-xs text-[#111111]"
                        >
                          <span className="truncate">
                            {ri.itemName}{" "}
                            <span className="font-mono tabular-nums text-[#666666]">
                              × {ri.quantity}
                            </span>
                          </span>
                          <span className="font-mono tabular-nums text-[11px] shrink-0">
                            {ri.allocatedExtraCost > 0 ? (
                              <>
                                <span className="text-[#666666]">{formatRub(ri.baseUnitPrice)}</span>
                                {" → "}
                                <span className="font-semibold text-[#4a38f5]">
                                  {formatRub(ri.effectiveUnitPrice)}
                                </span>
                              </>
                            ) : (
                              formatRub(ri.effectiveUnitPrice)
                            )}
                          </span>
                        </div>
                      ))}
                    </div>

                    {rc.costs.length > 0 && (
                      <div className="rounded-[6px] border border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2 space-y-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#888888]">
                          Дополнительные расходы приёмки
                        </div>
                        {rc.costs.map((c) => (
                          <div key={c.id} className="flex items-center justify-between text-xs">
                            <span className="text-[#666666]">
                              {c.description}{" "}
                              <span className="text-[11px] text-[#888888]">({c.categoryName})</span>
                            </span>
                            <span className="font-mono tabular-nums font-medium text-[#111111]">
                              {formatRub(c.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {rc.notes && (
                      <div className="text-[11px] text-[#666666] italic">
                        Комментарий: {rc.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Примечания */}
          {order.notes && (
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#666666]">
              <span className="font-semibold text-[#111111]">Примечания:</span> {order.notes}
            </div>
          )}
        </div>

        {/* Footer с кнопками действий */}
        <div className="flex items-center justify-between border-t border-[#e5e5e5] px-6 py-3.5 bg-white shrink-0">
          <div>
            <button
              type="button"
              onClick={() => onDelete(order)}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer"
              title={
                isReceived || isPartiallyReceived
                  ? "Удалить заказ, откатить оприходованные партии, движения и кассовые проводки"
                  : "Удалить заказ и вернуть заявки на закупку в статус «В ожидании»"
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              Удалить заказ
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onEdit(order)}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
            >
              <Edit2 className="h-3.5 w-3.5 text-[#666666]" />
              Редактировать
            </button>

            {!isPaid && order.status !== "cancelled" && (
              <button
                type="button"
                onClick={() => onPay(order)}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 shadow-xs transition-colors cursor-pointer"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Оплачено
              </button>
            )}

            {!isReceived && order.status !== "cancelled" && (
              <button
                type="button"
                onClick={() => onReceipt(order)}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#3d2ee0] shadow-xs transition-colors cursor-pointer"
              >
                <ArrowDownToLine className="h-3.5 w-3.5" />
                {isPartiallyReceived ? "Доприходовать на склад" : "Оприходовать на склад"}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
            >
              Закрыть
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
