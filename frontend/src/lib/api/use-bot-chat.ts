"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AiBot, BotChatMessage } from "@/lib/ai-bots/ai-bots.types";
import { estimateTokens } from "@/lib/ai-bots/ai-bots.types";
import { apiClient } from "@/lib/api/apiClient";

// ---------------------------------------------------------------------------
// Пробный чат с реальным вызовом AI-агента и базы знаний RAG.
//
// Запрос уходит на backend `POST /api/v1/ai/agents/:id/test-chat`, где
// контекст ищется в реальной базе знаний агента (pgvector), подставляются
// переменные из настроек мастера, и ответ формируется подключенной LLM-моделью.
// ---------------------------------------------------------------------------

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const CHUNK_INTERVAL_MS = 22;
const CHUNK_SIZE = 4;
const FAIL_TRIGGER = "/fail";
const STREAM_ERROR_MESSAGE = "Ошибка соединения при получении ответа модели.";

interface TestChatResponse {
  reply: string;
  messages?: string[];
  tokens?: number;
  latencyMs?: number;
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
  const [messages, setMessages] = useState<BotChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Reset the transcript whenever the caller switches bot.
  useEffect(() => {
    clearTimer();
    setMessages([]);
    setIsStreaming(false);
    setError(null);
    setLastPrompt(null);
  }, [bot.id, clearTimer]);

  // Stop any in-flight stream on unmount.
  useEffect(() => clearTimer, [clearTimer]);

  const finalizeMessage = useCallback((messageId: string, tokens: number, latencyMs: number) => {
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? {
              ...message,
              streaming: false,
              tokens,
              latency_ms: latencyMs,
            }
          : message,
      ),
    );
    setIsStreaming(false);
  }, []);

  const failMessage = useCallback((messageId: string, errorText?: string) => {
    const msg = errorText || STREAM_ERROR_MESSAGE;
    setMessages((prev) =>
      prev.map((message) =>
        message.id === messageId
          ? { ...message, streaming: false, error: msg }
          : message,
      ),
    );
    setError(msg);
    setIsStreaming(false);
  }, []);

  /** Streams `reply` into an existing assistant message, chunk by chunk. */
  const runStream = useCallback(
    (messageId: string, reply: string, tokens: number, latencyMs: number) => {
      let cursor = 0;

      const pushChunk = () => {
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
          finalizeMessage(messageId, tokens, latencyMs);
          return;
        }

        timerRef.current = setTimeout(pushChunk, CHUNK_INTERVAL_MS);
      };

      timerRef.current = setTimeout(pushChunk, 40);
    },
    [finalizeMessage],
  );

  /** Appends an empty assistant message and sends query to real backend test-chat. */
  const startAssistantReply = useCallback(
    (promptText: string, shouldFail: boolean) => {
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

      if (shouldFail) {
        setTimeout(() => {
          failMessage(assistantMessage.id, "Искусственный сбой по команде /fail");
        }, 500);
        return;
      }

      // Подготавливаем историю последних сообщений
      const historyPayload = messages.slice(-6).map((m) => ({
        role: (m.source === "human" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));

      apiClient
        .post<TestChatResponse>(`/api/v1/ai/agents/${bot.id}/test-chat`, {
          message: promptText,
          history: historyPayload,
        })
        .then((res) => {
          const reply = res.data?.reply || "Агент не сформировал текстовый ответ.";
          const tokens = res.data?.tokens ?? estimateTokens(reply);
          const latency = res.data?.latencyMs ?? 450;
          runStream(assistantMessage.id, reply, tokens, latency);
        })
        .catch((err: unknown) => {
          const errMsg = err instanceof Error ? err.message : "Не удалось получить ответ от агента";
          failMessage(assistantMessage.id, errMsg);
        });
    },
    [bot.id, messages, failMessage, runStream],
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
      startAssistantReply(trimmed, trimmed.startsWith(FAIL_TRIGGER));
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
              content: message.content.length > 0 ? message.content : "(генерация остановлена)",
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
    startAssistantReply(lastPrompt, false);
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
