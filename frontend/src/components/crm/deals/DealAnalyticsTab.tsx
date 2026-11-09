"use client";

import { useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Building2,
  Check,
  Clock,
  Compass,
  Copy,
  Cpu,
  ExternalLink,
  Globe,
  HardDrive,
  Laptop,
  Layers,
  MapPin,
  MessageCircle,
  Monitor,
  Navigation,
  Phone,
  Send,
  ShieldCheck,
  Smartphone,
  Tag,
  TrendingUp,
} from "lucide-react";
import { TagPill } from "@/components/ui/tag";
import { Skeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { useContact } from "@/lib/api/use-contacts";
import type { DealDTO } from "@/lib/api/use-deals";
import { toast } from "sonner";

interface DealAnalyticsTabProps {
  deal: DealDTO;
}

interface PageHistoryItem {
  url: string;
  step?: number;
  time?: string;
}

interface DeviceInfoData {
  ip?: string;
  os?: string;
  browser?: string;
  screen?: string;
  platform?: string;
  timezone?: string;
  timezoneOffset?: number;
  language?: string;
  deviceType?: string;
  deviceMemory?: number;
  cpuCores?: number;
  maxTouchPoints?: number;
  canvasHash?: string;
  gpuRenderer?: string;
}

interface VisitorGeoData {
  ip?: string;
  country?: string;
  countryCode?: string;
  region?: string;
  city?: string;
  district?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  timezone?: string;
  isp?: string;
  sourceType?: "ip" | "gps" | "hybrid" | "local" | "unknown";
  provider?: string;
  resolvedAt?: string;
  mapUrl?: string;
}

function CopyableValue({
  value,
  label,
  mono = true,
}: {
  value: string;
  label?: string;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success(label ? `${label} скопирован` : "Скопировано в буфер");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-1.5 group">
      <span
        className={`truncate ${mono ? "font-mono tabular-nums text-xs" : "text-[13px]"} text-[#111111]`}
        title={value}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity p-1 text-[#888888] hover:text-[#111111] rounded hover:bg-black/[0.04]"
        title="Копировать"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}

export function DealAnalyticsTab({ deal }: DealAnalyticsTabProps) {
  const contactQuery = useContact(deal.contactId);

  if (contactQuery.isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-28 w-full rounded-[8px]" />
        <Skeleton className="h-44 w-full rounded-[8px]" />
        <Skeleton className="h-36 w-full rounded-[8px]" />
      </div>
    );
  }

  const dealFields = (deal.customFields ?? {}) as Record<string, unknown>;
  const contactFields = ((contactQuery.data?.customFields ?? {}) as Record<string, unknown>);

  // Объединяем поля: приоритет отдаётся данным сделки, если в сделке нет — берём из контакта
  const mergedFields: Record<string, unknown> = {
    ...contactFields,
    ...dealFields,
  };

  // 1. Источник заявки
  const pageUrl = (mergedFields.page_url as string | undefined) || (mergedFields.last_page_url as string | undefined) || (mergedFields.pageUrl as string | undefined);
  const referrer = (mergedFields.referrer as string | undefined);
  const visitCount = typeof mergedFields.visit_count === "number" ? mergedFields.visit_count : typeof mergedFields.visitCount === "number" ? mergedFields.visitCount : undefined;
  const pageHistory = (Array.isArray(mergedFields.page_history) ? mergedFields.page_history : Array.isArray(mergedFields.pageHistory) ? mergedFields.pageHistory : []) as PageHistoryItem[];
  const webchatVisitorId = (mergedFields.webchat_visitor_id as string | undefined) || (mergedFields.visitorId as string | undefined);

  // Канал поступления
  const channel = contactQuery.data?.channel || (deal.title.toLowerCase().includes("webchat") || deal.title.includes("Онлайн-чат") ? "webchat" : "unknown");

  // 2. UTM-метки
  const utmTags = (
    typeof dealFields.utm_tags === "object" && dealFields.utm_tags !== null && Object.keys(dealFields.utm_tags).length > 0
      ? dealFields.utm_tags
      : typeof contactFields.utm_tags === "object" && contactFields.utm_tags !== null && Object.keys(contactFields.utm_tags).length > 0
        ? contactFields.utm_tags
        : {}
  ) as Record<string, string>;

  // 3. Рекламные идентификаторы
  const clickIds = (
    typeof dealFields.click_ids === "object" && dealFields.click_ids !== null && Object.keys(dealFields.click_ids).length > 0
      ? dealFields.click_ids
      : typeof contactFields.click_ids === "object" && contactFields.click_ids !== null && Object.keys(contactFields.click_ids).length > 0
        ? contactFields.click_ids
        : {}
  ) as Record<string, string>;

  // 4. Счётчики аналитики
  const ymUid = (mergedFields.ym_uid as string | undefined) || (mergedFields.ymUid as string | undefined);
  const yandexuid = (mergedFields.yandexuid as string | undefined);
  const gaId = (mergedFields.ga_id as string | undefined) || (mergedFields.gaId as string | undefined);
  const fbId = (mergedFields.fb_id as string | undefined) || (mergedFields.fbId as string | undefined);
  const tmrLvid = (mergedFields.tmr_lvid as string | undefined) || (mergedFields.tmrLvid as string | undefined);
  const deviceFingerprint = (mergedFields.device_fingerprint as string | undefined) || (mergedFields.deviceFingerprint as string | undefined);

  // 5. Данные устройства
  const rawDeviceInfo = (
    typeof dealFields.device_info === "object" && dealFields.device_info !== null
      ? dealFields.device_info
      : typeof contactFields.device_info === "object" && contactFields.device_info !== null
        ? contactFields.device_info
        : {}
  ) as DeviceInfoData;

  // 6. Геолокация и адрес посетителя
  const rawGeo = (
    dealFields.geo && typeof dealFields.geo === "object"
      ? dealFields.geo
      : contactFields.geo && typeof contactFields.geo === "object"
        ? contactFields.geo
        : deal.sourceMetadata && typeof deal.sourceMetadata === "object" && (deal.sourceMetadata as Record<string, unknown>).geo
          ? (deal.sourceMetadata as Record<string, unknown>).geo
          : contactQuery.data?.sourceMetadata && typeof contactQuery.data.sourceMetadata === "object" && (contactQuery.data.sourceMetadata as Record<string, unknown>).geo
            ? (contactQuery.data.sourceMetadata as Record<string, unknown>).geo
            : undefined
  ) as VisitorGeoData | undefined;

  const hasAnyAnalytics =
    Boolean(pageUrl) ||
    Boolean(referrer) ||
    Boolean(ymUid) ||
    Boolean(gaId) ||
    Boolean(yandexuid) ||
    Boolean(webchatVisitorId) ||
    Boolean(deviceFingerprint) ||
    Boolean(rawGeo) ||
    Object.keys(utmTags).length > 0 ||
    Object.keys(clickIds).length > 0 ||
    Boolean(rawDeviceInfo.ip || rawDeviceInfo.os || rawDeviceInfo.browser);

  if (!hasAnyAnalytics) {
    return (
      <div className="p-6">
        <EmptyState
          icon={BarChart3}
          title="Аналитические данные отсутствуют"
          description="Сделка была создана вручную менеджером или через внешний канал без веб-трекинга."
        />
      </div>
    );
  }

  // Извлечение чистого домена сайта
  let originDomain = "";
  if (pageUrl) {
    try {
      originDomain = new URL(pageUrl).hostname;
    } catch {
      originDomain = pageUrl;
    }
  }

  // Определение реферера для человека
  let referrerLabel = "Прямой заход (без реферера)";
  let isDirect = true;
  if (referrer && referrer.trim().length > 0) {
    isDirect = false;
    try {
      const refUrl = new URL(referrer);
      if (refUrl.hostname.includes("yandex")) referrerLabel = `Яндекс (${refUrl.hostname})`;
      else if (refUrl.hostname.includes("google")) referrerLabel = `Google (${refUrl.hostname})`;
      else if (refUrl.hostname.includes("vk.com")) referrerLabel = `ВКонтакте (${refUrl.hostname})`;
      else if (refUrl.hostname.includes("t.me")) referrerLabel = `Telegram (${refUrl.hostname})`;
      else referrerLabel = refUrl.hostname;
    } catch {
      referrerLabel = referrer;
    }
  }

  return (
    <div className="p-4 space-y-4 text-[13px] text-[#111111]">
      {/* 1. Блок: Источник заявки и сайт */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
          <div className="flex items-center gap-2 font-medium text-[#111111]">
            <Compass className="w-4 h-4 text-[#4a38f5]" />
            <span>Источник заявки</span>
          </div>
          <div className="flex items-center gap-2">
            {channel === "webchat" || channel === "phone" ? (
              <TagPill color="sky">
                <span className="flex items-center gap-1">
                  <MessageCircle className="w-3 h-3" /> Онлайн-чат
                </span>
              </TagPill>
            ) : channel === "telegram" ? (
              <TagPill color="sky">
                <span className="flex items-center gap-1">
                  <Send className="w-3 h-3" /> Telegram
                </span>
              </TagPill>
            ) : channel === "whatsapp" ? (
              <TagPill color="emerald">
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3" /> WhatsApp
                </span>
              </TagPill>
            ) : (
              <TagPill color="slate">{channel}</TagPill>
            )}
            {visitCount !== undefined && visitCount > 0 && (
              <span className="text-xs text-[#666666] bg-[#f5f5f5] px-2 py-0.5 rounded-[4px]">
                {visitCount === 1 ? "1 визит" : `${visitCount} визита(-ов)`}
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {pageUrl && (
            <div className="space-y-1">
              <span className="text-xs text-[#666666] font-medium flex items-center gap-1.5">
                <Globe className="w-3.5 h-3.5 text-[#888888]" /> Сайт обращения
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={pageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-[#4a38f5] hover:underline flex items-center gap-1 truncate"
                >
                  {originDomain || pageUrl}
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
              <div className="text-xs text-[#888888] truncate pt-0.5" title={pageUrl}>
                <CopyableValue value={pageUrl} label="URL страницы" />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <span className="text-xs text-[#666666] font-medium flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5 text-[#888888]" /> Откуда пришёл (Referrer)
            </span>
            <div className="flex items-center gap-2">
              <span className={`text-[13px] ${isDirect ? "text-[#666666]" : "text-[#111111] font-medium"}`}>
                {referrerLabel}
              </span>
            </div>
            {referrer && !isDirect && (
              <div className="text-xs text-[#888888] truncate pt-0.5">
                <CopyableValue value={referrer} label="Полный URL реферера" />
              </div>
            )}
          </div>
        </div>

        {/* История переходов внутри сайта */}
        {pageHistory.length > 0 && (
          <div className="pt-2 border-t border-[#f0f0f0] space-y-1.5">
            <span className="text-xs text-[#666666] font-medium flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-[#888888]" /> История навигации по сайту ({pageHistory.length})
            </span>
            <div className="space-y-1 bg-[#fafafa] p-2.5 rounded-[6px] border border-[#f0f0f0] max-h-36 overflow-y-auto">
              {pageHistory.map((h, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs text-[#666666]">
                  <span className="text-[11px] font-mono text-[#888888] w-5 text-right">
                    #{h.step || idx + 1}
                  </span>
                  {h.time && <span className="font-mono text-[#888888] text-[11px]">{h.time}</span>}
                  <ArrowRight className="w-3 h-3 text-[#cccccc] flex-shrink-0" />
                  <span className="text-[#111111] truncate font-mono text-[11.5px]" title={h.url}>
                    {h.url}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 2. Блок: Геолокация и адрес посетителя */}
      {rawGeo && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-3">
          <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
            <div className="flex items-center gap-2 font-medium text-[#111111]">
              <MapPin className="w-4 h-4 text-[#4a38f5]" />
              <span>Геолокация и адрес посетителя</span>
            </div>
            <div className="flex items-center gap-2">
              {rawGeo.sourceType === "gps" ? (
                <TagPill color="emerald">
                  <span className="flex items-center gap-1">
                    <Navigation className="w-3 h-3" /> Точный GPS
                    {rawGeo.accuracy ? ` (±${rawGeo.accuracy} м)` : ""}
                  </span>
                </TagPill>
              ) : rawGeo.sourceType === "local" ? (
                <TagPill color="slate">
                  <span className="flex items-center gap-1">Локальная сеть</span>
                </TagPill>
              ) : (
                <TagPill color="sky">
                  <span className="flex items-center gap-1">
                    <Globe className="w-3 h-3" /> IP-геолокация
                  </span>
                </TagPill>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="space-y-1">
              <span className="text-xs text-[#666666] font-medium flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-[#888888]" /> Город и регион
              </span>
              <p className="font-medium text-[#111111]">
                {[rawGeo.city, rawGeo.region && rawGeo.region !== rawGeo.city ? rawGeo.region : null, rawGeo.country]
                  .filter(Boolean)
                  .join(", ") || "Не определен"}
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-xs text-[#666666] font-medium flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#888888]" /> Физический адрес
              </span>
              <div>
                <CopyableValue
                  value={rawGeo.address || [rawGeo.city, rawGeo.country].filter(Boolean).join(", ") || "Приблизительная зона IP"}
                  label="Адрес"
                  mono={false}
                />
              </div>
            </div>

            {rawGeo.latitude !== undefined && rawGeo.longitude !== undefined && (
              <div className="space-y-1">
                <span className="text-xs text-[#666666] font-medium flex items-center gap-1.5">
                  <Navigation className="w-3.5 h-3.5 text-[#888888]" /> Географические координаты
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <CopyableValue
                    value={`${rawGeo.latitude.toFixed(5)}, ${rawGeo.longitude.toFixed(5)}`}
                    label="Координаты"
                  />
                  <div className="flex items-center gap-1.5 pl-1">
                    <a
                      href={`https://yandex.ru/maps/?pt=${rawGeo.longitude},${rawGeo.latitude}&z=15&l=map`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-[#4a38f5] hover:underline flex items-center gap-0.5"
                    >
                      Яндекс.Карты <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="text-[#cccccc]">·</span>
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${rawGeo.latitude}&mlon=${rawGeo.longitude}#map=16/${rawGeo.latitude}/${rawGeo.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-[#666666] hover:text-[#111111] flex items-center gap-0.5"
                    >
                      OSM <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              </div>
            )}

            {(rawGeo.ip || rawGeo.isp) && (
              <div className="space-y-1">
                <span className="text-xs text-[#666666] font-medium flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-[#888888]" /> Сеть / Провайдер (ISP)
                </span>
                <div className="flex items-center gap-1.5 truncate">
                  {rawGeo.isp && <span className="font-medium text-[#111111] truncate">{rawGeo.isp}</span>}
                  {rawGeo.ip && (
                    <span className="font-mono text-xs text-[#666666] shrink-0">
                      ({rawGeo.ip})
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {rawGeo.latitude !== undefined && rawGeo.longitude !== undefined && (
            <div className="relative mt-2 h-36 w-full overflow-hidden rounded-[6px] border border-[#e5e5e5] bg-[#f5f5f5]">
              <iframe
                title="Карта расположения"
                className="h-full w-full border-0 pointer-events-none"
                loading="lazy"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${rawGeo.longitude - 0.012}%2C${rawGeo.latitude - 0.008}%2C${rawGeo.longitude + 0.012}%2C${rawGeo.latitude + 0.008}&layer=mapnik&marker=${rawGeo.latitude}%2C${rawGeo.longitude}`}
              />
              <a
                href={`https://yandex.ru/maps/?pt=${rawGeo.longitude},${rawGeo.latitude}&z=15&l=map`}
                target="_blank"
                rel="noreferrer"
                className="absolute bottom-2 right-2 flex items-center gap-1 rounded-[6px] bg-white/95 px-2.5 py-1 text-xs font-medium text-[#4a38f5] shadow-xs hover:bg-white hover:underline transition-colors backdrop-blur-xs"
              >
                <span>Открыть на Яндекс.Картах</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* 3. Блок: UTM-метки и рекламные кампании */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
          <div className="flex items-center gap-2 font-medium text-[#111111]">
            <Tag className="w-4 h-4 text-[#4a38f5]" />
            <span>UTM-метки и реклама</span>
          </div>
          {Object.keys(utmTags).length > 0 ? (
            <TagPill color="emerald">Метки зафиксированы</TagPill>
          ) : (
            <TagPill color="slate">Прямой переход без меток</TagPill>
          )}
        </div>

        {Object.keys(utmTags).length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <span className="text-[11px] text-[#666666] font-medium uppercase tracking-wider">utm_source (Источник)</span>
              <div className="font-medium text-[#111111]">
                {utmTags.utm_source ? (
                  <CopyableValue value={utmTags.utm_source} label="utm_source" mono={false} />
                ) : (
                  <span className="text-[#888888]">—</span>
                )}
              </div>
            </div>

            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <span className="text-[11px] text-[#666666] font-medium uppercase tracking-wider">utm_medium (Канал)</span>
              <div className="font-medium text-[#111111]">
                {utmTags.utm_medium ? (
                  <CopyableValue value={utmTags.utm_medium} label="utm_medium" mono={false} />
                ) : (
                  <span className="text-[#888888]">—</span>
                )}
              </div>
            </div>

            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <span className="text-[11px] text-[#666666] font-medium uppercase tracking-wider">utm_campaign (Кампания)</span>
              <div className="font-medium text-[#111111]">
                {utmTags.utm_campaign ? (
                  <CopyableValue value={utmTags.utm_campaign} label="utm_campaign" mono={false} />
                ) : (
                  <span className="text-[#888888]">—</span>
                )}
              </div>
            </div>

            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <span className="text-[11px] text-[#666666] font-medium uppercase tracking-wider">utm_term (Ключевое слово)</span>
              <div className="font-medium text-[#111111]">
                {utmTags.utm_term ? (
                  <CopyableValue value={utmTags.utm_term} label="utm_term" mono={false} />
                ) : (
                  <span className="text-[#888888]">—</span>
                )}
              </div>
            </div>

            {utmTags.utm_content && (
              <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1 md:col-span-2">
                <span className="text-[11px] text-[#666666] font-medium uppercase tracking-wider">utm_content (Содержание)</span>
                <div className="font-medium text-[#111111]">
                  <CopyableValue value={utmTags.utm_content} label="utm_content" mono={false} />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-[#666666] bg-[#fafafa] p-3 rounded-[6px] border border-[#f0f0f0]">
            Посетитель зашёл без рекламных UTM-параметров (органический поиск, прямая ссылка, закладка или внутренний переход).
          </div>
        )}

        {/* Рекламные идентификаторы клика (Click IDs) */}
        {Object.keys(clickIds).length > 0 && (
          <div className="pt-2 border-t border-[#f0f0f0] space-y-2">
            <span className="text-xs text-[#666666] font-medium flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#888888]" /> Рекламные идентификаторы клика
            </span>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {Object.entries(clickIds).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between bg-[#fafafa] px-2.5 py-1.5 rounded-[6px] border border-[#f0f0f0] text-xs">
                  <span className="font-mono text-[#666666] font-medium">{k}:</span>
                  <CopyableValue value={String(v)} label={k} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 3. Блок: Счётчики и системы веб-аналитики */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
          <div className="flex items-center gap-2 font-medium text-[#111111]">
            <BarChart3 className="w-4 h-4 text-[#4a38f5]" />
            <span>Счётчики и идентификаторы веб-аналитики</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {ymUid && (
            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#666666] font-medium">Яндекс.Метрика ClientID (ym_uid)</span>
                <span className="text-[10px] bg-[#fefce8] text-[#854d0e] border border-[#fef08a] px-1.5 py-0.5 rounded-[3px]">
                  Яндекс
                </span>
              </div>
              <CopyableValue value={ymUid} label="YM ClientID" />
              <p className="text-[11px] text-[#888888] pt-0.5">
                Уникальный ID посетителя в Яндекс.Метрике (для сквозной аналитики и офлайн-конверсий).
              </p>
            </div>
          )}

          {yandexuid && (
            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <span className="text-xs text-[#666666] font-medium">Яндекс Браузер / Passport (yandexuid)</span>
              <CopyableValue value={yandexuid} label="yandexuid" />
              <p className="text-[11px] text-[#888888] pt-0.5">
                Идентификатор профиля Яндекс (cookie yandexuid).
              </p>
            </div>
          )}

          {gaId && (
            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#666666] font-medium">Google Analytics ClientID (ga_id)</span>
                <span className="text-[10px] bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded-[3px]">
                  Google
                </span>
              </div>
              <CopyableValue value={gaId} label="GA ClientID" />
            </div>
          )}

          {tmrLvid && (
            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <span className="text-xs text-[#666666] font-medium">Top.Mail.ru (tmr_lvid)</span>
              <CopyableValue value={tmrLvid} label="Top.Mail.ru" />
            </div>
          )}

          {webchatVisitorId && (
            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <span className="text-xs text-[#666666] font-medium">ID сессии чата (Visitor ID)</span>
              <CopyableValue value={webchatVisitorId} label="Visitor ID" />
            </div>
          )}

          {deviceFingerprint && (
            <div className="bg-[#fafafa] rounded-[6px] p-2.5 border border-[#f0f0f0] space-y-1">
              <span className="text-xs text-[#666666] font-medium">Цифровой отпечаток браузера</span>
              <CopyableValue value={deviceFingerprint} label="Fingerprint" />
            </div>
          )}
        </div>
      </div>

      {/* 4. Блок: Технический контекст устройства */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-3">
        <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2.5">
          <div className="flex items-center gap-2 font-medium text-[#111111]">
            <Monitor className="w-4 h-4 text-[#4a38f5]" />
            <span>Технический контекст и устройство</span>
          </div>
          {rawDeviceInfo.deviceType && (
            <TagPill color="sky">
              <span className="flex items-center gap-1">
                {rawDeviceInfo.deviceType === "mobile" ? (
                  <Smartphone className="w-3 h-3" />
                ) : (
                  <Laptop className="w-3 h-3" />
                )}
                {rawDeviceInfo.deviceType === "mobile"
                  ? "Мобильное"
                  : rawDeviceInfo.deviceType === "tablet"
                    ? "Планшет"
                    : "Десктоп"}
              </span>
            </TagPill>
          )}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
          {rawDeviceInfo.ip && (
            <div className="space-y-0.5">
              <span className="text-xs text-[#666666]">IP-адрес</span>
              <div>
                <CopyableValue value={rawDeviceInfo.ip} label="IP-адрес" />
              </div>
            </div>
          )}

          {rawDeviceInfo.os && (
            <div className="space-y-0.5">
              <span className="text-xs text-[#666666]">ОС / Платформа</span>
              <p className="font-medium text-[#111111] truncate">
                {rawDeviceInfo.os} {rawDeviceInfo.platform ? `(${rawDeviceInfo.platform})` : ""}
              </p>
            </div>
          )}

          {rawDeviceInfo.browser && (
            <div className="space-y-0.5">
              <span className="text-xs text-[#666666]">Браузер</span>
              <p className="font-medium text-[#111111] truncate">{rawDeviceInfo.browser}</p>
            </div>
          )}

          {rawDeviceInfo.screen && (
            <div className="space-y-0.5">
              <span className="text-xs text-[#666666]">Экран</span>
              <p className="font-mono text-xs text-[#111111] tabular-nums">{rawDeviceInfo.screen}</p>
            </div>
          )}

          {rawDeviceInfo.timezone && (
            <div className="space-y-0.5">
              <span className="text-xs text-[#666666] flex items-center gap-1">
                <Clock className="w-3 h-3 text-[#888888]" /> Часовой пояс
              </span>
              <p className="font-medium text-[#111111] truncate">{rawDeviceInfo.timezone}</p>
            </div>
          )}

          {rawDeviceInfo.language && (
            <div className="space-y-0.5">
              <span className="text-xs text-[#666666]">Язык системы</span>
              <p className="font-medium text-[#111111] truncate">{rawDeviceInfo.language}</p>
            </div>
          )}

          {rawDeviceInfo.cpuCores !== undefined && (
            <div className="space-y-0.5">
              <span className="text-xs text-[#666666] flex items-center gap-1">
                <Cpu className="w-3 h-3 text-[#888888]" /> Процессор
              </span>
              <p className="font-mono text-xs text-[#111111] tabular-nums">{rawDeviceInfo.cpuCores} ядер</p>
            </div>
          )}

          {rawDeviceInfo.deviceMemory !== undefined && (
            <div className="space-y-0.5">
              <span className="text-xs text-[#666666] flex items-center gap-1">
                <HardDrive className="w-3 h-3 text-[#888888]" /> ОЗУ
              </span>
              <p className="font-mono text-xs text-[#111111] tabular-nums">~{rawDeviceInfo.deviceMemory} ГБ</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
