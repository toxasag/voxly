"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Bot,
  Check,
  Copy,
  ExternalLink,
  HelpCircle,
  Link2,
  MessageSquare,
  Sparkles,
  Tag,
  User,
} from "lucide-react";

import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { TagPill } from "@/components/ui/tag";
import type { ChannelAccountDTO } from "@/lib/api/use-channels";
import type { ChannelSlug } from "@/types";

interface ConfigureLinkModalProps {
  open: boolean;
  onClose: () => void;
  channel: ChannelSlug;
  account: ChannelAccountDTO | null;
}

export function ConfigureLinkModal({
  open,
  onClose,
  channel,
  account,
}: ConfigureLinkModalProps) {
  const isBot =
    account?.links?.accountType === "bot" ||
    channel === "telegram_bot" ||
    channel === "max_bot";

  const [text, setText] = useState<string>("Здравствуйте! Интересует консультация.");
  const [btnTag, setBtnTag] = useState<string>("header_cta");
  const [startTag, setStartTag] = useState<string>("site_lead");

  // UTM генератор
  const [showUtm, setShowUtm] = useState(false);
  const [utmSource, setUtmSource] = useState("");
  const [utmMedium, setUtmMedium] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");

  const [copiedDirect, setCopiedDirect] = useState(false);
  const [copiedTracking, setCopiedTracking] = useState(false);

  // Вычисляем итоговые ссылки в реальном времени
  const { liveDirectUrl, liveTrackingUrl, sampleMessage } = useMemo(() => {
    if (!account) {
      return { liveDirectUrl: "", liveTrackingUrl: "", sampleMessage: "" };
    }

    const cleanId = account.links?.cleanIdentifier || account.externalId.replace(/^@/, "");
    const publicApiUrl = "https://api.getvoxly.ru";

    // 1. Direct link
    let direct = "";
    if (isBot) {
      direct = startTag.trim()
        ? `https://t.me/${cleanId}?start=${encodeURIComponent(startTag.trim())}`
        : `https://t.me/${cleanId}`;
    } else if (channel === "whatsapp") {
      const msg = text.trim() ? `?text=${encodeURIComponent(text.trim())}` : "";
      direct = `https://wa.me/${cleanId}${msg}`;
    } else if (channel === "max") {
      direct = `https://max.ru/${cleanId}`;
    } else {
      // Telegram User
      const isDigits = /^\d+$/.test(cleanId);
      const base = isDigits ? `https://t.me/+${cleanId}` : `https://t.me/${cleanId}`;
      const msg = text.trim() ? `?text=${encodeURIComponent(text.trim())}` : "";
      direct = `${base}${msg}`;
    }

    // 2. Tracking redirector link
    const params = new URLSearchParams();
    if (btnTag.trim()) params.set("btn", btnTag.trim());
    if (!isBot && text.trim()) params.set("text", text.trim());
    if (utmSource.trim()) params.set("utm_source", utmSource.trim());
    if (utmMedium.trim()) params.set("utm_medium", utmMedium.trim());
    if (utmCampaign.trim()) params.set("utm_campaign", utmCampaign.trim());

    const qs = params.toString();
    const tracking = qs
      ? `${publicApiUrl}/to/${account.id}?${qs}`
      : `${publicApiUrl}/to/${account.id}`;

    const sample = !isBot
      ? `${text.trim() || "Здравствуйте!"} (код: vx-8a2e)`
      : `/start ref_a9b1c2d3`;

    return { liveDirectUrl: direct, liveTrackingUrl: tracking, sampleMessage: sample };
  }, [account, channel, isBot, text, btnTag, startTag, utmSource, utmMedium, utmCampaign]);

  const copyToClipboard = async (textToCopy: string, isTracking: boolean) => {
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      if (isTracking) {
        setCopiedTracking(true);
        setTimeout(() => setCopiedTracking(false), 2000);
        toast.success("Умная ссылка с аналитикой скопирована");
      } else {
        setCopiedDirect(true);
        setTimeout(() => setCopiedDirect(false), 2000);
        toast.success("Прямая ссылка скопирована");
      }
    } catch {
      toast.error("Не удалось скопировать в буфер обмена");
    }
  };

  const testLink = (url: string) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (!account) return null;

  return (
    <Sheet open={open} onClose={onClose} width="w-[520px]">
      <SheetHeader onClose={onClose}>
        <div>
          <h2 className="text-[14px] font-semibold text-[#111111]">
            Настройка ссылок для сайта и кнопок
          </h2>
          <p className="text-xs text-[#666666]">
            Подключение «{account.label}» ({account.externalId})
          </p>
        </div>
      </SheetHeader>

      <SheetContent>
        <div className="space-y-6">
          {/* Тип подключения и бейдж */}
          <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-white border border-[#e5e5e5] text-[#4a38f5]">
                {isBot ? <Bot className="h-4 w-4" /> : <User className="h-4 w-4" />}
              </div>
              <div>
                <p className="text-[13px] font-semibold text-[#111111]">{account.label}</p>
                <p className="font-mono text-xs text-[#666666]">{account.externalId}</p>
              </div>
            </div>
            <TagPill color={account.status === "connected" ? "emerald" : "amber"}>
              {account.status === "connected" ? "В сети" : "Ожидает"}
            </TagPill>
          </div>

          {/* Настройка параметров */}
          <div className="space-y-4">
            <h3 className="text-[13px] font-semibold text-[#111111] flex items-center gap-1.5">
              <Tag className="h-4 w-4 text-[#4a38f5]" />
              Параметры ссылки и кнопок
            </h3>

            {/* Идентификатор кнопки */}
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Идентификатор кнопки на сайте (btn)
              </label>
              <input
                type="text"
                value={btnTag}
                onChange={(e) => setBtnTag(e.target.value)}
                placeholder="например: header_cta, catalog_button, footer_help"
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <p className="mt-1 text-[11px] text-[#666666]">
                Позволяет видеть в CRM и сквозной аналитике, по какой конкретно кнопке кликнул клиент.
              </p>
            </div>

            {/* Текст первого сообщения (WhatsApp / Telegram User API) */}
            {!isBot ? (
              <div>
                <label className="block text-xs font-medium text-[#111111] mb-1">
                  Текст первого сообщения в чате
                </label>
                <textarea
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Здравствуйте! Хочу уточнить стоимость..."
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <p className="mt-1 text-[11px] text-[#666666]">
                  Подставится в поле ввода сообщения при переходе клиента в мессенджер.
                </p>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-[#111111] mb-1">
                  Стартовый параметр бота (/start)
                </label>
                <input
                  type="text"
                  value={startTag}
                  onChange={(e) => setStartTag(e.target.value)}
                  placeholder="site_lead"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <p className="mt-1 text-[11px] text-[#666666]">
                  Передаётся боту при команде /start для сегментации источника.
                </p>
              </div>
            )}

            {/* Быстрый UTM генератор */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => setShowUtm(!showUtm)}
                className="flex items-center gap-1.5 text-xs font-medium text-[#4a38f5] hover:underline"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {showUtm ? "Скрыть рекламные UTM-метки" : "Добавить рекламные UTM-метки (Яндекс, VK, Google)"}
              </button>

              {showUtm && (
                <div className="mt-3 grid grid-cols-1 gap-2.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs">
                  <div>
                    <label className="block text-[11px] font-medium text-[#666666] mb-0.5">
                      utm_source (источник: yandex, vk, target)
                    </label>
                    <input
                      type="text"
                      value={utmSource}
                      onChange={(e) => setUtmSource(e.target.value)}
                      placeholder="yandex"
                      className="w-full h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 font-mono text-xs text-[#111111]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#666666] mb-0.5">
                      utm_medium (тип трафика: cpc, banner, social)
                    </label>
                    <input
                      type="text"
                      value={utmMedium}
                      onChange={(e) => setUtmMedium(e.target.value)}
                      placeholder="cpc"
                      className="w-full h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 font-mono text-xs text-[#111111]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-[#666666] mb-0.5">
                      utm_campaign (кампания: spring_promo)
                    </label>
                    <input
                      type="text"
                      value={utmCampaign}
                      onChange={(e) => setUtmCampaign(e.target.value)}
                      placeholder="spring_promo"
                      className="w-full h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 font-mono text-xs text-[#111111]"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Симуляция сообщения в чате */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3.5 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#666666]">
              <span className="font-medium flex items-center gap-1.5">
                <MessageSquare className="h-3.5 w-3.5 text-[#4a38f5]" />
                Как это выглядит в чате у клиента
              </span>
              <span className="text-[11px] text-emerald-700 font-medium">Авто-атрибуция в CRM</span>
            </div>
            <div className="rounded-[6px] border border-[#fef08a] bg-[#fefce8] p-2.5 text-xs text-[#854d0e]">
              <p className="font-sans font-medium">{sampleMessage}</p>
            </div>
            <p className="text-[11px] text-[#888888]">
              Умный редиректор автоматически добавляет код лида. Когда клиент отправляет сообщение, CRM связывает его со всеми UTM-метками и Client ID рекламы.
            </p>
          </div>

          {/* Готовые ссылки */}
          <div className="space-y-4 pt-1">
            {/* 1. Умная ссылка трекинга */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#111111] flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Умная ссылка со сквозной аналитикой
                </span>
                <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-[4px]">
                  Рекомендуется для сайтов
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={liveTrackingUrl}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[12px] text-[#111111] select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void copyToClipboard(liveTrackingUrl, true)}
                  className="h-8 shrink-0 flex items-center gap-1 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0]"
                >
                  {copiedTracking ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedTracking ? "Скопировано" : "Копировать"}
                </button>
                <button
                  type="button"
                  onClick={() => testLink(liveTrackingUrl)}
                  title="Проверить в новой вкладке"
                  className="h-8 w-8 shrink-0 flex items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111] hover:bg-[#fafafa]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-[11px] text-[#666666]">
                Ставьте эту ссылку на кнопки на лендингах (Tilda, WordPress, кастомный сайт). При клике сохраняются Client ID Яндекс.Метрики и GA4.
              </p>
            </div>

            {/* 2. Прямая ссылка */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#111111] flex items-center gap-1">
                  <Link2 className="h-3.5 w-3.5 text-[#666666]" />
                  Прямая статическая ссылка
                </span>
                <span className="text-[11px] text-[#888888]">Без редиректора</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={liveDirectUrl}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[12px] text-[#111111] select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => void copyToClipboard(liveDirectUrl, false)}
                  className="h-8 shrink-0 flex items-center gap-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
                >
                  {copiedDirect ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copiedDirect ? "Скопировано" : "Копировать"}
                </button>
                <button
                  type="button"
                  onClick={() => testLink(liveDirectUrl)}
                  title="Проверить в новой вкладке"
                  className="h-8 w-8 shrink-0 flex items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111] hover:bg-[#fafafa]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
