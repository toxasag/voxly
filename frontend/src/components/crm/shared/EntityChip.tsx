"use client";

import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Чип записи в духе Twenty: квадратный аватар со скруглением и инициалами
// (или иконкой), рядом — подпись. Цвет аватара детерминирован именем: один и
// тот же контакт/компания везде выглядит одинаково, что работает как второй
// идентификатор при сканировании таблицы глазами.
//
// Палитра фиксирована литеральными классами (Tailwind компилирует только те
// классы, что видит в исходниках) — 8 мягких пар из разрешённой гаммы.
// ---------------------------------------------------------------------------

const CHIP_PALETTES = [
  "bg-amber-500/15 text-amber-300 border-amber-500/25",
  "bg-emerald-500/15 text-emerald-300 border-emerald-500/25",
  "bg-sky-500/15 text-sky-300 border-sky-500/25",
  "bg-rose-500/15 text-rose-300 border-rose-500/25",
  "bg-violet-500/15 text-violet-300 border-violet-500/25",
  "bg-orange-500/15 text-orange-300 border-orange-500/25",
  "bg-cyan-500/15 text-cyan-300 border-cyan-500/25",
  "bg-slate-600/30 text-slate-300 border-slate-500/30",
] as const;

function paletteFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) | 0;
  }
  return CHIP_PALETTES[Math.abs(hash) % CHIP_PALETTES.length];
}

export function chipInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
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
  size?: "sm" | "md";
  className?: string;
}

export function EntityChip({ name, label, icon: Icon, size = "md", className }: EntityChipProps) {
  const box = size === "sm" ? "h-5 w-5 rounded text-xs" : "h-6 w-6 rounded-md text-xs";

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-2", className)}>
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center border font-bold",
          box,
          paletteFor(name),
        )}
      >
        {Icon !== undefined ? <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} /> : chipInitials(name)}
      </span>
      {label !== undefined && (
        <span className={cn("truncate font-medium", size === "sm" ? "text-xs" : "text-sm")}>
          {label !== "" ? label : "—"}
        </span>
      )}
    </span>
  );
}
