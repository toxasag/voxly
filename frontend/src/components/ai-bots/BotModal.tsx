"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  Check,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileUp,
  Globe,
  Loader2,
  MessageSquare,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
  Star,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type { AiBot, BotContextEntity, BotMode, BotModel } from "@/lib/ai-bots/ai-bots.types";
import {
  CONTEXT_ENTITIES,
  MODEL_CATALOG,
  getBotModeDescription,
  getBotModeLabel,
  getContextEntityLabel,
  getModelInfo,
  getProviderLabel,
} from "@/lib/ai-bots/ai-bots.types";
import { useAiModels } from "@/lib/api/use-ai-agents";
import { useCrmKnowledgeStats } from "@/lib/api/use-agent-knowledge";
import { createBotSchema, type CreateBotPayload } from "@/schemas/ai-bot.schema";
import { PromptTemplateEditor } from "@/components/ai-bots/PromptTemplateEditor";
import {
  DIRECTOR_PROMPT_TEMPLATE,
  INDUSTRY_PRESETS,
  type IndustryPreset,
} from "@/lib/ai-bots/prompt-templates";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface BotModalProps {
  open: boolean;
  /** Pass a bot to edit it; omit to create a new one. */
  bot?: AiBot | null;
  onClose: () => void;
  onSubmit: (payload: CreateBotPayload) => Promise<unknown> | unknown;
}

export type KnowledgeCategory = "price_list" | "commercial_offer" | "manual" | "general";

