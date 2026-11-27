"use client";

import { useState, useMemo, useEffect } from "react";
import { X, Loader2, Boxes, Tag, Layers, Cpu, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import {
  useCreateWarehouseItem,
  useWarehouseBrands,
  useWarehouseCategories,
  type WarehouseItemDTO,
} from "@/lib/api/use-warehouse";
import {
  useRepairDictionaries,
  type DictionaryItemDTO,
} from "@/lib/api/use-repairs";
import { DictionarySelectField } from "@/components/repairs/DictionarySelectField";

export interface CreateItemModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  initialName?: string;
  initialSku?: string;
  initialUnit?: string;
  initialCostPrice?: number | string;
  initialRetailPrice?: number | string;
  showQuantity?: boolean;
  initialQuantity?: number;
  showPurchaseRequestOption?: boolean;
  defaultAddToPurchaseRequest?: boolean;
  purchaseRequestHint?: string;
  onCreated?: (
    item: WarehouseItemDTO,
    extra: { quantity: number; addToPurchaseRequest: boolean },
  ) => void | Promise<void>;
}

export function CreateItemModal(props: CreateItemModalProps) {
  if (!props.open) return null;
  return <CreateItemModalInner {...props} />;
}

function CreateItemModalInner({
  open,
  onClose,
  title = "Новый товар в номенклатуру",
  subtitle = "Добавление позиции в каталог склада",
  submitLabel = "Создать позицию",
  initialName = "",
  initialSku = "",
  initialUnit = "шт.",
  initialCostPrice = "",
  initialRetailPrice = "",
  showQuantity = false,
  initialQuantity = 1,
  showPurchaseRequestOption = false,
  defaultAddToPurchaseRequest = false,
  purchaseRequestHint = "Автоматически сформирует заявку в разделе закупок склада",
  onCreated,
}: CreateItemModalProps) {
  useOverlay(open, { onEscape: onClose });

  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("Запчасти");
  const [modelNames, setModelNames] = useState<string[]>([]);
  const [unit, setUnit] = useState("шт.");
  const [minStock, setMinStock] = useState("2");
  const [retailPrice, setRetailPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [addToPurchaseRequest, setAddToPurchaseRequest] = useState(false);
  const [isPostProcessing, setIsPostProcessing] = useState(false);

  const createItemMutation = useCreateWarehouseItem();
  const dictionariesQuery = useRepairDictionaries();
  const warehouseBrandsQuery = useWarehouseBrands();
  const warehouseCategoriesQuery = useWarehouseCategories();

  useEffect(() => {
    if (!open) return;
    setName(initialName || "");
    setSku(initialSku || "");
    setBrand("");
    setCategory("Запчасти");
    setModelNames([]);
    setUnit(initialUnit || "шт.");
    setMinStock("2");
    setCostPrice(
      initialCostPrice !== undefined &&
        initialCostPrice !== null &&
        String(initialCostPrice).trim() !== "" &&
        Number(initialCostPrice) > 0
        ? String(initialCostPrice)
        : "",
    );
    setRetailPrice(
      initialRetailPrice !== undefined &&
        initialRetailPrice !== null &&
        String(initialRetailPrice).trim() !== "" &&
        Number(initialRetailPrice) > 0
        ? String(initialRetailPrice)
        : "",
    );
    setQuantity(String(initialQuantity > 0 ? initialQuantity : 1));
    setAddToPurchaseRequest(defaultAddToPurchaseRequest);
  }, [
    open,
    initialName,
    initialSku,
    initialUnit,
    initialCostPrice,
    initialRetailPrice,
    initialQuantity,
    defaultAddToPurchaseRequest,
  ]);

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
      for (const bName of warehouseBrandsQuery.data) {
        const trimmed = bName.trim();
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
    for (const t of dictionaries.types) {
      const trimmed = t.name.trim();
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        list.push(t);
        seen.add(trimmed.toLowerCase());
      }
    }
    if (warehouseCategoriesQuery.data) {
      for (const cName of warehouseCategoriesQuery.data) {
        const trimmed = cName.trim();
        if (trimmed && !seen.has(trimmed.toLowerCase())) {
          list.push(trimmed);
          seen.add(trimmed.toLowerCase());
        }
      }
    }
    return list;
  }, [dictionaries.categories, dictionaries.types, warehouseCategoriesQuery.data]);

  if (!open) return null;

  const isPending = createItemMutation.isPending || isPostProcessing;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Укажите наименование товара");
      return;
    }

    const parsedQty = showQuantity ? parseFloat(quantity) : 1;
    if (showQuantity && (isNaN(parsedQty) || parsedQty <= 0)) {
      toast.error("Количество должно быть больше 0");
      return;
    }

    try {
      const created = await createItemMutation.mutateAsync({
        name: trimmedName,
        sku: sku.trim() || undefined,
        brand: brand.trim() || undefined,
        category: category.trim() || undefined,
        models: modelNames.length > 0 ? modelNames : undefined,
        unit: unit.trim() || "шт.",
        min_stock: parseFloat(minStock) || 0,
        retail_price: retailPrice ? parseFloat(retailPrice) : undefined,
        cost_price: costPrice ? parseFloat(costPrice) : undefined,
      });

      if (onCreated) {
        setIsPostProcessing(true);
        try {
          await onCreated(created, {
            quantity: parsedQty,
            addToPurchaseRequest: showPurchaseRequestOption ? addToPurchaseRequest : false,
          });
        } finally {
          setIsPostProcessing(false);
        }
      } else {
        toast.success(`Товар «${trimmedName}» добавлен в номенклатуру`);
      }

      onClose();
      setName("");
      setSku("");
      setBrand("");
      setCategory("Запчасти");
      setModelNames([]);
      setRetailPrice("");
      setCostPrice("");
      setQuantity("1");
      setAddToPurchaseRequest(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать товар");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 border border-amber-200">
              <Boxes className="h-4 w-4 text-amber-700" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">{title}</h2>
              <p className="text-xs text-[#666666]">{subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно создания товара"
            className="rounded-lg p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
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
              autoFocus
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

          <div>
            <DictionarySelectField
              label="Подходит к моделям"
              icon={Cpu}
              category="model"
              mode="multi"
              brandName={brand}
              placeholder="Выберите одну или несколько моделей..."
              items={dictionaries.models}
              value={modelNames}
              onChange={(val) => setModelNames(Array.isArray(val) ? val : val ? [val] : [])}
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

          {(showQuantity || showPurchaseRequestOption) && (
            <div className="pt-2.5 border-t border-[#f0f0f0] space-y-2.5">
              {showQuantity && (
                <div>
                  <label className="block text-xs font-medium text-[#111111] mb-1">
                    Количество к добавлению <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-28 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    disabled={isPending}
                  />
                </div>
              )}

              {showPurchaseRequestOption && (
                <label className="flex items-start gap-2.5 cursor-pointer text-xs select-none">
                  <input
                    type="checkbox"
                    checked={addToPurchaseRequest}
                    onChange={(e) => setAddToPurchaseRequest(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    disabled={isPending}
                  />
                  <div>
                    <span className="font-medium text-[#111111] flex items-center gap-1.5">
                      <ShoppingCart className="h-3.5 w-3.5 text-[#666666]" />
                      Создать заявку на закупку
                    </span>
                    <p className="text-[11px] text-[#666666] mt-0.5">{purchaseRequestHint}</p>
                  </div>
                </label>
              )}
            </div>
          )}

          <div className="mt-6 flex items-center justify-end gap-2.5 pt-3 border-t border-[#e5e5e5]">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#666666] hover:bg-[#fafafa] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isPending}
              className="h-8 rounded-[8px] bg-[#4a38f5] px-3.5 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сохранение...
                </>
              ) : (
                submitLabel
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
