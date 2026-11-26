"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type TableBulkActionPayload<TFilters extends Record<string, unknown> = Record<string, unknown>> =
  | {
      mode: "ids";
      ids: string[];
    }
  | {
      mode: "all";
      filters?: TFilters;
      excluded_ids?: string[];
    };

export interface UseTableSelectionOptions {
  /** Сериализованный ключ фильтров/поиска; при его изменении выбор сбрасывается. */
  filterKey?: string;
  /** Общее количество записей выборки с учётом текущих фильтров (`meta.total`). */
  totalCount: number;
}

export interface TableSelectionState {
  selectedIds: ReadonlySet<string>;
  excludedIds: ReadonlySet<string>;
  isAllSelected: boolean;
  excludedCount: number;
  effectiveSelectedCount: number;
  /** Возвращает Set выбранных ID для текущей страницы (подходит для пропса `selectedIds` в `RecordTable`). */
  getPageSelectedIds: (pageIds: readonly string[]) => Set<string>;
  isRowSelected: (id: string) => boolean;
  isPageAllSelected: (pageIds: readonly string[]) => boolean;
  isPagePartiallySelected: (pageIds: readonly string[]) => boolean;
  toggleRow: (id: string) => void;
  togglePage: (pageIds: readonly string[]) => void;
  onPageSelectionChange: (nextPageSelected: Set<string>, pageIds: readonly string[]) => void;
  selectAllAcrossPages: () => void;
  clear: () => void;
  buildBulkPayload: <TFilters extends Record<string, unknown>>(
    filters?: TFilters,
  ) => TableBulkActionPayload<TFilters>;
}

/**
 * Единый state-менеджер для сквозного (cross-page) выбора строк во всех таблицах:
 * - в обычном режиме хранит явно отмеченные ID (переживает переход между страницами);
 * - после нажатия «Выбрать все N» переходит в `isAllSelected = true` и учитывает снятые строки в `excludedIds`;
 * - автоматически сбрасывается при изменении активных фильтров или поисковой строки.
 */
