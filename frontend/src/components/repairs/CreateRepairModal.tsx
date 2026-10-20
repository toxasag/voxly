"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Wrench,
  User,
  Camera,
  Image as ImageIcon,
  Loader2,
  Package,
  Banknote,
  FileText,
  X,
} from "lucide-react";
import {
  createRepairSchema,
  type CreateRepairPayload,
} from "@/schemas/repair.schema";
import { MOCK_EQUIPMENT_TYPES } from "@/lib/repairs/mock-repairs";
import { useContacts } from "@/lib/api/use-contacts";
import { useTeamMembers } from "@/lib/api/use-team";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface CreateRepairModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateRepairPayload, photos: File[]) => void;
}

export function CreateRepairModal({ open, onClose, onSubmit }: CreateRepairModalProps) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const contactsQuery = useContacts({ limit: 50 });
  const teamQuery = useTeamMembers();

  const contacts = contactsQuery.data?.items ?? [];
  const teamMembers = teamQuery.data?.members ?? [];

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

  return (
    <Sheet open={open} onClose={onClose} width="w-[620px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10">
            <Wrench className="h-4 w-4 text-[#4a38f5]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Приёмка оборудования</h2>
            <p className="text-xs text-[#666666]">Оформление нового наряд-заказа</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Customer */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">
                Клиент *
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <select
                  value={form.watch("customer_id")}
                  onChange={(e) =>
                    form.setValue("customer_id", e.target.value, { shouldValidate: true })
                  }
                  className={cn(
                    "w-full rounded-lg border border-[#e5e5e5] bg-white py-2.5 pl-10 pr-4 text-sm text-[#111111] appearance-none transition-colors",
                    "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                    errors.customer_id && "border-rose-500",
                  )}
                >
                  <option value="" disabled>
                    {contactsQuery.isLoading ? "Загрузка клиентов..." : "Выберите клиента..."}
                  </option>
                  {contacts.map((c) => {
                    const name = [c.firstName, c.lastName].filter(Boolean).join(" ") || "Без имени";
                    return (
                      <option key={c.id} value={c.id}>
                        {name} — {c.phone}
                      </option>
                    );
                  })}
                </select>
              </div>
              {errors.customer_id && (
                <p className="text-xs text-rose-500">{errors.customer_id.message}</p>
              )}
            </div>

            {/* Equipment Parameters */}
            <fieldset className="space-y-3 rounded-lg border border-[#e5e5e5] p-4 bg-slate-50/50">
              <legend className="flex items-center gap-2 text-xs font-medium text-slate-700 px-1">
                <Package className="h-3.5 w-3.5 text-slate-400" />
                Параметры оборудования
              </legend>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs text-slate-600">Тип *</label>
                  <select
                    value={form.watch("equipment_type")}
                    onChange={(e) =>
                      form.setValue("equipment_type", e.target.value, { shouldValidate: true })
                    }
                    className={cn(
                      "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] appearance-none transition-colors",
                      "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                      errors.equipment_type && "border-rose-500",
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
                    <p className="text-xs text-rose-500">{errors.equipment_type.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs text-slate-600">Бренд *</label>
                  <input
                    type="text"
                    placeholder="Samsung"
                    value={form.watch("equipment_brand")}
                    onChange={(e) =>
                      form.setValue("equipment_brand", e.target.value, { shouldValidate: true })
                    }
                    className={cn(
                      "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 transition-colors",
                      "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                      errors.equipment_brand && "border-rose-500",
                    )}
                  />
                  {errors.equipment_brand && (
                    <p className="text-xs text-rose-500">{errors.equipment_brand.message}</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block text-xs text-slate-600">Модель *</label>
                  <input
                    type="text"
                    placeholder="Galaxy S24 Ultra"
                    value={form.watch("equipment_model")}
                    onChange={(e) =>
                      form.setValue("equipment_model", e.target.value, { shouldValidate: true })
                    }
                    className={cn(
                      "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 transition-colors",
                      "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                      errors.equipment_model && "border-rose-500",
                    )}
                  />
                  {errors.equipment_model && (
                    <p className="text-xs text-rose-500">{errors.equipment_model.message}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs text-slate-600">Серийный номер</label>
                  <input
                    type="text"
                    placeholder="R58N90L2AX..."
                    value={form.watch("equipment_serial")}
                    onChange={(e) =>
                      form.setValue("equipment_serial", e.target.value, { shouldValidate: true })
                    }
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                  />
                </div>
              </div>
            </fieldset>

            {/* Defect Description */}
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-slate-700">
                Описание неисправности *
              </label>
              <textarea
                rows={3}
                placeholder="Подробно опишите симптомы неисправности со слов клиента..."
                value={form.watch("defect_description")}
                onChange={(e) =>
                  form.setValue("defect_description", e.target.value, { shouldValidate: true })
                }
                className={cn(
                  "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 resize-none transition-colors",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                  errors.defect_description && "border-rose-500",
                )}
              />
              {errors.defect_description && (
                <p className="text-xs text-rose-500">{errors.defect_description.message}</p>
              )}
            </div>

            {/* Photos */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Camera className="h-3.5 w-3.5 text-slate-400" />
                Фото фиксации дефектов
              </label>
              <div className="flex flex-wrap gap-2">
                {photoPreviews.map((preview, index) => (
                  <div key={preview} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={preview}
                      alt="Превью"
                      className="h-16 w-16 rounded-lg object-cover border border-[#e5e5e5]"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(index)}
                      className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-[#e5e5e5] bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <ImageIcon className="h-5 w-5 text-slate-400" />
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

            {/* Budget & Master */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Banknote className="h-3.5 w-3.5 text-slate-400" />
                  Предв. бюджет (RUB)
                </label>
                <input
                  type="number"
                  min={0}
                  value={form.watch("estimated_cost") === 0 ? "" : form.watch("estimated_cost")}
                  onChange={(e) =>
                    form.setValue(
                      "estimated_cost",
                      e.target.value === "" ? 0 : Number(e.target.value),
                      { shouldValidate: true },
                    )
                  }
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <User className="h-3.5 w-3.5 text-slate-400" />
                  Мастер *
                </label>
                <select
                  value={form.watch("master_id")}
                  onChange={(e) =>
                    form.setValue("master_id", e.target.value, { shouldValidate: true })
                  }
                  className={cn(
                    "w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] appearance-none transition-colors",
                    "focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                    errors.master_id && "border-rose-500",
                  )}
                >
                  <option value="" disabled>
                    {teamQuery.isLoading ? "Загрузка мастеров..." : "Выберите мастера..."}
                  </option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
                </select>
                {errors.master_id && (
                  <p className="text-xs text-rose-500">{errors.master_id.message}</p>
                )}
              </div>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs text-slate-600">
                <FileText className="h-3 w-3 text-slate-400" />
                Внутренние примечания (необязательно)
              </label>
              <textarea
                rows={2}
                placeholder="Дополнительные примечания для мастера..."
                value={form.watch("notes") ?? ""}
                onChange={(e) =>
                  form.setValue("notes", e.target.value, { shouldValidate: true })
                }
                className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 resize-none transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-[#e5e5e5] bg-white px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!isValid}
              className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3b2be0] disabled:opacity-50 disabled:cursor-not-allowed"
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
      </SheetContent>
    </Sheet>
  );
}