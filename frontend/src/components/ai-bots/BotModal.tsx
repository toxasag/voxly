"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bot, Loader2, Save, Sparkles, X } from "lucide-react";
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
import { createBotSchema, type CreateBotPayload } from "@/schemas/ai-bot.schema";
import { PromptTemplateEditor } from "@/components/ai-bots/PromptTemplateEditor";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

interface BotModalProps {
  open: boolean;
  /** Pass a bot to edit it; omit to create a new one. */
  bot?: AiBot | null;
  onClose: () => void;
  onSubmit: (payload: CreateBotPayload) => Promise<void> | void;
}

const MODES: BotMode[] = ["suggester", "autoreply", "disabled"];

const ACCENTS: { value: CreateBotPayload["accent"]; swatch: string }[] = [
  { value: "amber", swatch: "bg-amber-500" },
  { value: "sky", swatch: "bg-sky-500" },
  { value: "emerald", swatch: "bg-emerald-500" },
  { value: "orange", swatch: "bg-orange-400" },
  { value: "rose", swatch: "bg-rose-500" },
];

const DEFAULT_VALUES: CreateBotPayload = {
  name: "",
  description: "",
  model: "gpt-4o-mini",
  mode: "suggester",
  status: "active",
  accent: "amber",
  temperature: 0.6,
  max_tokens: 1024,
  system_prompt: "",
  context_entities: ["contacts", "deals"],
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
  };
}

