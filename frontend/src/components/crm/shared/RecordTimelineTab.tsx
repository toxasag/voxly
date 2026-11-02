"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  CheckCircle2,
  Clock,
  FileText,
  Filter,
  GitCommit,
  ListChecks,
  MessageCircle,
  Sparkles,
  StickyNote,
} from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { TagPill } from "@/components/ui/tag";
import {
  useRecordTimeline,
  type TimelineEventType,
  type TimelineRecordType,
  type TimelineEventDTO,
} from "@/lib/api/use-timeline";
import { NoteFormattedBody } from "@/components/crm/shared/RecordNotesTab";
import { cn, timeAgo } from "@/lib/utils";

interface RecordTimelineTabProps {
  recordType: TimelineRecordType;
  recordId: string;
}

type TimelineFilter = "all" | TimelineEventType;

const EVENT_TYPE_LABELS: Record<TimelineEventType, string> = {
  message: "Сообщение",
  note: "Заметка",
  task: "Задача",
  stage_change: "Смена этапа",
};

function formatFullDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function EventIcon({ type }: { type: TimelineEventType }) {
  switch (type) {
    case "message":
      return <MessageCircle className="h-3.5 w-3.5 text-sky-600" />;
    case "note":
      return <StickyNote className="h-3.5 w-3.5 text-amber-600" />;
    case "task":
      return <ListChecks className="h-3.5 w-3.5 text-emerald-600" />;
    case "stage_change":
      return <GitCommit className="h-3.5 w-3.5 text-[#4a38f5]" />;
    default:
      return <Activity className="h-3.5 w-3.5 text-[#666666]" />;
  }
}

function EventTypeChip({ type }: { type: TimelineEventType }) {
  switch (type) {
    case "message":
      return <TagPill color="sky">Сообщение</TagPill>;
    case "note":
      return <TagPill color="amber">Заметка</TagPill>;
    case "task":
      return <TagPill color="emerald">Задача</TagPill>;
    case "stage_change":
      return <TagPill color="violet">Смена этапа</TagPill>;
    default:
      return <TagPill color="slate">{type}</TagPill>;
  }
}

