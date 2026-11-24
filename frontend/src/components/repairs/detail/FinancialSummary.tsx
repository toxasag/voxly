"use client";

import { memo, useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  Banknote,
  Receipt,
  TrendingUp,
  Wrench,
  Package,
  CheckCircle2,
  Printer,
  Download,
  Send,
  MessageCircle,
  ChevronDown,
  Loader2,
  FileText,
  CloudUpload,
  Pencil,
  Trash2,
} from "lucide-react";
import type { WorkItem, PartItem } from "@/lib/repairs/repairs.types";
import {
  useRepairInvoices,
  useSendInvoice,
  useMarkInvoicePaid,
  useSyncInvoiceToElba,
  useDeleteInvoice,
  useFinanceOrganizations,
  openInvoiceRfPrintWindow,
  type InvoiceDTO,
} from "@/lib/api/use-invoices";
import { BatchPaymentModal } from "./BatchPaymentModal";
import { GenerateInvoiceModal } from "./GenerateInvoiceModal";
import { InvoiceEditModal } from "@/components/finance/InvoiceEditModal";
import { Guard } from "@/components/shared/Guard";
import { TagPill } from "@/components/ui/tag";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api/apiClient";

interface FinancialSummaryProps {
  repairOrderId: string;
  workItems: WorkItem[];
  parts: PartItem[];
  hasFinanceModule: boolean;
  companyId?: string | null;
  companyName?: string | null;
  companyInn?: string | null;
  companyAddress?: string | null;
  customerName?: string;
  customerPhone?: string;
  dealId?: string | null;
  paymentStatus?: string;
  dealPaymentStatus?: string | null;
  onRefresh?: () => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateRu(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return isoString;
  }
}

