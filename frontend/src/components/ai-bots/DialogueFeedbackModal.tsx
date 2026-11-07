"use client";

import { useState } from "react";
import { Star, MessageSquare, Loader2, CheckCircle2, HelpCircle, X, ExternalLink, Bot } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";
import { useAiAgents } from "@/lib/api/use-ai-agents";
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
  onClose: () => void;
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
  onClose,
}: DialogueFeedbackModalProps) {
  const queryClient = useQueryClient();
  const { data: agents = [], isLoading: isLoadingAgents } = useAiAgents();

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!open) return null;

  // Определяем активного агента: из пропсов, из стейта или первый активный агент тенанта
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) {
      toast.error("Пожалуйста, напишите замечание или комментарий к работе агента");
      return;
    }

    setIsSubmitting(true);
    try {
      if (dealId) {
        await apiClient.post(`/api/v1/crm/deals/${dealId}/feedback`, {
          rating,
          user_comment: comment.trim(),
          agent_id: effectiveAgentId || undefined,
          conversation_id: conversationId,
          clarification_answer: clarificationAnswer.trim() || undefined,
        });
      } else if (effectiveAgentId) {
        await apiClient.post(`/api/v1/ai/agents/${effectiveAgentId}/feedback`, {
          rating,
          user_comment: comment.trim(),
          deal_id: dealId,
          conversation_id: conversationId,
          clarification_answer: clarificationAnswer.trim() || undefined,
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
      setRating(5);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отправить отзыв");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
        {/* Шапка */}
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
                Петля обучения на реальных диалогах (RLHF feedback loop)
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

        {/* Выбор агента (если не передан жестко в props и их несколько) */}
        {!initialAgentId && agents.length > 1 && (
          <div className="flex items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2.5">
            <label className="flex items-center gap-1.5 text-xs font-medium text-[#111111]">
              <Bot className="h-3.5 w-3.5 text-[#4a38f5]" />
              <span>Целевой бот:</span>
            </label>
            <select
              value={effectiveAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs font-medium text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            >
              {agents.map((bot) => (
                <option key={bot.id} value={bot.id}>
                  {bot.name} {bot.status === "active" ? "(активен)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Контекст сделки / контакта */}
        {(dealTitle || contactName) && (
          <div className="flex items-center gap-2 rounded-[6px] border border-[#e5e5e5] bg-[#fbfbfb] px-3 py-1.5 text-xs text-[#666666]">
            <ExternalLink className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            <span className="truncate">
              Диалог по сделке:{" "}
              <strong className="font-semibold text-[#111111]">{contactName || dealTitle}</strong>
              {contactName && dealTitle && (
                <span className="ml-1 text-[#888888]">({dealTitle})</span>
              )}
            </span>
          </div>
        )}

        {/* Контекст последнего ответа (если есть) */}
        {(lastUserMessage || lastBotResponse) && (
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs space-y-2 max-h-40 overflow-y-auto">
            {lastUserMessage && (
              <div className="text-[#666666]">
                <span className="font-medium text-[#111111]">Вопрос клиента: </span>
                <span className="italic">«{lastUserMessage}»</span>
              </div>
            )}
            {lastBotResponse && (
              <div className="text-[#111111]">
                <span className="font-medium text-[#4a38f5]">Ответ ИИ: </span>
                <span className="bg-white p-1 rounded border border-[#e5e5e5] block mt-0.5">
                  {lastBotResponse}
                </span>
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Рейтинг */}
          <div className="space-y-1 text-center py-1">
            <span className="block text-xs font-medium text-[#111111]">
              Оценка качества ответов
            </span>
            <div className="flex items-center justify-center gap-1.5">
              {[1, 2, 3, 4, 5].map((star) => {
                const active = (hoverRating ?? rating) >= star;
                return (
                  <button
                    key={star}
                    type="button"
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(null)}
                    onClick={() => setRating(star)}
                    className="p-1 transition-transform hover:scale-115 cursor-pointer"
                  >
                    <Star
                      className={cn(
                        "h-6 w-6 transition-colors",
                        active ? "fill-amber-400 text-amber-400" : "text-[#e5e5e5]",
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[#666666]">
              {rating === 5 && "Отличная работа, ответы точные и по существу"}
              {rating === 4 && "Хорошо, но есть мелкие замечания"}
              {rating === 3 && "Удовлетворительно, агент упустил важную деталь"}
              {rating === 2 && "Плохо, дал неверный или неполный ответ"}
              {rating === 1 && "Критическая ошибка / дезинформация"}
            </p>
          </div>

          {/* Комментарий */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">
              Замечание или правило для агента
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Что именно агент сформулировал некорректно? Какое правило следует соблюдать в таких ситуациях?"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            <p className="text-[10px] text-[#888888]">
              На основе вашего замечания ИИ скомпилирует четкое правило для добавления в базу знаний.
            </p>
          </div>

          {/* Дополнительное уточнение (опционально) */}
          {comment.trim().length > 0 && comment.trim().length < 20 && (
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

          {/* Кнопки */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#e5e5e5]">
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
        </form>
      </div>
    </div>
  );
}
