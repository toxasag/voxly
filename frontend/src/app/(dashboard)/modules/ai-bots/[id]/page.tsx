"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { toast } from "sonner";
import {
  BarChart3,
  Bot,
  Braces,
  ChevronLeft,
  FileText,
  MessageSquare,
  Plug,
  Settings2,
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
import { useAiAgent, useUpdateAiAgent } from "@/lib/api/use-ai-agents";
import { useHasPermission } from "@/lib/auth/use-auth";
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
  const update = useUpdateAiAgent();
  // Тем же правом закрыта кнопка настроек ниже: интерфейс скрывает ровно то, что
  // отклонил бы сервер (`ai_bots:configure` на маршрутах записи).
  const canConfigure = useHasPermission("ai_bots:configure");

  const [tab, setTab] = useState<BotTab>("chat");
  const [configOpen, setConfigOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(bot.system_prompt);

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
      await update.mutateAsync({ id: bot.id, payload });
      toast.success("Настройки агента сохранены");
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

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <Link
        href="/modules/ai-bots"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition-colors hover:text-slate-300"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Назад к AI-ботам
      </Link>

      {/* Top bar */}
      <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
              getAccentClasses(bot.accent),
            )}
          >
            <Bot className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold text-slate-100">{bot.name}</h1>
              <StatusBadge variant={isActive ? "success" : "neutral"} size="sm" withDot>
                {isActive ? "Активен" : "На паузе"}
              </StatusBadge>
            </div>
            <p className="mt-1 text-sm text-slate-400">{bot.description}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-slate-700 bg-slate-950/60 px-2 py-0.5 font-mono text-xs text-slate-400">
                {model.label}
              </span>
              <span className="text-xs text-slate-600">
                {getProviderLabel(model.provider)}
              </span>
              <span className="rounded-md border border-orange-400/30 bg-orange-400/10 px-2 py-0.5 text-xs font-medium text-orange-400">
                {getBotModeLabel(bot.mode)}
              </span>
              <span className="text-xs text-slate-600">
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
              "rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
              isActive
                ? "border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20",
            )}
          >
            {isActive ? "Пауза" : "Активировать"}
          </button>
          <Guard requiredPermission="ai_bots:configure">
            <button
              type="button"
              onClick={() => setConfigOpen(true)}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Настроить
            </button>
          </Guard>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex w-fit items-center gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
        {TABS.map((entry) => {
          const Icon = entry.icon;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                tab === entry.key
                  ? "bg-amber-500 text-slate-950"
                  : "text-slate-400 hover:text-slate-200",
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
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
            <Braces className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs leading-relaxed text-slate-400">
              Демонстрационный режим: ответы формируются локально в браузере, модель не
              вызывается и баланс ИИ не расходуется. Реальные ответы появятся после
              подключения провайдера.
            </p>
          </div>
          <BotChat bot={bot} />
        </div>
      )}

      {tab === "prompt" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <PromptTemplateEditor
                value={promptDraft}
                onChange={setPromptDraft}
                contextWindow={model.context_window}
                rows={12}
              />

              <div className="mt-4 flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
                {promptDirty && (
                  <span className="mr-auto text-xs text-amber-400">Несохранённые изменения</span>
                )}
                <button
                  type="button"
                  onClick={resetPrompt}
                  disabled={!promptDirty}
                  className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Сбросить
                </button>
                <button
                  type="button"
                  onClick={savePrompt}
                  disabled={!promptDirty}
                  className="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Сохранить промпт
                </button>
              </div>
            </div>

            {/* Resolved preview */}
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">
                Подстановка во время выполнения
                <span className="ml-1.5 text-xs font-normal text-slate-600">
                  примерные значения
                </span>
              </h3>
              <p className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm leading-relaxed text-slate-300">
                {renderPromptPreview(promptDraft)}
              </p>
            </div>
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Сущности контекста</h3>
              <div className="flex flex-wrap gap-1.5">
                {bot.context_entities.map((entity) => (
                  <span
                    key={entity}
                    className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400"
                  >
                    {getContextEntityLabel(entity)}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-600">
                Записи этих сущностей загружаются в рамках тенанта вызывающего пользователя и
                подставляются перед отправкой промпта.
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="mb-1 text-sm font-semibold text-slate-200">Режим</h3>
              <p className="text-xs leading-relaxed text-slate-500">
                {getBotModeDescription(bot.mode)}
              </p>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-200">Шаблоны</h3>
              <div className="space-y-2">
                {PROMPT_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => applyTemplate(template.body)}
                    className="w-full rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-left transition-colors hover:border-slate-700"
                  >
                    <span className="block text-xs font-medium text-slate-300">
                      {template.name}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-xs text-slate-600">
                      {template.description}
                    </span>
                    <span className="mt-1.5 flex flex-wrap gap-1">
                      {template.variables.slice(0, 3).map((variable) => (
                        <span
                          key={variable}
                          className="rounded border border-slate-700 px-1 py-0.5 font-mono text-xs text-slate-500"
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
      <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
        <p className="text-sm text-rose-400">
          Не удалось загрузить агента: {error?.message ?? "неизвестная ошибка"}
        </p>
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
        <div className="rounded-xl border border-slate-800 bg-slate-900">
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
