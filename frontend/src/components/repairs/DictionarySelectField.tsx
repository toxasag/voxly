"use client";

import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import {
  useAddRepairDictionaryItem,
  useDeleteRepairDictionaryItem,
  useRenameRepairDictionaryItem,
  type DictionaryItemDTO,
} from "@/lib/api/use-repairs";
import { cn } from "@/lib/utils";

export type DictionaryCategory = "type" | "brand" | "model" | "accessory" | "malfunction";

export interface DictionarySelectFieldProps {
  label?: string;
  required?: boolean;
  icon: ComponentType<{ className?: string }>;
  category: DictionaryCategory;
  brandName?: string;
  brandId?: string;
  items: (string | DictionaryItemDTO)[];
  placeholder?: string;
  mode: "single" | "multi";
  value: string | string[];
  onChange: (value: string | string[]) => void;
  error?: string;
  className?: string;
  disabled?: boolean;
}

interface NormalizedItem {
  id?: string;
  name: string;
  brandName?: string;
  brandId?: string;
}

export function DictionarySelectField({
  label,
  required = false,
  icon: Icon,
  category,
  brandName,
  brandId,
  items,
  placeholder,
  mode,
  value,
  onChange,
  error,
  className,
  disabled = false,
}: DictionarySelectFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [newItemName, setNewItemName] = useState("");

  const isModelCategory = category === "model";
  const isBrandSelected = Boolean((brandId && brandId.trim()) || (brandName && brandName.trim()));
  const isLocked = isModelCategory && !isBrandSelected;
  const isEffectivelyDisabled = disabled || isLocked;
  const displayPlaceholder = isLocked
    ? "Сначала выберите бренд"
    : (placeholder ?? (mode === "single" ? "Выберите из списка..." : "Выберите несколько..."));

  // Режим инлайн-редактирования элемента
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const addPopoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  const addMutation = useAddRepairDictionaryItem();
  const renameMutation = useRenameRepairDictionaryItem();
  const deleteMutation = useDeleteRepairDictionaryItem();

  const singleValue = typeof value === "string" ? value : "";
  const multiValues = useMemo(() => (Array.isArray(value) ? value : []), [value]);

  // Нормализуем входящие элементы справочника
  const normalizedItems: NormalizedItem[] = useMemo(() => {
    return items.map((it) => {
      if (typeof it === "string") {
        return { name: it };
      }
      return { id: it.id, name: it.name, brandName: it.brandName, brandId: it.brandId };
    });
  }, [items]);

  // Закрытие при клике снаружи
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node) &&
        addPopoverRef.current &&
        !addPopoverRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setIsAddOpen(false);
        setEditingId(null);
        setActionError(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Фокус в инпут поиска при открытии дропдауна
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Фокус в инпут редактирования
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Фильтрация вариантов по бренду (для модели) и поисковому запросу
  const filteredItems = useMemo(() => {
    let source = normalizedItems;

    if (isModelCategory) {
      if (!isBrandSelected) {
        return [];
      }
      const normBrandName = brandName?.trim().toLowerCase();
      source = source.filter((item) => {
        if (brandId && item.brandId) {
          return item.brandId === brandId;
        }
        if (normBrandName && item.brandName) {
          return item.brandName.trim().toLowerCase() === normBrandName;
        }
        return false;
      });
    }

    const term = searchTerm.trim().toLowerCase();
    if (!term) return source;
    return source.filter((item) => item.name.toLowerCase().includes(term));
  }, [normalizedItems, isModelCategory, isBrandSelected, brandId, brandName, searchTerm]);

  const handleSelectSingle = (item: NormalizedItem) => {
    onChange(item.name);
    setIsOpen(false);
    setSearchTerm("");
    setActionError(null);
  };

  const handleClearSingle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const handleToggleMulti = (item: NormalizedItem) => {
    if (multiValues.includes(item.name)) {
      onChange(multiValues.filter((v) => v !== item.name));
    } else {
      onChange([...multiValues, item.name]);
    }
    setActionError(null);
  };

  const handleRemoveChip = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(multiValues.filter((v) => v !== name));
  };

  const handleClearAllMulti = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const handleAddNewItem = async (e?: React.FormEvent | React.MouseEvent | React.KeyboardEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const trimmed = newItemName.trim();
    if (!trimmed) return;

    try {
      await addMutation.mutateAsync({
        category,
        name: trimmed,
        brand_name: brandName?.trim(),
        brand_id: brandId?.trim(),
      });

      if (mode === "single") {
        onChange(trimmed);
      } else {
        if (!multiValues.includes(trimmed)) {
          onChange([...multiValues, trimmed]);
        }
      }

      setNewItemName("");
      setIsAddOpen(false);
      setActionError(null);
      toast.success(`Добавлено в справочник: ${trimmed}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось добавить элемент";
      setActionError(msg);
      toast.error(msg);
    }
  };

  const handleStartRename = (e: React.MouseEvent, item: NormalizedItem) => {
    e.stopPropagation();
    if (!item.id) return;
    setEditingId(item.id);
    setEditingName(item.name);
    setActionError(null);
  };

  const handleSaveRename = async (e: React.MouseEvent, item: NormalizedItem) => {
    e.stopPropagation();
    const trimmed = editingName.trim();
    if (!item.id || !trimmed || trimmed === item.name) {
      setEditingId(null);
      return;
    }

    try {
      await renameMutation.mutateAsync({
        category,
        id: item.id,
        name: trimmed,
      });

      // Обновляем выбранное значение, если оно совпадает с редактируемым
      if (mode === "single" && singleValue === item.name) {
        onChange(trimmed);
      } else if (mode === "multi" && multiValues.includes(item.name)) {
        onChange(multiValues.map((v) => (v === item.name ? trimmed : v)));
      }

      setEditingId(null);
      setActionError(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось переименовать";
      setActionError(msg);
    }
  };

  const handleDeleteItem = async (e: React.MouseEvent, item: NormalizedItem) => {
    e.stopPropagation();
    if (!item.id) return;

    setActionError(null);
    try {
      await deleteMutation.mutateAsync({
        category,
        id: item.id,
      });

      // Если удаленный элемент был выбран, удаляем его из значения
      if (mode === "single" && singleValue === item.name) {
        onChange("");
      } else if (mode === "multi" && multiValues.includes(item.name)) {
        onChange(multiValues.filter((v) => v !== item.name));
      }
    } catch (err: unknown) {
      // При 409 бэкенд возвращает сообщение о блокировке связей
      let msg = "Не удалось удалить элемент";
      if (err && typeof err === "object" && "message" in err) {
        msg = String((err as { message: unknown }).message);
      }
      setActionError(msg);
    }
  };

  return (
    <div className={cn("space-y-1 relative", className)} ref={containerRef}>
      {label && (
        <label className="block text-xs font-medium text-slate-700">
          {label} {required && <span className="text-rose-500">*</span>}
        </label>
      )}

      {/* Составной контейнер инпута */}
      <div
        className={cn(
          "flex min-h-[36px] w-full items-stretch rounded-lg border bg-white shadow-2xs transition-all",
          error
            ? "border-rose-400 focus-within:border-rose-500 focus-within:ring-1 focus-within:ring-rose-200"
            : isOpen
              ? "border-[#4a38f5] ring-1 ring-[#4a38f5]/20"
              : "border-[#e5e5e5] hover:border-[#cccccc]",
          isEffectivelyDisabled && "opacity-60 bg-slate-50 cursor-not-allowed",
        )}
      >
        {/* Левая ячейка: Иконка сущности */}
        <div className="flex w-9 shrink-0 items-center justify-center border-r border-[#e5e5e5] bg-slate-50/50 text-slate-400 rounded-l-[7px]">
          <Icon className="h-4 w-4" />
        </div>

        {/* Центральная часть: Селектор/чипы */}
        <div
          className={cn(
            "flex flex-1 items-center gap-1.5 px-2.5 py-1 min-w-0 select-none",
            isEffectivelyDisabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
          onClick={() => {
            if (!isEffectivelyDisabled) setIsOpen((prev) => !prev);
          }}
        >
          {mode === "single" ? (
            <div className="flex-1 truncate text-xs text-[#111111]">
              {singleValue ? (
                <span className="font-medium text-[#111111]">{singleValue}</span>
              ) : (
                <span className={cn(isLocked ? "italic text-slate-400 font-normal" : "text-slate-400")}>
                  {displayPlaceholder}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-1 flex-wrap items-center gap-1 min-w-0">
              {multiValues.length > 0 ? (
                multiValues.map((chip) => (
                  <span
                    key={chip}
                    className="inline-flex items-center gap-1 rounded-[4px] bg-slate-100 border border-slate-200/80 px-1.5 py-0.5 text-xs text-slate-700 font-medium"
                  >
                    <span>{chip}</span>
                    <button
                      type="button"
                      disabled={isEffectivelyDisabled}
                      onClick={(e) => handleRemoveChip(chip, e)}
                      className="rounded hover:bg-slate-200 p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
                      title="Удалить"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))
              ) : (
                <span className={cn(isLocked ? "italic text-slate-400 font-normal" : "text-xs text-slate-400")}>
                  {displayPlaceholder}
                </span>
              )}
            </div>
          )}

          {/* Кнопка сброса */}
          {!isEffectivelyDisabled && mode === "single" && singleValue && (
            <button
              type="button"
              onClick={handleClearSingle}
              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Очистить"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          {!isEffectivelyDisabled && mode === "multi" && multiValues.length > 0 && (
            <button
              type="button"
              onClick={handleClearAllMulti}
              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Очистить всё"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-slate-400 transition-transform",
              isOpen && "rotate-180",
              isEffectivelyDisabled && "opacity-40",
            )}
          />
        </div>

        {/* Правая ячейка: Кнопка «+» добавления нового элемента */}
        <button
          type="button"
          disabled={isEffectivelyDisabled}
          onClick={(e) => {
            e.stopPropagation();
            if (isEffectivelyDisabled) return;
            setIsAddOpen((prev) => !prev);
            setIsOpen(false);
            setActionError(null);
          }}
          className={cn(
            "flex w-9 shrink-0 items-center justify-center border-l border-[#e5e5e5] text-slate-500 rounded-r-[7px] transition-colors",
            isEffectivelyDisabled
              ? "opacity-40 cursor-not-allowed hover:bg-transparent hover:text-slate-500"
              : isAddOpen
                ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]"
                : "hover:bg-slate-50 hover:text-[#4a38f5]",
          )}
          title={isLocked ? "Сначала выберите бренд" : "Добавить в справочник"}
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Ошибка валидации формы */}
      {error && <p className="text-[11px] text-rose-500">{error}</p>}

      {/* Сообщение об ошибке действия со справочником (например 409 Conflict) */}
      {actionError && (
        <div className="flex items-start gap-1.5 rounded-[6px] border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 shadow-2xs">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <div className="flex-1 text-[11px] leading-tight">{actionError}</div>
          <button
            type="button"
            onClick={() => setActionError(null)}
            className="text-amber-500 hover:text-amber-700"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Выпадающий список выбора из справочника */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-64 overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-lg flex flex-col">
          {/* Поиск */}
          <div className="p-2 border-b border-[#f0f0f0] bg-slate-50/50">
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Поиск по справочнику..."
              className="h-7 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none"
            />
          </div>

          {/* Список элементов */}
          <div className="overflow-y-auto max-h-52 p-1 divide-y divide-[#f5f5f5]">
            {filteredItems.length > 0 ? (
              filteredItems.map((item) => {
                const isSelected =
                  mode === "single" ? singleValue === item.name : multiValues.includes(item.name);
                const isEditing = editingId !== null && editingId === item.id;

                if (isEditing) {
                  return (
                    <div
                      key={item.id ?? item.name}
                      onClick={(e) => e.stopPropagation()}
                      className="flex items-center gap-1 px-2 py-1.5 bg-slate-50 rounded-[4px]"
                    >
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleSaveRename(e as unknown as React.MouseEvent, item);
                          } else if (e.key === "Escape") {
                            setEditingId(null);
                          }
                        }}
                        className="h-6 flex-1 rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={(e) => void handleSaveRename(e, item)}
                        disabled={renameMutation.isPending}
                        className="p-1 rounded text-emerald-600 hover:bg-emerald-50 transition-colors"
                        title="Сохранить"
                      >
                        {renameMutation.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Check className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(null);
                        }}
                        className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        title="Отмена"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                }

                return (
                  <div
                    key={item.id ?? item.name}
                    onClick={() => {
                      if (mode === "single") {
                        handleSelectSingle(item);
                      } else {
                        handleToggleMulti(item);
                      }
                    }}
                    className={cn(
                      "group flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer transition-colors",
                      isSelected
                        ? "bg-[#4a38f5]/10 text-[#4a38f5] font-medium"
                        : "text-[#111111] hover:bg-slate-50",
                    )}
                  >
                    <div className="flex items-center gap-2 truncate mr-2">
                      <span>{item.name}</span>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      {/* Кнопки переименования и удаления, если элемент персистентный (есть id) */}
                      {item.id && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => handleStartRename(e, item)}
                            className="p-1 rounded text-slate-400 hover:text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors"
                            title="Переименовать"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => void handleDeleteItem(e, item)}
                            disabled={deleteMutation.isPending}
                            className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title="Удалить из справочника"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )}

                      {isSelected && <Check className="h-3.5 w-3.5 text-[#4a38f5]" />}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="p-3 text-center text-xs text-slate-400">
                Ничего не найдено. Нажмите «+» справа, чтобы добавить новое значение.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Поповер быстрого добавления нового элемента в справочник */}
      {isAddOpen && (
        <div
          ref={addPopoverRef}
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-[8px] border border-[#e5e5e5] bg-white p-3 shadow-xl"
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#111111] truncate pr-2">
                {isModelCategory && brandName
                  ? `Добавить модель для ${brandName}`
                  : isModelCategory
                    ? "Добавить модель"
                    : category === "brand"
                      ? "Добавить бренд"
                      : "Добавить в справочник"}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsAddOpen(false);
                }}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <input
              type="text"
              autoFocus
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleAddNewItem(e);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsAddOpen(false);
                }
              }}
              placeholder={
                isModelCategory
                  ? "Название модели (например, GSN50)..."
                  : category === "brand"
                    ? "Название бренда (например, Toua)..."
                    : "Введите наименование..."
              }
              className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsAddOpen(false);
                }}
                className="h-7 rounded-[6px] border border-[#e5e5e5] px-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void handleAddNewItem(e);
                }}
                disabled={!newItemName.trim() || addMutation.isPending}
                className="flex h-7 items-center gap-1 rounded-[6px] bg-[#4a38f5] px-3 text-xs font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50"
              >
                {addMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
