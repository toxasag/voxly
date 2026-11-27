"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, PackagePlus, Loader2, Check, Warehouse, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import { useAddDealItem } from "@/lib/api/use-deals";

export interface DealProductAddModalProps {
  open: boolean;
  onClose: () => void;
  dealId: string;
  initialName?: string;
  initialSku?: string;
  onSuccess?: () => void;
}

export function DealProductAddModal({
  open,
  onClose,
  dealId,
  initialName = "",
  initialSku = "",
  onSuccess,
}: DealProductAddModalProps) {
  useOverlay(open, { onEscape: onClose });

  const [name, setName] = useState(initialName);
  const [sku, setSku] = useState(initialSku);
  const [quantity, setQuantity] = useState("1");
  const [retailPrice, setRetailPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [saveToCatalog, setSaveToCatalog] = useState(true);
  const [addToPurchaseRequest, setAddToPurchaseRequest] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);
  const addDealItemMutation = useAddDealItem(dealId);

  useEffect(() => {
    if (open) {
      setName(initialName || "");
      setSku(initialSku || "");
      setQuantity("1");
      setRetailPrice("");
      setCostPrice("");
      setSaveToCatalog(true);
      setAddToPurchaseRequest(false);
      setErrorMsg(null);
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
    }
  }, [open, initialName, initialSku]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      const trimmedName = name.trim();
      if (!trimmedName) {
        setErrorMsg("Укажите наименование товара");
        nameInputRef.current?.focus();
        return;
      }

      const qtyNum = parseFloat(quantity);
      if (isNaN(qtyNum) || qtyNum <= 0) {
        setErrorMsg("Количество должно быть больше 0");
        return;
      }

      const retailNum = retailPrice.trim() ? parseFloat(retailPrice) : 0;
      if (isNaN(retailNum) || retailNum < 0) {
        setErrorMsg("Цена продажи не может быть отрицательной");
        return;
      }

      const costNum = costPrice.trim() ? parseFloat(costPrice) : 0;
      if (isNaN(costNum) || costNum < 0) {
        setErrorMsg("Себестоимость не может быть отрицательной");
        return;
      }

      setErrorMsg(null);

      try {
        await addDealItemMutation.mutateAsync({
          item_type: "product",
          item_id: null,
          name: trimmedName,
          sku: sku.trim() || "Б/А",
          quantity: qtyNum,
          price: retailNum,
          cost_price: costNum,
          unit: "шт",
          save_to_catalog: saveToCatalog,
          add_to_purchase_request: addToPurchaseRequest,
        });

        toast.success(
          `Товар «${trimmedName}» добавлен${
            saveToCatalog ? " и сохранён в номенклатуру склада" : ""
          }${addToPurchaseRequest ? " + создана заявка на закупку" : ""}`,
        );

        onSuccess?.();
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Не удалось добавить товар";
        setErrorMsg(message);
        toast.error(message);
      }
    },
    [
      name,
      sku,
      quantity,
      retailPrice,
      costPrice,
      saveToCatalog,
      addToPurchaseRequest,
      addDealItemMutation,
      onSuccess,
      onClose,
    ],
  );

  if (!open) return null;

  const isPending = addDealItemMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[1px] p-4"
      onClick={() => {
        if (!isPending) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-[12px] border border-[#e5e5e5] bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#4a38f5]/10 text-[#4a38f5]">
              <PackagePlus className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">Добавить товар</h3>
              <p className="text-[11px] text-[#666666]">
                Новый товар в сделку и номенклатуру склада
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            aria-label="Закрыть"
            className="rounded-[6px] p-1 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#111111] mb-1">
              Наименование <span className="text-rose-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Плата питания 12В"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              disabled={isPending}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Артикул (SKU)
              </label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Б/А"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                disabled={isPending}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Количество
              </label>
              <input
                type="number"
                min={0.01}
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-center font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Розница (₽)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={retailPrice}
                onChange={(e) => setRetailPrice(e.target.value)}
                placeholder="0"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-right font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                disabled={isPending}
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Закупка (₽)
              </label>
              <input
                type="number"
                min={0}
                step={1}
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-right font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                disabled={isPending}
              />
            </div>
          </div>

          <div className="pt-2 border-t border-[#f0f0f0] space-y-2.5">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs select-none">
              <input
                type="checkbox"
                checked={saveToCatalog}
                onChange={(e) => setSaveToCatalog(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                disabled={isPending}
              />
              <div>
                <span className="font-medium text-[#111111] flex items-center gap-1.5">
                  <Warehouse className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Сохранить в номенклатуру склада
                </span>
                <p className="text-[11px] text-[#666666] mt-0.5">
                  Позиция появится в общем справочнике склада и будет доступна для сделок и нарядов
                </p>
              </div>
            </label>

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
                <p className="text-[11px] text-[#666666] mt-0.5">
                  Автоматически сформирует заявку в разделе закупок склада под эту сделку
                </p>
              </div>
            </label>
          </div>

          <div className="pt-3 border-t border-[#e5e5e5] flex items-center justify-end gap-2 -mx-5 -mb-5 px-5 py-3.5 bg-[#fafafa]">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isPending || !name.trim()}
              className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Добавить товар
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
