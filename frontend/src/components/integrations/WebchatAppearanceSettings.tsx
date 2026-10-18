"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  ExternalLink,
  Laptop,
  Loader2,
  MessageSquare,
  Moon,
  Palette,
  Send,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelAccountDTO } from "@/lib/api/use-channels";
import { useUpdateChannelAccount } from "@/lib/api/use-channels";

interface WebchatAppearanceSettingsProps {
  account: ChannelAccountDTO;
  onBack: () => void;
}

const PRESET_COLORS = [
  { name: "Янтарь (GetVoxly)", hex: "#F59E0B" },
  { name: "Оранжевый", hex: "#F97316" },
  { name: "Индиго", hex: "#6366F1" },
  { name: "Изумруд", hex: "#10B981" },
  { name: "Небесный", hex: "#0EA5E9" },
  { name: "Роза", hex: "#F43F5E" },
  { name: "Фиолетовый", hex: "#8B5CF6" },
  { name: "Графит", hex: "#475569" },
];

export function WebchatAppearanceSettings({ account, onBack }: WebchatAppearanceSettingsProps) {
  const updateAccount = useUpdateChannelAccount("webchat");

  const initialCreds = (account.credentials ?? {}) as Record<string, unknown>;

  const [accentColor, setAccentColor] = useState<string>(
    typeof initialCreds.accentColor === "string" ? initialCreds.accentColor : "#F59E0B",
  );
  const [theme, setTheme] = useState<"dark" | "light" | "auto">(
    initialCreds.theme === "light" ? "light" : initialCreds.theme === "dark" ? "dark" : "auto",
  );
  const [title, setTitle] = useState<string>(
    typeof initialCreds.title === "string" ? initialCreds.title : "Онлайн-консультант",
  );
  const [greeting, setGreeting] = useState<string>(
    typeof initialCreds.greeting === "string"
      ? initialCreds.greeting
      : "Здравствуйте! Чем я могу вам помочь?",
  );
  const [placeholder, setPlaceholder] = useState<string>(
    typeof initialCreds.placeholder === "string"
      ? initialCreds.placeholder
      : "Напишите сообщение...",
  );
  const [position, setPosition] = useState<"bottom-right" | "bottom-left">(
    initialCreds.position === "bottom-left" ? "bottom-left" : "bottom-right",
  );
  const [showTelegramBanner, setShowTelegramBanner] = useState<boolean>(
    Boolean(initialCreds.showTelegramBanner),
  );
  const [telegramBot, setTelegramBot] = useState<string>(
    typeof initialCreds.telegramBot === "string" ? initialCreds.telegramBot : "",
  );

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(true);

  // Сброс индикатора успешного сохранения
  useEffect(() => {
    if (savedSuccess) {
      const timer = setTimeout(() => setSavedSuccess(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [savedSuccess]);

  const handleSave = () => {
    updateAccount.mutate(
      {
        id: account.id,
        credentials: {
          accentColor,
          theme,
          title,
          greeting,
          placeholder,
          position,
          showTelegramBanner,
          telegramBot: telegramBot.trim(),
        },
      },
      {
        onSuccess: () => {
          setSavedSuccess(true);
        },
      },
    );
  };

  const isDark = theme === "dark" || theme === "auto";

  return (
    <div className="space-y-6">
      {/* Шапка раздела */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#e5e5e5] bg-white text-[#666666] transition-colors hover:border-[#cccccc] hover:text-[#111111] hover:bg-[#fafafa]"
            title="Назад к списку сайтов"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-[#111111]">Внешний вид виджета</h1>
              <span className="rounded bg-[#f0f0f0] px-2 py-0.5 text-xs font-mono text-[#666666]">
                {account.externalId}
              </span>
            </div>
            <p className="mt-0.5 text-sm text-[#666666]">
              Настройка стилей, цветов, приветствия и Live Preview для сайта «{account.label}»
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {savedSuccess && (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4" />
              Настройки сохранены
            </span>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={updateAccount.isPending}
            className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3b2be0] disabled:opacity-50"
          >
            {updateAccount.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Сохранить настройки
          </button>
        </div>
      </div>

      {/* Основная сетка: настройки слева, интерактивный Live Preview справа */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Левая колонка: форма параметров */}
        <div className="space-y-6 lg:col-span-6">
          {/* 1. Цветовая палитра */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <div className="flex items-center gap-2">
              <Palette className="h-4 w-4 text-[#4a38f5]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
                Основной цвет виджета
              </h2>
            </div>
            <p className="mt-1 text-xs text-[#666666]">
              Цвет кнопки открытия, шапки диалога и активных элементов.
            </p>

            <div className="mt-4 flex flex-wrap gap-2.5">
              {PRESET_COLORS.map((preset) => {
                const isSelected = accentColor.toLowerCase() === preset.hex.toLowerCase();
                return (
                  <button
                    key={preset.hex}
                    type="button"
                    onClick={() => setAccentColor(preset.hex)}
                    className={cn(
                      "group relative flex h-8 w-8 items-center justify-center rounded-full transition-transform hover:scale-110 shadow-xs",
                      isSelected && "ring-2 ring-[#4a38f5] ring-offset-2 ring-offset-white",
                    )}
                    style={{ backgroundColor: preset.hex }}
                    title={preset.name}
                  >
                    {isSelected && <Check className="h-4 w-4 text-white stroke-[3]" />}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center gap-3">
              <label className="text-xs font-medium text-[#666666]">HEX:</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  className="h-7 w-8 cursor-pointer rounded border border-[#e5e5e5] bg-transparent"
                />
                <input
                  type="text"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  placeholder="#4a38f5"
                  className="w-28 rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
            </div>
          </div>

          {/* 2. Тема оформления */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
              Тема оформления
            </h2>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setTheme("dark")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium transition-colors",
                  theme === "dark"
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                <Moon className="h-3.5 w-3.5" />
                Тёмная
              </button>
              <button
                type="button"
                onClick={() => setTheme("light")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium transition-colors",
                  theme === "light"
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                <Sun className="h-3.5 w-3.5" />
                Светлая
              </button>
              <button
                type="button"
                onClick={() => setTheme("auto")}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-lg border py-2.5 text-xs font-medium transition-colors",
                  theme === "auto"
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                <Laptop className="h-3.5 w-3.5" />
                Авто (ОС)
              </button>
            </div>
          </div>

          {/* 3. Тексты и приветствие */}
          <div className="space-y-4 rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
              Тексты и приветствие
            </h2>

            <div>
              <label className="text-xs font-medium text-[#666666]">Заголовок виджета</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Онлайн-консультант"
                className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[#666666]">
                Приветственное сообщение
              </label>
              <textarea
                value={greeting}
                onChange={(e) => setGreeting(e.target.value)}
                rows={3}
                placeholder="Здравствуйте! Чем я могу вам помочь?"
                className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <p className="mt-1 text-xs text-[#888888]">
                Показывается посетителю при первом открытии окна чата.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-[#666666]">Плейсхолдер поля ввода</label>
              <input
                type="text"
                value={placeholder}
                onChange={(e) => setPlaceholder(e.target.value)}
                placeholder="Напишите сообщение..."
                className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          {/* 4. Позиция на экране */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
              Позиция на экране
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPosition("bottom-right")}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  position === "bottom-right"
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                <p className="text-xs font-semibold">Справа внизу</p>
                <p className="mt-0.5 text-[11px] text-[#888888]">Стандартное размещение</p>
              </button>

              <button
                type="button"
                onClick={() => setPosition("bottom-left")}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  position === "bottom-left"
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                <p className="text-xs font-semibold">Слева внизу</p>
                <p className="mt-0.5 text-[11px] text-[#888888]">Для сайтов с правой кнопкой звонка</p>
              </button>
            </div>
          </div>

          {/* 5. Переход в Telegram-бот */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
                  Баннер перехода в Telegram
                </h2>
                <p className="mt-0.5 text-xs text-[#666666]">
                  Предлагает посетителю продолжить диалог в мессенджере.
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={showTelegramBanner}
                  onChange={(e) => setShowTelegramBanner(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-[#e5e5e5] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-xs after:transition-all after:content-[''] peer-checked:bg-[#4a38f5] peer-checked:after:translate-x-full"></div>
              </label>
            </div>

            {showTelegramBanner && (
              <div className="mt-4 border-t border-[#e5e5e5] pt-4">
                <label className="text-xs font-medium text-[#666666]">
                  Юзернейм бота Telegram (@username или ссылка t.me/...)
                </label>
                <input
                  type="text"
                  value={telegramBot}
                  onChange={(e) => setTelegramBot(e.target.value)}
                  placeholder="@company_ai_bot"
                  className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
            )}
          </div>
        </div>

        {/* Правая колонка: интерактивный Live Preview */}
        <div className="lg:col-span-6">
          <div className="sticky top-6 rounded-2xl border border-[#e5e5e5] bg-white p-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="h-3 w-3 rounded-full bg-rose-400"></div>
                  <div className="h-3 w-3 rounded-full bg-[#4a38f5]"></div>
                  <div className="h-3 w-3 rounded-full bg-emerald-400"></div>
                </div>
                <div className="ml-2 flex items-center gap-1 rounded bg-[#fafafa] border border-[#e5e5e5] px-3 py-1 text-xs text-[#666666]">
                  <span>https://{account.externalId}</span>
                  <ExternalLink className="h-3 w-3 text-[#888888]" />
                </div>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium text-[#4a38f5]">
                <Sparkles className="h-3.5 w-3.5" />
                Live Preview
              </span>
            </div>

            {/* Макет сайта */}
            <div
              className={cn(
                "relative mt-3 h-[580px] overflow-hidden rounded-xl border border-[#e5e5e5] p-4 transition-colors",
                isDark ? "bg-[#18181b] text-white" : "bg-[#f8fafc] text-[#111111]",
              )}
            >
              {/* Фоновые псевдо-элементы страницы */}
              <div className="space-y-4 opacity-40">
                <div className="flex items-center justify-between border-b border-current pb-2">
                  <div className="h-4 w-28 rounded bg-current opacity-60"></div>
                  <div className="flex gap-3">
                    <div className="h-3 w-12 rounded bg-current opacity-40"></div>
                    <div className="h-3 w-12 rounded bg-current opacity-40"></div>
                    <div className="h-3 w-12 rounded bg-current opacity-40"></div>
                  </div>
                </div>
                <div className="h-28 rounded-lg bg-current opacity-10"></div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="h-20 rounded bg-current opacity-15"></div>
                  <div className="h-20 rounded bg-current opacity-15"></div>
                  <div className="h-20 rounded bg-current opacity-15"></div>
                </div>
              </div>

              {/* Виджет чата */}
              <div
                className={cn(
                  "absolute bottom-4 flex flex-col transition-all duration-300",
                  position === "bottom-right" ? "right-4 items-end" : "left-4 items-start",
                )}
              >
                {/* Окно диалога */}
                {previewOpen && (
                  <div
                    className={cn(
                      "mb-3 flex h-[460px] w-80 flex-col overflow-hidden rounded-2xl border shadow-2xl transition-all duration-200",
                      isDark
                        ? "border-[#27272a] bg-[#111111] text-white"
                        : "border-[#e5e5e5] bg-white text-[#111111]",
                    )}
                  >
                    {/* Шапка виджета */}
                    <div
                      className="flex items-center justify-between p-3.5 text-white shadow-md"
                      style={{ backgroundColor: accentColor }}
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="relative flex h-8 w-8 items-center justify-center rounded-full bg-black/15">
                          <Bot className="h-5 w-5 text-white" />
                          <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border border-white bg-emerald-500"></span>
                        </div>
                        <div>
                          <p className="text-xs font-bold leading-tight text-white">{title}</p>
                          <p className="text-[10px] font-medium opacity-80">
                            {account.boundAgentName ? account.boundAgentName : "В сети · AI онлайн"}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setPreviewOpen(false)}
                        className="rounded-full p-1 transition-colors hover:bg-black/10 text-white"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Баннер Telegram */}
                    {showTelegramBanner && (
                      <div className="flex items-center justify-between border-b border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-400">
                        <div className="flex items-center gap-1.5">
                          <Send className="h-3.5 w-3.5 text-sky-400" />
                          <span>Продолжить в Telegram</span>
                        </div>
                        <span className="text-[10px] underline">
                          {telegramBot || "@bot"}
                        </span>
                      </div>
                    )}

                    {/* Тело сообщений */}
                    <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
                      {/* Приветствие бота */}
                      <div className="flex items-start gap-2">
                        <div
                          className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
                          style={{ backgroundColor: accentColor }}
                        >
                          <Bot className="h-3.5 w-3.5" />
                        </div>
                        <div
                          className={cn(
                            "max-w-[85%] rounded-2xl rounded-tl-sm p-3 leading-relaxed shadow-sm",
                            isDark
                              ? "bg-[#18181b] text-zinc-200 border border-[#27272a]"
                              : "bg-[#f5f5f5] text-[#111111] border border-[#e5e5e5]",
                          )}
                        >
                          {greeting}
                        </div>
                      </div>

                      {/* Пример ответа пользователя */}
                      <div className="flex justify-end">
                        <div
                          className="max-w-[80%] rounded-2xl rounded-tr-sm p-2.5 leading-relaxed text-white shadow-sm"
                          style={{ backgroundColor: accentColor }}
                        >
                          Здравствуйте! Хочу уточнить детали тарифа.
                        </div>
                      </div>
                    </div>

                    {/* Поле ввода сообщения */}
                    <div
                      className={cn(
                        "border-t p-2.5",
                        isDark ? "border-[#27272a] bg-[#18181b]/50" : "border-[#e5e5e5] bg-[#fafafa]",
                      )}
                    >
                      <div className="flex items-center gap-1.5 rounded-xl border border-[#e5e5e5] bg-transparent px-2.5 py-1.5">
                        <input
                          type="text"
                          readOnly
                          placeholder={placeholder}
                          className="w-full bg-transparent text-xs text-[#111111] placeholder:text-[#888888] focus:outline-none"
                        />
                        <button
                          type="button"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-white transition-transform active:scale-90"
                          style={{ backgroundColor: accentColor }}
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Плавающая кнопка вызова виджета */}
                <button
                  type="button"
                  onClick={() => setPreviewOpen(!previewOpen)}
                  className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl transition-transform hover:scale-105 active:scale-95"
                  style={{ backgroundColor: accentColor }}
                >
                  {previewOpen ? (
                    <X className="h-6 w-6 stroke-[2.5]" />
                  ) : (
                    <MessageSquare className="h-6 w-6 stroke-[2.5]" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
