"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Wrench,
  User,
  Package,
  Loader2,
  Camera,
  Flag,
  X,
  Smartphone,
  Tag,
  Layers,
  Cpu,
  Bug,
  History,
  Copy,
  Trash2,
} from "lucide-react";
import { createRepairSchema, type CreateRepairPayload } from "@/schemas/repair.schema";
import { useTeamMembers } from "@/lib/api/use-team";
import { useDeal } from "@/lib/api/use-deals";
import {
  useRepairDictionaries,
  useSearchEquipmentBySerial,
  type CreateBatchRepairPayload,
  type EquipmentIntakeItem,
  type ServiceDictionariesDTO,
} from "@/lib/api/use-repairs";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { toast } from "sonner";
import { RepairClientSection } from "./RepairClientSection";
import { DictionarySelectField } from "./DictionarySelectField";
import { EquipmentRepairHistorySheet } from "./EquipmentRepairHistorySheet";
import { cn } from "@/lib/utils";

export interface EquipmentCardItem {
  id: string;
  equipment_type: string;
  equipment_brand: string;
  equipment_model: string;
  equipment_serial: string;
  package_contents: string;
  package_contents_items: string[];
  appearance: string;
  malfunctions: string[];
  defect_description: string;
  estimated_cost: number;
}

function createEmptyEquipment(): EquipmentCardItem {
  return {
    id:
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `eq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    equipment_type: "",
    equipment_brand: "",
    equipment_model: "",
    equipment_serial: "",
    package_contents: "",
    package_contents_items: [],
    appearance: "",
    malfunctions: [],
    defect_description: "",
    estimated_cost: 0,
  };
}

interface EquipmentCardProps {
  item: EquipmentCardItem;
  index: number;
  total: number;
  onCopy: () => void;
  onRemove: () => void;
  onChange: (updated: EquipmentCardItem) => void;
  dictionaries: ServiceDictionariesDTO;
  onOpenHistory: (serial: string) => void;
  errors?: Record<string, string>;
}

function EquipmentCard({
  item,
  index,
  total,
  onCopy,
  onRemove,
  onChange,
  dictionaries,
  onOpenHistory,
  errors = {},
}: EquipmentCardProps) {
  // Интеллектуальный поиск оборудования по серийному номеру с дебаунсом 300мс
  const [debouncedSerial, setDebouncedSerial] = useState(item.equipment_serial);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSerial(item.equipment_serial.trim());
    }, 300);
    return () => clearTimeout(handler);
  }, [item.equipment_serial]);

  const serialSearchQuery = useSearchEquipmentBySerial(debouncedSerial);
  const searchResult = serialSearchQuery.data;

  // Автозаполнение формы при обнаружении оборудования по серийному номеру
  useEffect(() => {
    if (searchResult && searchResult.found && searchResult.equipment) {
      const eq = searchResult.equipment;
      const updates: Partial<EquipmentCardItem> = {};

      if (eq.type && !item.equipment_type) updates.equipment_type = eq.type;
      if (eq.brand && !item.equipment_brand) updates.equipment_brand = eq.brand;
      if (eq.model && !item.equipment_model) updates.equipment_model = eq.model;
      if (eq.packageContents && eq.packageContents.length > 0 && item.package_contents_items.length === 0) {
        updates.package_contents_items = eq.packageContents;
        updates.package_contents = eq.packageContents.join(", ");
      }

      if (Object.keys(updates).length > 0) {
        onChange({ ...item, ...updates });
      }
    }
  }, [searchResult, item, onChange]);

  return (
    <fieldset className="space-y-3.5 rounded-lg border border-[#e5e5e5] p-4 bg-slate-50/50 shadow-2xs relative">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2.5">
        <legend className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 px-1">
          <Package className="h-3.5 w-3.5 text-[#4a38f5]" />
          <span>Оборудование {total > 1 ? `#${index + 1}` : ""}</span>
        </legend>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCopy}
            className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-[#4a38f5] hover:text-[#4a38f5] transition-colors shadow-2xs"
            title="Копировать оборудование (сохраняет тип, бренд, модель, неисправности; серийный номер пуст)"
          >
            <Copy className="h-3.5 w-3.5 text-[#4a38f5]" />
            <span>Копировать</span>
          </button>
          {total > 1 && (
            <button
              type="button"
              onClick={onRemove}
              className="p-1 rounded-[6px] text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
              title="Удалить оборудование"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Тип и Бренд */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
        <DictionarySelectField
          label="Тип оборудования"
          required
          icon={Smartphone}
          category="type"
          mode="single"
          placeholder="Выберите тип..."
          items={dictionaries.types}
          value={item.equipment_type}
          onChange={(val) => onChange({ ...item, equipment_type: val as string })}
          error={errors.equipment_type}
        />

        <DictionarySelectField
          label="Бренд"
          required
          icon={Tag}
          category="brand"
          mode="single"
          placeholder="Выберите бренд..."
          items={dictionaries.brands}
          value={item.equipment_brand}
          onChange={(val) => onChange({ ...item, equipment_brand: val as string })}
          error={errors.equipment_brand}
        />
      </div>

      {/* Модель и Серийный номер */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <DictionarySelectField
          label="Модель"
          required
          icon={Layers}
          category="model"
          brandName={item.equipment_brand}
          mode="single"
          placeholder="Выберите модель..."
          items={dictionaries.models}
          value={item.equipment_model}
          onChange={(val) => onChange({ ...item, equipment_model: val as string })}
          error={errors.equipment_model}
        />

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-slate-700">Серийный номер</label>
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
              value={item.equipment_serial}
              onChange={(e) => onChange({ ...item, equipment_serial: e.target.value })}
              className="h-9 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-xs font-mono tabular-nums text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          {/* Кнопка истории ремонтов */}
          {searchResult && searchResult.historyCount > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => onOpenHistory(item.equipment_serial)}
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
          value={item.package_contents_items}
          onChange={(val) => {
            const arr = val as string[];
            onChange({
              ...item,
              package_contents_items: arr,
              package_contents: arr.join(", "),
            });
          }}
        />
      </div>

      {/* Заявленные неисправности */}
      <div className="space-y-3 rounded-lg border border-[#e5e5e5] p-3.5 bg-white shadow-2xs mt-2">
        <DictionarySelectField
          label="Заявленные неисправности"
          required
          icon={Bug}
          category="malfunction"
          mode="multi"
          placeholder="Выберите неисправности (Не включается, Не стреляет, Залитие)..."
          items={dictionaries.malfunctions}
          value={item.malfunctions}
          onChange={(val) => {
            const arr = val as string[];
            const updates: Partial<EquipmentCardItem> = { malfunctions: arr };
            if (!item.defect_description) {
              updates.defect_description = arr.join(", ");
            }
            onChange({ ...item, ...updates });
          }}
          error={errors.malfunctions}
        />

        <div className="space-y-1">
          <label className="text-xs text-slate-600">Дополнительное описание неисправности</label>
          <textarea
            rows={2}
            placeholder="Подробности со слов клиента..."
            value={item.defect_description}
            onChange={(e) => onChange({ ...item, defect_description: e.target.value })}
            className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 px-3 text-xs text-[#111111] placeholder:text-slate-400 resize-none focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
        </div>
      </div>
    </fieldset>
  );
}

export interface RepairIntakeModalProps {
  open: boolean;
  onClose: () => void;
  // Поддерживает и одиночный, и пакетный CreateRepairPayload
  onSubmit: (payload: CreateRepairPayload & { equipments?: EquipmentIntakeItem[] }, photos: File[]) => void | Promise<void>;
  initialCustomerId?: string;
  initialDealId?: string | null;
  isSubmitting?: boolean;
}

export function RepairIntakeModal({
  open,
  onClose,
  onSubmit,
  initialCustomerId,
  initialDealId,
  isSubmitting = false,
}: RepairIntakeModalProps) {
  const { data: initialDeal } = useDeal(initialDealId ?? null);
  const [photos, setPhotos] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [isHistorySheetOpen, setIsHistorySheetOpen] = useState(false);
  const [historySerial, setHistorySerial] = useState<string>("");

  // Список карточек оборудования (мульти-приёмка)
  const [equipments, setEquipments] = useState<EquipmentCardItem[]>([createEmptyEquipment()]);
  const [equipmentErrors, setEquipmentErrors] = useState<Record<string, Record<string, string>>>({});

  const teamQuery = useTeamMembers();
  const teamMembers = teamQuery.data?.members ?? [];

  const dictionariesQuery = useRepairDictionaries();
  const dictionaries: ServiceDictionariesDTO = dictionariesQuery.data ?? {
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

  // Сброс при открытии
  useEffect(() => {
    if (open) {
      form.reset();
      setEquipments([createEmptyEquipment()]);
      setEquipmentErrors({});
      setPhotos([]);
      setPhotoPreviews([]);
      setIsHistorySheetOpen(false);
      setHistorySerial("");
      if (initialCustomerId) {
        form.setValue("customer_id", initialCustomerId, { shouldValidate: true });
      }
      if (initialDeal) {
        form.setValue("deal_id", initialDeal.id, { shouldValidate: true });
        if (initialDeal.contactId) {
          form.setValue("customer_id", initialDeal.contactId, { shouldValidate: true });
        }
        if (initialDeal.contactName) {
          form.setValue("customer_name", initialDeal.contactName, { shouldValidate: true });
        }
        if (initialDeal.contactPhone) {
          form.setValue("customer_phone", initialDeal.contactPhone, { shouldValidate: true });
        }
        if (initialDeal.contactEmail) {
          form.setValue("customer_email", initialDeal.contactEmail, { shouldValidate: true });
        }
        if (initialDeal.companyId) {
          form.setValue("company_id", initialDeal.companyId, { shouldValidate: true });
        }
        if (initialDeal.companyName) {
          form.setValue("company_name", initialDeal.companyName, { shouldValidate: true });
        }
      } else if (initialDealId) {
        form.setValue("deal_id", initialDealId, { shouldValidate: true });
      }
    }
  }, [open, form, initialCustomerId, initialDeal, initialDealId]);

  // Копирование карточки оборудования
  const handleCopyEquipment = useCallback((idx: number) => {
    setEquipments((prev) => {
      const source = prev[idx];
      if (!source) return prev;
      const copy: EquipmentCardItem = {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `eq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        equipment_type: source.equipment_type,
        equipment_brand: source.equipment_brand,
        equipment_model: source.equipment_model,
        equipment_serial: "", // Серийный номер очищен по ТЗ!
        package_contents: source.package_contents,
        package_contents_items: [...source.package_contents_items],
        appearance: source.appearance,
        malfunctions: [...source.malfunctions],
        defect_description: source.defect_description,
        estimated_cost: source.estimated_cost,
      };
      const updated = [...prev];
      updated.splice(idx + 1, 0, copy);
      return updated;
    });
  }, []);

  const handleRemoveEquipment = useCallback((idx: number) => {
    setEquipments((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const handleEquipmentChange = useCallback((idx: number, updated: EquipmentCardItem) => {
    setEquipments((prev) => {
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
    // Синхронизируем первую карточку с формой для совместимости с валидацией zod
    if (idx === 0) {
      form.setValue("equipment_type", updated.equipment_type, { shouldValidate: true });
      form.setValue("equipment_brand", updated.equipment_brand, { shouldValidate: true });
      form.setValue("equipment_model", updated.equipment_model, { shouldValidate: true });
      form.setValue("equipment_serial", updated.equipment_serial);
      form.setValue("package_contents", updated.package_contents);
      form.setValue("package_contents_items", updated.package_contents_items);
      form.setValue("malfunctions", updated.malfunctions);
      form.setValue("defect_description", updated.defect_description);
    }
  }, [form]);

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

  const serialHistorySearch = useSearchEquipmentBySerial(historySerial);

  const handleSubmit = useCallback(
    async (e?: React.FormEvent) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }

      // Валидация полей карточек оборудования
      const newErrors: Record<string, Record<string, string>> = {};
      let hasError = false;

      equipments.forEach((eq, idx) => {
        const itemErr: Record<string, string> = {};
        if (!eq.equipment_type.trim()) {
          itemErr.equipment_type = "Укажите тип оборудования";
          hasError = true;
        }
        if (!eq.equipment_brand.trim()) {
          itemErr.equipment_brand = "Укажите бренд";
          hasError = true;
        }
        if (!eq.equipment_model.trim()) {
          itemErr.equipment_model = "Укажите модель";
          hasError = true;
        }
        if (Object.keys(itemErr).length > 0) {
          newErrors[eq.id] = itemErr;
        }
      });

      setEquipmentErrors(newErrors);

      // Валидация полей клиента и мастера через react-hook-form
      const formValid = await form.trigger(["customer_name", "customer_phone", "master_id"]);
      if (!formValid || hasError) {
        return;
      }

      const formValues = form.getValues();
      const firstEq = equipments[0] ?? createEmptyEquipment();

      const batchEquipments: EquipmentIntakeItem[] = equipments.map((eq) => ({
        equipment_type: eq.equipment_type,
        equipment_brand: eq.equipment_brand,
        equipment_model: eq.equipment_model,
        equipment_serial: eq.equipment_serial || undefined,
        package_contents: eq.package_contents,
        package_contents_items: eq.package_contents_items,
        appearance: eq.appearance,
        defect_description: eq.defect_description,
        malfunctions: eq.malfunctions,
        defect_photos: photoPreviews,
        estimated_cost: eq.estimated_cost,
      }));

      const finalPayload: CreateRepairPayload & { equipments?: EquipmentIntakeItem[] } = {
        ...formValues,
        equipment_type: firstEq.equipment_type,
        equipment_brand: firstEq.equipment_brand,
        equipment_model: firstEq.equipment_model,
        equipment_serial: firstEq.equipment_serial || undefined,
        package_contents: firstEq.package_contents,
        package_contents_items: firstEq.package_contents_items,
        appearance: firstEq.appearance,
        defect_description: firstEq.defect_description,
        malfunctions: firstEq.malfunctions,
        defect_photos: photoPreviews,
        equipments: batchEquipments,
      };

      try {
        await onSubmit(finalPayload, photos);
        onClose();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Ошибка при сохранении наряда";
        toast.error(msg);
      }
    },
    [equipments, form, photoPreviews, onSubmit, photos, onClose],
  );

  if (!open) return null;
  const { errors } = form.formState;

  return (
    <>
      <Sheet open={open} onClose={onClose} width="w-[720px]" resizable>
        <SheetHeader onClose={onClose}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10">
              <Wrench className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">Приёмка оборудования</h2>
              <p className="text-xs text-[#666666]">
                {equipments.length > 1
                  ? `Оформить пакетный ремонт (${equipments.length} шт.) и напечатать квитанции`
                  : "Оформить ремонт и напечатать квитанцию"}
              </p>
            </div>
          </div>
        </SheetHeader>

        <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void handleSubmit(e);
            }}
            className="flex flex-col flex-1 min-h-0"
          >
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Блок «Клиент и сделка» (с множественными контактами) */}
              <RepairClientSection form={form} initialCustomerId={initialCustomerId} />

              {/* Карточки оборудования (мульти-приёмка с копированием) */}
              <div className="space-y-4">
                {equipments.map((eq, idx) => (
                  <EquipmentCard
                    key={eq.id}
                    item={eq}
                    index={idx}
                    total={equipments.length}
                    onCopy={() => handleCopyEquipment(idx)}
                    onRemove={() => handleRemoveEquipment(idx)}
                    onChange={(updated) => handleEquipmentChange(idx, updated)}
                    dictionaries={dictionaries}
                    onOpenHistory={(serial) => {
                      setHistorySerial(serial);
                      setIsHistorySheetOpen(true);
                    }}
                    errors={equipmentErrors[eq.id]}
                  />
                ))}
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
                        alt="Превью дефекта"
                        className="h-16 w-16 rounded-lg object-cover border border-[#e5e5e5]"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(i)}
                        className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-white shadow-xs opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  <label className="flex h-16 w-16 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-[#cccccc] bg-slate-50 text-slate-400 hover:border-[#4a38f5] hover:text-[#4a38f5] transition-colors">
                    <Camera className="h-5 w-5" />
                    <span className="text-[10px] mt-0.5">Фото</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePhotosAdd}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* Приоритет и Ответственный мастер */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Flag className="h-3.5 w-3.5 text-slate-400" /> Приоритет
                  </label>
                  <select
                    value={form.watch("priority")}
                    onChange={(e) =>
                      form.setValue("priority", e.target.value as "low" | "normal" | "high" | "urgent")
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
                    onChange={(e) => {
                      const id = e.target.value;
                      form.setValue("master_id", id, { shouldValidate: true });
                      const m = teamMembers.find((item) => item.id === id);
                      if (m) {
                        form.setValue("master_name", m.fullName, { shouldValidate: true });
                      }
                    }}
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
                <label className="text-xs text-slate-600">Примечания к наряду</label>
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
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleSubmit(e);
                }}
                disabled={isSubmitting}
                className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3b2be0] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Создаём...
                  </>
                ) : equipments.length > 1 ? (
                  `Оформить пакет (${equipments.length} шт.) и напечатать`
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
        onClose={() => {
          setIsHistorySheetOpen(false);
          setHistorySerial("");
        }}
        equipment={serialHistorySearch.data?.equipment ?? null}
        history={serialHistorySearch.data?.history ?? []}
      />
    </>
  );
}
