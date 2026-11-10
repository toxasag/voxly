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
}

export function VisualPrintCanvas({
  layoutConfig,
  sampleData = DEFAULT_PREVIEW_SAMPLE_DATA,
  activeSection,
  onSelectSection,
  zoom = 1,
  className,
  isPrinting = false,
}: VisualPrintCanvasProps) {
  const [hoveredSection, setHoveredSection] = useState<PrintSectionType | null>(null);

  const { theme, header, customer, equipment, table, terms, signatures, tearOffTicket } = layoutConfig;

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
        className={cn(
          "bg-white text-[#111111] shadow-2xl border border-[#e5e5e5] transition-shadow",
          fontClass,
          fontSizeStyle,
          marginClass,
          "w-[210mm] min-h-[297mm] print:w-full print:min-h-0 print:p-6 print:border-none print:shadow-none",
        )}
        style={{
          boxSizing: "border-box",
        }}
      >
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
                  <div
                    className="flex shrink-0 items-center justify-center rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs font-semibold text-[#666666]"
                    style={{ width: `${header.logoWidth}px`, height: "46px" }}
                  >
                    <span className="truncate uppercase tracking-wider text-[11px] text-[#4a38f5] font-bold">
                      {header.companyName ? header.companyName.slice(0, 15) : "VOXLY SERVICE"}
                    </span>
                  </div>
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
                {customer.showName && (
                  <div>
                    <span className="text-[#888888]">ФИО: </span>
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
        {/* TEAR-OFF CLIENT TICKET                                            */}
        {/* ================================================================= */}
        {tearOffTicket.visible && (
          <div
            {...getSectionInteractiveProps("tear_off_ticket", "Отрывной талон клиента")}
            className={cn(
              "mt-8 pt-4",
              getSectionInteractiveProps("tear_off_ticket", "Талон").className,
            )}
          >
            {renderSectionBadge("tear_off_ticket", "Отрывной талон клиента")}

            {/* Perforation Line */}
            <div className="relative flex items-center justify-center mb-3">
              <div className="absolute inset-x-0 border-t-2 border-dashed border-[#999999]" />
              <div className="relative bg-white px-3 flex items-center gap-1.5 text-[10px] text-[#666666] font-mono uppercase">
                <Scissors className="h-3.5 w-3.5 rotate-90 text-[#4a38f5]" />
                <span>Линия отреза талона</span>
              </div>
            </div>

            {/* Ticket Content */}
            <div className="rounded border border-[#cccccc] bg-[#fbfbfb] p-3">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="font-bold text-[12px] uppercase tracking-wide text-[#111111]">
                    {tearOffTicket.title || "ОТРЫВНОЙ ТАЛОН КЛИЕНТА"}
                  </div>
                  <div className="text-[10.5px]">
                    Заказ-наряд:{" "}
                    <span className="font-mono font-bold text-[#4a38f5]">{sampleData.orderNumber}</span> от{" "}
                    <span className="font-mono">{sampleData.orderDate}</span>
                  </div>
                  <div className="text-[10px] text-[#555555]">
                    Аппарат:{" "}
                    <span className="font-medium text-[#111111]">
                      {sampleData.equipmentType} {sampleData.equipmentBrand} {sampleData.equipmentModel}
                    </span>{" "}
                    (S/N: {sampleData.equipmentSerial})
                  </div>
                  <div className="text-[10px] text-[#555555]">
                    Заказчик: <span className="font-medium text-[#111111]">{sampleData.customerName}</span>
                  </div>
                  {header.companyPhone && (
                    <div className="text-[9.5px] text-[#777777]">
                      Справки по телефону сервиса:{" "}
                      <span className="font-mono font-semibold text-[#111111]">{header.companyPhone}</span>
                    </div>
                  )}
                  {tearOffTicket.customNote && (
                    <div className="text-[8.5px] text-[#888888] pt-1 leading-tight">
                      {tearOffTicket.customNote}
                    </div>
                  )}
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
    </div>
  );
}
