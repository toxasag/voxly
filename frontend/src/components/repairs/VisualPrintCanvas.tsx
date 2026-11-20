"use client";

import { useId, useState } from "react";
import {
  Scissors,
  QrCode,
  ShieldCheck,
  Building2,
  Phone,
  Mail,
  MapPin,
  Clock,
  Printer,
} from "lucide-react";
import type {
  PrintLayoutConfig,
  PrintSectionType,
} from "@/lib/api/use-print-templates";
import {
  type PreviewSampleData,
  DEFAULT_PREVIEW_SAMPLE_DATA,
  numberToWordsRu,
} from "@/lib/repairs/print-presets-client";
import { cn } from "@/lib/utils";

interface VisualPrintCanvasProps {
  layoutConfig: PrintLayoutConfig;
  sampleData?: PreviewSampleData;
  activeSection?: PrintSectionType | null;
  onSelectSection?: (section: PrintSectionType) => void;
  zoom?: number;
  className?: string;
  isPrinting?: boolean;
  documentType?: string;
}

export function VisualPrintCanvas({
  layoutConfig,
  sampleData = DEFAULT_PREVIEW_SAMPLE_DATA,
  activeSection,
  onSelectSection,
  zoom = 1,
  className,
  isPrinting = false,
  documentType,
}: VisualPrintCanvasProps) {
  const [hoveredSection, setHoveredSection] = useState<PrintSectionType | null>(null);

  const { theme, header, customer, equipment, table, terms, signatures, tearOffTicket } = layoutConfig;

  const companyPart = sampleData.companyName
    ? `${sampleData.companyName}${sampleData.companyInn ? ` (ИНН: ${sampleData.companyInn})` : ""}`
    : "";

  const customerDisplay =
    sampleData.clientInfo ||
    [
      companyPart,
      sampleData.customerName ? (sampleData.companyName ? `Представитель: ${sampleData.customerName}` : sampleData.customerName) : "",
      sampleData.customerPhone ? `тел. ${sampleData.customerPhone}` : "",
      sampleData.customerAddress,
    ]
      .filter(Boolean)
      .join(", ") ||
    sampleData.customerName ||
    "—";

  const toolDisplay =
    sampleData.toolInfo ||
    [
      sampleData.equipmentType,
      sampleData.equipmentBrand,
      sampleData.equipmentModel,
      sampleData.equipmentSerial ? `S/N: ${sampleData.equipmentSerial}` : "",
    ]
      .filter(Boolean)
      .join(" ");

  const shortTicketNumber =
    sampleData.orderNumber?.replace(/\D/g, "") || sampleData.orderNumber || "269";

  const isIntakeAct =
    documentType === "work_order" ||
    (tearOffTicket.visible && (!table.visible || (!table.showWorks && !table.showParts)));

  // Font family class
  const fontClass =
    theme.fontFamily === "Arial"
      ? "font-sans"
      : theme.fontFamily === "Times New Roman"
        ? "font-serif"
        : theme.fontFamily === "Roboto"
          ? "font-sans"
          : "font-sans";

  // Base font size
  const fontSizeStyle =
    theme.fontSize === "small"
      ? "text-[11px] leading-[1.35]"
      : theme.fontSize === "large"
        ? "text-[13px] leading-[1.45]"
        : "text-[12px] leading-[1.4]";

  // Padding / margins
  const marginClass =
    theme.margins === "compact"
      ? "p-6"
      : theme.margins === "spacious"
        ? "p-10"
        : "p-8";

  // Calculations
  const worksTotal = table.showWorks
    ? sampleData.works.reduce((acc, w) => acc + w.total, 0)
    : 0;
  const partsTotal = table.showParts
    ? sampleData.parts.reduce((acc, p) => acc + p.total, 0)
    : 0;
  const grandTotal = worksTotal + partsTotal;
  const vatAmount = table.showVat
    ? Math.round(((grandTotal * table.vatRate) / (100 + table.vatRate)) * 100) / 100
    : 0;

  const handleSectionClick = (sec: PrintSectionType) => {
    if (onSelectSection) {
      onSelectSection(sec);
    }
  };

  const getSectionInteractiveProps = (sec: PrintSectionType, label: string) => {
    if (isPrinting) return {};
    const isActive = activeSection === sec;
    const isHovered = hoveredSection === sec;

    return {
      onClick: (e: React.MouseEvent) => {
        e.stopPropagation();
        handleSectionClick(sec);
      },
      onMouseEnter: () => setHoveredSection(sec),
      onMouseLeave: () => setHoveredSection(null),
      className: cn(
        "relative transition-all duration-150 cursor-pointer rounded-[4px]",
        isActive && "ring-2 ring-[#4a38f5] bg-[#4a38f5]/[0.02]",
        !isActive && isHovered && "ring-1 ring-[#4a38f5]/50 bg-[#4a38f5]/[0.01]",
      ),
      "data-section": sec,
      title: `Нажмите, чтобы настроить: ${label}`,
    };
  };

  const renderSectionBadge = (sec: PrintSectionType, label: string) => {
    if (isPrinting) return null;
    const isHovered = hoveredSection === sec;
    const isActive = activeSection === sec;
    if (!isHovered && !isActive) return null;

    return (
      <div className="absolute -top-3 right-2 z-20 flex items-center gap-1 rounded bg-[#4a38f5] px-1.5 py-0.5 text-[9px] font-semibold text-white shadow-xs pointer-events-none animate-in fade-in zoom-in-95 duration-100">
        <span>{label}</span>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "relative mx-auto select-none print:m-0 print:p-0 print:shadow-none print:border-none print:w-full print:scale-100",
        className,
      )}
      style={{
        transform: isPrinting ? "none" : `scale(${zoom})`,
        transformOrigin: "top center",
      }}
    >
      {/* A4 Sheet Container */}
      <div
        id="visual-print-canvas-sheet"
        className={cn(
          "bg-white text-[#111111] shadow-2xl border border-[#e5e5e5] transition-shadow",
          fontClass,
          fontSizeStyle,
          marginClass,
          "w-[210mm] min-h-[297mm] print:w-full print:min-h-0 print:p-6 print:border-none print:shadow-none",
          isIntakeAct && "flex flex-col justify-between",
        )}
        style={{
          boxSizing: "border-box",
        }}
      >
        {isIntakeAct ? (
          <div className="flex flex-col justify-between min-h-[275mm] h-full space-y-3">
            <div className="space-y-3 flex-1 flex flex-col justify-start">
            {/* 1. Header: Logo Left, Company Details Right */}
            <div
              {...getSectionInteractiveProps("header", "Шапка и реквизиты")}
              className={cn(
                "pb-3 border-b border-[#e5e5e5]",
                getSectionInteractiveProps("header", "Шапка").className,
              )}
            >
              {renderSectionBadge("header", "Шапка и реквизиты")}
              <div className="flex items-start justify-between gap-6">
                <div className="flex items-center gap-3">
                  {header.showLogo && (
                    header.logoUrl ? (
                      <div
                        className="flex shrink-0 items-center justify-start overflow-hidden"
                        style={{ maxWidth: `${header.logoWidth || 120}px` }}
                      >
                        <img
                          src={header.logoUrl}
                          alt="Логотип сервиса"
                          style={{
                            maxWidth: `${header.logoWidth || 120}px`,
                            maxHeight: "48px",
                            objectFit: "contain",
                          }}
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = "none";
                          }}
                        />
                      </div>
                    ) : (
                      <div
                        className="flex shrink-0 items-center justify-center rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs font-semibold text-[#666666]"
                        style={{ width: `${header.logoWidth || 120}px`, height: "46px" }}
                      >
                        <span className="truncate uppercase tracking-wider text-[11px] text-[#4a38f5] font-bold">
                          {header.companyName ? header.companyName.slice(0, 15) : "VOXLY SERVICE"}
                        </span>
                      </div>
                    )
                  )}
                  {header.showCompanyDetails && (
                    <div>
                      <h2 className="text-[13px] font-bold uppercase tracking-tight text-[#111111]">
                        {header.companyName || "Ремонт инструмента ИП Сагайдак А.Г."}
                      </h2>
                      {header.companyInn && (
                        <p className="text-[10px] text-[#666666]">
                          ИНН: <span className="font-mono text-[#111111]">{header.companyInn}</span>
                          {header.companyOgrn && (
                            <span className="ml-2">
                              ОГРН: <span className="font-mono text-[#111111]">{header.companyOgrn}</span>
                            </span>
                          )}
                        </p>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10.5px] text-[#555555] pt-0.5">
                        {header.companyAddress && (
                          <span className="truncate">{header.companyAddress}</span>
                        )}
                        {header.companyPhone && (
                          <span>тел. <strong className="text-[#111111]">{header.companyPhone}</strong></span>
                        )}
                        {header.companyWebsite && (
                          <span className="font-semibold text-[#4a38f5] uppercase">{header.companyWebsite}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-right shrink-0">
                  <h1 className="text-[15px] font-bold uppercase tracking-tight text-[#111111]">
                    {header.documentTitle || "Договор"}
                  </h1>
                  {header.documentSubtitle && (
                    <p className="text-[10px] text-[#666666] max-w-[200px] text-right">
                      {header.documentSubtitle}
                    </p>
                  )}
                  <div className="mt-1.5 inline-flex flex-col items-end rounded border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1 text-right">
                    {header.showDocNumber && (
                      <div className="text-[11px] font-semibold text-[#111111]">
                        Номер: <span className="font-mono text-[#4a38f5] font-bold">{sampleData.orderNumber}</span>
                      </div>
                    )}
                    {header.showDate && (
                      <div className="text-[10px] text-[#666666]">
                        Дата: <span className="font-mono text-[#111111]">{sampleData.orderDate}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 2. Customer & Equipment Cards */}
            <div className="grid grid-cols-2 gap-3">
              {/* Customer Card */}
              <div
                {...getSectionInteractiveProps("customer", "Клиент / Заказчик")}
                className={cn(
                  "rounded border border-[#e5e5e5] p-2.5 space-y-1 bg-[#ffffff]",
                  getSectionInteractiveProps("customer", "Клиент").className,
                )}
              >
                {renderSectionBadge("customer", "Клиент / Заказчик")}
                <div className="border-b border-[#f0f0f0] pb-1 font-semibold text-[11px] uppercase tracking-wider text-[#666666]">
                  {customer.title || "Заказчик / Клиент"}
                </div>
                <div className="space-y-1 text-[11px] pt-0.5">
                  {sampleData.companyName && (
                    <div>
                      <span className="text-[#888888]">Организация: </span>
                      <span className="font-semibold text-[#111111]">{sampleData.companyName}</span>
                      {sampleData.companyInn && (
                        <span className="text-[10px] text-[#666666] ml-1.5 font-mono">(ИНН: {sampleData.companyInn})</span>
                      )}
                    </div>
                  )}
                  <div>
                    <span className="text-[#888888]">{sampleData.companyName ? "Представитель: " : "ФИО: "}</span>
                    <span className="font-medium text-[#111111]">{sampleData.customerName || "—"}</span>
                  </div>
                  {sampleData.customerPhone && (
                    <div>
                      <span className="text-[#888888]">Телефон: </span>
                      <span className="font-mono font-medium text-[#111111]">{sampleData.customerPhone}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Equipment Card */}
              <div
                {...getSectionInteractiveProps("equipment", "Оборудование и неисправность")}
                className={cn(
                  "rounded border border-[#e5e5e5] p-2.5 space-y-1 bg-[#ffffff]",
                  getSectionInteractiveProps("equipment", "Оборудование").className,
                )}
              >
                {renderSectionBadge("equipment", "Оборудование и неисправность")}
                <div className="border-b border-[#f0f0f0] pb-1 font-semibold text-[11px] uppercase tracking-wider text-[#666666]">
                  {equipment.title || "Оборудование и дефект"}
                </div>
                <div className="space-y-1 text-[11px] pt-0.5">
                  <div>
                    <span className="text-[#888888]">Техника: </span>
                    <span className="font-semibold text-[#111111]">
                      {[sampleData.equipmentType, sampleData.equipmentBrand, sampleData.equipmentModel].filter(Boolean).join(" ") || "—"}
                    </span>
                  </div>
                  {sampleData.equipmentSerial && (
                    <div>
                      <span className="text-[#888888]">S/N: </span>
                      <span className="font-mono text-[#111111]">{sampleData.equipmentSerial}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-[#888888]">Неисправность: </span>
                    <span className="text-[#111111]">{sampleData.defectDescription || "—"}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. Table: Комплектация & Внешний вид */}
            <div
              {...getSectionInteractiveProps("equipment", "Комплектация и состояние")}
              className={cn(
                "rounded border border-[#e5e5e5] overflow-hidden bg-white",
                getSectionInteractiveProps("equipment", "Комплектация").className,
              )}
            >
              {renderSectionBadge("equipment", "Комплектация и состояние")}
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="bg-[#fbfbfb] border-b border-[#e5e5e5] text-[#555555]">
                    <th className="border-r border-[#e5e5e5] px-3 py-1.5 text-left font-semibold w-1/2">
                      Комплектация при приеме
                    </th>
                    <th className="px-3 py-1.5 text-left font-semibold w-1/2">
                      Внешний вид / состояние
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="border-r border-[#e5e5e5] px-3 py-2 align-top text-[#222222]">
                      {sampleData.packageContents || "Без комплекта"}
                    </td>
                    <td className="px-3 py-2 align-top text-[#222222]">
                      {sampleData.appearance || "Б/У, следы нормальной эксплуатации"}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* 4. Preamble & Terms */}
            <div
              {...getSectionInteractiveProps("terms", "Предмет договора (Условия)")}
              className={cn(
                "rounded border border-[#e5e5e5] bg-[#fafafa] p-2.5 space-y-1.5 text-[#222222]",
                getSectionInteractiveProps("terms", "Условия").className,
              )}
            >
              {renderSectionBadge("terms", "Предмет договора")}
              <div className="text-[10px] leading-relaxed text-[#555555] italic border-b border-[#e5e5e5] pb-1.5">
                {header.companyName ? header.companyName.replace(/ИП.*$/, "").trim() || "ИП Сагайдак Антон Геннадьевич" : "ИП Сагайдак Антон Геннадьевич"}, именуемый в дальнейшем «Исполнитель» с одной стороны, и {sampleData.companyName ? `${sampleData.companyName} в лице ${sampleData.customerName || "представителя"}` : (sampleData.customerName || "Заказчик")}, именуемый в дальнейшем «Заказчик», с другой стороны, заключили настоящий договор о нижеследующем:
              </div>
              <div className="font-bold text-[10px] uppercase tracking-wider text-[#111111] pt-0.5">
                {terms.title || "ПРЕДМЕТ ДОГОВОРА И УСЛОВИЯ ПРИЕМА"}
              </div>
              <div className="text-[9.5px] leading-[1.35] text-[#444444] whitespace-pre-line">
                {terms.termsText}
              </div>
            </div>

            {/* 5. Signatures: Upper part */}
            <div
              {...getSectionInteractiveProps("signatures", "Подписи сторон")}
              className={cn(
                "pt-1 grid grid-cols-2 gap-8 text-[11px] text-[#111111]",
                getSectionInteractiveProps("signatures", "Подписи").className,
              )}
            >
              {renderSectionBadge("signatures", "Подписи сторон")}
              <div className="space-y-1">
                <div className="flex items-end gap-2">
                  <span className="font-bold">Заказчик:</span>
                  <span className="border-b border-[#111111] flex-1 pb-0.5"></span>
                </div>
                <div className="text-[10px] text-[#666666]">
                  {sampleData.companyName ? `${sampleData.companyName} / ` : ""}{sampleData.customerName} {sampleData.customerPhone}
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex items-end gap-2">
                  <span className="font-bold">Исполнитель:</span>
                  <span className="border-b border-[#111111] flex-1 pb-0.5"></span>
                </div>
                <div className="text-[10px] text-[#666666]">
                  {sampleData.masterName || "ИП Сагайдак Антон Геннадьевич"}
                </div>
              </div>
            </div>
            {/* End of upper agreement container */}
            </div>

            {/* Bottom Section: Cut Line + Master Stub docked to bottom */}
            <div className="mt-auto pt-2 shrink-0">
              {/* 6. Perforation Cut Line - Stabilized */}
              <div className="my-2.5 relative flex items-center justify-center">
                <div className="w-full border-t-2 border-dashed border-[#888888]" />
                <span className="absolute bg-white px-3 text-[10px] text-[#555555] font-mono font-semibold flex items-center gap-1.5 uppercase tracking-wider">
                  <Scissors className="h-3.5 w-3.5 text-[#4a38f5]" />
                  ЛИНИЯ ОТРЫВА (ЭКЗЕМПЛЯР МАСТЕРА)
                </span>
              </div>

              {/* 7. Lower Part: Master Stub */}
              <div
                {...getSectionInteractiveProps("tear_off_ticket", "Талон мастера")}
                className={cn(
                  "rounded border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2 text-[11px] text-[#111111]",
                  getSectionInteractiveProps("tear_off_ticket", "Талон мастера").className,
                )}
              >
                {renderSectionBadge("tear_off_ticket", "Отрывной талон мастера")}
                <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-1.5">
                  <span className="font-bold text-[12px] uppercase text-[#111111] tracking-wide">
                    {tearOffTicket.title && !tearOffTicket.title.includes("Заказ-наряд") ? tearOffTicket.title : "ТАЛОН МАСТЕРА (АКТ ПРИЕМА)"} № {sampleData.orderNumber?.replace(/^№\s*/, "")}
                  </span>
                  <span className="text-[10.5px] font-mono text-[#666666]">
                    от {sampleData.orderDate}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div className="space-y-0.5">
                    {sampleData.companyName && (
                      <div>
                        <span className="text-[#888888]">Организация: </span>
                        <span className="font-semibold text-[#111111]">{sampleData.companyName}</span>
                        {sampleData.companyInn && (
                          <span className="text-[10px] font-mono text-[#666666] ml-1">(ИНН: {sampleData.companyInn})</span>
                        )}
                      </div>
                    )}
                    <div>
                      <span className="text-[#888888]">{sampleData.companyName ? "Представитель: " : "Клиент: "}</span>
                      <span className="font-medium text-[#111111]">{sampleData.customerName || "—"}</span>
                      {sampleData.customerPhone && (
                        <span className="font-mono text-[#666666] ml-1.5">{sampleData.customerPhone}</span>
                      )}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div>
                      <span className="text-[#888888]">Устройство: </span>
                      <span className="font-semibold text-[#111111]">{toolDisplay}</span>
                    </div>
                    <div>
                      <span className="text-[#888888]">Неисправность: </span>
                      <strong className="text-[#111111]">{sampleData.defectDescription || "—"}</strong>
                    </div>
                    {sampleData.additionalDefectDescription && (
                      <div className="text-[10px] text-[#444444]">
                        <span className="text-[#888888]">Доп. описание: </span>
                        <span className="italic">{sampleData.additionalDefectDescription}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stub Table with Number Badge */}
                <div className="rounded border border-[#e5e5e5] bg-white overflow-hidden my-1">
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="bg-[#fbfbfb] border-b border-[#e5e5e5] text-[#555555]">
                        <th className="border-r border-[#e5e5e5] px-2.5 py-1 text-left font-semibold w-[42%]">
                          Комплектация
                        </th>
                        <th className="border-r border-[#e5e5e5] px-2.5 py-1 text-left font-semibold w-[42%]">
                          Внешний вид
                        </th>
                        <th className="px-2.5 py-1 text-center font-semibold w-[16%]">
                          Номер
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="border-r border-[#e5e5e5] px-2.5 py-1.5 align-top text-[#222222]">
                          {sampleData.packageContents || "—"}
                        </td>
                        <td className="border-r border-[#e5e5e5] px-2.5 py-1.5 align-top text-[#222222]">
                          {sampleData.appearance || "Б/У"}
                        </td>
                        <td className="px-2 py-1.5 align-middle text-center bg-[#fafafa]">
                          <span className="font-mono font-black text-2xl text-[#4a38f5]">
                            {shortTicketNumber}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {(sampleData.notes || sampleData.comments || tearOffTicket.customNote) && (
                  <div className="rounded border border-[#e5e5e5] bg-white p-2 text-[10.5px] text-[#333333]">
                    <span className="font-semibold text-[#111111]">Примечание к наряду: </span>
                    <span>{sampleData.notes || sampleData.comments || tearOffTicket.customNote}</span>
                  </div>
                )}

                <div className="pt-1 grid grid-cols-2 gap-8 text-[10.5px]">
                  <div className="space-y-0.5">
                    <div className="flex items-end gap-2">
                      <span className="font-bold">Заказчик:</span>
                      <span className="border-b border-[#111111] flex-1 pb-0.5"></span>
                    </div>
                    <div className="text-[10px] text-[#666666]">
                      {sampleData.customerName}
                    </div>
                  </div>
                  <div className="space-y-0.5">
                    <div className="flex items-end gap-2">
                      <span className="font-bold">Мастер:</span>
                      <span className="border-b border-[#111111] flex-1 pb-0.5"></span>
                    </div>
                    <div className="text-[10px] text-[#666666]">
                      {sampleData.masterName || "ИП Сагайдак Антон Геннадьевич"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div>
        {/* ================================================================= */}
        {/* HEADER SECTION                                                    */}
        {/* ================================================================= */}
        <div
          {...getSectionInteractiveProps("header", "Шапка и реквизиты")}
          className={cn(
            "pb-4 border-b border-[#e5e5e5]",
            getSectionInteractiveProps("header", "Шапка").className,
          )}
        >
          {renderSectionBadge("header", "Шапка и реквизиты")}
          <div className="flex items-start justify-between gap-6">
            {/* Left: Logo & Company details */}
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-3">
                {header.showLogo && (
                  header.logoUrl ? (
                    <div
                      className="flex shrink-0 items-center justify-start overflow-hidden"
                      style={{ maxWidth: `${header.logoWidth}px` }}
                    >
                      <img
                        src={header.logoUrl}
                        alt="Логотип сервиса"
                        style={{
                          maxWidth: `${header.logoWidth}px`,
                          maxHeight: "48px",
                          objectFit: "contain",
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className="flex shrink-0 items-center justify-center rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs font-semibold text-[#666666]"
                      style={{ width: `${header.logoWidth}px`, height: "46px" }}
                    >
                      <span className="truncate uppercase tracking-wider text-[11px] text-[#4a38f5] font-bold">
                        {header.companyName ? header.companyName.slice(0, 15) : "VOXLY SERVICE"}
                      </span>
                    </div>
                  )
                )}
                {header.showCompanyDetails && (
                  <div>
                    <h2 className="text-[13px] font-bold uppercase tracking-tight text-[#111111]">
                      {header.companyName || "Сервисный центр"}
                    </h2>
                    {header.companyInn && (
                      <p className="text-[10px] text-[#666666]">
                        ИНН: <span className="font-mono text-[#111111]">{header.companyInn}</span>
                        {header.companyOgrn && (
                          <span className="ml-2">
                            ОГРН: <span className="font-mono text-[#111111]">{header.companyOgrn}</span>
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                )}
              </div>

              {header.showCompanyDetails && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10.5px] text-[#555555] pt-1">
                  {header.companyAddress && (
                    <div className="flex items-center gap-1.5 truncate">
                      <MapPin className="h-3 w-3 shrink-0 text-[#888888]" />
                      <span className="truncate">{header.companyAddress}</span>
                    </div>
                  )}
                  {header.companyPhone && (
                    <div className="flex items-center gap-1.5 truncate">
                      <Phone className="h-3 w-3 shrink-0 text-[#888888]" />
                      <span className="font-mono font-medium text-[#111111]">{header.companyPhone}</span>
                    </div>
                  )}
                  {header.companyEmail && (
                    <div className="flex items-center gap-1.5 truncate">
                      <Mail className="h-3 w-3 shrink-0 text-[#888888]" />
                      <span className="truncate">{header.companyEmail}</span>
                    </div>
                  )}
                  {header.workingHours && (
                    <div className="flex items-center gap-1.5 truncate">
                      <Clock className="h-3 w-3 shrink-0 text-[#888888]" />
                      <span className="truncate">{header.workingHours}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Right: Document Title, Number & Date */}
            <div className="text-right shrink-0">
              <h1 className="text-[15px] font-extrabold uppercase tracking-tight text-[#111111]">
                {header.documentTitle || "ЗАКАЗ-НАРЯД"}
              </h1>
              {header.documentSubtitle && (
                <p className="text-[10px] text-[#666666] max-w-[200px] text-right">
                  {header.documentSubtitle}
                </p>
              )}
              <div className="mt-2 inline-flex flex-col items-end rounded border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1 text-right">
                {header.showDocNumber && (
                  <div className="text-[11px] font-semibold text-[#111111]">
                    Номер: <span className="font-mono text-[#4a38f5] font-bold">{sampleData.orderNumber}</span>
                  </div>
                )}
                {header.showDate && (
                  <div className="text-[10px] text-[#666666]">
                    Дата: <span className="font-mono text-[#111111]">{sampleData.orderDate}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ================================================================= */}
        {/* CUSTOMER & EQUIPMENT CARDS                                        */}
        {/* ================================================================= */}
        <div className="grid grid-cols-2 gap-4 pt-3.5 pb-2">
          {/* Customer Block */}
          {customer.visible && (
            <div
              {...getSectionInteractiveProps("customer", "Клиент / Заказчик")}
              className={cn(
                "rounded border border-[#e5e5e5] p-2.5 space-y-1 bg-[#ffffff]",
                getSectionInteractiveProps("customer", "Клиент").className,
              )}
            >
              {renderSectionBadge("customer", "Клиент / Заказчик")}
              <div className="border-b border-[#f0f0f0] pb-1 font-semibold text-[11px] uppercase tracking-wider text-[#666666]">
                {customer.title || "Заказчик / Клиент"}
              </div>
              <div className="space-y-1 text-[11px] pt-0.5">
                {sampleData.companyName && (
                  <div>
                    <span className="text-[#888888]">Организация: </span>
                    <span className="font-semibold text-[#111111]">{sampleData.companyName}</span>
                    {sampleData.companyInn && (
                      <span className="text-[10px] text-[#666666] ml-1.5 font-mono">(ИНН: {sampleData.companyInn})</span>
                    )}
                  </div>
                )}
                {customer.showName && (
                  <div>
                    <span className="text-[#888888]">{sampleData.companyName ? "Представитель: " : "ФИО: "}</span>
                    <span className="font-medium text-[#111111]">{sampleData.customerName}</span>
                  </div>
                )}
                {customer.showPhone && (
                  <div>
                    <span className="text-[#888888]">Телефон: </span>
                    <span className="font-mono font-medium text-[#111111]">{sampleData.customerPhone}</span>
                  </div>
                )}
                {customer.showEmail && (
                  <div>
                    <span className="text-[#888888]">Email: </span>
                    <span className="text-[#111111]">{sampleData.customerEmail}</span>
                  </div>
                )}
                {customer.showAddress && (
                  <div>
                    <span className="text-[#888888]">Адрес: </span>
                    <span className="text-[#111111]">{sampleData.customerAddress}</span>
                  </div>
                )}
                {customer.showPassport && (
                  <div>
                    <span className="text-[#888888]">Паспорт: </span>
                    <span className="font-mono text-[#111111]">{sampleData.customerPassport}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Equipment Block */}
          {equipment.visible && (
            <div
              {...getSectionInteractiveProps("equipment", "Оборудование")}
              className={cn(
                "rounded border border-[#e5e5e5] p-2.5 space-y-1 bg-[#ffffff]",
                getSectionInteractiveProps("equipment", "Оборудование").className,
              )}
            >
              {renderSectionBadge("equipment", "Оборудование")}
              <div className="border-b border-[#f0f0f0] pb-1 font-semibold text-[11px] uppercase tracking-wider text-[#666666]">
                {equipment.title || "Оборудование"}
              </div>
              <div className="space-y-1 text-[11px] pt-0.5">
                {equipment.showTypeBrandModel && (
                  <div>
                    <span className="text-[#888888]">Техника: </span>
                    <span className="font-semibold text-[#111111]">
                      {sampleData.equipmentType} {sampleData.equipmentBrand} {sampleData.equipmentModel}
                    </span>
                  </div>
                )}
                {equipment.showSerial && (
                  <div>
                    <span className="text-[#888888]">Серийный №: </span>
                    <span className="font-mono font-medium text-[#111111]">{sampleData.equipmentSerial}</span>
                  </div>
                )}
                {equipment.showDefect && (
                  <div>
                    <span className="text-[#888888]">Неисправность: </span>
                    <span className="text-[#111111]">{sampleData.defectDescription}</span>
                  </div>
                )}
                {equipment.showAppearance && (
                  <div>
                    <span className="text-[#888888]">Внешний вид: </span>
                    <span className="text-[#555555]">{sampleData.appearance}</span>
                  </div>
                )}
                {equipment.showPackage && (
                  <div>
                    <span className="text-[#888888]">Комплект: </span>
                    <span className="text-[#555555]">{sampleData.packageContents}</span>
                  </div>
                )}
                {equipment.showMaster && (
                  <div>
                    <span className="text-[#888888]">Мастер: </span>
                    <span className="font-medium text-[#111111]">{sampleData.masterName}</span>
                  </div>
                )}
                {equipment.showEstimatedCost && (
                  <div>
                    <span className="text-[#888888]">Предв. стоимость: </span>
                    <span className="font-mono font-semibold text-[#111111]">
                      {sampleData.estimatedCost.toLocaleString("ru-RU")} ₽
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ================================================================= */}
        {/* TABLE SECTION (WORKS & PARTS)                                     */}
        {/* ================================================================= */}
        {table.visible && (
          <div
            {...getSectionInteractiveProps("works_table", "Таблица услуг и запчастей")}
            className={cn(
              "pt-2 pb-2 space-y-3",
              getSectionInteractiveProps("works_table", "Таблица").className,
            )}
          >
            {renderSectionBadge("works_table", "Таблица услуг и запчастей")}

            {/* Works Table */}
            {table.showWorks && (
              <div>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#111111]">
                  {table.worksTitle || "Выполненные работы и услуги"}
                </div>
                <table className="w-full border-collapse border border-[#e5e5e5] text-left">
                  <thead>
                    <tr className={theme.accentHeaders ? "bg-[#f5f5f5]" : "bg-white"}>
                      {table.columns
                        .filter((c) => c.visible)
                        .map((col) => (
                          <th
                            key={col.id}
                            className={cn(
                              "border border-[#e5e5e5] px-2 py-1 text-[10px] font-semibold text-[#555555]",
                              col.id === "num" && "text-center",
                              (col.id === "price" || col.id === "total" || col.id === "qty") && "text-right",
                            )}
                            style={{ width: col.widthPercent ? `${col.widthPercent}%` : undefined }}
                          >
                            {col.label}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleData.works.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-[#fafafa]">
                        {table.columns
                          .filter((c) => c.visible)
                          .map((col) => (
                            <td
                              key={col.id}
                              className={cn(
                                "border border-[#e5e5e5] px-2 py-1 text-[11px]",
                                col.id === "num" && "text-center text-[#888888] font-mono",
                                (col.id === "price" || col.id === "total" || col.id === "qty") &&
                                  "text-right font-mono",
                              )}
                            >
                              {col.id === "num" && idx + 1}
                              {col.id === "name" && item.name}
                              {col.id === "qty" && item.qty}
                              {col.id === "unit" && item.unit}
                              {col.id === "price" && `${item.price.toLocaleString("ru-RU")} ₽`}
                              {col.id === "total" && `${item.total.toLocaleString("ru-RU")} ₽`}
                            </td>
                          ))}
                      </tr>
                    ))}
                    {table.showTotals && (
                      <tr className="bg-[#fafafa] font-semibold">
                        <td
                          colSpan={Math.max(1, table.columns.filter((c) => c.visible).length - 1)}
                          className="border border-[#e5e5e5] px-2 py-1 text-right text-[10.5px] text-[#555555]"
                        >
                          Итого по работам:
                        </td>
                        <td className="border border-[#e5e5e5] px-2 py-1 text-right font-mono text-[11px] text-[#111111]">
                          {worksTotal.toLocaleString("ru-RU")} ₽
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Parts Table */}
            {table.showParts && (
              <div>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-[#111111]">
                  {table.partsTitle || "Использованные запчасти и материалы"}
                </div>
                <table className="w-full border-collapse border border-[#e5e5e5] text-left">
                  <thead>
                    <tr className={theme.accentHeaders ? "bg-[#f5f5f5]" : "bg-white"}>
                      {table.columns
                        .filter((c) => c.visible)
                        .map((col) => (
                          <th
                            key={col.id}
                            className={cn(
                              "border border-[#e5e5e5] px-2 py-1 text-[10px] font-semibold text-[#555555]",
                              col.id === "num" && "text-center",
                              (col.id === "price" || col.id === "total" || col.id === "qty") && "text-right",
                            )}
                            style={{ width: col.widthPercent ? `${col.widthPercent}%` : undefined }}
                          >
                            {col.label}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampleData.parts.map((item, idx) => (
                      <tr key={item.id} className="hover:bg-[#fafafa]">
                        {table.columns
                          .filter((c) => c.visible)
                          .map((col) => (
                            <td
                              key={col.id}
                              className={cn(
                                "border border-[#e5e5e5] px-2 py-1 text-[11px]",
                                col.id === "num" && "text-center text-[#888888] font-mono",
                                (col.id === "price" || col.id === "total" || col.id === "qty") &&
                                  "text-right font-mono",
                              )}
                            >
                              {col.id === "num" && idx + 1}
                              {col.id === "name" && item.name}
                              {col.id === "qty" && item.qty}
                              {col.id === "unit" && item.unit}
                              {col.id === "price" && `${item.price.toLocaleString("ru-RU")} ₽`}
                              {col.id === "total" && `${item.total.toLocaleString("ru-RU")} ₽`}
                            </td>
                          ))}
                      </tr>
                    ))}
                    {table.showTotals && (
                      <tr className="bg-[#fafafa] font-semibold">
                        <td
                          colSpan={Math.max(1, table.columns.filter((c) => c.visible).length - 1)}
                          className="border border-[#e5e5e5] px-2 py-1 text-right text-[10.5px] text-[#555555]"
                        >
                          Итого по материалам:
                        </td>
                        <td className="border border-[#e5e5e5] px-2 py-1 text-right font-mono text-[11px] text-[#111111]">
                          {partsTotal.toLocaleString("ru-RU")} ₽
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {/* Grand Totals Box */}
            {table.showTotals && (
              <div className="flex flex-col items-end pt-1 space-y-1">
                <div className="flex items-center gap-4 text-[13px] font-bold">
                  <span>ВСЕГО К ОПЛАТЕ:</span>
                  <span className="font-mono text-[15px] text-[#111111]">
                    {grandTotal.toLocaleString("ru-RU")} ₽
                  </span>
                </div>
                {table.showVat && (
                  <div className="text-[10px] text-[#666666]">
                    В том числе НДС ({table.vatRate}%): {vatAmount.toLocaleString("ru-RU")} ₽
                  </div>
                )}
                {table.showGrandTotalWords && (
                  <div className="text-[10.5px] italic text-[#555555]">
                    Всего наименований: {sampleData.works.length + sampleData.parts.length}, на сумму{" "}
                    <span className="font-medium text-[#111111]">{numberToWordsRu(grandTotal)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TERMS & WARRANTY SECTION                                          */}
        {/* ================================================================= */}
        {terms.visible && (
          <div
            {...getSectionInteractiveProps("terms", "Условия и гарантия")}
            className={cn(
              "mt-3 rounded border border-[#e5e5e5] bg-[#fafafa] p-2.5 space-y-1.5",
              getSectionInteractiveProps("terms", "Условия").className,
            )}
          >
            {renderSectionBadge("terms", "Условия и гарантия")}
            <div className="font-semibold text-[10.5px] uppercase tracking-wider text-[#555555] flex items-center justify-between">
              <span>{terms.title || "Условия и гарантийные обязательства"}</span>
              {terms.showWarrantyText && terms.warrantyDays > 0 && (
                <span className="flex items-center gap-1 font-mono text-[#4a38f5] text-[10px] font-bold">
                  <ShieldCheck className="h-3 w-3" />
                  Гарантия: {terms.warrantyDays} дней
                </span>
              )}
            </div>
            {terms.termsText && (
              <p className="text-[9.5px] leading-relaxed text-[#555555] whitespace-pre-line">
                {terms.termsText}
              </p>
            )}
            {terms.showPdnConsent && terms.pdnText && (
              <p className="text-[9px] leading-relaxed text-[#777777] italic border-t border-[#e5e5e5] pt-1">
                {terms.pdnText}
              </p>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* SIGNATURES SECTION                                                */}
        {/* ================================================================= */}
        {signatures.visible && (
          <div
            {...getSectionInteractiveProps("signatures", "Подписи и печать")}
            className={cn(
              "mt-5 pt-3 border-t border-[#e5e5e5]",
              getSectionInteractiveProps("signatures", "Подписи").className,
            )}
          >
            {renderSectionBadge("signatures", "Подписи и печать")}
            <div className="grid grid-cols-2 gap-8 items-end">
              {/* Executor signature */}
              {signatures.showExecutor && (
                <div className="space-y-4">
                  <div className="text-[10.5px] font-semibold text-[#111111]">
                    {signatures.executorTitle || "Исполнитель / Мастер"}:
                  </div>
                  <div className="flex items-end gap-2 border-b border-[#111111] pb-0.5">
                    <span className="text-[9px] text-[#888888] pb-0.5">Подпись:</span>
                    <span className="flex-1" />
                    <span className="font-mono text-[10px] text-[#666666]">/ {sampleData.masterName} /</span>
                  </div>
                </div>
              )}

              {/* Client signature + Stamp */}
              <div className="space-y-4 relative">
                {signatures.showClient && (
                  <div>
                    <div className="text-[10.5px] font-semibold text-[#111111]">
                      {signatures.clientTitle || "Заказчик"}:
                    </div>
                    <div className="mt-4 flex items-end gap-2 border-b border-[#111111] pb-0.5">
                      <span className="text-[9px] text-[#888888] pb-0.5">Подпись:</span>
                      <span className="flex-1" />
                      <span className="font-mono text-[10px] text-[#666666]">
                        / {sampleData.customerName.split(" ").slice(0, 2).join(" ")} /
                      </span>
                    </div>
                  </div>
                )}
                {signatures.showStamp && (
                  <div className="absolute -top-3 right-4 h-16 w-16 rounded-full border-2 border-dashed border-[#888888]/40 flex items-center justify-center text-[10px] font-bold text-[#888888]/60 uppercase tracking-widest pointer-events-none">
                    {signatures.stampText || "М.П."}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TEAR-OFF MASTER TICKET (LOWER PART REMAINS WITH MASTER)           */}
        {/* ================================================================= */}
        {tearOffTicket.visible && (
          <div
            {...getSectionInteractiveProps("tear_off_ticket", "Талон мастера")}
            className={cn(
              "mt-auto pt-2 shrink-0",
              getSectionInteractiveProps("tear_off_ticket", "Талон").className,
            )}
          >
            {renderSectionBadge("tear_off_ticket", "Талон мастера")}

            {/* Perforation Line - Fixed & stabilized */}
            <div className="relative flex items-center justify-center my-2">
              <div className="absolute inset-x-0 border-t-2 border-dashed border-[#888888]" />
              <div className="relative bg-white px-3 flex items-center gap-1.5 text-[10px] text-[#555555] font-mono uppercase tracking-wider font-semibold">
                <Scissors className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span>ЛИНИЯ ОТРЫВА (ЭКЗЕМПЛЯР МАСТЕРА)</span>
              </div>
            </div>

            {/* Ticket Content */}
            <div className="rounded border border-[#cccccc] bg-[#fbfbfb] p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1.5 flex-1">
                  <div className="font-bold text-[12px] uppercase tracking-wide text-[#111111]">
                    {tearOffTicket.title || "ТАЛОН ПРИЕМА (ЭКЗЕМПЛЯР МАСТЕРА)"}
                  </div>
                  <div className="text-[10.5px] text-[#333333]">
                    Акт приёма:{" "}
                    <span className="font-mono font-bold text-[#4a38f5]">{sampleData.orderNumber}</span> от{" "}
                    <span className="font-mono">{sampleData.orderDate}</span>
                  </div>
                  <div className="text-[10px] text-[#333333]">
                    <span className="font-semibold text-[#111111]">Заказчик: </span>
                    <span className="font-medium text-[#111111]">{sampleData.clientInfo || sampleData.customerName}</span>
                    {!sampleData.clientInfo && sampleData.customerPhone && (
                      <span className="text-[#666666]"> (тел: {sampleData.customerPhone})</span>
                    )}
                  </div>
                  <div className="text-[10px] text-[#333333]">
                    <span className="font-semibold text-[#111111]">Инструмент: </span>
                    <span className="font-medium text-[#111111]">
                      {sampleData.toolInfo || `${sampleData.equipmentType} ${sampleData.equipmentBrand} ${sampleData.equipmentModel}`.trim()}
                    </span>
                    {!sampleData.toolInfo && sampleData.equipmentSerial && (
                      <span className="text-[#666666]"> (S/N: {sampleData.equipmentSerial})</span>
                    )}
                  </div>

                  {/* Defect details */}
                  <div className="text-[9.5px] text-[#555555] space-y-0.5 pt-0.5">
                    <div>
                      <span className="font-semibold text-[#111111]">Неисправность: </span>
                      <span className="text-[#111111] font-medium">{sampleData.defectDescription || "—"}</span>
                    </div>
                    {sampleData.additionalDefectDescription && (
                      <div>
                        <span className="font-semibold text-[#111111]">Доп. описание (со слов клиента): </span>
                        <span className="text-[#222222] italic">{sampleData.additionalDefectDescription}</span>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-x-2 pt-0.5">
                      {sampleData.packageContents && (
                        <div>Комплектация: <span className="text-[#111111]">{sampleData.packageContents}</span></div>
                      )}
                      {sampleData.appearance && (
                        <div>Внешний вид: <span className="text-[#111111]">{sampleData.appearance}</span></div>
                      )}
                    </div>
                  </div>

                  {/* Notes / Comments */}
                  {(sampleData.notes || sampleData.comments || tearOffTicket.customNote) && (
                    <div className="text-[9px] text-[#333333] pt-1 border-t border-[#e5e5e5]">
                      <span className="font-semibold text-[#111111]">Примечание к наряду: </span>
                      <span>{sampleData.notes || sampleData.comments || tearOffTicket.customNote}</span>
                    </div>
                  )}

                  <div className="text-[9.5px] text-[#666666] pt-0.5">
                    Мастер: <span className="font-medium text-[#111111]">{sampleData.masterName}</span>
                    {header.companyPhone && (
                      <span> • Сервис: <span className="font-mono text-[#111111]">{header.companyPhone}</span></span>
                    )}
                  </div>
                </div>

                {tearOffTicket.showBarcodeOrQr && (
                  <div className="flex flex-col items-center justify-center shrink-0 rounded border border-[#e5e5e5] bg-white p-2">
                    <QrCode className="h-12 w-12 text-[#111111]" />
                    <span className="font-mono text-[9px] text-[#888888] mt-0.5">
                      {sampleData.orderNumber}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
          </div>
        )}
      </div>
    </div>
  );
}
