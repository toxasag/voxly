"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Printer,
  X,
  Save,
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Plus,
  Star,
  Copy,
  SlidersHorizontal,
  FileText,
  CheckCircle,
  Receipt,
  FileCheck2,
  Check,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import {
  usePrintTemplates,
  useCreatePrintTemplate,
  useUpdatePrintTemplate,
  useSetDefaultPrintTemplate,
  useDeletePrintTemplate,
  type PrintLayoutConfig,
  type PrintSectionType,
  type PrintTemplateDTO,
} from "@/lib/api/use-print-templates";
import {
  ALL_CLIENT_PRESETS,
  getPresetByDocumentType,
  DEFAULT_PREVIEW_SAMPLE_DATA,
  type PreviewSampleData,
} from "@/lib/repairs/print-presets-client";
import { VisualPrintCanvas } from "./VisualPrintCanvas";
import {
  VisualPrintInspector,
  type InspectorTab,
} from "./VisualPrintInspector";
import { cn } from "@/lib/utils";

export interface VisualPrintTemplateEditorProps {
  open: boolean;
  onClose: () => void;
  initialDocumentType?: string;
  orderId?: string;
  sampleData?: PreviewSampleData;
}

const DOCUMENT_TYPES = [
  { id: "work_order", label: "Акт приема", icon: FileText, desc: "Приемка оборудования" },
  { id: "repair_order", label: "Заказ-наряд", icon: SlidersHorizontal, desc: "Рабочий лист мастера" },
  { id: "completion_act", label: "Акт вып. работ", icon: FileCheck2, desc: "Выдача и гарантия" },
  { id: "receipt", label: "Товарный чек", icon: Receipt, desc: "Квитанция об оплате" },
] as const;

