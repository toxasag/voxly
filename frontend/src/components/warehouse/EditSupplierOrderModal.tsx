"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  X,
  Loader2,
  Save,
  Truck,
  Building2,
  Plus,
  ChevronDown,
  Check,
  Search,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import {
  useUpdateSupplierOrder,
  type SupplierOrderDTO,
} from "@/lib/api/use-warehouse";
import {
  useCompanies,
  useCompanyInnLookup,
  useCreateCompany,
  type CompanyDTO,
  type CompanyInnLookupResult,
} from "@/lib/api/use-companies";
import { apiClient } from "@/lib/api/apiClient";

interface EditSupplierOrderModalProps {
  open: boolean;
  onClose: () => void;
  order: SupplierOrderDTO | null;
  onSuccess: () => void;
}

interface FormItemState {
  id?: string;
  itemId?: string | null;
  itemName: string;
  sku: string;
  unit: string;
  requestedQuantity: number;
  quantity: number;
  price: number;
  repairOrders?: string;
  purchaseRequestId?: string | null;
  purchaseRequestIds?: string[];
}

import { formatRub } from "@/lib/utils/format";

export function EditSupplierOrderModal({
  open,
  onClose,
  order,
  onSuccess,
}: EditSupplierOrderModalProps) {
  const [supplierInput, setSupplierInput] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<CompanyDTO | null>(null);
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);
  const [newCompanyInn, setNewCompanyInn] = useState("");
  const [newCompanyPhone, setNewCompanyPhone] = useState("");
  const [newCompanyKpp, setNewCompanyKpp] = useState("");
  const [newCompanyOgrn, setNewCompanyOgrn] = useState("");
  const [newCompanyLegalAddress, setNewCompanyLegalAddress] = useState("");
  const [isManualInnLookingUp, setIsManualInnLookingUp] = useState(false);
  const lastAutoAppliedInnRef = useRef<string>("");

  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<FormItemState[]>([]);

  const { data: companiesData, isLoading: isCompaniesLoading } = useCompanies({
    search: supplierInput.trim() || undefined,
    limit: 50,
  });
  const cleanNewInn = newCompanyInn.replace(/\D/g, "").trim();
  const innLookupQuery = useCompanyInnLookup(isCreatingCompany ? cleanNewInn : "");
  const createCompanyMutation = useCreateCompany();
  const updateOrderMutation = useUpdateSupplierOrder();

  useEffect(() => {
    if (!open || !order) return;
    setSupplierInput(order.supplierName || "");
    setNotes(order.notes || "");
    setIsCompanyDropdownOpen(false);
    setIsCreatingCompany(false);
    setNewCompanyInn("");
    setNewCompanyPhone("");
    setNewCompanyKpp("");
    setNewCompanyOgrn("");
    setNewCompanyLegalAddress("");
    lastAutoAppliedInnRef.current = "";

    const initialItems: FormItemState[] = (order.items || []).map((it) => ({
      id: it.id,
      itemId: it.itemId,
      itemName: it.itemName,
      sku: it.sku || "",
      unit: it.unit || "шт",
      requestedQuantity: it.requestedQuantity ?? 0,
      quantity: it.quantity,
      price: it.price,
      repairOrders: it.repairOrders,
      purchaseRequestId: it.purchaseRequestId,
      purchaseRequestIds: it.purchaseRequestIds,
    }));
    setItems(initialItems);
  }, [open, order]);

  useEffect(() => {
    if (!isCreatingCompany) return;
    const data = innLookupQuery.data;
    if (!data || !data.inn) return;
    if (lastAutoAppliedInnRef.current === data.inn) return;
    lastAutoAppliedInnRef.current = data.inn;
    if (data.name) setSupplierInput(data.name);
    setNewCompanyKpp(data.kpp ?? "");
    setNewCompanyOgrn(data.ogrn ?? "");
    setNewCompanyLegalAddress(data.legalAddress ?? "");
    toast.success(`Реквизиты найдены по ИНН: ${data.name}`);
  }, [isCreatingCompany, innLookupQuery.data]);

  const totalSum = useMemo(() => {
    return items.reduce((sum, it) => sum + it.quantity * it.price, 0);
  }, [items]);

  if (!open || !order) return null;

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

  const handleSelectCompany = (comp: CompanyDTO) => {
    setSelectedCompany(comp);
    setSupplierInput(comp.name);
    setIsCompanyDropdownOpen(false);
    setIsCreatingCompany(false);
  };

  const handleLookupCompanyByInn = async () => {
    const inn = newCompanyInn.replace(/\D/g, "").trim();
    if (inn.length !== 10 && inn.length !== 12) {
      toast.error("Укажите корректный ИНН (10 или 12 цифр)");
      return;
    }
    setIsManualInnLookingUp(true);
    try {
      const res = await apiClient.get<CompanyInnLookupResult>("/api/v1/crm/companies/lookup-inn", {
        query: { inn },
      });
      const data = res.data;
      if (!data) {
        toast.error("Организация с таким ИНН не найдена");
        return;
      }
      lastAutoAppliedInnRef.current = data.inn;
      if (data.name) setSupplierInput(data.name);
      setNewCompanyKpp(data.kpp ?? "");
      setNewCompanyOgrn(data.ogrn ?? "");
      setNewCompanyLegalAddress(data.legalAddress ?? "");
      toast.success(`Заполнено по ИНН: ${data.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Организация по ИНН не найдена");
    } finally {
      setIsManualInnLookingUp(false);
    }
  };

  const handleQuickCreateCompany = async () => {
    const trimmed = supplierInput.trim();
    if (!trimmed) {
      toast.error("Укажите наименование компании-поставщика");
      return;
    }
    const cleanInn = newCompanyInn.replace(/\D/g, "").trim();
    if (cleanInn.length > 0 && cleanInn.length !== 10 && cleanInn.length !== 12) {
      toast.error("ИНН должен содержать 10 или 12 цифр");
      return;
    }
    const cleanKpp = newCompanyKpp.replace(/\D/g, "").trim();
    const cleanOgrn = newCompanyOgrn.replace(/\D/g, "").trim();
    try {
      const created = await createCompanyMutation.mutateAsync({
        name: trimmed,
        inn: cleanInn || undefined,
        kpp: cleanKpp.length === 9 ? cleanKpp : undefined,
        ogrn: cleanOgrn.length === 13 || cleanOgrn.length === 15 ? cleanOgrn : undefined,
        legal_address: newCompanyLegalAddress.trim() || undefined,
        phone: newCompanyPhone.trim() || undefined,
      });
      setSelectedCompany(created);
      setSupplierInput(created.name);
      setNewCompanyInn("");
      setNewCompanyPhone("");
      setNewCompanyKpp("");
      setNewCompanyOgrn("");
      setNewCompanyLegalAddress("");
      lastAutoAppliedInnRef.current = "";
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

    const isItemsLocked = order.status === "received" || order.status === "partially_received";

    const payloadItems = items.map((it) => {
      const reqQty = it.requestedQuantity;
      const totalQty = it.quantity;
      const extraQty = Math.max(0, totalQty - reqQty);
      return {
        id: it.id,
        purchase_request_id: it.purchaseRequestId ?? null,
        purchase_request_ids: it.purchaseRequestIds,
        item_id: it.itemId ?? null,
        item_name: it.itemName,
        sku: it.sku,
        requested_quantity: reqQty,
        extra_quantity: extraQty,
        quantity: totalQty,
        unit: it.unit,
        price: it.price,
        repair_orders: it.repairOrders,
      };
    });

    try {
      await updateOrderMutation.mutateAsync({
        id: order.id,
        payload: {
          supplier_name: finalSupplierName,
          supplier_company_id: selectedCompany?.id ?? order.supplierCompanyId ?? null,
          notes: notes.trim(),
          ...(isItemsLocked ? {} : { items: payloadItems }),
        },
      });

      toast.success(`Заказ поставщику №${order.orderNumber} обновлен`);
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить заказ");
    }
  };

  const isItemsLocked = order.status === "received" || order.status === "partially_received";
  const companiesList = companiesData?.items ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs animate-in fade-in-0 duration-150">
      <div
        className="w-full max-w-2xl rounded-2xl border border-[#e5e5e5] bg-white shadow-xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={() => setIsCompanyDropdownOpen(false)}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 border border-amber-200">
              <Truck className="h-4.5 w-4.5 text-amber-700" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#111111]">
                Редактирование заказа {order.orderNumber}
              </h2>
              <p className="text-xs text-[#666666]">
                {order.status === "received"
                  ? "Заказ оприходован: можно изменить поставщика и примечание (состав правится во вкладке «Партии»)"
                  : "Изменение поставщика, количеств и закупочных цен"}
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

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 overflow-hidden p-6 gap-4">
          {/* Поставщик */}
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
                className="absolute right-2 text-[#888888] hover:text-[#111111] p-1"
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
                        className="w-full text-left px-3 py-2 hover:bg-[#fbfbfb] flex items-center justify-between transition-colors"
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

                {!isCreatingCompany ? (
                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => setIsCreatingCompany(true)}
                      className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/5 rounded-[6px] transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Создать компанию «{supplierInput.trim() || "новую"}»
                    </button>
                  </div>
                ) : (
                  <div className="p-3 bg-[#fafafa] space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-[#111111]">
                        Новый контрагент-поставщик
                      </span>
                      <button
                        type="button"
                        onClick={handleLookupCompanyByInn}
                        disabled={
                          innLookupQuery.isFetching ||
                          isManualInnLookingUp ||
                          (cleanNewInn.length !== 10 && cleanNewInn.length !== 12)
                        }
                        className="inline-flex items-center gap-1 rounded-[6px] border border-[#4a38f5]/25 bg-white px-2 py-0.5 text-[11px] font-medium text-[#4a38f5] hover:bg-[#4a38f5]/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
                      >
                        {innLookupQuery.isFetching || isManualInnLookingUp ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Search className="h-3 w-3" />
                        )}
                        <span>Заполнить по ИНН</span>
                      </button>
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
                        onChange={(e) => {
                          setNewCompanyInn(e.target.value);
                          if (e.target.value.replace(/\D/g, "") !== lastAutoAppliedInnRef.current) {
                            lastAutoAppliedInnRef.current = "";
                          }
                        }}
                        placeholder="ИНН (10 или 12 цифр)"
                        className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 font-mono text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                      <input
                        type="text"
                        value={newCompanyPhone}
                        onChange={(e) => setNewCompanyPhone(e.target.value)}
                        placeholder="Телефон"
                        className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                    {(newCompanyKpp || newCompanyOgrn || newCompanyLegalAddress) && (
                      <div className="rounded-[6px] border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-[11px] text-emerald-800 space-y-0.5">
                        <div className="flex items-center gap-1 font-medium">
                          <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                          <span>Реквизиты из ФНС будут сохранены</span>
                        </div>
                        <div className="font-mono text-[10px] text-emerald-700/90 flex flex-wrap gap-x-2">
                          {newCompanyKpp && <span>КПП: {newCompanyKpp}</span>}
                          {newCompanyOgrn && <span>ОГРН: {newCompanyOgrn}</span>}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setIsCreatingCompany(false)}
                        className="px-2.5 py-1 rounded-[6px] border border-[#e5e5e5] bg-white text-xs text-[#666666] hover:bg-neutral-50"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={handleQuickCreateCompany}
                        disabled={createCompanyMutation.isPending || !supplierInput.trim()}
                        className="px-3 py-1 rounded-[6px] bg-[#4a38f5] text-xs font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50"
                      >
                        {createCompanyMutation.isPending ? "Создание..." : "Создать и выбрать"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Таблица позиций */}
          <div className="flex-1 flex flex-col overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2 text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
              <span>Позиции заказа ({items.length} поз.)</span>
              <span>
                {isItemsLocked ? "Состав зафиксирован после приёмки" : "Количество и сумма"}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto divide-y divide-[#f0f0f0] p-1">
              {items.map((it, idx) => {
                const reqQty = it.requestedQuantity;
                const totalQty = it.quantity;
                const extraQty = Math.max(0, totalQty - reqQty);
                const itemTotal = totalQty * it.price;

                return (
                  <div key={it.id || idx} className="p-3 hover:bg-[#fbfbfb] transition-colors space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
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

                      <div className="text-right shrink-0">
                        <span className="font-mono text-[13px] font-bold text-[#111111]">
                          {formatRub(itemTotal)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 pt-1 border-t border-[#f5f5f5] text-xs">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {reqQty > 0 && (
                          <span className="inline-flex items-center rounded-[4px] border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                            {reqQty} {it.unit} в наряд {it.repairOrders || ""}
                          </span>
                        )}
                        {extraQty > 0 && (
                          <span className="inline-flex items-center rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                            +{extraQty} {it.unit} на склад
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-[#888888]">Всего:</span>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            disabled={isItemsLocked}
                            value={it.quantity}
                            onChange={(e) =>
                              handleItemQuantityChange(idx, parseInt(e.target.value, 10))
                            }
                            className="w-16 h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-center font-mono text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none disabled:bg-[#fafafa] disabled:text-[#888888] disabled:cursor-not-allowed"
                          />
                          <span className="text-[11px] text-[#666666]">{it.unit}</span>
                        </div>

                        <div className="flex items-center gap-1">
                          <span className="text-[11px] text-[#888888]">Цена:</span>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            disabled={isItemsLocked}
                            value={it.price}
                            onChange={(e) =>
                              handleItemPriceChange(idx, parseFloat(e.target.value))
                            }
                            className="w-20 h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-right font-mono text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none disabled:bg-[#fafafa] disabled:text-[#888888] disabled:cursor-not-allowed"
                          />
                          <span className="text-[11px] text-[#666666]">₽</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Примечания */}
          <div>
            <label className="block text-xs font-medium text-[#111111] mb-1">
              Примечания к заказу
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Условия доставки, трек-номер, контакт менеджера..."
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 resize-none"
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[#e5e5e5] pt-3 shrink-0">
            <div className="text-xs text-[#666666]">
              Итого сумма:{" "}
              <b className="font-mono text-sm font-bold text-[#111111] ml-1">
                {formatRub(totalSum)}
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
                disabled={updateOrderMutation.isPending}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50"
              >
                {updateOrderMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4" />
                    Сохранить изменения
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
