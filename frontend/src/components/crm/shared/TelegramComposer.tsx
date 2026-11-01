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

/**
 * Проверяет, находится ли узел внутри инлайн-тега форматирования
 */
function getInlineAncestor(node: Node | null, root: HTMLElement): HTMLElement | null {
  const inlineTags = new Set([
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "del",
    "strike",
    "code",
    "a",
  ]);
  let curr = node;
  while (curr && curr !== root && curr !== document.body) {
    if (curr.nodeType === Node.ELEMENT_NODE) {
      const el = curr as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (inlineTags.has(tag) || el.classList.contains("tg-spoiler")) {
        return el;
      }
    }
    curr = curr.parentNode;
  }
  return null;
}

/**
 * Проверяет, находится ли курсор в самом конце содержимого элемента
 */
function isCaretAtEndOfElement(el: HTMLElement, range: Range): boolean {
  try {
    const testRange = document.createRange();
    testRange.setStart(range.startContainer, range.startOffset);
    testRange.setEnd(el, el.childNodes.length);
    return testRange.toString().length === 0;
  } catch {
    return false;
  }
}

/**
 * Рекурсивный сериализатор DOM-узлов в Markdown
 */
function serializeDomNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  if (tag === "br") {
    return "\n";
  }

  let inner = "";
  for (let i = 0; i < el.childNodes.length; i++) {
    inner += serializeDomNode(el.childNodes[i]);
  }

  const isBold =
    tag === "b" ||
    tag === "strong" ||
    el.style.fontWeight === "bold" ||
    parseInt(el.style.fontWeight || "0", 10) >= 600;
  const isItalic =
    tag === "i" || tag === "em" || el.style.fontStyle === "italic";
  const isUnderline =
    tag === "u" ||
    (Boolean(el.style.textDecoration) && el.style.textDecoration.includes("underline"));
  const isStrike =
    tag === "s" ||
    tag === "del" ||
    tag === "strike" ||
    (Boolean(el.style.textDecoration) && el.style.textDecoration.includes("line-through"));
  const isCode = tag === "code";
  const isSpoiler =
    el.classList.contains("tg-spoiler") ||
    el.getAttribute("data-spoiler") === "true";
  const isLink = tag === "a";
  const isQuote = tag === "blockquote";
  const isBlock = tag === "div" || tag === "p";

  let result = inner;

  if (isCode && result) {
    result = `\`${result}\``;
  }
  if (isSpoiler && result) {
    result = `||${result}||`;
  }
  if (isStrike && result) {
    result = `~~${result}~~`;
  }
  if (isUnderline && result) {
    result = `<u>${result}</u>`;
  }
  if (isItalic && result) {
    result = `*${result}*`;
  }
  if (isBold && result) {
    result = `**${result}**`;
  }
  if (isLink && result) {
    const href = el.getAttribute("href") || "";
    result = `[${result}](${href})`;
  }
  if (isQuote && result) {
    result = result
      .split("\n")
      .map((line) => (line ? `> ${line}` : ">"))
      .join("\n");
  }

  if (isBlock) {
    if (result === "" || result === "\n") {
      return "\n";
    }
    return result + "\n";
  }

  return result;
}

/**
 * Конвертация HTML из contenteditable в Markdown
 */
export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  if (typeof document === "undefined") return html;
  const temp = document.createElement("div");
  temp.innerHTML = html;
  let md = "";
  for (let i = 0; i < temp.childNodes.length; i++) {
    md += serializeDomNode(temp.childNodes[i]);
  }
  // Удаляем zero-width space и нормализуем концевые переносы строк
  const clean = md.replace(/\u200B/g, "");
  return clean.replace(/\n+$/, (m) => (m.length > 1 ? "\n" : ""));
}

/**
 * Конвертация Markdown в визуальный HTML для contenteditable
 */
