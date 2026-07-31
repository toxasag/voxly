// Voxly AI WhatsApp Worker — Evolution API (Baileys QR), ADR-014
// Channel connect → Conversation + CRM lead always; AI reply only if AiAgent assigned.

import { prisma } from '@voxly/db';
import { decrypt, encrypt } from '@voxly/crypto';
import {
  chargeAiUsage,
  hasAiBalance,
  resolveProviderCostRub,
  retrieveAgentContext,
  formatRagPromptBlock,
  createInboundDebouncer,
  humanBubbleGapMs,
  normalizeAiBubbles,
  filterHistoryAfterAgentUpdate,
  filterMediaCapabilityRefusals,
  isMediaCapabilityRefusal,
  hasEnrichedMediaTag,
  isNearDuplicateReply,
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
} from '@voxly/ai-core';
import { fireGoal } from '@voxly/analytics-dispatchers';
import { isAiConversationMode, PRODUCT_CODES, AI_MODEL_DEFAULTS, AI_USAGE_CHANNELS, isWithinMailingAttributionWindow, mailingAttributionNote } from '@voxly/shared';
import { TwentyClient } from '@voxly/twenty-client';
import OpenAI from 'openai';
import pg from 'pg';

const PORT = Number(process.env.AI_WHATSAPP_PORT || 3006);
const EVOLUTION_API_URL = (process.env.EVOLUTION_API_URL || '').replace(/\/$/, '');
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';
/**
 * Dangerous opt-in: map LID→phone by matching Contact profilePic CDN fingerprint.
 * Known wrong: avatar twin attached stranger's E.164 (7915… vs real 7985…).
 * Default OFF — WhatsApp UI can show PN without Contacts; Evolution 2.2.3 still
 * omits remoteJidAlt/senderPn until Baileys lidMapping (Evolution ≥2.3.6/2.3.7).
 */
const ALLOW_AVATAR_PHONE_MATCH = process.env.WA_LID_AVATAR_PHONE_MATCH === '1';
const WEBHOOK_PUBLIC_URL =
  (process.env.AI_WHATSAPP_WEBHOOK_URL || `http://ai-whatsapp-worker:${PORT}/webhook/evolution`).replace(
    /\/$/,
    '',
  );
