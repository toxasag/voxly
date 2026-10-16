import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatPhone(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length === 0) return "";
  if (digits.length <= 1) return `+${digits}`;
  if (digits.length <= 4) return `+${digits[0]} ${digits.slice(1)}`;
  if (digits.length <= 7)
    return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4)}`;
  if (digits.length <= 9)
    return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  return `+${digits[0]} ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9)}`;
}

/**
 * Относительное время в духе Twenty: «только что», «5 мин», «3 ч», «Вчера»,
 * «12 дн». Полная дата остаётся в title атрибуте ячейки.
 */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";

  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);

  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "Вчера";
  if (days < 30) return `${days} дн`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} мес`;

  return `${Math.floor(months / 12)} г`;
}