export function VisualPrintTemplateEditor({
  open,
  onClose,
  initialDocumentType = "work_order",
  orderId,
  sampleData = DEFAULT_PREVIEW_SAMPLE_DATA,
}: VisualPrintTemplateEditorProps) {
  const [documentType, setDocumentType] = useState<string>(initialDocumentType);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("templates");
  const [activeSection, setActiveSection] = useState<PrintSectionType | null>(null);
  const [zoom, setZoom] = useState<number>(0.85);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);

  // Queries & Mutations
  const { data: allTemplates = [], isLoading } = usePrintTemplates();
  const createMutation = useCreatePrintTemplate();
  const updateMutation = useUpdatePrintTemplate();
  const setDefaultMutation = useSetDefaultPrintTemplate();
  const deleteMutation = useDeletePrintTemplate();

  // Filter templates by current document type
  const typeTemplates = allTemplates.filter(
    (t) => t.documentType === documentType || t.slug === documentType,
  );

  // Active template
  const currentTemplate =
    typeTemplates.find((t) => t.id === selectedTemplateId) ??
    typeTemplates.find((t) => t.isDefault) ??
    typeTemplates[0] ??
    null;

  // Local editing configuration state
  const fallbackPreset = getPresetByDocumentType(documentType);
  const [config, setConfig] = useState<PrintLayoutConfig>(fallbackPreset.layoutConfig);
  const [hasChanges, setHasChanges] = useState<boolean>(false);

  // Sync config when template changes
  useEffect(() => {
    if (currentTemplate && currentTemplate.layoutConfig) {
      setConfig(currentTemplate.layoutConfig);
      setSelectedTemplateId(currentTemplate.id);
      setHasChanges(false);
    } else {
      const preset = getPresetByDocumentType(documentType);
      setConfig(preset.layoutConfig);
      setHasChanges(false);
    }
  }, [currentTemplate?.id, documentType]);

  const handleConfigChange = (newConfig: PrintLayoutConfig) => {
    setConfig(newConfig);
    setHasChanges(true);
  };

  const handleSelectSectionFromCanvas = (section: PrintSectionType) => {
    setActiveSection(section);
    // Switch inspector tab to the matching section
    switch (section) {
      case "header":
        setActiveTab("header");
        break;
      case "customer":
        setActiveTab("customer");
        break;
      case "equipment":
        setActiveTab("equipment");
        break;
      case "works_table":
      case "parts_table":
      case "totals":
        setActiveTab("table");
        break;
      case "terms":
        setActiveTab("terms");
        break;
      case "signatures":
      case "tear_off_ticket":
        setActiveTab("signatures");
        break;
      default:
        setActiveTab("style");
    }
  };

  // Save changes
  const handleSave = async () => {
    try {
      if (currentTemplate) {
        await updateMutation.mutateAsync({
          id: currentTemplate.id,
          payload: {
            layout_config: config,
            document_type: documentType,
          },
        });
        toast.success("Шаблон успешно сохранен");
      } else {
        const preset = getPresetByDocumentType(documentType);
        await createMutation.mutateAsync({
          name: `${preset.name} (Копия)`,
          document_type: documentType,
          page_size: "A4",
          orientation: "portrait",
          layout_config: config,
          is_default: true,
        });
        toast.success("Новый шаблон создан и сохранен");
      }
      setHasChanges(false);
    } catch (err) {
      toast.error("Не удалось сохранить шаблон");
    }
  };

  // Make default
  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultMutation.mutateAsync(id);
      toast.success("Шаблон назначен основным по умолчанию");
    } catch {
      toast.error("Ошибка при назначении шаблона по умолчанию");
    }
  };

  // Create new / clone
  const handleClone = async () => {
    try {
      const preset = getPresetByDocumentType(documentType);
      const baseName = currentTemplate ? currentTemplate.name : preset.name;
      const res = await createMutation.mutateAsync({
        name: `${baseName} (Копия ${new Date().toLocaleDateString("ru-RU")})`,
        document_type: documentType,
        page_size: "A4",
        orientation: "portrait",
        layout_config: config,
        is_default: false,
      });
      setSelectedTemplateId(res.id);
      toast.success("Копия шаблона создана");
    } catch {
      toast.error("Не удалось создать копию");
    }
  };

  // Delete
  const handleDelete = async (id: string) => {
    if (!confirm("Вы уверены, что хотите удалить этот шаблон?")) return;
    try {
      await deleteMutation.mutateAsync(id);
      setSelectedTemplateId(null);
      toast.success("Шаблон удален");
    } catch {
      toast.error("Не удалось удалить шаблон");
    }
  };

  // Test Print
  const handlePrint = useCallback(() => {
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 150);
  }, []);

  // Keyboard shortcut Ctrl+S / Cmd+S
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
      if (e.key === "Escape") {
        onClose();
      }
    };
    if (open) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, config, currentTemplate]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs">
      <div className="flex flex-col h-[96vh] w-full max-w-[1500px] rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* ================================================================= */}
        {/* TOP BAR / HEADER                                                  */}
        {/* ================================================================= */}
        <div className="shrink-0 flex items-center justify-between border-b border-[#e5e5e5] bg-[#ffffff] px-4 py-2.5">
          {/* Left: Title & Document Type Selector */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 border border-[#4a38f5]/20 text-[#4a38f5]">
                <Printer className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-xs font-bold text-[#111111] leading-tight">
                  Редактор печатных форм
                </h2>
                <p className="text-[10px] text-[#666666]">
                  Визуальный конструктор бланков Twenty CRM
                </p>
              </div>
            </div>

            <div className="h-5 w-px bg-[#e5e5e5] hidden md:block" />

            {/* Document Types Selector */}
            <div className="flex items-center gap-1 bg-[#f5f5f5] p-0.5 rounded-[8px] border border-[#e5e5e5]">
              {DOCUMENT_TYPES.map((dt) => {
                const Icon = dt.icon;
                const isSelected = documentType === dt.id;
                return (
                  <button
                    key={dt.id}
                    type="button"
                    onClick={() => {
                      setDocumentType(dt.id);
                      setSelectedTemplateId(null);
                    }}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-medium transition-colors cursor-pointer",
                      isSelected
                        ? "bg-white text-[#4a38f5] shadow-xs font-semibold"
                        : "text-[#666666] hover:text-[#111111]",
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    <span>{dt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Actions, Zoom & Close */}
          <div className="flex items-center gap-2">
            {/* Template Status Badge */}
            {currentTemplate && (
              <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 rounded-[6px] bg-[#fafafa] border border-[#e5e5e5] text-[11px] text-[#666666]">
                <span className="font-medium text-[#111111] truncate max-w-[150px]">
                  {currentTemplate.name}
                </span>
                {currentTemplate.isDefault && (
                  <span className="rounded bg-emerald-50 text-emerald-700 px-1 py-0.2 text-[9px] font-bold border border-emerald-200">
                    Основной
                  </span>
                )}
              </div>
            )}

            {/* Zoom Controls */}
            <div className="flex items-center gap-1 border border-[#e5e5e5] rounded-[8px] bg-white p-0.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, Math.round((z - 0.1) * 10) / 10))}
                className="p-1 text-[#666666] hover:text-[#111111] rounded hover:bg-[#f0f0f0] cursor-pointer"
                title="Уменьшить масштаб"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="px-1.5 text-[11px] font-mono font-medium text-[#555555] min-w-[42px] text-center">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(1.4, Math.round((z + 0.1) * 10) / 10))}
                className="p-1 text-[#666666] hover:text-[#111111] rounded hover:bg-[#f0f0f0] cursor-pointer"
                title="Увеличить масштаб"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(0.85)}
                className="px-1.5 py-0.5 text-[10px] text-[#666666] hover:text-[#111111] rounded hover:bg-[#f0f0f0] cursor-pointer border-l border-[#e5e5e5]"
                title="По ширине окна"
              >
                Fit
              </button>
            </div>

            {/* Clone Button */}
            <button
              type="button"
              onClick={handleClone}
              className="hidden sm:flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#666666] hover:text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
              title="Создать копию текущего шаблона"
            >
              <Copy className="h-3.5 w-3.5" />
              <span>Копия</span>
            </button>

            {/* Test Print Button */}
            <button
              type="button"
              onClick={handlePrint}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
              title="Печать текущей формы"
            >
              <Printer className="h-3.5 w-3.5 text-[#4a38f5]" />
              <span>Печать</span>
            </button>

            {/* Save Button */}
            <button
              type="button"
              onClick={handleSave}
              disabled={createMutation.isPending || updateMutation.isPending}
              className={cn(
                "flex h-8 items-center gap-1.5 rounded-[8px] px-3.5 text-xs font-medium text-white shadow-xs transition-colors cursor-pointer",
                hasChanges
                  ? "bg-[#4a38f5] hover:bg-[#3d2ee0] animate-pulse"
                  : "bg-[#4a38f5] hover:bg-[#3d2ee0]",
              )}
            >
              <Save className="h-3.5 w-3.5" />
              <span>{hasChanges ? "Сохранить *" : "Сохранить"}</span>
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] rounded-lg transition-colors ml-1 cursor-pointer"
              title="Закрыть редактор (Esc)"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ================================================================= */}
        {/* SPLIT VIEW WORKSPACE                                              */}
        {/* ================================================================= */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Inspector Panel (390px) */}
          <div className="w-[390px] shrink-0 h-full overflow-hidden">
            <VisualPrintInspector
              activeTab={activeTab}
              onTabChange={setActiveTab}
              config={config}
              onChangeConfig={handleConfigChange}
              currentTemplate={currentTemplate}
              templatesList={typeTemplates}
              onSelectTemplate={(tpl) => {
                setSelectedTemplateId(tpl.id);
                setConfig(tpl.layoutConfig);
                setHasChanges(false);
              }}
              onCreateTemplate={handleClone}
              onCloneTemplate={handleClone}
              onSetDefaultTemplate={handleSetDefault}
              onDeleteTemplate={handleDelete}
              onResetToPreset={() => {
                const preset = getPresetByDocumentType(documentType);
                setConfig(preset.layoutConfig);
                setHasChanges(true);
              }}
            />
          </div>

          {/* Right Live A4 Canvas Preview Area */}
          <div className="flex-1 h-full bg-[#eef0f3] overflow-auto p-6 flex flex-col items-center">
            {/* Sheet Page Info Tag */}
            <div className="mb-3 shrink-0 flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-[11px] font-medium text-[#666666] shadow-xs backdrop-blur-xs border border-[#e5e5e5]">
              <Eye className="h-3 w-3 text-[#4a38f5]" />
              <span>Лист 1 из 1 (A4 • 210 × 297 мм)</span>
              <span className="text-[#cccccc]">•</span>
              <span className="text-[#888888]">
                Кликните по любому блоку листа для мгновенной настройки
              </span>
            </div>

            {/* Canvas */}
            <div className="flex-1 w-full flex items-start justify-center pb-12">
              <VisualPrintCanvas
                layoutConfig={config}
                sampleData={sampleData}
                activeSection={activeSection}
                onSelectSection={handleSelectSectionFromCanvas}
                zoom={zoom}
                isPrinting={isPrinting}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
