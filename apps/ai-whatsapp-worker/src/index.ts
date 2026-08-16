// Voxly AI WhatsApp Worker — Evolution API (Baileys QR), ADR-014
// Channel connect → Conversation + CRM lead always; AI reply only if AiAgent assigned.

import { prisma, upsertCrmRecordLink } from '@voxly/db';
import { decrypt, encrypt } from '@voxly/crypto';
import {
  chargeAiUsage,
  hasAiBalance,
  enqueueAiUsageCharge,
  buildUsageChargeKey,
  resolveProviderCostRub,
  retrieveAgentContext,
  formatRagPromptBlock,
  createInboundDebouncer,
  humanBubbleGapMs,
  normalizeAiBubbles,
  filterHistoryAfterAgentUpdate,
  filterMediaCapabilityRefusals,
  isMediaCapabilityRefusal,
  isNearDuplicateReply,
  hasEnrichedMediaTag,
  AGENT_PROMPT_PRIORITY_HINT,
  MEDIA_INBOUND_HINT,
  MEDIA_REFUSAL_RETRY_USER,
  DEFAULT_INBOUND_DEBOUNCE_MS,
  extractAudioFromVideo,
  detectDocumentKind,
  extractDocumentText,
  formatDocumentAiText,
  DOC_MEDIA_MAX_BYTES,
  type OpenRouterUsageLike,
  enqueueTimelineSync,
  buildTimelineSyncKey,
  type TimelineSyncJobData,
} from '@voxly/ai-core';
import { fireGoal } from '@voxly/analytics-dispatchers';
import { isAiConversationMode, PRODUCT_CODES, AI_MODEL_DEFAULTS, AI_USAGE_CHANNELS, isWithinMailingAttributionWindow, mailingAttributionNote, sleep, retryBackoffMs, fetchWithTimeout, invalidateCrmThreadCache, invalidateCrmUnreadCache, verifyServiceToken, resolveServiceToken, extractBearer } from '@voxly/shared';
import { TwentyClient, normalizePhoneToE164, phoneFingerprint } from '@voxly/twenty-client';
import OpenAI from 'openai';
import pg from 'pg';
import Redis from 'ioredis';

const PORT = Number(process.env.AI_WHATSAPP_PORT || 3006);
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
/**
 * Legacy opt-in for Contact-book-only avatar twin (history sync uses richer
 * profile-index match: fetchProfile pic/email/website — INC-097 v6).
 */
const ALLOW_AVATAR_PHONE_MATCH = process.env.WA_LID_AVATAR_PHONE_MATCH === '1';
/** Max PN profiles to fetchProfile when resolving LID chats (force sync may raise). */
const WA_PROFILE_INDEX_PN_CAP = Math.min(
  Math.max(Number(process.env.WA_PROFILE_INDEX_PN_CAP || 800), 50),
  3000,
);
/** Per-sync fetchProfile budget (IsOnWhatsapp/Message PN are prioritized first). */
const WA_PROFILE_FETCH_CAP = Math.min(
  Math.max(Number(process.env.WA_PROFILE_FETCH_CAP || 150), 30),
  WA_PROFILE_INDEX_PN_CAP,
);
const WEBHOOK_PUBLIC_URL =
  (process.env.AI_WHATSAPP_WEBHOOK_URL || `http://ai-whatsapp-worker:${PORT}/webhook/evolution`).replace(
    /\/$/,
    '',
  );
const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const CONTEXT_WINDOW = 20;
const AI_INBOUND_DEBOUNCE_MS = Math.max(
  500,
  Number(process.env.AI_INBOUND_DEBOUNCE_MS || DEFAULT_INBOUND_DEBOUNCE_MS) ||
    DEFAULT_INBOUND_DEBOUNCE_MS,
);
const DEFAULT_SYSTEM_PROMPT = `Ты — живой менеджер в WhatsApp. Пиши по-русски, коротко, как человек в чате.

КРИТИЧЕСКИ ВАЖНО: ответ — ТОЛЬКО JSON (без markdown, без текста вне JSON):
{
  "message1": "короткая фраза",
  "message2": "следующая мысль",
  "message3": "",
  "message4": ""
}
Правила пузырей:
- почти всегда 2–4 коротких сообщения (не один длинный абзац);
- 1 пузырь только если ответ в одно короткое предложение;
- каждое message — одна мысль, максимум 1–2 коротких предложения (~80–120 символов);
- не пиши эссе и не задавай сразу 3 вопроса в одном пузыре;
- пустые поля оставь "";
- без эмодзи, без переносов внутри строк.`;
const JSON_FORMAT_HINT = `

Ответь ТОЛЬКО JSON с message1…message4. Заполни 2–4 КОРОТКИХ пузыря (≤120 символов каждый). Не склеивай всё в message1.`;

/** Prefer column; fall back to settings.systemPrompt if an older client wrote there. */
function agentSystemPrompt(agent: {
  systemPrompt: string | null;
  settings: unknown;
} | null): string | null {
  const fromCol = agent?.systemPrompt?.trim();
  if (fromCol) return fromCol;
  const s = agent?.settings;
  if (s && typeof s === 'object') {
    const p = (s as Record<string, unknown>).systemPrompt;
    if (typeof p === 'string' && p.trim()) return p.trim();
  }
  return null;
}

type SessionPayload = {
  instanceName: string;
  instanceHash?: string;
};

type WaAiPending = {
  instanceName: string;
  from: string;
  conversationId: string;
  tenantId: string;
  botId: string;
  text: string;
  messageId?: string;
  /** Exact webhook remoteJid for blue-tick markRead. */
  remoteJid?: string;
  addonId?: string | null;
};

const inboundAiDebouncer = createInboundDebouncer<WaAiPending>({
  settleMs: AI_INBOUND_DEBOUNCE_MS,
  onFlush: async (_key, items, signal) => {
    if (!items.length) return;
    await flushWhatsAppAiReply(items, signal);
  },
});

/** Soft contact presence from Evolution PRESENCE_UPDATE (no on-demand GET). */
type CachedWaPresence = {
  online: boolean;
  lastSeenAt: string | null;
  updatedAt: number;
};
const waPresenceByKey = new Map<string, CachedWaPresence>();
const WA_PRESENCE_TTL_MS = 30 * 60 * 1000;
const WA_WEBHOOK_EVENTS = [
  'QRCODE_UPDATED',
  'CONNECTION_UPDATE',
  'MESSAGES_UPSERT',
  'PRESENCE_UPDATE',
] as const;

/** Debounce repeated history-sync requests (manual button / overlapping calls). */
const waHistorySyncStartedAt = new Map<string, number>();
const WA_HISTORY_SYNC_DEBOUNCE_MS = 2 * 60 * 1000;

type WaChatSyncSummary = {
  ok: boolean;
  dialogs: number;
  messagesUpserted: number;
  peopleSynced: number;
  skippedGroups: number;
  skippedSuppressed: number;
  skippedNoPhone: number;
  /** findChats row (or contact) with no stored messages — not an open dialog. */
  skippedNoMessages: number;
  /** Open chats kept Conversation-only (no E.164/real name) or skipped system peers. */
  skippedEmptyIdentity: number;
  repairedEmptyLeads: number;
  /** LID↔PN twin Conversations merged into one thread (INC-097 v6.1). */
  mergedTwinConversations: number;
  error?: string;
  note?: string;
};

function waPresenceCacheKey(instanceName: string, peer: string): string {
  return `${instanceName}:${normalizeWaNumber(peer) || peer}`;
}

function rememberWaPresence(
  instanceName: string,
  peerRaw: string,
  online: boolean,
  lastSeenAt: string | null,
): void {
  const peer = normalizeWaNumber(peerRaw) || String(peerRaw || '').replace(/\D/g, '');
  if (!instanceName || !peer) return;
  waPresenceByKey.set(waPresenceCacheKey(instanceName, peer), {
    online,
    lastSeenAt,
    updatedAt: Date.now(),
  });
}

function getCachedWaPresence(
  instanceName: string,
  peerRaw: string,
): CachedWaPresence | null {
  const peer = normalizeWaNumber(peerRaw) || String(peerRaw || '').replace(/\D/g, '');
  if (!instanceName || !peer) return null;
  const hit = waPresenceByKey.get(waPresenceCacheKey(instanceName, peer));
  if (!hit) return null;
  if (Date.now() - hit.updatedAt > WA_PRESENCE_TTL_MS) {
    waPresenceByKey.delete(waPresenceCacheKey(instanceName, peer));
    return null;
  }
  return hit;
}

function parsePresenceUpdatePayload(payload: any): void {
  const instanceName = String(
    payload?.instance || payload?.instanceName || payload?.data?.instanceName || '',
  ).trim();
  if (!instanceName) return;
  const data = payload?.data || payload;
  const presences = data?.presences;
  if (presences && typeof presences === 'object') {
    for (const [jid, info] of Object.entries(presences as Record<string, any>)) {
      const lastKnown = String(
        info?.lastKnownPresence || info?.presence || info?.status || '',
      ).toLowerCase();
      const online =
        lastKnown === 'available' ||
        lastKnown === 'composing' ||
        lastKnown === 'recording' ||
        lastKnown === 'paused';
      let lastSeenAt: string | null = null;
      const rawSeen = info?.lastSeen ?? info?.lastSeenAt ?? data?.lastSeen;
      if (typeof rawSeen === 'number' && Number.isFinite(rawSeen)) {
        const ms = rawSeen > 1e12 ? rawSeen : rawSeen * 1000;
        lastSeenAt = new Date(ms).toISOString();
      } else if (typeof rawSeen === 'string' && rawSeen) {
        const d = new Date(rawSeen);
        if (!Number.isNaN(d.getTime())) lastSeenAt = d.toISOString();
      }
      rememberWaPresence(instanceName, jid, online, online ? null : lastSeenAt);
    }
    return;
  }
  const jid = String(data?.id || data?.remoteJid || data?.from || '').trim();
  if (!jid) return;
  const lastKnown = String(
    data?.lastKnownPresence || data?.presence || data?.status || '',
  ).toLowerCase();
  if (!lastKnown) return;
  const online =
    lastKnown === 'available' ||
    lastKnown === 'composing' ||
    lastKnown === 'recording' ||
    lastKnown === 'paused';
  rememberWaPresence(instanceName, jid, online, null);
}

const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY || 'missing',
  baseURL: OPENROUTER_BASE_URL,
});

if (!OPENROUTER_API_KEY) {
  console.warn('[ai-whatsapp] OPENROUTER_API_KEY / OPENAI_API_KEY not set — AI replies disabled');
}
if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
  console.warn(
    '[ai-whatsapp] EVOLUTION_API_URL / EVOLUTION_API_KEY not set — QR connect will fail clearly',
  );
}

function requireServiceAuth(req: { headers: { authorization?: string } }): boolean {
  return verifyServiceToken(extractBearer(req.headers.authorization), 'ai-whatsapp-worker');
}

function evolutionConfigured(): boolean {
  return Boolean(EVOLUTION_API_URL && EVOLUTION_API_KEY);
}

function setupHint(): string {
  return (
    'Задайте EVOLUTION_API_URL и EVOLUTION_API_KEY, поднимите сервис evolution-api ' +
    '(docker compose --profile whatsapp up -d evolution-api) и перезапустите ai-whatsapp-worker.'
  );
}

async function evoFetch(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; json: any; ok: boolean }> {
  if (!evolutionConfigured()) {
    return {
      status: 503,
      ok: false,
      json: { ok: false, error: 'Evolution API not configured', hint: setupHint() },
    };
  }
  const headers = new Headers(init.headers || {});
  headers.set('apikey', EVOLUTION_API_KEY);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  try {
    // 429 on write ops → backoff (1s → 5s → 30s) and retry; read/poll paths pass through.
    const isRead = (init.method ?? 'GET').toUpperCase() === 'GET';
    let attempt = 0;
    for (;;) {
      const res = await fetchWithTimeout(`${EVOLUTION_API_URL}${path}`, { ...init, headers, timeout: 15000 });
      const json = await res.json().catch(() => ({}));
      if (res.status !== 429 || isRead || attempt >= 3) {
        return { status: res.status, json, ok: res.ok };
      }
      const backoffMs = retryBackoffMs(attempt);
      console.warn(
        `[ai-whatsapp] evo 429 ${path}, attempt=${attempt + 1}, backoff=${backoffMs}ms`,
      );
      await sleep(backoffMs);
      attempt += 1;
    }
  } catch (err) {
    return {
      status: 503,
      ok: false,
      json: {
        ok: false,
        error: 'Evolution API unavailable',
        detail: String((err as Error)?.message || err),
        hint: setupHint(),
      },
    };
  }
}

function readJsonBody(req: AsyncIterable<Buffer | string>): Promise<any> {
  return (async () => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (!body) return {};
    return JSON.parse(body);
  })();
}

function sendJson(res: any, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sanitizeName(name: string): string {
  const raw = String(name || 'default').trim();
  const ascii = raw
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 32);
  // Cyrillic / emoji-only labels become all underscores — Evolution breaks on that.
  // Stable ascii slug from a short hash of the original display name.
  if (!ascii || !/[a-z0-9]/.test(ascii)) {
    let h = 2166136261;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return `n${(h >>> 0).toString(36)}`.slice(0, 32);
  }
  return ascii;
}

function instanceNameFor(tenantId: string, name: string): string {
  const short = tenantId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || 't';
  return `wa_${short}_${sanitizeName(name)}`.slice(0, 60);
}

function decodeSession(encrypted: string | null | undefined): SessionPayload | null {
  if (!encrypted) return null;
  try {
    const raw = decrypt(encrypted);
    const parsed = JSON.parse(raw) as SessionPayload;
    if (!parsed?.instanceName) return null;
    return parsed;
  } catch {
    try {
      return { instanceName: decrypt(encrypted) };
    } catch {
      return null;
    }
  }
}

function encodeSession(payload: SessionPayload): string {
  return encrypt(JSON.stringify(payload));
}

function extractText(message: any): string | null {
  const classified = classifyWaInbound(message, undefined);
  return classified.text;
}

type WaAttachment = {
  type: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker';
  fileId: string;
  fileName?: string;
  mimeType?: string;
};

function classifyWaInbound(
  message: any,
  messageId: string | undefined,
): {
  text: string | null;
  attachments: WaAttachment[];
  needsVision: boolean;
  needsAsr: boolean;
  needsDoc?: boolean;
} {
  const attachments: WaAttachment[] = [];
  if (!message) {
    return { text: null, attachments, needsVision: false, needsAsr: false };
  }
  if (typeof message.conversation === 'string') {
    return {
      text: message.conversation,
      attachments,
      needsVision: false,
      needsAsr: false,
    };
  }
  if (message.extendedTextMessage?.text) {
    return {
      text: String(message.extendedTextMessage.text),
      attachments,
      needsVision: false,
      needsAsr: false,
    };
  }

  const fileId = messageId ? String(messageId) : '';

  if (message.imageMessage) {
    if (fileId) {
      attachments.push({
        type: 'photo',
        fileId,
        mimeType: message.imageMessage.mimetype || 'image/jpeg',
      });
    }
    const cap = message.imageMessage.caption
      ? String(message.imageMessage.caption).trim()
      : '';
    return {
      text: cap || '[фото]',
      attachments,
      needsVision: true,
      needsAsr: false,
    };
  }

  if (message.stickerMessage) {
    if (fileId) {
      attachments.push({
        type: 'sticker',
        fileId,
        mimeType: message.stickerMessage.mimetype || 'image/webp',
      });
    }
    return { text: '[стикер]', attachments, needsVision: true, needsAsr: false };
  }

  // WhatsApp video circle (push-to-video)
  if (message.ptvMessage) {
    if (fileId) {
      attachments.push({
        type: 'video',
        fileId,
        mimeType: message.ptvMessage.mimetype || 'video/mp4',
        fileName: 'video_note.mp4',
      });
    }
    return { text: '[кружочек]', attachments, needsVision: false, needsAsr: true };
  }

  if (message.videoMessage) {
    if (fileId) {
      attachments.push({
        type: 'video',
        fileId,
        mimeType: message.videoMessage.mimetype || 'video/mp4',
        fileName: message.videoMessage.fileName,
      });
    }
    const cap = message.videoMessage.caption
      ? String(message.videoMessage.caption).trim()
      : '';
    return {
      text: cap || '[видео]',
      attachments,
      needsVision: false,
      needsAsr: true,
    };
  }

  if (message.audioMessage) {
    const ptt = Boolean(message.audioMessage.ptt);
    if (fileId) {
      attachments.push({
        type: ptt ? 'voice' : 'audio',
        fileId,
        mimeType: message.audioMessage.mimetype || 'audio/ogg',
      });
    }
    return {
      text: ptt ? '[голосовое]' : '[аудио]',
      attachments,
      needsVision: false,
      needsAsr: true,
    };
  }

  if (message.documentMessage || message.documentWithCaptionMessage) {
    const doc =
      message.documentMessage ||
      message.documentWithCaptionMessage?.message?.documentMessage ||
      {};
    const mime = String(doc.mimetype || '').toLowerCase();
    const isDocVideo = mime.startsWith('video/');
    const docKind = !isDocVideo
      ? detectDocumentKind({ mimeType: mime, fileName: doc.fileName })
      : null;
    if (fileId) {
      attachments.push({
        type: isDocVideo ? 'video' : 'document',
        fileId,
        mimeType: doc.mimetype,
        fileName: doc.fileName,
      });
    }
    const cap = doc.caption ? String(doc.caption).trim() : '';
    return {
      text: cap || (isDocVideo ? '[видео]' : doc.fileName ? `[файл: ${doc.fileName}]` : '[документ]'),
      attachments,
      needsVision: false,
      needsAsr: isDocVideo,
      needsDoc: Boolean(docKind),
    };
  }

  if (message.contactMessage || message.contactsArrayMessage) {
    return { text: '[контакт]', attachments, needsVision: false, needsAsr: false };
  }

  return { text: null, attachments, needsVision: false, needsAsr: false };
}

async function fetchEvolutionMediaBase64(opts: {
  instanceName: string;
  messageId: string;
  remoteJid?: string;
  convertToMp4?: boolean;
  /** CRM outbound bubbles need fromMe=true; inbound false. Retry opposite on miss. */
  fromMe?: boolean;
}): Promise<{ base64: string; mimeType: string; fileName?: string } | null> {
  const remoteJid = opts.remoteJid
    ? opts.remoteJid.includes('@')
      ? opts.remoteJid
      : `${normalizeWaNumber(opts.remoteJid)}@s.whatsapp.net`
    : undefined;
  const tryOnce = async (fromMe: boolean | undefined) => {
    const key: Record<string, unknown> = { id: opts.messageId };
    if (remoteJid) {
      key.remoteJid = remoteJid;
      if (fromMe !== undefined) key.fromMe = fromMe;
    }
    const res = await evoFetch(
      `/chat/getBase64FromMediaMessage/${encodeURIComponent(opts.instanceName)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          message: { key },
          // Only convert video → mp4; converting audio/voice breaks ASR / playback.
          convertToMp4: Boolean(opts.convertToMp4),
        }),
      },
    );
    if (!res.ok) {
      console.warn(
        '[ai-whatsapp] getBase64FromMediaMessage failed',
        res.status,
        evolutionErrorMessage(res.json, ''),
        fromMe === undefined ? '' : `fromMe=${fromMe}`,
      );
      return null;
    }
    const b64 = String(res.json?.base64 || res.json?.base64Data || '').replace(
      /^data:[^;]+;base64,/,
      '',
    );
    if (!b64) return null;
    return {
      base64: b64,
      mimeType: String(res.json?.mimetype || res.json?.mimeType || 'application/octet-stream'),
      fileName: res.json?.fileName ? String(res.json.fileName) : undefined,
    };
  };

  const preferred =
    opts.fromMe !== undefined ? opts.fromMe : remoteJid ? false : undefined;
  let media = await tryOnce(preferred);
  // Outbound CRM fileIds often lack externalMessageId — retry opposite fromMe.
  if (!media && preferred !== undefined) {
    media = await tryOnce(!preferred);
  }
  if (!media && preferred === undefined && remoteJid) {
    media = (await tryOnce(false)) || (await tryOnce(true));
  }
  return media;
}

async function describeWaImage(
  buffer: Buffer,
  mime: string,
  caption: string | undefined,
  model: string,
): Promise<{ text: string; usage?: OpenRouterUsageLike } | null> {
  if (!OPENROUTER_API_KEY) return null;
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const prompt =
    'Опиши изображение кратко для ассистента-продавца: что на фото, текст/цены если видны. 1–3 предложения на русском, только факты.' +
    (caption ? ` Подпись пользователя: ${caption}` : '');
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: 300,
    temperature: 0.2,
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) return null;
  return { text, usage: completion.usage as OpenRouterUsageLike | undefined };
}

async function transcribeWaAudio(
  buffer: Buffer,
  format: string,
  model: string,
): Promise<{ text: string; usage?: OpenRouterUsageLike } | null> {
  if (!OPENROUTER_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let res: Response;
  try {
    res = await fetchWithTimeout(`${OPENROUTER_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.VOXLY_PUBLIC_URL || 'https://getvoxly.ru',
        'X-Title': 'Voxly AI WhatsApp ASR',
      },
      body: JSON.stringify({
        model,
        language: 'ru',
        input_audio: {
          data: buffer.toString('base64'),
          format,
        },
      }),
      signal: controller.signal,
      timeout: 45000,
    });
  } catch (err) {
    console.error('[ai-whatsapp] transcription fetch failed', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[ai-whatsapp] transcription HTTP', res.status, errText.slice(0, 400));
    return null;
  }
  const data = (await res.json()) as { text?: string; usage?: OpenRouterUsageLike };
  const text = data.text?.trim();
  if (!text) return null;
  return { text, usage: data.usage };
}

function audioFormatFromWaMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('flac')) return 'flac';
  if (m.includes('m4a') || m.includes('mp4')) return 'm4a';
  if (m.includes('webm')) return 'webm';
  if (m.includes('aac')) return 'aac';
  return 'ogg';
}

async function enrichWaTextWithMediaAi(opts: {
  tenantId: string;
  instanceName: string;
  messageId: string;
  remoteJid?: string;
  text: string;
  needsVision: boolean;
  needsAsr: boolean;
  needsDoc?: boolean;
  mimeHint?: string;
  fileNameHint?: string;
}): Promise<string> {
  if (
    !OPENROUTER_API_KEY ||
    (!opts.needsVision && !opts.needsAsr && !opts.needsDoc)
  ) {
    return opts.text;
  }
  const looksLikeVideoNote =
    opts.text === '[кружочек]' ||
    /video_note/i.test(opts.mimeHint || '') ||
    /video_note/i.test(opts.text);
  const looksLikeVideo =
    !looksLikeVideoNote &&
    (opts.text === '[видео]' || (opts.mimeHint || '').startsWith('video/'));
  const isVideoMedia = looksLikeVideoNote || looksLikeVideo;
  const docKind = opts.needsDoc
    ? detectDocumentKind({
        mimeType: opts.mimeHint,
        fileName: opts.fileNameHint,
      })
    : null;

  // Phase 3.2: pre-check wallet before paid ASR/vision. Docs are extracted locally (free).
  // No balance → skip the paid call and drop a placeholder so the message still lands in CRM.
  if (!docKind && (opts.needsAsr || opts.needsVision)) {
    if (!(await hasAiBalance(opts.tenantId, 1))) {
      const preCaption =
        opts.text.startsWith('[') && opts.text.endsWith(']')
          ? undefined
          : opts.text;
      const placeholder = looksLikeVideoNote
        ? '[кружочек]'
        : looksLikeVideo
          ? '[видео]'
          : opts.needsAsr
            ? '[голосовое]'
            : '[фото]';
      return preCaption ? `${preCaption}\n\n${placeholder}` : placeholder;
    }
  }

  const media = await fetchEvolutionMediaBase64({
    instanceName: opts.instanceName,
    messageId: opts.messageId,
    remoteJid: opts.remoteJid,
    convertToMp4: isVideoMedia,
  });
  if (!media) {
    if (docKind) {
      return formatDocumentAiText({ kind: docKind, text: null });
    }
    if (looksLikeVideoNote) {
      return opts.text.includes('не удалось')
        ? opts.text
        : '[кружочек — не удалось разобрать речь. Опиши текстом, пожалуйста.]';
    }
    if (looksLikeVideo) {
      return opts.text.includes('не удалось')
        ? opts.text
        : '[видео — не удалось разобрать речь. Опиши текстом, пожалуйста.]';
    }
    return opts.text;
  }
  const buffer = Buffer.from(media.base64, 'base64');
  const caption =
    opts.text.startsWith('[') && opts.text.endsWith(']') ? undefined : opts.text;
  const asrMax = 20 * 1024 * 1024;
  if (buffer.length === 0 || (isVideoMedia && buffer.length > asrMax)) {
    if (looksLikeVideoNote) {
      return caption
        ? `${caption}\n\n[кружочек — не удалось разобрать речь. Опиши текстом, пожалуйста.]`
        : '[кружочек — не удалось разобрать речь. Опиши текстом, пожалуйста.]';
    }
    if (looksLikeVideo) {
      return caption
        ? `${caption}\n\n[видео — не удалось разобрать речь. Опиши текстом, пожалуйста.]`
        : '[видео — не удалось разобрать речь. Опиши текстом, пожалуйста.]';
    }
    return opts.text;
  }
  const mime = media.mimeType || opts.mimeHint || 'application/octet-stream';

  try {
    if (docKind) {
      if (buffer.length > DOC_MEDIA_MAX_BYTES) {
        return formatDocumentAiText({ kind: docKind, text: null, caption });
      }
      const extracted = await extractDocumentText(buffer, docKind);
      return formatDocumentAiText({
        kind: docKind,
        text: extracted,
        caption,
        fileName: opts.fileNameHint,
      });
    }
    if (opts.needsAsr) {
      const asrModel =
        process.env.AI_ASR_MODEL || AI_MODEL_DEFAULTS.asr;
      let asrBuf: Buffer = buffer;
      let format = isVideoMedia ? 'mp4' : audioFormatFromWaMime(mime);
      if (isVideoMedia) {
        const extracted = await extractAudioFromVideo(buffer, 'mp4');
        if (extracted) {
          asrBuf = Buffer.from(extracted.buffer);
          format = extracted.format;
          console.log(
            `[ai-whatsapp] ffmpeg audio ${extracted.format} ${extracted.buffer.length}b (from ${buffer.length}b)`,
          );
        } else {
          console.warn('[ai-whatsapp] ffmpeg audio extract failed; trying raw mp4');
        }
      }
      const asr = await transcribeWaAudio(asrBuf, format, asrModel);
      if (asr?.text) {
        const estTokens = Math.max(1, Math.ceil(asr.text.length / 4));
        void resolveProviderCostRub({
          model: asrModel,
          usage: asr.usage || { total_tokens: estTokens },
          apiKey: OPENROUTER_API_KEY,
          baseUrl: OPENROUTER_BASE_URL,
        })
          .then((cost) =>
            // Phase 3.3: durable + idempotent charge (retries survive a worker crash).
            enqueueAiUsageCharge({
              tenantId: opts.tenantId,
              providerCostRub: cost.providerCostRub,
              tokens: cost.tokens || estTokens,
              model: asrModel,
              requestType: 'transcribe',
              channel: AI_USAGE_CHANNELS.WHATSAPP,
              usageChargeKey: buildUsageChargeKey({
                channel: AI_USAGE_CHANNELS.WHATSAPP,
                tenantId: opts.tenantId,
                requestType: 'transcribe',
                externalId: opts.messageId,
              }),
            }),
          )
          .catch((err) => console.warn('[ai-whatsapp] ASR charge failed', err));
        const tag = looksLikeVideoNote
          ? '[кружочек]'
          : looksLikeVideo
            ? '[видео]'
            : '[голос]';
        return caption ? `${caption}\n\n${tag}: ${asr.text}` : `${tag}: ${asr.text}`;
      }
      if (looksLikeVideoNote) {
        return caption
          ? `${caption}\n\n[кружочек — не удалось разобрать речь. Опиши текстом, пожалуйста.]`
          : '[кружочек — не удалось разобрать речь. Опиши текстом, пожалуйста.]';
      }
      if (looksLikeVideo) {
        return caption
          ? `${caption}\n\n[видео — не удалось разобрать речь. Опиши текстом, пожалуйста.]`
          : '[видео — не удалось разобрать речь. Опиши текстом, пожалуйста.]';
      }
    }
    if (opts.needsVision) {
      const visionModel = process.env.AI_CHAT_MODEL || AI_MODEL_DEFAULTS.chat;
      const vision = await describeWaImage(buffer, mime, caption, visionModel);
      if (vision?.text) {
        const estTokens = Math.max(1, Math.ceil(vision.text.length / 4));
        void resolveProviderCostRub({
          model: visionModel,
          usage: vision.usage || { total_tokens: estTokens },
          apiKey: OPENROUTER_API_KEY,
          baseUrl: OPENROUTER_BASE_URL,
        })
          .then((cost) =>
            // Phase 3.3: durable + idempotent charge (retries survive a worker crash).
            enqueueAiUsageCharge({
              tenantId: opts.tenantId,
              providerCostRub: cost.providerCostRub,
              tokens: cost.tokens || estTokens,
              model: visionModel,
              requestType: 'vision',
              channel: AI_USAGE_CHANNELS.WHATSAPP,
              usageChargeKey: buildUsageChargeKey({
                channel: AI_USAGE_CHANNELS.WHATSAPP,
                tenantId: opts.tenantId,
                requestType: 'vision',
                externalId: opts.messageId,
              }),
            }),
          )
          .catch((err) => console.warn('[ai-whatsapp] vision charge failed', err));
        const tag = mime.includes('webp') ? '[стикер]' : '[фото]';
        return caption ? `${caption}\n\n${tag}: ${vision.text}` : `${tag}: ${vision.text}`;
      }
    }
  } catch (err) {
    console.warn('[ai-whatsapp] media AI failed', err);
  }
  if (looksLikeVideoNote) {
    return caption
      ? `${caption}\n\n[кружочек — не удалось разобрать речь. Опиши текстом, пожалуйста.]`
      : '[кружочек — не удалось разобрать речь. Опиши текстом, пожалуйста.]';
  }
  if (looksLikeVideo) {
    return caption
      ? `${caption}\n\n[видео — не удалось разобрать речь. Опиши текстом, пожалуйста.]`
      : '[видео — не удалось разобрать речь. Опиши текстом, пожалуйста.]';
  }
  return opts.text;
}

