"use client";

import { useEffect, useState } from "react";
import {
  Send,
  MessageSquare,
  CheckCheck,
  Check,
  Sparkles,
  TrendingUp,
  Split,
  Save,
  RefreshCw,
  Copy,
  ShieldCheck,
  HelpCircle,
  ExternalLink,
  Layers,
  ArrowRight,
  UserCheck,
} from "lucide-react";
import { TagPill } from "@/components/ui/tag";
import {
  usePreChatConfig,
  usePreChatStats,
  useUpdatePreChatConfig,
  type PreChatABMode,
} from "@/lib/api/use-prechat-modal";

export function PreChatMessengerModalView() {
  const { data: config, isLoading: isConfigLoading, refetch: refetchConfig } = usePreChatConfig();
  const { data: stats, isLoading: isStatsLoading, refetch: refetchStats } = usePreChatStats();
  const updateMutation = useUpdatePreChatConfig();

  // Локальное состояние формы
  const [isEnabled, setIsEnabled] = useState(true);
  const [abMode, setAbMode] = useState<PreChatABMode>("split_50_50");
  const [greetingTemplate, setGreetingTemplate] = useState(
    "Здравствуйте! Меня зовут {name}. (код: {code})",
  );
  const [telegramUsername, setTelegramUsername] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [whatsappEnabled, setWhatsappEnabled] = useState(true);

  // Состояние интерактивного предпросмотра
  const [previewPlatform, setPreviewPlatform] = useState<"telegram" | "whatsapp">("telegram");
  const [previewName, setPreviewName] = useState("Иван");
  const [previewNote, setPreviewNote] = useState("Консультация по условиям");
  const [copiedCode, setCopiedCode] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Синхронизация формы при загрузке данных
  useEffect(() => {
    if (config) {
      setIsEnabled(config.isEnabled);
      setAbMode(config.abMode);
      setGreetingTemplate(config.greetingTemplate);
      setTelegramUsername(config.telegramUsername || "");
      setWhatsappNumber(config.whatsappNumber || "");
      setTelegramEnabled(config.telegramEnabled);
      setWhatsappEnabled(config.whatsappEnabled);
    }
  }, [config]);

  const handleSave = () => {
    updateMutation.mutate(
      {
        isEnabled,
        abMode,
        greetingTemplate,
        telegramUsername: telegramUsername.trim().replace(/^@/, "") || null,
        whatsappNumber: whatsappNumber.trim().replace(/\D/g, "") || null,
        telegramEnabled,
        whatsappEnabled,
      },
      {
        onSuccess: () => {
          setSaveSuccess(true);
          setTimeout(() => setSaveSuccess(false), 3000);
        },
      },
    );
  };

  const handleInsertTag = (tag: string) => {
    setGreetingTemplate((prev) => {
      if (prev.includes(tag)) return prev;
      return `${prev} ${tag}`;
    });
  };

  const previewCode = "vx-9821";
  const formattedPreviewText = greetingTemplate
    .replace(/\{name\}/g, previewName.trim() || "[Ваше имя]")
    .replace(/\{code\}/g, previewCode)
    .concat(previewNote.trim() ? ` Вопрос: ${previewNote.trim()}` : "");

  const handleCopyPreviewText = () => {
    navigator.clipboard.writeText(formattedPreviewText);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const directStats = stats?.direct || { impressions: 0, clicks: 0, chatsStarted: 0, conversionRate: 0 };
  const modalStats = stats?.modal || { impressions: 0, modalOpens: 0, submits: 0, chatsStarted: 0, conversionRate: 0 };
  const summary = stats?.summary || { totalImpressions: 0, totalChats: 0, winnerVariant: "insufficient_data", conversionLift: 0 };

  return (
    <div className="space-y-6">
      {/* Шапка раздела и описание */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5 max-w-3xl">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-[#111111]">
                Двухшаговый Pre-Chat Модал и Deep Link атрибуция
              </h2>
              <TagPill color="violet">Решение для личных аккаунтов</TagPill>
            </div>
            <p className="text-[13px] leading-relaxed text-[#666666]">
              В Telegram личные ссылки <code className="rounded bg-[#f4f4f5] px-1 py-0.5 font-mono text-xs">t.me/&lt;user&gt;?start=...</code>{" "}
              не передают параметры deep link (в отличие от ботов), а в WhatsApp клиенты часто стирают
              технические токены. 2-шаговый модал собирает имя и формирует естественный текст с компактным кодом{" "}
              <code className="rounded bg-[#f4f4f5] px-1 py-0.5 font-mono text-xs">vx-XXXX</code>, гарантируя сквозную
              атрибуцию рекламных кампаний (Яндекс.Метрика, GA4, Meta) при первом входящем сообщении.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void refetchConfig();
                void refetchStats();
              }}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa]"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isConfigLoading || isStatsLoading ? "animate-spin text-[#4a38f5]" : "text-[#666666]"}`}
              />
              Обновить метрики
            </button>
          </div>
        </div>
      </div>

      {/* A/B Сплит-тест: Сравнение Варианта А (Direct) и Варианта B (Modal) */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Split className="h-4 w-4 text-[#4a38f5]" />
            <h3 className="text-sm font-semibold text-[#111111]">
              Результаты A/B тестирования воронки (Direct Click vs Pre-Chat Modal)
            </h3>
          </div>
          {summary.winnerVariant === "modal" && (
            <TagPill color="emerald">
              Pre-Chat Модал лидирует: +{summary.conversionLift}% к реальным диалогам
            </TagPill>
          )}
          {summary.winnerVariant === "direct" && (
            <TagPill color="sky">
              Прямой клик лидирует: +{summary.conversionLift}%
            </TagPill>
          )}
          {summary.winnerVariant === "insufficient_data" && (
            <TagPill color="slate">
              Идет накопление данных сплит-теста
            </TagPill>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Вариант А: Прямой переход */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs">
            <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
              <div>
                <div className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                  Вариант A (Контроль)
                </div>
                <div className="text-sm font-semibold text-[#111111] mt-0.5">
                  Прямой клик в мессенджер
                </div>
              </div>
              <TagPill color="slate">Без модала</TagPill>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-[6px] bg-[#fbfbfb] p-3 border border-[#f0f0f0]">
                <div className="text-[11px] font-medium text-[#666666]">Показы баннера</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#111111]">
                  {directStats.impressions}
                </div>
              </div>
              <div className="rounded-[6px] bg-[#fbfbfb] p-3 border border-[#f0f0f0]">
                <div className="text-[11px] font-medium text-[#666666]">Клики</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#111111]">
                  {directStats.clicks}
                </div>
              </div>
              <div className="rounded-[6px] bg-[#fbfbfb] p-3 border border-[#f0f0f0]">
                <div className="text-[11px] font-medium text-[#666666]">Диалоги в CRM</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#111111]">
                  {directStats.chatsStarted}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-[#f0f0f0] pt-3">
              <span className="text-xs text-[#666666]">Конверсия в первый контакт:</span>
              <span className="font-mono text-sm font-semibold text-[#111111]">
                {directStats.conversionRate}%
              </span>
            </div>
          </div>

          {/* Вариант B: Двухшаговый Pre-Chat Модал */}
          <div className="rounded-[8px] border-2 border-[#4a38f5]/30 bg-white p-4 shadow-2xs relative">
            <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
              <div>
                <div className="text-xs font-semibold text-[#4a38f5] uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3" />
                  Вариант B (Тестируемый)
                </div>
                <div className="text-sm font-semibold text-[#111111] mt-0.5">
                  Pre-Chat Модал + Код vx-xxxx
                </div>
              </div>
              <TagPill color="violet">2 шага + имя</TagPill>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-[6px] bg-[#fbfbfb] p-3 border border-[#f0f0f0]">
                <div className="text-[11px] font-medium text-[#666666]">Открытий формы</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#111111]">
                  {modalStats.modalOpens || modalStats.impressions}
                </div>
              </div>
              <div className="rounded-[6px] bg-[#fbfbfb] p-3 border border-[#f0f0f0]">
                <div className="text-[11px] font-medium text-[#666666]">Отправлено форм</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#111111]">
                  {modalStats.submits}
                </div>
              </div>
              <div className="rounded-[6px] bg-[#fbfbfb] p-3 border border-[#f0f0f0]">
                <div className="text-[11px] font-medium text-[#666666]">Диалоги в CRM</div>
                <div className="mt-1 font-mono text-lg font-bold text-[#15803d]">
                  {modalStats.chatsStarted}
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-[#f0f0f0] pt-3">
              <span className="text-xs text-[#666666]">Конверсия в первый контакт:</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-semibold text-[#15803d]">
                  {modalStats.conversionRate}%
                </span>
                {modalStats.conversionRate > directStats.conversionRate && (
                  <span className="text-[11px] font-medium text-[#15803d]">
                    (+{(modalStats.conversionRate - directStats.conversionRate).toFixed(1)}%)
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Основная рабочая область: Конфигуратор слева и Интерактивный Live Preview справа */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Конфигуратор настроек модала */}
        <div className="space-y-5 lg:col-span-7">
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
              <h3 className="text-sm font-semibold text-[#111111]">Настройки механики захвата</h3>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                />
                <span className="text-xs font-medium text-[#111111]">Модал активен</span>
              </label>
            </div>

            {/* Выбор режима A/B тестирования */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[#111111]">
                Режим работы и A/B распределение трафика:
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <label
                  className={`flex cursor-pointer flex-col rounded-[8px] border p-3 transition-colors ${
                    abMode === "split_50_50"
                      ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#111111]"
                      : "border-[#e5e5e5] hover:bg-[#fafafa] text-[#666666]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">50/50 Сплит-тест</span>
                    <input
                      type="radio"
                      name="abMode"
                      value="split_50_50"
                      checked={abMode === "split_50_50"}
                      onChange={() => setAbMode("split_50_50")}
                      className="text-[#4a38f5]"
                    />
                  </div>
                  <span className="mt-1 text-[11px] leading-tight opacity-80">
                    50% прямой клик, 50% модал. Точное сравнение эффективности.
                  </span>
                </label>

                <label
                  className={`flex cursor-pointer flex-col rounded-[8px] border p-3 transition-colors ${
                    abMode === "always_modal"
                      ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#111111]"
                      : "border-[#e5e5e5] hover:bg-[#fafafa] text-[#666666]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Всегда модал</span>
                    <input
                      type="radio"
                      name="abMode"
                      value="always_modal"
                      checked={abMode === "always_modal"}
                      onChange={() => setAbMode("always_modal")}
                      className="text-[#4a38f5]"
                    />
                  </div>
                  <span className="mt-1 text-[11px] leading-tight opacity-80">
                    100% посетителей открывают форму. Максимальный сбор атрибуции.
                  </span>
                </label>

                <label
                  className={`flex cursor-pointer flex-col rounded-[8px] border p-3 transition-colors ${
                    abMode === "always_direct"
                      ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#111111]"
                      : "border-[#e5e5e5] hover:bg-[#fafafa] text-[#666666]"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold">Только прямой</span>
                    <input
                      type="radio"
                      name="abMode"
                      value="always_direct"
                      checked={abMode === "always_direct"}
                      onChange={() => setAbMode("always_direct")}
                      className="text-[#4a38f5]"
                    />
                  </div>
                  <span className="mt-1 text-[11px] leading-tight opacity-80">
                    Без открытия модала. Прямой переход по ссылке мессенджера.
                  </span>
                </label>
              </div>
            </div>

            {/* Привязка аккаунтов мессенджеров */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 pt-2">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#111111]">
                    Telegram аккаунт или бот:
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-[#666666]">
                    <input
                      type="checkbox"
                      checked={telegramEnabled}
                      onChange={(e) => setTelegramEnabled(e.target.checked)}
                      className="h-3.5 w-3.5 rounded text-[#4a38f5]"
                    />
                    Включен
                  </label>
                </div>
                <div className="relative">
                  <span className="absolute left-2.5 top-2 text-xs font-mono text-[#888888]">@</span>
                  <input
                    type="text"
                    value={telegramUsername}
                    onChange={(e) => setTelegramUsername(e.target.value)}
                    placeholder="GetVoxlybot или менеджер"
                    className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-7 pr-3 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>
                <p className="text-[11px] text-[#888888]">
                  Юзернейм личного аккаунта или бота в Telegram.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-[#111111]">
                    WhatsApp номер телефона:
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-[#666666]">
                    <input
                      type="checkbox"
                      checked={whatsappEnabled}
                      onChange={(e) => setWhatsappEnabled(e.target.checked)}
                      className="h-3.5 w-3.5 rounded text-[#4a38f5]"
                    />
                    Включен
                  </label>
                </div>
                <input
                  type="text"
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  placeholder="+7 (999) 123-45-67"
                  className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                />
                <p className="text-[11px] text-[#888888]">
                  Номер в международном формате для формирования wa.me ссылки.
                </p>
              </div>
            </div>

            {/* Шаблон первого сообщения */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-[#111111]">
                  Шаблон приветственного сообщения:
                </label>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#888888]">Вставить тег:</span>
                  <button
                    type="button"
                    onClick={() => handleInsertTag("{name}")}
                    className="rounded bg-[#f0f0f0] px-2 py-0.5 text-[11px] font-mono text-[#111111] hover:bg-[#e5e5e5] transition-colors"
                  >
                    + {"{name}"}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInsertTag("{code}")}
                    className="rounded bg-[#f0f0f0] px-2 py-0.5 text-[11px] font-mono text-[#111111] hover:bg-[#e5e5e5] transition-colors"
                  >
                    + {"{code}"}
                  </button>
                </div>
              </div>
              <textarea
                rows={3}
                value={greetingTemplate}
                onChange={(e) => setGreetingTemplate(e.target.value)}
                placeholder="Здравствуйте! Меня зовут {name}. (код: {code})"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-sans leading-relaxed"
              />
              <p className="text-[11px] text-[#888888]">
                Тег <code className="font-mono text-[#4a38f5]">&#123;code&#125;</code> будет заменен на
                компактный уникальный идентификатор вида <code className="font-mono text-[#111111]">vx-XXXX</code>,
                который менеджер увидит в первом сообщении, а CRM свяжет с сессией рекламы.
              </p>
            </div>

            {/* Кнопка сохранения */}
            <div className="flex items-center justify-between border-t border-[#f0f0f0] pt-4">
              <div className="flex items-center gap-2">
                {saveSuccess && (
                  <span className="flex items-center gap-1 text-xs font-medium text-[#15803d]">
                    <Check className="h-3.5 w-3.5" />
                    Настройки сохранены
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={updateMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
              >
                <Save className="h-3.5 w-3.5" />
                {updateMutation.isPending ? "Сохранение..." : "Сохранить настройки"}
              </button>
            </div>
          </div>
        </div>

        {/* Интерактивный Live Preview в реальном времени */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-[#4a38f5]" />
                <h3 className="text-sm font-semibold text-[#111111]">Интерактивный Live Preview</h3>
              </div>
              {/* Переключатель тем Telegram / WhatsApp */}
              <div className="flex items-center rounded-[6px] border border-[#e5e5e5] p-0.5 bg-[#fbfbfb]">
                <button
                  type="button"
                  onClick={() => setPreviewPlatform("telegram")}
                  className={`rounded-[4px] px-2.5 py-1 text-xs font-medium transition-colors ${
                    previewPlatform === "telegram"
                      ? "bg-[#2AABEE] text-white shadow-2xs"
                      : "text-[#666666] hover:text-[#111111]"
                  }`}
                >
                  Telegram
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewPlatform("whatsapp")}
                  className={`rounded-[4px] px-2.5 py-1 text-xs font-medium transition-colors ${
                    previewPlatform === "whatsapp"
                      ? "bg-[#075E54] text-white shadow-2xs"
                      : "text-[#666666] hover:text-[#111111]"
                  }`}
                >
                  WhatsApp
                </button>
              </div>
            </div>

            {/* Интерактивные тестовые поля для проверки в реальном времени */}
            <div className="grid grid-cols-2 gap-2 bg-[#fbfbfb] p-3 rounded-[8px] border border-[#f0f0f0]">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[#666666]">Тестовое имя:</label>
                <input
                  type="text"
                  value={previewName}
                  onChange={(e) => setPreviewName(e.target.value)}
                  placeholder="Иван"
                  className="h-7 w-full rounded border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-[#666666]">Вопрос / тема:</label>
                <input
                  type="text"
                  value={previewNote}
                  onChange={(e) => setPreviewNote(e.target.value)}
                  placeholder="Вопрос..."
                  className="h-7 w-full rounded border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>
            </div>

            {/* Каркас нативного модального окна */}
            <div className="rounded-[16px] border border-[#e5e5e5] shadow-sm overflow-hidden bg-white">
              {/* Шапка модала */}
              <div
                className={`p-3.5 text-white flex items-center justify-between ${
                  previewPlatform === "telegram" ? "bg-[#2AABEE]" : "bg-[#075E54]"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                    {previewPlatform === "telegram" ? (
                      <Send className="h-4 w-4 text-white" />
                    ) : (
                      <MessageSquare className="h-4 w-4 text-white" />
                    )}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold leading-tight">
                      {previewPlatform === "telegram"
                        ? "Написать в Telegram"
                        : "Написать в WhatsApp"}
                    </div>
                    <div className="text-[11px] opacity-85 leading-tight mt-0.5">
                      {previewPlatform === "telegram"
                        ? "Свяжитесь с нами напрямую"
                        : "Ответим в течение 2 минут"}
                    </div>
                  </div>
                </div>
                <span className="text-white/80 hover:text-white cursor-pointer text-xs">✕</span>
              </div>

              {/* Тело модала */}
              <div className="p-4 space-y-3 bg-white">
                {/* Блок предварительного просмотра сообщения в чате */}
                <div
                  className={`p-3 rounded-[8px] border text-xs leading-relaxed space-y-1.5 ${
                    previewPlatform === "telegram"
                      ? "bg-[#eef7fe] border-[#cbe6fa] text-[#0c4a6e]"
                      : "bg-[#dcf8c6] border-[#c7e8a9] text-[#064e3b]"
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider opacity-75">
                    <span>Предпросмотр сообщения:</span>
                    <button
                      type="button"
                      onClick={handleCopyPreviewText}
                      className="hover:underline inline-flex items-center gap-1 lowercase"
                    >
                      {copiedCode ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                      {copiedCode ? "скопировано" : "копировать"}
                    </button>
                  </div>
                  <div className="font-sans font-medium">{formattedPreviewText}</div>
                  <div className="flex items-center justify-end gap-1 text-[10px] opacity-65 font-mono">
                    <span>14:32</span>
                    {previewPlatform === "telegram" ? (
                      <Check className="h-3 w-3" />
                    ) : (
                      <CheckCheck className="h-3.5 w-3.5 text-[#075E54]" />
                    )}
                  </div>
                </div>

                {/* Поле ввода имени */}
                <div className="space-y-1">
                  <label className="text-[11.5px] font-semibold text-[#111111]">
                    Как к вам обращаться? *
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={previewName}
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-2.5 text-xs text-[#111111]"
                  />
                </div>

                {/* Кнопка действия */}
                <button
                  type="button"
                  className={`w-full h-9 rounded-[8px] text-[13px] font-semibold text-white flex items-center justify-center gap-2 shadow-xs transition-colors ${
                    previewPlatform === "telegram"
                      ? "bg-[#2AABEE] hover:bg-[#229ED9]"
                      : "bg-[#25D366] hover:bg-[#1ebe5d]"
                  }`}
                >
                  {previewPlatform === "telegram" ? (
                    <>
                      <Send className="h-4 w-4" />
                      Перейти в Telegram
                    </>
                  ) : (
                    <>
                      <MessageSquare className="h-4 w-4" />
                      Перейти в WhatsApp
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-1.5 text-[10.5px] text-[#888888] pt-1">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#15803d]" />
                  <span>Код диалога сохранит сессию и рекламный источник</span>
                </div>
              </div>
            </div>

            {/* Информация о сформированном deep link */}
            <div className="rounded-[6px] bg-[#fbfbfb] p-3 border border-[#f0f0f0] space-y-1.5 text-xs text-[#666666]">
              <div className="font-semibold text-[#111111] flex items-center justify-between">
                <span>Генерируемый Deep Link URL:</span>
                <span className="font-mono text-[11px] text-[#4a38f5]">код: {previewCode}</span>
              </div>
              <div className="font-mono text-[11px] break-all bg-white p-2 rounded border border-[#e5e5e5] text-[#111111]">
                {previewPlatform === "telegram"
                  ? `https://t.me/${telegramUsername || "GetVoxlybot"}?text=${encodeURIComponent(formattedPreviewText)}`
                  : `https://wa.me/${whatsappNumber.replace(/\D/g, "") || "79991234567"}?text=${encodeURIComponent(formattedPreviewText)}`}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
