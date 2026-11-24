"use client";

import {
  Bell,
  BellOff,
  Volume2,
  VolumeX,
  Sparkles,
  Smartphone,
  ShieldCheck,
  AlertTriangle,
  Radio,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TagPill } from "@/components/ui/tag";
import { useNotificationPreferences } from "@/lib/api/use-notification-preferences";
import { cn } from "@/lib/utils";

export function UserMasterNotificationToggle() {
  const { preferences, isUpdating, updatePreferences } = useNotificationPreferences();

  const isMasterEnabled = preferences.notifications_enabled;

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
      {/* Мастер-тумблер */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-5 border-b border-[#f0f0f0]">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-[6px] transition-colors",
                isMasterEnabled
                  ? "bg-[#eef2ff] text-[#4a38f5]"
                  : "bg-[#f4f4f5] text-[#71717a]",
              )}
            >
              {isMasterEnabled ? (
                <Bell className="h-4 w-4" />
              ) : (
                <BellOff className="h-4 w-4" />
              )}
            </div>
            <h2 className="text-sm font-semibold text-[#111111]">
              Все уведомления пользователя
            </h2>
            {isMasterEnabled ? (
              <TagPill color="emerald">Включено</TagPill>
            ) : (
              <TagPill color="rose">Отключено</TagPill>
            )}
          </div>
          <p className="text-xs text-[#666666] max-w-2xl leading-relaxed">
            Мастер-выключатель персональных оповещений. При полном отключении моментально блокируются
            звуковые сигналы во вкладках, всплывающие уведомления (Toaster) и доставка Web Push на устройства.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs font-medium text-[#666666]">
            {isMasterEnabled ? "Уведомления активны" : "Отключить все"}
          </span>
          <Switch
            checked={isMasterEnabled}
            disabled={isUpdating}
            onCheckedChange={(checked) => {
              updatePreferences({ notifications_enabled: checked });
            }}
          />
        </div>
      </div>

      {/* Предупреждающий баннер при выключенном мастер-тумблере */}
      {!isMasterEnabled && (
        <div className="mt-4 flex items-start gap-2.5 rounded-[6px] border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-900">
          <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold text-rose-950">Режим полной тишины активирован</p>
            <p className="leading-relaxed text-rose-800">
              Вы не будете получать всплывающие сообщения, звуковые сигналы и push-уведомления на смартфоне
              или компьютере. Все входящие заявки по-прежнему сохраняются в CRM и доступны в списках сделок.
            </p>
          </div>
        </div>
      )}

      {/* Дочерние каналы и взаимосвязи */}
      <div className="mt-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#888888]">
            Каналы персональной доставки:
          </h3>
          {!isMasterEnabled && (
            <span className="text-[11px] text-rose-600 font-medium">
              Заблокировано мастер-выключателем
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {/* 1. Звук */}
          <div
            className={cn(
              "flex flex-col justify-between rounded-[8px] border p-3.5 transition-all",
              !isMasterEnabled
                ? "border-[#f0f0f0] bg-[#fafafa] opacity-60 cursor-not-allowed"
                : preferences.sound_enabled
                  ? "border-[#e5e5e5] bg-white hover:border-[#cccccc]"
                  : "border-[#e5e5e5] bg-[#fafafa]",
            )}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  {preferences.sound_enabled && isMasterEnabled ? (
                    <Volume2 className="h-4 w-4 text-[#4a38f5]" />
                  ) : (
                    <VolumeX className="h-4 w-4 text-[#888888]" />
                  )}
                  <span className="text-xs font-semibold text-[#111111]">Звуковые сигналы</span>
                </div>
                <Switch
                  checked={isMasterEnabled && preferences.sound_enabled}
                  disabled={!isMasterEnabled || isUpdating}
                  onCheckedChange={(checked) => {
                    updatePreferences({ sound_enabled: checked });
                  }}
                />
              </div>
              <p className="text-[11px] text-[#666666] leading-relaxed">
                Двухтоновый сигнал во вкладке браузера при новых сообщениях и назначении задач.
              </p>
            </div>
          </div>

          {/* 2. In-App Toaster */}
          <div
            className={cn(
              "flex flex-col justify-between rounded-[8px] border p-3.5 transition-all",
              !isMasterEnabled
                ? "border-[#f0f0f0] bg-[#fafafa] opacity-60 cursor-not-allowed"
                : preferences.inapp_enabled
                  ? "border-[#e5e5e5] bg-white hover:border-[#cccccc]"
                  : "border-[#e5e5e5] bg-[#fafafa]",
            )}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles
                    className={cn(
                      "h-4 w-4",
                      preferences.inapp_enabled && isMasterEnabled
                        ? "text-[#4a38f5]"
                        : "text-[#888888]",
                    )}
                  />
                  <span className="text-xs font-semibold text-[#111111]">Всплывающий Toaster</span>
                </div>
                <Switch
                  checked={isMasterEnabled && preferences.inapp_enabled}
                  disabled={!isMasterEnabled || isUpdating}
                  onCheckedChange={(checked) => {
                    updatePreferences({ inapp_enabled: checked });
                  }}
                />
              </div>
              <p className="text-[11px] text-[#666666] leading-relaxed">
                Всплывающие информационные карточки в правом нижнем углу с кнопкой быстрого перехода.
              </p>
            </div>
          </div>

          {/* 3. Browser Push */}
          <div
            className={cn(
              "flex flex-col justify-between rounded-[8px] border p-3.5 transition-all",
              !isMasterEnabled
                ? "border-[#f0f0f0] bg-[#fafafa] opacity-60 cursor-not-allowed"
                : preferences.push_enabled
                  ? "border-[#e5e5e5] bg-white hover:border-[#cccccc]"
                  : "border-[#e5e5e5] bg-[#fafafa]",
            )}
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Smartphone
                    className={cn(
                      "h-4 w-4",
                      preferences.push_enabled && isMasterEnabled
                        ? "text-[#4a38f5]"
                        : "text-[#888888]",
                    )}
                  />
                  <span className="text-xs font-semibold text-[#111111]">Web Push & PWA</span>
                </div>
                <Switch
                  checked={isMasterEnabled && preferences.push_enabled}
                  disabled={!isMasterEnabled || isUpdating}
                  onCheckedChange={(checked) => {
                    updatePreferences({ push_enabled: checked });
                  }}
                />
              </div>
              <p className="text-[11px] text-[#666666] leading-relaxed">
                Системные push-оповещения на смартфоне и рабочем столе даже при закрытой вкладке CRM.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
