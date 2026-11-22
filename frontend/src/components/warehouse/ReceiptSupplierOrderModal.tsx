"use client";

import { useState } from "react";
import {
  X,
  Loader2,
  ArrowDownToLine,
  CheckCircle2,
  Wallet,
  Building2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCreateReceiptFromSupplierOrder,
  type SupplierOrderDTO,
} from "@/lib/api/use-warehouse";
import { useAccounts } from "@/lib/api/use-invoices";

interface ReceiptSupplierOrderModalProps {
  open: boolean;
  onClose: () => void;
  order: SupplierOrderDTO | null;
  onSuccess: () => void;
}

import { formatRub } from "@/lib/utils/format";

export function ReceiptSupplierOrderModal({
  open,
  onClose,
  order,
  onSuccess,
}: ReceiptSupplierOrderModalProps) {
  const [markPaid, setMarkPaid] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [paymentComment, setPaymentComment] = useState("");

  const { data: accounts = [] } = useAccounts();
  const createReceiptMutation = useCreateReceiptFromSupplierOrder();

  if (!open || !order) return null;

  const isAlreadyPaid = Boolean(order.paidAt) || order.status === "paid";

  const handleConfirmReceipt = async () => {
    try {
      const res = await createReceiptMutation.mutateAsync({
        id: order.id,
        payload: {
          mark_paid: markPaid && !isAlreadyPaid,
          cash_account_id: markPaid && !isAlreadyPaid ? selectedAccountId || undefined : undefined,
          comment: paymentComment.trim() || undefined,
        },
      });

      toast.success(
        `Заказ №${order.orderNumber} оприходован: создано ${res.batchesCreated} складских партий. Заявки переведены в наряды.`,
      );
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось оприходовать заказ");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-in fade-in-0 duration-150">
      <div className="w-full max-w-xl rounded-2xl border border-[#e5e5e5] bg-white shadow-xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4a38f5]/10 text-[#4a38f5] border border-[#4a38f5]/20">
              <ArrowDownToLine className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#111111]">
                Оприходование на склад
              </h2>
              <p className="text-xs text-[#666666]">
                Приёмка товаров по заказу {order.orderNumber}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-[#666666]" />
              <div>
                <span className="text-[#888888]">Поставщик:</span>{" "}
                <span className="font-semibold text-[#111111]">{order.supplierName}</span>
              </div>
            </div>
            <div className="font-mono font-bold text-sm text-[#111111]">
              {formatRub(order.totalAmount)}
            </div>
          </div>

          {/* Список поступающих позиций с разделением */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
            <div className="bg-[#fafafa] px-4 py-2 text-[11px] font-semibold text-[#666666] uppercase tracking-wider border-b border-[#e5e5e5]">
              Распределение поступающих товаров
            </div>
            <div className="divide-y divide-[#f0f0f0] p-1">
              {(order.items || []).map((it, idx) => {
                const reqQty = it.requestedQuantity || 0;
                const totalQty = it.quantity;
                const extraQty = it.extraQuantity ?? Math.max(0, totalQty - reqQty);

                return (
                  <div key={it.id || idx} className="p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[#111111]">{it.itemName}</span>
                      <span className="font-mono font-bold text-[#111111]">
                        {totalQty} {it.unit}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] flex-wrap">
                      {reqQty > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-[4px] border border-sky-200 bg-sky-50 px-2 py-0.5 font-medium text-sky-700">
                          <CheckCircle2 className="h-3 w-3" />
                          {reqQty} {it.unit} автоматически резервируется под наряд {it.repairOrders || ""}
                        </span>
                      )}
                      {extraQty > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                          +{extraQty} {it.unit} приходуется в свободный остаток склада
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Блок оплаты через кассу */}
          {!isAlreadyPaid ? (
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={markPaid}
                  onChange={(e) => setMarkPaid(e.target.checked)}
                  className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                />
                <span className="text-xs font-semibold text-[#111111] flex items-center gap-1.5">
                  <Wallet className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Списать оплату из кассы сейчас (формирование РКО)
                </span>
              </label>

              {markPaid && (
                <div className="space-y-2 pt-1 pl-6">
                  <div>
                    <label className="block text-[11px] text-[#666666] mb-1">
                      Кассовый счет списания
                    </label>
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    >
                      <option value="">Основная касса по умолчанию</option>
                      {accounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({formatRub(acc.balance)})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <input
                      type="text"
                      value={paymentComment}
                      onChange={(e) => setPaymentComment(e.target.value)}
                      placeholder="Комментарий к платежу (опционально)"
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              <span>Заказ уже оплачен через кассу. Повторное списание не требуется.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] px-6 py-3.5 bg-white shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#111111] hover:bg-[#fafafa] transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleConfirmReceipt}
            disabled={createReceiptMutation.isPending}
            className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50"
          >
            {createReceiptMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Оприходование...
              </>
            ) : (
              <>
                <ArrowDownToLine className="h-4 w-4" />
                Подтвердить оприходование
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
