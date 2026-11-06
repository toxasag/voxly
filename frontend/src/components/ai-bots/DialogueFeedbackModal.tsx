"use client";

import { useState } from "react";
import { Star, MessageSquare, Loader2, CheckCircle2, HelpCircle } from "lucide-react";
import { toast } from "sonner";
import { useCreateDialogueFeedback } from "@/lib/api/use-agent-knowledge";
import { cn } from "@/lib/utils";

interface DialogueFeedbackModalProps {
  open: boolean;
  agentId: string;
  agentName?: string;
  lastUserMessage?: string;
  lastBotResponse?: string;
  dealId?: string;
  conversationId?: string;
  onClose: () => void;
}

export function DialogueFeedbackModal({
  open,
  agentId,
  agentName,
  lastUserMessage,
  lastBotResponse,
  dealId,
  conversationId,
  onClose,
}: DialogueFeedbackModalProps) {
  const [rating, setRating] = useState<number>(5);
  const [comment, setComment] = useState("");
  const [clarificationAnswer, setClarificationAnswer] = useState("");
  const [hoverRating, setHoverRating] = useState<number | null>(null);

  const createFeedback = useCreateDialogueFeedback(agentId);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!comment.trim()) {
      toast.error("Пожалуйста, напишите комментарий к работе агента");
      return;
    }

    try {
      await createFeedback.mutateAsync({
        rating,
        user_comment: comment.trim(),
        deal_id: dealId,
        conversation_id: conversationId,
        clarification_answer: clarificationAnswer.trim() || undefined,
      });

      toast.success("Обратная связь отправлена в очередь обучения агента!");
      setComment("");
      setClarificationAnswer("");
      setRating(5);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось отправить отзыв");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
              <MessageSquare className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">
                Оценить диалог {agentName ? `агента «${agentName}»` : "и обучить агента"}
              </h3>
              <p className="text-[11px] text-[#666666]">
                Петля самообучения (Human-in-the-loop)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-sm font-semibold p-1 cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Контекст последнего ответа (если есть) */}
        {(lastUserMessage || lastBotResponse) && (
          <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-2.5 text-xs space-y-1.5 max-h-36 overflow-y-auto">
            {lastUserMessage && (
              <p className="text-[#666666] line-clamp-2">
                <span className="font-medium text-[#111111]">Вопрос:</span> {lastUserMessage}
              </p>
            )}
            {lastBotResponse && (
              <p className="text-[#111111] line-clamp-3">
                <span className="font-medium text-[#4a38f5]">Ответ бота:</span> {lastBotResponse}
              </p>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Рейтинг */}
          <div className="space-y-1.5 text-center py-1">
            <span className="block text-xs font-medium text-slate-700">
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
                        active ? "fill-amber-400 text-amber-400" : "text-slate-200",
                      )}
                    />
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-[#888888]">
              {rating === 5 && "Отличная работа, ответы точные и по существу"}
              {rating === 4 && "Хорошо, но есть мелкие замечания"}
              {rating === 3 && "Удовлетворительно, агент упустил важную деталь"}
              {rating === 2 && "Плохо, дал неверный или неполный ответ"}
              {rating === 1 && "Критическая ошибка / дезинформация"}
            </p>
          </div>

          {/* Комментарий */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-slate-700">
              Замечание или правило для агента
            </label>
            <textarea
              rows={3}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Что именно агент сформулировал некорректно? Как следовало ответить по стандартам вашей компании?"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            <p className="text-[10px] text-[#888888]">
              На основе вашего замечания ИИ скомпилирует четкое правило для добавления в базу знаний.
            </p>
          </div>

          {/* Дополнительное уточнение (опционально) */}
          {comment.trim().length > 0 && comment.trim().length < 20 && (
            <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 text-xs">
              <label className="flex items-center gap-1 font-medium text-amber-800">
                <HelpCircle className="h-3.5 w-3.5 text-amber-600" />
                Уточните, пожалуйста:
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
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createFeedback.isPending}
              className="h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
            >
              {createFeedback.isPending ? (
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
