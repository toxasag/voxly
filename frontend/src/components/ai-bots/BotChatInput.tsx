"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Send, Square, Loader2 } from "lucide-react";
import { estimateTokens } from "@/lib/ai-bots/ai-bots.types";
import { botChatInputSchema } from "@/schemas/ai-bot.schema";
import { cn } from "@/lib/utils";

interface BotChatInputProps {
  disabled: boolean;
  isStreaming: boolean;
  onSend: (content: string) => void;
  onStop: () => void;
}

const MAX_LENGTH = 4000;
const WARN_THRESHOLD = 0.9;

export const BotChatInput = memo(function BotChatInput({
  disabled,
  isStreaming,
  onSend,
  onStop,
}: BotChatInputProps) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea with its content, capped so the transcript stays visible.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  const submit = useCallback(() => {
    const parsed = botChatInputSchema.safeParse({ content: value });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Некорректное сообщение");
      return;
    }

    setError(null);
    onSend(parsed.data.content);
    setValue("");
  }, [onSend, value]);

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      submit();
    },
    [submit],
  );

  // Enter sends, Shift+Enter inserts a newline.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!disabled && !isStreaming) submit();
      }
    },
    [disabled, isStreaming, submit],
  );

  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
    setError(null);
  }, []);

  const isNearLimit = value.length > MAX_LENGTH * WARN_THRESHOLD;
  const canSend = value.trim().length > 0 && !disabled && !isStreaming;

  return (
    <form onSubmit={handleSubmit} className="border-t border-slate-800 bg-slate-900 p-4">
      <div
        className={cn(
          "flex items-end gap-2 rounded-lg border bg-slate-950 px-3 py-2.5 transition-colors",
          error ? "border-rose-500" : "border-slate-700 focus-within:border-[#4a38f5]",
        )}
      >
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          maxLength={MAX_LENGTH}
          disabled={disabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? "Бот на паузе — активируйте его, чтобы начать чат"
              : "Спросите бота… (Enter — отправить, Shift+Enter — новая строка)"
          }
          aria-label="Сообщение"
          className="max-h-40 flex-1 resize-none bg-transparent text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none disabled:cursor-not-allowed disabled:text-slate-600"
        />

        {isStreaming ? (
          <button
            type="button"
            onClick={onStop}
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-400 transition-colors hover:bg-rose-500/20"
          >
            <Square className="h-3 w-3" />
            Остановить
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            aria-label="Отправить сообщение"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4a38f5] text-white transition-colors hover:bg-[#3b2be0] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {disabled ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center justify-between px-1">
        {error ? (
          <p className="text-xs text-rose-400">{error}</p>
        ) : (
          <p className="text-xs text-slate-600">
            ~{new Intl.NumberFormat("ru-RU").format(estimateTokens(value))} токенов
          </p>
        )}
        <p className={cn("text-xs", isNearLimit ? "text-amber-400" : "text-slate-600")}>
          {value.length} / {MAX_LENGTH}
        </p>
      </div>
    </form>
  );
});
