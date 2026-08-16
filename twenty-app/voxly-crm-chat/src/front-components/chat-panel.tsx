import { defineFrontComponent } from 'twenty-sdk/define';
import {
  enqueueSnackbar,
  getApplicationVariable,
  useColorScheme,
  useRecordId,
} from 'twenty-sdk/front-component';
import { RestApiClient } from 'twenty-client-sdk/rest';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { CHAT_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

type ChatAttachment = {
  type: string;
  fileId: string;
  fileName?: string;
  mimeType?: string;
};

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  attachments?: ChatAttachment[];
  sentAt: string;
  senderLabel?: string | null;
};

type ChatPresence = {
  online?: boolean;
  lastSeenAt?: string | null;
  approx?: 'recently' | 'last_week' | 'last_month' | null;
};

type ChatPayload = {
  messages?: ChatMessage[];
  username?: string | null;
  firstName?: string | null;
  error?: string;
  /** Soft empty-state (no linked Telegram lead yet) — not a hard failure. */
  info?: string;
  channel?: string | null;
  channelLabel?: string | null;
  identityLabel?: string | null;
  peerLabel?: string | null;
  contactName?: string | null;
  botAgentLabel?: string | null;
  operatorName?: string | null;
  botType?: string | null;
  botId?: string | null;
  supportsAttachments?: boolean;
  mode?: string | null;
  aiDisabled?: boolean;
  suppressDealCreation?: boolean;
  pausedUntil?: string | null;
  aiControls?: boolean;
  conversationId?: string | null;
  subscriberId?: string | null;
  threads?: ChatThread[];
  sendFromOptions?: SendFromOption[];
  presence?: ChatPresence | null;
};

type ChatThread = {
  id: string;
  source: string;
  conversationId?: string | null;
  giftSubscriberId?: string | null;
  botId?: string;
  botType?: string | null;
  channelLabel: string;
  identityLabel: string;
  peerLabel: string;
};

type SendFromOption = {
  botId: string;
  botType: string;
  label: string;
  channelLabel: string;
  identityLabel: string;
  available: boolean;
  unavailableReason?: string;
  conversationId?: string | null;
  giftSubscriberId?: string | null;
  threadId?: string | null;
  isDefault?: boolean;
};

type FilePayload = {
  /** Preferred: signed saas-api URL (video/audio/photo; bypasses Twenty /s size cap). */
  url?: string;
  dataBase64?: string;
  contentType?: string;
  error?: string;
};

/** Encoded on host (patched FrontComponentRenderer) — Remote DOM File stubs are not Blobs (INC-017). */
type PendingAttachment = {
  name: string;
  type: string;
  size: number;
  lastModified: number;
  dataBase64: string;
};

/** Gift-bot / reply placeholders for media-only messages — hide when attachments render. */
function isMediaPlaceholder(content: string): boolean {
  const t = (content || '').trim();
  if (!t) return true;
  // Include legacy GramJS `[media]` so history backfills never leave bare text
  // when attachment previews are present.
  return /^\[(media|фото|видео|кружочек|стикер|голосовое|аудио|файл(?::[^\]]*)?|документ)\]$/i.test(
    t,
  );
}

function attachmentLabel(a: ChatAttachment): string {
  if (a.fileName === 'video_note.mp4' || /video_note/i.test(a.fileName || '')) {
    return 'Кружочек';
  }
  if (a.fileName) return a.fileName;
  if (a.type === 'video' || a.type === 'animation') return 'Видео';
  if (a.type === 'voice') return 'Голосовое';
  if (a.type === 'audio') return 'Аудио';
  if (a.type === 'photo') return 'Фото';
  if (a.type === 'sticker') return 'Стикер';
  return a.type || 'Файл';
}

function isImageType(
  type: string,
  contentType?: string,
  fileName?: string,
): boolean {
  if (type === 'photo' || type === 'sticker') return true;
  // GramJS / WA often store photos as document + image/* or octet-stream + .jpg.
  if (fileName && /\.(jpe?g|png|gif|webp)$/i.test(fileName)) return true;
  return !!contentType && contentType.startsWith('image/');
}

function isVideoType(type: string, contentType?: string, fileName?: string): boolean {
  if (type === 'video' || type === 'animation') return true;
  if (fileName && /video_note|\.(mp4|webm|mov)$/i.test(fileName)) return true;
  // Mis-tagged video notes (GramJS) still need <video>, not <audio>
  if (type === 'audio' && contentType?.startsWith('video/')) return true;
  return !!contentType && contentType.startsWith('video/');
}

function isAudioType(type: string, contentType?: string): boolean {
  if (contentType?.startsWith('video/')) return false;
  if (type === 'voice' || type === 'audio') return true;
  return !!contentType && contentType.startsWith('audio/');
}

function isVideoNoteAttachment(a: ChatAttachment): boolean {
  return (
    a.fileName === 'video_note.mp4' ||
    /video_note/i.test(a.fileName || '') ||
    /video_note/i.test(a.mimeType || '') ||
    // GramJS sometimes stored video_note as audio+video/mp4 without fileName
    (a.mimeType === 'video/mp4' && a.type === 'audio')
  );
}

