"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import {
  usePrintTemplates,
  useCreatePrintTemplate,
  useUpdatePrintTemplate,
  useSetDefaultPrintTemplate,
  useDeletePrintTemplate,
  useTogglePrintTemplateVisibility,
  useDuplicatePrintTemplate,
  type PrintLayoutConfig,
  type PrintSectionType,
  type PrintTemplateDTO,
} from "@/lib/api/use-print-templates";
import { useRepair } from "@/lib/api/use-repairs";
import {
  ALL_CLIENT_PRESETS,
  getPresetByDocumentType,
  DEFAULT_PREVIEW_SAMPLE_DATA,
  mapRepairToPreviewSampleData,
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
  order?: any;
  sampleData?: PreviewSampleData;
  isDrawer?: boolean;
}

export function VisualPrintTemplateEditor({
  open,
  onClose,
  initialDocumentType = "work_order",
  orderId,
  order,
  sampleData = DEFAULT_PREVIEW_SAMPLE_DATA,
  isDrawer = false,
}: VisualPrintTemplateEditorProps) {
  const [documentType, setDocumentType] = useState<string>(initialDocumentType);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("templates");
  const [activeSection, setActiveSection] = useState<PrintSectionType | null>(null);
  const [zoom, setZoom] = useState<number>(0.85);
  const [isPrinting, setIsPrinting] = useState<boolean>(false);

  // Queries & Mutations
  const { data: allTemplates = [], isLoading } = usePrintTemplates();
  const { data: orderDetail } = useRepair(orderId ?? null);
  const createMutation = useCreatePrintTemplate();
  const updateMutation = useUpdatePrintTemplate();
  const setDefaultMutation = useSetDefaultPrintTemplate();
  const deleteMutation = useDeletePrintTemplate();
  const toggleVisibilityMutation = useTogglePrintTemplateVisibility();
  const duplicateMutation = useDuplicatePrintTemplate();

  // Resolve effective sample data from active order if provided
  const effectiveSampleData = useMemo(() => {
    if (order) {
      return mapRepairToPreviewSampleData(order);
    }
    if (orderDetail) {
      return mapRepairToPreviewSampleData(orderDetail);
    }
    if (sampleData && sampleData !== DEFAULT_PREVIEW_SAMPLE_DATA) {
      return sampleData;
    }
    return DEFAULT_PREVIEW_SAMPLE_DATA;
  }, [order, orderDetail, sampleData]);

  // Active template: resolves by selected ID across all templates, or default for documentType
  const currentTemplate =
    (selectedTemplateId ? allTemplates.find((t) => t.id === selectedTemplateId) : null) ??
    allTemplates.find((t) => (t.documentType === documentType || t.slug === documentType) && t.isDefault) ??
    allTemplates.find((t) => t.documentType === documentType || t.slug === documentType) ??
    allTemplates[0] ??
    null;

  // Local editing configuration state
  const fallbackPreset = getPresetByDocumentType(documentType);
  const [config, setConfig] = useState<PrintLayoutConfig>(fallbackPreset.layoutConfig);
  const [hasChanges, setHasChanges] = useState<boolean>(false);

  const activeSampleData = effectiveSampleData;

  // Template rename state
  const [isEditingName, setIsEditingName] = useState<boolean>(false);
  const [nameInputValue, setNameInputValue] = useState<string>("");

  useEffect(() => {
    if (currentTemplate) {
      setNameInputValue(currentTemplate.name);
      setIsEditingName(false);
    }
  }, [currentTemplate?.id, currentTemplate?.name]);

  const handleSaveName = async (customName?: string) => {
    const trimmed = (customName ?? nameInputValue).trim();
    if (!currentTemplate || !currentTemplate.isCustom) return;
    if (!trimmed || trimmed === currentTemplate.name) {
      setIsEditingName(false);
      setNameInputValue(currentTemplate.name);
      return;
    }
    try {
      await updateMutation.mutateAsync({
        id: currentTemplate.id,
        payload: {
          name: trimmed,
        },
      });
      setIsEditingName(false);
      toast.success("Название шаблона обновлено");
    } catch {
      toast.error("Не удалось обновить название шаблона");
    }
  };

  const handleRenameFromInspector = async (template: PrintTemplateDTO, newName: string) => {
    if (!template.isCustom) return;
    try {
      await updateMutation.mutateAsync({
        id: template.id,
        payload: {
          name: newName,
        },
      });
      toast.success("Название шаблона обновлено");
    } catch {
      toast.error("Не удалось обновить название шаблона");
    }
  };

  // Sync config when template changes
  useEffect(() => {
    if (currentTemplate && currentTemplate.layoutConfig) {
      setConfig(currentTemplate.layoutConfig);
      setSelectedTemplateId(currentTemplate.id);
      if (currentTemplate.documentType && currentTemplate.documentType !== documentType) {
        setDocumentType(currentTemplate.documentType);
      }
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

  // Save changes (creates client version if system baseline, updates in place if custom)
  const handleSave = async () => {
    try {
      if (currentTemplate) {
        const updated = await updateMutation.mutateAsync({
          id: currentTemplate.id,
          payload: {
            layout_config: config,
            document_type: documentType,
          },
        });
        if (updated) {
          if (!currentTemplate.isCustom && updated.isCustom) {
            setSelectedTemplateId(updated.id);
            setDocumentType(updated.documentType);
            toast.success("Создана и сохранена пользовательская копия шаблона");
          } else {
            toast.success("Шаблон успешно сохранен");
          }
        }
      } else {
        const preset = getPresetByDocumentType(documentType);
        const created = await createMutation.mutateAsync({
          name: `${preset.name} (пользовательский)`,
          document_type: documentType,
          page_size: "A4",
          orientation: "portrait",
          layout_config: config,
          is_default: true,
          is_custom: true,
        });
        setSelectedTemplateId(created.id);
        toast.success("Новый шаблон создан и сохранен");
      }
      setHasChanges(false);
    } catch {
      toast.error("Не удалось сохранить шаблон");
    }
  };

  // Toggle visibility in quick print menu
  const handleToggleVisibility = async (id: string) => {
    try {
      const updated = await toggleVisibilityMutation.mutateAsync(id);
      toast.success(
        updated.isHidden
          ? "Шаблон скрыт из меню быстрой печати"
          : "Шаблон включен в меню быстрой печати",
      );
    } catch {
      toast.error("Не удалось изменить видимость шаблона");
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

  // Duplicate template
  const handleDuplicate = async (id?: string) => {
    const targetId = id || currentTemplate?.id;
    if (!targetId) return;
    try {
      const duplicated = await duplicateMutation.mutateAsync(targetId);
      setSelectedTemplateId(duplicated.id);
      setDocumentType(duplicated.documentType);
      setConfig(duplicated.layoutConfig);
      setHasChanges(false);
      toast.success(`Создана копия: ${duplicated.name}`);
    } catch {
      toast.error("Не удалось создать копию шаблона");
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

  const editorContent = (
    <div className="flex flex-col h-full w-full bg-white overflow-hidden">
      {/* ================================================================= */}
      {/* TOP BAR / HEADER                                                  */}
      {/* ================================================================= */}
      <div className="shrink-0 flex items-center justify-between border-b border-[#e5e5e5] bg-[#ffffff] px-4 py-2.5">
        {/* Left: Title & Active Template Badge (Single source of truth) */}
        <div className="flex items-center gap-3">
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

          {currentTemplate && (
            <>
              <div className="h-5 w-px bg-[#e5e5e5] hidden sm:block" />
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[#fafafa] border border-[#e5e5e5] text-xs">
                {isEditingName && currentTemplate.isCustom ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void handleSaveName();
                    }}
                    className="flex items-center gap-1"
                  >
                    <input
                      type="text"
                      value={nameInputValue}
                      onChange={(e) => setNameInputValue(e.target.value)}
                      onBlur={() => void handleSaveName()}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setIsEditingName(false);
                          setNameInputValue(currentTemplate.name);
                        }
                      }}
                      autoFocus
                      className="h-6 px-1.5 py-0.5 rounded border border-[#4a38f5] bg-white text-xs font-semibold text-[#111111] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5] min-w-[200px]"
                    />
                    <button
                      type="submit"
                      className="flex h-6 w-6 items-center justify-center rounded bg-[#4a38f5] text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer shrink-0"
                      title="Сохранить название"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingName(false);
                        setNameInputValue(currentTemplate.name);
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded text-[#888888] hover:bg-[#f0f0f0] transition-colors cursor-pointer shrink-0"
                      title="Отмена"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </form>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-[#111111] max-w-[160px] sm:max-w-[260px] truncate">
                      {currentTemplate.name}
                    </span>
                    {currentTemplate.isCustom && (
                      <button
                        type="button"
                        onClick={() => {
                          setNameInputValue(currentTemplate.name);
                          setIsEditingName(true);
                        }}
                        className="flex h-5 w-5 items-center justify-center text-[#888888] hover:text-[#4a38f5] rounded hover:bg-black/5 transition-colors cursor-pointer"
                        title="Переименовать пользовательский шаблон"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}

                <span
                  className={cn(
                    "rounded-[4px] px-1.5 py-0.2 text-[10px] font-medium",
                    currentTemplate.isCustom
                      ? "bg-[#4a38f5]/10 text-[#4a38f5]"
                      : "bg-[#e5e5e5] text-[#555555]",
                  )}
                >
                  {currentTemplate.isCustom ? "Пользовательский" : "Системный"}
                </span>
                {currentTemplate.isDefault && (
                  <span className="rounded-[4px] bg-emerald-50 text-emerald-700 px-1.5 py-0.2 text-[10px] font-semibold border border-emerald-200">
                    Основной
                  </span>
                )}
                {currentTemplate.isHidden && (
                  <span className="rounded-[4px] bg-amber-50 text-[#854d0e] px-1.5 py-0.2 text-[10px] font-medium border border-amber-200">
                    Скрыт в меню
                  </span>
                )}
              </div>

              {(orderId || order) && effectiveSampleData?.orderNumber && (
                <div className="hidden md:flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] bg-[#4a38f5]/5 border border-[#4a38f5]/20 text-[#4a38f5] text-[11px] font-medium">
                  <span className="font-semibold">Заказ: {effectiveSampleData.orderNumber}</span>
                  {effectiveSampleData.equipmentBrand && (
                    <span className="text-[#666666]">
                      ({effectiveSampleData.equipmentType} {effectiveSampleData.equipmentBrand} {effectiveSampleData.equipmentModel})
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Right: Actions, Zoom & Close */}
        <div className="flex items-center gap-2">
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
            onClick={() => void handleDuplicate()}
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
            templatesList={allTemplates}
            onSelectTemplate={(tpl) => {
              setSelectedTemplateId(tpl.id);
              setDocumentType(tpl.documentType);
              setConfig(tpl.layoutConfig);
              setHasChanges(false);
            }}
            onCreateTemplate={() => void handleDuplicate()}
            onCloneTemplate={() => void handleDuplicate()}
            onDuplicateTemplate={(id) => void handleDuplicate(id)}
            onToggleVisibility={(id) => void handleToggleVisibility(id)}
            onSetDefaultTemplate={handleSetDefault}
            onDeleteTemplate={handleDelete}
            onRenameTemplate={handleRenameFromInspector}
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
              sampleData={activeSampleData}
              activeSection={activeSection}
              onSelectSection={handleSelectSectionFromCanvas}
              zoom={zoom}
              documentType={documentType}
              isPrinting={isPrinting}
            />
          </div>
        </div>
      </div>
    </div>
  );

  if (isDrawer) {
    return editorContent;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 sm:p-4 backdrop-blur-xs">
      <div className="flex flex-col h-[96vh] w-full max-w-[1500px] rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {editorContent}
      </div>
    </div>
  );
}
