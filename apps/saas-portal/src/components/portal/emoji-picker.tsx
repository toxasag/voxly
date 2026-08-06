'use client';

import { useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Broad Unicode set (incl. newer “premium-looking” glyphs). TG custom Premium packs ≠ Unicode — paste from Telegram also works. */
const EMOJI_GROUPS: { label: string; emojis: string }[] = [
  {
    label: 'Частые',
    emojis:
      '😀😁😂🤣😊😍🥰😘🤗🤔🫡😎🤩🥳😭😤😡🥺😅😌✨🔥❤️💛💚💙💜🖤🤍💕💯🎉🎊🎁🚀✅❌⭐🌟💫⚡🎯💡📌❤️‍🔥❤️‍🩹🧡',
  },
  {
    label: 'Жесты',
    emojis:
      '👍👎👏🙌🤝🙏💪✌️🤞🫰👋🖐️✋🤚👊✊🤛🤜🫶🤲👐🫵👆👇👈👉💅✍️',
  },
  {
    label: 'Люди',
    emojis:
      '👶👧🧒👦👩👨🧑👵👴👱‍♀️👱👱‍♂️🧑‍⚕️👮‍♀️👮👷🕵️🎅🤶🦸🦹🧙🧝🧛🧟🧔🧔‍♀️🧔‍♂️',
  },
  {
    label: 'Сердца',
    emojis: '❤️🧡💛💚💙💜🖤🤍🤎💔❣️💕💞💓💗💖💘💝💟🫶💍💋',
  },
  {
    label: 'Природа',
    emojis:
      '🌸🌺🌻🌹🌷🌼💐🍀🌿🌱🌳🌴🌵🎄🔥❄️☀️🌙⭐🌈☁️⛈️🌊🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🦄🐝',
  },
  {
    label: 'Еда',
    emojis:
      '🍎🍊🍋🍌🍉🍇🍓🫐🍑🍒🥝🍅🥑🥕🌽🍞🧀🍕🍔🍟🌮🍣🍙🍪🎂🍰☕🍵🧋🍺🍷🥂🍾',
  },
  {
    label: 'Предметы',
    emojis:
      '📱💻⌨️🖥️📷📹🎥📞📺💡🔋🔌💰💳💎🔑🗝️📦📫✉️📨📩📝📁📂📎🔗🔔🔕🔒🔓',
  },
  {
    label: 'Символы',
    emojis:
      '✅❌⚠️❗❓💬💭🗯️🔊🔇🎵🎶♻️🔃➕➖➗✖️♾️💲💹📈📉🔴🟠🟡🟢🔵🟣⚫⚪🟤',
  },
];

function splitEmojis(s: string): string[] {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(s)].map(
    (x) => x.segment,
  );
}

export function EmojiPickerButton({
  onPick,
  disabled,
  className,
  placement = 'top',
  panelClassName,
}: {
  onPick: (emoji: string) => void;
  disabled?: boolean;
  className?: string;
  /** Where the panel opens relative to the trigger. Prefer `bottom` when above a preview. */
  placement?: 'top' | 'bottom';
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn('relative inline-flex', className)}>
      <button
        type="button"
        disabled={disabled}
        title="Эмодзи"
        aria-label="Вставить эмодзи"
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-black/10 bg-white text-black/70 transition-colors hover:bg-black/[0.04] disabled:opacity-50"
        onClick={() => setOpen((v) => !v)}
      >
        <SmilePlus className="h-4 w-4" />
      </button>
      {open ? (
        <div
          className={cn(
            'absolute left-0 z-50 w-[300px] overflow-hidden rounded-xl border border-black/10 bg-white shadow-lg',
            placement === 'bottom' ? 'top-full mt-2' : 'bottom-full mb-2',
            panelClassName,
          )}
        >
          <div className="flex gap-1 overflow-x-auto border-b border-black/8 px-2 py-1.5">
            {EMOJI_GROUPS.map((g, i) => (
              <button
                key={g.label}
                type="button"
                className={cn(
                  'shrink-0 rounded-md px-2 py-1 text-[11px] font-medium',
                  tab === i ? 'bg-black/8 text-black' : 'text-black/50 hover:bg-black/[0.04]',
                )}
                onClick={() => setTab(i)}
              >
                {g.label}
              </button>
            ))}
          </div>
          <div className="grid max-h-48 grid-cols-8 gap-0.5 overflow-y-auto p-2">
            {splitEmojis(EMOJI_GROUPS[tab]?.emojis || '').map((em, i) => (
              <button
                key={`${tab}-${i}-${em}`}
                type="button"
                className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-black/[0.06]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(em);
                  setOpen(false);
                }}
              >
                {em}
              </button>
            ))}
          </div>
          <p className="border-t border-black/8 px-2 py-1.5 text-[10px] leading-snug text-black/45">
            Любые Unicode-эмодзи, в том числе новые. Кастомные из Premium-наборов Telegram — вставьте
            копированием из Telegram.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** Inline panel (no floating popover) — use under a preview so it never covers it. */
export function EmojiPickerPanel({
  onPick,
  className,
}: {
  onPick: (emoji: string) => void;
  className?: string;
}) {
  const [tab, setTab] = useState(0);

  return (
    <div
      className={cn(
        'w-full overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm',
        className,
      )}
    >
      <div className="flex gap-1 overflow-x-auto border-b border-black/8 px-2 py-1.5">
        {EMOJI_GROUPS.map((g, i) => (
          <button
            key={g.label}
            type="button"
            className={cn(
              'shrink-0 rounded-md px-2 py-1 text-[11px] font-medium',
              tab === i ? 'bg-black/8 text-black' : 'text-black/50 hover:bg-black/[0.04]',
            )}
            onClick={() => setTab(i)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div className="grid max-h-40 grid-cols-8 gap-0.5 overflow-y-auto p-2">
        {splitEmojis(EMOJI_GROUPS[tab]?.emojis || '').map((em, i) => (
          <button
            key={`${tab}-${i}-${em}`}
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md text-lg hover:bg-black/[0.06]"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(em)}
          >
            {em}
          </button>
        ))}
      </div>
    </div>
  );
}
