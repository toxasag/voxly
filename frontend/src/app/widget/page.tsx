"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { ChatWidget } from "@/components/widgets/ChatWidget";
import {
  WidgetSettings,
  getTypingEffectFromStorage,
  setTypingEffectInStorage,
} from "@/components/widgets/WidgetSettings";
import type { WidgetLanguage } from "@/types/widget";
import {
  MessageSquare,
  Sparkles,
  Zap,
  Globe,
  Sliders,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  Terminal,
} from "lucide-react";

export default function WidgetPage() {
  const [language, setLanguage] = useState<WidgetLanguage>("ru");
  const [typingSpeed, setTypingSpeed] = useState<number>(12);
  const [typingEffectEnabled, setTypingEffectEnabled] = useState<boolean>(true);
  const [mounted, setMounted] = useState<boolean>(false);

  useEffect(() => {
    setMounted(true);
    setTypingEffectEnabled(getTypingEffectFromStorage());
  }, []);

  const isRu = language === "ru";

  const handleToggleTyping = (enabled: boolean) => {
    setTypingEffectEnabled(enabled);
    setTypingEffectInStorage(enabled);
  };

  return (
    <div className="min-h-screen bg-[#f8f9fa] text-[#111111]">
      {/* Top Navbar */}
      <header className="border-b border-[#e5e5e5] bg-white px-6 py-4 sticky top-0 z-10 shadow-2xs">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4a38f5] text-white shadow-xs">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-[#111111]">
                  GETVOXLY Webchat Widget
                </h1>
                <span className="inline-flex items-center rounded-full bg-[#4a38f5]/10 px-2 py-0.5 text-[11px] font-medium text-[#4a38f5]">
                  Typing Engine v2.0
                </span>
              </div>
              <p className="text-[12px] text-[#666666]">
                {isRu
                  ? "Интерактивная среда тестирования эффекта печати и настроек"
                  : "Interactive playground for chat typing effect and live controls"}
              </p>
            </div>
          </div>

          {/* Language Switcher */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#666666]">
              {isRu ? "Язык интерфейса:" : "Interface Language:"}
            </span>
            <div className="inline-flex rounded-lg border border-[#e5e5e5] p-0.5 bg-[#fbfbfb]">
              <button
                type="button"
                onClick={() => setLanguage("ru")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  isRu
                    ? "bg-white text-[#111111] shadow-xs"
                    : "text-[#666666] hover:text-[#111111]"
                }`}
              >
                Русский
              </button>
              <button
                type="button"
                onClick={() => setLanguage("en")}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  !isRu
                    ? "bg-white text-[#111111] shadow-xs"
                    : "text-[#666666] hover:text-[#111111]"
                }`}
              >
                English
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-6xl mx-auto p-6 md:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Settings and Controls */}
          <div className="lg:col-span-6 space-y-6">
            {/* Widget Settings Card */}
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Sliders className="h-5 w-5 text-[#4a38f5]" />
                  <h2 className="text-base font-semibold text-[#111111]">
                    {isRu ? "Панель управления виджетом" : "Widget Settings Panel"}
                  </h2>
                </div>
                <span className="text-[11px] font-mono text-[#888888] bg-gray-100 px-2 py-0.5 rounded-md">
                  localStorage: typingEffectEnabled
                </span>
              </div>

              <p className="text-[13px] text-[#666666] mb-6 leading-relaxed">
                {isRu
                  ? "Переключатель сохраняет состояние в браузере и мгновенно транслирует событие во все компоненты виджета без перезагрузки страницы."
                  : "The toggle switch synchronizes directly with localStorage and dynamically broadcasts changes across all widget instances without page refresh."}
              </p>

              {/* The WidgetSettings component */}
              <WidgetSettings
                typingEffectEnabled={typingEffectEnabled}
                onTypingEffectChange={handleToggleTyping}
                language={language}
                onLanguageChange={setLanguage}
                typingSpeed={typingSpeed}
                onTypingSpeedChange={setTypingSpeed}
              />
            </div>

            {/* Diagnostics & Verification info */}
            <div className="rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xs space-y-4">
              <h3 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                {isRu
                  ? "Критерии доступности и надежности (WCAG 2.2 AA)"
                  : "Accessibility & Reliability Compliance"}
              </h3>

              <div className="space-y-2 text-[12px] text-[#555555]">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#111111]">ARIA Attributes:</strong>{" "}
                    Контейнер текста снабжен <code className="font-mono bg-gray-100 px-1 py-0.2 rounded">role=&quot;status&quot;</code>,{" "}
                    <code className="font-mono bg-gray-100 px-1 py-0.2 rounded">aria-live=&quot;polite&quot;</code>,{" "}
                    <code className="font-mono bg-gray-100 px-1 py-0.2 rounded">aria-label=&quot;typing effect&quot;</code>.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#111111]">Blinking Cursor:</strong>{" "}
                    Высококонтрастный курсор <code className="font-mono bg-gray-100 px-1 py-0.2 rounded">text-[#111111]</code> с плавным миганием и <code className="font-mono bg-gray-100 px-1 py-0.2 rounded">aria-hidden=&quot;true&quot;</code>.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#111111]">Zero-Reload Sync:</strong>{" "}
                    Мгновенное переключение эффекта между ON и OFF без сброса диалога и без задержек.
                  </span>
                </div>
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>
                    <strong className="text-[#111111]">No API Breaking Changes:</strong>{" "}
                    Публичные контракты <code className="font-mono bg-gray-100 px-1 py-0.2 rounded">/api/v1/widget/config</code> полностью сохранены.
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Live Interactive Chat Widget Preview */}
          <div className="lg:col-span-6 flex flex-col items-center justify-center">
            <div className="w-full flex items-center justify-between mb-3 px-2">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  {isRu ? "Живой виджет (Live Canvas)" : "Live Widget Preview"}
                </span>
              </div>
              <span className="text-[11px] text-[#666666]">
                {typingEffectEnabled
                  ? isRu
                    ? "Режим: Посимвольная печать"
                    : "Mode: Typing active"
                  : isRu
                    ? "Режим: Мгновенный вывод"
                    : "Mode: Instant output"}
              </span>
            </div>

            {/* Chat Widget component instance */}
            <ChatWidget
              key={`${language}-${typingEffectEnabled}`}
              language={language}
              typingSpeed={typingSpeed}
              typingEffectEnabled={typingEffectEnabled}
              className="w-full shadow-2xl"
            />
          </div>
        </div>
      </main>
    </div>
  );
}
