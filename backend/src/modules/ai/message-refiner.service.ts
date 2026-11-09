import {
  GatewayChatProvider,
  type ChatProvider,
} from "../../services/chat.service.js";
import { aiTraceLogger } from "./ai-trace-logger.js";
import { findSentenceBoundary } from "./agent-reply.js";

export type MessageRefinerChannelType = "telegram" | "whatsapp" | "max" | "widget";

export interface MessageCorrectionInput {
  originalMessage: string;
  channelLimit: number;
  channelType: MessageRefinerChannelType;
  contextBrief?: string;
  tenantId: string;
}

export interface MessageCorrectionOutput {
  refinedMessage: string;
  bypass: boolean;
  latencyMs: number;
  tokensIn: number;
  tokensOut: number;
}

export const CHANNEL_LIMITS: Record<MessageRefinerChannelType, number> = {
  telegram: 4096,
  whatsapp: 4096,
  max: 4096,
  widget: 2048,
};

export function normalizeChannelType(channel?: string): MessageRefinerChannelType {
  if (!channel) return "widget";
  const lower = channel.toLowerCase();
  if (lower.includes("telegram")) return "telegram";
  if (lower.includes("whatsapp")) return "whatsapp";
  if (lower.includes("max")) return "max";
  return "widget";
}

export function getChannelLimit(channelType: MessageRefinerChannelType): number {
  return CHANNEL_LIMITS[channelType] ?? 2048;
}

/**
 * Проверяет, является ли текст логически и синтаксически завершенным
 * (заканчивается знаком препинания, скобкой или кавычкой, без висячих союзов/многоточий).
 */
export function isCompletedText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return true;

  // Висячие многоточия, запятые, двоеточия, тире свидетельствуют об обрыве мысли
  if (
    trimmed.endsWith("...") ||
    trimmed.endsWith("…") ||
    trimmed.endsWith(",") ||
    trimmed.endsWith(":") ||
    trimmed.endsWith(";") ||
    trimmed.endsWith("-") ||
    trimmed.endsWith("—")
  ) {
    return false;
  }

  // Завершающие знаки: ., !, ?, ), », ", '
  const lastChar = trimmed[trimmed.length - 1];
  if (lastChar && [".", "!", "?", ")", "»", '"', "'"].includes(lastChar)) {
    return true;
  }

  return true;
}

export class MessageRefinerService {
  private readonly chat: ChatProvider;
  private readonly defaultTimeoutMs: number;

  constructor(chat?: ChatProvider, timeoutMs: number = 2500) {
    this.chat = chat ?? new GatewayChatProvider();
    this.defaultTimeoutMs = timeoutMs;
  }

