'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  detectStoredMediaKind,
  normalizeGiftMediaType,
  parseTelegramClientMd,
  type GiftPromoMediaType,
  type TgMdNode,
} from '@voxly/shared';
import { cn } from '@/lib/utils';
import {
  TG_CHAT_BG,
  TG_CHAT_WALLPAPER,
  TG_INLINE_BTN,
  TG_PREVIEW_FRAME,
  TgPreviewHeader,
} from '@/components/portal/telegram-preview-chrome';

function mediaPlaceholderLabel(mediaType: GiftPromoMediaType): string {
  switch (mediaType) {
    case 'video':
      return 'Видео загружено';
    case 'video_note':
      return 'Кружочек загружен';
    case 'voice':
      return 'Голосовое загружено';
    case 'audio':
      return 'Аудио загружено';
    case 'document':
      return 'Файл загружен';
    default:
      return 'Медиа загружено';
  }
}

function isVisualMediaKind(kind: GiftPromoMediaType): boolean {
  return kind === 'photo' || kind === 'video' || kind === 'video_note';
}

/**
 * Prefer local/HTTPS URL; else fetch authenticated bot media proxy for file_id
 * (img/video cannot send Authorization — same pattern as bot avatar).
 */
function useResolvedMediaSrc(opts: {
  mediaUrl?: string;
  imageUrl?: string;
  botId?: string;
  telegramFileId?: string;
  mediaType: GiftPromoMediaType;
}): string | undefined {
  const local = opts.mediaUrl || opts.imageUrl || undefined;
  const [remoteSrc, setRemoteSrc] = useState<string | undefined>();
  const remoteRef = useRef<string | null>(null);

  useEffect(() => {
    const revokeRemote = () => {
      if (remoteRef.current) {
        URL.revokeObjectURL(remoteRef.current);
        remoteRef.current = null;
      }
    };

    if (local || !isVisualMediaKind(opts.mediaType) || !opts.botId || !opts.telegramFileId) {
      revokeRemote();
      setRemoteSrc(undefined);
      return;
    }

    let cancelled = false;
    revokeRemote();
    setRemoteSrc(undefined);

    void (async () => {
      try {
        const token =
          typeof window !== 'undefined' ? localStorage.getItem('voxly_token') : null;
        if (!token || cancelled) return;
        const url = `/api/bots/${encodeURIComponent(opts.botId!)}/media-file?fileId=${encodeURIComponent(opts.telegramFileId!)}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        const objectUrl = URL.createObjectURL(blob);
        remoteRef.current = objectUrl;
        setRemoteSrc(objectUrl);
      } catch {
        /* keep placeholder */
      }
    })();

    return () => {
      cancelled = true;
      revokeRemote();
    };
  }, [local, opts.botId, opts.telegramFileId, opts.mediaType]);

  return local || remoteSrc;
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 8.5L8.5 3.5" />
      <path d="M5 3.5h3.5V7" />
    </svg>
  );
}

const tgInlineBtnClass =
  'relative flex w-full items-center justify-center rounded-[10px] px-3 py-2.5 text-center text-[14px] font-medium leading-tight text-white shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.12)]';

/** Telegram-like chat preview for portal gift-bot / broadcast blocks. */
export function TelegramPreview({
  text,
  imageUrl,
  mediaUrl,
  mediaType = 'photo',
  mediaPlaceholder = false,
  telegramFileId,
  botId,
  buttonLabel,
  /** Extra URL buttons above the callback button (e.g. «Перейти в канал») */
  linkButtons,
  botName,
  botAvatarUrl,
  className,
}: {
  text: string;
  /** @deprecated use mediaUrl */
  imageUrl?: string;
  mediaUrl?: string;
  mediaType?: GiftPromoMediaType;
  /** Shown when file_id exists but no local/HTTPS/proxy preview URL yet */
  mediaPlaceholder?: boolean;
  /** Telegram file_id — resolved via authenticated `/api/bots/:botId/media-file` when no mediaUrl */
  telegramFileId?: string;
  botId?: string;
  buttonLabel?: string;
  linkButtons?: Array<{ label: string; href?: string }>;
  botName?: string;
  botAvatarUrl?: string | null;
  className?: string;
}) {
  // Prefer Telegram file_id prefix over caller mediaType (gift type=file often hinted as document).
  const kind: GiftPromoMediaType = telegramFileId
    ? detectStoredMediaKind(telegramFileId, normalizeGiftMediaType(mediaType) || mediaType)
    : normalizeGiftMediaType(mediaType) || 'photo';
  const src = useResolvedMediaSrc({
    mediaUrl,
    imageUrl,
    botId,
    telegramFileId,
    mediaType: kind,
  });
  const hasButtons = Boolean(buttonLabel) || (linkButtons && linkButtons.length > 0);

  return (
    <div className={cn(TG_PREVIEW_FRAME, className)}>
      {botName ? <TgPreviewHeader name={botName} avatarUrl={botAvatarUrl} /> : null}

      <div
        className="p-3"
        style={{
          backgroundColor: TG_CHAT_BG,
          backgroundImage: TG_CHAT_WALLPAPER,
          backgroundSize: '160px 160px',
        }}
      >
        <div className="mx-auto max-w-[280px]">
          <div className="overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
            {src ? (
              kind === 'video' || kind === 'video_note' ? (
                <video
                  src={src}
                  className={cn(
                    'w-full bg-black object-contain',
                    kind === 'video_note' ? 'mx-auto max-h-40 max-w-[10rem] rounded-full' : 'max-h-40',
                  )}
                  controls
                  muted
                  playsInline
                  preload="metadata"
                />
              ) : kind === 'photo' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={src} alt="" className="max-h-44 w-full object-cover" />
              ) : (
                <div className="flex h-20 items-center justify-center bg-[#eef2f5] text-[13px] text-[#5a6a7a]">
                  {mediaPlaceholderLabel(kind)}
                </div>
              )
            ) : mediaPlaceholder || Boolean(telegramFileId) ? (
              <div className="flex h-28 items-center justify-center bg-[#eef2f5] text-[13px] text-[#5a6a7a]">
                {mediaPlaceholderLabel(kind)}
              </div>
            ) : null}
            <div className="relative px-2.5 pb-1.5 pt-2">
              <div className="whitespace-pre-wrap pb-3.5 text-[14.5px] leading-[1.35] text-[#0f0f0f]">
                {renderTelegramText(text)}
              </div>
              <p className="absolute bottom-1.5 right-2.5 text-[11px] tabular-nums leading-none text-[#a0a0a0]">
                {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>

          {hasButtons ? (
            <div className="mt-1.5 flex flex-col gap-[3px]">
              {(linkButtons || []).map((b) => (
                <a
                  key={b.label}
                  href={b.href || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(tgInlineBtnClass, TG_INLINE_BTN)}
                  onClick={(e) => {
                    if (!b.href) e.preventDefault();
                  }}
                >
                  <span className="px-3">{b.label}</span>
                  <ExternalLinkIcon className="pointer-events-none absolute right-2 top-1.5 h-3 w-3 text-white/90" />
                </a>
              ))}
              {buttonLabel ? (
                <button type="button" className={cn(tgInlineBtnClass, TG_INLINE_BTN)}>
                  {buttonLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
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
      case 'link':
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#2481cc] underline underline-offset-2"
          >
            {renderNodes(node.children)}
          </a>
        );
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
