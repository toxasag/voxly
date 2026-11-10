"use client";

import { memo, useCallback, useRef, useState } from "react";
import { Printer, X, CheckCircle2, SlidersHorizontal } from "lucide-react";
import type { RepairTicket } from "@/lib/repairs/repairs.types";
import {
  usePrintTemplateSettings,
  formatTicketNumber,
} from "@/lib/api/use-print-templates";
import { PrintTemplateSettingsDrawer } from "./PrintTemplateSettingsDrawer";

interface RepairWorkOrderModalProps {
  open: boolean;
  ticket: RepairTicket | null;
  onClose: () => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const parsed = new Date(iso);
    if (isNaN(parsed.getTime())) return iso;
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(parsed);
  } catch {
    return iso;
  }
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(amount);
}

export const RepairWorkOrderModal = memo(function RepairWorkOrderModal({
  open,
  ticket,
  onClose,
}: RepairWorkOrderModalProps) {
  const printRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data: settings } = usePrintTemplateSettings();

  const handlePrint = useCallback(() => {
    if (!printRef.current) return;
    const w = window.open("", "_blank", "width=850,height=1100");
    if (!w) return;
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Акт выполненных работ ${ticket?.ticket_number ?? ""}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 11px;
      color: #111111;
      padding: 24px;
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.35;
      background: #ffffff;
    }
    @media print {
      @page {
        size: A4 portrait;
        margin: 10mm 12mm;
      }
      body {
        padding: 0;
        max-width: 100%;
      }
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0;
    }
    th, td {
      border: 1px solid #111111;
      padding: 4px 6px;
      font-size: 10.5px;
    }
    th {
      background: #fbfbfb;
      font-weight: 700;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
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

  const orderDate = ticket.completed_at || ticket.received_at;
  const dateStr = formatDate(orderDate);
  const displayTicketNumber = formatTicketNumber(
    ticket.ticket_number,
    settings?.numberingFormat,
    settings?.numberingPrefix,
  );

  const showWorks = settings?.showWorksTable ?? true;
  const showParts = settings?.showPartsTable ?? true;
  const showSignatures = settings?.showCompletionSignatures ?? true;
  const showStamp = settings?.showCompletionStamp ?? true;

  const warrantyText =
    settings?.warrantyTerms ||
    `1. Гарантийный срок на выполненные работы и установленные оригинальные запасные части составляет 30 календарных дней со дня выдачи изделия.
2. Гарантия не распространяется при наличии следов попадания влаги, механических повреждений, нарушения пломб или неквалифицированного вмешательства.`;

  const returnPolicyText =
    settings?.returnPolicy ||
    `Работы выполнены в полном объеме, в установленный срок и с надлежащим качеством. Оборудование протестировано в присутствии Заказчика. Претензий по качеству и комплектности не имею.`;

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
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">
                Акт выполненных работ {displayTicketNumber}
              </h3>
              <p className="text-xs text-[#666666]">Предпросмотр акта и расчетных таблиц</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#666666] hover:text-[#4a38f5] hover:bg-[#fafafa] transition-colors cursor-pointer"
              title="Настроить бланки"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#4a38f5]" />
              <span>Настроить</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Печать</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] p-1.5 text-[#888888] hover:bg-black/5 hover:text-[#111111] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Printable content */}
        <div
          ref={printRef}
          className="rounded-[16px] border border-[#e5e5e5] bg-white text-[#111111] p-8 md:p-10 shadow-xl font-sans"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <img
                src={settings?.logoUrl || "/service-logo.png"}
                alt="Логотип сервисного центра"
                style={{ width: "86px", height: "86px", borderRadius: "12px", objectFit: "contain" }}
                onError={(e) => {
                  (e.target as HTMLImageElement).src = "/service-logo.png";
                }}
              />
            </div>
            <div style={{ textAlign: "right", fontSize: "11px", lineHeight: "1.4", color: "#111111" }}>
              <div style={{ fontWeight: 700, fontSize: "13px" }}>
                {settings?.companyName || "Ремонт инструмента ИП Сагайдак А.Г."}
              </div>
              <div>{settings?.companyAddress || "Москва 3й проезд Марьиной рощи 40с1, 2 этаж, каб. 214"}</div>
              <div>
                тел. {settings?.companyPhone || "+7 977 628 20 49"}
                {settings?.workingHours ? ` ${settings.workingHours}` : " Пн-Пт 10:00-19:00"}
              </div>
              {settings?.companyWebsite ? (
                <div style={{ fontWeight: 700, marginTop: "2px" }}>САЙТ: {settings.companyWebsite}</div>
              ) : null}
              {settings?.companyInn ? (
                <div style={{ fontSize: "10px", color: "#555555" }}>ИНН: {settings.companyInn}</div>
              ) : null}
            </div>
          </div>

          {/* Title */}
          <div style={{ textAlign: "center", margin: "14px 0 16px 0" }}>
            <h1 style={{ fontSize: "16px", fontWeight: 800, margin: 0, textTransform: "uppercase" }}>
              Акт выполненных работ {displayTicketNumber} от {dateStr}
            </h1>
          </div>

          {/* Parties & Equipment */}
          <div style={{ fontSize: "11px", lineHeight: "1.6", marginBottom: "14px" }}>
            <div>
              <strong>Исполнитель:</strong> {ticket.master_name || settings?.companyName || "Мастер СЦ"}
            </div>
            <div>
              <strong>Заказчик:</strong> {ticket.customer_name} {ticket.customer_phone}
              {ticket.company_name ? ` (${ticket.company_name})` : ""}
            </div>
            <div>
              <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
              {ticket.equipment.brand} {ticket.equipment.model}
              {settings?.showEquipmentSerial !== false && ticket.equipment.serial_number
                ? ` S/N: ${ticket.equipment.serial_number}`
                : ""}
            </div>
          </div>

          {/* Таблица 1: Выполненная работа */}
          {showWorks && (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
                <thead>
                  <tr style={{ background: "#fbfbfb" }}>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "30px", textAlign: "center" }}>№</th>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "left" }}>Выполненная работа</th>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "65px", textAlign: "center" }}>Кол-во</th>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "100px", textAlign: "right" }}>Цена</th>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "100px", textAlign: "right" }}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.work_items.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ border: "1px solid #111111", padding: "6px", textAlign: "center", color: "#888888" }}>
                        Работы по прейскуранту не указаны
                      </td>
                    </tr>
                  ) : (
                    ticket.work_items.map((work, idx) => (
                      <tr key={work.id}>
                        <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "center" }}>{idx + 1}</td>
                        <td style={{ border: "1px solid #111111", padding: "4px 6px" }}>{work.description}</td>
                        <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "center" }}>1 шт.</td>
                        <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "right", fontFamily: "monospace" }}>
                          {formatCost(work.cost)}
                        </td>
                        <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "right", fontFamily: "monospace" }}>
                          {formatCost(work.cost)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div style={{ fontSize: "11px", fontWeight: 700, margin: "6px 0 14px 0" }}>
                Итого стоимость работ: {formatCost(workTotal)}
              </div>
            </>
          )}

          {/* Таблица 2: Запчасти */}
          {showParts && (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "4px" }}>
                <thead>
                  <tr style={{ background: "#fbfbfb" }}>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "30px", textAlign: "center" }}>№</th>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "left" }}>Запчасти</th>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "65px", textAlign: "center" }}>Кол-во</th>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "100px", textAlign: "right" }}>Цена</th>
                    <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "100px", textAlign: "right" }}>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {ticket.parts_used.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ border: "1px solid #111111", padding: "6px", textAlign: "center", color: "#888888" }}>
                        Запасные части не использовались
                      </td>
                    </tr>
                  ) : (
                    ticket.parts_used.map((part, idx) => {
                      const rowSum = part.retail_price * part.quantity;
                      return (
                        <tr key={part.id}>
                          <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "center" }}>{idx + 1}</td>
                          <td style={{ border: "1px solid #111111", padding: "4px 6px" }}>
                            {part.name} {part.article ? `(${part.article})` : ""}
                          </td>
                          <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "center" }}>
                            {part.quantity} шт.
                          </td>
                          <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "right", fontFamily: "monospace" }}>
                            {formatCost(part.retail_price)}
                          </td>
                          <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "right", fontFamily: "monospace" }}>
                            {formatCost(rowSum)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
              <div style={{ fontSize: "11px", fontWeight: 700, margin: "6px 0 10px 0" }}>
                Итого стоимость запчастей: {formatCost(partsTotal)}
              </div>
            </>
          )}

          {/* Общая стоимость */}
          <div style={{ fontSize: "12px", fontWeight: 800, margin: "10px 0 14px 0", color: "#111111" }}>
            Общая стоимость: {formatCost(grandTotal)}
          </div>

          {/* Гарантийные обязательства */}
          <div style={{ fontSize: "10px", lineHeight: "1.35", color: "#222222", marginBottom: "16px" }}>
            <div style={{ fontWeight: 700, fontSize: "10.5px", marginBottom: "3px" }}>
              Гарантийные обязательства:
            </div>
            <div style={{ whiteSpace: "pre-line", marginBottom: "6px" }}>
              {warrantyText}
            </div>
            <div style={{ whiteSpace: "pre-line" }}>
              {returnPolicyText}
            </div>
          </div>

          {/* Подписи */}
          {showSignatures && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "18px" }}>
              <div style={{ width: "45%" }}>
                <div><strong>Заказчик</strong> ____________________</div>
                <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                  {ticket.customer_name} {ticket.customer_phone}
                </div>
              </div>
              <div style={{ width: "45%" }}>
                <div><strong>Исполнитель</strong> ____________________</div>
                <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                  {ticket.master_name || settings?.companyName || "Мастер СЦ"}
                </div>
                {showStamp && <div style={{ fontSize: "10px", color: "#888888", marginTop: "4px" }}>М.П.</div>}
              </div>
            </div>
          )}
        </div>
      </div>

      <PrintTemplateSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialDocumentType="work_order"
        orderId={ticket?.id}
      />
    </div>
  );
});
