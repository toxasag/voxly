"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Globe,
  Layers,
  MessageCircle,
  MessageSquare,
  Search,
  Send,
  UserCheck,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadSource } from "@/lib/api/use-bitrix24";

export interface SourceMeta {
  id: LeadSource;
  label: string;
  shortLabel: string;
  description: string;
  icon: LucideIcon;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  iconColor: string;
}

export const LEAD_SOURCE_CATALOG: SourceMeta[] = [
  {
    id: "whatsapp",
    label: "Ватсап",
    shortLabel: "WhatsApp",
    description: "Входящие диалоги и обращения из WhatsApp",
    icon: MessageSquare,
    badgeBg: "bg-emerald-50",
    badgeBorder: "border-emerald-200",
    badgeText: "text-emerald-800",
    iconColor: "text-emerald-600",
  },
  {
    id: "max",
    label: "Макс",
    shortLabel: "MAX",
    description: "Мессенджер MAX (каналы и личные диалоги)",
    icon: MessageCircle,
    badgeBg: "bg-indigo-50",
    badgeBorder: "border-indigo-200",
    badgeText: "text-indigo-800",
    iconColor: "text-indigo-600",
  },
  {
    id: "telegram_personal",
    label: "Телеграм личные",
    shortLabel: "TG Личные",
    description: "Личные аккаунты сотрудников в Telegram (MTProto)",
    icon: Send,
    badgeBg: "bg-sky-50",
    badgeBorder: "border-sky-200",
    badgeText: "text-sky-800",
    iconColor: "text-sky-600",
  },
  {
    id: "telegram_bot",
    label: "Телеграм боты",
    shortLabel: "TG Боты",
    description: "Официальные Telegram-боты компании (Bot API)",
    icon: Bot,
    badgeBg: "bg-purple-50",
    badgeBorder: "border-purple-200",
    badgeText: "text-purple-800",
    iconColor: "text-purple-600",
  },
  {
    id: "site_widget",
    label: "Виджеты на сайтах",
    shortLabel: "Виджет",
    description: "Формы сбора контактов и онлайн-чат на сайтах",
    icon: Globe,
    badgeBg: "bg-amber-50",
    badgeBorder: "border-amber-200",
    badgeText: "text-amber-800",
    iconColor: "text-amber-600",
  },
  {
    id: "manual",
    label: "Ручное создание",
    shortLabel: "Вручную",
    description: "Сделки и лиды, созданные менеджерами в CRM вручную",
    icon: UserCheck,
    badgeBg: "bg-slate-50",
    badgeBorder: "border-slate-200",
    badgeText: "text-slate-800",
    iconColor: "text-slate-600",
  },
];

export const SOURCE_MAP = new Map<LeadSource, SourceMeta>(
  LEAD_SOURCE_CATALOG.map((item) => [item.id, item]),
);

interface SourceMultiSelectProps {
  value: LeadSource[];
  onChange: (value: LeadSource[]) => void;
  disabled?: boolean;
  className?: string;
}

