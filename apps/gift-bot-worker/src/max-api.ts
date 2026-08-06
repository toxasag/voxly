/**
 * MAX official Bot API client (platform-api2.max.ru).
 * Auth: Authorization header with bot token (not query param).
 * ADR-025 Phase 2 — gift_max.
 */

const MAX_API_BASE = (
  process.env.MAX_BOT_API_URL || 'https://platform-api2.max.ru'
).replace(/\/$/, '');

export type MaxMe = {
  user_id: number;
  name?: string;
  username?: string;
  is_bot?: boolean;
};

export type MaxSendResult = {
  ok: boolean;
  status: number;
  body: unknown;
  error?: string;
};

async function maxFetch(
  token: string,
  method: string,
  path: string,
  opts?: { query?: Record<string, string | number | undefined>; body?: unknown },
): Promise<{ status: number; json: any }> {
  const url = new URL(`${MAX_API_BASE}${path}`);
  if (opts?.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: token,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

export async function maxGetMe(token: string): Promise<MaxMe | null> {
  const { status, json } = await maxFetch(token, 'GET', '/me');
  if (status >= 300) return null;
  // Some responses wrap in { user_id } directly; tolerate nested.
  const me = (json?.user_id != null ? json : json?.result || json?.user) as MaxMe | undefined;
  if (!me?.user_id) return null;
  return me;
}

export async function maxSendText(opts: {
  token: string;
  userId?: string | number;
  chatId?: string | number;
  text: string;
  attachments?: unknown[];
}): Promise<MaxSendResult> {
  const query: Record<string, string | number | undefined> = {};
  if (opts.userId != null) query.user_id = opts.userId;
  if (opts.chatId != null) query.chat_id = opts.chatId;
  const { status, json } = await maxFetch(opts.token, 'POST', '/messages', {
    query,
    body: {
      text: opts.text,
      ...(opts.attachments ? { attachments: opts.attachments } : {}),
    },
  });
  const ok = status < 300 && json?.success !== false;
  return {
    ok,
    status,
    body: json,
    error: ok
      ? undefined
      : String(json?.message || json?.error || json?.code || `HTTP ${status}`),
  };
}

export async function maxSubscribeWebhook(opts: {
  token: string;
  url: string;
  secret: string;
  updateTypes?: string[];
}): Promise<MaxSendResult> {
  const { status, json } = await maxFetch(opts.token, 'POST', '/subscriptions', {
    body: {
      url: opts.url,
      secret: opts.secret,
      update_types: opts.updateTypes || ['message_created', 'bot_started', 'message_callback'],
    },
  });
  const ok = status < 300 && (json?.success === true || json?.success === undefined);
  return {
    ok,
    status,
    body: json,
    error: ok ? undefined : String(json?.message || json?.error || `HTTP ${status}`),
  };
}

export async function maxGetUpdates(opts: {
  token: string;
  marker?: number | string | null;
  timeout?: number;
  types?: string[];
}): Promise<{ updates: any[]; marker?: number }> {
  const query: Record<string, string | number | undefined> = {
    timeout: opts.timeout ?? 30,
  };
  if (opts.marker != null) query.marker = opts.marker;
  if (opts.types?.length) query.types = opts.types.join(',');
  const { status, json } = await maxFetch(opts.token, 'GET', '/updates', { query });
  if (status >= 300) return { updates: [] };
  const updates = Array.isArray(json?.updates)
    ? json.updates
    : Array.isArray(json)
      ? json
      : [];
  return { updates, marker: json?.marker };
}

export function maxInlineKeyboard(
  rows: Array<Array<{ type: string; text: string; payload?: string; url?: string }>>,
) {
  return {
    type: 'inline_keyboard',
    payload: { buttons: rows },
  };
}
