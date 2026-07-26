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
  DEFAULT_INBOUND_DEBOUNCE_MS,
  type OpenRouterUsageLike,
} from '@voxly/ai-core';
import { fireGoal } from '@voxly/analytics-dispatchers';
import { isAiConversationMode, PRODUCT_CODES } from '@voxly/shared';
import { TwentyClient } from '@voxly/twenty-client';
import OpenAI from 'openai';

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
  if (!message) return null;
  if (typeof message.conversation === 'string') return message.conversation;
  if (message.extendedTextMessage?.text) return String(message.extendedTextMessage.text);
  if (message.imageMessage?.caption) return String(message.imageMessage.caption) || '[фото]';
  if (message.videoMessage?.caption) return String(message.videoMessage.caption) || '[видео]';
  if (message.documentMessage) {
    return message.documentMessage.fileName
      ? `[файл: ${message.documentMessage.fileName}]`
      : '[документ]';
  }
  if (message.audioMessage) return '[аудио]';
  if (message.stickerMessage) return '[стикер]';
  if (message.contactMessage || message.contactsArrayMessage) {
    return '[контакт]';
  }
  return null;
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

/** Business WA profile for @lid — often has email/address, never phone on Evolution 2.2.3. */
async function fetchWaBusinessProfile(
  instanceName: string,
  lidOrNumber: string,
): Promise<{ email?: string; address?: string; description?: string } | null> {
  const digits = normalizeWaNumber(lidOrNumber);
  if (!instanceName || !digits) return null;
  const number = isWhatsAppLid(lidOrNumber) ? `${digits}@lid` : digits;
  const res = await evoFetch(`/chat/fetchBusinessProfile/${encodeURIComponent(instanceName)}`, {
    method: 'POST',
    body: JSON.stringify({ number }),
  });
  if (!res.ok || !res.json?.isBusiness) return null;
  const email = String(res.json.email || '').trim().toLowerCase();
  const address = String(res.json.address || '').trim();
  const description = String(res.json.description || '').trim();
  return {
    email: email.includes('@') ? email : undefined,
    address: address || undefined,
    description: description || undefined,
  };
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
  const base = 900;
  const perChar = 35;
  // Cap 5.5s think/typing before each bubble (Evolution presence is non-blocking).
  return Math.min(5500, Math.max(1200, base + String(text || '').length * perChar));
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

async function sendWhatsAppHumanLike(
  instanceName: string,
  to: string,
  bubbles: string[],
  opts?: { conversationId?: string; sendStartedAt?: Date },
): Promise<{ aborted?: boolean; sent: number }> {
  const parts = bubbles.map((b) => b.trim()).filter(Boolean).slice(0, 4);
  let sent = 0;
  for (let i = 0; i < parts.length; i += 1) {
    if (
      opts?.conversationId &&
      opts.sendStartedAt &&
      (await hasNewerUserMessage(opts.conversationId, opts.sendStartedAt))
    ) {
      return { aborted: true, sent };
    }
    const text = parts[i];
    const thinkMs = typingDelayMs(text);
    // Presence-only is unreliable on Evolution 2.3 (returns immediately). Typing that
    // users actually see comes from sendText `delay` (composing for N ms, then send).
    await sendWhatsAppText(instanceName, to, text, { delayMs: thinkMs });
    sent += 1;
    if (i < parts.length - 1) {
      if (
        opts?.conversationId &&
        opts.sendStartedAt &&
        (await hasNewerUserMessage(opts.conversationId, opts.sendStartedAt))
      ) {
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
}

async function resolveAssignedAgent(conversationId: string) {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      aiAgentId: true,
      aiAgent: {
        select: { id: true, name: true, systemPrompt: true, settings: true, status: true },
      },
      botInstance: {
        select: {
          defaultAiAgent: {
            select: { id: true, name: true, systemPrompt: true, settings: true, status: true },
          },
        },
      },
    },
  });
  if (!c) return null;
  const agent = c.aiAgent || c.botInstance?.defaultAiAgent || null;
  if (!agent || agent.status !== 'active') return null;
  return agent;
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
          twentyPersonId: null,
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
      if (personId && emailForCrm) {
        const ok = await client.updatePersonEmail(personId, emailForCrm);
        if (!ok) {
          console.warn(
            `[ai-whatsapp] could not set email=${emailForCrm} on person=${personId} — likely unique held by soft-deleted Person; empty Twenty trash or free the email`,
          );
        }
      }
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
      if (emailForCrm) {
        const ok = await client.updatePersonEmail(personId, emailForCrm);
        if (!ok) {
          console.warn(
            `[ai-whatsapp] could not set email=${emailForCrm} on person=${personId} — likely unique held by soft-deleted Person; empty Twenty trash or free the email`,
          );
        }
      }
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
      if (emailForCrm) {
        const ok = await client.updatePersonEmail(personId, emailForCrm);
        if (!ok) {
          console.warn(
            `[ai-whatsapp] could not set email=${emailForCrm} on person=${personId} — likely unique held by soft-deleted Person; empty Twenty trash or free the email`,
          );
        }
      }
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
      if (emailForCrm) {
        const ok = await client.updatePersonEmail(personId, emailForCrm);
        if (!ok) {
          console.warn(
            `[ai-whatsapp] could not set email=${emailForCrm} on person=${personId} — likely unique held by soft-deleted Person; empty Twenty trash or free the email`,
          );
        }
      }
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

  // Business profile email (PN or LID) — never invent phone from it.
  let businessEmail: string | undefined;
  try {
    const bizPeer = phoneE164 || from;
    const biz = await fetchWaBusinessProfile(opts.instanceName, bizPeer);
    businessEmail = biz?.email;
    if (businessEmail) {
      console.log(
        `[ai-whatsapp] business profile email for peer=${bizPeer} email=${businessEmail}`,
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

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: opts.text,
      externalMessageId: opts.messageId,
    },
  });

  void syncLeadToCrm({
    tenantId: resolved.tenantId,
    botId: resolved.id,
    conversationId: conversation.id,
    platformUserId: conversation.platformUserId || from,
    contactName: displayName !== 'WhatsApp' ? displayName : undefined,
    phoneE164,
    email: businessEmail,
  }).catch((err) => {
    console.error('[ai-whatsapp] syncLeadToCrm unhandled', err);
  });

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
    text: opts.text,
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
      createdAt: { gt: since },
    },
  });
  return n > 0;
}