export function SourceMultiSelect({
  value,
  onChange,
  disabled = false,
  className,
}: SourceMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Закрытие при клике снаружи и по Escape
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Фокус на инпут поиска при открытии
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
    } else {
      setSearch("");
    }
  }, [open]);

  const selectedSet = new Set<LeadSource>(value);
  const isAllSelected = value.length === LEAD_SOURCE_CATALOG.length;
  const isNoneExplicit = value.length === 0;

  const handleToggle = (id: LeadSource) => {
    if (disabled) return;
    if (selectedSet.has(id)) {
      onChange(value.filter((item) => item !== id));
    } else {
      onChange([...value, id]);
    }
  };

  const handleRemove = (e: React.MouseEvent, id: LeadSource) => {
    e.stopPropagation();
    if (disabled) return;
    onChange(value.filter((item) => item !== id));
  };

  const handleSelectAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange(LEAD_SOURCE_CATALOG.map((s) => s.id));
  };

  const handleClearAll = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (disabled) return;
    onChange([]);
  };

  const filteredSources = LEAD_SOURCE_CATALOG.filter((src) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (
      src.label.toLowerCase().includes(q) ||
      src.shortLabel.toLowerCase().includes(q) ||
      src.description.toLowerCase().includes(q) ||
      src.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className={cn("space-y-1.5", className)} ref={containerRef}>
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[#111111] block">
          Источники заявок для экспорта
        </label>
        <span className="text-[11px] text-[#666666]">
          {isNoneExplicit
            ? "Все источники (без ограничений)"
            : `Выбрано: ${value.length} из ${LEAD_SOURCE_CATALOG.length}`}
        </span>
      </div>

      {/* Поле выбора / Триггер комбобокса */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            setOpen((prev) => !prev);
          }
        }}
        className={cn(
          "relative min-h-[36px] w-full cursor-pointer rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs transition-colors",
          "hover:border-[#cccccc] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
          open && "border-[#4a38f5] ring-1 ring-[#4a38f5]/20",
          disabled && "cursor-not-allowed opacity-60 bg-[#fafafa]",
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5 pr-8">
          {/* Если источники не выбраны вручную — индикация дефолтного режима «Все источники» */}
          {isNoneExplicit ? (
            <span className="inline-flex items-center gap-1.5 rounded-[4px] border border-emerald-200 bg-emerald-50/80 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
              <Layers className="h-3 w-3 text-emerald-600" />
              Все источники (заявки из всех каналов)
            </span>
          ) : (
            value.map((srcId) => {
              const meta = SOURCE_MAP.get(srcId);
              if (!meta) return null;
              const Icon = meta.icon;
              return (
                <span
                  key={srcId}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[11px] font-medium transition-all shadow-2xs",
                    meta.badgeBg,
                    meta.badgeBorder,
                    meta.badgeText,
                  )}
                >
                  <Icon className={cn("h-3 w-3 shrink-0", meta.iconColor)} />
                  <span>{meta.label}</span>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={(e) => handleRemove(e, srcId)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-black/10 transition-colors"
                      title={`Удалить ${meta.label}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </span>
              );
            })
          )}
        </div>

        {/* Правые контролы (очистка и шеврон) */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[#888888]">
          {!isNoneExplicit && !disabled && (
            <button
              type="button"
              onClick={handleClearAll}
              className="p-1 hover:text-[#111111] transition-colors rounded-[4px]"
              title="Сбросить фильтр"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform duration-150", open && "rotate-180")}
          />
        </div>
      </div>

      {/* Выпадающая панель (Command Popover) */}
      {open && (
        <div
          className="absolute z-50 mt-1 w-full max-w-lg rounded-[12px] border border-[#e5e5e5] bg-white p-2 shadow-xl animate-in fade-in-0 zoom-in-95 duration-100"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Поле поиска */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск источника (WhatsApp, Telegram, боты, виджеты)..."
              className="w-full h-8 pl-8 pr-3 rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:bg-white focus:outline-none"
            />
          </div>

          {/* Быстрые действия: Выбрать все / Очистить */}
          <div className="flex items-center justify-between px-1.5 py-1 mb-1.5 border-b border-[#f0f0f0] text-[11px]">
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={isAllSelected}
              className="text-[#4a38f5] hover:underline disabled:opacity-40 font-medium"
            >
              Выбрать все
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={isNoneExplicit}
              className="text-[#666666] hover:text-rose-600 disabled:opacity-40"
            >
              Сбросить (отправлять все)
            </button>
          </div>

          {/* Список источников с чекбоксами */}
          <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
            {filteredSources.length === 0 ? (
              <div className="py-4 text-center text-xs text-[#888888]">
                Ничего не найдено по запросу «{search}»
              </div>
            ) : (
              filteredSources.map((src) => {
                const isSelected = selectedSet.has(src.id);
                const Icon = src.icon;

                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => handleToggle(src.id)}
                    className={cn(
                      "flex w-full items-start gap-2.5 p-2 rounded-[6px] text-left transition-colors",
                      isSelected
                        ? "bg-[#4a38f5]/5 text-[#111111]"
                        : "hover:bg-[#f5f5f5] text-[#333333]",
                    )}
                  >
                    {/* Кастомный чекбокс */}
                    <div
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border mt-0.5 transition-colors",
                        isSelected
                          ? "border-[#4a38f5] bg-[#4a38f5] text-white"
                          : "border-[#cccccc] bg-white",
                      )}
                    >
                      {isSelected && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", src.iconColor)} />
                        <span className="text-xs font-semibold text-[#111111]">{src.label}</span>
                        <span
                          className={cn(
                            "text-[10px] px-1 py-0.2 rounded border font-mono",
                            src.badgeBg,
                            src.badgeBorder,
                            src.badgeText,
                          )}
                        >
                          {src.id}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[#666666] leading-tight truncate">
                        {src.description}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Подсказка в футере панели */}
          <div className="mt-2 pt-2 border-t border-[#f0f0f0] px-1.5 text-[10px] text-[#888888] leading-relaxed">
            {isNoneExplicit
              ? "Пока фильтр пуст, заявки из любых каналов передаются в Битрикс24 без исключений."
              : "В Битрикс24 попадут только заявки, поступившие из выбранных каналов."}
          </div>
        </div>
      )}

      <p className="text-[11px] text-[#666666] leading-relaxed">
        {isNoneExplicit
          ? "По умолчанию передаются лиды из всех источников. Выберите каналы, если требуется фильтровать входящие заявки."
          : `Экспорт ограничен ${value.length} источн.: заявки из остальных каналов будут игнорироваться.`}
      </p>
    </div>
  );
}
