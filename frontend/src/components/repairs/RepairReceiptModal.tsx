"use client";

import { memo, useCallback, useRef, useState } from "react";
import { X, Printer, FileText, SlidersHorizontal } from "lucide-react";
import type { RepairTicket } from "@/lib/repairs/repairs.types";
import {
  usePrintTemplateSettings,
  formatTicketNumber,
} from "@/lib/api/use-print-templates";
import { PrintTemplateSettingsDrawer } from "./PrintTemplateSettingsDrawer";

interface RepairReceiptModalProps {
  open: boolean;
  ticket: RepairTicket | null;
  onClose: () => void;
}

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

export const RepairReceiptModal = memo(function RepairReceiptModal({
  open,
  ticket,
  onClose,
}: RepairReceiptModalProps) {
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
  <title>Акт приемки (Договор) ${ticket?.ticket_number ?? ""}</title>
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
    }
    th, td {
      border: 1px solid #111111;
      padding: 5px 8px;
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

  const dateStr = formatDate(ticket.received_at);
  const displayTicketNumber = formatTicketNumber(
    ticket.ticket_number,
    settings?.numberingFormat,
    settings?.numberingPrefix,
  );

  const showSerial = settings?.showEquipmentSerial ?? true;
  const showAppearance = settings?.showAppearance ?? true;
  const showPackage = settings?.showPackageContents ?? true;
  const showDefect = settings?.showDefectDescription ?? true;
  const showEstCost = settings?.showEstimatedCost ?? true;
  const showSignatures = settings?.showIntakeSignatures ?? true;
  const showTearOff = settings?.showClientTearOffTicket ?? true;

  const intakeTermsText =
    settings?.intakeTerms ||
    `1. Сервисный центр производит диагностику и устранение заявленных дефектов. При обнаружении скрытых повреждений стоимость и сроки согласуются дополнительно.
2. Сервисный центр не несет ответственности за возможную потерю данных на внутренних накопителях.
3. Срок бесплатного хранения готового оборудования — 14 дней с момента уведомления клиента.`;

  const pdnText =
    settings?.intakePdnConsent ||
    `Заказчик подтверждает согласие на обработку персональных данных в соответствии с ФЗ №152-ФЗ для исполнения договора оказания услуг.`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 backdrop-blur-[1px] p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl my-6 space-y-3">
        {/* Панель действий вверху */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <span className="text-sm font-semibold text-[#111111]">
                Акт приемки (Договор) {displayTicketNumber}
              </span>
              <p className="text-xs text-[#666666]">Предпросмотр договора и отрывного талона</p>
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

        {/* Печатный лист (Акт приемки + Договор + Отрывной талон) */}
        <div
          ref={printRef}
          className="rounded-[16px] border border-[#e5e5e5] bg-white text-[#111111] p-8 md:p-10 shadow-xl font-sans"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' }}
        >
          {/* Шапка: Логотип слева + Реквизиты компании справа */}
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

          {/* Заголовок Договора */}
          <div style={{ textAlign: "center", margin: "14px 0 12px 0" }}>
            <h1 style={{ fontSize: "15px", fontWeight: 800, margin: 0, textTransform: "uppercase" }}>
              Договор {displayTicketNumber} от {dateStr}
            </h1>
            <div style={{ fontSize: "12px", color: "#333333", marginTop: "2px" }}>
              на оказание услуг по ремонту инструмента и оборудования
            </div>
          </div>

          {/* Информация о заказе */}
          <div style={{ fontSize: "11px", lineHeight: "1.6", marginBottom: "12px" }}>
            <div>
              <strong>Заказчик:</strong> {ticket.customer_name} {ticket.customer_phone}
              {ticket.company_name ? ` (${ticket.company_name})` : ""}
            </div>
            <div>
              <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
              {ticket.equipment.brand} {ticket.equipment.model}
              {showSerial && ticket.equipment.serial_number ? ` S/N: ${ticket.equipment.serial_number}` : ""}
            </div>
            {showAppearance && ticket.equipment.appearance && (
              <div>
                <strong>Внешний вид / состояние:</strong> {ticket.equipment.appearance}
              </div>
            )}
            {showEstCost && ticket.estimated_cost && Number(ticket.estimated_cost) > 0 && (
              <div>
                <strong>Ориентировочная стоимость:</strong> {ticket.estimated_cost} ₽
              </div>
            )}
            {showDefect && (
              <div>
                <strong>Заявленная неисправность:</strong> {ticket.defect_description || "Не указана"}
              </div>
            )}
          </div>

          {/* Таблица: Комплектация | Неисправность */}
          {(showPackage || showDefect) && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px", fontSize: "11px" }}>
              <thead>
                <tr style={{ background: "#fbfbfb" }}>
                  {showPackage && (
                    <th style={{ border: "1px solid #111111", padding: "5px 8px", textAlign: "left", width: showDefect ? "50%" : "100%", fontWeight: 700 }}>
                      Комплектация
                    </th>
                  )}
                  {showDefect && (
                    <th style={{ border: "1px solid #111111", padding: "5px 8px", textAlign: "left", width: showPackage ? "50%" : "100%", fontWeight: 700 }}>
                      Неисправность
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                <tr>
                  {showPackage && (
                    <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                      {ticket.equipment.package_contents || "Стандартная"}
                    </td>
                  )}
                  {showDefect && (
                    <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                      {ticket.defect_description || "Диагностика"}
                    </td>
                  )}
                </tr>
              </tbody>
            </table>
          )}

          {/* Пункты договора */}
          <div style={{ fontSize: "9.5px", lineHeight: "1.32", color: "#222222", textAlign: "justify", marginBottom: "14px" }}>
            <p style={{ margin: "0 0 4px 0" }}>
              {settings?.companyName || "Сервисный центр"}, именуемый в дальнейшем «Исполнитель», с одной стороны, и {ticket.customer_name}{ticket.company_name ? ` (${ticket.company_name})` : ""}, именуемый в дальнейшем «Заказчик», заключили настоящий договор:
            </p>
            <div style={{ whiteSpace: "pre-line", margin: "4px 0" }}>
              {intakeTermsText}
            </div>
            {pdnText ? (
              <p style={{ fontStyle: "italic", color: "#444444", marginTop: "4px" }}>
                {pdnText}
              </p>
            ) : null}
          </div>

          {/* Подписи верхнего блока */}
          {showSignatures && (
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "12px", marginBottom: "16px" }}>
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
              </div>
            </div>
          )}

          {/* Линия отрыва и Нижний отрывной талон */}
          {showTearOff && (
            <>
              <div style={{ borderTop: "1.5px dashed #444444", margin: "14px 0", position: "relative" }}>
                <span style={{ position: "absolute", top: "-8px", left: "16px", background: "#ffffff", padding: "0 6px", fontSize: "9px", color: "#888888" }}>
                  линия отрыва
                </span>
              </div>

              <div style={{ marginTop: "10px" }}>
                <div style={{ textAlign: "center", marginBottom: "10px" }}>
                  <div style={{ fontWeight: 800, fontSize: "13px", textTransform: "uppercase" }}>
                    Заказ-наряд на выполнение работ {displayTicketNumber} от {dateStr}
                  </div>
                </div>

                <div style={{ fontSize: "11px", lineHeight: "1.5", marginBottom: "10px" }}>
                  <div>
                    <strong>Заказчик:</strong> {ticket.customer_name} {ticket.customer_phone}
                    {ticket.company_name ? ` (${ticket.company_name})` : ""}
                  </div>
                  <div>
                    <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
                    {ticket.equipment.brand} {ticket.equipment.model}
                    {showSerial && ticket.equipment.serial_number ? ` S/N: ${ticket.equipment.serial_number}` : ""}
                  </div>
                </div>

                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px", fontSize: "11px" }}>
                  <thead>
                    <tr style={{ background: "#fbfbfb" }}>
                      <th style={{ border: "1px solid #111111", padding: "4px 8px", textAlign: "left", width: "40%", fontWeight: 700 }}>
                        Комплектация
                      </th>
                      <th style={{ border: "1px solid #111111", padding: "4px 8px", textAlign: "left", width: "40%", fontWeight: 700 }}>
                        Неисправность
                      </th>
                      <th style={{ border: "1px solid #111111", padding: "4px 8px", textAlign: "center", width: "20%", fontWeight: 700 }}>
                        Талон
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                        {ticket.equipment.package_contents || "Стандартная"}
                      </td>
                      <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                        {ticket.defect_description || "Диагностика"}
                      </td>
                      <td
                        style={{
                          border: "1px solid #111111",
                          padding: "6px 8px",
                          textAlign: "center",
                          verticalAlign: "middle",
                          fontSize: "24px",
                          fontWeight: 800,
                          fontFamily: "monospace",
                        }}
                      >
                        {displayTicketNumber}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {showSignatures && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "10px" }}>
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
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <PrintTemplateSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
});
