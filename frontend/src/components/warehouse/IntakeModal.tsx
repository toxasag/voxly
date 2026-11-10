"use client";

import { useState, useEffect } from "react";
import { X, Loader2, ArrowDownToLine, Receipt, CreditCard } from "lucide-react";
import { toast } from "sonner";
import {
  useWarehouseItems,
  useIntakeWarehouseBatch,
  useUpdatePurchaseRequest,
  type WarehouseItemDTO,
} from "@/lib/api/use-warehouse";
import { useAccounts } from "@/lib/api/use-invoices";

interface IntakeModalProps {
  open: boolean;
  onClose: () => void;
  initialItem?: WarehouseItemDTO | null;
  purchaseRequestId?: string | null;
  initialName?: string;
  initialSku?: string;
  initialQty?: number;
  initialPrice?: number;
}

export function IntakeModal({
  open,
  onClose,
  initialItem,
  purchaseRequestId,
  initialName = "",
  initialSku = "",
  initialQty = 1,
  initialPrice = 0,
}: IntakeModalProps) {
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [name, setName] = useState("");
  const [sku, setSku] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [batchNumber, setBatchNumber] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [retailPrice, setRetailPrice] = useState("");
  const [recordFinanceExpense, setRecordFinanceExpense] = useState(false);
  const [cashAccountId, setCashAccountId] = useState("");

  const { data: items = [] } = useWarehouseItems();
  const { data: accounts = [] } = useAccounts();
  const intakeMutation = useIntakeWarehouseBatch();
  const updatePurchaseMutation = useUpdatePurchaseRequest();

  useEffect(() => {
    if (open) {
      if (initialItem) {
        setSelectedItemId(initialItem.id);
        setName(initialItem.name);
        setSku(initialItem.sku);
        setRetailPrice(initialItem.retailPrice ? String(initialItem.retailPrice) : "");
        setPurchasePrice(initialItem.costPrice ? String(initialItem.costPrice) : "");
      } else {
        setSelectedItemId("");
        setName(initialName);
        setSku(initialSku);
        setQuantity(String(initialQty || 1));
        setPurchasePrice(initialPrice ? String(initialPrice) : "");
        setRetailPrice("");
      }
      setBatchNumber(`ПХ-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${Math.floor(100 + Math.random() * 900)}`);
      setSupplierName("");
      setRecordFinanceExpense(false);

      if (accounts.length > 0) {
        const def = accounts.find((a) => a.isDefault) ?? accounts[0];
        setCashAccountId(def.id);
      }
    }
  }, [open, initialItem, initialName, initialSku, initialQty, initialPrice, accounts]);

  if (!open) return null;

  const handleItemSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedItemId(val);
    if (val) {
      const it = items.find((i) => i.id === val);
      if (it) {
        setName(it.name);
        setSku(it.sku);
        if (it.costPrice > 0) setPurchasePrice(String(it.costPrice));
        if (it.retailPrice > 0) setRetailPrice(String(it.retailPrice));
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const qtyNum = parseFloat(quantity);
    const priceNum = parseFloat(purchasePrice);

    if (!trimmedName) {
      toast.error("Укажите наименование товара");
      return;
    }
    if (isNaN(qtyNum) || qtyNum <= 0) {
      toast.error("Количество должно быть больше 0");
      return;
    }
    if (isNaN(priceNum) || priceNum < 0) {
      toast.error("Укажите корректную закупочную цену");
      return;
    }

    try {
      await intakeMutation.mutateAsync({
        item_id: selectedItemId || undefined,
        name: trimmedName,
        sku: sku.trim() || undefined,
        batch_number: batchNumber.trim() || undefined,
        supplier_name: supplierName.trim() || undefined,
        quantity: qtyNum,
        purchase_price: priceNum,
        retail_price: retailPrice ? parseFloat(retailPrice) : undefined,
        record_finance_expense: recordFinanceExpense,
        cash_account_id: recordFinanceExpense ? cashAccountId || undefined : undefined,
      });

      // Если оприходование было связано с заявкой на закупку, помечаем её как поступившую
      if (purchaseRequestId) {
        try {
          await updatePurchaseMutation.mutateAsync({
            id: purchaseRequestId,
            payload: { status: "received", comment: `Оприходовано на склад (партия ${batchNumber})` },
          });
        } catch {
          // Silent catch
        }
      }

      toast.success(
        `Партия «${trimmedName}» (${qtyNum} шт.) оприходована на склад${
          recordFinanceExpense ? " с проводкой расхода в ДДС" : ""
        }`,
      );
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при оприходовании партии");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 border border-emerald-200">
              <ArrowDownToLine className="h-4 w-4 text-emerald-700" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">Оприходование партии на склад</h2>
              <p className="text-xs text-[#666666]">Поступление номенклатуры и фиксация закупочной цены</p>
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
              Позиция из номенклатуры
            </label>
            <select
              value={selectedItemId}
              onChange={handleItemSelect}
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            >
              <option value="">— Создать новую позицию или ввести вручную —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name} (арт: {i.sku}, остаток: {i.availableStock} {i.unit})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Наименование <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Наименование детали"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Артикул / SKU
              </label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="SKU..."
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Номер накладной / партии
              </label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="ПХ-..."
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Поставщик
              </label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="ООО Поставщик"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Кол-во <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min={0.01}
                step={1}
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Закупка (₽/ед) <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min={0}
                required
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="0"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Розница (₽/ед)
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

          {/* Интеграция с ДДС Финансов */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={recordFinanceExpense}
                onChange={(e) => setRecordFinanceExpense(e.target.checked)}
                className="h-4 w-4 rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
              />
              <span className="text-xs font-medium text-[#111111] flex items-center gap-1.5">
                <Receipt className="h-3.5 w-3.5 text-[#4a38f5]" />
                Списать расход в кассу ДДС (Модуль «Финансы»)
              </span>
            </label>

            {recordFinanceExpense && (
              <div className="pl-6 space-y-2 pt-1 border-t border-[#f0f0f0]">
                <div className="text-[11px] text-[#666666]">
                  Сумма списания:{" "}
                  <b className="font-mono text-[#111111]">
                    {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(
                      (parseFloat(quantity) || 0) * (parseFloat(purchasePrice) || 0),
                    )}
                  </b>{" "}
                  по статье «Закупка запчастей и комплектующих».
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[#666666] mb-1 flex items-center gap-1">
                    <CreditCard className="h-3 w-3" /> Расчетный счет / касса списания
                  </label>
                  <select
                    value={cashAccountId}
                    onChange={(e) => setCashAccountId(e.target.value)}
                    className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111]"
                  >
                    {accounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.currency})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center justify-end gap-2.5 pt-3 border-t border-[#e5e5e5]">
            <button
              type="button"
              onClick={onClose}
              disabled={intakeMutation.isPending}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#666666] hover:bg-[#fafafa] transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={intakeMutation.isPending}
              className="h-8 rounded-[8px] bg-[#4a38f5] px-3.5 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              {intakeMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Приёмка...
                </>
              ) : (
                "Оприходовать партию"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
