/**
 * Debounce inbound user bursts so AI replies once after a quiet period
 * (n8n-style: wait until the client finishes sending short messages).
 *
 * While a flush is in-flight for a key, further pushes are queued and one
 * follow-up flush is scheduled after the current one finishes (avoids parallel
 * multi-bubble storms when the user pauses just longer than settleMs).
 */

export type InboundDebouncer<T> = {
  push: (key: string, item: T) => void;
  pendingCount: (key: string) => number;
  clear: (key?: string) => void;
  /** Abort the in-flight generation/send if active for this key. */
  abort: (key: string) => void;
};

/** Default quiet window after last user message (10s — short pauses still coalesce). */
export const DEFAULT_INBOUND_DEBOUNCE_MS = 10_000;

export function createInboundDebouncer<T>(opts: {
  /** Quiet window after last message before flush (default 10s). */
  settleMs?: number;
  onFlush: (key: string, items: T[], signal?: AbortSignal) => void | Promise<void>;
}): InboundDebouncer<T> {
  const settleMs = opts.settleMs !== undefined ? Math.max(10, opts.settleMs) : DEFAULT_INBOUND_DEBOUNCE_MS;
  const pending = new Map<string, { items: T[]; timer: ReturnType<typeof setTimeout> }>();
  const inFlight = new Map<string, Promise<void>>();
  const abortControllers = new Map<string, AbortController>();
  const queuedDuringFlight = new Map<string, T[]>();

  const schedule = (key: string, items: T[]) => {
    const cur = pending.get(key);
    if (cur) clearTimeout(cur.timer);
    const timer = setTimeout(() => {
      pending.delete(key);
      void startFlush(key, items);
    }, settleMs);
    pending.set(key, { items, timer });
  };

  const startFlush = async (key: string, items: T[]) => {
    if (inFlight.has(key)) {
      const q = queuedDuringFlight.get(key) || [];
      queuedDuringFlight.set(key, [...q, ...items]);
      return;
    }

    const controller = new AbortController();
    abortControllers.set(key, controller);

    const job = (async () => {
      try {
        await opts.onFlush(key, items, controller.signal);
      } catch (err) {
        if (controller.signal.aborted) {
          console.log('[inbound-debounce] onFlush aborted for key:', key);
        } else {
          console.error('[inbound-debounce] onFlush failed', key, err);
        }
      } finally {
        inFlight.delete(key);
        abortControllers.delete(key);
        const queued = queuedDuringFlight.get(key);
        queuedDuringFlight.delete(key);
        if (queued?.length) {
          schedule(key, queued);
        }
      }
    })();

    inFlight.set(key, job);
    await job;
  };

  return {
    push(key: string, item: T) {
      if (inFlight.has(key)) {
        // Abort the in-flight generation since new user message arrived
        const ac = abortControllers.get(key);
        if (ac && !ac.signal.aborted) {
          ac.abort();
        }
        const q = queuedDuringFlight.get(key) || [];
        queuedDuringFlight.set(key, [...q, item]);
        return;
      }
      const cur = pending.get(key);
      if (cur) clearTimeout(cur.timer);
      const items = cur ? [...cur.items, item] : [item];
      schedule(key, items);
    },
    pendingCount(key: string) {
      const pendingCount = pending.get(key)?.items.length ?? 0;
      const queued = queuedDuringFlight.get(key)?.length ?? 0;
      return pendingCount + queued;
    },
    abort(key: string) {
      const ac = abortControllers.get(key);
      if (ac && !ac.signal.aborted) {
        ac.abort();
      }
    },
    clear(key?: string) {
      if (key) {
        const cur = pending.get(key);
        if (cur) clearTimeout(cur.timer);
        pending.delete(key);
        queuedDuringFlight.delete(key);
        const ac = abortControllers.get(key);
        if (ac && !ac.signal.aborted) {
          ac.abort();
        }
        return;
      }
      for (const [, cur] of pending) clearTimeout(cur.timer);
      pending.clear();
      queuedDuringFlight.clear();
      for (const [, ac] of abortControllers) {
        if (!ac.signal.aborted) ac.abort();
      }
      abortControllers.clear();
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

/**
 * After an AiAgent prompt/settings edit (`updatedAt`), prior assistant turns still
 * few-shot the old persona and drown out the new system prompt. Drop those
 * assistant messages; keep user/operator facts for continuity.
 */
export function filterHistoryAfterAgentUpdate<
  T extends { role: string; createdAt: Date | string },
>(messages: T[], agentUpdatedAt: Date | string | null | undefined): T[] {
  if (!agentUpdatedAt || !messages.length) return messages;
  const cut =
    agentUpdatedAt instanceof Date
      ? agentUpdatedAt.getTime()
      : new Date(agentUpdatedAt).getTime();
  if (!Number.isFinite(cut)) return messages;
  // Drop *all* turns before the prompt change. Keeping orphan user lines without their
  // old assistant replies (WA long threads) few-shot'ит мусор → «не впопад» (INC-066).
  return messages.filter((m) => {
    const t =
      m.createdAt instanceof Date
        ? m.createdAt.getTime()
        : new Date(m.createdAt).getTime();
    return Number.isFinite(t) && t >= cut;
  });
}

/** Appended when a tenant agent is assigned so new instructions beat chat style. */
export const AGENT_PROMPT_PRIORITY_HINT = `

Приоритет: текущие инструкции выше важнее стиля и роли из истории переписки.`;

/**
 * Old assistant turns like «не могу просмотреть видео» few-shot refusals even when
 * the latest user line already has ASR/vision text (`[видео]: …`). Drop those.
 */
const MEDIA_CAPABILITY_REFUSAL_RE =
  /не\s+могу(?:\s+\S+){0,6}\s+(?:просмотреть|прослушать|обработать|посмотреть|открыть|прочитать|услышать)|могу\s+(?:работать|отвечать)\s+только\s+(?:с\s+текстом|на\s+текстов)|только\s+на\s+текстов(?:ые|ые\s+сообщения)|cannot\s+(?:view|watch|listen|process)\s+(?:the\s+)?(?:video|audio|media|voice)/i;

export function isMediaCapabilityRefusal(content: string): boolean {
  return MEDIA_CAPABILITY_REFUSAL_RE.test(String(content || ''));
}

/** True when ASR/vision/doc already put real text after a media tag (`[голос]: …`). */
export function hasEnrichedMediaTag(content: string): boolean {
  return /\[(?:голос(?:овое)?|кружочек|видео|фото|стикер|документ[^\]]*)\]:\s*\S+/i.test(
    String(content || ''),
  );
}

export function filterMediaCapabilityRefusals<
  T extends { role: string; content?: string | null },
>(messages: T[]): T[] {
  return messages.filter((m) => {
    if (m.role !== 'assistant') return true;
    return !isMediaCapabilityRefusal(String(m.content || ''));
  });
}

/** Near-identical AI replies within a short window (double flush / twin webhook). */
export function isNearDuplicateReply(a: string, b: string): boolean {
  const norm = (s: string) =>
    String(s || '')
      .replace(/\s+/g, ' ')
      .replace(/[.…]+$/g, '')
      .trim()
      .toLowerCase();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length < 48) return false;
  return longer.startsWith(shorter);
}

/**
 * Always append so the model uses ASR/vision/doc extracts, not bare media labels
 * (few-shot from old `[видео]` / `[файл:…]` placeholders taught «Это видео.»).
 */
export const MEDIA_INBOUND_HINT = `

Медиа во входящих уже распознаны системой. Теги:
- [голос]: текст / [кружочек]: текст / [видео]: текст — это ГОТОВАЯ расшифровка речи. Отвечай по смыслу текста после «:» как будто клиент написал его вручную (даже одно слово вроде «Голосовое.» / «Огонь.»).
- [фото]: … / [стикер]: … — описание картинки (ты «увидел»).
- [документ PDF]: … / [документ DOCX]: … — извлечённый текст (ты «прочитал»).
Пример: user «[видео]: это видео про заявку» → ответь про заявку, НЕ пиши что не видишь видео.
Пример: user «[голос]: Голосовое.» → ответь по слову «Голосовое», НЕ пиши «не могу прослушать».
Пример: user «[кружочек]: один» → ответь по слову «один», НЕ путай с голосом и НЕ отказывайся слушать.
Запрещено писать «не могу просмотреть/прослушать/обработать», «могу только текст», «ответьте текстом» — если после тега есть любой текст.
Голый тег без текста после «:» (например «[видео]» или «[голосовое]») — коротко попроси описать текстом; не выдумывай длинный отказ в «просмотре».
Отвечай по ПОСЛЕДНЕМУ входящему user-сообщению; если последнее — [фото], говори про фото, не про старое видео.`;

export const MEDIA_REFUSAL_RETRY_USER = `Система уже расшифровала медиа. В истории есть теги [голос]//[видео]//[фото]//[документ]: с текстом после «:». Ответь по этому тексту обычным полезным ответом. Запрещено снова писать, что ты не можешь прослушать/просмотреть.`;

