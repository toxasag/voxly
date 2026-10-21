"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  Paperclip,
  Smile,
  Mic,
  Send,
  Sparkles,
  Maximize2,
  Minimize2,
  ChevronRight,
  X,
  FileText,
  Loader2,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

const POPULAR_EMOJIS = [
  "👍", "👋", "🔥", "❤️", "😊", "🤝", "✅", "🎉",
  "👌", "🙏", "🚀", "💡", "❓", "❗", "📞", "⏳",
  "💼", "💰", "🛠️", "⭐",
];

export interface AttachedFile {
  file: File;
  name: string;
  size: number;
  previewUrl?: string;
}

export interface TelegramComposerProps {
  value: string;
  onChange: (val: string) => void;
  onSend: (file?: AttachedFile) => void;
  isSending?: boolean;
  onAiDraft?: () => void;
  isAiDraftPending?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

interface ContextMenuPosition {
  x: number;
  y: number;
}

export function TelegramComposer({
  value,
  onChange,
  onSend,
  isSending = false,
  onAiDraft,
  isAiDraftPending = false,
  placeholder = "Сообщение...",
  className,
  disabled = false,
}: TelegramComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fullscreenTextareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Контекстное меню
  const [contextMenuPos, setContextMenuPos] = useState<ContextMenuPosition | null>(null);
  const [isFormattingSubmenuOpen, setIsFormattingSubmenuOpen] = useState(false);

  // История для Undo/Redo
  const [history, setHistory] = useState<string[]>([value]);
  const [historyIdx, setHistoryIdx] = useState(0);

  // Автоматическая подгонка высоты до 13 строк (строка ~22px, максимум ~290px)
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollH = el.scrollHeight;
    const maxHeight = 290; // ~13 строк
    const newH = Math.max(38, Math.min(scrollH, maxHeight));
    el.style.height = `${newH}px`;
    el.style.overflowY = scrollH > maxHeight ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [value, adjustHeight]);

  // Запись в историю изменений (с троттлингом)
  const updateValueWithHistory = useCallback((newVal: string) => {
    onChange(newVal);
    setHistory((prev) => {
      const next = prev.slice(0, historyIdx + 1);
      return [...next, newVal];
    });
    setHistoryIdx((prev) => prev + 1);
  }, [historyIdx, onChange]);

  // Закрытие контекстного меню при клике снаружи или Escape
  useEffect(() => {
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuPos(null);
        setIsFormattingSubmenuOpen(false);
      }
    };

