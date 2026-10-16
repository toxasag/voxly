"use client";

import { RecordTable, type RecordTableProps } from "@/components/crm/shared/RecordTable";
import { useSyncedRecordTableLayout } from "@/components/crm/shared/use-synced-record-table-layout";
import type { CrmRecordTableId } from "@/lib/api/use-record-table-layouts";

type SyncedRecordTableProps<T> = Omit<RecordTableProps<T>, "remoteLayout" | "onLayoutPersist" | "tableId"> & {
  tableId: CrmRecordTableId;
};

export function SyncedRecordTable<T>(props: SyncedRecordTableProps<T>) {
  const { tableId, ...rest } = props;
  const sync = useSyncedRecordTableLayout(tableId);

  return (
    <RecordTable
      {...rest}
      tableId={tableId}
      remoteLayout={sync.remoteLayout}
      onLayoutPersist={sync.persist}
    />
  );
}
