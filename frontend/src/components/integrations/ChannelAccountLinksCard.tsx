"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Bot,
  Check,
  Copy,
  ExternalLink,
  Info,
  Link2,
  Plus,
  Send,
  Settings2,
  Sparkles,
  User,
} from "lucide-react";

import { TagPill } from "@/components/ui/tag";
import type { ChannelAccountDTO } from "@/lib/api/use-channels";
import type { ChannelSlug } from "@/types";
import { ConfigureLinkModal } from "./ConfigureLinkModal";

interface ChannelAccountLinksCardProps {
  channel: ChannelSlug;
  accounts: ChannelAccountDTO[];
  onConnect?: () => void;
}

export function ChannelAccountLinksCard({
  channel,
  accounts,
  onConnect,
}: ChannelAccountLinksCardProps) {
  // Выбираем первый подключенный или первый в списке
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [configureOpen, setConfigureOpen] = useState(false);

  const [copiedDirect, setCopiedDirect] = useState(false);
  const [copiedTracking, setCopiedTracking] = useState(false);

  const activeAccount = useMemo(() => {
    if (accounts.length === 0) return null;
    if (selectedId) {
      const found = accounts.find((a) => a.id === selectedId);
      if (found) return found;
    }
    // По умолчанию берём первый со статусом 'connected', либо первый вообще
    const connected = accounts.find((a) => a.status === "connected");
    return connected || accounts[0];
  }, [accounts, selectedId]);

  const accountType = activeAccount?.links?.accountType || (channel === "whatsapp" ? "whatsapp" : "default");
  const isBot = accountType === "bot";

  // Прямая ссылка по умолчанию
  const directUrl = useMemo(() => {
    if (!activeAccount) return "";
    if (activeAccount.links?.directUrl) return activeAccount.links.directUrl;

    const cleanId = activeAccount.externalId.replace(/^@/, "");
    if (channel === "telegram" || channel === "telegram_bot") {
      return `https://t.me/${cleanId}`;
    }
    if (channel === "whatsapp") {
      const phoneDigits = activeAccount.externalId.replace(/\D/g, "");
      return `https://wa.me/${phoneDigits || cleanId}?text=${encodeURIComponent("Здравствуйте!")}`;
    }
    if (channel === "max") {
      return `https://max.ru/${cleanId}`;
    }
    return `https://t.me/${cleanId}`;
  }, [activeAccount, channel]);

  // Умная ссылка редиректора по умолчанию
  const trackingUrl = useMemo(() => {
    if (!activeAccount) return "";
    if (activeAccount.links?.trackingUrl) return activeAccount.links.trackingUrl;
    return `https://api.getvoxly.ru/to/${activeAccount.id}`;
  }, [activeAccount]);

  const copyToClipboard = async (textToCopy: string, isTracking: boolean) => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      if (isTracking) {
        setCopiedTracking(true);
        setTimeout(() => setCopiedTracking(false), 2000);
        toast.success("Умная ссылка с аналитикой скопирована в буфер");
      } else {
        setCopiedDirect(true);
        setTimeout(() => setCopiedDirect(false), 2000);
        toast.success("Прямая ссылка скопирована в буфер");
      }
    } catch {
      toast.error("Не удалось скопировать в буфер обмена");
    }
  };

  const openInNewTab = (url: string) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (accounts.length === 0) {
    return (
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5]">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-[#111111]">
                Ссылки для кнопок и сайтов (Direct & Deep Links)
              </h2>
              <p className="mt-0.5 text-xs text-[#666666]">
                Подключите хотя бы один аккаунт канала, чтобы получить ссылки для кнопок сайта и сквозной аналитики.
              </p>
            </div>
          </div>
          {onConnect && (
            <button
              type="button"
              onClick={onConnect}
              className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 py-1.5 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
            >
              <Plus className="h-3.5 w-3.5" />
              Подключить аккаунт
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-5">
      {/* Шапка секции */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#f0f0f0] pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5]">
            <Link2 className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-[#111111]">
                Ссылки для кнопок и сайтов (Direct & Deep Links)
              </h2>
              <span className="hidden sm:inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                Сквозная аналитика
              </span>
            </div>
            <p className="text-xs text-[#666666] mt-0.5">
              Готовые ссылки для перехода в мессенджер с автоматическим сохранением UTM-меток и Client ID рекламы
            </p>
          </div>
        </div>

        {/* Кнопка открытия тонкой настройки */}
        <button
          type="button"
          onClick={() => setConfigureOpen(true)}
          className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa]"
        >
          <Settings2 className="h-3.5 w-3.5 text-[#666666]" />
          Настроить ссылку
        </button>
      </div>

      {/* Селектор аккаунтов (Multi-instance поддержка) */}
      {accounts.length > 1 && (
        <div className="space-y-2">
          <span className="text-xs font-medium text-[#666666]">
            Выберите подключение ({accounts.length}):
          </span>
          <div className="flex flex-wrap gap-2">
            {accounts.map((acc) => {
              const isSelected = activeAccount?.id === acc.id;
              const isAccBot = acc.links?.accountType === "bot";

              return (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => setSelectedId(acc.id)}
                  className={`flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-all ${
                    isSelected
                      ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] shadow-2xs"
                      : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]"
                  }`}
                >
                  <span className="flex h-4 w-4 items-center justify-center">
                    {isAccBot ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                  </span>
                  <span>{acc.label}</span>
                  <span className="font-mono text-[11px] opacity-75">
                    {acc.externalId.replace(/^@/, "")}
                  </span>
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      acc.status === "connected" ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Блок с двумя типами ссылок */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. Умная ссылка со сквозной аналитикой */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 flex flex-col justify-between space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[#111111] flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-[#4a38f5]" />
                Умная ссылка с аналитикой (Smart Link)
              </span>
              <TagPill color="emerald">Рекомендуется для сайта</TagPill>
            </div>
            <p className="text-xs text-[#666666]">
              При клике по этой ссылке сохраняются UTM-метки, Client ID Яндекс.Метрики и Google Analytics, после чего клиент перенаправляется в чат.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly
                value={trackingUrl}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[12px] text-[#111111] select-all focus:border-[#4a38f5] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void copyToClipboard(trackingUrl, true)}
                className="h-8 shrink-0 flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] shadow-xs"
              >
                {copiedTracking ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedTracking ? "Скопировано" : "Копировать"}
              </button>
              <button
                type="button"
                onClick={() => openInNewTab(trackingUrl)}
                title="Проверить переход"
                className="h-8 w-8 shrink-0 flex items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111] hover:bg-[#fafafa]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-between text-[11px] text-[#666666]">
              <span>Редиректор 302: t.me, wa.me, max.ru</span>
              <button
                type="button"
                onClick={() => setConfigureOpen(true)}
                className="text-[#4a38f5] hover:underline flex items-center gap-1 font-medium"
              >
                Добавить UTM или тег кнопки
              </button>
            </div>
          </div>
        </div>

        {/* 2. Прямая ссылка на мессенджер */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 flex flex-col justify-between space-y-3">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-[#111111] flex items-center gap-1.5">
                <Link2 className="h-4 w-4 text-[#666666]" />
                Прямая ссылка (Direct Link)
              </span>
              <span className="text-[11px] font-medium text-[#666666]">
                {isBot ? "Bot API" : channel === "whatsapp" ? "WhatsApp Web" : "MTProto"}
              </span>
            </div>
            <p className="text-xs text-[#666666]">
              Прямой адрес профиля в мессенджере. Подходит для визиток, шапки сайта или соцсетей, когда не требуется перехват меток редиректором.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                readOnly
                value={directUrl}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-2.5 font-mono text-[12px] text-[#111111] select-all focus:border-[#4a38f5] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void copyToClipboard(directUrl, false)}
                className="h-8 shrink-0 flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa] shadow-xs"
              >
                {copiedDirect ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedDirect ? "Скопировано" : "Копировать"}
              </button>
              <button
                type="button"
                onClick={() => openInNewTab(directUrl)}
                title="Открыть мессенджер"
                className="h-8 w-8 shrink-0 flex items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111] hover:bg-[#fafafa]"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="text-[11px] text-[#888888]">
              {isBot
                ? "Запуск бота через команду /start"
                : "Открывает диалог с предзаполненным текстом"}
            </div>
          </div>
        </div>
      </div>

      {/* Подсказка механики атрибуции (Twenty UX Note Pattern) */}
      <div className="rounded-[4px] border border-[#fef08a] bg-[#fefce8] p-3 text-xs text-[#854d0e] flex items-start gap-2.5">
        <Info className="h-4 w-4 shrink-0 text-[#854d0e] mt-0.5" />
        <div className="space-y-1">
          <p className="font-medium text-[#854d0e]">
            Как работает автоматическая сквозная атрибуция в GETVOXLY:
          </p>
          <p className="text-[#854d0e]/90 text-[11px] leading-relaxed">
            Посетитель переходит по умной ссылке <code className="font-mono bg-white/70 px-1 py-0.5 rounded">https://api.getvoxly.ru/to/{activeAccount?.id?.slice(0, 8)}...</code>. Сервер мгновенно фиксирует сессию с UTM-метками и Client ID Яндекс.Метрики / Google Analytics. В поле ввода диалога подставляется короткий код (например, <code className="font-mono bg-white/70 px-1 py-0.5 rounded">код: vx-xxxx</code>). При отправке первого сообщения сделка в CRM автоматически связывается с рекламной кампанией и ключевым словом.
          </p>
        </div>
      </div>

      {/* Модальная шторка настройки ссылки */}
      <ConfigureLinkModal
        open={configureOpen}
        onClose={() => setConfigureOpen(false)}
        channel={channel}
        account={activeAccount}
      />
    </div>
  );
}
