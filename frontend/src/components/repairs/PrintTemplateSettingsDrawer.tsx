"use client";

import { Sheet } from "@/components/ui/sheet";
import type { RepairPreviewSource } from "@/lib/repairs/print-presets-client";
import { VisualPrintTemplateEditor, type VisualPrintTemplateEditorProps } from "./VisualPrintTemplateEditor";

export interface PrintTemplateSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  initialDocumentType?: string;
  orderId?: string;
  order?: RepairPreviewSource | null;
}

export function PrintTemplateSettingsDrawer({
  open,
  onClose,
  initialDocumentType = "work_order",
  orderId,
  order,
}: PrintTemplateSettingsDrawerProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      width="w-full md:w-[1450px]"
      resizable
    >
      <VisualPrintTemplateEditor
        open={open}
        onClose={onClose}
        initialDocumentType={initialDocumentType}
        orderId={orderId}
        order={order}
        isDrawer
      />
    </Sheet>
  );
}

export { VisualPrintTemplateEditor };