function ChatAttachmentView({
  recordId,
  attachment,
  muted,
  ink,
}: {
  recordId: string;
  attachment: ChatAttachment;
  muted: string;
  ink: string;
}) {
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string>('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setMediaUrl(null);
    setContentType('');
    setFailed(false);
    if (!attachment.fileId) {
      setFailed(true);
      return;
    }
    const preferSignedUrl =
      isImageType(attachment.type, attachment.mimeType, attachment.fileName) ||
      isVideoType(attachment.type, attachment.mimeType, attachment.fileName) ||
      isVideoNoteAttachment(attachment) ||
      isAudioType(attachment.type, attachment.mimeType) ||
      // PDF/DOCX exceed Twenty /s ~96KB base64 cap — use signed URL like video/audio.
      // Photos also prefer signed URL so multi-channel Persons bypass /file bot mismatch
      // and Twenty JSON size cliff (INC-115).
      attachment.type === 'document';
    void (async () => {
      try {
        if (preferSignedUrl) {
          const data = await api.get<FilePayload>(
            `/s/crm-chat/${recordId}/file-url/${encodeURIComponent(attachment.fileId)}`,
          );
          if (cancelled) return;
          if (data.error || !data.url) {
            setFailed(true);
            return;
          }
          setContentType(
            data.contentType ||
              attachment.mimeType ||
              (isVideoType(attachment.type, undefined, attachment.fileName)
                ? 'video/mp4'
                : isAudioType(attachment.type)
                  ? 'audio/ogg'
                  : ''),
          );
          setMediaUrl(data.url);
          return;
        }
        const data = await api.get<FilePayload>(
          `/s/crm-chat/${recordId}/file/${encodeURIComponent(attachment.fileId)}`,
        );
        if (cancelled) return;
        if (data.error) {
          setFailed(true);
          return;
        }
        if (data.url) {
          setContentType(data.contentType || attachment.mimeType || '');
          setMediaUrl(data.url);
          return;
        }
        if (data.dataBase64) {
          const ct =
            data.contentType || attachment.mimeType || 'application/octet-stream';
          setContentType(ct);
          setMediaUrl(`data:${ct};base64,${data.dataBase64}`);
          return;
        }
        setFailed(true);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    recordId,
    attachment.fileId,
    attachment.type,
    attachment.mimeType,
    attachment.fileName,
  ]);

  const label = attachmentLabel(attachment);
  const videoNote = isVideoNoteAttachment(attachment);
  const effectiveType =
    contentType || attachment.mimeType || '';

  if (failed) {
    return (
      <div style={{ marginTop: 6, fontSize: 12, color: muted }}>
        📎 {label}
        {mediaUrl ? (
          <>
            {' · '}
            <a
              href={mediaUrl}
              download={attachment.fileName || label}
              target="_blank"
              rel="noreferrer"
              style={{ color: ink, textDecoration: 'underline' }}
            >
              скачать
            </a>
          </>
        ) : null}
      </div>
    );
  }
  if (!mediaUrl) {
    return (
      <div style={{ marginTop: 6, fontSize: 12, color: muted }}>Загрузка…</div>
    );
  }
  if (isImageType(attachment.type, effectiveType, attachment.fileName)) {
    return (
      <img
        src={mediaUrl}
        alt={label}
        onError={() => setFailed(true)}
        style={{
          display: 'block',
          maxWidth: '100%',
          borderRadius: 8,
          marginTop: 6,
        }}
      />
    );
  }
  if (isVideoType(attachment.type, effectiveType, attachment.fileName) || videoNote) {
    const videoType =
      contentType && contentType.startsWith('video/')
        ? contentType
        : 'video/mp4';
    return (
      <div style={{ marginTop: 6 }}>
        <video
          key={mediaUrl}
          src={mediaUrl}
          controls
          playsInline
          preload="metadata"
          onError={() => setFailed(true)}
          style={{
            display: 'block',
            maxWidth: videoNote ? 220 : '100%',
            width: videoNote ? 220 : undefined,
            height: videoNote ? 220 : undefined,
            objectFit: videoNote ? 'cover' : undefined,
            borderRadius: videoNote ? '50%' : 8,
            background: '#111',
          }}
        >
          <source src={mediaUrl} type={videoType} />
        </video>
        <a
          href={mediaUrl}
          download={attachment.fileName || label}
          target="_blank"
          rel="noreferrer"
          style={{
            display: 'inline-block',
            marginTop: 4,
            fontSize: 11,
            color: muted,
            textDecoration: 'underline',
          }}
        >
          Скачать {label}
        </a>
      </div>
    );
  }
  if (isAudioType(attachment.type, contentType)) {
    const audioType =
      contentType && contentType.startsWith('audio/')
        ? contentType
        : 'audio/ogg';
    return (
      <div style={{ marginTop: 6 }}>
        <audio
          controls
          preload="metadata"
          onError={() => setFailed(true)}
          style={{ display: 'block', width: '100%' }}
        >
          <source src={mediaUrl} type={audioType} />
        </audio>
      </div>
    );
  }
  return (
    <a
      href={mediaUrl}
      download={attachment.fileName || label}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-block',
        marginTop: 6,
        fontSize: 12,
        color: ink,
        textDecoration: 'underline',
      }}
    >
      📎 {label}
    </a>
  );
}

/**
 * Worker fetch requires absolute URLs (relative → "Failed to parse URL").
 * hostFetch allowlists TWENTY_API_URL / TWENTY_FUNCTIONS_URL origins.
 * Prefer WORKSPACE_ORIGIN (custom CRM host). Rewrite bare localhost and the
 * SERVER_URL host (app.getvoxly.ru) → workspace origin for /s/* (INC-011/029).
 */
function resolveWorkspaceOrigin(): string | null {
  const fromVar = (getApplicationVariable('WORKSPACE_ORIGIN') || '')
    .trim()
    .replace(/\/+$/, '');
  if (fromVar) return fromVar;

  try {
    if (typeof location !== 'undefined' && location?.origin) {
      return location.origin.replace(/\/+$/, '');
    }
  } catch {
    // Worker / sandbox may lack location
  }

  const functionsUrl = (process.env.TWENTY_FUNCTIONS_URL || '').trim();
  if (functionsUrl) {
    try {
      const u = new URL(functionsUrl);
      if (u.hostname.includes('.localhost') || (u.hostname !== 'localhost' && u.hostname !== '127.0.0.1')) {
        return u.origin;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

function serverUrlOrigin(): string | null {
  for (const raw of [
    process.env.TWENTY_API_URL,
    process.env.TWENTY_FUNCTIONS_URL,
    process.env.REACT_APP_SERVER_BASE_URL,
  ]) {
    const v = (raw || '').trim();
    if (!v) continue;
    try {
      return new URL(v).origin;
    } catch {
      // ignore
    }
  }
  return null;
}

function workspaceAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const impl = globalThis.fetch.bind(globalThis);
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  let absolute = href;
  try {
    if (href.startsWith('/')) {
      const origin =
        resolveWorkspaceOrigin() ||
        (process.env.TWENTY_API_URL || 'http://localhost:3007').replace(/\/+$/, '');
      absolute = `${origin}${href}`;
    }

    const url = new URL(absolute);
    const workspaceOrigin = resolveWorkspaceOrigin();
    if (workspaceOrigin) {
      const ws = new URL(workspaceOrigin);
      const serverOrigin = serverUrlOrigin();
      const isLocalHost =
        url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      const isServerUrlHost =
        Boolean(serverOrigin) && url.origin === serverOrigin && url.origin !== ws.origin;
      const isLogicPath = url.pathname.startsWith('/s/');
      if (isLocalHost || (isLogicPath && isServerUrlHost)) {
        url.protocol = ws.protocol;
        url.hostname = ws.hostname;
        url.port = ws.port;
        absolute = url.toString();
      }
    }
  } catch {
    return impl(input as RequestInfo, init);
  }

  return impl(absolute, init);
}

const api = new RestApiClient({ fetch: workspaceAwareFetch });

/** Compact select labels: TGUser/WAUser/MaxUser/TGBot Gift (+ identity). */
function shortBotPrefix(botType?: string | null): string {
  switch (botType) {
    case 'ai_gramjs':
      return 'TGUser';
    case 'ai_wa':
      return 'WAUser';
    case 'ai_max':
      return 'MaxUser';
    case 'gift':
      return 'TGBot Gift';
    case 'gift_max':
      return 'MaxBot Gift';
    default:
      return botType || 'Чат';
  }
}

function shortFromLabel(o: { botType: string; identityLabel: string; label: string }): string {
  const id = (o.identityLabel || o.label || '').trim();
  const prefix = shortBotPrefix(o.botType);
  // Gift bots read naturally without the dash (owner-approved wording).
  return o.botType === 'gift' || o.botType === 'gift_max'
    ? `${prefix} ${id}`
    : `${prefix} - ${id}`;
}

function shortThreadLabel(t: {
  botType?: string | null;
  peerLabel: string;
  identityLabel: string;
  channelLabel: string;
}): string {
  const peer = (t.peerLabel || t.identityLabel || t.channelLabel || '').trim();
  const prefix = shortBotPrefix(t.botType);
  return t.botType === 'gift' || t.botType === 'gift_max'
    ? `${prefix} ${peer}`
    : `${prefix} - ${peer}`;
}

function roleLabel(
  role: string,
  opts?: {
    contactName?: string | null;
    botAgentLabel?: string | null;
    operatorName?: string | null;
    senderLabel?: string | null;
  },
): string {
  if (role === 'user') return opts?.contactName || 'Клиент';
  if (role === 'operator') {
    return opts?.senderLabel || opts?.operatorName || 'Менеджер';
  }
  if (role === 'assistant' || role === 'bot') {
    return opts?.botAgentLabel || 'Бот';
  }
  return role || '';
}

function escapeHtml(src: string): string {
  return String(src || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Russian relative/absolute last-seen for CRM chat header. */
function formatRuLastSeen(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  if (diffMs < 60_000) return 'только что';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins} мин. назад`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (sameCalendarDay(d, now)) return `сегодня в ${time}`;
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (sameCalendarDay(d, yest)) return `вчера в ${time}`;
  if (diffMs < 7 * 86_400_000) {
    const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    return `${days[d.getDay()]} в ${time}`;
  }
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Hide when unknown — never invent status. */
function formatPresenceLine(presence?: ChatPresence | null): string | null {
  if (!presence) return null;
  if (presence.online) return 'онлайн';
  if (presence.approx === 'recently') return 'был(а) недавно';
  if (presence.approx === 'last_week') return 'был(а) на этой неделе';
  if (presence.approx === 'last_month') return 'был(а) в этом месяце';
  if (presence.lastSeenAt) {
    const when = formatRuLastSeen(presence.lastSeenAt);
    return when ? `был(а) в сети ${when}` : null;
  }
  return null;
}

/** Normalize pasted/TG HTML leftovers before escape (INC-050). */
function normalizeMessageText(src: string): string {
  return String(src || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/nbsp;/gi, ' ');
}

/**
 * Turn bare http(s) URLs into links. Only touch text nodes (skip tags / already-linked).
 */
function linkifyHtml(html: string): string {
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part || part.startsWith('<')) return part;
      return part.replace(/(https?:\/\/[^\s<]+)/g, (rawUrl) => {
        let url = rawUrl;
        let trail = '';
        while (url.length > 0 && /[.,);:!?\]}'"]/.test(url.slice(-1))) {
          trail = url.slice(-1) + trail;
          url = url.slice(0, -1);
        }
        if (!/^https?:\/\//i.test(url)) return rawUrl;
        const href = escapeHtml(url);
        return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="color:#1961ed;text-decoration:underline;word-break:break-all">${href}</a>${trail}`;
      });
    })
    .join('');
}

