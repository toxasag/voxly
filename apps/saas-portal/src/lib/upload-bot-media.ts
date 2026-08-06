export type UploadedBotMediaKind =
  | 'photo'
  | 'video'
  | 'document'
  | 'voice'
  | 'video_note'
  | 'audio';

export type UploadedBotMedia = {
  fileId: string;
  fileUniqueId?: string;
  /** Mirrors Telegram send kind after staging (fallbacks may change the kind). */
  mediaType: UploadedBotMediaKind;
  kind: UploadedBotMediaKind;
};

export type UploadBotMediaProgress = {
  /** 0–100 */
  percent: number;
  /** upload = bytes to API; processing = waiting for Telegram file_id */
  phase: 'upload' | 'processing';
};

/** Align with NPM proxy_*_timeout 300s (INC-088/089); client abort at 180s caused 499. */
const DEFAULT_TIMEOUT_MS = 300_000;

/**
 * Browser → public API (bypasses Next.js rewrite).
 * Large videos were dying with Premature close after ~30s through portal proxy.
 */
function mediaUploadBaseUrl(): string {
  const fromEnv = (process.env.NEXT_PUBLIC_API_URL || '').trim().replace(/\/$/, '');
  // Never upload via Next rewrite on prod — Premature close ~30s (INC-086/088).
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'getvoxly.ru' || host === 'www.getvoxly.ru' || host.endsWith('.getvoxly.ru')) {
      return 'https://api.getvoxly.ru';
    }
    if (host === 'localhost' || host === '127.0.0.1') {
      return fromEnv || 'http://localhost:3002';
    }
  }
  if (fromEnv && !/localhost|127\.0\.0\.1/i.test(fromEnv)) return fromEnv;
  return fromEnv || 'https://api.getvoxly.ru';
}

/**
 * Multipart upload to `/api/bots/:botId/media` with real upload progress.
 * Caps client→server at ~90%; remainder is server→Telegram processing.
 */
export function uploadBotMedia(opts: {
  botId: string;
  file: File;
  campaignId?: string;
  /** Stage as Telegram video note (кружочек); MP4 ≤60s, ideally square. */
  asVideoNote?: boolean;
  token: string | null;
  timeoutMs?: number;
  onProgress?: (p: UploadBotMediaProgress) => void;
  signal?: AbortSignal;
}): Promise<UploadedBotMedia> {
  const { botId, file, campaignId, asVideoNote, token, onProgress, signal } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    if (!token) {
      reject(new Error('Войдите в кабинет заново — нет токена сессии'));
      return;
    }

    const xhr = new XMLHttpRequest();
    const q = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
    const base = mediaUploadBaseUrl();
    const url = `${base}/api/bots/${encodeURIComponent(botId)}/media${q}`;
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = timeoutMs;
    xhr.responseType = 'json';
    xhr.withCredentials = true;

    const fail = (message: string) => {
      reject(new Error(message));
    };

    const onAbort = () => {
      xhr.abort();
      fail('Загрузка отменена');
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const pct = Math.min(90, Math.round((event.loaded / event.total) * 90));
      onProgress?.({ percent: pct, phase: 'upload' });
    };

    xhr.upload.onload = () => {
      onProgress?.({ percent: 92, phase: 'processing' });
    };

    xhr.onload = () => {
      signal?.removeEventListener('abort', onAbort);
      const status = xhr.status;
      const body = (xhr.response ?? {}) as {
        error?: unknown;
        fileId?: string;
        fileUniqueId?: string;
        mediaType?: UploadedBotMediaKind;
        kind?: UploadedBotMediaKind;
      };

      if (status < 200 || status >= 300) {
        const err =
          typeof body.error === 'string'
            ? body.error
            : body.error
              ? JSON.stringify(body.error)
              : status === 413
                ? 'Файл слишком большой (лимит ~48 МБ)'
                : status === 0
                  ? 'Соединение оборвалось. Повторите загрузку (лучше MP4 до 48 МБ).'
                  : `Ошибка загрузки (${status})`;
        fail(err);
        return;
      }

      if (!body.fileId || !body.kind) {
        fail('Сервер не вернул file_id');
        return;
      }

      const allowed: UploadedBotMediaKind[] = [
        'photo',
        'video',
        'document',
        'voice',
        'video_note',
        'audio',
      ];
      const kind = allowed.includes(body.kind as UploadedBotMediaKind)
        ? (body.kind as UploadedBotMediaKind)
        : 'document';
      const mediaType = allowed.includes(body.mediaType as UploadedBotMediaKind)
        ? (body.mediaType as UploadedBotMediaKind)
        : kind;

      onProgress?.({ percent: 100, phase: 'processing' });
      resolve({
        fileId: body.fileId,
        fileUniqueId: body.fileUniqueId,
        mediaType,
        kind,
      });
    };

    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      fail('Сеть недоступна или API оборвал загрузку. Для видео попробуйте MP4 до 48 МБ.');
    };

    xhr.ontimeout = () => {
      signal?.removeEventListener('abort', onAbort);
      fail(
        'Превышено время ожидания (5 мин). Уменьшите видео или проверьте, что Telegram привязан / канал проверен.',
      );
    };

    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort);
      fail('Загрузка отменена');
    };

    onProgress?.({ percent: 0, phase: 'upload' });
    const fd = new FormData();
    fd.append('file', file);
    if (campaignId) fd.append('campaignId', campaignId);
    if (asVideoNote) fd.append('asVideoNote', '1');
    xhr.send(fd);
  });
}
