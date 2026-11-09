"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  Star,
  MessageSquare,
  Loader2,
  CheckCircle2,
  HelpCircle,
  X,
  ExternalLink,
  Sparkles,
  Quote,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";
import { useAiAgents } from "@/lib/api/use-ai-agents";
import { useCrmChat, type ChatMessageDTO } from "@/lib/api/use-crm-chat";
import type { DialogueQuoteItem } from "@/lib/api/use-agent-knowledge";
import { cn } from "@/lib/utils";

export interface DialogueFeedbackModalProps {
  open: boolean;
  agentId?: string;
  agentName?: string;
  dealId?: string;
  dealTitle?: string;
  contactName?: string;
  conversationId?: string;
  lastUserMessage?: string;
  lastBotResponse?: string;
  messages?: ChatMessageDTO[];
  onClose: () => void;
}

interface FloatingQuoteState {
  text: string;
  role: string;
  author: string;
  time?: string;
  top: number;
  left: number;
}

function formatTime(iso?: string): string {
  if (!iso) return "";
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

export function DialogueFeedbackModal({
  open,
  agentId: initialAgentId,
  agentName: initialAgentName,
  dealId,
  dealTitle,
  contactName,
  conversationId,
  lastUserMessage,
  lastBotResponse,
  messages: propMessages,
  onClose,
}: DialogueFeedbackModalProps) {
  const queryClient = useQueryClient();
  const { data: agents = [], isLoading: isLoadingAgents } = useAiAgents();

  // Загрузка сообщений через useCrmChat, если они не были переданы напрямую в props
  const fallbackChat = useCrmChat({
    entityType: "deal",
    entityId: dealId ?? "",
    live: false,
  });

  const rawMessages = useMemo(() => {
    if (propMessages && propMessages.length > 0) return propMessages;
    return fallbackChat.messagesQuery.data ?? [];
  }, [propMessages, fallbackChat.messagesQuery.data]);

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [selectedQuotes, setSelectedQuotes] = useState<DialogueQuoteItem[]>([]);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Состояние плавающего тултипа цитирования
  const [floatingQuote, setFloatingQuote] = useState<FloatingQuoteState | null>(null);

  const timelineRef = useRef<HTMLDivElement>(null);
  const timelineEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Автоскролл к последнему сообщению при открытии
  useEffect(() => {
    if (open && rawMessages.length > 0) {
      setTimeout(() => {
        timelineEndRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      }, 100);
    }
  }, [open, rawMessages.length]);

  // Определяем активного агента
  const activeAgent =
    agents.find((a) => a.id === (initialAgentId || selectedAgentId)) ||
    agents.find((a) => a.status === "active") ||
    agents[0];

  const effectiveAgentId = initialAgentId || selectedAgentId || activeAgent?.id || "";
  const effectiveAgentName =
    initialAgentName ||
    agents.find((a) => a.id === effectiveAgentId)?.name ||
    activeAgent?.name ||
    "Ассистент";

  // Обработка выделения текста мышью в ленте диалога (Quote Selection UX)
  const handleTimelineMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setFloatingQuote(null);
      return;
    }

    const text = selection.toString().trim();
    if (!text || text.length < 2) {
      setFloatingQuote(null);
      return;
    }

    const container = timelineRef.current;
    if (!container || !container.contains(selection.anchorNode)) {
      setFloatingQuote(null);
      return;
    }

    // Ищем родительский элемент сообщения
    let node: Node | null = selection.anchorNode;
    let messageEl: HTMLElement | null = null;
    while (node && node !== container) {
      if (node instanceof HTMLElement && node.dataset.messageId) {
        messageEl = node;
        break;
      }
      node = node.parentNode;
    }

    try {
      const range = selection.getRangeAt(0);
      const rangeRect = range.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();

      // Вычисляем координаты всплывающей плашки над выделенным текстом
      const top = rangeRect.top - containerRect.top + container.scrollTop - 36;
      const left = rangeRect.left - containerRect.left + rangeRect.width / 2;

      const senderRole = messageEl?.dataset.senderRole || "assistant";
      const senderName = messageEl?.dataset.senderName || (senderRole === "client" ? "Клиент" : "Ассистент");
      const senderTime = messageEl?.dataset.senderTime || "";

      setFloatingQuote({
        text,
        role: senderRole,
        author: senderName,
        time: senderTime,
        top: Math.max(8, top),
        left: Math.max(80, Math.min(container.clientWidth - 110, left)),
      });
    } catch {
      setFloatingQuote(null);
    }
  }, []);

  // Вставка цитаты в замечание
  const applyQuote = useCallback((text: string, role?: string, author?: string, time?: string) => {
    const roleLabel =
      role === "client" ? "Клиент" : role === "ai" || role === "ai_bot" || role === "assistant" ? "Ассистент" : author || "Оператор";
    const quoteHeader = time ? `> [${roleLabel}, ${time}]:` : `> [${roleLabel}]:`;
    const quoteBlock = `${quoteHeader} "${text.trim()}"\n\n`;

    setComment((prev) => {
      const cleanPrev = prev.trimEnd();
      return cleanPrev ? `${cleanPrev}\n\n${quoteBlock}` : quoteBlock;
    });

    setSelectedQuotes((prev) => [
      ...prev,
      {
        text: text.trim(),
        role: role || "assistant",
        author: author || roleLabel,
        time: time || undefined,
      },
    ]);

    // Сброс выделения и скрытие тултипа
    window.getSelection()?.removeAllRanges();
    setFloatingQuote(null);

    // Фокус в поле замечания
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
      }
    }, 50);

    toast.success("Цитата вставлена в замечание");
  }, []);

  const removeQuote = useCallback((index: number) => {
    setSelectedQuotes((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) {
      toast.error("Пожалуйста, напишите замечание или правило для агента");
      return;
    }

    setIsSubmitting(true);
    try {
      const finalComment = comment.trim();

      if (dealId) {
        await apiClient.post(`/api/v1/crm/deals/${dealId}/feedback`, {
          rating,
          user_comment: finalComment,
          agent_id: effectiveAgentId || undefined,
          conversation_id: conversationId,
          clarification_answer: clarificationAnswer.trim() || undefined,
          selected_quotes: selectedQuotes,
        });
      } else if (effectiveAgentId) {
        await apiClient.post(`/api/v1/ai/agents/${effectiveAgentId}/feedback`, {
          rating,
          user_comment: finalComment,
          deal_id: dealId,
          conversation_id: conversationId,
          clarification_answer: clarificationAnswer.trim() || undefined,
          selected_quotes: selectedQuotes,
        });
      } else {
        throw new Error("Не выбран целевой AI-агент для обучения");
      }

      toast.success("Обратная связь отправлена в очередь обучения агента!");
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents"] });
      if (effectiveAgentId) {
        void queryClient.invalidateQueries({ queryKey: ["ai", "agents", effectiveAgentId, "feedbacks"] });
      }
      if (dealId) {
        void queryClient.invalidateQueries({ queryKey: ["crm-chat", "deal", dealId] });
        void queryClient.invalidateQueries({ queryKey: ["deals"] });
      }

      setComment("");
      setClarificationAnswer("");
      setSelectedQuotes([]);
      setRating(5);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отправить отзыв");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="w-full max-w-2xl rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl space-y-4 my-auto animate-in fade-in zoom-in-95 duration-150">
        {/* Шапка модального окна */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5]">
              <MessageSquare className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">
                Обучить агента «{effectiveAgentName}»
              </h3>
              <p className="text-[11px] text-[#666666]">
                Контекстная обратная связь и дистилляция правил (RLHF & Few-Shot Learning)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#888888] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Инфо-полоса: сделка и целевой бот */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <ExternalLink className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            <span className="truncate text-[#666666]">
              Диалог:{" "}
              <strong className="font-semibold text-[#111111]">{contactName || dealTitle || "Сделка"}</strong>
              {contactName && dealTitle && (
                <span className="ml-1 text-[#888888]">({dealTitle})</span>
              )}
            </span>
          </div>

          {!initialAgentId && agents.length > 1 && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[11px] text-[#888888]">Бот:</span>
              <select
                value={effectiveAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="h-6 rounded-[6px] border border-[#e5e5e5] bg-white px-1.5 text-xs font-medium text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              >
                {agents.map((bot) => (
                  <option key={bot.id} value={bot.id}>
                    {bot.name} {bot.status === "active" ? "(активен)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Полный таймлайн чата с механизмом Quote Selection UX */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between px-0.5">
            <label className="text-xs font-semibold text-[#111111] flex items-center gap-1.5">
              <span>Лента переписки</span>
              <span className="rounded-full bg-[#f0f0f0] px-1.5 py-0.2 text-[10px] font-mono text-[#666666]">
                {rawMessages.length}
              </span>
            </label>
            <span className="text-[11px] text-[#888888] flex items-center gap-1">
              <Quote className="h-3 w-3 text-[#4a38f5]" />
              <span>Выделите текст в сообщении для цитирования</span>
            </span>
          </div>

          <div className="relative">
            <div
              ref={timelineRef}
              onMouseUp={handleTimelineMouseUp}
              className="relative max-h-56 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2.5 text-xs select-text"
            >
              {rawMessages.length === 0 ? (
                // Если сообщений в трэке нет, показываем контекст последних сообщений
                lastUserMessage || lastBotResponse ? (
                  <div className="space-y-2">
                    {lastUserMessage && (
                      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-[#888888]">
                          <span className="font-semibold text-[#111111]">Клиент</span>
                        </div>
                        <p className="text-[#111111]">{lastUserMessage}</p>
                      </div>
                    )}
                    {lastBotResponse && (
                      <div className="rounded-[8px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 p-2.5 space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-[#4a38f5]">
                          <span className="font-semibold flex items-center gap-1">
                            <Sparkles className="h-2.5 w-2.5" /> AI-ассистент
                          </span>
                        </div>
                        <p className="text-[#111111]">{lastBotResponse}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-[#888888]">
                    Сообщений в этом диалоге пока нет
                  </div>
                )
              ) : (
                rawMessages.map((msg) => {
                  const isClient = msg.direction === "inbound" || msg.source === "client";
                  const isAi = msg.source === "ai" || msg.source === "ai_bot";
                  const time = formatTime(msg.createdAt);

                  return (
                    <div
                      key={msg.id}
                      data-message-id={msg.id}
                      data-sender-role={isClient ? "client" : isAi ? "ai" : "manager"}
                      data-sender-name={isClient ? "Клиент" : isAi ? "Ассистент" : msg.senderName || "Оператор"}
                      data-sender-time={time}
                      className={cn(
                        "group relative rounded-[8px] p-2.5 border transition-colors",
                        isAi
                          ? "bg-[#4a38f5]/5 border-[#4a38f5]/20"
                          : isClient
                            ? "bg-white border-[#e5e5e5]"
                            : "bg-[#ffffff] border-[#e5e5e5]",
                      )}
                    >
                      {/* Шапка сообщения: роль, время и кнопка цитирования целиком */}
                      <div className="flex items-center justify-between gap-2 pb-1 mb-1 border-b border-black/[0.04]">
                        <div className="flex items-center gap-1.5">
                          {isAi ? (
                            <span className="inline-flex items-center gap-1 rounded bg-[#4a38f5]/10 px-1.5 py-0.2 text-[10px] font-semibold text-[#4a38f5]">
                              <Sparkles className="h-2.5 w-2.5" />
                              <span>AI-ассистент</span>
                            </span>
                          ) : isClient ? (
                            <span className="inline-flex items-center gap-1 rounded bg-[#f0f0f0] px-1.5 py-0.2 text-[10px] font-semibold text-[#111111]">
                              <User className="h-2.5 w-2.5 text-[#666666]" />
                              <span>{msg.senderName || "Клиент"}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.2 text-[10px] font-semibold text-sky-800 border border-sky-100">
                              <span>Оператор ({msg.senderName})</span>
                            </span>
                          )}
                          {time && (
                            <span className="text-[10px] text-[#888888] font-mono">{time}</span>
                          )}
                        </div>

                        {/* Кнопка 1-click цитирования всей реплики */}
                        <button
                          type="button"
                          onClick={() =>
                            applyQuote(
                              msg.content,
                              isClient ? "client" : isAi ? "ai" : "manager",
                              msg.senderName || (isClient ? "Клиент" : isAi ? "Ассистент" : "Оператор"),
                              time,
                            )
                          }
                          title="Цитировать всё сообщение"
                          className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[#666666] hover:bg-black/[0.05] hover:text-[#111111] transition-opacity cursor-pointer"
                        >
                          <Quote className="h-2.5 w-2.5" />
                          <span>Цитировать</span>
                        </button>
                      </div>

                      {/* Текст сообщения */}
                      <p className="text-xs text-[#111111] leading-relaxed whitespace-pre-wrap break-words">
                        {msg.content}
                      </p>
                    </div>
                  );
                })
              )}
              <div ref={timelineEndRef} />
            </div>

            {/* Всплывающий тултип цитирования по выделению (Quote Selection Floating Pill) */}
            {floatingQuote && (
              <div
                style={{ top: `${floatingQuote.top}px`, left: `${floatingQuote.left}px` }}
                className="absolute z-30 -translate-x-1/2 transform animate-in fade-in zoom-in-95 duration-100 pointer-events-auto"
              >
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyQuote(
                      floatingQuote.text,
                      floatingQuote.role,
                      floatingQuote.author,
                      floatingQuote.time,
                    );
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#111111] px-3 py-1.5 text-xs font-semibold text-white shadow-xl hover:bg-black transition-transform hover:scale-105 active:scale-95 cursor-pointer border border-white/20"
                >
                  <Quote className="h-3.5 w-3.5 text-[#4a38f5]" />
                  <span>Цитировать в замечание</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Прикрепленные цитаты (chips) */}
        {selectedQuotes.length > 0 && (
          <div className="space-y-1 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-2.5">
            <div className="flex items-center justify-between text-[11px] text-[#666666]">
              <span className="font-medium">
                Прикрепленные фрагменты ({selectedQuotes.length}):
              </span>
              <button
                type="button"
                onClick={() => setSelectedQuotes([])}
                className="text-[10px] text-[#888888] hover:text-rose-600 transition-colors cursor-pointer"
              >
                Очистить все цитаты
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
              {selectedQuotes.map((q, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 rounded-[4px] border border-[#e5e5e5] bg-white px-2 py-1 text-[11px] text-[#111111] shadow-2xs"
                >
                  <Quote className="h-2.5 w-2.5 text-[#4a38f5] shrink-0" />
                  <span className="font-medium text-[#4a38f5]">[{q.author || q.role}]:</span>
                  <span className="max-w-[220px] truncate text-[#444444]">«{q.text}»</span>
                  <button
                    type="button"
                    onClick={() => removeQuote(idx)}
                    className="ml-0.5 text-[#888888] hover:text-rose-600 cursor-pointer"
                    title="Удалить цитату"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Форма обратной связи */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Поле замечания оператора */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-[#111111]">
                Замечание или правило для агента
              </label>
              <span className="text-[10px] text-[#888888]">
                Markdown цитаты поддерживаются
              </span>
            </div>
            <textarea
              ref={textareaRef}
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Что именно агент сформулировал некорректно? Какое правило диалога следует соблюдать в таких ситуациях?"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-sans leading-relaxed"
            />
            <p className="text-[10px] text-[#888888]">
              На основе вашего замечания и прикрепленных цитат ИИ скомпилирует правило для базы знаний агента.
            </p>
          </div>

          {/* Дополнительное уточнение (при коротком комментарии) */}
          {comment.trim().length > 0 && comment.trim().length < 20 && selectedQuotes.length === 0 && (
            <div className="space-y-1 rounded-[8px] border border-amber-200 bg-amber-50/50 p-2.5 text-xs">
              <label className="flex items-center gap-1 font-medium text-amber-800">
                <HelpCircle className="h-3.5 w-3.5 text-amber-600" />
                <span>Уточните, пожалуйста:</span>
              </label>
              <input
                type="text"
                value={clarificationAnswer}
                onChange={(e) => setClarificationAnswer(e.target.value)}
                placeholder="Как именно боту следовало отреагировать на вопрос?"
                className="w-full rounded-[6px] border border-amber-200 bg-white px-2.5 py-1 text-xs text-[#111111] focus:outline-none focus:border-[#4a38f5]"
              />
            </div>
          )}

          {/* Футер: компактный рейтинг слева и кнопки действий справа */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[#e5e5e5]">
            {/* Компактный рейтинг диалога */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#666666]">Оценка:</span>
              <div className="flex items-center gap-0.5" role="group" aria-label="Оценка качества ответов">
                {[1, 2, 3, 4, 5].map((star) => {
                  const active = (hoverRating ?? rating) >= star;
                  return (
                    <button
                      key={star}
                      type="button"
                      onMouseEnter={() => setHoverRating(star)}
                      onMouseLeave={() => setHoverRating(null)}
                      onClick={() => setRating(star)}
                      className="p-0.5 transition-transform hover:scale-115 cursor-pointer text-[#888888]"
                      title={`Оценка ${star} из 5`}
                      aria-label={`${star} звезд`}
                    >
                      <Star
                        className={cn(
                          "h-4 w-4 transition-colors",
                          active ? "fill-amber-400 text-amber-400" : "text-[#e5e5e5]",
                        )}
                      />
                    </button>
                  );
                })}
              </div>
              <span className="text-[11px] text-[#888888] hidden sm:inline">
                {rating === 5 && "(отлично)"}
                {rating === 4 && "(хорошо)"}
                {rating === 3 && "(средне)"}
                {rating === 2 && "(плохо)"}
                {rating === 1 && "(критично)"}
              </span>
            </div>

            {/* Кнопки действий */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={isSubmitting || isLoadingAgents}
                className="h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Сохранение...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span>Отправить в обучение</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