export const FinancialSummary = memo(function FinancialSummary({
  repairOrderId,
  workItems,
  parts,
  hasFinanceModule,
  companyId = null,
  companyName = null,
  companyInn = null,
  companyAddress = null,
  customerName = "",
  customerPhone = "",
  dealId = null,
  paymentStatus = "unpaid",
  dealPaymentStatus = null,
  onRefresh,
}: FinancialSummaryProps) {
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState<InvoiceDTO | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [syncingElbaId, setSyncingElbaId] = useState<string | null>(null);
  const [deletingInvoiceId, setDeletingInvoiceId] = useState<string | null>(null);
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);
  const [sendingInvoiceId, setSendingInvoiceId] = useState<string | null>(null);
  const [messengerMenuState, setMessengerMenuState] = useState<{
    invoice: InvoiceDTO;
    anchorRect: DOMRect;
    top: number;
    left: number;
  } | null>(null);
  const messengerPortalRef = useRef<HTMLDivElement>(null);
  const messengerTriggerRef = useRef<HTMLButtonElement | null>(null);

  const { data: invoices = [], isLoading: isLoadingInvoices, refetch: refetchInvoices } = useRepairInvoices(repairOrderId);
  const { data: organizations = [] } = useFinanceOrganizations();
  const sendInvoice = useSendInvoice();
  const markInvoicePaid = useMarkInvoicePaid();
  const syncElba = useSyncInvoiceToElba();
  const deleteInvoice = useDeleteInvoice();

  useLayoutEffect(() => {
    if (!messengerMenuState) return;
    const menuWidth = 224;
    const menuHeight = messengerPortalRef.current?.offsetHeight || 210;
    const { anchorRect } = messengerMenuState;
    const margin = 8;
    const left = Math.max(
      margin,
      Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - margin),
    );
    const spaceBelow = window.innerHeight - anchorRect.bottom;
    const top =
      spaceBelow < menuHeight + margin && anchorRect.top > menuHeight + margin
        ? Math.max(margin, anchorRect.top - menuHeight - 6)
        : Math.min(window.innerHeight - menuHeight - margin, anchorRect.bottom + 6);

    if (Math.abs(top - messengerMenuState.top) > 1 || Math.abs(left - messengerMenuState.left) > 1) {
      setMessengerMenuState((prev) => (prev ? { ...prev, top, left } : null));
    }
  }, [messengerMenuState]);

  useEffect(() => {
    if (!messengerMenuState) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (messengerPortalRef.current?.contains(target)) return;
      if (messengerTriggerRef.current?.contains(target)) return;
      setMessengerMenuState(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMessengerMenuState(null);
    };
    const handleClose = () => setMessengerMenuState(null);

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleClose, true);
    window.addEventListener("resize", handleClose);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleClose, true);
      window.removeEventListener("resize", handleClose);
    };
  }, [messengerMenuState]);
  const hasElbaConfigured = useMemo(
    () => organizations.some((o) => o.elbaEnabled && o.elbaHasApiKey && o.elbaOrganizationId),
    [organizations],
  );

  const summary = useMemo(() => {
    const totalWork = workItems.reduce((sum, w) => sum + w.cost, 0);
    const totalPartsRetail = parts.reduce((sum, p) => sum + p.retail_price * p.quantity, 0);
    const totalPartsCost = parts.reduce((sum, p) => sum + p.cost_price * p.quantity, 0);
    const partsMarkupAmount = totalPartsRetail - totalPartsCost;
    const partsMarkupPct =
      totalPartsCost > 0 ? Math.round((partsMarkupAmount / totalPartsCost) * 100) : 0;
    const totalClient = totalWork + totalPartsRetail;
    const totalCost = totalPartsCost;
    const grossProfit = totalClient - totalCost;
    const marginPct = totalClient > 0 ? Math.round((grossProfit / totalClient) * 100) : 0;

    return {
      totalWork,
      totalPartsRetail,
      totalPartsCost,
      partsMarkupAmount,
      partsMarkupPct,
      totalClient,
      totalCost,
      grossProfit,
      marginPct,
    };
  }, [workItems, parts]);

  const hasData = workItems.length > 0 || parts.length > 0;

  // Заказ или вся сделка полностью оплачены
  const isFullyPaid = useMemo(() => {
    if (paymentStatus === "paid" || dealPaymentStatus === "paid") {
      return true;
    }
    const paidInvoicesTotal = invoices
      .filter((i) => i.status === "paid")
      .reduce((sum, i) => sum + Number(i.total), 0);

    if (summary.totalClient > 0 && paidInvoicesTotal >= summary.totalClient) {
      return true;
    }

    if (invoices.length > 0 && invoices.every((i) => i.status === "paid" || i.status === "cancelled")) {
      return true;
    }

    return false;
  }, [paymentStatus, dealPaymentStatus, invoices, summary.totalClient]);

  const handleDownloadPdf = useCallback(async (inv: InvoiceDTO) => {
    try {
      setDownloadingId(inv.id);
      const { blob } = await apiClient.downloadBlob(`/api/v1/invoices/${inv.id}/pdf`);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Invoice-${inv.invoiceNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast.success(`PDF счёта №${inv.invoiceNumber} успешно скачан`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось скачать PDF";
      toast.error(msg);
    } finally {
      setDownloadingId(null);
    }
  }, []);

  const handlePrintInvoice = useCallback(async (inv: InvoiceDTO) => {
    try {
      setPrintingId(inv.id);
      await openInvoiceRfPrintWindow(inv.id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось открыть печатную форму счёта";
      toast.error(msg);
    } finally {
      setPrintingId(null);
    }
  }, []);

  const handleSyncToElba = useCallback(
    async (inv: InvoiceDTO) => {
      try {
        setSyncingElbaId(inv.id);
        await syncElba.mutateAsync(inv.id);
        toast.success(`Счёт №${inv.invoiceNumber} выгружен в Контур.Эльбу`);
        void refetchInvoices();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Не удалось выгрузить счёт в Контур.Эльбу";
        toast.error(msg);
      } finally {
        setSyncingElbaId(null);
      }
    },
    [syncElba, refetchInvoices],
  );

  const handleDeleteInvoice = useCallback(
    async (inv: InvoiceDTO) => {
      if (inv.status === "paid") {
        toast.error("Оплаченный счёт нельзя удалить");
        return;
      }
      if (!window.confirm(`Удалить счёт № ${inv.invoiceNumber}?`)) return;
      try {
        setDeletingInvoiceId(inv.id);
        await deleteInvoice.mutateAsync(inv.id);
        toast.success(`Счёт № ${inv.invoiceNumber} удалён`);
        void refetchInvoices();
        if (onRefresh) onRefresh();
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить счёт");
      } finally {
        setDeletingInvoiceId(null);
      }
    },
    [deleteInvoice, refetchInvoices, onRefresh],
  );

  const handleSendToMessenger = useCallback(
    async (inv: InvoiceDTO, channelType: "telegram" | "whatsapp" | "max" | "all") => {
      setMessengerMenuState(null);
      try {
        setSendingInvoiceId(inv.id);
        const res = await sendInvoice.mutateAsync({
          id: inv.id,
          channel_type: channelType,
        });
        toast.success(res.message || "PDF счёта отправлен клиенту");
        void refetchInvoices();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Не удалось отправить счёт";
        toast.error(msg);
      } finally {
        setSendingInvoiceId(null);
      }
    },
    [sendInvoice, refetchInvoices],
  );

  const handleQuickMarkPaid = useCallback(
    async (inv: InvoiceDTO) => {
      if (inv.status === "paid" || inv.status === "cancelled") return;
      try {
        setMarkingPaidId(inv.id);
        await markInvoicePaid.mutateAsync({
          id: inv.id,
          payload: {},
        });
        toast.success(`Счёт № ${inv.invoiceNumber} и наряд отмечены как оплаченные`);
        void refetchInvoices();
        if (onRefresh) onRefresh();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Не удалось отметить счёт оплаченным";
        toast.error(msg);
      } finally {
        setMarkingPaidId(null);
      }
    },
    [markInvoicePaid, refetchInvoices, onRefresh],
  );

  const handleSuccessPayment = useCallback(() => {
    void refetchInvoices();
    if (onRefresh) onRefresh();
  }, [refetchInvoices, onRefresh]);

  const handleSuccessInvoice = useCallback(() => {
    void refetchInvoices();
    if (onRefresh) onRefresh();
  }, [refetchInvoices, onRefresh]);

  return (
    <div className="space-y-6">
      {/* Financial Breakdown Card */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Banknote className="h-4 w-4 text-[#666666]" />
            <span className="text-sm font-semibold text-[#111111]">Финансовый итог наряда</span>
          </div>
          <div>
            {isFullyPaid || paymentStatus === "paid" ? (
              <TagPill color="emerald">Оплачен</TagPill>
            ) : paymentStatus === "invoiced" ? (
              <TagPill color="sky">Счёт выставлен</TagPill>
            ) : (
              <TagPill color="amber">Не оплачен</TagPill>
            )}
          </div>
        </div>

        {!hasData ? (
          <p className="text-sm text-[#888888] py-4">Добавьте работы и запчасти, чтобы увидеть финансовую разбивку.</p>
        ) : (
          <div className="space-y-3">
            {/* Work */}
            {workItems.length > 0 && (
              <div className="flex items-center justify-between rounded-lg bg-[#fafafa] border border-[#e5e5e5] px-4 py-3">
                <div className="flex items-center gap-2">
                  <Wrench className="h-3.5 w-3.5 text-[#666666]" />
                  <span className="text-sm text-[#666666]">Работы ({workItems.length})</span>
                </div>
                <span className="text-sm font-semibold text-[#111111]">{formatCost(summary.totalWork)}</span>
              </div>
            )}

            {/* Parts */}
            {parts.length > 0 && (
              <div className="rounded-lg bg-[#fafafa] border border-[#e5e5e5] divide-y divide-[#f0f0f0] px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-[#666666]" />
                    <span className="text-sm text-[#666666]">Запчасти ({parts.length})</span>
                  </div>
                  <span className="text-sm font-semibold text-[#111111]">{formatCost(summary.totalPartsRetail)}</span>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-[#888888] pl-6">Закупочная цена запчастей</span>
                  <span className="text-xs text-[#666666] font-mono">{formatCost(summary.totalPartsCost)}</span>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs text-emerald-700 pl-6">
                    Наценка на запчасти{summary.totalPartsCost > 0 ? ` (+${summary.partsMarkupPct}%)` : ""}
                  </span>
                  <span className="text-xs font-semibold font-mono text-emerald-700">
                    {formatCost(summary.partsMarkupAmount)}
                  </span>
                </div>
              </div>
            )}

            <div className="h-px bg-[#e5e5e5]" />

            {/* Total for Client */}
            <div className="flex items-center justify-between rounded-[8px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#4a38f5]" />
                <span className="text-sm font-semibold text-[#4a38f5]">Итого к оплате (клиент)</span>
              </div>
              <span className="text-lg font-bold text-[#4a38f5]">{formatCost(summary.totalClient)}</span>
            </div>

            {/* Gross Profit / Margin */}
            <div className="flex items-center justify-between rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-700" />
                <span className="text-sm font-semibold text-emerald-700">Валовая прибыль</span>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold text-emerald-700">{formatCost(summary.grossProfit)}</span>
                <span className="block text-xs text-emerald-700/80">маржа {summary.marginPct}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons: Принять оплату & Сформировать счет */}
        {hasData && hasFinanceModule && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              disabled={isFullyPaid}
              onClick={isFullyPaid ? undefined : () => setIsPaymentModalOpen(true)}
              title={isFullyPaid ? "Вся сумма по сделке уже оплачена" : "Принять оплату"}
              className={cn(
                "flex items-center justify-center gap-2 rounded-[8px] py-2.5 px-4 text-xs font-semibold transition-colors select-none",
                isFullyPaid
                  ? "bg-[#f5f5f5] text-[#888888] border border-[#e5e5e5] cursor-not-allowed opacity-70 shadow-none"
                  : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs cursor-pointer",
              )}
            >
              <CheckCircle2 className="h-4 w-4" />
              {isFullyPaid ? "Оплачено" : "Принять оплату"}
            </button>

            <button
              type="button"
              disabled={isFullyPaid}
              onClick={isFullyPaid ? undefined : () => setIsInvoiceModalOpen(true)}
              title={isFullyPaid ? "Вся сумма по сделке уже оплачена" : "Сформировать счёт"}
              className={cn(
                "flex items-center justify-center gap-2 rounded-[8px] py-2.5 px-4 text-xs font-semibold transition-colors select-none",
                isFullyPaid
                  ? "bg-[#f5f5f5] text-[#888888] border border-[#e5e5e5] cursor-not-allowed opacity-70 shadow-none"
                  : "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] shadow-2xs cursor-pointer",
              )}
            >
              <Receipt className="h-4 w-4" />
              Сформировать счёт
            </button>
          </div>
        )}

        {hasData && !hasFinanceModule && (
          <div className="mt-4 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-4 py-3 text-center">
            <p className="text-xs text-[#666666]">
              Модуль «Финансы» не установлен. Установите его, чтобы принимать оплату и формировать счета.
            </p>
          </div>
        )}
      </div>

      {/* Invoices Section (Счета на оплату) */}
      {hasFinanceModule && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Receipt className="h-4 w-4 text-[#666666]" />
              <h3 className="text-sm font-semibold text-[#111111]">
                Счета на оплату ({invoices.length})
              </h3>
            </div>
            {invoices.length > 0 && !isFullyPaid && (
              <button
                type="button"
                onClick={() => setIsInvoiceModalOpen(true)}
                className="text-xs font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors cursor-pointer"
              >
                + Новый счёт
              </button>
            )}
          </div>

          {isLoadingInvoices ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-[#e5e5e5] bg-[#fafafa] p-6 text-center">
              <FileText className="h-8 w-8 text-[#888888] mx-auto mb-2 opacity-40" />
              <p className="text-xs text-[#666666]">По этому наряд-заказу ещё не выставлено ни одного счёта.</p>
              {!isFullyPaid && (
                <button
                  type="button"
                  onClick={() => setIsInvoiceModalOpen(true)}
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#4a38f5] hover:underline cursor-pointer"
                >
                  <Receipt className="h-3.5 w-3.5" />
                  Сформировать счёт на оплату
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-[#f0f0f0] border border-[#e5e5e5] rounded-[8px]">
              {invoices.map((inv) => {
                const isPaid = inv.status === "paid";
                const isCancelled = inv.status === "cancelled";
                const isDownloading = downloadingId === inv.id;
                const isSending = sendingInvoiceId === inv.id;
                const isMarkingPaid = markingPaidId === inv.id;
                const isMessengerMenuOpen = messengerMenuState?.invoice.id === inv.id;

                return (
                  <div
                    key={inv.id}
                    className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-[#fafafa] transition-colors first:rounded-t-[8px] last:rounded-b-[8px]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="font-semibold text-sm text-[#111111] font-mono whitespace-nowrap">
                          № {inv.invoiceNumber}
                        </span>
                        {isPaid ? (
                          <TagPill color="emerald">Оплачен</TagPill>
                        ) : inv.status === "sent" ? (
                          <TagPill color="sky">Выставлен</TagPill>
                        ) : inv.status === "overdue" ? (
                          <TagPill color="rose">Просрочен</TagPill>
                        ) : (
                          <TagPill color="amber">Черновик</TagPill>
                        )}
                        <span className="text-xs text-[#888888] whitespace-nowrap">
                          от {formatDateRu(inv.issueDate)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-1.5 text-xs text-[#666666]">
                        <span className="truncate max-w-full">
                          Плательщик: <strong className="font-medium text-[#111111]">{inv.companyName || inv.contactName}</strong>
                        </span>
                        <span className="text-[#cccccc]">•</span>
                        <span className="whitespace-nowrap">Срок: до {formatDateRu(inv.dueDate)}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 shrink-0">
                      <div className="text-left lg:text-right whitespace-nowrap">
                        <span className="text-sm font-bold font-mono tabular-nums text-[#111111]">
                          {formatCost(inv.total)}
                        </span>
                        {inv.vatRate > 0 && (
                          <span className="block text-[11px] text-[#888888]">
                            в т.ч. НДС {formatCost(inv.vatAmount)}
                          </span>
                        )}
                      </div>

                      {/* Action buttons per invoice */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* 0. Быстрая отметка оплаты */}
                        {!isPaid && !isCancelled && (
                          <Guard requiredPermission="finance:write">
                            <button
                              type="button"
                              onClick={() => void handleQuickMarkPaid(inv)}
                              disabled={isMarkingPaid}
                              title="Отметить счёт и наряд как оплаченные"
                              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-emerald-600 px-2.5 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                            >
                              {isMarkingPaid ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              )}
                              <span>Оплачен</span>
                            </button>
                          </Guard>
                        )}

                        {/* 1. Печать РФ-счёта */}
                        <button
                          type="button"
                          onClick={() => void handlePrintInvoice(inv)}
                          disabled={printingId === inv.id}
                          title="Распечатать счёт по стандарту РФ"
                          className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          {printingId === inv.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                          ) : (
                            <Printer className="h-3.5 w-3.5 text-[#666666]" />
                          )}
                          <span className="hidden sm:inline">Печать</span>
                        </button>

                        {/* 2. Скачать PDF */}
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(inv)}
                          disabled={isDownloading}
                          title="Скачать PDF документ счёта"
                          className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                        >
                          {isDownloading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                          ) : (
                            <Download className="h-3.5 w-3.5 text-[#666666]" />
                          )}
                          <span className="hidden sm:inline">PDF</span>
                        </button>

                        {/* 2.5 Контур.Эльба */}
                        {inv.elbaBillId ? (
                          <span
                            title={`Выгружен в Контур.Эльбу (ID: ${inv.elbaBillId})`}
                            className="inline-flex h-8 items-center gap-1 rounded-[8px] border border-emerald-200 bg-emerald-50 px-2 text-[11px] font-medium text-emerald-700 whitespace-nowrap"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Эльба
                          </span>
                        ) : hasElbaConfigured ? (
                          <button
                            type="button"
                            onClick={() => void handleSyncToElba(inv)}
                            disabled={syncingElbaId === inv.id}
                            title="Выгрузить счёт в Контур.Эльбу"
                            className="flex h-8 items-center gap-1 rounded-[8px] border border-[#e5e5e5] bg-white px-2 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            {syncingElbaId === inv.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                            ) : (
                              <CloudUpload className="h-3.5 w-3.5 text-[#4a38f5]" />
                            )}
                            <span className="hidden sm:inline">В Эльбу</span>
                          </button>
                        ) : null}

                        {/* 3. Отправить клиенту PDF в мессенджер (портал поверх всех слоёв) */}
                        <button
                          type="button"
                          disabled={isSending}
                          onClick={(e) => {
                            if (isMessengerMenuOpen) {
                              setMessengerMenuState(null);
                              return;
                            }
                            const rect = e.currentTarget.getBoundingClientRect();
                            messengerTriggerRef.current = e.currentTarget;
                            const menuWidth = 224;
                            const left = Math.max(
                              8,
                              Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8),
                            );
                            const top = rect.bottom + 6;
                            setMessengerMenuState({ invoice: inv, anchorRect: rect, top, left });
                          }}
                          title="Отправить PDF счёта в мессенджер"
                          className={cn(
                            "flex h-8 items-center gap-1 rounded-[8px] border bg-white px-2.5 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap",
                            isMessengerMenuOpen ? "border-[#4a38f5] bg-[#4a38f5]/5" : "border-[#e5e5e5]",
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

                        {/* 4. Редактировать и удалить (только для неоплаченных и с правом finance:write) */}
                        {!isPaid && (
                          <Guard requiredPermission="finance:write">
                            <button
                              type="button"
                              onClick={() => setEditingInvoice(inv)}
                              title="Редактировать счёт"
                              className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteInvoice(inv)}
                              disabled={deletingInvoiceId === inv.id}
                              title="Удалить счёт"
                              className="flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {deletingInvoiceId === inv.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-600" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </Guard>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal 1: Принять оплату по актам */}
      <BatchPaymentModal
        open={isPaymentModalOpen}
        onClose={() => setIsPaymentModalOpen(false)}
        repairOrderId={repairOrderId}
        onSuccess={handleSuccessPayment}
      />

      {/* Modal 2: Сформировать счет по актам */}
      <GenerateInvoiceModal
        open={isInvoiceModalOpen}
        onClose={() => setIsInvoiceModalOpen(false)}
        repairOrderId={repairOrderId}
        defaultCompanyId={companyId}
        defaultCompanyName={companyName}
        defaultCompanyInn={companyInn}
        defaultCompanyAddress={companyAddress}
        defaultCustomerName={customerName}
        defaultCustomerPhone={customerPhone}
        dealId={dealId}
        onSuccess={handleSuccessInvoice}
      />

      {/* Portal dropdown: Отправить PDF счёта в мессенджер */}
      {messengerMenuState && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={messengerPortalRef}
              style={{ top: messengerMenuState.top, left: messengerMenuState.left }}
              className="fixed z-[9999] w-56 rounded-[10px] border border-[#e5e5e5] bg-white py-1.5 shadow-xl text-xs"
            >
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#888888] border-b border-[#f0f0f0]">
                Отправить PDF счёта в:
              </div>
              <button
                type="button"
                onClick={() => void handleSendToMessenger(messengerMenuState.invoice, "max")}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5] text-[#111111] transition-colors cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span>MAX (PDF)</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSendToMessenger(messengerMenuState.invoice, "telegram")}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5] text-[#111111] transition-colors cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5 text-sky-500" />
                <span>Telegram (PDF)</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSendToMessenger(messengerMenuState.invoice, "whatsapp")}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5] text-[#111111] transition-colors cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
                <span>WhatsApp / Чат (PDF)</span>
              </button>
              <div className="h-px bg-[#f0f0f0] my-1" />
              <button
                type="button"
                onClick={() => void handleSendToMessenger(messengerMenuState.invoice, "all")}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5] text-[#4a38f5] font-medium transition-colors cursor-pointer"
              >
                <Send className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span>Во все мессенджеры</span>
              </button>
            </div>,
            document.body,
          )
        : null}

      {/* Modal 3: Редактировать счёт */}
      <InvoiceEditModal
        open={editingInvoice !== null}
        invoice={editingInvoice}
        onClose={() => setEditingInvoice(null)}
        onSaved={() => {
          void refetchInvoices();
          if (onRefresh) onRefresh();
        }}
      />
    </div>
  );
});