/** Phone from shared WA contact card / vCard (when peer shares contact). */
function extractPhoneFromWaContactMessage(message: any): string | undefined {
  const cards: any[] = [];
  if (message?.contactMessage) cards.push(message.contactMessage);
  const arr = message?.contactsArrayMessage?.contacts;
  if (Array.isArray(arr)) cards.push(...arr);
  for (const card of cards) {
    const vcard = String(card?.vcard || card?.vCard || '');
    const fromVcard = vcard.match(/TEL[^:]*:([+\d\s()-]+)/i);
    if (fromVcard?.[1]) {
      const digits = extractWaPhoneE164(fromVcard[1]);
      if (digits) return digits;
    }
    const direct = extractWaPhoneE164(
      card?.phoneNumber,
      card?.phone,
      card?.displayName,
    );
    if (direct) return direct;
  }
  return undefined;
}

function normalizeWaNumber(jidOrNumber: string): string {
  return String(jidOrNumber || '')
    .replace(/@.*/, '')
    .replace(/\D/g, '');
}

/** True E.164-ish digits for Twenty Person.phones (skip WA @lid / device ids). */
function isLikelyE164Phone(digits: string): boolean {
  const n = String(digits || '').replace(/\D/g, '');
  // WA Linked IDs are typically 14–16 digits; real mobiles with country code are usually 10–13.
  // Min 10 rejects CUID digit scraps (e.g. cmrx…003…45…0…5 → "20034505", INC-060).
  return n.length >= 10 && n.length <= 13;
}

/** WhatsApp Linked ID (@lid) — not a dialable phone; Evolution must receive `digits@lid`. */
function isWhatsAppLid(jidOrNumber: string): boolean {
  const raw = String(jidOrNumber || '').trim().toLowerCase();
  if (raw.includes('@lid')) return true;
  return normalizeWaNumber(raw).length >= 14;
}

/**
 * Format recipient for Evolution sendText.
 * Digits-only LIDs become `@s.whatsapp.net` inside Evolution and fail with exists:false (400).
 */
function formatWaSendRecipient(to: string): string {
  const raw = String(to || '').trim();
  if (!raw) return '';
  if (raw.includes('@')) {
    return raw.replace(/:\d+(?=@)/, '');
  }
  const digits = normalizeWaNumber(raw);
  if (!digits) return '';
  if (isWhatsAppLid(digits)) {
    return `${digits}@lid`;
  }
  return digits;
}

function evolutionErrorMessage(json: any, fallback: string): string {
  if (!json || typeof json !== 'object') return fallback;
  if (typeof json.error === 'string' && json.error !== 'Bad Request') return json.error;
  if (typeof json.message === 'string') return json.message;
  const nested = json.response?.message ?? json.message;
  if (Array.isArray(nested) && nested.length) {
    const first = nested[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const jid = typeof first.jid === 'string' ? first.jid : '';
      if (first.exists === false && jid.includes('@lid')) {
        return `WhatsApp LID peer rejected by Evolution (${jid}). Update Evolution LID bypass or resolve to phone.`;
      }
      if (first.exists === false) {
        return `WhatsApp number not found (${jid || first.number || 'unknown'})`;
      }
      try {
        return JSON.stringify(first);
      } catch {
        /* ignore */
      }
    }
  }
  if (typeof json.error === 'string') return json.error;
  return fallback;
}

/** Collect candidate JIDs/PNs from Evolution upsert payloads (field names vary by version). */
function waInboundIdentityCandidates(item: any): string[] {
  const key = item?.key || {};
  const ctx = item?.message?.messageContextInfo || {};
  const contact = item?.contact || item?.senderContact || {};
  return [
    // Baileys / Evolution 2.3+: PN twin when remoteJid is @lid
    key.remoteJidAlt,
    item?.remoteJidAlt,
    key.participantAlt,
    item?.participantAlt,
    item?.senderPn,
    key.senderPn,
    item?.participantPn,
    key.participantPn,
    item?.sender_pn,
    key.sender_pn,
    item?.participant_pn,
    key.participant_pn,
    // Addressing / enriched contact (newer Evolution)
    item?.addressingMode === 'pn' ? key.remoteJid : undefined,
    contact?.remoteJidAlt,
    contact?.remoteJid,
    contact?.id,
    contact?.phoneNumber,
    contact?.phone,
    contact?.number,
    item?.phoneNumber,
    item?.phone,
    item?.number,
    // Nested context
    ctx.remoteJidAlt,
    ctx.participantAlt,
    ctx.participant,
    ctx.remoteJid,
    // LID itself last — extractWaPhoneE164 skips @lid
    item?.senderLid,
    key.senderLid,
    item?.remoteJid,
    key.remoteJid,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);
}

/** Explicit PN-ish fields on an Evolution Contact/Chat row (never invent from avatar). */
function extractPhoneFromEvoRow(row: any): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  // Never pass row.id — Evolution Contact ids are CUIDs; stripping non-digits yields
  // garbage like "20034505" from "cmrxq2epw003jt45it0gun5tz" (INC-060).
  // Never pass row.owner here for Chat rows — owner is often the WA account's own number.
  return extractWaPhoneE164(
    row.remoteJidAlt,
    row.senderPn,
    row.participantPn,
    row.participantAlt,
    row.phone,
    row.phoneNumber,
    row.number,
    // Only accept remoteJid when it is already @s.whatsapp.net / bare E.164 (not @lid).
    String(row.remoteJid || '').toLowerCase().includes('@lid') ? undefined : row.remoteJid,
  );
}

/** Stable fingerprint from WA CDN avatar URL (query params rotate). */
function profilePicFingerprint(url?: string | null): string | undefined {
  const raw = String(url || '').trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    const base = u.pathname.split('/').filter(Boolean).pop() || '';
    const stem = base.replace(/\.(jpe?g|png|webp)$/i, '');
    return stem || undefined;
  } catch {
    const m = raw.match(/\/([0-9]+_[0-9]+_[0-9]+)(?:_n)?\.(?:jpe?g|png|webp)/i);
    return m?.[1];
  }
}

type EvoContactRow = {
  remoteJid?: string;
  pushName?: string | null;
  profilePicUrl?: string | null;
};

type LidPnSource =
  | 'webhook'
  | 'vcard'
  | 'contact_row'
  | 'chat_row'
  | 'avatar_twin'
  | 'cached'
  | 'lid_mapping'
  | 'is_on_whatsapp'
  | 'whatsapp_numbers'
  | 'message_key'
  | 'message'
  | 'none';

/** Evolution stores Baileys auth in Redis DB 6: hash `evolution:instance:{uuid}`. */
function evolutionRedisUri(): string {
  if (process.env.EVOLUTION_REDIS_URI?.trim()) {
    return process.env.EVOLUTION_REDIS_URI.trim();
  }
  if (process.env.CACHE_REDIS_URI?.trim()) {
    return process.env.CACHE_REDIS_URI.trim();
  }
  const base = process.env.REDIS_URL || 'redis://redis:6379';
  try {
    const u = new URL(base);
    u.pathname = '/6';
    return u.toString();
  } catch {
    return 'redis://redis:6379/6';
  }
}
const EVOLUTION_REDIS_URI = evolutionRedisUri();

let evolutionRedis: Redis | null = null;
function getEvolutionRedis(): Redis {
  if (!evolutionRedis) {
    evolutionRedis = new Redis(EVOLUTION_REDIS_URI, {
      maxRetriesPerRequest: 1,
      enableReadyCheck: false,
      lazyConnect: true,
    });
  }
  return evolutionRedis;
}

/** Redis for CRM thread-list cache invalidation (Phase 2.2), on the default queue DB (not Evolution's /6). Lazy. */
const CRM_CACHE_REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const crmCacheRedis = new Redis(CRM_CACHE_REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

function evolutionDbUrl(): string | undefined {
  if (process.env.EVOLUTION_DATABASE_URL?.trim()) {
    return process.env.EVOLUTION_DATABASE_URL.trim();
  }
  const base = process.env.DATABASE_URL || '';
  if (!base) return undefined;
  try {
    const u = new URL(base);
    u.pathname = '/evolution';
    u.search = '';
    return u.toString();
  } catch {
    return undefined;
  }
}

const evolutionInstanceIdCache = new Map<string, string>();

type WaPeerProfile = {
  phone?: string;
  lidDigits?: string;
  email?: string;
  websiteHost?: string;
  picFp?: string;
  name?: string;
};

type WaProfilePnIndex = {
  byPic: Map<string, string>;
  byEmail: Map<string, string>;
  byWebsite: Map<string, string>;
  profiles: Map<string, WaPeerProfile>;
};

type ContactBookEntry = {
  remoteJid: string;
  phone?: string;
  lidDigits?: string;
  pushName?: string;
  profilePicUrl?: string;
};

type EvolutionContactBook = {
  byLid: Map<string, ContactBookEntry>;
  byPhone: Map<string, ContactBookEntry>;
  /** Lowercased unique pushName → PN entry (only when name is unique across book). */
  byUniqueName: Map<string, ContactBookEntry>;
  phoneEntries: ContactBookEntry[];
};

function websiteHostKey(raw?: string | null): string | undefined {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  return s && s.includes('.') ? s : undefined;
}

/** fetchProfile/fetchBusinessProfile on unmapped @lid returns linked-account wuid/wid (INC-097 v8.2). */
function isPoisonedWaLinkedAccountProfile(
  wuidOrWid: string,
  ownPhoneDigits?: string | null,
  opts?: { asLid?: boolean; hasAltPn?: boolean; requestedDigits?: string },
): boolean {
  const own = ownPhoneDigits ? normalizeWaNumber(ownPhoneDigits) : undefined;
  if (!own) return false;
  const raw = String(wuidOrWid || '').toLowerCase();
  const wuidPhone =
    extractWaPhoneE164(raw) ||
    normalizeWaNumber(raw.split('@')[0]?.split(':')[0] || '');
  if (!wuidPhone || wuidPhone !== own) return false;
  if (opts?.hasAltPn) return false;
  if (opts?.asLid) return true;
  const req = opts?.requestedDigits ? normalizeWaNumber(opts.requestedDigits) : undefined;
  return !req || req !== own;
}

async function loadPnCandidatesFromEvolutionDb(
  instanceName: string,
  opts?: {
    /** Scope Message / IsOnWhatsapp to open findChats JIDs (INC-097 v7.1). */
    openRemoteJids?: string[];
    /** Bulk Contact table — enrich-only; never primary profile-index fill. */
    includeContactBook?: boolean;
  },
): Promise<string[]> {
  const instanceId = await resolveEvolutionInstanceId(instanceName);
  const uri = evolutionDbUrl();
  if (!instanceId || !uri) return [];
  const client = new pg.Client({ connectionString: uri });
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null) => {
    const p =
      raw && isLikelyE164Phone(extractWaPhoneE164(raw) || raw)
        ? extractWaPhoneE164(raw) || raw
        : undefined;
    if (!p || seen.has(p)) return;
    seen.add(p);
    ordered.push(p);
  };
  const openJids = (opts?.openRemoteJids || [])
    .map((j) => String(j || '').trim().toLowerCase())
    .filter(Boolean);
  try {
    await client.connect();
    if (openJids.length) {
      const pnJids = openJids.filter((j) => j.includes('@s.whatsapp.net'));
      const lidJids = openJids.filter((j) => j.includes('@lid'));
      for (const jid of pnJids) push(jid);
      if (lidJids.length) {
        const onWa = await client.query<{ remoteJid: string; jidOptions: string }>(
          `SELECT "remoteJid", "jidOptions" FROM "IsOnWhatsapp"
           WHERE "remoteJid" = ANY($1::text[])
              OR "jidOptions" LIKE ANY($2::text[])
           LIMIT 40`,
          [lidJids, lidJids.map((l) => `%${l}%`)],
        );
        for (const row of onWa.rows) {
          push(
            phoneFromJidOptions(row.jidOptions, row.remoteJid) ||
              extractWaPhoneE164(row.remoteJid),
          );
        }
        const altRes = await client.query<{ alt: string | null; pn: string | null }>(
          `SELECT DISTINCT ("key"->>'remoteJidAlt') AS alt, ("key"->>'senderPn') AS pn
           FROM "Message"
           WHERE "instanceId" = $1
             AND lower(("key"->>'remoteJid')) = ANY($2::text[])
           LIMIT 40`,
          [instanceId, lidJids],
        );
        for (const row of altRes.rows) {
          push(row.alt);
          push(row.pn);
        }
      }
    } else {
      const msgs = await client.query<{ remoteJid: string }>(
        `SELECT DISTINCT ("key"->>'remoteJid') AS "remoteJid"
         FROM "Message"
         WHERE "instanceId" = $1
           AND ("key"->>'remoteJid') LIKE '%@s.whatsapp.net'
         LIMIT $2`,
        [instanceId, WA_PROFILE_INDEX_PN_CAP],
      );
      for (const row of msgs.rows) push(row.remoteJid);
      const onWa = await client.query<{ remoteJid: string }>(
        `SELECT "remoteJid" FROM "IsOnWhatsapp"
         WHERE "remoteJid" LIKE '%@s.whatsapp.net'
         ORDER BY "updatedAt" DESC NULLS LAST
         LIMIT $1`,
        [WA_PROFILE_INDEX_PN_CAP],
      );
      for (const row of onWa.rows) push(row.remoteJid);
    }
    if (opts?.includeContactBook) {
      const contacts = await client.query<{ remoteJid: string }>(
        `SELECT "remoteJid" FROM "Contact"
         WHERE "instanceId" = $1 AND "remoteJid" LIKE '%@s.whatsapp.net'
         LIMIT $2`,
        [instanceId, WA_PROFILE_INDEX_PN_CAP],
      );
      for (const row of contacts.rows) push(row.remoteJid);
    }
  } catch (err) {
    console.warn(
      '[ai-whatsapp] loadPnCandidatesFromEvolutionDb failed',
      err instanceof Error ? err.message : err,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
  return ordered;
}

type OpenWaPrivateChat = { chat: any; remoteJid: string };

/** Open private findChats peers — profile-index / repair scope (INC-097 v7.1). */
type OpenWaChatPeers = {
  lidDigits: Set<string>;
  phones: Set<string>;
  pnPhones: Set<string>;
  remoteJids: Set<string>;
};

function collectOpenWaChatPeers(
  chats: OpenWaPrivateChat[],
  ownPhoneDigits?: string | null,
): OpenWaChatPeers {
  const lidDigits = new Set<string>();
  const phones = new Set<string>();
  const pnPhones = new Set<string>();
  const remoteJids = new Set<string>();
  const own = ownPhoneDigits ? normalizeWaNumber(ownPhoneDigits) : undefined;
  for (const { chat, remoteJid } of chats) {
    const j = String(remoteJid || '').trim();
    if (!j) continue;
    remoteJids.add(j.toLowerCase());
    const pn =
      extractWaPhoneE164(remoteJid, chat?.remoteJidAlt, chat?.senderPn) ||
      extractPhoneFromEvoRow(chat);
    if (pn && isLikelyE164Phone(pn) && pn !== own) {
      phones.add(pn);
      // remoteJidAlt on @lid chats must feed profile-index PN candidates (INC-097 v8.2).
      if (j.toLowerCase().includes('@s.whatsapp.net') || isWhatsAppLid(j)) {
        pnPhones.add(pn);
      }
    }
    if (isWhatsAppLid(remoteJid)) {
      lidDigits.add(normalizeWaNumber(remoteJid));
    }
  }
  return { lidDigits, phones, pnPhones, remoteJids };
}

function openPeerConversationOr(
  peers: OpenWaChatPeers,
): Array<{ platformUserId: string } | { platformUsername: string }> {
  const or: Array<{ platformUserId: string } | { platformUsername: string }> = [];
  for (const lid of peers.lidDigits) or.push({ platformUserId: lid });
  for (const phone of peers.phones) {
    or.push({ platformUserId: phone });
    or.push({ platformUsername: `+${phone}` });
  }
  return or;
}

async function fetchOpenWaPrivateChats(
  instanceName: string,
  ownPhoneDigits?: string | null,
): Promise<{ chats: OpenWaPrivateChat[]; skippedGroups: number }> {
  const chatsRes = await evoFetch(
    `/chat/findChats/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body: JSON.stringify({ where: {} }) },
  );
  if (!chatsRes.ok) {
    return { chats: [], skippedGroups: 0 };
  }
  const allChats = unwrapEvoRows(chatsRes.json, ['chats', 'records', 'data']);
  let skippedGroups = 0;
  const chats = allChats
    .map((c) => {
      const remoteJid = String(
        c?.remoteJid || c?.id || c?.key?.remoteJid || '',
      ).trim();
      return { chat: c, remoteJid };
    })
    .filter(({ remoteJid }) => {
      if (!remoteJid) return false;
      if (!isPrivateWaRemoteJid(remoteJid)) {
        skippedGroups += 1;
        return false;
      }
      if (isWaSystemOrSelfJid(remoteJid, ownPhoneDigits)) {
        skippedGroups += 1;
        return false;
      }
      return true;
    });
  chats.sort((a, b) => chatActivityTs(b.chat) - chatActivityTs(a.chat));
  return { chats, skippedGroups };
}

/** Prioritize open-chat + message/IsOnWhatsapp PN before bulk Contact book (INC-097 v6). */
function collectPnProfileIndexCandidates(opts: {
  openPnPhones: Iterable<string>;
  dbPhones: string[];
}): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string) => {
    const p = raw && isLikelyE164Phone(raw) ? raw : undefined;
    if (!p || seen.has(p)) return;
    seen.add(p);
    ordered.push(p);
  };
  for (const p of opts.openPnPhones) push(p);
  for (const p of opts.dbPhones) push(p);
  return ordered;
}

async function fetchWaPeerProfile(
  instanceName: string,
  numberOrLid: string,
  ownPhoneDigits?: string | null,
): Promise<WaPeerProfile | null> {
  const raw = String(numberOrLid || '').trim();
  if (!instanceName || !raw) return null;
  const digits = normalizeWaNumber(raw);
  const asLid = isWhatsAppLid(raw) || (digits.length > 14 && !raw.includes('@s.whatsapp.net'));
  const number = asLid ? `${digits}@lid` : digits;
  const profileRes = await evoFetch(
    `/chat/fetchProfile/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body: JSON.stringify({ number }) },
  );
  if (!profileRes.ok || !profileRes.json) return null;
  const p = profileRes.json as Record<string, unknown>;
  const wuid = String(p.wuid || '').toLowerCase();
  const email = String(p.email || '')
    .trim()
    .toLowerCase();
  const websiteRaw = Array.isArray(p.website)
    ? String(p.website[0] || '')
    : String(p.website || '');
  const picture = String(p.picture || p.profilePicUrl || '');
  const phoneFromAlt = extractWaPhoneE164(
    p.remoteJidAlt as string | undefined,
    p.senderPn as string | undefined,
  );
  const phoneFromWuid = extractWaPhoneE164(wuid);
  const poisoned = isPoisonedWaLinkedAccountProfile(wuid, ownPhoneDigits, {
    asLid,
    hasAltPn: Boolean(phoneFromAlt),
    requestedDigits: asLid ? undefined : digits,
  });
  const name = cleanWaContactName(
    String(p.verifiedName || p.name || p.businessName || ''),
    phoneFromAlt || phoneFromWuid || digits,
  );
  return {
    phone:
      (phoneFromAlt && isLikelyE164Phone(phoneFromAlt) ? phoneFromAlt : undefined) ||
      (!poisoned && phoneFromWuid && isLikelyE164Phone(phoneFromWuid)
        ? phoneFromWuid
        : undefined),
    lidDigits:
      !poisoned && wuid.includes('@lid') ? normalizeWaNumber(wuid) : undefined,
    email: !poisoned && email.includes('@') ? email : undefined,
    websiteHost: !poisoned ? websiteHostKey(websiteRaw) : undefined,
    picFp: profilePicFingerprint(picture),
    name: !poisoned && name && name !== 'WhatsApp' ? name : undefined,
  };
}

function indexPnProfile(index: WaProfilePnIndex, phone: string, profile: WaPeerProfile) {
  index.profiles.set(phone, { ...profile, phone });
  if (profile.picFp && !index.byPic.has(profile.picFp)) {
    index.byPic.set(profile.picFp, phone);
  }
  if (profile.email && !index.byEmail.has(profile.email)) {
    index.byEmail.set(profile.email, phone);
  }
  if (profile.websiteHost && !index.byWebsite.has(profile.websiteHost)) {
    index.byWebsite.set(profile.websiteHost, phone);
  }
}

function matchPhoneFromProfileIndex(
  index: WaProfilePnIndex,
  lidProfile: WaPeerProfile,
  pushName?: string,
): string | undefined {
  if (lidProfile.email) {
    const hit = index.byEmail.get(lidProfile.email);
    if (hit) return hit;
  }
  if (lidProfile.websiteHost) {
    const hit = index.byWebsite.get(lidProfile.websiteHost);
    if (hit) return hit;
  }
  if (!ALLOW_AVATAR_PHONE_MATCH) return undefined;
  if (lidProfile.picFp) {
    const hit = index.byPic.get(lidProfile.picFp);
    if (hit) return hit;
  }
  const hint = normalizeContactBookName(lidProfile.name || pushName).replace(/[\s-]+/g, '');
  if (hint.length >= 4) {
    const hostHits: string[] = [];
    for (const [phone, profile] of index.profiles) {
      const stem = profile.websiteHost?.split('.')[0] || '';
      if (stem && (hint.includes(stem) || stem.includes(hint))) hostHits.push(phone);
    }
    if (hostHits.length === 1) return hostHits[0];
    const nameKey = normalizeContactBookName(lidProfile.name || pushName);
    if (nameKey && isUsefulContactBookName(nameKey)) {
      const hits: string[] = [];
      for (const [phone, profile] of index.profiles) {
        if (normalizeContactBookName(profile.name) === nameKey) hits.push(phone);
      }
      if (hits.length === 1) return hits[0];
    }
  }
  return undefined;
}

/**
 * Build PN profile index (pic/email/website → E.164) so LID chats can resolve
 * the phone WhatsApp UI always shows (INC-097 v6). Product: phone is always
 * visible in chat header even when not in the address book.
 */
async function buildWaProfilePnIndex(opts: {
  instanceName: string;
  contactBook: EvolutionContactBook;
  openPnPhones?: Iterable<string>;
  prefetchedDbPhones?: string[];
  openRemoteJids?: string[];
  fetchCap?: number;
  force?: boolean;
  ownPhoneDigits?: string | null;
}): Promise<WaProfilePnIndex> {
  const index: WaProfilePnIndex = {
    byPic: new Map(),
    byEmail: new Map(),
    byWebsite: new Map(),
    profiles: new Map(),
  };
  // Free: Contact book CDN fingerprints (no API) — pic match is last resort (INC-059).
  for (const entry of opts.contactBook.phoneEntries) {
    if (!entry.phone) continue;
    const fp = profilePicFingerprint(entry.profilePicUrl);
    if (fp && !index.byPic.has(fp)) index.byPic.set(fp, entry.phone);
  }

  const dbPhones =
    opts.prefetchedDbPhones ||
    (await loadPnCandidatesFromEvolutionDb(opts.instanceName, {
      openRemoteJids: opts.openRemoteJids,
    }));
  const candidates = collectPnProfileIndexCandidates({
    openPnPhones: opts.openPnPhones || [],
    dbPhones,
  });
  const defaultCap = opts.force ? WA_PROFILE_FETCH_CAP : Math.min(WA_PROFILE_FETCH_CAP, 80);
  const cap = opts.fetchCap ?? defaultCap;
  let fetched = 0;
  for (const phone of candidates) {
    if (fetched >= cap) break;
    if (index.profiles.has(phone)) continue;
    const profile = await fetchWaPeerProfile(
      opts.instanceName,
      phone,
      opts.ownPhoneDigits,
    );
    fetched += 1;
    if (!profile) continue;
    // fetchProfile(PN) returns wuid as PN — keep phone candidate.
    indexPnProfile(index, phone, { ...profile, phone });
    if (fetched % 25 === 0) {
      await sleep(100);
    } else {
      await sleep(40);
    }
  }
  console.log(
    `[ai-whatsapp] profile-index instance=${opts.instanceName} fetched=${fetched} byPic=${index.byPic.size} byEmail=${index.byEmail.size} byWeb=${index.byWebsite.size}`,
  );
  return index;
}

async function rememberLidPhoneMapping(
  instanceName: string,
  lidDigits: string,
  phoneE164: string,
): Promise<void> {
  const lid = normalizeWaNumber(lidDigits);
  const phone = normalizeWaNumber(phoneE164);
  if (!lid || !phone || !isWhatsAppLid(`${lid}@lid`) || !isLikelyE164Phone(phone)) return;
  try {
    const instanceId = await resolveEvolutionInstanceId(instanceName);
    if (!instanceId) return;
    const redis = getEvolutionRedis();
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => undefined);
    }
    const key = `evolution:instance:${instanceId}`;
    await redis.hset(key, `lid-mapping-${lid}_reverse`, phone);
    await redis.hset(key, `lid-mapping-${phone}`, lid);
  } catch {
    /* best-effort */
  }
}

/** All LID digits Evolution Redis maps to the same E.164 (multi-LID same peer). */
async function listLidDigitsMappedToPhone(
  instanceName: string,
  phoneE164: string,
): Promise<string[]> {
  const phone = normalizeWaNumber(phoneE164);
  if (!instanceName || !isLikelyE164Phone(phone)) return [];
  try {
    const instanceId = await resolveEvolutionInstanceId(instanceName);
    if (!instanceId) return [];
    const redis = getEvolutionRedis();
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => undefined);
    }
    const rows = await redis.hgetall(`evolution:instance:${instanceId}`);
    const lids: string[] = [];
    for (const [k, v] of Object.entries(rows)) {
      if (!k.startsWith('lid-mapping-') || !k.endsWith('_reverse')) continue;
      if (normalizeWaNumber(String(v)) !== phone) continue;
      const lid = k.slice('lid-mapping-'.length, -'_reverse'.length);
      if (lid && isWhatsAppLid(lid)) lids.push(normalizeWaNumber(lid));
    }
    return [...new Set(lids)];
  } catch {
    return [];
  }
}

async function fetchAllEvoMessagesForJid(
  instanceName: string,
  remoteJid: string,
  maxMessages = 500,
): Promise<any[]> {
  const out: any[] = [];
  const pageSize = 50;
  let page = 1;
  for (;;) {
    const res = await evoFetch(
      `/chat/findMessages/${encodeURIComponent(instanceName)}`,
      {
        method: 'POST',
        body: JSON.stringify({
          where: { key: { remoteJid } },
          page,
          limit: pageSize,
          offset: (page - 1) * pageSize,
        }),
      },
    );
    if (!res.ok) break;
    const envelope = res.json?.messages || res.json;
    const rows = unwrapEvoRows(res.json, ['messages', 'records', 'data']);
    const batch = Array.isArray(rows) ? rows : [];
    out.push(...batch);
    const total = Number(envelope?.total || envelope?.messages?.total || 0);
    const pages = Number(envelope?.pages || envelope?.messages?.pages || 1);
    if (batch.length === 0 || out.length >= maxMessages || page >= pages || page >= 20) {
      break;
    }
    page += 1;
    await sleep(80);
  }
  const byId = new Map<string, any>();
  for (const m of out) {
    const id = String(m?.key?.id || m?.id || '').trim();
    if (id) byId.set(id, m);
  }
  return [...byId.values()].sort(
    (a, b) => evoUnixSeconds(a?.messageTimestamp) - evoUnixSeconds(b?.messageTimestamp),
  );
}

async function nextWaDealSequence(tenantId: string): Promise<number> {
  const n = await prisma.conversation.count({
    where: {
      tenantId,
      platform: 'whatsapp',
      twentyOpportunityId: { not: null },
    },
  });
  return n + 1;
}

