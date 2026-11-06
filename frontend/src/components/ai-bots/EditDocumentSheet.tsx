"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Code,
  FileText,
  Layers,
  Loader2,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PageBlockEditor } from "@/components/ai-bots/PageBlockEditor";
import { Sheet } from "@/components/ui/sheet";
import {
  type ContentBlock,
  parseMarkdownToBlocks,
  serializeBlocksToMarkdown,
} from "@/lib/ai-bots/block-parser";
import {
  useApproveKnowledgeDocument,
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
  const approveMutation = useApproveKnowledgeDocument(agentId);

  const [filename, setFilename] = useState("");
  const [text, setText] = useState("");
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [viewMode, setViewMode] = useState<"blocks" | "raw">("blocks");

  // Синхронизация при загрузке документа
  useEffect(() => {
    if (document) {
      const rawText = document.contentText || "";
      setFilename(document.filename);
      setText(rawText);
      setBlocks(parseMarkdownToBlocks(rawText));
    }
  }, [document]);

  // Обработка изменений в блочном редакторе
  const handleBlocksChange = (updatedBlocks: ContentBlock[]) => {
    setBlocks(updatedBlocks);
    const serialized = serializeBlocksToMarkdown(updatedBlocks);
    setText(serialized);
  };

  // Переключение режима отображения
  const handleSwitchMode = (newMode: "blocks" | "raw") => {
    if (newMode === viewMode) return;
    if (newMode === "blocks") {
      // При переходе в блочный режим парсим актуальный текст
      setBlocks(parseMarkdownToBlocks(text));
    } else {
      // При переходе в сырой режим обновляем текст из блоков
      setText(serializeBlocksToMarkdown(blocks));
    }
    setViewMode(newMode);
  };

  const getEffectiveText = (): string => {
    if (viewMode === "blocks") {
      return serializeBlocksToMarkdown(blocks).trim();
    }
    return text.trim();
  };

  const handleSave = async () => {
    if (!documentId) return;
    const finalText = getEffectiveText();

    if (finalText.length === 0) {
      toast.error("Текст документа не может быть пустым");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        docId: documentId,
        text: finalText,
        filename: filename.trim() || undefined,
      });
      toast.success("Документ и векторный индекс успешно обновлены!");
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить документ");
    }
  };

  const handleApprove = async () => {
    if (!documentId) return;
    const finalText = getEffectiveText();

    if (finalText.length === 0) {
      toast.error("Текст документа не может быть пустым");
      return;
    }

    try {
      await approveMutation.mutateAsync({
        docId: documentId,
        text: finalText,
        filename: filename.trim() || undefined,
      });
      toast.success("Документ утверждён и отправлен в активную базу знаний (RAG)!");
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось утвердить документ");
    }
  };

  const isPriceDoc =
    filename.toLowerCase().includes("прайс") ||
    filename.toLowerCase().includes("цена") ||
    filename.toLowerCase().includes("price");

  return (
    <Sheet open={open} onClose={onClose} width="w-full md:w-[780px] lg:w-[860px]">
      <div className="flex h-full flex-col bg-white">
        {/* Шапка шторки */}
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
                Блочное редактирование и актуализация источника знаний агента
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

        {/* Тело шторки */}
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
              {/* Бейдж черновика (Human-in-the-Loop RAG) */}
              {document.status === "draft" && (
                <div className="rounded-[8px] border border-amber-200 bg-amber-50/80 p-3.5 text-xs text-amber-900 flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                  <div className="leading-relaxed space-y-1">
                    <p className="font-semibold text-amber-900">
                      Черновик страницы на проверке (Human-in-the-Loop RAG)
                    </p>
                    <p className="text-amber-800">
                      Страница разделена на смысловые секции. Вы можете отредактировать нужные
                      блоки, удалить лишний мусор со страницы или добавить ключевые тезисы.
                      После проверки нажмите <strong>«Утвердить и отправить в RAG»</strong>.
                    </p>
                  </div>
                </div>
              )}

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
                  Название файла / регламента / страницы
                </label>
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  disabled={!canEdit}
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:bg-[#fbfbfb]"
                />
              </div>

              {/* Мета-информация и переключатель режима */}
              <div className="flex flex-wrap items-center justify-between gap-3 py-2 border-y border-[#f0f0f0]">
                <div className="flex flex-wrap items-center gap-3 text-xs text-[#666666]">
                  <span>
                    Фрагментов в индексе:{" "}
                    <strong className="text-[#111111] font-mono">{document.chunksCount}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Секций:{" "}
                    <strong className="text-[#111111] font-mono">{blocks.length}</strong>
                  </span>
                  <span>·</span>
                  <span>
                    Символов:{" "}
                    <strong className="text-[#111111] font-mono">
                      {text.length.toLocaleString("ru-RU")}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    Статус:{" "}
                    <strong
                      className={cn(
                        document.status === "ready" || document.status === "approved"
                          ? "text-emerald-600"
                          : document.status === "draft"
                            ? "text-amber-600"
                            : document.status === "processing"
                              ? "text-blue-600"
                              : "text-rose-600"
                      )}
                    >
                      {document.status === "ready"
                        ? "Готов"
                        : document.status === "approved"
                          ? "Утверждён"
                          : document.status === "draft"
                            ? "Черновик"
                            : document.status === "processing"
                              ? "Векторизация..."
                              : "Ошибка"}
                    </strong>
                  </span>
                </div>

                {/* Переключатель: Блоки / Сырой Markdown */}
                <div className="flex items-center rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-0.5">
                  <button
                    type="button"
                    onClick={() => handleSwitchMode("blocks")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[6px] px-3 py-1 text-xs font-medium transition-colors",
                      viewMode === "blocks"
                        ? "bg-white text-[#4a38f5] shadow-xs font-semibold"
                        : "text-[#666666] hover:text-[#111111]"
                    )}
                  >
                    <Layers className="h-3.5 w-3.5" />
                    Блоки ({blocks.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMode("raw")}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[6px] px-3 py-1 text-xs font-medium transition-colors",
                      viewMode === "raw"
                        ? "bg-white text-[#4a38f5] shadow-xs font-semibold"
                        : "text-[#666666] hover:text-[#111111]"
                    )}
                  >
                    <Code className="h-3.5 w-3.5" />
                    Сырой текст
                  </button>
                </div>
              </div>

              {/* Содержимое: Блочный редактор или Сырой текст */}
              {viewMode === "blocks" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-[#666666]">
                    <span className="font-medium">Семантические секции страницы</span>
                    <span className="text-[11px] text-[#888888]">
                      {canEdit ? "Нажмите на заголовок или текст секции для правки" : "Только просмотр"}
                    </span>
                  </div>
                  <PageBlockEditor
                    blocks={blocks}
                    onChange={handleBlocksChange}
                    canEdit={canEdit}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-[#666666]">
                    <span className="font-medium">Полный текст (Markdown / Текст)</span>
                    <span className="text-[11px] text-[#888888]">
                      {canEdit ? "Сплошное полотно разметки" : "Только просмотр"}
                    </span>
                  </div>
                  <div className="rounded-[6px] bg-[#fefce8] border border-[#fef08a] p-2.5 text-[11px] text-[#854d0e]">
                    Внимание: правки в сыром режиме синхронизируются с секциями при переключении
                    обратно в режим «Блоки».
                  </div>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    disabled={!canEdit}
                    rows={22}
                    placeholder="Введите текст документа, регламента, условий или прайса..."
                    className="w-full resize-y rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 font-mono text-xs leading-relaxed text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:bg-[#fbfbfb]"
                  />
                </div>
              )}
            </>
          )}
        </div>

        {/* Футер */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
          >
            Закрыть
          </button>
          {canEdit && (
            <>
              <button
                type="button"
                onClick={handleSave}
                disabled={updateMutation.isPending || approveMutation.isPending || isLoading}
                className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors disabled:opacity-50"
              >
                {updateMutation.isPending ? "Сохранение..." : "Сохранить правки"}
              </button>

              {document?.status === "draft" && (
                <button
                  type="button"
                  onClick={handleApprove}
                  disabled={approveMutation.isPending || updateMutation.isPending || isLoading}
                  className="flex items-center gap-1.5 rounded-[8px] bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-emerald-700 transition-colors disabled:opacity-50"
                >
                  {approveMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {approveMutation.isPending ? "Индексация в RAG..." : "Утвердить и отправить в RAG"}
                </button>
              )}

              {document?.status !== "draft" && (
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
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