export const KNOWLEDGE_CATEGORIES: { id: KnowledgeCategory; label: string; badgeColor: string }[] = [
  { id: "price_list", label: "Прайс-лист / Каталог", badgeColor: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  { id: "commercial_offer", label: "Коммерческое предложение", badgeColor: "bg-blue-50 text-blue-700 border-blue-200" },
  { id: "manual", label: "Регламент / Инструкция", badgeColor: "bg-purple-50 text-purple-700 border-purple-200" },
  { id: "general", label: "Общие сведения / FAQ", badgeColor: "bg-slate-50 text-slate-700 border-slate-200" },
];

function detectCategoryFromFilename(filename: string): KnowledgeCategory {
  const name = filename.toLowerCase();
  if (name.includes("прайс") || name.includes("price") || name.includes("тариф") || name.includes("цен")) return "price_list";
  if (name.includes("кп") || name.includes("offer") || name.includes("предложен") || name.includes("коммерческ")) return "commercial_offer";
  if (name.includes("регламент") || name.includes("инструкц") || name.includes("стандарт") || name.includes("manual") || name.includes("правил")) return "manual";
  return "general";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

const MODES: BotMode[] = ["suggester", "autoreply", "disabled"];

const ACCENTS: { value: CreateBotPayload["accent"]; swatch: string }[] = [
  { value: "amber", swatch: "bg-[#4a38f5]" },
  { value: "sky", swatch: "bg-sky-500" },
  { value: "emerald", swatch: "bg-emerald-500" },
  { value: "orange", swatch: "bg-orange-400" },
  { value: "rose", swatch: "bg-rose-500" },
];

const DEFAULT_VALUES: CreateBotPayload = {
  name: "Ассистент",
  description: "Консультирует клиентов по услугам, отвечает на вопросы и квалифицирует лиды",
  model: "gemini-3.5-flash",
  mode: "suggester",
  status: "active",
  accent: "amber",
  temperature: 0.6,
  max_tokens: 1024,
  system_prompt: DIRECTOR_PROMPT_TEMPLATE,
  context_entities: ["contacts", "deals"],
  website_url: "https://team-big.ru/",
  map_reviews_url: "https://yandex.ru/maps/org/team_big/2489543575/",
  sync_crm: true,
  whatsapp_chat_text: "",
  wizard_config: {
    presetId: "tpl-universal-closer",
    consultantName: "Алексей",
    consultantRole: "ведущий специалист",
    businessNiche: "оказание профильных услуг и консультация клиентов",
    targetAction: "Получение контактов и назначение созвона со специалистом",
    handoffSpecialist: "старший специалист профильного отдела",
    isCustomEdited: false,
  },
};

function toFormValues(bot: AiBot): CreateBotPayload {
  return {
    name: bot.name,
    description: bot.description,
    model: bot.model,
    mode: bot.mode,
    status: bot.status,
    accent: bot.accent,
    temperature: bot.temperature,
    max_tokens: bot.max_tokens,
    system_prompt: bot.system_prompt,
    context_entities: [...bot.context_entities],
    website_url: "",
    map_reviews_url: "",
    sync_crm: false,
    whatsapp_chat_text: "",
    wizard_config: bot.wizard_config ?? {
      presetId: "tpl-universal-closer",
      consultantName: "Алексей",
      consultantRole: "ведущий специалист",
      businessNiche: "оказание профильных услуг и консультация клиентов",
      targetAction: "согласование деталей заказа и обмен прямыми контактами",
      handoffSpecialist: "старший специалист профильного отдела",
      isCustomEdited: true,
    },
  };
}

export function BotModal({ open, bot = null, onClose, onSubmit }: BotModalProps) {
  const isEdit = bot !== null;
  const [promptTab, setPromptTab] = useState<"wizard" | "editor">("wizard");
  const [pendingPreset, setPendingPreset] = useState<IndustryPreset | null>(null);

  // Multi-file drag & drop state
  const [queuedFiles, setQueuedFiles] = useState<
    Array<{
      id: string;
      file: File;
      category: KnowledgeCategory;
      sizeFormatted: string;
    }>
  >([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [showAllModels, setShowAllModels] = useState(false);
  const [isUploadingDocs, setIsUploadingDocs] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const form = useForm<CreateBotPayload>({
    resolver: zodResolver(createBotSchema),
    defaultValues: DEFAULT_VALUES,
    mode: "onChange",
  });

  const { errors, isValid, isSubmitting } = form.formState;

  // Re-seed the form whenever the modal opens or the target bot changes.
  useEffect(() => {
    if (!open) return;
    form.reset(bot !== null ? toFormValues(bot) : DEFAULT_VALUES);
    setPromptTab(bot?.wizard_config ? "wizard" : "wizard");
    setPendingPreset(null);
    setQueuedFiles([]);
  }, [open, bot, form]);

  const handleAddFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const validExtensions = ["pdf", "docx", "xlsx", "csv", "txt", "md"];
    const maxSizeBytes = 10 * 1024 * 1024; // 10 MB

    const nextFiles: Array<{
      id: string;
      file: File;
      category: KnowledgeCategory;
      sizeFormatted: string;
    }> = [];

    for (const f of fileArray) {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      if (!validExtensions.includes(ext)) {
        toast.error(`Файл «${f.name}» не поддерживается. Разрешены: PDF, DOCX, XLSX, CSV, TXT, MD`);
        continue;
      }
      if (f.size > maxSizeBytes) {
        toast.error(`Файл «${f.name}» превышает лимит 10 МБ`);
        continue;
      }

      nextFiles.push({
        id: `kb-file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        file: f,
        category: detectCategoryFromFilename(f.name),
        sizeFormatted: formatFileSize(f.size),
      });
    }

    if (nextFiles.length > 0) {
      setQueuedFiles((prev) => [...prev, ...nextFiles]);
      toast.success(`Добавлено файлов для базы знаний: ${nextFiles.length}`);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  }, [handleAddFiles]);

  const handleRemoveQueuedFile = useCallback((id: string) => {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const handleUpdateFileCategory = useCallback((id: string, category: KnowledgeCategory) => {
    setQueuedFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, category } : f)),
    );
  }, []);

  const submit = useCallback(
    async (values: CreateBotPayload) => {
      try {
        const result = await onSubmit(values);
        const targetId =
          (result && typeof result === "object" && "id" in result
            ? (result as { id: string }).id
            : bot?.id) ?? null;

        if (targetId && queuedFiles.length > 0) {
          setIsUploadingDocs(true);
          const { API_BASE_URL } = await import("@/lib/api/apiClient");
          const { readAccessToken } = await import("@/lib/auth/session");
          const token = readAccessToken();

          let uploadedCount = 0;
          for (const item of queuedFiles) {
            try {
              const fd = new FormData();
              fd.append("file", item.file);
              fd.append("category", item.category);

              const res = await fetch(`${API_BASE_URL}/api/v1/ai/agents/${targetId}/knowledge`, {
                method: "POST",
                body: fd,
                credentials: "include",
                ...(token !== null && { headers: { Authorization: `Bearer ${token}` } }),
              });
              if (res.ok) uploadedCount++;
            } catch {
              // ignore individual failure
            }
          }

          if (uploadedCount > 0) {
            toast.success(`Загружено ${uploadedCount} документов в базу знаний. Векторизация запущена!`);
          }
        }
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить бота");
      } finally {
        setIsUploadingDocs(false);
      }
    },
    [bot?.id, onClose, onSubmit, queuedFiles],
  );

  const selectedModel: BotModel = form.watch("model");
  const selectedMode: BotMode = form.watch("mode");
  const selectedAccent = form.watch("accent");
  const temperature = form.watch("temperature");
  const systemPrompt = form.watch("system_prompt");
  const isPaused = form.watch("status") === "paused";
  const wizardConfig = form.watch("wizard_config");

  const { data: modelsData, isLoading: modelsLoading, refetch: refetchModels } = useAiModels();
  const { data: crmStats } = useCrmKnowledgeStats();
  const activeProvider = modelsData?.activeProvider;
  const rawModelsList = modelsData?.data && modelsData.data.length > 0 ? modelsData.data : MODEL_CATALOG;

  // При открытии окна принудительно запрашиваем актуальный статус моделей и интеграций
  useEffect(() => {
    if (open) {
      void refetchModels();
    }
  }, [open, refetchModels]);

  // Оставляем только РЕАЛЬНО настроенные модели, если у нас есть данные от бэкенда
  const modelsList = modelsData?.data && modelsData.data.length > 0
    ? modelsData.data.filter((m) => m.isConfigured !== false)
    : activeProvider?.isConfigured
      ? rawModelsList.filter(
          (m) =>
            ("isConfigured" in m && Boolean(m.isConfigured)) ||
            m.provider === activeProvider.providerType ||
            (activeProvider.providerType === "gemini" && m.provider === "google"),
        )
      : [];

  // Автоматически синхронизируем выбранную модель с активной моделью провайдера
  useEffect(() => {
    if (!open || isEdit) return;
    if (modelsList.length > 0) {
      const currentModel = form.getValues("model");
      const isKnown = modelsList.some((m) => m.id === currentModel);
      if (!isKnown || currentModel === "gpt-4o-mini") {
        const preferred =
          modelsList.find((m) => m.id === activeProvider?.chatModel)?.id ??
          modelsList[0]?.id;
        if (preferred && preferred !== currentModel) {
          form.setValue("model", preferred as BotModel, { shouldValidate: true });
        }
      }
    }
  }, [open, isEdit, modelsList, activeProvider, form]);

  const toggleEntity = useCallback(
    (entity: BotContextEntity) => {
      const current = form.getValues("context_entities");
      const next = current.includes(entity)
        ? current.filter((item) => item !== entity)
        : [...current, entity];
      form.setValue("context_entities", next, { shouldValidate: true, shouldDirty: true });
    },
    [form],
  );

  const applyPreset = useCallback(
    (preset: IndustryPreset) => {
      form.setValue(
        "wizard_config",
        {
          presetId: preset.id,
          consultantName: preset.defaultConfig.consultantName,
          consultantRole: preset.defaultConfig.consultantRole,
          businessNiche: preset.defaultConfig.businessNiche,
          targetAction: preset.defaultConfig.targetAction,
          handoffSpecialist: preset.defaultConfig.handoffSpecialist,
          isCustomEdited: false,
        },
        { shouldValidate: true, shouldDirty: true },
      );
      form.setValue("system_prompt", DIRECTOR_PROMPT_TEMPLATE, {
        shouldValidate: true,
        shouldDirty: true,
      });
      setPendingPreset(null);
    },
    [form],
  );

  const handleSelectPreset = useCallback(
    (preset: IndustryPreset) => {
      const isCustom = form.getValues("wizard_config.isCustomEdited");
      if (isCustom) {
        setPendingPreset(preset);
        return;
      }
      applyPreset(preset);
    },
    [applyPreset, form],
  );

  if (!open) return null;

  const modelInfo = getModelInfo(selectedModel);

  return (
    <Sheet open={open} onClose={onClose} width="w-[660px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10">
            <Bot className="h-4 w-4 text-[#4a38f5]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              {isEdit ? "Настройка бота" : "Новый AI-бот"}
            </h2>
            <p className="text-xs text-[#666666]">
              {isEdit ? bot.name : "Модель, отраслевая роль и поведение"}
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(submit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Name + accent */}
            <div className="grid grid-cols-[1fr_auto] gap-4">
              <div className="space-y-1.5">
                <label htmlFor="bot-name" className="block text-xs font-medium text-slate-700">
                  Название
                </label>
                <input
                  id="bot-name"
                  type="text"
                  {...form.register("name")}
                  placeholder="Ассистент по продажам"
                  className={cn(
                    "w-full rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-slate-400 focus:outline-none focus:border-[#4a38f5] focus:ring-2 focus:ring-[#4a38f5]/20",
                    errors.name && "border-rose-500",
                  )}
                />
                {errors.name && <p className="text-xs text-rose-500">{errors.name.message}</p>}
              </div>

              <div className="space-y-1.5">
                <span className="block text-xs font-medium text-slate-700">Акцент</span>
                <div className="flex items-center gap-1.5 pt-1">
                  {ACCENTS.map((accent) => (
                    <button
                      key={accent.value}
                      type="button"
                      aria-label={`Акцентный цвет ${accent.value}`}
                      onClick={() =>
                        form.setValue("accent", accent.value, { shouldValidate: true, shouldDirty: true })
                      }
                      className={cn(
                        "h-6 w-6 rounded-full transition-transform cursor-pointer",
                        accent.swatch,
                        selectedAccent === accent.value
                          ? "ring-2 ring-[#4a38f5] ring-offset-2 ring-offset-white scale-110"
                          : "opacity-60 hover:opacity-100",
                      )}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <label htmlFor="bot-description" className="block text-xs font-medium text-slate-700">
                Описание
              </label>
              <input
                id="bot-description"
                type="text"
                {...form.register("description")}
                placeholder="Консультирует клиентов по услугам, отвечает на вопросы и квалифицирует лиды"
                className={cn(
                  "w-full rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-slate-400 focus:outline-none focus:border-[#4a38f5] focus:ring-2 focus:ring-[#4a38f5]/20",
                  errors.description && "border-rose-500",
                )}
              />
              {errors.description && (
                <p className="text-xs text-rose-500">{errors.description.message}</p>
              )}
            </div>

            {/* Model */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="block text-xs font-medium text-slate-700">Модель</span>
                {activeProvider && activeProvider.isConfigured ? (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Провайдер платформы: {activeProvider.name} {activeProvider.chatModel ? `(${activeProvider.chatModel})` : ""}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full font-medium">
                    Провайдер не настроен
                  </span>
                )}
              </div>

              {modelsLoading ? (
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-14 rounded-lg border border-[#e5e5e5] bg-slate-50 animate-pulse" />
                  ))}
                </div>
              ) : !activeProvider?.isConfigured && modelsList.length === 0 ? (
                <div className="rounded-[8px] border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 flex items-start gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-amber-900">Провайдер ИИ не настроен</p>
                    <p className="mt-0.5 text-amber-700 leading-relaxed text-[11px]">
                      В панели администратора платформы не подключены валидные API-ключи. Перейдите в раздел «Настройки платформы → Провайдеры ИИ», чтобы подключить Google Gemini, OpenAI или Anthropic.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {(showAllModels ? modelsList : modelsList.slice(0, 6)).map((model) => {
                      const isSelected = selectedModel === model.id;
                      const isDefault = model.id === activeProvider?.chatModel;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() =>
                            form.setValue("model", model.id as BotModel, {
                              shouldValidate: true,
                              shouldDirty: true,
                            })
                          }
                          className={cn(
                            "rounded-lg border px-3 py-2 text-left transition-all cursor-pointer flex flex-col justify-between",
                            isSelected
                              ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] ring-1 ring-[#4a38f5]/30 shadow-2xs"
                              : "border-[#e5e5e5] bg-white hover:border-[#cccccc] hover:bg-slate-50",
                          )}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span
                              className={cn(
                                "block text-xs font-semibold leading-tight truncate",
                                isSelected ? "text-[#4a38f5]" : "text-[#111111]",
                              )}
                              title={model.label}
                            >
                              {model.label}
                            </span>
                            {isDefault ? (
                              <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 shrink-0">
                                Основная
                              </span>
                            ) : (
                              <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                                Подключена
                              </span>
                            )}
                          </div>
                          <span className="block text-[11px] text-[#666666] mt-1 truncate">
                            {getProviderLabel(model.provider)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {modelsList.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllModels((prev) => !prev)}
                      className="text-[11px] font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors inline-flex items-center gap-1 mt-1 cursor-pointer"
                    >
                      {showAllModels
                        ? "Свернуть список моделей"
                        : `Показать все доступные модели (${modelsList.length})`}
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Mode */}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-700">Режим работы</span>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      form.setValue("mode", mode, { shouldValidate: true, shouldDirty: true })
                    }
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer",
                      selectedMode === mode
                        ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white hover:bg-slate-50",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-xs font-semibold",
                        selectedMode === mode ? "text-[#4a38f5]" : "text-[#111111]",
                      )}
                    >
                      {getBotModeLabel(mode)}
                    </span>
                    <span className="block text-[11px] text-[#666666]">
                      {getBotModeDescription(mode)}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Context entities */}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-700">
                Контекст CRM (сущности)
              </span>
              <div className="grid grid-cols-3 gap-2">
                {CONTEXT_ENTITIES.map((entity) => {
                  const selected = form.watch("context_entities").includes(entity);
                  return (
                    <button
                      key={entity}
                      type="button"
                      onClick={() => toggleEntity(entity)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors cursor-pointer",
                        selected
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {getContextEntityLabel(entity)}
                    </button>
                  );
                })}
              </div>
              {errors.context_entities && (
                <p className="text-xs text-rose-500">{errors.context_entities.message}</p>
              )}
            </div>

            {/* Temperature + max tokens */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label htmlFor="bot-temperature" className="block text-xs font-medium text-slate-700">
                  Температура
                  <span className="ml-1.5 font-mono text-[#111111]">{temperature.toFixed(1)}</span>
                </label>
                <input
                  id="bot-temperature"
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={temperature}
                  onChange={(event) =>
                    form.setValue("temperature", Number(event.target.value), {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  className="w-full accent-[#4a38f5]"
                />
                <p className="text-xs text-slate-500">Меньше — предсказуемее, больше — свободнее.</p>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="bot-max-tokens" className="block text-xs font-medium text-slate-700">
                  Макс. токенов в ответе
                </label>
                <input
                  id="bot-max-tokens"
                  type="number"
                  min={128}
                  max={8192}
                  step={128}
                  {...form.register("max_tokens", { valueAsNumber: true })}
                  className={cn(
                    "w-full rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] [-moz-appearance:textfield] focus:outline-none focus:border-[#4a38f5] focus:ring-2 focus:ring-[#4a38f5]/20 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                    errors.max_tokens && "border-rose-500",
                  )}
                />
                {errors.max_tokens && (
                  <p className="text-xs text-rose-500">{errors.max_tokens.message}</p>
                )}
              </div>
            </div>

            {/* База знаний и ссылки (обучение при создании) */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-[#4a38f5]" />
                  <span className="text-xs font-semibold text-[#111111]">
                    База знаний и ссылки компании
                  </span>
                </div>
                <span className="text-[11px] text-[#666666]">
                  {isEdit ? "Для детального управления файлами используйте вкладку агента" : "Автоматическое обучение"}
                </span>
              </div>
              <p className="text-xs text-[#666666]">
                Укажите адрес сайта и ссылку на карты — система автоматически просканирует страницы и отзывы клиентов, чтобы обучить агента сразу при создании.
              </p>

              <div className="space-y-3">
                <div className="space-y-1">
                  <label htmlFor="bot-website-url" className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Globe className="h-3.5 w-3.5 text-[#4a38f5]" />
                    Ссылка на сайт компании (сканирование всех страниц)
                  </label>
                  <input
                    id="bot-website-url"
                    type="url"
                    {...form.register("website_url")}
                    placeholder="https://mysite.ru"
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    Краулер обойдёт sitemap.xml и внутренние ссылки (услуги, прайсы, контакты) и проиндексирует базу знаний.
                  </p>
                </div>

                <div className="space-y-1">
                  <label htmlFor="bot-map-reviews-url" className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                    <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500" />
                    Отзывы и рейтинг (Яндекс Карты, 2ГИС, Google Maps, Zoon)
                  </label>
                  <input
                    id="bot-map-reviews-url"
                    type="url"
                    {...form.register("map_reviews_url")}
                    placeholder="https://yandex.ru/maps/org/... или https://2gis.ru/..."
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    Парсер выгрузит оценку компании и реальные отзывы клиентов для использования в аргументации при продажах.
                  </p>
                </div>

                {/* Опыт из CRM */}
                {!isEdit && (
                  <div className="flex items-start gap-2.5 rounded-[8px] border border-[#e5e5e5] bg-white p-3">
                    <input
                      id="bot-sync-crm"
                      type="checkbox"
                      {...form.register("sync_crm")}
                      className="mt-0.5 h-4 w-4 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    <label htmlFor="bot-sync-crm" className="text-xs cursor-pointer select-none">
                      <span className="font-semibold text-[#111111] flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-[#4a38f5]" />
                        Синтезировать опыт из CRM (сделки и чаты)
                      </span>
                      <span className="block text-[#666666] mt-0.5">
                        {crmStats?.wonDeals
                          ? `В CRM найдено ${crmStats.wonDeals} успешных сделок и ${crmStats.totalMessages} сообщений. AI выделит прайс и частые вопросы.`
                          : "AI проанализирует сделки и переписки в вашей CRM и создаст структурированную базу знаний."}
                      </span>
                    </label>
                  </div>
                )}

                {/* Выгрузка переписки WhatsApp */}
                {!isEdit && (
                  <div className="space-y-1">
                    <label htmlFor="bot-whatsapp-file" className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                      <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                      Выгрузка переписки из WhatsApp (_chat.txt)
                    </label>
                    <input
                      id="bot-whatsapp-file"
                      type="file"
                      accept=".txt"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                          const content = ev.target?.result;
                          if (typeof content === "string") {
                            form.setValue("whatsapp_chat_text", content);
                          }
                        };
                        reader.readAsText(file);
                      }}
                      className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] file:mr-2 file:rounded-[4px] file:border-0 file:bg-emerald-50 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-emerald-700 hover:file:bg-emerald-100"
                    />
                    <p className="text-[11px] text-[#888888]">
                      Прикрепите текстовый файл экспорта чата WhatsApp (Экспорт чата → Без медиафайлов) для обучения агента на живом стиле компании.
                    </p>
                  </div>
                )}

                {/* Мульти-загрузка документов базы знаний (.pdf, .docx, .xlsx, .csv, .txt) */}
                <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-[#111111]">
                      <UploadCloud className="h-4 w-4 text-[#4a38f5]" />
                      Документы базы знаний (прайс-листы, КП, регламенты)
                    </label>
                    <span className="text-[11px] text-[#666666]">
                      {queuedFiles.length > 0 ? `Файлов к загрузке: ${queuedFiles.length}` : "PDF, DOCX, XLSX, CSV, TXT (до 10 МБ)"}
                    </span>
                  </div>

                  {/* Dropzone */}
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={cn(
                      "group relative flex flex-col items-center justify-center rounded-[8px] border-2 border-dashed p-4 text-center transition-all cursor-pointer",
                      isDragOver
                        ? "border-[#4a38f5] bg-[#4a38f5]/5"
                        : "border-[#e5e5e5] bg-white hover:border-[#4a38f5]/50 hover:bg-slate-50/50",
                    )}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept=".pdf,.docx,.xlsx,.csv,.txt,.md"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files.length > 0) {
                          handleAddFiles(e.target.files);
                          e.target.value = "";
                        }
                      }}
                    />
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#4a38f5]/10 text-[#4a38f5] transition-transform group-hover:scale-105">
                      <FileUp className="h-4 w-4" />
                    </div>
                    <p className="mt-2 text-xs font-medium text-[#111111]">
                      Перетащите файлы сюда или <span className="text-[#4a38f5] underline underline-offset-2">выберите на диске</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-[#666666]">
                      Поддерживаются прайс-листы Excel (.xlsx, .csv), договоры и КП (.docx, .pdf), регламенты (.txt)
                    </p>
                  </div>

                  {/* List of Queued Files */}
                  {queuedFiles.length > 0 && (
                    <div className="space-y-2 pt-1">
                      {queuedFiles.map((item) => {
                        const ext = item.file.name.split(".").pop()?.toLowerCase() ?? "";
                        const isSpreadsheet = ext === "xlsx" || ext === "csv";
                        const isPdf = ext === "pdf";
                        const isDocx = ext === "docx";

                        return (
                          <div
                            key={item.id}
                            className="flex flex-col gap-2 rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 shadow-2xs hover:border-[#cccccc] transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div
                                  className={cn(
                                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]",
                                    isSpreadsheet
                                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                                      : isPdf
                                        ? "bg-rose-50 text-rose-700 border border-rose-200"
                                        : isDocx
                                          ? "bg-blue-50 text-blue-700 border border-blue-200"
                                          : "bg-slate-50 text-slate-700 border border-slate-200",
                                  )}
                                >
                                  {isSpreadsheet ? (
                                    <FileSpreadsheet className="h-3.5 w-3.5" />
                                  ) : (
                                    <FileText className="h-3.5 w-3.5" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-xs font-medium text-[#111111]" title={item.file.name}>
                                    {item.file.name}
                                  </p>
                                  <p className="font-mono text-[10px] text-[#666666]">{item.sizeFormatted}</p>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleRemoveQueuedFile(item.id)}
                                className="rounded p-1 text-[#888888] hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                                title="Удалить файл"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {/* Category Selector */}
                            <div className="flex items-center gap-1.5 pt-1 border-t border-[#f0f0f0]">
                              <span className="text-[11px] text-[#666666] shrink-0">Категория:</span>
                              <div className="flex flex-wrap gap-1">
                                {KNOWLEDGE_CATEGORIES.map((cat) => {
                                  const isCatSelected = item.category === cat.id;
                                  return (
                                    <button
                                      key={cat.id}
                                      type="button"
                                      onClick={() => handleUpdateFileCategory(item.id, cat.id)}
                                      className={cn(
                                        "rounded-[4px] px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer border",
                                        isCatSelected
                                          ? "bg-[#4a38f5] text-white border-[#4a38f5]"
                                          : "bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100",
                                      )}
                                    >
                                      {cat.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* PROMPT SECTION: TABS (WIZARD vs DIRECT EDITOR) */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPromptTab("wizard")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer",
                      promptTab === "wizard"
                        ? "bg-[#4a38f5]/10 text-[#4a38f5]"
                        : "text-[#666666] hover:text-[#111111] hover:bg-slate-50",
                    )}
                  >
                    <Sliders className="h-3.5 w-3.5" />
                    Конструктор роли (Без кода)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPromptTab("editor")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer",
                      promptTab === "editor"
                        ? "bg-[#4a38f5]/10 text-[#4a38f5]"
                        : "text-[#666666] hover:text-[#111111] hover:bg-slate-50",
                    )}
                  >
                    <FileCode className="h-3.5 w-3.5" />
                    Прямой редактор системного промпта
                    {wizardConfig?.isCustomEdited && (
                      <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-[#854d0e] border border-[#fef08a]">
                        кастом
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* OVERWRITE WARNING DIALOG */}
              {pendingPreset && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5 text-xs space-y-2">
                  <div className="flex items-start gap-2 text-[#854d0e]">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                    <div>
                      <p className="font-semibold">
                        Применение отраслевого пресета «{pendingPreset.name}»
                      </p>
                      <p className="mt-0.5 text-slate-700">
                        Вы вносили ручные изменения в системный промпт. Применение нового пресета
                        обновит поля конструктора и сбросит ручные правки к чистому эталонному шаблону.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setPendingPreset(null)}
                      className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset(pendingPreset)}
                      className="px-2.5 py-1 text-xs rounded bg-[#4a38f5] text-white hover:bg-[#3d2ee0] font-medium"
                    >
                      Применить и сбросить
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 1: VISUAL WIZARD */}
              {promptTab === "wizard" && (
                <div className="space-y-4 rounded-lg border border-[#e5e5e5] bg-[#fafafa]/50 p-4">
                  {/* Preset Selector */}
                  <div className="space-y-1.5">
                    <label className="block text-xs font-medium text-slate-700">
                      Отраслевой шаблон (Метод Станиславского v2.0)
                    </label>
                    <div className="grid grid-cols-2 gap-2.5">
                      {INDUSTRY_PRESETS.map((preset, index) => {
                        const isSelected = wizardConfig?.presetId === preset.id;
                        const isLast = index === INDUSTRY_PRESETS.length - 1;
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => handleSelectPreset(preset)}
                            className={cn(
                              "rounded-lg border p-3 text-left transition-all cursor-pointer flex flex-col justify-between",
                              isLast && "col-span-2",
                              isSelected
                                ? "border-[#4a38f5] bg-white ring-1 ring-[#4a38f5] shadow-2xs"
                                : "border-[#e5e5e5] bg-white hover:border-[#cccccc]",
                            )}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <span className="text-xs font-semibold text-[#111111] leading-snug break-words">
                                  {preset.name}
                                </span>
                                {isSelected && <Check className="h-3.5 w-3.5 text-[#4a38f5] shrink-0 mt-0.5" />}
                              </div>
                              <p className="mt-1.5 text-[11px] text-[#666666] leading-relaxed break-words">
                                {preset.description}
                              </p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 5 Core Consultant Parameters */}
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    <div className="col-span-2 space-y-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Ниша / профиль компании (в именительном падеже)
                      </label>
                      <input
                        type="text"
                        value={wizardConfig?.businessNiche ?? ""}
                        onChange={(e) =>
                          form.setValue("wizard_config.businessNiche", e.target.value, {
                            shouldDirty: true,
                          })
                        }
                        placeholder="сервис технического обслуживания автомобилей"
                        className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Имя консультанта
                      </label>
                      <input
                        type="text"
                        value={wizardConfig?.consultantName ?? ""}
                        onChange={(e) =>
                          form.setValue("wizard_config.consultantName", e.target.value, {
                            shouldDirty: true,
                          })
                        }
                        placeholder="Дмитрий"
                        className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Должность / роль консультанта
                      </label>
                      <input
                        type="text"
                        value={wizardConfig?.consultantRole ?? ""}
                        onChange={(e) =>
                          form.setValue("wizard_config.consultantRole", e.target.value, {
                            shouldDirty: true,
                          })
                        }
                        placeholder="старший мастер-приёмщик"
                        className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>

                    <div className="col-span-2 space-y-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Целевой шаг диалога (целевое действие)
                      </label>
                      <input
                        type="text"
                        value={wizardConfig?.targetAction ?? ""}
                        onChange={(e) =>
                          form.setValue("wizard_config.targetAction", e.target.value, {
                            shouldDirty: true,
                          })
                        }
                        placeholder="согласование времени для бесплатной диагностики на подъёмнике"
                        className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>

                    <div className="col-span-2 space-y-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Специалист для эскалации (handoff)
                      </label>
                      <input
                        type="text"
                        value={wizardConfig?.handoffSpecialist ?? ""}
                        onChange={(e) =>
                          form.setValue("wizard_config.handoffSpecialist", e.target.value, {
                            shouldDirty: true,
                          })
                        }
                        placeholder="руководитель сервисного участка"
                        className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  </div>

                  {/* Knowledge Base Guidance Banner */}
                  <div className="rounded-[8px] border border-blue-100 bg-blue-50/60 p-3 text-xs text-[#333333] flex items-start gap-2.5">
                    <FileText className="h-4 w-4 text-[#4a38f5] shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-medium text-[#111111]">
                        База знаний и фактологическая точность
                      </p>
                      <p className="text-[11px] text-[#555555] leading-relaxed">
                        Конструктор роли задаёт характер и скрипт продаж консультанта. Документы (прайс-листы, КП, регламенты) и ссылки компании можно прикрепить прямо в блоке выше — они автоматически индексируются в фоне. Детальное управление фрагментами и ручное добавление фактов также доступно во вкладке <strong>«База знаний»</strong> после создания бота.
                      </p>
                    </div>
                  </div>

                  {/* Overwrite Protection Info */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#e5e5e5]">
                    <span className="text-[11px] text-[#666666]">
                      {wizardConfig?.isCustomEdited ? (
                        <span className="text-amber-600 font-medium">
                          В промпт внесены ручные правки. Чтобы синхронизировать форму с промптом:
                        </span>
                      ) : (
                        "Параметры подставляются в промпт автоматически на сервере."
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        form.setValue("system_prompt", DIRECTOR_PROMPT_TEMPLATE, {
                          shouldValidate: true,
                          shouldDirty: true,
                        });
                        form.setValue("wizard_config.isCustomEdited", false, {
                          shouldDirty: true,
                        });
                      }}
                      className="inline-flex items-center gap-1.5 text-xs text-[#4a38f5] hover:text-[#3d2ee0] font-medium"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Сбросить к эталону Мета-Промпта v2.0
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 2: DIRECT PROMPT EDITOR */}
              {promptTab === "editor" && (
                <div className="space-y-2">
                  <PromptTemplateEditor
                    value={systemPrompt}
                    onChange={(next) => {
                      form.setValue("system_prompt", next, {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                      if (!form.getValues("wizard_config.isCustomEdited")) {
                        form.setValue("wizard_config.isCustomEdited", true, {
                          shouldDirty: true,
                        });
                      }
                    }}
                    contextWindow={modelInfo.context_window}
                    error={errors.system_prompt?.message}
                  />
                </div>
              )}
            </div>

            {/* Status */}
            <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-[#e5e5e5] bg-slate-50 px-3.5 py-3">
              <input
                type="checkbox"
                checked={!isPaused}
                onChange={(event) =>
                  form.setValue("status", event.target.checked ? "active" : "paused", {
                    shouldValidate: true,
                    shouldDirty: true,
                  })
                }
                className="h-4 w-4 rounded border-slate-300 accent-[#4a38f5]"
              />
              <span className="text-xs text-[#111111]">
                Активировать сразу
                <span className="ml-1.5 text-slate-500">
                  боты на паузе сохраняют настройки, но не работают в каналах
                </span>
              </span>
            </label>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-[#e5e5e5] bg-white px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!isValid || isSubmitting || isUploadingDocs}
              className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3d2ee0] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting || isUploadingDocs ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isUploadingDocs ? "Загружаем документы..." : "Сохраняем..."}
                </>
              ) : isEdit ? (
                <>
                  <Save className="h-4 w-4" />
                  Сохранить изменения
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  Создать бота
                </>
              )}
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
