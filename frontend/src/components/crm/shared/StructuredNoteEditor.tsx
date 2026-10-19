"use client";

import { useRef, useEffect } from "react";
import {
  CheckSquare,
  Code,
  Heading2,
  List,
  Loader2,
  Quote,
} from "lucide-react";

export interface StructuredNoteEditorProps {
  title: string;
  body: string;
  onTitleChange: (val: string) => void;
  onBodyChange: (val: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving?: boolean;
  saveLabel?: string;
  autoFocus?: boolean;
}

export function StructuredNoteEditor({
  title,
  body,
  onTitleChange,
  onBodyChange,
  onSave,
  onCancel,
  isSaving = false,
  saveLabel = "Сохранить",
  autoFocus = true,
}: StructuredNoteEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  const insertSnippet = (prefix: string, suffix = "") => {
    const el = textareaRef.current;
    if (!el) {
      onBodyChange(body ? `${body}\n${prefix}${suffix}` : `${prefix}${suffix}`);
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = body.slice(start, end);

    const isNewLinePrefix = prefix.startsWith("\n") || prefix.startsWith("- ") || prefix.startsWith("## ") || prefix.startsWith("> ");
    const needsPrefixNewline = isNewLinePrefix && start > 0 && body[start - 1] !== "\n";
    const actualPrefix = needsPrefixNewline ? `\n${prefix}` : prefix;

    const replacement = `${actualPrefix}${selected}${suffix}`;
    const nextBody = body.slice(0, start) + replacement + body.slice(end);
    onBodyChange(nextBody);

    setTimeout(() => {
      if (el) {
        el.focus();
        const cursor = start + actualPrefix.length + selected.length;
        el.setSelectionRange(cursor, cursor);
      }
    }, 0);
  };

  return (
    <div className="space-y-2 rounded-[16px] border border-[#e5e5e5] bg-white p-3 shadow-2xs">
      <input
        value={title}
        onChange={(e) => onTitleChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Заголовок (необязательно)"
        className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm font-medium text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
      />

      <textarea
        ref={textareaRef}
        value={body}
        rows={4}
        onChange={(e) => onBodyChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSave();
          }
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Текст заметки... (поддерживаются списки, чекбоксы, заголовки)"
        className="w-full resize-y rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm leading-relaxed text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none font-sans"
      />

      {/* Editor formatting toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#f0f0f0] pt-2">
        <div className="flex flex-wrap items-center gap-1 text-[#666666]">
          <button
            type="button"
            onClick={() => insertSnippet("- [ ] ")}
            title="Добавить чек-лист"
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-xs text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
          >
            <CheckSquare className="h-3.5 w-3.5" />
            <span>Чек-лист</span>
          </button>

          <button
            type="button"
            onClick={() => insertSnippet("- ")}
            title="Добавить маркированный список"
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-xs text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
          >
            <List className="h-3.5 w-3.5" />
            <span>Список</span>
          </button>

          <button
            type="button"
            onClick={() => insertSnippet("## ")}
            title="Заголовок"
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-xs text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
          >
            <Heading2 className="h-3.5 w-3.5" />
            <span>Заголовок</span>
          </button>

          <button
            type="button"
            onClick={() => insertSnippet("> ")}
            title="Цитата"
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-xs text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
          >
            <Quote className="h-3.5 w-3.5" />
            <span>Цитата</span>
          </button>

          <button
            type="button"
            onClick={() => insertSnippet("**", "**")}
            title="Жирный шрифт"
            className="rounded-[4px] px-2 py-1 text-xs font-bold text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
          >
            B
          </button>

          <button
            type="button"
            onClick={() => insertSnippet("`", "`")}
            title="Код"
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-xs text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors font-mono"
          >
            <Code className="h-3.5 w-3.5" />
            <span>Код</span>
          </button>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[6px] px-2.5 py-1 text-xs text-[#666666] hover:text-[#111111] transition-colors"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || body.trim() === ""}
            className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0] disabled:opacity-50 shadow-2xs"
          >
            {isSaving && <Loader2 className="h-3 w-3 animate-spin" />}
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
