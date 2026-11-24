"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/use-auth";

const STORAGE_PREFIX = "getvoxly:filters:v1";

export interface FilterFieldSpec<V> {
  /** Имя query-параметра в URL; без него поле сохраняется только в localStorage. */
  queryParam?: string;
  /** Значение по умолчанию, используемое до гидрации и после сброса. */
  defaultValue: V;
  /** Валидатор сырого значения из URL или localStorage; null означает «невалидно». */
  parse: (raw: unknown) => V | null;
  /** Сериализация в query-параметр; null/пустая строка удаляют параметр из URL. */
  serialize?: (value: V) => string | null;
}

export type FilterSchema<T extends Record<string, unknown>> = {
  [K in keyof T]: FilterFieldSpec<T[K]>;
};

export interface UsePersistedFiltersOptions<T extends Record<string, unknown>> {
  /** Уникальный идентификатор страницы (например, "repairs", "crm-deals"). */
  pageKey: string;
  /** Описание полей фильтра (рекомендуется выносить в константу уровня модуля). */
  schema: FilterSchema<T>;
  /** Синхронизировать фильтры с query-параметрами URL через history.replaceState. */
  syncUrl?: boolean;
}

export interface UsePersistedFiltersResult<T extends Record<string, unknown>> {
  /** Текущие значения фильтров (на SSR и первом кадре — значения по умолчанию). */
  filters: T;
  /** true после клиентского чтения URL и localStorage для текущего tenant + user. */
  isHydrated: boolean;
  /** true, если хотя бы одно поле отличается от значения по умолчанию. */
  hasActiveFilters: boolean;
  /** Обновить одно поле фильтра, сохранить в localStorage и синхронизировать URL. */
  setFilter: <K extends keyof T>(key: K, value: T[K]) => void;
  /** Атомарно обновить несколько полей фильтра. */
  setFilters: (patch: Partial<T>) => void;
  /** Сбросить все поля к значениям по умолчанию, очистить localStorage и URL-параметры фильтров. */
  resetFilters: () => void;
  /** Вычисленный ключ localStorage с изоляцией по tenant, userId и странице. */
  storageKey: string;
}

export function enumField<V extends string>(options: {
  queryParam?: string;
  defaultValue: V;
  allowed: readonly V[];
}): FilterFieldSpec<V> {
  const allowedSet = new Set<string>(options.allowed);
  return {
    queryParam: options.queryParam,
    defaultValue: options.defaultValue,
    parse: (raw: unknown): V | null => {
      if (typeof raw !== "string") return null;
      return allowedSet.has(raw) ? (raw as V) : null;
    },
    serialize: (value: V): string | null =>
      value === options.defaultValue ? null : value,
  };
}

export function stringField(options?: {
  queryParam?: string;
  defaultValue?: string;
  maxLength?: number;
}): FilterFieldSpec<string> {
  const defaultValue = options?.defaultValue ?? "";
  const maxLength = options?.maxLength ?? 200;
  return {
    queryParam: options?.queryParam,
    defaultValue,
    parse: (raw: unknown): string | null => {
      if (typeof raw !== "string") return null;
      return raw.length > maxLength ? raw.slice(0, maxLength) : raw;
    },
    serialize: (value: string): string | null =>
      value === defaultValue || value.trim() === "" ? null : value,
  };
}

export function nullableStringField(options?: {
  queryParam?: string;
  defaultValue?: string | null;
  maxLength?: number;
}): FilterFieldSpec<string | null> {
  const defaultValue = options?.defaultValue ?? null;
  const maxLength = options?.maxLength ?? 128;
  return {
    queryParam: options?.queryParam,
    defaultValue,
    parse: (raw: unknown): string | null => {
      if (raw === null) return null;
      if (typeof raw !== "string") return null;
      const trimmed = raw.trim();
      if (trimmed.length === 0) return null;
      return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
    },
    serialize: (value: string | null): string | null =>
      value === defaultValue || value === null || value.trim() === "" ? null : value,
  };
}

export function buildFilterStorageKey(
  tenantKey: string,
  userId: string,
  pageKey: string,
): string {
  return `${STORAGE_PREFIX}:${tenantKey}:${userId}:${pageKey}`;
}