export function useTableSelection({
  filterKey,
  totalCount,
}: UseTableSelectionOptions): TableSelectionState {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [excludedIds, setExcludedIds] = useState<Set<string>>(() => new Set());
  const [isAllSelected, setIsAllSelected] = useState(false);

  const prevFilterKeyRef = useRef<string | undefined>(filterKey);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setExcludedIds(new Set());
    setIsAllSelected(false);
  }, []);

  useEffect(() => {
    if (filterKey !== prevFilterKeyRef.current) {
      prevFilterKeyRef.current = filterKey;
      clear();
    }
  }, [filterKey, clear]);

  const effectiveSelectedCount = useMemo(() => {
    if (isAllSelected) {
      return Math.max(0, totalCount - excludedIds.size);
    }
    return selectedIds.size;
  }, [isAllSelected, totalCount, excludedIds.size, selectedIds.size]);

  const isRowSelected = useCallback(
    (id: string) => {
      if (isAllSelected) {
        return !excludedIds.has(id);
      }
      return selectedIds.has(id);
    },
    [isAllSelected, excludedIds, selectedIds],
  );

  const isPageAllSelected = useCallback(
    (pageIds: readonly string[]) => {
      if (pageIds.length === 0) return false;
      return pageIds.every((id) => (isAllSelected ? !excludedIds.has(id) : selectedIds.has(id)));
    },
    [isAllSelected, excludedIds, selectedIds],
  );

  const isPagePartiallySelected = useCallback(
    (pageIds: readonly string[]) => {
      if (pageIds.length === 0) return false;
      let checked = 0;
      for (const id of pageIds) {
        if (isAllSelected ? !excludedIds.has(id) : selectedIds.has(id)) {
          checked += 1;
        }
      }
      return checked > 0 && checked < pageIds.length;
    },
    [isAllSelected, excludedIds, selectedIds],
  );

  const getPageSelectedIds = useCallback(
    (pageIds: readonly string[]): Set<string> => {
      if (!isAllSelected) {
        return new Set(selectedIds);
      }
      const pageSet = new Set<string>();
      for (const id of pageIds) {
        if (!excludedIds.has(id)) {
          pageSet.add(id);
        }
      }
      return pageSet;
    },
    [isAllSelected, selectedIds, excludedIds],
  );

  const toggleRow = useCallback(
    (id: string) => {
      if (isAllSelected) {
        setExcludedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          if (totalCount > 0 && next.size >= totalCount) {
            setIsAllSelected(false);
            setSelectedIds(new Set());
            return new Set();
          }
          return next;
        });
        return;
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [isAllSelected, totalCount],
  );

  const togglePage = useCallback(
    (pageIds: readonly string[]) => {
      if (pageIds.length === 0) return;

      if (isAllSelected) {
        const allCheckedOnPage = pageIds.every((id) => !excludedIds.has(id));
        if (allCheckedOnPage) {
          // Снять всю страницу когда уже выбраны все на текущей — трактуем как «снять всё»
          clear();
        } else {
          // Доткнуть отсутствующие на странице -> убираем из excludedIds
          setExcludedIds((prev) => {
            const next = new Set(prev);
            for (const id of pageIds) {
              next.delete(id);
            }
            return next;
          });
        }
        return;
      }

      const allCheckedOnPage = pageIds.every((id) => selectedIds.has(id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (allCheckedOnPage) {
          for (const id of pageIds) next.delete(id);
        } else {
          for (const id of pageIds) next.add(id);
        }
        return next;
      });
    },
    [isAllSelected, excludedIds, selectedIds, clear],
  );

  const onPageSelectionChange = useCallback(
    (nextPageSelected: Set<string>, pageIds: readonly string[]) => {
      if (isAllSelected) {
        // Если RecordTable.toggleAll сбросил всю страницу (>1 строки) в пустой Set — снимаем всё выделение.
        if (nextPageSelected.size === 0 && pageIds.length > 1) {
          const prevCheckedCount = pageIds.filter((id) => !excludedIds.has(id)).length;
          if (prevCheckedCount === pageIds.length) {
            clear();
            return;
          }
        }

        setExcludedIds((prev) => {
          const nextExcluded = new Set(prev);
          for (const id of pageIds) {
            if (nextPageSelected.has(id)) {
              nextExcluded.delete(id);
            } else {
              nextExcluded.add(id);
            }
          }
          if (totalCount > 0 && nextExcluded.size >= totalCount) {
            setIsAllSelected(false);
            setSelectedIds(new Set());
            return new Set();
          }
          return nextExcluded;
        });
        return;
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of pageIds) {
          next.delete(id);
        }
        for (const id of nextPageSelected) {
          next.add(id);
        }
        return next;
      });
    },
    [isAllSelected, excludedIds, totalCount, clear],
  );

  const selectAllAcrossPages = useCallback(() => {
    setIsAllSelected(true);
    setExcludedIds(new Set());
    setSelectedIds(new Set());
  }, []);

  const buildBulkPayload = useCallback(
    <TFilters extends Record<string, unknown>>(filters?: TFilters): TableBulkActionPayload<TFilters> => {
      if (isAllSelected) {
        const payload: {
          mode: "all";
          filters?: TFilters;
          excluded_ids?: string[];
        } = { mode: "all" };
        if (filters) {
          payload.filters = filters;
        }
        if (excludedIds.size > 0) {
          payload.excluded_ids = Array.from(excludedIds);
        }
        return payload;
      }
      return {
        mode: "ids",
        ids: Array.from(selectedIds),
      };
    },
    [isAllSelected, excludedIds, selectedIds],
  );

  return {
    selectedIds,
    excludedIds,
    isAllSelected,
    excludedCount: excludedIds.size,
    effectiveSelectedCount,
    getPageSelectedIds,
    isRowSelected,
    isPageAllSelected,
    isPagePartiallySelected,
    toggleRow,
    togglePage,
    onPageSelectionChange,
    selectAllAcrossPages,
    clear,
    buildBulkPayload,
  };
}
