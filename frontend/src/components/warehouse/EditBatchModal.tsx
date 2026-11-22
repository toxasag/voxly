"use client";

import { useState, useEffect } from "react";
import { X, Loader2, Save, Receipt } from "lucide-react";
import { toast } from "sonner";
import {
  useUpdateWarehouseBatch,
  type WarehouseBatchDTO,
} from "@/lib/api/use-warehouse";

interface EditBatchModalProps {
  open: boolean;
  onClose: () => void;
  batch: WarehouseBatchDTO | null;
}

function toDatetimeLocal(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return "";
  }
}

export function EditBatchModal({ open, onClose, batch }: EditBatchModalProps) {
  const [batchNumber, setBatchNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [initialQuantity, setInitialQuantity] = useState("");
  const [remainingQuantity, setRemainingQuantity] = useState("");
  const [receivedAt, setReceivedAt] = useState("");

  const updateMutation = useUpdateWarehouseBatch();

  useEffect(() => {
    if (!open || !batch) return;
    setBatchNumber(batch.batchNumber || "");
    setSupplierName(batch.supplierName || "");
    setPurchasePrice(String(batch.purchasePrice ?? 0));
    setInitialQuantity(String(batch.initialQuantity ?? 1));
    setRemainingQuantity(String(batch.remainingQuantity ?? 0));
    setReceivedAt(toDatetimeLocal(batch.receivedAt));
  }, [open, batch]);

  if (!open || !batch) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const priceNum = parseFloat(purchasePrice);
    const initNum = parseFloat(initialQuantity);
    const remNum = parseFloat(remainingQuantity);

    if (isNaN(priceNum) || priceNum < 0) {
      toast.error("Укажите корректную закупочную цену");
      return;
    }
    if (isNaN(initNum) || initNum <= 0) {
      toast.error("Принятое количество должно быть больше 0");
      return;
    }
    if (isNaN(remNum) || remNum < 0 || remNum > initNum) {
      toast.error("Остаток FIFO должен быть от 0 до принятого количества");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: batch.id,
        payload: {
          batch_number: batchNumber.trim(),
          supplier_name: supplierName.trim(),
          purchase_price: priceNum,
          initial_quantity: initNum,
          remaining_quantity: remNum,
          received_at: receivedAt ? new Date(receivedAt).toISOString() : undefined,
        },
      });
      toast.success("Партия обновлена, остатки и цены пересчитаны");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить партию");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-[12px] border border-[#e5e5e5] bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-indigo-50 border border-indigo-200 text-[#4a38f5]">
              <Receipt className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">Редактирование партии</h2>
              <p className="text-[11px] text-[#666666]">{batch.itemName ?? "Товар"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Партия / Накладная
              </label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="Например, ЗП-2026-0001"
                className="w-full h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Дата прихода
              </label>
              <input
                type="datetime-local"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
                className="w-full h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#666666] mb-1">
              Поставщик
            </label>
            <input
              type="text"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              placeholder="Наименование поставщика"
              className="w-full h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Закупка/ед., ₽
              </label>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                className="w-full h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Принято
              </label>
              <input
                type="number"
                min="0.01"
                step="any"
                required
                value={initialQuantity}
                onChange={(e) => setInitialQuantity(e.target.value)}
                className="w-full h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Остаток FIFO
              </label>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={remainingQuantity}
                onChange={(e) => setRemainingQuantity(e.target.value)}
                className="w-full h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>
          </div>

          <p className="text-[11px] text-[#888888]">
            Изменение закупочной цены автоматически пересчитает себестоимость связанных движений, списаний FIFO и оценку склада.
          </p>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0f0f0]">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="inline-flex items-center gap-1.5 h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