async function flushWhatsAppAiReply(items: WaAiPending[]) {
  const last = items[items.length - 1];
  if (!last) return;
  const { instanceName, from, conversationId, tenantId, addonId } = last;
  const messageIds = items.map((i) => i.messageId).filter(Boolean) as string[];
  const burstText = items.map((i) => i.text).filter(Boolean).join('\n');
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
  const model =
    (agent?.settings as any)?.model ||
    process.env.AI_DEFAULT_MODEL ||
    'openai/gpt-4o-mini';
  let systemPrompt = (agent?.systemPrompt || DEFAULT_SYSTEM_PROMPT) + JSON_FORMAT_HINT;
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
  for (const msg of [...conversation.messages].reverse()) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
    });
  }

  try {
    const preferredJid =
      items.map((i) => i.remoteJid).find(Boolean) || last.remoteJid || undefined;
    await markWhatsAppRead(instanceName, from, messageIds, preferredJid);
    await sendWhatsAppTyping(instanceName, from, 4000);
    if (await hasNewerUserMessage(conversationId, sendStartedAt)) {
      console.log(
        `[ai-whatsapp] skip flush conv=${conversationId} — newer inbound before OpenRouter`,
      );
      return;
    }
    let completion;
    try {
      completion = await openai.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      });
    } catch {
      completion = await openai.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 1000,
      });
    }
    if (await hasNewerUserMessage(conversationId, sendStartedAt)) {
      console.log(
        `[ai-whatsapp] skip flush conv=${conversationId} — newer inbound after OpenRouter`,
      );
      return;
    }
    const raw =
      completion.choices[0]?.message?.content || 'Извините, я не смог сформировать ответ.';
    const bubbles = normalizeAiBubbles(parseAiBubbles(raw), 4);
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
    });

    const sendResult = await sendWhatsAppHumanLike(instanceName, from, bubbles, {
      conversationId,
      sendStartedAt,
    });

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
        content: bubbles.join('\n\n'),
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
  } catch (err) {
    console.error('[ai-whatsapp] AI reply error:', err);
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
    const text = extractText(item?.message);
    if (!text) continue;
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
      text,
      messageId: item?.key?.id,
      pushName: item?.pushName,
      contactName: item?.pushName,
      phoneE164,
      phoneSource: webhookPnSource,
      profilePicUrl,
      remoteJid: String(remoteJid),
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

main().catch(console.error);
