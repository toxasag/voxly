"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  Check,
  ChevronDown,
  FileCode,
  FileText,
  Globe,
  Info,
  Loader2,
  MessageSquare,
  MessageSquareQuote,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { AiBot, BotContextEntity, BotMode, BotModel, ModelInfo } from "@/lib/ai-bots/ai-bots.types";
import {
  CONTEXT_ENTITIES,
  MODEL_CATALOG,
  getBotModeDescription,
  getBotModeLabel,
  getContextEntityLabel,
  getModelInfo,
  getProviderLabel,
} from "@/lib/ai-bots/ai-bots.types";
import { useAiModels, type AiModelItem } from "@/lib/api/use-ai-agents";
import {
  useAgentFeedbacks,
  useGeneratePrompt,
  useRebuildAgentPrompt,
} from "@/lib/api/use-agent-knowledge";
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
  onDelete?: (bot: AiBot) => void;
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
  website_url: "",
  map_reviews_url: "",
  sync_crm: false,
  whatsapp_chat_text: "",
  company_name_override: "",
  consultant_source: "manual",
  consultant_name: "Алексей",
  consultant_role: "ведущий специалист",
  fallback_models: ["gemini-flash-lite-latest", "gemini-3.1-flash-lite"],
  target_page_url: "",
  generated_system_prompt: "",
  knowledge_base_md: "",
  feedback_learning_enabled: true,
  wizard_config: {
    presetId: "tpl-universal-closer",
    consultantName: "Алексей",
    consultantRole: "ведущий специалист",
    businessNiche: "оказание профильных услуг и консультация клиентов",
    clientProfile: "Клиенты, которым необходима экспертная консультация и подбор оптимального решения",
    targetAction: "согласование деталей заказа и обмен прямыми контактами",
    constraints: "Не давать ложных обещаний, строго следовать прайсу и регламенту компании",
    handoffSpecialist: "старший специалист профильного отдела",
    isCustomEdited: false,
  },
};

function toFormValues(bot: AiBot): CreateBotPayload {
  const wizardConfig = bot.wizard_config as Record<string, unknown> | null | undefined;
  const websiteUrl = bot.website_url ?? (wizardConfig?.website_url as string | undefined) ?? "";

  return {
    name: bot.name,
    description: bot.description,
    model: bot.model || "gemini-3.5-flash",
    mode: bot.mode,
    status: bot.status,
    accent: bot.accent,
    temperature: bot.temperature ?? 0.6,
    max_tokens: bot.max_tokens ?? 1024,
    system_prompt: bot.system_prompt || DIRECTOR_PROMPT_TEMPLATE,
    context_entities: [...bot.context_entities],
    website_url: websiteUrl,
    map_reviews_url: "",
    sync_crm: false,
    whatsapp_chat_text: "",
    company_name_override: bot.company_name_override ?? "",
    consultant_source: bot.consultant_source ?? "manual",
    consultant_name: bot.consultant_name ?? (wizardConfig?.consultantName as string | undefined) ?? "",
    consultant_role: bot.consultant_role ?? (wizardConfig?.consultantRole as string | undefined) ?? "",
    fallback_models: bot.fallback_models ?? ["gemini-flash-lite-latest", "gemini-3.1-flash-lite"],
    target_page_url: bot.target_page_url ?? "",
    generated_system_prompt: bot.generated_system_prompt ?? "",
    knowledge_base_md: bot.knowledge_base_md ?? "",
    feedback_learning_enabled: bot.feedback_learning_enabled ?? true,
    wizard_config: bot.wizard_config ?? {
      presetId: "tpl-universal-closer",
      consultantName: "Алексей",
      consultantRole: "ведущий специалист",
      businessNiche: "оказание профильных услуг и консультация клиентов",
      clientProfile: "Клиенты, которым необходима экспертная консультация и подбор оптимального решения",
      targetAction: "согласование деталей заказа и обмен прямыми контактами",
      constraints: "Не давать ложных обещаний, строго следовать прайсу и регламенту компании",
      handoffSpecialist: "старший специалист профильного отдела",
      isCustomEdited: false,
    },
  };
}

