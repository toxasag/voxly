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
  amber:   "border-amber-500/25   bg-amber-500/10   text-amber-300",
  emerald: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300",
  sky:     "border-sky-500/25     bg-sky-500/10     text-sky-300",
  rose:    "border-rose-500/25    bg-rose-500/10    text-rose-300",
  violet:  "border-violet-500/25  bg-violet-500/10  text-violet-300",
  orange:  "border-orange-400/25  bg-orange-400/10  text-orange-300",
  cyan:    "border-cyan-500/25    bg-cyan-500/10    text-cyan-300",
  slate:   "border-slate-600/40   bg-slate-700/30   text-slate-300",
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