const SERVICE_TOKEN = process.env.VOXLY_SERVICE_TOKEN || '';
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
  onFlush: async (_key, items) => {
    if (!items.length) return;
    await flushWhatsAppAiReply(items);
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
  if (!SERVICE_TOKEN) return false;
  const h = req.headers.authorization || '';
  return h === `Bearer ${SERVICE_TOKEN}`;
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
    const res = await fetch(`${EVOLUTION_API_URL}${path}`, { ...init, headers });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json, ok: res.ok };
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
}): Promise<{ base64: string; mimeType: string; fileName?: string } | null> {
  const key: Record<string, unknown> = { id: opts.messageId };
  if (opts.remoteJid) {
    key.remoteJid = opts.remoteJid.includes('@')
      ? opts.remoteJid
      : `${normalizeWaNumber(opts.remoteJid)}@s.whatsapp.net`;
    key.fromMe = false;
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
    res = await fetch(`${OPENROUTER_BASE_URL}/audio/transcriptions`, {
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
            chargeAiUsage({
              tenantId: opts.tenantId,
              providerCostRub: cost.providerCostRub,
              tokens: cost.tokens || estTokens,
              model: asrModel,
              requestType: 'transcribe',
              channel: AI_USAGE_CHANNELS.WHATSAPP,
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
            chargeAiUsage({
              tenantId: opts.tenantId,
              providerCostRub: cost.providerCostRub,
              tokens: cost.tokens || estTokens,
              model: visionModel,
              requestType: 'vision',
              channel: AI_USAGE_CHANNELS.WHATSAPP,
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
  return extractWaPhoneE164(
    row.remoteJidAlt,
    row.senderPn,
    row.participantPn,
    row.participantAlt,
    row.phone,
    row.phoneNumber,
    row.number,
    row.owner,
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
  | 'none';

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

/** Business WA profile — email/website/address; IG/FB only if present as URLs. */
async function fetchWaBusinessProfile(
  instanceName: string,
  lidOrNumber: string,
): Promise<{
  email?: string;
  address?: string;
  description?: string;
  website?: string;
  instagram?: string;
  facebook?: string;
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

  return {
    email: email.includes('@') ? email : undefined,
    address: address || undefined,
    description: description || undefined,
    website: social.website,
    instagram: social.instagram,
    facebook: social.facebook,
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
    extractPhoneFromWaContactMessage(item?.message)
  );
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
  return n;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  const rawB64 = String(opts.mediaBase64 || '').replace(/^data:[^;]+;base64,/, '');
  if (!rawB64) throw new Error('WhatsApp media payload is empty');
  const mimeType = opts.mimeType || 'application/octet-stream';
  const fileName = opts.fileName || 'file.bin';
  const mediatype = mediaTypeForMime(mimeType, fileName);
  const media = `data:${mimeType};base64,${rawB64}`;
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
  opts?: { conversationId?: string; sendStartedAt?: Date },
): Promise<{ aborted?: boolean; sent: number }> {
  const parts = bubbles.map((b) => b.trim()).filter(Boolean).slice(0, 4);
  let sent = 0;
  try {
    for (let i = 0; i < parts.length; i += 1) {
      if (
        opts?.conversationId &&
        opts.sendStartedAt &&
        (await hasNewerUserMessage(opts.conversationId, opts.sendStartedAt))
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
          opts?.conversationId &&
          opts.sendStartedAt &&
          (await hasNewerUserMessage(opts.conversationId, opts.sendStartedAt))
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
  /** Real E.164 digits when known (remoteJidAlt / senderPn); never LID. */
  phoneE164?: string;
  /** Optional email from WA business profile (LID peers often lack phone). */
  email?: string;
  website?: string;
  instagram?: string;
  facebook?: string;
  /** Optional Telegram @username for cross-channel hint merge. */
  telegramUsername?: string;
}): Promise<void> {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: opts.conversationId },
    });
    if (!conversation) return;

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
      (isLikelyE164Phone(opts.platformUserId) ? opts.platformUserId : undefined);
    const displayName = cleanWaContactName(opts.contactName, opts.platformUserId);
    const whatsappValue = phoneForCrm ? `+${phoneForCrm}` : undefined;

    // INC-042: after CRM wipe, Conversation may still hold deleted Twenty ids.
    // Validate before early-return / updates; clear + recreate when missing.
    // Soft-deleted Opportunity still stored on Conversation looks “linked” until we check.
    let personId = conversation.twentyPersonId || undefined;
    let opportunityId = conversation.twentyOpportunityId || undefined;
    let clearedStale = false;
    let needsReview = conversation.needsReview;

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
          `[ai-whatsapp] stale twentyOpportunityId=${opportunityId} conv=${opts.conversationId}; recreating`,
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
      // Create without email first — soft-deleted Persons often still hold unique emails
      // in Twenty (IDX on emailsPrimaryEmail includes trash). Attach email after create.
      const created = await client.createPerson({
        firstName: displayName,
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
          firstName: displayName,
          lastName: '',
        });
      } catch {
        /* ignore */
      }
    } else {
      await applyBusinessSocial(personId);
      if (displayName !== 'WhatsApp') {
        try {
          await client.updatePersonName(personId, {
            firstName: displayName,
            lastName: '',
          });
        } catch {
          /* ignore */
        }
      }
    }

    if (personId && opportunityId && !clearedStale) {
      await applyBusinessSocial(personId);
      if (phoneForCrm || displayName !== 'WhatsApp' || needsReview || emailForCrm) {
        await prisma.conversation.update({
          where: { id: opts.conversationId },
          data: {
            twentyPersonId: personId,
            twentyOpportunityId: opportunityId,
            needsReview: needsReview || conversation.needsReview,
            platformFirstName:
              displayName !== 'WhatsApp' ? displayName : conversation.platformFirstName,
            platformUsername: phoneForCrm
              ? `+${phoneForCrm}`
              : conversation.platformUsername,
          },
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

    if (!opportunityId && personId) {
      const botLabel = bot?.displayName || bot?.botUsername || 'WhatsApp';
      const who =
        displayName !== 'WhatsApp'
          ? displayName
          : phoneForCrm
            ? `+${phoneForCrm}`
            : 'WhatsApp';
      const opportunity = await client.createOpportunity({
        name: `${who} · WA · ${botLabel}`,
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
    }

    await prisma.conversation.update({
      where: { id: opts.conversationId },
      data: {
        twentyPersonId: personId || null,
        twentyOpportunityId: opportunityId || null,
        needsReview: needsReview || conversation.needsReview,
        platformFirstName: displayName !== 'WhatsApp' ? displayName : conversation.platformFirstName,
        platformUsername: phoneForCrm
          ? `+${phoneForCrm}`
          : conversation.platformUsername,
      },
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

    if (personId && (clearedStale || !conversation.twentyPersonId)) {
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
        const preferPnId =
          isWhatsAppLid(conv.platformUserId) && isLikelyE164Phone(twinPhone)
            ? twinPhone
            : conv.platformUserId;
        await prisma.conversation.update({
          where: { id: conv.id },
          data: {
            platformUsername: `+${twinPhone}`,
            platformUserId: preferPnId,
          },
        });
        void syncLeadToCrm({
          tenantId: conv.tenantId,
          botId: resolved.id,
          conversationId: conv.id,
          platformUserId: preferPnId,
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
  // LID-only webhooks: resolve E.164 via Evolution Contact/Chat explicit fields only.
  if (!phoneE164 && isWhatsAppLid(from)) {
    const fromContacts = await resolvePhoneFromEvolutionContacts(opts.instanceName, from, {
      pushName: opts.contactName || opts.pushName,
      profilePicUrl: opts.profilePicUrl,
    });
    if (fromContacts.phone) {
      phoneE164 = fromContacts.phone;
      phoneSource = fromContacts.source;
    } else {
      const fromChats = await resolvePhoneFromEvolutionDb(opts.instanceName, from);
      if (fromChats.phone) {
        phoneE164 = fromChats.phone;
        phoneSource = fromChats.source;
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
  const displayName = cleanWaContactName(opts.contactName || opts.pushName, from);

  // Business profile: email / website / IG·FB URLs when Evolution exposes them.
  let businessEmail: string | undefined;
  let businessWebsite: string | undefined;
  let businessInstagram: string | undefined;
  let businessFacebook: string | undefined;
  try {
    const bizPeer = phoneE164 || from;
    const biz = await fetchWaBusinessProfile(opts.instanceName, bizPeer);
    businessEmail = biz?.email;
    businessWebsite = biz?.website;
    businessInstagram = biz?.instagram;
    businessFacebook = biz?.facebook;
    if (businessEmail || businessWebsite || businessInstagram || businessFacebook) {
      console.log(
        `[ai-whatsapp] business profile peer=${bizPeer} email=${businessEmail || '-'} website=${businessWebsite || '-'} ig=${businessInstagram || '-'} fb=${businessFacebook || '-'}`,
      );
    }
  } catch (err) {
    console.warn('[ai-whatsapp] fetchBusinessProfile failed', err);
  }

  if (!conversation) {
    // Prefer dialable E.164 as platformUserId when known so LID/PN twins share one thread.
    const platformUserId = phoneE164 && isLikelyE164Phone(phoneE164) ? phoneE164 : from;
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
    (phoneE164 && conversation.platformUsername !== `+${phoneE164}`) ||
    (phoneE164 &&
      isWhatsAppLid(conversation.platformUserId) &&
      conversation.platformUserId !== phoneE164)
  ) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        platformFirstName:
          displayName !== 'WhatsApp' ? displayName : conversation.platformFirstName,
        platformUsername: phoneE164 ? `+${phoneE164}` : conversation.platformUsername,
        platformUserId:
          phoneE164 && isWhatsAppLid(conversation.platformUserId)
            ? phoneE164
            : conversation.platformUserId,
      },
    });
    if (phoneE164 && isWhatsAppLid(conversation.platformUserId)) {
      conversation = { ...conversation, platformUserId: phoneE164 };
    }
  }

  // Persist + CRM sync BEFORE slow ASR/vision/doc extract so voice/video/image/doc
  // still create Person+Opportunity if media AI hangs or fails (personal WA wipe path).
  let displayText = opts.text;
  const createdMsg = await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: displayText,
      externalMessageId: opts.messageId,
      attachments:
        opts.attachments && opts.attachments.length ? opts.attachments : undefined,
    },
  });

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

  // Mark read as soon as we accept the message (human-like).
  if (opts.messageId) {
    void markWhatsAppRead(
      session.instanceName,
      from,
      [opts.messageId],
      opts.remoteJid || (opts.from.includes('@') ? opts.from : undefined),
    );
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

async function flushWhatsAppAiReply(items: WaAiPending[]) {
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
      return await openai.chat.completions.create({
        model,
        messages: msgs,
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      });
    } catch {
      return await openai.chat.completions.create({
        model,
        messages: msgs,
        temperature: 0.7,
        max_tokens: 1000,
      });
    }
  };

  let typingStarted = false;
  try {
    const preferredJid =
      items.map((i) => i.remoteJid).find(Boolean) || last.remoteJid || undefined;
    await markWhatsAppRead(instanceName, from, messageIds, preferredJid);
    await sendWhatsAppTyping(instanceName, from, 4000);
    typingStarted = true;
    if (await hasNewerUserMessage(conversationId, sendStartedAt)) {
      console.log(
        `[ai-whatsapp] skip flush conv=${conversationId} — newer inbound before OpenRouter`,
      );
      return;
    }
    let completion = await callModel(messages);
    if (await hasNewerUserMessage(conversationId, sendStartedAt)) {
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
      if (await hasNewerUserMessage(conversationId, sendStartedAt)) {
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
    if (item?.key?.fromMe) continue;
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
        const fromChat = await resolvePhoneFromEvolutionDb(
          session.instanceName,
          conv.platformUserId,
        );
        phone = fromChat.phone;
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
        serviceToken: Boolean(SERVICE_TOKEN),
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
          });
          if (convForRead) {
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
          // Multi-bubble like Telegram (JSON message1..n or paragraphs).
          const bubbles = parseAiBubbles(text);
          await sendWhatsAppHumanLike(session.instanceName, to, bubbles);
        }

        // Human outbound — store already done by CRM; do not auto-pause AI.
        return sendJson(res, 200, { ok: true, attachment: attachment || null });
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
        {
          const msgRow = await prisma.chatMessage.findFirst({
            where: {
              externalMessageId: messageId,
              conversation: { botInstanceId: bot.id },
            },
            select: {
              attachments: true,
              conversation: { select: { platformUserId: true } },
            },
          });
          if (!remoteJid) {
            remoteJid = msgRow?.conversation?.platformUserId || '';
          }
          if (Array.isArray(msgRow?.attachments)) {
            const first = msgRow.attachments.find(
              (a: unknown) =>
                a &&
                typeof a === 'object' &&
                typeof (a as { fileId?: string }).fileId === 'string',
            ) as { type?: string } | undefined;
            attTypeHint = first?.type || '';
          }
        }
        const convertToMp4 = attTypeHint === 'video';
        const media = await fetchEvolutionMediaBase64({
          instanceName: session.instanceName,
          messageId,
          remoteJid: remoteJid || undefined,
          convertToMp4,
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
