"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiBot, BotChatMessage } from "@/lib/ai-bots/ai-bots.types";
import { estimateTokens } from "@/lib/ai-bots/ai-bots.types";
// ---------------------------------------------------------------------------
// Демонстрационный поток пробного чата.
//
// Рабочая реализация подпишется на SSE `POST /ai-bots/:id/chat` (M4.2.4) и будет
// дописывать каждый `chunk` в последнее сообщение ассистента. Пока ключа
// LLM-провайдера на платформе нет, тот же конечный автомат управляется таймером —
// это позволяет проверить индикатор набора, остановку и повтор при ошибке.
//
// Интерфейс прямо предупреждает, что режим демонстрационный (см. страницу
// агента): показывать выдуманные ответы как настоящие было бы обманом.
//
// Заготовки ответов лежат здесь, а не в `lib/ai-bots/`: это фикстуры одного
// экрана, и в домене агентов, который теперь работает на реальных данных, им
// места нет. Прежний `mock-ai-bots.ts` удалён вместе с захардкоженными ботами.
//
// `/fail` в начале сообщения обрывает поток — проверка пути «соединение
// потеряно» (M4.1.13).
// ---------------------------------------------------------------------------

/** Пустая история: переписка появится вместе с реальным чатом. */
function getBotChatHistory(_botId: string): BotChatMessage[] {
  return [];
}

const DEMO_REPLIES: string[] = [
  "Понял задачу. Судя по истории сделки, клиента беспокоит окно миграции. Я бы уточнил, что переключение проходит в выходные, а старая система две недели остаётся доступной для чтения. Подготовить такой ответ?",
  "Предлагаю ответить так:\n\nДобрый день! Описанный объём укладывается в стандартный пакет. Срок — 3–4 недели с даты договора, первые две недели поддержки после запуска входят в стоимость. Могу прислать подробную смету сегодня — оформить на бухгалтерию?",
  "Сводка по запросу:\n• Клиенту нужна интеграция со складской системой\n• Ожидаемый срок — конец квартала\n• Лицо, принимающее решение, не выявлено\n\nСледующий шаг: выяснить, кто утверждает бюджет, до отправки сметы.",
  "Заказ-наряд в диагностике. Мастер обнаружил окисление на плате питания — этим объясняются самопроизвольные отключения. Замена платы стоит 8 400 ₽ и занимает два рабочих дня после поступления детали. Сообщить клиенту и запросить согласование?",
];

const FIRST_CHUNK_DELAY_MS = 420;
const CHUNK_INTERVAL_MS = 28;
const CHUNK_SIZE = 3;
const FAIL_TRIGGER = "/fail";
const STREAM_ERROR_MESSAGE = "Connection lost while streaming the response.";