function EventContent({ event }: { event: TimelineEventDTO }) {
  const { type, data } = event;

  if (type === "message") {
    const text = typeof data.text === "string" ? data.text : (typeof data.content === "string" ? data.content : "");
    const channel = typeof data.channel === "string" ? data.channel : null;
    const direction = typeof data.direction === "string" ? data.direction : null;
    const metadata = (data.metadata as Record<string, unknown> | null) ?? null;
    const transcript = metadata?.transcript as { text?: string } | undefined;
    const documentInfo = metadata?.document_info as { summary?: string; doc_type?: string } | undefined;

    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#666666]">
          {channel !== null && (
            <span className="rounded bg-black/[0.04] px-1.5 py-0.5 font-mono text-[11px] text-[#555555]">
              {channel}
            </span>
          )}
          {direction !== null && (
            <span className="text-[11px] text-[#888888]">
              {direction === "inbound" ? "Входящее" : "Исходящее"}
            </span>
          )}
        </div>
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[#111111]">
          {text || "—"}
        </p>

        {/* Распознанный текст аудио */}
        {transcript?.text && (
          <div className="mt-1.5 rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] p-2 text-xs">
            <div className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-[#4a38f5]">
              <Sparkles className="h-3 w-3" />
              <span>Транскрипция</span>
            </div>
            <p className="line-clamp-3 text-[12px] leading-relaxed text-[#222222]">
              {transcript.text}
            </p>
          </div>
        )}

        {/* Аннотация документа */}
        {documentInfo && (documentInfo.summary || documentInfo.doc_type) && (
          <div className="mt-1.5 rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] p-2 text-xs">
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-[#4a38f5]">
              <FileText className="h-2.5 w-2.5" />
              <span>{documentInfo.doc_type || "Документ"}</span>
            </div>
            {documentInfo.summary && (
              <p className="text-[12px] leading-snug text-[#333333]">
                {documentInfo.summary}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  if (type === "note") {
    const title = typeof data.title === "string" ? data.title : "";
    const body = typeof data.body === "string" ? data.body : "";

    return (
      <div className="space-y-1">
        {title !== "" && (
          <h4 className="text-[13px] font-semibold text-[#111111]">{title}</h4>
        )}
        <NoteFormattedBody body={body} />
      </div>
    );
  }

  if (type === "task") {
    const title = typeof data.title === "string" ? data.title : "";
    const description = typeof data.description === "string" ? data.description : "";
    const status = typeof data.status === "string" ? data.status : "todo";
    const priority = typeof data.priority === "string" ? data.priority : null;
    const dueDate = typeof data.dueDate === "string" ? data.dueDate : null;

    const isDone = status === "done";

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          {isDone ? (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Выполнена
            </span>
          ) : (
            <span className="text-xs text-[#888888]">
              {status === "in_progress" ? "В работе" : "К выполнению"}
            </span>
          )}
          {priority !== null && (
            <span className="text-xs text-[#666666]">· {priority}</span>
          )}
          {dueDate !== null && (
            <span className="flex items-center gap-1 text-xs text-[#888888]">
              <Clock className="h-3 w-3" />
              до {new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(new Date(dueDate))}
            </span>
          )}
        </div>
        <p className={cn("text-[13px] font-medium leading-snug", isDone ? "text-[#888888] line-through" : "text-[#111111]")}>
          {title}
        </p>
        {description !== "" && (
          <p className="text-xs text-[#666666] line-clamp-2">{description}</p>
        )}
      </div>
    );
  }

  if (type === "stage_change") {
    const fromStage = typeof data.fromStageName === "string" ? data.fromStageName : "Начало";
    const toStage = typeof data.toStageName === "string" ? data.toStageName : "Новый этап";
    const dealTitle = typeof data.dealTitle === "string" ? data.dealTitle : null;
    const comment = typeof data.comment === "string" ? data.comment : null;

    return (
      <div className="space-y-1">
        {dealTitle && (
          <p className="text-xs font-medium text-[#4a38f5]">{dealTitle}</p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
          <span className="text-[#666666]">{fromStage}</span>
          <span className="text-[#888888]">→</span>
          <span className="font-semibold text-[#111111]">{toStage}</span>
        </div>
        {comment !== null && comment !== "" && (
          <p className="text-xs italic text-[#666666]">{comment}</p>
        )}
      </div>
    );
  }

  return (
    <pre className="overflow-x-auto text-xs text-[#666666]">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export function RecordTimelineTab({ recordType, recordId }: RecordTimelineTabProps) {
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const { data, isLoading, isError, refetch } = useRecordTimeline(recordType, recordId);

  const items = data?.items ?? [];

  const filteredItems = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.type === filter);
  }, [items, filter]);

  return (
    <div className="space-y-4 p-4">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[#e5e5e5] pb-3">
        <span className="mr-1 flex items-center gap-1 text-xs font-medium text-[#888888]">
          <Filter className="h-3 w-3" /> Фильтр:
        </span>
        <button
          type="button"
          onClick={() => setFilter("all")}
          className={cn(
            "rounded-[6px] px-2 py-1 text-xs transition-colors",
            filter === "all"
              ? "bg-[#4a38f5] font-medium text-white shadow-2xs"
              : "text-[#666666] hover:bg-black/[0.04] hover:text-[#111111]",
          )}
        >
          Все ({items.length})
        </button>
        {(["message", "note", "task", "stage_change"] as TimelineEventType[]).map((type) => {
          const count = items.filter((it) => it.type === type).length;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setFilter(type)}
              className={cn(
                "rounded-[6px] px-2 py-1 text-xs transition-colors",
                filter === type
                  ? "bg-[#4a38f5] font-medium text-white shadow-2xs"
                  : "text-[#666666] hover:bg-black/[0.04] hover:text-[#111111]",
              )}
            >
              {EVENT_TYPE_LABELS[type]} {count > 0 ? `(${count})` : ""}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex gap-3">
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-14 w-full rounded-[8px]" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-4">
          <p className="text-sm font-medium text-rose-700">Не удалось загрузить историю активности</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 text-xs font-semibold text-rose-600 hover:text-rose-800"
          >
            Повторить запрос
          </button>
        </div>
      ) : filteredItems.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="История активности пуста"
          description={
            filter === "all"
              ? "Здесь будут отображаться сообщения, задачи, заметки и переходы этапов по этой записи."
              : `Событий с типом «${EVENT_TYPE_LABELS[filter]}» пока нет.`
          }
        />
      ) : (
        <div className="relative space-y-4 before:absolute before:bottom-2 before:left-3.5 before:top-2 before:w-px before:bg-[#e5e5e5]">
          {filteredItems.map((event) => (
            <div key={event.id} className="relative flex items-start gap-3 pl-0.5">
              {/* Event icon dot */}
              <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#e5e5e5] bg-white shadow-2xs">
                <EventIcon type={event.type} />
              </div>

              {/* Event card */}
              <div className="flex-1 rounded-[8px] border border-[#e5e5e5] bg-white p-3 shadow-2xs hover:border-[#cccccc] transition-colors">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-1 border-b border-[#f0f0f0] pb-1.5">
                  <div className="flex items-center gap-1.5">
                    <EventTypeChip type={event.type} />
                    <span className="text-xs font-medium text-[#111111]">
                      {event.authorName ?? "Система"}
                    </span>
                  </div>
                  <span
                    title={formatFullDate(event.createdAt)}
                    className="text-[11px] text-[#888888] tabular-nums"
                  >
                    {timeAgo(event.createdAt)}
                  </span>
                </div>

                <EventContent event={event} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
