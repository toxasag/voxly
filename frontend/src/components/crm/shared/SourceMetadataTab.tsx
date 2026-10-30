"use client";

import { useState } from "react";
import {
  Activity,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Compass,
  Copy,
  ExternalLink,
  Fingerprint,
  Globe,
  HardDrive,
  Laptop,
  Layers,
  MapPin,
  Monitor,
  Network,
  Share2,
  Smartphone,
  Tablet,
  Tag,
} from "lucide-react";
import { TagPill, type TagColor } from "@/components/ui/tag";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "sonner";
import type { DealDTO } from "@/lib/api/use-deals";
import type { ContactDTO } from "@/lib/api/use-contacts";
import { useContact } from "@/lib/api/use-contacts";
import {
  hasSourceMetadataContent,
  resolveSourceMetadata,
  type ParsedSourceMetadata,
} from "@/lib/utils/source-metadata";

interface SourceMetadataTabProps {
  deal?: DealDTO;
  contact?: ContactDTO;
}

export function SourceMetadataTab({ deal, contact }: SourceMetadataTabProps) {
  // If deal is provided but contact isn't, query contact to support fallback if deal was created manually
  const { data: linkedContact } = useContact(deal?.contactId || "");

  // Resolve metadata: deal first, then contact prop, then linked contact
  const dealMeta = deal
    ? resolveSourceMetadata({
        sourceMetadata: deal.sourceMetadata,
        customFields: deal.customFields,
        createdAt: deal.createdAt,
      })
    : null;

  const contactToUse = contact || linkedContact;
  const contactMeta = contactToUse
    ? resolveSourceMetadata({
        sourceMetadata: contactToUse.sourceMetadata,
        customFields: contactToUse.customFields,
        createdAt: contactToUse.createdAt,
      })
    : null;

  // Prefer deal metadata if it has content, otherwise use contact metadata
  const metadata: ParsedSourceMetadata =
    dealMeta && hasSourceMetadataContent(dealMeta)
      ? dealMeta
      : contactMeta && hasSourceMetadataContent(contactMeta)
      ? contactMeta
      : dealMeta || contactMeta || resolveSourceMetadata();

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = async (text: string, key: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(`${label} скопирован в буфер`);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const hasData = hasSourceMetadataContent(metadata);

  if (!hasData) {
    return (
      <EmptyState
        icon={Globe}
        title="Информация об источнике отсутствует"
        description="Метаданные устройства, страницы перехода и рекламные метки фиксируются автоматически при первом обращении клиента через онлайн-чат или виджет."
      />
    );
  }

  // Device icon and badge
  const deviceType = metadata.device.deviceType;
  const DeviceIcon =
    deviceType === "mobile" ? Smartphone : deviceType === "tablet" ? Tablet : Laptop;
  const deviceLabel =
    deviceType === "mobile" ? "Мобильное" : deviceType === "tablet" ? "Планшет" : "Компьютер (Desktop)";
  const deviceColor: TagColor =
    deviceType === "mobile" ? "sky" : deviceType === "tablet" ? "amber" : "slate";

  // Format first seen timestamp
  let formattedFirstSeen: string | null = null;
  if (metadata.firstSeenAt) {
    try {
      const d = new Date(metadata.firstSeenAt);
      formattedFirstSeen = d.toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      formattedFirstSeen = metadata.firstSeenAt;
    }
  }

  // Humanized referrer
  let humanReferrer = "Прямой заход (без реферера)";
  let isDirectReferrer = true;
  if (metadata.referrer && metadata.referrer.trim().length > 0) {
    isDirectReferrer = false;
    try {
      const refUrl = new URL(metadata.referrer);
      if (refUrl.hostname.includes("yandex")) humanReferrer = `Яндекс (${refUrl.hostname})`;
      else if (refUrl.hostname.includes("google")) humanReferrer = `Google (${refUrl.hostname})`;
      else if (refUrl.hostname.includes("vk.com")) humanReferrer = `ВКонтакте (${refUrl.hostname})`;
      else if (refUrl.hostname.includes("t.me")) humanReferrer = `Telegram (${refUrl.hostname})`;
      else humanReferrer = refUrl.hostname;
    } catch {
      humanReferrer = metadata.referrer;
    }
  }

  const utmEntries = Object.entries(metadata.utm);
  const clickIdEntries = Object.entries(metadata.clickIds);
  const analyticsEntries = Object.entries(metadata.analytics).filter(
    ([, v]) => typeof v === "string" && v.trim().length > 0
  );

  return (
    <div className="p-4 space-y-4 text-[13px] text-[#111111]">
      {/* КАРТОЧКА 1: Устройство пользователя */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs hover:border-[#cccccc] transition-colors space-y-3">
        <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
          <div className="flex items-center gap-2 font-medium text-[#111111]">
            <DeviceIcon className="w-4 h-4 text-[#4a38f5]" />
            <span>Устройство клиента</span>
          </div>
          <div className="flex items-center gap-2">
            <TagPill color={deviceColor}>
              <span className="flex items-center gap-1">
                <DeviceIcon className="w-3 h-3" /> {deviceLabel}
              </span>
            </TagPill>
            {metadata.visitCount !== undefined && metadata.visitCount > 0 && (
              <span className="text-xs text-[#666666] bg-[#f5f5f5] px-2 py-0.5 rounded-[4px] font-mono tabular-nums">
                {metadata.visitCount === 1 ? "1 визит" : `${metadata.visitCount} визита(-ов)`}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          <div className="space-y-1">
            <span className="text-xs text-[#666666] font-medium">Операционная система</span>
            <div className="flex items-center gap-2">
              <span className="font-medium text-[#111111]">{metadata.device.os}</span>
              {metadata.device.platform && (
                <span className="text-[11px] font-mono text-[#888888] bg-[#f5f5f5] px-1.5 py-0.5 rounded-[4px]">
                  {metadata.device.platform}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-xs text-[#666666] font-medium">Браузер</span>
            <div className="font-medium text-[#111111]">{metadata.device.browser}</div>
          </div>

          {metadata.device.screen && (
            <div className="space-y-1">
              <span className="text-xs text-[#666666] font-medium flex items-center gap-1">
                <Monitor className="w-3 h-3 text-[#888888]" /> Разрешение экрана
              </span>
              <div className="font-mono tabular-nums text-[#111111]">{metadata.device.screen}</div>
            </div>
          )}

          {metadata.firstSeenAt && (
            <div className="space-y-1">
              <span className="text-xs text-[#666666] font-medium flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#888888]" /> Время первого захода
              </span>
              <div className="font-mono tabular-nums text-[#111111]">{formattedFirstSeen}</div>
            </div>
          )}
        </div>

        {metadata.device.rawUserAgent && (
          <div className="pt-2 border-t border-[#f0f0f0] flex items-center justify-between gap-3 text-xs">
            <div className="truncate text-[#666666] font-mono select-all">
              UA: {metadata.device.rawUserAgent}
            </div>
            <button
              type="button"
              onClick={() =>
                copyToClipboard(metadata.device.rawUserAgent || "", "ua", "User-Agent")
              }
              className="inline-flex shrink-0 items-center gap-1 px-2 py-1 rounded-[4px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
            >
              {copiedKey === "ua" ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span className="text-emerald-600">Скопировано</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Копировать UA</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* КАРТОЧКА 2: Страница входа и обращений */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs hover:border-[#cccccc] transition-colors space-y-3">
        <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
          <div className="flex items-center gap-2 font-medium text-[#111111]">
            <Globe className="w-4 h-4 text-[#4a38f5]" />
            <span>Страница входа / обращения</span>
          </div>
          {metadata.page.domain && (
            <TagPill color="sky">
              <span className="font-mono">{metadata.page.domain}</span>
            </TagPill>
          )}
        </div>

        {metadata.page.title && (
          <div className="space-y-1">
            <span className="text-xs text-[#666666] font-medium">Заголовок страницы</span>
            <div className="font-medium text-[#111111]">{metadata.page.title}</div>
          </div>
        )}

        {metadata.page.url && (
          <div className="space-y-1">
            <span className="text-xs text-[#666666] font-medium">Полный адрес страницы (URL)</span>
            <div className="flex items-center gap-2">
              <a
                href={metadata.page.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate font-mono text-xs text-[#4a38f5] hover:underline flex items-center gap-1.5"
                title={metadata.page.url}
              >
                <span className="truncate">{metadata.page.url}</span>
                <ExternalLink className="w-3 h-3 shrink-0 opacity-70" />
              </a>
              <button
                type="button"
                onClick={() => copyToClipboard(metadata.page.url, "url", "URL страницы")}
                className="inline-flex shrink-0 items-center gap-1 px-2 py-1 rounded-[4px] border border-[#e5e5e5] bg-white text-xs text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
              >
                {copiedKey === "url" ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-600">Скопировано</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Копировать</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* История переходов / цепочка страниц */}
        {metadata.pageHistory.length > 0 && (
          <div className="pt-2 border-t border-[#f0f0f0] space-y-2">
            <span className="text-xs text-[#666666] font-medium flex items-center gap-1">
              <Layers className="w-3.5 h-3.5 text-[#888888]" /> История переходов по сайту (
              {metadata.pageHistory.length})
            </span>
            <div className="space-y-1.5">
              {metadata.pageHistory.map((item, idx) => (
                <div
                  key={`${item.url}-${idx}`}
                  className="flex items-center gap-2 text-xs text-[#666666] bg-[#fbfbfb] px-2.5 py-1.5 rounded-[4px] border border-[#e5e5e5]/60"
                >
                  <span className="font-mono text-[11px] text-[#888888] w-5 shrink-0">
                    #{item.step ?? idx + 1}
                  </span>
                  {item.time && (
                    <span className="font-mono text-[11px] text-[#888888] shrink-0">
                      {item.time}
                    </span>
                  )}
                  <ChevronRight className="w-3 h-3 text-[#cccccc] shrink-0" />
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate font-mono text-[#111111] hover:text-[#4a38f5] hover:underline"
                    title={item.url}
                  >
                    {item.url}
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* КАРТОЧКА 3: Реферер и UTM-метки */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs hover:border-[#cccccc] transition-colors space-y-3">
        <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
          <div className="flex items-center gap-2 font-medium text-[#111111]">
            <Share2 className="w-4 h-4 text-[#4a38f5]" />
            <span>Источник перехода и UTM-метки</span>
          </div>
          {utmEntries.length > 0 ? (
            <TagPill color="emerald">UTM зафиксированы</TagPill>
          ) : (
            <TagPill color="slate">Без рекламных меток</TagPill>
          )}
        </div>

        {/* Реферер */}
        <div className="space-y-1">
          <span className="text-xs text-[#666666] font-medium">Реферер (источник перехода)</span>
          <div className="flex items-center gap-2">
            <span
              className={`font-medium ${
                isDirectReferrer ? "text-[#666666]" : "text-[#111111]"
              }`}
            >
              {humanReferrer}
            </span>
            {metadata.referrer && !isDirectReferrer && (
              <button
                type="button"
                onClick={() => copyToClipboard(metadata.referrer, "ref", "Реферер")}
                className="inline-flex items-center gap-1 p-1 rounded-[4px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5]"
                title="Копировать реферер"
              >
                {copiedKey === "ref" ? (
                  <Check className="w-3 h-3 text-emerald-600" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Сетка UTM-меток */}
        {utmEntries.length > 0 ? (
          <div className="space-y-2 pt-2 border-t border-[#f0f0f0]">
            <span className="text-xs text-[#666666] font-medium flex items-center gap-1">
              <Tag className="w-3 h-3 text-[#888888]" /> Параметры рекламной кампании (UTM)
            </span>
            <div className="flex flex-wrap gap-2">
              {utmEntries.map(([key, val]) => {
                const colorMap: Record<string, TagColor> = {
                  utm_source: "sky",
                  utm_medium: "emerald",
                  utm_campaign: "violet",
                  utm_content: "amber",
                  utm_term: "orange",
                };
                const pillColor = colorMap[key] || "slate";
                return (
                  <div
                    key={key}
                    className="flex items-center rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1 text-xs gap-1.5"
                  >
                    <span className="font-mono text-[#666666] text-[11px]">{key}:</span>
                    <span className="font-medium text-[#111111]">{val}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(val, `utm-${key}`, key)}
                      className="text-[#888888] hover:text-[#111111] ml-1"
                      title="Скопировать значение"
                    >
                      {copiedKey === `utm-${key}` ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Рекламные идентификаторы (Click IDs) */}
        {clickIdEntries.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-[#f0f0f0]">
            <span className="text-xs text-[#666666] font-medium flex items-center gap-1">
              <Fingerprint className="w-3 h-3 text-[#888888]" /> Рекламные идентификаторы клика
              (Click IDs)
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {clickIdEntries.map(([key, val]) => (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1 text-xs"
                >
                  <div className="truncate font-mono mr-2">
                    <span className="text-[#666666]">{key}: </span>
                    <span className="font-medium text-[#111111]">{val}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(val, `click-${key}`, key)}
                    className="text-[#888888] hover:text-[#111111] shrink-0"
                    title="Скопировать"
                  >
                    {copiedKey === `click-${key}` ? (
                      <Check className="w-3 h-3 text-emerald-600" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* КАРТОЧКА 4: Сетевые данные и аналитика */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs hover:border-[#cccccc] transition-colors space-y-3">
        <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
          <div className="flex items-center gap-2 font-medium text-[#111111]">
            <Network className="w-4 h-4 text-[#4a38f5]" />
            <span>Сетевые данные и аналитические ID</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {metadata.network.ip && (
            <div className="space-y-1">
              <span className="text-xs text-[#666666] font-medium flex items-center gap-1">
                IP-адрес посетителя
              </span>
              <div className="flex items-center gap-2">
                <span className="font-mono tabular-nums font-medium text-[#111111]">
                  {metadata.network.ip}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    copyToClipboard(metadata.network.ip || "", "ip", "IP-адрес")
                  }
                  className="inline-flex items-center gap-1 p-1 rounded-[4px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5]"
                  title="Копировать IP"
                >
                  {copiedKey === "ip" ? (
                    <Check className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>
          )}

          {(metadata.network.city || metadata.network.country) && (
            <div className="space-y-1">
              <span className="text-xs text-[#666666] font-medium flex items-center gap-1">
                <MapPin className="w-3 h-3 text-[#888888]" /> Примерная геолокация
              </span>
              <div className="font-medium text-[#111111]">
                {[metadata.network.country, metadata.network.city].filter(Boolean).join(", ")}
              </div>
            </div>
          )}
        </div>

        {analyticsEntries.length > 0 && (
          <div className="pt-2 border-t border-[#f0f0f0] space-y-2">
            <span className="text-xs text-[#666666] font-medium flex items-center gap-1">
              <Activity className="w-3 h-3 text-[#888888]" /> Идентификаторы систем веб-аналитики
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {analyticsEntries.map(([key, val]) => {
                const labels: Record<string, string> = {
                  yandexuid: "Яндекс UID",
                  ymUid: "Яндекс.Метрика ClientID",
                  gaId: "Google Analytics ClientID",
                  fbId: "Facebook ClientID",
                  tmrLvid: "Top.Mail.ru ClientID",
                };
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1 text-xs"
                  >
                    <div className="truncate font-mono mr-2">
                      <span className="text-[#666666]">{labels[key] || key}: </span>
                      <span className="font-medium text-[#111111]">{val}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(val || "", `analytic-${key}`, labels[key] || key)}
                      className="text-[#888888] hover:text-[#111111] shrink-0"
                      title="Скопировать"
                    >
                      {copiedKey === `analytic-${key}` ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
