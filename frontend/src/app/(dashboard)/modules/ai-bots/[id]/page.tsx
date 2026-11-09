"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
  Bot,
  Braces,
  Check,
  ChevronLeft,
  Clock,
  Copy,
  FileText,
  MessageSquare,
  Plug,
  Settings2,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { AiBot } from "@/lib/ai-bots/ai-bots.types";
import {
  getAccentClasses,
  getBotModeDescription,
  getBotModeLabel,
  getContextEntityLabel,
  getModelInfo,
  getProviderLabel,
  renderPromptPreview,
} from "@/lib/ai-bots/ai-bots.types";
import { PROMPT_TEMPLATES } from "@/lib/ai-bots/prompt-templates";
import {
  useAiAgent,
  useAgentPromptPreview,
  useDeleteAiAgent,
  useUpdateAiAgent,
} from "@/lib/api/use-ai-agents";
import { useAuth, useHasPermission } from "@/lib/auth/use-auth";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Skeleton } from "@/components/shared/Skeleton";
import { AgentChannelsTab } from "@/components/ai-bots/AgentChannelsTab";
import { AgentKnowledgeTab } from "@/components/ai-bots/AgentKnowledgeTab";
import { BotChat } from "@/components/ai-bots/BotChat";
import { BotModal } from "@/components/ai-bots/BotModal";
import { BotUsageStats } from "@/components/ai-bots/BotUsageStats";
import { PromptTemplateEditor } from "@/components/ai-bots/PromptTemplateEditor";
import { EmptyState } from "@/components/shared/EmptyState";
import { Guard } from "@/components/shared/Guard";
import { StatusBadge } from "@/components/shared/StatusBadge";
import type { CreateBotPayload } from "@/schemas/ai-bot.schema";
import { cn } from "@/lib/utils";

type BotTab = "chat" | "prompt" | "knowledge" | "channels" | "usage";

const TABS: { key: BotTab; label: string; icon: typeof Bot }[] = [
  { key: "chat", label: "Чат", icon: MessageSquare },
  { key: "prompt", label: "Промпт", icon: Braces },
  { key: "knowledge", label: "База знаний", icon: FileText },
  { key: "channels", label: "Подключенные каналы", icon: Plug },
  { key: "usage", label: "Использование", icon: BarChart3 },
];

interface BotDetailContentProps {
  bot: AiBot;
}

