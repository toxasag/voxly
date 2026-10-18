"use client";

import { useState } from "react";
import { Loader2, NotebookPen, Pencil, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import {
  useCreateNote,
  useDeleteNote,
  useNotes,
  useUpdateNote,
  type NoteTargetType,
} from "@/lib/api/use-notes";
import { timeAgo } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Вкладка «Заметки» карточки записи.
//
// Образец — вкладка Notes в Twenty (`NotesCardContent`): список заметок и
// кнопка создания, привязанная к текущей записи. Заметка создаётся сразу
// прикреплённой к цели, как у них: `openCreateActivityDrawer` подставляет
// targetableObjects текущей записи, а не спрашивает связь у пользователя.
// ---------------------------------------------------------------------------

interface RecordNotesTabProps {
  targetType: NoteTargetType;
  targetId: string;
  /** Право на запись: без него кнопка создания не рисуется, как у Twenty. */
  canWrite?: boolean;
}

export function RecordNotesTab({ targetType, targetId, canWrite = true }: RecordNotesTabProps) {
  const notes = useNotes(targetType, targetId);
  const create = useCreateNote();
  const update = useUpdateNote();
  const remove = useDeleteNote();
  const [draft, setDraft] = useState("");
  /**
   * Заголовок заметки.
   *
   * Колонка и валидация были на бэкенде с самого начала (`title` nullable, как
   * `Note.title` у Twenty), но UI его не отправлял и не показывал — заголовок
   * нельзя было ни задать, ни прочитать. Остаётся необязательным: у короткой
   * заметки заголовок дублировал бы первую строку.
   */
  const [titleDraft, setTitleDraft] = useState("");
  const [composing, setComposing] = useState(false);
  /** Идентификатор правимой заметки и её черновики — правка по месту, как у Twenty. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editTitleDraft, setEditTitleDraft] = useState("");

  const saveEdit = (id: string, originalBody: string, originalTitle: string): void => {
    const body = editDraft.trim();
    const title = editTitleDraft.trim();

    // Пустой текст не сохраняется: заметка без содержимого — это удаление, а его
    // пользователь делает явной кнопкой.
    if (body === "") {
      setEditingId(null);
      return;
    }

    if (body === originalBody && title === originalTitle) {
      setEditingId(null);
      return;
    }

    update.mutate(
      { id, payload: { body, title } },
      {
        onSuccess: () => setEditingId(null),
        onError: (error) => toast.error(error.message),
      },
    );
  };

  const startEdit = (id: string, body: string, title: string): void => {
    setEditingId(id);
    setEditDraft(body);
    setEditTitleDraft(title);
  };

  const submit = (): void => {
    const body = draft.trim();
    if (body === "") return;

    create.mutate(
      { body, title: titleDraft.trim(), target_type: targetType, target_id: targetId },
      {
        onSuccess: () => {
          setDraft("");
          setTitleDraft("");
          setComposing(false);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <div className="space-y-3 p-4">
      {canWrite && (
        composing ? (
          <div className="space-y-2 rounded-[16px] border border-[#e5e5e5] bg-white p-3 shadow-2xs">
            <input
              value={titleDraft}
              autoFocus
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setComposing(false);
                }
              }}
              placeholder="Заголовок (необязательно)"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm font-medium text-[#000000] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
            />
            <textarea
              value={draft}
              rows={3}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                // Ctrl/Cmd+Enter отправляет, Escape закрывает: обычный Enter
                // должен переносить строку — заметки многострочные.
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setComposing(false);
                }
              }}
              placeholder="Текст заметки..."
              className="w-full resize-y rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm text-[#000000] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setComposing(false); setDraft(""); setTitleDraft(""); }}
                className="rounded px-2 py-1 text-xs text-[#666666] hover:text-[#000000]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={create.isPending || draft.trim() === ""}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:opacity-50"
              >
                {create.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Сохранить
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
          >
            <Plus className="h-3.5 w-3.5" />
            Новая заметка
          </button>
        )
      )}

      {notes.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : notes.isError ? (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3">
          <p className="text-sm text-slate-200">Не удалось загрузить заметки</p>
          <button
            type="button"
            onClick={() => void notes.refetch()}
            className="mt-1.5 text-xs text-slate-300 hover:text-slate-100"
          >
            Повторить
          </button>
        </div>
      ) : notes.data === undefined || notes.data.items.length === 0 ? (
        <EmptyState
          icon={NotebookPen}
          title="Заметок нет"
          description="Заметки по этой записи появятся здесь"
        />
      ) : (
        <div className="space-y-2">
          {notes.data.items.map((note) => (
            <article key={note.id} className="group rounded-[16px] border border-[#e5e5e5] bg-white p-3 shadow-2xs">
              {editingId === note.id ? (
                <div className="space-y-2">
                  <input
                    value={editTitleDraft}
                    autoFocus
                    onChange={(event) => setEditTitleDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        saveEdit(note.id, note.body, note.title);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingId(null);
                      }
                    }}
                    placeholder="Заголовок (необязательно)"
                    className="w-full rounded-[8px] border border-[#4a38f5] bg-white px-2.5 py-1.5 text-sm font-medium text-[#000000] placeholder:text-[#888888] focus:outline-none"
                  />
                  <textarea
                    value={editDraft}
                    rows={3}
                    onChange={(event) => setEditDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        saveEdit(note.id, note.body, note.title);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setEditingId(null);
                      }
                    }}
                    className="w-full resize-y rounded-[8px] border border-[#4a38f5] bg-white px-2.5 py-1.5 text-sm text-[#000000] focus:outline-none"
                  />
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="rounded px-2 py-1 text-xs text-[#666666] hover:text-[#000000]"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(note.id, note.body, note.title)}
                      disabled={update.isPending}
                      className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:opacity-50"
                    >
                      {update.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                      Сохранить
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  {note.title !== "" && (
                    <h4 className="mb-1 break-words text-sm font-semibold text-[#000000]">
                      {note.title}
                    </h4>
                  )}
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#333333]">
                    {note.body}
                  </p>
                </div>
              )}
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                <span>{note.createdByName ?? "Система"}</span>
                <span>·</span>
                <span title={new Date(note.createdAt).toLocaleString("ru-RU")}>
                  {timeAgo(note.createdAt)}
                </span>
                {canWrite && editingId !== note.id && (
                  <span className="ml-auto flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => startEdit(note.id, note.body, note.title)}
                      aria-label="Изменить заметку"
                      className="rounded p-1 text-slate-600 hover:text-slate-300"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(
                        { id: note.id, targetType, targetId },
                        { onError: (error) => toast.error(error.message) },
                      )}
                      aria-label="Удалить заметку"
                      className="rounded p-1 text-slate-600 hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