    const handleKeyDownGlobal = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (contextMenuPos) {
          setContextMenuPos(null);
          setIsFormattingSubmenuOpen(false);
        } else if (isFullscreen) {
          setIsFullscreen(false);
        } else if (showEmojiPicker) {
          setShowEmojiPicker(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDownGlobal);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDownGlobal);
    };
  }, [contextMenuPos, isFullscreen, showEmojiPicker]);

  // Правый клик -> вызов кастомного контекстного меню
  const handleContextMenu = (e: MouseEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - 380);
    setContextMenuPos({ x, y });
    setIsFormattingSubmenuOpen(false);
  };

  const getTargetTextarea = (): HTMLTextAreaElement | null => {
    return isFullscreen ? fullscreenTextareaRef.current : textareaRef.current;
  };

  // Вставка форматирования
  const applyFormatting = useCallback((prefix: string, suffix: string = prefix) => {
    const el = getTargetTextarea();
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentVal = el.value;

    if (start !== end) {
      const selected = currentVal.substring(start, end);
      const updated = currentVal.substring(0, start) + prefix + selected + suffix + currentVal.substring(end);
      updateValueWithHistory(updated);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + prefix.length, end + prefix.length);
      }, 0);
    } else {
      const updated = currentVal.substring(0, start) + prefix + suffix + currentVal.substring(end);
      updateValueWithHistory(updated);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start + prefix.length, start + prefix.length);
      }, 0);
    }

    setContextMenuPos(null);
    setIsFormattingSubmenuOpen(false);
  }, [isFullscreen, updateValueWithHistory]);

  // Очистка форматирования
  const clearFormatting = useCallback(() => {
    const el = getTargetTextarea();
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentVal = el.value;

    const targetText = start !== end ? currentVal.substring(start, end) : currentVal;
    const cleaned = targetText
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/\|\|(.*?)\|\|/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/<u>(.*?)<\/u>/g, "$1")
      .replace(/^>\s*/gm, "");

    if (start !== end) {
      const updated = currentVal.substring(0, start) + cleaned + currentVal.substring(end);
      updateValueWithHistory(updated);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start + cleaned.length);
      }, 0);
    } else {
      updateValueWithHistory(cleaned);
    }

    setContextMenuPos(null);
    setIsFormattingSubmenuOpen(false);
  }, [isFullscreen, updateValueWithHistory]);

  // Вставка текущей даты
  const insertDate = useCallback(() => {
    const el = getTargetTextarea();
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentVal = el.value;

    const dateStr = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());

    const updated = currentVal.substring(0, start) + dateStr + currentVal.substring(end);
    updateValueWithHistory(updated);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + dateStr.length, start + dateStr.length);
    }, 0);

    setContextMenuPos(null);
    setIsFormattingSubmenuOpen(false);
  }, [isFullscreen, updateValueWithHistory]);

  // Вставка ссылки
  const insertLink = useCallback(() => {
    const el = getTargetTextarea();
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const currentVal = el.value;

    const selected = start !== end ? currentVal.substring(start, end) : "ссылка";
    const url = window.prompt("Введите адрес ссылки (URL):", "https://");
    if (!url) return;

    const linkMd = `[${selected}](${url})`;
    const updated = currentVal.substring(0, start) + linkMd + currentVal.substring(end);
    updateValueWithHistory(updated);
    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + linkMd.length, start + linkMd.length);
    }, 0);

    setContextMenuPos(null);
    setIsFormattingSubmenuOpen(false);
  }, [isFullscreen, updateValueWithHistory]);

  // Undo / Redo
  const handleUndo = useCallback(() => {
    if (historyIdx > 0) {
      const prev = history[historyIdx - 1];
      if (prev !== undefined) {
        setHistoryIdx(historyIdx - 1);
        onChange(prev);
      }
    }
    setContextMenuPos(null);
  }, [history, historyIdx, onChange]);

  const handleRedo = useCallback(() => {
    if (historyIdx < history.length - 1) {
      const next = history[historyIdx + 1];
      if (next !== undefined) {
        setHistoryIdx(historyIdx + 1);
        onChange(next);
      }
    }
    setContextMenuPos(null);
  }, [history, historyIdx, onChange]);

  // Копирование, вырезание, вставка, удаление
  const handleCopy = useCallback(async () => {
    const el = getTargetTextarea();
    if (!el) return;
    const textToCopy = el.selectionStart !== el.selectionEnd
      ? el.value.substring(el.selectionStart, el.selectionEnd)
      : el.value;
    if (textToCopy) {
      await navigator.clipboard.writeText(textToCopy).catch(() => null);
    }
    setContextMenuPos(null);
  }, [isFullscreen]);

  const handleCut = useCallback(async () => {
    const el = getTargetTextarea();
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) {
      const selected = el.value.substring(start, end);
      await navigator.clipboard.writeText(selected).catch(() => null);
      const updated = el.value.substring(0, start) + el.value.substring(end);
      updateValueWithHistory(updated);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start);
      }, 0);
    }
    setContextMenuPos(null);
  }, [isFullscreen, updateValueWithHistory]);

  const handlePaste = useCallback(async () => {
    const el = getTargetTextarea();
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) {
        const updated = el.value.substring(0, start) + clipText + el.value.substring(end);
        updateValueWithHistory(updated);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start + clipText.length, start + clipText.length);
        }, 0);
      }
    } catch {
      // Игнорируем отсутствие разрешений буфера
    }
    setContextMenuPos(null);
  }, [isFullscreen, updateValueWithHistory]);

  const handleDelete = useCallback(() => {
    const el = getTargetTextarea();
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (start !== end) {
      const updated = el.value.substring(0, start) + el.value.substring(end);
      updateValueWithHistory(updated);
      setTimeout(() => {
        el.focus();
        el.setSelectionRange(start, start);
      }, 0);
    }
    setContextMenuPos(null);
  }, [isFullscreen, updateValueWithHistory]);

  const handleSelectAll = useCallback(() => {
    const el = getTargetTextarea();
    if (!el) return;
    el.focus();
    el.select();
    setContextMenuPos(null);
  }, [isFullscreen]);

  // Обработка горячих клавиш клавиатуры
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const isMac = navigator.platform.toUpperCase().includes("MAC");
    const modKey = isMac ? e.metaKey : e.ctrlKey;

    // Enter для отправки, Shift+Enter для переноса
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() || attachedFile) {
        onSend(attachedFile ?? undefined);
        setAttachedFile(null);
        if (textareaRef.current) {
          textareaRef.current.style.height = "38px";
        }
      }
      return;
    }

    // Горячие клавиши форматирования
    if (modKey) {
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        applyFormatting("**", "**");
      } else if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        applyFormatting("*", "*");
      } else if (e.key.toLowerCase() === "u") {
        e.preventDefault();
        applyFormatting("<u>", "</u>");
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        insertLink();
      } else if (e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        applyFormatting("~~", "~~");
      } else if (e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        applyFormatting("`", "`");
      } else if (e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        applyFormatting("||", "||");
      } else if (e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        insertDate();
      } else if (e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        clearFormatting();
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImg = file.type.startsWith("image/");
    const previewUrl = isImg ? URL.createObjectURL(file) : undefined;

    setAttachedFile({
      file,
      name: file.name,
      size: file.size,
      previewUrl,
    });
  };

  const removeAttachedFile = () => {
    if (attachedFile?.previewUrl) {
      URL.revokeObjectURL(attachedFile.previewUrl);
    }
    setAttachedFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSendAction = () => {
    if (disabled || isSending || (!value.trim() && !attachedFile)) return;
    onSend(attachedFile ?? undefined);
    setAttachedFile(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = "38px";
    }
    if (isFullscreen) {
      setIsFullscreen(false);
    }
  };

  return (
    <div className={cn("relative bg-white", className)}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Полоса прикрепленного файла над полем ввода */}
      {attachedFile && (
        <div className="mb-2 flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2 text-xs">
          {attachedFile.previewUrl ? (
            <img
              src={attachedFile.previewUrl}
              alt="Вложение"
              className="h-10 w-10 rounded-[6px] object-cover border border-[#e5e5e5]"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[#f0f0f0] text-[#666666]">
              <FileText className="h-5 w-5" />
            </div>
          )}
          <div className="flex-1 truncate">
            <p className="font-medium text-[#111111] truncate">{attachedFile.name}</p>
            <p className="text-[11px] text-[#888888]">
              {Math.round(attachedFile.size / 1024)} КБ
            </p>
          </div>
          <button
            type="button"
            onClick={removeAttachedFile}
            className="p-1 text-[#888888] hover:text-rose-600 transition-colors"
            title="Удалить файл"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Верхние служебные иконки: ✦Ai слева и Expand справа (как на скриншоте 12.15.43) */}
      <div className="flex items-center justify-between px-3 pt-1 pb-0.5 text-xs">
        {onAiDraft ? (
          <button
            type="button"
            onClick={onAiDraft}
            disabled={isAiDraftPending}
            title="AI Copilot: сгенерировать ответ"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#888888] hover:text-[#4a38f5] transition-colors cursor-pointer"
          >
            {isAiDraftPending ? (
              <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 text-[#4a38f5]" />
            )}
            <span className="font-semibold text-[#4a38f5]">Ai</span>
          </button>
        ) : (
          <div />
        )}

        <button
          type="button"
          onClick={() => setIsFullscreen(true)}
          title="Открыть редактор на весь экран"
          className="text-[#888888] hover:text-[#111111] transition-colors p-0.5 rounded cursor-pointer"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Основная строка ввода Telegram-стиля (скриншоты 12.12.36, 12.13.38, 12.15.43) */}
      <div className="relative flex items-end gap-1.5 px-2 pb-2 pt-0.5">
        {/* Кнопка скрепки (вложения) */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Прикрепить файл или фото"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
        >
          <Paperclip className="h-5 w-5 rotate-[-45deg]" />
        </button>

        {/* Текстовое поле ввода */}
        <div className="relative flex-1">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              updateValueWithHistory(e.target.value);
              adjustHeight();
            }}
            onKeyDown={handleKeyDown}
            onContextMenu={handleContextMenu}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            className="w-full resize-none border-none bg-transparent px-2 py-2 text-[14px] leading-relaxed text-[#111111] placeholder:text-[#888888] focus:outline-none focus:ring-0"
            style={{ minHeight: "38px", maxHeight: "290px" }}
          />
        </div>

        {/* Иконка смайлика (быстрые эмодзи) */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowEmojiPicker((v) => !v)}
            title="Эмодзи"
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <Smile className="h-5 w-5" />
          </button>

          {showEmojiPicker && (
            <div className="absolute bottom-full right-0 z-30 mb-2 flex w-56 flex-wrap gap-1 rounded-[16px] border border-[#e5e5e5] bg-white p-2.5 shadow-xl">
              {POPULAR_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    const el = textareaRef.current;
                    if (el) {
                      const start = el.selectionStart;
                      const end = el.selectionEnd;
                      const updated = value.substring(0, start) + emoji + value.substring(end);
                      updateValueWithHistory(updated);
                      setTimeout(() => {
                        el.focus();
                        el.setSelectionRange(start + emoji.length, start + emoji.length);
                      }, 0);
                    } else {
                      updateValueWithHistory(value + emoji);
                    }
                    setShowEmojiPicker(false);
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-base hover:bg-[#f5f5f5] cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Кнопка действия: Микрофон (если пусто) или Синий самолётик (если введен текст/файл) */}
        <div className="shrink-0">
          {value.trim() || attachedFile ? (
            <button
              type="button"
              onClick={handleSendAction}
              disabled={disabled || isSending}
              title="Отправить сообщение (Enter)"
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#2aabee] hover:bg-[#2aabee]/10 transition-colors disabled:opacity-40 cursor-pointer"
            >
              {isSending ? (
                <Loader2 className="h-5 w-5 animate-spin text-[#2aabee]" />
              ) : (
                <Send className="h-5 w-5 fill-[#2aabee]" />
              )}
            </button>
          ) : (
            <button
              type="button"
              title="Голосовое сообщение"
              className="flex h-9 w-9 items-center justify-center rounded-full text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
            >
              <Mic className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>

      {/* КАСТОМНОЕ КОНТЕКСТНОЕ МЕНЮ (Скриншот 12.17.30) */}
      {contextMenuPos && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[210px] rounded-[12px] border border-[#e5e5e5] bg-white py-1.5 shadow-2xl text-[13px] text-[#111111]"
          style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
        >
          <button
            type="button"
            onClick={handleUndo}
            disabled={historyIdx === 0}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] disabled:opacity-40 cursor-pointer"
          >
            <span>Отменить</span>
            <span className="text-[11px] text-[#888888]">⌘Z</span>
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={historyIdx >= history.length - 1}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] disabled:opacity-40 cursor-pointer"
          >
            <span>Повторить</span>
            <span className="text-[11px] text-[#888888]">⇧⌘Z</span>
          </button>

          <div className="my-1 border-t border-[#f0f0f0]" />

          <button
            type="button"
            onClick={handleCut}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Вырезать</span>
            <span className="text-[11px] text-[#888888]">⌘X</span>
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Копировать</span>
            <span className="text-[11px] text-[#888888]">⌘C</span>
          </button>
          <button
            type="button"
            onClick={handlePaste}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Вставить</span>
            <span className="text-[11px] text-[#888888]">⌘V</span>
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Удалить</span>
          </button>

          <div className="my-1 border-t border-[#f0f0f0]" />

          {/* Пункт с подменю «Форматирование >» */}
          <div
            className="relative"
            onMouseEnter={() => setIsFormattingSubmenuOpen(true)}
          >
            <button
              type="button"
              onClick={() => setIsFormattingSubmenuOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
            >
              <span>Форматирование</span>
              <ChevronRight className="h-4 w-4 text-[#888888]" />
            </button>

            {/* Подменю форматирования */}
            {isFormattingSubmenuOpen && (
              <div
                className="absolute left-full top-[-80px] z-50 min-w-[210px] rounded-[12px] border border-[#e5e5e5] bg-white py-1.5 shadow-2xl text-[13px] text-[#111111]"
              >
                <button
                  type="button"
                  onClick={() => applyFormatting("**", "**")}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="font-semibold">Жирный</span>
                  <span className="text-[11px] text-[#888888]">⌘B</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("*", "*")}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="italic">Курсив</span>
                  <span className="text-[11px] text-[#888888]">⌘I</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("<u>", "</u>")}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="underline">Подчёркнутый</span>
                  <span className="text-[11px] text-[#888888]">⌘U</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("~~", "~~")}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="line-through">Зачёркнутый</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘X</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("> ")}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span>Цитата</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘.</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("`", "`")}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="font-mono text-xs">Моноширинный</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘M</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyFormatting("||", "||")}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span>Скрытый</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘P</span>
                </button>

                <div className="my-1 border-t border-[#f0f0f0]" />

                <button
                  type="button"
                  onClick={insertLink}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span>Добавить ссылку</span>
                  <span className="text-[11px] text-[#888888]">⌘K</span>
                </button>
                <button
                  type="button"
                  onClick={insertDate}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span>Дата</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘D</span>
                </button>

                <div className="my-1 border-t border-[#f0f0f0]" />

                <button
                  type="button"
                  onClick={clearFormatting}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] text-[#888888] hover:text-[#111111] cursor-pointer"
                >
                  <span>Без форматирования</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘N</span>
                </button>
              </div>
            )}
          </div>

          <div className="my-1 border-t border-[#f0f0f0]" />

          <button
            type="button"
            onClick={handleSelectAll}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Выбрать всё</span>
            <span className="text-[11px] text-[#888888]">⌘A</span>
          </button>
        </div>
      )}

      {/* ПОЛНОЭКРАННЫЙ РЕЖИМ РЕДАКТИРОВАНИЯ (Fullscreen Overlay) */}
      {isFullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white p-6 shadow-2xl">
          {/* Шапка полноэкранного редактора */}
          <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-3 mb-4">
            <div className="flex items-center gap-3">
              <h3 className="text-base font-semibold text-[#111111]">
                Редактирование сообщения
              </h3>
              {onAiDraft && (
                <button
                  type="button"
                  onClick={onAiDraft}
                  disabled={isAiDraftPending}
                  className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-2.5 py-1 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 cursor-pointer"
                >
                  {isAiDraftPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  <span>Сгенерировать черновик (AI)</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] px-3 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                title="Свернуть (Escape)"
              >
                <Minimize2 className="h-4 w-4" />
                <span>Свернуть</span>
              </button>
            </div>
          </div>

          {/* Панель быстрого форматирования в полноэкранном режиме */}
          <div className="flex flex-wrap items-center gap-1 border-b border-[#f0f0f0] pb-2 mb-3 text-xs text-[#666666]">
            <button
              type="button"
              onClick={() => applyFormatting("**", "**")}
              className="rounded px-2.5 py-1 font-bold hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Жирный (⌘B)
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("*", "*")}
              className="rounded px-2.5 py-1 italic hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Курсив (⌘I)
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("<u>", "</u>")}
              className="rounded px-2.5 py-1 underline hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Подчёркнутый (⌘U)
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("~~", "~~")}
              className="rounded px-2.5 py-1 line-through hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Зачёркнутый
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("> ")}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Цитата
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("`", "`")}
              className="rounded px-2.5 py-1 font-mono text-xs hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Моноширинный
            </button>
            <button
              type="button"
              onClick={() => applyFormatting("||", "||")}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Спойлер
            </button>
            <button
              type="button"
              onClick={insertLink}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#4a38f5] cursor-pointer"
            >
              Ссылка (⌘K)
            </button>
            <button
              type="button"
              onClick={insertDate}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#666666] cursor-pointer"
            >
              Дата
            </button>
            <button
              type="button"
              onClick={clearFormatting}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#888888] cursor-pointer ml-auto"
            >
              Очистить разметку
            </button>
          </div>

          {/* Текстовая область на весь экран */}
          <div className="flex-1 relative">
            <textarea
              ref={fullscreenTextareaRef}
              value={value}
              onChange={(e) => updateValueWithHistory(e.target.value)}
              onKeyDown={handleKeyDown}
              onContextMenu={handleContextMenu}
              placeholder="Введите текст сообщения..."
              className="h-full w-full resize-none rounded-[8px] border border-[#e5e5e5] p-4 text-[14px] leading-relaxed text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-sans"
              autoFocus
            />
          </div>

          {/* Нижняя панель действий полноэкранного режима */}
          <div className="flex items-center justify-between border-t border-[#e5e5e5] pt-3 mt-4">
            <span className="text-xs text-[#888888]">
              {value.length} символов • {value.split("\n").length} строк • Enter для отправки
            </span>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                className="h-9 px-4 rounded-[8px] border border-[#e5e5e5] text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
              >
                Готово
              </button>
              <button
                type="button"
                onClick={handleSendAction}
                disabled={disabled || isSending || (!value.trim() && !attachedFile)}
                className="flex h-9 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-40 cursor-pointer"
              >
                {isSending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                <span>Отправить клиенту</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
