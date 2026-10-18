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
  columnWidths: Record<string, number>;
  setColumnWidth: (stageId: string, next: number) => void;
} {
  const remote = useRecordTableLayoutQuery(TABLE_ID);
  const save = useSaveRecordTableLayout();
  const [width, setLocal] = useState(DEFAULT_KANBAN_COLUMN_WIDTH);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized) return;
    if (remote.isPending) return;

    const fromServer = remote.isSuccess
      ? normalizeWidth(remote.data?.layout.kanbanColumnWidth)
      : null;
    const serverWidths = remote.isSuccess && remote.data?.layout.kanbanColumnWidths
      ? remote.data.layout.kanbanColumnWidths
      : undefined;

    if (fromServer !== null || serverWidths !== undefined) {
      if (fromServer !== null) setLocal(fromServer);
      if (serverWidths !== undefined) setColumnWidths(serverWidths);
      setInitialized(true);
      return;
    }

    const legacy = readLegacyRecordTableLayout(TABLE_ID);
    const stored = normalizeWidth(legacy?.kanbanColumnWidth);
    setLocal(stored ?? DEFAULT_KANBAN_COLUMN_WIDTH);
    if (legacy?.kanbanColumnWidths) {
      setColumnWidths(legacy.kanbanColumnWidths);
    }
    setInitialized(true);
  }, [initialized, remote.data, remote.isPending, remote.isSuccess]);

  const setWidth = useCallback(
    (next: number) => {
      const clamped = clampWidth(next);
      setLocal(clamped);

      const base: ColumnLayout =
        remote.data?.layout ??
        readLegacyRecordTableLayout(TABLE_ID) ?? { widths: {}, order: [], hidden: [] };
      const layout: ColumnLayout = { ...base, kanbanColumnWidth: clamped, kanbanColumnWidths: columnWidths };
      writeLegacyRecordTableLayout(TABLE_ID, layout);
      if (remote.isSuccess) save.mutate({ tableId: TABLE_ID, layout });
    },
    [columnWidths, remote.data, remote.isSuccess, save],
  );

  const setColumnWidth = useCallback(
    (stageId: string, next: number) => {
      const clamped = clampWidth(next);
      setColumnWidths((prev) => {
        const updated = { ...prev, [stageId]: clamped };
        const base: ColumnLayout =
          remote.data?.layout ??
          readLegacyRecordTableLayout(TABLE_ID) ?? { widths: {}, order: [], hidden: [] };
        const layout: ColumnLayout = { ...base, kanbanColumnWidths: updated };
        writeLegacyRecordTableLayout(TABLE_ID, layout);
        if (remote.isSuccess) save.mutate({ tableId: TABLE_ID, layout });
        return updated;
      });
    },
    [remote.data, remote.isSuccess, save],
  );

  return { width, setWidth, columnWidths, setColumnWidth };
}