/** Inline client-MD → HTML (single line; newlines handled by the caller). */
function formatInlineMarkdown(src: string): string {
  let s = escapeHtml(src);
  s = s.replace(/```([\s\S]*?)```/g, (_m, code) => {
    return `<pre style="margin:4px 0;padding:6px;background:rgba(0,0,0,0.06);border-radius:6px;overflow:auto;font-size:12px">${code}</pre>`;
  });
  s = s.replace(
    /`([^`]+)`/g,
    '<code style="background:rgba(0,0,0,0.06);padding:1px 4px;border-radius:4px">$1</code>',
  );
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<em>$1</em>');
  s = s.replace(/(^|[^A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  // Spoiler must stay readable in CRM (Telegram hides until tap; we hint with dashed bg).
  s = s.replace(
    /\|\|([^|]+)\|\|/g,
    '<span style="background:rgba(0,0,0,0.12);border-bottom:1px dashed rgba(0,0,0,0.35);border-radius:3px;padding:0 2px">$1</span>',
  );
  return linkifyHtml(s);
}

/**
 * Full message HTML. Remote DOM often drops bare `<br/>` / collapses newlines inside
 * a single HTML blob — split lines into block rows instead (INC-023).
 * Empty rows use min-height only (not `&nbsp;`) — Remote DOM can strip `&` and show `nbsp;` (INC-050).
 */
function formatContent(src: string): string {
  const raw = normalizeMessageText(src);
  if (!raw) return '';
  return raw
    .split('\n')
    .map((line) => {
      const html = formatInlineMarkdown(line);
      return `<div style="min-height:1.2em">${html}</div>`;
    })
    .join('');
}

function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
): { text: string; nextStart: number; nextEnd: number } {
  const selected = value.slice(start, end);
  const text = value.slice(0, start) + before + selected + after + value.slice(end);
  return {
    text,
    nextStart: start + before.length,
    nextEnd: end + before.length,
  };
}

/** Nest JSON body limit is 10MB — base64 expands ~4/3, so keep raw well under. */
const MAX_REPLY_BASE64_CHARS = 7_000_000;

/**
 * Remote DOM file objects are metadata stubs (+ optional dataBase64 from host patch).
 * Never call FileReader / arrayBuffer on them (INC-015 / INC-017).
 *
 * Host serializer (i4 + voxly-file-base64) puts files on the **top-level** event
 * (`event.files`), not only `target.files` / `detail.files`.
 */
function extractPendingAttachments(event: unknown): {
  ready: PendingAttachment[];
  metaOnly: number;
} {
  const e = event as {
    files?: unknown;
    detail?: { files?: unknown };
    target?: { files?: ArrayLike<unknown> | null };
  };
  const asList = (v: unknown): unknown[] | null => {
    if (Array.isArray(v) && v.length > 0) return v;
    if (v && typeof v === 'object' && typeof (v as { length?: number }).length === 'number') {
      const arr = Array.from(v as ArrayLike<unknown>);
      return arr.length > 0 ? arr : null;
    }
    return null;
  };
  const candidates = [
    asList(e.files),
    asList(e.detail?.files),
    asList(e.target?.files),
  ].filter((x): x is unknown[] => !!x);
  // Prefer a list that already carries host-encoded bytes (INC-017/020).
  const raw =
    candidates.find((list) =>
      list.some(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof (item as { dataBase64?: unknown }).dataBase64 === 'string' &&
          !!(item as { dataBase64: string }).dataBase64,
      ),
    ) ||
    candidates[0] ||
    [];
  const ready: PendingAttachment[] = [];
  let metaOnly = 0;
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const name = typeof f.name === 'string' ? f.name : '';
    const dataBase64 = typeof f.dataBase64 === 'string' ? f.dataBase64 : '';
    if (!name) continue;
    if (!dataBase64) {
      metaOnly += 1;
      continue;
    }
    ready.push({
      name,
      type: typeof f.type === 'string' && f.type ? f.type : 'application/octet-stream',
      size: typeof f.size === 'number' ? f.size : 0,
      lastModified: typeof f.lastModified === 'number' ? f.lastModified : 0,
      dataBase64,
    });
  }
  return { ready, metaOnly };
}

function replyErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Не удалось отправить';
  // RestApiClientError attaches parsed JSON on `.body` ({ error: string }).
  const body = (err as Error & { body?: unknown }).body;
  const bodyText =
    typeof body === 'string'
      ? body
      : body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
        ? (body as { error: string }).error
        : '';
  const raw = bodyText || err.message;
  if (
    /request entity too large/i.test(raw) ||
    /request entity too large/i.test(err.message)
  ) {
    return 'Файл слишком большой для отправки (лимит ~7 МБ). Сожмите изображение или отправьте по одному.';
  }
  // Prefer API `error` string over generic "Request to … failed with status 400".
  if (bodyText) return bodyText;
  if (/failed with status\s*\d+/i.test(err.message)) {
    return 'Не удалось отправить сообщение';
  }
  return err.message;
}

function attachmentKey(file: PendingAttachment): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

const ChatPanel = () => {
  const recordId = useRecordId();
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [meta, setMeta] = useState<{
    title: string;
    presenceLine: string | null;
    channelLabel: string;
    identityLabel: string;
    supportsAttachments: boolean;
    conversationId: string;
    giftSubscriberId: string;
    aiControls: boolean;
    mode: string;
    aiDisabled: boolean;
    suppressDealCreation: boolean;
    pausedUntil: string | null;
    contactName: string;
    botAgentLabel: string;
    operatorName: string;
  }>({
    title: 'Чат',
    presenceLine: null,
    channelLabel: '',
    identityLabel: '',
    supportsAttachments: true,
    conversationId: '',
    giftSubscriberId: '',
    aiControls: false,
    mode: 'ai',
    aiDisabled: false,
    suppressDealCreation: false,
    pausedUntil: null,
    contactName: 'Клиент',
    botAgentLabel: 'Бот',
    operatorName: 'Менеджер',
  });
  const [aiBusy, setAiBusy] = useState(false);
  const [suppressBusy, setSuppressBusy] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [sendFromOptions, setSendFromOptions] = useState<SendFromOption[]>([]);
  const [sendFromBotId, setSendFromBotId] = useState('');
  const [activeThreadId, setActiveThreadId] = useState<string>('');
  const [draft, setDraft] = useState('');
  /** Remount composer after send — Remote DOM often ignores controlled `value=""` (INC-016). */
  const [composerKey, setComposerKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingAttachment[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const lastSig = useRef('');
  /** Selection must live in a ref — button click clears DOM selection before onClick. */
  const selRef = useRef({ start: 0, end: 0 });
  const activeThreadIdRef = useRef(activeThreadId);
  activeThreadIdRef.current = activeThreadId;
  const threadsRef = useRef(threads);
  threadsRef.current = threads;

  const syncSelection = (t: {
    selectionStart: number | null;
    selectionEnd: number | null;
    value?: string;
  }) => {
    const len = typeof t.value === 'string' ? t.value.length : draft.length;
    let start = typeof t.selectionStart === 'number' ? t.selectionStart : 0;
    let end = typeof t.selectionEnd === 'number' ? t.selectionEnd : start;
    start = Math.max(0, Math.min(start, len));
    end = Math.max(0, Math.min(end, len));
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    selRef.current = { start, end };
  };

  const load = useCallback(async (threadOverride?: ChatThread | null) => {
    if (!recordId) return;
    // Soft host refresh (shell-ux) reuses this button — skip spinner if we already have a list.
    const initialLoad = !lastSig.current;
    if (initialLoad) setLoading(true);
    try {
      const preferred =
        threadOverride ||
        threadsRef.current.find((t) => t.id === activeThreadIdRef.current) ||
        null;
      const qs = new URLSearchParams();
      if (preferred?.conversationId) qs.set('conversationId', preferred.conversationId);
      if (preferred?.giftSubscriberId) qs.set('giftSubscriberId', preferred.giftSubscriberId);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      const data = await api.get<ChatPayload>(`/s/crm-chat/${recordId}${suffix}`);
      if (data.error && !data.messages?.length) {
        setError(data.error);
        setInfo(null);
        setMessages([]);
        lastSig.current = '';
        return;
      }
      setError(null);
      setInfo(data.info || null);
      const nextThreads = data.threads || [];
      setThreads(nextThreads);
      const nextSendFrom = data.sendFromOptions || [];
      setSendFromOptions(nextSendFrom);
      const currentId =
        (preferred && nextThreads.find((t) => t.id === preferred.id)?.id) ||
        (data.conversationId
          ? nextThreads.find((t) => t.conversationId === data.conversationId)?.id
          : '') ||
        (data.subscriberId
          ? nextThreads.find((t) => t.giftSubscriberId === data.subscriberId)?.id
          : '') ||
        nextThreads[0]?.id ||
        '';
      if (currentId) setActiveThreadId(currentId);
      const defaultSend =
        nextSendFrom.find((o) => o.isDefault)?.botId ||
        data.botId ||
        nextThreads.find((t) => t.id === currentId)?.botId ||
        nextSendFrom[0]?.botId ||
        '';
      setSendFromBotId((prev) => {
        if (prev && nextSendFrom.some((o) => o.botId === prev)) return prev;
        return defaultSend;
      });
      const next = data.messages || [];
      // Fingerprint content + attachments too — history backfill keeps same ids
      // but rewrites `[media]` → `[файл:…]` + attachment meta (soft refresh must pick up).
      const sig = `${currentId}:${next
        .map((m) => {
          const attKey = (m.attachments || [])
            .map((a) => `${a?.fileId || ''}:${a?.type || ''}`)
            .join('+');
          return `${m.id}|${m.content || ''}|${attKey}`;
        })
        .join(',')}`;
      if (sig !== lastSig.current) {
        lastSig.current = sig;
        setMessages(next);
      }
      const who =
        data.contactName ||
        data.peerLabel ||
        (data.username ? `@${data.username}` : data.firstName || 'Клиент');
      const selectedOpt =
        nextSendFrom.find((o) => o.botId === (defaultSend || data.botId)) ||
        nextSendFrom.find((o) => o.isDefault);
      setMeta({
        title: who,
        presenceLine: formatPresenceLine(data.presence),
        channelLabel: selectedOpt?.channelLabel || data.channelLabel || '',
        identityLabel: selectedOpt?.identityLabel || data.identityLabel || '',
        supportsAttachments:
          typeof data.supportsAttachments === 'boolean' ? data.supportsAttachments : true,
        conversationId: data.conversationId || '',
        giftSubscriberId: data.subscriberId || '',
        aiControls: data.aiControls === true,
        mode: data.mode || 'ai',
        aiDisabled: data.aiDisabled === true,
        suppressDealCreation: data.suppressDealCreation === true,
        pausedUntil: data.pausedUntil || null,
        contactName: who,
        botAgentLabel: data.botAgentLabel || data.identityLabel || 'Бот',
        operatorName: data.operatorName || 'Менеджер',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Не удалось загрузить чат';
      if (/status 404/i.test(msg) || /No (Telegram )?chat linked/i.test(msg)) {
        setError(null);
        setInfo(
          'Нет чата для этой записи. Напишите клиенту в Telegram / WhatsApp или дождитесь входящего сообщения.',
        );
        setMessages([]);
        lastSig.current = '';
      } else {
        setInfo(null);
        setError(msg);
      }
    } finally {
      if (initialLoad) setLoading(false);
    }
  }, [recordId]);

  const setAiAction = async (action: 'enable' | 'pause' | 'disable') => {
    if (!recordId || !meta.conversationId || aiBusy) return;
    setAiBusy(true);
    try {
      await api.post(`/s/crm-chat/${recordId}/ai`, {
        conversationId: meta.conversationId,
        action,
      });
      await enqueueSnackbar({
        message:
          action === 'enable'
            ? 'AI включён'
            : action === 'pause'
              ? 'AI на паузе ~1 час'
              : 'AI отключён',
        variant: 'success',
      });
      lastSig.current = '';
      await load();
    } catch (err) {
      await enqueueSnackbar({
        message: err instanceof Error ? err.message : 'Не удалось изменить AI',
        variant: 'error',
      });
    } finally {
      setAiBusy(false);
    }
  };

  const toggleSuppressDeal = async () => {
    if (!recordId || suppressBusy) return;
    if (!meta.conversationId && !meta.giftSubscriberId) return;
    setSuppressBusy(true);
    const next = !meta.suppressDealCreation;
    try {
      await api.post(`/s/crm-chat/${recordId}/suppress-deal`, {
        conversationId: meta.conversationId || undefined,
        giftSubscriberId: meta.giftSubscriberId || undefined,
        suppress: next,
      });
      setMeta((m) => ({ ...m, suppressDealCreation: next }));
      await enqueueSnackbar({
        message: next
          ? 'Сделки при новых сообщениях отключены'
          : 'Автосоздание сделок снова включено',
        variant: 'success',
      });
    } catch (err) {
      await enqueueSnackbar({
        message:
          err instanceof Error ? err.message : 'Не удалось изменить настройку сделки',
        variant: 'error',
      });
    } finally {
      setSuppressBusy(false);
    }
  };

  // Remote DOM sandbox: no window.setInterval / requestAnimationFrame.
  // Refresh on open, after send, «Обновить», and host soft-click (~4.5s while Chat open).
  useEffect(() => {
    void load(null);
  }, [load]);

  // Auto-scroll to the LATEST message on open, thread switch and new messages.
  // Remote DOM: direct scrollTop on the proxied list node may be a no-op —
  // scrollIntoView on the sentinel child proxies to the real host element.
  useLayoutEffect(() => {
    const anchor = endRef.current as { scrollIntoView?: (o?: unknown) => void } | null;
    if (anchor && typeof anchor.scrollIntoView === 'function') {
      try {
        anchor.scrollIntoView({ block: 'end' });
        return;
      } catch {
        // fall through to scrollTop
      }
    }
    const el = listRef.current as { scrollTop?: number; scrollHeight?: number } | null;
    if (!el || typeof el.scrollHeight !== 'number') return;
    try {
      el.scrollTop = el.scrollHeight;
    } catch {
      // Remote DOM scroll may be unsupported
    }
  }, [messages, activeThreadId, loading]);

  const readComposerText = (): string => {
    // Remote DOM: host textarea value can diverge from React `draft` (INC-016).
    // Prefer non-empty host value; otherwise fall back to draft (empty "" must NOT win).
    const el = inputRef.current as { value?: string } | null;
    const fromEl = el && typeof el.value === 'string' ? el.value : '';
    if (fromEl.trim()) return fromEl;
    return draft;
  };

  const send = async () => {
    if (!recordId || sending) return;
    const text = readComposerText().trim();
    const files = meta.supportsAttachments ? [...pendingFiles] : [];
    if (!meta.supportsAttachments && pendingFiles.length > 0) {
      await enqueueSnackbar({
        message: 'Вложения из CRM для этого канала пока не поддерживаются — отправьте текст',
        variant: 'error',
      });
      return;
    }
    if (!text && files.length === 0) {
      await enqueueSnackbar({
        message: 'Введите текст сообщения',
        variant: 'error',
      });
      return;
    }
      const selected = sendFromOptions.find((o) => o.botId === sendFromBotId);
      if (selected && !selected.available) {
        await enqueueSnackbar({
          message: selected.unavailableReason || 'Нельзя отправить с этого аккаунта',
          variant: 'error',
        });
        return;
      }
      setSending(true);
      // Reply returns the conversation the message actually landed in. When
      // write-first / channel switch created a NEW thread, the panel must
      // switch to it instead of staying on the previously displayed one.
      let sentConversationId: string | null = null;
    try {
      const threadKeys: Record<string, string> = {};
      if (meta.conversationId) threadKeys.conversationId = meta.conversationId;
      if (meta.giftSubscriberId) threadKeys.giftSubscriberId = meta.giftSubscriberId;
      if (sendFromBotId) threadKeys.sendFromBotId = sendFromBotId;
      // saas-api accepts one file per /reply — send sequentially (caption on first).
      // dataBase64 already encoded on host file-change (INC-017); never FileReader here.
      if (files.length === 0) {
        const res = await api.post<{ conversationId?: string }>(
          `/s/crm-chat/${recordId}/reply`,
          { text, ...threadKeys },
        );
        if (res?.conversationId) sentConversationId = res.conversationId;
      } else {
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (!file.dataBase64) {
            throw new Error(`Файл без данных: ${file.name}`);
          }
          if (file.dataBase64.length > MAX_REPLY_BASE64_CHARS) {
            throw new Error(
              `«${file.name}» слишком большой для отправки. Сожмите файл или отправьте отдельно.`,
            );
          }
          const res = await api.post<{ conversationId?: string }>(
            `/s/crm-chat/${recordId}/reply`,
            {
              text: i === 0 ? text || undefined : undefined,
              fileBase64: file.dataBase64,
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
              ...threadKeys,
            },
          );
          if (res?.conversationId) sentConversationId = res.conversationId;
        }
      }
      // Clear draft/files only after all successful send(s).
      // Remount textarea: Remote DOM keeps host DOM value when only setDraft('') runs.
      setDraft('');
      setComposerKey((k) => k + 1);
      setPendingFiles([]);
      if (fileRef.current) {
        try {
          fileRef.current.value = '';
        } catch {
          // Remote DOM file input may be read-only
        }
      }
      selRef.current = { start: 0, end: 0 };
    } catch (err) {
      await enqueueSnackbar({
        message: replyErrorMessage(err),
        variant: 'error',
      });
    } finally {
      // Always clear sending before refresh — hung load() must not stick the button.
      setSending(false);
    }
    // Refresh outside the sending lock (never await load inside finally).
    // A new thread (write-first / channel switch) becomes the displayed one.
    void load(
      sentConversationId && sentConversationId !== meta.conversationId
        ? ({ conversationId: sentConversationId } as ChatThread)
        : null,
    );
  };

  const applyFormat = (before: string, after: string) => {
    if (inputRef.current) syncSelection(inputRef.current);
    const value = readComposerText();
    const len = value.length;
    let { start, end } = selRef.current;
    start = Math.max(0, Math.min(start, len));
    end = Math.max(0, Math.min(end, len));
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    // Remote DOM often collapses selection before click; fall back to last word on the
    // current line (not across newlines — otherwise strike wraps only the last line).
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
    if (start === end) {
      void enqueueSnackbar({
        message: 'Сначала выделите текст в поле ввода',
        variant: 'error',
      });
      return;
    }
    const next = wrapSelection(value, start, end, before, after);
    setDraft(next.text);
    selRef.current = { start: next.nextStart, end: next.nextEnd };
    // Never call focus/setSelectionRange — Remote DOM throws (Fl.focus is not a function).
  };

  const noteSelection = (
    t: HTMLTextAreaElement | { selectionStart: number | null; selectionEnd: number | null; value?: string },
  ) => {
    syncSelection(t);
  };

  const formatItems = [
    { label: 'Жирный', before: '**', after: '**' },
    { label: 'Курсив', before: '__', after: '__' },
    { label: 'Зачёркнутый', before: '~~', after: '~~' },
    { label: 'Спойлер', before: '||', after: '||' },
    { label: 'Код', before: '`', after: '`' },
  ];
  void formatItems;

  /** Right-click formatting menu (replaces the old button toolbar). */
  const [ctxMenu, setCtxMenu] = useState<{ x: number | null; y: number | null } | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);

  const quoteSelection = () => {
    if (inputRef.current) syncSelection(inputRef.current);
    const value = readComposerText();
    const len = value.length;
    let { start, end } = selRef.current;
    start = Math.max(0, Math.min(start, len));
    end = Math.max(0, Math.min(end, len));
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    if (start === end) {
      void enqueueSnackbar({ message: 'Сначала выделите текст в поле ввода', variant: 'error' });
      return;
    }
    const quoted = value
      .slice(start, end)
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    const next = value.slice(0, start) + quoted + value.slice(end);
    setDraft(next);
    selRef.current = { start, end: start + quoted.length };
  };

  const linkSelection = () => {
    if (inputRef.current) syncSelection(inputRef.current);
    const value = readComposerText();
    const len = value.length;
    let { start, end } = selRef.current;
    start = Math.max(0, Math.min(start, len));
    end = Math.max(0, Math.min(end, len));
    if (start > end) {
      const tmp = start;
      start = end;
      end = tmp;
    }
    if (start === end) {
      void enqueueSnackbar({ message: 'Сначала выделите текст ссылки', variant: 'error' });
      return;
    }
    const url = 'https://';
    const wrapped = `[${value.slice(start, end)}](${url})`;
    const next = value.slice(0, start) + wrapped + value.slice(end);
    setDraft(next);
    // Cursor onto the URL part for immediate paste-over: [text](https://)
    selRef.current = { start: end + 3, end: start + wrapped.length - 1 };
  };

  const insertAtCursor = (text: string) => {
    const host = inputRef.current as { value?: string; selectionStart?: number | null } | null;
    const value = readComposerText();
    let at = value.length;
    if (host && typeof host.selectionStart === 'number') {
      at = Math.max(0, Math.min(host.selectionStart, value.length));
    } else if (selRef.current.end > 0) {
      at = Math.min(selRef.current.end, value.length);
    }
    const next = value.slice(0, at) + text + value.slice(at);
    setDraft(next);
    selRef.current = { start: at + text.length, end: at + text.length };
    setShowEmoji(false);
  };

  const canSend = Boolean(draft.trim() || pendingFiles.length);
  const bg = dark ? '#1a1a1a' : '#f7f7f7';
  const panel = dark ? '#242424' : '#ffffff';
  const ink = dark ? '#f3f3f3' : '#1a1a1a';
  const muted = dark ? '#a0a0a0' : '#666666';
  const border = dark ? '#333' : '#e6e6e6';
  const bubbleIn = dark ? '#2e2e2e' : '#ececec';
  const bubbleOut = dark ? '#1f3a2e' : '#e8f5ee';

  if (!recordId) {
    return (
      <div style={{ padding: 24, color: muted, height: '100%' }}>
        Откройте карточку контакта или сделки, чтобы увидеть чат.
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      data-voxly-crm-chat="1"
      style={{
        // Fill the host widget box; never grow with messages (outer scroll-wrapper
        // would then move the composer — pin via absolute + host CSS in shell-ux).
        boxSizing: 'border-box',
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        width: 'auto',
        height: 'auto',
        overflow: 'hidden',
        background: bg,
        color: ink,
        fontFamily:
          'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      <div
        style={{
          flexShrink: 0,
          padding: '12px 16px',
          borderBottom: `1px solid ${border}`,
          background: panel,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'baseline' }}>
            <span>{meta.title}</span>
            {meta.presenceLine ? (
              <span style={{ fontWeight: 400, fontSize: 12, color: muted }}>{meta.presenceLine}</span>
            ) : null}
          </div>
          {sendFromOptions.length > 0 ? (
            <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
              <label
                style={{
                  fontSize: 12,
                  color: muted,
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>От:</span>
                <select
                  value={sendFromBotId}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    const opt = sendFromOptions.find((o) => o.botId === nextId);
                    setSendFromBotId(nextId);
                    if (opt) {
                      setMeta((m) => ({
                        ...m,
                        channelLabel: opt.channelLabel,
                        identityLabel: opt.identityLabel,
                        // gift_max only — GramJS/MAX/WA outbound attach are supported.
                        supportsAttachments: opt.botType !== 'gift_max',
                      }));
                      if (opt.threadId) {
                        const thr = threads.find((t) => t.id === opt.threadId);
                        if (thr) {
                          setActiveThreadId(thr.id);
                          lastSig.current = '';
                          void load(thr);
                          return;
                        }
                      }
                      // No thread for this bot yet → show empty history (write-first)
                      setActiveThreadId('');
                      setMessages([]);
                      lastSig.current = '';
                      if (!opt.available && opt.unavailableReason) {
                        setError(opt.unavailableReason);
                      } else {
                        setError(null);
                      }
                    }
                  }}
                  style={{
                    maxWidth: 220,
                    fontSize: 12,
                    border: `1px solid ${border}`,
                    borderRadius: 8,
                    padding: '3px 6px',
                    background: panel,
                    color: ink,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {sendFromOptions.map((o) => (
                    <option key={o.botId} value={o.botId} disabled={!o.available}>
                      {shortFromLabel(o)}
                      {!o.available ? ' (недоступно)' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {threads.length > 1 && (
                <label
                  style={{
                    fontSize: 12,
                    color: muted,
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <span>Чат:</span>
                  <select
                    value={activeThreadId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      const t = threads.find((x) => x.id === nextId);
                      setActiveThreadId(nextId);
                      if (t?.botId) setSendFromBotId(t.botId);
                      lastSig.current = '';
                      void load(t || null);
                    }}
                    style={{
                      maxWidth: 220,
                      fontSize: 12,
                      border: `1px solid ${border}`,
                      borderRadius: 8,
                      padding: '3px 6px',
                      background: panel,
                      color: ink,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {threads.map((t) => (
                      <option key={t.id} value={t.id}>
                        {shortThreadLabel(t)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(() => {
                const cur = sendFromOptions.find((o) => o.botId === sendFromBotId);
                if (cur && !cur.available && cur.unavailableReason) {
                  return (
                    <div style={{ fontSize: 11, color: '#b45309', maxWidth: 360 }}>
                      {cur.unavailableReason}
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          ) : (
            (meta.channelLabel || meta.identityLabel) && (
              <div style={{ fontSize: 12, color: muted, marginTop: 2 }}>
                От: {meta.channelLabel}
                {meta.identityLabel ? ` · ${meta.identityLabel}` : ''}
                {meta.presenceLine ? ` · ${meta.presenceLine}` : ''}
              </div>
            )
          )}
        </div>
        {/* Hidden refresh marker: twenty-shell-ux clicks it for live refresh
            (Remote DOM cannot setInterval). Never render visibly. */}
        <button
          type="button"
          data-voxly-chat-refresh="1"
          onClick={() => void load()}
          style={{ display: 'none' }}
        >
          Обновить
        </button>
      </div>

      {(meta.aiControls && meta.conversationId) ||
      meta.conversationId ||
      meta.giftSubscriberId ? (
        <div
          data-voxly-ai-controls="1"
          style={{
            flexShrink: 0,
            padding: '8px 16px',
            borderBottom: `1px solid ${border}`,
            background: dark ? '#0f172a' : '#f8fafc',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            alignItems: 'center',
          }}
        >
          {meta.aiControls && meta.conversationId
            ? (() => {
                const paused =
                  Boolean(meta.pausedUntil) &&
                  new Date(meta.pausedUntil!).getTime() > Date.now();
                const status = meta.aiDisabled
                  ? 'AI выкл'
                  : paused
                    ? 'AI пауза'
                    : meta.mode === 'human'
                      ? 'AI пауза'
                      : 'AI вкл';
                return (
                  <span
                    style={{ fontSize: 12, color: muted, marginRight: 4, fontWeight: 600 }}
                  >
                    {status}
                  </span>
                );
              })()
            : null}
          {meta.aiControls && meta.conversationId
            ? (
                [
                  { action: 'enable' as const, label: 'Вкл AI' },
                  { action: 'pause' as const, label: 'Пауза' },
                  { action: 'disable' as const, label: 'Выкл AI' },
                ] as const
              ).map((btn) => (
                <button
                  key={btn.action}
                  type="button"
                  disabled={aiBusy || sending}
                  onClick={() => void setAiAction(btn.action)}
                  style={{
                    border: `1px solid ${border}`,
                    background: panel,
                    color: ink,
                    borderRadius: 8,
                    padding: '5px 10px',
                    cursor: aiBusy ? 'wait' : 'pointer',
                    fontSize: 12,
                    opacity: aiBusy ? 0.6 : 1,
                  }}
                >
                  {btn.label}
                </button>
              ))
            : null}
          {(meta.conversationId || meta.giftSubscriberId) && (
            <button
              type="button"
              disabled={suppressBusy || sending}
              onClick={() => void toggleSuppressDeal()}
              title="Если сделка удалена — новые сообщения не создадут новую, пока флаг включён"
              style={{
                border: `1px solid ${meta.suppressDealCreation ? '#b45309' : border}`,
                background: meta.suppressDealCreation
                  ? dark
                    ? '#422006'
                    : '#fff7ed'
                  : panel,
                color: meta.suppressDealCreation ? '#c2410c' : ink,
                borderRadius: 8,
                padding: '5px 10px',
                cursor: suppressBusy ? 'wait' : 'pointer',
                fontSize: 12,
                opacity: suppressBusy ? 0.6 : 1,
                marginLeft: meta.aiControls ? 4 : 0,
              }}
            >
              {meta.suppressDealCreation
                ? 'Сделку не создавать ✓'
                : 'Не создавать сделку'}
            </button>
          )}
        </div>
      ) : null}

      <div
        ref={listRef}
        data-voxly-chat-list="1"
        style={{
          flex: 1,
          minHeight: 0,
          overflowX: 'hidden',
          overflowY: 'auto',
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}
      >
        {loading && messages.length === 0 && (
          <div style={{ color: muted, fontSize: 13 }}>Загрузка…</div>
        )}
        {error && (
          <div style={{ color: '#b42318', fontSize: 13 }}>{error}</div>
        )}
        {!error && info && !loading && messages.length === 0 && (
          <div style={{ color: muted, fontSize: 13, lineHeight: 1.45 }}>{info}</div>
        )}
        {!error && !info && !loading && messages.length === 0 && (
          <div style={{ color: muted, fontSize: 13 }}>
            Нет сообщений по этой записи.
          </div>
        )}
        {messages.map((m) => {
          const outbound = m.role === 'operator' || m.role === 'assistant' || m.role === 'bot';
          const atts = m.attachments?.filter((a) => a?.fileId) || [];
          const hidePlaceholder =
            atts.length > 0 && isMediaPlaceholder(m.content || '');
          return (
            <div
              key={m.id}
              style={{
                alignSelf: outbound ? 'flex-end' : 'flex-start',
                maxWidth: '78%',
                background: outbound ? bubbleOut : bubbleIn,
                borderRadius: 12,
                padding: '8px 10px',
              }}
            >
              <div style={{ fontSize: 11, color: muted, marginBottom: 4 }}>
                {roleLabel(m.role, {
                  contactName: meta.contactName,
                  botAgentLabel: meta.botAgentLabel,
                  operatorName: meta.operatorName,
                  senderLabel: m.senderLabel,
                })}{' '}
                · {new Date(m.sentAt).toLocaleString()}
              </div>
              {!hidePlaceholder && m.content ? (
                <div
                  style={{
                    fontSize: 13,
                    lineHeight: 1.45,
                    wordBreak: 'break-word',
                  }}
                  dangerouslySetInnerHTML={{ __html: formatContent(m.content) }}
                />
              ) : null}
              {atts.map((a) => (
                <ChatAttachmentView
                  key={a.fileId}
                  recordId={recordId}
                  attachment={a}
                  muted={muted}
                  ink={ink}
                />
              ))}
            </div>
          );
        })}
        {/* Auto-scroll anchor: scrollIntoView proxies to the real host element
            in Remote DOM, unlike direct scrollTop assignment on a proxy node. */}
        <div ref={endRef} style={{ height: 1 }} />
      </div>

      <div
        style={{
          flexShrink: 0,
          borderTop: `1px solid ${border}`,
          background: panel,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {pendingFiles.length > 0 ? (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
            }}
          >
            {pendingFiles.map((file) => (
              <span
                key={attachmentKey(file)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: ink,
                  background: bg,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  padding: '4px 8px',
                  maxWidth: '100%',
                }}
              >
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 180,
                  }}
                >
                  {file.name}
                </span>
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    setPendingFiles((prev) =>
                      prev.filter((f) => attachmentKey(f) !== attachmentKey(file)),
                    );
                    if (fileRef.current) {
                      try {
                        fileRef.current.value = '';
                      } catch {
                        // Remote DOM file input may be read-only
                      }
                    }
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: '#b42318',
                    cursor: 'pointer',
                    fontSize: 12,
                    padding: 0,
                    flexShrink: 0,
                  }}
                >
                  убрать
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            alignItems: 'stretch',
          }}
        >
          <textarea
            key={composerKey}
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              noteSelection(e.target);
            }}
            onSelect={(e) => {
              noteSelection(e.target as HTMLTextAreaElement);
            }}
            onKeyUp={(e) => {
              noteSelection(e.target as HTMLTextAreaElement);
            }}
            onMouseUp={(e) => {
              noteSelection(e.target as HTMLTextAreaElement);
            }}
            onContextMenu={(e) => {
              // Right-click on selected draft text → formatting menu.
              e.preventDefault();
              noteSelection(e.target as HTMLTextAreaElement);
              const rect = (rootRef.current as { getBoundingClientRect?: () => DOMRect } | null)
                ?.getBoundingClientRect?.();
              const ev = e as unknown as { clientX?: number; clientY?: number };
              setCtxMenu({
                x: Math.max(8, (ev.clientX || 0) - (rect?.left || 0)),
                y: Math.max(8, (ev.clientY || 0) - (rect?.top || 0)),
              });
            }}
            onMouseDown={(e) => {
              // Remote DOM may not proxy `contextmenu` — catch the right-button
              // mousedown instead (selection still alive at this moment).
              const ev = e as unknown as { button?: number };
              if (ev.button === 2) {
                noteSelection(e.target as HTMLTextAreaElement);
                const rect = (rootRef.current as { getBoundingClientRect?: () => DOMRect } | null)
                  ?.getBoundingClientRect?.();
                const cev = e as unknown as { clientX?: number; clientY?: number };
                setCtxMenu({
                  x: Math.max(8, (cev.clientX || 0) - (rect?.left || 0)),
                  y: Math.max(8, (cev.clientY || 0) - (rect?.top || 0)),
                });
              }
            }}
            onKeyDown={(e) => {
              // Enter = newline (multiline replies). Cmd/Ctrl+Enter = send.
              // Plain Enter previously sent immediately → only the first line went out (INC-022).
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={`Ответ в ${
              meta.channelLabel?.trim()
                ? meta.channelLabel.split('·')[0].trim()
                : 'чат'
            }… (⌘/Ctrl+Enter — отправить)`}
            rows={3}
            style={{
              flex: 1,
              minWidth: 0,
              resize: 'none',
              border: `1px solid ${border}`,
              borderRadius: 10,
              padding: '10px 12px',
              background: bg,
              color: ink,
              fontSize: 13,
              lineHeight: 1.4,
              outline: 'none',
            }}
          />
          <div
            style={{
              display: 'flex',
              flexDirection: 'row',
              gap: 6,
              flexShrink: 0,
              alignItems: 'center',
              order: -1,
            }}
          >
            <button
              type="button"
              title="Смайлик — вставить эмодзи"
              onClick={() => setShowEmoji((v) => !v)}
              style={{
                border: `1px solid ${border}`,
                background: showEmoji ? (dark ? '#1e293b' : '#eff6ff') : panel,
                color: ink,
                borderRadius: 10,
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: 15,
                lineHeight: 1.2,
              }}
            >
              😊
            </button>
            {meta.supportsAttachments ? (
            <label
              title="Прикрепить файл"
              style={{
                border: `1px solid ${border}`,
                background: panel,
                color: ink,
                borderRadius: 10,
                padding: '6px 10px',
                cursor: 'pointer',
                fontSize: 15,
                lineHeight: 1.2,
                whiteSpace: 'nowrap',
                textAlign: 'center',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              📎
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.txt"
                onChange={(e) => {
                  const { ready, metaOnly } = extractPendingAttachments(e);
                  if (metaOnly > 0 && ready.length === 0) {
                    void enqueueSnackbar({
                      message:
                        'Файл выбран, но содержимое недоступно в Remote DOM. Нужен патч Twenty (file base64) и hard-refresh.',
                      variant: 'error',
                    });
                  }
                  if (ready.length === 0) return;
                  setPendingFiles((prev) => {
                    const seen = new Set(prev.map(attachmentKey));
                    const next = [...prev];
                    for (const f of ready) {
                      const k = attachmentKey(f);
                      if (seen.has(k)) continue;
                      seen.add(k);
                      next.push(f);
                    }
                    return next;
                  });
                  try {
                    e.target.value = '';
                  } catch {
                    // Remote DOM file input may be read-only
                  }
                }}
                style={{
                  position: 'absolute',
                  inset: 0,
                  opacity: 0,
                  cursor: 'pointer',
                  fontSize: 0,
                }}
              />
            </label>
            ) : null}
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <button
              type="button"
              disabled={sending || !canSend}
              onClick={() => void send()}
              style={{
                border: 'none',
                background: sending || !canSend ? muted : ink,
                color: panel,
                borderRadius: 10,
                padding: '10px 14px',
                cursor: sending || !canSend ? 'default' : 'pointer',
                fontSize: 13,
                fontWeight: 600,
                opacity: sending || !canSend ? 0.6 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              Отправить
            </button>
          </div>
        </div>
      </div>

      {/* Right-click formatting menu (draft text selection). */}
      {ctxMenu ? (
        <div
          onClick={() => setCtxMenu(null)}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 40,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: ctxMenu.x ?? 0,
              top: ctxMenu.y ?? 0,
              zIndex: 41,
              minWidth: 170,
              background: panel,
              border: `1px solid ${border}`,
              borderRadius: 10,
              boxShadow: dark ? '0 8px 24px rgba(0,0,0,.55)' : '0 8px 24px rgba(0,0,0,.14)',
              padding: 4,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {[
              { label: 'Цитировать', action: () => quoteSelection() },
              { label: 'Скрытый', action: () => applyFormat('||', '||') },
              { label: 'Жирный', action: () => applyFormat('**', '**') },
              { label: 'Зачеркнутый', action: () => applyFormat('~~', '~~') },
              { label: 'Подчеркнутый', action: () => applyFormat('__', '__') },
              { label: 'Ссылка', action: () => linkSelection() },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onMouseDown={(e) => {
                  // Keep textarea selection alive across Remote DOM click.
                  e.preventDefault();
                  if (inputRef.current) syncSelection(inputRef.current);
                }}
                onClick={() => {
                  item.action();
                  setCtxMenu(null);
                }}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: ink,
                  textAlign: 'left',
                  padding: '6px 10px',
                  borderRadius: 7,
                  cursor: 'pointer',
                  fontSize: 13,
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Emoji palette. */}
      {showEmoji ? (
        <div
          style={{
            position: 'absolute',
            right: 12,
            bottom: 96,
            zIndex: 42,
            width: 264,
            maxHeight: 200,
            overflowY: 'auto',
            background: panel,
            border: `1px solid ${border}`,
            borderRadius: 10,
            boxShadow: dark ? '0 8px 24px rgba(0,0,0,.55)' : '0 8px 24px rgba(0,0,0,.14)',
            padding: 8,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}
        >
          {[
            '😀','😁','😂','🤣','😊','🙂','😉','😍','🥰','😘','😎','🤩','🤔','😅','😌',
            '👍','👎','👏','🙏','💪','🤝','👌','✌️','🤞','👋','🔥','⭐️','✅','❌','⚡️',
            '🎉','🎊','🎁','❤️','💚','💙','😢','😭','😤','😡','🤯','😱','🥳','😴','🤗',
            '📞','📱','💬','📧','🕒','📅','💰','📊','📈','📉','🎯','📌','📎','🔗','🛠','🔨',
          ]
            .map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => insertAtCursor(emoji)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  fontSize: 18,
                  lineHeight: 1.4,
                  cursor: 'pointer',
                  padding: '2px 4px',
                  borderRadius: 6,
                }}
              >
                {emoji}
              </button>
            ))}
          <button
            type="button"
            onClick={() => setShowEmoji(false)}
            style={{
              border: `1px solid ${border}`,
              background: bg,
              color: muted,
              borderRadius: 8,
              fontSize: 11,
              padding: '4px 8px',
              cursor: 'pointer',
              marginLeft: 'auto',
            }}
          >
            Закрыть
          </button>
        </div>
      ) : null}
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: CHAT_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Voxly Chat',
  description: 'Telegram chat for Person and Opportunity record pages',
  component: ChatPanel,
});
