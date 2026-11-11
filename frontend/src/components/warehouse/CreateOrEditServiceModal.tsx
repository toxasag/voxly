"use client";

import { useState, useEffect, useCallback } from "react";
import { X, Loader2, Sparkles, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import {
  useCreateService,
  useUpdateService,
  type ServiceItemDTO,
} from "@/lib/api/use-services";

interface CreateOrEditServiceModalProps {
  open: boolean;
  onClose: () => void;
  service?: ServiceItemDTO | null;
}

export function CreateOrEditServiceModal({
  open,
  onClose,
  service,
}: CreateOrEditServiceModalProps) {
  useOverlay(open, { onEscape: onClose });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [unit, setUnit] = useState("усл");
  const [durationMinutes, setDurationMinutes] = useState("");

  const createMutation = useCreateService();
  const updateMutation = useUpdateService();

  const isEditing = Boolean(service);
  const isPending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    if (service) {
      setName(service.name);
      setDescription(service.description ?? "");
      setPrice(service.price !== undefined && service.price !== null ? String(service.price) : "0");
      setUnit(service.unit ?? "усл");
      setDurationMinutes(service.durationMinutes ? String(service.durationMinutes) : "");
    } else {
      setName("");
      setDescription("");
      setPrice("");
      setUnit("усл");
      setDurationMinutes("");
    }
  }, [service, open]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Укажите наименование услуги");
      return;
    }

    const priceNum = parseFloat(price);
    const parsedPrice = !isNaN(priceNum) && priceNum >= 0 ? priceNum : 0;
    const durationNum = parseInt(durationMinutes, 10);
    const parsedDuration = !isNaN(durationNum) && durationNum > 0 ? durationNum : null;

    try {
      if (isEditing && service) {
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
      } else {
        await createMutation.mutateAsync({
          name: trimmedName,
          description: description.trim(),
          price: parsedPrice,
          default_price: parsedPrice,
          unit: unit.trim() || "усл",
          duration_minutes: parsedDuration,
        });
        toast.success(`Услуга «${trimmedName}» добавлена в справочник`);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Произошла ошибка при сохранении услуги");
    }
  }, [name, description, price, unit, durationMinutes, isEditing, service, updateMutation, createMutation, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
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
              <h2 className="text-sm font-semibold text-[#111111]">
                {isEditing ? "Редактирование услуги" : "Новая услуга в справочнике"}
              </h2>
              <p className="text-[11px] text-[#666666]">
                {isEditing
                  ? "Изменение параметров и описания услуги"
                  : "Добавление услуги в каталог для сделок и сервиса"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-[#333333] mb-1.5">
              Наименование услуги <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              placeholder="Например: Замена дисплейного модуля, Диагностика..."
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#333333] mb-1.5">
              Описание услуги
            </label>
            <textarea
              rows={3}
              placeholder="Подробное описание состава работ, условий выполнения, гарантийных обязательств..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 resize-none"
            />
            <p className="text-[11px] text-[#888888] mt-1">
              Отображается в карточке сделки, подсказках и печатных формах
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#333333] mb-1.5">
                Базовая цена, ₽
              </label>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono tabular-nums text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#333333] mb-1.5">
                Ед. измерения
              </label>
              <input
                type="text"
                placeholder="усл, шт, час"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#333333] mb-1.5">
                Длительность (мин)
              </label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="60"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono tabular-nums text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[#f0f0f0]">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={isPending || !name.trim()}
              className="h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEditing ? "Сохранить изменения" : "Добавить услугу"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
