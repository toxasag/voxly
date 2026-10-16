"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  X,
  Wrench,
  User,
  Camera,
  Image,
  Loader2,
  Package,
  ListChecks,
  Banknote,
  FileText,
} from "lucide-react";
import {
  createRepairSchema,
  type CreateRepairPayload,
} from "@/schemas/repair.schema";
import {
  MOCK_CUSTOMERS_FOR_REPAIR,
  MOCK_EQUIPMENT_TYPES,
  MOCK_MASTERS,
} from "@/lib/repairs/mock-repairs";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

interface CreateRepairModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateRepairPayload, photos: File[]) => void;
}

export function CreateRepairModal({ open, onClose, onSubmit }: CreateRepairModalProps) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<CreateRepairPayload>({
    resolver: zodResolver(createRepairSchema),
    defaultValues: {
      customer_id: "",
      equipment_type: "",
      equipment_brand: "",
      equipment_model: "",
      equipment_serial: "",
      defect_description: "",
      estimated_cost: 0,
      master_id: "",
      notes: "",
    },
    mode: "onChange",
  });

  const handleSubmit = useCallback(
    (values: CreateRepairPayload) => {
      onSubmit(values, photos);
      form.reset();
      setPhotos([]);
      setPhotoPreviews([]);
      onClose();
    },
    [onSubmit, form, photos, onClose],
  );

  const handlePhotosAdd = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    setPhotos((prev) => [...prev, ...files]);
    files.forEach((file) => {
      const url = URL.createObjectURL(file);
      setPhotoPreviews((prev) => [...prev, url]);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleRemovePhoto = useCallback((index: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoPreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose });

  useEffect(() => {
    if (open) {
      form.reset();
      setPhotos([]);
      photoPreviews.forEach((url) => URL.revokeObjectURL(url));
      setPhotoPreviews([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);


  if (!open) return null;

  const { errors, isValid } = form.formState;
  const budgetValue = form.watch("estimated_cost");

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-500/10">
              <Wrench className="h-4 w-4 text-sky-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Приёмка оборудования</h2>
              <p className="text-xs text-slate-500">Оформление нового наряд-заказа</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={form.handleSubmit(handleSubmit)} className="p-6 space-y-5">
          {/* Customer */}
          <div className="space-y-2">
            <label className="block text-xs font-medium text-slate-400">
              Клиент
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <select
                value={form.watch("customer_id")}
                onChange={(e) =>
                  form.setValue("customer_id", e.target.value, { shouldValidate: true })
                }
                className={cn(
                  "w-full rounded-lg border bg-slate-950 py-2.5 pl-10 pr-4 text-sm text-slate-100 appearance-none transition-colors",
                  "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                  errors.customer_id ? "border-rose-500" : "border-slate-700",
                )}
              >
                <option value="" disabled>
                  Выберите клиента...
                </option>
                {MOCK_CUSTOMERS_FOR_REPAIR.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.phone}
                  </option>
                ))}
              </select>
            </div>
            {errors.customer_id && (
              <p className="text-xs text-rose-400">{errors.customer_id.message}</p>
            )}
          </div>

          {/* Equipment Parameters */}
          <fieldset className="space-y-4">
            <legend className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-2">
              <Package className="h-3.5 w-3.5 text-slate-500" />
              Параметры оборудования
            </legend>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs text-slate-500">Тип</label>
                <select
                  value={form.watch("equipment_type")}
                  onChange={(e) =>
                    form.setValue("equipment_type", e.target.value, { shouldValidate: true })
                  }
                  className={cn(
                    "w-full rounded-lg border bg-slate-950 py-2 px-3 text-sm text-slate-100 appearance-none transition-colors",
                    "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                    errors.equipment_type ? "border-rose-500" : "border-slate-700",
                  )}
                >
                  <option value="" disabled>
                    Выберите тип...
                  </option>
                  {MOCK_EQUIPMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                {errors.equipment_type && (
                  <p className="text-xs text-rose-400">{errors.equipment_type.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs text-slate-500">Бренд</label>
                <input
                  type="text"
                  placeholder="Samsung, Apple, Sony..."
                  value={form.watch("equipment_brand")}
                  onChange={(e) =>
                    form.setValue("equipment_brand", e.target.value, { shouldValidate: true })
                  }
                  className={cn(
                    "w-full rounded-lg border bg-slate-950 py-2 px-3 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                    "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                    errors.equipment_brand ? "border-rose-500" : "border-slate-700",
                  )}
                />
                {errors.equipment_brand && (
                  <p className="text-xs text-rose-400">{errors.equipment_brand.message}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs text-slate-500">Модель</label>
                <input
                  type="text"
                  placeholder="Galaxy S24 Ultra"
                  value={form.watch("equipment_model")}
                  onChange={(e) =>
                    form.setValue("equipment_model", e.target.value, { shouldValidate: true })
                  }
                  className={cn(
                    "w-full rounded-lg border bg-slate-950 py-2 px-3 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                    "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                    errors.equipment_model ? "border-rose-500" : "border-slate-700",
                  )}
                />
                {errors.equipment_model && (
                  <p className="text-xs text-rose-400">{errors.equipment_model.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs text-slate-500">Серийный номер</label>
                <input
                  type="text"
                  placeholder="R58N90L2AX"
                  value={form.watch("equipment_serial")}
                  onChange={(e) =>
                    form.setValue("equipment_serial", e.target.value, { shouldValidate: true })
                  }
                  className={cn(
                    "w-full rounded-lg border bg-slate-950 py-2 px-3 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                    "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                    errors.equipment_serial ? "border-rose-500" : "border-slate-700",
                  )}
                />
                {errors.equipment_serial && (
                  <p className="text-xs text-rose-400">{errors.equipment_serial.message}</p>
                )}
              </div>
            </div>
          </fieldset>

          {/* Defect Description */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <ListChecks className="h-3.5 w-3.5 text-slate-500" />
              Описание неисправности
            </label>
            <textarea
              rows={3}
              placeholder="Подробно опишите неисправность..."
              value={form.watch("defect_description")}
              onChange={(e) =>
                form.setValue("defect_description", e.target.value, { shouldValidate: true })
              }
              className={cn(
                "w-full rounded-lg border bg-slate-950 py-2.5 px-3.5 text-sm text-slate-100 placeholder:text-slate-500 resize-none transition-colors",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                errors.defect_description ? "border-rose-500" : "border-slate-700",
              )}
            />
            {errors.defect_description && (
              <p className="text-xs text-rose-400">{errors.defect_description.message}</p>
            )}
            <p className="text-xs text-slate-600">
              {form.watch("defect_description").length}/2000
            </p>
          </div>

          {/* Photos */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs font-medium text-slate-400">
              <Camera className="h-3.5 w-3.5 text-slate-500" />
              Фото неисправности
            </label>
            <div className="flex flex-wrap gap-2">
              {photoPreviews.map((url, idx) => (
                <div key={url} className="relative group">
                  <img
                    src={url}
                    alt={`Фото неисправности ${idx + 1}`}
                    className="h-20 w-20 object-cover rounded-lg border border-slate-700"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemovePhoto(idx)}
                    className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-slate-700 bg-slate-950 hover:border-slate-600 hover:bg-slate-800/50 transition-colors"
              >
                <Image className="h-5 w-5 text-slate-600" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handlePhotosAdd}
              />
            </div>
          </div>

          {/* Cost + Master */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                <Banknote className="h-3 w-3" />
                Предварительная стоимость (RUB)
              </label>
              <input
                type="number"
                min={0}
                placeholder="0"
                value={budgetValue === 0 ? "" : budgetValue}
                onChange={(e) =>
                  form.setValue(
                    "estimated_cost",
                    e.target.value === "" ? 0 : Number(e.target.value),
                    { shouldValidate: true },
                  )
                }
                className={cn(
                  "w-full rounded-lg border bg-slate-950 py-2 px-3 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                  "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                  "[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                  errors.estimated_cost ? "border-rose-500" : "border-slate-700",
                )}
              />
              {errors.estimated_cost && (
                <p className="text-xs text-rose-400">{errors.estimated_cost.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs text-slate-500">Назначенный мастер</label>
              <select
                value={form.watch("master_id")}
                onChange={(e) =>
                  form.setValue("master_id", e.target.value, { shouldValidate: true })
                }
                className={cn(
                  "w-full rounded-lg border bg-slate-950 py-2 px-3 text-sm text-slate-100 appearance-none transition-colors",
                  "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                  errors.master_id ? "border-rose-500" : "border-slate-700",
                )}
              >
                <option value="" disabled>
                  Выберите мастера...
                </option>
                {MOCK_MASTERS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              {errors.master_id && (
                <p className="text-xs text-rose-400">{errors.master_id.message}</p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <FileText className="h-3 w-3" />
              Внутренние примечания (необязательно)
            </label>
            <textarea
              rows={2}
              placeholder="Дополнительные примечания для мастера..."
              value={form.watch("notes") ?? ""}
              onChange={(e) =>
                form.setValue("notes", e.target.value, { shouldValidate: true })
              }
              className={cn(
                "w-full rounded-lg border bg-slate-950 py-2 px-3 text-sm text-slate-100 placeholder:text-slate-500 resize-none transition-colors",
                "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                "border-slate-700",
              )}
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className={cn(
                "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors",
                "bg-sky-600 text-white hover:bg-sky-500",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {form.formState.isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Создаём...
                </>
              ) : (
                "Оформить ремонт"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}