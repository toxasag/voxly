/**
 * Debounce inbound user bursts so AI replies once after a quiet period
 * (n8n-style: wait until the client finishes sending short messages).
 */

export type InboundDebouncer<T> = {
  push: (key: string, item: T) => void;
  pendingCount: (key: string) => number;
  clear: (key?: string) => void;
};

/** Default quiet window after last user message (5–6s target → 6s). */
export const DEFAULT_INBOUND_DEBOUNCE_MS = 6000;

export function createInboundDebouncer<T>(opts: {
  /** Quiet window after last message before flush (default 6s). */
  settleMs?: number;
  onFlush: (key: string, items: T[]) => void | Promise<void>;
}): InboundDebouncer<T> {
  const settleMs = Math.max(500, opts.settleMs ?? DEFAULT_INBOUND_DEBOUNCE_MS);
  const pending = new Map<string, { items: T[]; timer: ReturnType<typeof setTimeout> }>();

  return {
    push(key: string, item: T) {
      const cur = pending.get(key);
      if (cur) clearTimeout(cur.timer);
      const items = cur ? [...cur.items, item] : [item];
      const timer = setTimeout(() => {
        pending.delete(key);
        void Promise.resolve(opts.onFlush(key, items)).catch((err) => {
          console.error('[inbound-debounce] onFlush failed', key, err);
        });
      }, settleMs);
      pending.set(key, { items, timer });
    },
    pendingCount(key: string) {
      return pending.get(key)?.items.length ?? 0;
    },
    clear(key?: string) {
      if (key) {
        const cur = pending.get(key);
        if (cur) clearTimeout(cur.timer);
        pending.delete(key);
        return;
      }
      for (const [, cur] of pending) clearTimeout(cur.timer);
      pending.clear();
    },
  };
}

/** Inter-bubble gap: 4–6s (readable human pacing in messengers). */
export function humanBubbleGapMs(): number {
  return 4000 + Math.floor(Math.random() * 2000);
}

/** Cap + split a single long bubble into 2–4 short messenger bubbles. */
export function normalizeAiBubbles(rawBubbles: string[], max = 4): string[] {
  const MAX_CHARS = 140;
  const cleaned = rawBubbles.map((b) => String(b || '').trim()).filter(Boolean);
  if (!cleaned.length) return [];

  // Multi-bubble from model: keep up to max, hard-cap length per bubble.
  if (cleaned.length > 1) {
    return cleaned.slice(0, max).map((b) =>
      b.length > MAX_CHARS ? `${b.slice(0, MAX_CHARS - 1).trim()}…` : b,
    );
  }

  const text = cleaned[0];
  if (text.length < 110) return [text];

  const byPara = text
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (byPara.length >= 2 && byPara.length <= max) {
    return byPara.slice(0, max).map((b) =>
      b.length > MAX_CHARS ? `${b.slice(0, MAX_CHARS - 1).trim()}…` : b,
    );
  }

  const sentences = text
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length >= 2) {
    const out: string[] = [];
    let buf = '';
    for (const s of sentences) {
      const next = buf ? `${buf} ${s}` : s;
      if (buf && next.length > MAX_CHARS) {
        out.push(buf);
        buf = s;
        if (out.length >= max - 1) {
          buf = [buf, ...sentences.slice(sentences.indexOf(s) + 1)].join(' ');
          break;
        }
      } else {
        buf = next;
      }
    }
    if (buf.trim()) out.push(buf.trim());
    if (out.length >= 2) {
      return out.slice(0, max).map((b) =>
        b.length > MAX_CHARS ? `${b.slice(0, MAX_CHARS - 1).trim()}…` : b,
      );
    }
  }

  // Hard wrap long single bubble into ~2–3 chunks by words.
  const words = text.split(/\s+/);
  const chunkSize = Math.ceil(words.length / Math.min(max, 3));
  const chunks: string[] = [];
  for (let i = 0; i < words.length && chunks.length < max; i += chunkSize) {
    chunks.push(words.slice(i, i + chunkSize).join(' '));
  }
  return chunks
    .filter(Boolean)
    .map((b) => (b.length > MAX_CHARS ? `${b.slice(0, MAX_CHARS - 1).trim()}…` : b));
}
