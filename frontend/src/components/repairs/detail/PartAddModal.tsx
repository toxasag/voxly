"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { X, PackagePlus, Loader2, Check, Warehouse, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import { useCreatePart } from "@/lib/api/use-repairs";

export interface PartAddModalProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  initialName?: string;
  initialArticle?: string;
  onSuccess?: () => void;
}

export function PartAddModal({
  open,
  onClose,
  orderId,
  initialName = "",
  initialArticle = "",
  onSuccess,
}: PartAddModalProps) {
  useOverlay(open, { onEscape: onClose });

  const [name, setName] = useState(initialName);
  const [article, setArticle] = useState(initialArticle);
  const [quantity, setQuantity] = useState("1");
  const [retailPrice, setRetailPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [saveToCatalog, setSaveToCatalog] = useState(true);
  const [addToPurchaseRequest, setAddToPurchaseRequest] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  const createPartMutation = useCreatePart();

  // Reset or initialize on open
  useEffect(() => {
    if (open) {
      setName(initialName || "");
      setArticle(initialArticle || "");
      setQuantity("1");
      setRetailPrice("");
      setCostPrice("");
      setSaveToCatalog(true);
      setAddToPurchaseRequest(false);
      setErrorMsg(null);
      // Autofocus
      setTimeout(() => {
        nameInputRef.current?.focus();
      }, 50);
    }
  }, [open, initialName, initialArticle]);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      const trimmedName = name.trim();
      if (!trimmedName) {
        setErrorMsg("Укажите наименование запчасти");
        nameInputRef.current?.focus();
        return;
      }

      const qtyNum = parseInt(quantity, 10);
      if (isNaN(qtyNum) || qtyNum < 1) {
        setErrorMsg("Количество должно быть не менее 1");
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
        await createPartMutation.mutateAsync({
          orderId,
          payload: {
            name: trimmedName,
            article: article.trim() || "Б/А",
            quantity: qtyNum,
            retail_price: retailNum,
            cost_price: costNum,
            save_to_catalog: saveToCatalog,
            add_to_purchase_request: addToPurchaseRequest,
          },
        });

        toast.success(
          `Запчасть «${trimmedName}» добавлена${
            saveToCatalog ? " и сохранена в номенклатуру" : ""
          }${addToPurchaseRequest ? " + создана заявка на закупку" : ""}`,
        );

        onSuccess?.();
        onClose();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Не удалось добавить запчасть";
        setErrorMsg(message);
        toast.error(message);
      }
    },
    [
      name,
      article,
      quantity,
      retailPrice,
      costPrice,
      saveToCatalog,
      addToPurchaseRequest,
      orderId,
      createPartMutation,
      onSuccess,
      onClose,
    ],
  );

  if (!open) return null;

  const isPending = createPartMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="part-add-modal-title"
    >
      <div
        className="w-full max-w-md rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-4 bg-[#fafafa]">
          <div className="flex items-center gap-2.5">
            <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-1.5 shadow-2xs">
              <PackagePlus className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <div>
              <h2 id="part-add-modal-title" className="text-sm font-semibold text-[#111111]">
                Добавить запчасть
              </h2>
              <p className="text-[11px] text-[#666666]">
                Добавление детали в наряд и складской каталог
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors cursor-pointer"
            title="Закрыть"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {errorMsg && (
            <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
              {errorMsg}
            </div>
          )}

          {/* Наименование */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider block">
              Наименование запчасти <span className="text-rose-500">*</span>
            </label>
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Кнопка выключателя DCCN40"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              disabled={isPending}
            />
          </div>

          {/* Артикул / SKU */}
          <div className="space-y-1">
            <label className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider block">
              Артикул / SKU
            </label>
            <input
              type="text"
              value={article}
              onChange={(e) => setArticle(e.target.value)}
              placeholder="DCCN40-BTN или Б/А"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              disabled={isPending}
            />
          </div>

          {/* Количество и цены в ряд */}
          <div className="grid grid-cols-3 gap-3">
            {/* Количество */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider block">
                Кол-во <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="1"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-center font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                disabled={isPending}
              />
            </div>

            {/* Розничная цена */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider block">
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

            {/* Закупочная цена */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider block">
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

          {/* Опции: сохранение в номенклатуру и заявка на закупку */}
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
                  Позиция появится в общем справочнике склада и будет доступна для других нарядов
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
                  Автоматически сформирует запись в разделе /warehouse (закупки) под этот наряд
                </p>
              </div>
            </label>
          </div>

          {/* Footer Buttons */}
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
                  Добавить запчасть
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
