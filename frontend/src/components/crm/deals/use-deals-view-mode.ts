"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readLegacyRecordTableLayout,
  writeLegacyRecordTableLayout,
  type ColumnLayout,
  type RecordViewMode,
} from "@/components/crm/shared/use-record-table-layout";
import {
  useRecordTableLayoutQuery,
  useSaveRecordTableLayout,
} from "@/lib/api/use-record-table-layouts";

// ---------------------------------------------------------------------------
// Режим отображения сделок: канбан или список.
//
// До этого вид жил в `useState("kanban")` и сбрасывался при каждом заходе на
// страницу: менеджер, работающий списком, каждый раз возвращался в канбан.
//
// Хранится внутри раскладки таблицы сделок, а не отдельным ключом: это часть
// представления, и план прямо требует держать `view_mode` рядом с раскладкой.
// Побочно вид переезжает между браузерами — как и ширины колонок.
//
// Приоритет тот же, что у раскладки: сервер важнее локального кэша, но до ответа
// сервера показывается локальное значение, иначе канбан мигал бы при каждой
// загрузке страницы.
// ---------------------------------------------------------------------------

const TABLE_ID = "deals";
const DEFAULT_VIEW: RecordViewMode = "kanban";

/** Неизвестное значение читается как умолчание: испорченная запись не ломает экран. */
function normalizeViewMode(value: unknown): RecordViewMode | null {
  return value === "kanban" || value === "table" || value === "calendar" ? value : null;
}

export interface DealsViewModeResult {
  viewMode: RecordViewMode;
  setViewMode: (next: RecordViewMode) => void;
}

export function useDealsViewMode(): DealsViewModeResult {
  const remote = useRecordTableLayoutQuery(TABLE_ID);
  const save = useSaveRecordTableLayout();
  const [viewMode, setLocalViewMode] = useState<RecordViewMode>(DEFAULT_VIEW);

  /**
   * Начальное значение применяется один раз.
   *
   * Без этого флага эффект перезаписывал бы выбор пользователя: он срабатывает и
   * на обновление `remote.data` после собственного PUT, то есть переключение
   * вида откатывалось бы к прежнему значению из кэша запроса.
   */
  const [initialized, setInitialized] = useState(false);

  // Чтение в эффекте, а не в инициализаторе состояния: localStorage недоступен
  // при SSR, и чтение на первом рендере расходилось бы с разметкой сервера.
  useEffect(() => {
    if (initialized) return;
    // Пока GET не завершился — ждём: локальный кэш подставится, если сервер
    // ответит отказом или пустой раскладкой.
    if (remote.isPending) return;

    const fromServer = remote.isSuccess
      ? normalizeViewMode(remote.data?.layout.viewMode)
      : null;

    if (fromServer !== null) {
      setLocalViewMode(fromServer);
      setInitialized(true);
      return;
    }

    // Сервер молчит или там нет режима — берём локальный кэш. Отказ GET это
    // offline, а не «на сервере канбан».
    const stored = normalizeViewMode(readLegacyRecordTableLayout(TABLE_ID)?.viewMode);
    setLocalViewMode(stored ?? DEFAULT_VIEW);
    setInitialized(true);
  }, [initialized, remote.isPending, remote.isSuccess, remote.data]);

  const setViewMode = useCallback(
    (next: RecordViewMode) => {
      // Локальное состояние меняется первым: переключатель вида должен
      // отзываться мгновенно, ожидание ответа читается как «кнопка не сработала».
      setLocalViewMode(next);

      // PUT заменяет раскладку целиком, поэтому сохраняется вся: иначе ширины и
      // порядок колонок были бы стёрты сменой вида.
      const base: ColumnLayout =
        remote.data?.layout ??
        readLegacyRecordTableLayout(TABLE_ID) ?? { widths: {}, order: [], hidden: [] };

      const layout: ColumnLayout = { ...base, viewMode: next };

      writeLegacyRecordTableLayout(TABLE_ID, layout);

      // На сервер только когда он подтвердил доступность: при недоступном GET
      // запись создала бы состояние, которого пользователь не выбирал на этом
      // устройстве.
      if (remote.isSuccess) save.mutate({ tableId: TABLE_ID, layout });
    },
    [remote.data, remote.isSuccess, save],
  );

  return { viewMode, setViewMode };
}
