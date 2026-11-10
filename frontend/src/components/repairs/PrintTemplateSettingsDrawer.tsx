"use client";

import { VisualPrintTemplateEditor, type VisualPrintTemplateEditorProps } from "./VisualPrintTemplateEditor";

export interface PrintTemplateSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  initialDocumentType?: string;
  orderId?: string;
}

export function PrintTemplateSettingsDrawer({
  open,
  onClose,
  initialDocumentType = "work_order",
  orderId,
}: PrintTemplateSettingsDrawerProps) {
  return (
    <VisualPrintTemplateEditor
      open={open}
      onClose={onClose}
      initialDocumentType={initialDocumentType}
      orderId={orderId}
    />
  );
}

export { VisualPrintTemplateEditor };
