"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  CloudUpload,
  Download,
  FileText,
  Loader2,
  Mail,
  MessageCircle,
  Pencil,
  Printer,
  Receipt,
  Send,
  Trash2,
} from "lucide-react";
import { Guard } from "@/components/shared/Guard";
import {
  InvoiceEditModal,
  type EditableInvoiceData,
} from "@/components/finance/InvoiceEditModal";
import { GenerateDealDocumentModal } from "@/components/crm/deals/GenerateDealDocumentModal";
import { apiClient } from "@/lib/api/apiClient";
import type { DealDTO, DealItemDTO } from "@/lib/api/use-deals";
import {
  openInvoiceRfPrintWindow,
  useCreateInvoice,
  useDeleteInvoice,
  useFinanceOrganizations,
  useInvoices,
  useMarkInvoicePaid,
  useSendInvoice,
  useSyncInvoiceToElba,
  type InvoiceDocumentType,
  type InvoiceDTO,
  type SendInvoicePayload,
} from "@/lib/api/use-invoices";
import { cn, toLocalDateKey } from "@/lib/utils";
import { formatRub } from "@/lib/utils/format";

interface DealDocumentsSectionProps {
  deal: DealDTO;
  items: DealItemDTO[];
}

interface SendMenuState {
  doc: InvoiceDTO;
  top: number;
  left: number;
}

const STATUS_BADGE: Record<
  InvoiceDTO["status"],
  { invoiceLabel: string; proposalLabel: string; cls: string }
