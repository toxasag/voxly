"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Wrench,
  User,
  Package,
  FileText,
  Loader2,
  Camera,
  Image as ImageIcon,
  Banknote,
  Flag,
  X,
  Smartphone,
  Tag,
  Layers,
  Cpu,
  Bug,
  History,
} from "lucide-react";
import { createRepairSchema, type CreateRepairPayload } from "@/schemas/repair.schema";
import { useTeamMembers } from "@/lib/api/use-team";
import {
  useRepairDictionaries,
  useSearchEquipmentBySerial,
} from "@/lib/api/use-repairs";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { RepairClientSection } from "./RepairClientSection";
import { DictionarySelectField } from "./DictionarySelectField";
import { EquipmentRepairHistorySheet } from "./EquipmentRepairHistorySheet";
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
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [isHistorySheetOpen, setIsHistorySheetOpen] = useState(false);

  const teamQuery = useTeamMembers();
  const teamMembers = teamQuery.data?.members ?? [];

  const dictionariesQuery = useRepairDictionaries();
  const dictionaries = dictionariesQuery.data ?? {
    types: [],
    brands: [],
    models: [],
    accessories: [],
    malfunctions: [],
  };

  const form = useForm<CreateRepairPayload>({
    resolver: zodResolver(createRepairSchema),
    defaultValues: {
      deal_id: "",
      customer_id: "",
      customer_name: "",
      customer_phone: "",
      customer_email: "",
      additional_contacts: [],
      company_id: "",
      company_name: "",
      company_inn: "",
      company_ogrn: "",
      company_bik: "",
      company_account_number: "",
      company_legal_address: "",
      equipment_type: "",
      equipment_brand: "",
      equipment_model: "",
      equipment_serial: "",
      package_contents: "",
      package_contents_items: [],
      appearance: "",
      defect_description: "",
      malfunctions: [],
      defect_photos: [],
      priority: "normal",
      master_id: "",
      master_name: "",
      estimated_cost: 0,
      notes: "",
    },
    mode: "onChange",
  });

  const selectedMasterId = form.watch("master_id");

  useEffect(() => {
    if (selectedMasterId) {
      const master = teamMembers.find((m) => m.id === selectedMasterId);
      if (master) {
        form.setValue("master_name", master.fullName, { shouldValidate: true });
      }
    }
  }, [selectedMasterId, teamMembers, form]);

  // Интеллектуальный поиск оборудования по серийному номеру с дебаунсом 300мс
  const serialWatch = form.watch("equipment_serial") ?? "";
  const [debouncedSerial, setDebouncedSerial] = useState(serialWatch);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSerial(serialWatch.trim());
    }, 300);
    return () => clearTimeout(handler);
  }, [serialWatch]);

  const serialSearchQuery = useSearchEquipmentBySerial(debouncedSerial);
  const searchResult = serialSearchQuery.data;

  // Автозаполнение формы при обнаружении оборудования по серийному номеру
  useEffect(() => {
    if (searchResult && searchResult.found && searchResult.equipment) {
      const eq = searchResult.equipment;
      if (eq.type && !form.getValues("equipment_type")) {
        form.setValue("equipment_type", eq.type, { shouldValidate: true, shouldDirty: true });
      }
      if (eq.brand && !form.getValues("equipment_brand")) {
        form.setValue("equipment_brand", eq.brand, { shouldValidate: true, shouldDirty: true });
      }
      if (eq.model && !form.getValues("equipment_model")) {
        form.setValue("equipment_model", eq.model, { shouldValidate: true, shouldDirty: true });
      }
      if (eq.packageContents && eq.packageContents.length > 0) {
        const currentItems = form.getValues("package_contents_items") || [];
        if (currentItems.length === 0) {
          form.setValue("package_contents_items", eq.packageContents, {
            shouldValidate: true,
            shouldDirty: true,
          });
          form.setValue("package_contents", eq.packageContents.join(", "), { shouldDirty: true });
        }
      }

      // Если данные клиента еще не были заполнены
      if (searchResult.customer && !form.getValues("customer_name")) {
        form.setValue("customer_id", searchResult.customer.id, { shouldValidate: true, shouldDirty: true });
        form.setValue("customer_name", searchResult.customer.name, { shouldValidate: true, shouldDirty: true });
        form.setValue("customer_phone", searchResult.customer.phone, { shouldValidate: true, shouldDirty: true });
      }
    }
  }, [searchResult, form]);

  const handleSubmit = useCallback(
    (v: CreateRepairPayload) => {
      // Синхронизация строковых полей с массивами чипов
      const finalPayload: CreateRepairPayload = {
        ...v,
        package_contents:
          v.package_contents || (v.package_contents_items && v.package_contents_items.length > 0)
            ? (v.package_contents_items || []).join(", ")
            : "",
        defect_description:
          v.defect_description || (v.malfunctions && v.malfunctions.length > 0)
            ? (v.malfunctions || []).join(", ")
            : "",
        defect_photos: photoPreviews,
      };

      onSubmit(finalPayload, photos);
      form.reset();
      setPhotos([]);
      setPhotoPreviews([]);
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
      setIsHistorySheetOpen(false);
      if (initialCustomerId) {
        form.setValue("customer_id", initialCustomerId, { shouldValidate: true });
      }
    }
  }, [open, form, initialCustomerId]);

  if (!open) return null;
  const { errors, isValid } = form.formState;

  return (
    <>
      <Sheet open={open} onClose={onClose} width="w-[680px]" resizable>
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
              {/* Блок «Клиент и сделка» (с множественными контактами) */}
              <RepairClientSection form={form} initialCustomerId={initialCustomerId} />

              {/* Блок «Оборудование» */}
              <fieldset className="space-y-3.5 rounded-lg border border-[#e5e5e5] p-4 bg-slate-50/50">
                <legend className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 px-1">
                  <Package className="h-3.5 w-3.5 text-slate-400" /> Оборудование
                </legend>

                {/* Тип и Бренд */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <DictionarySelectField
                    label="Тип оборудования"
                    required
                    icon={Smartphone}
                    category="type"
                    mode="single"
                    placeholder="Выберите тип..."
                    items={dictionaries.types}
                    value={form.watch("equipment_type")}
                    onChange={(val) =>
                      form.setValue("equipment_type", val as string, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                    error={errors.equipment_type?.message}
                  />

                  <DictionarySelectField
                    label="Бренд"
                    required
                    icon={Tag}
                    category="brand"
                    mode="single"
                    placeholder="Выберите бренд..."
                    items={dictionaries.brands}
                    value={form.watch("equipment_brand")}
                    onChange={(val) =>
                      form.setValue("equipment_brand", val as string, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                    error={errors.equipment_brand?.message}
                  />
                </div>

                {/* Модель и Серийный номер */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <DictionarySelectField
                    label="Модель"
                    required
                    icon={Layers}
                    category="model"
                    brandName={form.watch("equipment_brand")}
                    mode="single"
                    placeholder="Выберите модель..."
                    items={dictionaries.models}
                    value={form.watch("equipment_model")}
                    onChange={(val) =>
                      form.setValue("equipment_model", val as string, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                    error={errors.equipment_model?.message}
                  />

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-700">
                        Серийный номер
                      </label>
                      {serialSearchQuery.isFetching && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                          <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />
                          Поиск...
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="R58N90L2AX"
                        value={form.watch("equipment_serial")}
                        onChange={(e) =>
                          form.setValue("equipment_serial", e.target.value, { shouldValidate: true })
                        }
                        className="h-9 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-xs font-mono tabular-nums text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>

                    {/* Кнопка истории ремонтов, если найдены прошлые обращения */}
                    {searchResult && searchResult.historyCount > 0 && (
                      <div className="pt-1">
                        <button
                          type="button"
                          onClick={() => setIsHistorySheetOpen(true)}
                          className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#4a38f5]/30 bg-[#4a38f5]/5 px-2.5 py-1 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors"
                        >
                          <History className="h-3.5 w-3.5" />
                          История ремонта (найдено {searchResult.historyCount})
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Комплектация (мультиселект с чипами) */}
                <div>
                  <DictionarySelectField
                    label="Комплектация"
                    icon={Cpu}
                    category="accessory"
                    mode="multi"
                    placeholder="Выберите или добавьте комплектующие (Обойма, 2 АКБ, Кейс)..."
                    items={dictionaries.accessories}
                    value={form.watch("package_contents_items") || []}
                    onChange={(val) => {
                      const items = val as string[];
                      form.setValue("package_contents_items", items, {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                      form.setValue("package_contents", items.join(", "), { shouldDirty: true });
                    }}
                  />
                </div>
              </fieldset>

              {/* Заявленные неисправности */}
              <div className="space-y-3 rounded-lg border border-[#e5e5e5] p-4 bg-white shadow-2xs">
                <DictionarySelectField
                  label="Заявленные неисправности"
                  required
                  icon={Bug}
                  category="malfunction"
                  mode="multi"
                  placeholder="Выберите неисправности (Не включается, Не стреляет, Залитие)..."
                  items={dictionaries.malfunctions}
                  value={form.watch("malfunctions") || []}
                  onChange={(val) => {
                    const items = val as string[];
                    form.setValue("malfunctions", items, {
                      shouldValidate: true,
                      shouldDirty: true,
                    });
                    if (!form.getValues("defect_description")) {
                      form.setValue("defect_description", items.join(", "), {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                    }
                  }}
                  error={errors.malfunctions?.message}
                />

                <div className="space-y-1">
                  <label className="text-xs text-slate-600">
                    Дополнительное описание неисправности
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Подробности со слов клиента..."
                    value={form.watch("defect_description") ?? ""}
                    onChange={(e) =>
                      form.setValue("defect_description", e.target.value, { shouldValidate: true })
                    }
                    className={cn(
                      "w-full rounded-lg border bg-white py-2 px-3 text-xs text-[#111111] placeholder:text-slate-400 resize-none focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                      errors.defect_description ? "border-rose-500" : "border-[#e5e5e5]",
                    )}
                  />
                  {errors.defect_description && (
                    <p className="text-xs text-rose-500">{errors.defect_description.message}</p>
                  )}
                </div>
              </div>

              {/* Фотографии дефектов */}
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                  <Camera className="h-3.5 w-3.5 text-slate-400" /> Фотографии
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

              {/* Стоимость + Приоритет + Мастер */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Banknote className="h-3.5 w-3.5 text-slate-400" /> Предв. стоимость (RUB)
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
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono tabular-nums [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Flag className="h-3.5 w-3.5 text-slate-400" /> Приоритет
                  </label>
                  <select
                    value={form.watch("priority")}
                    onChange={(e) =>
                      form.setValue("priority", e.target.value as CreateRepairPayload["priority"], {
                        shouldValidate: true,
                      })
                    }
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] appearance-none focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  >
                    <option value="low">Низкий</option>
                    <option value="normal">Обычный</option>
                    <option value="high">Высокий</option>
                    <option value="urgent">Срочный</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <User className="h-3.5 w-3.5 text-slate-400" /> Мастер *
                  </label>
                  <select
                    value={form.watch("master_id")}
                    onChange={(e) =>
                      form.setValue("master_id", e.target.value, { shouldValidate: true })
                    }
                    className={cn(
                      "w-full rounded-lg border bg-white py-2 px-3 text-sm text-[#111111] appearance-none focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                      errors.master_id ? "border-rose-500" : "border-[#e5e5e5]",
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
                </div>
              </div>

              {/* Примечания */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-600">Примечания</label>
                <textarea
                  rows={2}
                  placeholder="Дополнительные пожелания клиента..."
                  value={form.watch("notes")}
                  onChange={(e) => form.setValue("notes", e.target.value)}
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-sm text-[#111111] placeholder:text-slate-400 resize-none focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
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

      {/* Шторка истории ремонтов оборудования по серийному номеру */}
      <EquipmentRepairHistorySheet
        open={isHistorySheetOpen}
        onClose={() => setIsHistorySheetOpen(false)}
        equipment={searchResult?.equipment ?? null}
        history={searchResult?.history ?? []}
      />
    </>
  );
}