export function markdownToHtml(md: string): string {
  if (!md) return "";

  const lines = md.split("\n");
  const processedLines = lines.map((line) => {
    let l = line;
    const isQuote = /^>\s?/.test(l);
    if (isQuote) {
      l = l.replace(/^>\s?/, "");
    }

    // Экранируем HTML спецсимволы
    l = l
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Восстанавливаем поддерживаемые теги <u></u>
    l = l.replace(/&lt;u&gt;(.*?)&lt;\/u&gt;/gi, "<u>$1</u>");

    // Bold + Italic: ***text***
    l = l.replace(/(?<!\*)\*\*\*(?!\*)([^*]+?)(?<!\*)\*\*\*(?!\*)/g, "<strong><em>$1</em></strong>");

    // Bold: **text**
    l = l.replace(/(?<!\*)\*\*(?!\*)([^*]+?)(?<!\*)\*\*(?!\*)/g, "<strong>$1</strong>");

    // Italic: *text*
    l = l.replace(/(?<!\*)\*(?!\*)([^*]+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");

    // Strikethrough: ~~text~~
    l = l.replace(/~~([^~]+?)~~/g, "<s>$1</s>");

    // Monospace / Code: `code`
    l = l.replace(
      /`([^`]+?)`/g,
      `<code class="rounded bg-[#f0f0f0] px-1 py-0.5 font-mono text-xs text-[#111111]">$1</code>`
    );

    // Spoiler: ||spoiler||
    l = l.replace(
      /\|\|([^|]+?)\|\|/g,
      `<span class="tg-spoiler" data-spoiler="true" style="background-color:#e5e5e5;color:#111111;padding:1px 4px;border-radius:4px;border:1px dashed #cccccc;">$1</span>`
    );

    // Link: [text](url)
    l = l.replace(
      /\[([^\]]+?)\]\(([^)]+?)\)/g,
      `<a href="$2" class="text-[#2aabee] underline" target="_blank" rel="noreferrer">$1</a>`
    );

    if (isQuote) {
      return `<blockquote class="border-l-2 border-[#2aabee] pl-2 text-[#666666] italic my-1">${l}</blockquote>`;
    }
    return l;
  });

  return processedLines.join("<br>");
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
  const editorRef = useRef<HTMLDivElement>(null);
  const fullscreenEditorRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const lastSerializedValueRef = useRef<string>(value);
  const savedRangeRef = useRef<Range | null>(null);

  const [attachedFile, setAttachedFile] = useState<AttachedFile | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hasContent, setHasContent] = useState<boolean>(Boolean(value.trim()));

  // Контекстное меню
  const [contextMenuPos, setContextMenuPos] = useState<ContextMenuPosition | null>(null);
  const [isFormattingSubmenuOpen, setIsFormattingSubmenuOpen] = useState(false);

  // Возвращает активный элемент редактора (основной или полноэкранный)
  const getTargetEditor = useCallback((): HTMLDivElement | null => {
    return isFullscreen ? fullscreenEditorRef.current : editorRef.current;
  }, [isFullscreen]);

  // Автоматическая подгонка высоты до 13 строк (строка ~22px, максимум ~290px)
  const adjustHeight = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    el.style.height = "auto";
    const scrollH = el.scrollHeight;
    const maxHeight = 290;
    const newH = Math.max(38, Math.min(scrollH, maxHeight));
    el.style.height = `${newH}px`;
    el.style.overflowY = scrollH > maxHeight ? "auto" : "hidden";
  }, []);

  // Синхронизация DOM -> Markdown
  const syncFromDOM = useCallback(() => {
    const activeEl = getTargetEditor();
    if (!activeEl) return;
    const md = htmlToMarkdown(activeEl.innerHTML);
    lastSerializedValueRef.current = md;
    setHasContent(Boolean(md.trim()));
    onChange(md);
    adjustHeight();
  }, [getTargetEditor, onChange, adjustHeight]);

  // Синхронизация внешнего значения `value` в DOM (при сбросе после отправки или вставке черновика AI)
  useEffect(() => {
    if (value !== lastSerializedValueRef.current) {
      lastSerializedValueRef.current = value;
      const html = markdownToHtml(value);
      if (editorRef.current && editorRef.current.innerHTML !== html) {
        editorRef.current.innerHTML = html;
      }
      if (fullscreenEditorRef.current && fullscreenEditorRef.current.innerHTML !== html) {
        fullscreenEditorRef.current.innerHTML = html;
      }
      setHasContent(Boolean(value.trim()));
      adjustHeight();
    }
  }, [value, adjustHeight]);

  // Синхронизация содержимого при переключении Fullscreen
  useEffect(() => {
    const html = markdownToHtml(lastSerializedValueRef.current);
    if (isFullscreen && fullscreenEditorRef.current) {
      fullscreenEditorRef.current.innerHTML = html;
      fullscreenEditorRef.current.focus();
    } else if (!isFullscreen && editorRef.current) {
      editorRef.current.innerHTML = html;
      editorRef.current.focus();
      adjustHeight();
    }
  }, [isFullscreen, adjustHeight]);

  // Сохранение и восстановление выделения
  const saveSelection = useCallback(() => {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      savedRangeRef.current = sel.getRangeAt(0).cloneRange();
    }
  }, []);

  const restoreSelection = useCallback(() => {
    if (typeof window === "undefined") return;
    const sel = window.getSelection();
    const range = savedRangeRef.current;
    if (sel && range) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, []);

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
  const handleContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    saveSelection();
    const x = Math.min(e.clientX, window.innerWidth - 240);
    const y = Math.min(e.clientY, window.innerHeight - 380);
    setContextMenuPos({ x, y });
    setIsFormattingSubmenuOpen(false);
  };

  /**
   * Чистое DOM-применение инлайн-форматирования строго к ВЫДЕЛЕННОМУ тексту.
   * Исключает document.execCommand, благодаря чему браузер не накапливает глобальный стек стилей.
   */
  const toggleInlineFormat = useCallback(
    (
      tagNames: string[],
      wrapperTag: string,
      className?: string,
      style?: string,
      attributes?: Record<string, string>
    ) => {
      const activeEl = getTargetEditor();
      if (!activeEl) return;
      activeEl.focus();

      restoreSelection();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;

      const range = sel.getRangeAt(0);
      if (range.collapsed) {
        // Если ничего не выделено — не создаём скрытых тегов, чтобы не загрязнять дальнейший ввод
        return;
      }

      // Проверяем, находится ли выделение уже внутри одного из tagNames
      let matchedAncestor: HTMLElement | null = null;
      let curr: Node | null = range.commonAncestorContainer;
      if (curr.nodeType === Node.TEXT_NODE) {
        curr = curr.parentElement;
      }
      while (curr && curr !== activeEl && curr !== document.body) {
        if (curr.nodeType === Node.ELEMENT_NODE) {
          const el = curr as HTMLElement;
          const lower = el.tagName.toLowerCase();
          if (tagNames.includes(lower)) {
            if (!className || el.classList.contains(className)) {
              matchedAncestor = el;
              break;
            }
          }
        }
        curr = curr.parentNode;
      }

      if (matchedAncestor) {
        // Снимаем форматирование (разворачиваем тег)
        const parent = matchedAncestor.parentNode;
        if (parent) {
          while (matchedAncestor.firstChild) {
            parent.insertBefore(matchedAncestor.firstChild, matchedAncestor);
          }
          parent.removeChild(matchedAncestor);
        }
      } else {
        // Применяем форматирование ТОЛЬКО к выделенному фрагменту
        const wrapper = document.createElement(wrapperTag);
        if (className) wrapper.className = className;
        if (style) wrapper.setAttribute("style", style);
        if (attributes) {
          Object.entries(attributes).forEach(([k, v]) => {
            wrapper.setAttribute(k, v);
          });
        }

        try {
          const fragment = range.extractContents();
          wrapper.appendChild(fragment);
          range.insertNode(wrapper);

          // Гарантируем наличие чистого текстового узла после элемента для выхода из форматирования
          if (!wrapper.nextSibling || wrapper.nextSibling.nodeType !== Node.TEXT_NODE) {
            const emptyText = document.createTextNode("");
            if (wrapper.nextSibling) {
              wrapper.parentNode?.insertBefore(emptyText, wrapper.nextSibling);
            } else {
              wrapper.parentNode?.appendChild(emptyText);
            }
          }

          // Выделяем содержимое wrapper
          sel.removeAllRanges();
          const newRange = document.createRange();
          newRange.selectNodeContents(wrapper);
          sel.addRange(newRange);
          savedRangeRef.current = newRange.cloneRange();
        } catch {
          // Игнорируем ошибки при сложных пересечениях
        }
      }

      syncFromDOM();
      setContextMenuPos(null);
      setIsFormattingSubmenuOpen(false);
    },
    [getTargetEditor, restoreSelection, syncFromDOM]
  );

  // Команды форматирования
  const applyBold = useCallback(() => {
    toggleInlineFormat(["strong", "b"], "strong");
  }, [toggleInlineFormat]);

  const applyItalic = useCallback(() => {
    toggleInlineFormat(["em", "i"], "em");
  }, [toggleInlineFormat]);

  const applyUnderline = useCallback(() => {
    toggleInlineFormat(["u"], "u");
  }, [toggleInlineFormat]);

  const applyStrike = useCallback(() => {
    toggleInlineFormat(["s", "del", "strike"], "s");
  }, [toggleInlineFormat]);

  const applyMonospace = useCallback(() => {
    toggleInlineFormat(
      ["code"],
      "code",
      "rounded bg-[#f0f0f0] px-1 py-0.5 font-mono text-xs text-[#111111]"
    );
  }, [toggleInlineFormat]);

  const applySpoiler = useCallback(() => {
    toggleInlineFormat(
      ["span"],
      "span",
      "tg-spoiler",
      "background-color:#e5e5e5;color:#111111;padding:1px 4px;border-radius:4px;border:1px dashed #cccccc;",
      { "data-spoiler": "true" }
    );
  }, [toggleInlineFormat]);

  const applyQuote = useCallback(() => {
    const activeEl = getTargetEditor();
    if (!activeEl) return;
    activeEl.focus();

    restoreSelection();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);

    let quoteEl: HTMLElement | null = null;
    let curr: Node | null = range.commonAncestorContainer;
    if (curr.nodeType === Node.TEXT_NODE) curr = curr.parentElement;
    while (curr && curr !== activeEl && curr !== document.body) {
      if (curr.nodeType === Node.ELEMENT_NODE && (curr as HTMLElement).tagName.toLowerCase() === "blockquote") {
        quoteEl = curr as HTMLElement;
        break;
      }
      curr = curr.parentNode;
    }

    if (quoteEl) {
      const parent = quoteEl.parentNode;
      if (parent) {
        while (quoteEl.firstChild) {
          parent.insertBefore(quoteEl.firstChild, quoteEl);
        }
        parent.removeChild(quoteEl);
      }
    } else {
      const bq = document.createElement("blockquote");
      bq.className = "border-l-2 border-[#2aabee] pl-2 text-[#666666] italic my-1";
      if (!range.collapsed) {
        const fragment = range.extractContents();
        bq.appendChild(fragment);
        range.insertNode(bq);
      } else {
        bq.innerHTML = "<br>";
        range.insertNode(bq);
      }
    }

    syncFromDOM();
    setContextMenuPos(null);
    setIsFormattingSubmenuOpen(false);
  }, [getTargetEditor, restoreSelection, syncFromDOM]);

  const clearFormatting = useCallback(() => {
    restoreSelection();
    const activeEl = getTargetEditor();
    if (!activeEl) return;
    activeEl.focus();

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      if (!range.collapsed) {
        const text = range.toString();
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);
        const newRange = document.createRange();
        newRange.selectNodeContents(textNode);
        sel.removeAllRanges();
        sel.addRange(newRange);
        savedRangeRef.current = newRange.cloneRange();
      } else {
        const text = activeEl.innerText || activeEl.textContent || "";
        activeEl.innerHTML = text.replace(/\n/g, "<br>");
      }
    }
    syncFromDOM();
    setContextMenuPos(null);
    setIsFormattingSubmenuOpen(false);
  }, [getTargetEditor, restoreSelection, syncFromDOM]);

  const insertDate = useCallback(() => {
    restoreSelection();
    const activeEl = getTargetEditor();
    if (!activeEl) return;
    activeEl.focus();
    const dateStr = new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date());
    document.execCommand("insertText", false, dateStr);
    syncFromDOM();
    setContextMenuPos(null);
    setIsFormattingSubmenuOpen(false);
  }, [getTargetEditor, restoreSelection, syncFromDOM]);

  const insertLink = useCallback(() => {
    restoreSelection();
    const activeEl = getTargetEditor();
    if (!activeEl) return;
    activeEl.focus();
    const sel = window.getSelection();
    const selectedText = sel ? sel.toString() : "";
    const url = window.prompt("Введите адрес ссылки (URL):", "https://");
    if (!url) return;

    if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.className = "text-[#2aabee] underline";
      a.appendChild(range.extractContents());
      range.insertNode(a);
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.setStartAfter(a);
      newRange.setEndAfter(a);
      sel.addRange(newRange);
    } else if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.className = "text-[#2aabee] underline";
      a.textContent = url;
      range.insertNode(a);
      sel.removeAllRanges();
      const newRange = document.createRange();
      newRange.setStartAfter(a);
      newRange.setEndAfter(a);
      sel.addRange(newRange);
    }
    syncFromDOM();
    setContextMenuPos(null);
    setIsFormattingSubmenuOpen(false);
  }, [getTargetEditor, restoreSelection, syncFromDOM]);

  // Буфер обмена и стандартные действия
  const handleUndo = useCallback(() => {
    getTargetEditor()?.focus();
    document.execCommand("undo", false);
    syncFromDOM();
    setContextMenuPos(null);
  }, [getTargetEditor, syncFromDOM]);

  const handleRedo = useCallback(() => {
    getTargetEditor()?.focus();
    document.execCommand("redo", false);
    syncFromDOM();
    setContextMenuPos(null);
  }, [getTargetEditor, syncFromDOM]);

  const handleCut = useCallback(() => {
    getTargetEditor()?.focus();
    document.execCommand("cut", false);
    syncFromDOM();
    setContextMenuPos(null);
  }, [getTargetEditor, syncFromDOM]);

  const handleCopy = useCallback(() => {
    getTargetEditor()?.focus();
    document.execCommand("copy", false);
    setContextMenuPos(null);
  }, [getTargetEditor]);

  const handlePasteAction = useCallback(async () => {
    const activeEl = getTargetEditor();
    if (!activeEl) return;
    activeEl.focus();
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        document.execCommand("insertText", false, text);
        syncFromDOM();
      }
    } catch {
      // Игнорируем отсутствие разрешений буфера
    }
    setContextMenuPos(null);
  }, [getTargetEditor, syncFromDOM]);

  const handleDelete = useCallback(() => {
    getTargetEditor()?.focus();
    document.execCommand("delete", false);
    syncFromDOM();
    setContextMenuPos(null);
  }, [getTargetEditor, syncFromDOM]);

  const handleSelectAll = useCallback(() => {
    getTargetEditor()?.focus();
    document.execCommand("selectAll", false);
    setContextMenuPos(null);
  }, [getTargetEditor]);

  // Обработка горячих клавиш клавиатуры и защита от утечки форматирования
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");
    const modKey = isMac ? e.metaKey : e.ctrlKey;
    const activeEl = getTargetEditor();
    if (!activeEl) return;

    // 1. Enter для отправки в обычном режиме (Enter без Shift)
    const isEnterSend = e.key === "Enter" && !e.shiftKey && !isFullscreen;
    if (isEnterSend) {
      e.preventDefault();
      if (value.trim() || attachedFile) {
        handleSendAction();
      }
      return;
    }

    // 2. Enter для переноса строки (Shift+Enter в основном режиме или Enter в полноэкранном)
    if (e.key === "Enter") {
      e.preventDefault();
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const inlineEl = getInlineAncestor(range.startContainer, activeEl);

        const br = document.createElement("br");

        if (inlineEl) {
          if (isCaretAtEndOfElement(inlineEl, range)) {
            // Вставляем перенос строки СТРОГО СНАРУЖИ inlineEl, чтобы новая строка была чистой!
            if (inlineEl.nextSibling) {
              inlineEl.parentNode?.insertBefore(br, inlineEl.nextSibling);
            } else {
              inlineEl.parentNode?.appendChild(br);
            }
          } else {
            range.deleteContents();
            range.insertNode(br);
          }
        } else {
          range.deleteContents();
          range.insertNode(br);
        }

        // Если это последний элемент в редакторе, добавляем второй <br> для курсора
        if (!br.nextSibling) {
          const trailingBr = document.createElement("br");
          br.parentNode?.appendChild(trailingBr);
        }

        // Ставим курсор строго ПОСЛЕ <br> вне любых инлайн-стилей
        const newRange = document.createRange();
        newRange.setStartAfter(br);
        newRange.setEndAfter(br);
        sel.removeAllRanges();
        sel.addRange(newRange);
        savedRangeRef.current = newRange.cloneRange();
        syncFromDOM();
        return;
      }
    }

    // 3. Пробел после форматированного слова: пробел и следующее слово выходят ИЗ тега форматирования!
    if (e.key === " " && !modKey) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const inlineEl = getInlineAncestor(range.startContainer, activeEl);

        if (inlineEl && isCaretAtEndOfElement(inlineEl, range)) {
          e.preventDefault();
          // Вставляем обычный пробел СНАРУЖИ inlineEl
          const textNode = document.createTextNode(" ");
          if (inlineEl.nextSibling) {
            inlineEl.parentNode?.insertBefore(textNode, inlineEl.nextSibling);
          } else {
            inlineEl.parentNode?.appendChild(textNode);
          }
          // Курсор переносим за пробел
          const newRange = document.createRange();
          newRange.setStart(textNode, 1);
          newRange.setEnd(textNode, 1);
          sel.removeAllRanges();
          sel.addRange(newRange);
          savedRangeRef.current = newRange.cloneRange();
          syncFromDOM();
          return;
        }
      }
    }

    // 4. Стрелка вправо на границе форматированного слова: выходит наружу тега
    if (e.key === "ArrowRight" && !modKey && !e.shiftKey) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const inlineEl = getInlineAncestor(range.startContainer, activeEl);
        if (inlineEl && isCaretAtEndOfElement(inlineEl, range)) {
          if (inlineEl.nextSibling) {
            e.preventDefault();
            const newRange = document.createRange();
            newRange.setStartAfter(inlineEl);
            newRange.setEndAfter(inlineEl);
            sel.removeAllRanges();
            sel.addRange(newRange);
            savedRangeRef.current = newRange.cloneRange();
            return;
          }
        }
      }
    }

    // 5. Горячие клавиши форматирования
    if (modKey) {
      if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        applyBold();
      } else if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        applyItalic();
      } else if (e.key.toLowerCase() === "u") {
        e.preventDefault();
        applyUnderline();
      } else if (e.key.toLowerCase() === "k") {
        e.preventDefault();
        insertLink();
      } else if (e.shiftKey && e.key.toLowerCase() === "x") {
        e.preventDefault();
        applyStrike();
      } else if (e.shiftKey && e.key.toLowerCase() === "m") {
        e.preventDefault();
        applyMonospace();
      } else if (e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        applySpoiler();
      } else if (e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        insertDate();
      } else if (e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        clearFormatting();
      }
    }
  };

  // Вставка текста из буфера обмена (очистка от лишних стилей)
  const handleNativePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    if (text) {
      document.execCommand("insertText", false, text);
      syncFromDOM();
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
    lastSerializedValueRef.current = "";
    if (editorRef.current) {
      editorRef.current.innerHTML = "";
      editorRef.current.style.height = "38px";
    }
    if (fullscreenEditorRef.current) {
      fullscreenEditorRef.current.innerHTML = "";
    }
    setHasContent(false);
    if (isFullscreen) {
      setIsFullscreen(false);
    }
  };

  const insertEmoji = (emoji: string) => {
    const activeEl = getTargetEditor();
    if (activeEl) {
      activeEl.focus();
      document.execCommand("insertText", false, emoji);
      syncFromDOM();
    }
    setShowEmojiPicker(false);
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

      {/* Верхние служебные иконки: ✦Ai слева и Expand справа */}
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

      {/* Основная строка ввода Telegram-стиля (WYSIWYG visual editor) */}
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

        {/* Текстовое поле ввода WYSIWYG */}
        <div className="relative flex-1 min-w-0">
          {!hasContent && (
            <div className="pointer-events-none absolute left-2 top-2 select-none text-[14px] leading-relaxed text-[#888888]">
              {placeholder}
            </div>
          )}
          <div
            ref={editorRef}
            contentEditable={!disabled}
            onInput={syncFromDOM}
            onKeyDown={handleKeyDown}
            onPaste={handleNativePaste}
            onContextMenu={handleContextMenu}
            role="textbox"
            aria-multiline="true"
            className={cn(
              "w-full resize-none border-none bg-transparent px-2 py-2 text-[14px] leading-relaxed text-[#111111] focus:outline-none focus:ring-0 break-words font-sans selection:bg-[#4a38f5]/20",
              "[&_strong]:font-semibold [&_strong]:text-[#111111] [&_b]:font-semibold [&_b]:text-[#111111]",
              "[&_em]:italic [&_i]:italic",
              "[&_u]:underline",
              "[&_s]:line-through [&_s]:text-[#666666] [&_del]:line-through [&_strike]:line-through",
              "[&_code]:rounded [&_code]:bg-[#f0f0f0] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-[#111111]",
              "[&_blockquote]:border-l-2 [&_blockquote]:border-[#2aabee] [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-[#666666] [&_blockquote]:my-1",
              "[&_a]:text-[#2aabee] [&_a]:underline"
            )}
            style={{ minHeight: "38px", maxHeight: "290px", overflowY: "hidden" }}
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
                  onClick={() => insertEmoji(emoji)}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-base hover:bg-[#f5f5f5] cursor-pointer"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Кнопка действия: Микрофон (если пусто) или Самолётик (если введен текст/файл) */}
        <div className="shrink-0">
          {hasContent || attachedFile ? (
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

      {/* КАСТОМНОЕ КОНТЕКСТНОЕ МЕНЮ С ФОРМАТИРОВАНИЕМ */}
      {contextMenuPos && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[210px] rounded-[12px] border border-[#e5e5e5] bg-white py-1.5 shadow-2xl text-[13px] text-[#111111]"
          style={{ top: contextMenuPos.y, left: contextMenuPos.x }}
        >
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleUndo}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Отменить</span>
            <span className="text-[11px] text-[#888888]">⌘Z</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleRedo}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Повторить</span>
            <span className="text-[11px] text-[#888888]">⇧⌘Z</span>
          </button>

          <div className="my-1 border-t border-[#f0f0f0]" />

          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCut}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Вырезать</span>
            <span className="text-[11px] text-[#888888]">⌘X</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleCopy}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Копировать</span>
            <span className="text-[11px] text-[#888888]">⌘C</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void handlePasteAction()}
            className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
          >
            <span>Вставить</span>
            <span className="text-[11px] text-[#888888]">⌘V</span>
          </button>
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
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
              onMouseDown={(e) => e.preventDefault()}
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
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={applyBold}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="font-semibold">Жирный</span>
                  <span className="text-[11px] text-[#888888]">⌘B</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={applyItalic}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="italic">Курсив</span>
                  <span className="text-[11px] text-[#888888]">⌘I</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={applyUnderline}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="underline">Подчёркнутый</span>
                  <span className="text-[11px] text-[#888888]">⌘U</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={applyStrike}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="line-through">Зачёркнутый</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘X</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={applyQuote}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span>Цитата</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘.</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={applyMonospace}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span className="font-mono text-xs">Моноширинный</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘M</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={applySpoiler}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span>Скрытый</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘P</span>
                </button>

                <div className="my-1 border-t border-[#f0f0f0]" />

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={insertLink}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span>Добавить ссылку</span>
                  <span className="text-[11px] text-[#888888]">⌘K</span>
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={insertDate}
                  className="flex w-full items-center justify-between px-3 py-1.5 hover:bg-[#f5f5f5] cursor-pointer"
                >
                  <span>Дата</span>
                  <span className="text-[11px] text-[#888888]">⇧⌘D</span>
                </button>

                <div className="my-1 border-t border-[#f0f0f0]" />

                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
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
            onMouseDown={(e) => e.preventDefault()}
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

          {/* Панель быстрого визуального форматирования в полноэкранном режиме */}
          <div className="flex flex-wrap items-center gap-1 border-b border-[#f0f0f0] pb-2 mb-3 text-xs text-[#666666]">
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyBold}
              className="rounded px-2.5 py-1 font-bold hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Жирный (⌘B)
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyItalic}
              className="rounded px-2.5 py-1 italic hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Курсив (⌘I)
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyUnderline}
              className="rounded px-2.5 py-1 underline hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Подчёркнутый (⌘U)
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyStrike}
              className="rounded px-2.5 py-1 line-through hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Зачёркнутый
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyQuote}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Цитата
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyMonospace}
              className="rounded px-2.5 py-1 font-mono text-xs hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Моноширинный
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applySpoiler}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#111111] cursor-pointer"
            >
              Спойлер
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertLink}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#4a38f5] cursor-pointer"
            >
              Ссылка (⌘K)
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={insertDate}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#666666] cursor-pointer"
            >
              Дата
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clearFormatting}
              className="rounded px-2.5 py-1 hover:bg-[#f5f5f5] text-[#888888] cursor-pointer ml-auto"
            >
              Очистить разметку
            </button>
          </div>

          {/* Визуальная область на весь экран */}
          <div className="flex-1 relative">
            {!hasContent && (
              <div className="pointer-events-none absolute left-4 top-4 select-none text-[14px] leading-relaxed text-[#888888]">
                Введите текст сообщения...
              </div>
            )}
            <div
              ref={fullscreenEditorRef}
              contentEditable={!disabled}
              onInput={syncFromDOM}
              onKeyDown={handleKeyDown}
              onPaste={handleNativePaste}
              onContextMenu={handleContextMenu}
              role="textbox"
              aria-multiline="true"
              className={cn(
                "h-full w-full resize-none rounded-[8px] border border-[#e5e5e5] p-4 text-[14px] leading-relaxed text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-sans overflow-y-auto",
                "[&_strong]:font-semibold [&_strong]:text-[#111111] [&_b]:font-semibold [&_b]:text-[#111111]",
                "[&_em]:italic [&_i]:italic",
                "[&_u]:underline",
                "[&_s]:line-through [&_s]:text-[#666666] [&_del]:line-through [&_strike]:line-through",
                "[&_code]:rounded [&_code]:bg-[#f0f0f0] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-[#111111]",
                "[&_blockquote]:border-l-2 [&_blockquote]:border-[#2aabee] [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-[#666666] [&_blockquote]:my-1",
                "[&_a]:text-[#2aabee] [&_a]:underline"
              )}
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
