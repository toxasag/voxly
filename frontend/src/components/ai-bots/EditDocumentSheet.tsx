"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Loader2, Sparkles, X } from "lucide-react";
import { toast } from "sonner";

import { Sheet } from "@/components/ui/sheet";
import {
  useKnowledgeDocumentDetail,
  useUpdateKnowledgeDocument,
} from "@/lib/api/use-agent-knowledge";
import { cn } from "@/lib/utils";

interface EditDocumentSheetProps {
  agentId: string;
  documentId: string | null;
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
}

export function EditDocumentSheet({
  agentId,
  documentId,
  open,
  onClose,
  canEdit,
}: EditDocumentSheetProps) {
  const { data: document, isLoading, error } = useKnowledgeDocumentDetail(agentId, documentId);
  const updateMutation = useUpdateKnowledgeDocument(agentId);

  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");

  useEffect(() => {
    if (document) {
      setFilename(document.filename);
      setText(document.contentText || "");
    }
  }, [document]);

  const handleSave = async () => {
    if (!documentId) return;
    if (text.trim().length === 0) {
      toast.error("Текст документа не может быть пустым");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        docId: documentId,
        text: text.trim(),
        filename: filename.trim() || undefined,
      });
      toast.success("Документ и векторный индекс успешно обновлены!");
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить документ");
    }
  };

  const isPriceDoc =
    filename.toLowerCase().includes("прайс") ||
    filename.toLowerCase().includes("цена") ||
    filename.toLowerCase().includes("price");

  return (
    <Sheet open={open} onClose={onClose} width="w-full md:w-[680px]">
      <div className="flex h-full flex-col bg-white">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]">
              <FileText className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-sm font-semibold text-[#111111]">
                {document?.filename || "Просмотр документа"}
              </h2>
              <p className="text-xs text-[#666666]">
                Просмотр и актуализация информации в базе знаний
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[#888888] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20 text-[#888888]">
              <Loader2 className="h-6 w-6 animate-spin text-[#4a38f5] mb-2" />
              <p className="text-xs">Загрузка текста документа...</p>
            </div>
          )}

          {error && !isLoading && (
            <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Не удалось загрузить документ</p>
                <p>{error.message}</p>
              </div>
            </div>
          )}

          {!isLoading && document && (
            <>
              {/* Бейдж приоритета прайса */}
              {isPriceDoc && (
                <div className="rounded-[8px] border border-[#fef08a] bg-[#fefce8] p-3 text-xs text-[#854d0e] flex items-start gap-2.5">
                  <Sparkles className="h-4 w-4 shrink-0 text-[#ca8a04] mt-0.5" />
                  <div className="leading-relaxed">
                    <span className="font-semibold">Высший приоритет цен:</span> цены и условия из
                    этого документа имеют абсолютное преимущество перед историческими диалогами и
                    старыми переписками.
                  </div>
                </div>
              )}

              {/* Название */}
              <div>
                <label className="block text-xs font-medium text-[#666666] mb-1.5">
                  Название файла / регламента
                </label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  disabled={!canEdit}
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:bg-[#fbfbfb]"
                />
              </div>

              {/* Мета-информация */}
              <div className="flex flex-wrap items-center gap-3 py-1 text-xs text-[#666666] border-y border-[#f0f0f0]">
                <span>
                  Фрагментов в индексе:{" "}
                  <strong className="text-[#111111] font-mono">{document.chunksCount}</strong>
                </span>
                <span>·</span>
                <span>
                  Символов:{" "}
                  <strong className="text-[#111111] font-mono">{text.length}</strong>
                </span>
                <span>·</span>
                <span>
                  Статус:{" "}
                  <strong
                    className={cn(
                      document.status === "ready"
                        ? "text-emerald-600"
                        : document.status === "processing"
                          ? "text-amber-600"
                          : "text-rose-600",
                    )}
                  >
                    {document.status === "ready"
                      ? "Готов"
                      : document.status === "processing"
                        ? "Векторизация..."
                        : "Ошибка"}
                  </strong>
                </span>
              </div>

              {/* Текст */}
              <div className="space-y-1.5 flex-1 flex flex-col">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-[#666666]">
                    Содержимое (Markdown / Текст)
                  </label>
                  <span className="text-[11px] text-[#888888]">
                    {canEdit ? "Редактируемый текст" : "Только просмотр"}
                  </span>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={!canEdit}
                  rows={20}
                  placeholder="Введите текст документа, регламента, условий или прайса..."
                  className="w-full resize-y rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 font-mono text-xs leading-relaxed text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:bg-[#fbfbfb]"
                />
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
          >
            Закрыть
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={handleSave}
              disabled={updateMutation.isPending || isLoading}
              className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {updateMutation.isPending ? "Перевекторизация..." : "Сохранить и обновить векторы"}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
