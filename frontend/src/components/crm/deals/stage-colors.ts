import type { StageColorKey } from "@/lib/api/use-deals";

/**
 * Пресеты цвета стадии канбана.
 *
 * Классы записаны литералами намеренно: Tailwind компилирует только те классы,
 * которые видит в исходниках, — динамическая сборка `border-t-${key}-500`
 * дала бы пустую строку в проде. Ключи совпадают с бэкенд-enum
 * (`deals.types.ts → stageColorSchema`), значение по умолчанию в БД — slate.
 */
export const STAGE_COLOR_KEYS: readonly StageColorKey[] = [
  "amber", "emerald", "sky", "rose", "violet", "orange", "cyan", "slate",
] as const;

export interface StageColorPreset {
  label: string;
  /** Верхняя рамка колонки канбана. */
  border: string;
  /** Левая полоса карточки сделки. */
  cardBorder: string;
  /** Точка-индикатор и мелкие акценты. */
  dot: string;
  /** Кружок-свотч в редакторе стадии. */
  swatch: string;
}

export const STAGE_COLORS: Record<StageColorKey, StageColorPreset> = {
  amber:   { label: "Янтарный", border: "border-t-amber-500",   cardBorder: "border-l-amber-500",   dot: "bg-amber-500",   swatch: "bg-amber-500" },
  emerald: { label: "Зелёный",  border: "border-t-emerald-500", cardBorder: "border-l-emerald-500", dot: "bg-emerald-500", swatch: "bg-emerald-500" },
  sky:     { label: "Голубой",  border: "border-t-sky-500",     cardBorder: "border-l-sky-500",     dot: "bg-sky-500",     swatch: "bg-sky-500" },
  rose:    { label: "Розовый",  border: "border-t-rose-500",    cardBorder: "border-l-rose-500",    dot: "bg-rose-500",    swatch: "bg-rose-500" },
  violet:  { label: "Сиреневый",border: "border-t-violet-500",  cardBorder: "border-l-violet-500",  dot: "bg-violet-500",  swatch: "bg-violet-500" },
  orange:  { label: "Оранжевый",border: "border-t-orange-400",  cardBorder: "border-l-orange-400",  dot: "bg-orange-400",  swatch: "bg-orange-400" },
  cyan:    { label: "Циан",     border: "border-t-cyan-500",    cardBorder: "border-l-cyan-500",    dot: "bg-cyan-500",    swatch: "bg-cyan-500" },
  slate:   { label: "Серый",    border: "border-t-slate-600",   cardBorder: "border-l-slate-600",   dot: "bg-slate-600",   swatch: "bg-slate-600" },
};

/** Ключ TagPill для стадии (совпадает по имени с пресетом). */
export function stageTagColor(value: string | undefined | null): import("@/components/ui/tag").TagColor {
  if (
    value === "amber" || value === "emerald" || value === "sky" || value === "rose" ||
    value === "violet" || value === "orange" || value === "cyan" || value === "slate"
  ) {
    return value;
  }
  return "slate";
}

/** Безопасный разбор значения из БД/сети на случай неизвестного ключа. */
export function stageColor(value: string | undefined | null): StageColorPreset {
  if (value !== undefined && value !== null && value in STAGE_COLORS) {
    return STAGE_COLORS[value as StageColorKey];
  }
  return STAGE_COLORS.slate;
}
