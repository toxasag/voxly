"use client";

import { useState } from "react";
import { X, SlidersHorizontal, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import {
  useBulkUpdateWarehouseItems,
  type BulkUpdateWarehouseItemsPayload,
  type PriceAdjustmentAction,
} from "@/lib/api/use-warehouse";
import { cn } from "@/lib/utils";

interface ProductBulkEditDialogProps {
  open: boolean;
  selectedIds: string[];
  onClose: () => void;
  onSuccess?: () => void;
}

export function ProductBulkEditDialog({
  open,
  selectedIds,
  onClose,
  onSuccess,
}: ProductBulkEditDialogProps) {
  // Field enable toggles
  const [enableCategory, setEnableCategory] = useState(false);
  const [category, setCategory] = useState("");

  const [enableBrand, setEnableBrand] = useState(false);
  const [brand, setBrand] = useState("");

  const [enableUnit, setEnableUnit] = useState(false);
  const [unit, setUnit] = useState("шт.");

  const [enableMinStock, setEnableMinStock] = useState(false);
  const [minStock, setMinStock] = useState("0");

  const [enableRetailPrice, setEnableRetailPrice] = useState(false);
  const [retailPriceMode, setRetailPriceMode] = useState<"set" | "percent" | "delta">("percent");
  const [retailPriceValue, setRetailPriceValue] = useState("");

  const [enableCostPrice, setEnableCostPrice] = useState(false);
  const [costPriceMode, setCostPriceMode] = useState<"set" | "percent" | "delta">("percent");
  const [costPriceValue, setCostPriceValue] = useState("");

  const bulkUpdateMutation = useBulkUpdateWarehouseItems();

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !enableCategory &&
      !enableBrand &&
      !enableUnit &&
      !enableMinStock &&
      !enableRetailPrice &&
      !enableCostPrice
    ) {
      toast.error("Отметьте хотя бы одно поле для изменения");
      return;
    }

    const payload: BulkUpdateWarehouseItemsPayload = {
      ids: selectedIds,
    };

    if (enableCategory) {
      payload.category = category.trim();
    }
    if (enableBrand) {
      payload.brand = brand.trim();
    }
    if (enableUnit) {
      payload.unit = unit.trim();
    }
    if (enableMinStock) {
      payload.min_stock = Math.max(0, parseFloat(minStock) || 0);
    }

    if (enableRetailPrice && retailPriceValue !== "") {
      const val = parseFloat(retailPriceValue);
      if (!isNaN(val)) {
        payload.retail_price_action = {
          mode: retailPriceMode,
          value: val,
        };
      }
    }

    if (enableCostPrice && costPriceValue !== "") {
      const val = parseFloat(costPriceValue);
      if (!isNaN(val)) {
        payload.cost_price_action = {
          mode: costPriceMode,
          value: val,
        };
      }
    }

    try {
      const res = await bulkUpdateMutation.mutateAsync(payload);
      toast.success(`Обновлено позиций: ${res.updatedCount}`);
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить позиции");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 border border-amber-200">
              <SlidersHorizontal className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <h2 className="text-[14px] font-bold text-[#111111]">
                Массовое редактирование ({selectedIds.length} позиций)
              </h2>
              <p className="text-xs text-[#666666]">
                Отметьте галочками поля, которые необходимо изменить у выбранных товаров
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

        <form onSubmit={handleSubmit} className="mt-4 space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Category */}
          <div className="rounded-[8px] border border-[#e5e5e5] p-3 space-y-2 bg-white">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-[#111111]">
              <input
                type="checkbox"
                checked={enableCategory}
                onChange={(e) => setEnableCategory(e.target.checked)}
                className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
              />
              <span>Изменить категорию</span>
            </label>
            {enableCategory && (
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Новая категория (например: Дисплеи, Аккумуляторы)"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
              />
            )}
          </div>

          {/* Brand */}
          <div className="rounded-[8px] border border-[#e5e5e5] p-3 space-y-2 bg-white">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-[#111111]">
              <input
                type="checkbox"
                checked={enableBrand}
                onChange={(e) => setEnableBrand(e.target.checked)}
                className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
              />
              <span>Изменить бренд / производителя</span>
            </label>
            {enableBrand && (
              <input
                type="text"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="Например: Apple, Samsung, Xiaomi"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
              />
            )}
          </div>

          {/* Unit & Min stock in grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[8px] border border-[#e5e5e5] p-3 space-y-2 bg-white">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-[#111111]">
                <input
                  type="checkbox"
                  checked={enableUnit}
                  onChange={(e) => setEnableUnit(e.target.checked)}
                  className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                />
                <span>Ед. изм.</span>
              </label>
              {enableUnit && (
                <select
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                >
                  <option value="шт.">шт.</option>
                  <option value="комплект">комплект</option>
                  <option value="м">м</option>
                  <option value="л">л</option>
                  <option value="кг">кг</option>
                  <option value="упак">упак</option>
                </select>
              )}
            </div>

            <div className="rounded-[8px] border border-[#e5e5e5] p-3 space-y-2 bg-white">
              <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-[#111111]">
                <input
                  type="checkbox"
                  checked={enableMinStock}
                  onChange={(e) => setEnableMinStock(e.target.checked)}
                  className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                />
                <span>Мин. остаток</span>
              </label>
              {enableMinStock && (
                <input
                  type="number"
                  min={0}
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none font-mono"
                />
              )}
            </div>
          </div>

          {/* Retail Price Adjustment */}
          <div className="rounded-[8px] border border-[#e5e5e5] p-3 space-y-2.5 bg-white">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-[#111111]">
              <input
                type="checkbox"
                checked={enableRetailPrice}
                onChange={(e) => setEnableRetailPrice(e.target.checked)}
                className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
              />
              <span>Розничная цена</span>
            </label>
            {enableRetailPrice && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setRetailPriceMode("percent")}
                    className={cn(
                      "rounded-[6px] px-2.5 py-1 text-xs font-medium border transition-colors",
                      retailPriceMode === "percent"
                        ? "bg-[#4a38f5] text-white border-[#4a38f5]"
                        : "bg-[#fafafa] text-[#666666] border-[#e5e5e5] hover:bg-[#f0f0f0]",
                    )}
                  >
                    Изменить на %
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetailPriceMode("delta")}
                    className={cn(
                      "rounded-[6px] px-2.5 py-1 text-xs font-medium border transition-colors",
                      retailPriceMode === "delta"
                        ? "bg-[#4a38f5] text-white border-[#4a38f5]"
                        : "bg-[#fafafa] text-[#666666] border-[#e5e5e5] hover:bg-[#f0f0f0]",
                    )}
                  >
                    Изменить на +/- ₽
                  </button>
                  <button
                    type="button"
                    onClick={() => setRetailPriceMode("set")}
                    className={cn(
                      "rounded-[6px] px-2.5 py-1 text-xs font-medium border transition-colors",
                      retailPriceMode === "set"
                        ? "bg-[#4a38f5] text-white border-[#4a38f5]"
                        : "bg-[#fafafa] text-[#666666] border-[#e5e5e5] hover:bg-[#f0f0f0]",
                    )}
                  >
                    Установить точную сумму
                  </button>
                </div>

                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={retailPriceValue}
                    onChange={(e) => setRetailPriceValue(e.target.value)}
                    placeholder={
                      retailPriceMode === "percent"
                        ? "Например: 15 (увеличит на 15%) или -10"
                        : retailPriceMode === "delta"
                        ? "Например: 500 (увеличит на 500 ₽) или -200"
                        : "Точная цена в рублях (например: 3500)"
                    }
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#888888]">
                    {retailPriceMode === "percent" ? "%" : "₽"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Cost Price Adjustment */}
          <div className="rounded-[8px] border border-[#e5e5e5] p-3 space-y-2.5 bg-white">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs font-semibold text-[#111111]">
              <input
                type="checkbox"
                checked={enableCostPrice}
                onChange={(e) => setEnableCostPrice(e.target.checked)}
                className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
              />
              <span>Себестоимость / Закупка</span>
            </label>
            {enableCostPrice && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setCostPriceMode("percent")}
                    className={cn(
                      "rounded-[6px] px-2.5 py-1 text-xs font-medium border transition-colors",
                      costPriceMode === "percent"
                        ? "bg-[#4a38f5] text-white border-[#4a38f5]"
                        : "bg-[#fafafa] text-[#666666] border-[#e5e5e5] hover:bg-[#f0f0f0]",
                    )}
                  >
                    Изменить на %
                  </button>
                  <button
                    type="button"
                    onClick={() => setCostPriceMode("delta")}
                    className={cn(
                      "rounded-[6px] px-2.5 py-1 text-xs font-medium border transition-colors",
                      costPriceMode === "delta"
                        ? "bg-[#4a38f5] text-white border-[#4a38f5]"
                        : "bg-[#fafafa] text-[#666666] border-[#e5e5e5] hover:bg-[#f0f0f0]",
                    )}
                  >
                    Изменить на +/- ₽
                  </button>
                  <button
                    type="button"
                    onClick={() => setCostPriceMode("set")}
                    className={cn(
                      "rounded-[6px] px-2.5 py-1 text-xs font-medium border transition-colors",
                      costPriceMode === "set"
                        ? "bg-[#4a38f5] text-white border-[#4a38f5]"
                        : "bg-[#fafafa] text-[#666666] border-[#e5e5e5] hover:bg-[#f0f0f0]",
                    )}
                  >
                    Установить точную сумму
                  </button>
                </div>

                <div className="relative">
                  <input
                    type="number"
                    step="any"
                    value={costPriceValue}
                    onChange={(e) => setCostPriceValue(e.target.value)}
                    placeholder={
                      costPriceMode === "percent"
                        ? "Например: 10 или -5"
                        : costPriceMode === "delta"
                        ? "Например: 300 или -150"
                        : "Точная себестоимость в рублях"
                    }
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#888888]">
                    {costPriceMode === "percent" ? "%" : "₽"}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-[#e5e5e5]">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={bulkUpdateMutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] disabled:opacity-50 transition-colors"
            >
              {bulkUpdateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Применить ({selectedIds.length} поз.)
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