function pickReply(seed: number): string {
  const reply = DEMO_REPLIES[seed % DEMO_REPLIES.length];
  return reply ?? DEMO_REPLIES[0] ?? "";
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

interface UseBotChatResult {
  messages: BotChatMessage[];
  isStreaming: boolean;
  error: string | null;
  /** Content of the last user prompt — used by Regenerate. */
  lastPrompt: string | null;
  sendMessage: (content: string) => void;
  stopGeneration: () => void;
  regenerate: () => void;
  clearChat: () => void;
}

export function useBotChat(bot: AiBot): UseBotChatResult {
  const [messages, setMessages] = useState<BotChatMessage[]>(() => getBotChatHistory(bot.id));
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replySeedRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Reset the transcript whenever the caller switches bot.
  useEffect(() => {
    clearTimer();
    setMessages(getBotChatHistory(bot.id));
    setIsStreaming(false);
    setError(null);
    setLastPrompt(null);
  }, [bot.id, clearTimer]);

  // Stop any in-flight stream on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  const finalizeMessage = useCallback((messageId: string, latencyMs: number) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? {
              ...message,
              streaming: false,
              tokens: estimateTokens(message.content),
              latency_ms: latencyMs,
            }
          : message,
      ),
    );
    setIsStreaming(false);
  }, []);

  const failMessage = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? { ...message, streaming: false, error: STREAM_ERROR_MESSAGE }
          : message,
      ),
    );
    setError(STREAM_ERROR_MESSAGE);
    setIsStreaming(false);
  }, []);

  /** Streams `reply` into an existing assistant message, chunk by chunk. */
  const runStream = useCallback(
    (messageId: string, reply: string, shouldFail: boolean) => {
      const startedAt = Date.now();
      const failAt = shouldFail ? Math.floor(reply.length * 0.4) : -1;
      let cursor = 0;

      const pushChunk = () => {
        if (shouldFail && cursor >= failAt) {
          failMessage(messageId);
          return;
        }

        const next = reply.slice(cursor, cursor + CHUNK_SIZE);
        cursor += CHUNK_SIZE;

        setMessages((prev) =>
          prev.map((message) =>
            message.id === messageId
              ? { ...message, content: message.content + next }
              : message,
          ),
        );

        if (cursor >= reply.length) {
          finalizeMessage(messageId, Date.now() - startedAt);
          return;
        }

        timerRef.current = setTimeout(pushChunk, CHUNK_INTERVAL_MS);
      };

      timerRef.current = setTimeout(pushChunk, FIRST_CHUNK_DELAY_MS);
    },
    [failMessage, finalizeMessage],
  );

  /** Appends an empty assistant message and starts streaming into it. */
  const startAssistantReply = useCallback(
    (shouldFail: boolean) => {
      const assistantMessage: BotChatMessage = {
        id: makeId("msg-ai"),
        bot_id: bot.id,
        source: "ai_bot",
        content: "",
        created_at: new Date().toISOString(),
        tokens: null,
        latency_ms: null,
        streaming: true,
        error: null,
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setIsStreaming(true);
      setError(null);

      const reply = pickReply(replySeedRef.current);
      replySeedRef.current += 1;
      runStream(assistantMessage.id, reply, shouldFail);
    },
    [bot.id, runStream],
  );

  const sendMessage = useCallback(
    (content: string) => {
      const trimmed = content.trim();
      if (trimmed.length === 0 || isStreaming) return;

      clearTimer();

      const userMessage: BotChatMessage = {
        id: makeId("msg-human"),
        bot_id: bot.id,
        source: "human",
        content: trimmed,
        created_at: new Date().toISOString(),
        tokens: estimateTokens(trimmed),
        latency_ms: null,
        streaming: false,
        error: null,
      };

      setMessages((prev) => [...prev, userMessage]);
      setLastPrompt(trimmed);
      startAssistantReply(trimmed.startsWith(FAIL_TRIGGER));
    },
    [bot.id, clearTimer, isStreaming, startAssistantReply],
  );

  const stopGeneration = useCallback(() => {
    clearTimer();
    setMessages((prev) =>
      prev.map((message) =>
        message.streaming
          ? {
              ...message,
              streaming: false,
              tokens: estimateTokens(message.content),
              content: message.content.length > 0 ? message.content : "(generation stopped)",
            }
          : message,
      ),
    );
    setIsStreaming(false);
  }, [clearTimer]);

  const regenerate = useCallback(() => {
    if (isStreaming || lastPrompt === null) return;

    clearTimer();
    // Drop the failed / previous assistant turn, then stream a fresh one.
    setMessages((prev) => {
      const lastIndex = prev.length - 1;
      const last = prev[lastIndex];
      if (last && (last.source === "ai_bot" || last.source === "ai")) {
        return prev.slice(0, lastIndex);
      }
      return prev;
    });
    setError(null);
    startAssistantReply(false);
  }, [clearTimer, isStreaming, lastPrompt, startAssistantReply]);

  const clearChat = useCallback(() => {
    clearTimer();
    setMessages([]);
    setIsStreaming(false);
    setError(null);
    setLastPrompt(null);
  }, [clearTimer]);

  return {
    messages,
    isStreaming,
    error,
    lastPrompt,
    sendMessage,
    stopGeneration,
    regenerate,
    clearChat,
  };
}