async function nextNonameLabel(tenantId: string): Promise<string> {
  const rows = await prisma.conversation.findMany({
    where: {
      tenantId,
      platform: 'whatsapp',
      platformFirstName: { startsWith: 'noname' },
    },
    select: { platformFirstName: true },
  });
  let max = 0;
  for (const r of rows) {
    const m = String(r.platformFirstName || '').match(/^noname(\d+)$/i);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `noname${max + 1}`;
}

async function resolveEvolutionInstanceId(
  instanceName: string,
): Promise<string | undefined> {
  const name = String(instanceName || '').trim();
  if (!name) return undefined;
  const cached = evolutionInstanceIdCache.get(name);
  if (cached) return cached;

  const uri = evolutionDbUrl();
  if (!uri) return undefined;
  const client = new pg.Client({ connectionString: uri });
  try {
    await client.connect();
    const res = await client.query<{ id: string }>(
      `SELECT id FROM "Instance" WHERE name = $1 LIMIT 1`,
      [name],
    );
    const id = res.rows[0]?.id;
    if (id) evolutionInstanceIdCache.set(name, id);
    return id;
  } catch (err) {
    console.warn(
      '[ai-whatsapp] resolveEvolutionInstanceId failed',
      err instanceof Error ? err.message : err,
    );
    return undefined;
  } finally {
    await client.end().catch(() => undefined);
  }
}

function parseLidMappingValue(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  let s = String(raw).trim();
  for (let i = 0; i < 2; i += 1) {
    if (
      (s.startsWith('"') && s.endsWith('"')) ||
      (s.startsWith("'") && s.endsWith("'"))
    ) {
      try {
        s = JSON.parse(s);
      } catch {
        s = s.slice(1, -1);
      }
      continue;
    }
    break;
  }
  const digits = normalizeWaNumber(s);
  return digits || undefined;
}

/**
 * Baileys lidMapping in Evolution Redis (INC-059 / v2.3.7):
 *   lid-mapping-{phone} → lid digits
 *   lid-mapping-{lid}_reverse → phone digits
 */
async function resolvePhoneFromEvolutionLidMapping(
  instanceName: string,
  lidDigits: string,
): Promise<{ phone?: string; source: LidPnSource }> {
  const lid = normalizeWaNumber(lidDigits);
  if (!instanceName || !lid || !isWhatsAppLid(lid)) {
    return { source: 'none' };
  }
  try {
    const instanceId = await resolveEvolutionInstanceId(instanceName);
    if (!instanceId) return { source: 'none' };
    const redis = getEvolutionRedis();
    if (redis.status !== 'ready') {
      await redis.connect().catch(() => undefined);
    }
    const key = `evolution:instance:${instanceId}`;
    const raw = await redis.hget(key, `lid-mapping-${lid}_reverse`);
    const phone = parseLidMappingValue(raw);
    if (phone && isLikelyE164Phone(phone)) {
      console.log(
        `[ai-whatsapp] LID→phone via lid_mapping lid=${lid} phone=+${phone}`,
      );
      return { phone, source: 'lid_mapping' };
    }
  } catch (err) {
    console.warn(
      '[ai-whatsapp] lid_mapping lookup failed',
      err instanceof Error ? err.message : err,
    );
  }
  return { source: 'none' };
}

/** PN from Evolution IsOnWhatsapp.jidOptions (populated when inbound has remoteJidAlt). */
function phoneFromJidOptions(
  jidOptions: string | null | undefined,
  lidJid?: string,
): string | undefined {
  const raw = String(jidOptions || '').trim();
  if (!raw) return undefined;
  const lid = lidJid?.toLowerCase();
  const phones: string[] = [];
  for (const part of raw.split(',')) {
    const jid = part.trim().toLowerCase();
    if (!jid || jid === lid || jid.includes('@lid')) continue;
    const phone = extractWaPhoneE164(jid);
    if (phone) phones.push(phone);
  }
  if (phones.length === 1) return phones[0];
  return undefined;
}

async function resolvePhoneFromIsOnWhatsapp(
  instanceName: string,
  lidDigits: string,
): Promise<{ phone?: string; source: LidPnSource }> {
  const lid = normalizeWaNumber(lidDigits);
  if (!instanceName || !lid || !isWhatsAppLid(lid)) {
    return { source: 'none' };
  }
  const uri = evolutionDbUrl();
  if (!uri) return { source: 'none' };
  const lidJid = `${lid}@lid`;
  const client = new pg.Client({ connectionString: uri });
  try {
    await client.connect();
    const res = await client.query<{ remoteJid: string; jidOptions: string }>(
      `SELECT "remoteJid", "jidOptions" FROM "IsOnWhatsapp"
       WHERE "remoteJid" = $1 OR "jidOptions" LIKE $2
       ORDER BY "updatedAt" DESC NULLS LAST
       LIMIT 5`,
      [lidJid, `%${lidJid}%`],
    );
    for (const row of res.rows) {
      const fromOptions = phoneFromJidOptions(row.jidOptions, lidJid);
      const fromRemote =
        row.remoteJid.toLowerCase().includes('@lid')
          ? undefined
          : extractWaPhoneE164(row.remoteJid);
      const phone = fromOptions || fromRemote;
      if (phone && isLikelyE164Phone(phone)) {
        console.log(
          `[ai-whatsapp] LID→phone via is_on_whatsapp lid=${lid} phone=+${phone}`,
        );
        return { phone, source: 'is_on_whatsapp' };
      }
    }
  } catch (err) {
    console.warn(
      '[ai-whatsapp] is_on_whatsapp lookup failed',
      err instanceof Error ? err.message : err,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
  return { source: 'none' };
}

/** Evolution POST /chat/whatsappNumbers — uses IsOnWhatsapp cache + Baileys onWhatsApp. */
async function resolvePhoneFromEvolutionWhatsappNumbers(
  instanceName: string,
  lidDigits: string,
): Promise<{ phone?: string; source: LidPnSource }> {
  const lid = normalizeWaNumber(lidDigits);
  if (!instanceName || !lid || !isWhatsAppLid(lid)) {
    return { source: 'none' };
  }
  const res = await evoFetch(
    `/chat/whatsappNumbers/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body: JSON.stringify({ numbers: [`${lid}@lid`] }) },
  );
  if (!res.ok) return { source: 'none' };
  const rows: any[] = Array.isArray(res.json) ? res.json : [];
  const hit = rows[0];
  if (!hit?.exists) return { source: 'none' };
  const jid = String(hit.jid || '');
  if (jid.toLowerCase().includes('@lid')) return { source: 'none' };
  const phone = extractWaPhoneE164(jid, hit.number);
  if (phone && isLikelyE164Phone(phone)) {
    console.log(
      `[ai-whatsapp] LID→phone via whatsapp_numbers lid=${lid} phone=+${phone} jid=${jid}`,
    );
    return { phone, source: 'whatsapp_numbers' };
  }
  return { source: 'none' };
}

/** Stored Message.key remoteJidAlt / senderPn when webhook omitted them (Evolution ≥2.3.7). */
async function resolvePhoneFromMessageKeyAlt(
  instanceName: string,
  lidDigits: string,
): Promise<{ phone?: string; source: LidPnSource }> {
  const lid = normalizeWaNumber(lidDigits);
  if (!instanceName || !lid || !isWhatsAppLid(lid)) {
    return { source: 'none' };
  }
  const instanceId = await resolveEvolutionInstanceId(instanceName);
  const uri = evolutionDbUrl();
  if (!instanceId || !uri) return { source: 'none' };
  const lidJid = `${lid}@lid`.toLowerCase();
  const client = new pg.Client({ connectionString: uri });
  try {
    await client.connect();
    const res = await client.query<{ alt: string | null; pn: string | null }>(
      `SELECT ("key"->>'remoteJidAlt') AS alt, ("key"->>'senderPn') AS pn
       FROM "Message"
       WHERE "instanceId" = $1
         AND lower("key"->>'remoteJid') = $2
         AND (
           ("key"->>'remoteJidAlt') LIKE '%@s.whatsapp.net'
           OR ("key"->>'senderPn') IS NOT NULL
         )
       ORDER BY "messageTimestamp" DESC
       LIMIT 1`,
      [instanceId, lidJid],
    );
    const phone = extractWaPhoneE164(res.rows[0]?.alt, res.rows[0]?.pn);
    if (phone && isLikelyE164Phone(phone)) {
      console.log(
        `[ai-whatsapp] LID→phone via message_key lid=${lid} phone=+${phone}`,
      );
      return { phone, source: 'message_key' };
    }
  } catch (err) {
    console.warn(
      '[ai-whatsapp] message_key lookup failed',
      err instanceof Error ? err.message : err,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
  return { source: 'none' };
}

/** Official Evolution/Baileys LID→PN chain (profile-index is separate fallback). */
async function resolveLidPhoneFromEvolution(
  instanceName: string,
  lidDigits: string,
  hints?: { pushName?: string | null; profilePicUrl?: string | null },
): Promise<{ phone?: string; source: LidPnSource }> {
  const fromMsg = await resolvePhoneFromMessageKeyAlt(instanceName, lidDigits);
  if (fromMsg.phone) return fromMsg;

  const fromMap = await resolvePhoneFromEvolutionLidMapping(instanceName, lidDigits);
  if (fromMap.phone) return fromMap;

  const fromOnWa = await resolvePhoneFromIsOnWhatsapp(instanceName, lidDigits);
  if (fromOnWa.phone) return fromOnWa;

  const fromApi = await resolvePhoneFromEvolutionWhatsappNumbers(instanceName, lidDigits);
  if (fromApi.phone) return fromApi;

  const fromContacts = await resolvePhoneFromEvolutionContacts(
    instanceName,
    lidDigits,
    hints,
  );
  if (fromContacts.phone) return fromContacts;

  const fromChats = await resolvePhoneFromEvolutionDb(instanceName, lidDigits);
  if (fromChats.phone) return fromChats;

  return { source: 'none' };
}

async function resolveContactPushName(
  instanceName: string,
  phoneE164: string,
): Promise<string | undefined> {
  const phone = normalizeWaNumber(phoneE164);
  if (!instanceName || !phone || !isLikelyE164Phone(phone)) return undefined;
  const jid = `${phone}@s.whatsapp.net`;
  const res = await evoFetch(`/chat/findContacts/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({ where: { remoteJid: jid } }),
  });
  if (!res.ok) return undefined;
  const rows: EvoContactRow[] = Array.isArray(res.json)
    ? res.json
    : Array.isArray(res.json?.contacts)
      ? res.json.contacts
      : [];
  const hit =
    rows.find((c) => String(c.remoteJid || '').toLowerCase() === jid) || rows[0];
  const name = String(hit?.pushName || '').trim();
  if (!name) return undefined;
  const cleaned = cleanWaContactName(name, phone);
  return cleaned !== 'WhatsApp' ? cleaned : undefined;
}

function normalizeContactBookName(name?: string | null): string {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isUsefulContactBookName(name?: string | null): boolean {
  const cleaned = cleanWaContactName(name);
  if (cleaned === 'WhatsApp') return false;
  // Require a letter so we do not match "123" / emoji-only nicknames (INC-055).
  return /[a-zа-яё]/i.test(cleaned) && cleaned.length >= 2;
}

async function loadEvolutionContactBook(
  instanceName: string,
): Promise<EvolutionContactBook> {
  const empty: EvolutionContactBook = {
    byLid: new Map(),
    byPhone: new Map(),
    byUniqueName: new Map(),
    phoneEntries: [],
  };
  if (!instanceName) return empty;
  const res = await evoFetch(`/chat/findContacts/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({ where: {} }),
  });
  if (!res.ok) return empty;
  const rows: EvoContactRow[] = Array.isArray(res.json)
    ? res.json
    : Array.isArray(res.json?.contacts)
      ? res.json.contacts
      : [];
  if (!rows.length) return empty;

  const byLid = new Map<string, ContactBookEntry>();
  const byPhone = new Map<string, ContactBookEntry>();
  const nameCounts = new Map<string, number>();
  const phoneEntries: ContactBookEntry[] = [];

  for (const row of rows) {
    const remoteJid = String(row.remoteJid || '').trim();
    if (!remoteJid) continue;
    const jidLower = remoteJid.toLowerCase();
    if (jidLower.endsWith('@g.us') || jidLower.includes('@broadcast')) continue;

    const phoneFromJid = jidLower.endsWith('@s.whatsapp.net')
      ? extractWaPhoneE164(remoteJid)
      : undefined;
    const phoneFromFields = extractPhoneFromEvoRow(row);
    const phone = phoneFromJid || phoneFromFields;
    const lidDigits = isWhatsAppLid(remoteJid)
      ? normalizeWaNumber(remoteJid)
      : undefined;
    const pushName = String(row.pushName || '').trim() || undefined;
    const entry: ContactBookEntry = {
      remoteJid,
      phone: phone && isLikelyE164Phone(phone) ? phone : undefined,
      lidDigits,
      pushName,
      profilePicUrl: row.profilePicUrl || undefined,
    };

    if (entry.lidDigits) byLid.set(entry.lidDigits, entry);
    if (entry.phone) {
      byPhone.set(entry.phone, entry);
      if (jidLower.endsWith('@s.whatsapp.net')) phoneEntries.push(entry);
    }
    if (entry.phone && isUsefulContactBookName(pushName)) {
      const key = normalizeContactBookName(pushName);
      nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
    }
  }

  const byUniqueName = new Map<string, ContactBookEntry>();
  for (const entry of phoneEntries) {
    if (!entry.phone || !isUsefulContactBookName(entry.pushName)) continue;
    const key = normalizeContactBookName(entry.pushName);
    if ((nameCounts.get(key) || 0) !== 1) continue;
    byUniqueName.set(key, entry);
  }

  return { byLid, byPhone, byUniqueName, phoneEntries };
}

/**
 * Prefer Contact book for LID chats: explicit LID row fields, then unique pushName → PN.
 * Avatar twin stays opt-in (WA_LID_AVATAR_PHONE_MATCH).
 */
function matchContactBookIdentity(
  book: EvolutionContactBook,
  opts: { lidDigits?: string; pushName?: string | null },
): { phone?: string; name?: string; source: LidPnSource } {
  const lid = opts.lidDigits ? normalizeWaNumber(opts.lidDigits) : '';
  if (lid && book.byLid.has(lid)) {
    const row = book.byLid.get(lid)!;
    if (row.phone) {
      return {
        phone: row.phone,
        name: isUsefulContactBookName(row.pushName) ? row.pushName : undefined,
        source: 'contact_row',
      };
    }
  }

  const nameKey = normalizeContactBookName(opts.pushName);
  if (nameKey && isUsefulContactBookName(opts.pushName) && book.byUniqueName.has(nameKey)) {
    const hit = book.byUniqueName.get(nameKey)!;
    if (hit.phone) {
      console.log(
        `[ai-whatsapp] LID→phone via unique_contact_name name=${opts.pushName} phone=+${hit.phone}`,
      );
      return {
        phone: hit.phone,
        name: hit.pushName,
        source: 'contact_row',
      };
    }
  }

  return { source: 'none' };
}

/**
 * After Person has E.164 — if tenant has connected ai_max, resolve MAX by phone
 * (PyMax search_by_phone) and write Person.max + name (placeholder only).
 * Never invent max.ru/+phone.
 */
async function enrichMaxPresenceFromPhone(opts: {
  tenantId: string;
  personId: string;
  phoneE164: string;
  client: TwentyClient;
}): Promise<void> {
  const phone = normalizeWaNumber(opts.phoneE164);
  if (!opts.personId || !phone || !isLikelyE164Phone(phone)) return;

  const maxBot = await prisma.botInstance.findFirst({
    where: {
      tenantId: opts.tenantId,
      botType: 'ai_max',
      status: 'active',
      botTokenEncrypted: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });
  if (!maxBot) return;

  const bridge = (process.env.MAX_BRIDGE_URL || 'http://max-bridge:3010').replace(
    /\/$/,
    '',
  );
  const token = resolveServiceToken('max-bridge');
  if (!token) return;

  try {
    const res = await fetchWithTimeout(`${bridge}/users/by-phone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ botId: maxBot.id, phone: `+${phone}` }),
      timeout: 15000,
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      exists?: boolean;
      userId?: string;
      firstName?: string;
      lastName?: string;
      link?: string;
      about?: string;
      phone?: string;
      error?: string;
    };
    if (!res.ok || !json.ok) return;
    if (json.exists === false) return;
    if (!json.userId && !json.link) return;

    await opts.client.applyMaxProfile(opts.personId, {
      firstName: json.firstName,
      lastName: json.lastName,
      link: json.link,
      userId: json.userId,
      about: json.about,
      phone:
        normalizeWaNumber(json.phone || '') === phone ? `+${phone}` : undefined,
    });
    console.log(
      `[ai-whatsapp] max presence enriched person=${opts.personId} phone=+${phone} link=${json.link || '-'}`,
    );
  } catch (err) {
    console.warn(
      '[ai-whatsapp] max by-phone failed',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * After Person has E.164 — positively confirm Telegram presence, write @username,
 * then run existing open-profile enrich (GetFullUser → applyTelegramProfile).
 * Never invent `https://t.me/+{phone}`.
 */
async function enrichTelegramPresenceFromPhone(opts: {
  tenantId: string;
  personId: string;
  phoneE164: string;
  client: TwentyClient;
}): Promise<void> {
  const phone = normalizeWaNumber(opts.phoneE164);
  if (!opts.personId || !phone || !isLikelyE164Phone(phone)) return;

  let username: string | undefined;
  let telegramUserId: string | undefined;
  /** Real profile from bridge (GetFullUser inside /users/by-phone) — never ImportContacts probe names. */
  let byPhoneProfile:
    | {
        firstName?: string;
        lastName?: string;
        about?: string;
        birthday?: string;
        personalChannelUrl?: string;
        phone?: string;
      }
    | undefined;

  const bridge = (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(
    /\/$/,
    '',
  );
  const token = resolveServiceToken('gramjs-bridge');
  if (token) {
    try {
      const res = await fetchWithTimeout(`${bridge}/users/by-phone`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ tenantId: opts.tenantId, phone: `+${phone}` }),
        timeout: 15000,
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        exists?: boolean;
        username?: string;
        userId?: string;
        firstName?: string;
        lastName?: string;
        about?: string;
        birthday?: string;
        personalChannelUrl?: string;
        phone?: string;
      };
      if (res.ok && json.ok && json.exists === true) {
        if (json.userId) telegramUserId = String(json.userId);
        if (json.username) {
          username = String(json.username).replace(/^@/, '');
        } else if (!telegramUserId) {
          console.log(
            `[ai-whatsapp] telegram presence confirmed but no @username/userId person=${opts.personId} phone=+${phone}`,
          );
          return;
        }
        // No @username but userId → open via /open/tg bridge (never invent t.me/+phone).
        const fn = String(json.firstName || '').trim();
        const ln = String(json.lastName || '').trim();
        const probe = /^voxly$/i.test(fn) && /^check$/i.test(ln);
        if (!probe && (fn || ln || json.about || json.birthday || json.personalChannelUrl)) {
          byPhoneProfile = {
            firstName: fn || undefined,
            lastName: ln || undefined,
            about: json.about,
            birthday: json.birthday,
            personalChannelUrl: json.personalChannelUrl,
            phone: json.phone,
          };
        }
      } else if (res.ok && json.ok && json.exists === false) {
        return;
      }
    } catch (err) {
      console.warn(
        '[ai-whatsapp] gramjs by-phone failed',
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Optional scrape for public @username only when GramJS did not resolve the user.
  // Never early-return on scrape errors when telegramUserId is already known (INC-105).
  if (!username && !telegramUserId) {
    try {
      const url = `https://t.me/+${phone}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; VoxlyCRM/1.0; +https://getvoxly.ru)',
          Accept: 'text/html',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      const html = await res.text();
      if (
        /tgme_page_error|If you have.+Telegram|user not found|не найден/i.test(html)
      ) {
        return;
      }
      const userMatch =
        html.match(/tgme_username["'\s>]+@?([A-Za-z0-9_]{5,})/i) ||
        html.match(
          /property="og:url"\s+content="https:\/\/t\.me\/([A-Za-z0-9_]{5,})"/i,
        );
      const handle = userMatch?.[1];
      if (
        handle &&
        !/^(share|addstickers|proxy|socks|setlanguage|\+?\d+)$/i.test(handle)
      ) {
        username = handle;
      }
    } catch {
      /* optional */
    }
  }

  if (!username && !telegramUserId) return;

  try {
    await opts.client.updatePersonTelegram(opts.personId, {
      username,
      userId: telegramUserId,
    });
    console.log(
      `[ai-whatsapp] telegram presence person=${opts.personId} phone=+${phone} username=${username ? `@${username}` : '-'} userId=${telegramUserId || '-'}`,
    );
  } catch (err) {
    console.warn(
      '[ai-whatsapp] update telegram social failed',
      err instanceof Error ? err.message : err,
    );
  }

  // Open-profile enrich: prefer fields already returned by /users/by-phone (GetFullUser).
  // Fallback to /users/full when by-phone had only ids (older bridge).
  if (!token || (!username && !telegramUserId)) return;

  const applyProfile = async (raw: {
    username?: string;
    userId?: string;
    firstName?: string;
    lastName?: string;
    phone?: string;
    about?: string;
    birthday?: string;
    personalChannelUrl?: string;
  }) => {
    const profile = { ...raw };
    if (username) profile.username = username;
    if (telegramUserId) profile.userId = telegramUserId;

    const tgPhone = profile.phone ? normalizeWaNumber(profile.phone) : '';
    if (tgPhone && isLikelyE164Phone(tgPhone)) {
      if (tgPhone === phone) {
        profile.phone = `+${tgPhone}`;
      } else {
        console.warn(
          `[ai-whatsapp] telegram phone mismatch person=${opts.personId} wa=+${phone} tg=+${tgPhone} — keep WA phone`,
        );
        delete profile.phone;
      }
    } else {
      delete profile.phone;
    }

    await opts.client.applyTelegramProfile(opts.personId, profile);
    console.log(
      `[ai-whatsapp] telegram profile enrich person=${opts.personId} @${username || '-'} userId=${telegramUserId || '-'} fields=${[
        (profile.username || profile.userId) && 'telegram',
        profile.firstName && 'name',
        profile.about && 'about',
        profile.birthday && 'birthday',
        profile.personalChannelUrl && 'website',
        profile.phone && 'phone_verified',
      ]
        .filter(Boolean)
        .join(',')}`,
    );
  };

  if (byPhoneProfile) {
    try {
      await applyProfile({
        ...byPhoneProfile,
        username,
        userId: telegramUserId,
      });
      return;
    } catch (err) {
      console.warn(
        '[ai-whatsapp] telegram by-phone profile enrich failed',
        err instanceof Error ? err.message : err,
      );
    }
  }

  try {
    const fullRes = await fetchWithTimeout(`${bridge}/users/full`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenantId: opts.tenantId,
        username,
        userId: telegramUserId,
      }),
      timeout: 15000,
    });
    const fullJson = (await fullRes.json().catch(() => ({}))) as {
      ok?: boolean;
      profile?: {
        username?: string;
        userId?: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        about?: string;
        birthday?: string;
        personalChannelUrl?: string;
      };
      error?: string;
    };
    if (!fullRes.ok || !fullJson.ok || !fullJson.profile) {
      if (fullJson.error) {
        console.warn(
          `[ai-whatsapp] telegram full profile skip person=${opts.personId} @${username || telegramUserId}: ${fullJson.error}`,
        );
      }
      return;
    }
    await applyProfile(fullJson.profile);
  } catch (err) {
    console.warn(
      '[ai-whatsapp] telegram full profile enrich failed',
      err instanceof Error ? err.message : err,
    );
  }
}

/** Clear invented `https://t.me/+{digits}` Telegram fields (not a verified handle). */
async function clearFalseTelegramPhoneLinks(opts: {
  workspaceId: string;
  personIds: string[];
}): Promise<number> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString || !opts.workspaceId || !opts.personIds.length) return 0;
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [opts.workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return 0;
    const result = await client.query(
      `UPDATE "${schema}".person
       SET telegram = NULL, "updatedAt" = NOW()
       WHERE id = ANY($1::uuid[])
         AND "deletedAt" IS NULL
         AND telegram IS NOT NULL
         AND (
           telegram ~* '^https?://t\\.me/\\+\\d+'
           OR telegram ~* '^t\\.me/\\+\\d+'
         )`,
      [opts.personIds],
    );
    return result.rowCount || 0;
  } catch (err) {
    console.warn(
      '[ai-whatsapp] clearFalseTelegramPhoneLinks failed',
      err instanceof Error ? err.message : err,
    );
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** System / self chats that must never become CRM leads. */
function isWaSystemOrSelfJid(
  remoteJid: string,
  ownPhoneDigits?: string | null,
): boolean {
  const j = String(remoteJid || '').toLowerCase().trim();
  const digits = normalizeWaNumber(j);
  if (!j) return true;
  if (j === '0@s.whatsapp.net' || digits === '0') return true;
  if (j.startsWith('status@') || j.endsWith('@broadcast')) return true;
  if (ownPhoneDigits && digits && digits === normalizeWaNumber(ownPhoneDigits)) {
    return true;
  }
  return false;
}

/** E.164 digits from Conversation.platformUsername (+7985… / 7985…). */
function phoneFromPlatformUsername(username?: string | null): string | undefined {
  const raw = String(username || '').trim();
  if (!raw) return undefined;
  return extractWaPhoneE164(raw);
}

/**
 * Reuse a previously discovered LID→PN mapping stored on Conversation.platformUsername
 * (manual backfill, shared vCard, or older webhook that had remoteJidAlt).
 */
async function resolvePhoneFromConversationCache(opts: {
  tenantId: string;
  botId: string;
  platformUserId: string;
  conversationId?: string;
  platformUsername?: string | null;
}): Promise<{ phone?: string; source: LidPnSource }> {
  const fromSelf = phoneFromPlatformUsername(opts.platformUsername);
  if (fromSelf) return { phone: fromSelf, source: 'cached' };

  const prior = await prisma.conversation.findFirst({
    where: {
      tenantId: opts.tenantId,
      platform: 'whatsapp',
      platformUserId: opts.platformUserId,
      platformUsername: { not: null },
      ...(opts.conversationId ? { NOT: { id: opts.conversationId } } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    select: { platformUsername: true },
  });
  const fromPrior = phoneFromPlatformUsername(prior?.platformUsername);
  if (fromPrior) {
    console.log(
      `[ai-whatsapp] LID→phone via cached platformUsername lid=${opts.platformUserId} phone=+${fromPrior}`,
    );
    return { phone: fromPrior, source: 'cached' };
  }
  return { source: 'none' };
}

/**
 * Human label from WA business website host (e.g. boomerservice.ru → Boomerservice).
 * Never invent phones; only a display name when Evolution omits verifiedName.
 * Skip punycode/IDN hosts (xn--) — use description/email instead (INC-097 v5).
 */
function deriveNameFromWebsiteHost(website?: string | null): string | undefined {
  const raw = String(website || '').trim();
  if (!raw) return undefined;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    let host = u.hostname.replace(/^www\./i, '');
    // Punycode IDN (e.g. xn--80a… for рен-авто.рф) is not a usable CRM name.
    if (/^xn--/i.test(host) || host.split('.').some((p) => /^xn--/i.test(p))) {
      return undefined;
    }
    const parts = host.split('.').filter(Boolean);
    if (parts.length >= 2) {
      host = parts.slice(0, -1).join('.');
    }
    host = host.replace(/[-_]+/g, ' ').trim();
    if (!host || host.length < 2) return undefined;
    const titled = host
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    const cleaned = cleanWaContactName(titled);
    return cleaned !== 'WhatsApp' ? cleaned : undefined;
  } catch {
    return undefined;
  }
}

/** Business WA profile — email/website/address/name; IG/FB only if present as URLs. */
async function probePhoneFromBusinessHints(
  instanceName: string,
  pushName: string,
  candidates: string[],
  cap = 50,
): Promise<string | undefined> {
  const hint = normalizeContactBookName(pushName).replace(/[\s-]+/g, '');
  if (hint.length < 4) return undefined;
  let tried = 0;
  for (const phone of candidates) {
    if (!phone || tried >= cap) break;
    tried += 1;
    try {
      const biz = await fetchWaBusinessProfile(instanceName, phone);
      if (!biz) continue;
      const hostStem = websiteHostKey(biz.website)?.split('.')[0] || '';
      const nameNorm = normalizeContactBookName(biz.name).replace(/[\s-]+/g, '');
      if (
        (hostStem && (hint.includes(hostStem) || hostStem.includes(hint))) ||
        (nameNorm && nameNorm === hint)
      ) {
        console.log(
          `[ai-whatsapp] LID→phone via business-hint pushName=${pushName} phone=+${phone}`,
        );
        return phone;
      }
    } catch {
      /* ignore */
    }
    if (tried % 10 === 0) await sleep(100);
    else await sleep(40);
  }
  return undefined;
}

async function fetchWaBusinessProfile(
  instanceName: string,
  lidOrNumber: string,
  ownPhoneDigits?: string | null,
): Promise<{
  email?: string;
  address?: string;
  description?: string;
  website?: string;
  instagram?: string;
  facebook?: string;
  /** verifiedName / business name / website-derived label — never «WhatsApp». */
  name?: string;
} | null> {
  const digits = normalizeWaNumber(lidOrNumber);
  if (!instanceName || !digits) return null;
  const number = isWhatsAppLid(lidOrNumber) ? `${digits}@lid` : digits;

  const bizRes = await evoFetch(
    `/chat/fetchBusinessProfile/${encodeURIComponent(instanceName)}`,
    { method: 'POST', body: JSON.stringify({ number }) },
  );
  const profileRes = await evoFetch(`/chat/fetchProfile/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({ number }),
  });

  const biz = bizRes.ok ? bizRes.json || {} : {};
  const profile = profileRes.ok ? profileRes.json || {} : {};
  const wid = String(biz.wid || profile.wuid || '').toLowerCase();
  const asLid = isWhatsAppLid(lidOrNumber);
  if (
    isPoisonedWaLinkedAccountProfile(wid, ownPhoneDigits, {
      asLid,
      requestedDigits: digits,
    })
  ) {
    return null;
  }
  const isBusiness = Boolean(biz.isBusiness || profile.isBusiness);
  if (!isBusiness && !biz.email && !profile.email && !biz.website && !profile.website) {
    return null;
  }

  const email = String(biz.email || profile.email || '')
    .trim()
    .toLowerCase();
  const address = String(biz.address || profile.address || '').trim();
  const description = String(biz.description || profile.description || '').trim();
  const websiteUrls = collectWaWebsiteUrls(biz.website, profile.website, description);
  const social = pickSocialFromUrls(websiteUrls, description);

  const rawName = String(
    biz.verifiedName ||
      biz.name ||
      biz.businessName ||
      profile.verifiedName ||
      profile.name ||
      profile.businessName ||
      '',
  ).trim();
  let name = cleanWaContactName(rawName);
  if (name === 'WhatsApp') name = '';
  // Reject accidental punycode leftovers from older sync.
  if (/^xn[\s-]/i.test(name) || /\bxn--/i.test(name)) name = '';
  if (!name) {
    name = deriveNameFromWebsiteHost(social.website) || '';
  }
  // Short first line of description as last-resort label (letter-bearing only).
  if (!name && description) {
    const firstLine = description
      .split(/\n|\/|\|/)
      .map((s) => s.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim())
      .find((s) => s.length >= 3 && /[a-zа-яё]/i.test(s));
    if (firstLine) {
      const cleaned = cleanWaContactName(firstLine.slice(0, 60));
      if (cleaned !== 'WhatsApp' && !/^xn[\s-]/i.test(cleaned)) name = cleaned;
    }
  }

  return {
    email: email.includes('@') ? email : undefined,
    address: address || undefined,
    description: description || undefined,
    website: social.website,
    instagram: social.instagram,
    facebook: social.facebook,
    name: name || undefined,
  };
}

function collectWaWebsiteUrls(...sources: unknown[]): string[] {
  const out: string[] = [];
  for (const src of sources) {
    if (!src) continue;
    if (Array.isArray(src)) {
      for (const item of src) {
        const s = String(item || '').trim();
        if (s) out.push(s);
      }
      continue;
    }
    const s = String(src).trim();
    if (!s) continue;
    // Pull bare URLs out of description text.
    const matches = s.match(/https?:\/\/[^\s<>"']+/gi) || [];
    if (matches.length) out.push(...matches);
    else if (/^https?:\/\//i.test(s) || /\.[a-z]{2,}/i.test(s)) out.push(s);
  }
  return [...new Set(out.map((u) => u.replace(/[),.;]+$/g, '')))];
}

function pickSocialFromUrls(
  urls: string[],
  description?: string,
): { website?: string; instagram?: string; facebook?: string } {
  let website: string | undefined;
  let instagram: string | undefined;
  let facebook: string | undefined;
  const all = [...urls];
  if (description) {
    all.push(...collectWaWebsiteUrls(description));
  }
  for (const raw of all) {
    const u = raw.trim();
    if (!u) continue;
    const lower = u.toLowerCase();
    if (!instagram && /(instagram\.com|instagr\.am)\//i.test(lower)) {
      instagram = u.startsWith('http') ? u : `https://${u}`;
      continue;
    }
    if (!facebook && /(facebook\.com|fb\.com|fb\.me)\//i.test(lower)) {
      facebook = u.startsWith('http') ? u : `https://${u}`;
      continue;
    }
    if (
      !website &&
      !/(instagram\.com|instagr\.am|facebook\.com|fb\.com|fb\.me)\//i.test(lower)
    ) {
      website = u.startsWith('http') ? u : `https://${u}`;
    }
  }
  return { website, instagram, facebook };
}

/**
 * Twenty unique on emailsPrimaryEmail includes soft-deleted rows. Clearing trash
 * emails lets us attach the address to the live Person after CRM wipe (INC-062).
 */
async function releaseSoftDeletedPersonEmail(
  workspaceId: string,
  email: string,
): Promise<number> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  const normalized = String(email || '').trim().toLowerCase();
  if (!connectionString || !workspaceId || !normalized.includes('@')) return 0;

  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return 0;
    const res = await client.query(
      `UPDATE "${schema}".person
       SET "emailsPrimaryEmail" = NULL, "updatedAt" = NOW()
       WHERE "deletedAt" IS NOT NULL
         AND lower("emailsPrimaryEmail") = $1`,
      [normalized],
    );
    const n = res.rowCount ?? 0;
    if (n > 0) {
      console.log(
        `[ai-whatsapp] cleared soft-deleted email=${normalized} rows=${n} workspace=${workspaceId}`,
      );
    }
    return n;
  } catch (err) {
    console.warn(
      '[ai-whatsapp] releaseSoftDeletedPersonEmail failed',
      err instanceof Error ? err.message : err,
    );
    return 0;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * When webhook is LID-only (no senderPn/remoteJidAlt), try Evolution Contact book.
 * Prefer explicit PN fields on the LID row. Avatar twin matching is opt-in only
 * (WA_LID_AVATAR_PHONE_MATCH=1) — default OFF after wrong-number incidents.
 * Never map by pushName (INC-055).
 */
async function resolvePhoneFromEvolutionContacts(
  instanceName: string,
  lidDigits: string,
  hints?: { pushName?: string | null; profilePicUrl?: string | null },
): Promise<{ phone?: string; source: LidPnSource }> {
  if (!instanceName || !lidDigits || !isWhatsAppLid(lidDigits)) {
    return { source: 'none' };
  }
  const res = await evoFetch(`/chat/findContacts/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({ where: {} }),
  });
  if (!res.ok) {
    console.warn(
      `[ai-whatsapp] findContacts failed instance=${instanceName} status=${res.status}`,
    );
    return { source: 'none' };
  }
  const rows: EvoContactRow[] = Array.isArray(res.json)
    ? res.json
    : Array.isArray(res.json?.contacts)
      ? res.json.contacts
      : [];
  if (!rows.length) return { source: 'none' };

  const lidJid = `${normalizeWaNumber(lidDigits)}@lid`.toLowerCase();
  const lidRow = rows.find(
    (c) => String(c.remoteJid || '').toLowerCase() === lidJid,
  );
  const pushName = String(hints?.pushName || lidRow?.pushName || '')
    .trim()
    .toLowerCase();
  const picFp =
    profilePicFingerprint(hints?.profilePicUrl) ||
    profilePicFingerprint(lidRow?.profilePicUrl);

  // 1) Explicit fields on the LID Contact row (Evolution 2.3+ may store remoteJidAlt).
  const fromRow = extractPhoneFromEvoRow(lidRow);
  if (fromRow) {
    console.log(
      `[ai-whatsapp] LID→phone via contact_row lid=${lidDigits} phone=+${fromRow}`,
    );
    return { phone: fromRow, source: 'contact_row' };
  }

  // 2) Opt-in avatar twin — OFF by default (wrong E.164 risk).
  if (ALLOW_AVATAR_PHONE_MATCH && picFp) {
    const phoneRows = rows.filter((c) => {
      const jid = String(c.remoteJid || '').toLowerCase();
      return jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@g.us');
    });
    const byPic = phoneRows.filter(
      (c) => profilePicFingerprint(c.profilePicUrl) === picFp,
    );
    if (byPic.length === 1) {
      const digits = extractWaPhoneE164(byPic[0].remoteJid);
      if (digits) {
        console.warn(
          `[ai-whatsapp] LID→phone via avatar_twin (WA_LID_AVATAR_PHONE_MATCH=1) lid=${lidDigits} phone=+${digits} — verify manually`,
        );
        return { phone: digits, source: 'avatar_twin' };
      }
    }
  }

  console.warn(
    `[ai-whatsapp] LID-only peer unresolved lid=${lidDigits} pushName=${pushName || '-'} pic=${picFp ? 'yes' : 'no'} avatarMatch=${ALLOW_AVATAR_PHONE_MATCH ? 'on' : 'off'} — webhook/Contact lack E.164; WhatsApp UI may still show PN via lidMapping (needs Evolution ≥2.3.7 Baileys mapping, not address-book alone)`,
  );
  return { source: 'none' };
}

/**
 * Read phone from Evolution Chat row when webhook is LID-only.
 * Prefer exact LID row fields; never invent from pushName/avatar.
 */
async function resolvePhoneFromEvolutionDb(
  instanceName: string,
  lidDigits: string,
): Promise<{ phone?: string; source: LidPnSource }> {
  const chats = await evoFetch(`/chat/findChats/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({ where: {} }),
  });
  if (!chats.ok) return { source: 'none' };
  const rows: any[] = Array.isArray(chats.json)
    ? chats.json
    : Array.isArray(chats.json?.chats)
      ? chats.json.chats
      : [];
  const lidJid = `${normalizeWaNumber(lidDigits)}@lid`.toLowerCase();
  const hit = rows.find((c) => String(c.remoteJid || '').toLowerCase() === lidJid);
  if (!hit) return { source: 'none' };
  const phone = extractPhoneFromEvoRow(hit);
  if (phone) {
    console.log(
      `[ai-whatsapp] LID→phone via chat_row lid=${lidDigits} phone=+${phone}`,
    );
    return { phone, source: 'chat_row' };
  }
  return { source: 'none' };
}

/** E.164 digits only — never WA @lid / device ids (INC-037). */
function extractWaPhoneE164(...candidates: Array<string | null | undefined>): string | undefined {
  for (const c of candidates) {
    const raw = String(c || '').trim();
    if (!raw) continue;
    if (raw.toLowerCase().includes('@lid')) continue;
    // Prefer real WA user JIDs; skip groups
    if (raw.toLowerCase().includes('@g.us')) continue;
    const digits = normalizeWaNumber(raw);
    if (isLikelyE164Phone(digits)) return digits;
  }
  return undefined;
}

function extractPhoneFromInboundItem(item: any): string | undefined {
  return (
    extractWaPhoneE164(...waInboundIdentityCandidates(item)) ||
    extractWaPhoneE164(item?.participant, item?.key?.participant) ||
    extractPhoneFromWaContactMessage(item?.message)
  );
}

/**
 * If stored messages expose exactly one non-self E.164 participant (rare on LID
 * chats, but cheap to check), use it as the peer phone.
 */
function extractUniqueParticipantPhone(
  msgs: any[],
  ownPhoneDigits?: string,
): string | undefined {
  const phones = new Set<string>();
  for (const m of msgs) {
    const phone =
      extractPhoneFromInboundItem(m) ||
      extractWaPhoneE164(m?.participant, m?.key?.participant);
    if (!phone) continue;
    if (ownPhoneDigits && phone === ownPhoneDigits) continue;
    phones.add(phone);
  }
  if (phones.size === 1) return [...phones][0];
  return undefined;
}

/** Source tag when phone came from shared contact card (for logs). */
function inboundPhoneSource(item: any): LidPnSource | undefined {
  if (extractWaPhoneE164(...waInboundIdentityCandidates(item))) return 'webhook';
  if (extractPhoneFromWaContactMessage(item?.message)) return 'vcard';
  return undefined;
}

function extractProfilePicFromInboundItem(item: any): string | undefined {
  const candidates = [
    item?.profilePicUrl,
    item?.profilePictureUrl,
    item?.picture,
    item?.key?.profilePicUrl,
  ];
  for (const c of candidates) {
    const s = String(c || '').trim();
    if (s.startsWith('http')) return s;
  }
  return undefined;
}

/** Prefer phone JID (@s.whatsapp.net) over Linked ID when Evolution provides remoteJidAlt. */
function resolveInboundWaJid(item: any): string {
  const remoteJid = String(item?.key?.remoteJid || item?.remoteJid || '');
  const phone = extractPhoneFromInboundItem(item);
  if (remoteJid.toLowerCase().includes('@lid') && phone) {
    return `${phone}@s.whatsapp.net`;
  }
  const alt = waInboundIdentityCandidates(item).find(
    (c) => c && !c.toLowerCase().includes('@lid') && !c.toLowerCase().endsWith('@g.us'),
  );
  if (remoteJid.toLowerCase().includes('@lid') && alt) return alt;
  return remoteJid;
}

/** Human label for CRM — never append raw LID digits (INC-039). */
function cleanWaContactName(
  name?: string | null,
  lidOrPeerDigits?: string | null,
): string {
  let n = String(name || '').trim();
  const lid = normalizeWaNumber(lidOrPeerDigits || '');
  if (lid && n.endsWith(lid)) {
    n = n.slice(0, -lid.length).trim();
  }
  // Strip accidental "Name 165274770739447" suffixes (14–16 digit LIDs)
  n = n.replace(/\s+\d{14,16}\s*$/, '').trim();
  if (!n || /^\d{14,16}$/.test(n)) return 'WhatsApp';
  // Evolution / WA clients label the account itself on fromMe bubbles.
  if (/^(você|voce|you|me|eu)$/i.test(n)) return 'WhatsApp';
  if (/^whatsapp(\s+business)?$/i.test(n)) return 'WhatsApp';
  return n;
}

function typingDelayMs(text: string): number {
  const base = 1400;
  const perChar = 40;
  // Min ~3s so «печатает…» is visible on personal WA clients before the bubble.
  return Math.min(6500, Math.max(3000, base + String(text || '').length * perChar));
}

/** Parse n8n-style multi-bubble JSON; fallback to paragraph / single bubble. */
function parseAiBubbles(raw: string): string[] {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return [];
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as Record<
        string,
        unknown
      >;
      const bubbles: string[] = [];
      for (let i = 1; i <= 8; i += 1) {
        const v = parsed[`message${i}`];
        if (typeof v === 'string' && v.trim()) bubbles.push(v.trim());
      }
      if (bubbles.length) return bubbles;
    }
  } catch {
    /* fall through */
  }

  const paras = trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length > 1 && paras.length <= 6) return paras;
  return [trimmed];
}

function waRemoteJidForRead(to: string): string {
  const formatted = formatWaSendRecipient(to);
  if (!formatted) return '';
  if (formatted.includes('@')) return formatted;
  return `${formatted}@s.whatsapp.net`;
}

function waRemoteJidCandidates(to: string): string[] {
  const raw = String(to || '').trim();
  const out: string[] = [];
  const push = (v: string) => {
    const s = v.trim();
    if (s && !out.includes(s)) out.push(s);
  };
  if (!raw) return out;
  if (raw.includes('@')) {
    push(raw.replace(/:\d+(?=@)/, ''));
  }
  const digits = normalizeWaNumber(raw);
  if (digits) {
    if (isWhatsAppLid(digits) || raw.toLowerCase().includes('@lid')) {
      push(`${digits}@lid`);
    } else {
      push(`${digits}@s.whatsapp.net`);
      push(digits);
    }
  }
  const primary = waRemoteJidForRead(to);
  if (primary) push(primary);
  return out;
}

function normalizeWaMessageIds(ids: string[]): string[] {
  const out: string[] = [];
  for (const raw of ids) {
    let id = String(raw || '').trim();
    if (!id) continue;
    // Strip common prefixes / full keys like "true_7916...@s.whatsapp.net_ABCDEF"
    if (id.includes('_')) {
      const parts = id.split('_');
      const last = parts[parts.length - 1];
      if (last && last.length >= 8) id = last;
    }
    if (!out.includes(id)) out.push(id);
  }
  return out.slice(0, 20);
}

/** Best-effort mark inbound messages as read (blue ticks). */
async function markWhatsAppRead(
  instanceName: string,
  to: string,
  messageIds: string[],
  preferredRemoteJid?: string,
): Promise<void> {
  const ids = normalizeWaMessageIds(messageIds);
  const rawIds = messageIds.map((id) => String(id || '').trim()).filter(Boolean);
  const allIds = [...new Set([...ids, ...rawIds])].slice(0, 20);
  const jids = [
    ...(preferredRemoteJid ? [preferredRemoteJid.replace(/:\d+(?=@)/, '')] : []),
    ...waRemoteJidCandidates(to),
  ].filter((v, i, a) => v && a.indexOf(v) === i);
  if (!jids.length || !allIds.length) {
    console.warn(
      `[ai-whatsapp] markRead skip: jids=${jids.length} ids=${allIds.length} to=${to}`,
    );
    return;
  }
  for (const remoteJid of jids) {
    for (const idSet of [allIds, ids, rawIds]) {
      const unique = [...new Set(idSet)].filter(Boolean).slice(0, 20);
      if (!unique.length) continue;
      const res = await evoFetch(`/chat/markMessageAsRead/${encodeURIComponent(instanceName)}`, {
        method: 'POST',
        body: JSON.stringify({
          readMessages: unique.map((id) => ({ remoteJid, fromMe: false, id })),
        }),
      }).catch(() => null);
      if (res?.ok || res?.status === 201) {
        console.log(
          `[ai-whatsapp] markRead ok jid=${remoteJid} ids=${unique.slice(0, 3).join(',')}`,
        );
        return;
      }
      if (res && !res.ok) {
        console.warn(
          '[ai-whatsapp] markMessageAsRead failed',
          res.status,
          evolutionErrorMessage(res.json, ''),
          { remoteJid, ids: unique.slice(0, 3) },
        );
      }
    }
  }
}

function mediaTypeForMime(
  mimeType: string,
  filename: string,
): 'image' | 'video' | 'document' {
  if (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(filename)) {
    return 'image';
  }
  if (mimeType.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(filename)) {
    return 'video';
  }
  return 'document';
}

async function softCheckAddon(tenantId: string): Promise<{ ok: boolean; warning: string | null }> {
  const addon = await prisma.addon.findUnique({
    where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_WHATSAPP } },
  });
  const active = Boolean(addon && addon.status === 'active' && addon.activeUntil > new Date());
  return {
    ok: true,
    warning: active
      ? null
      : 'Тариф WhatsApp ещё не оплачен — soft-режим (подключение доступно для теста).',
  };
}

async function ensureBotInstance(tenantId: string, slug: string, displayLabel: string) {
  const instanceName = instanceNameFor(tenantId, slug);
  const label = String(displayLabel || '').trim() || slug;
  const existing = await prisma.botInstance.findFirst({
    where: { tenantId, botType: 'ai_wa', botUsername: slug },
  });
  if (existing) {
    const session = decodeSession(existing.botTokenEncrypted);
    const data: {
      displayName?: string;
      botTokenEncrypted?: string;
    } = {};
    if (existing.displayName !== label) data.displayName = label;
    if (session?.instanceName !== instanceName) {
      data.botTokenEncrypted = encodeSession({
        instanceName,
        instanceHash: session?.instanceHash,
      });
    }
    if (Object.keys(data).length === 0) return existing;
    return prisma.botInstance.update({ where: { id: existing.id }, data });
  }
  return prisma.botInstance.create({
    data: {
      tenantId,
      botType: 'ai_wa',
      botUsername: slug,
      displayName: label,
      status: 'inactive',
      botTokenEncrypted: encodeSession({ instanceName }),
      provisionedVia: 'managed',
    },
  });
}

async function createOrConnectEvolution(botId: string, instanceName: string) {
  const webhookUrl = WEBHOOK_PUBLIC_URL;
  const create = await evoFetch('/instance/create', {
    method: 'POST',
    body: JSON.stringify({
      instanceName,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: [...WA_WEBHOOK_EVENTS],
      },
    }),
  });

  // Instance may already exist — fetch QR via connect
  if (!create.ok) {
    const connect = await evoFetch(`/instance/connect/${encodeURIComponent(instanceName)}`, {
      method: 'GET',
    });
    return { create, connect, botId };
  }

  const hash = create.json?.hash || create.json?.instance?.instanceId;
  if (hash) {
    await prisma.botInstance.update({
      where: { id: botId },
      data: {
        botTokenEncrypted: encodeSession({ instanceName, instanceHash: String(hash) }),
      },
    });
  }

  // Ensure webhook even if create payload shape differs
  await evoFetch(`/webhook/set/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url: webhookUrl,
        byEvents: false,
        base64: false,
        events: [...WA_WEBHOOK_EVENTS],
      },
    }),
  });

  return { create, connect: null as any, botId };
}

function pickQrBase64(payload: any): string | null {
  const b64 =
    payload?.qrcode?.base64 ||
    payload?.base64 ||
    payload?.qr?.base64 ||
    payload?.instance?.qrcode?.base64 ||
    null;
  if (!b64 || typeof b64 !== 'string') return null;
  return b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`;
}

async function waitForQr(instanceName: string, attempts = 8, delayMs = 1500): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const connect = await evoFetch(`/instance/connect/${encodeURIComponent(instanceName)}`, {
      method: 'GET',
    });
    const qr = pickQrBase64(connect.json);
    if (qr) return qr;
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return null;
}

async function handleQrStart(tenantId: string, nameRaw: string) {
  if (!evolutionConfigured()) {
    return {
      status: 503,
      body: { ok: false, error: 'Evolution API not configured', hint: setupHint() },
    };
  }
  const displayName = String(nameRaw || '').trim() || 'default';
  const name = sanitizeName(displayName);
  const billing = await softCheckAddon(tenantId);
  const bot = await ensureBotInstance(tenantId, name, displayName);
  const session = decodeSession(bot.botTokenEncrypted);
  if (!session?.instanceName) {
    return { status: 500, body: { ok: false, error: 'Failed to allocate instance name' } };
  }

  const { create, connect } = await createOrConnectEvolution(bot.id, session.instanceName);
  let qr =
    pickQrBase64(create.json) ||
    pickQrBase64(connect?.json) ||
    null;
  if (!qr) {
    qr = await waitForQr(session.instanceName);
  }

  const state = await evoFetch(
    `/instance/connectionState/${encodeURIComponent(session.instanceName)}`,
  );
  const stateVal =
    state.json?.instance?.state ||
    state.json?.state ||
    state.json?.status ||
    'close';

  if (String(stateVal).toLowerCase() === 'open') {
    await prisma.botInstance.update({
      where: { id: bot.id },
      data: { status: 'active' },
    });
    // History sync is manual only (portal «Синхронизировать» → /internal/crm/sync-history).
  }

  const preparingHint = !qr && String(stateVal).toLowerCase() !== 'open'
    ? 'QR ещё не готов. Обновите статус через несколько секунд. Если зависает — проверьте CONFIG_SESSION_PHONE_VERSION на Evolution.'
    : undefined;

  return {
    status: 200,
    body: {
      ok: true,
      botId: bot.id,
      name,
      displayName: bot.displayName || displayName,
      instanceName: session.instanceName,
      status: String(stateVal).toLowerCase() === 'open' ? 'authorized' : qr ? 'qr_ready' : 'preparing',
      qr,
      hint: preparingHint,
      billingWarning: billing.warning,
      evolution: {
        createOk: create.ok,
        createStatus: create.status,
        createError: create.ok ? null : create.json?.message || create.json?.error || null,
      },
    },
  };
}

/** Logout + delete Evolution instance, then remove BotInstance (or soft-clear if FK blocks). */
async function handleDeleteAccount(tenantId: string, botId: string) {
  const bot = await prisma.botInstance.findFirst({
    where: { id: botId, tenantId, botType: 'ai_wa' },
  });
  if (!bot) {
    return { status: 404, body: { ok: false, error: 'account not found' } };
  }

  const session = decodeSession(bot.botTokenEncrypted);
  let evolutionDeleted = false;
  if (session?.instanceName && evolutionConfigured()) {
    await evoFetch(`/instance/logout/${encodeURIComponent(session.instanceName)}`, {
      method: 'DELETE',
    }).catch(() => null);
    const del = await evoFetch(`/instance/delete/${encodeURIComponent(session.instanceName)}`, {
      method: 'DELETE',
    });
    evolutionDeleted = del.ok || del.status === 404;
  }

  await prisma.conversation.updateMany({
    where: { botInstanceId: bot.id },
    data: { botInstanceId: null },
  });

  try {
    await prisma.botInstance.delete({ where: { id: bot.id } });
  } catch {
    await prisma.botInstance.update({
      where: { id: bot.id },
      data: {
        status: 'inactive',
        botTokenEncrypted: null,
        phoneNumberId: null,
      },
    });
  }

  return {
    status: 200,
    body: {
      ok: true,
      botId: bot.id,
      evolutionDeleted,
    },
  };
}

async function handleQrStatus(tenantId: string, nameRaw: string) {
  const name = sanitizeName(nameRaw);
  const bot = await prisma.botInstance.findFirst({
    where: { tenantId, botType: 'ai_wa', botUsername: name },
  });
  if (!bot) {
    return { status: 200, body: { ok: true, status: 'unknown', qr: null } };
  }
  const session = decodeSession(bot.botTokenEncrypted);
  if (!session?.instanceName || !evolutionConfigured()) {
    return {
      status: 200,
      body: {
        ok: true,
        botId: bot.id,
        status: evolutionConfigured() ? 'error' : 'error',
        error: evolutionConfigured() ? 'missing session' : 'Evolution API not configured',
        hint: evolutionConfigured() ? undefined : setupHint(),
        qr: null,
      },
    };
  }

  const state = await evoFetch(
    `/instance/connectionState/${encodeURIComponent(session.instanceName)}`,
  );
  const stateVal = String(
    state.json?.instance?.state || state.json?.state || state.json?.status || 'close',
  ).toLowerCase();

  let qr: string | null = null;
  if (stateVal !== 'open') {
    qr = await waitForQr(session.instanceName, 4, 1200);
  } else {
    await prisma.botInstance.update({
      where: { id: bot.id },
      data: { status: 'active' },
    });
    // History sync is manual only (portal «Синхронизировать» → /internal/crm/sync-history).
  }

  const billing = await softCheckAddon(tenantId);
  return {
    status: 200,
    body: {
      ok: true,
      botId: bot.id,
      name,
      displayName: bot.displayName || name,
      instanceName: session.instanceName,
      status: stateVal === 'open' ? 'authorized' : qr ? 'qr_ready' : 'preparing',
      qr,
      hint:
        stateVal !== 'open' && !qr
          ? 'QR не получен от Evolution (часто устаревший CONFIG_SESSION_PHONE_VERSION).'
          : undefined,
      phoneNumberId: bot.phoneNumberId,
      billingWarning: billing.warning,
    },
  };
}

async function sendWhatsAppText(
  instanceName: string,
  to: string,
  text: string,
  opts?: { delayMs?: number },
) {
  const number = formatWaSendRecipient(to);
  if (!number) {
    throw new Error('WhatsApp recipient is empty');
  }
  const delay =
    opts?.delayMs != null
      ? Math.max(0, Math.min(12000, Math.floor(opts.delayMs)))
      : undefined;
  const body: Record<string, unknown> = { number, text };
  // Evolution `delay` shows «печатает…» for N ms then sends (HTTP blocks until done).
  if (delay && delay > 0) body.delay = delay;
  const res = await evoFetch(`/message/sendText/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      evolutionErrorMessage(res.json, `Evolution send failed (HTTP ${res.status})`),
    );
  }
}

async function sendWhatsAppMedia(opts: {
  instanceName: string;
  to: string;
  mediaBase64: string;
  mimeType: string;
  fileName: string;
  caption?: string;
}): Promise<{ type: 'photo' | 'video' | 'document'; fileId: string; fileName: string; mimeType: string }> {
  const number = formatWaSendRecipient(opts.to);
  if (!number) throw new Error('WhatsApp recipient is empty');
  // Evolution sendMedia validates with class-validator isBase64/isURL — a data: URL
  // fails both and returns 400 "Owned media must be a url or base64". Pass pure base64.
  const media = String(opts.mediaBase64 || '')
    .replace(/^data:[^;]+;base64,/, '')
    .replace(/\s+/g, '');
  if (!media) throw new Error('WhatsApp media payload is empty');
  let mimeType = opts.mimeType || 'application/octet-stream';
  const fileName = opts.fileName || 'file.bin';
  const mediatype = mediaTypeForMime(mimeType, fileName);
  // Browser often sends application/octet-stream; Evolution needs a real media mime.
  if (mediatype === 'image' && !mimeType.startsWith('image/')) mimeType = 'image/jpeg';
  if (mediatype === 'video' && !mimeType.startsWith('video/')) mimeType = 'video/mp4';
  const res = await evoFetch(`/message/sendMedia/${encodeURIComponent(opts.instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({
      number,
      mediatype,
      mimetype: mimeType,
      caption: opts.caption || '',
      media,
      fileName,
      delay: Math.min(2500, typingDelayMs(opts.caption || '')),
    }),
  });
  if (!res.ok) {
    throw new Error(
      evolutionErrorMessage(res.json, `Evolution media send failed (HTTP ${res.status})`),
    );
  }
  const keyId =
    (typeof res.json?.key?.id === 'string' && res.json.key.id) ||
    `wa-media-${Date.now()}`;
  return {
    type: mediatype === 'image' ? 'photo' : mediatype === 'video' ? 'video' : 'document',
    fileId: keyId,
    fileName,
    mimeType,
  };
}

/**
 * WhatsApp status/story via Evolution 2.3.7 `POST /message/sendStatus/{instance}`.
 * Public status: `allContacts: true` lets Evolution pick contacts from its own DB;
 * otherwise pass explicit `statusJidList` of raw phone digits (`^\d+` per schema).
 * `content` is a URL or base64 for image/video, plain text for text type.
 */
async function sendWhatsAppStory(opts: {
  instanceName: string;
  type: 'text' | 'image' | 'video';
  content: string;
  caption?: string;
  statusJidList?: string[];
  backgroundColor?: string;
  font?: number;
}): Promise<void> {
  const statusJidList = (opts.statusJidList || [])
    .map(normalizeWaNumber)
    .filter(Boolean);
  const body: Record<string, unknown> = {
    type: opts.type,
    content: opts.content,
  };
  if (opts.caption) body.caption = opts.caption;
  if (opts.backgroundColor) body.backgroundColor = opts.backgroundColor;
  if (typeof opts.font === 'number') body.font = opts.font;
  if (statusJidList.length > 0) {
    body.statusJidList = statusJidList;
    body.allContacts = false;
  } else {
    // Evolution fills statusJidList from its own contact DB (public story).
    body.allContacts = true;
  }
  const res = await evoFetch(
    `/message/sendStatus/${encodeURIComponent(opts.instanceName)}`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    throw new Error(
      evolutionErrorMessage(res.json, `Evolution story send failed (HTTP ${res.status})`),
    );
  }
}

/** Best-effort presenceSubscribe via Evolution — may refresh Baileys lidMapping (INC-097 v8.2). */
async function pokeWaLidMappingViaPresence(
  instanceName: string,
  lidDigits: string,
): Promise<void> {
  const lid = normalizeWaNumber(lidDigits);
  if (!instanceName || !lid || !isWhatsAppLid(`${lid}@lid`)) return;
  const jid = `${lid}@lid`;
  await sendWhatsAppTyping(instanceName, jid, 800).catch(() => undefined);
  await sleep(350);
  await clearWhatsAppTyping(instanceName, jid).catch(() => undefined);
}

/** Best-effort typing indicator (Evolution presence = composing). */
async function sendWhatsAppTyping(
  instanceName: string,
  to: string,
  delayMs = 2500,
): Promise<void> {
  const number = formatWaSendRecipient(to);
  if (!number) return;
  const delay = Math.max(400, Math.min(8000, Math.floor(delayMs)));
  // Evolution ≥2.3.7 expects top-level `presence` + `delay` (nested `options` → 400).
  const res = await evoFetch(`/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({
      number,
      delay,
      presence: 'composing',
    }),
  }).catch(() => null);
  if (res && !res.ok) {
    console.warn(
      '[ai-whatsapp] sendPresence failed',
      res.status,
      evolutionErrorMessage(res.json, ''),
    );
  }
}

/** Clear stuck «печатает…» after abort / error / reply complete. */
async function clearWhatsAppTyping(instanceName: string, to: string): Promise<void> {
  const number = formatWaSendRecipient(to);
  if (!number) return;
  const res = await evoFetch(`/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({
      number,
      delay: 0,
      presence: 'paused',
    }),
  }).catch(() => null);
  if (res && !res.ok) {
    console.warn(
      '[ai-whatsapp] clearPresence failed',
      res.status,
      evolutionErrorMessage(res.json, ''),
    );
  }
}

async function sendWhatsAppHumanLike(
  instanceName: string,
  to: string,
  bubbles: string[],
  opts?: { conversationId?: string; sendStartedAt?: Date; signal?: AbortSignal },
): Promise<{ aborted?: boolean; sent: number }> {
  const parts = bubbles.map((b) => b.trim()).filter(Boolean).slice(0, 4);
  let sent = 0;
  try {
    for (let i = 0; i < parts.length; i += 1) {
      if (
        opts?.signal?.aborted ||
        (opts?.conversationId &&
          opts.sendStartedAt &&
          (await hasNewerUserMessage(opts.conversationId, opts.sendStartedAt)))
      ) {
        await clearWhatsAppTyping(instanceName, to);
        return { aborted: true, sent };
      }
      const text = parts[i];
      const thinkMs = typingDelayMs(text);
      // Kick composing immediately, then sendText(delay) holds typing until the bubble.
      await sendWhatsAppTyping(instanceName, to, thinkMs);
      console.log(
        `[ai-whatsapp] typing+send delay=${thinkMs}ms bubble=${i + 1}/${parts.length}`,
      );
      await sendWhatsAppText(instanceName, to, text, { delayMs: thinkMs });
      sent += 1;
      if (i < parts.length - 1) {
        if (
          opts?.signal?.aborted ||
          (opts?.conversationId &&
            opts.sendStartedAt &&
            (await hasNewerUserMessage(opts.conversationId, opts.sendStartedAt)))
        ) {
          await clearWhatsAppTyping(instanceName, to);
          return { aborted: true, sent };
        }
        const gap = humanBubbleGapMs();
        console.log(
          `[ai-whatsapp] human gap ${gap}ms before bubble ${i + 2}/${parts.length}`,
        );
        // Keep composing visible during the quiet gap between bubbles.
        void sendWhatsAppTyping(instanceName, to, gap);
        await sleep(gap);
      }
    }
    return { sent };
  } finally {
    // Always clear composing so WA UI does not stick on «печатает…».
    await clearWhatsAppTyping(instanceName, to);
  }
}

/** Always re-read AiAgent by id so portal PATCH (prompt/model) applies on next message. */
async function resolveAssignedAgent(conversationId: string) {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      aiAgentId: true,
      botInstance: { select: { defaultAiAgentId: true } },
    },
  });
  if (!c) return null;
  const agentId = c.aiAgentId || c.botInstance?.defaultAiAgentId;
  if (!agentId) return null;
  return prisma.aiAgent.findFirst({
    where: { id: agentId, status: 'active' },
    select: {
      id: true,
      name: true,
      systemPrompt: true,
      settings: true,
      status: true,
      updatedAt: true,
    },
  });
}

