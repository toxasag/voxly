"use client";

import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Общие визуальные стандарты ячеек Twenty CRM Light Canvas
//
// Используются единообразно в таблицах Сделок, Контактов и Компаний:
// - Квадратные брендовые бейджи для компаний (Airbnb, Stripe, Anthropic, etc.)
// - Круглые цветные аватары с инициалами для персон и авторов
// - Аккуратные пилюли (rounded-full border border-[#e5e5e5]) для email, телефонов, доменов
// - Чип «-» или «- Без названия» для пустых значений
// - Единая системная типографика Inter 12px / 13px
// ---------------------------------------------------------------------------

export const DEAL_AVATAR_PALETTES = [
  "bg-pink-100 text-pink-700 border border-pink-200/60",
  "bg-amber-100 text-amber-800 border border-amber-200/60",
  "bg-emerald-100 text-emerald-800 border border-emerald-200/60",
  "bg-sky-100 text-sky-800 border border-sky-200/60",
  "bg-lime-100 text-lime-800 border border-lime-200/60",
  "bg-stone-100 text-stone-700 border border-stone-200/60",
  "bg-purple-100 text-purple-800 border border-purple-200/60",
  "bg-indigo-100 text-indigo-800 border border-indigo-200/60",
];

export function getDealAvatarColor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return DEAL_AVATAR_PALETTES[Math.abs(hash) % DEAL_AVATAR_PALETTES.length];
}

export function getSingleInitial(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

// Стилизация плашек компаний под Twenty: узнаваемый акцент бренда или детерминированный цвет
export function getCompanyBadgeStyle(name: string): { bg: string; text: string; initial: string } {
  const lower = name.toLowerCase().trim();
  if (lower.includes("stripe")) return { bg: "bg-[#635bff]", text: "text-white", initial: "S" };
  if (lower.includes("anthropic")) return { bg: "bg-[#191919]", text: "text-white", initial: "A" };
  if (lower.includes("notion")) return { bg: "bg-[#000000]", text: "text-white", initial: "N" };
  if (lower.includes("airbnb")) return { bg: "bg-[#ff385c]", text: "text-white", initial: "A" };
  if (lower.includes("figma")) return { bg: "bg-[#1e1e1e]", text: "text-white", initial: "F" };

  const colors = [
    { bg: "bg-blue-600", text: "text-white" },
    { bg: "bg-violet-600", text: "text-white" },
    { bg: "bg-emerald-600", text: "text-white" },
    { bg: "bg-amber-600", text: "text-white" },
    { bg: "bg-rose-600", text: "text-white" },
    { bg: "bg-[#4a38f5]", text: "text-white" },
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const picked = colors[Math.abs(hash) % colors.length];
  return {
    bg: picked.bg,
    text: picked.text,
    initial: name.trim().charAt(0).toUpperCase() || "C",
  };
}

// Цвета аватаров контактов (Twenty CRM: круглые цветные аватары в нейтральной пилюле)
export const CONTACT_AVATAR_COLORS = [
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-lime-100 text-lime-800",
  "bg-purple-100 text-purple-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-indigo-100 text-indigo-800",
];

export function getContactAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CONTACT_AVATAR_COLORS[Math.abs(hash) % CONTACT_AVATAR_COLORS.length];
}

// Форматирование сумм под Twenty: $ 60k, ₽ 100k, $ 45k
export function formatBudgetTwenty(budget: number, currency: string = "RUB"): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₽";
  if (budget >= 1000 && budget % 1000 === 0) {
    return `${symbol} ${Math.round(budget / 1000)}k`;
  }
  return `${symbol} ${budget.toLocaleString("ru-RU")}`;
}

// Форматирование даты под Twenty: "31 янв., 2026 19:25"
export function formatDateTwenty(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  const formatted = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return formatted.replace(" г.", "");
}

/**
 * Бейдж компании: квадратная иконка бренда или первая буква + имя компании.
 * Если имя не задано — серый чип «- Без названия» (Скриншот 6).
 */
export function CompanyBadgeCell({
  name,
  emptyText = "Без названия",
}: {
  name?: string | null;
  emptyText?: string;
}) {
  if (!name || name.trim() === "") {
    return (
      <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#f4f4f5] px-1.5 py-0.5 text-xs text-[#888888]">
        <span className="flex h-3.5 w-3.5 items-center justify-center rounded-[3px] bg-[#e4e4e7] text-[10px] font-bold text-[#666666]">
          -
        </span>
        <span>{emptyText}</span>
      </span>
    );
  }

  const b = getCompanyBadgeStyle(name);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-bold shadow-2xs",
          b.bg,
          b.text,
        )}
      >
        {b.initial}
      </span>
      <span className="truncate font-medium text-[13px] text-[#111111]">{name}</span>
    </span>
  );
}

/**
 * Аватар контакта: цветной круг с первой буквой + имя (Скриншот 5).
 * Если имя не задано — круглый чип «-».
 */
export function ContactAvatarCell({
  name,
}: {
  name?: string | null;
}) {
  if (!name || name.trim() === "") {
    return (
      <span className="inline-flex h-4 w-5 items-center justify-center rounded-full bg-[#f4f4f5] text-[11px] font-medium text-[#888888]">
        -
      </span>
    );
  }

  const color = getContactAvatarColor(name);
  const initial = getSingleInitial(name);

  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
          color,
        )}
      >
        {initial}
      </span>
      <span className="truncate font-medium text-[13px] text-[#111111]">{name}</span>
    </span>
  );
}

/**
 * Автор записи (колонка «Создано»):
 * Если система — иконка робота и подпись «System» (Скриншоты 4, 5, 6).
 * Если пользователь — круглый цветной аватар с первой буквой имени + имя.
 */
export function CreatorCell({
  createdBy,
  createdByName,
}: {
  createdBy?: string | null;
  createdByName?: string | null;
}) {
  const isSystem =
    !createdBy ||
    createdBy === "system" ||
    createdBy === "System" ||
    createdByName === "System" ||
    createdByName === "system";

  if (isSystem) {
    return (
      <span className="flex items-center gap-1.5 text-[13px] text-[#111111]">
        <Bot className="h-3.5 w-3.5 shrink-0 text-[#666666]" />
        <span>System</span>
      </span>
    );
  }

  const name = createdByName || createdBy || "User";
  const color = getContactAvatarColor(name);
  const initial = getSingleInitial(name);

  return (
    <span className="flex items-center gap-1.5 text-[13px] text-[#111111]">
      <span
        aria-hidden="true"
        className={cn(
          "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
          color,
        )}
      >
        {initial}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/**
 * Пилюля Twenty CRM (rounded-full border border-[#e5e5e5] bg-white)
 * для отображения email, телефонов, доменов.
 */
export function PillBadge({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-[#e5e5e5] bg-white px-2 py-0.5 text-xs text-[#111111]",
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Чип прочерка «-» для пустых значений ячеек в стиле Twenty CRM.
 */
export function EmptyDashPill() {
  return (
    <span className="inline-flex h-4 w-5 items-center justify-center rounded-full bg-[#f4f4f5] text-[11px] font-medium text-[#888888]">
      -
    </span>
  );
}
