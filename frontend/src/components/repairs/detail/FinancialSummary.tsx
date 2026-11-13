"use client";

import { memo, useMemo, useState, useCallback, useRef } from "react";
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
} from "lucide-react";
import type { WorkItem, PartItem } from "@/lib/repairs/repairs.types";
import { useRepairInvoices, useSendInvoice, type InvoiceDTO } from "@/lib/api/use-invoices";
import { BatchPaymentModal } from "./BatchPaymentModal";
import { GenerateInvoiceModal } from "./GenerateInvoiceModal";
import { TagPill } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

interface FinancialSummaryProps {
  repairOrderId: string;
  workItems: WorkItem[];
  parts: PartItem[];
  hasFinanceModule: boolean;
  customerName?: string;
  customerPhone?: string;
  dealId?: string | null;
  paymentStatus?: string;
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
  customerName = "",
  customerPhone = "",
  dealId = null,
  paymentStatus = "unpaid",
  onRefresh,
}: FinancialSummaryProps) {
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [activeMessengerMenuId, setActiveMessengerMenuId] = useState<string | null>(null);

  const { data: invoices = [], isLoading: isLoadingInvoices, refetch: refetchInvoices } = useRepairInvoices(repairOrderId);
  const sendInvoice = useSendInvoice();

  const summary = useMemo(() => {
    const totalWork = workItems.reduce((sum, w) => sum + w.cost, 0);
    const totalPartsRetail = parts.reduce((sum, p) => sum + p.retail_price * p.quantity, 0);
    const totalPartsCost = parts.reduce((sum, p) => sum + p.cost_price * p.quantity, 0);
    const totalClient = totalWork + totalPartsRetail;
    const totalCost = totalPartsCost;
    const grossProfit = totalClient - totalCost;
    const marginPct = totalClient > 0 ? Math.round((grossProfit / totalClient) * 100) : 0;

    return { totalWork, totalPartsRetail, totalPartsCost, totalClient, totalCost, grossProfit, marginPct };
  }, [workItems, parts]);

  const hasData = workItems.length > 0 || parts.length > 0;

  const handleDownloadPdf = useCallback(async (inv: InvoiceDTO) => {
    try {
      setDownloadingId(inv.id);
      const res = await fetch(`/api/v1/invoices/${inv.id}/pdf`, {
        credentials: "include",
      });
      if (!res.ok) {
        throw new Error("Ошибка скачивания PDF с сервера");
      }
      const blob = await res.blob();
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

  const handlePrintInvoice = useCallback((inv: InvoiceDTO) => {
    // Generate clean printable window for invoice
    const w = window.open("", "_blank", "width=850,height=1000");
    if (!w) {
      toast.error("Всплывающее окно заблокировано браузером");
      return;
    }

    const itemsRows = inv.lineItems
      .map(
        (it, idx) => `
        <tr>
          <td style="padding:6px;border:1px solid #ccc;text-align:center;">${idx + 1}</td>
          <td style="padding:6px;border:1px solid #ccc;">${it.description}${it.sourceLabel ? ` (${it.sourceLabel})` : ""}</td>
          <td style="padding:6px;border:1px solid #ccc;text-align:center;">${it.quantity}</td>
          <td style="padding:6px;border:1px solid #ccc;text-align:center;">шт.</td>
          <td style="padding:6px;border:1px solid #ccc;text-align:right;">${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2 }).format(it.unitPrice)}</td>
          <td style="padding:6px;border:1px solid #ccc;text-align:right;font-weight:bold;">${new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2 }).format(it.total)}</td>
        </tr>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Счёт № ${inv.invoiceNumber}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px; color: #111; padding: 30px; margin: 0 auto; max-width: 800px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th { background: #f3f4f6; font-weight: bold; border: 1px solid #ccc; padding: 6px; }
    @media print { @page { margin: 12mm; } }
  </style>
</head>
<body onload="window.print()">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;border-bottom:2px solid #111;padding-bottom:10px;">
    <div>
      <h1 style="margin:0;font-size:20px;font-weight:bold;">Счёт на оплату № ${inv.invoiceNumber}</h1>
      <p style="margin:4px 0 0;color:#666;font-size:12px;">от ${formatDateRu(inv.issueDate)}</p>
    </div>
    <div style="text-align:right;">
      <span style="font-size:16px;font-weight:bold;color:#4a38f5;">${formatCost(inv.total)}</span>
    </div>
  </div>

  <div style="margin-bottom:15px;font-size:12px;line-height:1.6;">
    <p><strong>Плательщик:</strong> ${inv.companyName || inv.contactName} ${inv.companyInn ? `(ИНН: ${inv.companyInn})` : ""}</p>
    <p><strong>Срок оплаты:</strong> до ${formatDateRu(inv.dueDate)}</p>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:30px;">№</th>
        <th>Товары (работы, услуги)</th>
        <th style="width:50px;">Кол-во</th>
        <th style="width:40px;">Ед.</th>
        <th style="width:85px;">Цена</th>
        <th style="width:95px;">Сумма</th>
      </tr>
    </thead>
    <tbody>
      ${itemsRows}
    </tbody>
  </table>

  <div style="margin-top:20px;text-align:right;">
    <p style="margin:4px 0;"><strong>Итого:</strong> ${formatCost(inv.subtotal)}</p>
    ${inv.vatRate > 0 ? `<p style="margin:4px 0;color:#666;">В том числе НДС (${inv.vatRate}%): ${formatCost(inv.vatAmount)}</p>` : `<p style="margin:4px 0;color:#666;">Без НДС</p>`}
    <p style="margin:8px 0;font-size:15px;font-weight:bold;">Всего к оплате: ${formatCost(inv.total)}</p>
  </div>
</body>
</html>`;

    w.document.write(html);
    w.document.close();
  }, []);

  const handleSendToMessenger = useCallback(
    async (inv: InvoiceDTO, channelType: "telegram" | "whatsapp" | "all") => {
      setActiveMessengerMenuId(null);
      try {
        const res = await sendInvoice.mutateAsync({
          id: inv.id,
          channel_type: channelType,
        });
        toast.success(res.message || "Счёт отправлен клиенту");
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Не удалось отправить счёт";
        toast.error(msg);
      }
    },
    [sendInvoice],
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
            {paymentStatus === "paid" ? (
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
                  <span className="text-xs text-emerald-700 pl-6">Наценка на запчасти</span>
                  <span className="text-xs font-semibold font-mono text-emerald-700">
                    {formatCost(summary.totalPartsRetail - summary.totalPartsCost)}
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
                <span className="block text-xs text-emerald-700/80">наценка {summary.marginPct}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons: Принять оплату & Сформировать счет */}
        {hasData && hasFinanceModule && (
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setIsPaymentModalOpen(true)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-[8px] py-2.5 px-4 text-xs font-semibold transition-colors cursor-pointer",
                "bg-emerald-600 text-white hover:bg-emerald-700 shadow-2xs",
              )}
            >
              <CheckCircle2 className="h-4 w-4" />
              Принять оплату
            </button>

            <button
              type="button"
              onClick={() => setIsInvoiceModalOpen(true)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-[8px] py-2.5 px-4 text-xs font-semibold transition-colors cursor-pointer",
                "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] shadow-2xs",
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
            {invoices.length > 0 && (
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
              <button
                type="button"
                onClick={() => setIsInvoiceModalOpen(true)}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#4a38f5] hover:underline cursor-pointer"
              >
                <Receipt className="h-3.5 w-3.5" />
                Сформировать счёт на оплату
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[#f0f0f0] border border-[#e5e5e5] rounded-[8px] overflow-hidden">
              {invoices.map((inv) => {
                const isPaid = inv.status === "paid";
                const isDownloading = downloadingId === inv.id;
                const isMessengerMenuOpen = activeMessengerMenuId === inv.id;

                return (
                  <div
                    key={inv.id}
                    className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-[#fafafa] transition-colors"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-[#111111] font-mono">
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
                        <span className="text-xs text-[#888888]">
                          от {formatDateRu(inv.issueDate)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-[#666666]">
                        <span>Плательщик: {inv.companyName || inv.contactName}</span>
                        <span>•</span>
                        <span>Срок: до {formatDateRu(inv.dueDate)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between md:justify-end gap-3">
                      <div className="text-right">
                        <span className="text-sm font-bold font-mono text-[#111111]">
                          {formatCost(inv.total)}
                        </span>
                        {inv.vatRate > 0 && (
                          <span className="block text-[11px] text-[#888888]">
                            в т.ч. НДС {formatCost(inv.vatAmount)}
                          </span>
                        )}
                      </div>

                      {/* Action buttons per invoice */}
                      <div className="flex items-center gap-1.5 relative">
                        {/* 1. Печать */}
                        <button
                          type="button"
                          onClick={() => handlePrintInvoice(inv)}
                          title="Распечатать счёт"
                          className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                        >
                          <Printer className="h-3.5 w-3.5 text-[#666666]" />
                          <span className="hidden sm:inline">Печать</span>
                        </button>

                        {/* 2. Скачать PDF */}
                        <button
                          type="button"
                          onClick={() => handleDownloadPdf(inv)}
                          disabled={isDownloading}
                          title="Скачать PDF документ счёта"
                          className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isDownloading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                          ) : (
                            <Download className="h-3.5 w-3.5 text-[#666666]" />
                          )}
                          <span className="hidden sm:inline">PDF</span>
                        </button>

                        {/* 3. Отправить клиенту в мессенджер */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() =>
                              setActiveMessengerMenuId(isMessengerMenuOpen ? null : inv.id)
                            }
                            title="Отправить счёт в мессенджер"
                            className="flex h-8 items-center gap-1 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <Send className="h-3.5 w-3.5 text-[#4a38f5]" />
                            <span className="hidden sm:inline">Отправить</span>
                            <ChevronDown className="h-3 w-3 text-[#888888]" />
                          </button>

                          {isMessengerMenuOpen && (
                            <div className="absolute right-0 top-full mt-1 z-20 w-52 rounded-[8px] border border-[#e5e5e5] bg-white py-1 shadow-lg text-xs">
                              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#888888] border-b border-[#f0f0f0]">
                                Отправить счёт в:
                              </div>
                              <button
                                type="button"
                                onClick={() => handleSendToMessenger(inv, "telegram")}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5] text-[#111111] transition-colors cursor-pointer"
                              >
                                <MessageCircle className="h-3.5 w-3.5 text-sky-500" />
                                <span>Telegram</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSendToMessenger(inv, "whatsapp")}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5] text-[#111111] transition-colors cursor-pointer"
                              >
                                <MessageCircle className="h-3.5 w-3.5 text-emerald-600" />
                                <span>WhatsApp / Чат</span>
                              </button>
                              <div className="h-px bg-[#f0f0f0] my-1" />
                              <button
                                type="button"
                                onClick={() => handleSendToMessenger(inv, "all")}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f5f5] text-[#4a38f5] font-medium transition-colors cursor-pointer"
                              >
                                <Send className="h-3.5 w-3.5 text-[#4a38f5]" />
                                <span>Во все мессенджеры</span>
                              </button>
                            </div>
                          )}
                        </div>
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
        defaultCustomerName={customerName}
        defaultCustomerPhone={customerPhone}
        dealId={dealId}
        onSuccess={handleSuccessInvoice}
      />
    </div>
  );
});