> = {
  draft: {
    invoiceLabel: "Черновик",
    proposalLabel: "Черновик",
    cls: "bg-[#f3f4f6] text-[#555555] border-[#e5e5e5]",
  },
  sent: {
    invoiceLabel: "Выставлен",
    proposalLabel: "Отправлено",
    cls: "bg-sky-50 text-sky-700 border-sky-200",
  },
  paid: {
    invoiceLabel: "Оплачен",
    proposalLabel: "Согласовано",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  overdue: {
    invoiceLabel: "Просрочен",
    proposalLabel: "Истёк срок",
    cls: "bg-rose-50 text-rose-700 border-rose-200",
  },
  cancelled: {
    invoiceLabel: "Отменён",
    proposalLabel: "Отменено",
    cls: "bg-[#f3f4f6] text-[#888888] border-[#e5e5e5]",
  },
};

function formatShortDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export const DealDocumentsSection = memo(function DealDocumentsSection({
  deal,
  items,
}: DealDocumentsSectionProps) {
  const {
    data: docsRes,
    isLoading,
    refetch: refetchDocs,
  } = useInvoices({
    dealId: deal.id,
    documentType: "all",
    limit: 50,
    sortBy: "created_at",
    sortDir: "desc",
  });
  const documents = docsRes?.items ?? [];

  const { data: organizations = [] } = useFinanceOrganizations();
  const hasElbaConfigured = organizations.some(
    (o) => o.elbaEnabled && o.elbaHasApiKey && o.elbaOrganizationId,
  );

  const sendInvoice = useSendInvoice();
  const deleteInvoice = useDeleteInvoice();
  const markInvoicePaid = useMarkInvoicePaid();
  const syncElba = useSyncInvoiceToElba();
  const createInvoice = useCreateInvoice();

  const [generatorType, setGeneratorType] = useState<InvoiceDocumentType | null>(null);
  const [editingDoc, setEditingDoc] = useState<InvoiceDTO | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [syncingElbaId, setSyncingElbaId] = useState<string | null>(null);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  const [sendMenuState, setSendMenuState] = useState<SendMenuState | null>(null);
  const [customEmail, setCustomEmail] = useState<string>("");
  const [showEmailInput, setShowEmailInput] = useState(false);
  const sendMenuRef = useRef<HTMLDivElement>(null);

  const defaultClientEmail = (deal.contactEmail || deal.companyEmail || "").trim();

  useEffect(() => {
    if (!sendMenuState) return;
    const onPointerDown = (e: MouseEvent) => {
      if (sendMenuRef.current && !sendMenuRef.current.contains(e.target as Node)) {
        setSendMenuState(null);
        setShowEmailInput(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSendMenuState(null);
        setShowEmailInput(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sendMenuState]);

  const hasBillableItems = items.some((it) => it.totalAmount > 0 || it.price > 0);

  const handlePrint = useCallback(async (doc: InvoiceDTO) => {
    try {
      setPrintingId(doc.id);
      await openInvoiceRfPrintWindow(doc.id);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось открыть печатную форму");
    } finally {
      setPrintingId(null);
    }
  }, []);

  const handleDownloadPdf = useCallback(async (doc: InvoiceDTO) => {
    try {
      setDownloadingId(doc.id);
      const isProposal = doc.documentType === "proposal";
      const { blob } = await apiClient.downloadBlob(`/api/v1/invoices/${doc.id}/pdf`);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${isProposal ? "KP" : "Invoice"}-${doc.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast.success(
        isProposal
          ? `PDF КП № ${doc.invoiceNumber} скачан`
          : `PDF счёта № ${doc.invoiceNumber} скачан`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось скачать PDF");
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const handleSend = useCallback(
    async (
      doc: InvoiceDTO,
      channelType: SendInvoicePayload["channel_type"],
      recipientEmail?: string,
    ) => {
      setSendMenuState(null);
      setShowEmailInput(false);
      try {
        setSendingId(doc.id);
        const res = await sendInvoice.mutateAsync({
          id: doc.id,
          channel_type: channelType,
          recipient_email: recipientEmail?.trim() || undefined,
        });
        toast.success(res.message || "Документ отправлен клиенту");
        void refetchDocs();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Не удалось отправить документ");
      } finally {
        setSendingId(null);
      }
    },
    [sendInvoice, refetchDocs],
  );

  const handleConvertProposalToInvoice = useCallback(
    async (proposal: InvoiceDTO) => {
      try {
        setConvertingId(proposal.id);
        const created = await createInvoice.mutateAsync({
          document_type: "invoice",
          issuer_organization_id: proposal.issuerOrganizationId || undefined,
          company_id: proposal.companyId || deal.companyId || undefined,
          company_name: proposal.companyName || deal.companyName || deal.contactName || deal.title,
          company_inn: proposal.companyInn || "",
          company_address: proposal.companyAddress || "",
          contact_name: proposal.contactName || deal.contactName || "",
          contact_phone: proposal.contactPhone || deal.contactPhone || "",
          deal_id: deal.id,
          due_date: toLocalDateKey(new Date(Date.now() + 3 * 86400 * 1000)),
          vat_mode: proposal.vatMode,
          vat_rate: proposal.vatRate,
          currency: proposal.currency || "RUB",
          notes: proposal.notes || `По КП № ${proposal.invoiceNumber}`,
          line_items: proposal.lineItems.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            unit_price: li.unitPrice,
            source: li.source || "deal",
            source_label: li.sourceLabel || "",
          })),
        });
        toast.success(`Счёт № ${created.invoiceNumber} сформирован на основе КП № ${proposal.invoiceNumber}`);
        void refetchDocs();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Не удалось сформировать счёт из КП");
      } finally {
        setConvertingId(null);
      }
    },
    [createInvoice, deal, refetchDocs],
  );

  const handleMarkPaid = useCallback(
    async (doc: InvoiceDTO) => {
      if (doc.status === "paid" || doc.documentType === "proposal") return;
      try {
        setMarkingPaidId(doc.id);
        await markInvoicePaid.mutateAsync({ id: doc.id, payload: {} });
        toast.success(`Счёт № ${doc.invoiceNumber} отмечен как оплаченный`);
        void refetchDocs();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Не удалось отметить оплату");
      } finally {
        setMarkingPaidId(null);
      }
    },
    [markInvoicePaid, refetchDocs],
  );

  const handleSyncToElba = useCallback(
    async (doc: InvoiceDTO) => {
      try {
        setSyncingElbaId(doc.id);
        await syncElba.mutateAsync(doc.id);
        toast.success(`Счёт № ${doc.invoiceNumber} выгружен в Контур.Эльбу`);
        void refetchDocs();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Не удалось выгрузить счёт в Эльбу");
      } finally {
        setSyncingElbaId(null);
      }
    },
    [syncElba, refetchDocs],
  );

  const handleDelete = useCallback(
    async (doc: InvoiceDTO) => {
      if (doc.status === "paid") {
        toast.error("Оплаченный счёт нельзя удалить");
        return;
      }
      const isProposal = doc.documentType === "proposal";
      if (
        !window.confirm(
          isProposal
            ? `Удалить коммерческое предложение № ${doc.invoiceNumber}?`
            : `Удалить счёт № ${doc.invoiceNumber}?`,
        )
      ) {
        return;
      }
      try {
        setDeletingId(doc.id);
        await deleteInvoice.mutateAsync(doc.id);
        toast.success(
          isProposal
            ? `КП № ${doc.invoiceNumber} удалено`
            : `Счёт № ${doc.invoiceNumber} удалён`,
        );
        void refetchDocs();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить документ");
      } finally {
        setDeletingId(null);
      }
    },
    [deleteInvoice, refetchDocs],
  );

  const editableDoc: EditableInvoiceData | null = editingDoc
    ? {
        id: editingDoc.id,
        invoiceNumber: editingDoc.invoiceNumber,
        status: editingDoc.status,
        dueDate: editingDoc.dueDate,
        issuerOrganizationId: editingDoc.issuerOrganizationId ?? null,
        companyName: editingDoc.companyName,
        companyInn: editingDoc.companyInn,
        companyAddress: editingDoc.companyAddress,
        contactName: editingDoc.contactName,
        contactPhone: editingDoc.contactPhone,
        vatMode: editingDoc.vatMode,
        vatRate: editingDoc.vatRate,
        notes: editingDoc.notes,
        lineItems: editingDoc.lineItems,
      }
    : null;

  return (
    <Guard requiredModule="finance" requiredPermission="finance:read">
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
        {/* Header + action buttons */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e5e5] px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#4a38f5]" />
            <h4 className="text-xs font-semibold text-[#111111]">
              Документы по сделке (КП и счета)
              {documents.length > 0 && (
                <span className="ml-1.5 font-mono text-[11px] font-normal text-[#888888]">
                  ({documents.length})
                </span>
              )}
            </h4>
          </div>

          <Guard requiredPermission="finance:write">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setGeneratorType("proposal")}
                disabled={!hasBillableItems}
                title={
                  hasBillableItems
                    ? "Сформировать коммерческое предложение из товаров и услуг сделки"
                    : "Сначала добавьте товары или услуги с ценой"
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#4a38f5]/30 bg-[#4a38f5]/5 px-2.5 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Сформировать КП</span>
              </button>
              <button
                type="button"
                onClick={() => setGeneratorType("invoice")}
                disabled={!hasBillableItems}
                title={
                  hasBillableItems
                    ? "Сформировать счёт на оплату из товаров и услуг сделки"
                    : "Сначала добавьте товары или услуги с ценой"
                }
                className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-2.5 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Receipt className="h-3.5 w-3.5" />
                <span>Сформировать счёт</span>
              </button>
            </div>
          </Guard>
        </div>

        {/* Body */}
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-[#666666]">
            <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
            <span>Загрузка документов...</span>
          </div>
        ) : documents.length === 0 ? (
          <div className="px-4 py-5 text-center text-xs text-[#888888]">
            {hasBillableItems
              ? "КП и счета по этой сделке ещё не сформированы. Нажмите «Сформировать КП» или «Сформировать счёт» выше."
              : "Добавьте товары или услуги с ценой, чтобы сформировать коммерческое предложение или счёт."}
          </div>
        ) : (
          <div className="divide-y divide-[#f0f0f0]">
            {documents.map((doc) => {
              const isProposal = doc.documentType === "proposal";
              const isPaid = doc.status === "paid";
              const badge = STATUS_BADGE[doc.status] ?? STATUS_BADGE.draft;
              const isPrinting = printingId === doc.id;
              const isDownloading = downloadingId === doc.id;
              const isSending = sendingId === doc.id;
              const isSendMenuOpen = sendMenuState?.doc.id === doc.id;

              return (
                <div
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 hover:bg-[#fafafa] transition-colors"
                >
                  {/* Left: type badge + number + date + status */}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-[4px] border px-1.5 py-0.5 text-[10px] font-semibold",
                          isProposal
                            ? "border-[#4a38f5]/25 bg-[#4a38f5]/10 text-[#4a38f5]"
                            : "border-sky-200 bg-sky-50 text-sky-700",
                        )}
                      >
                        {isProposal ? "КП" : "Счёт"}
                      </span>
                      <span className="font-mono text-xs font-semibold text-[#111111]">
                        № {doc.invoiceNumber}
                      </span>
                      <span className="text-[11px] text-[#888888]">
                        от {formatShortDate(doc.issueDate)}
                      </span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
                          badge.cls,
                        )}
                      >
                        {isProposal ? badge.proposalLabel : badge.invoiceLabel}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#666666]">
                      <span className="truncate max-w-[260px]">
                        {doc.companyName || doc.contactName || "Клиент"}
                      </span>
                      {doc.dueDate && (
                        <span className="text-[#888888]">
                          · {isProposal ? "действует до" : "оплатить до"}{" "}
                          <span className="font-mono">{formatShortDate(doc.dueDate)}</span>
                        </span>
                      )}
                      {doc.lineItems && doc.lineItems.length > 0 && (
                        <span className="text-[#888888]">· {doc.lineItems.length} поз.</span>
                      )}
                    </div>
                  </div>

                  {/* Right: amount + actions */}
                  <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                    <span className="mr-1 font-mono text-xs font-bold text-[#111111] tabular-nums">
                      {formatRub(doc.total)}
                    </span>

                    {/* Печать */}
                    <button
                      type="button"
                      onClick={() => void handlePrint(doc)}
                      disabled={isPrinting}
                      title={isProposal ? "Распечатать КП" : "Распечатать счёт"}
                      className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-[11px] font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isPrinting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                      ) : (
                        <Printer className="h-3.5 w-3.5 text-[#666666]" />
                      )}
                      <span className="hidden sm:inline">Печать</span>
                    </button>

                    {/* Скачать PDF */}
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(doc)}
                      disabled={isDownloading}
                      title={isProposal ? "Скачать КП в PDF" : "Скачать счёт в PDF"}
                      className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-[11px] font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {isDownloading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                      ) : (
                        <Download className="h-3.5 w-3.5 text-[#666666]" />
                      )}
                      <span className="hidden sm:inline">PDF</span>
                    </button>

                    {/* Отправить клиенту */}
                    <Guard requiredPermission="finance:write">
                      <button
                        type="button"
                        disabled={isSending}
                        onClick={(e) => {
                          if (isSendMenuOpen) {
                            setSendMenuState(null);
                            setShowEmailInput(false);
                            return;
                          }
                          const rect = e.currentTarget.getBoundingClientRect();
                          const menuWidth = 240;
                          const left = Math.max(
                            8,
                            Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
                          );
                          const top = rect.bottom + 6;
                          setCustomEmail(defaultClientEmail);
                          setShowEmailInput(false);
                          setSendMenuState({ doc, top, left });
                        }}
                        title="Отправить PDF клиенту в мессенджер или на E-mail"
                        className={cn(
                          "inline-flex h-7 items-center gap-1 rounded-[6px] border bg-white px-2 text-[11px] font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50",
                          isSendMenuOpen ? "border-[#4a38f5] bg-[#4a38f5]/5" : "border-[#e5e5e5]",
                        )}
                      >
                        {isSending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                        ) : (
                          <Send className="h-3.5 w-3.5 text-[#4a38f5]" />
                        )}
                        <span className="hidden sm:inline">Отправить</span>
                        <ChevronDown className="h-3 w-3 text-[#888888]" />
                      </button>
                    </Guard>

                    {/* Для КП: быстро создать счёт */}
                    {isProposal && (
                      <Guard requiredPermission="finance:write">
                        <button
                          type="button"
                          onClick={() => void handleConvertProposalToInvoice(doc)}
                          disabled={convertingId === doc.id}
                          title="Сформировать счёт на оплату на основе этого КП"
                          className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-[11px] font-medium text-[#111111] hover:border-[#4a38f5]/40 hover:text-[#4a38f5] transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {convertingId === doc.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                          ) : (
                            <Receipt className="h-3.5 w-3.5 text-[#4a38f5]" />
                          )}
                          <span className="hidden md:inline">Счёт из КП</span>
                        </button>
                      </Guard>
                    )}

                    {/* Для Счёта: Эльба и быстрая отметка оплаты */}
                    {!isProposal && (
                      <>
                        {doc.elbaBillId ? (
                          <span
                            title={`Выгружен в Контур.Эльбу (ID: ${doc.elbaBillId})`}
                            className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            <span>Эльба</span>
                          </span>
                        ) : hasElbaConfigured ? (
                          <Guard requiredPermission="finance:write">
                            <button
                              type="button"
                              onClick={() => void handleSyncToElba(doc)}
                              disabled={syncingElbaId === doc.id}
                              title="Выгрузить счёт в Контур.Эльбу"
                              className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-[11px] font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {syncingElbaId === doc.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                              ) : (
                                <CloudUpload className="h-3.5 w-3.5 text-[#4a38f5]" />
                              )}
                              <span className="hidden md:inline">В Эльбу</span>
                            </button>
                          </Guard>
                        ) : null}

                        {!isPaid && doc.status !== "cancelled" && (
                          <Guard requiredPermission="finance:write">
                            <button
                              type="button"
                              onClick={() => void handleMarkPaid(doc)}
                              disabled={markingPaidId === doc.id}
                              title="Отметить счёт как оплаченный"
                              className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {markingPaidId === doc.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              <span className="hidden md:inline">Оплачен</span>
                            </button>
                          </Guard>
                        )}
                      </>
                    )}

                    {/* Редактировать / Удалить */}
                    {!isPaid && (
                      <Guard requiredPermission="finance:write">
                        <button
                          type="button"
                          onClick={() => setEditingDoc(doc)}
                          title="Редактировать документ"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(doc)}
                          disabled={deletingId === doc.id}
                          title="Удалить документ"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {deletingId === doc.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </Guard>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Шторка создания КП или Счёта */}
      {generatorType && (
        <GenerateDealDocumentModal
          open={Boolean(generatorType)}
          onClose={() => setGeneratorType(null)}
          deal={deal}
          items={items}
          documentType={generatorType}
          onSuccess={() => void refetchDocs()}
        />
      )}

      {/* Переиспользуемая шторка редактирования */}
      <InvoiceEditModal
        open={Boolean(editingDoc)}
        invoice={editableDoc}
        onClose={() => setEditingDoc(null)}
        onSaved={() => void refetchDocs()}
      />

      {/* Портал меню отправки клиенту */}
      {sendMenuState && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={sendMenuRef}
              style={{ top: sendMenuState.top, left: sendMenuState.left }}
              className="fixed z-[9999] w-60 rounded-[10px] border border-[#e5e5e5] bg-white py-1.5 shadow-xl text-xs"
            >
              <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#888888]">
                Отправить PDF клиенту
              </div>
              <button
                type="button"
                onClick={() => void handleSend(sendMenuState.doc, "all")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
              >
                <Send className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span>Во все мессенджеры</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSend(sendMenuState.doc, "max")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span>MAX</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSend(sendMenuState.doc, "telegram")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5 text-sky-500" />
                <span>Telegram</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSend(sendMenuState.doc, "whatsapp")}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
                <span>WhatsApp</span>
              </button>

              <div className="my-1 border-t border-[#f0f0f0]" />

              {!showEmailInput ? (
                <button
                  type="button"
                  onClick={() => {
                    if (defaultClientEmail) {
                      void handleSend(sendMenuState.doc, "email", defaultClientEmail);
                    } else {
                      setShowEmailInput(true);
                    }
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                >
                  <Mail className="h-3.5 w-3.5 text-[#666666]" />
                  <span className="truncate">
                    {defaultClientEmail ? `На E-mail (${defaultClientEmail})` : "Отправить на E-mail..."}
                  </span>
                </button>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!customEmail.trim()) return;
                    void handleSend(sendMenuState.doc, "email", customEmail);
                  }}
                  className="space-y-1.5 px-3 py-1.5"
                >
                  <input
                    type="email"
                    required
                    autoFocus
                    value={customEmail}
                    onChange={(e) => setCustomEmail(e.target.value)}
                    placeholder="client@company.ru"
                    className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="w-full rounded-[6px] bg-[#4a38f5] py-1 text-[11px] font-medium text-white hover:bg-[#3d2ee0] cursor-pointer"
                  >
                    Отправить PDF на почту
                  </button>
                </form>
              )}
            </div>,
            document.body,
          )
        : null}
    </Guard>
  );
});
