"use client";

import { useState } from "react";
import { X, Loader2, Boxes } from "lucide-react";
import { toast } from "sonner";
import { useCreateWarehouseItem } from "@/lib/api/use-warehouse";

interface CreateItemModalProps {
  open: boolean;
  onClose: () => void;
}

export function CreateItemModal({ open, onClose }: CreateItemModalProps) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [category, setCategory] = useState("Запчасти");
  const [unit, setUnit] = useState("шт.");
  const [minStock, setMinStock] = useState("2");
  const [retailPrice, setRetailPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");

  const createItemMutation = useCreateWarehouseItem();

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Укажите наименование товара");
      return;
    }

    try {
      await createItemMutation.mutateAsync({
        name: trimmedName,
        sku: sku.trim() || undefined,
        category: category.trim() || undefined,
        unit: unit.trim() || "шт.",
        min_stock: parseFloat(minStock) || 0,
        retail_price: retailPrice ? parseFloat(retailPrice) : undefined,
        cost_price: costPrice ? parseFloat(costPrice) : undefined,
      });

      toast.success(`Товар «${trimmedName}» добавлен в номенклатуру`);
      onClose();
      setName("");
      setSku("");
      setRetailPrice("");
      setCostPrice("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать товар");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-md rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between pb-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 border border-amber-200">
              <Boxes className="h-4 w-4 text-amber-700" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">Новый товар в номенклатуру</h2>
              <p className="text-xs text-[#666666]">Добавление позиции в каталог склада</p>
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

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          <div>
            <label className="block text-xs font-medium text-[#111111] mb-1">
              Наименование <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Дисплейный модуль iPhone 13"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Артикул / SKU
              </label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="DISP-IP13-BLK"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Категория
              </label>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Запчасти"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Единица изм.
              </label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="шт."
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Мин. остаток
              </label>
              <input
                type="number"
                min={0}
                value={minStock}
                onChange={(e) => setMinStock(e.target.value)}
                placeholder="2"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Себестоимость (закупка, ₽)
              </label>
              <input
                type="number"
                min={0}
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Розничная цена (₽)
              </label>
              <input
                type="number"
                min={0}
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value)}
                placeholder="0"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-2.5 pt-3 border-t border-[#e5e5e5]">
            <button
              type="button"
              onClick={onClose}
              disabled={createItemMutation.isPending}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#666666] hover:bg-[#fafafa] transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createItemMutation.isPending}
              className="h-8 rounded-[8px] bg-[#4a38f5] px-3.5 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {createItemMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сохранение...
                </>
              ) : (
                "Создать позицию"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
