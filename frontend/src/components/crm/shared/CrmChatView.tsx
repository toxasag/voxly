"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Bot,
  CheckCheck,
  Clock,
  Loader2,
  MessageCircle,
  Paperclip,
  Pause,
  Play,
  PowerOff,
  RefreshCw,
  Send,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import {
  useCrmChat,
  type ChatMessageDTO,
  type CrmChatEntityType,
  type SendFromOptionDTO,
} from "@/lib/api/use-crm-chat";
import { TelegramComposer, type AttachedFile } from "./TelegramComposer";

export interface CrmChatViewProps {
  entityType: CrmChatEntityType;
  entityId: string;
  entityName?: string;
  className?: string;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

function formatDateHeader(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const today = new Date();
    const isToday =
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear();

    if (isToday) return "Сегодня";

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday =
      d.getDate() === yesterday.getDate() &&
      d.getMonth() === yesterday.getMonth() &&
      d.getFullYear() === yesterday.getFullYear();

    if (isYesterday) return "Вчера";

    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(d);
  } catch {
    return "";
  }
}

function normalizeChannel(ch: string | undefined): string {
  if (!ch) return "unknown";
  const lower = ch.toLowerCase();
  if (lower === "rumax") return "max";
  return lower;
}

function getChannelBadge(channel: string) {
  switch (channel.toLowerCase()) {
    case "telegram":
      return {
        slug: "telegram",
        label: "Telegram",
        color: "text-[#229ed9] bg-[#229ed9]/10 border-[#229ed9]/25",
        activeBorder: "border-[#229ed9] text-[#229ed9]",
        badgeBg: "bg-[#229ed9]/15 text-[#229ed9]",
        dotColor: "bg-[#229ed9]",
      };
    case "whatsapp":
      return {
        slug: "whatsapp",
        label: "WhatsApp",
        color: "text-[#16a34a] bg-[#16a34a]/10 border-[#16a34a]/25",
        activeBorder: "border-[#16a34a] text-[#16a34a]",
        badgeBg: "bg-[#16a34a]/15 text-[#16a34a]",
        dotColor: "bg-[#16a34a]",
      };
    case "max":
    case "rumax":
      return {
        slug: "max",
        label: "MAX",
        color: "text-[#4a38f5] bg-[#4a38f5]/10 border-[#4a38f5]/25",
        activeBorder: "border-[#4a38f5] text-[#4a38f5]",
        badgeBg: "bg-[#4a38f5]/15 text-[#4a38f5]",
        dotColor: "bg-[#4a38f5]",
      };
    case "webchat":
      return {
        slug: "webchat",
        label: "Онлайн-чат",
        color: "text-[#666666] bg-[#f0f0f0] border-[#e5e5e5]",
        activeBorder: "border-[#666666] text-[#111111]",
        badgeBg: "bg-[#f0f0f0] text-[#111111]",
        dotColor: "bg-[#888888]",
      };
    default:
      return {
        slug: channel.toLowerCase(),
        label: channel.toUpperCase(),
        color: "text-[#666666] bg-[#f0f0f0] border-[#e5e5e5]",
        activeBorder: "border-[#666666] text-[#111111]",
        badgeBg: "bg-[#f0f0f0] text-[#111111]",
        dotColor: "bg-[#888888]",
      };
  }
}

