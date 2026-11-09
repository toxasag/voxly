"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  MessageSquare,
  Search,
  ExternalLink,
  ChevronLeft,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { CrmChatView } from "@/components/crm/shared/CrmChatView";
import { DialogueFeedbackModal } from "@/components/ai-bots/DialogueFeedbackModal";
import { useInboxThreads, type InboxThreadDTO } from "@/lib/api/use-inbox";

function formatThreadTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const isToday =
      d.getDate() === now.getDate() &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();

    if (isToday) {
      return new Intl.DateTimeFormat("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(d);
    }

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return "Вчера";

    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
    }).format(d);
  } catch {
    return "";
  }
}

function getChannelBadge(channel: string) {
  const norm = channel.toLowerCase();
  switch (norm) {
    case "telegram":
      return { label: "Telegram", className: "bg-sky-50 text-sky-700 border-sky-200" };
    case "whatsapp":
      return { label: "WhatsApp", className: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "max":
    case "rumax":
      return { label: "MAX", className: "bg-violet-50 text-violet-700 border-violet-200" };
    case "webchat":
      return { label: "Онлайн-чат", className: "bg-blue-50 text-blue-700 border-blue-200" };
    default:
      return { label: channel || "Чат", className: "bg-[#fafafa] text-[#666666] border-[#e5e5e5]" };
  }
}

const CHANNELS = [
  { id: "all", label: "Все каналы" },
  { id: "telegram", label: "Telegram" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "max", label: "MAX" },
] as const;

export default function InboxPage() {
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [showInboxFeedback, setShowInboxFeedback] = useState(false);

  const {
    data: threads = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useInboxThreads(
    {
      channel: channelFilter,
      unread_only: unreadOnly,
      search: searchQuery,
    },
    { refetchInterval: 5000 },
  );

  // Автоматический выбор первого диалога, если текущий не выбран или исчез из фильтра
  const activeThread = useMemo(() => {
    if (threads.length === 0) return null;
    if (selectedDealId) {
      const found = threads.find((t) => t.dealId === selectedDealId);
      if (found) return found;
    }
    return threads[0] ?? null;
  }, [threads, selectedDealId]);

  const unreadCount = useMemo(() => {
    return threads.filter((t) => t.unreadCount > 0 || t.lastDirection === "inbound").length;
  }, [threads]);

  const handleSelectThread = (thread: InboxThreadDTO) => {
    setSelectedDealId(thread.dealId);
    setMobileDetailOpen(true);
  };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col -m-6 bg-white overflow-hidden">
      {/* Шапка Inbox */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#e5e5e5] bg-white px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5]">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold text-[#111111]">Входящие</h1>
              {unreadCount > 0 && (
                <span className="rounded-full bg-[#4a38f5] px-2 py-0.5 text-[11px] font-medium text-white tabular-nums">
                  {unreadCount}
                </span>
              )}
            </div>
            <p className="text-xs text-[#666666]">
              Единый омниканальный центр сообщений (Telegram, WhatsApp, MAX)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa] disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin text-[#4a38f5]")} />
            <span className="hidden sm:inline">Обновить</span>
          </button>
        </div>
      </div>

      {/* Основная рабочая область: Сплиттер Master-Detail */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Левая колонка: список диалогов */}
        <aside
          className={cn(
            "flex flex-col border-r border-[#e5e5e5] bg-[#fbfbfb] transition-all",
            "w-full md:w-80 lg:w-96 shrink-0",
            mobileDetailOpen ? "hidden md:flex" : "flex",
          )}
        >
          {/* Поиск и фильтры каналов */}
          <div className="space-y-2 border-b border-[#e5e5e5] bg-white p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по диалогам и контактам..."
                className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] pl-8 pr-7 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              {searchQuery.trim() && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#111111]"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Фильтры каналов */}
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              {CHANNELS.map((ch) => {
                const active = channelFilter === ch.id;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setChannelFilter(ch.id)}
                    className={cn(
                      "rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors shrink-0",
                      active
                        ? "bg-[#4a38f5] text-white shadow-2xs"
                        : "text-[#666666] hover:bg-black/[0.04] hover:text-[#111111]",
                    )}
                  >
                    {ch.label}
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => setUnreadOnly((prev) => !prev)}
                className={cn(
                  "ml-auto rounded-[6px] px-2 py-1 text-[11px] font-medium transition-colors shrink-0 border",
                  unreadOnly
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-transparent text-[#666666] hover:bg-black/[0.04]",
                )}
              >
                Неотвеченные
              </button>
            </div>
          </div>

          {/* Список тредов */}
          <div className="flex-1 overflow-y-auto divide-y divide-[#f0f0f0]">
            {isLoading ? (
              <div className="p-3 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex gap-3 p-2">
                    <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <div className="flex justify-between">
                        <Skeleton className="h-3.5 w-24" />
                        <Skeleton className="h-3 w-10" />
                      </div>
                      <Skeleton className="h-3 w-40" />
                      <Skeleton className="h-2.5 w-28" />
                    </div>
                  </div>
                ))}
              </div>
            ) : isError ? (
              <div className="p-4">
                <div role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
                  <p className="font-semibold text-rose-900">Не удалось загрузить сообщения</p>
                  <p className="mt-1">{error instanceof Error ? error.message : "Ошибка сервера"}</p>
                  <button
                    type="button"
                    onClick={() => void refetch()}
                    className="mt-2 text-rose-900 underline font-medium"
                  >
                    Повторить
                  </button>
                </div>
              </div>
            ) : threads.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={MessageSquare}
                  title="Нет сообщений"
                  description={
                    searchQuery.trim()
                      ? "По вашему запросу диалогов не найдено."
                      : unreadOnly
                        ? "Все входящие сообщения обработаны."
                        : "Диалоги с клиентами появятся здесь при входящем сообщении или создании сделки."
                  }
                />
              </div>
            ) : (
              threads.map((thread) => {
                const isSelected = activeThread?.dealId === thread.dealId;
                const channelBadge = getChannelBadge(thread.channel);
                const needsReply = thread.unreadCount > 0 || thread.lastDirection === "inbound";

                return (
                  <button
                    key={thread.dealId}
                    type="button"
                    onClick={() => handleSelectThread(thread)}
                    className={cn(
                      "w-full text-left p-3.5 transition-colors cursor-pointer flex gap-3 relative",
                      isSelected
                        ? "bg-white shadow-2xs border-l-[3px] border-l-[#4a38f5]"
                        : "hover:bg-black/[0.02]",
                    )}
                  >
                    {/* Аватар с первой буквой */}
                    <div className="relative shrink-0">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0f0f0] text-xs font-semibold text-[#111111]">
                        {thread.contactName.charAt(0).toUpperCase() || "К"}
                      </div>
                      {needsReply && (
                        <span className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4a38f5] opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#4a38f5]" />
                        </span>
                      )}
                    </div>

                    {/* Текстовая колонка треда */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="truncate text-[13px] font-semibold text-[#111111]">
                          {thread.contactName}
                        </span>
                        <span className="text-[10px] text-[#888888] shrink-0 font-mono">
                          {formatThreadTime(thread.lastMessageAt)}
                        </span>
                      </div>

                      {/* Канал + Сделка */}
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <span
                          className={cn(
                            "rounded-[4px] border px-1.5 py-0.2 text-[10px] font-medium leading-none shrink-0",
                            channelBadge.className,
                          )}
                        >
                          {channelBadge.label}
                        </span>
                        <span className="truncate text-[11px] text-[#666666]">
                          {thread.dealTitle}
                        </span>
                      </div>

                      {/* Текст последнего сообщения */}
                      <p
                        className={cn(
                          "truncate text-xs",
                          needsReply ? "font-medium text-[#111111]" : "text-[#888888]",
                        )}
                      >
                        {thread.lastDirection === "outbound" && (
                          <span className="text-[#888888] font-normal">Вы: </span>
                        )}
                        {thread.lastMessage}
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* Правая колонка: Чат активного треда */}
        <section
          className={cn(
            "flex flex-1 flex-col bg-white overflow-hidden min-w-0",
            !mobileDetailOpen && "hidden md:flex",
          )}
        >
          {activeThread ? (
            <div className="flex flex-1 flex-col h-full overflow-hidden">
              {/* Шапка чата */}
              <div className="flex shrink-0 items-center justify-between border-b border-[#e5e5e5] bg-white px-4 py-2.5">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => setMobileDetailOpen(false)}
                    className="rounded-[6px] p-1 text-[#666666] hover:bg-black/[0.04] md:hidden"
                    aria-label="Назад к списку"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>

                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f0f0f0] text-xs font-semibold text-[#111111] shrink-0">
                    {activeThread.contactName.charAt(0).toUpperCase() || "К"}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[#111111]">
                        {activeThread.contactName}
                      </span>
                      {activeThread.contactPhone && (
                        <span className="hidden sm:inline text-xs text-[#666666] font-mono">
                          {activeThread.contactPhone}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-[#888888] truncate">
                      <span className="truncate">{activeThread.dealTitle}</span>
                      <span>·</span>
                      <span className="rounded bg-[#f5f5f5] px-1.5 py-0.2 text-[10px] text-[#666666]">
                        {activeThread.stageName}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowInboxFeedback(true)}
                    title="Оценить качество ответов ИИ и обучить агента по этому диалогу"
                    className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-2.5 py-1 text-xs font-medium text-[#4a38f5] shadow-2xs hover:bg-[#4a38f5]/10 transition-colors cursor-pointer"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-[#4a38f5]" />
                    <span>Обучить бота</span>
                  </button>
                  <Link
                    href={`/crm/deals?record=${activeThread.dealId}`}
                    className="inline-flex items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors"
                  >
                    <span>Карточка сделки</span>
                    <ExternalLink className="h-3 w-3 text-[#888888]" />
                  </Link>
                </div>
              </div>

              {/* Полнофункциональный чат CrmChatView */}
              <div className="flex-1 min-h-0 overflow-hidden">
                <CrmChatView
                  key={activeThread.dealId}
                  entityType="deal"
                  entityId={activeThread.dealId}
                  entityName={activeThread.contactName}
                  className="h-full border-0 rounded-none shadow-none"
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 bg-[#fafafa]">
              <EmptyState
                icon={MessageSquare}
                title="Выберите диалог"
                description="Выберите чат из списка слева, чтобы просмотреть переписку и ответить клиенту."
              />
            </div>
          )}
        </section>
      </div>

      {activeThread && (
        <DialogueFeedbackModal
          open={showInboxFeedback}
          onClose={() => setShowInboxFeedback(false)}
          dealId={activeThread.dealId}
          dealTitle={activeThread.dealTitle}
          contactName={activeThread.contactName}
        />
      )}
    </div>
  );
}
