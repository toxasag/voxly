"use client";

import * as React from "react";
import { useEffect, useState, useCallback } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { WidgetSettingsProps, WidgetLanguage } from "@/types/widget";
import { Sparkles, Zap, Globe, Sliders } from "lucide-react";

export const TYPING_EFFECT_STORAGE_KEY = "typingEffectEnabled";
export const TYPING_EVENT_NAME = "voxly:typing-effect-changed";

export function getTypingEffectFromStorage(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const val = window.localStorage.getItem(TYPING_EFFECT_STORAGE_KEY);
    if (val === null) return true; // default enabled
    return val === "true";
  } catch {
    return true;
  }
}

export function setTypingEffectInStorage(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TYPING_EFFECT_STORAGE_KEY, enabled ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent(TYPING_EVENT_NAME, {
        detail: { enabled },
      }),
    );
  } catch (e) {
    console.error("Failed to save typingEffectEnabled to localStorage", e);
  }
}

export const WidgetSettings: React.FC<WidgetSettingsProps> = ({
  typingEffectEnabled: controlledEnabled,
  onTypingEffectChange,
  language = "ru",
  onLanguageChange,
  typingSpeed = 12,
  onTypingSpeedChange,
  className,
}) => {
  const [internalEnabled, setInternalEnabled] = useState<boolean>(() => {
    if (typeof controlledEnabled === "boolean") return controlledEnabled;
    return getTypingEffectFromStorage();
  });

  const isEnabled =
    typeof controlledEnabled === "boolean" ? controlledEnabled : internalEnabled;

  const isRu = language === "ru";

  // Sync with localStorage & custom events
  useEffect(() => {
    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<{ enabled: boolean }>;
      if (customEvent.detail && typeof customEvent.detail.enabled === "boolean") {
        setInternalEnabled(customEvent.detail.enabled);
      }
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === TYPING_EFFECT_STORAGE_KEY && e.newValue !== null) {
        setInternalEnabled(e.newValue === "true");
      }
    };

    window.addEventListener(TYPING_EVENT_NAME, handleCustomEvent);
    window.addEventListener("storage", handleStorageEvent);

    return () => {
      window.removeEventListener(TYPING_EVENT_NAME, handleCustomEvent);
      window.removeEventListener("storage", handleStorageEvent);
    };
  }, []);

  const handleToggle = useCallback(
    (checked: boolean) => {
      setInternalEnabled(checked);
      setTypingEffectInStorage(checked);
      onTypingEffectChange?.(checked);
    },
    [onTypingEffectChange],
  );

  return (
    <div
      className={cn(
        "rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-xs transition-all",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-[#111111]">
              {isRu ? "Типинг-эффект" : "Typing Effect"}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                isEnabled
                  ? "bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "bg-gray-100 text-[#666666]",
              )}
            >
              {isEnabled
                ? isRu
                  ? "ВКЛ"
                  : "ON"
                : isRu
                  ? "ВЫКЛ"
                  : "OFF"}
            </span>
          </div>
          <p className="text-[12px] text-[#666666]">
            {isRu
              ? "Посимвольное появление текста бота с мигающим курсором"
              : "Character-by-character bot messages with blinking cursor"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="typing-effect-toggle"
            checked={isEnabled}
            onCheckedChange={handleToggle}
            aria-label={
              isRu ? "Типинг-эффект ON/OFF" : "Typing effect ON/OFF"
            }
          />
        </div>
      </div>

      {/* Additional widget controls: Language & Speed */}
      {(onLanguageChange || onTypingSpeedChange) && (
        <div className="mt-4 pt-3 border-t border-[#f0f0f0] flex flex-wrap items-center justify-between gap-3 text-[12px]">
          {onLanguageChange && (
            <div className="flex items-center gap-2">
              <span className="text-[#666666] flex items-center gap-1">
                <Globe className="h-3.5 w-3.5 text-[#888888]" />
                {isRu ? "Язык:" : "Language:"}
              </span>
              <div className="inline-flex rounded-lg border border-[#e5e5e5] p-0.5 bg-[#fbfbfb]">
                <button
                  type="button"
                  onClick={() => onLanguageChange("ru")}
                  className={cn(
                    "px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors",
                    isRu
                      ? "bg-white text-[#111111] shadow-xs"
                      : "text-[#666666] hover:text-[#111111]",
                  )}
                >
                  RU
                </button>
                <button
                  type="button"
                  onClick={() => onLanguageChange("en")}
                  className={cn(
                    "px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors",
                    !isRu
                      ? "bg-white text-[#111111] shadow-xs"
                      : "text-[#666666] hover:text-[#111111]",
                  )}
                >
                  EN
                </button>
              </div>
            </div>
          )}

          {onTypingSpeedChange && (
            <div className="flex items-center gap-2">
              <span className="text-[#666666] flex items-center gap-1">
                <Sliders className="h-3.5 w-3.5 text-[#888888]" />
                {isRu ? "Скорость:" : "Speed:"}
              </span>
              <div className="inline-flex rounded-lg border border-[#e5e5e5] p-0.5 bg-[#fbfbfb]">
                {[
                  { speed: 22, label: isRu ? "Плавная" : "Smooth" },
                  { speed: 12, label: isRu ? "Норм" : "Normal" },
                  { speed: 6, label: isRu ? "Быстрая" : "Fast" },
                ].map((item) => (
                  <button
                    key={item.speed}
                    type="button"
                    onClick={() => onTypingSpeedChange(item.speed)}
                    className={cn(
                      "px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors",
                      typingSpeed === item.speed
                        ? "bg-white text-[#111111] shadow-xs"
                        : "text-[#666666] hover:text-[#111111]",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
