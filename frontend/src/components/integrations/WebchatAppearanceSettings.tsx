"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  ExternalLink,
  Laptop,
  Link2,
  Loader2,
  MessageSquare,
  Moon,
  Palette,
  Send,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelAccountDTO } from "@/lib/api/use-channels";
import { useChannelAccounts, useUpdateChannelAccount } from "@/lib/api/use-channels";

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

const AVATAR_PRESETS = [
  {
    name: "Анна",
    role: "Консультант",
    avatar: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80",
  },
  {
    name: "Максим",
    role: "Продажи",
    avatar: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150&auto=format&fit=crop&q=80",
  },
  {
    name: "Елена",
    role: "Поддержка",
    avatar: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150&auto=format&fit=crop&q=80",
  },
  {
    name: "Денис",
    role: "Эксперт",
    avatar: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150&auto=format&fit=crop&q=80",
  },
];

async function resizeImageFile(file: File, maxSize: number = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(e.target?.result as string);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.88));
      };
      img.onerror = () => reject(new Error("Не удалось прочитать изображение"));
      img.src = e.target?.result as string;
    };
    reader.onerror = () => reject(new Error("Не удалось загрузить файл"));
    reader.readAsDataURL(file);
  });
}

export function WebchatAppearanceSettings({ account, onBack }: WebchatAppearanceSettingsProps) {
  const updateAccount = useUpdateChannelAccount("webchat");

  // Загружаем список подключений Telegram (личные аккаунты и боты)
  const { data: tgPersonalData } = useChannelAccounts("telegram");
  const { data: tgBotData } = useChannelAccounts("telegram_bot");

  const personalAccounts = useMemo(() => tgPersonalData?.items ?? [], [tgPersonalData]);
  const botAccounts = useMemo(() => tgBotData?.items ?? [], [tgBotData]);
  const hasSystemTgAccounts = personalAccounts.length > 0 || botAccounts.length > 0;

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

  // Консультант: фото и имя
  const [consultantName, setConsultantName] = useState<string>(
    typeof initialCreds.consultantName === "string" ? initialCreds.consultantName : "",
  );
  const [consultantAvatar, setConsultantAvatar] = useState<string>(
    typeof initialCreds.consultantAvatar === "string" ? initialCreds.consultantAvatar : "",
  );
  const [showAvatarUrlInput, setShowAvatarUrlInput] = useState<boolean>(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState<boolean>(false);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);

  // Telegram-баннер и выбор аккаунта/бота
  const [showTelegramBanner, setShowTelegramBanner] = useState<boolean>(
    Boolean(initialCreds.showTelegramBanner),
  );
  const [telegramBot, setTelegramBot] = useState<string>(
    typeof initialCreds.telegramBot === "string" ? initialCreds.telegramBot : "",
  );
  const [telegramAccountId, setTelegramAccountId] = useState<string>(
    typeof initialCreds.telegramAccountId === "string" ? initialCreds.telegramAccountId : "",
  );
  const [telegramMode, setTelegramMode] = useState<"system" | "manual">(
    initialCreds.telegramMode === "system" || (!initialCreds.telegramMode && initialCreds.telegramAccountId)
      ? "system"
      : "manual",
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

  const handleAvatarFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsUploadingAvatar(true);
      const dataUrl = await resizeImageFile(file, 256);
      setConsultantAvatar(dataUrl);
    } catch {
      // Игнорируем ошибку чтения файла
    } finally {
      setIsUploadingAvatar(false);
      if (avatarFileInputRef.current) {
        avatarFileInputRef.current.value = "";
      }
    }
  };

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
          telegramAccountId: telegramMode === "system" ? telegramAccountId : undefined,
          telegramMode,
          consultantName: consultantName.trim(),
          consultantAvatar: consultantAvatar.trim(),
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

          {/* 3. Консультант чата (Фото и Имя) */}
          <div className="space-y-4 rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-[#4a38f5]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
                Консультант чата
              </h2>
            </div>
            <p className="text-xs text-[#666666]">
              Персонализируйте онлайн-чат: установите реальное фото и имя консультанта для повышения доверия посетителей сайта.
            </p>

            {/* Фото консультанта */}
            <div>
              <label className="text-xs font-medium text-[#666666]">Фото консультанта (аватар)</label>
              <div className="mt-2 flex items-center gap-4">
                {/* Круглая миниатюра аватара */}
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#e5e5e5] bg-[#f5f5f5] shadow-xs">
                  {consultantAvatar ? (
                    <img
                      src={consultantAvatar}
                      alt={consultantName || "Консультант"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-6 w-6 text-[#888888]" />
                  )}
                  {consultantAvatar && (
                    <button
                      type="button"
                      onClick={() => setConsultantAvatar("")}
                      className="absolute inset-0 flex items-center justify-center bg-black/50 text-white opacity-0 transition-opacity hover:opacity-100 cursor-pointer"
                      title="Удалить фото"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="file"
                      ref={avatarFileInputRef}
                      accept="image/*"
                      onChange={handleAvatarFileSelect}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => avatarFileInputRef.current?.click()}
                      disabled={isUploadingAvatar}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] hover:border-[#cccccc] hover:bg-[#fafafa] transition-colors cursor-pointer"
                    >
                      {isUploadingAvatar ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                      ) : (
                        <Upload className="h-3.5 w-3.5 text-[#666666]" />
                      )}
                      <span>Загрузить фото</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowAvatarUrlInput((v) => !v)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
                    >
                      <Link2 className="h-3.5 w-3.5 text-[#666666]" />
                      <span>{showAvatarUrlInput ? "Скрыть URL" : "Указать ссылку"}</span>
                    </button>

                    {consultantAvatar && (
                      <button
                        type="button"
                        onClick={() => setConsultantAvatar("")}
                        className="inline-flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 transition-colors p-1 cursor-pointer"
                        title="Сбросить фото"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Удалить</span>
                      </button>
                    )}
                  </div>

                  {showAvatarUrlInput && (
                    <div className="pt-1">
                      <input
                        type="text"
                        value={consultantAvatar}
                        onChange={(e) => setConsultantAvatar(e.target.value)}
                        placeholder="https://example.com/avatar.jpg"
                        className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                      />
                    </div>
                  )}

                  <p className="text-[11px] text-[#888888]">
                    PNG, JPG или WebP до 5 МБ. Изображение автоматически оптимизируется.
                  </p>
                </div>
              </div>

              {/* Готовые пресеты аватаров */}
              <div className="mt-3 pt-3 border-t border-[#f0f0f0]">
                <span className="text-[11px] font-medium text-[#888888]">Или выберите готовый аватар:</span>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {AVATAR_PRESETS.map((preset) => {
                    const isSelected = consultantAvatar === preset.avatar;
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => {
                          setConsultantAvatar(preset.avatar);
                          if (!consultantName) {
                            setConsultantName(preset.name);
                          }
                        }}
                        className={cn(
                          "flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] font-medium"
                            : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                        )}
                      >
                        <img
                          src={preset.avatar}
                          alt={preset.name}
                          className="h-5 w-5 rounded-full object-cover"
                        />
                        <span>{preset.name}</span>
                        <span className="text-[10px] text-[#888888]">({preset.role})</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Имя консультанта */}
            <div>
              <label className="text-xs font-medium text-[#666666]">Имя консультанта</label>
              <input
                type="text"
                value={consultantName}
                onChange={(e) => setConsultantName(e.target.value)}
                placeholder="Например, Анна или Максим (Менеджер)"
                className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <p className="mt-1 text-[11px] text-[#888888]">
                Отображается в шапке окна чата и перед сообщениями консультанта.
              </p>
            </div>
          </div>

          {/* 4. Тексты и приветствие */}
          <div className="space-y-4 rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
              Тексты и приветствие
            </h2>

            <div>
              <label className="text-xs font-medium text-[#666666]">Заголовок / статус виджета</label>
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

          {/* 5. Позиция на экране */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
              Позиция на экране
            </h2>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPosition("bottom-right")}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors cursor-pointer",
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
                  "rounded-lg border p-3 text-left transition-colors cursor-pointer",
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

          {/* 6. Переход в Telegram (Личный аккаунт или Бот) */}
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
              <div className="mt-4 space-y-4 border-t border-[#e5e5e5] pt-4">
                {/* Переключатель способа выбора Telegram: из добавленных в CRM или вручную */}
                <div>
                  <label className="text-xs font-medium text-[#666666] block mb-1.5">
                    Куда направлять посетителя сайта:
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTelegramMode("system")}
                      className={cn(
                        "flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors cursor-pointer",
                        telegramMode === "system"
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                      )}
                    >
                      <Bot className="h-3.5 w-3.5" />
                      <span>Из подключений системы</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTelegramMode("manual")}
                      className={cn(
                        "flex items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-medium transition-colors cursor-pointer",
                        telegramMode === "manual"
                          ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                          : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                      )}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Указать вручную</span>
                    </button>
                  </div>
                </div>

                {/* Вариант 1: Выбор из добавленных в систему личных аккаунтов или ботов */}
                {telegramMode === "system" && (
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-[#666666]">
                      Выберите личный аккаунт или бота:
                    </label>
                    {hasSystemTgAccounts ? (
                      <select
                        value={telegramAccountId}
                        onChange={(e) => {
                          const selectedId = e.target.value;
                          setTelegramAccountId(selectedId);
                          const foundAcc = [...personalAccounts, ...botAccounts].find((a) => a.id === selectedId);
                          if (foundAcc) {
                            const rawId = foundAcc.externalId.trim();
                            const username = rawId.startsWith("@") || rawId.startsWith("http")
                              ? rawId
                              : foundAcc.credentials?.username
                              ? `@${String(foundAcc.credentials.username).replace(/^@/, "")}`
                              : `@${rawId.replace(/^@/, "")}`;
                            setTelegramBot(username);
                          }
                        }}
                        className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 cursor-pointer"
                      >
                        <option value="">-- Выберите подключение из списка --</option>
                        {personalAccounts.length > 0 && (
                          <optgroup label="Личные аккаунты Telegram (MTProto)">
                            {personalAccounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                👤 {acc.label} ({acc.externalId})
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {botAccounts.length > 0 && (
                          <optgroup label="Telegram-боты (Bot API)">
                            {botAccounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                🤖 {acc.label} ({acc.externalId})
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    ) : (
                      <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
                        <p className="font-medium">В системе пока нет подключенных Telegram-аккаунтов или ботов.</p>
                        <p className="mt-1 text-amber-700">
                          Вы можете указать юзернейм вручную или подключить аккаунт в разделе{" "}
                          <a href="/integrations/telegram" className="underline font-semibold hover:text-amber-900">
                            Интеграции → Telegram
                          </a>.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Поле юзернейма / ссылки */}
                <div>
                  <label className="text-xs font-medium text-[#666666]">
                    Юзернейм или ссылка (@username или https://t.me/...)
                  </label>
                  <input
                    type="text"
                    value={telegramBot}
                    onChange={(e) => setTelegramBot(e.target.value)}
                    placeholder="@company_ai_bot или https://t.me/company"
                    className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                  />
                  <p className="mt-1 text-[11px] text-[#888888]">
                    По этой ссылке посетитель перейдёт в мессенджер при клике на баннер.
                  </p>
                </div>
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
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* Аватар консультанта */}
                        <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black/15 overflow-hidden">
                          {consultantAvatar ? (
                            <img
                              src={consultantAvatar}
                              alt={consultantName || "Консультант"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Bot className="h-5 w-5 text-white" />
                          )}
                          <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border border-white bg-emerald-500"></span>
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold leading-tight text-white truncate">
                            {consultantName || title}
                          </p>
                          <p className="text-[10px] font-medium opacity-80 truncate">
                            {consultantName ? title : (account.boundAgentName ? account.boundAgentName : "В сети · Консультант онлайн")}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setPreviewOpen(false)}
                        className="rounded-full p-1 transition-colors hover:bg-black/10 text-white cursor-pointer"
                        title="Закрыть окно"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>

                    {/* Баннер Telegram */}
                    {showTelegramBanner && (
                      <div className="flex items-center justify-between border-b border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-400">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Send className="h-3.5 w-3.5 text-sky-400 shrink-0" />
                          <span className="truncate">Продолжить в Telegram</span>
                        </div>
                        <span className="text-[10px] underline font-mono truncate max-w-[120px]">
                          {telegramBot || "@bot"}
                        </span>
                      </div>
                    )}

                    {/* Тело сообщений */}
                    <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
                      {/* Приветствие консультанта */}
                      <div className="flex items-start gap-2">
                        <div
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white overflow-hidden shadow-xs"
                          style={{ backgroundColor: accentColor }}
                        >
                          {consultantAvatar ? (
                            <img
                              src={consultantAvatar}
                              alt={consultantName || "Консультант"}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <Bot className="h-4 w-4" />
                          )}
                        </div>
                        <div className="flex-1">
                          {consultantName && (
                            <p className="mb-0.5 text-[10px] font-semibold text-[#888888]">{consultantName}</p>
                          )}
                          <div
                            className={cn(
                              "max-w-[90%] rounded-2xl rounded-tl-sm p-3 leading-relaxed shadow-sm",
                              isDark
                                ? "bg-[#18181b] text-zinc-200 border border-[#27272a]"
                                : "bg-[#f5f5f5] text-[#111111] border border-[#e5e5e5]",
                            )}
                          >
                            {greeting}
                          </div>
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
                  className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 cursor-pointer"
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
