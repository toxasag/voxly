"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  FileText,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  useAddKnowledgeText,
  useDeleteKnowledgeDocument,
  useKnowledgeDocuments,
  useUploadKnowledgeFile,
  type KnowledgeDocument,
} from "@/lib/api/use-agent-knowledge";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Вкладка «База знаний» на странице агента.
//
// Именно на странице агента, а не в модальном окне настроек: документ
// привязывается к существующему агенту, и до первого сохранения привязывать его
// некуда. В модальном окне создания раздел показывал бы поле загрузки, которое
// ничего не делает.
// ---------------------------------------------------------------------------

interface AgentKnowledgeTabProps {
  agentId: string;
  /** Право на изменение (`ai_bots:configure`); без него доступен только просмотр. */
  canEdit: boolean;
}

const STATUS_LABEL: Record<KnowledgeDocument["status"], string> = {
  processing: "Векторизация...",
  ready: "Готов",
  failed: "Ошибка",
};

const STATUS_CLASS: Record<KnowledgeDocument["status"], string> = {
  processing: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
  ready: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  failed: "bg-rose-500/10 text-rose-400 border-rose-500/30",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** «4 фрагмента» / «1 фрагмент» / «12 фрагментов». */
function pluralChunks(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} фрагмент`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} фрагмента`;
  return `${count} фрагментов`;
}

export function AgentKnowledgeTab({ agentId, canEdit }: AgentKnowledgeTabProps) {
  const { data, isLoading, error } = useKnowledgeDocuments(agentId);
  const addText = useAddKnowledgeText(agentId);
  const uploadFile = useUploadKnowledgeFile(agentId);
  const remove = useDeleteKnowledgeDocument(agentId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [pendingDelete, setPendingDelete] = useState<KnowledgeDocument | null>(null);

  const meta = data?.meta;
  const documents = data?.documents ?? [];
  const vectorisationAvailable = meta?.vectorisationAvailable ?? false;

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Значение сбрасывается сразу: без этого повторный выбор того же файла не
      // вызывает `change`, и загрузка после ошибки выглядела бы неработающей.
      event.target.value = "";

      if (file === undefined) return;

      void uploadFile
        .mutateAsync(file)
        .then((document) => {
          toast.success(
            `«${document.filename}» загружен: ${pluralChunks(document.chunksCount)}`,
          );
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Не удалось загрузить файл");
        });
    },
    [uploadFile],
  );

  const handleAddText = useCallback(() => {
    if (title.trim().length === 0 || text.trim().length === 0) {
      toast.error("Укажите название и текст документа");
      return;
    }

    void addText
      .mutateAsync({ title: title.trim(), text: text.trim() })
      .then((document) => {
        toast.success(`«${document.filename}» добавлен: ${pluralChunks(document.chunksCount)}`);
        setTitle("");
        setText("");
        setTextOpen(false);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить документ");
      });
  }, [addText, title, text]);

  const handleDelete = useCallback(() => {
    if (pendingDelete === null) return;
    const target = pendingDelete;

    void remove
      .mutateAsync({ documentId: target.id })
      .then(() => toast.success(`«${target.filename}» удалён`))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Не удалось удалить документ"),
      )
      .finally(() => setPendingDelete(null));
  }, [pendingDelete, remove]);

  const isBusy = uploadFile.isPending || addText.isPending;
  const accept = (meta?.supportedExtensions ?? []).map((ext) => `.${ext}`).join(",");

  return (
    <div className="space-y-4">
      {/* Предупреждение о неготовности платформы: показывается до попытки
          загрузки, иначе пользователь узнаёт о ней только по ошибке. */}
      {!isLoading && !vectorisationAvailable && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-400/30 bg-yellow-400/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-yellow-400">Векторизация недоступна</p>
            <p className="text-slate-400">
              На платформе не настроен доступ к моделям, поэтому загрузка документов сейчас
              невозможна. Обратитесь к администратору платформы.
            </p>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <div className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">База знаний</h3>
            <p className="text-xs text-slate-500">
              Документы, по которым агент отвечает. Загруженный текст разбивается на фрагменты и
              переводится в векторы для поиска по смыслу.
            </p>
          </div>

          {canEdit && (
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setTextOpen((open) => !open)}
                disabled={!vectorisationAvailable || isBusy}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 transition-colors",
                  "hover:border-slate-600 hover:text-slate-100",
                  "disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                <Plus className="h-3.5 w-3.5" />
                Текстом
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={!vectorisationAvailable || isBusy}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors",
                  "hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50",
                )}
              >
                {uploadFile.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Загрузить файл
              </button>

              <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                onChange={handleFileChange}
                className="hidden"
              />
            </div>
          )}
        </div>

        {/* Форма ввода текстом */}
        {textOpen && canEdit && (
          <div className="space-y-3 border-b border-slate-800 bg-slate-950/40 px-6 py-4">
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Название документа, например «Регламент сервисного центра»"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={8}
              placeholder="Вставьте текст: регламент, прайс, ответы на частые вопросы..."
              className="w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{text.length} символов</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTextOpen(false)}
                  className="rounded-lg px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleAddText}
                  disabled={addText.isPending}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {addText.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Добавить в базу знаний
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Список */}
        <div className="p-6">
          {isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-14 w-full" />
              ))}
            </div>
          )}

          {error !== null && !isLoading && (
            <p className="text-sm text-rose-400">
              Не удалось загрузить документы: {error.message}
            </p>
          )}

          {!isLoading && error === null && documents.length === 0 && (
            <EmptyState
              icon={FileText}
              title="База знаний пуста"
              description="Загрузите регламент, прайс или ответы на частые вопросы — агент будет опираться на них при ответах."
            />
          )}

          {!isLoading && documents.length > 0 && (
            <div className="space-y-2">
              {documents.map((document) => (
                <div
                  key={document.id}
                  className="flex items-center gap-4 rounded-lg border border-slate-800 bg-slate-950/40 px-4 py-3 transition-colors hover:bg-slate-800/50"
                >
                  <FileText className="h-4 w-4 shrink-0 text-slate-500" />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">
                      {document.filename}
                    </p>
                    <p className="text-xs text-slate-500">
                      {pluralChunks(document.chunksCount)} · {formatSize(document.fileSize)} ·{" "}
                      {formatDate(document.createdAt)}
                      {document.agentId === null && " · общий для всех агентов"}
                    </p>
                    {document.status === "failed" && document.errorMessage.length > 0 && (
                      <p className="mt-1 text-xs text-rose-400">{document.errorMessage}</p>
                    )}
                  </div>

                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                      STATUS_CLASS[document.status],
                    )}
                  >
                    {STATUS_LABEL[document.status]}
                  </span>

                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setPendingDelete(document)}
                      aria-label={`Удалить ${document.filename}`}
                      className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить документ?"
        description={
          pendingDelete === null
            ? ""
            : `«${pendingDelete.filename}» и ${pluralChunks(pendingDelete.chunksCount)} будут удалены безвозвратно. Агент перестанет опираться на этот материал.`
        }
        confirmLabel="Удалить"
        variant="destructive"
        isPending={remove.isPending}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
