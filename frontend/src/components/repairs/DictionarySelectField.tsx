"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import { Check, ChevronDown, Loader2, Plus, X } from "lucide-react";
import { useAddRepairDictionaryItem } from "@/lib/api/use-repairs";
import { cn } from "@/lib/utils";

export type DictionaryCategory = "type" | "brand" | "model" | "accessory" | "malfunction";

export interface DictionarySelectFieldProps {
  label?: string;
  required?: boolean;
  icon: ComponentType<{ className?: string }>;
  category: DictionaryCategory;
  brandName?: string;
  items: string[];
  placeholder?: string;
  mode: "single" | "multi";
  value: string | string[];
  onChange: (value: string | string[]) => void;
  error?: string;
  className?: string;
  disabled?: boolean;
}

export function DictionarySelectField({
  label,
  required = false,
  icon: Icon,
  category,
  brandName,
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

  const containerRef = useRef<HTMLDivElement>(null);
  const addPopoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const addMutation = useAddRepairDictionaryItem();

  const singleValue = typeof value === "string" ? value : "";
  const multiValues = Array.isArray(value) ? value : [];

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

  // Фильтрация вариантов
  const filteredItems = items.filter((item) =>
    item.toLowerCase().includes(searchTerm.trim().toLowerCase()),
  );

  const handleSelectSingle = (item: string) => {
    onChange(item);
    setIsOpen(false);
    setSearchTerm("");
  };

  const handleClearSingle = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  const handleToggleMulti = (item: string) => {
    if (multiValues.includes(item)) {
      onChange(multiValues.filter((v) => v !== item));
    } else {
      onChange([...multiValues, item]);
    }
  };

  const handleRemoveChip = (item: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(multiValues.filter((v) => v !== item));
  };

  const handleClearAllMulti = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const handleAddNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newItemName.trim();
    if (!trimmed) return;

    try {
      await addMutation.mutateAsync({
        category,
        name: trimmed,
        brand_name: brandName,
      });

      // Автоматически выбираем созданный элемент
      if (mode === "single") {
        onChange(trimmed);
      } else {
        if (!multiValues.includes(trimmed)) {
          onChange([...multiValues, trimmed]);
        }
      }

      setNewItemName("");
      setIsAddOpen(false);
    } catch {
      // Ошибка обрабатывается мутацией
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
          disabled && "opacity-50 pointer-events-none bg-slate-50",
        )}
      >
        {/* Левая ячейка: Иконка сущности */}
        <div className="flex w-9 shrink-0 items-center justify-center border-r border-[#e5e5e5] bg-slate-50/50 text-slate-400 rounded-l-[7px]">
          <Icon className="h-4 w-4" />
        </div>

        {/* Центральная часть: Селектор/чипы */}
        <div
          className="flex flex-1 items-center gap-1.5 px-2.5 py-1 min-w-0 cursor-pointer select-none"
          onClick={() => {
            if (!disabled) setIsOpen((prev) => !prev);
          }}
        >
          {mode === "single" ? (
            <div className="flex-1 truncate text-xs text-[#111111]">
              {singleValue ? (
                <span className="font-medium text-[#111111]">{singleValue}</span>
              ) : (
                <span className="text-slate-400">{placeholder ?? "Выберите из списка..."}</span>
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
                      onClick={(e) => handleRemoveChip(chip, e)}
                      className="rounded hover:bg-slate-200 p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
                      title="Удалить"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-400">
                  {placeholder ?? "Выберите несколько..."}
                </span>
              )}
            </div>
          )}

          {/* Кнопка сброса */}
          {mode === "single" && singleValue && (
            <button
              type="button"
              onClick={handleClearSingle}
              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Очистить"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          {mode === "multi" && multiValues.length > 0 && (
            <button
              type="button"
              onClick={handleClearAllMulti}
              className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Очистить всё"
            >
              <X className="h-3 w-3" />
            </button>
          )}

          <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform", isOpen && "rotate-180")} />
        </div>

        {/* Правая ячейка: Кнопка «+» добавления нового элемента */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsAddOpen((prev) => !prev);
            setIsOpen(false);
          }}
          className={cn(
            "flex w-9 shrink-0 items-center justify-center border-l border-[#e5e5e5] text-slate-500 rounded-r-[7px] transition-colors",
            isAddOpen
              ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]"
              : "hover:bg-slate-50 hover:text-[#4a38f5]",
          )}
          title="Добавить в справочник"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* Ошибка валидации */}
      {error && <p className="text-[11px] text-rose-500">{error}</p>}

      {/* Выпадающий список выбора из справочника */}
      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-40 mt-1 max-h-60 overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-lg flex flex-col">
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
          <div className="overflow-y-auto max-h-48 p-1 divide-y divide-[#f5f5f5]">
            {filteredItems.length > 0 ? (
              filteredItems.map((item) => {
                const isSelected =
                  mode === "single" ? singleValue === item : multiValues.includes(item);

                return (
                  <div
                    key={item}
                    onClick={() => {
                      if (mode === "single") {
                        handleSelectSingle(item);
                      } else {
                        handleToggleMulti(item);
                      }
                    }}
                    className={cn(
                      "flex items-center justify-between px-2.5 py-1.5 text-xs rounded-[4px] cursor-pointer transition-colors",
                      isSelected
                        ? "bg-[#4a38f5]/10 text-[#4a38f5] font-medium"
                        : "text-[#111111] hover:bg-slate-50",
                    )}
                  >
                    <span>{item}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-[#4a38f5]" />}
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
          className="absolute right-0 top-full z-50 mt-1 w-72 rounded-[8px] border border-[#e5e5e5] bg-white p-3 shadow-xl"
        >
          <form onSubmit={handleAddNewItem} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#111111]">
                Добавить в справочник
              </span>
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
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
              placeholder="Введите наименование..."
              className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-slate-400 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="h-7 rounded-[6px] border border-[#e5e5e5] px-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Отмена
              </button>
              <button
                type="submit"
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
          </form>
        </div>
      )}
    </div>
  );
}
