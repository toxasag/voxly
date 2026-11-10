"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { Package, Plus, Trash2, ShoppingCart, Check, AlertCircle, Loader2, Boxes } from "lucide-react";
import { toast } from "sonner";
import type { PartItem } from "@/lib/repairs/repairs.types";
import {
  useWarehouseItems,
  useCreatePurchaseRequest,
  usePurchaseRequests,
  type WarehouseItemDTO,
} from "@/lib/api/use-warehouse";
import { useCreatePart, useDeletePart } from "@/lib/api/use-repairs";
import { cn } from "@/lib/utils";

interface PartsTableProps {
  orderId?: string;
  items: PartItem[];
  onChange?: (items: PartItem[]) => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function PartsTable({ orderId, items, onChange }: PartsTableProps) {
  const [newName, setNewName] = useState("");
  const [newArticle, setNewArticle] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newRetail, setNewRetail] = useState("");
  const [newCostPrice, setNewCostPrice] = useState("");
  const [selectedWarehouseItem, setSelectedWarehouseItem] = useState<WarehouseItemDTO | null>(null);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const comboboxRef = useRef<HTMLDivElement>(null);

  const { data: warehouseItems = [], isLoading: isWarehouseLoading } = useWarehouseItems();
  const { data: purchaseRequests = [] } = usePurchaseRequests(undefined, orderId);
  const createPartMutation = useCreatePart();
  const deletePartMutation = useDeletePart();
  const createPurchaseMutation = useCreatePurchaseRequest();

  // Закрытие выпадающего списка при клике снаружи
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (comboboxRef.current && !comboboxRef.current.contains(event.target as Node)) {
        setCatalogOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Фильтрация номенклатуры склада по введенному поиску
  const filteredWarehouseItems = warehouseItems.filter((wi) => {
    const q = newName.trim().toLowerCase();
    if (!q) return true;
    return wi.name.toLowerCase().includes(q) || wi.sku.toLowerCase().includes(q);
  });

  const handleSelectWarehouseItem = (item: WarehouseItemDTO) => {
    setSelectedWarehouseItem(item);
    setNewName(item.name);
    setNewArticle(item.sku);
    if (item.retailPrice > 0) {
      setNewRetail(String(item.retailPrice));
    }
    if (item.costPrice > 0) {
      setNewCostPrice(String(item.costPrice));
    }
    setCatalogOpen(false);
  };

  const handleAdd = useCallback(async () => {
    const name = newName.trim();
    const article = newArticle.trim();
    const qtyNum = parseInt(newQty, 10);
    const retailNum = parseFloat(newRetail);
    const costNum = parseFloat(newCostPrice);

    if (
      !name ||
      !article ||
      isNaN(qtyNum) ||
      qtyNum < 1 ||
      isNaN(retailNum) ||
      retailNum < 0 ||
      isNaN(costNum) ||
      costNum < 0
    ) {
      return;
    }

    if (orderId) {
      try {
        await createPartMutation.mutateAsync({
          orderId,
          payload: {
            name,
            article,
            quantity: qtyNum,
            retail_price: retailNum,
            cost_price: costNum,
            warehouse_item_id: selectedWarehouseItem?.id,
          },
        });
        toast.success(`Запчасть «${name}» добавлена${selectedWarehouseItem ? " (зарезервирована со склада)" : ""}`);
        setNewName("");
        setNewArticle("");
        setNewQty("1");
        setNewRetail("");
        setNewCostPrice("");
        setSelectedWarehouseItem(null);
        setCatalogOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось добавить запчасть");
      }
    } else {
      const newItem: PartItem = {
        id: `p${Date.now()}`,
        name,
        article,
        quantity: qtyNum,
        retail_price: retailNum,
        cost_price: costNum,
        warehouse_item_id: selectedWarehouseItem?.id,
        status: selectedWarehouseItem ? "reserved" : "used",
      };

      onChange?.([...items, newItem]);
      setNewName("");
      setNewArticle("");
      setNewQty("1");
      setNewRetail("");
      setNewCostPrice("");
      setSelectedWarehouseItem(null);
      setCatalogOpen(false);
    }
  }, [
    newName,
    newArticle,
    newQty,
    newRetail,
    newCostPrice,
    orderId,
    selectedWarehouseItem,
    createPartMutation,
    items,
    onChange,
  ]);

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (orderId) {
        setDeletingId(id);
        try {
          await deletePartMutation.mutateAsync({
            orderId,
            partId: id,
          });
          toast.success(`Запчасть «${name}» удалена (резерв снят)`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Не удалось удалить запчасть");
        } finally {
          setDeletingId(null);
        }
      } else {
        onChange?.(items.filter((item) => item.id !== id));
      }
    },
    [orderId, deletePartMutation, items, onChange],
  );

