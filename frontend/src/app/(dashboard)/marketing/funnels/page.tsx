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
    <div className="flex-1 p-6 bg-slate-50 min-h-screen text-slate-900 font-sans">
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">Автоворонки (Stage Rules)</h1>
          <p className="text-sm text-slate-500 mt-1">
            Автоматическая отправка сообщений клиентам при переходе сделки между этапами воронки
          </p>
        </div>

        {successMessage && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            {successMessage}
          </div>
        )}

        {/* Форма добавления нового правила */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Plus className="w-4 h-4 text-blue-600" /> Новое правило этапа
          </h2>

          <form onSubmit={handleAddRule} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                  Целевой этап сделки
                </label>
                <select
                  value={selectedStage}
                  onChange={(e) => setSelectedStage(e.target.value)}
                  className="w-full text-sm rounded-lg border border-slate-200 p-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="Новый лид">Новый лид</option>
                  <option value="Квалификация">Квалификация</option>
                  <option value="Согласование">Согласование</option>
                  <option value="В работе">В работе</option>
                  <option value="Успешно реализовано">Успешно реализовано</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                  Канал отправки
                </label>
                <select
                  value={channel}
                  onChange={(e) => setChannel(e.target.value as "telegram" | "whatsapp" | "max")}
                  className="w-full text-sm rounded-lg border border-slate-200 p-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                  <option value="telegram">Telegram</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="max">MAX</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 uppercase tracking-wider mb-1.5">
                  Задержка перед отправкой
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={delayMinutes}
                    onChange={(e) => setDelayMinutes(parseInt(e.target.value, 10) || 0)}
                    className="w-full text-sm rounded-lg border border-slate-200 p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                  />
                  <span className="text-xs text-slate-500 whitespace-nowrap">минут</span>
                </div>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-slate-600 uppercase tracking-wider">
                  Шаблон сообщения
                </label>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <span>Теги:</span>
                  <button
                    type="button"
                    onClick={() => setTemplateText((t) => `${t} {{name}}`)}
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-mono"
                  >
                    {"{{name}}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateText((t) => `${t} {{deal_title}}`)}
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-mono"
                  >
                    {"{{deal_title}}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTemplateText((t) => `${t} {{budget}}`)}
                    className="px-1.5 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-mono"
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
                className="w-full text-sm rounded-lg border border-slate-200 p-3 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 bg-white placeholder:text-slate-400"
                required
              />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!templateText.trim()}
                className="py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg text-sm shadow-sm transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <GitBranch className="w-4 h-4" /> Добавить правило
              </button>
            </div>
          </form>
        </div>

        {/* Список действующих правил */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-800">Активные правила воронок</h3>
            <span className="text-xs text-slate-500">Всего: {rules.length}</span>
          </div>

          <div className="divide-y divide-slate-100">
            {rules.map((rule) => (
              <div key={rule.id} className="p-4 flex items-start justify-between hover:bg-slate-50 transition-colors">
                <div className="space-y-1.5 max-w-2xl">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                      {rule.stage_name}
                    </span>
                    <span className="text-xs font-semibold uppercase px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                      {rule.channel}
                    </span>
                    <span className="text-xs text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> задержка {Math.round(rule.delay_seconds / 60)} мин
                    </span>
                  </div>

                  <p className="text-sm text-slate-800 font-medium whitespace-pre-wrap">{rule.template_text}</p>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => toggleRuleActive(rule.id)}
                    className={`text-xs px-2.5 py-1 rounded-full font-medium border transition-colors ${
                      rule.is_active
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-slate-100 text-slate-500 border-slate-200"
                    }`}
                  >
                    {rule.is_active ? "Активно" : "Отключено"}
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteRule(rule.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors"
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
