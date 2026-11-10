"use client";

import { useState } from "react";
import { X, Loader2, ShoppingCart, Truck } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateSupplierOrder,
  type AggregatedPurchaseRequestDTO,
} from "@/lib/api/use-warehouse";

interface CreateSupplierOrderModalProps {
  open: boolean;
  onClose: () => void;
  selectedRequests: AggregatedPurchaseRequestDTO[];
  onSuccess: () => void;
}

function formatRub(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function CreateSupplierOrderModal({
  open,
  onClose,
  selectedRequests,
  onSuccess,
}: CreateSupplierOrderModalProps) {
  const [supplierName, setSupplierName] = useState("");
  const [notes, setNotes] = useState("");

  const createOrderMutation = useCreateSupplierOrder();

  if (!open) return null;

  const totalEstimated = selectedRequests.reduce(
    (sum, r) => sum + r.quantity * (r.estimatedPrice || 0),
    0,
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedSupplier = supplierName.trim();
    if (!trimmedSupplier) {
      toast.error("Укажите наименование поставщика");
      return;
    }

    if (selectedRequests.length === 0) {
      toast.error("Не выбраны позиции для заказа");
      return;
    }

    // Собираем все ID заявок
    const allRequestIds: string[] = [];
    selectedRequests.forEach((r) => {
      if (r.requestIds && r.requestIds.length > 0) {
        allRequestIds.push(...r.requestIds);
      } else if (r.id) {
        allRequestIds.push(r.id);
      }
    });

    const items = selectedRequests.map((r) => ({
      item_id: r.itemId ?? undefined,
      item_name: r.itemName,
      sku: r.sku || "",
      quantity: r.quantity,
      unit: r.unit || "шт",
      price: r.estimatedPrice || 0,
    }));

    try {
      await createOrderMutation.mutateAsync({
        supplier_name: trimmedSupplier,
        purchase_request_ids: allRequestIds,
        items,
        notes: notes.trim(),
      });

      toast.success(`Заказ поставщику «${trimmedSupplier}» успешно сформирован`);
      setSupplierName("");
      setNotes("");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать заказ поставщику");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between pb-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 border border-sky-200">
              <Truck className="h-4.5 w-4.5 text-sky-700" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#111111]">
                Сформировать заказ поставщику
              </h2>
              <p className="text-xs text-[#666666]">
                Объединение {selectedRequests.length} позиций в единую закупку
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

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col flex-1 overflow-hidden space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#111111] mb-1">
              Поставщик <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Например: Профи-Партс, ООО «МобилДеталь», База GSM"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          <div className="flex-1 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2">
            <div className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
              Выбранные позиции ({selectedRequests.length})
            </div>
            <div className="space-y-1.5">
              {selectedRequests.map((r, idx) => (
                <div
                  key={r.id || idx}
                  className="flex items-center justify-between rounded-[6px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs"
                >
                  <div className="min-w-0 pr-2">
                    <div className="font-medium text-[#111111] truncate">{r.itemName}</div>
                    <div className="flex items-center gap-2 text-[11px] text-[#666666] font-mono mt-0.5">
                      {r.sku && <span>{r.sku}</span>}
                      {r.repairOrders && (
                        <span className="text-sky-700 font-sans">
                          Наряды: {r.repairOrders}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="font-mono font-semibold text-[#111111]">
                      {r.quantity} {r.unit}
                    </span>
                    {r.estimatedPrice > 0 && (
                      <div className="text-[11px] font-mono text-[#666666]">
                        {formatRub(r.quantity * r.estimatedPrice)}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#111111] mb-1">
              Примечания к заказу
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Условия доставки, трек-номер, пожелания..."
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 resize-none"
            />
          </div>

          <div className="flex items-center justify-between border-t border-[#e5e5e5] pt-3">
            <div className="text-xs text-[#666666]">
              Предв. сумма:{" "}
              <b className="font-mono text-[13px] text-[#111111]">
                {formatRub(totalEstimated)}
              </b>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#111111] hover:bg-[#fafafa] transition-colors"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={createOrderMutation.isPending}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50"
              >
                {createOrderMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Создание...
                  </>
                ) : (
                  <>
                    <ShoppingCart className="h-4 w-4" />
                    Создать заказ поставщику
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
