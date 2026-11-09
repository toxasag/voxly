"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  CheckCheck,
  Clock,
  ExternalLink,
  Loader2,
  NotebookPen,
  Send,
  User,
  History,
  Filter,
} from "lucide-react";
import { useRepairNotes, useCreateRepairNote, type RepairNoteDTO } from "@/lib/api/use-repairs";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

interface RepairNotesSectionProps {
  orderId: string;
  ticketNumber: string;
  dealId?: string | null;
  dealTitle?: string | null;
  className?: string;
  /** Если true, отображается в режиме полного экрана/вкладки */
  fullWidth?: boolean;
}

export function RepairNotesSection({
  orderId,
  ticketNumber,
  dealId,
  dealTitle,
  className,
  fullWidth = false,
}: RepairNotesSectionProps) {
  const { data: notes = [], isLoading, isError, refetch } = useRepairNotes(orderId);
  const createMutation = useCreateRepairNote();
  const [content, setContent] = useState("");
  const [filter, setFilter] = useState<"all" | "notes" | "status">("all");

  const handleSubmit = (): void => {
    const trimmed = content.trim();
    if (!trimmed) {
      toast.error("Введите текст заметки");
      return;
    }

    createMutation.mutate(
      { orderId, payload: { content: trimmed } },
      {
        onSuccess: () => {
          setContent("");
          toast.success(
            dealId
              ? "Заметка добавлена и синхронизирована со сделкой CRM"
              : "Заметка к наряду успешно сохранена",
          );
        },
        onError: (err) => {
          toast.error(err.message || "Не удалось сохранить заметку");
        },
      },
    );
  };

  const filteredNotes = notes.filter((n) => {
    if (filter === "notes") return n.kind === "note";
    if (filter === "status") return n.kind === "status_change";
    return true;
  });

  const notesOnlyCount = notes.filter((n) => n.kind === "note").length;

  return (
    <div
      className={cn(
        "rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs space-y-4",
        fullWidth ? "p-6" : "p-5",
        className,
      )}
    >
      {/* Шапка секции */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#f0f0f0]">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-[#4a38f5]" />
          <h3 className="text-[13px] font-semibold text-[#111111]">
            Заметки и история наряда
          </h3>
          <span className="rounded-[4px] bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] font-medium text-[#666666] font-mono tabular-nums">
            {notes.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {dealId && (
            <Link
              href={`/crm/deals?record=${dealId}`}
              className="inline-flex items-center gap-1 rounded-[4px] bg-[#4a38f5]/10 border border-[#4a38f5]/20 px-2 py-1 text-[11px] font-medium text-[#4a38f5] hover:bg-[#4a38f5]/20 transition-colors"
              title="Заметки автоматически попадают в ленту этой сделки"
            >
              <Briefcase className="h-3 w-3" />
              <span>Сделка CRM</span>
              <ExternalLink className="h-2.5 w-2.5 opacity-70" />
            </Link>
          )}

          {/* Фильтр: Все / Только заметки / Статусы */}
          <div className="flex items-center rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "rounded-[4px] px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                filter === "all" ? "bg-white text-[#111111] shadow-2xs font-semibold" : "text-[#666666] hover:text-[#111111]",
              )}
            >
              Все ({notes.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("notes")}
              className={cn(
                "rounded-[4px] px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                filter === "notes" ? "bg-white text-[#111111] shadow-2xs font-semibold" : "text-[#666666] hover:text-[#111111]",
              )}
            >
              Заметки ({notesOnlyCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter("status")}
              className={cn(
                "rounded-[4px] px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                filter === "status" ? "bg-white text-[#111111] shadow-2xs font-semibold" : "text-[#666666] hover:text-[#111111]",
              )}
            >
              Статусы ({notes.length - notesOnlyCount})
            </button>
          </div>
        </div>
      </div>

      {/* Форма добавления заметки */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3 space-y-2.5 focus-within:border-[#4a38f5] focus-within:bg-white transition-colors">
        <label htmlFor="repair-note-input" className="sr-only">
          Новая заметка к наряду
        </label>
        <textarea
          id="repair-note-input"
          rows={3}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              handleSubmit();
            }
          }}
          disabled={createMutation.isPending}
          placeholder="Напишите заметку к наряду... (Ctrl+Enter для быстрой отправки)"
          className="w-full resize-none bg-transparent text-xs text-[#111111] placeholder:text-[#888888] focus:outline-none leading-relaxed"
        />

        <div className="flex items-center justify-between pt-1 border-t border-[#f0f0f0] text-xs">
          <span className="text-[11px] text-[#888888]">
            {dealId ? (
              <span className="inline-flex items-center gap-1 text-emerald-700">
                <CheckCheck className="h-3 w-3" />
                Сквозная синхронизация со сделкой включена
              </span>
            ) : (
              "Нажмите Ctrl + Enter для сохранения"
            )}
          </span>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={createMutation.isPending || content.trim().length === 0}
            className={cn(
              "flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium text-white shadow-xs transition-colors cursor-pointer",
              createMutation.isPending || content.trim().length === 0
                ? "bg-[#4a38f5]/40 cursor-not-allowed"
                : "bg-[#4a38f5] hover:bg-[#3d2ee0]",
            )}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Сохранение...</span>
              </>
            ) : (
              <>
                <Send className="h-3.5 w-3.5" />
                <span>Добавить заметку</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Список заметок */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-[#888888]">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          <span className="text-xs">Загрузка заметок...</span>
        </div>
      ) : isError ? (
        <div className="rounded-[6px] border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 flex items-center justify-between">
          <span>Не удалось загрузить заметки наряда.</span>
          <button
            type="button"
            onClick={() => void refetch()}
            className="font-medium underline hover:text-rose-900 ml-2"
          >
            Повторить
          </button>
        </div>
      ) : filteredNotes.length === 0 ? (
        <div className="rounded-[6px] border border-dashed border-[#e5e5e5] p-6 text-center text-xs text-[#888888]">
          <NotebookPen className="h-6 w-6 text-[#cccccc] mx-auto mb-2" />
          {filter === "notes"
            ? "Пока нет добавленных заметок. Напишите первую заметку в форме выше."
            : filter === "status"
              ? "История изменений статуса пока пуста."
              : "Пока нет заметок и записей истории. Добавьте первую заметку выше."}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredNotes.map((note) => {
            const isStatusChange = note.kind === "status_change";

            if (isStatusChange) {
              return (
                <div
                  key={note.id}
                  className="flex items-center justify-between rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] px-3 py-2 text-xs text-[#666666]"
                >
                  <div className="flex items-center gap-2">
                    <History className="h-3.5 w-3.5 text-[#888888]" />
                    <span className="text-[#111111] font-medium">
                      {note.authorName || "Система"}
                    </span>
                    <span>изменил статус:</span>
                    <span className="rounded bg-white border border-[#e5e5e5] px-1.5 py-0.5 text-[11px] font-medium text-[#111111]">
                      {note.fromStatus || "—"} → {note.toStatus || "—"}
                    </span>
                    {note.content && (
                      <span className="text-[#666666] italic">({note.content})</span>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-1 font-mono text-[11px] text-[#888888] tabular-nums"
                    title={new Date(note.createdAt).toLocaleString("ru-RU")}
                  >
                    <Clock className="h-3 w-3" />
                    <span>{formatDateTime(note.createdAt)}</span>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={note.id}
                className="group rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3.5 space-y-2 hover:border-[#cccccc] transition-colors"
              >
                {/* Автор, бейдж и таймстамп */}
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#f0f0f0] text-[#666666]">
                      <User className="h-3 w-3" />
                    </div>
                    <span className="font-semibold text-[#111111]">
                      {note.authorName || "Сотрудник"}
                    </span>
                    {dealId && (
                      <span
                        className="rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 inline-flex items-center gap-1"
                        title="Заметка синхронизирована со сделкой CRM"
                      >
                        <CheckCheck className="h-2.5 w-2.5" />
                        В сделке CRM
                      </span>
                    )}
                  </div>

                  <div
                    className="flex items-center gap-1 font-mono text-[11px] text-[#888888] tabular-nums"
                    title={new Date(note.createdAt).toLocaleString("ru-RU")}
                  >
                    <Clock className="h-3 w-3" />
                    <span>{formatDateTime(note.createdAt)}</span>
                    <span className="text-[#cccccc] mx-1">·</span>
                    <span className="text-[#888888] font-sans">{timeAgo(note.createdAt)}</span>
                  </div>
                </div>

                {/* Содержимое заметки */}
                <div className="text-xs text-[#111111] leading-relaxed whitespace-pre-wrap break-words pl-7">
                  {note.content}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
