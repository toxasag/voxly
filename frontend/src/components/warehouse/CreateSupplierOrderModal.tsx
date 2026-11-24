"use client";

import { useState, useMemo, useEffect } from "react";
import {
  X,
  Loader2,
  ShoppingCart,
  Truck,
  Building2,
  Plus,
  ChevronDown,
  Check,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useCreateSupplierOrder,
  useWarehouseItems,
  type AggregatedPurchaseRequestDTO,
} from "@/lib/api/use-warehouse";
import { useCompanies, useCreateCompany, type CompanyDTO } from "@/lib/api/use-companies";
import { cn } from "@/lib/utils";
import { formatRub } from "@/lib/utils/format";

interface CreateSupplierOrderModalProps {
  open: boolean;
  onClose: () => void;
  selectedRequests?: AggregatedPurchaseRequestDTO[];
  onSuccess: () => void;
}

interface FormItemState {
  key: string;
  itemId?: string | null;
  itemName: string;
  sku: string;
  unit: string;
  requestedQuantity: number;
  quantity: number;
  price: number;
  repairOrders?: string;
  requestIds: string[];
}

export function CreateSupplierOrderModal({
  open,
  onClose,
  selectedRequests = [],
  onSuccess,
}: CreateSupplierOrderModalProps) {
  // Поставщик
  const [selectedCompany, setSelectedCompany] = useState<CompanyDTO | null>(null);
  const [supplierInput, setSupplierInput] = useState("");
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);
  const [newCompanyInn, setNewCompanyInn] = useState("");
  const [newCompanyPhone, setNewCompanyPhone] = useState("");

  // Статус и примечания
  const [status, setStatus] = useState<"pending_payment" | "draft">("pending_payment");
  const [notes, setNotes] = useState("");

  // Редактируемые позиции
  const [items, setItems] = useState<FormItemState[]>([]);

  // Хуки
  const { data: companiesData, isLoading: isCompaniesLoading } = useCompanies({
    search: supplierInput.trim() || undefined,
    limit: 50,
  });
  const { data: allWarehouseItems = [] } = useWarehouseItems();
  const createCompanyMutation = useCreateCompany();
  const createOrderMutation = useCreateSupplierOrder();

  // Инициализация позиций
  useEffect(() => {
    if (!open) return;
    if (selectedRequests && selectedRequests.length > 0) {
      const initialItems: FormItemState[] = selectedRequests.map((r, idx) => {
        const reqQty = Number(r.quantity) || 1;
        const unitPrice = Number(r.estimatedPrice) || 0;
        const reqIds = r.requestIds && r.requestIds.length > 0 ? r.requestIds : r.id ? [r.id] : [];
        return {
          key: r.id || `${r.itemName}_${idx}`,
          itemId: r.itemId ?? null,
          itemName: r.itemName,
          sku: r.sku || "",
          unit: r.unit || "шт",
          requestedQuantity: reqQty,
          quantity: reqQty,
          price: unitPrice,
          repairOrders: r.repairOrders || undefined,
          requestIds: reqIds,
        };
      });
      setItems(initialItems);
    } else {
      setItems([
        {
          key: `item_${Date.now()}_0`,
          itemId: null,
          itemName: "",
          sku: "",
          unit: "шт",
          requestedQuantity: 0,
          quantity: 1,
          price: 0,
          repairOrders: undefined,
          requestIds: [],
        },
      ]);
    }
    setSelectedCompany(null);
    setSupplierInput("");
    setIsCompanyDropdownOpen(false);
    setIsCreatingCompany(false);
    setStatus("pending_payment");
    setNotes("");
  }, [open, selectedRequests]);

  const totalSum = useMemo(() => {
    return items.reduce((sum, it) => sum + it.quantity * it.price, 0);
  }, [items]);

  if (!open) return null;

  const handleAddItem = () => {
    setItems((prev) => [
      ...prev,
      {
        key: `item_${Date.now()}_${prev.length}`,
        itemId: null,
        itemName: "",
        sku: "",
        unit: "шт",
        requestedQuantity: 0,
        quantity: 1,
        price: 0,
        repairOrders: undefined,
        requestIds: [],
      },
    ]);
  };

  const handleRemoveItem = (idx: number) => {
    setItems((prev) => {
      const filtered = prev.filter((_, i) => i !== idx);
      if (filtered.length === 0) {
        return [
          {
            key: `item_${Date.now()}_0`,
            itemId: null,
            itemName: "",
            sku: "",
            unit: "шт",
            requestedQuantity: 0,
            quantity: 1,
            price: 0,
            repairOrders: undefined,
            requestIds: [],
          },
        ];
      }
      return filtered;
    });
  };

  const handleItemNameChange = (idx: number, val: string) => {
    setItems((prev) => {
      const copy = [...prev];
      const cur = copy[idx];
      if (!cur) return prev;
      const matched = allWarehouseItems.find(
        (it) => it.name.trim().toLowerCase() === val.trim().toLowerCase(),
      );
      if (matched) {
        copy[idx] = {
          ...cur,
          itemName: matched.name,
          itemId: matched.id,
          sku: matched.sku || cur.sku,
          unit: matched.unit || cur.unit || "шт",
          price: Number(matched.costPrice || matched.price || matched.retailPrice || cur.price || 0),
        };
      } else {
        copy[idx] = { ...cur, itemName: val };
      }
      return copy;
    });
  };

  const handleItemQuantityChange = (idx: number, val: number) => {
    setItems((prev) => {
      const copy = [...prev];
      const cur = copy[idx];
      if (!cur) return prev;
      const cleanVal = Math.max(1, isNaN(val) ? 1 : val);
      copy[idx] = { ...cur, quantity: cleanVal };
      return copy;
    });
  };

  const handleItemPriceChange = (idx: number, val: number) => {
    setItems((prev) => {
      const copy = [...prev];
      const cur = copy[idx];
      if (!cur) return prev;
      const cleanVal = Math.max(0, isNaN(val) ? 0 : val);
      copy[idx] = { ...cur, price: cleanVal };
      return copy;
    });
  };

  const handleItemSkuChange = (idx: number, val: string) => {
    setItems((prev) => {
      const copy = [...prev];
      const cur = copy[idx];
      if (!cur) return prev;
      copy[idx] = { ...cur, sku: val };
      return copy;
    });
  };

  const handleItemUnitChange = (idx: number, val: string) => {
    setItems((prev) => {
      const copy = [...prev];
      const cur = copy[idx];
      if (!cur) return prev;
      copy[idx] = { ...cur, unit: val };
      return copy;
    });
  };

  const handleSelectCompany = (comp: CompanyDTO) => {
    setSelectedCompany(comp);
    setSupplierInput(comp.name);
    setIsCompanyDropdownOpen(false);
    setIsCreatingCompany(false);
  };

  const handleQuickCreateCompany = async () => {
    const trimmed = supplierInput.trim();
    if (!trimmed) {
      toast.error("Укажите наименование компании-поставщика");
      return;
    }
    try {
      const created = await createCompanyMutation.mutateAsync({
        name: trimmed,
        inn: newCompanyInn.trim() || undefined,
        phone: newCompanyPhone.trim() || undefined,
      });
      setSelectedCompany(created);
      setSupplierInput(created.name);
      setIsCreatingCompany(false);
      setIsCompanyDropdownOpen(false);
      toast.success(`Компания «${created.name}» добавлена в справочник`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать компанию");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalSupplierName = selectedCompany ? selectedCompany.name : supplierInput.trim();
    if (!finalSupplierName) {
      toast.error("Укажите наименование поставщика");
      return;
    }

    const validItems = items.filter((it) => it.itemName.trim().length > 0);
    if (validItems.length === 0) {
      toast.error("Добавьте хотя бы одну позицию в заказ");
      return;
    }

    // Собираем все уникальные ID заявок
    const allRequestIds: string[] = [];
    validItems.forEach((it) => {
      allRequestIds.push(...it.requestIds);
    });

    const payloadItems = validItems.map((it) => {
      const reqQty = it.requestedQuantity;
      const totalQty = it.quantity;
      const extraQty = Math.max(0, totalQty - reqQty);
      return {
        purchase_request_ids: it.requestIds,
        purchase_request_id: it.requestIds[0] ?? null,
        item_id: it.itemId ?? null,
        item_name: it.itemName.trim(),
        sku: it.sku.trim(),
        requested_quantity: reqQty,
        extra_quantity: extraQty,
        quantity: totalQty,
        unit: it.unit || "шт",
        price: it.price,
        repair_orders: it.repairOrders,
      };
    });

    try {
      await createOrderMutation.mutateAsync({
        supplier_name: finalSupplierName,
        supplier_company_id: selectedCompany?.id ?? null,
        purchase_request_ids: Array.from(new Set(allRequestIds)),
        status,
        items: payloadItems,
        notes: notes.trim(),
      });

      toast.success(`Заказ поставщику «${finalSupplierName}» успешно сформирован`);
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать заказ поставщику");
    }
  };

  const companiesList = companiesData?.items ?? [];
  const isFromPurchases = selectedRequests && selectedRequests.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-in fade-in-0 duration-150">
      <div
        className="w-full max-w-2xl rounded-2xl border border-[#e5e5e5] bg-white shadow-xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={() => setIsCompanyDropdownOpen(false)}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-50 border border-sky-200">
              <Truck className="h-4.5 w-4.5 text-sky-700" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#111111]">
                {isFromPurchases ? "Сформировать заказ поставщику" : "Новый заказ поставщику"}
              </h2>
              <p className="text-xs text-[#666666]">
                {isFromPurchases
                  ? `Объединение ${selectedRequests.length} позиций с возможностью пополнения склада`
                  : "Прямой заказ поставщику на закупку и пополнение склада"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden p-6 gap-4">
          {/* Поле Поставщик с Combobox */}
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <label className="block text-xs font-medium text-[#111111] mb-1">
              Поставщик (Контрагент) <span className="text-rose-500">*</span>
            </label>
            <div className="relative flex items-center">
              <div className="absolute left-3 text-[#888888] pointer-events-none">
                <Building2 className="h-4 w-4" />
              </div>
              <input
                type="text"
                required
                value={supplierInput}
                onChange={(e) => {
                  setSupplierInput(e.target.value);
                  setSelectedCompany(null);
                  setIsCompanyDropdownOpen(true);
                }}
                onFocus={() => setIsCompanyDropdownOpen(true)}
                placeholder="Выберите компанию или начните вводить название..."
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-9 pr-8 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <button
                type="button"
                onClick={() => setIsCompanyDropdownOpen((v) => !v)}
                className="absolute right-2 text-[#888888] hover:text-[#111111] p-1 cursor-pointer"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>

            {/* Выпадающий список компаний */}
            {isCompanyDropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-60 overflow-y-auto rounded-xl border border-[#e5e5e5] bg-white shadow-lg py-1.5 text-xs divide-y divide-[#f5f5f5]">
                {companiesList.length > 0 && (
                  <div className="py-1">
                    <div className="px-3 py-1 text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                      Компании в CRM
                    </div>
                    {companiesList.map((comp) => (
                      <button
                        key={comp.id}
                        type="button"
                        onClick={() => handleSelectCompany(comp)}
                        className="w-full text-left px-3 py-2 hover:bg-[#fbfbfb] flex items-center justify-between transition-colors cursor-pointer"
                      >
                        <div>
                          <div className="font-medium text-[#111111]">{comp.name}</div>
                          {comp.requisites?.inn && (
                            <div className="text-[11px] text-[#666666]">
                              ИНН: {comp.requisites.inn}
                            </div>
                          )}
                        </div>
                        {selectedCompany?.id === comp.id && (
                          <Check className="h-4 w-4 text-[#4a38f5]" />
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {companiesList.length === 0 && !isCompaniesLoading && !isCreatingCompany && (
                  <div className="px-3 py-2 text-center text-[#888888]">
                    Компаний не найдено. Нажмите «Создать компанию» ниже.
                  </div>
                )}

                {/* Блок быстрого создания компании */}
                {!isCreatingCompany ? (
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => setIsCreatingCompany(true)}
                      className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/5 rounded-[6px] transition-colors cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Создать компанию «{supplierInput.trim() || "новую"}»
                    </button>
                  </div>
                ) : (
                  <div className="p-3 bg-[#fafafa] space-y-2">
                    <div className="text-[11px] font-semibold text-[#111111]">
                      Новый контрагент-поставщик
                    </div>
                    <div>
                      <input
                        type="text"
                        value={supplierInput}
                        onChange={(e) => setSupplierInput(e.target.value)}
                        placeholder="Название компании *"
                        className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={newCompanyInn}
                        onChange={(e) => setNewCompanyInn(e.target.value)}
                        placeholder="ИНН (10 или 12 цифр)"
                        className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                      <input
                        type="text"
                        value={newCompanyPhone}
                        onChange={(e) => setNewCompanyPhone(e.target.value)}
                        placeholder="Телефон"
                        className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsCreatingCompany(false)}
                        className="px-2.5 py-1 rounded-[6px] border border-[#e5e5e5] bg-white text-xs text-[#666666] hover:bg-neutral-50 cursor-pointer"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={handleQuickCreateCompany}
                        disabled={createCompanyMutation.isPending || !supplierInput.trim()}
                        className="px-3 py-1 rounded-[6px] bg-[#4a38f5] text-xs font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
                      >
                        {createCompanyMutation.isPending ? "Создание..." : "Создать и выбрать"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Datalist для быстрого выбора товаров из номенклатуры */}
          <datalist id="warehouse-supplier-order-catalog">
            {allWarehouseItems.map((wi) => (
              <option key={wi.id} value={wi.name}>
                {wi.sku ? `[${wi.sku}] ` : ""}Остаток: {wi.availableStock} {wi.unit}
              </option>
            ))}
          </datalist>

          {/* Таблица позиций с редактированием количества и цен */}
          <div className="flex-1 flex flex-col overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2 text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
              <span>Состав закупки ({items.length} поз.)</span>
              <button
                type="button"
                onClick={handleAddItem}
                className="inline-flex items-center gap-1 rounded-[4px] bg-[#4a38f5]/10 px-2 py-0.5 text-xs font-semibold text-[#4a38f5] hover:bg-[#4a38f5]/20 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Добавить товар</span>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#f0f0f0] p-1">
              {items.map((it, idx) => {
                const reqQty = it.requestedQuantity;
                const totalQty = it.quantity;
                const extraQty = Math.max(0, totalQty - reqQty);
                const itemTotal = totalQty * it.price;
                const isManual = reqQty === 0;

                return (
                  <div key={it.key} className="p-3 hover:bg-[#fbfbfb] transition-colors space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        {isManual ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              required
                              value={it.itemName}
                              list="warehouse-supplier-order-catalog"
                              onChange={(e) => handleItemNameChange(idx, e.target.value)}
                              placeholder="Начните ввод или выберите товар из каталога..."
                              className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] placeholder:text-[#aaaaaa] focus:border-[#4a38f5] focus:outline-none"
                            />
                          </div>
                        ) : (
                          <div>
                            <div className="font-medium text-[13px] text-[#111111] truncate">
                              {it.itemName}
                            </div>
                            <div className="flex items-center gap-2 text-[11px] text-[#666666] mt-0.5">
                              {it.sku && <span className="font-mono">{it.sku}</span>}
                              {it.repairOrders && (
                                <span className="font-medium text-sky-700">
                                  Наряды: {it.repairOrders}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {isManual && (
                          <div className="flex items-center gap-2 text-[11px] text-[#666666]">
                            <input
                              type="text"
                              value={it.sku}
                              onChange={(e) => handleItemSkuChange(idx, e.target.value)}
                              placeholder="Артикул"
                              className="w-28 rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-0.5 text-[11px] font-mono text-[#111111] placeholder:text-[#cccccc] focus:border-[#4a38f5] focus:outline-none"
                            />
                            <input
                              type="text"
                              value={it.unit}
                              onChange={(e) => handleItemUnitChange(idx, e.target.value)}
                              placeholder="Ед. (шт)"
                              className="w-16 rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-0.5 text-[11px] text-[#111111] placeholder:text-[#cccccc] focus:border-[#4a38f5] focus:outline-none"
                            />
                          </div>
                        )}
                      </div>

                      {/* Сумма по позиции и кнопка удаления */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <span className="font-mono text-[13px] font-bold text-[#111111]">
                            {formatRub(itemTotal)}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(idx)}
                          className="rounded-[4px] p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Удалить позицию"
                          aria-label="Удалить позицию"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>

                    {/* Панель количества и цены */}
                    <div className="flex items-center justify-between gap-3 pt-1 border-t border-[#f5f5f5] text-xs">
                      {/* Бейджи разделения */}
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {reqQty > 0 && (
                          <span className="inline-flex items-center rounded-[4px] border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                            {reqQty} {it.unit} в наряд {it.repairOrders ? it.repairOrders : ""}
                          </span>
                        )}
                        {extraQty > 0 ? (
                          <span className="inline-flex items-center rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            +{extraQty} {it.unit} на склад (свободный остаток)
                          </span>
                        ) : reqQty > 0 ? (
                          <span className="text-[11px] text-[#888888]">
                            Увеличьте количество, чтобы заказать на склад
                          </span>
                        ) : (
                          <span className="text-[11px] text-[#888888]">
                            Прямой заказ на склад
                          </span>
                        )}
                      </div>

                      {/* Инпуты ввода */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* Количество */}
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-[#888888]">Кол-во:</span>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={it.quantity}
                            onChange={(e) =>
                              handleItemQuantityChange(idx, parseInt(e.target.value, 10))
                            }
                            className="w-16 h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-center font-mono text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                          />
                          <span className="text-[11px] text-[#666666]">{it.unit}</span>
                        </div>

                        {/* Цена */}
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-[#888888]">Цена:</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={it.price}
                            onChange={(e) =>
                              handleItemPriceChange(idx, parseFloat(e.target.value))
                            }
                            className="w-20 h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-right font-mono text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                          />
                          <span className="text-[11px] text-[#666666]">₽</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={handleAddItem}
              className="flex items-center justify-center gap-1.5 py-2 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/5 border-t border-[#f0f0f0] transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Добавить ещё одну позицию</span>
            </button>
          </div>

          {/* Статус и примечания */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Статус заказа
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "pending_payment" | "draft")}
                className="w-full h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none cursor-pointer"
              >
                <option value="pending_payment">Ожидает оплаты</option>
                <option value="draft">Черновик</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Примечания к заказу
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Условия доставки, трек-номер, контакт менеджера..."
                className="w-full h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#e5e5e5] pt-3 shrink-0">
            <div className="text-xs text-[#666666]">
              Итого к заказу:{" "}
              <b className="font-mono text-sm font-bold text-[#111111] ml-1">
                {formatRub(totalSum)}
              </b>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={createOrderMutation.isPending}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 cursor-pointer"
              >
                {createOrderMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Создание...
                  </>
                ) : (
                  <>
                    <ShoppingCart className="h-4 w-4" />
                    {isFromPurchases ? "Сформировать заказ" : "Создать заказ"}
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
