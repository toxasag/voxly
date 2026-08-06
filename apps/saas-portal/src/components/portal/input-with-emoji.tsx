'use client';

import { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { EmojiPickerButton } from '@/components/portal/emoji-picker';
import { cn } from '@/lib/utils';

/** Single-line input with emoji picker (name, short description, button labels). */
export function InputWithEmoji({
  value,
  onChange,
  maxLength,
  placeholder,
  disabled,
  className,
  showEmoji = true,
  onFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  maxLength?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  showEmoji?: boolean;
  onFocus?: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const insert = (emoji: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    let next = value.slice(0, start) + emoji + value.slice(end);
    if (maxLength != null && next.length > maxLength) {
      next = next.slice(0, maxLength);
    }
    onChange(next);
    const caret = Math.min(start + emoji.length, next.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className={cn('relative mt-1.5', className)}>
      <Input
        ref={ref}
        className={showEmoji ? 'pr-12' : undefined}
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onFocus={onFocus}
      />
      {showEmoji ? (
        <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
          <EmojiPickerButton disabled={disabled} onPick={insert} />
        </div>
      ) : null}
    </div>
  );
}