  const handleCreatePurchase = async (partName: string, sku: string, qty: number, estPrice: number) => {
    try {
      await createPurchaseMutation.mutateAsync({
        repair_order_id: orderId,
        item_id: selectedWarehouseItem?.id,
        item_name: partName,
        sku: sku || "Б/А",
        quantity: qty > 0 ? qty : 1,
        estimated_price: estPrice > 0 ? estPrice : undefined,
        comment: `Заявка из наряда на ремонт`,
      });
      toast.success(`Заявка на закупку «${partName}» создана`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при создании заявки на закупку");
    }
  };

  const isAdding = createPartMutation.isPending;
  const canAdd =
    !isAdding &&
    newName.trim().length > 0 &&
    newArticle.trim().length > 0 &&
    newQty.trim().length > 0 &&
    parseInt(newQty, 10) >= 1 &&
    newRetail.trim().length > 0 &&
    parseFloat(newRetail) >= 0 &&
    newCostPrice.trim().length > 0 &&
    parseFloat(newCostPrice) >= 0;

  const totalRetail = items.reduce((sum, item) => sum + item.retail_price * item.quantity, 0);
  const totalCost = items.reduce((sum, item) => sum + item.cost_price * item.quantity, 0);
  const totalMargin = totalRetail - totalCost;

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
      <div className="flex items-center gap-2 border-b border-[#e5e5e5] px-4 py-3 bg-[#fafafa]">
        <Package className="h-4 w-4 text-[#666666]" />
        <span className="text-sm font-semibold text-[#111111]">Использованные запчасти</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-[#888888]">{items.length} позиций</span>
          {orderId && (
            <span className="flex items-center gap-1 rounded-[4px] bg-[#f0f0f0] px-2 py-0.5 text-[11px] text-[#666666]">
              <Boxes className="h-3 w-3 text-[#4a38f5]" /> Авторезерв со склада
            </span>
          )}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                Запчасть
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                Артикул
              </th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[70px]">
                Кол-во
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[105px]">
                Розница
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[105px]">
                Закупка
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[90px]">
                Наценка
              </th>
              <th className="px-4 py-2.5 w-[80px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {items.map((item) => {
              const itemTotalRetail = item.retail_price * item.quantity;
              const itemTotalCost = item.cost_price * item.quantity;
              const margin = itemTotalRetail - itemTotalCost;
              const marginPct = itemTotalCost > 0 ? Math.round((margin / itemTotalRetail) * 100) : 0;

              return (
                <tr key={item.id} className="transition-colors hover:bg-[#f5f5f5]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-medium text-[#111111]">{item.name}</p>
                      {item.warehouse_item_id && (
                        <span className="inline-flex items-center rounded-[4px] bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 border border-sky-200">
                          Склад
                        </span>
                      )}
                      {item.status === "reserved" && (
                        <span className="inline-flex items-center rounded-[4px] bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                          Резерв
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-[#666666]">{item.article}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-[13px] font-mono text-[#111111]">{item.quantity}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-[13px] font-semibold text-[#111111] font-mono">
                      {formatCost(item.retail_price)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-[13px] text-[#666666] font-mono">
                      {formatCost(item.cost_price)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div>
                      <span className="text-[13px] font-semibold text-emerald-700 font-mono">
                        {formatCost(margin)}
                      </span>
                      <span className="block text-[10px] text-emerald-700/80">
                        {marginPct}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {orderId && (
                        <button
                          type="button"
                          onClick={() => handleCreatePurchase(item.name, item.article, item.quantity, item.cost_price)}
                          className="rounded p-1 text-[#888888] hover:text-[#4a38f5] hover:bg-slate-100 transition-colors"
                          title="Создать заявку на закупку"
                        >
                          <ShoppingCart className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDelete(item.id, item.name)}
                        disabled={deletingId === item.id}
                        className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40"
                        title="Удалить запчасть"
                      >
                        {deletingId === item.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="text-sm text-[#888888]">Запчасти пока не добавлены.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Выбор из склада / Добавление */}
      <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3 space-y-2">
        <div className="flex items-center gap-2">
          {/* Складской автокомплит */}
          <div ref={comboboxRef} className="relative flex-1">
            <div className="relative">
              <input
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setSelectedWarehouseItem(null);
                  setCatalogOpen(true);
                }}
                onFocus={() => setCatalogOpen(true)}
                placeholder="Поиск по складу или название запчасти..."
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-3 pr-8 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <Boxes className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            </div>

            {catalogOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg">
                <div className="px-2 py-1 text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                  Номенклатура склада
                </div>
                {isWarehouseLoading && (
                  <div className="flex items-center justify-center py-3 text-xs text-[#888888]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Загрузка остатков...
                  </div>
                )}
                {!isWarehouseLoading && filteredWarehouseItems.length > 0 && (
                  <div className="space-y-0.5">
                    {filteredWarehouseItems.map((wi) => {
                      const isOutOfStock = wi.availableStock <= 0;
                      return (
                        <button
                          key={wi.id}
                          type="button"
                          onClick={() => handleSelectWarehouseItem(wi)}
                          className="flex w-full items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[#fafafa]"
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <span className="font-medium text-[#111111] truncate block">{wi.name}</span>
                            <span className="text-[11px] font-mono text-[#888888]">{wi.sku}</span>
                          </div>
                          <div className="text-right shrink-0">
                            <span
                              className={cn(
                                "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono",
                                isOutOfStock
                                  ? "bg-rose-50 text-rose-700 border border-rose-200"
                                  : "bg-emerald-50 text-emerald-700 border border-emerald-200",
                              )}
                            >
                              Доступно: {wi.availableStock} {wi.unit}
                            </span>
                            <div className="text-[11px] font-mono text-[#666666] mt-0.5">
                              {formatCost(wi.retailPrice)}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {!isWarehouseLoading && filteredWarehouseItems.length === 0 && (
                  <div className="px-2.5 py-2 text-xs text-[#888888]">
                    {warehouseItems.length === 0
                      ? "Склад пока пуст. Введите название и параметры вручную."
                      : "На складе позиций не найдено. Можно добавить как свободную деталь."}
                  </div>
                )}
              </div>
            )}
          </div>

          <input
            type="text"
            value={newArticle}
            onChange={(e) => setNewArticle(e.target.value)}
            placeholder="Артикул"
            className="w-[110px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-3 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
          <input
            type="number"
            min={1}
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            placeholder="1"
            title="Количество"
            className="w-[60px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2 text-[13px] text-center font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <input
            type="number"
            min={0}
            step={1}
            value={newRetail}
            onChange={(e) => setNewRetail(e.target.value)}
            placeholder="Розница"
            title="Розничная цена"
            className="w-[95px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2 text-[13px] text-right font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <input
            type="number"
            min={0}
            step={1}
            value={newCostPrice}
            onChange={(e) => setNewCostPrice(e.target.value)}
            placeholder="Закупка"
            title="Себестоимость"
            className="w-[95px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2 text-[13px] text-right font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className={cn(
              "shrink-0 rounded-[8px] p-2 transition-colors",
              canAdd
                ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]"
                : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
            )}
            title="Добавить запчасть"
          >
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>

        {/* Предупреждение о нехватке на складе и быстрая закупка */}
        {selectedWarehouseItem && (
          <div className="flex items-center justify-between rounded-[6px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              {selectedWarehouseItem.availableStock >= (parseInt(newQty, 10) || 1) ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="text-[#111111]">
                    В наличии на складе: <b>{selectedWarehouseItem.availableStock}</b> {selectedWarehouseItem.unit} (будет зарезервировано)
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                  <span className="text-amber-800 font-medium">
                    Недостаточно на складе: доступно <b>{selectedWarehouseItem.availableStock}</b> из {selectedWarehouseItem.totalStock} {selectedWarehouseItem.unit}
                  </span>
                </>
              )}
            </div>

            {selectedWarehouseItem.availableStock < (parseInt(newQty, 10) || 1) && (
              <button
                type="button"
                onClick={() =>
                  handleCreatePurchase(
                    selectedWarehouseItem.name,
                    selectedWarehouseItem.sku,
                    parseInt(newQty, 10) || 1,
                    selectedWarehouseItem.costPrice,
                  )
                }
                disabled={createPurchaseMutation.isPending}
                className="flex items-center gap-1.5 rounded-[4px] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors"
              >
                <ShoppingCart className="h-3 w-3" />
                В заявку на закупку
              </button>
            )}
          </div>
        )}
      </div>

      {/* Итого по запчастям */}
      {items.length > 0 && (
        <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4 text-[#666666]">
            <span>Закупка: <b className="font-mono text-[#111111]">{formatCost(totalCost)}</b></span>
            <span>Маржа: <b className="font-mono text-emerald-700">{formatCost(totalMargin)}</b></span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#666666]">Итого розница:</span>
            <span className="text-sm font-bold text-[#111111] font-mono">{formatCost(totalRetail)}</span>
          </div>
        </div>
      )}

      {/* Связанные заявки на закупку */}
      {purchaseRequests.length > 0 && (
        <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5">
          <div className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <ShoppingCart className="h-3.5 w-3.5 text-[#4a38f5]" />
            Заявки на закупку по этому наряду ({purchaseRequests.length})
          </div>
          <div className="space-y-1">
            {purchaseRequests.map((pr) => {
              const statusMap = {
                pending: { label: "Ожидает закупки", color: "bg-amber-50 text-amber-700 border-amber-200" },
                ordered: { label: "Заказано у поставщика", color: "bg-sky-50 text-sky-700 border-sky-200" },
                received: { label: "Поступило на склад", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                cancelled: { label: "Отменено", color: "bg-rose-50 text-rose-700 border-rose-200" },
              }[pr.status];

              return (
                <div
                  key={pr.id}
                  className="flex items-center justify-between rounded-[6px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-[#111111]">{pr.itemName}</span>
                    <span className="font-mono text-[11px] text-[#888888]">{pr.sku}</span>
                    <span className="font-mono text-xs text-[#666666]">× {pr.quantity} {pr.unit}</span>
                  </div>
                  <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold border", statusMap.color)}>
                    {statusMap.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
