"use client";

import { useCallback, useEffect, useState } from "react";

import {
  readLegacyRecordTableLayout,
  writeLegacyRecordTableLayout,
  type ColumnLayout,
} from "@/components/crm/shared/use-record-table-layout";
import {
  useRecordTableLayoutQuery,
  useSaveRecordTableLayout,
} from "@/lib/api/use-record-table-layouts";

const TABLE_ID = "deals";
export const DEFAULT_KANBAN_COLUMN_WIDTH = 280;
export const MIN_KANBAN_COLUMN_WIDTH = 200;
export const MAX_KANBAN_COLUMN_WIDTH = 480;

function clampWidth(value: number): number {
  return Math.min(MAX_KANBAN_COLUMN_WIDTH, Math.max(MIN_KANBAN_COLUMN_WIDTH, Math.round(value)));
}

function normalizeWidth(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? clampWidth(value) : null;
}

export function useKanbanColumnWidth(): {
  width: number;
  setWidth: (next: number) => void;
} {
  const remote = useRecordTableLayoutQuery(TABLE_ID);
  const save = useSaveRecordTableLayout();
  const [width, setLocal] = useState(DEFAULT_KANBAN_COLUMN_WIDTH);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    if (remote.isPending) return;

    const fromServer = remote.isSuccess
      ? normalizeWidth(remote.data?.layout.kanbanColumnWidth)
      : null;
    if (fromServer !== null) {
      setLocal(fromServer);
      setInitialized(true);
      return;
    }

    const stored = normalizeWidth(readLegacyRecordTableLayout(TABLE_ID)?.kanbanColumnWidth);
    setLocal(stored ?? DEFAULT_KANBAN_COLUMN_WIDTH);
    setInitialized(true);
  }, [initialized, remote.data, remote.isPending, remote.isSuccess]);

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clampWidth(next);
      setLocal(clamped);

      const base: ColumnLayout =
        remote.data?.layout ??
        readLegacyRecordTableLayout(TABLE_ID) ?? { widths: {}, order: [], hidden: [] };
      const layout: ColumnLayout = { ...base, kanbanColumnWidth: clamped };
      writeLegacyRecordTableLayout(TABLE_ID, layout);
      if (remote.isSuccess) save.mutate({ tableId: TABLE_ID, layout });
    },
    [remote.data, remote.isSuccess, save],
  );

  return { width, setWidth };
}