  /**
   * Корректирует и сжимает сообщение под лимит канала с помощью LLM-редактора (Critic/Refiner).
   * Если сообщение укладывается в лимит и синтаксически завершено — мгновенный bypass (0ms).
   * При превышении лимита или обрыве — 1 быстрый проход через gemini-3.5-flash-lite.
   * При сбое или таймауте — graceful fallback без сбоя в пайплайне.
   */
  async refineMessage(input: MessageCorrectionInput): Promise<MessageCorrectionOutput> {
    const startedAt = Date.now();
    const original = input.originalMessage.trim();
    const limit = input.channelLimit > 0 ? input.channelLimit : getChannelLimit(input.channelType);

    // 1. Pre-check bypass: сообщение укладывается в лимит и логически завершено
    if (original.length <= limit && isCompletedText(original)) {
      const result: MessageCorrectionOutput = {
        refinedMessage: original,
        bypass: true,
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
      };

      aiTraceLogger.traceEvent("ai:message_corrected", {
        tenantId: input.tenantId,
        channelType: input.channelType,
        channelLimit: limit,
        originalLength: original.length,
        refinedLength: original.length,
        latencyMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        bypass: true,
      });

      return result;
    }

    // 2. Refiner LLM call: сжатие сообщения через быструю модель (1 проход, без рекурсии)
    try {
      const systemPrompt = `
Ты — AI-редактор и критик сообщений (Message Refiner) в B2B CRM платформе GETVOXLY.
Твоя задача — сжато и точно переформулировать ответ агента для мессенджера/чата, уложив его строго в лимит символов.

ПРАВИЛА РЕДАКТИРОВАНИЯ:
1. ЛИМИТ ДЛИНЫ: Длина итогового текста должна быть СТРОГО МЕНЬШЕ ИЛИ РАВНА ${limit} символов.
2. СОХРАНЕНИЕ СУТИ И CTA: Сохрани ключевой смысл, все важные факты, цены/сроки (если есть) и призыв к действию/вопрос клиенту в конце.
3. ЕСТЕСТВЕННЫЙ ЖИВОЙ ТОН: Пиши как живой вежливый специалист в мессенджере. Никакого нейрослопа, канцелярщины и шаблонов.
4. ЗАПРЕТ ПРЕАМБУЛ: Категорически запрещено добавлять вводные слова («Вот исправленный вариант:», «Конечно!», «Сократил:»). Верни ТОЛЬКО текст сообщения.
5. ЗАВЕРШЕННОСТЬ: Сообщение обязано заканчиваться грамматически завершенным предложением со знаком препинания (. ! ?). Никаких обрывов на полуслове и многоточий.
6. ЯЗЫК: Отвечай на том же языке, на котором написано исходное сообщение.
`.trim();

      const userPrompt = `
ЛИМИТ СИМВОЛОВ: ${limit}
КАНАЛ: ${input.channelType}
${input.contextBrief ? `КОНТЕКСТ ДИАЛОГА: ${input.contextBrief}\n` : ""}
ИСХОДНОЕ СООБЩЕНИЕ:
${original}
`.trim();

      // Максимальный таймаут через Promise.race
      const completionPromise = this.chat.complete({
        model: "gemini-3.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.1,
        maxTokens: Math.min(2048, Math.max(256, Math.ceil(limit / 2))),
        tenantId: input.tenantId,
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`MessageRefiner timed out after ${this.defaultTimeoutMs}ms`));
        }, this.defaultTimeoutMs);
        if (typeof timer.unref === "function") timer.unref();
      });

      const completion = await Promise.race([completionPromise, timeoutPromise]);
      const latencyMs = Math.max(1, Date.now() - startedAt);

      // Очистка ответа от случайных markdown-обёрток и кавычек
      let refinedText = completion.content
        .replace(/^```[a-z]*\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      if (
        (refinedText.startsWith('"') && refinedText.endsWith('"')) ||
        (refinedText.startsWith('«') && refinedText.endsWith('»'))
      ) {
        refinedText = refinedText.slice(1, -1).trim();
      }

      // Страховка от превышения лимита моделью
      if (refinedText.length > limit) {
        const boundary = findSentenceBoundary(refinedText.slice(0, limit));
        if (boundary > 0) {
          refinedText = refinedText.slice(0, boundary + 1).trim();
        } else {
          refinedText = refinedText.slice(0, limit).trim();
        }
      }

      // Страховка от незавершённого предложения
      if (!isCompletedText(refinedText)) {
        refinedText = `${refinedText}.`;
      }

      const result: MessageCorrectionOutput = {
        refinedMessage: refinedText,
        bypass: false,
        latencyMs,
        tokensIn: completion.tokensIn ?? 0,
        tokensOut: completion.tokensOut ?? 0,
      };

      aiTraceLogger.traceEvent("ai:message_corrected", {
        tenantId: input.tenantId,
        channelType: input.channelType,
        channelLimit: limit,
        originalLength: original.length,
        refinedLength: refinedText.length,
        latencyMs,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        bypass: false,
      });

      return result;
    } catch (err) {
      // 3. Graceful fallback при ошибке или таймауте LLM
      const latencyMs = Math.max(1, Date.now() - startedAt);
      let fallbackText = original;

      if (fallbackText.length > limit) {
        const boundary = findSentenceBoundary(fallbackText.slice(0, limit));
        if (boundary > 0) {
          fallbackText = fallbackText.slice(0, boundary + 1).trim();
        } else {
          const lastSpace = fallbackText.slice(0, limit).lastIndexOf(" ");
          if (lastSpace > 0) {
            fallbackText = fallbackText.slice(0, lastSpace).trim();
          } else {
            fallbackText = fallbackText.slice(0, limit).trim();
          }
        }
      }

      if (!isCompletedText(fallbackText)) {
        fallbackText = `${fallbackText}.`;
      }

      const result: MessageCorrectionOutput = {
        refinedMessage: fallbackText,
        bypass: false,
        latencyMs,
        tokensIn: 0,
        tokensOut: 0,
      };

      aiTraceLogger.traceEvent("ai:message_corrected", {
        tenantId: input.tenantId,
        channelType: input.channelType,
        channelLimit: limit,
        originalLength: original.length,
        refinedLength: fallbackText.length,
        latencyMs,
        tokensIn: 0,
        tokensOut: 0,
        bypass: false,
        fallback: true,
        error: err instanceof Error ? err.message : String(err),
      });

      return result;
    }
  }
}

export const messageRefiner = new MessageRefinerService();