export function BotModal({ open, bot = null, onClose, onSubmit }: BotModalProps) {
  const isEdit = bot !== null;

  const form = useForm<CreateBotPayload>({
    resolver: zodResolver(createBotSchema),
    defaultValues: DEFAULT_VALUES,
    mode: "onChange",
  });

  const { errors, isValid, isSubmitting } = form.formState;

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose });

  // Re-seed the form whenever the modal opens or the target bot changes.
  useEffect(() => {
    if (!open) return;
    form.reset(bot !== null ? toFormValues(bot) : DEFAULT_VALUES);
  }, [open, bot, form]);

  // Escape to close + body scroll lock

  const handleBackdrop = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  const submit = useCallback(
    async (values: CreateBotPayload) => {
      await onSubmit(values);
      onClose();
    },
    [onClose, onSubmit],
  );

  const selectedModel: BotModel = form.watch("model");
  const selectedMode: BotMode = form.watch("mode");
  const selectedAccent = form.watch("accent");
  const temperature = form.watch("temperature");
  const contextEntities = form.watch("context_entities");
  const systemPrompt = form.watch("system_prompt");
  const isPaused = form.watch("status") === "paused";

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

  if (!open) return null;

  const modelInfo = getModelInfo(selectedModel);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={handleBackdrop}
    >
      <div className="my-8 w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10">
              <Bot className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                {isEdit ? "Настройка бота" : "Новый AI-бот"}
              </h2>
              <p className="text-xs text-slate-500">
                {isEdit ? bot.name : "Модель, поведение и промпт"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={form.handleSubmit(submit)} className="space-y-5 p-6">
          {/* Name + accent */}
          <div className="grid grid-cols-[1fr_auto] gap-4">
            <div className="space-y-2">
              <label htmlFor="bot-name" className="block text-xs font-medium text-slate-400">
                Название
              </label>
              <input
                id="bot-name"
                type="text"
                {...form.register("name")}
                placeholder="Ассистент по продажам"
                className={cn(
                  "w-full rounded-lg border bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                  errors.name ? "border-rose-500" : "border-slate-700 focus:border-amber-500",
                )}
              />
              {errors.name && <p className="text-xs text-rose-400">{errors.name.message}</p>}
            </div>

            <div className="space-y-2">
              <span className="block text-xs font-medium text-slate-400">Акцент</span>
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
                      "h-6 w-6 rounded-full transition-transform",
                      accent.swatch,
                      selectedAccent === accent.value
                        ? "ring-2 ring-slate-100 ring-offset-2 ring-offset-slate-900"
                        : "opacity-50 hover:opacity-100",
                    )}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label htmlFor="bot-description" className="block text-xs font-medium text-slate-400">
              Описание
            </label>
            <input
              id="bot-description"
              type="text"
              {...form.register("description")}
              placeholder="Готовит черновики ответов на входящие запросы по сделкам"
              className={cn(
                "w-full rounded-lg border bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                errors.description ? "border-rose-500" : "border-slate-700 focus:border-amber-500",
              )}
            />
            {errors.description && (
              <p className="text-xs text-rose-400">{errors.description.message}</p>
            )}
          </div>

          {/* Model */}
          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-400">Модель</span>
            <div className="grid grid-cols-3 gap-2">
              {MODEL_CATALOG.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() =>
                    form.setValue("model", model.id, { shouldValidate: true, shouldDirty: true })
                  }
                  className={cn(
                    "rounded-lg border px-3 py-2 text-left transition-colors",
                    selectedModel === model.id
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-slate-700 bg-slate-950/50 hover:border-slate-600",
                  )}
                >
                  <span
                    className={cn(
                      "block truncate text-xs font-semibold",
                      selectedModel === model.id ? "text-amber-400" : "text-slate-300",
                    )}
                  >
                    {model.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {getProviderLabel(model.provider)}
                  </span>
                </button>
              ))}
            </div>
            {errors.model && <p className="text-xs text-rose-400">{errors.model.message}</p>}
            <p className="text-xs text-slate-600">
              Контекст {new Intl.NumberFormat("en-US", { notation: "compact" }).format(modelInfo.context_window)}{" "}
              токенов · {modelInfo.price_in_per_1k} ₽ вход / {modelInfo.price_out_per_1k} ₽ выход за 1 тыс.
            </p>
          </div>

          {/* Mode */}
          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-400">Режим</span>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() =>
                    form.setValue("mode", mode, { shouldValidate: true, shouldDirty: true })
                  }
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    selectedMode === mode
                      ? "border-amber-500 bg-amber-500/10"
                      : "border-slate-700 bg-slate-950/50 hover:border-slate-600",
                  )}
                >
                  <span className="mb-1 flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        selectedMode === mode ? "bg-amber-500" : "bg-slate-600",
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs font-semibold",
                        selectedMode === mode ? "text-amber-400" : "text-slate-300",
                      )}
                    >
                      {getBotModeLabel(mode)}
                    </span>
                  </span>
                  <span className="block text-xs leading-snug text-slate-500">
                    {getBotModeDescription(mode)}
                  </span>
                </button>
              ))}
            </div>
            {errors.mode && <p className="text-xs text-rose-400">{errors.mode.message}</p>}
          </div>

          {/* Context entities */}
          <div className="space-y-2">
            <span className="block text-xs font-medium text-slate-400">
              Сущности контекста
              <span className="ml-1.5 text-xs font-normal text-slate-600">
                подставляются на сервере для каждого запроса
              </span>
            </span>
            <div className="flex flex-wrap gap-1.5">
              {CONTEXT_ENTITIES.map((entity) => {
                const selected = contextEntities.includes(entity);
                return (
                  <button
                    key={entity}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleEntity(entity)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                      selected
                        ? "border-amber-500 bg-amber-500/10 text-amber-400"
                        : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
                    )}
                  >
                    {getContextEntityLabel(entity)}
                  </button>
                );
              })}
            </div>
            {errors.context_entities && (
              <p className="text-xs text-rose-400">{errors.context_entities.message}</p>
            )}
          </div>

          {/* Temperature + max tokens */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label htmlFor="bot-temperature" className="block text-xs font-medium text-slate-400">
                Температура
                <span className="ml-1.5 font-mono text-slate-300">{temperature.toFixed(1)}</span>
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
                className="w-full accent-amber-500"
              />
              <p className="text-xs text-slate-600">
                Меньше — предсказуемее, больше — креативнее.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="bot-max-tokens" className="block text-xs font-medium text-slate-400">
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
                  "w-full rounded-lg border bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 [-moz-appearance:textfield] focus:outline-none focus:ring-2 focus:ring-amber-500/20 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                  errors.max_tokens ? "border-rose-500" : "border-slate-700 focus:border-amber-500",
                )}
              />
              {errors.max_tokens && (
                <p className="text-xs text-rose-400">{errors.max_tokens.message}</p>
              )}
            </div>
          </div>

          {/* System prompt */}
          <PromptTemplateEditor
            value={systemPrompt}
            onChange={(next) =>
              form.setValue("system_prompt", next, { shouldValidate: true, shouldDirty: true })
            }
            contextWindow={modelInfo.context_window}
            error={errors.system_prompt?.message}
          />

          {/* Status */}
          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950/50 px-3.5 py-3">
            <input
              type="checkbox"
              checked={!isPaused}
              onChange={(event) =>
                form.setValue("status", event.target.checked ? "active" : "paused", {
                  shouldValidate: true,
                  shouldDirty: true,
                })
              }
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 accent-amber-500"
            />
            <span className="text-xs text-slate-300">
              Активировать сразу
              <span className="ml-1.5 text-slate-600">
                боты на паузе сохраняют настройки, но не работают
              </span>
            </span>
          </label>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={!isValid || isSubmitting}
              className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
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
        </form>
      </div>
    </div>
  );
}
