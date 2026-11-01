"use client";

import { useRef, useState } from "react";
import { AlertCircle, FileText, Loader2, MessageSquare, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { useImportWhatsAppKnowledge } from "@/lib/api/use-agent-knowledge";
import { cn } from "@/lib/utils";

interface WhatsAppImportModalProps {
  agentId: string;
  open: boolean;
  onClose: () => void;
}

export function WhatsAppImportModal({ agentId, open, onClose }: WhatsAppImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importMutation = useImportWhatsAppKnowledge(agentId);

  const [chatText, setChatText] = useState("");
  const [fileName, setFileName] = useState("");
  const [activeMode, setActiveMode] = useState<"file" | "paste">("file");

  if (!open) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith(".txt")) {
      toast.error("Пожалуйста, выберите текстовый файл переписки (.txt)");
      return;
    }

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string") {
        setChatText(content);
        toast.success(`Файл «${file.name}» загружен (${Math.round(file.size / 1024)} КБ)`);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (chatText.trim().length === 0) {
      toast.error("Загрузите файл или вставьте текст переписки WhatsApp");
      return;
    }

    try {
      const res = await importMutation.mutateAsync({
        text: chatText.trim(),
        filename: fileName || "WhatsApp-чат.txt",
      });

      toast.success(
        `AI успешно проанализировал переписку WhatsApp! Создано документов: ${res.documentsCreated} (собеседников: ${res.participants.length})`,
      );
      setChatText("");
      setFileName("");
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось обработать переписку");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="w-full max-w-xl rounded-[16px] border border-[#e5e5e5] bg-white shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-emerald-50 text-emerald-600 border border-emerald-200">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">
                Импорт переписки из WhatsApp
              </h3>
              <p className="text-xs text-[#666666]">
                Обучение агента на реальных диалогах с клиентами
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[#888888] hover:bg-[#f5f5f5] hover:text-[#111111]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4">
          {/* Инструкция */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3.5 text-xs text-[#666666] space-y-1.5">
            <p className="font-semibold text-[#111111]">Как выгрузить переписку из WhatsApp:</p>
            <ol className="list-decimal pl-4 space-y-1 text-[#666666]">
              <li>Откройте чат с клиентом в WhatsApp на телефоне.</li>
              <li>Нажмите на имя контакта или три точки ⋮ в правом верхнем углу.</li>
              <li>Выберите: <strong>Ещё → Экспорт чата → Без медиафайлов</strong>.</li>
              <li>Прикрепите полученный файл <code>_chat.txt</code> ниже.</li>
            </ol>
          </div>

          {/* Переключатель режима: файл / текст */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveMode("file")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors border",
                activeMode === "file"
                  ? "bg-[#4a38f5] text-white border-[#4a38f5]"
                  : "bg-white text-[#666666] border-[#e5e5e5] hover:bg-slate-50",
              )}
            >
              Загрузить файл .txt
            </button>
            <button
              type="button"
              onClick={() => setActiveMode("paste")}
              className={cn(
                "px-3 py-1.5 text-xs font-medium rounded-[6px] transition-colors border",
                activeMode === "paste"
                  ? "bg-[#4a38f5] text-white border-[#4a38f5]"
                  : "bg-white text-[#666666] border-[#e5e5e5] hover:bg-slate-50",
              )}
            >
              Вставить текст вручную
            </button>
          </div>

          {/* Поле загрузки файла */}
          {activeMode === "file" && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="flex flex-col items-center justify-center gap-2 rounded-[8px] border border-dashed border-[#cccccc] bg-[#fafafa] p-6 text-center cursor-pointer hover:border-[#4a38f5] hover:bg-white transition-colors"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white border border-[#e5e5e5] shadow-2xs">
                <Upload className="h-5 w-5 text-[#888888]" />
              </div>
              <div>
                <p className="text-xs font-semibold text-[#111111]">
                  {fileName ? fileName : "Нажмите для выбора файла _chat.txt"}
                </p>
                <p className="text-[11px] text-[#888888]">
                  {chatText
                    ? `Готово к анализу: ${chatText.length} символов`
                    : "Поддерживаются файлы экспорта диалогов WhatsApp"}
                </p>
              </div>
            </div>
          )}

          {/* Ручная вставка текста */}
          {activeMode === "paste" && (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#666666]">
                Текст сообщений WhatsApp
              </label>
              <textarea
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                rows={8}
                placeholder="[24.10.2026, 14:10] Иван: Здравствуйте! Сколько стоит замена экрана?&#10;[24.10.2026, 14:12] Мастер: Добрый день! 4500 руб с оригиналом..."
                className="w-full resize-y rounded-[8px] border border-[#e5e5e5] bg-white p-3 font-mono text-xs leading-relaxed text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          )}

          <div className="rounded-[8px] border border-emerald-200 bg-emerald-50/50 p-3 text-xs text-emerald-800">
            <strong>Что сделает нейросеть:</strong> автоматически выделит реальные цены на услуги,
            частые вопросы клиентов (FAQ) и естественный тон общения (Tone of Voice) вашей компании.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5]"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={importMutation.isPending || chatText.trim().length === 0}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] disabled:opacity-50"
          >
            {importMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {importMutation.isPending ? "Анализируем диалоги..." : "Анализировать и обучить агента"}
          </button>
        </div>
      </div>
    </div>
  );
}
