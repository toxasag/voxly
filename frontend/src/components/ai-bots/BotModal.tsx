"use client";

import { useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Bot, Loader2, Save, Sparkles } from "lucide-react";
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
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface BotModalProps {
  open: boolean;
  /** Pass a bot to edit it; omit to create a new one. */
  bot?: AiBot | null;
  onClose: () => void;
  onSubmit: (payload: CreateBotPayload) => Promise<void> | void;
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

  // Re-seed the form whenever the modal opens or the target bot changes.
  useEffect(() => {
    if (!open) return;
    form.reset(bot !== null ? toFormValues(bot) : DEFAULT_VALUES);
  }, [open, bot, form]);

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
    <Sheet open={open} onClose={onClose} width="w-[620px]" resizable>
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
              {isEdit ? bot.name : "Модель, поведение и промпт"}
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
                placeholder="Готовит черновики ответов на входящие запросы по сделкам"
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
              <span className="block text-xs font-medium text-slate-700">Модель</span>
              <div className="grid grid-cols-3 gap-2">
                {MODEL_CATALOG.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() =>
                      form.setValue("model", model.id, { shouldValidate: true, shouldDirty: true })
                    }
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer",
                      selectedModel === model.id
                        ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white hover:bg-slate-50",
                    )}
                  >
                    <span
                      className={cn(
                        "block truncate text-xs font-semibold",
                        selectedModel === model.id ? "text-[#4a38f5]" : "text-slate-900",
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
              {errors.model && <p className="text-xs text-rose-500">{errors.model.message}</p>}
              <p className="text-xs text-slate-500">
                Контекст {new Intl.NumberFormat("en-US", { notation: "compact" }).format(modelInfo.context_window)}{" "}
                токенов · {modelInfo.price_in_per_1k} ₽ вход / {modelInfo.price_out_per_1k} ₽ выход за 1 тыс.
              </p>
            </div>

            {/* Mode */}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-700">Режим</span>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      form.setValue("mode", mode, { shouldValidate: true, shouldDirty: true })
                    }
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors cursor-pointer",
                      selectedMode === mode
                        ? "border-[#4a38f5] bg-[#4a38f5]/5"
                        : "border-[#e5e5e5] bg-white hover:bg-slate-50",
                    )}
                  >
                    <span className="mb-1 flex items-center gap-1.5">
                      <span
                        className={cn(
                          "h-2 w-2 rounded-full",
                          selectedMode === mode ? "bg-[#4a38f5]" : "bg-slate-300",
                        )}
                      />
                      <span
                        className={cn(
                          "text-xs font-semibold",
                          selectedMode === mode ? "text-[#4a38f5]" : "text-slate-900",
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
              {errors.mode && <p className="text-xs text-rose-500">{errors.mode.message}</p>}
            </div>

            {/* Context entities */}
            <div className="space-y-1.5">
              <span className="block text-xs font-medium text-slate-700">
                Сущности контекста
                <span className="ml-1.5 text-xs font-normal text-slate-500">
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
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
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
                  <span className="ml-1.5 font-mono text-slate-900">{temperature.toFixed(1)}</span>
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
                <p className="text-xs text-slate-500">
                  Меньше — предсказуемее, больше — креативнее.
                </p>
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
              <span className="text-xs text-slate-800">
                Активировать сразу
                <span className="ml-1.5 text-slate-500">
                  боты на паузе сохраняют настройки, но не работают
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
              disabled={!isValid || isSubmitting}
              className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-50"
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
      </SheetContent>
    </Sheet>
  );
}
