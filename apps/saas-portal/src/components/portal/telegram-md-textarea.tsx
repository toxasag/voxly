'use client';

import { useEffect, useRef, useState } from 'react';
import { wrapSelection } from '@voxly/shared';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { EmojiPickerButton } from '@/components/portal/emoji-picker';

type FormatItem =
  | { label: string; before: string; after: string; kind?: undefined }
  | { label: string; kind: 'link' };

const FORMAT_ITEMS: FormatItem[] = [
  { label: 'Жирный', before: '**', after: '**' },
  { label: 'Курсив', before: '__', after: '__' },
  { label: 'Зачёркнутый', before: '~~', after: '~~' },
  { label: 'Спойлер', before: '||', after: '||' },
  { label: 'Код', before: '`', after: '`' },
  { label: 'Блок кода', before: '```\n', after: '\n```' },
  { label: 'Ссылка', kind: 'link' },
];

export function TelegramMdTextarea({
  value,
  onChange,
  rows = 5,
  className,
  placeholder,
  disabled,
  showEmoji = true,
  onFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  rows?: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  showEmoji?: boolean;
  onFocus?: () => void;
}) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selRef = useRef({ start: 0, end: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const syncSelection = (el: HTMLTextAreaElement) => {
    selRef.current = {
      start: el.selectionStart ?? 0,
      end: el.selectionEnd ?? 0,
    };
  };

  const insertAtCursor = (text: string) => {
    const el = areaRef.current;
    if (el) syncSelection(el);
    let { start, end } = selRef.current;
    const len = value.length;
    start = Math.max(0, Math.min(start, len));
    end = Math.max(0, Math.min(end, len));
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    const next = value.slice(0, start) + text + value.slice(end);
    const caret = start + text.length;
    onChange(next);
    selRef.current = { start: caret, end: caret };
    requestAnimationFrame(() => {
      const ta = areaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(caret, caret);
    });
  };

  const applyFormat = (before: string, after: string) => {
    const el = areaRef.current;
    if (el) syncSelection(el);
    let { start, end } = selRef.current;
    const len = value.length;
    start = Math.max(0, Math.min(start, len));
    end = Math.max(0, Math.min(end, len));
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    if (start === end) {
      const beforeCursor = value.slice(0, end || len);
      const lineStart = beforeCursor.lastIndexOf('\n') + 1;
      const line = beforeCursor.slice(lineStart);
      const match = /(\S+)$/u.exec(line);
      if (match && match.index != null) {
        start = lineStart + match.index;
        end = lineStart + match.index + match[1].length;
      }
    }
    const next = wrapSelection(value, start, end, before, after);
    onChange(next.text);
    selRef.current = { start: next.nextStart, end: next.nextEnd };
    requestAnimationFrame(() => {
      const ta = areaRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(next.nextStart, next.nextEnd);
    });
  };

  const applyLink = () => {
    const el = areaRef.current;
    if (el) syncSelection(el);
    let { start, end } = selRef.current;
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    const selected = value.slice(start, end) || 'ссылка';
    const url = window.prompt('URL ссылки (https://…)', 'https://');
    if (!url || !url.trim()) return;
    const before = '[';
    const after = `](${url.trim()})`;
    if (start === end) {
      const inserted = value.slice(0, start) + before + selected + after + value.slice(end);
      onChange(inserted);
      const nextStart = start + before.length;
      const nextEnd = nextStart + selected.length;
      selRef.current = { start: nextStart, end: nextEnd };
      requestAnimationFrame(() => {
        areaRef.current?.focus();
        areaRef.current?.setSelectionRange(nextStart, nextEnd);
      });
      return;
    }
    applyFormat(before, after);
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <div className="relative">
      <Textarea
        ref={areaRef}
        className={cn('mt-1.5', showEmoji && 'pr-12', className)}
        rows={rows}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          syncSelection(e.target);
          onChange(e.target.value);
        }}
        onFocus={(e) => {
          syncSelection(e.currentTarget);
          onFocus?.();
        }}
        onSelect={(e) => syncSelection(e.currentTarget)}
        onKeyUp={(e) => syncSelection(e.currentTarget)}
        onClick={(e) => syncSelection(e.currentTarget)}
        onContextMenu={(e) => {
          e.preventDefault();
          syncSelection(e.currentTarget);
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      />
      {showEmoji ? (
        <div className="absolute right-2 top-3.5">
          <EmojiPickerButton disabled={disabled} onPick={insertAtCursor} />
        </div>
      ) : null}
      {menu ? (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] rounded-lg border border-black/10 bg-white p-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {FORMAT_ITEMS.map((item) => (
            <button
              key={item.label}
              type="button"
              className="block w-full rounded-md px-3 py-1.5 text-left text-sm text-black hover:bg-black/[0.04]"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (item.kind === 'link') applyLink();
                else applyFormat(item.before, item.after);
                setMenu(null);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
