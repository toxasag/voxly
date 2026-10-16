"use client";

import { useCallback, useEffect, useRef } from "react";

import {
  useRecordTableLayoutQuery,
  useSaveRecordTableLayout,
  type CrmRecordTableId,
} from "@/lib/api/use-record-table-layouts";
import {
  readLegacyRecordTableLayout,
  type ColumnLayout,
} from "@/components/crm/shared/use-record-table-layout";

// ---------------------------------------------------------------------------
// Адаптер серверной синхронизации раскладки.
//
// `RecordTable` остаётся Query-free: его unit-тесты и локальные таблицы с
// произвольными id не требуют QueryProvider. Этот хук используют только четыре
// CRM-страницы с известными tableId, передавая результат в таблицу.
//
// Remote побеждает localStorage. Пока GET не завершился, `remoteLayout` undefined
// и таблица показывает локальный fallback. После GET с DTO remote применяется;
// после GET с null legacy localStorage мигрируется один раз. Ошибка GET означает
// offline fallback — локально работать можно, но нельзя утверждать, что сервер
// пуст, поэтому миграция не идёт.
// ---------------------------------------------------------------------------

export interface SyncedRecordTableLayout {
  /** undefined: GET ещё идёт/упал; null: сервер подтвердил отсутствие записи. */
  remoteLayout: ColumnLayout | null | undefined;
  persist: (layout: ColumnLayout) => void;
}

export function useSyncedRecordTableLayout(
  tableId: CrmRecordTableId,
): SyncedRecordTableLayout {
  const remote = useRecordTableLayoutQuery(tableId);
  const save = useSaveRecordTableLayout();
  const migrated = useRef(false);

  const persist = useCallback(
    (layout: ColumnLayout) => {
      // Локальный отклик уже применён таблицей. Серверное сохранение полное;
      // последний завершившийся PUT выигрывает — для пользовательской настройки
      // это приемлемо, ETag/конфликт потребовал бы нового контракта API.
      save.mutate({ tableId, layout });
    },
    [save, tableId],
  );

  useEffect(() => {
    if (!remote.isSuccess || remote.data !== null || migrated.current) return;

    const stored = readLegacyRecordTableLayout(tableId);
    if (stored === null) {
      migrated.current = true;
      return;
    }

    migrated.current = true;
    save.mutate({ tableId, layout: stored });
  }, [remote.isSuccess, remote.data, save, tableId]);

  return {
    remoteLayout: remote.isSuccess ? remote.data?.layout ?? null : undefined,
    persist,
  };
}