function renderChatMessageContent(content: string): React.ReactNode {
  if (!content) return null;

  const lines = content.split("\n");

  return lines.map((line, lineIdx) => {
    const isQuote = /^>\s?/.test(line);
    const lineText = isQuote ? line.replace(/^>\s?/, "") : line;

    // Регулярное выражение для распознавания форматирования Markdown и HTML
    const regex = /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|<b>.*?<\/b>|<strong>.*?<\/strong>|(?<!\*)\*[^*]+?\*(?!\*)|<i>.*?<\/i>|<em>.*?<\/em>|<u>.*?<\/u>|~~[^~]+?~~|<s>.*?<\/s>|<del>.*?<\/del>|`[^`]+?`|<code>.*?<\/code>|\|\|[^|]+?\|\||\[[^\]]+?\]\([^)]+?\)|https?:\/\/[^\s]+)/g;
    const parts = lineText.split(regex);

    const rendered = parts.map((part, partIdx) => {
      if (!part) return null;

      // Bold + Italic
      if (part.startsWith("***") && part.endsWith("***") && part.length >= 6) {
        return (
          <strong key={partIdx} className="font-semibold italic text-[#111111]">
            {part.slice(3, -3)}
          </strong>
        );
      }
      // Bold
      if (
        (part.startsWith("**") && part.endsWith("**") && part.length >= 4) ||
        (part.startsWith("<b>") && part.endsWith("</b>")) ||
        (part.startsWith("<strong>") && part.endsWith("</strong>"))
      ) {
        const text = part.startsWith("**")
          ? part.slice(2, -2)
          : part.startsWith("<b>")
          ? part.slice(3, -4)
          : part.slice(8, -9);
        return (
          <strong key={partIdx} className="font-semibold text-[#111111]">
            {text}
          </strong>
        );
      }
      // Italic
      if (
        (part.startsWith("*") && part.endsWith("*") && part.length >= 2) ||
        (part.startsWith("<i>") && part.endsWith("</i>")) ||
        (part.startsWith("<em>") && part.endsWith("</em>"))
      ) {
        const text = part.startsWith("*")
          ? part.slice(1, -1)
          : part.startsWith("<i>")
          ? part.slice(3, -4)
          : part.slice(4, -5);
        return (
          <em key={partIdx} className="italic text-[#111111]">
            {text}
          </em>
        );
      }
      // Underline
      if (part.startsWith("<u>") && part.endsWith("</u>") && part.length >= 7) {
        return (
          <u key={partIdx} className="underline text-[#111111]">
            {part.slice(3, -4)}
          </u>
        );
      }
      // Strikethrough
      if (
        (part.startsWith("~~") && part.endsWith("~~") && part.length >= 4) ||
        (part.startsWith("<s>") && part.endsWith("</s>")) ||
        (part.startsWith("<del>") && part.endsWith("</del>"))
      ) {
        const text = part.startsWith("~~")
          ? part.slice(2, -2)
          : part.startsWith("<s>")
          ? part.slice(3, -4)
          : part.slice(5, -6);
        return (
          <s key={partIdx} className="line-through text-[#666666]">
            {text}
          </s>
        );
      }
      // Code
      if (
        (part.startsWith("`") && part.endsWith("`") && part.length >= 2) ||
        (part.startsWith("<code>") && part.endsWith("</code>"))
      ) {
        const text = part.startsWith("`") ? part.slice(1, -1) : part.slice(6, -7);
        return (
          <code
            key={partIdx}
            className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[12px] text-[#111111]"
          >
            {text}
          </code>
        );
      }
      // Spoiler
      if (part.startsWith("||") && part.endsWith("||") && part.length >= 4) {
        return (
          <span
            key={partIdx}
            className="cursor-pointer rounded bg-[#e5e5e5] px-1 py-0.2 text-transparent hover:text-[#111111] transition-colors select-none"
            title="Спойлер (наведите для просмотра)"
          >
            {part.slice(2, -2)}
          </span>
        );
      }
      // Link: [text](url)
      if (part.startsWith("[") && part.includes("](") && part.endsWith(")")) {
        const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (linkMatch && linkMatch[1] && linkMatch[2]) {
          return (
            <a
              key={partIdx}
              href={linkMatch[2]}
              target="_blank"
              rel="noreferrer"
              className="text-[#2aabee] underline hover:text-[#208bbf] break-all"
            >
              {linkMatch[1]}
            </a>
          );
        }
      }
      // Raw URL
      if (part.startsWith("http://") || part.startsWith("https://")) {
        return (
          <a
            key={partIdx}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="text-[#2aabee] underline hover:text-[#208bbf] break-all"
          >
            {part}
          </a>
        );
      }

      return <span key={partIdx}>{part}</span>;
    });

    if (isQuote) {
      return (
        <blockquote
          key={lineIdx}
          className="my-1 border-l-2 border-[#2aabee] pl-2.5 text-[#555555] italic"
        >
          {rendered}
        </blockquote>
      );
    }

    return (
      <span key={lineIdx}>
        {rendered}
        {lineIdx < lines.length - 1 && <br />}
      </span>
    );
  });
}

