"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Printer, ArrowLeft, Loader2, AlertCircle, SlidersHorizontal } from "lucide-react";
import { useRepair, useRepairWorks, useRepairParts } from "@/lib/api/use-repairs";
import {
  usePrintTemplateSettings,
  formatTicketNumber,
} from "@/lib/api/use-print-templates";
import { PrintTemplateSettingsDrawer } from "@/components/repairs/PrintTemplateSettingsDrawer";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
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

export default function RepairCompletionPrintPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: ticket, isLoading: ticketLoading, isError } = useRepair(id);
  const { data: works = [], isLoading: worksLoading } = useRepairWorks(id);
  const { data: parts = [], isLoading: partsLoading } = useRepairParts(id);
  const { data: settings } = usePrintTemplateSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const printedRef = useRef(false);

  const isLoading = ticketLoading || worksLoading || partsLoading;

  useEffect(() => {
    if (ticket && !isLoading && !printedRef.current && !settingsOpen) {
      printedRef.current = true;
      const timer = setTimeout(() => {
        window.print();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [ticket, isLoading, settingsOpen]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white gap-2 text-sm text-[#666666]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
        <span>Подготовка акта выполненных работ к печати...</span>
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-white gap-3 p-4">
        <AlertCircle className="h-8 w-8 text-rose-500" />
        <p className="text-sm font-medium text-[#111111]">Наряд-заказ не найден</p>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-[8px] border border-[#e5e5e5] px-3.5 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa]"
        >
          Назад
        </button>
      </div>
    );
  }

  const dateStr = formatDate(ticket.completedAt || ticket.deliveredAt || ticket.receivedAt);
  const displayTicketNumber = formatTicketNumber(
    ticket.ticketNumber,
    settings?.numberingFormat,
    settings?.numberingPrefix,
  );

  const workTotal = works.reduce((sum, w) => sum + (Number(w.cost) || 0), 0);
  const partsTotal = parts.reduce((sum, p) => sum + (Number(p.retailPrice) || 0) * (Number(p.quantity) || 1), 0);
  const grandTotal = workTotal + partsTotal;

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
    <div className="min-h-screen bg-[#f5f5f5] p-4 sm:p-8 print:p-0 print:bg-white text-[#111111] font-sans">
      <style jsx global>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 8mm 10mm;
          }
          body {
            background: #ffffff !important;
            color: #000000 !important;
            padding: 0 !important;
          }
          .no-print {
            display: none !important;
          }
        }
      `}</style>

      {/* Control toolbar */}
      <div className="no-print mx-auto max-w-3xl mb-4 flex items-center justify-between rounded-xl border border-[#e5e5e5] bg-white p-3 shadow-sm">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Назад</span>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#111111]">
            Акт выполненных работ {displayTicketNumber}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#666666] hover:text-[#4a38f5] hover:bg-[#fafafa] transition-colors cursor-pointer"
            title="Настроить бланки"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 text-[#4a38f5]" />
            <span>Настроить</span>
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors cursor-pointer"
          >
            <Printer className="h-3.5 w-3.5" />
            <span>Распечатать</span>
          </button>
        </div>
      </div>

      {/* Printable Sheet */}
      <div
        className="mx-auto max-w-3xl rounded-[16px] border border-[#e5e5e5] bg-white p-8 md:p-10 shadow-xl print:shadow-none print:border-none print:p-0"
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
            <strong>Исполнитель:</strong> {ticket.masterName || settings?.companyName || "Мастер СЦ"}
          </div>
          <div>
            <strong>Заказчик:</strong> {ticket.customerName} {ticket.customerPhone}
            {ticket.companyName ? ` (${ticket.companyName})` : ""}
          </div>
          <div>
            <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
            {ticket.equipment.brand} {ticket.equipment.model}
            {settings?.showEquipmentSerial !== false && ticket.equipment.serialNumber
              ? ` S/N: ${ticket.equipment.serialNumber}`
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
                {works.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ border: "1px solid #111111", padding: "6px", textAlign: "center", color: "#888888" }}>
                      Работы по прейскуранту не указаны
                    </td>
                  </tr>
                ) : (
                  works.map((work, idx) => (
                    <tr key={work.id}>
                      <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "center" }}>{idx + 1}</td>
                      <td style={{ border: "1px solid #111111", padding: "4px 6px" }}>{work.description}</td>
                      <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "center" }}>{work.quantity ?? 1} шт.</td>
                      <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "right", fontFamily: "monospace" }}>
                        {formatCost(work.unitPrice ?? work.cost)}
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
                  <th style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "left" }}>Запчасти и материалы</th>
                  <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "65px", textAlign: "center" }}>Кол-во</th>
                  <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "100px", textAlign: "right" }}>Цена</th>
                  <th style={{ border: "1px solid #111111", padding: "4px 6px", width: "100px", textAlign: "right" }}>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {parts.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ border: "1px solid #111111", padding: "6px", textAlign: "center", color: "#888888" }}>
                      Запасные части не использовались
                    </td>
                  </tr>
                ) : (
                  parts.map((part, idx) => (
                    <tr key={part.id}>
                      <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "center" }}>{idx + 1}</td>
                      <td style={{ border: "1px solid #111111", padding: "4px 6px" }}>
                        {part.name}
                        {part.article ? ` (${part.article})` : ""}
                      </td>
                      <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "center" }}>{part.quantity} шт.</td>
                      <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "right", fontFamily: "monospace" }}>
                        {formatCost(part.retailPrice)}
                      </td>
                      <td style={{ border: "1px solid #111111", padding: "4px 6px", textAlign: "right", fontFamily: "monospace" }}>
                        {formatCost(part.retailPrice * part.quantity)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div style={{ fontSize: "11px", fontWeight: 700, margin: "6px 0 14px 0" }}>
              Итого стоимость запчастей: {formatCost(partsTotal)}
            </div>
          </>
        )}

        {/* Общий итог */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            alignItems: "center",
            padding: "8px 12px",
            background: "#fbfbfb",
            border: "1.5px solid #111111",
            borderRadius: "4px",
            fontSize: "13px",
            fontWeight: 800,
            marginBottom: "14px",
          }}
        >
          <span style={{ marginRight: "12px" }}>ВСЕГО К ОПЛАТЕ:</span>
          <span style={{ fontSize: "15px", fontFamily: "monospace" }}>{formatCost(grandTotal)}</span>
        </div>

        {/* Условия гарантии и правила */}
        <div style={{ fontSize: "10px", lineHeight: "1.4", color: "#333333", marginBottom: "16px", textAlign: "justify" }}>
          <p style={{ margin: "0 0 4px 0", fontWeight: 700 }}>ГАРАНТИЙНЫЕ ОБЯЗАТЕЛЬСТВА:</p>
          <div style={{ whiteSpace: "pre-line", margin: "0 0 6px 0" }}>
            {warrantyText}
          </div>
          <div style={{ whiteSpace: "pre-line" }}>
            {returnPolicyText}
          </div>
        </div>

        {/* Подписи */}
        {showSignatures && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "20px" }}>
            <div style={{ width: "45%" }}>
              <div>Исполнитель: _________________ / {ticket.masterName || settings?.companyName || "Мастер СЦ"}</div>
              {showStamp && <div style={{ fontSize: "10px", color: "#888888", marginTop: "4px" }}>М.П.</div>}
            </div>
            <div style={{ width: "45%" }}>
              <div>Заказчик работу принял: _________________ / {ticket.customerName}</div>
              <div style={{ fontSize: "10px", color: "#888888", marginTop: "4px" }}>Претензий не имею</div>
            </div>
          </div>
        )}
      </div>

      <PrintTemplateSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialDocumentType="completion_act"
        orderId={id}
      />
    </div>
  );
}
