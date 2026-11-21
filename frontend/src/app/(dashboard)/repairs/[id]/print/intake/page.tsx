"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Printer, ArrowLeft, Loader2, AlertCircle, SlidersHorizontal } from "lucide-react";
import { useRepair } from "@/lib/api/use-repairs";
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

export default function RepairIntakePrintPage() {
  const params = useParams();
  const router = useRouter();
  const id = typeof params.id === "string" ? params.id : "";
  const { data: ticket, isLoading, isError } = useRepair(id);
  const { data: settings } = usePrintTemplateSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const printedRef = useRef(false);

  useEffect(() => {
    if (ticket && !printedRef.current && !settingsOpen) {
      printedRef.current = true;
      const timer = setTimeout(() => {
        window.print();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [ticket, settingsOpen]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white gap-2 text-sm text-[#666666]">
        <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
        <span>Подготовка документа к печати...</span>
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

  const dateStr = formatDate(ticket.receivedAt);
  const displayTicketNumber = formatTicketNumber(
    ticket.ticketNumber,
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

  const mainDefect =
    ticket.malfunctions && ticket.malfunctions.length > 0
      ? ticket.malfunctions.join(", ")
      : ticket.defectDescription || "Не указана";

  const extraDefect =
    ticket.defectDescription &&
    ticket.defectDescription.trim() !== mainDefect.trim()
      ? ticket.defectDescription.trim()
      : "";

  const intakeTermsText =
    settings?.intakeTerms ||
    `1. Сервисный центр производит диагностику и устранение заявленных дефектов. При обнаружении скрытых повреждений стоимость и сроки согласуются дополнительно.
2. Сервисный центр не несет ответственности за возможную потерю данных на внутренних накопителях.
3. Срок бесплатного хранения готового оборудования — 14 дней с момента уведомления клиента.`;

  const pdnText =
    settings?.intakePdnConsent ||
    `Заказчик подтверждает согласие на обработку персональных данных в соответствии с ФЗ №152-ФЗ для исполнения договора оказания услуг.`;

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

      {/* Floating control toolbar (hidden in print mode) */}
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
            Акт приемки (Договор) {displayTicketNumber}
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

      {/* A4 Printable Sheet */}
      <div
        className="mx-auto max-w-3xl rounded-[16px] border border-[#e5e5e5] bg-white p-8 md:p-10 shadow-xl print:shadow-none print:border-none print:p-0 flex flex-col justify-between min-h-[285mm]"
        style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' }}
      >
        <div className="space-y-3 flex-1 flex flex-col justify-start">
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
              {settings?.companyName || "Сервисный центр"}
            </div>
            {settings?.companyAddress ? <div>{settings.companyAddress}</div> : null}
            {settings?.companyPhone ? (
              <div>
                тел. {settings.companyPhone}
                {settings?.workingHours ? ` ${settings.workingHours}` : ""}
              </div>
            ) : settings?.workingHours ? (
              <div>{settings.workingHours}</div>
            ) : null}
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
            <strong>Заказчик:</strong> {ticket.customerName} {ticket.customerPhone}
            {ticket.companyName ? ` (${ticket.companyName})` : ""}
          </div>
          <div>
            <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
            {ticket.equipment.brand} {ticket.equipment.model}
            {showSerial && ticket.equipment.serialNumber ? ` S/N: ${ticket.equipment.serialNumber}` : ""}
          </div>
          {showAppearance && ticket.equipment.appearance && (
            <div>
              <strong>Внешний вид / состояние:</strong> {ticket.equipment.appearance}
            </div>
          )}
          {showEstCost && ticket.estimatedCost && Number(ticket.estimatedCost) > 0 && (
            <div>
              <strong>Ориентировочная стоимость:</strong> {ticket.estimatedCost} ₽
            </div>
          )}
          {showDefect && (
            <div>
              <strong>Заявленная неисправность:</strong> {mainDefect}
              {extraDefect ? <span style={{ color: "#555555", fontStyle: "italic" }}> ({extraDefect})</span> : null}
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
                    {ticket.equipment.packageContents || "Стандартная"}
                  </td>
                )}
                {showDefect && (
                  <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                    <div><strong>{mainDefect}</strong></div>
                    {extraDefect && <div style={{ fontSize: "9.5px", color: "#555555", fontStyle: "italic", marginTop: "2px" }}>{extraDefect}</div>}
                  </td>
                )}
              </tr>
            </tbody>
          </table>
        )}

        {/* Пункты договора */}
        <div style={{ fontSize: "9.5px", lineHeight: "1.32", color: "#222222", textAlign: "justify", marginBottom: "14px" }}>
          <p style={{ margin: "0 0 4px 0" }}>
            {settings?.companyName || "Сервисный центр"}, именуемый в дальнейшем «Исполнитель», с одной стороны, и {ticket.customerName}{ticket.companyName ? ` (${ticket.companyName})` : ""}, именуемый в дальнейшем «Заказчик», заключили настоящий договор:
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
                {ticket.customerName} {ticket.customerPhone}
              </div>
            </div>
            <div style={{ width: "45%" }}>
              <div><strong>Исполнитель</strong> ____________________</div>
              <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                {ticket.masterName || settings?.companyName || "Мастер СЦ"}
              </div>
            </div>
          </div>
        )}
        </div>

        {/* Линия отрыва и Нижний отрывной талон */}
        {showTearOff && (
          <div style={{ marginTop: "auto" }}>
            <div className="relative flex items-center justify-center my-3">
              <div className="absolute inset-x-0 border-t-2 border-dashed border-[#888888]" />
              <div className="relative bg-white px-3 flex items-center gap-1.5 text-[10px] text-[#555555] font-mono uppercase tracking-wider font-semibold">
                <span>✂ ЛИНИЯ ОТРЫВА (ЭКЗЕМПЛЯР МАСТЕРА) ✂</span>
              </div>
            </div>

            <div style={{ marginTop: "8px" }}>
              <div style={{ textAlign: "center", marginBottom: "8px" }}>
                <div style={{ fontWeight: 800, fontSize: "13px", textTransform: "uppercase" }}>
                  ТАЛОН ПРИЕМА (ЭКЗЕМПЛЯР МАСТЕРА) {displayTicketNumber} от {dateStr}
                </div>
              </div>

              <div style={{ fontSize: "11px", lineHeight: "1.5", marginBottom: "8px" }}>
                <div>
                  <strong>Заказчик:</strong> {ticket.customerName} {ticket.customerPhone}
                  {ticket.companyName ? ` (${ticket.companyName})` : ""}
                </div>
                <div>
                  <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
                  {ticket.equipment.brand} {ticket.equipment.model}
                  {showSerial && ticket.equipment.serialNumber ? ` S/N: ${ticket.equipment.serialNumber}` : ""}
                </div>
              </div>

              <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "10px", fontSize: "11px" }}>
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
                      {ticket.equipment.packageContents || "Стандартная"}
                    </td>
                    <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                      <div><strong>{mainDefect}</strong></div>
                      {extraDefect && <div style={{ fontSize: "9.5px", color: "#444444", fontStyle: "italic", marginTop: "2px" }}>Доп. описание: {extraDefect}</div>}
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

              {ticket.notes && (
                <div style={{ fontSize: "10px", margin: "6px 0", padding: "5px 8px", background: "#fafafa", border: "1px solid #e5e5e5", borderRadius: "4px", color: "#333333" }}>
                  <strong>Примечание к наряду:</strong> {ticket.notes}
                </div>
              )}

              {showSignatures && (
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "8px" }}>
                  <div style={{ width: "45%" }}>
                    <div><strong>Заказчик</strong> ____________________</div>
                    <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                      {ticket.customerName} {ticket.customerPhone}
                    </div>
                  </div>
                  <div style={{ width: "45%" }}>
                    <div><strong>Исполнитель</strong> ____________________</div>
                    <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                      {ticket.masterName || settings?.companyName || "Мастер СЦ"}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <PrintTemplateSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialDocumentType="work_order"
        orderId={id}
      />
    </div>
  );
}
