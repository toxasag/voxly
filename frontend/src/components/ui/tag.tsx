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
  amber:   "bg-[#fef9c3] text-[#a16207]",
  emerald: "bg-[#dcfce7] text-[#15803d]",
  sky:     "bg-[#e0f2fe] text-[#0369a1]",
  rose:    "bg-[#ffe4e6] text-[#be123c]",
  violet:  "bg-[#f3e8ff] text-[#7e22ce]",
  orange:  "bg-[#ffedd5] text-[#c2410c]",
  cyan:    "bg-[#cffafe] text-[#0e7490]",
  slate:   "bg-[#f4f4f5] text-[#3f3f46]",
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
        "inline-flex max-w-full items-center gap-1.5 rounded-[4px] px-1.5 py-0.5 text-xs font-medium leading-none",
        TAG_COLORS[color],
        className,
      )}
    >
      {children}
    </span>
  );
}
