"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Цветная пилюля-тэг как в Twenty: мягкий фон + насыщенный текст того же тона.
// Используется для стадий сделок, каналов связи и прочих перечислений.
// Классы литеральные — динамическая сборка не компилируется Tailwind'ом.
// ---------------------------------------------------------------------------

export type TagColor = "amber" | "emerald" | "sky" | "rose" | "violet" | "orange" | "cyan" | "slate";

const TAG_COLORS: Record<TagColor, string> = {
  amber:   "border-amber-200/80   bg-amber-50   text-amber-800",
  emerald: "border-emerald-200/80 bg-emerald-50 text-emerald-800",
  sky:     "border-sky-200/80     bg-sky-50     text-sky-800",
  rose:    "border-rose-200/80    bg-rose-50    text-rose-800",
  violet:  "border-purple-200/80  bg-purple-50  text-purple-800",
  orange:  "border-orange-200/80  bg-orange-50  text-orange-800",
  cyan:    "border-cyan-200/80    bg-cyan-50    text-cyan-800",
  slate:   "border-slate-200      bg-slate-100  text-slate-700",
};

interface TagPillProps {
  color?: TagColor;
  children: ReactNode;
  className?: string;
}

export function TagPill({ color = "slate", children, className }: TagPillProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        TAG_COLORS[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
