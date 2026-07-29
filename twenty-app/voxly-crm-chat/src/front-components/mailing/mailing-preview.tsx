import { useState, type CSSProperties, type ReactNode } from 'react';

import { parseTelegramClientMd, type TgMdNode } from './mailing-md';

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
      style={{
        borderRadius: 3,
        padding: '0 2px',
        cursor: open ? 'default' : 'pointer',
        background: open ? '#e8e8e8' : '#242424',
        color: open ? 'inherit' : 'transparent',
        userSelect: open ? 'auto' : 'none',
      }}
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
        return <s key={i}>{renderNodes(node.children)}</s>;
      case 'spoiler':
        return <Spoiler key={i}>{renderNodes(node.children)}</Spoiler>;
      case 'code':
        return (
          <code
            key={i}
            style={{
              borderRadius: 4,
              background: '#f0f0f0',
              padding: '1px 4px',
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 13,
              color: '#c2255c',
            }}
          >
            {node.value}
          </code>
        );
      case 'pre':
        return (
          <pre
            key={i}
            style={{
              margin: '4px 0',
              overflowX: 'auto',
              borderRadius: 6,
              background: '#f4f4f5',
              padding: 8,
              fontFamily: 'ui-monospace, Menlo, monospace',
              fontSize: 12,
              color: '#111',
            }}
          >
            {node.value}
          </pre>
        );
      default:
        return null;
    }
  });
}

function renderTelegramText(input: string) {
  if (!input) {
    return <span style={{ color: '#8a8a8a' }}>Текст сообщения…</span>;
  }
  return <>{renderNodes(parseTelegramClientMd(input))}</>;
}

/** Telegram-like bubble preview (portal BroadcastsPage ethalon). */
export function MailingPreview({
  text,
  mediaUrl,
  mediaType = 'photo',
  mediaPlaceholder = false,
  botName,
  style,
}: {
  text: string;
  mediaUrl?: string | null;
  mediaType?: 'photo' | 'video' | string | null;
  mediaPlaceholder?: boolean;
  botName?: string;
  style?: CSSProperties;
}) {
  const src = (mediaUrl || '').trim();
  const isVideo = mediaType === 'video';

  return (
    <div
      style={{
        borderRadius: 12,
        border: '1px solid #dfe5ec',
        background:
          'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.12) 0, transparent 40%), #8ca8c3',
        padding: 12,
        ...style,
      }}
    >
      <div style={{ margin: '0 auto', maxWidth: 280 }}>
        {botName ? (
          <p
            style={{
              margin: '0 0 6px',
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 500,
              color: 'rgba(255,255,255,0.9)',
            }}
          >
            {botName}
          </p>
        ) : null}
        <div
          style={{
            overflow: 'hidden',
            borderRadius: 16,
            borderBottomLeftRadius: 6,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
          }}
        >
          {src ? (
            isVideo ? (
              <video
                src={src}
                style={{
                  maxHeight: 160,
                  width: '100%',
                  background: '#000',
                  objectFit: 'contain',
                  display: 'block',
                }}
                controls
                muted
                playsInline
                preload="metadata"
              />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element -- remote preview URL
              <img
                src={src}
                alt=""
                style={{
                  maxHeight: 160,
                  width: '100%',
                  objectFit: 'cover',
                  display: 'block',
                }}
              />
            )
          ) : mediaPlaceholder ? (
            <div
              style={{
                height: 112,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#eef2f5',
                fontSize: 13,
                color: '#5a6a7a',
              }}
            >
              {isVideo ? 'Видео загружено' : 'Медиа загружено'}
            </div>
          ) : null}
          <div style={{ padding: '10px 12px', display: 'grid', gap: 8 }}>
            <div
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 14,
                lineHeight: 1.35,
                color: '#0f0f0f',
              }}
            >
              {renderTelegramText(text)}
            </div>
            <p
              style={{
                margin: 0,
                textAlign: 'right',
                fontSize: 11,
                color: '#8a8a8a',
              }}
            >
              {new Date().toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
