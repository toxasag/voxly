'use client';

import { useState, type ReactNode } from 'react';
import { parseTelegramClientMd, type TgMdNode } from '@voxly/shared';
import { cn } from '@/lib/utils';

/** Minimal Telegram-like bubble for portal previews (light theme). */
export function TelegramPreview({
  text,
  imageUrl,
  mediaUrl,
  mediaType = 'photo',
  mediaPlaceholder = false,
  buttonLabel,
  botName,
  className,
}: {
  text: string;
  /** @deprecated use mediaUrl */
  imageUrl?: string;
  mediaUrl?: string;
  mediaType?: 'photo' | 'video';
  /** Shown when file_id exists but no local/HTTPS preview URL */
  mediaPlaceholder?: boolean;
  buttonLabel?: string;
  botName?: string;
  className?: string;
}) {
  const src = mediaUrl || imageUrl;

  return (
    <div
      className={cn(
        'rounded-xl border border-[#dfe5ec] bg-[#8ca8c3]/[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.12)_0,transparent_40%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.1)_0,transparent_35%)] p-3',
        className,
      )}
    >
      <div className="mx-auto max-w-[280px]">
        {botName && (
          <p className="mb-1.5 text-center text-[11px] font-medium text-white/90">{botName}</p>
        )}
        <div className="overflow-hidden rounded-2xl rounded-bl-md bg-white shadow-sm">
          {src ? (
            mediaType === 'video' ? (
              <video
                src={src}
                className="max-h-40 w-full bg-black object-contain"
                controls
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={src} alt="" className="max-h-40 w-full object-cover" />
            )
          ) : mediaPlaceholder ? (
            <div className="flex h-28 items-center justify-center bg-[#eef2f5] text-[13px] text-[#5a6a7a]">
              {mediaType === 'video' ? 'Видео загружено' : 'Медиа загружено'}
            </div>
          ) : null}
          <div className="space-y-2 px-3 py-2.5">
            <div className="whitespace-pre-wrap text-[14px] leading-[1.35] text-[#0f0f0f]">
              {renderTelegramText(text)}
            </div>
            <p className="text-right text-[11px] text-[#8a8a8a]">
              {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </p>
          </div>
        </div>
        {buttonLabel ? (
          <button
            type="button"
            className="mt-1.5 w-full rounded-xl border border-[#d0d7de] bg-[#f1f3f5] px-3 py-2.5 text-center text-[14px] font-medium text-[#2481cc]"
          >
            {buttonLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Spoiler({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setOpen(true);
        }
      }}
      className={cn(
        'rounded-sm px-0.5 transition',
        open
          ? 'bg-[#e8e8e8]'
          : 'cursor-pointer select-none bg-[#242424] text-transparent hover:bg-[#3a3a3a]',
      )}
      title={open ? undefined : 'Нажмите, чтобы показать'}
    >
      {children}
    </span>
  );
}

function renderNodes(nodes: TgMdNode[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <span key={i}>{node.value}</span>;
      case 'bold':
        return <strong key={i}>{renderNodes(node.children)}</strong>;
      case 'italic':
        return <em key={i}>{renderNodes(node.children)}</em>;
      case 'strike':
        return (
          <s key={i} className="text-[#666]">
            {renderNodes(node.children)}
          </s>
        );
      case 'spoiler':
        return <Spoiler key={i}>{renderNodes(node.children)}</Spoiler>;
      case 'code':
        return (
          <code
            key={i}
            className="rounded bg-[#f0f0f0] px-1 py-0.5 font-mono text-[13px] text-[#c2255c]"
          >
            {node.value}
          </code>
        );
      case 'pre':
        return (
          <pre
            key={i}
            className="my-1 overflow-x-auto rounded-md bg-[#f4f4f5] p-2 font-mono text-[12px] leading-snug text-[#111]"
          >
            {node.value}
          </pre>
        );
      default:
        return null;
    }
  });
}

/** Telegram client Markdown: **bold**, __italic__, ~~strike~~, ||spoiler||, `code`, ```blocks``` */
function renderTelegramText(input: string) {
  if (!input) {
    return <span className="text-[#8a8a8a]">Текст сообщения…</span>;
  }
  return <>{renderNodes(parseTelegramClientMd(input))}</>;
}
