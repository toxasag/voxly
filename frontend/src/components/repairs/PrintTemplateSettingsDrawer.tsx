"use client";

import { VisualPrintTemplateEditor, type VisualPrintTemplateEditorProps } from "./VisualPrintTemplateEditor";

export interface PrintTemplateSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  initialDocumentType?: string;
  orderId?: string;
  order?: any;
}

export function PrintTemplateSettingsDrawer({
  open,
  onClose,
  initialDocumentType = "work_order",
  orderId,
  order,
}: PrintTemplateSettingsDrawerProps) {
  return (
    <VisualPrintTemplateEditor
      open={open}
      onClose={onClose}
      initialDocumentType={initialDocumentType}
      orderId={orderId}
      order={order}
    />
  );
}

export { VisualPrintTemplateEditor };
