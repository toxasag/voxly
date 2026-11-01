"use client";

import { CheckCircle, Database, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { useCrmKnowledgeStats, useSyncCrmKnowledge } from "@/lib/api/use-agent-knowledge";
import { cn } from "@/lib/utils";

interface CrmSyncModalProps {
  agentId: string;
  open: boolean;
  onClose: () => void;
}

export function CrmSyncModal({ agentId, open, onClose }: CrmSyncModalProps) {
  const { data: stats, isLoading } = useCrmKnowledgeStats();
  const syncMutation = useSyncCrmKnowledge(agentId);

  if (!open) return null;

  const handleSync = async () => {
    try {
      const res = await syncMutation.mutateAsync();
      toast.success(
        `AI успешно проанализировал CRM! Создано документов: ${res.documentsCreated} (сделок: ${res.dealsAnalyzed}, сообщений: ${res.messagesAnalyzed})`,
      );
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось синтезировать знания из CRM");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-lg rounded-[16px] border border-[#e5e5e5] bg-white shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5] border border-[#4a38f5]/20">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">
                Синтез базы знаний из CRM
              </h3>
              <p className="text-xs text-[#666666]">
                Обучение на закрытых сделках и реальных переписках
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[#888888] hover:bg-[#f5f5f5] hover:text-[#111111]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          <p className="text-xs text-[#666666] leading-relaxed">
            Нейросеть проанализирует историю ваших успешных сделок и переписок менеджеров,
            выделит согласованные цены на услуги, частые вопросы клиентов (FAQ) и лучшие
            скрипты продаж, приведшие к закрытию.
          </p>

          {/* Статистика CRM */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-4">
            <h4 className="text-xs font-semibold text-[#111111] mb-3 flex items-center gap-1.5">
              <Database className="h-3.5 w-3.5 text-[#666666]" />
              Данные вашей CRM:
            </h4>

            {isLoading ? (
              <div className="flex items-center justify-center py-4 text-[#888888]">
                <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5] mr-2" />
                <span className="text-xs">Подсчёт данных...</span>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-2.5">
                  <div className="text-lg font-bold text-[#111111] font-mono">
                    {stats?.wonDeals ?? 0}
                  </div>
                  <div className="text-[11px] text-[#666666]">Успешных сделок</div>
                </div>

                <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-2.5">
                  <div className="text-lg font-bold text-[#111111] font-mono">
                    {stats?.totalDeals ?? 0}
                  </div>
                  <div className="text-[11px] text-[#666666]">Всего сделок</div>
                </div>

                <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-2.5">
                  <div className="text-lg font-bold text-[#111111] font-mono">
                    {stats?.totalMessages ?? 0}
                  </div>
                  <div className="text-[11px] text-[#666666]">Сообщений в чатах</div>
                </div>
              </div>
            )}
          </div>

          {/* Преимущества */}
          <div className="space-y-2 text-xs text-[#666666]">
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Прайс из сделок:</strong> извлекает реальные услуги и чеки, которые оплачивали клиенты.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Реальный FAQ:</strong> формирует список типовых вопросов и работающих ответов.
              </span>
            </div>
            <div className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>
                <strong>Прозрачность:</strong> все созданные документы можно посмотреть и скорректировать руками в любой момент.
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncMutation.isPending || isLoading || (!stats?.wonDeals && !stats?.totalMessages)}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] disabled:opacity-50"
          >
            {syncMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {syncMutation.isPending ? "Синтез базы знаний..." : "Синтезировать опыт из CRM"}
          </button>
        </div>
      </div>
    </div>
  );
}
