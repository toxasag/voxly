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

export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    return `${day}.${month}.${year}, ${hours}:${minutes}`;
  } catch {
    return "—";
  }
}

/**
 * Конвертирует ISO-метку (или локальную дату) в строку формата «YYYY-MM-DDTHH:mm»
 * в локальной таймзоне пользователя для DateTimePicker и input[type="datetime-local"].
 */
export function toLocalDateTimeInput(value: string | null | undefined): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T12:00`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return "";

  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

/**
 * Переводит локальное значение из DateTimePicker («YYYY-MM-DDTHH:mm» или «YYYY-MM-DD»)
 * в абсолютную ISO-8601 UTC-строку для отправки на сервер в TIMESTAMPTZ.
 */
export function localDateTimeToIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T12:00:00` : trimmed;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

/** Возвращает локальный ключ даты формата «YYYY-MM-DD» без сдвига в UTC. */
export function toLocalDateKey(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Форматирует только локальное время («HH:mm») для компактных ячеек календаря. */
export function formatTaskTime(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Единый формат отображения срока задачи с датой и временем в локальной таймзоне.
 * Примеры: «25.11, 15:30» или «25 ноября, 15:30» (с годом, если год не текущий).
 */
export function formatTaskDue(
  value: string | null | undefined,
  options?: { longMonth?: boolean; emptyLabel?: string },
): string {
  if (!value) return options?.emptyLabel ?? "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return options?.emptyLabel ?? "—";

  const sameYear = d.getFullYear() === new Date().getFullYear();
  const timePart = formatTaskTime(value);

  if (options?.longMonth) {
    const datePart = new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "long",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(d);
    return `${datePart}, ${timePart}`;
  }

  const pad = (n: number): string => String(n).padStart(2, "0");
  const datePart = sameYear
    ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`
    : `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  return `${datePart}, ${timePart}`;
}

/**
 * Многословный регистронезависимый поиск: разбивает запрос по пробелам на токены
 * и проверяет `AND`-совпадение каждого слова хотя бы в одном из полей в любом порядке.
 */
export function matchesSearchTokens(
  query: string,
  fields: Array<string | null | undefined>,
): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;

  const tokens = trimmed.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return true;

  const haystack = fields
    .filter((f): f is string => typeof f === "string" && f.length > 0)
    .map((f) => f.toLowerCase());

  if (haystack.length === 0) return false;

  return tokens.every((token) => haystack.some((field) => field.includes(token)));
}

/**
 * Многословный поиск по позиции номенклатуры склада (название, артикул, бренд, категория, модели).
 */
export function matchesWarehouseItem(
  item: {
    name?: string | null;
    sku?: string | null;
    brand?: string | null;
    category?: string | null;
    modelNames?: string[];
    models?: Array<{ name?: string | null; brandName?: string | null }>;
  },
  query: string,
): boolean {
  return matchesSearchTokens(query, [
    item.name,
    item.sku,
    item.brand,
    item.category,
    ...(item.modelNames ?? []),
    ...(item.models ?? []).flatMap((m) => [m.name, m.brandName]),
  ]);
}
