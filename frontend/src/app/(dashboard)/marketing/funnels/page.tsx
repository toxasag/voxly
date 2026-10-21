"use client";

import React, { useState } from "react";
import {
  GitBranch,
  Plus,
  Clock,
  MessageSquare,
  Trash2,
  Loader2,
  Sparkles,
} from "lucide-react";
import {
  useStageRules,
  useCreateStageRule,
  useDeleteStageRule,
} from "@/lib/api/use-stage-rules";
import { usePipelines, useKanban } from "@/lib/api/use-deals";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function MarketingFunnelsPage() {
  const { data: rules = [], isLoading: isLoadingRules } = useStageRules();
  const createMutation = useCreateStageRule();
  const deleteMutation = useDeleteStageRule();

  const { data: pipelines = [] } = usePipelines();
  const activePipelineId = pipelines[0]?.id ?? null;
  const { data: kanbanColumns = [] } = useKanban(activePipelineId);

  const [ruleName, setRuleName] = useState("");
  const [selectedStageId, setSelectedStageId] = useState("");
  const [delayMinutes, setDelayMinutes] = useState(5);
  const [templateText, setTemplateText] = useState("");
  const [channel, setChannel] = useState<"telegram" | "whatsapp" | "max">("telegram");

  // Автовыбор первого этапа при загрузке
  React.useEffect(() => {
    if (!selectedStageId && kanbanColumns.length > 0) {
      setSelectedStageId(kanbanColumns[0]?.stageId ?? "");
    }
  }, [kanbanColumns, selectedStageId]);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateText.trim()) return;

    const currentStage = kanbanColumns.find((c) => c.stageId === selectedStageId);
    const finalRuleName =
      ruleName.trim() || `Автоворонка: ${currentStage?.stageName ?? "Новый этап"}`;

    try {
      await createMutation.mutateAsync({
        pipelineId: activePipelineId,
        stageId: selectedStageId || kanbanColumns[0]?.stageId || "default-stage",
        name: finalRuleName,
        delaySeconds: Math.max(0, delayMinutes * 60),
        templateText: templateText.trim(),
        channel,
        isActive: true,
      });

      setRuleName("");
      setTemplateText("");
      toast.success("Правило автоворонки успешно сохранено");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось сохранить правило",
      );
    }
  };

  const handleDeleteRule = async (id: string) => {
    try {
      await deleteMutation.mutateAsync(id);
      toast.success("Правило удалено");
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Не удалось удалить правило",
      );
    }
  };

  return (
    <div className="flex-1 p-6 bg-white min-h-[calc(100vh-3rem)] text-[#111111] font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-[#111111] tracking-tight">
            Автоворонки (Stage Rules)
          </h1>
          <p className="text-[13px] text-[#666666] mt-1">
            Автоматическая отправка сообщений клиентам в мессенджеры при смене этапа сделки
          </p>
        </div>

        {/* Форма добавления нового правила */}
        <div className="bg-white rounded-[8px] border border-[#e5e5e5] p-5 shadow-2xs">
          <h2 className="text-sm font-semibold text-[#111111] mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#4a38f5]" /> Новое правило этапа
          </h2>

          <form onSubmit={handleAddRule} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1.5">
                  Название правила
                </label>
                <input
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  placeholder="Приветствие лида"
                  className="h-8 w-full text-[13px] rounded-[8px] border border-[#e5e5e5] px-2.5 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 bg-white text-[#111111] placeholder:text-[#888888]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1.5">
                  Целевой этап сделки
                </label>
                <select
                  value={selectedStageId}
                  onChange={(e) => setSelectedStageId(e.target.value)}
                  className="h-8 w-full text-[13px] rounded-[8px] border border-[#e5e5e5] px-2.5 bg-white text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                >
                  {kanbanColumns.length > 0 ? (
                    kanbanColumns.map((col) => (
                      <option key={col.stageId} value={col.stageId}>
                        {col.stageName}
                      </option>
                    ))
                  ) : (
                    <option value="lead">Новый лид</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1.5">
                  Канал отправки
                </label>
                <select
                  value={channel}
                  onChange={(e) =>
                    setChannel(e.target.value as "telegram" | "whatsapp" | "max")
                  }
                  className="h-8 w-full text-[13px] rounded-[8px] border border-[#e5e5e5] px-2.5 bg-white text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                >
                  <option value="telegram">Telegram (MTProto)</option>
                  <option value="max">MAX (Бот платформы)</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1.5">
                  Задержка перед отправкой
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={delayMinutes}
                    onChange={(e) => setDelayMinutes(Number(e.target.value))}
                    className="h-8 w-24 text-[13px] rounded-[8px] border border-[#e5e5e5] px-2.5 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 bg-white text-[#111111]"
                  />
                  <span className="text-xs text-[#666666]">минут (0 = мгновенно)</span>
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1.5">
                  Шаблон сообщения (переменные: {"{{name}}"}, {"{{deal_title}}"}, {"{{budget}}"})
                </label>
                <textarea
                  value={templateText}
                  onChange={(e) => setTemplateText(e.target.value)}
                  rows={3}
                  placeholder="Здравствуйте, {{name}}! Ваша заявка «{{deal_title}}» принята в работу."
                  className="w-full text-[13px] rounded-[8px] border border-[#e5e5e5] p-2.5 focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 bg-white text-[#111111] placeholder:text-[#888888]"
                  required
                />
              </div>
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={createMutation.isPending || !templateText.trim()}
                className="h-8 px-4 bg-[#4a38f5] hover:bg-[#3d2ee0] text-white font-medium rounded-[8px] text-[13px] shadow-xs transition-colors disabled:opacity-50 flex items-center gap-1.5"
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5" />
                )}
                Сохранить правило
              </button>
            </div>
          </form>
        </div>

        {/* Список настроенных правил */}
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-[#666666]" /> Активные цепочки этапов ({rules.length})
          </h2>

          {isLoadingRules ? (
            <div className="p-8 text-center text-xs text-[#888888] flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#4a38f5]" />
              Загрузка правил автоворонки...
            </div>
          ) : rules.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#888888] rounded-[8px] border border-[#e5e5e5] bg-white">
              Правила автоворонки ещё не настроены. Создайте первое правило выше.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3">
              {rules.map((rule) => {
                const stageName =
                  kanbanColumns.find((c) => c.stageId === rule.stageId)?.stageName ??
                  rule.stageId ??
                  "Этап";
                return (
                  <div
                    key={rule.id}
                    className="bg-white rounded-[8px] border border-[#e5e5e5] p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-2xs hover:border-[#cccccc] transition-colors"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-[#111111]">
                          {rule.name}
                        </span>
                        <span className="px-2 py-0.5 text-[11px] font-medium bg-[#f4f4f5] text-[#333333] rounded-[4px] border border-[#e5e5e5]">
                          Этап: {stageName}
                        </span>
                        <span className="px-2 py-0.5 text-[11px] font-medium uppercase bg-black/[0.04] text-[#444444] rounded-[4px]">
                          {rule.channel}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] text-[#666666]">
                          <Clock className="w-3 h-3 text-[#888888]" />
                          {rule.delaySeconds === 0
                            ? "мгновенно"
                            : `${Math.round(rule.delaySeconds / 60)} мин. задержка`}
                        </span>
                      </div>

                      <div className="flex items-start gap-2 bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0]">
                        <MessageSquare className="w-3.5 h-3.5 text-[#888888] shrink-0 mt-0.5" />
                        <p className="text-xs text-[#333333] leading-relaxed">
                          {rule.templateText}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        disabled={deleteMutation.isPending}
                        className="h-8 w-8 rounded-[6px] flex items-center justify-center text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                        title="Удалить правило"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