function BotDetailContent({ bot }: BotDetailContentProps) {
  const router = useRouter();
  const update = useUpdateAiAgent();
  const deleteMutation = useDeleteAiAgent();
  const { tenant } = useAuth();
  const tenantName = tenant?.tenantName ?? "Компания";

  // Тем же правом закрыта кнопка настроек ниже: интерфейс скрывает ровно то, что
  // отклонил бы сервер (`ai_bots:configure` на маршрутах записи).
  const canConfigure = useHasPermission("ai_bots:configure");

  const [tab, setTab] = useState<BotTab>("chat");
  const [configOpen, setConfigOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(bot.system_prompt);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const { data: previewData } = useAgentPromptPreview(bot.id, promptDraft);

  const isCompanyOverridden = useMemo(() => {
    const wc = (bot.wizard_config ?? {}) as Record<string, unknown>;
    return Boolean(
      (bot.company_name_override && bot.company_name_override.trim().length > 0) ||
      (bot.companyNameOverride && bot.companyNameOverride.trim().length > 0) ||
      (wc.company_name_override && String(wc.company_name_override).trim().length > 0) ||
      (wc.companyName && String(wc.companyName).trim().length > 0),
    );
  }, [bot]);

  const effectiveVariables = useMemo(() => {
    const fromApi = previewData?.variables ?? {};
    const wc = (bot.wizard_config ?? {}) as Record<string, string | undefined>;

    const effectiveCompany =
      (bot.company_name_override && bot.company_name_override.trim().length > 0 ? bot.company_name_override.trim() : null) ||
      (bot.companyNameOverride && bot.companyNameOverride.trim().length > 0 ? bot.companyNameOverride.trim() : null) ||
      (wc.company_name_override && wc.company_name_override.trim().length > 0 ? wc.company_name_override.trim() : null) ||
      (wc.companyName && wc.companyName.trim().length > 0 ? wc.companyName.trim() : null) ||
      fromApi["tenant.name"] ||
      tenantName;

    const effectiveConsultant =
      (bot.consultant_name && bot.consultant_name.trim().length > 0 ? bot.consultant_name.trim() : null) ||
      (bot.consultantName && bot.consultantName.trim().length > 0 ? bot.consultantName.trim() : null) ||
      (wc.consultantName && wc.consultantName.trim().length > 0 ? wc.consultantName.trim() : null) ||
      fromApi["consultant.name"] ||
      bot.name ||
      "Консультант";

    const effectiveRole =
      (bot.consultant_role && bot.consultant_role.trim().length > 0 ? bot.consultant_role.trim() : null) ||
      (bot.consultantRole && bot.consultantRole.trim().length > 0 ? bot.consultantRole.trim() : null) ||
      (wc.consultantRole && wc.consultantRole.trim().length > 0 ? wc.consultantRole.trim() : null) ||
      fromApi["consultant.role"] ||
      "онлайн-помощник";

    const effectiveNiche =
      (wc.businessNiche && wc.businessNiche.trim().length > 0 ? wc.businessNiche.trim() : null) ||
      fromApi["business.niche"] ||
      (bot.description && bot.description.trim().length > 5 ? bot.description.trim() : null) ||
      "оказание профильных услуг и консультация клиентов";

    const effectiveProfile =
      (wc.clientProfile && wc.clientProfile.trim().length > 0 ? wc.clientProfile.trim() : null) ||
      (wc.client_profile && wc.client_profile.trim().length > 0 ? wc.client_profile.trim() : null) ||
      fromApi["client.profile"] ||
      "клиенты, которым требуется экспертная консультация и решение их задачи";

    const effectiveTargetAction =
      (wc.targetAction && wc.targetAction.trim().length > 0 ? wc.targetAction.trim() : null) ||
      fromApi["target.action"] ||
      "согласование деталей заказа и обмен контактами";

    const effectiveConstraints =
      (wc.constraints && wc.constraints.trim().length > 0 ? wc.constraints.trim() : null) ||
      fromApi["constraints"] ||
      "Не давать ложных обещаний, строго следовать закону и регламенту компании.";

    const effectiveHandoff =
      (wc.handoffSpecialist && wc.handoffSpecialist.trim().length > 0 ? wc.handoffSpecialist.trim() : null) ||
      fromApi["handoff.specialist"] ||
      "старший специалист профильного отдела";

    const currentTime =
      fromApi["current_time"] ||
      new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) + " МСК";

    const channelType = fromApi["channel_type"] || "чат на сайте";

    return {
      "tenant.name": effectiveCompany,
      "company.name": effectiveCompany,
      "consultant.name": effectiveConsultant,
      "consultant.role": effectiveRole,
      "business.niche": effectiveNiche,
      "client.profile": effectiveProfile,
      "target.action": effectiveTargetAction,
      "constraints": effectiveConstraints,
      "handoff.specialist": effectiveHandoff,
      "current_time": currentTime,
      "channel_type": channelType,
    };
  }, [bot, previewData?.variables, tenantName]);

  const copyVariableValue = useCallback((key: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopiedKey(key);
    toast.success(`Переменная {{${key}}} скопирована`);
    setTimeout(() => setCopiedKey((curr) => (curr === key ? null : curr)), 2000);
  }, []);

  const previewText = useMemo(() => {
    if (previewData?.resolvedPrompt) {
      return previewData.resolvedPrompt;
    }
    return renderPromptPreview(promptDraft, bot, {
      tenantName,
      currentTime:
        new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) + " МСК",
      channelType: "чат на сайте",
    });
  }, [previewData?.resolvedPrompt, promptDraft, bot, tenantName]);

  // Черновик промпта синхронизируется с сервером: после сохранения приходит
  // обновлённый агент, и локальная копия не должна показывать прежний текст.
  useEffect(() => {
    setPromptDraft(bot.system_prompt);
  }, [bot.system_prompt]);

  /**
   * Статистика по агенту.
   *
   * Пока пустая: журнал `ai_usage_log` заполняется вызовами моделей, а провайдер
   * ещё не подключён. Прежде здесь показывались сгенерированные цифры — они
   * выглядели как реальный расход и вводили в заблуждение.
   */
  const usage = useMemo(() => [], []);
  const logs = useMemo(() => [], []);
  const model = getModelInfo(bot.model);
  const isActive = bot.status === "active";
  const promptDirty = promptDraft !== bot.system_prompt;

  const handleToggleStatus = useCallback(() => {
    const status = bot.status === "active" ? "paused" : "active";

    void update
      .mutateAsync({ id: bot.id, payload: { status } })
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Не удалось изменить статус"),
      );
  }, [bot.id, bot.status, update]);

  const handleConfigSubmit = useCallback(
    async (payload: CreateBotPayload) => {
      const updated = await update.mutateAsync({ id: bot.id, payload });
      toast.success("Настройки агента сохранены");
      return updated;
    },
    [bot.id, update],
  );

  const savePrompt = useCallback(() => {
    void update
      .mutateAsync({ id: bot.id, payload: { system_prompt: promptDraft } })
      .then(() => toast.success("Промпт сохранён"))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить промпт"),
      );
  }, [bot.id, promptDraft, update]);

  const resetPrompt = useCallback(() => setPromptDraft(bot.system_prompt), [bot.system_prompt]);

  const applyTemplate = useCallback((body: string) => setPromptDraft(body), []);

  const handleDeleteAgent = useCallback(async () => {
    try {
      await deleteMutation.mutateAsync({ id: bot.id });
      toast.success(`AI-агент «${bot.name}» успешно удалён`);
      router.push("/modules/ai-bots");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить агента");
    }
  }, [bot.id, bot.name, deleteMutation, router]);

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <Link
        href="/modules/ai-bots"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#666666] transition-colors hover:text-[#111111]"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Назад к AI-ботам
      </Link>

      {/* Top bar */}
      <div className="flex items-start justify-between gap-4 rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-[8px]",
              getAccentClasses(bot.accent),
            )}
          >
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold text-[#111111]">{bot.name}</h1>
              <StatusBadge variant={isActive ? "success" : "neutral"} size="sm" withDot>
                {isActive ? "Активен" : "На паузе"}
              </StatusBadge>
            </div>
            <p className="mt-1 text-[13px] text-[#666666]">{bot.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-[4px] border border-[#e5e5e5] bg-[#f5f5f5] px-2 py-0.5 font-mono text-xs text-[#666666]">
                {model.label}
              </span>
              <span className="text-xs text-[#888888]">
                {getProviderLabel(model.provider)}
              </span>
              <span className="rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                {getBotModeLabel(bot.mode)}
              </span>
              <span className="text-xs text-[#888888]">
                temp {bot.temperature.toFixed(1)} · макс. {bot.max_tokens} ток.
              </span>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleToggleStatus}
            className={cn(
              "rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-colors shadow-2xs",
              isActive
                ? "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]"
                : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
            )}
          >
            {isActive ? "Пауза" : "Активировать"}
          </button>
          <Guard requiredPermission="ai_bots:configure">
            <button
              type="button"
              onClick={() => setConfigOpen(true)}
              className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Настроить
            </button>
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#666666] shadow-2xs transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Удалить
            </button>
          </Guard>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex w-fit items-center gap-1 rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-2xs">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={cn(
                "flex items-center gap-2 rounded-[6px] px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                tab === entry.key
                  ? "bg-[#4a38f5] text-white shadow-2xs"
                  : "text-[#666666] hover:text-[#111111] hover:bg-[#fafafa]",
              )}
            >
              <Icon className="h-4 w-4" />
              {entry.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {/*
        Пробный чат работает на локальной имитации потока: ключа LLM-провайдера на
        платформе пока нет, поэтому ответы генерируются в браузере. Предупреждение
        стоит над чатом, иначе экран выглядел бы как работающий ассистент.
      */}
      {tab === "chat" && (
        <div className="space-y-3">
          <BotChat bot={bot} />
        </div>
      )}

      {tab === "prompt" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
              <PromptTemplateEditor
                value={promptDraft}
                onChange={setPromptDraft}
                contextWindow={model.context_window}
                rows={12}
              />

              <div className="mt-4 flex items-center justify-end gap-3 border-t border-[#e5e5e5] pt-4">
                {promptDirty && (
                  <span className="mr-auto text-xs text-amber-700">Несохранённые изменения</span>
                )}
                <button
                  type="button"
                  onClick={resetPrompt}
                  disabled={!promptDirty}
                  className="rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-2 text-[13px] font-medium text-[#666666] shadow-2xs transition-colors hover:bg-[#fafafa] hover:text-[#111111] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Сбросить
                </button>
                <button
                  type="button"
                  onClick={savePrompt}
                  disabled={!promptDirty}
                  className="rounded-[8px] bg-[#4a38f5] px-5 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Сохранить промпт
                </button>
              </div>
            </div>

            {/* Resolved preview */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#e5e5e5] pb-4">
                <div>
                  <h3 className="text-[14px] font-semibold text-[#111111] flex items-center gap-2">
                    <Braces className="h-4 w-4 text-[#4a38f5]" />
                    Подстановка во время выполнения
                  </h3>
                  <p className="mt-1 text-xs text-[#666666]">
                    Актуальные данные и переменные среды, подставляемые в шаблон системного промпта перед каждым запросом к модели.
                  </p>
                </div>
                {canConfigure && (
                  <button
                    type="button"
                    onClick={() => setConfigOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer shrink-0"
                  >
                    <Settings2 className="h-3.5 w-3.5 text-[#4a38f5]" />
                    <span>Настроить переменные</span>
                  </button>
                )}
              </div>

              {/* Секция 1: Анкета и настройки бота (Редактируемые оверрайды) */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5 text-[#4a38f5]" />
                    <span className="text-xs font-semibold text-[#111111]">
                      Анкета и настройки бота
                    </span>
                    <span className="rounded-[4px] border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700">
                      Редактируемые оверрайды
                    </span>
                  </div>
                  {canConfigure && (
                    <button
                      type="button"
                      onClick={() => setConfigOpen(true)}
                      className="text-[11px] font-medium text-[#4a38f5] hover:text-[#3d2ee0] hover:underline cursor-pointer"
                    >
                      Изменить в анкете →
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {/* Название компании (Главный фокус!) */}
                  <div className="col-span-1 md:col-span-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#4a38f5]">
                          {"{{tenant.name}}"}
                        </code>
                        <span className="text-[11px] text-[#888888] font-mono">
                          (алиас: {"{{company.name}}"})
                        </span>
                        <span className="text-xs font-medium text-[#111111]">
                          Название компании
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded-[4px] border px-2 py-0.5 text-[10px] font-medium",
                            isCompanyOverridden
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-[#e5e5e5] bg-white text-[#666666]",
                          )}
                        >
                          {isCompanyOverridden ? "Оверрайд агента" : `По умолчанию из CRM (${tenantName})`}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyVariableValue("tenant.name", effectiveVariables["tenant.name"])}
                          className="rounded-[4px] p-1 text-[#666666] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                          title="Скопировать значение"
                        >
                          {copiedKey === "tenant.name" ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                    <div className="text-[13px] font-medium text-[#111111] break-words">
                      {effectiveVariables["tenant.name"]}
                    </div>
                    {!isCompanyOverridden && (
                      <p className="mt-1 text-[11px] text-[#888888]">
                        Если хотите назвать компанию иначе, укажите своё имя в настройках бота («Название компании»).
                      </p>
                    )}
                  </div>

                  {/* Имя консультанта */}
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#4a38f5]">
                          {"{{consultant.name}}"}
                        </code>
                        <span className="text-xs font-medium text-[#111111]">Имя консультанта</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyVariableValue("consultant.name", effectiveVariables["consultant.name"])}
                        className="rounded-[4px] p-1 text-[#666666] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                        title="Скопировать"
                      >
                        {copiedKey === "consultant.name" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="text-[13px] text-[#111111] break-words">
                      {effectiveVariables["consultant.name"]}
                    </div>
                  </div>

                  {/* Роль консультанта */}
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#4a38f5]">
                          {"{{consultant.role}}"}
                        </code>
                        <span className="text-xs font-medium text-[#111111]">Должность / роль</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyVariableValue("consultant.role", effectiveVariables["consultant.role"])}
                        className="rounded-[4px] p-1 text-[#666666] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                        title="Скопировать"
                      >
                        {copiedKey === "consultant.role" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="text-[13px] text-[#111111] break-words">
                      {effectiveVariables["consultant.role"]}
                    </div>
                  </div>

                  {/* Продукт / Ниша */}
                  <div className="col-span-1 md:col-span-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#4a38f5]">
                          {"{{business.niche}}"}
                        </code>
                        <span className="text-xs font-medium text-[#111111]">Продукт / Ниша компании</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyVariableValue("business.niche", effectiveVariables["business.niche"])}
                        className="rounded-[4px] p-1 text-[#666666] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                        title="Скопировать"
                      >
                        {copiedKey === "business.niche" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="text-[12px] sm:text-[13px] text-[#111111] leading-relaxed break-words font-normal">
                      {effectiveVariables["business.niche"]}
                    </div>
                  </div>

                  {/* Портрет целевого клиента */}
                  <div className="col-span-1 md:col-span-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#4a38f5]">
                          {"{{client.profile}}"}
                        </code>
                        <span className="text-xs font-medium text-[#111111]">Портрет клиента</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyVariableValue("client.profile", effectiveVariables["client.profile"])}
                        className="rounded-[4px] p-1 text-[#666666] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                        title="Скопировать"
                      >
                        {copiedKey === "client.profile" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="text-[12px] sm:text-[13px] text-[#111111] leading-relaxed break-words font-normal">
                      {effectiveVariables["client.profile"]}
                    </div>
                  </div>

                  {/* Целевой шаг диалога */}
                  <div className="col-span-1 md:col-span-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#4a38f5]">
                          {"{{target.action}}"}
                        </code>
                        <span className="text-xs font-medium text-[#111111]">Целевой шаг диалога</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyVariableValue("target.action", effectiveVariables["target.action"])}
                        className="rounded-[4px] p-1 text-[#666666] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                        title="Скопировать"
                      >
                        {copiedKey === "target.action" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="text-[12px] sm:text-[13px] text-[#111111] leading-relaxed break-words font-normal">
                      {effectiveVariables["target.action"]}
                    </div>
                  </div>

                  {/* Ограничения */}
                  <div className="col-span-1 md:col-span-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#4a38f5]">
                          {"{{constraints}}"}
                        </code>
                        <span className="text-xs font-medium text-[#111111]">Ограничения</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyVariableValue("constraints", effectiveVariables["constraints"])}
                        className="rounded-[4px] p-1 text-[#666666] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                        title="Скопировать"
                      >
                        {copiedKey === "constraints" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="text-[12px] sm:text-[13px] text-[#111111] leading-relaxed break-words font-normal">
                      {effectiveVariables["constraints"]}
                    </div>
                  </div>

                  {/* Специалист эскалации */}
                  <div className="col-span-1 md:col-span-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#4a38f5]">
                          {"{{handoff.specialist}}"}
                        </code>
                        <span className="text-xs font-medium text-[#111111]">Специалист эскалации</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyVariableValue("handoff.specialist", effectiveVariables["handoff.specialist"])}
                        className="rounded-[4px] p-1 text-[#666666] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                        title="Скопировать"
                      >
                        {copiedKey === "handoff.specialist" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                    <div className="text-[13px] text-[#111111] break-words">
                      {effectiveVariables["handoff.specialist"]}
                    </div>
                  </div>
                </div>
              </div>

              {/* Секция 2: Системные переменные среды (Только чтение / Вычисляется на лету) */}
              <div className="space-y-3 pt-3 border-t border-[#e5e5e5]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 text-amber-600" />
                    <span className="text-xs font-semibold text-[#111111]">
                      Системные переменные среды
                    </span>
                    <span className="rounded-[4px] border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                      Только чтение · Вычисляется на лету
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {/* Текущее время */}
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#666666]">
                          {"{{current_time}}"}
                        </code>
                        <span className="text-xs font-medium text-[#111111]">Время (МСК)</span>
                      </div>
                      <span className="rounded-[4px] border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        Только чтение
                      </span>
                    </div>
                    <div className="text-[13px] font-mono text-[#111111]">
                      {effectiveVariables["current_time"]}
                    </div>
                  </div>

                  {/* Канал связи */}
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 transition-colors hover:border-[#cccccc]">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <div className="flex items-center gap-2">
                        <code className="rounded-[4px] border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-[#666666]">
                          {"{{channel_type}}"}
                        </code>
                        <span className="text-xs font-medium text-[#111111]">Канал</span>
                      </div>
                      <span className="rounded-[4px] border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                        Только чтение
                      </span>
                    </div>
                    <div className="text-[13px] text-[#111111]">
                      {effectiveVariables["channel_type"]}
                    </div>
                  </div>
                </div>
              </div>

              {/* RAG Telemetry */}
              {previewData?.ragTelemetry && (
                <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-[#111111]">
                      Векторная база знаний (RAG)
                    </span>
                    <button
                      type="button"
                      onClick={() => setTab("knowledge")}
                      className="text-xs font-medium text-[#4a38f5] hover:underline cursor-pointer"
                    >
                      Управление базой знаний →
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    <div className="rounded-[6px] border border-emerald-200 bg-emerald-50/50 p-2.5">
                      <div className="text-[11px] text-[#666666]">Готово к поиску</div>
                      <div className="text-[15px] font-semibold text-emerald-700">
                        {previewData.ragTelemetry.readyDocumentsCount} документов
                      </div>
                    </div>
                    <div className="rounded-[6px] border border-indigo-200 bg-indigo-50/50 p-2.5">
                      <div className="text-[11px] text-[#666666]">Активных чанков</div>
                      <div className="text-[15px] font-semibold text-indigo-700">
                        {previewData.ragTelemetry.activeChunksCount} фрагментов
                      </div>
                    </div>
                    <div className={`rounded-[6px] border p-2.5 ${previewData.ragTelemetry.draftDocumentsCount > 0 ? "border-amber-200 bg-amber-50/50" : "border-[#e5e5e5] bg-[#fafafa]"}`}>
                      <div className="text-[11px] text-[#666666]">На модерации (draft)</div>
                      <div className={`text-[15px] font-semibold ${previewData.ragTelemetry.draftDocumentsCount > 0 ? "text-amber-800" : "text-[#888888]"}`}>
                        {previewData.ragTelemetry.draftDocumentsCount} документов
                      </div>
                    </div>
                  </div>
                  {previewData.ragTelemetry.draftDocuments && previewData.ragTelemetry.draftDocuments.length > 0 && (
                    <div className="mt-3 rounded-[6px] border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                      <div className="font-medium mb-1">
                        Ожидают проверки и векторизации ({previewData.ragTelemetry.draftDocuments.length}):
                      </div>
                      <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-800">
                        {previewData.ragTelemetry.draftDocuments.map((doc) => (
                          <li key={doc.id} className="truncate">
                            {doc.filename} {doc.sourceUrl ? `(${doc.sourceUrl})` : ""}
                          </li>
                        ))}
                      </ul>
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={() => setTab("knowledge")}
                          className="font-semibold text-amber-950 underline hover:text-black cursor-pointer"
                        >
                          Перейти в «Базу знаний» для проверки и запуска векторизации
                        </button>
                      </div>
                    </div>
                  )}
                  <p className="mt-2 text-[11px] text-[#888888]">
                    Системный промпт изолирован от раздувания: релевантные факты прайса и каталога подтягиваются автоматически в блок &lt;retrieved_facts&gt; при каждом запросе клиента.
                  </p>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#666666]">
                  Итоговый системный промпт (статичный канон + метод Станиславского + шпаргалка):
                </label>
                <p className="max-h-[500px] overflow-y-auto whitespace-pre-wrap rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-4 py-3 text-xs leading-relaxed text-[#111111] font-mono">
                  {previewText}
                </p>
              </div>
            </div>
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
              <h3 className="mb-3 text-[13px] font-semibold text-[#111111]">Сущности контекста</h3>
              <div className="flex flex-wrap gap-1.5">
                {bot.context_entities.map((entity) => (
                  <span
                    key={entity}
                    className="rounded-[4px] border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700"
                  >
                    {getContextEntityLabel(entity)}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[#666666]">
                Записи этих сущностей загружаются в рамках тенанта вызывающего пользователя и
                подставляются перед отправкой промпта.
              </p>
            </div>

            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
              <h3 className="mb-1 text-[13px] font-semibold text-[#111111]">Режим</h3>
              <p className="text-xs leading-relaxed text-[#666666]">
                {getBotModeDescription(bot.mode)}
              </p>
            </div>

            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
              <h3 className="mb-3 text-[13px] font-semibold text-[#111111]">Шаблоны</h3>
              <div className="space-y-2">
                {PROMPT_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyTemplate(template.body)}
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2.5 text-left transition-colors hover:border-[#cccccc] hover:bg-[#fafafa]"
                  >
                    <span className="block text-xs font-medium text-[#111111]">
                      {template.name}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-xs text-[#666666]">
                      {template.description}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {template.variables.slice(0, 3).map((variable) => (
                        <span
                          key={variable}
                          className="rounded-[4px] border border-[#e5e5e5] bg-[#f5f5f5] px-1 py-0.5 font-mono text-xs text-[#666666]"
                        >
                          {variable}
                        </span>
                      ))}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/*
        База знаний и каналы живут на странице агента, а не в модальном окне
        настроек: и документ, и привязка требуют существующего `agentId`, поэтому
        в окне создания эти разделы показывали бы органы управления, которые
        ничего не делают до первого сохранения.

        `canEdit` берётся из того же права, что закрывает кнопку настроек:
        интерфейс скрывает ровно то, что отклонил бы сервер.
      */}
      {tab === "knowledge" && <AgentKnowledgeTab agentId={bot.id} canEdit={canConfigure} />}

      {tab === "channels" && <AgentChannelsTab agentId={bot.id} canEdit={canConfigure} />}

      {tab === "usage" && <BotUsageStats bot={bot} usage={usage} logs={logs} />}

      <BotModal
        open={configOpen}
        bot={bot}
        onClose={() => setConfigOpen(false)}
        onSubmit={handleConfigSubmit}
        onDelete={() => setDeleteConfirmOpen(true)}
      />

      <ConfirmDialog
        open={deleteConfirmOpen}
        title="Удалить AI-агента?"
        description={`Вы уверены, что хотите удалить агента «${bot.name}»? Бот будет выведен из эксплуатации, а все привязанные каналы связи отвязаны. Действие необратимо.`}
        confirmLabel="Удалить агента"
        cancelLabel="Отмена"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={handleDeleteAgent}
        onClose={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}

/** Загрузка агента с сервера. Вынесена внутрь Guard: без права запрос не нужен. */
function BotDetailLoader({ id }: { id: string }) {
  const { data, isLoading, isError, error } = useAiAgent(id);

  if (isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // 404 — агента нет или он удалён: стандартная страница уместнее сообщения об
  // ошибке загрузки.
  if (isError && error.status === 404) notFound();

  if (isError || data === undefined) {
    return (
      <div role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-semibold text-rose-900">Не удалось загрузить агента</p>
        <p className="mt-1 text-sm text-rose-700">{error?.message ?? "неизвестная ошибка"}</p>
      </div>
    );
  }

  return <BotDetailContent bot={data} />;
}

export default function BotDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  if (typeof id !== "string" || id.length === 0) notFound();

  return (
    <Guard
      requiredPermission="ai_bots:read"
      requiredModule="ai_bots"
      fallback={
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
          <EmptyState
            icon={Bot}
            title="Нет доступа к AI-агентам"
            description="Модуль не установлен для этого рабочего пространства, либо у вашей роли нет права ai_bots:read."
          />
        </div>
      }
    >
      <BotDetailLoader id={id} />
    </Guard>
  );
}
