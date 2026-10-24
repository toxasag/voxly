"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Camera,
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
  Smile,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelAccountDTO } from "@/lib/api/use-channels";
import { useChannelAccounts, useUpdateChannelAccount } from "@/lib/api/use-channels";
import {
  InteractiveMascot,
  AVAILABLE_MASCOTS,
  type MascotId,
} from "./InteractiveMascot";
import { CreatePhotoMascotModal } from "./CreatePhotoMascotModal";

type WebchatAvatarType = "icon" | "photo" | "mascot";

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

function TelegramIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69a.2.2 0 00-.05-.18c-.06-.05-.14-.03-.21-.02-.09.02-1.49.95-4.22 2.79-.4.27-.76.41-1.08.4-.36-.01-1.04-.2-1.55-.37-.63-.2-1.12-.31-1.08-.66.02-.18.27-.36.75-.55 2.92-1.27 4.86-2.11 5.83-2.51 2.78-1.16 3.35-1.36 3.73-1.36.08 0 .27.02.39.12.1.08.13.19.14.27-.01.06.01.24 0 .38z" />
    </svg>
  );
}

function WhatsAppIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2M12.05 3.67C14.25 3.67 16.31 4.53 17.87 6.09C19.42 7.65 20.28 9.72 20.28 11.92C20.28 16.46 16.58 20.15 12.04 20.15C10.56 20.15 9.11 19.76 7.85 19.01L7.55 18.83L4.43 19.65L5.26 16.61L5.06 16.29C4.24 14.99 3.8 13.47 3.8 11.91C3.81 7.37 7.5 3.67 12.05 3.67M9.53 7.34C9.36 7.34 9.09 7.4 8.87 7.65C8.65 7.89 8.02 8.49 8.02 9.71C8.02 10.93 8.91 12.11 9.03 12.27C9.15 12.44 10.74 14.98 13.23 15.96C15.3 16.77 15.72 16.61 16.17 16.57C16.62 16.53 17.62 15.98 17.83 15.4C18.04 14.81 18.04 14.31 17.98 14.21C17.92 14.1 17.76 14.04 17.51 13.92C17.27 13.79 16.07 13.2 15.85 13.12C15.63 13.04 15.46 13 15.3 13.25C15.13 13.49 14.66 14.04 14.52 14.21C14.38 14.37 14.24 14.4 14 14.27C13.75 14.15 12.96 13.89 12.03 13.06C11.3 12.41 10.81 11.61 10.67 11.36C10.53 11.12 10.65 10.99 10.78 10.86C10.89 10.75 11.03 10.57 11.16 10.42C11.28 10.27 11.32 10.16 11.41 9.99C11.49 9.83 11.45 9.68 11.39 9.56C11.33 9.44 10.83 8.21 10.62 7.71C10.42 7.22 10.21 7.29 10.06 7.28C9.92 7.27 9.75 7.27 9.58 7.27" />
    </svg>
  );
}

function MaxIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

