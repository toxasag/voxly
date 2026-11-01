"use client";

import { Bell, BellOff, CheckCircle2, Send, Smartphone, AlertTriangle } from "lucide-react";
import { useWebPush } from "@/lib/notifications/use-web-push";
import { TagPill } from "@/components/ui/tag";

export function WebPushDeviceSettings() {
  const {
    isSupported,
    permission,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
    sendTestNotification,
  } = useWebPush();

  return (
    <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-[#111111]">
              Уведомления на этом устройстве (Web Push & PWA)
            </h3>
            {isSubscribed ? (
              <TagPill color="emerald">Активно</TagPill>
            ) : permission === "denied" ? (
              <TagPill color="rose">Заблокировано</TagPill>
            ) : (
              <TagPill color="slate">Не подключено</TagPill>
            )}
          </div>
          <p className="text-xs text-[#666666] max-w-2xl leading-relaxed">
            Получайте моментальные звуковые и всплывающие push-уведомления о новых заявках, сообщениях
            клиентов и назначенных задачах прямо на смартфоне или в браузере даже при закрытой вкладке.
          </p>
        </div>

        {/* Действия */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isSubscribed ? (
            <>
              <button
                type="button"
                onClick={() => void sendTestNotification()}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa]"
              >
                <Send className="h-3.5 w-3.5 text-[#666666]" />
                <span>Тест push</span>
              </button>
              <button
                type="button"
                onClick={() => void unsubscribe()}
                disabled={isLoading}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-600 shadow-2xs transition-colors hover:bg-rose-100 disabled:opacity-50"
              >
                <BellOff className="h-3.5 w-3.5" />
                <span>Отключить</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void subscribe()}
              disabled={isLoading || !isSupported || permission === "denied"}
              className="flex h-8 items-center gap-1.5 rounded-lg bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
            >
              <Bell className="h-3.5 w-3.5" />
              <span>{isLoading ? "Подключение..." : "Включить на этом устройстве"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Предупреждения и подсказки */}
      {!isSupported && (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <span>
            Браузер не поддерживает стандарты W3C Web Push API. Для iOS убедитесь, что приложение добавлено
            на экран «Домой» (PWA) и версия системы не ниже iOS 16.4.
          </span>
        </div>
      )}

      {isSupported && permission === "denied" && (
        <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
          <span>
            Уведомления заблокированы в настройках браузера. Нажмите на иконку замка в адресной строке и
            разрешите «Уведомления» для этого сайта.
          </span>
        </div>
      )}

      {/* Список активных триггеров */}
      <div className="mt-4 border-t border-[#f0f0f0] pt-4">
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#888888]">
          События, доставляемые на устройство:
        </h4>
        <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="flex items-center gap-2 text-xs text-[#333333]">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>Новые заявки и сделки с сайта</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#333333]">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>Входящие сообщения в чатах</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-[#333333]">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>Назначение задач и дедлайны</span>
          </div>
        </div>
      </div>
    </div>
  );
}