export function BotModal({ open, bot = null, onClose, onSubmit, onDelete }: BotModalProps) {
  const isEdit = bot !== null;
  const [showTechnicalParams, setShowTechnicalParams] = useState(false);
  const [promptTab, setPromptTab] = useState<"wizard" | "editor" | "feedbacks">("wizard");
  const [pendingPreset, setPendingPreset] = useState<IndustryPreset | null>(null);
  const [showAllModels, setShowAllModels] = useState(false);
  const [showPresetsDropdown, setShowPresetsDropdown] = useState(false);

  const generatePromptMutation = useGeneratePrompt();
  const { data: feedbacksData } = useAgentFeedbacks(bot?.id);
  const rebuildPromptMutation = useRebuildAgentPrompt(bot?.id ?? "");

  const approvedFeedbacks = (feedbacksData ?? []).filter((fb) => fb.status === "approved");

  const handleRebuildPromptFromFeedbacks = async () => {
    if (!bot?.id) return;
    try {
      const res = await rebuildPromptMutation.mutateAsync();
      form.setValue("system_prompt", res.systemPrompt, { shouldValidate: true, shouldDirty: true });
      form.setValue("generated_system_prompt", res.systemPrompt, { shouldDirty: true });
      if (!form.getValues("wizard_config.isCustomEdited")) {
        form.setValue("wizard_config.isCustomEdited", true, { shouldDirty: true });
      }
      toast.success(res.summaryOfChanges || "Системный промпт агента успешно пересобран!");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось пересобрать промпт");
    }
  };

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
    setShowTechnicalParams(false);
    setPromptTab(bot?.wizard_config?.isCustomEdited ? "editor" : "wizard");
    setPendingPreset(null);
  }, [open, bot, form]);

  const submit = useCallback(
    async (values: CreateBotPayload) => {
      try {
        await onSubmit(values);
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить бота");
      }
    },
    [onClose, onSubmit],
  );

  const selectedModel: BotModel = form.watch("model");
  const selectedMode: BotMode = form.watch("mode");
  const selectedAccent = form.watch("accent");
  const temperature = form.watch("temperature");
  const systemPrompt = form.watch("system_prompt");
  const isPaused = form.watch("status") === "paused";
  const wizardConfig = form.watch("wizard_config");
  const fallbackModels = form.watch("fallback_models") ?? [];
  const consultantSource = form.watch("consultant_source") ?? "manual";
  const companyNameOverride = form.watch("company_name_override") ?? "";
  const consultantName = form.watch("consultant_name") ?? "";
  const consultantRole = form.watch("consultant_role") ?? "";

  const toggleFallbackModel = useCallback(
    (modelId: string) => {
      const current = form.getValues("fallback_models") ?? [];
      const next = current.includes(modelId)
        ? current.filter((m) => m !== modelId)
        : [...current, modelId];
      form.setValue("fallback_models", next, { shouldDirty: true });
    },
    [form],
  );

  const { data: modelsData, isLoading: modelsLoading } = useAiModels();

  const activeProvider =
    modelsData?.activeProvider ??
    (Array.isArray(modelsData)
      ? { name: "Google Gemini", providerType: "gemini", isConfigured: true }
      : undefined);

  const modelsArray: (AiModelItem | ModelInfo)[] = Array.isArray(modelsData?.data)
    ? modelsData.data
    : Array.isArray(modelsData)
      ? (modelsData as unknown as ModelInfo[])
      : [];

  const rawModelsList: (AiModelItem | ModelInfo)[] =
    modelsArray.length > 0 ? modelsArray : MODEL_CATALOG;

  // Оставляем только РЕАЛЬНО настроенные модели, если у нас есть данные от бэкенда
  const modelsList =
    modelsArray.length > 0
      ? modelsArray.filter((m) => m.isConfigured !== false)
      : activeProvider?.isConfigured
        ? rawModelsList.filter(
            (m) =>
              Boolean(m.isConfigured) ||
              m.provider === activeProvider.providerType ||
              (activeProvider.providerType === "gemini" && (m.provider === "google" || m.provider === "gemini")),
          )
        : rawModelsList;

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
          clientProfile: preset.defaultConfig.clientProfile ?? "",
          targetAction: preset.defaultConfig.targetAction,
          constraints: preset.defaultConfig.constraints ?? "",
          handoffSpecialist: preset.defaultConfig.handoffSpecialist,
          isCustomEdited: false,
        },
        { shouldValidate: true, shouldDirty: true },
      );
      form.setValue("consultant_name", preset.defaultConfig.consultantName, { shouldDirty: true });
      form.setValue("consultant_role", preset.defaultConfig.consultantRole, { shouldDirty: true });
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

  const handleGeneratePrompt = useCallback(async () => {
    try {
      const targetPageUrl = form.getValues("target_page_url");
      const currentWc = form.getValues("wizard_config");
      const companyName = form.getValues("company_name_override");

      const result = await generatePromptMutation.mutateAsync({
        target_page_url: targetPageUrl,
        company_name: companyName,
        business_niche: currentWc?.businessNiche,
        client_profile: currentWc?.clientProfile,
        target_action: currentWc?.targetAction,
        constraints: currentWc?.constraints,
        consultant_name: form.getValues("consultant_name"),
        consultant_role: form.getValues("consultant_role"),
        handoff_specialist: currentWc?.handoffSpecialist,
      });

      if (result) {
        form.setValue("system_prompt", result.systemPrompt, {
          shouldValidate: true,
          shouldDirty: true,
        });
        form.setValue("generated_system_prompt", result.systemPrompt, {
          shouldDirty: true,
        });
        if (result.consultantName) {
          form.setValue("consultant_name", result.consultantName, { shouldDirty: true });
        }
        if (result.consultantRole) {
          form.setValue("consultant_role", result.consultantRole, { shouldDirty: true });
        }
        form.setValue(
          "wizard_config",
          {
            ...currentWc,
            businessNiche: result.businessNiche || currentWc?.businessNiche,
            clientProfile: result.clientProfile || currentWc?.clientProfile,
            targetAction: result.targetAction || currentWc?.targetAction,
            constraints: result.constraints || currentWc?.constraints,
            consultantName: result.consultantName || currentWc?.consultantName,
            consultantRole: result.consultantRole || currentWc?.consultantRole,
            handoffSpecialist: result.handoffSpecialist || currentWc?.handoffSpecialist,
            isCustomEdited: true,
          },
          { shouldValidate: true, shouldDirty: true },
        );

        toast.success("Роль и системный промпт успешно сгенерированы!");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось сгенерировать системный промпт",
      );
    }
  }, [form, generatePromptMutation]);

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
              {isEdit ? bot.name : "Анкета продукта, целей и роль консультанта"}
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <form onSubmit={form.handleSubmit(submit)} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto p-6 space-y-5">
            {/* Название + Акцент */}
            <div className="grid grid-cols-[1fr_auto] gap-4">
              <div className="space-y-1.5">
                <label htmlFor="bot-name" className="block text-xs font-medium text-slate-700">
                  Название бота
                </label>
                <input
                  id="bot-name"
                  type="text"
                  {...form.register("name")}
                  placeholder="Консультант по продажам"
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

            {/* Описание */}
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

            {/* Режим работы */}
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

            {/* Контекст CRM (сущности) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="block text-xs font-medium text-slate-700">
                  Контекст CRM (какие данные видит агент)
                </span>
                <span className="text-[11px] text-[#666666]">
                  Персонализация диалогов
                </span>
              </div>

              {/* Callout пояснение CRM контекста */}
              <div className="rounded-[8px] border border-blue-100 bg-blue-50/60 p-3 text-xs text-[#333333] flex items-start gap-2.5">
                <Info className="h-4 w-4 text-[#4a38f5] shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-semibold text-[#111111]">Как агент использует данные CRM:</p>
                  <p className="text-[11px] text-[#555555] leading-relaxed">
                    Бот автоматически видит карточку клиента, его имя, телефон, историю сделок и прошлые заметки менеджеров. Это позволяет сразу обращаться по имени, не переспрашивать то, что клиент уже сообщал ранее, и делать персонализированные предложения.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {CONTEXT_ENTITIES.map((entity) => {
                  const selected = form.watch("context_entities").includes(entity);
                  return (
                    <button
                      key={entity}
                      type="button"
                      onClick={() => toggleEntity(entity)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors cursor-pointer flex items-center justify-between",
                        selected
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      <span>{getContextEntityLabel(entity)}</span>
                      {selected && <Check className="h-3 w-3 text-[#4a38f5]" />}
                    </button>
                  );
                })}
              </div>
              {errors.context_entities && (
                <p className="text-xs text-rose-500">{errors.context_entities.message}</p>
              )}
            </div>

            {/* ОСНОВНАЯ АНКЕТА: ПРОДУКТ, ЦЕЛИ И РОЛЬ КОНСУЛЬТАНТА */}
            <div className="space-y-4 rounded-lg border border-[#e5e5e5] bg-[#fafafa]/50 p-4">
              <div className="flex items-start justify-between gap-2 border-b border-[#e5e5e5] pb-2.5">
                <div>
                  <h3 className="text-xs font-semibold text-[#111111] flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-[#4a38f5]" />
                    Анкета продукта и целей
                  </h3>
                  <p className="text-[11px] text-[#666666] mt-0.5">
                    Задайте профиль вашего продукта, целевое действие и ограничения. Агент общается строго от лица живого специалиста (Метод Станиславского).
                  </p>
                </div>
              </div>

              {/* ГЕНЕРАТИВНЫЙ СИНТЕЗ РОЛИ И СИСТЕМНОГО ПРОМПТА */}
              <div className="space-y-3 rounded-lg border border-[#4a38f5]/25 bg-[#4a38f5]/[0.02] p-3.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-4 w-4 text-[#4a38f5]" />
                    <span className="text-xs font-semibold text-[#111111]">
                      Генеративный синтез роли и промпта
                    </span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#4a38f5]/10 text-[#4a38f5] font-medium">
                    6 навыков продаж (B2B/CRM)
                  </span>
                </div>

                <p className="text-[11px] text-[#666666] leading-relaxed">
                  Укажите адрес целевой веб-страницы (сайт / лендинг) или контекст бизнеса. ИИ автоматически спарсит страницу, выявит ценность и сгенерирует подробный системный промпт.
                </p>

                {/* Поле ввода URL целевой страницы */}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    URL целевой страницы внедрения (сайт / лендинг)
                  </label>
                  <div className="relative">
                    <Globe className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="url"
                      value={form.watch("target_page_url") ?? ""}
                      onChange={(e) =>
                        form.setValue("target_page_url", e.target.value, { shouldDirty: true })
                      }
                      placeholder="https://example.com/services/b2b-consulting"
                      className="h-8.5 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-8 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>
                </div>

                {/* Кнопка генерации + быстрое меню пресетов */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    disabled={generatePromptMutation.isPending}
                    onClick={handleGeneratePrompt}
                    className="h-8 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    {generatePromptMutation.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Синтез промпта и роли...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Сгенерировать роль и системный промпт</span>
                      </>
                    )}
                  </button>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowPresetsDropdown(!showPresetsDropdown)}
                      className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer flex items-center gap-1"
                    >
                      <span>Быстрые пресеты</span>
                      <ChevronDown className="h-3 w-3 text-slate-500" />
                    </button>
                    {showPresetsDropdown && (
                      <div className="absolute right-0 top-9 z-20 w-64 rounded-lg border border-[#e5e5e5] bg-white p-1.5 shadow-lg space-y-1">
                        {INDUSTRY_PRESETS.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              applyPreset(p);
                              setShowPresetsDropdown(false);
                            }}
                            className="w-full text-left px-2.5 py-1.5 rounded text-xs hover:bg-slate-100 flex flex-col cursor-pointer"
                          >
                            <span className="font-medium text-[#111111]">{p.name}</span>
                            <span className="text-[10px] text-[#888888] line-clamp-1">{p.description}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Интерактивное отображение и инлайн-редактор сгенерированного промпта */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1">
                      <FileCode className="h-3 w-3 text-[#4a38f5]" />
                      Сгенерированный системный промпт (активный)
                    </label>
                    <span className="text-[10px] text-slate-500">
                      {(form.watch("system_prompt") || "").length} символов
                    </span>
                  </div>

                  <textarea
                    rows={6}
                    value={form.watch("system_prompt")}
                    onChange={(e) =>
                      form.setValue("system_prompt", e.target.value, {
                        shouldValidate: true,
                        shouldDirty: true,
                      })
                    }
                    placeholder="Системный промпт роли агента..."
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-xs text-[#111111] font-mono leading-relaxed focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 resize-y"
                  />
                </div>
              </div>

              {/* Предупреждение о перезаписи промпта */}
              {pendingPreset && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs space-y-2">
                  <div className="flex items-start gap-2 text-[#854d0e]">
                    <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
                    <div>
                      <p className="font-semibold">
                        Применение шаблона «{pendingPreset.name}»
                      </p>
                      <p className="mt-0.5 text-slate-700">
                        В системный промпт вносились ручные правки. Применение нового шаблона обновит анкету и сбросит ручные правки к чистому эталону.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setPendingPreset(null)}
                      className="px-2.5 py-1 text-xs rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={() => applyPreset(pendingPreset)}
                      className="px-2.5 py-1 text-xs rounded bg-[#4a38f5] text-white hover:bg-[#3d2ee0] font-medium cursor-pointer"
                    >
                      Применить и сбросить
                    </button>
                  </div>
                </div>
              )}

              {/* Поля анкеты */}
              <div className="space-y-3 pt-1">
                {/* 1. Название компании */}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Название компании (переменная {"{{tenant.name}}"})
                  </label>
                  <input
                    type="text"
                    value={companyNameOverride}
                    onChange={(e) =>
                      form.setValue("company_name_override", e.target.value, {
                        shouldDirty: true,
                      })
                    }
                    placeholder="Например: Банкирро (по умолчанию берётся из названия вашей CRM)"
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    Если не заполнено, название автоматически подставляется из профиля вашей компании в CRM.
                  </p>
                </div>

                {/* 2. Источник консультанта */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-medium text-slate-700">
                    Источник консультанта ({"{{consultant.name}}"} и {"{{consultant.role}}"})
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => form.setValue("consultant_source", "manual", { shouldDirty: true })}
                      className={cn(
                        "rounded-[6px] border px-3 py-1.5 text-xs font-medium text-left transition-colors cursor-pointer",
                        consultantSource === "manual"
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-slate-50",
                      )}
                    >
                      Указать вручную
                    </button>
                    <button
                      type="button"
                      onClick={() => form.setValue("consultant_source", "chat_widget", { shouldDirty: true })}
                      className={cn(
                        "rounded-[6px] border px-3 py-1.5 text-xs font-medium text-left transition-colors cursor-pointer",
                        consultantSource === "chat_widget"
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-slate-50",
                      )}
                    >
                      Из настроек онлайн-чата
                    </button>
                  </div>
                </div>

                {consultantSource === "chat_widget" ? (
                  <div className="rounded-[8px] border border-blue-100 bg-blue-50/60 p-2.5 text-xs text-[#333333] flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[#4a38f5] shrink-0" />
                    <span className="text-[11px] text-[#555555]">
                      Имя и должность консультанта подтягиваются динамически из настроек подключенного виджета онлайн-чата на сайте.
                    </span>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Имя консультанта
                      </label>
                      <input
                        type="text"
                        value={consultantName || (wizardConfig?.consultantName ?? "")}
                        onChange={(e) => {
                          form.setValue("consultant_name", e.target.value, { shouldDirty: true });
                          form.setValue("wizard_config.consultantName", e.target.value, { shouldDirty: true });
                        }}
                        placeholder="Екатерина"
                        className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-medium text-slate-700">
                        Должность / роль консультанта
                      </label>
                      <input
                        type="text"
                        value={consultantRole || (wizardConfig?.consultantRole ?? "")}
                        onChange={(e) => {
                          form.setValue("consultant_role", e.target.value, { shouldDirty: true });
                          form.setValue("wizard_config.consultantRole", e.target.value, { shouldDirty: true });
                        }}
                        placeholder="ведущий юрист практики"
                        className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  </div>
                )}

                {/* 3. Ваш продукт, Что продаёте */}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Ваш продукт, Что продаёте (переменная {"{{business.niche}}"})
                  </label>
                  <input
                    type="text"
                    value={wizardConfig?.businessNiche ?? ""}
                    onChange={(e) =>
                      form.setValue("wizard_config.businessNiche", e.target.value, {
                        shouldDirty: true,
                      })
                    }
                    placeholder="Например: Банкротство физлиц и списание долгов под ключ / Ремонт стиральных машин"
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    Какую услугу или товар продаёт консультант. Бот будет держать фокус диалога строго на этом направлении.
                  </p>
                </div>

                {/* 4. Ваш клиент. Кому и в какой ситуации помогаете */}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Ваш клиент. Кому и в какой ситуации помогаете (переменная {"{{client.profile}}"})
                  </label>
                  <input
                    type="text"
                    value={wizardConfig?.clientProfile ?? ""}
                    onChange={(e) =>
                      form.setValue("wizard_config.clientProfile", e.target.value, {
                        shouldDirty: true,
                      })
                    }
                    placeholder="Например: Граждане и ИП с долгами от 300 000 руб., которым угрожают коллекторы или заблокировали счета"
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    Портрет вашей целевой аудитории. Помогает боту понимать жизненную ситуацию клиента и аргументировать выгоду.
                  </p>
                </div>

                {/* 5. Целевой шаг диалога, Чем должен закончиться диалог */}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Целевой шаг диалога, Чем должен закончиться диалог (переменная {"{{target.action}}"})
                  </label>
                  <input
                    type="text"
                    value={wizardConfig?.targetAction ?? ""}
                    onChange={(e) =>
                      form.setValue("wizard_config.targetAction", e.target.value, {
                        shouldDirty: true,
                      })
                    }
                    placeholder="Например: Получение номера телефона и согласование времени бесплатной консультации с юристом"
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    К какому целевому действию консультант ненавязчиво подводит клиента после выявления потребности.
                  </p>
                </div>

                {/* 6. Важные ограничения. Что нельзя обещать или делать */}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Важные ограничения. Что нельзя обещать или делать (переменная {"{{constraints}}"})
                  </label>
                  <input
                    type="text"
                    value={wizardConfig?.constraints ?? ""}
                    onChange={(e) =>
                      form.setValue("wizard_config.constraints", e.target.value, {
                        shouldDirty: true,
                      })
                    }
                    placeholder="Например: Не давать 100% гарантий списания без аудита документов; не называть точную цену без юриста"
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    Строгие запреты (золотая клетка). Защищает компанию от юридических рисков, выдуманных цен и невыполнимых обещаний.
                  </p>
                </div>

                {/* 7. Специалист для эскалации (handoff) */}
                <div className="space-y-1">
                  <label className="block text-xs font-medium text-slate-700">
                    Специалист для эскалации (handoff, переменная {"{{handoff.specialist}}"})
                  </label>
                  <input
                    type="text"
                    value={wizardConfig?.handoffSpecialist ?? ""}
                    onChange={(e) =>
                      form.setValue("wizard_config.handoffSpecialist", e.target.value, {
                        shouldDirty: true,
                      })
                    }
                    placeholder="Например: старший юрист практики / руководитель сервисного участка"
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <p className="text-[11px] text-[#888888]">
                    Сотрудник, на которого переводится диалог при сложных вопросах, жалобах или претензиях. Бот напишет: «Давайте подключу нашего специалиста ([должность]), он этим вопросом занимается напрямую. На какой номер коллеге удобнее вам набрать?» и передаст управление человеку.
                  </p>
                </div>

                {/* 8. Самообучение на диалогах (Dialogue Feedback Loop) */}
                <div className="flex items-start justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-white p-3">
                  <div className="space-y-0.5">
                    <label className="text-xs font-semibold text-[#111111] flex items-center gap-1.5 cursor-pointer" htmlFor="feedback-toggle">
                      <MessageSquare className="h-3.5 w-3.5 text-[#4a38f5]" />
                      Запрашивать комментарии для обучения после диалогов
                    </label>
                    <p className="text-[11px] text-[#666666] leading-relaxed">
                      Оператор или клиент может оценить качество ответа и оставить пожелание по корректировке. Утвержденные правила автоматически дополняют Markdown-базу знаний агента.
                    </p>
                  </div>
                  <input
                    id="feedback-toggle"
                    type="checkbox"
                    checked={form.watch("feedback_learning_enabled") ?? true}
                    onChange={(e) =>
                      form.setValue("feedback_learning_enabled", e.target.checked, { shouldDirty: true })
                    }
                    className="h-4 w-4 rounded border-slate-300 accent-[#4a38f5] cursor-pointer mt-0.5"
                  />
                </div>
              </div>

              {/* Информация о вкладке Базы знаний */}
              <div className="rounded-[8px] border border-slate-200 bg-white p-3 text-xs text-[#555555] flex items-start gap-2.5">
                <FileText className="h-4 w-4 text-[#4a38f5] shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-[#111111]">База знаний, прайс-листы и сканирование сайта</p>
                  <p className="text-[11px] text-[#666666] mt-0.5 leading-relaxed">
                    Загрузка прайс-листов (Excel, PDF, Word), обход страниц сайта через краулер и подключение отзывов с Яндекс Карт / 2ГИС доступны в отдельной вкладке <strong>«База знаний»</strong> на странице созданного бота.
                  </p>
                </div>
              </div>
            </div>

            {/* Статус активации */}
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
                  (боты на паузе сохраняют настройки, но не отвечают в каналах связи)
                </span>
              </span>
            </label>

            {/* ДОПОЛНИТЕЛЬНЫЕ ТЕХНИЧЕСКИЕ ПАРАМЕТРЫ (LLM, ТЕМПЕРАТУРА, ПРОМПТ) — АККОРДЕОН */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]/50 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowTechnicalParams((prev) => !prev)}
                className="w-full flex items-center justify-between p-3.5 text-xs font-semibold text-[#111111] hover:bg-slate-50 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-2 text-slate-700">
                  <Sliders className="h-4 w-4 text-[#888888]" />
                  Дополнительные технические параметры (LLM, температура, промпт)
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-[#888888] transition-transform duration-200",
                    showTechnicalParams && "rotate-180",
                  )}
                />
              </button>

              {showTechnicalParams && (
                <div className="p-4 pt-1 space-y-4 border-t border-[#e5e5e5] bg-white">
                  <div className="rounded-[6px] border border-blue-100 bg-blue-50/50 p-2.5 text-[11px] text-[#555555] leading-relaxed flex items-start gap-2">
                    <Info className="h-3.5 w-3.5 text-[#4a38f5] shrink-0 mt-0.5" />
                    <div>
                      <strong>Автоматическая оркестрация:</strong> Платформа по умолчанию использует оптимальную модель (Google Gemini 3.5 Flash) с автоматическим каскадом резервных моделей (Fallback Chain) при сбоях или перегрузках. Ручная смена параметров требуется только инженерам.
                    </div>
                  </div>

                  {/* Модель */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="block text-xs font-medium text-slate-700">Модель</span>
                      {activeProvider && activeProvider.isConfigured ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Провайдер платформы: {activeProvider.name} {activeProvider.chatModel ? `(${activeProvider.chatModel})` : ""}
                        </span>
                      ) : modelsList.length > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full font-medium">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          Подключено моделей: {modelsList.length}
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

                  {/* Fallback Chains */}
                  <div className="space-y-1.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]/60 p-3">
                    <div className="flex items-center justify-between">
                      <span className="block text-xs font-medium text-slate-700">
                        Цепочка отказоустойчивости (Fallback Chain)
                      </span>
                      <span className="text-[11px] text-[#666666]">
                        Каскад при 429 / 5xx / Timeout
                      </span>
                    </div>
                    <p className="text-[11px] text-[#666666] leading-relaxed">
                      Если основная модель перегружена или не отвечает, запрос автоматически переключается на резервные модели по порядку:
                    </p>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {modelsList
                        .filter((m) => m.id !== selectedModel)
                        .map((m) => {
                          const isSelected = fallbackModels.includes(m.id);
                          const priorityIndex = fallbackModels.indexOf(m.id);
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => toggleFallbackModel(m.id)}
                              className={cn(
                                "rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5",
                                isSelected
                                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                                  : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-slate-50",
                              )}
                            >
                              {isSelected && (
                                <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#4a38f5] text-[9px] text-white font-mono">
                                  {priorityIndex + 1}
                                </span>
                              )}
                              <span>{m.label}</span>
                            </button>
                          );
                        })}
                    </div>
                  </div>

                  {/* Температура и Макс. токенов */}
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
                      <p className="text-[11px] text-slate-500">Зафиксировано 0.6: идеальный баланс естественности и следования прайсу.</p>
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
                      <p className="text-[11px] text-slate-500">Зафиксировано 1024: исключает зависания и длинные роботизированные простыни.</p>
                    </div>
                  </div>

                  {/* Прямой редактор системного промпта */}
                  <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPromptTab("wizard")}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer",
                            promptTab === "wizard"
                              ? "bg-[#4a38f5]/10 text-[#4a38f5]"
                              : "text-[#666666] hover:text-[#111111] hover:bg-slate-50",
                          )}
                        >
                          <Sliders className="h-3.5 w-3.5" />
                          Анкета роли
                        </button>
                        <button
                          type="button"
                          onClick={() => setPromptTab("editor")}
                          className={cn(
                            "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer",
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
                        {isEdit && bot && (
                          <button
                            type="button"
                            onClick={() => setPromptTab("feedbacks")}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-md transition-colors cursor-pointer",
                              promptTab === "feedbacks"
                                ? "bg-[#4a38f5]/10 text-[#4a38f5]"
                                : "text-[#666666] hover:text-[#111111] hover:bg-slate-50",
                            )}
                          >
                            <MessageSquareQuote className="h-3.5 w-3.5" />
                            Обучение на диалогах
                            {approvedFeedbacks.length > 0 && (
                              <span className="ml-1 inline-flex items-center px-1.5 py-0.2 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200">
                                {approvedFeedbacks.length}
                              </span>
                            )}
                          </button>
                        )}
                      </div>

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
                        className="inline-flex items-center gap-1.5 text-[11px] text-[#4a38f5] hover:text-[#3d2ee0] font-medium cursor-pointer"
                      >
                        <RefreshCw className="h-3 w-3" />
                        Сбросить к эталону Мета-Промпта v2.0
                      </button>
                    </div>

                    {promptTab === "editor" && (
                      <div className="space-y-2 pt-1">
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

                    {promptTab === "feedbacks" && (
                      <div className="space-y-4 pt-2">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]">
                          <div className="space-y-1">
                            <h4 className="text-xs font-semibold text-[#111111] flex items-center gap-1.5">
                              <MessageSquareQuote className="h-4 w-4 text-[#4a38f5]" />
                              Пересборка системного промпта по правилам обучения
                            </h4>
                            <p className="text-xs text-[#666666] leading-relaxed">
                              Утвержденные правила из диалогов с клиентами интегрируются в валидную структуру &lt;director_system_prompt&gt;.
                            </p>
                          </div>
                          <button
                            type="button"
                            disabled={rebuildPromptMutation.isPending || approvedFeedbacks.length === 0}
                            onClick={handleRebuildPromptFromFeedbacks}
                            className="h-8 shrink-0 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer flex items-center gap-1.5 transition-colors shadow-2xs"
                          >
                            {rebuildPromptMutation.isPending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RefreshCw className="h-3.5 w-3.5" />
                            )}
                            <span>Пересобрать промпт агента</span>
                          </button>
                        </div>

                        {approvedFeedbacks.length === 0 ? (
                          <div className="rounded-[8px] border border-dashed border-[#e5e5e5] p-6 text-center text-xs text-[#666666]">
                            У этого агента пока нет утвержденных правил обучения. Оценивайте диалоги в CRM или подтверждайте правила в базе знаний.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-[#111111]">
                              Утвержденные правила обучения ({approvedFeedbacks.length}):
                            </p>
                            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                              {approvedFeedbacks.map((fb, idx) => (
                                <div key={fb.id} className="p-3 rounded-[6px] border border-[#e5e5e5] bg-white text-xs space-y-1">
                                  <div className="flex items-center justify-between text-[11px] text-[#666666]">
                                    <span className="font-semibold text-[#111111]">Правило #{idx + 1}</span>
                                    <span>Оценка: {fb.rating}/5</span>
                                  </div>
                                  <p className="text-[#333333] font-mono text-[11px]">
                                    {fb.compiledRule || fb.userComment}
                                  </p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 flex items-center justify-between border-t border-[#e5e5e5] bg-white px-6 py-4">
            <div>
              {isEdit && bot && onDelete && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onDelete(bot);
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 transition-colors hover:bg-rose-100 cursor-pointer"
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить агента
                </button>
              )}
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={!isValid || isSubmitting}
                className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3d2ee0] disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Сохраняем...
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
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
