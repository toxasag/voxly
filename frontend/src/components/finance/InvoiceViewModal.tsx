"use client";

import { memo, useCallback, useRef, useState } from "react";
import { Printer, MessageCircle, FileText, CheckCircle2 } from "lucide-react";
import type { Invoice } from "@/lib/finance/invoices.types";
import { getInvoiceStatusLabel, getInvoiceStatusColors } from "@/lib/finance/invoices.types";
import { amountToWords } from "@/lib/finance/amount-to-words";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { InvoicePaymentModal } from "@/components/finance/InvoicePaymentModal";
import { cn } from "@/lib/utils";

interface InvoiceViewModalProps {
  open: boolean;
  invoice: Invoice | null;
  onClose: () => void;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(
    new Date(iso),
  );
}

function formatCost(amount: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export const InvoiceViewModal = memo(function InvoiceViewModal({
  open,
  invoice,
  onClose,
}: InvoiceViewModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [payModalOpen, setPayModalOpen] = useState(false);

  const handlePrint = useCallback(() => {
    if (!printRef.current) return;
    const w = window.open("", "_blank", "width=800,height=1000");
    if (!w) return;
    w.document.write(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,sans-serif;font-size:13px;color:#1e1e1e;padding:30px;max-width:800px;margin:0 auto;}@media print{@page{margin:12mm}}</style></head><body onload="window.print()">${printRef.current.innerHTML}</body></html>`,
    );
    w.document.close();
  }, []);

  const handleSend = useCallback(
    (ch: string) => {
      window.alert(`Счёт ${invoice?.invoice_number} отправлен клиенту через ${ch}`);
    },
    [invoice],
  );

  if (!open || !invoice) return null;

  const rubles = Math.floor(invoice.total);
  const kopecks = Math.round((invoice.total - rubles) * 100);
  const totalInWords = amountToWords(rubles, kopecks);

  return (
    <>
      <Sheet open={open} onClose={onClose} width="w-[720px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <FileText className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Счёт №{invoice.invoice_number}</h2>
            <p className="text-xs text-[#666666]">Просмотр и печать счёта</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-[#f8f9fa] text-[#111111]">
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                  getInvoiceStatusColors(invoice.status),
                )}
              >
                {getInvoiceStatusLabel(invoice.status)}
              </span>
              <span className="text-xs text-slate-500">автор: {invoice.created_by}</span>
            </div>
            <div className="flex items-center gap-2">
              {invoice.status !== "paid" && invoice.status !== "cancelled" && (
                <button
                  type="button"
                  onClick={() => setPayModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Принять оплату
                </button>
              )}
              <button
                type="button"
                onClick={() => handleSend("Telegram")}
                className="flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Отправить в чат
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <Printer className="h-3.5 w-3.5" />
                Печать
              </button>
            </div>
          </div>

          <div
            ref={printRef}
            className="rounded-xl border border-[#e5e5e5] bg-white text-[#111111] p-8 shadow-sm font-sans"
          >
            <div className="flex justify-between items-start mb-8">
              <div>
                <h1 className="text-xl font-black tracking-tight text-[#4a38f5]">GETVOXLY</h1>
                <p className="text-xs text-slate-500 mt-1">B2B SaaS-платформа — модуль «Финансы»</p>
              </div>
              <div className="text-right">
                <h2 className="text-base font-bold text-[#111111]">СЧЁТ №{invoice.invoice_number}</h2>
                <p className="text-xs font-mono font-semibold text-slate-500 mt-0.5">
                  {invoice.invoice_number}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-6 mb-8 border-y border-[#e5e5e5] py-4">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-1">
                  Дата выставления
                </p>
                <p className="text-sm font-medium">{formatDate(invoice.issue_date)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-1">
                  Срок оплаты
                </p>
                <p className="text-sm font-medium">{formatDate(invoice.due_date)}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-1">
                  Статус
                </p>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                    invoice.status === "paid"
                      ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                      : invoice.status === "overdue"
                        ? "bg-rose-100 text-rose-700 border-rose-300"
                        : "bg-slate-100 text-slate-600 border-slate-300",
                  )}
                >
                  {getInvoiceStatusLabel(invoice.status)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-1">
                  Поставщик
                </p>
                <p className="text-sm font-semibold">GETVOXLY Сервисный центр</p>
                <p className="text-xs text-slate-500">ИНН: 7700000001</p>
                <p className="text-xs text-slate-500">Москва, Садовая 10</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-1">
                  Плательщик
                </p>
                <p className="text-sm font-semibold">{invoice.company_name}</p>
                <p className="text-xs text-slate-500">ИНН: {invoice.company_inn}</p>
                <p className="text-xs text-slate-500">{invoice.company_address}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {invoice.contact_name} — {invoice.contact_phone}
                </p>
              </div>
            </div>

            <table className="w-full mb-6">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="py-2 text-left text-xs font-semibold uppercase text-slate-400 tracking-wider">
                    Описание
                  </th>
                  <th className="py-2 text-center text-xs font-semibold uppercase text-slate-400 tracking-wider w-[60px]">
                    Кол-во
                  </th>
                  <th className="py-2 text-right text-xs font-semibold uppercase text-slate-400 tracking-wider w-[100px]">
                    Цена
                  </th>
                  <th className="py-2 text-right text-xs font-semibold uppercase text-slate-400 tracking-wider w-[110px]">
                    Сумма
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.line_items.map((li) => (
                  <tr key={li.id}>
                    <td className="py-2.5 pr-4">
                      <p className="text-sm">{li.description}</p>
                    </td>
                    <td className="py-2.5 text-center text-sm">{li.quantity}</td>
                    <td className="py-2.5 text-right text-sm font-mono">
                      {formatCost(li.unit_price, invoice.currency)}
                    </td>
                    <td className="py-2.5 text-right text-sm font-semibold font-mono">
                      {formatCost(li.total, invoice.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex justify-end mb-6">
              <div className="w-[280px] space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Подытог</span>
                  <span className="font-medium font-mono">
                    {formatCost(invoice.subtotal, invoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">НДС ({invoice.vat_rate}%)</span>
                  <span className="font-medium font-mono">
                    {formatCost(invoice.vat_amount, invoice.currency)}
                  </span>
                </div>
                <div className="flex justify-between border-t-2 border-[#111111] pt-2">
                  <span className="text-base font-bold">Итого к оплате</span>
                  <span className="text-base font-bold font-mono text-[#4a38f5]">
                    {formatCost(invoice.total, invoice.currency)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mb-6 border-t border-slate-200 pt-4">
              <p className="text-xs italic text-slate-500">{totalInWords}</p>
            </div>

            {invoice.notes && (
              <div className="mb-6 border-t border-slate-200 pt-4">
                <p className="text-xs font-semibold uppercase text-slate-400 tracking-wider mb-1">
                  Примечания
                </p>
                <p className="text-xs text-slate-500">{invoice.notes}</p>
              </div>
            )}

            <div className="mt-8 border-t border-slate-200 pt-4 text-center">
              <p className="text-xs text-slate-400">
                Сформировано модулем «Финансы» GETVOXLY · {invoice.invoice_number}
              </p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
    <InvoicePaymentModal
      open={payModalOpen}
      invoice={invoice}
      onClose={() => setPayModalOpen(false)}
      onSuccess={onClose}
    />
  </>
  );
});