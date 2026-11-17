"use client";

import { useState, useMemo, useCallback } from "react";
import {
  PackagePlus,
  Boxes,
  BookOpen,
  Plus,
  Trash2,
  Search,
  Loader2,
  Check,
  AlertCircle,
  Tag,
  Calculator,
} from "lucide-react";
import { toast } from "sonner";
import {
  useDealItems,
  useAddDealItem,
  useDeleteDealItem,
  useUpdateDealItem,
  type DealDTO,
  type DealItemDTO,
} from "@/lib/api/use-deals";
import { useWarehouseItems, type WarehouseItemDTO } from "@/lib/api/use-warehouse";
import { useServices, type ServiceItemDTO } from "@/lib/api/use-services";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/shared/Skeleton";
import { TagPill } from "@/components/ui/tag";

function formatRub(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function DealProductsServicesTab({ deal }: { deal: DealDTO }) {
  const { data: dealItemsData, isLoading: isItemsLoading } = useDealItems(deal.id);
  const items = dealItemsData?.data ?? [];
  const totalBudget = dealItemsData?.totalBudget ?? deal.budget ?? 0;

  const addItemMutation = useAddDealItem(deal.id);
  const deleteItemMutation = useDeleteDealItem(deal.id);
  const updateItemMutation = useUpdateDealItem(deal.id);

  const { data: warehouseItems = [], isLoading: isWarehouseLoading } = useWarehouseItems();
  const { data: services = [], isLoading: isServicesLoading } = useServices();

  // Add Item Bar State
  const [itemType, setItemType] = useState<"product" | "service">("service");
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>("");
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customSku, setCustomSku] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("усл");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Statistics
  const stats = useMemo(() => {
    let productsSum = 0;
    let servicesSum = 0;
    let productsCount = 0;
    let servicesCount = 0;

    for (const item of items) {
      if (item.itemType === "product") {
        productsSum += item.totalAmount;
        productsCount += item.quantity;
      } else {
        servicesSum += item.totalAmount;
        servicesCount += item.quantity;
      }
    }

    return {
      productsSum,
      servicesSum,
      productsCount,
      servicesCount,
      totalCount: items.length,
      calculatedBudget: productsSum + servicesSum,
    };
  }, [items]);

  // Handle Catalog Selection
  const handleSelectCatalogItem = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedCatalogId(id);

    if (!id) {
      setCustomName("");
      setCustomDescription("");
      setCustomSku("");
      setPrice("");
      return;
    }

    if (itemType === "service") {
      const s = services.find((srv) => srv.id === id);
      if (s) {
        setCustomName(s.name);
        setCustomDescription(s.description ?? "");
        setPrice(String(s.price || s.defaultPrice || 0));
        setUnit(s.unit || "усл");
      }
    } else {
      const w = warehouseItems.find((wh) => wh.id === id);
      if (w) {
        setCustomName(w.name);
        setCustomDescription(w.category ? `Категория: ${w.category}` : "");
        setCustomSku(w.sku || "");
        setPrice(String(w.retailPrice || w.costPrice || 0));
        setUnit(w.unit || "шт");
      }
    }
  };

  // Switch between Product / Service tab in Add Form
  const handleSwitchType = (type: "product" | "service") => {
    setItemType(type);
    setSelectedCatalogId("");
    setCustomName("");
    setCustomDescription("");
    setCustomSku("");
    setPrice("");
    setUnit(type === "product" ? "шт" : "усл");
  };

  // Submit Add Item
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = customName.trim();
    if (!trimmedName) {
      toast.error("Укажите наименование позиции");
      return;
    }

    const priceNum = parseFloat(price);
    const parsedPrice = !isNaN(priceNum) && priceNum >= 0 ? priceNum : 0;
    const qtyNum = parseFloat(quantity);
    const parsedQty = !isNaN(qtyNum) && qtyNum > 0 ? qtyNum : 1;
    const discNum = parseFloat(discountPercent);
    const parsedDisc = !isNaN(discNum) && discNum >= 0 && discNum <= 100 ? discNum : 0;

    try {
      await addItemMutation.mutateAsync({
        item_type: itemType,
        item_id: selectedCatalogId || null,
        name: trimmedName,
        description: customDescription.trim(),
        sku: customSku.trim(),
        price: parsedPrice,
        quantity: parsedQty,
        unit: unit.trim() || (itemType === "product" ? "шт" : "усл"),
        discount_percent: parsedDisc,
      });

      toast.success(`Позиция «${trimmedName}» добавлена в сделку`);
      setSelectedCatalogId("");
      setCustomName("");
      setCustomDescription("");
      setCustomSku("");
      setPrice("");
      setQuantity("1");
      setDiscountPercent("0");
      setIsAddFormOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось добавить позицию");
    }
  };

  // Delete Item
  const handleDeleteItem = async (itemId: string, name: string) => {
    setDeletingId(itemId);
    try {
      await deleteItemMutation.mutateAsync(itemId);
      toast.success(`Позиция «${name}» удалена из сделки`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить позицию");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-5 space-y-4">
      {/* Summary KPI Card Twenty CRM Light */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-indigo-50 border border-indigo-200 text-[#4a38f5]">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#666666]">Позиций:</span>
                <span className="text-sm font-bold font-mono text-[#111111]">{stats.totalCount}</span>
              </div>
              <span className="text-[#e5e5e5]">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#666666]">Услуги:</span>
                <span className="text-xs font-semibold font-mono text-[#111111]">{formatRub(stats.servicesSum)}</span>
              </div>
              <span className="text-[#e5e5e5]">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#666666]">Товары:</span>
                <span className="text-xs font-semibold font-mono text-[#111111]">{formatRub(stats.productsSum)}</span>
              </div>
              <span className="text-[#e5e5e5]">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#666666]">Итого бюджет:</span>
                <span className="text-sm font-bold font-mono text-[#4a38f5]">
                  {formatRub(stats.calculatedBudget || totalBudget)}
                </span>
              </div>
            </div>
            <p className="text-[11px] text-[#888888] mt-1">
              Бюджет сделки автоматически пересчитывается при добавлении или изменении позиций
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsAddFormOpen(!isAddFormOpen)}
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-2 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          {isAddFormOpen ? "Скрыть форму" : "Добавить позицию"}
        </button>
      </div>

      {/* Add Item Panel */}
      {isAddFormOpen && (
        <div className="rounded-[8px] border border-indigo-200 bg-white p-4 shadow-2xs animate-in fade-in duration-150">
          <div className="flex items-center justify-between mb-3 border-b border-[#f0f0f0] pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#111111]">Тип позиции:</span>
              <div className="inline-flex rounded-[6px] border border-[#e5e5e5] p-0.5 bg-[#f5f5f5]">
                <button
                  type="button"
                  onClick={() => handleSwitchType("service")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-[4px] font-medium transition-colors cursor-pointer",
                    itemType === "service"
                      ? "bg-white text-[#4a38f5] shadow-2xs"
                      : "text-[#666666] hover:text-[#111111]",
                  )}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Услуга
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchType("product")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-[4px] font-medium transition-colors cursor-pointer",
                    itemType === "product"
                      ? "bg-white text-[#4a38f5] shadow-2xs"
                      : "text-[#666666] hover:text-[#111111]",
                  )}
                >
                  <Boxes className="h-3.5 w-3.5" />
                  Товар
                </button>
              </div>
            </div>

            <span className="text-[11px] text-[#888888]">
              {itemType === "service" ? "Выбор из справочника услуг" : "Выбор из номенклатуры склада"}
            </span>
          </div>

          <form onSubmit={handleAddItem} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Выбрать из каталога
                </label>
                <select
                  value={selectedCatalogId}
                  onChange={handleSelectCatalogItem}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                >
                  <option value="">— Быстрый выбор или ввести вручную —</option>
                  {itemType === "service" ? (
                    services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.price > 0 ? `${s.price} ₽` : "0 ₽"})
                      </option>
                    ))
                  ) : (
                    warehouseItems.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} {w.sku ? `[${w.sku}]` : ""} — ост. {w.availableStock} {w.unit} (
                        {w.retailPrice || w.costPrice} ₽)
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Наименование в сделке <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Название товара или услуги..."
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Цена за ед., ₽
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Количество
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="ед."
                    className="w-16 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2 text-xs text-center text-[#666666] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Скидка, %
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  placeholder="0"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Итоговая сумма строки
                </label>
                <div className="h-8 rounded-[8px] bg-[#f5f5f5] border border-[#e5e5e5] px-3 flex items-center justify-between text-xs font-mono font-bold text-[#111111]">
                  <span>
                    {formatRub(
                      Math.max(
                        0,
                        (parseFloat(price) || 0) * (parseFloat(quantity) || 1) * (1 - (parseFloat(discountPercent) || 0) / 100),
                      ),
                    )}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Описание / примечание к позиции
              </label>
              <input
                type="text"
                placeholder="Дополнительное описание, условия или артикул..."
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0f0f0]">
              <button
                type="button"
                onClick={() => setIsAddFormOpen(false)}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={addItemMutation.isPending || !customName.trim()}
                className="h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {addItemMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Добавить в сделку
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Items Table */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
        {isItemsLoading ? (
          <div className="p-8 space-y-3">
            <Skeleton className="h-8 w-full rounded-[6px]" />
            <Skeleton className="h-8 w-full rounded-[6px]" />
            <Skeleton className="h-8 w-full rounded-[6px]" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <div className="h-12 w-12 rounded-full bg-[#f5f5f5] flex items-center justify-center mx-auto mb-3">
              <PackagePlus className="h-6 w-6 text-[#888888]" />
            </div>
            <h3 className="text-sm font-semibold text-[#111111] mb-1">
              В сделке пока нет товаров и услуг
            </h3>
            <p className="text-xs text-[#666666] max-w-sm mx-auto mb-4">
              Прикрепляйте позиции со склада или из справочника услуг для точного расчета сметы и бюджета сделки
            </p>
            <button
              type="button"
              onClick={() => setIsAddFormOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-2 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить первую позицию
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-[11px] font-medium uppercase tracking-wider text-[#666666]">
                <th className="py-2.5 px-4 font-medium w-6">#</th>
                <th className="py-2.5 px-4 font-medium w-1/3">Наименование</th>
                <th className="py-2.5 px-4 font-medium text-center">Тип</th>
                <th className="py-2.5 px-4 font-medium text-right">Цена</th>
                <th className="py-2.5 px-4 font-medium text-center">Кол-во</th>
                <th className="py-2.5 px-4 font-medium text-right">Скидка</th>
                <th className="py-2.5 px-4 font-medium text-right">Итого</th>
                <th className="py-2.5 px-4 font-medium text-right w-16"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {items.map((item, index) => (
                <tr key={item.id} className="hover:bg-[#fafafa] transition-colors group">
                  <td className="py-2.5 px-4 text-xs font-mono text-[#888888]">
                    {index + 1}
                  </td>
                  <td className="py-2.5 px-4">
                    <p className="text-[13px] font-medium text-[#111111]">{item.name}</p>
                    {item.description ? (
                      <p className="text-[11px] text-[#666666] line-clamp-1 mt-0.5">{item.description}</p>
                    ) : null}
                    {item.sku ? (
                      <span className="text-[10px] font-mono text-[#888888]">Арт: {item.sku}</span>
                    ) : null}
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    {item.itemType === "service" ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                        <BookOpen className="h-3 w-3" />
                        Услуга
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                        <Boxes className="h-3 w-3" />
                        Товар
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <span className="text-xs font-mono tabular-nums text-[#111111]">
                      {formatRub(item.price)}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    <span className="text-xs font-mono tabular-nums font-medium text-[#111111]">
                      {item.quantity} {item.unit || "шт"}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    {item.discountPercent > 0 ? (
                      <span className="text-xs font-mono text-emerald-600">
                        -{item.discountPercent}%
                      </span>
                    ) : (
                      <span className="text-xs text-[#cccccc]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <span className="text-xs font-mono font-bold tabular-nums text-[#111111]">
                      {formatRub(item.totalAmount)}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => void handleDeleteItem(item.id, item.name)}
                      disabled={deletingId === item.id}
                      title="Удалить из сделки"
                      className="rounded-[6px] p-1.5 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-40"
                    >
                      {deletingId === item.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#e5e5e5] bg-[#fafafa] font-semibold text-xs text-[#111111]">
                <td colSpan={6} className="py-3 px-4 text-right">
                  ИТОГО ПО СДЕЛКЕ:
                </td>
                <td className="py-3 px-4 text-right font-mono font-bold text-sm text-[#4a38f5]">
                  {formatRub(stats.calculatedBudget || totalBudget)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}