async function shouldAiReply(conversationId: string): Promise<boolean> {
  const c = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!c) return false;
  if (c.aiDisabled) return false;
  if (c.status === 'closed') return false;
  if (!isAiConversationMode(c.mode)) return false;
  if (c.pausedUntil && c.pausedUntil.getTime() > Date.now()) return false;
  const agent = await resolveAssignedAgent(conversationId);
  return Boolean(agent);
}

async function switchToHuman(
  instanceName: string,
  from: string,
  tenantId: string,
  botId: string,
  conversationId: string,
) {
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { mode: 'human', status: 'waiting_for_human' },
  });

  await sendWhatsAppText(instanceName, from, 'Режим оператора. Ожидайте ответа.');

  await fireGoal({
    tenantId,
    goalName: 'human_handoff',
    subscriberId: from,
    botInstanceId: botId,
  });
}

async function syncLeadToCrm(opts: {
  tenantId: string;
  botId: string;
  conversationId: string;
  platformUserId: string;
  contactName?: string;
  /** Explicit Person firstName (nonameN / real name); never «WhatsApp». */
  personFirstName?: string;
  /** Opportunity title — `{seq} · WA · {accountDisplayName}` (INC-097 v6). */
  opportunityName?: string;
  /** Real E.164 digits when known (remoteJidAlt / senderPn); never LID. */
  phoneE164?: string;
  /** Optional email from WA business profile (LID peers often lack phone). */
  email?: string;
  website?: string;
  instagram?: string;
  facebook?: string;
  /** Optional Telegram @username for cross-channel hint merge. */
  telegramUsername?: string;
  /**
   * Mark needsReview (e.g. ambiguous phone match). Does NOT block Person create
   * when personFirstName / phone is present (INC-097 v6).
   */
  forceNeedsReview?: boolean;
}): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: opts.conversationId },
    });
    if (!conversation) return;

    const phoneForCrmEarly =
      (opts.phoneE164 && isLikelyE164Phone(opts.phoneE164) ? opts.phoneE164 : undefined) ||
      (isLikelyE164Phone(opts.platformUserId) ? opts.platformUserId : undefined) ||
      phoneFromPlatformUsername(conversation.platformUsername);
    const lidDigits = isWhatsAppLid(opts.platformUserId)
      ? normalizeWaNumber(opts.platformUserId)
      : isWhatsAppLid(conversation.platformUserId)
        ? normalizeWaNumber(conversation.platformUserId)
        : undefined;
    if (phoneForCrmEarly || lidDigits) {
      const merged = await mergeWaLidPnTwinConversations({
        tenantId: opts.tenantId,
        botId: opts.botId,
        phoneE164: phoneForCrmEarly,
        lidDigits,
        preferConversationId: opts.conversationId,
      });
      if (merged && merged.canonicalId !== opts.conversationId) {
        opts = { ...opts, conversationId: merged.canonicalId };
      }
    }

    const conversationAfterMerge = await prisma.conversation.findUnique({
      where: { id: opts.conversationId },
    });
    if (!conversationAfterMerge) return;

    const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId } });
    if (!tenant?.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) return;

    const owner = await prisma.tenantMember.findFirst({
      where: { tenantId: opts.tenantId, role: 'owner' },
      include: { user: true },
    });
    if (!owner?.user?.email) return;

    const bot = await prisma.botInstance.findUnique({
      where: { id: opts.botId },
      select: { botUsername: true, displayName: true, phoneNumberId: true },
    });

    const client = new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    });
    await client.authenticateWorkspace(
      owner.user.email,
      decrypt(tenant.twentyOwnerPasswordEncrypted),
      tenant.twentyWorkspaceId,
    );

    try {
      await client.ensureSocialFields();
    } catch (err) {
      console.warn('[ai-whatsapp] ensureSocialFields failed', err);
    }

    const phoneForCrm =
      (opts.phoneE164 && isLikelyE164Phone(opts.phoneE164) ? opts.phoneE164 : undefined) ||
      (isLikelyE164Phone(opts.platformUserId) ? opts.platformUserId : undefined) ||
      phoneFromPlatformUsername(conversationAfterMerge.platformUsername);
    const displayName = cleanWaContactName(opts.contactName, opts.platformUserId);
    const personFirstName =
      opts.personFirstName ||
      (displayName !== 'WhatsApp' ? displayName : undefined) ||
      (phoneForCrm ? `+${phoneForCrm}` : undefined);
    const whatsappValue = phoneForCrm ? `+${phoneForCrm}` : undefined;

    // INC-042: after CRM wipe, Conversation may still hold deleted Twenty ids.
    // Validate before early-return / updates; clear + recreate when missing.
    // Soft-deleted Opportunity still stored on Conversation looks “linked” until we check.
    // suppressDealCreation is manual only (CRM «Не создавать сделку») — never auto-set on delete.
    let personId = conversationAfterMerge.twentyPersonId || undefined;
    let opportunityId = conversationAfterMerge.twentyOpportunityId || undefined;
    let clearedStale = false;
    let needsReview = conversationAfterMerge.needsReview || Boolean(opts.forceNeedsReview);
    let suppressDeal =
      (conversationAfterMerge as { suppressDealCreation?: boolean }).suppressDealCreation ===
      true;

    if (personId) {
      const ok = await client.personExists(personId);
      if (!ok) {
        console.warn(
          `[ai-whatsapp] stale twentyPersonId=${personId} conv=${opts.conversationId}; recreating`,
        );
        personId = undefined;
        opportunityId = undefined;
        clearedStale = true;
      }
    }
    if (opportunityId) {
      const ok = await client.opportunityExists(opportunityId);
      if (!ok) {
        console.warn(
          `[ai-whatsapp] deleted/stale twentyOpportunityId=${opportunityId} conv=${opts.conversationId}; clearing link`,
        );
        opportunityId = undefined;
        clearedStale = true;
      }
    }
    if (clearedStale) {
      await prisma.conversation.update({
        where: { id: opts.conversationId },
        data: {
          twentyPersonId: personId || null,
          twentyOpportunityId: null,
        },
      });
    }

    // Cross-channel merge: reuse TG/gift Person by phone (and optional TG username hint).
    const emailForCrmEarly =
      opts.email && opts.email.includes('@') ? opts.email.trim().toLowerCase() : undefined;
    if (!personId) {
      const candidateIds = new Set<string>();

      if (emailForCrmEarly) {
        try {
          const byEmail = await client.findPersonByEmail(emailForCrmEarly);
          if (byEmail?.id) {
            const ok = await client.personExists(byEmail.id);
            if (ok) candidateIds.add(byEmail.id);
          }
        } catch (err) {
          console.warn('[ai-whatsapp] findPersonByEmail failed', err);
        }
      }

      if (phoneForCrm) {
        try {
          const byPhone = await client.findPersonByPhone(`+${phoneForCrm}`);
          if (byPhone?.ids?.length) {
            for (const id of byPhone.ids) {
              const ok = await client.personExists(id);
              if (ok) candidateIds.add(id);
            }
            if (byPhone.ids.length > 1) needsReview = true;
          }
        } catch (err) {
          console.warn('[ai-whatsapp] findPersonByPhone failed', err);
        }
      }

      const tgHint =
        opts.telegramUsername ||
        (opts.contactName && /^@?[A-Za-z0-9_]{5,}$/.test(opts.contactName.trim())
          ? opts.contactName.trim()
          : undefined);
      if (tgHint) {
        try {
          const hinted = await client.findPersonByHint({
            username: tgHint.replace(/^@/, ''),
            lastName: `@${tgHint.replace(/^@/, '')}`,
          });
          if (hinted?.id) {
            const ok = await client.personExists(hinted.id);
            if (ok) candidateIds.add(hinted.id);
          }
        } catch {
          /* ignore */
        }
      }

      // Prior WA conversation same LID/phone
      const priorConv = await prisma.conversation.findFirst({
        where: {
          tenantId: opts.tenantId,
          platformUserId: opts.platformUserId,
          twentyPersonId: { not: null },
          NOT: { id: opts.conversationId },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (priorConv?.twentyPersonId) {
        const ok = await client.personExists(priorConv.twentyPersonId);
        if (ok) candidateIds.add(priorConv.twentyPersonId);
        if (!opportunityId && priorConv.twentyOpportunityId) {
          const oppOk = await client.opportunityExists(priorConv.twentyOpportunityId);
          if (oppOk) opportunityId = priorConv.twentyOpportunityId;
        }
      }

      if (candidateIds.size > 1) needsReview = true;
      if (candidateIds.size >= 1) {
        personId = [...candidateIds][0];
        if (needsReview) {
          console.warn(
            `[ai-whatsapp] ambiguous Person match for wa=${opts.platformUserId}: ${[...candidateIds].join(',')}`,
          );
        }
      }
    }

    const emailForCrm = emailForCrmEarly;

    const applyBusinessSocial = async (id: string) => {
      if (emailForCrm) {
        let ok = await client.updatePersonEmail(id, emailForCrm);
        if (!ok && tenant.twentyWorkspaceId) {
          const freed = await releaseSoftDeletedPersonEmail(
            tenant.twentyWorkspaceId,
            emailForCrm,
          );
          if (freed > 0) {
            ok = await client.updatePersonEmail(id, emailForCrm);
          }
        }
        if (!ok) {
          console.warn(
            `[ai-whatsapp] could not set email=${emailForCrm} on person=${id} — unique still held after trash clear attempt`,
          );
        }
      }
      if (opts.website) {
        await client.updatePersonSocialText(id, 'website', opts.website);
      }
      if (opts.instagram) {
        await client.updatePersonSocialText(id, 'instagram', opts.instagram);
      }
      if (opts.facebook) {
        await client.updatePersonSocialText(id, 'facebook', opts.facebook);
      }
    };

    if (!personId) {
      if (!personFirstName && !phoneForCrm) {
        console.warn(
          `[ai-whatsapp] syncLeadToCrm refuse Person create without identity conv=${opts.conversationId}`,
        );
        return;
      }
      // Create without email first — soft-deleted Persons often still hold unique emails
      // in Twenty (IDX on emailsPrimaryEmail includes trash). Attach email after create.
      const created = await client.createPerson({
        firstName: personFirstName || (phoneForCrm ? `+${phoneForCrm}` : 'noname'),
        // Never put LID / platformUserId into lastName (shows as «Антон 165…», INC-039).
        lastName: undefined,
        email: undefined,
        // Only pass real phones — WA @lid ids crash Twenty phone validation (INC-037).
        phone: whatsappValue,
        whatsapp: whatsappValue,
      });
      personId = created?.id;
      if (personId && phoneForCrm) {
        try {
          await client.updatePersonPhone(personId, `+${phoneForCrm}`);
        } catch {
          /* ignore */
        }
        try {
          await client.updatePersonWhatsapp(personId, `+${phoneForCrm}`);
        } catch {
          /* ignore */
        }
      }
      if (personId) await applyBusinessSocial(personId);
    } else if (phoneForCrm) {
      // Backfill phone on existing Person when LID→PN mapping appears later / TG merge.
      try {
        await client.updatePersonPhone(personId, `+${phoneForCrm}`);
      } catch {
        /* ignore */
      }
      try {
        await client.updatePersonWhatsapp(personId, `+${phoneForCrm}`);
      } catch {
        /* ignore */
      }
      await applyBusinessSocial(personId);
      // Clear LID-looking lastName left by older sync (INC-039).
      try {
        await client.updatePersonName(personId, {
          firstName: personFirstName || `+${phoneForCrm}`,
          lastName: '',
        });
      } catch {
        /* ignore */
      }
    } else {
      await applyBusinessSocial(personId);
      if (personFirstName && personFirstName !== 'WhatsApp') {
        try {
          await client.updatePersonName(personId, {
            firstName: personFirstName,
            lastName: '',
          });
        } catch {
          /* ignore */
        }
      }
    }

    if (personId && opportunityId && !clearedStale) {
      if (phoneForCrm) {
        try {
          await client.updatePersonPhone(personId, `+${phoneForCrm}`);
        } catch {
          /* ignore */
        }
        try {
          await client.updatePersonWhatsapp(personId, `+${phoneForCrm}`);
        } catch {
          /* ignore */
        }
      }
      await applyBusinessSocial(personId);
      if (opts.opportunityName && tenant.twentyWorkspaceId) {
        await renameWhatsAppShellOpportunity({
          workspaceId: tenant.twentyWorkspaceId,
          opportunityId,
          opportunityName: opts.opportunityName,
        });
      }
      if (phoneForCrm || personFirstName || needsReview || emailForCrm) {
        await prisma.conversation.update({
          where: { id: opts.conversationId },
          data: {
            twentyPersonId: personId,
            twentyOpportunityId: opportunityId,
            needsReview: needsReview || conversationAfterMerge.needsReview,
            platformFirstName:
              personFirstName && personFirstName !== 'WhatsApp'
                ? personFirstName
                : conversationAfterMerge.platformFirstName,
            platformUsername: phoneForCrm
              ? `+${phoneForCrm}`
              : conversationAfterMerge.platformUsername,
          },
        });
        await upsertCrmRecordLink(prisma, {
          tenantId: opts.tenantId,
          conversationId: opts.conversationId,
          twentyPersonId: personId,
          twentyOpportunityId: opportunityId,
        });
      }
      return;
    }

    // Reuse Opportunity already linked to this Person (TG/gift/other WA).
    if (!opportunityId && personId) {
      const linkedOpp = await prisma.conversation.findFirst({
        where: {
          tenantId: opts.tenantId,
          twentyPersonId: personId,
          twentyOpportunityId: { not: null },
          NOT: { id: opts.conversationId },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (
        linkedOpp?.twentyOpportunityId &&
        (await client.opportunityExists(linkedOpp.twentyOpportunityId))
      ) {
        opportunityId = linkedOpp.twentyOpportunityId;
      }
    }

    // Critical: reuse open Opportunity on Person in Twenty (covers LID↔PN race
    // where two syncs create two Opps before either Conversation is linked).
    if (!opportunityId && personId) {
      try {
        const openOpp = await client.findOpenOpportunityByPerson(personId);
        if (openOpp?.id) {
          opportunityId = openOpp.id;
          console.log(
            `[ai-whatsapp] reuse open Opportunity ${opportunityId} for person=${personId} conv=${opts.conversationId}`,
          );
        }
      } catch (err) {
        console.warn(
          '[ai-whatsapp] findOpenOpportunityByPerson failed',
          err instanceof Error ? err.message : err,
        );
      }
    }

    if (!opportunityId && personId && !suppressDeal) {
      const botLabel = bot?.displayName || bot?.botUsername || 'WhatsApp';
      const oppName = opts.opportunityName || `${botLabel} · WA`;
      const opportunity = await client.createOpportunity({
        name: oppName,
        personId,
        stage: 'NEW',
      });
      opportunityId = opportunity?.id;
      await fireGoal({
        tenantId: opts.tenantId,
        goalName: 'whatsapp_lead_created',
        subscriberId: opts.platformUserId,
        botInstanceId: opts.botId,
      });
    } else if (!opportunityId && personId && suppressDeal) {
      console.log(
        `[ai-whatsapp] skip Opportunity create conv=${opts.conversationId} (suppressDealCreation)`,
      );
    }

    await prisma.conversation.update({
      where: { id: opts.conversationId },
      data: {
        twentyPersonId: personId || null,
        twentyOpportunityId: opportunityId || null,
        suppressDealCreation: suppressDeal,
        needsReview: needsReview || conversationAfterMerge.needsReview,
        platformFirstName:
          personFirstName && personFirstName !== 'WhatsApp'
            ? personFirstName
            : conversationAfterMerge.platformFirstName,
        platformUsername: phoneForCrm
          ? `+${phoneForCrm}`
          : conversationAfterMerge.platformUsername,
      },
    });
    await upsertCrmRecordLink(prisma, {
      tenantId: opts.tenantId,
      conversationId: opts.conversationId,
      twentyPersonId: personId || null,
      twentyOpportunityId: opportunityId || null,
    });

    if (personId || opportunityId) {
      console.log(
        `[ai-whatsapp] syncLeadToCrm ok conv=${opts.conversationId} person=${personId || '-'} opp=${opportunityId || '-'} clearedStale=${clearedStale}`,
      );
    } else {
      console.warn(
        `[ai-whatsapp] syncLeadToCrm left CRM empty conv=${opts.conversationId} phone=${phoneForCrm || '-'}`,
      );
    }

    if (personId && phoneForCrm) {
      try {
        await enrichTelegramPresenceFromPhone({
          tenantId: opts.tenantId,
          personId,
          phoneE164: phoneForCrm,
          client,
        });
      } catch (err) {
        console.warn(
          '[ai-whatsapp] telegram presence enrich failed',
          err instanceof Error ? err.message : err,
        );
      }
      try {
        await enrichMaxPresenceFromPhone({
          tenantId: opts.tenantId,
          personId,
          phoneE164: phoneForCrm,
          client,
        });
      } catch (err) {
        console.warn(
          '[ai-whatsapp] max presence enrich failed',
          err instanceof Error ? err.message : err,
        );
      }
    }

    // Kanban «Последнее обновление» follows chat, not only CRM field edits.
    if (opportunityId) {
      try {
        await client.touchOpportunityActivity(opportunityId);
      } catch {
        /* ignore */
      }
    }

    if (personId && (clearedStale || !conversationAfterMerge.twentyPersonId)) {
      try {
        const account =
          bot?.displayName ||
          (bot?.phoneNumberId ? `+${bot.phoneNumberId}` : null) ||
          bot?.botUsername ||
          '';
        await client.createNoteForPerson({
          personId,
          title: 'WhatsApp чат',
          body: `Диалог начат через WhatsApp${account ? ` (${account})` : ''}.${
            phoneForCrm ? ` Телефон: +${phoneForCrm}.` : ''
          }`,
        });
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.error(
      `[ai-whatsapp] syncLeadToCrm failed conv=${opts.conversationId}`,
      err instanceof Error ? err.message : err,
    );
  }
}

async function handleInboundMessage(opts: {
  instanceName: string;
  from: string;
  text: string;
  messageId?: string;
  contactName?: string;
  pushName?: string;
  phoneE164?: string;
  /** How phoneE164 was obtained when already known from webhook. */
  phoneSource?: LidPnSource;
  profilePicUrl?: string;
  remoteJid?: string;
  attachments?: WaAttachment[];
  needsVision?: boolean;
  needsAsr?: boolean;
  needsDoc?: boolean;
  mimeHint?: string;
  fromMe?: boolean;
}) {
  // MVP: decrypt session payloads (tenant WA count is small).
  const candidates = await prisma.botInstance.findMany({
    where: { botType: 'ai_wa' },
    take: 500,
  });
  const resolved =
    candidates.find((b) => decodeSession(b.botTokenEncrypted)?.instanceName === opts.instanceName) ||
    null;
  if (!resolved) {
    console.warn(`[ai-whatsapp] No bot for instance ${opts.instanceName}`);
    return;
  }

  const from = normalizeWaNumber(opts.from);
  if (!from) return;

  // Same WA message often arrives twice (PN @s.whatsapp.net + twin @lid). Skip the twin
  // but enrich the existing thread with E.164 when this event carries it.
  if (opts.messageId) {
    const already = await prisma.chatMessage.findFirst({
      where: {
        externalMessageId: opts.messageId,
        conversation: {
          botInstanceId: resolved.id,
          platform: 'whatsapp',
        },
      },
      select: {
        id: true,
        conversationId: true,
        conversation: {
          select: {
            id: true,
            platformUserId: true,
            platformUsername: true,
            platformFirstName: true,
            tenantId: true,
          },
        },
      },
    });
    if (already?.conversation) {
      const twinPhone =
        (opts.phoneE164 && isLikelyE164Phone(opts.phoneE164) ? opts.phoneE164 : undefined) ||
        (isLikelyE164Phone(from) ? from : undefined);
      const conv = already.conversation;
      if (twinPhone && conv.platformUsername !== `+${twinPhone}`) {
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            platformUsername: `+${twinPhone}`,
          },
        });
        void syncLeadToCrm({
          tenantId: conv.tenantId,
          botId: resolved.id,
          conversationId: conv.id,
          platformUserId: conv.platformUserId,
          contactName: conv.platformFirstName || opts.contactName || opts.pushName || undefined,
          phoneE164: twinPhone,
        }).catch((err) => {
          console.error('[ai-whatsapp] syncLeadToCrm twin enrich failed', err);
        });
      }
      console.log(
        `[ai-whatsapp] skip duplicate webhook messageId=${opts.messageId} from=${from} existingConv=${already.conversationId}`,
      );
      return;
    }
  }

  let phoneE164 =
    (opts.phoneE164 && isLikelyE164Phone(opts.phoneE164) ? opts.phoneE164 : undefined) ||
    (isLikelyE164Phone(from) ? from : undefined);
  let phoneSource: LidPnSource = phoneE164
    ? opts.phoneSource || 'webhook'
    : 'none';
  // LID-only webhooks: resolve E.164 via Contact book (incl. unique name) + Chat/Redis.
  if (!phoneE164 && isWhatsAppLid(from)) {
    const book = await loadEvolutionContactBook(opts.instanceName);
    const fromBook = matchContactBookIdentity(book, {
      lidDigits: from,
      pushName: opts.contactName || opts.pushName,
    });
    if (fromBook.phone) {
      phoneE164 = fromBook.phone;
      phoneSource = fromBook.source;
    }
  }
  if (!phoneE164 && isWhatsAppLid(from)) {
    const fromContacts = await resolvePhoneFromEvolutionContacts(opts.instanceName, from, {
      pushName: opts.contactName || opts.pushName,
      profilePicUrl: opts.profilePicUrl,
    });
    if (fromContacts.phone) {
      phoneE164 = fromContacts.phone;
      phoneSource = fromContacts.source;
    } else {
      const fromEvolution = await resolveLidPhoneFromEvolution(opts.instanceName, from, {
        pushName: opts.contactName || opts.pushName,
        profilePicUrl: opts.profilePicUrl,
      });
      if (fromEvolution.phone) {
        phoneE164 = fromEvolution.phone;
        phoneSource = fromEvolution.source;
      }
    }
  }

  if (resolved.status !== 'active') {
    await prisma.botInstance.update({
      where: { id: resolved.id },
      data: { status: 'active' },
    });
  }

  // Prefer existing open thread: exact platformUserId, or same E.164 (LID↔PN merge).
  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: resolved.tenantId,
      botInstanceId: resolved.id,
      platform: 'whatsapp',
      platformUserId: from,
      status: { in: ['open', 'waiting_for_human'] },
    },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: CONTEXT_WINDOW },
    },
  });
  // Reopen closed same-peer thread so AI + CRM sync continue on one Conversation
  // (new open twin left Opportunity empty / AI silent on the closed card — INC-066).
  if (!conversation) {
    const closed = await prisma.conversation.findFirst({
      where: {
        tenantId: resolved.tenantId,
        botInstanceId: resolved.id,
        platform: 'whatsapp',
        platformUserId: from,
        status: 'closed',
      },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: CONTEXT_WINDOW },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (closed) {
      const bogusUsername =
        closed.platformUsername &&
        !isLikelyE164Phone(normalizeWaNumber(closed.platformUsername));
      conversation = await prisma.conversation.update({
        where: { id: closed.id },
        data: {
          status: 'open',
          mode: isAiConversationMode(closed.mode) ? closed.mode : 'ai',
          aiDisabled: false,
          pausedUntil: null,
          ...(bogusUsername ? { platformUsername: null } : {}),
        },
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: CONTEXT_WINDOW },
        },
      });
      console.log(
        `[ai-whatsapp] reopened closed conv=${conversation.id} peer=${from}`,
      );
    }
  }
  if (!conversation && phoneE164) {
    conversation = await prisma.conversation.findFirst({
      where: {
        tenantId: resolved.tenantId,
        botInstanceId: resolved.id,
        platform: 'whatsapp',
        status: { in: ['open', 'waiting_for_human'] },
        OR: [
          { platformUserId: phoneE164 },
          { platformUsername: `+${phoneE164}` },
          { platformUsername: phoneE164 },
        ],
      },
      include: {
        messages: { orderBy: { createdAt: 'desc' }, take: CONTEXT_WINDOW },
      },
    });
    if (!conversation) {
      const closedByPhone = await prisma.conversation.findFirst({
        where: {
          tenantId: resolved.tenantId,
          botInstanceId: resolved.id,
          platform: 'whatsapp',
          status: 'closed',
          OR: [
            { platformUserId: phoneE164 },
            { platformUsername: `+${phoneE164}` },
            { platformUsername: phoneE164 },
          ],
        },
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: CONTEXT_WINDOW },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (closedByPhone) {
        conversation = await prisma.conversation.update({
          where: { id: closedByPhone.id },
          data: {
            status: 'open',
            mode: isAiConversationMode(closedByPhone.mode)
              ? closedByPhone.mode
              : 'ai',
            aiDisabled: false,
            pausedUntil: null,
            platformUsername: `+${phoneE164}`,
            platformUserId: isWhatsAppLid(closedByPhone.platformUserId)
              ? phoneE164
              : closedByPhone.platformUserId,
          },
          include: {
            messages: { orderBy: { createdAt: 'desc' }, take: CONTEXT_WINDOW },
          },
        });
        console.log(
          `[ai-whatsapp] reopened closed phone thread conv=${conversation.id} phone=+${phoneE164}`,
        );
      }
    }
    if (conversation) {
      console.log(
        `[ai-whatsapp] merge inbound into existing phone thread conv=${conversation.id} from=${from} phone=+${phoneE164}`,
      );
    }
  }

  // Reuse stored Conversation.platformUsername (+E.164) for LID peers (manual/vCard cache).
  if (!phoneE164 && isWhatsAppLid(from)) {
    const cached = await resolvePhoneFromConversationCache({
      tenantId: resolved.tenantId,
      botId: resolved.id,
      platformUserId: from,
      conversationId: conversation?.id,
      platformUsername: conversation?.platformUsername,
    });
    if (cached.phone) {
      phoneE164 = cached.phone;
      phoneSource = cached.source;
    } else if (phoneSource === 'none') {
      console.warn(
        `[ai-whatsapp] no PN for LID chat instance=${opts.instanceName} lid=${from} sources=webhook,contact_row,chat_row,cached — CRM phone left empty (Evolution 2.2.3-lid has no lidMapping; upgrade ≥2.3.7)`,
      );
    }
  }
  if (phoneE164) {
    console.log(
      `[ai-whatsapp] phone resolved source=${phoneSource} lidOrFrom=${from} e164=+${phoneE164}`,
    );
  }

  const lidFrom = isWhatsAppLid(from) ? from : undefined;
  if (phoneE164 || lidFrom) {
    const merged = await mergeWaLidPnTwinConversations({
      tenantId: resolved.tenantId,
      botId: resolved.id,
      phoneE164,
      lidDigits: lidFrom,
      preferConversationId: conversation?.id,
    });
    if (merged) {
      const refreshed = await prisma.conversation.findFirst({
        where: { id: merged.canonicalId },
        include: {
          messages: { orderBy: { createdAt: 'desc' }, take: CONTEXT_WINDOW },
        },
      });
      if (refreshed) conversation = refreshed;
    }
  }

  // Business profile: email / website / IG·FB URLs / display name when Evolution exposes them.
  let businessEmail: string | undefined;
  let businessWebsite: string | undefined;
  let businessInstagram: string | undefined;
  let businessFacebook: string | undefined;
  let businessName: string | undefined;
  try {
    const bizPeer = phoneE164 || from;
    const biz = await fetchWaBusinessProfile(opts.instanceName, bizPeer);
    businessEmail = biz?.email;
    businessWebsite = biz?.website;
    businessInstagram = biz?.instagram;
    businessFacebook = biz?.facebook;
    businessName = biz?.name;
    if (businessEmail || businessWebsite || businessInstagram || businessFacebook || businessName) {
      console.log(
        `[ai-whatsapp] business profile peer=${bizPeer} name=${businessName || '-'} email=${businessEmail || '-'} website=${businessWebsite || '-'} ig=${businessInstagram || '-'} fb=${businessFacebook || '-'}`,
      );
    }
  } catch (err) {
    console.warn('[ai-whatsapp] fetchBusinessProfile failed', err);
  }

  let displayName = cleanWaContactName(opts.contactName || opts.pushName, from);
  if (displayName === 'WhatsApp' && businessName) {
    displayName = businessName;
  }

  if (!conversation) {
    // Keep LID on platformUserId for Evolution send; E.164 lives in platformUsername.
    const platformUserId =
      isWhatsAppLid(from) ? from : phoneE164 && isLikelyE164Phone(phoneE164) ? phoneE164 : from;
    const created = await prisma.conversation.create({
      data: {
        tenantId: resolved.tenantId,
        botInstanceId: resolved.id,
        platform: 'whatsapp',
        platformUserId,
        platformUsername: phoneE164
          ? `+${phoneE164}`
          : displayName !== 'WhatsApp'
            ? displayName
            : null,
        platformFirstName: displayName !== 'WhatsApp' ? displayName : null,
        status: 'open',
        mode: 'ai',
        channel: 'whatsapp',
      },
    });
    conversation = { ...created, messages: [] };
    await fireGoal({
      tenantId: resolved.tenantId,
      goalName: 'whatsapp_conversation_started',
      subscriberId: platformUserId,
      botInstanceId: resolved.id,
    });
  } else if (
    (displayName !== 'WhatsApp' && conversation.platformFirstName !== displayName) ||
    (phoneE164 && conversation.platformUsername !== `+${phoneE164}`)
  ) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        platformFirstName:
          displayName !== 'WhatsApp' ? displayName : conversation.platformFirstName,
        platformUsername: phoneE164 ? `+${phoneE164}` : conversation.platformUsername,
      },
    });
  }

  // Persist + CRM sync BEFORE slow ASR/vision/doc extract so voice/video/image/doc
  // still create Person+Opportunity if media AI hangs or fails (personal WA wipe path).
  let displayText = opts.text;
  const createdMsg = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: opts.fromMe ? 'operator' : 'user',
      content: displayText,
      externalMessageId: opts.messageId,
      fromMe: opts.fromMe || false,
      attachments:
        opts.attachments && opts.attachments.length ? opts.attachments : undefined,
    },
  });

  // Timeline sync (Phase 5.3) — fire-and-forget via queue
  const phoneFp = conversation.platformUsername && conversation.platformUsername.startsWith('+')
    ? phoneFingerprint(conversation.platformUsername)
    : null;
  void enqueueTimelineSync({
    tenantId: resolved.tenantId,
    twentyPersonId: conversation.twentyPersonId || null,
    phoneFingerprint: phoneFp ?? null,
    kind: 'chat_inbound',
    channel: 'ai_wa',
    title: `Входящее: ${displayText.slice(0, 80)}${displayText.length > 80 ? '…' : ''}`,
    description: displayText,
    meta: {
      conversationId: conversation.id,
      externalMessageId: opts.messageId,
      platformUserId: conversation.platformUserId,
      platformUsername: conversation.platformUsername,
      platformFirstName: conversation.platformFirstName,
    },
    conversationId: conversation.id,
    messageId: opts.messageId,
  });

  await invalidateCrmThreadCache(crmCacheRedis, resolved.tenantId, [
    conversation.twentyPersonId,
    conversation.twentyOpportunityId,
  ]);
  await invalidateCrmUnreadCache(crmCacheRedis, resolved.tenantId);

  void maybeAttributeMailingInbound({
    tenantId: resolved.tenantId,
    conversationId: conversation.id,
  }).catch((err) => console.warn('[ai-whatsapp] mailing attribution failed', err));

  await syncLeadToCrm({
    tenantId: resolved.tenantId,
    botId: resolved.id,
    conversationId: conversation.id,
    platformUserId: conversation.platformUserId || from,
    contactName: displayName !== 'WhatsApp' ? displayName : undefined,
    phoneE164,
    email: businessEmail,
    website: businessWebsite,
    instagram: businessInstagram,
    facebook: businessFacebook,
  }).catch((err) => {
    console.error('[ai-whatsapp] syncLeadToCrm unhandled', err);
  });

  if (
    opts.messageId &&
    (opts.needsVision || opts.needsAsr || opts.needsDoc) &&
    OPENROUTER_API_KEY
  ) {
    try {
      displayText = await enrichWaTextWithMediaAi({
        tenantId: resolved.tenantId,
        instanceName: opts.instanceName,
        messageId: opts.messageId,
        remoteJid: opts.remoteJid || (opts.from.includes('@') ? opts.from : undefined),
        text: opts.text,
        needsVision: Boolean(opts.needsVision),
        needsAsr: Boolean(opts.needsAsr),
        needsDoc: Boolean(opts.needsDoc),
        mimeHint: opts.mimeHint,
        fileNameHint: opts.attachments?.[0]?.fileName,
      });
      if (displayText !== opts.text) {
        await prisma.chatMessage.update({
          where: { id: createdMsg.id },
          data: { content: displayText },
        });
      }
    } catch (err) {
      console.warn('[ai-whatsapp] media enrich after CRM sync failed', err);
    }
  }

  if (!(await shouldAiReply(conversation.id))) {
    const c = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: {
        mode: true,
        aiDisabled: true,
        pausedUntil: true,
        status: true,
        aiAgentId: true,
        botInstance: { select: { defaultAiAgentId: true } },
      },
    });
    console.log(
      `[ai-whatsapp] AI off for conv=${conversation.id}`,
      JSON.stringify({
        mode: c?.mode,
        aiDisabled: c?.aiDisabled,
        pausedUntil: c?.pausedUntil?.toISOString() ?? null,
        status: c?.status,
        aiAgentId: c?.aiAgentId ?? null,
        defaultAiAgentId: c?.botInstance?.defaultAiAgentId ?? null,
      }),
    );
    return;
  }

  const session = decodeSession(resolved.botTokenEncrypted);
  if (!session?.instanceName) return;

  // Mark read as soon as we accept the message (human-like), unless suppressDealCreation is set.
  if (opts.messageId) {
    if (conversation.suppressDealCreation === true) {
      console.log(
        `[ai-whatsapp] skip markRead conv=${conversation.id} (suppressDealCreation)`,
      );
    } else {
      void markWhatsAppRead(
        session.instanceName,
        from,
        [opts.messageId],
        opts.remoteJid || (opts.from.includes('@') ? opts.from : undefined),
      );
    }
  }

  inboundAiDebouncer.push(conversation.id, {
    instanceName: session.instanceName,
    from,
    conversationId: conversation.id,
    tenantId: resolved.tenantId,
    botId: resolved.id,
    text: displayText,
    messageId: opts.messageId,
    remoteJid: opts.remoteJid || (opts.from.includes('@') ? opts.from : undefined),
    addonId: resolved.addonId,
  });
}

