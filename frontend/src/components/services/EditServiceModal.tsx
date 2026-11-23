"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Loader2, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import { useUpdateService, type ServiceItemDTO } from "@/lib/api/use-services";
import { Button } from "@/components/ui/button";

export interface EditServiceModalProps {
  open: boolean;
  onClose: () => void;
  service: ServiceItemDTO | null;
}

export function EditServiceModal({ open, onClose, service }: EditServiceModalProps) {
  useOverlay(open, { onEscape: onClose });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("усл");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  const updateMutation = useUpdateService();

  useEffect(() => {
    if (service && open) {
      setName(service.name);
      setDescription(service.description ?? "");
      setPrice(
        service.price !== undefined && service.price !== null
          ? String(service.price)
          : service.defaultPrice !== undefined && service.defaultPrice !== null
            ? String(service.defaultPrice)
            : "0",
      );
      setUnit(service.unit ?? "усл");
      setDurationMinutes(service.durationMinutes ? String(service.durationMinutes) : "");
      setError(null);

      // Auto-focus first input on open
      setTimeout(() => {
        firstInputRef.current?.focus();
      }, 50);
    }
  }, [service, open]);

  // Focus trap inside the modal
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Tab" && modalRef.current) {
        const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusableElements.length === 0) return;

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement?.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement?.focus();
          }
        }
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!service) return;

      const trimmedName = name.trim();
      if (!trimmedName) {
        setError("Наименование услуги обязательно");
        toast.error("Укажите наименование услуги");
        firstInputRef.current?.focus();
        return;
      }

      const priceNum = parseFloat(price);
      const parsedPrice = !isNaN(priceNum) && priceNum >= 0 ? priceNum : 0;
      const durationNum = parseInt(durationMinutes, 10);
      const parsedDuration = !isNaN(durationNum) && durationNum > 0 ? durationNum : null;

      try {
        await updateMutation.mutateAsync({
          id: service.id,
          payload: {
            name: trimmedName,
            description: description.trim(),
            price: parsedPrice,
            default_price: parsedPrice,
            unit: unit.trim() || "усл",
            duration_minutes: parsedDuration,
          },
        });
        toast.success(`Услуга «${trimmedName}» успешно обновлена`);
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Ошибка при сохранении услуги";
        setError(msg);
        toast.error(msg);
      }
    },
    [service, name, description, price, unit, durationMinutes, updateMutation, onClose],
  );

  if (!open || !service) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-service-modal-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-3.5 bg-[#fafafa]">
          <div className="flex items-center gap-2.5">
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-2xs">
              <BookOpen className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <div>
              <h2 id="edit-service-modal-title" className="text-sm font-semibold text-[#111111]">
                Редактирование услуги
              </h2>
              <p className="text-[11px] text-[#666666]">
                Изменение параметров, базовой цены и описания услуги
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть окно редактирования"
            tabIndex={0}
            className="rounded-[6px] p-1.5 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="rounded-[8px] bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-700">
              {error}
            </div>
          )}

          <div>
            <label htmlFor="service-name" className="block text-xs font-medium text-[#333333] mb-1.5">
              Наименование услуги <span className="text-rose-500">*</span>
            </label>
            <input
              id="service-name"
              ref={firstInputRef}
              type="text"
              required
              tabIndex={0}
              placeholder="Например: Замена разъема питания, Диагностика..."
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          <div>
            <label htmlFor="service-description" className="block text-xs font-medium text-[#333333] mb-1.5">
              Описание услуги
            </label>
            <textarea
              id="service-description"
              rows={3}
              tabIndex={0}
              placeholder="Подробное описание состава работ, условий выполнения, гарантии..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 resize-none"
            />
            <p className="text-[11px] text-[#888888] mt-1">
              Отображается в счетах, нарядах на ремонт и печатных актах
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="service-price" className="block text-xs font-medium text-[#333333] mb-1.5">
                Цена, ₽
              </label>
              <input
                id="service-price"
                type="number"
                min="0"
                step="any"
                tabIndex={0}
                placeholder="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono tabular-nums text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div>
              <label htmlFor="service-unit" className="block text-xs font-medium text-[#333333] mb-1.5">
                Ед. измерения
              </label>
              <input
                id="service-unit"
                type="text"
                tabIndex={0}
                placeholder="усл, шт, час"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div>
              <label htmlFor="service-duration" className="block text-xs font-medium text-[#333333] mb-1.5">
                Длительность (мин)
              </label>
              <input
                id="service-duration"
                type="number"
                min="0"
                step="1"
                tabIndex={0}
                placeholder="60"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono tabular-nums text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#f0f0f0]">
            <Button
              type="button"
              variant="outline"
              size="default"
              tabIndex={0}
              onClick={onClose}
              disabled={updateMutation.isPending}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              variant="default"
              size="default"
              tabIndex={0}
              disabled={updateMutation.isPending || !name.trim()}
              className="min-w-[100px]"
            >
              {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Сохранить
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