export function CrmChatView({
  entityType,
  entityId,
  entityName,
  className,
}: CrmChatViewProps) {
  const {
    messagesQuery,
    sendFromOptionsQuery,
    aiStatusQuery,
    sendMessageMutation,
    aiControlMutation,
    aiDraftMutation,
    syncHistoryMutation,
  } = useCrmChat({ entityType, entityId, live: true });

  const [input, setInput] = useState("");
  const [selectedChannelAccountId, setSelectedChannelAccountId] = useState<string>("");
  const [activeChannel, setActiveChannel] = useState<string>("all");
  const hasUserSelectedTabRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const messages = messagesQuery.data ?? [];
  const sendFromOptions = sendFromOptionsQuery.data ?? [];
  const aiStatus = aiStatusQuery.data;

  // Список доступных каналов переписки (с подсчетом сообщений)
  const availableChannels = useMemo(() => {
    const channelMap = new Map<string, { slug: string; label: string; count: number }>();

    // 1. Каналы из доступных для отправки аккаунтов
    for (const opt of sendFromOptions) {
      const slug = normalizeChannel(opt.channel);
      if (slug === "system" || slug === "unknown") continue;
      if (!channelMap.has(slug)) {
        channelMap.set(slug, {
          slug,
          label: getChannelBadge(slug).label,
          count: 0,
        });
      }
    }

    // 2. Каналы из фактических сообщений
    for (const msg of messages) {
      const slug = normalizeChannel(msg.channel);
      if (slug === "system" || slug === "unknown") continue;
      const existing = channelMap.get(slug);
      if (existing) {
        existing.count += 1;
      } else {
        channelMap.set(slug, {
          slug,
          label: getChannelBadge(slug).label,
          count: 1,
        });
      }
    }

    return Array.from(channelMap.values());
  }, [messages, sendFromOptions]);

  // Автоматический выбор первого доступного аккаунта отправки
  useEffect(() => {
    if (sendFromOptions.length === 0) return;
    if (selectedChannelAccountId && sendFromOptions.some((o) => o.channelAccountId === selectedChannelAccountId)) {
      return;
    }
    const defaultAvailable = sendFromOptions.find((o) => o.isDefault && o.available);
    if (defaultAvailable) {
      setSelectedChannelAccountId(defaultAvailable.channelAccountId);
      return;
    }
    const firstAvailable = sendFromOptions.find((o) => o.available);
    if (firstAvailable) {
      setSelectedChannelAccountId(firstAvailable.channelAccountId);
    } else {
      setSelectedChannelAccountId(sendFromOptions[0]?.channelAccountId ?? "");
    }
  }, [sendFromOptions, selectedChannelAccountId]);

  // Первоначальный выбор вкладки канала (по умолчанию канал последнего диалога или первого активного канала)
  useEffect(() => {
    if (hasUserSelectedTabRef.current) return;
    if (messages.length === 0 && sendFromOptions.length === 0) return;

    // Предпочитаем канал последнего сообщения в переписке
    const lastMessageWithChannel = [...messages].reverse().find((m) => m.channel && m.channel !== "system");
    if (lastMessageWithChannel) {
      setActiveChannel(normalizeChannel(lastMessageWithChannel.channel));
      return;
    }

    const defaultOpt = sendFromOptions.find((o) => o.isDefault && o.available) || sendFromOptions.find((o) => o.available);
    if (defaultOpt) {
      setActiveChannel(normalizeChannel(defaultOpt.channel));
    }
  }, [messages, sendFromOptions]);

  // Переключение вкладки канала пользователем
  const handleSelectChannelTab = useCallback(
    (channelSlug: string) => {
      hasUserSelectedTabRef.current = true;
      setActiveChannel(channelSlug);

      if (channelSlug !== "all") {
        // Синхронизируем выпадающий список «Пишем от:» с выбранным каналом
        const matchingOption =
          sendFromOptions.find((o) => normalizeChannel(o.channel) === channelSlug && o.available) ||
          sendFromOptions.find((o) => normalizeChannel(o.channel) === channelSlug);

        if (matchingOption) {
          setSelectedChannelAccountId(matchingOption.channelAccountId);
        }
      }
    },
    [sendFromOptions],
  );

  // Выбор аккаунта в поле «Пишем от:»
  const handleSelectAccount = useCallback(
    (channelAccountId: string) => {
      hasUserSelectedTabRef.current = true;
      setSelectedChannelAccountId(channelAccountId);

      const opt = sendFromOptions.find((o) => o.channelAccountId === channelAccountId);
      if (opt) {
        // При переключении канала отправки открываем чат этого же канала
        setActiveChannel(normalizeChannel(opt.channel));
      }
    },
    [sendFromOptions],
  );

  const selectedOption: SendFromOptionDTO | undefined = useMemo(() => {
    return sendFromOptions.find((o) => o.channelAccountId === selectedChannelAccountId);
  }, [sendFromOptions, selectedChannelAccountId]);

  // Фильтрация сообщений по выбранному каналу
  const displayedMessages = useMemo(() => {
    if (activeChannel === "all") return messages;
    return messages.filter((m) => normalizeChannel(m.channel) === activeChannel);
  }, [messages, activeChannel]);

  // Автоскролл к низу переписки при открытии или получении сообщений
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [displayedMessages.length, activeChannel]);

  // Отправка сообщения
  const handleSend = useCallback(
    async (attached?: AttachedFile) => {
      const text = input.trim();
      if ((!text && !attached) || sendMessageMutation.isPending) return;

      const lastMessageWithChannel = [...messages].reverse().find((m) => m.channel && m.channel !== "system");
      const fallbackChannel = lastMessageWithChannel?.channel ?? "telegram";
      const channel = selectedOption?.channel ?? (activeChannel !== "all" ? activeChannel : fallbackChannel);
      const channelAccountId = selectedOption?.channelAccountId;

      try {
        await sendMessageMutation.mutateAsync({
          content: text || (attached ? attached.name : "Вложение"),
          channel,
          channel_account_id: channelAccountId || undefined,
          source: "manager",
          direction: "outbound",
          attachment: attached?.name,
          attachment_type: attached?.file.type,
        });
        setInput("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось отправить сообщение");
      }
    },
    [input, sendMessageMutation, selectedOption, activeChannel, messages],
  );

  // Вызов AI-Copilot (генерация подсказки/черновика ответа)
  const handleGenerateAiDraft = useCallback(async () => {
    try {
      const res = await aiDraftMutation.mutateAsync();
      if (res?.draft) {
        setInput(res.draft);
        toast.success("Черновик ответа подготовлен AI-ассистентом");
      } else {
        toast.error("Не удалось сформировать черновик");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка работы AI Copilot");
    }
  }, [aiDraftMutation]);

  // Управление автопилотом AI
  const handleAiAction = useCallback(
    async (action: "enable" | "pause" | "disable") => {
      try {
        await aiControlMutation.mutateAsync({ action });
        if (action === "enable") {
          toast.success("AI-автопилот активирован");
        } else if (action === "pause") {
          toast.info("AI-автопилот приостановлен на 1 час");
        } else {
          toast.info("AI-автопилот выключен");
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось изменить статус AI");
      }
    },
    [aiControlMutation],
  );

  // Ручная синхронизация истории сообщений из подключенных каналов (MAX, Telegram)
  const handleSyncHistory = useCallback(async () => {
    try {
      const res = await syncHistoryMutation.mutateAsync();
      if (res?.synced && res.synced > 0) {
        toast.success(`Подтянуто сообщений из истории: ${res.synced}`);
      } else {
        toast.info("История переписки актуальна");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось синхронизировать историю чата");
    }
  }, [syncHistoryMutation]);

  // Группировка сообщений по датам (для отображаемого канала)
  const groupedMessages = useMemo(() => {
    const groups: { dateLabel: string; items: ChatMessageDTO[] }[] = [];
    let currentDateLabel = "";
    let currentBucket: ChatMessageDTO[] = [];

    for (const msg of displayedMessages) {
      const label = formatDateHeader(msg.createdAt);
      if (label !== currentDateLabel) {
        if (currentBucket.length > 0) {
          groups.push({ dateLabel: currentDateLabel, items: currentBucket });
        }
        currentDateLabel = label;
        currentBucket = [msg];
      } else {
        currentBucket.push(msg);
      }
    }

    if (currentBucket.length > 0) {
      groups.push({ dateLabel: currentDateLabel, items: currentBucket });
    }

    return groups;
  }, [displayedMessages]);

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-white text-[#111111]", className)}>
      {/* Шапка: статус AI-автопилота и управление */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#e5e5e5] bg-[#fbfbfb] px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {aiStatus?.aiControl === "enabled" && !aiStatus.isPaused ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-600" />
                </>
              ) : aiStatus?.isPaused ? (
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              ) : (
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#888888]" />
              )}
            </span>
            <span className="text-xs font-medium text-[#111111]">
              {aiStatus?.aiControl === "enabled" && !aiStatus.isPaused ? (
                <span className="font-semibold text-emerald-700">AI Автопилот активен</span>
              ) : aiStatus?.isPaused ? (
                <span className="text-amber-700">
                  AI на паузе {aiStatus.pausedUntil ? `до ${formatTime(aiStatus.pausedUntil)}` : ""} (ручной перехват)
                </span>
              ) : (
                <span className="text-[#666666]">AI Автопилот выключен</span>
              )}
            </span>
          </div>
        </div>

        {/* Кнопки переключения режима AI */}
        <div className="flex items-center gap-1.5">
          {aiStatus?.aiControl === "enabled" && !aiStatus.isPaused ? (
            <>
              <button
                type="button"
                onClick={() => handleAiAction("pause")}
                disabled={aiControlMutation.isPending}
                title="Приостановить автоответчик на 1 час (оператор перехватывает диалог)"
                className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-[#111111] disabled:opacity-50"
              >
                <Pause className="h-3 w-3 text-amber-600" />
                <span>Пауза на 1 ч</span>
              </button>
              <button
                type="button"
                onClick={() => handleAiAction("disable")}
                disabled={aiControlMutation.isPending}
                title="Полностью отключить автоответчик по этой сделке/контакту"
                className="inline-flex items-center rounded-[8px] border border-[#e5e5e5] bg-white p-1 text-[#888888] transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
              >
                <PowerOff className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => handleAiAction("enable")}
              disabled={aiControlMutation.isPending}
              title="Включить AI-автопилот"
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            >
              <Play className="h-3 w-3 fill-current" />
              <span>Включить AI</span>
            </button>
          )}
        </div>
      </div>

      {/* Выбор активного чата / канала переписки (выпадающий список как в «Пишем от:») */}
      <div className="flex shrink-0 items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[#666666]">Чат:</span>
          <div className="flex items-center gap-1.5">
            <select
              aria-label="Выбор канала чата"
              value={activeChannel}
              onChange={(e) => handleSelectChannelTab(e.target.value)}
              className="h-7 rounded-[8px] border border-[#e5e5e5] bg-white px-2 text-xs font-medium text-[#111111] shadow-2xs outline-none transition-colors hover:border-[#cccccc] focus:border-[#4a38f5] cursor-pointer"
            >
              <option value="all">
                Все каналы {messages.length > 0 ? `(${messages.length})` : ""}
              </option>
              {availableChannels.map((ch) => {
                const badge = getChannelBadge(ch.slug);
                return (
                  <option key={ch.slug} value={ch.slug}>
                    {badge.label} {ch.count > 0 ? `(${ch.count})` : ""}
                  </option>
                );
              })}
            </select>

            {activeChannel !== "all" && (
              <span
                className={cn(
                  "rounded-[4px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                  getChannelBadge(activeChannel).color,
                )}
              >
                {getChannelBadge(activeChannel).label}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Кнопка синхронизации истории переписки */}
          <button
            type="button"
            onClick={handleSyncHistory}
            disabled={syncHistoryMutation.isPending}
            title={
              activeChannel !== "all"
                ? `Подтянуть историю диалога ${getChannelBadge(activeChannel).label} из мессенджера`
                : "Подтянуть историю прошлых сообщений из подключенных каналов (MAX, Telegram)"
            }
            className="flex items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-xs text-[#666666] shadow-2xs transition-colors hover:border-[#cccccc] hover:bg-[#fafafa] hover:text-[#111111] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={cn("h-3 w-3 text-[#888888]", syncHistoryMutation.isPending && "animate-spin text-[#4a38f5]")} />
            <span>
              {syncHistoryMutation.isPending
                ? "Синхронизация..."
                : "Синхронизировать"}
            </span>
          </button>

          <span className="hidden text-[11px] text-[#888888] sm:inline">
            {activeChannel === "all" ? (
              <span>Всего: {messages.length}</span>
            ) : (
              <span>В чате: {displayedMessages.length}</span>
            )}
          </span>
        </div>
      </div>

      {/* Список сообщений диалога */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-4 overflow-y-auto p-4 scroll-smooth"
      >
        {messagesQuery.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-[16px] bg-[#f5f5f5]" />
            ))}
          </div>
        ) : displayedMessages.length === 0 ? (
          <div className="py-12">
            <EmptyState
              icon={MessageCircle}
              title={
                activeChannel === "all"
                  ? "Сообщений пока нет"
                  : `Нет сообщений в ${getChannelBadge(activeChannel).label}`
              }
              description={
                activeChannel === "all"
                  ? entityName
                    ? `Начните омниканальную переписку с клиентом ${entityName}`
                    : "Начните омниканальную переписку с клиентом"
                  : `В канале ${getChannelBadge(activeChannel).label} сообщений пока нет. Напишите сообщение ниже, чтобы отправить его клиенту в ${getChannelBadge(activeChannel).label}.`
              }
            />
          </div>
        ) : (
          groupedMessages.map((group) => (
            <div key={group.dateLabel} className="space-y-3">
              {/* Разделитель даты */}
<div className="my-3 flex items-center justify-center">
                <span className="rounded-full border border-[#e5e5e5] bg-[#fafafa] px-3 py-0.5 text-[11px] font-medium text-[#666666] shadow-2xs">
                  {group.dateLabel}
                </span>
              </div>

              {group.items.map((message) => {
                const isOutbound = message.direction === "outbound";
                const isSystem = message.source === "system" || message.direction === "neutral";
                const isAi = message.source === "ai" || message.source === "ai_bot";
                const isClient = message.direction === "inbound" || message.source === "client";

                if (isSystem) {
                  return (
<div key={message.id} className="my-1.5 flex justify-center">
                      <div className="max-w-md rounded-full border border-[#e5e5e5] bg-[#f5f5f5] px-3 py-1 text-center text-xs text-[#666666]">
                        {renderChatMessageContent(message.content)}
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={message.id}
                    className={cn(
                      "flex w-full flex-col",
                      isOutbound ? "items-end" : "items-start",
                    )}
                  >
                    <div
                      className={cn(
"relative max-w-[85%] rounded-[16px] px-4 py-2.5 text-[13px] shadow-2xs md:max-w-[75%]",
                        isClient && "rounded-tl-xs border border-[#e5e5e5] bg-[#f8f9fa] text-[#111111]",
                        isOutbound && !isAi && "rounded-tr-xs border border-[#4a38f5]/20 bg-[#4a38f5]/5 text-[#111111]",
                        isAi && "rounded-tr-xs border border-emerald-200 bg-emerald-50/80 text-[#111111]",
                      )}
                    >
                      {/* Шапка пузыря: отправитель и бейджи */}
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        {isAi ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <Bot className="h-3 w-3" />
                            <span>AI Автопилот</span>
                          </span>
                        ) : isOutbound ? (
                          <span className="font-medium text-[#4a38f5]">
                            {message.senderName || "Оператор"}
                          </span>
                        ) : (
<span className="font-medium text-[#111111]">
                            {message.senderName || "Клиент"}
                          </span>
                        )}

<span className="rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-0.2 text-[10px] uppercase tracking-wide text-[#666666]">
                          {message.channel}
                        </span>
                      </div>

                      {/* Текст сообщения */}
                      <div className="whitespace-pre-wrap break-words leading-relaxed text-[#111111]">
                        {renderChatMessageContent(message.content)}
                      </div>

                      {/* Вложение сообщения, если есть */}
                      {message.attachment && (
                        <div className="mt-2 flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white/90 px-2.5 py-1.5 text-xs shadow-2xs">
                          <Paperclip className="h-3.5 w-3.5 text-[#888888] shrink-0" />
                          <span className="font-medium text-[#111111] truncate">{message.attachment}</span>
                        </div>
                      )}

                      {/* Подвал пузыря: время и статус доставки */}
                      <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] text-[#888888]">
                        <span>{formatTime(message.createdAt)}</span>

                        {isOutbound && (
                          <span className="inline-flex items-center">
                            {message.deliveryStatus === "pending" && (
                              <span title="Отправляется в канал..." className="flex items-center gap-0.5 text-amber-600">
                                <Clock className="h-3 w-3 animate-pulse" />
                              </span>
                            )}
                            {message.deliveryStatus === "sent" && (
                              <span title="Успешно доставлено клиенту" className="flex items-center text-emerald-600">
                                <CheckCheck className="h-3.5 w-3.5" />
                              </span>
                            )}
                            {message.deliveryStatus === "failed" && (
                              <span
                                title={`Ошибка доставки: ${message.deliveryError || "неизвестная ошибка"}`}
className="flex items-center gap-1 font-medium text-rose-600"
                              >
                                <AlertCircle className="h-3 w-3" />
                                <span>Сбой</span>
                              </span>
                            )}
                          </span>
                        )}
                      </div>

                      {/* Текст ошибки доставки под сообщением */}
                      {message.deliveryStatus === "failed" && message.deliveryError && (
                        <div className="mt-1.5 rounded-[8px] border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                          {message.deliveryError}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Панель составления ответа (Telegram Composer) */}
      <div className="shrink-0 border-t border-[#e5e5e5] bg-[#fbfbfb] p-3">
        {/* Выбор «Пишем от:» */}
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[#666666]">Пишем от:</span>
            {sendFromOptionsQuery.isLoading ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-[#888888]">
                <Loader2 className="h-3 w-3 animate-spin text-[#888888]" />
                Загрузка каналов...
              </span>
            ) : sendFromOptions.length > 0 ? (
              <div className="flex items-center gap-1.5">
                <select
                  value={selectedChannelAccountId}
                  onChange={(e) => handleSelectAccount(e.target.value)}
                  className="h-7 rounded-[8px] border border-[#e5e5e5] bg-white px-2 text-xs font-medium text-[#111111] shadow-2xs outline-none transition-colors hover:border-[#cccccc] focus:border-[#4a38f5] cursor-pointer"
                >
                  {sendFromOptions.map((opt) => (
                    <option
                      key={opt.channelAccountId}
                      value={opt.channelAccountId}
                      disabled={!opt.available}
                    >
                      {opt.label || `${opt.accountName} (${opt.channel})`}
                      {!opt.available ? ` — ${opt.unavailableReason || "недоступен"}` : ""}
                    </option>
                  ))}
                </select>

                {selectedOption && (
                  <span
                    className={cn(
                      "rounded-[4px] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                      getChannelBadge(selectedOption.channel).color,
                    )}
                  >
                    {getChannelBadge(selectedOption.channel).label}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-[#888888]">Автоматический канал</span>
            )}
          </div>
        </div>

        {/* Telegram-стиль компонент ввода сообщений */}
        <div className="rounded-[12px] border border-[#e5e5e5] bg-white shadow-2xs transition-colors focus-within:border-[#cccccc]">
          <TelegramComposer
            value={input}
            onChange={setInput}
            onSend={(attached) => void handleSend(attached)}
            isSending={sendMessageMutation.isPending}
            onAiDraft={handleGenerateAiDraft}
            isAiDraftPending={aiDraftMutation.isPending}
            placeholder="Сообщение..."
          />
        </div>
      </div>
    </div>
  );
}