function getDefaults<T extends Record<string, unknown>>(schema: FilterSchema<T>): T {
  const result = {} as T;
  for (const key of Object.keys(schema) as Array<keyof T>) {
    result[key] = schema[key].defaultValue;
  }
  return result;
}

function areAllDefaults<T extends Record<string, unknown>>(
  schema: FilterSchema<T>,
  values: T,
): boolean {
  for (const key of Object.keys(schema) as Array<keyof T>) {
    if (!Object.is(values[key], schema[key].defaultValue)) {
      return false;
    }
  }
  return true;
}

function readStoredFilters<T extends Record<string, unknown>>(
  storageKey: string,
  schema: FilterSchema<T>,
): Partial<T> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed as Record<string, unknown>;
    const restored: Partial<T> = {};
    for (const key of Object.keys(schema) as Array<keyof T>) {
      const rawKey = String(key);
      if (!(rawKey in record)) continue;
      const value = schema[key].parse(record[rawKey]);
      if (value !== null) {
        restored[key] = value;
      }
    }
    return restored;
  } catch {
    return {};
  }
}

function writeStoredFilters<T extends Record<string, unknown>>(
  storageKey: string,
  schema: FilterSchema<T>,
  values: T,
): void {
  if (typeof window === "undefined") return;
  try {
    if (areAllDefaults(schema, values)) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    const payload: Record<string, unknown> = {};
    for (const key of Object.keys(schema) as Array<keyof T>) {
      if (!Object.is(values[key], schema[key].defaultValue)) {
        payload[String(key)] = values[key];
      }
    }
    window.localStorage.setItem(storageKey, JSON.stringify(payload));
  } catch {
    // Приватный режим или переполнение квоты не должны ломать интерфейс.
  }
}

function clearStoredFilters(storageKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage access errors.
  }
}

function readUrlFilters<T extends Record<string, unknown>>(
  searchParams: { get: (name: string) => string | null },
  schema: FilterSchema<T>,
): { values: Partial<T>; hasExplicitParams: boolean } {
  const values: Partial<T> = {};
  let hasExplicitParams = false;

  for (const key of Object.keys(schema) as Array<keyof T>) {
    const spec = schema[key];
    if (!spec.queryParam) continue;
    const raw = searchParams.get(spec.queryParam);
    if (raw === null) continue;
    hasExplicitParams = true;
    const parsed = spec.parse(raw);
    if (parsed !== null) {
      values[key] = parsed;
    }
  }

  return { values, hasExplicitParams };
}

function syncFiltersToUrl<T extends Record<string, unknown>>(
  schema: FilterSchema<T>,
  values: T,
): void {
  if (typeof window === "undefined") return;
  try {
    const url = new URL(window.location.href);
    const params = url.searchParams;
    let changed = false;

    for (const key of Object.keys(schema) as Array<keyof T>) {
      const spec = schema[key];
      if (!spec.queryParam) continue;

      const value = values[key];
      const isDefault = Object.is(value, spec.defaultValue);
      const serialized = isDefault
        ? null
        : spec.serialize
          ? spec.serialize(value)
          : value === null || value === undefined || value === ""
            ? null
            : String(value);

      const current = params.get(spec.queryParam);
      if (serialized === null || serialized === "") {
        if (current !== null) {
          params.delete(spec.queryParam);
          changed = true;
        }
      } else if (current !== serialized) {
        params.set(spec.queryParam, serialized);
        changed = true;
      }
    }

    if (!changed) return;

    const query = params.toString();
    const nextUrl = `${url.pathname}${query.length > 0 ? `?${query}` : ""}${url.hash}`;
    window.history.replaceState(window.history.state, "", nextUrl);
  } catch {
    // Ignore history API restrictions.
  }
}

/**
 * Персистентное состояние фильтров страницы с изоляцией по tenant и userId.
 *
 * Приоритет восстановления при монтировании (строго на клиенте, без hydration mismatch):
 * 1. Явные query-параметры URL (позволяют делиться ссылками с фильтрами).
 * 2. Последний сохранённый выбор пользователя в localStorage (`tenant:userId:pageKey`).
 * 3. Значения по умолчанию из `schema`.
 *
 * Синхронизация URL выполняется через `history.replaceState` и затрагивает только
 * описанные в `schema` параметры, не затирая `?record=`, `?deal=`, `?create=` и т.д.
 */
