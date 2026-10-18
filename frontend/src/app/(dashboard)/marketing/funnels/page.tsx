"use client";

import React, { useState } from "react";
import { GitBranch, Plus, Clock, MessageSquare, CheckCircle2, Trash2 } from "lucide-react";

interface StageRule {
  id: string;
  stage_name: string;
  delay_seconds: number;
  template_text: string;
  is_active: boolean;
  channel: "telegram" | "whatsapp" | "max";
}

export default function MarketingFunnelsPage() {
  const [rules, setRules] = useState<StageRule[]>([
    {
      id: "rule-1",
      stage_name: "Новый лид",
      delay_seconds: 60,
      template_text: "Здравствуйте, {{name}}! Спасибо за заявку на «{{deal_title}}». Наш менеджер уже изучает детали.",
      is_active: true,
      channel: "telegram",
    },
    {
      id: "rule-2",
      stage_name: "Согласование",
      delay_seconds: 300,
      template_text: "Уважаемый(ая) {{name}}, мы подготовили расчет стоимости на сумму {{budget}} руб. Готовы ответить на любые вопросы!",
      is_active: true,
      channel: "whatsapp",
    },
  ]);

  const [selectedStage, setSelectedStage] = useState("Квалификация");
  const [delayMinutes, setDelayMinutes] = useState(5);
  const [templateText, setTemplateText] = useState("");
  const [channel, setChannel] = useState<"telegram" | "whatsapp" | "max">("telegram");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateText.trim()) return;

    const newRule: StageRule = {
      id: `rule-${Date.now()}`,
      stage_name: selectedStage,
      delay_seconds: delayMinutes * 60,
      template_text: templateText,
      is_active: true,
      channel,
    };

    setRules([...rules, newRule]);
    setTemplateText("");
    setSuccessMessage("Правило автоворонки успешно сохранено!");
    setTimeout(() => setSuccessMessage(null), 3000);
  };

  const toggleRuleActive = (id: string) => {
    setRules(
      rules.map((r) => (r.id === id ? { ...r, is_active: !r.is_active } : r)),
    );
  };

  const deleteRule = (id: string) => {
    setRules(rules.filter((r) => r.id !== id));
  };

  return (
    <div className="flex-1 p-6 bg-white min-h-screen text-[#000000] font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold text-[#000000] tracking-tight">Автоворонки (Stage Rules)</h1>
          <p className="text-[13px] text-[#666666] mt-1">
            Автоматическая отправка сообщений клиентам при переходе сделки между этапами воронки
          </p>
        </div>

        {successMessage && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-md text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            {successMessage}
          </div>
        )}

        {/* Форма добавления нового правила */}
        <div className="bg-[#ffffff] rounded-[10px] border border-[#e5e5e5] p-5 shadow-none">
          <h2 className="text-sm font-semibold text-[#000000] mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#111111]" /> Новое правило этапа
          </h2>

          <form onSubmit={handleAddRule} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1.5">
                  Целевой этап сделки
                </label>
                <select
                  value={selectedStage}
                  onChange={(e) => setSelectedStage(e.target.value)}
                  className="w-full text-[13px] rounded-md border border-[#e5e5e5] p-2 bg-white text-[#000000] focus:outline-none focus:border-[#888888]"
                >
                  <option value="Новый лид">Новый лид</option>
                  <option value="Квалификация">Квалификация</option>
                  <option value="Согласование">Согласование</option>
                  <option value="В работе">В работе</option>
                  <option value="Успешно реализовано">Успешно реализовано</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] uppercase tracking-wider mb-1.5">
                  Канал отправки
                </label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as "telegram" | "whatsapp" | "max")}
                  className="w-full text-[13px] rounded-md border border-[#e5e5e5] p-2 bg-white text-[#000000] focus:outline-none focus:border-[#888888]"
                >
                  <option value="telegram">Telegram</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="max">MAX</option>
                </select>
              </div>

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
                    onChange={(e) => setDelayMinutes(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-[13px] rounded-md border border-[#e5e5e5] p-2 focus:outline-none focus:border-[#888888]"
                  />
                  <span className="text-xs text-[#666666] whitespace-nowrap">минут</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
                  Шаблон сообщения
                </label>
                <div className="flex items-center gap-1.5 text-xs text-[#888888]">
                  <span>Теги:</span>
                  <button
                    type="button"
                    onClick={() => setTemplateText((t) => `${t} {{name}}`)}
                    className="px-1.5 py-0.5 rounded bg-black/[0.04] hover:bg-black/[0.08] text-[#333333] text-[11px] font-mono border border-[#e5e5e5]"
                  >
                    {"{{name}}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateText((t) => `${t} {{deal_title}}`)}
                    className="px-1.5 py-0.5 rounded bg-black/[0.04] hover:bg-black/[0.08] text-[#333333] text-[11px] font-mono border border-[#e5e5e5]"
                  >
                    {"{{deal_title}}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateText((t) => `${t} {{budget}}`)}
                    className="px-1.5 py-0.5 rounded bg-black/[0.04] hover:bg-black/[0.08] text-[#333333] text-[11px] font-mono border border-[#e5e5e5]"
                  >
                    {"{{budget}}"}
                  </button>
                </div>
              </div>
              <textarea
                value={templateText}
                onChange={(e) => setTemplateText(e.target.value)}
                rows={3}
                placeholder="Здравствуйте, {{name}}! ..."
                className="w-full text-[13px] rounded-md border border-[#e5e5e5] p-2.5 focus:outline-none focus:border-[#888888] bg-white placeholder:text-[#888888]"
                required
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!templateText.trim()}
                className="h-9 px-4 bg-[#111111] hover:bg-[#222222] text-white font-medium rounded-md text-[13px] transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <GitBranch className="w-3.5 h-3.5" /> Добавить правило
              </button>
            </div>
          </form>
        </div>

        {/* Список действующих правил */}
        <div className="bg-[#ffffff] rounded-[10px] border border-[#e5e5e5] overflow-hidden shadow-none">
          <div className="px-4 py-3 border-b border-[#e5e5e5] flex items-center justify-between">
            <h3 className="text-xs font-semibold text-[#000000]">Активные правила воронок</h3>
            <span className="text-xs text-[#888888]">Всего: {rules.length}</span>
          </div>

          <div className="divide-y divide-[#e5e5e5]">
            {rules.map((rule) => (
              <div key={rule.id} className="p-4 flex items-start justify-between hover:bg-black/[0.02] transition-colors">
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-black/[0.04] text-[#111111] border border-[#e5e5e5]">
                      {rule.stage_name}
                    </span>
                    <span className="text-[11px] font-medium uppercase px-2 py-0.5 rounded bg-black/[0.04] text-[#666666] border border-[#e5e5e5]">
                      {rule.channel}
                    </span>
                    <span className="text-xs text-[#888888] flex items-center gap-1">
                      <Clock className="w-3 h-3" /> задержка {Math.round(rule.delay_seconds / 60)} мин
                    </span>
                  </div>

                  <p className="text-[13px] text-[#111111] font-medium whitespace-pre-wrap">{rule.template_text}</p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleRuleActive(rule.id)}
                    className={`text-xs px-2.5 py-0.5 rounded-full font-medium border transition-colors ${
                      rule.is_active
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-black/[0.03] text-[#888888] border-[#e5e5e5]"
                    }`}
                  >
                    {rule.is_active ? "Активно" : "Отключено"}
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteRule(rule.id)}
                    className="p-1.5 text-[#888888] hover:text-rose-600 rounded-md hover:bg-rose-50 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
