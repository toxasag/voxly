"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Чип записи в духе Twenty: квадратный аватар со скруглением и инициалами
// (или иконкой/фавиконкой компании), рядом — подпись. Цвет аватара детерминирован
// именем: один и тот же контакт/компания везде выглядит одинаково, что работает
// как второй идентификатор при сканировании таблицы глазами.
//
// Если передан домен (domain) компании или прямой URL (imageUrl), подтягивается
// реальный логотип через Google Favicon API с мягким fallback на инициалы.
// ---------------------------------------------------------------------------

const CHIP_PALETTES = [
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-sky-100 text-sky-800 border-sky-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-orange-100 text-orange-800 border-orange-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
  "bg-zinc-100 text-zinc-800 border-zinc-200",
] as const;

export function paletteFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return CHIP_PALETTES[Math.abs(hash) % CHIP_PALETTES.length];
}

export function chipInitials(name: string, singleLetter = false): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?";
  if (singleLetter) return (trimmed.charAt(0) || "?").toUpperCase();

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]?.slice(0, 2) ?? "?").toUpperCase();
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts[1]?.charAt(0) ?? "";
  return `${first}${second}`.toUpperCase();
}

interface EntityChipProps {
  /** Имя записи — источник инициалов и цвета фона. */
  name: string;
  label?: string;
  icon?: LucideIcon;
  imageUrl?: string;
  /** Домен компании (например, acme.com) для авто-фавиконки в духе Twenty */
  domain?: string;
  size?: "sm" | "md" | "table";
  singleLetter?: boolean;
  className?: string;
}

export function EntityChip({
  name,
  label,
  icon: Icon,
  imageUrl,
  domain,
  size = "md",
  singleLetter = false,
  className,
}: EntityChipProps) {
  const [imgFailed, setImgFailed] = useState(false);

  const cleanDomain = domain?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const faviconUrl = imageUrl || (cleanDomain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(cleanDomain)}&sz=64` : undefined);
  const showFavicon = Boolean(faviconUrl && !imgFailed);

  const box =
    size === "sm"
      ? "h-3.5 w-3.5 rounded-[2px] text-[8px]"
      : size === "table"
        ? "h-5 w-5 rounded-[4px] text-[10px]"
        : "h-6 w-6 rounded-md text-xs";

  const initials = chipInitials(name, singleLetter);

  if (size === "sm" && label !== undefined) {
    return (
      <span
        className={cn(
          "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-0.5 text-[11px] text-[#333333] shadow-2xs",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex shrink-0 items-center justify-center border font-semibold overflow-hidden",
            box,
            showFavicon ? "border-[#e5e5e5] bg-white" : paletteFor(name),
          )}
        >
          {showFavicon ? (
            <img
              src={faviconUrl}
              alt=""
              onError={() => setImgFailed(true)}
              className="h-full w-full object-contain p-[1px] rounded-[inherit]"
            />
          ) : Icon !== undefined ? (
            <Icon className="h-2.5 w-2.5" />
          ) : (
            initials
          )}
        </span>
        <span className="truncate font-medium">{label !== "" ? label : "—"}</span>
      </span>
    );
  }

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center border font-semibold overflow-hidden",
          box,
          showFavicon ? "border-[#e5e5e5] bg-white" : paletteFor(name),
        )}
      >
        {showFavicon ? (
          <img
            src={faviconUrl}
            alt=""
            onError={() => setImgFailed(true)}
            className="h-full w-full object-contain p-0.5 rounded-[inherit]"
          />
        ) : Icon !== undefined ? (
          <Icon className={size === "sm" ? "h-2.5 w-2.5" : size === "table" ? "h-3 w-3" : "h-3.5 w-3.5"} />
        ) : (
          initials
        )}
      </span>
      {label !== undefined && (
        <span className={cn("truncate font-medium", size === "sm" ? "text-xs" : "text-sm")}>
          {label !== "" ? label : "—"}
        </span>
      )}
    </span>
  );
}
