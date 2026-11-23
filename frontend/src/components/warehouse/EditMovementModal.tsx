"use client";

import { useState, useEffect } from "react";
import { X, Loader2, Save, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import {
  useUpdateWarehouseMovement,
  type WarehouseMovementDTO,
} from "@/lib/api/use-warehouse";

interface EditMovementModalProps {
  open: boolean;
  onClose: () => void;
  movement: WarehouseMovementDTO | null;
}

export function EditMovementModal({ open, onClose, movement }: EditMovementModalProps) {
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("");
  const [costPrice, setCostPrice] = useState("");

  const updateMutation = useUpdateWarehouseMovement();

  useEffect(() => {
    if (!open || !movement) return;
    setDescription(movement.description || "");
    setQuantity(String(movement.quantity ?? 1));
    setCostPrice(String(movement.costPrice ?? 0));
  }, [open, movement]);

  if (!open || !movement) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qtyNum = parseFloat(quantity);
    const costNum = parseFloat(costPrice);

    if (isNaN(qtyNum) || qtyNum <= 0) {
      toast.error("Количество должно быть больше 0");
      return;
    }
    if (isNaN(costNum) || costNum < 0) {
      toast.error("Цена не может быть отрицательной");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: movement.id,
        payload: {
          description: description.trim(),
          quantity: qtyNum,
          cost_price: costNum,
        },
      });
      toast.success("Запись движения обновлена");
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить запись движения");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-[12px] border border-[#e5e5e5] bg-white shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-indigo-50 border border-indigo-200 text-[#4a38f5]">
              <ArrowRightLeft className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">Редактирование движения</h2>
              <p className="text-[11px] text-[#666666]">{movement.itemName ?? "Товар"}</p>
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Количество
              </label>
              <input
                type="number"
                min="0.01"
                step="any"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Цена / Себестоимость, ₽
              </label>
              <input
                type="number"
                min="0"
                step="any"
                required
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="w-full h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-medium text-[#666666] mb-1">
              Описание операции
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Комментарий к операции..."
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none resize-none"
            />
          </div>

          <p className="text-[11px] text-[#888888]">
            При изменении количества или цены автоматически корректируются остатки связанной партии, резерва или списания FIFO.
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
