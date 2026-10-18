"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  Bot,
  Check,
  CheckCheck,
  Clock,
  Code,
  CornerDownLeft,
  Link2,
  Loader2,
  MessageCircle,
  Pause,
  Play,
  PowerOff,
  Quote,
  Send,
  Smile,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn, timeAgo } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import {
  useCrmChat,
  type ChatMessageDTO,
  type CrmChatEntityType,
  type SendFromOptionDTO,
} from "@/lib/api/use-crm-chat";

export interface CrmChatViewProps {
  entityType: CrmChatEntityType;
  entityId: string;
  entityName?: string;
  className?: string;
}

const POPULAR_EMOJIS = [
  "👍", "👋", "🤝", "✅", "🙏", "🕒", "📦", "💼", "📞", "💬", "🚀", "💡", "💳", "📍", "❌"
];

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

function formatDateHeader(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const today = new Date();
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();

    if (isToday) return "Сегодня";

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return "Вчера";

    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

export function CrmChatView({
  entityType,
  entityId,
  entityName,
  className,
}: CrmChatViewProps) {
  const {
    messagesQuery,
    sendFromOptionsQuery,
    aiStatusQuery,
    sendMessageMutation,
    aiControlMutation,
    aiDraftMutation,
  } = useCrmChat({ entityType, entityId, live: true });

  const [input, setInput] = useState("");
  const [selectedChannelAccountId, setSelectedChannelAccountId] = useState<string>("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const messages = messagesQuery.data ?? [];
  const sendFromOptions = sendFromOptionsQuery.data ?? [];
  const aiStatus = aiStatusQuery.data;

  // Автоматический выбор первого доступного аккаунта отправки
  useEffect(() => {
    if (sendFromOptions.length === 0) return;
    if (selectedChannelAccountId && sendFromOptions.some((o) => o.channelAccountId === selectedChannelAccountId)) {
      return;
    }
    const defaultAvailable = sendFromOptions.find((o) => o.isDefault && o.available);
    if (defaultAvailable) {
      setSelectedChannelAccountId(defaultAvailable.channelAccountId);
      return;
    }
    const firstAvailable = sendFromOptions.find((o) => o.available);
    if (firstAvailable) {
      setSelectedChannelAccountId(firstAvailable.channelAccountId);
    } else {
      setSelectedChannelAccountId(sendFromOptions[0]?.channelAccountId ?? "");
    }
  }, [sendFromOptions, selectedChannelAccountId]);

  // Автоскролл к низу переписки при открытии или получении сообщений
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const selectedOption: SendFromOptionDTO | undefined = useMemo(() => {
    return sendFromOptions.find((o) => o.channelAccountId === selectedChannelAccountId);
  }, [sendFromOptions, selectedChannelAccountId]);

  // Отправка сообщения
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sendMessageMutation.isPending) return;

    const channel = selectedOption?.channel ?? "telegram";
    const channelAccountId = selectedOption?.channelAccountId;

    try {
      await sendMessageMutation.mutateAsync({
        content: text,
        channel,
        channel_account_id: channelAccountId || undefined,
        source: "manager",
        direction: "outbound",
      });
      setInput("");
      setShowEmojiPicker(false);
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отправить сообщение");
    }
  }, [input, sendMessageMutation, selectedOption]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  // Вызов AI-Copilot (генерация подсказки/черновика ответа)
  const handleGenerateAiDraft = useCallback(async () => {
    try {
      const res = await aiDraftMutation.mutateAsync();
      if (res?.draft) {
        setInput(res.draft);
        toast.success("Черновик ответа подготовлен AI-ассистентом");
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
        }
      } else {
        toast.error("Не удалось сформировать черновик");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка работы AI Copilot");
    }
  }, [aiDraftMutation]);

  // Управление автопилотом AI
  const handleAiAction = useCallback(
    async (action: "enable" | "pause" | "disable") => {
      try {
        await aiControlMutation.mutateAsync({ action });
        if (action === "enable") {
          toast.success("AI-автопилот активирован");
        } else if (action === "pause") {
          toast.info("AI-автопилот приостановлен на 1 час");
        } else {
          toast.info("AI-автопилот выключен");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось изменить статус AI");
      }
    },
    [aiControlMutation],
  );

  // Вставка markdown-разметки
  const insertFormatting = useCallback((prefix: string, suffix: string = "") => {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = input.substring(start, end);
    const next = input.substring(0, start) + prefix + selected + suffix + input.substring(end);
    setInput(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, end + prefix.length);
    }, 0);
  }, [input]);

  const insertEmoji = useCallback((emoji: string) => {
    const el = textareaRef.current;
    if (!el) {
      setInput((prev) => prev + emoji);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = input.substring(0, start) + emoji + input.substring(end);
    setInput(next);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + emoji.length, start + emoji.length);
    }, 0);
  }, [input]);

  // Группировка сообщений по датам
  const groupedMessages = useMemo(() => {
    const groups: { dateLabel: string; items: ChatMessageDTO[] }[] = [];
    let currentDateLabel = "";
    let currentBucket: ChatMessageDTO[] = [];

    for (const msg of messages) {
      const label = formatDateHeader(msg.createdAt);
      if (label !== currentDateLabel) {
        if (currentBucket.length > 0) {
          groups.push({ dateLabel: currentDateLabel, items: currentBucket });
        }
        currentDateLabel = label;
        currentBucket = [msg];
      } else {
        currentBucket.push(msg);
      }
    }

    if (currentBucket.length > 0) {
      groups.push({ dateLabel: currentDateLabel, items: currentBucket });
    }

    return groups;
  }, [messages]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-white text-[#111111]", className)}>
      {/* Шапка: статус AI-автопилота и управление */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#e5e5e5] bg-white px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {aiStatus?.aiControl === "enabled" && !aiStatus.isPaused ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
                </>
              ) : aiStatus?.isPaused ? (
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              ) : (
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#888888]" />
              )}
            </span>
            <span className="text-xs font-medium text-[#111111]">
              {aiStatus?.aiControl === "enabled" && !aiStatus.isPaused ? (
                <span className="text-emerald-700 font-semibold">AI Автопилот активен</span>
              ) : aiStatus?.isPaused ? (
                <span className="text-amber-700">
                  AI на паузе {aiStatus.pausedUntil ? `до ${formatTime(aiStatus.pausedUntil)}` : ""} (ручной перехват)
                </span>
              ) : (
                <span className="text-[#666666]">AI Автопилот выключен</span>
              )}
            </span>
          </div>
        </div>

        {/* Кнопки переключения режима AI */}
        <div className="flex items-center gap-1.5">
          {aiStatus?.aiControl === "enabled" && !aiStatus.isPaused ? (
            <>
              <button
                type="button"
                onClick={() => handleAiAction("pause")}
                disabled={aiControlMutation.isPending}
                title="Приостановить автоответчик на 1 час (оператор перехватывает диалог)"
                className="inline-flex items-center gap-1.5 rounded-md border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-[#111111] disabled:opacity-50"
              >
                <Pause className="h-3 w-3 text-amber-600" />
                <span>Пауза на 1 ч</span>
              </button>
              <button
                type="button"
                onClick={() => handleAiAction("disable")}
                disabled={aiControlMutation.isPending}
                title="Полностью отключить автоответчик по этой сделке/контакту"
                className="inline-flex items-center rounded-md border border-[#e5e5e5] bg-white p-1 text-[#888888] transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              >
                <PowerOff className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleAiAction("enable")}
              disabled={aiControlMutation.isPending}
              title="Включить AI-автопилот"
              className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>Включить AI</span>
            </button>
          )}
        </div>
      </div>

      {/* Список сообщений диалога */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto p-4 scroll-smooth"
      >
        {messagesQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl bg-[#f0f0f0]" />
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="py-12">
            <EmptyState
              icon={MessageCircle}
              title="Сообщений пока нет"
              description={
                entityName
                  ? `Начните омниканальную переписку с клиентом ${entityName}`
                  : "Начните омниканальную переписку с клиентом"
              }
            />
          </div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.dateLabel} className="space-y-3">
              {/* Разделитель даты */}
              <div className="flex items-center justify-center my-3">
                <span className="rounded-full border border-[#e5e5e5] bg-[#fafafa] px-3 py-0.5 text-[11px] font-medium text-[#666666] shadow-2xs">
                  {group.dateLabel}
                </span>
              </div>

              {group.items.map((message) => {
                const isOutbound = message.direction === "outbound";
                const isSystem = message.source === "system" || message.direction === "neutral";
                const isAi = message.source === "ai" || message.source === "ai_bot";
                const isClient = message.direction === "inbound" || message.source === "client";

                if (isSystem) {
                  return (
                    <div key={message.id} className="flex justify-center my-1.5">
                      <div className="max-w-md rounded-full bg-[#f5f5f5] border border-[#e5e5e5] px-3 py-1 text-center text-xs text-[#666666]">
                        {message.content}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex w-full flex-col",
                      isOutbound ? "items-end" : "items-start"
                    )}
                  >
                    <div
                      className={cn(
                        "relative max-w-[85%] rounded-2xl px-4 py-2.5 text-[13px] shadow-2xs md:max-w-[75%]",
                        isClient && "rounded-tl-xs border border-[#e5e5e5] bg-[#f5f5f5] text-[#111111]",
                        isOutbound && !isAi && "rounded-tr-xs border border-[#4a38f5]/20 bg-[#4a38f5]/5 text-[#111111]",
                        isAi && "rounded-tr-xs border border-emerald-200 bg-emerald-50/60 text-[#111111]"
                      )}
                    >
                      {/* Шапка пузыря: отправитель и бейджи */}
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        {isAi ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <Bot className="h-3 w-3" />
                            <span>AI Автопилот</span>
                          </span>
                        ) : isOutbound ? (
                          <span className="font-medium text-[#4a38f5]">
                            {message.senderName || "Оператор"}
                          </span>
                        ) : (
                          <span className="font-medium text-[#111111]">
                            {message.senderName || "Клиент"}
                          </span>
                        )}

                        <span className="rounded bg-black/[0.05] px-1.5 py-0.2 text-[10px] uppercase tracking-wide text-[#666666]">
                          {message.channel}
                        </span>
                      </div>

                      {/* Текст сообщения */}
                      <div className="whitespace-pre-wrap break-words leading-relaxed text-[#111111]">
                        {message.content}
                      </div>

                      {/* Подвал пузыря: время и статус доставки */}
                      <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-[#888888]">
                        <span>{formatTime(message.createdAt)}</span>

                        {isOutbound && (
                          <span className="inline-flex items-center">
                            {message.deliveryStatus === "pending" && (
                              <span title="Отправляется в канал..." className="flex items-center gap-0.5 text-amber-600">
                                <Clock className="h-3 w-3 animate-pulse" />
                              </span>
                            )}
                            {message.deliveryStatus === "sent" && (
                              <span title="Успешно доставлено клиенту" className="flex items-center text-emerald-600">
                                <CheckCheck className="h-3.5 w-3.5" />
                              </span>
                            )}
                            {message.deliveryStatus === "failed" && (
                              <span
                                title={`Ошибка доставки: ${message.deliveryError || "неизвестная ошибка"}`}
                                className="flex items-center gap-1 text-rose-600 font-medium"
                              >
                                <AlertCircle className="h-3 w-3" />
                                <span>Сбой</span>
                              </span>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Текст ошибки доставки под сообщением */}
                      {message.deliveryStatus === "failed" && message.deliveryError && (
                        <div className="mt-1.5 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                          {message.deliveryError}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Панель составления ответа (Composer) */}
      <div className="shrink-0 border-t border-[#e5e5e5] bg-white p-3">
        {/* Выбор «Пишем от:» и кнопка «AI Copilot» */}
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          {/* Селектор канала отправки */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#666666]">Пишем от:</span>
            {sendFromOptions.length > 0 ? (
              <select
                value={selectedChannelAccountId}
                onChange={(e) => setSelectedChannelAccountId(e.target.value)}
                className="rounded-md border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] outline-none transition-colors focus:border-[#4a38f5]"
              >
                {sendFromOptions.map((opt) => (
                  <option
                    key={opt.channelAccountId}
                    value={opt.channelAccountId}
                    disabled={!opt.available}
                  >
                    {opt.accountName} ({opt.channel})
                    {!opt.available ? ` — ${opt.unavailableReason || "недоступен"}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-xs text-[#888888]">Автоматический канал</span>
            )}
          </div>

          {/* Кнопка вызова AI-Copilot */}
          <button
            type="button"
            onClick={handleGenerateAiDraft}
            disabled={aiDraftMutation.isPending}
            title="Сгенерировать черновик ответа на основе базы знаний компании и контекста переписки"
            className="inline-flex items-center gap-1.5 rounded-md border border-[#4a38f5]/30 bg-[#4a38f5]/10 px-2.5 py-1 text-xs font-medium text-[#4a38f5] transition-colors hover:bg-[#4a38f5]/20 disabled:opacity-50"
          >
            {aiDraftMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" />
            )}
            <span>AI Copilot</span>
          </button>
        </div>

        {/* Панель форматирования и эмодзи */}
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1 text-[#666666]">
            <button
              type="button"
              onClick={() => insertFormatting("**", "**")}
              title="Жирный шрифт"
              className="rounded p-1 hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              <span className="text-xs font-bold px-0.5">B</span>
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("> ")}
              title="Цитата"
              className="rounded p-1 hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              <Quote className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("`", "`")}
              title="Код"
              className="rounded p-1 hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              <Code className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("[", "](https://)")}
              title="Ссылка"
              className="rounded p-1 hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              <Link2 className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => insertFormatting("||", "||")}
              title="Спойлер (скрытый текст)"
              className="rounded p-1 text-[11px] font-mono hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              ||
            </button>
          </div>

          {/* Быстрые эмодзи */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmojiPicker((v) => !v)}
              title="Быстрые эмодзи"
              className="rounded p-1 text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              <Smile className="h-4 w-4" />
            </button>

            {showEmojiPicker && (
              <div className="absolute bottom-full right-0 mb-2 z-30 flex flex-wrap gap-1 rounded-xl border border-[#e5e5e5] bg-white p-2 shadow-xl w-48">
                {POPULAR_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => insertEmoji(emoji)}
                    className="flex h-7 w-7 items-center justify-center rounded hover:bg-[#f5f5f5] text-sm"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Поле ввода сообщения и кнопка отправки */}
        <div className="relative flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Написать сообщение клиенту (Enter для отправки, Shift+Enter для переноса)..."
            rows={2}
            className="w-full resize-none rounded-xl border border-[#e5e5e5] bg-white px-3.5 py-2.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />

          <button
            type="button"
            onClick={handleSend}
            disabled={sendMessageMutation.isPending || !input.trim()}
            title="Отправить сообщение (Enter)"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4a38f5] text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sendMessageMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