export function usePersistedFilters<T extends Record<string, unknown>>(
  options: UsePersistedFiltersOptions<T>,
): UsePersistedFiltersResult<T> {
  const { pageKey, schema, syncUrl = true } = options;
  const searchParams = useSearchParams();
  const auth = useAuth();

  const schemaRef = useRef(schema);
  schemaRef.current = schema;

  const tenantKey = auth.tenant?.slug || auth.tenant?.tenantId || "default";
  const userId = auth.user?.id || "anon";
  const authLoading = Boolean(auth.isLoading);

  const storageKey = useMemo(
    () => buildFilterStorageKey(tenantKey, userId, pageKey),
    [tenantKey, userId, pageKey],
  );

  const [filters, setFiltersState] = useState<T>(() => getDefaults(schema));
  const [isHydrated, setIsHydrated] = useState(false);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const hydratedStorageKeyRef = useRef<string | null>(null);
  const lastUrlSignatureRef = useRef<string | null>(null);

  // Стабильная подпись только управляемых URL-параметров: смена `?record=` не триггерит эффект.
  const urlFilterSignature = useMemo(() => {
    const entries: Array<[string, string | null]> = [];
    for (const key of Object.keys(schema) as Array<keyof T>) {
      const param = schema[key].queryParam;
      if (param) {
        entries.push([param, searchParams.get(param)]);
      }
    }
    return JSON.stringify(entries);
  }, [schema, searchParams]);

  useEffect(() => {
    if (authLoading) return;

    const currentSchema = schemaRef.current;
    const isKeySwitch = hydratedStorageKeyRef.current !== storageKey;
    const isUrlChanged = lastUrlSignatureRef.current !== urlFilterSignature;

    if (!isKeySwitch && !isUrlChanged) return;

    const { values: urlValues, hasExplicitParams } = readUrlFilters(
      searchParams,
      currentSchema,
    );

    if (isKeySwitch) {
      const defaults = getDefaults(currentSchema);
      const storedValues = readStoredFilters(storageKey, currentSchema);
      const resolved: T = {
        ...defaults,
        ...storedValues,
        ...urlValues,
      };

      hydratedStorageKeyRef.current = storageKey;
      lastUrlSignatureRef.current = urlFilterSignature;
      filtersRef.current = resolved;
      setFiltersState(resolved);
      setIsHydrated(true);

      if (syncUrl) {
        syncFiltersToUrl(currentSchema, resolved);
      }
      return;
    }

    lastUrlSignatureRef.current = urlFilterSignature;
    if (hasExplicitParams) {
      const defaults = getDefaults(currentSchema);
      const next: T = {
        ...defaults,
        ...urlValues,
      };
      filtersRef.current = next;
      setFiltersState(next);
    }
  }, [authLoading, searchParams, storageKey, syncUrl, urlFilterSignature]);

  const setFilters = useCallback(
    (patch: Partial<T>) => {
      const currentSchema = schemaRef.current;
      const next: T = { ...filtersRef.current, ...patch };
      filtersRef.current = next;
      setFiltersState(next);

      if (!authLoading) {
        writeStoredFilters(storageKey, currentSchema, next);
      }
      if (syncUrl) {
        syncFiltersToUrl(currentSchema, next);
      }
    },
    [authLoading, storageKey, syncUrl],
  );

  const setFilter = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      setFilters({ [key]: value } as unknown as Partial<T>);
    },
    [setFilters],
  );

  const resetFilters = useCallback(() => {
    const currentSchema = schemaRef.current;
    const defaults = getDefaults(currentSchema);
    filtersRef.current = defaults;
    setFiltersState(defaults);

    clearStoredFilters(storageKey);
    if (syncUrl) {
      syncFiltersToUrl(currentSchema, defaults);
    }
  }, [storageKey, syncUrl]);

  const hasActiveFilters = useMemo(
    () => !areAllDefaults(schema, filters),
    [schema, filters],
  );

  return {
    filters,
    isHydrated,
    hasActiveFilters,
    setFilter,
    setFilters,
    resetFilters,
    storageKey,
  };
}
