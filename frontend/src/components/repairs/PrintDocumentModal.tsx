"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Printer, X, ExternalLink, FileText, CheckCircle, ShieldCheck, Receipt, SlidersHorizontal } from "lucide-react";
import { usePrintTemplates, getPrintRenderUrl, type PrintTemplateDTO } from "@/lib/api/use-print-templates";
import { PrintTemplateSettingsDrawer } from "./PrintTemplateSettingsDrawer";
import { cn } from "@/lib/utils";

interface PrintDocumentModalProps {
  open: boolean;
  orderId: string;
  orderNumber?: string;
  initialSlug?: string;
  onClose: () => void;
}

const TEMPLATE_CONFIG = [
  { slug: "work_order", label: "Заказ-наряд", icon: FileText, desc: "Прием в ремонт" },
  { slug: "completion_act", label: "Акт выполненных работ", icon: CheckCircle, desc: "Выдача клиенту" },
  { slug: "warranty_ticket", label: "Гарантийный талон", icon: ShieldCheck, desc: "Гарантия на работы" },
  { slug: "receipt", label: "Товарный чек", icon: Receipt, desc: "Квитанция об оплате" },
] as const;

export function PrintDocumentModal({
  open,
  orderId,
  orderNumber = "",
  initialSlug = "completion_act",
  onClose,
}: PrintDocumentModalProps) {
  const [selectedSlug, setSelectedSlug] = useState<string>(initialSlug);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (open && initialSlug) {
      setSelectedSlug(initialSlug);
    }
  }, [open, initialSlug]);

  // Load only templates marked as visible for quick print
  const { data: visibleTemplates = [] } = usePrintTemplates({ visibleOnly: true });

  const getDocIcon = (docType: string) => {
    switch (docType) {
      case "work_order":
        return FileText;
      case "repair_order":
        return SlidersHorizontal;
      case "completion_act":
        return CheckCircle;
      case "receipt":
        return Receipt;
      case "warranty_ticket":
        return ShieldCheck;
      default:
        return FileText;
    }
  };

  const activeTemplate =
    visibleTemplates.find(
      (t) => t.slug === selectedSlug || t.id === selectedSlug || t.documentType === selectedSlug,
    ) ?? visibleTemplates[0];

  const currentSlugOrId = activeTemplate ? (activeTemplate.slug || activeTemplate.id) : selectedSlug;
  const renderUrl = orderId ? getPrintRenderUrl(currentSlugOrId, orderId) : "";

  const cleanOrderNumber = orderNumber
    ? orderNumber.startsWith("№")
      ? orderNumber
      : `№${orderNumber}`
    : "";

  const handlePrint = useCallback(() => {
    if (iframeRef.current && iframeRef.current.contentWindow) {
      iframeRef.current.contentWindow.focus();
      iframeRef.current.contentWindow.print();
    }
  }, []);

  const handleOpenNewTab = useCallback(() => {
    if (renderUrl) {
      window.open(renderUrl, "_blank");
    }
  }, [renderUrl]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
      <div className="flex flex-col h-[92vh] w-full max-w-4xl rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between border-b border-[#e5e5e5] px-5 py-3.5 bg-[#fafafa]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 border border-[#4a38f5]/20">
              <Printer className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">
                Печать документов {cleanOrderNumber ? `по наряду ${cleanOrderNumber}` : ""}
              </h2>
              <p className="text-xs text-[#666666]">
                Шаблоны с автозаполнением реквизитов, работ и запчастей
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#666666] hover:text-[#4a38f5] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
              title="Настройки печатных форм"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-[#4a38f5]" />
              <span>Настроить</span>
            </button>
            <button
              type="button"
              onClick={handleOpenNewTab}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#666666] hover:text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
              title="Открыть в новой вкладке"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              В новой вкладке
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              Распечатать
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors ml-1"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Template Selector Tabs */}
        <div className="shrink-0 flex items-center gap-1 border-b border-[#e5e5e5] bg-[#fafafa] px-5 py-2 overflow-x-auto no-scrollbar">
          {visibleTemplates.length > 0
            ? visibleTemplates.map((t) => {
                const Icon = getDocIcon(t.documentType);
                const isSelected = activeTemplate?.id === t.id || activeTemplate?.slug === t.slug;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedSlug(t.slug || t.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer shrink-0",
                      isSelected
                        ? "bg-white text-[#4a38f5] shadow-xs border border-[#e5e5e5] font-semibold"
                        : "text-[#666666] hover:text-[#111111] hover:bg-[#f0f0f0]",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5", isSelected ? "text-[#4a38f5]" : "text-[#888888]")} />
                    <span>{t.name}</span>
                  </button>
                );
              })
            : TEMPLATE_CONFIG.map((t) => {
                const Icon = t.icon;
                const isSelected = selectedSlug === t.slug;
                return (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => setSelectedSlug(t.slug)}
                    className={cn(
                      "flex items-center gap-2 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer shrink-0",
                      isSelected
                        ? "bg-white text-[#4a38f5] shadow-xs border border-[#e5e5e5]"
                        : "text-[#666666] hover:text-[#111111] hover:bg-[#f0f0f0]",
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5", isSelected ? "text-[#4a38f5]" : "text-[#888888]")} />
                    <span>{t.label}</span>
                  </button>
                );
              })}
        </div>

        {/* Document Live Preview in iframe */}
        <div className="flex-1 bg-[#f0f0f0] p-4 overflow-hidden flex items-center justify-center">
          <div className="h-full w-full max-w-[800px] bg-white rounded-lg shadow-md border border-[#e5e5e5] overflow-hidden">
            {renderUrl ? (
              <iframe
                ref={iframeRef}
                src={renderUrl}
                title="Предпросмотр документа"
                className="w-full h-full border-0 bg-white"
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-[#888888]">
                Нет данных для печати
              </div>
            )}
          </div>
        </div>
      </div>

      <PrintTemplateSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialDocumentType={selectedSlug}
        orderId={orderId}
      />
    </div>
  );
}
