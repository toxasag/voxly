"use client";

import { useState, useEffect, useMemo } from "react";
import { X, Loader2, SquarePen, Tag, Layers } from "lucide-react";
import { toast } from "sonner";
import {
  useWarehouseItem,
  useUpdateWarehouseItem,
  useWarehouseCategories,
  useWarehouseBrands,
  type WarehouseItemDTO,
} from "@/lib/api/use-warehouse";
import {
  useRepairDictionaries,
  type DictionaryItemDTO,
} from "@/lib/api/use-repairs";
import { DictionarySelectField } from "@/components/repairs/DictionarySelectField";

interface EditItemModalProps {
  open: boolean;
  itemId: string | null;
  initialItem?: WarehouseItemDTO | null;
  onClose: () => void;
  onSuccess?: () => void;
}

export function EditItemModal({
  open,
  itemId,
  initialItem,
  onClose,
  onSuccess,
}: EditItemModalProps) {
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("шт.");
  const [minStock, setMinStock] = useState("0");
  const [retailPrice, setRetailPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");

  const itemQuery = useWarehouseItem(open && itemId ? itemId : null);
  const updateItemMutation = useUpdateWarehouseItem();
  const dictionariesQuery = useRepairDictionaries();
  const warehouseBrandsQuery = useWarehouseBrands();
  const warehouseCategoriesQuery = useWarehouseCategories();

  const dictionaries = dictionariesQuery.data ?? {
    types: [],
    brands: [],
    models: [],
    accessories: [],
    malfunctions: [],
    categories: [],
  };

  const brandItems: (string | DictionaryItemDTO)[] = useMemo(() => {
    const list: (string | DictionaryItemDTO)[] = [...dictionaries.brands];
    const seen = new Set(dictionaries.brands.map((b) => b.name.trim().toLowerCase()));
    if (warehouseBrandsQuery.data) {
      for (const name of warehouseBrandsQuery.data) {
        const trimmed = name.trim();
        if (trimmed && !seen.has(trimmed.toLowerCase())) {
          list.push(trimmed);
          seen.add(trimmed.toLowerCase());
        }
      }
    }
    return list;
  }, [dictionaries.brands, warehouseBrandsQuery.data]);

  const categoryItems: (string | DictionaryItemDTO)[] = useMemo(() => {
    const list: (string | DictionaryItemDTO)[] = dictionaries.categories ? [...dictionaries.categories] : [];
    const seen = new Set(
      list.map((c) => (typeof c === "string" ? c.trim().toLowerCase() : c.name.trim().toLowerCase())),
    );
    // Также включаем типы оборудования из ремонта
    for (const t of dictionaries.types) {
      const trimmed = t.name.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        list.push(t);
        seen.add(trimmed.toLowerCase());
      }
    }
    if (warehouseCategoriesQuery.data) {
      for (const name of warehouseCategoriesQuery.data) {
        const trimmed = name.trim();
        if (trimmed && !seen.has(trimmed.toLowerCase())) {
          list.push(trimmed);
          seen.add(trimmed.toLowerCase());
        }
      }
    }
    return list;
  }, [dictionaries.categories, dictionaries.types, warehouseCategoriesQuery.data]);

  useEffect(() => {
    const src = itemQuery.data ?? initialItem;
    if (src && open) {
      setName(src.name ?? "");
      setSku(src.sku ?? "");
      setBrand(src.brand ?? "");
      setCategory(src.category ?? "");
      setUnit(src.unit ?? "шт.");
      setMinStock(src.minStock !== undefined ? String(src.minStock) : "0");
      setRetailPrice(
        src.retailPrice !== undefined && src.retailPrice !== null
          ? String(src.retailPrice)
          : src.price !== undefined
          ? String(src.price)
          : "",
      );
      setCostPrice(
        src.costPrice !== undefined && src.costPrice !== null
          ? String(src.costPrice)
          : "",
      );
    }
  }, [itemQuery.data, initialItem, open]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !itemId) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Укажите наименование товара");
      return;
    }

    try {
      await updateItemMutation.mutateAsync({
        id: itemId,
        payload: {
          name: trimmedName,
          sku: sku.trim(),
          brand: brand.trim(),
          category: category.trim(),
          unit: unit.trim() || "шт.",
          min_stock: parseFloat(minStock) || 0,
          retail_price: retailPrice !== "" ? parseFloat(retailPrice) : 0,
          cost_price: costPrice !== "" ? parseFloat(costPrice) : 0,
        },
      });

      toast.success(`Товар «${trimmedName}» успешно обновлен`);
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить товар");
    }
  };

  const isLoading = itemQuery.isLoading && !initialItem;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 border border-[#4a38f5]/20 text-[#4a38f5]">
              <SquarePen className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">Редактирование товара</h2>
              <p className="text-xs text-[#666666]">Изменение параметров складской позиции</p>
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

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-[#4a38f5]" />
          </div>
        ) : (
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

            <div className="grid grid-cols-2 gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-[#111111] mb-1.5">
                  Артикул / SKU
                </label>
                <input
                  type="text"
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="DISP-IP13-BLK"
                  className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
              <div>
                <DictionarySelectField
                  label="Бренд"
                  icon={Tag}
                  category="brand"
                  mode="single"
                  placeholder="Apple, Samsung, Toua..."
                  items={brandItems}
                  value={brand}
                  onChange={(val) => setBrand((val as string) || "")}
                />
              </div>
            </div>

            <div>
              <DictionarySelectField
                label="Категория"
                icon={Layers}
                category="category"
                mode="single"
                placeholder="Запчасти, Инструмент..."
                items={categoryItems}
                value={category}
                onChange={(val) => setCategory((val as string) || "")}
              />
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
                  placeholder="0"
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
                  step="any"
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
                  step="any"
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
                disabled={updateItemMutation.isPending}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#666666] hover:bg-[#fafafa] transition-colors"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={updateItemMutation.isPending}
                className="h-8 rounded-[8px] bg-[#4a38f5] px-3.5 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors flex items-center gap-1.5 disabled:opacity-50"
              >
                {updateItemMutation.isPending ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сохранение...
                  </>
                ) : (
                  "Сохранить изменения"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