export function WebchatAppearanceSettings({ account, onBack }: WebchatAppearanceSettingsProps) {
  const updateAccount = useUpdateChannelAccount("webchat");

  // Загружаем список подключений всех поддерживаемых мессенджеров
  const { data: tgPersonalData } = useChannelAccounts("telegram");
  const { data: tgBotData } = useChannelAccounts("telegram_bot");
  const { data: waData } = useChannelAccounts("whatsapp");
  const { data: maxData } = useChannelAccounts("max");
  const { data: maxBotData } = useChannelAccounts("max_bot");

  const personalAccounts = useMemo(() => tgPersonalData?.items ?? [], [tgPersonalData]);
  const botAccounts = useMemo(() => tgBotData?.items ?? [], [tgBotData]);
  const waAccounts = useMemo(() => waData?.items ?? [], [waData]);
  const maxAccounts = useMemo(
    () => [...(maxData?.items ?? []), ...(maxBotData?.items ?? [])],
    [maxData, maxBotData],
  );

  const hasSystemTgAccounts = personalAccounts.length > 0 || botAccounts.length > 0;
  const hasSystemWaAccounts = waAccounts.length > 0;
  const hasSystemMaxAccounts = maxAccounts.length > 0;

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

  const initialCustomDirs =
    typeof initialCreds.customMascotDirections === "string"
      ? initialCreds.customMascotDirections
      : "";
  const initialCustomReacts =
    typeof initialCreds.customMascotReactions === "string"
      ? initialCreds.customMascotReactions
      : "";

  // Тип аватара и маскота
  const [avatarType, setAvatarType] = useState<WebchatAvatarType>(() => {
    if (
      initialCreds.avatarType === "mascot" ||
      initialCreds.avatarType === "photo" ||
      initialCreds.avatarType === "icon"
    ) {
      if (initialCreds.mascotId === "custom" || initialCustomDirs) {
        return "mascot";
      }
      return initialCreds.avatarType as WebchatAvatarType;
    }
    return initialCustomDirs ? "mascot" : (initialCreds.consultantAvatar ? "photo" : "mascot");
  });
  const [mascotId, setMascotId] = useState<MascotId>(() => {
    if (typeof initialCreds.mascotId === "string" && initialCreds.mascotId) {
      return initialCreds.mascotId as MascotId;
    }
    return initialCustomDirs ? "custom" : "ballerina";
  });
  const [customDirections, setCustomDirections] = useState<string>(initialCustomDirs);
  const [customReactions, setCustomReactions] = useState<string>(initialCustomReacts);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [mascotCategory, setMascotCategory] = useState<"all" | "people" | "robots" | "animals">("all");

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

  // Баннер перехода в мессенджеры (Telegram, WhatsApp, MAX)
  const [showMessengerBanner, setShowMessengerBanner] = useState<boolean>(
    initialCreds.showMessengerBanner !== undefined
      ? Boolean(initialCreds.showMessengerBanner)
      : (initialCreds.showTelegramBanner !== undefined ? Boolean(initialCreds.showTelegramBanner) : true),
  );

  const [messengerBannerMode, setMessengerBannerMode] = useState<"single" | "multi">(
    initialCreds.messengerBannerMode === "multi" ? "multi" : "single",
  );

  const [singleTarget, setSingleTarget] = useState<"telegram" | "whatsapp" | "max">(
    initialCreds.singleTarget === "whatsapp" || initialCreds.singleTarget === "max"
      ? initialCreds.singleTarget
      : "telegram",
  );

  // 1. Telegram
  const [telegramEnabled, setTelegramEnabled] = useState<boolean>(
    initialCreds.telegramEnabled !== undefined
      ? Boolean(initialCreds.telegramEnabled)
      : (Boolean(initialCreds.showTelegramBanner) || Boolean(initialCreds.telegramBot)),
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

  // 2. WhatsApp
  const [whatsappEnabled, setWhatsappEnabled] = useState<boolean>(
    Boolean(initialCreds.whatsappEnabled),
  );
  const [whatsappPhone, setWhatsappPhone] = useState<string>(
    typeof initialCreds.whatsappPhone === "string" ? initialCreds.whatsappPhone : "",
  );
  const [whatsappAccountId, setWhatsappAccountId] = useState<string>(
    typeof initialCreds.whatsappAccountId === "string" ? initialCreds.whatsappAccountId : "",
  );
  const [whatsappMode, setWhatsappMode] = useState<"system" | "manual">(
    initialCreds.whatsappMode === "system" || (!initialCreds.whatsappMode && initialCreds.whatsappAccountId)
      ? "system"
      : "manual",
  );

  // 3. MAX
  const [maxEnabled, setMaxEnabled] = useState<boolean>(
    Boolean(initialCreds.maxEnabled),
  );
  const [maxLink, setMaxLink] = useState<string>(
    typeof initialCreds.maxLink === "string" ? initialCreds.maxLink : "",
  );
  const [maxAccountId, setMaxAccountId] = useState<string>(
    typeof initialCreds.maxAccountId === "string" ? initialCreds.maxAccountId : "",
  );
  const [maxMode, setMaxMode] = useState<"system" | "manual">(
    initialCreds.maxMode === "system" || (!initialCreds.maxMode && initialCreds.maxAccountId)
      ? "system"
      : "manual",
  );

  // 4. Проактивное авто-открытие чата
  const [proactiveEnabled, setProactiveEnabled] = useState<boolean>(
    Boolean(initialCreds.proactiveEnabled),
  );
  const [proactiveDelaySeconds, setProactiveDelaySeconds] = useState<number>(
    typeof initialCreds.proactiveDelaySeconds === "number" && initialCreds.proactiveDelaySeconds > 0
      ? initialCreds.proactiveDelaySeconds
      : 10,
  );
  const [proactiveMessage, setProactiveMessage] = useState<string>(
    typeof initialCreds.proactiveMessage === "string" && initialCreds.proactiveMessage.trim().length > 0
      ? initialCreds.proactiveMessage.trim()
      : "Здравствуйте! Я онлайн, спрашивайте — готов вам помочь.",
  );

  // 5. Всплывающая подсказка возле кнопки (Бейдж и сменяющиеся фразы)
  const [badgeEnabled, setBadgeEnabled] = useState<boolean>(
    initialCreds.badgeEnabled !== undefined ? Boolean(initialCreds.badgeEnabled) : true,
  );
  const [badgeTextsInput, setBadgeTextsInput] = useState<string>(() => {
    if (Array.isArray(initialCreds.badgeTexts) && initialCreds.badgeTexts.length > 0) {
      return (initialCreds.badgeTexts as string[]).join("\n");
    }
    if (typeof initialCreds.badgeTexts === "string" && initialCreds.badgeTexts.trim()) {
      return initialCreds.badgeTexts.trim();
    }
    if (typeof initialCreds.badgeText === "string" && initialCreds.badgeText.trim()) {
      return initialCreds.badgeText.trim();
    }
    return "Задайте вопрос\nЯ онлайн, спрашивайте\nЧем помочь вам?\nЯ еще тут, давайте подскажу";
  });
  const [badgeRotateIntervalSec, setBadgeRotateIntervalSec] = useState<number>(
    typeof initialCreds.badgeRotateIntervalSec === "number" && initialCreds.badgeRotateIntervalSec >= 2
      ? initialCreds.badgeRotateIntervalSec
      : (typeof initialCreds.badgeRotateIntervalSec === "string" && parseInt(initialCreds.badgeRotateIntervalSec, 10) >= 2
          ? parseInt(initialCreds.badgeRotateIntervalSec, 10)
          : 5),
  );

  const parsedBadgeTexts = useMemo(() => {
    const list = badgeTextsInput
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return list.length > 0 ? list : ["Задайте вопрос"];
  }, [badgeTextsInput]);

  // Ротация фраз для Live Preview
  const [previewBadgeIdx, setPreviewBadgeIdx] = useState(0);
  const [badgeAnimating, setBadgeAnimating] = useState(false);

  useEffect(() => {
    if (parsedBadgeTexts.length <= 1) {
      setPreviewBadgeIdx(0);
      return;
    }
    const intervalMs = Math.max(2, badgeRotateIntervalSec) * 1000;
    const timer = setInterval(() => {
      setBadgeAnimating(true);
      setTimeout(() => {
        setPreviewBadgeIdx((prev) => (prev + 1) % parsedBadgeTexts.length);
        setBadgeAnimating(false);
      }, 250);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [parsedBadgeTexts, badgeRotateIntervalSec]);

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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
    setSaveError(null);
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
          // Мессенджеры
          showMessengerBanner,
          messengerBannerMode,
          singleTarget,
          // Telegram
          telegramEnabled: messengerBannerMode === "single" ? singleTarget === "telegram" : telegramEnabled,
          telegramBot: telegramBot.trim(),
          telegramAccountId: telegramMode === "system" ? telegramAccountId : undefined,
          telegramMode,
          showTelegramBanner: showMessengerBanner && (messengerBannerMode === "single" ? singleTarget === "telegram" : telegramEnabled),
          // WhatsApp
          whatsappEnabled: messengerBannerMode === "single" ? singleTarget === "whatsapp" : whatsappEnabled,
          whatsappPhone: whatsappPhone.trim(),
          whatsappAccountId: whatsappMode === "system" ? whatsappAccountId : undefined,
          whatsappMode,
          // MAX
          maxEnabled: messengerBannerMode === "single" ? singleTarget === "max" : maxEnabled,
          maxLink: maxLink.trim(),
          maxAccountId: maxMode === "system" ? maxAccountId : undefined,
          maxMode,
          // Консультант и маскот
          consultantName: consultantName.trim(),
          consultantAvatar: consultantAvatar.trim(),
          avatarType,
          mascotId,
          customMascotDirections: customDirections,
          customMascotReactions: customReactions,
          // Проактивное авто-открытие
          proactiveEnabled,
          proactiveDelaySeconds,
          proactiveMessage: proactiveMessage.trim(),
          // Бейдж-подсказка возле кнопки и сменяющиеся фразы
          badgeEnabled,
          badgeText: parsedBadgeTexts[0] || "Задайте вопрос",
          badgeTexts: parsedBadgeTexts,
          badgeRotateIntervalSec,
          badgeIntervalSeconds: badgeRotateIntervalSec,
        },
      },
      {
        onSuccess: () => {
          setSavedSuccess(true);
          setSaveError(null);
        },
        onError: (err) => {
          setSaveError(err.message || "Ошибка при сохранении настроек виджета");
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
          {saveError && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-lg">
              <AlertCircle className="h-3.5 w-3.5" />
              {saveError}
            </span>
          )}
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
            className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#3b2be0] disabled:opacity-50 cursor-pointer"
          >
            {updateAccount.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            {updateAccount.isPending ? "Сохранение..." : "Сохранить настройки"}
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

          {/* 3. Иконка и аватар виджета (Маскот / Фото / Иконка) */}
          <div className="space-y-4 rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <div className="flex items-center gap-2">
              <Smile className="h-4 w-4 text-[#4a38f5]" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
                Оформление кнопки и аватара
              </h2>
            </div>
            <p className="text-xs text-[#666666]">
              Выберите, как виджет выглядит на вашем сайте: живой 3D-маскот, фото реального менеджера или классическая лаконичная кнопка.
            </p>

            {/* Переключатель 3 вариантов */}
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setAvatarType("mascot")}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all cursor-pointer",
                  avatarType === "mascot"
                    ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] ring-1 ring-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
                  <Bot className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold">3D-Маскот</span>
                <span className="text-[10px] text-[#888888] leading-tight">Следит за курсором</span>
              </button>

              <button
                type="button"
                onClick={() => setAvatarType("photo")}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all cursor-pointer",
                  avatarType === "photo"
                    ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] ring-1 ring-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
                  <User className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold">Фото менеджера</span>
                <span className="text-[10px] text-[#888888] leading-tight">Персональное доверие</span>
              </button>

              <button
                type="button"
                onClick={() => setAvatarType("icon")}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition-all cursor-pointer",
                  avatarType === "icon"
                    ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] ring-1 ring-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
                  <MessageSquare className="h-5 w-5" />
                </div>
                <span className="text-xs font-semibold">Классика</span>
                <span className="text-[10px] text-[#888888] leading-tight">Минимализм иконки</span>
              </button>
            </div>

            {/* Настройки для 3D-маскота */}
            {avatarType === "mascot" && (
              <div className="mt-3 space-y-4 rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4">
                {/* Панель фильтров и кнопка создания по фото */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e5e5] pb-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setMascotCategory("all")}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                        mascotCategory === "all"
                          ? "bg-[#4a38f5] text-white"
                          : "bg-white border border-[#e5e5e5] text-[#666666] hover:text-[#111111]",
                      )}
                    >
                      Все ({AVAILABLE_MASCOTS.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMascotCategory("people")}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                        mascotCategory === "people"
                          ? "bg-[#4a38f5] text-white"
                          : "bg-white border border-[#e5e5e5] text-[#666666] hover:text-[#111111]",
                      )}
                    >
                      Люди (Девушки, Камран...)
                    </button>
                    <button
                      type="button"
                      onClick={() => setMascotCategory("robots")}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                        mascotCategory === "robots"
                          ? "bg-[#4a38f5] text-white"
                          : "bg-white border border-[#e5e5e5] text-[#666666] hover:text-[#111111]",
                      )}
                    >
                      Роботы
                    </button>
                    <button
                      type="button"
                      onClick={() => setMascotCategory("animals")}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                        mascotCategory === "animals"
                          ? "bg-[#4a38f5] text-white"
                          : "bg-white border border-[#e5e5e5] text-[#666666] hover:text-[#111111]",
                      )}
                    >
                      Животные (Кот, Лис...)
                    </button>
                  </div>

                  {/* Кнопка создания по фото */}
                  <button
                    type="button"
                    onClick={() => setIsPhotoModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#4a38f5]/30 bg-[#4a38f5]/10 px-3 py-1.5 text-xs font-semibold text-[#4a38f5] hover:bg-[#4a38f5]/15 transition-colors cursor-pointer shadow-2xs"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Сделать маскота по фото</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {/* Карточка создания своего маскота по фото */}
                  <div
                    onClick={() => setIsPhotoModalOpen(true)}
                    className="group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#4a38f5]/40 bg-white p-3 text-center transition-all hover:border-[#4a38f5] hover:bg-[#4a38f5]/5 cursor-pointer min-h-[170px]"
                  >
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#4a38f5]/10 text-[#4a38f5] group-hover:scale-110 transition-transform">
                      <Camera className="h-6 w-6" />
                    </div>
                    <span className="mt-2 text-xs font-bold text-[#4a38f5]">
                      Сделать по фото
                    </span>
                    <p className="mt-0.5 text-[10px] text-[#666666] leading-tight">
                      Генерация чиби по вашему селфи
                    </p>
                  </div>

                  {/* Если есть кастомный маскот по фото */}
                  {customDirections && (
                    <div
                      onClick={() => setMascotId("custom")}
                      className={cn(
                        "group relative flex flex-col items-center rounded-xl border p-3 transition-all cursor-pointer bg-white text-center",
                        mascotId === "custom"
                          ? "border-[#4a38f5] shadow-xs ring-2 ring-[#4a38f5]/20"
                          : "border-[#e5e5e5] hover:border-[#cccccc] hover:shadow-2xs",
                      )}
                    >
                      <span className="absolute top-2 right-2 rounded bg-emerald-100 text-emerald-800 px-1.5 py-0.5 text-[9px] font-bold">
                        Мой аватар
                      </span>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCustomDirections("");
                          setCustomReactions("");
                          if (mascotId === "custom") {
                            setMascotId("ballerina");
                          }
                        }}
                        className="absolute top-2 left-2 rounded p-1 text-[#888888] hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer"
                        title="Удалить своего маскота"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>

                      <div className="my-1.5">
                        <InteractiveMascot
                          mascotId="custom"
                          customDirections={customDirections}
                          customReactions={customReactions || customDirections}
                          size={70}
                          interactive={true}
                        />
                      </div>

                      <span className="text-xs font-bold text-[#111111] group-hover:text-[#4a38f5]">
                        Из моего фото
                      </span>
                      <p className="mt-0.5 text-[10px] text-[#888888]">
                        Пользовательский спрайт
                      </p>

                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsPhotoModalOpen(true);
                          }}
                          className="text-[11px] text-[#4a38f5] font-semibold underline hover:text-[#3d2ee0] cursor-pointer"
                        >
                          Изменить
                        </button>

                        {mascotId === "custom" && (
                          <div className="flex items-center gap-1 text-[11px] font-semibold text-[#4a38f5]">
                            <Check className="h-3 w-3 stroke-[3]" />
                            <span>Выбран</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Каталог готовых персонажей */}
                  {AVAILABLE_MASCOTS.filter(
                    (m) => mascotCategory === "all" || m.category === mascotCategory,
                  ).map((m) => {
                    const isSelected = mascotId === m.id;
                    return (
                      <div
                        key={m.id}
                        onClick={() => {
                          setMascotId(m.id);
                          if (!consultantName) {
                            setConsultantName(m.name);
                          }
                        }}
                        className={cn(
                          "group relative flex flex-col items-center rounded-xl border p-3 transition-all cursor-pointer bg-white text-center",
                          isSelected
                            ? "border-[#4a38f5] shadow-xs ring-2 ring-[#4a38f5]/20"
                            : "border-[#e5e5e5] hover:border-[#cccccc] hover:shadow-2xs",
                        )}
                      >
                        {m.badge && (
                          <span className="absolute top-2 right-2 rounded bg-[#f0f0f0] px-1.5 py-0.5 text-[9px] font-medium text-[#666666]">
                            {m.badge}
                          </span>
                        )}

                        <div className="my-1.5">
                          <InteractiveMascot
                            mascotId={m.id}
                            size={70}
                            interactive={true}
                          />
                        </div>

                        <span className="text-xs font-bold text-[#111111] group-hover:text-[#4a38f5]">
                          {m.name}
                        </span>
                        <p className="mt-0.5 text-[10px] text-[#888888] leading-tight line-clamp-2">
                          {m.description}
                        </p>

                        {isSelected && (
                          <div className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-[#4a38f5]">
                            <Check className="h-3 w-3 stroke-[3]" />
                            <span>Выбран</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Настройки для Фото менеджера */}
            {avatarType === "photo" && (
              <div className="mt-3 space-y-4 rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-4">
                <div>
                  <label className="text-xs font-medium text-[#666666]">Фото сотрудника (аватар)</label>
                  <div className="mt-2 flex items-center gap-4">
                    {/* Круглая миниатюра аватара */}
                    <div className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-[#e5e5e5] bg-white shadow-xs">
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
                          <span>Загрузить своё фото</span>
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
                        PNG, JPG или WebP. Рекомендуется квадратное фото с чётким лицом.
                      </p>
                    </div>
                  </div>

                  {/* Готовые пресеты аватаров */}
                  <div className="mt-3 pt-3 border-t border-[#e5e5e5]">
                    <span className="text-[11px] font-medium text-[#888888]">Или выберите пример сотрудника:</span>
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
              </div>
            )}

            {/* Имя консультанта / ассистента */}
            <div>
              <label className="text-xs font-medium text-[#666666]">
                {avatarType === "mascot"
                  ? "Имя маскота / ассистента"
                  : avatarType === "photo"
                  ? "Имя сотрудника"
                  : "Название ассистента"}
              </label>
              <input
                type="text"
                value={consultantName}
                onChange={(e) => setConsultantName(e.target.value)}
                placeholder={
                  avatarType === "mascot"
                    ? "Вокси (AI-помощник)"
                    : avatarType === "photo"
                    ? "Анна (Консультант)"
                    : "Онлайн-консультант"
                }
                className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <p className="mt-1 text-[11px] text-[#888888]">
                Отображается в шапке окна чата и перед сообщениями посетителям сайта.
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

          {/* Всплывающая подсказка возле кнопки (Бейдж и сменяющиеся фразы) */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
                    Подсказка возле кнопки (Бейдж)
                  </h2>
                  <p className="mt-0.5 text-xs text-[#666666]">
                    Текст сбоку от кнопки чата, привлекающий внимание посетителя сайта.
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={badgeEnabled}
                  onChange={(e) => setBadgeEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#e5e5e5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#cccccc] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#4a38f5]"></div>
              </label>
            </div>

            {badgeEnabled && (
              <div className="space-y-4 pt-1">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-[#111111]">
                      Текст или сменяющиеся фразы (каждая с новой строки)
                    </label>
                    <span className="text-[11px] font-mono text-[#888888]">
                      Фраз: {parsedBadgeTexts.length}
                    </span>
                  </div>
                  <textarea
                    rows={4}
                    value={badgeTextsInput}
                    onChange={(e) => setBadgeTextsInput(e.target.value)}
                    placeholder="Задайте вопрос&#10;Я онлайн, спрашивайте&#10;Чем помочь вам?&#10;Я еще тут, давайте подскажу"
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white p-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono leading-relaxed"
                  />
                  <p className="mt-1 text-[11px] text-[#888888]">
                    Если указано несколько фраз — они будут по очереди плавно сменять друг друга, стимулируя начать диалог.
                  </p>

                  {/* Быстрые шаблоны фраз */}
                  <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-medium text-[#888888]">Шаблоны:</span>
                    <button
                      type="button"
                      onClick={() =>
                        setBadgeTextsInput("Задайте вопрос\nЯ онлайн, спрашивайте\nЧем помочь вам?\nЯ еще тут, давайте подскажу")
                      }
                      className="rounded bg-[#fafafa] border border-[#e5e5e5] px-2 py-0.5 text-[10px] text-[#666666] hover:border-[#cccccc] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      Дружелюбный (4 фразы)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBadgeTextsInput("Онлайн-консультант\nОтветим за 1 минуту\nПоможем с выбором")
                      }
                      className="rounded bg-[#fafafa] border border-[#e5e5e5] px-2 py-0.5 text-[10px] text-[#666666] hover:border-[#cccccc] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      Быстрый ответ (3 фразы)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBadgeTextsInput("Задайте вопрос")}
                      className="rounded bg-[#fafafa] border border-[#e5e5e5] px-2 py-0.5 text-[10px] text-[#666666] hover:border-[#cccccc] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      Один текст (статично)
                    </button>
                  </div>

                  {/* Быстрое добавление отдельных фраз */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-medium text-[#888888]">Добавить фразу:</span>
                    <button
                      type="button"
                      onClick={() =>
                        setBadgeTextsInput((prev) =>
                          prev.trim().length > 0 ? prev.trim() + "\nЯ онлайн, спрашивайте" : "Я онлайн, спрашивайте"
                        )
                      }
                      className="rounded bg-white border border-[#e5e5e5] px-2 py-0.5 text-[10px] text-[#4a38f5] hover:bg-[#4a38f5]/5 hover:border-[#4a38f5] transition-colors cursor-pointer"
                    >
                      + «Я онлайн, спрашивайте»
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBadgeTextsInput((prev) =>
                          prev.trim().length > 0 ? prev.trim() + "\nЧем помочь вам?" : "Чем помочь вам?"
                        )
                      }
                      className="rounded bg-white border border-[#e5e5e5] px-2 py-0.5 text-[10px] text-[#4a38f5] hover:bg-[#4a38f5]/5 hover:border-[#4a38f5] transition-colors cursor-pointer"
                    >
                      + «Чем помочь вам?»
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBadgeTextsInput((prev) =>
                          prev.trim().length > 0 ? prev.trim() + "\nЯ еще тут, давайте подскажу" : "Я еще тут, давайте подскажу"
                        )
                      }
                      className="rounded bg-white border border-[#e5e5e5] px-2 py-0.5 text-[10px] text-[#4a38f5] hover:bg-[#4a38f5]/5 hover:border-[#4a38f5] transition-colors cursor-pointer"
                    >
                      + «Я еще тут, давайте подскажу»
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setBadgeTextsInput((prev) =>
                          prev.trim().length > 0 ? prev.trim() + "\nЗдравствуйте! Чем могу помочь?" : "Здравствуйте! Чем могу помочь?"
                        )
                      }
                      className="rounded bg-white border border-[#e5e5e5] px-2 py-0.5 text-[10px] text-[#4a38f5] hover:bg-[#4a38f5]/5 hover:border-[#4a38f5] transition-colors cursor-pointer"
                    >
                      + «Здравствуйте! Чем могу помочь?»
                    </button>
                  </div>
                </div>

                {parsedBadgeTexts.length > 1 && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-semibold text-[#111111]">
                        Интервал смены надписей
                      </label>
                      <span className="text-xs font-mono font-semibold text-[#4a38f5]">
                        {badgeRotateIntervalSec} сек
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="range"
                        min={2}
                        max={30}
                        step={1}
                        value={badgeRotateIntervalSec}
                        onChange={(e) => setBadgeRotateIntervalSec(parseInt(e.target.value, 10) || 5)}
                        className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-[#e5e5e5] accent-[#4a38f5]"
                      />
                      <input
                        type="number"
                        min={2}
                        max={60}
                        value={badgeRotateIntervalSec}
                        onChange={(e) => setBadgeRotateIntervalSec(Math.max(2, parseInt(e.target.value, 10) || 5))}
                        className="w-16 rounded-lg border border-[#e5e5e5] bg-white px-2 py-1 text-center text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-[#888888]">
                      Рекомендуется 4–7 секунд, чтобы посетитель успел комфортно прочитать текст перед сменой.
                    </p>
                  </div>
                )}
              </div>
            )}
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

          {/* 6. Переход в мессенджеры (Telegram, WhatsApp, MAX) */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wider text-[#111111]">
                  Быстрый переход в мессенджеры
                </h2>
                <p className="mt-0.5 text-xs text-[#666666]">
                  Предлагает посетителю продолжить диалог в удобном мессенджере (Telegram, WhatsApp или MAX).
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={showMessengerBanner}
                  onChange={(e) => setShowMessengerBanner(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-[#e5e5e5] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-xs after:transition-all after:content-[''] peer-checked:bg-[#4a38f5] peer-checked:after:translate-x-full"></div>
              </label>
            </div>

            {showMessengerBanner && (
              <div className="mt-4 space-y-5 border-t border-[#e5e5e5] pt-4">
                {/* Формат отображения в виджете */}
                <div>
                  <label className="text-xs font-semibold text-[#111111] block mb-1.5">
                    Формат отображения в виджете:
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMessengerBannerMode("single")}
                      className={cn(
                        "flex flex-col items-start rounded-lg border p-3 text-left transition-colors cursor-pointer",
                        messengerBannerMode === "single"
                          ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#111111]"
                          : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={cn("h-2.5 w-2.5 rounded-full border", messengerBannerMode === "single" ? "bg-[#4a38f5] border-[#4a38f5]" : "border-zinc-300 bg-white")} />
                        <span className="text-xs font-bold text-[#111111]">Один мессенджер</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#666666] leading-tight">
                        Широкая плашка: «Продолжить в Telegram / WhatsApp / MAX»
                      </p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMessengerBannerMode("multi")}
                      className={cn(
                        "flex flex-col items-start rounded-lg border p-3 text-left transition-colors cursor-pointer",
                        messengerBannerMode === "multi"
                          ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#111111]"
                          : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={cn("h-2.5 w-2.5 rounded-full border", messengerBannerMode === "multi" ? "bg-[#4a38f5] border-[#4a38f5]" : "border-zinc-300 bg-white")} />
                        <span className="text-xs font-bold text-[#111111]">Несколько кнопок на выбор</span>
                      </div>
                      <p className="mt-1 text-[11px] text-[#666666] leading-tight">
                        Компактная полоса с кнопками, чтобы клиент сам выбрал
                      </p>
                    </button>
                  </div>
                </div>

                {/* В одиночном режиме: выбор главного мессенджера */}
                {messengerBannerMode === "single" && (
                  <div>
                    <label className="text-xs font-semibold text-[#111111] block mb-1.5">
                      Выберите мессенджер для плашки:
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setSingleTarget("telegram")}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-lg border py-2 px-3 text-xs font-medium transition-all cursor-pointer",
                          singleTarget === "telegram"
                            ? "border-[#0284c7] bg-[#0284c7]/10 text-[#0284c7] font-semibold"
                            : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                        )}
                      >
                        <TelegramIcon className="h-4 w-4" />
                        <span>Telegram</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSingleTarget("whatsapp")}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-lg border py-2 px-3 text-xs font-medium transition-all cursor-pointer",
                          singleTarget === "whatsapp"
                            ? "border-[#16a34a] bg-[#16a34a]/10 text-[#16a34a] font-semibold"
                            : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                        )}
                      >
                        <WhatsAppIcon className="h-4 w-4" />
                        <span>WhatsApp</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSingleTarget("max")}
                        className={cn(
                          "flex items-center justify-center gap-2 rounded-lg border py-2 px-3 text-xs font-medium transition-all cursor-pointer",
                          singleTarget === "max"
                            ? "border-[#6366f1] bg-[#6366f1]/10 text-[#6366f1] font-semibold"
                            : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                        )}
                      >
                        <MaxIcon className="h-4 w-4" />
                        <span>MAX</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Настройка Telegram */}
                {(messengerBannerMode === "multi" || singleTarget === "telegram") && (
                  <div className="rounded-lg border border-[#e5e5e5] p-3.5 space-y-3 bg-[#fafafa]/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0284c7]/10 text-[#0284c7]">
                          <TelegramIcon className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-[#111111]">Telegram</span>
                      </div>
                      {messengerBannerMode === "multi" && (
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-[#111111]">
                          <input
                            type="checkbox"
                            checked={telegramEnabled}
                            onChange={(e) => setTelegramEnabled(e.target.checked)}
                            className="rounded border-[#cccccc] text-[#0284c7] focus:ring-[#0284c7]"
                          />
                          <span>Показывать кнопку</span>
                        </label>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setTelegramMode("system")}
                          className={cn(
                            "flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            telegramMode === "system"
                              ? "border-[#0284c7] bg-[#0284c7]/10 text-[#0284c7]"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                          )}
                        >
                          <Bot className="h-3.5 w-3.5" />
                          <span>Из подключений</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setTelegramMode("manual")}
                          className={cn(
                            "flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            telegramMode === "manual"
                              ? "border-[#0284c7] bg-[#0284c7]/10 text-[#0284c7]"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                          )}
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>Вручную</span>
                        </button>
                      </div>

                      {telegramMode === "system" ? (
                        hasSystemTgAccounts ? (
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
                            className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] focus:border-[#0284c7] focus:outline-none focus:ring-1 focus:ring-[#0284c7]/20 cursor-pointer"
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
                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-800">
                            <p>В системе пока нет Telegram-подключений. <Link href="/integrations/telegram" className="underline font-semibold hover:text-amber-900">Подключить</Link> или укажите юзернейм вручную.</p>
                          </div>
                        )
                      ) : (
                        <input
                          type="text"
                          value={telegramBot}
                          onChange={(e) => setTelegramBot(e.target.value)}
                          placeholder="@company_ai_bot или https://t.me/company"
                          className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#0284c7] focus:outline-none focus:ring-1 focus:ring-[#0284c7]/20 font-mono"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Настройка WhatsApp */}
                {(messengerBannerMode === "multi" || singleTarget === "whatsapp") && (
                  <div className="rounded-lg border border-[#e5e5e5] p-3.5 space-y-3 bg-[#fafafa]/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#16a34a]/10 text-[#16a34a]">
                          <WhatsAppIcon className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-[#111111]">WhatsApp</span>
                      </div>
                      {messengerBannerMode === "multi" && (
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-[#111111]">
                          <input
                            type="checkbox"
                            checked={whatsappEnabled}
                            onChange={(e) => setWhatsappEnabled(e.target.checked)}
                            className="rounded border-[#cccccc] text-[#16a34a] focus:ring-[#16a34a]"
                          />
                          <span>Показывать кнопку</span>
                        </label>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setWhatsappMode("system")}
                          className={cn(
                            "flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            whatsappMode === "system"
                              ? "border-[#16a34a] bg-[#16a34a]/10 text-[#16a34a]"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                          )}
                        >
                          <Bot className="h-3.5 w-3.5" />
                          <span>Из подключений</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setWhatsappMode("manual")}
                          className={cn(
                            "flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            whatsappMode === "manual"
                              ? "border-[#16a34a] bg-[#16a34a]/10 text-[#16a34a]"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                          )}
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>Вручную</span>
                        </button>
                      </div>

                      {whatsappMode === "system" ? (
                        hasSystemWaAccounts ? (
                          <select
                            value={whatsappAccountId}
                            onChange={(e) => {
                              const selectedId = e.target.value;
                              setWhatsappAccountId(selectedId);
                              const foundAcc = waAccounts.find((a) => a.id === selectedId);
                              if (foundAcc) {
                                setWhatsappPhone(foundAcc.externalId || "");
                              }
                            }}
                            className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] focus:border-[#16a34a] focus:outline-none focus:ring-1 focus:ring-[#16a34a]/20 cursor-pointer"
                          >
                            <option value="">-- Выберите подключение WhatsApp --</option>
                            {waAccounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                💬 {acc.label} ({acc.externalId})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-800">
                            <p>В системе пока нет WhatsApp-подключений. <Link href="/integrations/whatsapp" className="underline font-semibold hover:text-amber-900">Подключить</Link> или укажите номер вручную.</p>
                          </div>
                        )
                      ) : (
                        <input
                          type="text"
                          value={whatsappPhone}
                          onChange={(e) => setWhatsappPhone(e.target.value)}
                          placeholder="+79991234567 или https://wa.me/79991234567"
                          className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#16a34a] focus:outline-none focus:ring-1 focus:ring-[#16a34a]/20 font-mono"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Настройка MAX */}
                {(messengerBannerMode === "multi" || singleTarget === "max") && (
                  <div className="rounded-lg border border-[#e5e5e5] p-3.5 space-y-3 bg-[#fafafa]/50">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#6366f1]/10 text-[#6366f1]">
                          <MaxIcon className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-[#111111]">MAX</span>
                      </div>
                      {messengerBannerMode === "multi" && (
                        <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-[#111111]">
                          <input
                            type="checkbox"
                            checked={maxEnabled}
                            onChange={(e) => setMaxEnabled(e.target.checked)}
                            className="rounded border-[#cccccc] text-[#6366f1] focus:ring-[#6366f1]"
                          />
                          <span>Показывать кнопку</span>
                        </label>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setMaxMode("system")}
                          className={cn(
                            "flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            maxMode === "system"
                              ? "border-[#6366f1] bg-[#6366f1]/10 text-[#6366f1]"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                          )}
                        >
                          <Bot className="h-3.5 w-3.5" />
                          <span>Из подключений</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setMaxMode("manual")}
                          className={cn(
                            "flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-medium transition-colors cursor-pointer",
                            maxMode === "manual"
                              ? "border-[#6366f1] bg-[#6366f1]/10 text-[#6366f1]"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                          )}
                        >
                          <Send className="h-3.5 w-3.5" />
                          <span>Вручную</span>
                        </button>
                      </div>

                      {maxMode === "system" ? (
                        hasSystemMaxAccounts ? (
                          <select
                            value={maxAccountId}
                            onChange={(e) => {
                              const selectedId = e.target.value;
                              setMaxAccountId(selectedId);
                              const foundAcc = maxAccounts.find((a) => a.id === selectedId);
                              if (foundAcc) {
                                const isNumeric = /^\d+$/.test(foundAcc.externalId || "");
                                setMaxLink(isNumeric ? "id505030516451_bot" : (foundAcc.externalId || ""));
                              }
                            }}
                            className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] focus:border-[#6366f1] focus:outline-none focus:ring-1 focus:ring-[#6366f1]/20 cursor-pointer"
                          >
                            <option value="">-- Выберите подключение MAX --</option>
                            {maxAccounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                ⚡ {acc.label} ({acc.externalId})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-800">
                            <p>В системе пока нет MAX-подключений. <Link href="/integrations/max" className="underline font-semibold hover:text-amber-900">Подключить</Link> или укажите юзернейм/ссылку вручную.</p>
                          </div>
                        )
                      ) : (
                        <input
                          type="text"
                          value={maxLink}
                          onChange={(e) => setMaxLink(e.target.value)}
                          placeholder="@company_bot или https://max.ru/company"
                          className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#6366f1] focus:outline-none focus:ring-1 focus:ring-[#6366f1]/20 font-mono"
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Автоматическое приглашение в чат (проактивный чат) */}
          <div className="rounded-2xl border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
            <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-[#111111]">
                  Автоматическое приглашение в чат
                </h3>
                <p className="text-xs text-[#666666]">
                  Автоматически открывать окно чата с приглашением через заданное время
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={proactiveEnabled}
                  onChange={(e) => setProactiveEnabled(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-[#e5e5e5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#cccccc] after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#4a38f5]"></div>
              </label>
            </div>

            {proactiveEnabled && (
              <div className="space-y-4 pt-1">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[#111111]">
                    Задержка перед открытием (секунд)
                  </label>
                  <input
                    type="number"
                    min={2}
                    max={300}
                    value={proactiveDelaySeconds}
                    onChange={(e) => setProactiveDelaySeconds(Math.max(1, parseInt(e.target.value, 10) || 10))}
                    className="w-32 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
                  />
                  <p className="mt-1 text-[11px] text-[#888888]">
                    Рекомендуется от 7 до 15 секунд, чтобы посетитель успел осмотреться на сайте.
                  </p>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-[#111111]">
                    Текст приглашения в чат
                  </label>
                  <textarea
                    rows={2}
                    value={proactiveMessage}
                    onChange={(e) => setProactiveMessage(e.target.value)}
                    placeholder="Здравствуйте! Я онлайн, спрашивайте — готов вам помочь."
                    className="w-full rounded-lg border border-[#e5e5e5] bg-white p-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(!previewOpen)}
                  className="rounded-md border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1 text-xs font-medium text-[#666666] hover:bg-white hover:text-[#111111] hover:border-[#cccccc] transition-colors cursor-pointer"
                  title="Переключить вид между открытым окном и свёрнутой кнопкой"
                >
                  {previewOpen ? "Показать кнопку с бейджем" : "Показать окно чата"}
                </button>
                <span className="flex items-center gap-1.5 text-xs font-medium text-[#4a38f5]">
                  <Sparkles className="h-3.5 w-3.5" />
                  Live Preview
                </span>
              </div>
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
                          {avatarType === "mascot" ? (
                            <InteractiveMascot
                              mascotId={mascotId}
                              size={32}
                              accentColor={accentColor}
                              interactive={false}
                              customDirections={customDirections}
                              customReactions={customReactions}
                            />
                          ) : avatarType === "photo" && consultantAvatar ? (
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

                    {/* Баннер перехода в мессенджеры */}
                    {showMessengerBanner && (
                      <>
                        {messengerBannerMode === "single" ? (
                          singleTarget === "telegram" && (telegramBot || telegramAccountId) ? (
                            <div className="flex items-center justify-between border-b border-sky-500/20 bg-sky-500/10 px-3 py-2 text-xs text-sky-600 dark:text-sky-400">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <TelegramIcon className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                                <span className="truncate font-medium">Продолжить в Telegram</span>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded bg-[#0284c7] px-2 py-0.5 text-[10px] font-semibold text-white shadow-2xs">
                                Перейти &rarr;
                              </span>
                            </div>
                          ) : singleTarget === "whatsapp" && (whatsappPhone || whatsappAccountId) ? (
                            <div className="flex items-center justify-between border-b border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <WhatsAppIcon className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                <span className="truncate font-medium">Продолжить в WhatsApp</span>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded bg-[#16a34a] px-2 py-0.5 text-[10px] font-semibold text-white shadow-2xs">
                                Перейти &rarr;
                              </span>
                            </div>
                          ) : singleTarget === "max" && (maxLink || maxAccountId) ? (
                            <div className="flex items-center justify-between border-b border-indigo-500/20 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-700 dark:text-indigo-400">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <MaxIcon className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
                                <span className="truncate font-medium">Продолжить в MAX</span>
                              </div>
                              <span className="inline-flex items-center gap-1 rounded bg-[#6366f1] px-2 py-0.5 text-[10px] font-semibold text-white shadow-2xs">
                                Перейти &rarr;
                              </span>
                            </div>
                          ) : null
                        ) : (
                          // Мульти-режим: 2 или 3 кнопки
                          <div
                            className={cn(
                              "flex items-center justify-between border-b px-3 py-1.5 text-xs gap-2",
                              isDark ? "border-[#27272a] bg-[#18181b]" : "border-[#e5e5e5] bg-[#fafafa]",
                            )}
                          >
                            <span className="text-[11px] font-semibold text-[#888888] shrink-0">
                              Продолжить в:
                            </span>
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              {telegramEnabled && (
                                <span className="inline-flex items-center gap-1 rounded bg-[#0284c7] px-2 py-0.5 text-[10px] font-medium text-white shadow-2xs">
                                  <TelegramIcon className="h-2.5 w-2.5" />
                                  <span>Telegram</span>
                                </span>
                              )}
                              {whatsappEnabled && (
                                <span className="inline-flex items-center gap-1 rounded bg-[#16a34a] px-2 py-0.5 text-[10px] font-medium text-white shadow-2xs">
                                  <WhatsAppIcon className="h-2.5 w-2.5" />
                                  <span>WhatsApp</span>
                                </span>
                              )}
                              {maxEnabled && (
                                <span className="inline-flex items-center gap-1 rounded bg-[#6366f1] px-2 py-0.5 text-[10px] font-medium text-white shadow-2xs">
                                  <MaxIcon className="h-2.5 w-2.5" />
                                  <span>MAX</span>
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* Тело сообщений */}
                    <div className="flex-1 space-y-3 overflow-y-auto p-3 text-xs">
                      {/* Приветствие консультанта */}
                      <div className="flex items-start gap-2">
                        <div
                          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white overflow-hidden shadow-xs"
                          style={{ backgroundColor: accentColor }}
                        >
                          {avatarType === "mascot" ? (
                            <InteractiveMascot
                              mascotId={mascotId}
                              size={28}
                              accentColor={accentColor}
                              interactive={false}
                              customDirections={customDirections}
                              customReactions={customReactions}
                            />
                          ) : avatarType === "photo" && consultantAvatar ? (
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

                {/* Плавающая кнопка вызова виджета и бейдж */}
                <div
                  className={cn(
                    "flex items-center gap-2.5",
                    position === "bottom-right" ? "flex-row" : "flex-row-reverse",
                  )}
                >
                  {!previewOpen && badgeEnabled && (
                    <div
                      onClick={() => setPreviewOpen(true)}
                      className={cn(
                        "relative cursor-pointer rounded-[10px] px-3.5 py-1.5 text-xs font-semibold text-white shadow-lg transition-all duration-250 select-none whitespace-nowrap",
                        badgeAnimating ? "opacity-0 -translate-y-2 scale-90" : "opacity-100 translate-y-0 scale-100",
                      )}
                      style={{
                        backgroundColor: accentColor,
                      }}
                      title="Нажмите, чтобы открыть чат"
                    >
                      <span>
                        {parsedBadgeTexts[previewBadgeIdx % parsedBadgeTexts.length] || "Задайте вопрос"}
                      </span>
                      {/* Стрелочка speech-bubble */}
                      <span
                        className={cn(
                          "absolute top-1/2 -translate-y-1/2 h-0 w-0 border-solid",
                          position === "bottom-right"
                            ? "-right-1.5 border-y-[5px] border-y-transparent border-l-[6px] border-r-0"
                            : "-left-1.5 border-y-[5px] border-y-transparent border-r-[6px] border-l-0",
                        )}
                        style={{
                          borderLeftColor: position === "bottom-right" ? accentColor : "transparent",
                          borderRightColor: position === "bottom-left" ? accentColor : "transparent",
                        }}
                      />
                    </div>
                  )}

                  {previewOpen ? (
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(false)}
                      className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                      style={{ backgroundColor: accentColor }}
                      title="Закрыть чат"
                    >
                      <X className="h-6 w-6 stroke-[2.5]" />
                    </button>
                  ) : avatarType === "mascot" ? (
                    <div
                      onClick={() => setPreviewOpen(true)}
                      className="group relative flex h-16 w-16 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95 cursor-pointer shrink-0"
                      style={{
                        filter: `drop-shadow(0 10px 20px ${accentColor}40)`,
                      }}
                      title="Нажмите, чтобы открыть чат"
                    >
                      <InteractiveMascot
                        mascotId={mascotId}
                        size={60}
                        accentColor={accentColor}
                        interactive={true}
                        customDirections={customDirections}
                        customReactions={customReactions}
                        onClick={() => setPreviewOpen(true)}
                      />
                      <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-emerald-500 text-[9px] font-bold text-white shadow-xs">
                        1
                      </span>
                    </div>
                  ) : avatarType === "photo" && consultantAvatar ? (
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(true)}
                      className="group relative flex h-14 w-14 items-center justify-center rounded-full overflow-hidden border-2 border-white shadow-2xl transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                      style={{ backgroundColor: accentColor }}
                      title="Нажмите, чтобы написать консультанту"
                    >
                      <img
                        src={consultantAvatar}
                        alt={consultantName || "Консультант"}
                        className="h-full w-full object-cover"
                      />
                      <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-emerald-500 shadow-xs" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPreviewOpen(true)}
                      className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl transition-transform hover:scale-105 active:scale-95 cursor-pointer shrink-0"
                      style={{ backgroundColor: accentColor }}
                      title="Открыть чат"
                    >
                      <MessageSquare className="h-6 w-6 stroke-[2.5]" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <CreatePhotoMascotModal
        isOpen={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        initialDirections={customDirections}
        initialReactions={customReactions}
        initialName={consultantName}
        onApply={(dirs, reacts, name) => {
          setCustomDirections(dirs);
          setCustomReactions(reacts);
          setMascotId("custom");
          setAvatarType("mascot");
          if (name) {
            setConsultantName(name);
          }
        }}
      />
    </div>
  );
}
