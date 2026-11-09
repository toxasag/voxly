"use client";

import { useState, useEffect } from "react";
import { Bell, X, Smartphone } from "lucide-react";
import { useWebPush } from "@/lib/notifications/use-web-push";

const DISMISS_KEY = "voxly_push_prompt_dismissed";

export function PushNotificationPromptBanner() {
  const { isSupported, permission, isSubscribed, isLoading, subscribe } = useWebPush();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const isDismissed = sessionStorage.getItem(DISMISS_KEY) === "1";
    setDismissed(isDismissed);
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(DISMISS_KEY, "1");
    }
  };

  const handleSubscribe = async () => {
    const success = await subscribe();
    if (success) {
      setDismissed(true);
    }
  };

  // Показываем только если браузер поддерживает Web Push,
  // пользователь еще не подписан, не заблокировал уведомления и не скрыл баннер
  if (!isSupported || isSubscribed || permission !== "default" || dismissed) {
    return null;
  }

  return (
    <aside
      aria-label="Включение уведомлений"
      className="fixed bottom-20 left-4 right-4 z-40 sm:bottom-6 sm:right-6 sm:left-auto sm:max-w-sm rounded-[12px] border border-[#e5e5e5] bg-white p-3.5 shadow-xl animate-in slide-in-from-bottom-4 duration-200"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
          <Smartphone className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1">
            <h4 className="text-[13px] font-semibold text-[#111111]">
              Уведомления на смартфоне
            </h4>
            <button
              type="button"
              onClick={handleDismiss}
              className="text-[#888888] hover:text-[#111111] transition-colors p-0.5"
              aria-label="Закрыть"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <p className="mt-0.5 text-[12px] text-[#666666] leading-snug">
            Включите push-уведомления, чтобы вовремя узнавать о новых заявках, звонках и задачах прямо в PWA.
          </p>

          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSubscribe()}
              disabled={isLoading}
              className="flex h-7 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 text-[12px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
            >
              <Bell className="h-3 w-3" />
              <span>{isLoading ? "Подключение..." : "Включить"}</span>
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              className="h-7 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] font-medium text-[#666666] transition-colors hover:bg-[#fafafa] hover:text-[#111111]"
            >
              Позже
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
