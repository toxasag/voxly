"use client";

import { memo, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Printer,
  Download,
  FileText,
  CheckCircle2,
  CloudUpload,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import type { Invoice } from "@/lib/finance/invoices.types";
import { getInvoiceStatusLabel, getInvoiceStatusColors } from "@/lib/finance/invoices.types";
import {
  fetchInvoiceRfHtml,
  openInvoiceRfPrintWindow,
  useDeleteInvoice,
  useFinanceOrganizations,
  useSyncInvoiceToElba,
} from "@/lib/api/use-invoices";
import { apiClient, triggerBrowserDownload } from "@/lib/api/apiClient";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { InvoicePaymentModal } from "@/components/finance/InvoicePaymentModal";
import { InvoiceEditModal } from "@/components/finance/InvoiceEditModal";
import { Guard } from "@/components/shared/Guard";
import { cn } from "@/lib/utils";

interface InvoiceViewModalProps {
  open: boolean;
  invoice: Invoice | null;
  onClose: () => void;
}

export const InvoiceViewModal = memo(function InvoiceViewModal({
  open,
  invoice,
  onClose,
}: InvoiceViewModalProps) {
  const [payModalOpen, setPayModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [loadingHtml, setLoadingHtml] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const { data: organizations = [] } = useFinanceOrganizations();
  const syncElba = useSyncInvoiceToElba();
  const deleteInvoice = useDeleteInvoice();

  const hasElbaConfigured = organizations.some(
    (o) => o.elbaEnabled && o.elbaHasApiKey && o.elbaOrganizationId,
  );

  useEffect(() => {
    if (!open || !invoice) {
      setPreviewHtml("");
      return;
    }
    let cancelled = false;
    setLoadingHtml(true);
    fetchInvoiceRfHtml(invoice.id, false)
      .then((html) => {
        if (!cancelled) setPreviewHtml(html);
      })
      .catch(() => {
        if (!cancelled) setPreviewHtml("");
      })
      .finally(() => {
        if (!cancelled) setLoadingHtml(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, invoice?.id, reloadTick]);

  const handlePrint = useCallback(async () => {
    if (!invoice) return;
    try {
      await openInvoiceRfPrintWindow(invoice.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось открыть печать счёта");
    }
  }, [invoice]);

  const handleDownloadPdf = useCallback(async () => {
    if (!invoice) return;
    try {
      setDownloadingPdf(true);
      const { blob } = await apiClient.downloadBlob(`/api/v1/invoices/${invoice.id}/pdf`);
      triggerBrowserDownload(blob, `Invoice-${invoice.invoice_number}.pdf`);
      toast.success(`PDF счёта №${invoice.invoice_number} скачан`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось скачать PDF");
    } finally {
      setDownloadingPdf(false);
    }
  }, [invoice]);

  const handleSyncElba = useCallback(async () => {
    if (!invoice) return;
    try {
      await syncElba.mutateAsync(invoice.id);
      toast.success(`Счёт №${invoice.invoice_number} выгружен в Контур.Эльбу`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось выгрузить счёт в Эльбу");
    }
  }, [invoice, syncElba]);

  const handleDelete = useCallback(async () => {
    if (!invoice) return;
    if (invoice.status === "paid") {
      toast.error("Оплаченный счёт нельзя удалить");
      return;
    }
    if (!window.confirm(`Удалить счёт № ${invoice.invoice_number}?`)) return;
    try {
      await deleteInvoice.mutateAsync(invoice.id);
      toast.success(`Счёт № ${invoice.invoice_number} удалён`);
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить счёт");
    }
  }, [invoice, deleteInvoice, onClose]);

  if (!open || !invoice) return null;

  const isPaid = invoice.status === "paid";

  return (
    <>
      <Sheet open={open} onClose={onClose} width="w-[820px]" resizable>
        <SheetHeader onClose={onClose}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">
                Счёт № {invoice.invoice_number}
              </h2>
              <p className="text-xs text-[#666666]">Просмотр и печать счёта (стандарт РФ)</p>
            </div>
          </div>
        </SheetHeader>

        <SheetContent className="flex flex-col h-full bg-[#f8f9fa] text-[#111111]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e5e5] bg-white px-6 py-3">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  getInvoiceStatusColors(invoice.status),
                )}
              >
                {getInvoiceStatusLabel(invoice.status)}
              </span>
              {invoice.elba_bill_id && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  В Контур.Эльбе
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isPaid && invoice.status !== "cancelled" && (
                <Guard requiredPermission="finance:write">
                  <button
                    type="button"
                    onClick={() => setPayModalOpen(true)}
                    className="flex h-8 items-center gap-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Принять оплату
                  </button>
                </Guard>
              )}

              {!isPaid && (
                <Guard requiredPermission="finance:write">
                  <button
                    type="button"
                    onClick={() => setEditModalOpen(true)}
                    className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5 text-[#666666]" />
                    Редактировать
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete()}
                    disabled={deleteInvoice.isPending}
                    className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer disabled:opacity-50"
                    title="Удалить счёт"
                  >
                    {deleteInvoice.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    Удалить
                  </button>
                </Guard>
              )}

              {hasElbaConfigured && !invoice.elba_bill_id && (
                <Guard requiredPermission="finance:write">
                  <button
                    type="button"
                    onClick={() => void handleSyncElba()}
                    disabled={syncElba.isPending}
                    className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {syncElba.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                    ) : (
                      <CloudUpload className="h-3.5 w-3.5 text-[#4a38f5]" />
                    )}
                    В Эльбу
                  </button>
                </Guard>
              )}

              <button
                type="button"
                onClick={() => void handleDownloadPdf()}
                disabled={downloadingPdf}
                className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50"
              >
                {downloadingPdf ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                ) : (
                  <Download className="h-3.5 w-3.5 text-[#666666]" />
                )}
                PDF
              </button>

              <button
                type="button"
                onClick={() => void handlePrint()}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-semibold text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5" />
                Печать
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-5">
            {loadingHtml ? (
              <div className="flex items-center justify-center h-[520px] rounded-[8px] border border-[#e5e5e5] bg-white">
                <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
              </div>
            ) : previewHtml ? (
              <iframe
                title={`Счёт № ${invoice.invoice_number}`}
                srcDoc={previewHtml}
                className="w-full h-[780px] rounded-[8px] border border-[#e5e5e5] bg-white shadow-xs"
              />
            ) : (
              <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 text-center text-xs text-[#666666]">
                Не удалось загрузить форму счёта. Попробуйте нажать «Печать» или «PDF».
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <InvoicePaymentModal
        open={payModalOpen}
        invoice={invoice}
        onClose={() => setPayModalOpen(false)}
        onSuccess={() => {
          setPayModalOpen(false);
          onClose();
        }}
      />

      <InvoiceEditModal
        open={editModalOpen}
        invoice={{
          id: invoice.id,
          invoiceNumber: invoice.invoice_number,
          status: invoice.status,
          dueDate: invoice.due_date,
          issuerOrganizationId: invoice.issuer_organization_id ?? null,
          companyName: invoice.company_name,
          companyInn: invoice.company_inn,
          companyAddress: invoice.company_address,
          contactName: invoice.contact_name,
          contactPhone: invoice.contact_phone,
          vatMode: invoice.vat_mode,
          vatRate: invoice.vat_rate,
          notes: invoice.notes,
          lineItems: invoice.line_items.map((li) => ({
            id: li.id,
            description: li.description,
            quantity: li.quantity,
            unitPrice: li.unit_price,
            source: li.source,
            sourceLabel: li.source_label,
          })),
        }}
        onClose={() => setEditModalOpen(false)}
        onSaved={() => {
          setReloadTick((t) => t + 1);
        }}
      />
    </>
  );
});
