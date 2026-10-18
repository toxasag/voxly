"use client";

import { memo, useEffect, useRef } from "react";
import {
  AlertTriangle,
  Bot,
  Info,
  MessageSquare,
  RefreshCw,
  Trash2,
  User,
} from "lucide-react";
import type { AiBot, BotChatMessage, ChatMessageSource } from "@/lib/ai-bots/ai-bots.types";
import { getAccentClasses } from "@/lib/ai-bots/ai-bots.types";
import { BotChatInput } from "@/components/ai-bots/BotChatInput";
import { EmptyState } from "@/components/shared/EmptyState";
import { useBotChat } from "@/lib/api/use-bot-chat";
import { cn } from "@/lib/utils";

interface BotChatProps {
  bot: AiBot;
}

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(
    new Date(iso),
  );
}

const SOURCE_LABELS: Record<ChatMessageSource, string> = {
  human: "Вы",
  ai: "AI",
  system: "Система",
  ai_bot: "Бот",
};

const SOURCE_BADGE: Record<ChatMessageSource, string> = {
  human: "border-slate-700 bg-slate-800 text-slate-400",
  ai: "border-sky-500/30 bg-sky-500/10 text-sky-400",
  system: "border-slate-700 bg-slate-800/60 text-slate-500",
  ai_bot: "border-orange-400/30 bg-orange-400/10 text-orange-400",
};

// ---------------------------------------------------------------------------
// Single message row
// ---------------------------------------------------------------------------

interface MessageRowProps {
  message: BotChatMessage;
  bot: AiBot;
}

const MessageRow = memo(function MessageRow({ message, bot }: MessageRowProps) {
  const isHuman = message.source === "human";
  const isSystem = message.source === "system";

  if (isSystem) {
    return (
      <div className="flex items-start gap-2 px-2">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600" />
        <p className="text-xs italic leading-relaxed text-slate-600">{message.content}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3", isHuman && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          isHuman ? "bg-slate-800 text-slate-400" : getAccentClasses(bot.accent),
        )}
      >
        {isHuman ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>

      <div className={cn("min-w-0 max-w-[80%]", isHuman && "items-end")}>
        {/* Meta */}
        <div className={cn("mb-1 flex items-center gap-1.5", isHuman && "justify-end")}>
          <span className="text-xs font-medium text-slate-400">
            {isHuman ? SOURCE_LABELS.human : bot.name}
          </span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide",
              SOURCE_BADGE[message.source],
            )}
          >
            {SOURCE_LABELS[message.source]}
          </span>
          <span className="text-xs text-slate-600">{formatTime(message.created_at)}</span>
        </div>

        {/* Bubble */}
        <div
          className={cn(
            "rounded-xl border px-3.5 py-2.5",
            isHuman
              ? "border-slate-700 bg-slate-800/60"
              : message.error !== null
                ? "border-rose-500/30 bg-rose-500/5"
                : "border-slate-800 bg-slate-950/60",
          )}
        >
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200">
            {message.content}
            {message.streaming && (
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-amber-400 align-middle" />
            )}
          </p>

          {message.error !== null && (
            <div className="mt-2 flex items-start gap-1.5 border-t border-rose-500/20 pt-2">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
              <p className="text-xs text-rose-400">{message.error}</p>
            </div>
          )}
        </div>

        {/* Footer stats */}
        {!message.streaming && (message.tokens !== null || message.latency_ms !== null) && (
          <div className={cn("mt-1 flex items-center gap-2 px-1", isHuman && "justify-end")}>
            {message.tokens !== null && (
              <span className="text-xs text-slate-600">{message.tokens} tok</span>
            )}
            {message.latency_ms !== null && (
              <span className="text-xs text-slate-600">{message.latency_ms} ms</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Chat panel
// ---------------------------------------------------------------------------

export function BotChat({ bot }: BotChatProps) {
  const { messages, isStreaming, error, lastPrompt, sendMessage, stopGeneration, regenerate, clearChat } =
    useBotChat(bot);

  const scrollRef = useRef<HTMLDivElement>(null);
  const isPaused = bot.status === "paused";

  // Keep the newest message in view as chunks arrive.
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  return (
    <div className="flex h-[calc(100vh-13rem)] flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-slate-500" />
          <span className="text-sm font-semibold text-slate-200">Чат</span>
          {isStreaming && (
            <span className="flex items-center gap-1.5 rounded-full border border-[#4a38f5]/30 bg-[#4a38f5]/10 px-2 py-0.5 text-xs font-medium text-amber-400">
              <span className="flex gap-0.5">
                <span className="h-1 w-1 animate-bounce rounded-full bg-amber-400 [animation-delay:0ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-amber-400 [animation-delay:120ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-amber-400 [animation-delay:240ms]" />
              </span>
              печатает
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {lastPrompt !== null && !isStreaming && (
            <button
              type="button"
              onClick={regenerate}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
            >
              <RefreshCw className="h-3 w-3" />
              Сгенерировать заново
            </button>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-800 hover:text-rose-400"
            >
              <Trash2 className="h-3 w-3" />
              Очистить
            </button>
          )}
        </div>
      </div>

      {/* Connection error banner */}
      {error !== null && (
        <div className="flex items-center justify-between gap-3 border-b border-rose-500/20 bg-rose-500/5 px-4 py-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
            <p className="text-xs text-rose-400">{error}</p>
          </div>
          <button
            type="button"
            onClick={regenerate}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-xs font-semibold text-rose-400 transition-colors hover:bg-rose-500/20"
          >
            <RefreshCw className="h-3 w-3" />
            Сгенерировать заново
          </button>
        </div>
      )}

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="Сообщений пока нет"
            description={`Отправьте промпт, чтобы увидеть ответ бота ${bot.name}. Переписка не сохраняется, пока не подключён серверный эндпоинт чата.`}
          />
        ) : (
          messages.map((message) => <MessageRow key={message.id} message={message} bot={bot} />)
        )}
      </div>

      {/* Input */}
      <BotChatInput
        disabled={isPaused}
        isStreaming={isStreaming}
        onSend={sendMessage}
        onStop={stopGeneration}
      />
    </div>
  );
}