async function hasNewerUserMessage(conversationId: string, since: Date): Promise<boolean> {
  const n = await prisma.chatMessage.count({
    where: {
      conversationId,
      role: 'user',
      OR: [{ createdAt: { gt: since } }, { sentAt: { gt: since } }],
    },
  });
  return n > 0;
}

async function flushWhatsAppAiReply(items: WaAiPending[], signal?: AbortSignal) {
  const last = items[items.length - 1];
  if (!last) return;
  const { instanceName, from, conversationId, tenantId, botId, addonId } = last;
  const messageIds = items.map((i) => i.messageId).filter(Boolean) as string[];
  // Prefer DB content (post-ASR/vision) over stale placeholder in the debounce bag.
  let burstText = items.map((i) => i.text).filter(Boolean).join('\n');
  if (messageIds.length) {
    const fresh = await prisma.chatMessage.findMany({
      where: {
        conversationId,
        role: 'user',
        externalMessageId: { in: messageIds },
      },
      orderBy: { sentAt: 'asc' },
      select: { content: true },
    });
    if (fresh.length) {
      burstText = fresh.map((m) => m.content).filter(Boolean).join('\n') || burstText;
    }
  }
  // Stamp before OpenRouter so mid-flight inbound aborts this reply (INC-061).
  const sendStartedAt = new Date();

  if (!(await shouldAiReply(conversationId))) return;

  const hasBalance = await hasAiBalance(tenantId, 1);
  if (!hasBalance) {
    await sendWhatsAppText(
      instanceName,
      from,
      '⚠️ Баланс AI-ассистента исчерпан. Пополните баланс в личном кабинете.',
    );
    await switchToHuman(instanceName, from, tenantId, botId, conversationId);
    return;
  }

  if (!OPENROUTER_API_KEY) return;

  if (await hasNewerUserMessage(conversationId, sendStartedAt)) {
    console.log(
      `[ai-whatsapp] skip flush conv=${conversationId} — newer inbound before generate`,
    );
    return;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: 'desc' }, take: CONTEXT_WINDOW },
    },
  });
  if (!conversation) return;

  const agent = await resolveAssignedAgent(conversationId);
  const settingsModelRaw = (agent?.settings as { model?: unknown } | null | undefined)?.model;
  const settingsModel =
    typeof settingsModelRaw === 'string' ? settingsModelRaw.trim() : '';
  const model =
    settingsModel ||
    process.env.AI_CHAT_MODEL?.trim() ||
    process.env.AI_DEFAULT_MODEL?.trim() ||
    AI_MODEL_DEFAULTS.chat;
  const customPrompt = agentSystemPrompt(agent);
  let systemPrompt =
    (customPrompt || DEFAULT_SYSTEM_PROMPT) +
    MEDIA_INBOUND_HINT +
    JSON_FORMAT_HINT +
    (agent ? AGENT_PROMPT_PRIORITY_HINT : '');
  if (burstText) {
    systemPrompt += `\n\nСейчас ответь именно на эти новые сообщения клиента (не на более старые из истории):\n${burstText}`;
  }
  try {
    if (agent?.id) {
      const rag = await retrieveAgentContext({
        aiAgentId: agent.id,
        query: burstText || last.text,
        tenantId,
      });
      systemPrompt += formatRagPromptBlock(rag);
    }
  } catch (err) {
    console.warn('[ai-whatsapp] RAG retrieve failed', err);
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];
  // History already includes all burst user messages; do not re-append last text.
  const history = filterMediaCapabilityRefusals(
    filterHistoryAfterAgentUpdate(
      [...conversation.messages].reverse(),
      agent?.updatedAt,
    ),
  );
  for (const msg of history) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
  }

  const callModel = async (msgs: OpenAI.Chat.ChatCompletionMessageParam[]) => {
    try {
      return await openai.chat.completions.create(
        {
          model,
          messages: msgs,
          temperature: 0.7,
          max_tokens: 1000,
          response_format: { type: 'json_object' },
        },
        signal ? { signal } : undefined,
      );
    } catch (err: any) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      return await openai.chat.completions.create(
        {
          model,
          messages: msgs,
          temperature: 0.7,
          max_tokens: 1000,
        },
        signal ? { signal } : undefined,
      );
    }
  };

  let typingStarted = false;
  try {
    const preferredJid =
      items.map((i) => i.remoteJid).find(Boolean) || last.remoteJid || undefined;
    await markWhatsAppRead(instanceName, from, messageIds, preferredJid);
    await sendWhatsAppTyping(instanceName, from, 4000);
    typingStarted = true;
    if (
      signal?.aborted ||
      (await hasNewerUserMessage(conversationId, sendStartedAt))
    ) {
      console.log(
        `[ai-whatsapp] skip flush conv=${conversationId} — newer inbound before OpenRouter`,
      );
      return;
    }
    let completion = await callModel(messages);
    if (
      signal?.aborted ||
      (await hasNewerUserMessage(conversationId, sendStartedAt))
    ) {
      console.log(
        `[ai-whatsapp] skip flush conv=${conversationId} — newer inbound after OpenRouter`,
      );
      return;
    }
    let raw =
      completion.choices[0]?.message?.content || 'Извините, я не смог сформировать ответ.';
    if (
      isMediaCapabilityRefusal(raw) &&
      (hasEnrichedMediaTag(burstText) || items.some((i) => hasEnrichedMediaTag(i.text)))
    ) {
      console.warn(
        `[ai-whatsapp] media refusal retry conv=${conversationId} burst=${burstText.slice(0, 80)}`,
      );
      completion = await callModel([
        ...messages,
        { role: 'assistant', content: raw },
        { role: 'user', content: MEDIA_REFUSAL_RETRY_USER },
      ]);
      if (
        signal?.aborted ||
        (await hasNewerUserMessage(conversationId, sendStartedAt))
      ) {
        console.log(
          `[ai-whatsapp] skip flush conv=${conversationId} — newer inbound after refusal retry`,
        );
        return;
      }
      raw =
        completion.choices[0]?.message?.content ||
        'Извините, я не смог сформировать ответ.';
    }
    const bubbles = normalizeAiBubbles(parseAiBubbles(raw), 4);
    const replyText = bubbles.join('\n\n');
    const recentAssistant = await prisma.chatMessage.findFirst({
      where: {
        conversationId,
        role: 'assistant',
        createdAt: { gte: new Date(Date.now() - 90_000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    if (recentAssistant && isNearDuplicateReply(recentAssistant.content, replyText)) {
      console.log(
        `[ai-whatsapp] skip near-duplicate assistant conv=${conversationId}`,
      );
      return;
    }
    const usage = completion.usage as OpenRouterUsageLike | undefined;
    const cost = await resolveProviderCostRub({
      model,
      usage,
      apiKey: OPENROUTER_API_KEY,
      baseUrl: OPENROUTER_BASE_URL,
    });
    const tokensUsed = cost.tokens || usage?.total_tokens || 0;
    const chargeResult = await chargeAiUsage({
      tenantId,
      providerCostRub: cost.providerCostRub,
      tokens: tokensUsed,
      model,
      requestType: 'text',
      addonId: addonId || undefined,
      aiAgentId: agent?.id,
      channel: AI_USAGE_CHANNELS.WHATSAPP,
    });

    const sendResult = await sendWhatsAppHumanLike(instanceName, from, bubbles, {
      conversationId,
      sendStartedAt,
      signal,
    });
    typingStarted = false; // humanLike clears presence in finally

    if (sendResult.aborted) {
      console.log(
        `[ai-whatsapp] outbound aborted conv=${conversationId} — newer inbound will reply`,
      );
      return;
    }

    await prisma.chatMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        content: replyText,
        tokensUsed,
        modelUsed: model,
        providerCostRub: cost.providerCostRub,
        chargedRub: chargeResult.chargedRub,
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { lastAiMessageAt: new Date() },
    });

    if (chargeResult.paused) {
      await sendWhatsAppText(
        instanceName,
        from,
        '⚠️ Баланс AI-ассистента исчерпан. Пополните баланс в личном кабинете. Переключаю на оператора.',
      );
      await switchToHuman(instanceName, from, tenantId, botId, conversationId);
    }
  } catch (err) {
    console.error('[ai-whatsapp] AI reply error:', err);
  } finally {
    if (typingStarted) {
      await clearWhatsAppTyping(instanceName, from);
    }
  }
}

function isPrivateWaRemoteJid(jid: string): boolean {
  const j = String(jid || '').toLowerCase().trim();
  if (!j) return false;
  if (j.endsWith('@g.us')) return false;
  if (j === 'status@broadcast' || j.endsWith('@broadcast')) return false;
  if (j.endsWith('@newsletter')) return false;
  return (
    j.includes('@s.whatsapp.net') ||
    j.includes('@lid') ||
    Boolean(normalizeWaNumber(j))
  );
}

function unwrapEvoRows(json: any, keys: string[] = ['chats', 'messages', 'records', 'data']): any[] {
  if (Array.isArray(json)) return json;
  for (const k of keys) {
    const v = json?.[k];
    if (Array.isArray(v)) return v;
    if (Array.isArray(v?.records)) return v.records;
  }
  if (Array.isArray(json?.messages?.records)) return json.messages.records;
  return [];
}

function evoUnixSeconds(raw: unknown): number {
  if (raw == null) return 0;
  if (typeof raw === 'object' && raw !== null && 'low' in (raw as object)) {
    const n = Number((raw as { low?: number }).low);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function chatActivityTs(chat: any): number {
  return (
    evoUnixSeconds(chat?.updatedAt) ||
    evoUnixSeconds(chat?.conversationTimestamp) ||
    evoUnixSeconds(chat?.lastMsgTimestamp) ||
    evoUnixSeconds(chat?.lastMessage?.messageTimestamp) ||
    evoUnixSeconds(chat?.lastMessageTimestamp) ||
    0
  );
}

type WaTwinMergeResult = {
  canonicalId: string;
  mergedConvIds: string[];
  messagesMoved: number;
};

function preferWaContactName(...names: (string | null | undefined)[]): string | undefined {
  for (const raw of names) {
    const n = String(raw || '').trim();
    if (!n || n === 'WhatsApp') continue;
    if (/^noname\d+$/i.test(n)) continue;
    return n;
  }
  for (const raw of names) {
    const n = String(raw || '').trim();
    if (n && n !== 'WhatsApp') return n;
  }
  return undefined;
}

/**
 * Merge sibling WA Conversations for the same peer (LID digits vs E.164 / +E.164).
 * Keeps LID on platformUserId for Evolution send; platformUsername = +E.164 when known.
 */
async function mergeWaLidPnTwinConversations(opts: {
  tenantId: string;
  botId: string;
  phoneE164?: string;
  lidDigits?: string;
  preferConversationId?: string;
  instanceName?: string;
  profileIndex?: WaProfilePnIndex;
  /** Other LID digits known to map to phoneE164 (same sync pass). */
  extraLidDigits?: string[];
}): Promise<WaTwinMergeResult | null> {
  const phone =
    opts.phoneE164 && isLikelyE164Phone(opts.phoneE164)
      ? normalizeWaNumber(opts.phoneE164)
      : undefined;
  const lidRaw = opts.lidDigits ? normalizeWaNumber(opts.lidDigits) : '';
  const lid = lidRaw && isWhatsAppLid(lidRaw) ? lidRaw : undefined;
  if (!phone && !lid) return null;

  const or: Array<{ platformUserId: string } | { platformUsername: string }> = [];
  if (phone) {
    or.push({ platformUserId: phone });
    or.push({ platformUsername: `+${phone}` });
    or.push({ platformUsername: phone });
  }
  if (lid) {
    or.push({ platformUserId: lid });
  }
  if (phone && opts.extraLidDigits?.length) {
    for (const raw of opts.extraLidDigits) {
      const d = normalizeWaNumber(raw);
      if (d && isWhatsAppLid(d)) or.push({ platformUserId: d });
    }
  }
  if (phone && opts.instanceName) {
    const mappedLids = await listLidDigitsMappedToPhone(opts.instanceName, phone);
    for (const d of mappedLids) {
      or.push({ platformUserId: d });
    }
  }
  if (!or.length) return null;

  const siblingById = new Map<
    string,
    Awaited<ReturnType<typeof prisma.conversation.findMany>>[0] & {
      _count: { messages: number };
    }
  >();

  const addSiblings = (
    rows: Array<
      Awaited<ReturnType<typeof prisma.conversation.findMany>>[0] & {
        _count: { messages: number };
      }
    >,
  ) => {
    for (const row of rows) siblingById.set(row.id, row);
  };

  addSiblings(
    await prisma.conversation.findMany({
      where: {
        tenantId: opts.tenantId,
        botInstanceId: opts.botId,
        platform: 'whatsapp',
        OR: or,
      },
      include: { _count: { select: { messages: true } } },
      take: 30,
    }),
  );

  // Expand: CRM-linked twins (same Person / Opportunity).
  let expanded = true;
  while (expanded) {
    expanded = false;
    const personIds = [
      ...new Set(
        [...siblingById.values()]
          .map((c) => c.twentyPersonId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const oppIds = [
      ...new Set(
        [...siblingById.values()]
          .map((c) => c.twentyOpportunityId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (!personIds.length && !oppIds.length) break;
    const more = await prisma.conversation.findMany({
      where: {
        tenantId: opts.tenantId,
        botInstanceId: opts.botId,
        platform: 'whatsapp',
        id: { notIn: [...siblingById.keys()] },
        OR: [
          ...(personIds.length ? [{ twentyPersonId: { in: personIds } }] : []),
          ...(oppIds.length ? [{ twentyOpportunityId: { in: oppIds } }] : []),
        ],
      },
      include: { _count: { select: { messages: true } } },
      take: 30,
    });
    if (more.length) {
      addSiblings(more);
      expanded = true;
    }
  }

  // Expand: other LID threads mapped to the same E.164 (multi-LID same peer).
  if (phone) {
    const lidCandidates = await prisma.conversation.findMany({
      where: {
        tenantId: opts.tenantId,
        botInstanceId: opts.botId,
        platform: 'whatsapp',
        id: { notIn: [...siblingById.keys()] },
      },
      select: {
        id: true,
        platformUserId: true,
        platformUsername: true,
        platformFirstName: true,
      },
      take: 50,
    });
    for (const lc of lidCandidates) {
      if (!isWhatsAppLid(lc.platformUserId)) continue;
      const lidDigits = normalizeWaNumber(lc.platformUserId);
      let mappedPhone: string | undefined;
      if (opts.instanceName) {
        const fromMap = await resolvePhoneFromEvolutionLidMapping(
          opts.instanceName,
          lidDigits,
        );
        if (fromMap.phone && isLikelyE164Phone(fromMap.phone)) {
          mappedPhone = normalizeWaNumber(fromMap.phone);
        }
      }
      const fromUsername = phoneFromPlatformUsername(lc.platformUsername);
      if (mappedPhone === phone || fromUsername === phone) {
        const full = await prisma.conversation.findUnique({
          where: { id: lc.id },
          include: { _count: { select: { messages: true } } },
        });
        if (full) addSiblings([full]);
      }
    }
  }

  const siblings = [...siblingById.values()];
  if (siblings.length <= 1) return null;

  const score = (c: (typeof siblings)[0]): number => {
    let s = 0;
    if (opts.preferConversationId && c.id === opts.preferConversationId) s += 1000;
    if (c.twentyPersonId && c.twentyOpportunityId && phone) {
      const pu = phoneFromPlatformUsername(c.platformUsername);
      if (pu === phone) s += 500;
    }
    if (c.twentyPersonId) s += 200;
    if (c.twentyOpportunityId) s += 100;
    s += Math.min(c._count.messages, 100) * 5;
    s += c.updatedAt.getTime() / 1e12;
    return s;
  };

  const sorted = [...siblings].sort((a, b) => score(b) - score(a));
  const canonical = sorted[0]!;
  const twins = sorted.slice(1);

  let messagesMoved = 0;
  let lidPlatformUserId = lid;
  let personId = canonical.twentyPersonId;
  let opportunityId = canonical.twentyOpportunityId;
  let suppressDeal =
    (canonical as { suppressDealCreation?: boolean }).suppressDealCreation === true;
  let needsReview = canonical.needsReview;

  for (const c of siblings) {
    if (isWhatsAppLid(c.platformUserId)) {
      const d = normalizeWaNumber(c.platformUserId);
      const prev = lidPlatformUserId
        ? siblings.find((s) => normalizeWaNumber(s.platformUserId) === lidPlatformUserId)
        : undefined;
      if (
        !lidPlatformUserId ||
        c._count.messages > (prev?._count.messages || 0)
      ) {
        lidPlatformUserId = d;
      }
    }
    if (!personId && c.twentyPersonId) personId = c.twentyPersonId;
    if (!opportunityId && c.twentyOpportunityId) opportunityId = c.twentyOpportunityId;
    if ((c as { suppressDealCreation?: boolean }).suppressDealCreation) suppressDeal = true;
    if (c.needsReview) needsReview = true;
  }

  const bestName = preferWaContactName(
    canonical.platformFirstName,
    ...twins.map((t) => t.platformFirstName),
  );
  const preferredPlatformUserId =
    lidPlatformUserId ||
    (phone && isLikelyE164Phone(phone) ? phone : canonical.platformUserId);

  for (const twin of twins) {
    const twinMsgs = await prisma.chatMessage.findMany({
      where: { conversationId: twin.id },
      select: { id: true, externalMessageId: true },
    });
    for (const msg of twinMsgs) {
      if (msg.externalMessageId) {
        const dup = await prisma.chatMessage.findFirst({
          where: {
            conversationId: canonical.id,
            externalMessageId: msg.externalMessageId,
          },
          select: { id: true },
        });
        if (dup) {
          await prisma.chatMessage.delete({ where: { id: msg.id } });
          continue;
        }
      }
      await prisma.chatMessage.update({
        where: { id: msg.id },
        data: { conversationId: canonical.id },
      });
      messagesMoved += 1;
    }
    await prisma.conversation.update({
      where: { id: twin.id },
      data: {
        status: 'closed',
        twentyPersonId: null,
        twentyOpportunityId: null,
      },
    });
  }

  await prisma.conversation.update({
    where: { id: canonical.id },
    data: {
      status: canonical.status === 'closed' ? 'open' : canonical.status,
      platformUserId: preferredPlatformUserId,
      platformUsername: phone ? `+${phone}` : canonical.platformUsername,
      platformFirstName: bestName || canonical.platformFirstName,
      twentyPersonId: personId,
      twentyOpportunityId: opportunityId,
      suppressDealCreation: suppressDeal,
      needsReview,
      botInstanceId: opts.botId,
    },
  });

  // Soft-delete orphan Opportunities left on the same Person after twin merge
  // (race: LID + PN each created an Opp; Person keeps both until cleanup).
  const orphanOppIds = [
    ...new Set(
      siblings
        .map((c) => c.twentyOpportunityId)
        .filter((id): id is string => Boolean(id) && id !== opportunityId),
    ),
  ];
  if (personId && orphanOppIds.length) {
    try {
      const tenant = await prisma.tenant.findUnique({
        where: { id: opts.tenantId },
        include: {
          users: {
            where: { role: 'owner' },
            include: { user: true },
            take: 1,
          },
        },
      });
      const owner = tenant?.users[0]?.user;
      if (
        tenant?.twentyWorkspaceId &&
        tenant.twentyOwnerPasswordEncrypted &&
        owner?.email
      ) {
        const client = new TwentyClient({
          apiUrl:
            process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
        });
        await client.authenticateWorkspace(
          owner.email,
          decrypt(tenant.twentyOwnerPasswordEncrypted),
          tenant.twentyWorkspaceId,
        );
        for (const orphanId of orphanOppIds) {
          const stillLinked = await prisma.conversation.findFirst({
            where: {
              tenantId: opts.tenantId,
              twentyOpportunityId: orphanId,
              status: { not: 'closed' },
            },
            select: { id: true },
          });
          if (stillLinked) continue;
          const poc = await client.getOpportunityPointOfContactId(orphanId);
          if (poc && poc !== personId) continue;
          const deleted = await client.softDeleteOpportunity(orphanId);
          if (deleted) {
            console.log(
              `[ai-whatsapp] soft-deleted orphan Opportunity ${orphanId} after twin merge person=${personId}`,
            );
          }
        }
      }
    } catch (err) {
      console.warn(
        '[ai-whatsapp] orphan Opportunity cleanup failed',
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[ai-whatsapp] merged LID↔PN twins canonical=${canonical.id} twins=${twins.map((t) => t.id).join(',')} movedMsgs=${messagesMoved} phone=+${phone || '-'} lid=${lidPlatformUserId || '-'}`,
  );

  return {
    canonicalId: canonical.id,
    mergedConvIds: twins.map((t) => t.id),
    messagesMoved,
  };
}

/** Bot-wide pass: merge open/closed twins that share the same resolved E.164. */
async function repairWaLidPnSplitConversationsForBot(opts: {
  tenantId: string;
  botId: string;
  instanceName?: string;
  profileIndex?: WaProfilePnIndex;
  /** Scope to open findChats peers + convs with messages — not contact-book shells (INC-097 v7.1). */
  openPeers?: OpenWaChatPeers;
}): Promise<number> {
  const peerOr = opts.openPeers ? openPeerConversationOr(opts.openPeers) : undefined;
  const convs = await prisma.conversation.findMany({
    where: {
      tenantId: opts.tenantId,
      botInstanceId: opts.botId,
      platform: 'whatsapp',
      ...(peerOr?.length
        ? {
            OR: [{ messages: { some: {} } }, ...peerOr],
          }
        : {}),
    },
    select: {
      id: true,
      platformUserId: true,
      platformUsername: true,
    },
    take: opts.openPeers ? 120 : 1000,
  });

  const byPhone = new Map<string, { phone: string; lids: Set<string> }>();
  const addPhoneLid = (phoneRaw: string, lidRaw?: string) => {
    const phone = normalizeWaNumber(phoneRaw);
    if (!isLikelyE164Phone(phone)) return;
    const entry = byPhone.get(phone) || { phone, lids: new Set<string>() };
    if (lidRaw && isWhatsAppLid(lidRaw)) entry.lids.add(normalizeWaNumber(lidRaw));
    byPhone.set(phone, entry);
  };

  for (const c of convs) {
    const phone =
      phoneFromPlatformUsername(c.platformUsername) ||
      (isLikelyE164Phone(c.platformUserId)
        ? normalizeWaNumber(c.platformUserId)
        : undefined);
    if (!phone) continue;
    const lid = isWhatsAppLid(c.platformUserId)
      ? normalizeWaNumber(c.platformUserId)
      : undefined;
    addPhoneLid(phone, lid);
  }

  // Profile-index: orphan LID-only threads → same E.164 bucket (open chats only).
  if (opts.profileIndex && opts.instanceName) {
    const orphanLids = convs.filter(
      (c) =>
        isWhatsAppLid(c.platformUserId) &&
        !phoneFromPlatformUsername(c.platformUsername) &&
        (!opts.openPeers ||
          opts.openPeers.lidDigits.has(normalizeWaNumber(c.platformUserId))),
    );
    const orphanCap = opts.openPeers
      ? Math.min(20, opts.openPeers.lidDigits.size + 2)
      : 20;
    for (const lc of orphanLids.slice(0, orphanCap)) {
      const lidDigits = normalizeWaNumber(lc.platformUserId);
      const lidProfile = await fetchWaPeerProfile(opts.instanceName, lidDigits);
      const matched = matchPhoneFromProfileIndex(opts.profileIndex, lidProfile || {});
      if (matched && isLikelyE164Phone(matched)) {
        addPhoneLid(matched, lidDigits);
      }
    }
    // Stale outbound-only LID (no email/pic in profile) paired with a rich +E.164 thread.
    for (const lc of orphanLids.slice(0, orphanCap)) {
      const lidDigits = normalizeWaNumber(lc.platformUserId);
      const lidProfile = await fetchWaPeerProfile(opts.instanceName, lidDigits);
      if (lidProfile?.email || lidProfile?.picFp) continue;
      const msgs = await prisma.chatMessage.findMany({
        where: { conversationId: lc.id },
        select: { role: true },
        take: 30,
      });
      if (!msgs.length || !msgs.every((m) => m.role === 'operator')) continue;
      for (const pc of convs) {
        const p = phoneFromPlatformUsername(pc.platformUsername);
        if (!p || !isLikelyE164Phone(p)) continue;
        const pnProf = opts.profileIndex.profiles.get(normalizeWaNumber(p));
        if (!pnProf?.email && !pnProf?.picFp) continue;
        addPhoneLid(p, lidDigits);
        await rememberLidPhoneMapping(opts.instanceName, lidDigits, p);
        console.log(
          `[ai-whatsapp] stale outbound LID linked lid=${lidDigits} phone=+${p}`,
        );
        break;
      }
    }
  }

  let merges = 0;
  for (const { phone, lids } of byPhone.values()) {
    const lidList = [...lids];
    const result = await mergeWaLidPnTwinConversations({
      tenantId: opts.tenantId,
      botId: opts.botId,
      phoneE164: phone,
      lidDigits: lidList[0],
      extraLidDigits: lidList.slice(1),
      instanceName: opts.instanceName,
      profileIndex: opts.profileIndex,
    });
    if (result) merges += 1;
  }
  if (merges) {
    console.log(
      `[ai-whatsapp] repairWaLidPnSplit bot=${opts.botId} mergedGroups=${merges}`,
    );
  }
  return merges;
}

/**
 * After a Twenty CRM wipe, Conversations still hold trashed person/opportunity uuids.
 * Clear those links so history sync can recreate (INC-042 / INC-097 wipe path).
 * Does not touch suppressDealCreation.
 */
async function clearStaleWaConversationCrmIds(opts: {
  tenantId: string;
  botId: string;
}): Promise<number> {
  const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId } });
  if (!tenant?.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) return 0;

  const owner = await prisma.tenantMember.findFirst({
    where: { tenantId: opts.tenantId, role: 'owner' },
    include: { user: true },
  });
  if (!owner?.user?.email) return 0;

  const convs = await prisma.conversation.findMany({
    where: {
      tenantId: opts.tenantId,
      botInstanceId: opts.botId,
      platform: 'whatsapp',
      OR: [{ twentyPersonId: { not: null } }, { twentyOpportunityId: { not: null } }],
    },
    select: {
      id: true,
      twentyPersonId: true,
      twentyOpportunityId: true,
    },
    take: 500,
  });
  if (!convs.length) return 0;

  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  try {
    await client.authenticateWorkspace(
      owner.user.email,
      decrypt(tenant.twentyOwnerPasswordEncrypted),
      tenant.twentyWorkspaceId,
    );
  } catch (err) {
    console.warn(
      '[ai-whatsapp] clearStaleWaConversationCrmIds auth failed',
      err instanceof Error ? err.message : err,
    );
    return 0;
  }

  let cleared = 0;
  for (const c of convs) {
    let personId = c.twentyPersonId || null;
    let opportunityId = c.twentyOpportunityId || null;
    let changed = false;
    if (personId && !(await client.personExists(personId))) {
      personId = null;
      opportunityId = null;
      changed = true;
    } else if (opportunityId && !(await client.opportunityExists(opportunityId))) {
      opportunityId = null;
      changed = true;
    }
    if (!changed) continue;
    await prisma.conversation.update({
      where: { id: c.id },
      data: {
        twentyPersonId: personId,
        twentyOpportunityId: opportunityId,
      },
    });
    cleared += 1;
  }
  if (cleared) {
    console.log(
      `[ai-whatsapp] cleared stale Twenty CRM ids on ${cleared} WA conversations bot=${opts.botId}`,
    );
  }
  return cleared;
}

/**
 * Soft-delete contact-book-only CRM shells: CRM-linked WA Conversation with
 * **zero** ChatMessages (INC-097 v2 wrongly iterated the address book as dialogs).
 * Never touch conversations that have messages — those are real open chats and must
 * be recreatable after a Twenty wipe (even if still LID-only).
 * Keeps Conversation rows; messages stay for later PN enrich.
 */
/**
 * Soft-delete garbage WA CRM shells:
 * 1) Conversations with CRM links but zero messages (contact-book noise).
 * 2) Open chats linked to Person firstName=«WhatsApp» with empty phone (INC-097 v5) —
 *    keep Conversation + ChatMessages; drop Person/Opportunity until E.164 known.
 * Also clears invented t.me/+{phone} Telegram fields.
 */
async function repairEmptyWaHistoryLeads(opts: {
  tenantId: string;
  botId: string;
}): Promise<number> {
  const convs = await prisma.conversation.findMany({
    where: {
      tenantId: opts.tenantId,
      botInstanceId: opts.botId,
      platform: 'whatsapp',
      OR: [{ twentyPersonId: { not: null } }, { twentyOpportunityId: { not: null } }],
    },
    include: { _count: { select: { messages: true } } },
    take: 500,
  });

  const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId } });
  if (!tenant?.twentyWorkspaceId) return 0;

  // Clear invented t.me/+{phone} Telegram fields on any WA-linked Person for this bot.
  const allPersonIds = [
    ...new Set(
      convs
        .map((c) => c.twentyPersonId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const clearedTg = await clearFalseTelegramPhoneLinks({
    workspaceId: tenant.twentyWorkspaceId,
    personIds: allPersonIds,
  });
  if (clearedTg) {
    console.log(
      `[ai-whatsapp] cleared ${clearedTg} false t.me/+ telegram links bot=${opts.botId}`,
    );
  }

  const zeroMsg = convs.filter((c) => c._count.messages === 0);
  const shellPersonIds = [
    ...new Set(
      convs
        .filter((c) => c._count.messages > 0 && c.twentyPersonId)
        .map((c) => c.twentyPersonId!)
        .filter(Boolean),
    ),
  ];
  const whatsappShellIds = await findNamelessWhatsAppPersonIds({
    workspaceId: tenant.twentyWorkspaceId,
    personIds: shellPersonIds,
  });

  const toRepair = new Map<string, (typeof convs)[number]>();
  for (const c of zeroMsg) toRepair.set(c.id, c);
  for (const c of convs) {
    if (
      c._count.messages > 0 &&
      c.twentyPersonId &&
      whatsappShellIds.has(c.twentyPersonId)
    ) {
      toRepair.set(c.id, c);
    }
  }

  if (!toRepair.size) return clearedTg > 0 ? clearedTg : 0;

  let repaired = 0;
  // Dedup: same twentyPersonId linked from multiple convs → soft-delete once.
  const deletedPeople = new Set<string>();
  const deletedOpps = new Set<string>();
  for (const c of toRepair.values()) {
    const personId = c.twentyPersonId;
    const opportunityId = c.twentyOpportunityId;
    await softDeleteTwentyLead({
      workspaceId: tenant.twentyWorkspaceId,
      personId:
        personId && !deletedPeople.has(personId) ? personId : null,
      opportunityId:
        opportunityId && !deletedOpps.has(opportunityId) ? opportunityId : null,
    });
    if (personId) deletedPeople.add(personId);
    if (opportunityId) deletedOpps.add(opportunityId);
    await prisma.conversation.update({
      where: { id: c.id },
      data: {
        twentyPersonId: null,
        twentyOpportunityId: null,
        needsReview: false,
      },
    });
    repaired += 1;
  }
  if (repaired) {
    console.log(
      `[ai-whatsapp] repaired ${repaired} empty/WhatsApp-shell history-sync CRM cards bot=${opts.botId} (Conversation kept)`,
    );
  }
  return repaired + clearedTg;
}

/** Person ids whose live row is named WhatsApp with no usable phone. */
async function findNamelessWhatsAppPersonIds(opts: {
  workspaceId: string;
  personIds: string[];
}): Promise<Set<string>> {
  const out = new Set<string>();
  if (!opts.personIds.length) return out;
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString || !opts.workspaceId) return out;
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [opts.workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return out;
    const res = await client.query<{ id: string }>(
      `SELECT id FROM "${schema}".person
       WHERE id = ANY($1::uuid[])
         AND "deletedAt" IS NULL
         AND lower(coalesce("nameFirstName", '')) IN ('whatsapp', 'whatsapp business')
         AND (
           "phonesPrimaryPhoneNumber" IS NULL
           OR btrim("phonesPrimaryPhoneNumber") = ''
         )`,
      [opts.personIds],
    );
    for (const row of res.rows) out.add(row.id);
  } catch (err) {
    console.warn(
      '[ai-whatsapp] findNamelessWhatsAppPersonIds failed',
      err instanceof Error ? err.message : err,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
  return out;
}

async function softDeleteTwentyLead(opts: {
  workspaceId: string;
  personId?: string | null;
  opportunityId?: string | null;
}): Promise<void> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString || !opts.workspaceId) return;
  if (!opts.personId && !opts.opportunityId) return;
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [opts.workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return;
    if (opts.opportunityId) {
      await client.query(
        `UPDATE "${schema}".opportunity SET "deletedAt" = NOW(), "updatedAt" = NOW()
         WHERE id = $1::uuid AND "deletedAt" IS NULL`,
        [opts.opportunityId],
      );
    }
    if (opts.personId) {
      await client.query(
        `UPDATE "${schema}".person SET "deletedAt" = NOW(), "updatedAt" = NOW()
         WHERE id = $1::uuid AND "deletedAt" IS NULL`,
        [opts.personId],
      );
    }
  } catch (err) {
    console.warn(
      '[ai-whatsapp] softDeleteTwentyLead failed',
      err instanceof Error ? err.message : err,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Rename legacy `WhatsApp ·%` Opportunity shells to seq-based title (INC-097 v6). */
async function renameWhatsAppShellOpportunity(opts: {
  workspaceId: string;
  opportunityId?: string | null;
  opportunityName: string;
}): Promise<void> {
  if (!opts.opportunityId || !opts.opportunityName) return;
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString || !opts.workspaceId) return;
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [opts.workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return;
    await client.query(
      `UPDATE "${schema}".opportunity
       SET name = $2, "updatedAt" = NOW()
       WHERE id = $1::uuid
         AND "deletedAt" IS NULL
         AND (
           name ILIKE 'WhatsApp ·%'
           OR name ILIKE '% · WA · %' AND name NOT SIMILAR TO $3
         )`,
      [opts.opportunityId, opts.opportunityName, '^[0-9]+ · WA · .*'],
    );
  } catch (err) {
    console.warn(
      '[ai-whatsapp] renameWhatsAppShellOpportunity failed',
      err instanceof Error ? err.message : err,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Best-effort private-chat history → Conversation + ChatMessage + CRM deals.
 * Source of truth = Evolution findChats (open private dialogs) with findMessages
 * history. Contact book is enrichment only (LID→PN / name) — never a dialog source.
 * Groups (@g.us) and broadcasts are skipped. No Opportunity without messages.
 * Default: all private dialogs × last 500 messages; concurrency 1 + sleep.
 */
async function runWhatsAppPrivateChatSync(opts: {
  tenantId: string;
  botId: string;
  /** Positive = cap; omit/0 = all private dialogs. */
  dialogLimit?: number;
  messageLimit?: number;
  force?: boolean;
  /** Only run LID↔PN twin merge repair (no findChats / message upsert). */
  repairOnly?: boolean;
}): Promise<WaChatSyncSummary> {
  const rawDialog = opts.dialogLimit;
  const dialogLimit =
    typeof rawDialog === 'number' && Number.isFinite(rawDialog) && rawDialog > 0
      ? Math.floor(rawDialog)
      : Number.POSITIVE_INFINITY;
  const messageLimit = Math.min(Math.max(opts.messageLimit ?? 500, 1), 2000);
  const note =
    'Best-effort: only chats/messages already in Evolution DB (WA history sync may still be incomplete right after connect).';

  const emptySummary = (extra: Partial<WaChatSyncSummary> = {}): WaChatSyncSummary => ({
    ok: true,
    dialogs: 0,
    messagesUpserted: 0,
    peopleSynced: 0,
    skippedGroups: 0,
    skippedSuppressed: 0,
    skippedNoPhone: 0,
    skippedNoMessages: 0,
    skippedEmptyIdentity: 0,
    repairedEmptyLeads: 0,
    mergedTwinConversations: 0,
    ...extra,
  });

  const last = waHistorySyncStartedAt.get(opts.botId) || 0;
  if (!opts.force && Date.now() - last < WA_HISTORY_SYNC_DEBOUNCE_MS) {
    return emptySummary({ note: 'debounced' });
  }
  waHistorySyncStartedAt.set(opts.botId, Date.now());

  const bot = await prisma.botInstance.findFirst({
    where: {
      id: opts.botId,
      tenantId: opts.tenantId,
      botType: 'ai_wa',
    },
    select: {
      id: true,
      botTokenEncrypted: true,
      displayName: true,
      botUsername: true,
      phoneNumberId: true,
    },
  });
  if (!bot) {
    return emptySummary({ ok: false, error: 'wa_bot_not_found' });
  }
  const session = decodeSession(bot.botTokenEncrypted);
  if (!session?.instanceName) {
    return emptySummary({ ok: false, error: 'wa_session_missing' });
  }
  if (!evolutionConfigured()) {
    return emptySummary({
      ok: false,
      error: 'evolution_not_configured',
      note: setupHint(),
    });
  }

  const ownPhoneDigits =
    (bot.phoneNumberId && isLikelyE164Phone(normalizeWaNumber(bot.phoneNumberId))
      ? normalizeWaNumber(bot.phoneNumberId)
      : undefined) ||
    (bot.displayName && isLikelyE164Phone(normalizeWaNumber(bot.displayName))
      ? normalizeWaNumber(bot.displayName)
      : undefined);

  if (opts.repairOnly) {
    const { chats: openChats } = await fetchOpenWaPrivateChats(
      session.instanceName,
      ownPhoneDigits,
    );
    const openPeers = collectOpenWaChatPeers(openChats, ownPhoneDigits);
    const openRemoteJids = [...openPeers.remoteJids];
    const contactBook = await loadEvolutionContactBook(session.instanceName);
    const scopedFetchCap = Math.min(
      WA_PROFILE_FETCH_CAP,
      Math.max(openPeers.lidDigits.size + openPeers.pnPhones.size + 8, 24),
    );
    const profileIndex = await buildWaProfilePnIndex({
      instanceName: session.instanceName,
      contactBook,
      openPnPhones: openPeers.pnPhones,
      openRemoteJids,
      fetchCap: scopedFetchCap,
      force: true,
      ownPhoneDigits: ownPhoneDigits,
    });
    const mergedTwins = await repairWaLidPnSplitConversationsForBot({
      tenantId: opts.tenantId,
      botId: bot.id,
      instanceName: session.instanceName,
      profileIndex,
      openPeers,
    });
    return emptySummary({
      dialogs: openChats.length,
      mergedTwinConversations: mergedTwins,
      note: `repairOnly openChats=${openChats.length} mergedGroups=${mergedTwins}`,
    });
  }

  const staleCleared = await clearStaleWaConversationCrmIds({
    tenantId: opts.tenantId,
    botId: bot.id,
  });

  const chatsRes = await evoFetch(
    `/chat/findChats/${encodeURIComponent(session.instanceName)}`,
    { method: 'POST', body: JSON.stringify({ where: {} }) },
  );
  if (!chatsRes.ok) {
    return emptySummary({
      ok: false,
      error: `findChats_http_${chatsRes.status}`,
      note,
    });
  }

  const allChats = unwrapEvoRows(chatsRes.json, ['chats', 'records', 'data']);
  let skippedGroups = 0;
  // Contact book enriches identity only — never a primary dialog source (INC-097 v3).
  const contactBook = await loadEvolutionContactBook(session.instanceName);

  const privateChats = allChats
    .map((c) => {
      const remoteJid = String(
        c?.remoteJid || c?.id || c?.key?.remoteJid || '',
      ).trim();
      return { chat: c, remoteJid };
    })
    .filter(({ remoteJid }) => {
      if (!remoteJid) return false;
      if (!isPrivateWaRemoteJid(remoteJid)) {
        skippedGroups += 1;
        return false;
      }
      if (isWaSystemOrSelfJid(remoteJid, ownPhoneDigits)) {
        skippedGroups += 1;
        return false;
      }
      return true;
    });

  privateChats.sort((a, b) => chatActivityTs(b.chat) - chatActivityTs(a.chat));
  const limitedChats = privateChats.slice(
    0,
    Number.isFinite(dialogLimit) ? dialogLimit : undefined,
  );

  const openPeers = collectOpenWaChatPeers(privateChats, ownPhoneDigits);
  const openRemoteJids = [...openPeers.remoteJids];
  const scopedFetchCap = Math.min(
    WA_PROFILE_FETCH_CAP,
    Math.max(openPeers.lidDigits.size + openPeers.pnPhones.size + 12, 32),
  );

  // INC-097 v6/v7.1: index PN profiles for open chats only — not bulk Contact book.
  const pnCandidatePhones = await loadPnCandidatesFromEvolutionDb(session.instanceName, {
    openRemoteJids,
  });
  const profileIndex = await buildWaProfilePnIndex({
    instanceName: session.instanceName,
    contactBook,
    openPnPhones: openPeers.pnPhones,
    prefetchedDbPhones: pnCandidatePhones,
    openRemoteJids,
    fetchCap: scopedFetchCap,
    force: opts.force,
    ownPhoneDigits: ownPhoneDigits,
  });
  let dealSeq = await nextWaDealSequence(opts.tenantId);
  const botLabel = bot.displayName || bot.botUsername || 'WhatsApp';
  let messagesUpserted = 0;
  let peopleSynced = 0;
  let skippedSuppressed = 0;
  let skippedNoPhone = 0;
  let skippedNoMessages = 0;
  let skippedEmptyIdentity = 0;

  for (let i = 0; i < limitedChats.length; i += 1) {
    const { chat, remoteJid } = limitedChats[i]!;
    if (i > 0) {
      // Concurrency 1 + pause between Evolution findMessages calls.
      await sleep(250 + Math.floor(Math.random() * 250));
    }

    // Never trust chat.owner / Chat.id (owner = own WA number; id = CUID, INC-060).
    let phoneE164 =
      extractPhoneFromEvoRow(chat) ||
      extractWaPhoneE164(remoteJid, chat?.remoteJidAlt, chat?.senderPn) ||
      (isLikelyE164Phone(normalizeWaNumber(remoteJid))
        ? normalizeWaNumber(remoteJid)
        : undefined);
    if (phoneE164 && ownPhoneDigits && phoneE164 === ownPhoneDigits) {
      phoneE164 = undefined;
    }

    let pushName = String(chat?.pushName || chat?.name || chat?.notify || '').trim();
    const lastFromMe = Boolean(
      chat?.lastMessage?.key?.fromMe || chat?.lastMessage?.fromMe,
    );
    if (!pushName && !lastFromMe) {
      pushName = String(chat?.lastMessage?.pushName || '').trim();
    }

    const lidDigits = isWhatsAppLid(remoteJid)
      ? normalizeWaNumber(remoteJid)
      : undefined;

    // INC-097 v6: fetchProfile on LID for email/website/name + profile-index phone match.
    let lidProfile: WaPeerProfile | null = null;
    if (lidDigits) {
      lidProfile = await fetchWaPeerProfile(
        session.instanceName,
        lidDigits,
        ownPhoneDigits,
      );
      if (
        lidProfile?.name &&
        (!pushName || cleanWaContactName(pushName, lidDigits) === 'WhatsApp')
      ) {
        pushName = lidProfile.name;
      }
    }

    let historyMsgs = await fetchAllEvoMessagesForJid(
      session.instanceName,
      remoteJid,
      messageLimit,
    );

    // Reuse inbound PN extractors on stored messages (remoteJidAlt / senderPn / vCard).
    if (!phoneE164) {
      for (const m of historyMsgs) {
        const fromMsg = extractPhoneFromInboundItem(m);
        if (fromMsg && (!ownPhoneDigits || fromMsg !== ownPhoneDigits)) {
          phoneE164 = fromMsg;
          break;
        }
      }
    }
    if (!phoneE164) {
      phoneE164 = extractUniqueParticipantPhone(historyMsgs, ownPhoneDigits);
    }

    // Contact book first (LID row + unique pushName → PN), then Redis / Chat row.
    if (!phoneE164 && (lidDigits || pushName)) {
      const fromBook = matchContactBookIdentity(contactBook, {
        lidDigits,
        pushName,
      });
      if (fromBook.phone) phoneE164 = fromBook.phone;
      if (fromBook.name && (!pushName || cleanWaContactName(pushName, lidDigits) === 'WhatsApp')) {
        pushName = fromBook.name;
      }
    }

    if (!phoneE164 && lidDigits) {
      await pokeWaLidMappingViaPresence(session.instanceName, lidDigits);
      const fromMapAfterPoke = await resolvePhoneFromEvolutionLidMapping(
        session.instanceName,
        lidDigits,
      );
      if (fromMapAfterPoke.phone) {
        phoneE164 = fromMapAfterPoke.phone;
        await rememberLidPhoneMapping(session.instanceName, lidDigits, phoneE164);
        console.log(
          `[ai-whatsapp] LID→phone via lid_mapping_after_poke lid=${lidDigits} phone=+${phoneE164}`,
        );
      }
    }

    if (!phoneE164 && lidDigits) {
      const fromEvolution = await resolveLidPhoneFromEvolution(
        session.instanceName,
        lidDigits,
        { pushName, profilePicUrl: chat?.profilePicUrl },
      );
      if (fromEvolution.phone) phoneE164 = fromEvolution.phone;
    }

    if (!phoneE164 && lidDigits) {
      const fromIndex = matchPhoneFromProfileIndex(
        profileIndex,
        lidProfile || {},
        pushName,
      );
      if (fromIndex && isLikelyE164Phone(fromIndex)) {
        // Pic-only profile-index is opt-in (INC-059 / INC-097 v8.2 — false LID→PN twins).
        const lidEmail = lidProfile?.email;
        const lidWeb = lidProfile?.websiteHost;
        const indexed = profileIndex.profiles.get(fromIndex);
        const emailHit =
          lidEmail && indexed?.email && lidEmail === indexed.email;
        const webHit =
          lidWeb && indexed?.websiteHost && lidWeb === indexed.websiteHost;
        if (!emailHit && !webHit && !ALLOW_AVATAR_PHONE_MATCH) {
          /* skip pic-only match */
        } else {
          phoneE164 = fromIndex;
          await rememberLidPhoneMapping(session.instanceName, lidDigits, phoneE164);
          console.log(
            `[ai-whatsapp] LID→phone via profile-index lid=${lidDigits} phone=+${phoneE164}`,
          );
        }
      }
    }

    if (!phoneE164 && lidProfile?.phone && isLikelyE164Phone(lidProfile.phone)) {
      phoneE164 = lidProfile.phone;
      await rememberLidPhoneMapping(session.instanceName, lidDigits!, phoneE164);
      console.log(
        `[ai-whatsapp] LID→phone via fetchProfile lid=${lidDigits} phone=+${phoneE164}`,
      );
    }

    if (lidDigits && !phoneE164) {
      console.warn(
        `[ai-whatsapp] history-sync LID unresolved lid=${lidDigits} pushName=${pushName || '-'} — Evolution lidMapping/Redis/Message.key have no PN; CRM phone empty (needsReview). WA UI may show number Baileys has not persisted to mapping yet.`,
      );
    }

    if (phoneE164 && ownPhoneDigits && phoneE164 === ownPhoneDigits) {
      phoneE164 = undefined;
    }

    if (phoneE164 && (!pushName || cleanWaContactName(pushName, lidDigits) === 'WhatsApp')) {
      const fromBookName =
        contactBook.byPhone.get(phoneE164)?.pushName ||
        profileIndex.profiles.get(phoneE164)?.name ||
        (await resolveContactPushName(session.instanceName, phoneE164));
      if (fromBookName) pushName = fromBookName;
    }
    if (!pushName || cleanWaContactName(pushName, lidDigits) === 'WhatsApp') {
      for (const m of historyMsgs) {
        const candidate = String(m?.pushName || '').trim();
        if (!candidate || Boolean(m?.key?.fromMe || m?.fromMe)) continue;
        const cleaned = cleanWaContactName(candidate, lidDigits || phoneE164);
        if (cleaned !== 'WhatsApp') {
          pushName = cleaned;
          break;
        }
      }
    }

    // LID + resolved PN: merge messages from both JIDs (dedupe by message id).
    if (phoneE164 && lidDigits) {
      const pnJid = `${phoneE164}@s.whatsapp.net`;
      const pnMsgs = await fetchAllEvoMessagesForJid(
        session.instanceName,
        pnJid,
        messageLimit,
      );
      if (pnMsgs.length > 0) {
        const byId = new Map<string, any>();
        for (const m of [...historyMsgs, ...pnMsgs]) {
          const id = String(m?.key?.id || m?.id || '').trim();
          if (id) byId.set(id, m);
        }
        historyMsgs = [...byId.values()].sort(
          (a, b) =>
            evoUnixSeconds(a?.messageTimestamp) - evoUnixSeconds(b?.messageTimestamp),
        );
        if (historyMsgs.length > messageLimit) {
          historyMsgs = historyMsgs.slice(-messageLimit);
        }
      }
    } else if (
      historyMsgs.length === 0 &&
      phoneE164 &&
      isWhatsAppLid(remoteJid)
    ) {
      historyMsgs = await fetchAllEvoMessagesForJid(
        session.instanceName,
        `${phoneE164}@s.whatsapp.net`,
        messageLimit,
      );
    }

    // Source of truth = open chats with message history — never Contact-book-only rows.
    if (historyMsgs.length === 0) {
      skippedNoMessages += 1;
      continue;
    }

    const contactName = cleanWaContactName(pushName, lidDigits || phoneE164);
    const preferredPlatformUserId =
      lidDigits ||
      phoneE164 ||
      normalizeWaNumber(remoteJid) ||
      String(remoteJid).split('@')[0];
    if (!preferredPlatformUserId) {
      skippedNoPhone += 1;
      continue;
    }

    if (phoneE164 || lidDigits) {
      await mergeWaLidPnTwinConversations({
        tenantId: opts.tenantId,
        botId: bot.id,
        phoneE164,
        lidDigits,
        instanceName: session.instanceName,
        profileIndex,
      });
    }

    let conversation = await prisma.conversation.findFirst({
      where: {
        tenantId: opts.tenantId,
        botInstanceId: bot.id,
        platform: 'whatsapp',
        OR: [
          { platformUserId: preferredPlatformUserId },
          ...(phoneE164
            ? [
                { platformUserId: phoneE164 },
                { platformUsername: `+${phoneE164}` },
              ]
            : []),
          ...(lidDigits ? [{ platformUserId: lidDigits }] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId: opts.tenantId,
          botInstanceId: bot.id,
          platform: 'whatsapp',
          platformUserId: preferredPlatformUserId,
          platformUsername: phoneE164 ? `+${phoneE164}` : undefined,
          platformFirstName: contactName !== 'WhatsApp' ? contactName : undefined,
          channel: 'whatsapp',
          status: 'open',
          mode: 'ai',
        },
      });
    } else {
      const keepLid =
        isWhatsAppLid(conversation.platformUserId) ? conversation.platformUserId : lidDigits;
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          botInstanceId: bot.id,
          platformUserId: keepLid || conversation.platformUserId || preferredPlatformUserId,
          platformUsername: phoneE164
            ? `+${phoneE164}`
            : conversation.platformUsername,
          platformFirstName:
            contactName !== 'WhatsApp'
              ? contactName
              : conversation.platformFirstName,
        },
      });
    }

    for (const m of historyMsgs) {
      const key = m?.key || {};
      const externalMessageId = String(key?.id || m?.id || '').trim();
      if (!externalMessageId) continue;
      const existing = await prisma.chatMessage.findFirst({
        where: {
          conversationId: conversation.id,
          externalMessageId,
        },
        select: { id: true },
      });
      if (existing) continue;

      const classified = classifyWaInbound(m?.message, externalMessageId);
      const content = classified.text || '[media]';
      const fromMe = Boolean(key?.fromMe || m?.fromMe);
      const ts = evoUnixSeconds(m?.messageTimestamp);
      const sentAt = ts > 0 ? new Date(ts * 1000) : new Date();

      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: fromMe ? 'operator' : 'user',
          content,
          externalMessageId,
          sentAt,
          ...(classified.attachments.length
            ? { attachments: classified.attachments }
            : {}),
        },
      });
      messagesUpserted += 1;
    }

    // Empty LID shells without phone/name: keep Conversation + messages, but do NOT
    // create «WhatsApp» Person/Opportunity (INC-097 v5). Business profile name/website
    // counts as identity when Evolution has no E.164.
    const cachedPhone =
      phoneFromPlatformUsername(conversation.platformUsername) ||
      (
        await resolvePhoneFromConversationCache({
          tenantId: opts.tenantId,
          botId: bot.id,
          platformUserId: conversation.platformUserId,
          conversationId: conversation.id,
          platformUsername: conversation.platformUsername,
        })
      ).phone;
    let effectivePhone = phoneE164 || cachedPhone;
    const cachedName = cleanWaContactName(
      conversation.platformFirstName,
      conversation.platformUserId,
    );
    let effectiveName =
      contactName !== 'WhatsApp'
        ? contactName
        : cachedName !== 'WhatsApp'
          ? cachedName
          : 'WhatsApp';

    let businessEmail: string | undefined = lidProfile?.email;
    let businessWebsite: string | undefined = lidProfile?.websiteHost
      ? `https://${lidProfile.websiteHost}`
      : undefined;
    let businessInstagram: string | undefined;
    let businessFacebook: string | undefined;
    let businessName: string | undefined = lidProfile?.name;
    try {
      const biz = await fetchWaBusinessProfile(
        session.instanceName,
        effectivePhone || conversation.platformUserId,
        ownPhoneDigits,
      );
      businessEmail = businessEmail || biz?.email;
      businessWebsite = businessWebsite || biz?.website;
      businessInstagram = biz?.instagram;
      businessFacebook = biz?.facebook;
      businessName = businessName || biz?.name;
    } catch {
      /* optional */
    }
    if (effectiveName === 'WhatsApp' && businessName) {
      effectiveName = businessName;
    }

    const isSystemPeer =
      preferredPlatformUserId === '0' ||
      isWaSystemOrSelfJid(remoteJid, ownPhoneDigits);
    if (isSystemPeer) {
      skippedEmptyIdentity += 1;
      console.warn(
        `[ai-whatsapp] history-sync skip CRM system peer conv=${conversation.id} jid=${remoteJid}`,
      );
      continue;
    }

    let personFirstName =
      effectiveName !== 'WhatsApp' ? effectiveName : undefined;
    if (!personFirstName) {
      personFirstName = await nextNonameLabel(opts.tenantId);
    }
    const opportunityName = `${dealSeq} · WA · ${botLabel}`;

    try {
      await syncLeadToCrm({
        tenantId: opts.tenantId,
        botId: bot.id,
        conversationId: conversation.id,
        platformUserId: conversation.platformUserId,
        personFirstName,
        opportunityName,
        contactName: personFirstName,
        phoneE164: effectivePhone,
        email: businessEmail,
        website: businessWebsite,
        instagram: businessInstagram,
        facebook: businessFacebook,
        forceNeedsReview: !effectivePhone,
      });
      dealSeq += 1;
      peopleSynced += 1;
      const after = await prisma.conversation.findUnique({
        where: { id: conversation.id },
      });
      const suppress =
        (after as { suppressDealCreation?: boolean } | null)?.suppressDealCreation ===
        true;
      if (suppress && !after?.twentyOpportunityId) {
        skippedSuppressed += 1;
      }
    } catch (err) {
      console.error(
        `[ai-whatsapp] history syncLead failed conv=${conversation.id}`,
        err,
      );
    }
  }

  const repaired = await repairEmptyWaHistoryLeads({
    tenantId: opts.tenantId,
    botId: bot.id,
  });
  const mergedTwins = await repairWaLidPnSplitConversationsForBot({
    tenantId: opts.tenantId,
    botId: bot.id,
    instanceName: session.instanceName,
    profileIndex,
    openPeers,
  });

  console.log(
    `[ai-whatsapp] history-sync bot=${opts.botId} dialogs=${limitedChats.length} msgs=${messagesUpserted} people=${peopleSynced} groupsSkipped=${skippedGroups} noMsgs=${skippedNoMessages} emptyIdentity=${skippedEmptyIdentity} repaired=${repaired} mergedTwins=${mergedTwins} staleCleared=${staleCleared} suppress=${skippedSuppressed} contactBookEnrich=${contactBook.phoneEntries.length}`,
  );

  return {
    ok: true,
    dialogs: limitedChats.length,
    messagesUpserted,
    peopleSynced,
    skippedGroups,
    skippedSuppressed,
    skippedNoPhone,
    skippedNoMessages,
    skippedEmptyIdentity,
    repairedEmptyLeads: repaired,
    mergedTwinConversations: mergedTwins,
    note,
  };
}

/**
 * Phone-app (or device) outbound: mirror into CRM as operator only.
 * NEVER syncLeadToCrm / enrich / create Person·Opportunity (INC-118).
 */
async function mirrorWaPhoneOutbound(opts: {
  instanceName: string;
  item: any;
}): Promise<void> {
  const candidates = await prisma.botInstance.findMany({
    where: { botType: 'ai_wa' },
    take: 500,
  });
  const bot =
    candidates.find(
      (b) => decodeSession(b.botTokenEncrypted)?.instanceName === opts.instanceName,
    ) || null;
  if (!bot) return;

  const remoteJid = resolveInboundWaJid(opts.item);
  if (!remoteJid || String(remoteJid).endsWith('@g.us')) return;
  const jid = String(remoteJid);
  if (
    jid === 'status@broadcast' ||
    jid.endsWith('@newsletter') ||
    jid.endsWith('@broadcast')
  ) {
    return;
  }
  const ownPhone = bot.phoneNumberId || null;
  if (isWaSystemOrSelfJid(jid, ownPhone)) return;

  const messageId = opts.item?.key?.id ? String(opts.item.key.id) : undefined;
  if (messageId) {
    const dup = await prisma.chatMessage.findFirst({
      where: {
        externalMessageId: messageId,
        conversation: { botInstanceId: bot.id, platform: 'whatsapp' },
      },
      select: { id: true },
    });
    if (dup) return;
  }

  const classified = classifyWaInbound(opts.item?.message, messageId);
  if (!classified.text && !(classified.attachments?.length > 0)) return;

  const from = normalizeWaNumber(jid) || jid;
  const extractedPhone = extractPhoneFromInboundItem(opts.item);
  const phoneE164 =
    (extractedPhone && isLikelyE164Phone(extractedPhone) ? extractedPhone : undefined) ||
    (isLikelyE164Phone(from) ? from : undefined);

  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: bot.tenantId,
      botInstanceId: bot.id,
      platform: 'whatsapp',
      platformUserId: from,
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!conversation && phoneE164) {
    conversation = await prisma.conversation.findFirst({
      where: {
        tenantId: bot.tenantId,
        botInstanceId: bot.id,
        platform: 'whatsapp',
        OR: [
          { platformUserId: phoneE164 },
          { platformUsername: `+${phoneE164}` },
          { platformUsername: phoneE164 },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }
  if (!conversation && isWhatsAppLid(from)) {
    // Last resort: any open WA thread with same LID digits in platformUserId already handled above.
  }
  if (!conversation) {
    // Conversation shell only — no Person/Opp (lead sync forbidden on this path).
    conversation = await prisma.conversation.create({
      data: {
        tenantId: bot.tenantId,
        botInstanceId: bot.id,
        platform: 'whatsapp',
        platformUserId: from,
        platformUsername: phoneE164 ? `+${phoneE164}` : null,
        channel: 'whatsapp',
        status: 'open',
        mode: 'ai',
      },
    });
  }

  const atts = classified.attachments?.length ? classified.attachments : undefined;
  const content =
    (classified.text || '').trim() ||
    (atts?.[0]
      ? atts[0].type === 'photo'
        ? '[фото]'
        : atts[0].type === 'video'
          ? '[видео]'
          : atts[0].fileName
            ? `[файл: ${atts[0].fileName}]`
            : '[файл]'
      : '[outbound]');

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'operator',
      content,
      externalMessageId: messageId,
      ...(atts ? { attachments: atts } : {}),
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });
  console.log(
    `[ai-whatsapp] phone-outbound mirrored conv=${conversation.id} mid=${messageId || '-'} peer=${from}`,
  );
}

async function handleEvolutionWebhook(payload: any) {
  const event = String(payload?.event || payload?.type || '').toLowerCase();
  const instanceName =
    payload?.instance ||
    payload?.instanceName ||
    payload?.data?.instanceName ||
    payload?.sender ||
    '';

  if (event.includes('presence') || String(payload?.event || '').includes('PRESENCE')) {
    parsePresenceUpdatePayload(payload);
    return;
  }

  if (event.includes('connection') || event === 'connection.update') {
    const state = String(
      payload?.data?.state || payload?.data?.status || payload?.state || '',
    ).toLowerCase();
    if (instanceName && state === 'open') {
      const bots = await prisma.botInstance.findMany({
        where: { botType: 'ai_wa' },
        take: 500,
      });
      const bot = bots.find(
        (b) => decodeSession(b.botTokenEncrypted)?.instanceName === instanceName,
      );
      if (bot) {
        const phone =
          normalizeWaNumber(payload?.data?.wuid || payload?.data?.owner || '') ||
          bot.phoneNumberId;
        await prisma.botInstance.update({
          where: { id: bot.id },
          data: { status: 'active', phoneNumberId: phone || bot.phoneNumberId },
        });
        // History sync is manual only (portal «Синхронизировать» → /internal/crm/sync-history).
      }
    }
    return;
  }

  if (!event.includes('messages.upsert') && !event.includes('messages_upsert')) {
    // Some versions send event as MESSAGES_UPSERT without dots
    if (event !== 'messages.upsert' && !String(payload?.event || '').includes('MESSAGES_UPSERT')) {
      if (!payload?.data?.key && !payload?.data?.message) return;
    }
  }

  const data = payload?.data;
  const messages = Array.isArray(data) ? data : data ? [data] : [];
  for (const item of messages) {
    const fromMe = Boolean(item?.key?.fromMe);
    const remoteJid = resolveInboundWaJid(item);
    if (!remoteJid || String(remoteJid).endsWith('@g.us')) continue; // skip groups for MVP
    // Skip WhatsApp status / newsletters / broadcast lists (not human 1:1)
    const jid = String(remoteJid);
    if (
      jid === 'status@broadcast' ||
      jid.endsWith('@newsletter') ||
      jid.endsWith('@broadcast')
    ) {
      continue;
    }
    const messageId = item?.key?.id ? String(item.key.id) : undefined;
    const classified = classifyWaInbound(item?.message, messageId);
    if (!classified.text) continue;
    const phoneE164 = extractPhoneFromInboundItem(item);
    const profilePicUrl = extractProfilePicFromInboundItem(item);
    const key = item?.key || {};
    const webhookPnSource = phoneE164 ? inboundPhoneSource(item) : undefined;
    if (!phoneE164 && isWhatsAppLid(remoteJid)) {
      console.warn(
        `[ai-whatsapp] inbound LID without PN in payload instance=${instanceName} remoteJid=${key.remoteJid || remoteJid} alt=${key.remoteJidAlt || item?.remoteJidAlt || '-'} senderPn=${key.senderPn || item?.senderPn || '-'} participantAlt=${key.participantAlt || '-'} — trying Contact/Chat explicit fields next`,
      );
    } else if (phoneE164) {
      console.log(
        `[ai-whatsapp] inbound PN from ${webhookPnSource || 'webhook'} instance=${instanceName} e164=+${phoneE164} remoteJid=${key.remoteJid || remoteJid}`,
      );
    }
    await handleInboundMessage({
      instanceName: String(instanceName),
      from: remoteJid,
      text: classified.text,
      messageId,
      fromMe,
      pushName: item?.pushName,
      contactName: item?.pushName,
      phoneE164,
      phoneSource: webhookPnSource,
      profilePicUrl,
      remoteJid: String(remoteJid),
      attachments: classified.attachments,
      needsVision: classified.needsVision,
      needsAsr: classified.needsAsr,
      needsDoc: Boolean(classified.needsDoc),
      mimeHint: classified.attachments[0]?.mimeType,
    });
  }
}

/**
 * Confirm phone is registered on WhatsApp via Evolution whatsappNumbers / IsOnWhatsApp.
 * Used by saas-api cross-channel enrich (site / TG / MAX → Person.whatsapp).
 */
async function checkPhoneOnWhatsApp(opts: {
  tenantId: string;
  phone: string;
  botId?: string;
}): Promise<{
  ok: boolean;
  exists?: boolean;
  phone?: string;
  botId?: string;
  error?: string;
}> {
  const phone = normalizeWaNumber(opts.phone);
  if (!opts.tenantId || !phone || !isLikelyE164Phone(phone)) {
    return { ok: false, error: 'bad_input' };
  }
  if (!evolutionConfigured()) {
    return { ok: false, error: 'evolution_not_configured' };
  }

  const bot = opts.botId
    ? await prisma.botInstance.findFirst({
        where: {
          id: opts.botId,
          tenantId: opts.tenantId,
          botType: 'ai_wa',
          status: 'active',
          botTokenEncrypted: { not: null },
        },
      })
    : await prisma.botInstance.findFirst({
        where: {
          tenantId: opts.tenantId,
          botType: 'ai_wa',
          status: 'active',
          botTokenEncrypted: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
      });
  if (!bot) {
    return { ok: true, exists: false, error: 'no_wa_session', phone };
  }

  const session = decodeSession(bot.botTokenEncrypted);
  if (!session?.instanceName) {
    return { ok: false, error: 'bad_session', botId: bot.id };
  }

  const res = await evoFetch(
    `/chat/whatsappNumbers/${encodeURIComponent(session.instanceName)}`,
    { method: 'POST', body: JSON.stringify({ numbers: [phone] }) },
  );
  if (!res.ok) {
    return {
      ok: false,
      error: `evolution_http_${res.status}`,
      botId: bot.id,
      phone,
    };
  }
  const rows: any[] = Array.isArray(res.json) ? res.json : [];
  const hit = rows[0];
  const exists = Boolean(hit?.exists);
  return {
    ok: true,
    exists,
    phone,
    botId: bot.id,
  };
}

/** One-shot: LID Conversations → Evolution Contact book → Twenty phones/whatsapp. */
async function backfillWaPhonesFromEvolution(opts?: {
  tenantId?: string;
}): Promise<{ scanned: number; resolved: number; unresolved: string[] }> {
  const unresolved: string[] = [];
  let scanned = 0;
  let resolved = 0;

  const bots = await prisma.botInstance.findMany({
    where: {
      botType: 'ai_wa',
      ...(opts?.tenantId ? { tenantId: opts.tenantId } : {}),
    },
    take: 200,
  });

  for (const bot of bots) {
    const session = decodeSession(bot.botTokenEncrypted);
    if (!session?.instanceName) continue;

    const convs = await prisma.conversation.findMany({
      where: {
        botInstanceId: bot.id,
        platform: 'whatsapp',
        status: { in: ['open', 'waiting_for_human'] },
      },
      take: 500,
    });

    for (const conv of convs) {
      scanned += 1;
      const existingPhone =
        (conv.platformUsername &&
        isLikelyE164Phone(normalizeWaNumber(conv.platformUsername))
          ? normalizeWaNumber(conv.platformUsername)
          : undefined) ||
        (isLikelyE164Phone(conv.platformUserId) ? conv.platformUserId : undefined);
      if (existingPhone) {
        // Still push to CRM in case Person.whatsapp was empty.
        await syncLeadToCrm({
          tenantId: conv.tenantId,
          botId: bot.id,
          conversationId: conv.id,
          platformUserId: conv.platformUserId,
          contactName: conv.platformFirstName || undefined,
          phoneE164: existingPhone,
        });
        resolved += 1;
        continue;
      }
      if (!isWhatsAppLid(conv.platformUserId)) {
        unresolved.push(`${conv.id}:not-lid`);
        continue;
      }
      const contactHit = await resolvePhoneFromEvolutionContacts(
        session.instanceName,
        conv.platformUserId,
        { pushName: conv.platformFirstName },
      );
      let phone = contactHit.phone;
      if (!phone) {
        const fromEvolution = await resolveLidPhoneFromEvolution(
          session.instanceName,
          conv.platformUserId,
          { pushName: conv.platformFirstName },
        );
        phone = fromEvolution.phone;
      }
      if (!phone) {
        unresolved.push(`${conv.id}:lid=${conv.platformUserId}`);
        continue;
      }
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { platformUsername: `+${phone}` },
      });
      await syncLeadToCrm({
        tenantId: conv.tenantId,
        botId: bot.id,
        conversationId: conv.id,
        platformUserId: conv.platformUserId,
        contactName: conv.platformFirstName || undefined,
        phoneE164: phone,
      });
      resolved += 1;
    }
  }

  return { scanned, resolved, unresolved };
}

async function main() {
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        evolutionConfigured: evolutionConfigured(),
        serviceToken: Boolean(resolveServiceToken('ai-whatsapp-worker')),
      });
    }

    // Evolution webhook (no service token — network-internal; optionally share secret later)
    if (req.method === 'POST' && url.pathname === '/webhook/evolution') {
      try {
        const data = await readJsonBody(req);
        await handleEvolutionWebhook(data);
        return sendJson(res, 200, { ok: true });
      } catch (err) {
        console.error('[ai-whatsapp] webhook error', err);
        return sendJson(res, 500, { ok: false, error: 'webhook failed' });
      }
    }

    if (!requireServiceAuth(req)) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    }

    try {
      if (req.method === 'POST' && url.pathname === '/internal/auth/qr/start') {
        const body = await readJsonBody(req);
        const result = await handleQrStart(String(body.tenantId || ''), String(body.name || 'default'));
        return sendJson(res, result.status, result.body);
      }

      if (req.method === 'GET' && url.pathname === '/internal/auth/qr/status') {
        const result = await handleQrStatus(
          String(url.searchParams.get('tenantId') || ''),
          String(url.searchParams.get('name') || 'default'),
        );
        return sendJson(res, result.status, result.body);
      }

      if (req.method === 'POST' && url.pathname === '/internal/accounts/delete') {
        const body = await readJsonBody(req);
        const result = await handleDeleteAccount(
          String(body.tenantId || ''),
          String(body.botId || ''),
        );
        return sendJson(res, result.status, result.body);
      }

      if (req.method === 'POST' && url.pathname === '/internal/messages/send') {
        const body = await readJsonBody(req);
        const botId = String(body.botId || '');
        const to = String(body.to || body.peerUserId || '');
        const text = String(body.text || '');
        const mediaBase64 = String(body.mediaBase64 || body.fileBase64 || '');
        const mimeType = String(body.mimeType || 'application/octet-stream');
        const fileName = String(body.fileName || body.filename || 'file.bin');
        if (!botId || !to || (!text && !mediaBase64)) {
          return sendJson(res, 400, {
            ok: false,
            error: 'botId, to, and text or mediaBase64 required',
          });
        }
        const bot = await prisma.botInstance.findFirst({
          where: { id: botId, botType: 'ai_wa' },
        });
        if (!bot) return sendJson(res, 404, { ok: false, error: 'account not found' });
        const session = decodeSession(bot.botTokenEncrypted);
        if (!session?.instanceName) {
          return sendJson(res, 400, { ok: false, error: 'WhatsApp session missing' });
        }

        // Mark recent inbound as read before operator/CRM outbound.
        if (body.markRead !== false) {
          const peer = normalizeWaNumber(to);
          const convForRead = await prisma.conversation.findFirst({
            where: {
              botInstanceId: bot.id,
              platformUserId: peer,
              status: { in: ['open', 'waiting_for_human'] },
            },
            select: { id: true, suppressDealCreation: true },
          });
          if (convForRead) {
            if (convForRead.suppressDealCreation === true) {
              console.log(`[ai-whatsapp] skip markRead conv=${convForRead.id} (suppressDealCreation)`);
            } else {
              const recent = await prisma.chatMessage.findMany({
                where: {
                  conversationId: convForRead.id,
                  role: 'user',
                  externalMessageId: { not: null },
                },
                orderBy: { sentAt: 'desc' },
                take: 10,
                select: { externalMessageId: true },
              });
              const ids = recent
                .map((m) => m.externalMessageId)
                .filter((id): id is string => Boolean(id));
              if (ids.length) await markWhatsAppRead(session.instanceName, to, ids);
            }
          }
        }

        let attachment:
          | { type: 'photo' | 'video' | 'document'; fileId: string; fileName: string; mimeType: string }
          | undefined;
        if (mediaBase64) {
          if (body.typing !== false) {
            await sendWhatsAppTyping(session.instanceName, to, 1500);
          }
          attachment = await sendWhatsAppMedia({
            instanceName: session.instanceName,
            to,
            mediaBase64,
            mimeType,
            fileName,
            caption: text || undefined,
          });
        } else {
          // CRM operator outbound — send instantly (no AI human-like typing delay).
          // Split multi-bubble into short messages with minimal 600ms gap for readability.
          const bubbles = parseAiBubbles(text);
          for (let i = 0; i < bubbles.length; i += 1) {
            await sendWhatsAppText(session.instanceName, to, bubbles[i]);
            if (i < bubbles.length - 1) {
              await new Promise((r) => setTimeout(r, 600));
            }
          }
        }

        // Human outbound — store already done by CRM; do not auto-pause AI.
        return sendJson(res, 200, { ok: true, attachment: attachment || null });
      }

      // Broadcast story: WhatsApp status via Evolution sendStatus (Job 1D.1).
      if (req.method === 'POST' && url.pathname === '/internal/stories/send') {
        const body = await readJsonBody(req);
        const botId = String(body.botId || '').trim();
        const text = String(body.text || '').trim();
        const mediaUrl = String(body.mediaUrl || '').trim();
        const caption = String(body.caption || '').trim();
        const mediaType = String(body.mediaType || '').trim();
        const statusJidList = Array.isArray(body.statusJidList)
          ? body.statusJidList.map(String)
          : [];
        if (!botId || (!text && !mediaUrl)) {
          return sendJson(res, 400, {
            ok: false,
            error: 'botId and text or mediaUrl required',
          });
        }
        const bot = await prisma.botInstance.findFirst({
          where: { id: botId, botType: 'ai_wa' },
        });
        if (!bot) return sendJson(res, 404, { ok: false, error: 'account not found' });
        const session = decodeSession(bot.botTokenEncrypted);
        if (!session?.instanceName) {
          return sendJson(res, 400, { ok: false, error: 'WhatsApp session missing' });
        }
        try {
          let type: 'text' | 'image' | 'video';
          let content: string;
          if (mediaUrl) {
            type = mediaType === 'video' ? 'video' : 'image';
            content = mediaUrl;
          } else {
            type = 'text';
            content = text;
            if (!body.backgroundColor && !statusJidList.length) {
              body.backgroundColor = body.backgroundColor || '#000000';
            }
            body.font = body.font ?? 0;
          }
          await sendWhatsAppStory({
            instanceName: session.instanceName,
            type,
            content,
            caption: caption || (mediaUrl ? text : undefined),
            statusJidList,
            backgroundColor: body.backgroundColor,
            font: body.font,
          });
          return sendJson(res, 200, { ok: true, type });
        } catch (err) {
          const message = String((err as Error)?.message || err);
          console.error('[ai-whatsapp] story send failed', message);
          return sendJson(res, 400, { ok: false, error: message });
        }
      }

      // CRM file preview: re-download media by Evolution message id.
      if (req.method === 'POST' && url.pathname === '/internal/messages/media') {
        const body = await readJsonBody(req);
        const botId = String(body.botId || '').trim();
        const messageId = String(body.messageId || body.fileId || '').trim();
        let remoteJid = String(body.remoteJid || body.peerUserId || '').trim();
        if (!botId || !messageId) {
          return sendJson(res, 400, {
            ok: false,
            error: 'botId and messageId (or fileId) required',
          });
        }
        const bot = await prisma.botInstance.findFirst({
          where: { id: botId, botType: 'ai_wa' },
        });
        if (!bot) return sendJson(res, 404, { ok: false, error: 'account not found' });
        const session = decodeSession(bot.botTokenEncrypted);
        if (!session?.instanceName) {
          return sendJson(res, 400, { ok: false, error: 'WhatsApp session missing' });
        }
        let attTypeHint = '';
        let fromMeHint: boolean | undefined =
          typeof body.fromMe === 'boolean' ? body.fromMe : undefined;
        {
          let msgRow = await prisma.chatMessage.findFirst({
            where: {
              externalMessageId: messageId,
              conversation: { botInstanceId: bot.id },
            },
            select: {
              role: true,
              attachments: true,
              conversation: { select: { platformUserId: true } },
            },
          });
          // CRM outbound often stores Evolution key only in attachments.fileId
          // (externalMessageId unset until INC-115) — scan recent messages.
          if (!msgRow) {
            const recent = await prisma.chatMessage.findMany({
              where: { conversation: { botInstanceId: bot.id } },
              orderBy: { sentAt: 'desc' },
              take: 120,
              select: {
                role: true,
                attachments: true,
                conversation: { select: { platformUserId: true } },
              },
            });
            msgRow =
              recent.find((m) => {
                if (!Array.isArray(m.attachments)) return false;
                return m.attachments.some(
                  (a: unknown) =>
                    a &&
                    typeof a === 'object' &&
                    (a as { fileId?: string }).fileId === messageId,
                );
              }) || null;
          }
          if (!remoteJid) {
            remoteJid = msgRow?.conversation?.platformUserId || '';
          }
          if (fromMeHint === undefined && msgRow?.role) {
            fromMeHint =
              msgRow.role === 'operator' || msgRow.role === 'assistant'
                ? true
                : msgRow.role === 'user'
                  ? false
                  : undefined;
          }
          if (Array.isArray(msgRow?.attachments)) {
            const match = msgRow.attachments.find(
              (a: unknown) =>
                a &&
                typeof a === 'object' &&
                (a as { fileId?: string }).fileId === messageId,
            ) as { type?: string } | undefined;
            const first = msgRow.attachments.find(
              (a: unknown) =>
                a &&
                typeof a === 'object' &&
                typeof (a as { fileId?: string }).fileId === 'string',
            ) as { type?: string } | undefined;
            attTypeHint = match?.type || first?.type || '';
          }
        }
        const convertToMp4 =
          attTypeHint === 'video' ||
          /\.(mp4|mov|webm|mkv)$/i.test(String(body.fileName || ''));
        const media = await fetchEvolutionMediaBase64({
          instanceName: session.instanceName,
          messageId,
          remoteJid: remoteJid || undefined,
          convertToMp4,
          fromMe: fromMeHint,
        });
        if (!media) {
          return sendJson(res, 404, { ok: false, error: 'media not available' });
        }
        return sendJson(res, 200, {
          ok: true,
          botId,
          messageId,
          mimeType: media.mimeType,
          fileName: media.fileName || null,
          dataBase64: media.base64,
        });
      }

      if (req.method === 'POST' && url.pathname === '/internal/chat/typing') {
        const body = await readJsonBody(req);
        const botId = String(body.botId || '');
        const to = String(body.to || body.peerUserId || '');
        const delayMs = Number(body.delayMs || 2500);
        if (!botId || !to) {
          return sendJson(res, 400, { ok: false, error: 'botId, to required' });
        }
        const bot = await prisma.botInstance.findFirst({
          where: { id: botId, botType: 'ai_wa' },
        });
        if (!bot) return sendJson(res, 404, { ok: false, error: 'account not found' });
        const session = decodeSession(bot.botTokenEncrypted);
        if (!session?.instanceName) {
          return sendJson(res, 400, { ok: false, error: 'WhatsApp session missing' });
        }
        await sendWhatsAppTyping(session.instanceName, to, delayMs);
        return sendJson(res, 200, { ok: true });
      }

      if (req.method === 'POST' && url.pathname === '/internal/chat/read') {
        const body = await readJsonBody(req);
        const botId = String(body.botId || '');
        const to = String(body.to || body.peerUserId || '');
        const messageIds = Array.isArray(body.messageIds)
          ? body.messageIds.map((id: unknown) => String(id || ''))
          : [];
        if (!botId || !to) {
          return sendJson(res, 400, { ok: false, error: 'botId, to required' });
        }
        const bot = await prisma.botInstance.findFirst({
          where: { id: botId, botType: 'ai_wa' },
        });
        if (!bot) return sendJson(res, 404, { ok: false, error: 'account not found' });
        const session = decodeSession(bot.botTokenEncrypted);
        if (!session?.instanceName) {
          return sendJson(res, 400, { ok: false, error: 'WhatsApp session missing' });
        }
        let ids = messageIds.filter(Boolean);
        if (!ids.length) {
          const peer = normalizeWaNumber(to);
          const conv = await prisma.conversation.findFirst({
            where: {
              botInstanceId: bot.id,
              platformUserId: peer,
              status: { in: ['open', 'waiting_for_human'] },
            },
          });
          if (conv) {
            const recent = await prisma.chatMessage.findMany({
              where: {
                conversationId: conv.id,
                role: 'user',
                externalMessageId: { not: null },
              },
              orderBy: { sentAt: 'desc' },
              take: 10,
              select: { externalMessageId: true },
            });
            ids = recent
              .map((m) => m.externalMessageId)
              .filter((id): id is string => Boolean(id));
          }
        }
        await markWhatsAppRead(session.instanceName, to, ids);
        return sendJson(res, 200, { ok: true, marked: ids.length });
      }

      if (req.method === 'GET' && url.pathname === '/internal/chat/presence') {
        const botId = String(url.searchParams.get('botId') || '').trim();
        const to = String(url.searchParams.get('to') || url.searchParams.get('peerUserId') || '').trim();
        if (!botId || !to) {
          return sendJson(res, 400, { ok: false, error: 'botId, to required' });
        }
        const bot = await prisma.botInstance.findFirst({
          where: { id: botId, botType: 'ai_wa' },
        });
        if (!bot) return sendJson(res, 404, { ok: false, error: 'account not found' });
        const session = decodeSession(bot.botTokenEncrypted);
        if (!session?.instanceName) {
          return sendJson(res, 200, { ok: true, presence: null });
        }
        const cached = getCachedWaPresence(session.instanceName, to);
        if (!cached) {
          return sendJson(res, 200, { ok: true, presence: null });
        }
        return sendJson(res, 200, {
          ok: true,
          presence: {
            online: cached.online,
            lastSeenAt: cached.lastSeenAt,
            approx: null,
          },
        });
      }

      if (req.method === 'POST' && url.pathname === '/internal/crm/backfill-phones') {
        const body = await readJsonBody(req);
        const tenantId = String(body.tenantId || '').trim() || undefined;
        const result = await backfillWaPhonesFromEvolution({ tenantId });
        return sendJson(res, 200, { ok: true, ...result });
      }

      // Cross-channel enrich: phone → Evolution IsOnWhatsApp (never invent wa.me without exists).
      if (req.method === 'POST' && url.pathname === '/internal/crm/check-on-whatsapp') {
        const body = await readJsonBody(req);
        const tenantId = String(body.tenantId || '').trim();
        const phone = normalizeWaNumber(String(body.phone || ''));
        const botId = String(body.botId || '').trim() || undefined;
        if (!tenantId || !phone || !isLikelyE164Phone(phone)) {
          return sendJson(res, 400, {
            ok: false,
            error: 'tenantId and E.164 phone required',
          });
        }
        const result = await checkPhoneOnWhatsApp({ tenantId, phone, botId });
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      // Private chat history → CRM (all private dialogs × up to 500 msgs; groups skipped).
      if (req.method === 'POST' && url.pathname === '/internal/crm/sync-history') {
        const body = await readJsonBody(req);
        const tenantId = String(body.tenantId || '').trim();
        const botId = String(body.botId || '').trim();
        if (!tenantId || !botId) {
          return sendJson(res, 400, { ok: false, error: 'tenantId and botId required' });
        }
        const rawDialog = Number(body.dialogLimit);
        const dialogLimit =
          Number.isFinite(rawDialog) && rawDialog > 0 ? Math.floor(rawDialog) : 0;
        const rawMsg = Number(body.messageLimit);
        const messageLimit =
          Number.isFinite(rawMsg) && rawMsg > 0 ? Math.floor(rawMsg) : 500;
        const result = await runWhatsAppPrivateChatSync({
          tenantId,
          botId,
          dialogLimit,
          messageLimit,
          force: body.force !== false,
          repairOnly: body.repairOnly === true,
        });
        return sendJson(res, result.ok ? 200 : 502, result);
      }

      if (req.method === 'GET' && url.pathname === '/internal/config') {
        return sendJson(res, 200, {
          ok: true,
          evolutionConfigured: evolutionConfigured(),
          evolutionUrl: EVOLUTION_API_URL || null,
          hint: evolutionConfigured() ? null : setupHint(),
        });
      }

      return sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      console.error('[ai-whatsapp] request error', err);
      return sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : 'internal error',
      });
    }
  });

  server.listen(PORT, () => {
    console.log(
      `[ai-whatsapp-worker] Listening on :${PORT} evolution=${evolutionConfigured() ? 'yes' : 'NO'}`,
    );
  });
}

async function maybeAttributeMailingInbound(opts: {
  tenantId: string;
  conversationId: string;
}): Promise<void> {
  const conversation = await prisma.conversation.findUnique({
    where: { id: opts.conversationId },
  });
  if (
    !conversation?.lastMailingBroadcastId ||
    !isWithinMailingAttributionWindow(conversation.lastMailingAt)
  ) {
    return;
  }
  if (!conversation.twentyPersonId) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId } });
  if (!tenant?.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) return;
  const owner = await prisma.tenantMember.findFirst({
    where: { tenantId: opts.tenantId, role: 'owner' },
    include: { user: true },
  });
  if (!owner?.user?.email) return;

  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );

  const broadcast = await prisma.broadcast.findUnique({
    where: { id: conversation.lastMailingBroadcastId },
    select: { messageJson: true },
  });
  const channel = (broadcast?.messageJson as { channel?: string } | null)?.channel;
  const note = mailingAttributionNote({
    broadcastId: conversation.lastMailingBroadcastId,
    kind: channel === 'story' ? 'story' : 'broadcast',
  });
  await client.createNoteForPerson({
    personId: conversation.twentyPersonId,
    body: note,
    title: note,
  });
  await fireGoal({
    tenantId: opts.tenantId,
    goalName: 'mailing_reply',
    subscriberId: conversation.platformUserId,
    botInstanceId: conversation.botInstanceId || undefined,
  });
}

main().catch(console.error);
