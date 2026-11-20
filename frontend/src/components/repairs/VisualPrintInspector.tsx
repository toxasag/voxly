"use client";

import { useState, useRef, useCallback } from "react";
import {
  FileText,
  Type,
  Building2,
  User,
  Wrench,
  Table,
  FileCheck2,
  PenTool,
  Scissors,
  Check,
  ChevronUp,
  ChevronDown,
  Trash2,
  Copy,
  Star,
  RotateCcw,
  Plus,
  Eye,
  EyeOff,
  Camera,
  UploadCloud,
  Loader2,
  SlidersHorizontal,
  Receipt,
  Sparkles,
  Pencil,
  X,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { AvatarCropModal } from "@/components/settings/AvatarCropModal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { loadImageFile, releaseImage, AvatarError } from "@/lib/utils/avatar";
import { toast } from "sonner";
import type {
  PrintLayoutConfig,
  PrintSectionType,
  PrintTemplateDTO,
} from "@/lib/api/use-print-templates";
import {
  ALL_CLIENT_PRESETS,
  getPresetByDocumentType,
} from "@/lib/repairs/print-presets-client";
import { cn } from "@/lib/utils";

export type InspectorTab =
  | "templates"
  | "style"
  | "header"
  | "customer"
  | "equipment"
  | "table"
  | "terms"
  | "signatures"
  | "tearOff";

interface VisualPrintInspectorProps {
  activeTab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  config: PrintLayoutConfig;
  onChangeConfig: (newConfig: PrintLayoutConfig) => void;
  currentTemplate?: PrintTemplateDTO | null;
  templatesList?: PrintTemplateDTO[];
  onSelectTemplate?: (template: PrintTemplateDTO) => void;
  onCreateTemplate?: () => void;
  onCloneTemplate?: () => void;
  onSetDefaultTemplate?: (id: string) => void;
  onToggleVisibility?: (id: string) => void;
  onDuplicateTemplate?: (id: string) => void;
  onDeleteTemplate?: (id: string) => void;
  onResetToPreset?: () => void;
  onRenameTemplate?: (template: PrintTemplateDTO, newName: string) => Promise<void> | void;
}

export function VisualPrintInspector({
  activeTab,
  onTabChange,
  config,
  onChangeConfig,
  currentTemplate,
  templatesList = [],
  onSelectTemplate,
  onCreateTemplate,
  onCloneTemplate,
  onSetDefaultTemplate,
  onToggleVisibility,
  onDuplicateTemplate,
  onDeleteTemplate,
  onResetToPreset,
  onRenameTemplate,
}: VisualPrintInspectorProps) {
  // Rename state
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState("");

  const handleStartRename = (e: React.MouseEvent, tpl: PrintTemplateDTO) => {
    e.stopPropagation();
    if (!tpl.isCustom) return;
    setEditingTemplateId(tpl.id);
    setEditNameValue(tpl.name);
  };

  const handleFinishRename = (tpl: PrintTemplateDTO) => {
    const trimmed = editNameValue.trim();
    if (trimmed && trimmed !== tpl.name && onRenameTemplate) {
      void onRenameTemplate(tpl, trimmed);
    }
    setEditingTemplateId(null);
  };
  // Logo upload & crop state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const [removeLogoOpen, setRemoveLogoOpen] = useState(false);
  const [cropSource, setCropSource] = useState<{ image: HTMLImageElement; url: string } | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Logo handlers
  const handleLogoFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    setIsProcessingLogo(true);
    try {
      const loaded = await loadImageFile(file);
      setCropSource(loaded);
    } catch (err) {
      toast.error(err instanceof AvatarError ? err.message : "Не удалось прочитать файл логотипа");
    } finally {
      setIsProcessingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  const handleLogoCropApply = useCallback(
    (dataUri: string) => {
      onChangeConfig({
        ...config,
        header: {
          ...config.header,
          logoUrl: dataUri,
        },
      });
      toast.success("Логотип обновлен");
      if (cropSource) releaseImage(cropSource.url);
      setCropSource(null);
    },
    [config, onChangeConfig, cropSource],
  );

  const handleRemoveLogo = useCallback(() => {
    onChangeConfig({
      ...config,
      header: {
        ...config.header,
        logoUrl: "",
      },
    });
    toast.success("Логотип удален");
    setRemoveLogoOpen(false);
  }, [config, onChangeConfig]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const file = e.dataTransfer.files?.[0];
    void handleLogoFile(file);
  };
  // Typed section update helpers
  const updateTheme = (patch: Partial<PrintLayoutConfig["theme"]>) =>
    onChangeConfig({ ...config, theme: { ...config.theme, ...patch } });
  const updateHeader = (patch: Partial<PrintLayoutConfig["header"]>) =>
    onChangeConfig({ ...config, header: { ...config.header, ...patch } });
  const updateCustomer = (patch: Partial<PrintLayoutConfig["customer"]>) =>
    onChangeConfig({ ...config, customer: { ...config.customer, ...patch } });
  const updateEquipment = (patch: Partial<PrintLayoutConfig["equipment"]>) =>
    onChangeConfig({ ...config, equipment: { ...config.equipment, ...patch } });
  const updateTable = (patch: Partial<PrintLayoutConfig["table"]>) =>
    onChangeConfig({ ...config, table: { ...config.table, ...patch } });
  const updateTerms = (patch: Partial<PrintLayoutConfig["terms"]>) =>
    onChangeConfig({ ...config, terms: { ...config.terms, ...patch } });
  const updateSignatures = (patch: Partial<PrintLayoutConfig["signatures"]>) =>
    onChangeConfig({ ...config, signatures: { ...config.signatures, ...patch } });
  const updateTearOffTicket = (patch: Partial<PrintLayoutConfig["tearOffTicket"]>) =>
    onChangeConfig({ ...config, tearOffTicket: { ...config.tearOffTicket, ...patch } });

  function updateConfig(section: "theme", patch: Partial<PrintLayoutConfig["theme"]>): void;
  function updateConfig(section: "header", patch: Partial<PrintLayoutConfig["header"]>): void;
  function updateConfig(section: "customer", patch: Partial<PrintLayoutConfig["customer"]>): void;
  function updateConfig(section: "equipment", patch: Partial<PrintLayoutConfig["equipment"]>): void;
  function updateConfig(section: "table", patch: Partial<PrintLayoutConfig["table"]>): void;
  function updateConfig(section: "terms", patch: Partial<PrintLayoutConfig["terms"]>): void;
  function updateConfig(section: "signatures", patch: Partial<PrintLayoutConfig["signatures"]>): void;
  function updateConfig(section: "tearOffTicket", patch: Partial<PrintLayoutConfig["tearOffTicket"]>): void;
  function updateConfig(
    section:
      | "theme"
      | "header"
      | "customer"
      | "equipment"
      | "table"
      | "terms"
      | "signatures"
      | "tearOffTicket",
    patch: unknown,
  ): void {
    if (section === "theme") updateTheme(patch as Partial<PrintLayoutConfig["theme"]>);
    else if (section === "header") updateHeader(patch as Partial<PrintLayoutConfig["header"]>);
    else if (section === "customer") updateCustomer(patch as Partial<PrintLayoutConfig["customer"]>);
    else if (section === "equipment") updateEquipment(patch as Partial<PrintLayoutConfig["equipment"]>);
    else if (section === "table") updateTable(patch as Partial<PrintLayoutConfig["table"]>);
    else if (section === "terms") updateTerms(patch as Partial<PrintLayoutConfig["terms"]>);
    else if (section === "signatures") updateSignatures(patch as Partial<PrintLayoutConfig["signatures"]>);
    else if (section === "tearOffTicket") updateTearOffTicket(patch as Partial<PrintLayoutConfig["tearOffTicket"]>);
  }

  const DOC_TYPE_LABELS: Record<string, string> = {
    work_order: "Акт приема",
    repair_order: "Заказ-наряд",
    completion_act: "Акт вып. работ",
    receipt: "Товарный чек",
    warranty_ticket: "Гарантийный талон",
  };

  const systemTemplates = templatesList.filter((t) => !t.isCustom);
  const customTemplates = templatesList.filter((t) => t.isCustom);

  const renderTemplateCard = (tpl: PrintTemplateDTO) => {
    const isSelected = currentTemplate?.id === tpl.id;
    const docLabel = DOC_TYPE_LABELS[tpl.documentType] || tpl.documentType;

    return (
      <div
        key={tpl.id}
        onClick={() => onSelectTemplate?.(tpl)}
        className={cn(
          "group relative rounded-[8px] border p-3 bg-white transition-all cursor-pointer",
          isSelected
            ? "border-[#4a38f5] ring-2 ring-[#4a38f5]/20 bg-[#4a38f5]/[0.02] shadow-xs"
            : "border-[#e5e5e5] hover:border-[#cccccc] hover:bg-[#fafafa]/50",
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            {/* Badges row */}
            <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
              <span className="rounded-[4px] bg-[#f0f0f0] text-[#555555] px-1.5 py-0.5 text-[10px] font-medium">
                {docLabel}
              </span>
              <span
                className={cn(
                  "rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium",
                  tpl.isCustom
                    ? "bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "bg-[#e5e5e5] text-[#555555]",
                )}
              >
                {tpl.isCustom ? "Пользовательский" : "Системный"}
              </span>
              {tpl.isDefault && (
                <span className="flex items-center gap-0.5 rounded-[4px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold">
                  <Check className="h-2.5 w-2.5" />
                  Основной
                </span>
              )}
              {tpl.isHidden && (
                <span className="flex items-center gap-0.5 rounded-[4px] bg-amber-50 text-[#854d0e] border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium">
                  <EyeOff className="h-2.5 w-2.5" />
                  Скрыт в меню
                </span>
              )}
            </div>

            {/* Template name & description */}
            <div className="flex items-center gap-1.5">
              {editingTemplateId === tpl.id ? (
                <div
                  className="flex items-center gap-1 w-full my-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="text"
                    value={editNameValue}
                    onChange={(e) => setEditNameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleFinishRename(tpl);
                      } else if (e.key === "Escape") {
                        setEditingTemplateId(null);
                      }
                    }}
                    autoFocus
                    className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs font-semibold text-[#111111] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]"
                  />
                  <button
                    type="button"
                    onClick={() => handleFinishRename(tpl)}
                    className="flex h-6 w-6 items-center justify-center rounded bg-[#4a38f5] text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer shrink-0"
                    title="Сохранить"
                  >
                    <Check className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingTemplateId(null)}
                    className="flex h-6 w-6 items-center justify-center rounded text-[#888888] hover:bg-[#f0f0f0] transition-colors cursor-pointer shrink-0"
                    title="Отмена"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <>
                  <h4 className="text-xs font-semibold text-[#111111] truncate group-hover:text-[#4a38f5] transition-colors">
                    {tpl.name}
                  </h4>
                  {isSelected && (
                    <span className="rounded-full bg-[#4a38f5] text-white px-1.5 py-0.2 text-[9px] font-bold shrink-0">
                      Активен
                    </span>
                  )}
                </>
              )}
            </div>
            {tpl.description && (
              <p className="text-[11px] text-[#666666] mt-0.5 line-clamp-1 leading-snug">
                {tpl.description}
              </p>
            )}
          </div>
        </div>

        {/* Card footer: Page size & Action buttons */}
        <div className="mt-2.5 flex items-center justify-between pt-2 border-t border-[#f0f0f0]">
          <span className="text-[10px] font-mono text-[#888888] uppercase">
            {tpl.pageSize || "A4"} • {tpl.orientation === "landscape" ? "Альбомная" : "Книжная"}
          </span>

          <div className="flex items-center gap-1 shrink-0">
            {/* Rename button (custom only) */}
            {tpl.isCustom && onRenameTemplate && (
              <button
                type="button"
                onClick={(e) => handleStartRename(e, tpl)}
                className="p-1 text-[#666666] hover:text-[#4a38f5] hover:bg-[#f0f0f0] rounded-[4px] transition-colors cursor-pointer"
                title="Переименовать шаблон"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Visibility toggle button */}
            {onToggleVisibility && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleVisibility(tpl.id);
                }}
                className={cn(
                  "p-1 rounded-[4px] transition-colors cursor-pointer",
                  tpl.isHidden
                    ? "text-[#888888] hover:text-[#4a38f5] hover:bg-[#f0f0f0]"
                    : "text-[#4a38f5] hover:bg-[#4a38f5]/10",
                )}
                title={
                  tpl.isHidden
                    ? "Включить в меню быстрой печати"
                    : "Скрыть из меню быстрой печати"
                }
              >
                {tpl.isHidden ? (
                  <EyeOff className="h-3.5 w-3.5 text-[#888888]" />
                ) : (
                  <Eye className="h-3.5 w-3.5" />
                )}
              </button>
            )}

            {/* Duplicate button */}
            {onDuplicateTemplate && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDuplicateTemplate(tpl.id);
                }}
                className="p-1 text-[#666666] hover:text-[#4a38f5] hover:bg-[#f0f0f0] rounded-[4px] transition-colors cursor-pointer"
                title="Создать копию шаблона"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Set as default button */}
            {!tpl.isDefault && onSetDefaultTemplate && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetDefaultTemplate(tpl.id);
                }}
                className="p-1 text-[#666666] hover:text-amber-600 hover:bg-[#f0f0f0] rounded-[4px] transition-colors cursor-pointer"
                title="Сделать основным по умолчанию"
              >
                <Star className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Delete button (only custom non-default templates) */}
            {tpl.isCustom && !tpl.isDefault && onDeleteTemplate && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteTemplate(tpl.id);
                }}
                className="p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 rounded-[4px] transition-colors cursor-pointer"
                title="Удалить шаблон"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  const navItems: Array<{ id: InspectorTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: "templates", label: "Шаблоны", icon: FileText },
    { id: "style", label: "Стиль", icon: Type },
    { id: "header", label: "Шапка", icon: Building2 },
    { id: "customer", label: "Клиент", icon: User },
    { id: "equipment", label: "Техника", icon: Wrench },
    { id: "table", label: "Таблица", icon: Table },
    { id: "terms", label: "Условия", icon: FileCheck2 },
    { id: "signatures", label: "Подписи", icon: PenTool },
  ];

  return (
    <div className="flex flex-col h-full bg-[#fbfbfb] border-r border-[#e5e5e5] select-none">
      {/* Top Inspector Tab Nav */}
      <div className="shrink-0 flex items-center gap-1 overflow-x-auto p-2 border-b border-[#e5e5e5] bg-[#ffffff] no-scrollbar">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={cn(
                "flex items-center gap-1.5 shrink-0 px-2.5 py-1.5 rounded-[6px] text-xs font-medium transition-colors cursor-pointer",
                isActive
                  ? "bg-[#4a38f5] text-white shadow-xs font-semibold"
                  : "text-[#666666] hover:text-[#111111] hover:bg-[#f0f0f0]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Content Body (Scrollable) */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ================================================================= */}
        {/* TAB 1: TEMPLATES & PRESETS (SINGLE INTERACTIVE CATALOG)           */}
        {/* ================================================================= */}
        {activeTab === "templates" && (
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider mb-1">
                  Каталог печатных бланков
                </h3>
                <p className="text-[11px] text-[#666666]">
                  Кликните по бланку для выбора и мгновенного предпросмотра
                </p>
              </div>
              {onCreateTemplate && (
                <button
                  type="button"
                  onClick={onCreateTemplate}
                  className="flex items-center gap-1 rounded-[6px] bg-[#4a38f5] px-2.5 py-1 text-[11px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors cursor-pointer shrink-0"
                >
                  <Plus className="h-3 w-3" />
                  <span>Новый</span>
                </button>
              )}
            </div>

            {/* Custom Templates Section */}
            {customTemplates.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#4a38f5] uppercase tracking-wider">
                    Пользовательские шаблоны ({customTemplates.length})
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {customTemplates.map(renderTemplateCard)}
                </div>
              </div>
            )}

            {/* System Baseline Templates Section */}
            <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                  Системные базовые бланки ({systemTemplates.length || ALL_CLIENT_PRESETS.length})
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {systemTemplates.length > 0
                  ? systemTemplates.map(renderTemplateCard)
                  : ALL_CLIENT_PRESETS.map((preset) => {
                      const isMatch =
                        currentTemplate?.slug === preset.slug ||
                        currentTemplate?.documentType === preset.documentType;
                      return (
                        <div
                          key={preset.slug}
                          onClick={() => {
                            onChangeConfig(preset.layoutConfig);
                          }}
                          className={cn(
                            "rounded-[8px] border p-3 bg-white transition-all cursor-pointer",
                            isMatch
                              ? "border-[#4a38f5] ring-2 ring-[#4a38f5]/20 bg-[#4a38f5]/[0.02] shadow-xs"
                              : "border-[#e5e5e5] hover:border-[#cccccc]",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-[#111111]">
                              {preset.name}
                            </span>
                            <span className="rounded bg-[#f0f0f0] text-[#555555] px-1.5 py-0.5 text-[10px] font-medium">
                              Системный
                            </span>
                          </div>
                          <p className="text-[11px] text-[#666666] mt-0.5 leading-snug">
                            {preset.description}
                          </p>
                        </div>
                      );
                    })}
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 2: STYLE & TYPOGRAPHY                                         */}
        {/* ================================================================= */}
        {activeTab === "style" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider mb-1">
                Шрифт и форматирование бланка
              </h3>
              <p className="text-[11px] text-[#666666]">
                Настройте гарнитуру, базовый кегль и поля листа для идеальной посадки на A4
              </p>
            </div>

            {/* Font Family */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                Гарнитура шрифта
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: "Inter", label: "Inter (CRM)", font: "font-sans" },
                  { id: "Arial", label: "Arial (Стандарт)", font: "font-sans" },
                  { id: "Roboto", label: "Roboto (Google)", font: "font-sans" },
                  { id: "Times New Roman", label: "Times (С засечками)", font: "font-serif" },
                ].map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() =>
                      updateConfig("theme", {
                        fontFamily: f.id as "Inter" | "Arial" | "Times New Roman" | "Roboto",
                      })
                    }
                    className={cn(
                      "h-8 rounded-[8px] border px-2.5 text-xs font-medium text-left transition-colors cursor-pointer flex items-center justify-between",
                      config.theme.fontFamily === f.id
                        ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] font-semibold"
                        : "border-[#e5e5e5] bg-white text-[#111111] hover:border-[#cccccc]",
                    )}
                  >
                    <span className={f.font}>{f.label}</span>
                    {config.theme.fontFamily === f.id && <Check className="h-3 w-3 text-[#4a38f5]" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Size */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                Базовый размер текста
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "small", label: "Компактный", desc: "11px" },
                  { id: "medium", label: "Обычный", desc: "12px" },
                  { id: "large", label: "Крупный", desc: "13px" },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      updateConfig("theme", {
                        fontSize: s.id as "small" | "medium" | "large",
                      })
                    }
                    className={cn(
                      "rounded-[8px] border p-2 text-center transition-colors cursor-pointer",
                      config.theme.fontSize === s.id
                        ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] font-semibold"
                        : "border-[#e5e5e5] bg-white text-[#111111] hover:border-[#cccccc]",
                    )}
                  >
                    <div className="text-xs">{s.label}</div>
                    <div className="text-[10px] text-[#888888]">{s.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Sheet Margins */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                Поля листа (отступы)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "compact", label: "Узкие", desc: "15 мм" },
                  { id: "normal", label: "Стандарт", desc: "20 мм" },
                  { id: "spacious", label: "Просторные", desc: "25 мм" },
                ].map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() =>
                      updateConfig("theme", {
                        margins: m.id as "compact" | "normal" | "spacious",
                      })
                    }
                    className={cn(
                      "rounded-[8px] border p-2 text-center transition-colors cursor-pointer",
                      config.theme.margins === m.id
                        ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] font-semibold"
                        : "border-[#e5e5e5] bg-white text-[#111111] hover:border-[#cccccc]",
                    )}
                  >
                    <div className="text-xs">{m.label}</div>
                    <div className="text-[10px] text-[#888888]">{m.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Table Theme Options */}
            <div className="space-y-3 pt-2 border-t border-[#e5e5e5]">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-[#111111]">Акцентные шапки таблиц</div>
                  <div className="text-[11px] text-[#666666]">
                    Выделять заголовки колонок легкой серыми подложкой
                  </div>
                </div>
                <Switch
                  checked={config.theme.accentHeaders}
                  onCheckedChange={(val) => updateConfig("theme", { accentHeaders: val })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-[#111111]">Четкие границы ячеек</div>
                  <div className="text-[11px] text-[#666666]">
                    Прорисовывать тонкие линии вокруг каждой ячейки
                  </div>
                </div>
                <Switch
                  checked={config.theme.showBorders}
                  onCheckedChange={(val) => updateConfig("theme", { showBorders: val })}
                />
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 3: HEADER & REQUISITES                                        */}
        {/* ================================================================= */}
        {activeTab === "header" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider mb-1">
                Шапка бланка и реквизиты
              </h3>
              <p className="text-[11px] text-[#666666]">
                Брендинг, логотип сервисного центра, контактные данные и реквизиты
              </p>
            </div>

            {/* Logo Settings */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[#111111]">Показывать логотип</div>
                  <div className="text-[10.5px] text-[#666666]">Размещение в левом верхнем углу</div>
                </div>
                <Switch
                  checked={config.header.showLogo}
                  onCheckedChange={(val) => updateConfig("header", { showLogo: val })}
                />
              </div>

              {config.header.showLogo && (
                <div className="space-y-3 pt-2 border-t border-[#f0f0f0]">
                  {/* Current Logo Preview or Upload Dropzone */}
                  {config.header.logoUrl ? (
                    <div className="flex items-center gap-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2.5">
                      <div className="flex h-14 w-28 shrink-0 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white p-1 overflow-hidden">
                        <img
                          src={config.header.logoUrl}
                          alt="Логотип"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-[#111111] truncate">
                          Логотип загружен
                        </div>
                        <div className="text-[10px] text-[#666666]">
                          Отображается в шапке бланка
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isProcessingLogo}
                            className="flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:underline cursor-pointer"
                          >
                            <Camera className="h-3 w-3" />
                            <span>Заменить</span>
                          </button>
                          <span className="text-[#cccccc]">•</span>
                          <button
                            type="button"
                            onClick={() => setRemoveLogoOpen(true)}
                            className="flex items-center gap-1 text-[11px] font-medium text-rose-600 hover:underline cursor-pointer"
                          >
                            <Trash2 className="h-3 w-3" />
                            <span>Удалить</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        "flex flex-col items-center justify-center rounded-[8px] border border-dashed p-4 text-center cursor-pointer transition-colors",
                        isDragOver
                          ? "border-[#4a38f5] bg-[#4a38f5]/5"
                          : "border-[#d0d0d0] bg-[#fafafa] hover:border-[#4a38f5] hover:bg-white",
                      )}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white border border-[#e5e5e5] text-[#4a38f5] shadow-xs mb-1.5">
                        {isProcessingLogo ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <UploadCloud className="h-4 w-4" />
                        )}
                      </div>
                      <span className="text-xs font-medium text-[#111111]">
                        {isProcessingLogo ? "Обработка изображения..." : "Загрузить логотип"}
                      </span>
                      <span className="text-[10.5px] text-[#888888] mt-0.5">
                        Перетащите файл или нажмите для выбора
                      </span>
                      <span className="text-[10px] text-[#aaaaaa] mt-1">
                        PNG, JPG, WebP до 10 МБ
                      </span>
                    </div>
                  )}

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => void handleLogoFile(e.target.files?.[0])}
                  />

                  {/* Logo Width Slider */}
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs text-[#555555]">
                      <span>Ширина логотипа на листе</span>
                      <span className="font-mono font-medium text-[#111111]">
                        {config.header.logoWidth} px
                      </span>
                    </div>
                    <input
                      type="range"
                      min="80"
                      max="260"
                      step="5"
                      value={config.header.logoWidth}
                      onChange={(e) => updateConfig("header", { logoWidth: Number(e.target.value) })}
                      className="w-full accent-[#4a38f5] cursor-pointer"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Document Title & Subtitle */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                Заголовок документа
              </label>
              <input
                type="text"
                value={config.header.documentTitle}
                onChange={(e) => updateConfig("header", { documentTitle: e.target.value })}
                placeholder="АКТ ПРИЕМА-ПЕРЕДАЧИ ОБОРУДОВАНИЯ"
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-semibold"
              />
              <input
                type="text"
                value={config.header.documentSubtitle ?? ""}
                onChange={(e) => updateConfig("header", { documentSubtitle: e.target.value })}
                placeholder="Подзаголовок (например, Заказ-наряд на ремонт)"
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 text-[#666666]"
              />
            </div>

            {/* Date & Number Toggles */}
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-2.5">
                <span className="text-xs text-[#111111]">Дата</span>
                <Switch
                  checked={config.header.showDate}
                  onCheckedChange={(val) => updateConfig("header", { showDate: val })}
                />
              </div>
              <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-2.5">
                <span className="text-xs text-[#111111]">Номер бланка</span>
                <Switch
                  checked={config.header.showDocNumber}
                  onCheckedChange={(val) => updateConfig("header", { showDocNumber: val })}
                />
              </div>
            </div>

            {/* Company Requisites Fields */}
            <div className="space-y-2.5 pt-2 border-t border-[#e5e5e5]">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                  Реквизиты сервиса
                </span>
                <Switch
                  checked={config.header.showCompanyDetails}
                  onCheckedChange={(val) => updateConfig("header", { showCompanyDetails: val })}
                />
              </div>

              {config.header.showCompanyDetails && (
                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] text-[#888888]">Название компании / ИП</span>
                    <input
                      type="text"
                      value={config.header.companyName}
                      onChange={(e) => updateConfig("header", { companyName: e.target.value })}
                      placeholder="ООО / ИП Название компании"
                      className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>

                  <div>
                    <span className="text-[10px] text-[#888888]">Адрес сервисного центра</span>
                    <input
                      type="text"
                      value={config.header.companyAddress}
                      onChange={(e) => updateConfig("header", { companyAddress: e.target.value })}
                      placeholder="г. Москва, ул. Примерная, д. 1"
                      className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-[#888888]">Телефон</span>
                      <input
                        type="text"
                        value={config.header.companyPhone}
                        onChange={(e) => updateConfig("header", { companyPhone: e.target.value })}
                        placeholder="+7 (999) 000-00-00"
                        className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-[#888888]">Email</span>
                      <input
                        type="text"
                        value={config.header.companyEmail ?? ""}
                        onChange={(e) => updateConfig("header", { companyEmail: e.target.value })}
                        placeholder="info@service.ru"
                        className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-[#888888]">ИНН</span>
                      <input
                        type="text"
                        value={config.header.companyInn ?? ""}
                        onChange={(e) => updateConfig("header", { companyInn: e.target.value })}
                        placeholder="ИНН (10 или 12 цифр)"
                        className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-[#888888]">ОГРН / ОГРНИП</span>
                      <input
                        type="text"
                        value={config.header.companyOgrn ?? ""}
                        onChange={(e) => updateConfig("header", { companyOgrn: e.target.value })}
                        placeholder="ОГРН / ОГРНИП"
                        className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                      />
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] text-[#888888]">Режим работы</span>
                    <input
                      type="text"
                      value={config.header.workingHours ?? ""}
                      onChange={(e) => updateConfig("header", { workingHours: e.target.value })}
                      placeholder="Пн-Пт 10:00-19:00, Сб 11:00-16:00"
                      className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 4: CUSTOMER SECTION                                           */}
        {/* ================================================================= */}
        {activeTab === "customer" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  Данные Заказчика
                </h3>
                <p className="text-[11px] text-[#666666]">
                  Отображение блока с контактами и реквизитами клиента
                </p>
              </div>
              <Switch
                checked={config.customer.visible}
                onCheckedChange={(val) => updateConfig("customer", { visible: val })}
              />
            </div>

            {config.customer.visible && (
              <div className="space-y-3 pt-2">
                <div>
                  <span className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                    Заголовок блока
                  </span>
                  <input
                    type="text"
                    value={config.customer.title}
                    onChange={(e) => updateConfig("customer", { title: e.target.value })}
                    placeholder="Заказчик / Клиент"
                    className="w-full mt-1 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
                  <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                    Поля карточки клиента
                  </span>

                  {[
                    { key: "showName", label: "ФИО Заказчика", checked: config.customer.showName },
                    { key: "showPhone", label: "Номер телефона", checked: config.customer.showPhone },
                    { key: "showEmail", label: "Email адрес", checked: config.customer.showEmail },
                    { key: "showAddress", label: "Фактический адрес", checked: config.customer.showAddress },
                    { key: "showPassport", label: "Паспортные данные", checked: config.customer.showPassport },
                  ].map((field) => (
                    <div
                      key={field.key}
                      className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-2.5"
                    >
                      <span className="text-xs text-[#111111]">{field.label}</span>
                      <Switch
                        checked={field.checked}
                        onCheckedChange={(val) =>
                          updateConfig("customer", {
                            [field.key]: val,
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 5: EQUIPMENT SECTION                                          */}
        {/* ================================================================= */}
        {activeTab === "equipment" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  Оборудование и неисправность
                </h3>
                <p className="text-[11px] text-[#666666]">
                  Сведения об аппарате, серийном номере, дефектах и комплекте
                </p>
              </div>
              <Switch
                checked={config.equipment.visible}
                onCheckedChange={(val) => updateConfig("equipment", { visible: val })}
              />
            </div>

            {config.equipment.visible && (
              <div className="space-y-3 pt-2">
                <div>
                  <span className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                    Заголовок блока
                  </span>
                  <input
                    type="text"
                    value={config.equipment.title}
                    onChange={(e) => updateConfig("equipment", { title: e.target.value })}
                    placeholder="Оборудование и неисправность"
                    className="w-full mt-1 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
                  <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                    Отображаемые поля
                  </span>

                  {[
                    {
                      key: "showTypeBrandModel",
                      label: "Тип, бренд и модель аппарата",
                      checked: config.equipment.showTypeBrandModel,
                    },
                    {
                      key: "showSerial",
                      label: "Серийный номер (S/N / IMEI)",
                      checked: config.equipment.showSerial,
                    },
                    {
                      key: "showDefect",
                      label: "Заявленная неисправность",
                      checked: config.equipment.showDefect,
                    },
                    {
                      key: "showAppearance",
                      label: "Внешний вид и следы износа",
                      checked: config.equipment.showAppearance,
                    },
                    {
                      key: "showPackage",
                      label: "Комплектация при приеме",
                      checked: config.equipment.showPackage,
                    },
                    {
                      key: "showMaster",
                      label: "Назначенный мастер-исполнитель",
                      checked: config.equipment.showMaster,
                    },
                    {
                      key: "showEstimatedCost",
                      label: "Ориентировочная / согласованная стоимость",
                      checked: config.equipment.showEstimatedCost,
                    },
                  ].map((field) => (
                    <div
                      key={field.key}
                      className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-2.5"
                    >
                      <span className="text-xs text-[#111111]">{field.label}</span>
                      <Switch
                        checked={field.checked}
                        onCheckedChange={(val) =>
                          updateConfig("equipment", {
                            [field.key]: val,
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 6: SERVICES & PARTS TABLE                                     */}
        {/* ================================================================= */}
        {activeTab === "table" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  Таблица работ и материалов
                </h3>
                <p className="text-[11px] text-[#666666]">
                  Настройка колонок сметы, сумм, НДС и итоговых расчетов
                </p>
              </div>
              <Switch
                checked={config.table.visible}
                onCheckedChange={(val) => updateConfig("table", { visible: val })}
              />
            </div>

            {config.table.visible && (
              <div className="space-y-3 pt-2">
                {/* Tables visibility */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-2.5">
                    <span className="text-xs font-medium text-[#111111]">Блок работ</span>
                    <Switch
                      checked={config.table.showWorks}
                      onCheckedChange={(val) => updateConfig("table", { showWorks: val })}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-2.5">
                    <span className="text-xs font-medium text-[#111111]">Блок запчастей</span>
                    <Switch
                      checked={config.table.showParts}
                      onCheckedChange={(val) => updateConfig("table", { showParts: val })}
                    />
                  </div>
                </div>

                {/* Custom titles */}
                <div className="space-y-2">
                  <div>
                    <span className="text-[10px] text-[#888888]">Заголовок таблицы работ</span>
                    <input
                      type="text"
                      value={config.table.worksTitle}
                      onChange={(e) => updateConfig("table", { worksTitle: e.target.value })}
                      className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                  <div>
                    <span className="text-[10px] text-[#888888]">Заголовок таблицы запчастей</span>
                    <input
                      type="text"
                      value={config.table.partsTitle}
                      onChange={(e) => updateConfig("table", { partsTitle: e.target.value })}
                      className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                </div>

                {/* Columns Selection */}
                <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
                  <span className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                    Колонки в таблице
                  </span>
                  <div className="space-y-1.5">
                    {config.table.columns.map((col, idx) => (
                      <div
                        key={col.id}
                        className="flex items-center justify-between rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs"
                      >
                        <span className="text-[#111111] font-medium">{col.label}</span>
                        <Switch
                          checked={col.visible}
                          onCheckedChange={(val) => {
                            const newCols = [...config.table.columns];
                            const target = newCols[idx];
                            if (target) {
                              target.visible = val;
                              updateConfig("table", { columns: newCols });
                            }
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Totals & VAT Options */}
                <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
                  <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-2.5">
                    <span className="text-xs text-[#111111]">Показывать строку ИТОГО</span>
                    <Switch
                      checked={config.table.showTotals}
                      onCheckedChange={(val) => updateConfig("table", { showTotals: val })}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-2.5">
                    <span className="text-xs text-[#111111]">Сумма прописью</span>
                    <Switch
                      checked={config.table.showGrandTotalWords}
                      onCheckedChange={(val) => updateConfig("table", { showGrandTotalWords: val })}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white p-2.5">
                    <div>
                      <div className="text-xs text-[#111111]">Выделять НДС</div>
                      <div className="text-[10px] text-[#888888]">Расчет суммы налога</div>
                    </div>
                    <Switch
                      checked={config.table.showVat}
                      onCheckedChange={(val) => updateConfig("table", { showVat: val })}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 7: TERMS & WARRANTY                                           */}
        {/* ================================================================= */}
        {activeTab === "terms" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  Условия и гарантия
                </h3>
                <p className="text-[11px] text-[#666666]">
                  Правила приема/выдачи, гарантийный срок и согласие на обработку ПДН
                </p>
              </div>
              <Switch
                checked={config.terms.visible}
                onCheckedChange={(val) => updateConfig("terms", { visible: val })}
              />
            </div>

            {config.terms.visible && (
              <div className="space-y-3 pt-2">
                <div>
                  <span className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                    Заголовок блока
                  </span>
                  <input
                    type="text"
                    value={config.terms.title}
                    onChange={(e) => updateConfig("terms", { title: e.target.value })}
                    placeholder="Условия и гарантийные обязательства"
                    className="w-full mt-1 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-[#555555] uppercase tracking-wider">
                    Текст условий и правил
                  </span>
                  <textarea
                    rows={4}
                    value={config.terms.termsText}
                    onChange={(e) => updateConfig("terms", { termsText: e.target.value })}
                    placeholder="Текст условий обслуживания..."
                    className="w-full mt-1 rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none leading-relaxed"
                  />
                </div>

                {/* Warranty */}
                <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-[#111111]">
                      Гарантийный срок (в днях)
                    </span>
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={config.terms.warrantyDays}
                      onChange={(e) => updateConfig("terms", { warrantyDays: Number(e.target.value) })}
                      className="w-20 h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-right text-xs font-mono font-bold text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                </div>

                {/* PDN Consent */}
                <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium text-[#111111]">
                        Согласие на обработку ПДН (152-ФЗ)
                      </div>
                      <div className="text-[10px] text-[#666666]">
                        Юридическая строка согласия Заказчика
                      </div>
                    </div>
                    <Switch
                      checked={config.terms.showPdnConsent}
                      onCheckedChange={(val) => updateConfig("terms", { showPdnConsent: val })}
                    />
                  </div>

                  {config.terms.showPdnConsent && (
                    <textarea
                      rows={2}
                      value={config.terms.pdnText}
                      onChange={(e) => updateConfig("terms", { pdnText: e.target.value })}
                      placeholder="Заказчик подтверждает согласие..."
                      className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* TAB 8: SIGNATURES & TEAR-OFF TICKET                               */}
        {/* ================================================================= */}
        {activeTab === "signatures" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider mb-1">
                Подписи и отрывной талон
              </h3>
              <p className="text-[11px] text-[#666666]">
                Блок заверения документа сторонами и отрывной квиточек клиенту
              </p>
            </div>

            {/* Signatures block */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#111111]">Блок подписей</span>
                <Switch
                  checked={config.signatures.visible}
                  onCheckedChange={(val) => updateConfig("signatures", { visible: val })}
                />
              </div>

              {config.signatures.visible && (
                <div className="space-y-2 pt-2 border-t border-[#f0f0f0]">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] text-[#888888]">Подпись исполнителя</span>
                      <input
                        type="text"
                        value={config.signatures.executorTitle}
                        onChange={(e) => updateConfig("signatures", { executorTitle: e.target.value })}
                        placeholder="Исполнитель / Мастер"
                        className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                    <div>
                      <span className="text-[10px] text-[#888888]">Подпись заказчика</span>
                      <input
                        type="text"
                        value={config.signatures.clientTitle}
                        onChange={(e) => updateConfig("signatures", { clientTitle: e.target.value })}
                        placeholder="Заказчик"
                        className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-[#111111]">Место для печати (М.П.)</span>
                    <Switch
                      checked={config.signatures.showStamp}
                      onCheckedChange={(val) => updateConfig("signatures", { showStamp: val })}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tear-off Ticket */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-[#111111]">Отрывной талон клиента</div>
                  <div className="text-[10.5px] text-[#666666]">
                    Квиток с линией отреза ножницами внизу листа
                  </div>
                </div>
                <Switch
                  checked={config.tearOffTicket.visible}
                  onCheckedChange={(val) => updateConfig("tearOffTicket", { visible: val })}
                />
              </div>

              {config.tearOffTicket.visible && (
                <div className="space-y-2 pt-2 border-t border-[#f0f0f0]">
                  <div>
                    <span className="text-[10px] text-[#888888]">Заголовок талона</span>
                    <input
                      type="text"
                      value={config.tearOffTicket.title}
                      onChange={(e) => updateConfig("tearOffTicket", { title: e.target.value })}
                      placeholder="ОТРЫВНОЙ ТАЛОН КЛИЕНТА"
                      className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs text-[#111111]">Штрихкод / QR-код заказа</span>
                    <Switch
                      checked={config.tearOffTicket.showBarcodeOrQr}
                      onCheckedChange={(val) =>
                        updateConfig("tearOffTicket", { showBarcodeOrQr: val })
                      }
                    />
                  </div>

                  <div>
                    <span className="text-[10px] text-[#888888]">Памятка клиенту</span>
                    <textarea
                      rows={2}
                      value={config.tearOffTicket.customNote}
                      onChange={(e) => updateConfig("tearOffTicket", { customNote: e.target.value })}
                      placeholder="Предъявите данный талон при получении..."
                      className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Avatar / Logo Crop Modal (Rectangular Crop) */}
      <AvatarCropModal
        open={cropSource !== null}
        image={cropSource?.image ?? null}
        imageUrl={cropSource?.url ?? null}
        shape="rect"
        title="Выберите область логотипа"
        onCancel={() => {
          if (cropSource) releaseImage(cropSource.url);
          setCropSource(null);
        }}
        onApply={handleLogoCropApply}
        isPending={isProcessingLogo}
      />

      {/* Delete Logo Confirmation Dialog */}
      <ConfirmDialog
        open={removeLogoOpen}
        title="Удалить логотип бланка?"
        description="Логотип будет удален из заголовка печатной формы. Вы сможете загрузить новый логотип в любой момент."
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="destructive"
        onConfirm={handleRemoveLogo}
        onClose={() => setRemoveLogoOpen(false)}
      />
    </div>
  );
}
