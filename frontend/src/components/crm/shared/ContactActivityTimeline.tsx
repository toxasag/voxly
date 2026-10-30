"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  Bot,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Compass,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Globe,
  Layers,
  MessageCircle,
  MousePointer,
  Send,
  Smartphone,
  Sparkles,
  StickyNote,
  Tag,
  TrendingUp,
  User,
  UserCheck,
} from "lucide-react";
import { TagPill, type TagColor } from "@/components/ui/tag";
import { cn, timeAgo } from "@/lib/utils";
import { useContactTimeline, type ContactActivityItemDTO } from "@/lib/api/use-contact-timeline";
import type { DealContactTimelineItemDTO } from "@/lib/api/use-deal-contact-history";

interface ContactActivityTimelineProps {
  contactId?: string;
  dealId?: string;
  initialItems?: DealContactTimelineItemDTO[] | ContactActivityItemDTO[];
}

type FilterTab = "all" | "web" | "forms" | "dialogues" | "crm";

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds || seconds <= 0) return "0 сек";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs} сек`;
  if (secs === 0) return `${mins} мин`;
  return `${mins} мин ${secs} сек`;
}

function formatFullDateTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return isoString;
  }
}

export function ContactActivityTimeline({
  contactId,
  dealId,
  initialItems = [],
}: ContactActivityTimelineProps) {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({});

  // Если передан contactId, можем дополнительно подтягивать свежие данные
  const { data: timelineData, isLoading } = useContactTimeline(contactId, {
    dealId,
    limit: 100,
  });

  // Нормализуем элементы в единый формат
  const items: ContactActivityItemDTO[] = useMemo(() => {
    const rawItems = (timelineData?.items && timelineData.items.length > 0)
      ? timelineData.items
      : (initialItems as any[]);

    return (rawItems || []).map((it) => {
      const activityKind =
        it.activityKind ||
        it.type ||
        "note";

      const activityChannel =
        it.activityChannel ||
        (activityKind === "widget_launch"
          ? "web_widget"
          : activityKind === "form_submission"
            ? "web_form"
            : activityKind === "im_session_inbound" || activityKind === "im_session_outbound"
              ? "telegram"
              : "crm");

      return {
        id: it.id,
        type: activityKind,
        activityChannel,
        activityKind,
        direction: it.direction ?? (activityKind === "im_session_inbound" ? "inbound" : activityKind === "im_session_outbound" ? "outbound" : null),
        timestamp: it.timestamp || it.createdAt || new Date().toISOString(),
        title: it.title || "Событие",
        description: it.description,
        authorName: it.authorName,
        clientHandle: it.clientHandle,
        dealId: it.dealId,
        dealTitle: it.dealTitle,
        payload: it.payload || it.metadata || {},
      };
    });
  }, [timelineData, initialItems]);

  // Фильтрация элементов по вкладкам
  const filteredItems = useMemo(() => {
    switch (activeTab) {
      case "web":
        return items.filter((it) => it.activityKind === "widget_launch");
      case "forms":
        return items.filter((it) => it.activityKind === "form_submission");
      case "dialogues":
        return items.filter(
          (it) =>
            it.activityKind === "im_session_inbound" ||
            it.activityKind === "im_session_outbound" ||
            it.activityKind === "message",
        );
      case "crm":
        return items.filter(
          (it) =>
            it.activityKind === "note" ||
            it.activityKind === "task" ||
            it.activityKind === "stage_change",
        );
      default:
        return items;
    }
  }, [items, activeTab]);

  // Счетчики категорий для табов
  const counts = useMemo(() => {
    let web = 0;
    let forms = 0;
    let dialogues = 0;
    let crm = 0;

    for (const it of items) {
      if (it.activityKind === "widget_launch") web++;
      else if (it.activityKind === "form_submission") forms++;
      else if (
        it.activityKind === "im_session_inbound" ||
        it.activityKind === "im_session_outbound" ||
        it.activityKind === "message"
      )
        dialogues++;
      else if (
        it.activityKind === "note" ||
        it.activityKind === "task" ||
        it.activityKind === "stage_change"
      )
        crm++;
    }

    return { all: items.length, web, forms, dialogues, crm };
  }, [items]);

  const toggleItem = (id: string) => {
    setOpenItems((prev) => ({
      ...prev,
      [id]: prev[id] === undefined ? false : !prev[id],
    }));
  };

  const isItemOpen = (id: string, index: number) => {
    // По умолчанию первые 3 карточки раскрыты
    if (openItems[id] === undefined) {
      return index < 3;
    }
    return openItems[id];
  };

  const expandAll = () => {
    const next: Record<string, boolean> = {};
    for (const it of filteredItems) {
      next[it.id] = true;
    }
    setOpenItems(next);
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    for (const it of filteredItems) {
      next[it.id] = false;
    }
    setOpenItems(next);
  };

  return (
    <div className="space-y-3">
      {/* 1. Панель фильтров по типу активности (Twenty CRM Light Canvas) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e5e5] pb-2.5">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab("all")}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium transition-colors",
              activeTab === "all"
                ? "bg-[#111111] text-white"
                : "bg-[#fafafa] text-[#666666] hover:bg-[#f0f0f0] hover:text-[#111111]",
            )}
          >
            <span>Все</span>
            <span
              className={cn(
                "rounded-[4px] px-1 font-mono text-[10px]",
                activeTab === "all" ? "bg-white/20 text-white" : "bg-black/[0.05] text-[#888888]",
              )}
            >
              {counts.all}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("web")}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium transition-colors",
              activeTab === "web"
                ? "bg-[#4a38f5] text-white"
                : "bg-[#fafafa] text-[#666666] hover:bg-[#f0f0f0] hover:text-[#111111]",
            )}
          >
            <Globe className="h-3 w-3" />
            <span>Веб-сессии</span>
            {counts.web > 0 && (
              <span
                className={cn(
                  "rounded-[4px] px-1 font-mono text-[10px]",
                  activeTab === "web" ? "bg-white/20 text-white" : "bg-black/[0.05] text-[#888888]",
                )}
              >
                {counts.web}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("forms")}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium transition-colors",
              activeTab === "forms"
                ? "bg-emerald-600 text-white"
                : "bg-[#fafafa] text-[#666666] hover:bg-[#f0f0f0] hover:text-[#111111]",
            )}
          >
            <FileText className="h-3 w-3" />
            <span>Заявки</span>
            {counts.forms > 0 && (
              <span
                className={cn(
                  "rounded-[4px] px-1 font-mono text-[10px]",
                  activeTab === "forms" ? "bg-white/20 text-white" : "bg-black/[0.05] text-[#888888]",
                )}
              >
                {counts.forms}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("dialogues")}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium transition-colors",
              activeTab === "dialogues"
                ? "bg-sky-600 text-white"
                : "bg-[#fafafa] text-[#666666] hover:bg-[#f0f0f0] hover:text-[#111111]",
            )}
          >
            <MessageCircle className="h-3 w-3" />
            <span>Диалоги</span>
            {counts.dialogues > 0 && (
              <span
                className={cn(
                  "rounded-[4px] px-1 font-mono text-[10px]",
                  activeTab === "dialogues" ? "bg-white/20 text-white" : "bg-black/[0.05] text-[#888888]",
                )}
              >
                {counts.dialogues}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab("crm")}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-[12px] font-medium transition-colors",
              activeTab === "crm"
                ? "bg-amber-600 text-white"
                : "bg-[#fafafa] text-[#666666] hover:bg-[#f0f0f0] hover:text-[#111111]",
            )}
          >
            <Activity className="h-3 w-3" />
            <span>CRM-события</span>
            {counts.crm > 0 && (
              <span
                className={cn(
                  "rounded-[4px] px-1 font-mono text-[10px]",
                  activeTab === "crm" ? "bg-white/20 text-white" : "bg-black/[0.05] text-[#888888]",
                )}
              >
                {counts.crm}
              </span>
            )}
          </button>
        </div>

        <div className="flex items-center gap-1.5 text-[11px] text-[#666666]">
          <button
            type="button"
            onClick={expandAll}
            className="rounded-[4px] px-1.5 py-1 transition-colors hover:bg-black/[0.04] hover:text-[#111111]"
          >
            Развернуть все
          </button>
          <span>•</span>
          <button
            type="button"
            onClick={collapseAll}
            className="rounded-[4px] px-1.5 py-1 transition-colors hover:bg-black/[0.04] hover:text-[#111111]"
          >
            Свернуть все
          </button>
        </div>
      </div>

      {/* 2. Список карточек событий таймлайна */}
      {filteredItems.length === 0 ? (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-6 text-center text-[12px] text-[#666666]">
          События активности не найдены в выбранной категории.
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredItems.map((item, index) => {
            const isOpen = isItemOpen(item.id, index);

            switch (item.activityKind) {
              case "widget_launch":
                return (
                  <WebSessionCard
                    key={item.id}
                    item={item}
                    isOpen={isOpen}
                    onToggle={() => toggleItem(item.id)}
                  />
                );

              case "form_submission":
                return (
                  <FormSubmissionCard
                    key={item.id}
                    item={item}
                    isOpen={isOpen}
                    onToggle={() => toggleItem(item.id)}
                  />
                );

              case "im_session_inbound":
                return (
                  <InboundSessionCard
                    key={item.id}
                    item={item}
                    isOpen={isOpen}
                    onToggle={() => toggleItem(item.id)}
                  />
                );

              case "im_session_outbound":
                return (
                  <OutboundSessionCard
                    key={item.id}
                    item={item}
                    isOpen={isOpen}
                    onToggle={() => toggleItem(item.id)}
                  />
                );

              default:
                return (
                  <GenericCrmEventCard
                    key={item.id}
                    item={item}
                    isOpen={isOpen}
                    onToggle={() => toggleItem(item.id)}
                  />
                );
            }
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Карточка 1: Веб-сессия / Запуск онлайн-виджета (widget_launch)
// ---------------------------------------------------------------------------
function WebSessionCard({
  item,
  isOpen,
  onToggle,
}: {
  item: ContactActivityItemDTO;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const payload = item.payload as any;
  const domain = payload.domain || "getvoxly.ru";
  const totalTime = payload.totalTimeSeconds || 0;
  const pagesVisited: Array<{ step?: number; url: string; title?: string; timeSpentSeconds?: number }> =
    payload.pagesVisited || [];
  const heatmap = payload.heatmap || { clicks: [], scrollDepthPercent: 0, readToBottom: false };
  const clicks: Array<{ selector: string; text?: string; count?: number }> = heatmap.clicks || [];
  const scrollDepth = heatmap.scrollDepthPercent || 0;
  const readToBottom = Boolean(heatmap.readToBottom);
  const device = payload.device;

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs transition-colors hover:border-[#cccccc]">
      {/* Шапка карточки */}
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center justify-between p-3.5 select-none"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-indigo-200 bg-indigo-50 text-indigo-600">
            <Globe className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="font-mono text-[11px] text-[#666666]">
                {formatFullDateTime(item.timestamp)}
              </span>
              <span className="font-semibold text-indigo-700">{domain}</span>
              <span className="text-[#666666]">—</span>
              <span className="font-medium text-[#111111]">запустил онлайн-виджет</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#888888]">
              <span>Время на сайте: {formatDuration(totalTime)}</span>
              <span>•</span>
              <span>Страниц: {pagesVisited.length || 1}</span>
              {device?.browser && (
                <>
                  <span>•</span>
                  <span>{device.browser}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TagPill color="violet">{formatDuration(totalTime)}</TagPill>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[#888888] transition-transform duration-150",
              isOpen && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Раскрывающийся блок с деталями сессии */}
      {isOpen && (
        <div className="border-t border-[#f0f0f0] bg-[#fafafa]/50 p-4 text-[12px] space-y-4">
          {/* История переходов */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#666666]">
              <Compass className="h-3.5 w-3.5" />
              <span>История переходов по страницам</span>
            </div>
            {pagesVisited.length === 0 ? (
              <div className="text-[#888888] text-[11px]">Нет зафиксированных страниц</div>
            ) : (
              <div className="overflow-hidden rounded-[6px] border border-[#e5e5e5] bg-white">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-[#666666]">
                      <th className="w-10 px-3 py-1.5">№</th>
                      <th className="px-3 py-1.5">Раздел / Заголовок</th>
                      <th className="px-3 py-1.5">URL страницы</th>
                      <th className="px-3 py-1.5 text-right">Время на странице</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0f0]">
                    {pagesVisited.map((page, idx) => (
                      <tr key={idx} className="hover:bg-black/[0.01]">
                        <td className="px-3 py-1.5 font-mono text-[#888888]">{page.step ?? idx + 1}</td>
                        <td className="px-3 py-1.5 font-medium text-[#111111]">
                          {page.title || "Просмотр страницы"}
                        </td>
                        <td className="px-3 py-1.5 font-mono text-[#666666] max-w-[260px] truncate">
                          {page.url}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono text-[#111111]">
                          {formatDuration(page.timeSpentSeconds ?? 45)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Тепловая карта и клики */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#666666]">
                <MousePointer className="h-3.5 w-3.5 text-indigo-600" />
                <span>Действия на тепловой карте (клики)</span>
              </div>
              {clicks.length === 0 ? (
                <div className="text-[11px] text-[#888888]">Кликнутые селекторы отсутствуют</div>
              ) : (
                <div className="space-y-1.5">
                  {clicks.map((clk, cIdx) => (
                    <div
                      key={cIdx}
                      className="flex items-center justify-between rounded-[4px] bg-[#fafafa] px-2 py-1 text-[11px]"
                    >
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-mono text-indigo-600">{clk.selector}</span>
                        {clk.text && <span className="text-[#666666]">(«{clk.text}»)</span>}
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-[#888888]">
                        {clk.count || 1} клик(ов)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-3 space-y-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#666666]">
                <Eye className="h-3.5 w-3.5 text-indigo-600" />
                <span>Глубина скролла и поведение</span>
              </div>
              <div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-[#666666]">Глубина скролла</span>
                  <span className="font-mono font-semibold text-[#111111]">{scrollDepth}%</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-[#f0f0f0]">
                  <div
                    className="h-1.5 rounded-full bg-indigo-600 transition-all"
                    style={{ width: `${Math.min(100, Math.max(0, scrollDepth))}%` }}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px] border-t border-[#f0f0f0] pt-2">
                <span className="text-[#666666]">Доскроллил до подвала</span>
                <span
                  className={cn(
                    "font-medium",
                    readToBottom ? "text-emerald-700" : "text-[#888888]",
                  )}
                >
                  {readToBottom ? "Да (100% прочитано)" : "Нет"}
                </span>
              </div>
            </div>
          </div>

          {/* Устройство клиента */}
          {device && (
            <div className="flex flex-wrap items-center gap-4 text-[11px] text-[#666666] pt-1 border-t border-[#f0f0f0]">
              <div className="flex items-center gap-1">
                <Smartphone className="h-3 w-3 text-[#888888]" />
                <span>Платформа: {device.platform || "Desktop"}</span>
              </div>
              <div className="flex items-center gap-1">
                <Layers className="h-3 w-3 text-[#888888]" />
                <span>Экран: {device.screen || "1920x1080"}</span>
              </div>
              {item.dealTitle && (
                <div className="ml-auto flex items-center gap-1">
                  <span className="text-[#888888]">Сделка:</span>
                  <span className="font-medium text-[#111111]">{item.dealTitle}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Карточка 2: Лид-форма / Конверсионное действие (form_submission)
// ---------------------------------------------------------------------------
function FormSubmissionCard({
  item,
  isOpen,
  onToggle,
}: {
  item: ContactActivityItemDTO;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const payload = item.payload as any;
  const domain = payload.domain || "getvoxly.ru";
  const formName = payload.formName || "Лид-форма на сайте";
  const formFields: Record<string, unknown> = payload.formFields || {};
  const touchpoints = payload.touchpoints || {};
  const utmSource = touchpoints.utmSource || touchpoints.utm_source;
  const utmMedium = touchpoints.utmMedium || touchpoints.utm_medium;
  const utmCampaign = touchpoints.utmCampaign || touchpoints.utm_campaign;
  const utmContent = touchpoints.utmContent || touchpoints.utm_content;
  const touchpointCount = touchpoints.touchpointCount ?? touchpoints.touchpoints_count ?? 3;
  const timeToSubmit = touchpoints.timeToSubmitSeconds ?? 384;
  const referrer = touchpoints.referrer || "Прямой переход (Direct)";

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs transition-colors hover:border-[#cccccc]">
      {/* Шапка карточки */}
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center justify-between p-3.5 select-none"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-emerald-200 bg-emerald-50 text-emerald-600">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="font-mono text-[11px] text-[#666666]">
                {formatFullDateTime(item.timestamp)}
              </span>
              <span className="font-semibold text-emerald-700">{domain}</span>
              <span className="text-[#666666]">—</span>
              <span className="font-medium text-[#111111]">отправил заявку через форму</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#888888]">
              <span>Форма: {formName}</span>
              <span>•</span>
              <span>{touchpointCount} касания</span>
              {utmSource && (
                <>
                  <span>•</span>
                  <span>UTM: {utmSource}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TagPill color="emerald">Конверсия</TagPill>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[#888888] transition-transform duration-150",
              isOpen && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Раскрывающийся блок с параметрами заявки и Customer Journey */}
      {isOpen && (
        <div className="border-t border-[#f0f0f0] bg-[#fafafa]/50 p-4 text-[12px] space-y-4">
          {/* Заполненные поля формы */}
          <div>
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-[#666666]">
              <FileText className="h-3.5 w-3.5" />
              <span>Заполненные параметры и поля формы</span>
            </div>
            <div className="overflow-hidden rounded-[6px] border border-[#e5e5e5] bg-white">
              <table className="w-full text-left text-[11px]">
                <tbody className="divide-y divide-[#f0f0f0]">
                  {Object.entries(formFields).map(([key, val]) => (
                    <tr key={key} className="hover:bg-black/[0.01]">
                      <td className="w-1/3 px-3 py-2 font-medium text-[#666666] bg-[#fafafa]">
                        {key}
                      </td>
                      <td className="px-3 py-2 font-mono text-[#111111]">
                        {typeof val === "object" ? JSON.stringify(val) : String(val ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Customer Journey & Точки касания */}
          <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-3 space-y-3">
            <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#666666]">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                <span>Customer Journey (путь до конверсии)</span>
              </div>
              <div className="flex items-center gap-3 text-[11px] text-[#666666]">
                <span>
                  Касаний: <b className="text-[#111111]">{touchpointCount}</b>
                </span>
                <span>•</span>
                <span>
                  Время до отправки: <b className="text-[#111111]">{formatDuration(timeToSubmit)}</b>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[11px]">
              <div>
                <span className="text-[#888888]">Источник первого захода (Referrer):</span>
                <div className="mt-0.5 font-mono text-[#111111] bg-[#fafafa] p-1.5 rounded-[4px] border border-[#e5e5e5]">
                  {referrer}
                </div>
              </div>
              <div>
                <span className="text-[#888888]">UTM-метки кампании:</span>
                <div className="mt-0.5 flex flex-wrap gap-1">
                  {utmSource && <TagPill color="sky">source: {utmSource}</TagPill>}
                  {utmMedium && <TagPill color="slate">medium: {utmMedium}</TagPill>}
                  {utmCampaign && <TagPill color="amber">camp: {utmCampaign}</TagPill>}
                  {utmContent && <TagPill color="violet">content: {utmContent}</TagPill>}
                  {!utmSource && !utmMedium && (
                    <span className="text-[#888888] font-mono">Прямой трафик (organic/direct)</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Карточка 3: Входящая сессия Telegram / Мессенджера (im_session_inbound)
// ---------------------------------------------------------------------------
function InboundSessionCard({
  item,
  isOpen,
  onToggle,
}: {
  item: ContactActivityItemDTO;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const payload = item.payload as any;
  const channel = payload.channel || "telegram";
  const clientHandle = payload.clientHandle || item.clientHandle || "@client";
  const accountHandle = payload.accountHandle || "@getvoxly_bot";
  const messageCount = payload.messageCount || 1;
  const durationSeconds = payload.durationSeconds || 120;
  const aiSummary = payload.aiSummary || payload.summary || item.description || "Обращение клиента обработано.";
  const keyPoints: string[] = payload.keyPoints || [];
  const sentiment = payload.sentiment || "neutral";

  const channelLabel =
    channel === "whatsapp" ? "WhatsApp" : channel === "webchat" ? "Онлайн-чат" : "Telegram";

  const sentimentColor: TagColor =
    sentiment === "positive" ? "emerald" : sentiment === "negative" ? "rose" : "slate";

  const sentimentLabel =
    sentiment === "positive" ? "Позитивная" : sentiment === "negative" ? "Претензия" : "Нейтральная";

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs transition-colors hover:border-[#cccccc]">
      {/* Шапка карточки */}
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center justify-between p-3.5 select-none"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-sky-200 bg-sky-50 text-sky-600">
            <MessageCircle className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="font-mono text-[11px] text-[#666666]">
                {formatFullDateTime(item.timestamp)}
              </span>
              <span className="text-[#666666]">—</span>
              <span className="font-medium text-[#111111]">
                клиент <b className="font-mono text-sky-700">{clientHandle}</b> написал в {channelLabel}{" "}
                <span className="font-mono text-[#666666]">{accountHandle}</span>
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#888888]">
              <span>Длительность: {formatDuration(durationSeconds)}</span>
              <span>•</span>
              <span>Сообщений: {messageCount}</span>
              {item.dealTitle && (
                <>
                  <span>•</span>
                  <span>Сделка: {item.dealTitle}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TagPill color={sentimentColor}>{sentimentLabel}</TagPill>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[#888888] transition-transform duration-150",
              isOpen && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Раскрывающийся блок: ИИ-саммари и ключевые тезисы (БЕЗ свалки сообщений!) */}
      {isOpen && (
        <div className="border-t border-[#f0f0f0] bg-[#fafafa]/50 p-4 text-[12px] space-y-3">
          {/* Блок ИИ-саммари */}
          <div className="rounded-[6px] border border-sky-200 bg-sky-50/40 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-sky-800">
              <Sparkles className="h-3.5 w-3.5 text-sky-600" />
              <span>Выжимка диалога (AI Summary)</span>
            </div>
            <p className="leading-relaxed text-[#111111]">{aiSummary}</p>
          </div>

          {/* Ключевые тезисы диалога */}
          {keyPoints.length > 0 && (
            <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-3">
              <div className="mb-2 text-[11px] font-semibold text-[#666666]">
                Ключевые тезисы и запросы клиента
              </div>
              <ul className="space-y-1.5 text-[11px] text-[#333333]">
                {keyPoints.map((kp, kIdx) => (
                  <li key={kIdx} className="flex items-start gap-2">
                    <span className="text-sky-600 font-bold">•</span>
                    <span>{kp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Статус сессии и ссылка на сделку */}
          <div className="flex flex-wrap items-center justify-between text-[11px] text-[#888888] pt-1">
            <div className="flex items-center gap-3">
              <span>Канал: {channelLabel}</span>
              <span>•</span>
              <span>Сообщений в сессии: {messageCount}</span>
            </div>
            {item.dealId && (
              <Link
                href={`/crm/deals?record=${item.dealId}`}
                className="flex items-center gap-1 font-medium text-[#4a38f5] hover:underline"
              >
                <span>Перейти к сделке</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Карточка 4: Исходящая сессия менеджера (im_session_outbound)
// ---------------------------------------------------------------------------
function OutboundSessionCard({
  item,
  isOpen,
  onToggle,
}: {
  item: ContactActivityItemDTO;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const payload = item.payload as any;
  const channel = payload.channel || "telegram";
  const managerName = payload.managerName || item.authorName || "Менеджер";
  const clientHandle = payload.clientHandle || item.clientHandle || "@client";
  const durationSeconds = payload.durationSeconds || 60;
  const statusLabel = payload.statusLabel || "Ответ отправлен";
  const summary = payload.summary || item.description || "Менеджер связался с клиентом.";
  const agreements: string[] = payload.agreements || [];

  const channelLabel =
    channel === "whatsapp" ? "WhatsApp" : channel === "webchat" ? "Онлайн-чат" : "Telegram";

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs transition-colors hover:border-[#cccccc]">
      {/* Шапка карточки */}
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center justify-between p-3.5 select-none"
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border border-violet-200 bg-violet-50 text-violet-600">
            <UserCheck className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="font-mono text-[11px] text-[#666666]">
                {formatFullDateTime(item.timestamp)}
              </span>
              <span className="text-[#666666]">—</span>
              <span className="font-medium text-[#111111]">
                менеджер <b className="text-violet-800">{managerName}</b> написал в {channelLabel}{" "}
                клиенту <span className="font-mono text-sky-700">{clientHandle}</span>
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#888888]">
              <span>Длительность: {formatDuration(durationSeconds)}</span>
              <span>•</span>
              <span>Статус: {statusLabel}</span>
              {item.dealTitle && (
                <>
                  <span>•</span>
                  <span>Сделка: {item.dealTitle}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TagPill color="violet">{statusLabel}</TagPill>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[#888888] transition-transform duration-150",
              isOpen && "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Раскрывающийся блок: резюме договоренностей и следующие шаги */}
      {isOpen && (
        <div className="border-t border-[#f0f0f0] bg-[#fafafa]/50 p-4 text-[12px] space-y-3">
          {/* Резюме ответа менеджера */}
          <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-3">
            <div className="mb-1.5 text-[11px] font-semibold text-[#666666]">
              Резюме ответа и предоставленной информации
            </div>
            <p className="leading-relaxed text-[#111111]">{summary}</p>
          </div>

          {/* Договоренности и следующий шаг */}
          {agreements.length > 0 && (
            <div className="rounded-[6px] border border-violet-100 bg-violet-50/30 p-3">
              <div className="mb-2 text-[11px] font-semibold text-violet-800">
                Зафиксированные договоренности и следующий шаг
              </div>
              <ul className="space-y-1.5 text-[11px] text-[#222222]">
                {agreements.map((ag, aIdx) => (
                  <li key={aIdx} className="flex items-start gap-2">
                    <CheckCircle2 className="h-3.5 w-3.5 text-violet-600 shrink-0 mt-0.5" />
                    <span>{ag}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-[#888888] pt-1">
            <span>Ответственный менеджер: {managerName}</span>
            {item.dealId && (
              <Link
                href={`/crm/deals?record=${item.dealId}`}
                className="flex items-center gap-1 font-medium text-[#4a38f5] hover:underline"
              >
                <span>Карточка сделки</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Карточка CRM: Заметки, Задачи, Смена этапа
// ---------------------------------------------------------------------------
function GenericCrmEventCard({
  item,
  isOpen,
  onToggle,
}: {
  item: ContactActivityItemDTO;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const isNote = item.activityKind === "note";
  const isTask = item.activityKind === "task";
  const isStage = item.activityKind === "stage_change";

  const Icon = isNote ? StickyNote : isTask ? Clock : Activity;
  const iconColor = isNote
    ? "border-amber-200 bg-amber-50 text-amber-600"
    : isTask
      ? "border-emerald-200 bg-emerald-50 text-emerald-600"
      : "border-violet-200 bg-violet-50 text-violet-600";

  const pillColor: TagColor = isNote ? "amber" : isTask ? "emerald" : "violet";
  const pillLabel = isNote ? "Заметка" : isTask ? "Задача" : "Этап сделки";

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs transition-colors hover:border-[#cccccc]">
      <div
        onClick={onToggle}
        className="flex cursor-pointer items-center justify-between p-3.5 select-none"
      >
        <div className="flex items-center gap-2.5">
          <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] border", iconColor)}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span className="font-mono text-[11px] text-[#666666]">
                {formatFullDateTime(item.timestamp)}
              </span>
              <span className="text-[#666666]">—</span>
              <span className="font-medium text-[#111111]">{item.title}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#888888]">
              {item.authorName && <span>Автор: {item.authorName}</span>}
              {item.dealTitle && (
                <>
                  <span>•</span>
                  <span>Сделка: {item.dealTitle}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <TagPill color={pillColor}>{pillLabel}</TagPill>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-[#888888] transition-transform duration-150",
              isOpen && "rotate-180",
            )}
          />
        </div>
      </div>

      {isOpen && item.description && (
        <div className="border-t border-[#f0f0f0] bg-[#fafafa]/50 p-4 text-[12px]">
          <div className="whitespace-pre-wrap leading-relaxed text-[#333333]">
            {item.description}
          </div>
        </div>
      )}
    </div>
  );
}
