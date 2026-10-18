"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Wrench,
  User,
  Search,
  Package,
  FileText,
  Loader2,
  Camera,
  Image as ImageIcon,
  Banknote,
  Flag,
  X,
} from "lucide-react";
import { createRepairSchema, type CreateRepairPayload } from "@/schemas/repair.schema";
import { MOCK_CUSTOMERS_FOR_REPAIR, MOCK_EQUIPMENT_TYPES, MOCK_MASTERS } from "@/lib/repairs/mock-repairs";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface RepairIntakeModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (payload: CreateRepairPayload, photos: File[]) => void;
  initialCustomerId?: string;
  isSubmitting?: boolean;
}

export function RepairIntakeModal({
  open,
  onClose,
  onSubmit,
  initialCustomerId,
  isSubmitting = false,
}: RepairIntakeModalProps) {
  const [customerSearch, setCustomerSearch] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);

  const filteredCustomers = useMemo(() => {
    if (!customerSearch) return MOCK_CUSTOMERS_FOR_REPAIR.slice(0, 6);
    const q = customerSearch.toLowerCase();
    return MOCK_CUSTOMERS_FOR_REPAIR.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.includes(q),
    );
  }, [customerSearch]);

  const form = useForm<CreateRepairPayload>({
    resolver: zodResolver(createRepairSchema),
    defaultValues: {
      customer_id: "",
      customer_name: "",
      customer_phone: "",
      equipment_type: "",
      equipment_brand: "",
      equipment_model: "",
      equipment_serial: "",
      package_contents: "Только устройство, оригинальная упаковка",
      appearance: "Видимые следы износа, рабочее состояние",
      defect_description: "",
      defect_photos: [],
      priority: "normal",
      master_id: "",
      master_name: "",
      estimated_cost: 0,
      notes: "",
    },
    mode: "onChange",
  });

  const selectedCustomerId = form.watch("customer_id");
  const selectedMasterId = form.watch("master_id");

  useEffect(() => {
    if (selectedCustomerId) {
      const customer = MOCK_CUSTOMERS_FOR_REPAIR.find((c) => c.id === selectedCustomerId);
      if (customer) {
        form.setValue("customer_name", customer.name, { shouldValidate: true });
        form.setValue("customer_phone", customer.phone, { shouldValidate: true });
      }
    }
  }, [selectedCustomerId, form]);

  useEffect(() => {
    if (selectedMasterId) {
      const master = MOCK_MASTERS.find((m) => m.id === selectedMasterId);
      if (master) {
        form.setValue("master_name", master.name, { shouldValidate: true });
      }
    }
  }, [selectedMasterId, form]);

  const handleSubmit = useCallback(
    (v: CreateRepairPayload) => {
      onSubmit({ ...v, defect_photos: photoPreviews }, photos);
      form.reset();
      setPhotos([]);
      setPhotoPreviews([]);
      setCustomerSearch("");
      onClose();
    },
    [onSubmit, form, photos, photoPreviews, onClose],
  );

  const handlePhotosAdd = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    setPhotos((prev) => [...prev, ...files]);
    files.forEach((f) => setPhotoPreviews((prev) => [...prev, URL.createObjectURL(f)]));
  }, []);

  const handleRemovePhoto = useCallback((idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setPhotoPreviews((prev) => {
      URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  useEffect(() => {
    if (open) {
      form.reset();
      setPhotos([]);
      setPhotoPreviews([]);
      setCustomerSearch("");
      if (initialCustomerId) {
        form.setValue("customer_id", initialCustomerId, { shouldValidate: true });
      }
    }
  }, [open, form, initialCustomerId]);

  if (!open) return null;
  const { errors, isValid } = form.formState;

  return (
    <Sheet open={open} onClose={onClose} width="w-[640px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10">
            <Wrench className="h-4 w-4 text-[#4a38f5]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Приёмка оборудования</h2>
            <p className="text-xs text-[#666666]">Оформить ремонт и напечатать квитанцию</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(handleSubmit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Customer with autocomplete */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <User className="h-3 w-3 text-slate-400" /> Клиент *
              </label>
              {!selectedCustomerId ? (
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    autoFocus
                    placeholder="Поиск по имени или телефону..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 pl-10 pr-4 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                  />
                  <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border border-[#e5e5e5] bg-white shadow-xl z-10 max-h-48 overflow-y-auto">
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          form.setValue("customer_id", c.id, { shouldValidate: true });
                          setCustomerSearch("");
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                      >
                        <span className="font-medium text-[#111111]">{c.name}</span>
                        <span className="text-xs text-slate-500">{c.phone}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-[#4a38f5]/30 bg-[#4a38f5]/5 px-4 py-2.5">
                  <span className="text-sm font-medium text-[#111111]">
                    {form.watch("customer_name") ||
                      MOCK_CUSTOMERS_FOR_REPAIR.find((c) => c.id === selectedCustomerId)?.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      form.setValue("customer_id", "");
                      form.setValue("customer_name", "");
                      form.setValue("customer_phone", "");
                    }}
                    className="text-xs text-[#4a38f5] hover:underline cursor-pointer"
                  >
                    Изменить
                  </button>
                </div>
              )}
              {errors.customer_id && (
                <p className="text-xs text-rose-500">{errors.customer_id.message}</p>
              )}
              {errors.customer_name && (
                <p className="text-xs text-rose-500">{errors.customer_name.message}</p>
              )}
              {errors.customer_phone && (
                <p className="text-xs text-rose-500">{errors.customer_phone.message}</p>
              )}
            </div>

            {/* Equipment */}
            <fieldset className="space-y-3 rounded-lg border border-[#e5e5e5] p-4 bg-slate-50/50">
              <legend className="flex items-center gap-1.5 text-xs font-medium text-slate-700 px-1">
                <Package className="h-3 w-3 text-slate-400" /> Оборудование
              </legend>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-600">Тип *</label>
                  <select
                    value={form.watch("equipment_type")}
                    onChange={(e) =>
                      form.setValue("equipment_type", e.target.value, { shouldValidate: true })
                    }
                    className={cn(
                      "w-full rounded-lg border bg-white py-2 px-3 text-sm text-[#111111] appearance-none focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                      errors.equipment_type ? "border-rose-500" : "border-[#e5e5e5]",
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
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-600">Бренд *</label>
                  <input
                    type="text"
                    placeholder="Samsung"
                    value={form.watch("equipment_brand")}
                    onChange={(e) =>
                      form.setValue("equipment_brand", e.target.value, { shouldValidate: true })
                    }
                    className={cn(
                      "w-full rounded-lg border bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                      errors.equipment_brand ? "border-rose-500" : "border-[#e5e5e5]",
                    )}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-600">Модель *</label>
                  <input
                    type="text"
                    placeholder="Galaxy S24 Ultra"
                    value={form.watch("equipment_model")}
                    onChange={(e) =>
                      form.setValue("equipment_model", e.target.value, { shouldValidate: true })
                    }
                    className={cn(
                      "w-full rounded-lg border bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                      errors.equipment_model ? "border-rose-500" : "border-[#e5e5e5]",
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-600">Серийный номер</label>
                  <input
                    type="text"
                    placeholder="R58N90L2AX"
                    value={form.watch("equipment_serial")}
                    onChange={(e) =>
                      form.setValue("equipment_serial", e.target.value, { shouldValidate: true })
                    }
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-600">Комплектация</label>
                  <input
                    type="text"
                    value={form.watch("package_contents")}
                    onChange={(e) => form.setValue("package_contents", e.target.value)}
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-600">Внешний вид</label>
                  <input
                    type="text"
                    value={form.watch("appearance")}
                    onChange={(e) => form.setValue("appearance", e.target.value)}
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                  />
                </div>
              </div>
            </fieldset>

            {/* Defect */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <FileText className="h-3 w-3 text-slate-400" /> Описание неисправности *
              </label>
              <textarea
                rows={3}
                placeholder="Опишите неисправность..."
                value={form.watch("defect_description")}
                onChange={(e) =>
                  form.setValue("defect_description", e.target.value, { shouldValidate: true })
                }
                className={cn(
                  "w-full rounded-lg border bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 resize-none focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                  errors.defect_description ? "border-rose-500" : "border-[#e5e5e5]",
                )}
              />
              {errors.defect_description && (
                <p className="text-xs text-rose-500">{errors.defect_description.message}</p>
              )}
            </div>

            {/* Photos */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                <Camera className="h-3 w-3 text-slate-400" /> Фотографии
              </label>
              <div className="flex flex-wrap gap-2">
                {photoPreviews.map((url, i) => (
                  <div key={url} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt="Фото дефекта"
                      className="h-16 w-16 object-cover rounded-lg border border-[#e5e5e5]"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemovePhoto(i)}
                      className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => document.getElementById("intake-photo")?.click()}
                  className="flex h-16 w-16 items-center justify-center rounded-lg border border-dashed border-[#e5e5e5] bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <ImageIcon className="h-5 w-5 text-slate-400" />
                </button>
                <input
                  id="intake-photo"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handlePhotosAdd}
                />
              </div>
            </div>

            {/* Cost + Priority + Master */}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Banknote className="h-3 w-3 text-slate-400" /> Предв. стоимость (RUB)
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
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Flag className="h-3 w-3 text-slate-400" /> Приоритет
                </label>
                <select
                  value={form.watch("priority")}
                  onChange={(e) =>
                    form.setValue("priority", e.target.value as CreateRepairPayload["priority"], {
                      shouldValidate: true,
                    })
                  }
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] appearance-none focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                >
                  <option value="low">Низкий</option>
                  <option value="normal">Обычный</option>
                  <option value="high">Высокий</option>
                  <option value="urgent">Срочный</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <User className="h-3 w-3 text-slate-400" /> Мастер *
                </label>
                <select
                  value={form.watch("master_id")}
                  onChange={(e) =>
                    form.setValue("master_id", e.target.value, { shouldValidate: true })
                  }
                  className={cn(
                    "w-full rounded-lg border bg-white py-2 px-3 text-sm text-[#111111] appearance-none focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
                    errors.master_id ? "border-rose-500" : "border-[#e5e5e5]",
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
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-600">Примечания</label>
              <textarea
                rows={2}
                placeholder="Дополнительные пожелания клиента..."
                value={form.watch("notes")}
                onChange={(e) => form.setValue("notes", e.target.value)}
                className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 resize-none focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

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
              disabled={!isValid || isSubmitting}
              className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3b2be0] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Создаём...
                </>
              ) : (
                "Оформить и напечатать квитанцию"
              )}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
