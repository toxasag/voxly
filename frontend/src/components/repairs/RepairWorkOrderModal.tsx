"use client";

import { memo, useCallback, useRef } from "react";
import { Printer, Wrench, X } from "lucide-react";
import type { RepairTicket } from "@/lib/repairs/repairs.types";
import { getRepairStatusLabel } from "@/lib/repairs/repairs.types";
import { amountToWords } from "@/lib/finance/amount-to-words";

interface RepairWorkOrderModalProps {
  open: boolean;
  ticket: RepairTicket | null;
  onClose: () => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(parsed);
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export const RepairWorkOrderModal = memo(function RepairWorkOrderModal({
  open,
  ticket,
  onClose,
}: RepairWorkOrderModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useCallback(() => {
    if (!printRef.current) return;
    const w = window.open("", "_blank", "width=850,height=1100");
    if (!w) return;
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Заказ-наряд №${ticket?.ticket_number ?? ""}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 12px;
      color: #111111;
      padding: 30px;
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.4;
    }
    @media print {
      @page {
        size: A4;
        margin: 12mm 15mm;
      }
      body {
        padding: 0;
        max-width: 100%;
      }
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0 16px 0;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 6px 8px;
      text-align: left;
      font-size: 11.5px;
    }
    th {
      background-color: #f3f4f6;
      font-weight: 600;
    }
    .text-right { text-align: right; }
    .text-center { text-align: center; }
    .bold { font-weight: 700; }
    .header-box {
      border-bottom: 2px solid #111111;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .section-title {
      font-size: 13px;
      font-weight: 700;
      margin: 14px 0 6px 0;
      color: #111111;
      border-bottom: 1px solid #e5e5e5;
      padding-bottom: 4px;
    }
    .sig-row {
      display: flex;
      justify-content: space-between;
      gap: 40px;
      margin-top: 36px;
      page-break-inside: avoid;
    }
    .sig-col {
      flex: 1;
    }
    .sig-line {
      border-bottom: 1px solid #111111;
      margin-top: 30px;
    }
    .sig-label {
      font-size: 10px;
      color: #666666;
      margin-top: 4px;
      text-align: center;
    }
  </style>
</head>
<body onload="window.print()">
  ${printRef.current.innerHTML}
</body>
</html>`);
    w.document.close();
  }, [ticket]);

  if (!open || !ticket) return null;

  const workTotal = ticket.work_items.reduce((s, w) => s + w.cost, 0);
  const partsTotal = ticket.parts_used.reduce((s, p) => s + p.retail_price * p.quantity, 0);
  const grandTotal = workTotal + partsTotal;

  const rubles = Math.floor(grandTotal);
  const kopecks = Math.round((grandTotal - rubles) * 100);
  const totalInWords = amountToWords(rubles, kopecks);

  const orderDate = ticket.completed_at || ticket.received_at;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 backdrop-blur-[1px] p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl my-6 space-y-3">
        {/* Top toolbar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
              <Wrench className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">
                Заказ-наряд №{ticket.ticket_number}
              </h3>
              <p className="text-xs text-[#666666]">Предпросмотр и печать акта выполненных работ</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-2xs hover:bg-[#3b2be0] transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              Печать заказ-наряда
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] p-1.5 text-[#888888] hover:bg-black/5 hover:text-[#111111] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Printable content */}
        <div
          ref={printRef}
          className="rounded-[16px] border border-[#e5e5e5] bg-white text-[#111111] p-8 md:p-10 shadow-xl font-sans"
        >
          {/* Header */}
          <div className="header-box flex justify-between items-start">
            <div>
              <h1 className="text-lg font-black tracking-tight text-[#4a38f5] mb-1">
                GETVOXLY Сервисный центр
              </h1>
              <p className="text-xs text-[#666666]">
                Исполнитель: Сервисный центр GETVOXLY · ИНН 7700000001
              </p>
              <p className="text-xs text-[#666666]">
                Адрес: г. Москва, ул. Садовая, д. 10 · Тел: +7 (495) 000-00-00
              </p>
            </div>
            <div className="text-right">
              <h2 className="text-base font-bold text-[#111111]">
                ЗАКАЗ-НАРЯД №{ticket.ticket_number}
              </h2>
              <p className="text-xs font-mono text-[#666666] mt-0.5">
                от {formatDate(orderDate)}
              </p>
              <span className="inline-block mt-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                Статус: {getRepairStatusLabel(ticket.status)}
              </span>
            </div>
          </div>

          {/* Info grid */}
          <div className="info-grid grid grid-cols-2 gap-6 my-4 border-b border-[#e5e5e5] pb-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#888888] mb-1">
                Заказчик
              </p>
              <p className="text-sm font-semibold text-[#111111]">{ticket.customer_name}</p>
              <p className="text-xs text-[#666666]">Телефон: {ticket.customer_phone}</p>
              <p className="text-xs text-[#666666]">Дата приёмки: {formatDate(ticket.received_at)}</p>
            </div>

            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#888888] mb-1">
                Оборудование
              </p>
              <p className="text-sm font-semibold text-[#111111]">
                {ticket.equipment.type} {ticket.equipment.brand} {ticket.equipment.model}
              </p>
              <p className="text-xs text-[#666666]">
                Серийный номер (S/N):{" "}
                <span className="font-mono">{ticket.equipment.serial_number || "Б/Н"}</span>
              </p>
              <p className="text-xs text-[#666666]">
                Внешний вид: {ticket.equipment.appearance}
              </p>
            </div>
          </div>

          {/* Defect description & diagnostics */}
          <div className="my-3 space-y-2 text-xs">
            <div>
              <span className="font-semibold text-[#111111]">Заявленная неисправность: </span>
              <span className="text-[#444444]">{ticket.defect_description}</span>
            </div>
            {ticket.diagnostics && (
              <div>
                <span className="font-semibold text-[#111111]">Результаты диагностики: </span>
                <span className="text-[#444444]">{ticket.diagnostics.findings}</span>
              </div>
            )}
          </div>

          {/* Table of works */}
          <div className="mt-5">
            <h3 className="section-title text-xs font-bold uppercase tracking-wider text-[#111111]">
              1. Выполненные работы и услуги
            </h3>
            {ticket.work_items.length === 0 ? (
              <p className="text-xs text-[#888888] italic py-2">Работы не добавлены</p>
            ) : (
              <table className="w-full text-xs border border-[#e5e5e5] my-2">
                <thead>
                  <tr className="bg-[#fbfbfb] border-b border-[#e5e5e5]">
                    <th className="py-1.5 px-2 text-left w-10">№</th>
                    <th className="py-1.5 px-2 text-left">Наименование работы</th>
                    <th className="py-1.5 px-2 text-left w-36">Мастер</th>
                    <th className="py-1.5 px-2 text-right w-28">Стоимость</th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.work_items.map((work, index) => (
                    <tr key={work.id} className="border-b border-[#f0f0f0]">
                      <td className="py-1.5 px-2 text-center text-[#888888]">{index + 1}</td>
                      <td className="py-1.5 px-2 font-medium">{work.description}</td>
                      <td className="py-1.5 px-2 text-[#666666]">{work.master_name}</td>
                      <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                        {formatCost(work.cost)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-[#fbfbfb] font-semibold">
                    <td colSpan={3} className="py-1.5 px-2 text-right">
                      Итого по работам:
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCost(workTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Table of parts */}
          <div className="mt-4">
            <h3 className="section-title text-xs font-bold uppercase tracking-wider text-[#111111]">
              2. Использованные запасные части и материалы
            </h3>
            {ticket.parts_used.length === 0 ? (
              <p className="text-xs text-[#888888] italic py-2">Запасные части не использовались</p>
            ) : (
              <table className="w-full text-xs border border-[#e5e5e5] my-2">
                <thead>
                  <tr className="bg-[#fbfbfb] border-b border-[#e5e5e5]">
                    <th className="py-1.5 px-2 text-left w-10">№</th>
                    <th className="py-1.5 px-2 text-left">Наименование</th>
                    <th className="py-1.5 px-2 text-left w-24">Артикул</th>
                    <th className="py-1.5 px-2 text-center w-16">Кол-во</th>
                    <th className="py-1.5 px-2 text-right w-24">Цена</th>
                    <th className="py-1.5 px-2 text-right w-28">Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.parts_used.map((part, index) => {
                    const rowSum = part.retail_price * part.quantity;
                    return (
                      <tr key={part.id} className="border-b border-[#f0f0f0]">
                        <td className="py-1.5 px-2 text-center text-[#888888]">{index + 1}</td>
                        <td className="py-1.5 px-2 font-medium">{part.name}</td>
                        <td className="py-1.5 px-2 font-mono text-[#666666]">{part.article}</td>
                        <td className="py-1.5 px-2 text-center font-mono">{part.quantity}</td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatCost(part.retail_price)}
                        </td>
                        <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                          {formatCost(rowSum)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-[#fbfbfb] font-semibold">
                    <td colSpan={5} className="py-1.5 px-2 text-right">
                      Итого по материалам:
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono tabular-nums">
                      {formatCost(partsTotal)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          {/* Grand total */}
          <div className="mt-4 border-t-2 border-[#111111] pt-3">
            <div className="flex justify-between items-center text-sm font-bold">
              <span>ВСЕГО К ОПЛАТЕ:</span>
              <span className="text-base font-mono tabular-nums text-[#4a38f5]">
                {formatCost(grandTotal)}
              </span>
            </div>
            <p className="mt-1 text-xs italic text-[#555555]">{totalInWords}</p>
          </div>

          {/* Warranty & terms */}
          <div className="mt-6 rounded border border-[#e5e5e5] bg-[#fafafa] p-3 text-[11px] leading-relaxed text-[#555555]">
            <p className="font-semibold text-[#111111] mb-1">
              Гарантийные обязательства и условия приёмки:
            </p>
            <p>
              1. Гарантийный срок на выполненные работы и установленные запасные части составляет
              30 (тридцать) календарных дней с момента передачи оборудования заказчику.
            </p>
            <p className="mt-0.5">
              2. Гарантия не распространяется на оборудование со следами попадания влаги,
              механических повреждений, нарушения правил эксплуатации или несанкционированного
              вскрытия.
            </p>
            <p className="mt-0.5">
              3. Работы выполнены в полном объеме, в срок и с надлежащим качеством. Претензий по
              объёму, качеству и внешнему виду изделия не имею.
            </p>
          </div>

          {/* Signatures */}
          <div className="sig-row flex justify-between gap-12 mt-8 pt-4">
            <div className="sig-col flex-1">
              <div className="sig-line border-b border-[#111111] mt-8" />
              <p className="sig-label text-center text-[10px] text-[#666666] mt-1">
                Исполнитель: {ticket.master_name} / Подпись
              </p>
            </div>
            <div className="sig-col flex-1">
              <div className="sig-line border-b border-[#111111] mt-8" />
              <p className="sig-label text-center text-[10px] text-[#666666] mt-1">
                Заказчик: {ticket.customer_name} / Подпись
              </p>
            </div>
          </div>

          {/* Footer note */}
          <div className="mt-8 text-center text-[10px] text-[#888888] border-t border-[#f0f0f0] pt-2">
            Сформировано в системе GETVOXLY · Дата формирования: {formatDate(new Date().toISOString())}
          </div>
        </div>
      </div>
    </div>
  );
});
