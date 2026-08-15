// Voxly GramJS bridge — personal Telegram account sessions (QR login).
// Pattern from reference server.js; auth is Voxly-internal (Bearer VOXLY_SERVICE_TOKEN).
// Inbound text/media → ai-telegram-worker POST /internal/inbound → send bubbles via MTProto.

import http from 'node:http';
import { URL } from 'node:url';
import QRCode from 'qrcode';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { CustomFile } from 'telegram/client/uploads.js';
import { generateRandomLong } from 'telegram/Helpers.js';
import { FloodWaitError } from 'telegram/errors/index.js';
import { prisma } from '@voxly/db';
import { encrypt, decrypt } from '@voxly/crypto';
import { PRODUCT_CODES, PRICING, clientMdToTelegramHtml, fetchWithTimeout, verifyServiceToken, resolveServiceToken, extractBearer } from '@voxly/shared';

const PORT = Number(process.env.GRAMJS_BRIDGE_PORT || 3008);
const API_ID = Number(process.env.TELEGRAM_API_ID || process.env.API_ID || 0);
const API_HASH = String(process.env.TELEGRAM_API_HASH || process.env.API_HASH || '');
/** Token to authenticate outbound calls to ai-telegram-worker (per-service or shared). */
const AI_WORKER_TOKEN = resolveServiceToken('ai-telegram-worker');
const AI_WORKER_URL =
  process.env.AI_TELEGRAM_WORKER_URL || 'http://ai-telegram-worker:3005';
/** saas-api for post-connect CRM enrich (docker DNS on prod). */
const SAAS_API_URL = (
  process.env.VOXLY_CHAT_API_URL ||
  process.env.SAAS_API_URL ||
  'http://saas-api:3002'
).replace(/\/+$/, '');
/** Dialog / audience sync interval (ms). */
const AUDIENCE_SYNC_MS = Number(process.env.GRAMJS_AUDIENCE_SYNC_MS || 20 * 60 * 1000);
/** Min gap between membership checks per (botId,user,peer) key. */
const MEMBERSHIP_CHECK_COOLDOWN_MS = 60_000;

type QrState = {
  status: string;
  url?: string;
  err?: string;
  user?: { id: string; username?: string; firstName?: string };
  resolvePassword?: (pw: string) => void;
  botId?: string;
  tenantId?: string;
};

const qrState = new Map<string, QrState>();
/** botInstanceId → live client */
const clients = new Map<string, TelegramClient>();
const handlersAttached = new Set<string>();
/** botInstanceId → message ids we just sent via AI (ignore for human-pause) */
const aiSentIds = new Map<string, Set<number>>();
/** Rate-limit membership checks: key → lastAt */
const membershipCheckAt = new Map<string, number>();
/** botIds currently syncing dialogs */
const audienceSyncing = new Set<string>();

function requireAuth(req: http.IncomingMessage): boolean {
  return verifyServiceToken(extractBearer(req.headers.authorization), 'gramjs-bridge');
}

async function readJson(req: http.IncomingMessage): Promise<any> {
  let body = '';
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function sendJson(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

type GramjsAttachment = {
  type: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker' | 'animation';
  fileId: string;
  fileName?: string;
  mimeType?: string;
};

/** Stable CRM file id: bridge can re-download via peer + message id. */
function gramjsFileId(peerId: string, messageId: number | string): string {
  return `gramjs:${peerId}:${messageId}`;
}

function parseGramjsFileId(
  fileId: string,
): { peerUserId: string; messageId: string } | null {
  if (!fileId.startsWith('gramjs:')) return null;
  const rest = fileId.slice('gramjs:'.length);
  const colon = rest.lastIndexOf(':');
  if (colon <= 0) return null;
  const peerUserId = rest.slice(0, colon).trim();
  const messageId = rest.slice(colon + 1).trim();
  if (!peerUserId || !messageId) return null;
  return { peerUserId, messageId };
}

function extractGramjsAttachment(
  msg: { id: number; photo?: unknown; sticker?: unknown; voice?: unknown; audio?: unknown; video?: unknown; videoNote?: unknown; gif?: unknown; document?: unknown; file?: { name?: string; mimeType?: string } | undefined },
  peerId: string,
): GramjsAttachment | null {
  const fileId = gramjsFileId(peerId, msg.id);
  const mime = msg.file?.mimeType;
  const name = typeof msg.file?.name === 'string' ? msg.file.name : undefined;
  if (msg.photo) {
    return { type: 'photo', fileId, mimeType: mime || 'image/jpeg' };
  }
  if (msg.sticker) {
    return { type: 'sticker', fileId, mimeType: mime || 'image/webp' };
  }
  if (msg.voice) {
    return { type: 'voice', fileId, mimeType: mime || 'audio/ogg' };
  }
  // videoNote before audio — some clients expose both; CRM needs type=video + fileName.
  if (msg.video || msg.videoNote) {
    return {
      type: 'video',
      fileId,
      mimeType: mime || 'video/mp4',
      fileName: name || (msg.videoNote ? 'video_note.mp4' : undefined),
    };
  }
  if (msg.audio) {
    return { type: 'audio', fileId, mimeType: mime, fileName: name };
  }
  if (msg.gif) {
    return { type: 'animation', fileId, mimeType: mime || 'video/mp4', fileName: name };
  }
  if (msg.document) {
    const isDocVideo = typeof mime === 'string' && mime.toLowerCase().startsWith('video/');
    return {
      type: isDocVideo ? 'video' : 'document',
      fileId,
      mimeType: mime,
      fileName: name,
    };
  }
  return null;
}

function gramjsAttachmentPlaceholder(a: GramjsAttachment, kind?: 'video_note'): string {
  if (kind === 'video_note') return '[кружочек]';
  if (a.type === 'photo') return '[фото]';
  if (a.type === 'video' || a.type === 'animation') return '[видео]';
  if (a.type === 'voice') return '[голосовое]';
  if (a.type === 'audio') return '[аудио]';
  if (a.type === 'sticker') return '[стикер]';
  return a.fileName ? `[файл: ${a.fileName}]` : '[файл]';
}

const OUTBOUND_MEDIA_MAX_BYTES = 20 * 1024 * 1024;

function classifyOutboundUpload(
  mimeType: string,
  fileName: string,
): {
  type: 'photo' | 'video' | 'document' | 'audio' | 'voice';
  forceDocument: boolean;
  voiceNote: boolean;
  supportsStreaming: boolean;
} {
  const mime = (mimeType || '').toLowerCase();
  const name = fileName || 'file.bin';
  if (mime.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(name)) {
    return {
      type: 'photo',
      forceDocument: false,
      voiceNote: false,
      supportsStreaming: false,
    };
  }
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(name)) {
    return {
      type: 'video',
      forceDocument: false,
      voiceNote: false,
      supportsStreaming: true,
    };
  }
  const isOgg =
    mime.includes('ogg') ||
    mime === 'audio/opus' ||
    /\.(ogg|opus)$/i.test(name);
  if (isOgg || mime === 'audio/ogg') {
    return {
      type: 'voice',
      forceDocument: false,
      voiceNote: true,
      supportsStreaming: false,
    };
  }
  if (mime.startsWith('audio/') || /\.(mp3|m4a|wav|aac|flac)$/i.test(name)) {
    return {
      type: 'audio',
      forceDocument: false,
      voiceNote: false,
      supportsStreaming: false,
    };
  }
  return {
    type: 'document',
    forceDocument: true,
    voiceNote: false,
    supportsStreaming: false,
  };
}

/** Resolve peer for CRM send: id → @username → ImportContacts(phone). */
async function resolveSendPeer(
  client: TelegramClient,
  peerUserId: string,
  opts: { phoneHint?: string; usernameHint?: string } = {},
): Promise<{ entity: any; peerId: string } | null> {
  let entity = await resolvePeerEntity(client, peerUserId);
  let peerId = peerUserId;
  const usernameHint = (opts.usernameHint || '').trim().replace(/^@/, '');
  if (!entity && usernameHint) {
    try {
      entity = await client.getEntity(usernameHint);
    } catch {
      try {
        entity = await client.getEntity(`@${usernameHint}`);
      } catch {
        entity = null;
      }
    }
  }
  const phoneHint = (opts.phoneHint || '').trim();
  if (!entity && phoneHint) {
    const imported = await resolveUserByPhone(client, phoneHint, {
      keepContact: true,
    });
    if (imported?.exists && imported.userId) {
      if (/^\d{1,20}$/.test(peerUserId) && imported.userId !== peerUserId) {
        console.warn(
          `[gramjs] send peer id mismatch: crm=${peerUserId} phone→${imported.userId} — using phone`,
        );
      }
      peerId = imported.userId;
      entity = await resolvePeerEntity(client, imported.userId);
    }
  }
  if (!entity) return null;
  return { entity, peerId };
}

const GRAMJS_VISION_MAX_BYTES = 8 * 1024 * 1024;
/** Video ASR / document extract — up to Bot API-ish size; audio demuxed in AI worker. */
const GRAMJS_ASR_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
/** CRM preview can be larger than vision/ASR payloads (Telegram Bot API ~20MB). */
const GRAMJS_CRM_MEDIA_MAX_BYTES = 20 * 1024 * 1024;

async function downloadGramjsMediaBuffer(
  client: TelegramClient,
  msg: Parameters<TelegramClient['downloadMedia']>[0],
  maxBytes: number = GRAMJS_VISION_MAX_BYTES,
): Promise<{ buffer: Buffer; mimeType?: string } | null> {
  try {
    const raw = await client.downloadMedia(msg, {});
    if (!raw) return null;
    const buffer = Buffer.isBuffer(raw)
      ? raw
      : typeof raw === 'string'
        ? Buffer.from(raw)
        : null;
    if (!buffer || buffer.length === 0) return null;
    if (buffer.length > maxBytes) {
      console.warn(`[gramjs] media too large (${buffer.length} bytes > ${maxBytes}), skip`);
      return null;
    }
    return { buffer };
  } catch (err) {
    console.warn('[gramjs] downloadMedia failed', err);
    return null;
  }
}

/** Soft SKU gate — warn if no ai_gramjs addon; do not hard-block (billing UX later). */
async function softCheckAddon(tenantId: string): Promise<boolean> {
  const addon = await prisma.addon.findFirst({
    where: {
      tenantId,
      type: PRODUCT_CODES.AI_GRAMJS,
      status: 'active',
      activeUntil: { gt: new Date() },
    },
  });
  if (!addon) {
    console.warn(
      `[gramjs] soft gate: no active ${PRODUCT_CODES.AI_GRAMJS} addon ` +
        `(${PRICING.AI_GRAMJS_MONTHLY}₽/mo) for tenant ${tenantId}`,
    );
    return false;
  }
  return true;
}

/** Human typed from phone → auto-pause AI ~1h (same as Business). */
async function pauseOnHumanOutbound(opts: {
  tenantId: string;
  botId: string;
  platformUserId: string;
  content: string;
  externalMessageId?: string;
  /** Phone-app / CRM media — store descriptors only; never syncLead/enrich. */
  attachments?: GramjsAttachment[];
}) {
  // Dedup CRM echo + webhook retry (same TG message id).
  if (opts.externalMessageId) {
    const dup = await prisma.chatMessage.findFirst({
      where: {
        externalMessageId: opts.externalMessageId,
        conversation: {
          tenantId: opts.tenantId,
          botInstanceId: opts.botId,
        },
      },
      select: { id: true },
    });
    if (dup) return;
  }

  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: opts.tenantId,
      botInstanceId: opts.botId,
      platformUserId: opts.platformUserId,
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!conversation) {
    // Conversation only — never Person/Opportunity from phone outbound.
    conversation = await prisma.conversation.create({
      data: {
        tenantId: opts.tenantId,
        botInstanceId: opts.botId,
        platform: 'telegram',
        platformUserId: opts.platformUserId,
        channel: 'telegram_gramjs',
        status: 'open',
        mode: 'ai',
      },
    });
  }

  const atts = opts.attachments?.length ? opts.attachments : undefined;
  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'operator',
      content: opts.content || '[outbound]',
      externalMessageId: opts.externalMessageId,
      ...(atts ? { attachments: atts } : {}),
    },
  });
  // Do NOT auto-pause AI (manual pause/off only). No CRM lead sync.
}

function rememberAiSent(botId: string, messageId: number) {
  let set = aiSentIds.get(botId);
  if (!set) {
    set = new Set();
    aiSentIds.set(botId, set);
  }
  set.add(messageId);
  // Bound memory: drop oldest when large
  if (set.size > 200) {
    const first = set.values().next().value;
    if (first !== undefined) set.delete(first);
  }
}

type PeerType = 'channel' | 'group' | 'bot' | 'user';

function classifyEntity(entity: unknown): {
  peerId: string;
  peerType: PeerType;
  username?: string;
  title?: string;
} | null {
  if (entity instanceof Api.User) {
    return {
      peerId: String(entity.id),
      peerType: entity.bot ? 'bot' : 'user',
      username: entity.username || undefined,
      title: [entity.firstName, entity.lastName].filter(Boolean).join(' ') || undefined,
    };
  }
  if (entity instanceof Api.Channel) {
    const megagroup = Boolean(entity.megagroup);
    return {
      peerId: String(entity.id),
      peerType: megagroup ? 'group' : 'channel',
      username: entity.username || undefined,
      title: entity.title || undefined,
    };
  }
  if (entity instanceof Api.Chat) {
    return {
      peerId: String(entity.id),
      peerType: 'group',
      title: entity.title || undefined,
    };
  }
  return null;
}

async function upsertPeer(info: {
  peerId: string;
  peerType: PeerType;
  username?: string;
  title?: string;
}) {
  const now = new Date();
  await prisma.telegramPeer.upsert({
    where: { peerId: info.peerId },
    create: {
      peerId: info.peerId,
      peerType: info.peerType,
      username: info.username,
      title: info.title,
      updatedAt: now,
    },
    update: {
      peerType: info.peerType,
      username: info.username ?? undefined,
      title: info.title ?? undefined,
      updatedAt: now,
    },
  });
}

async function upsertSighting(opts: {
  telegramUserId: string;
  peerId: string;
  relation: 'member' | 'seen_in' | 'admin';
  sourceTenantId: string;
  sourceBotInstanceId?: string;
  confidence?: number;
}) {
  if (opts.telegramUserId === opts.peerId && opts.relation !== 'member') {
    // Skip trivial self-peer noise for seen_in
  }
  const now = new Date();
  await prisma.telegramSighting.upsert({
    where: {
      telegramUserId_peerId_relation: {
        telegramUserId: opts.telegramUserId,
        peerId: opts.peerId,
        relation: opts.relation,
      },
    },
    create: {
      telegramUserId: opts.telegramUserId,
      peerId: opts.peerId,
      relation: opts.relation,
      firstSeenAt: now,
      lastSeenAt: now,
      sourceTenantId: opts.sourceTenantId,
      sourceBotInstanceId: opts.sourceBotInstanceId,
      confidence: opts.confidence ?? 1,
      updatedAt: now,
    },
    update: {
      lastSeenAt: now,
      sourceTenantId: opts.sourceTenantId,
      sourceBotInstanceId: opts.sourceBotInstanceId ?? undefined,
      confidence: opts.confidence ?? undefined,
      updatedAt: now,
    },
  });
}

/** Sync dialogs → peers + memberships for the connected GramJS account. */
/** Re-attach threads orphaned when an account was deleted/reconnected (sole session). */
async function relinkOrphanedGramjsConversations(
  tenantId: string,
  botId: string,
): Promise<number> {
  const other = await prisma.botInstance.count({
    where: {
      tenantId,
      botType: 'ai_gramjs',
      status: 'active',
      botTokenEncrypted: { not: null },
      NOT: { id: botId },
    },
  });
  if (other > 0) return 0;
  const result = await prisma.conversation.updateMany({
    where: {
      tenantId,
      botInstanceId: null,
      channel: 'telegram_gramjs',
    },
    data: { botInstanceId: botId },
  });
  if (result.count > 0) {
    console.log(
      `[gramjs] relinked ${result.count} orphaned telegram_gramjs conversations → bot=${botId}`,
    );
  }
  return result.count;
}

type PrivateDialogMessage = {
  id: number;
  out: boolean;
  text: string;
  date: number;
  /** Present when message has media — CRM stores for /messages/media preview. */
  attachment?: GramjsAttachment;
};

type PrivateDialogExport = {
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  messages: PrivateDialogMessage[];
};

/**
 * Export private (User) dialogs + last N messages for CRM import.
 * Groups/channels/bots are excluded. dialogLimit<=0 → all private dialogs
 * (GramJS paginates until done). Concurrency 1 + sleep between chats to
 * reduce FloodWait risk.
 */
async function exportPrivateDialogsForCrm(
  client: TelegramClient,
  opts: { dialogLimit: number; messageLimit: number },
): Promise<PrivateDialogExport[]> {
  const allDialogs = opts.dialogLimit <= 0;
  // Over-fetch when capped so groups/channels don't starve the private quota.
  const fetchLimit = allDialogs
    ? undefined
    : Math.min(Math.max(opts.dialogLimit * 5, opts.dialogLimit), 2000);
  const dialogs = await client.getDialogs({ limit: fetchLimit });
  const out: PrivateDialogExport[] = [];
  for (const d of dialogs) {
    if (!allDialogs && out.length >= opts.dialogLimit) break;
    const entity = d.entity;
    if (!(entity instanceof Api.User) || entity.bot || entity.self) continue;

    const userId = String(entity.id);
    let messages: PrivateDialogMessage[] = [];
    try {
      const hist = await client.getMessages(entity, { limit: opts.messageLimit });
      messages = hist
        .filter((m) => m && typeof m.id === 'number')
        .map((m) => {
          const attachment = extractGramjsAttachment(m as any, userId);
          const text = (m.message || '').trim();
          const placeholder =
            text ||
            (attachment
              ? gramjsAttachmentPlaceholder(
                  attachment,
                  (m as { videoNote?: unknown }).videoNote ? 'video_note' : undefined,
                )
              : m.media
                ? '[media]'
                : '');
          return {
            id: m.id,
            out: Boolean(m.out),
            text: placeholder,
            date: m.date || 0,
            ...(attachment ? { attachment } : {}),
          };
        })
        .filter((m) => m.text)
        .reverse(); // chronological
    } catch (err) {
      console.warn(
        `[gramjs] private dialog history failed user=${userId}`,
        err instanceof Error ? err.message : err,
      );
    }
    // Rate-limit before next peer (even if this chat had no text msgs).
    await sleep(500 + Math.floor(Math.random() * 400));
    if (messages.length === 0) continue;
    out.push({
      userId,
      username: entity.username || undefined,
      firstName: entity.firstName || undefined,
      lastName: entity.lastName || undefined,
      phone:
        typeof entity.phone === 'string' && entity.phone.trim()
          ? entity.phone.trim()
          : undefined,
      messages,
    });
  }
  return out;
}

async function syncAudienceFromDialogs(
  client: TelegramClient,
  tenantId: string,
  botId: string,
): Promise<{ peers: number; sightings: number }> {
  if (audienceSyncing.has(botId)) return { peers: 0, sightings: 0 };
  audienceSyncing.add(botId);
  let peers = 0;
  let sightings = 0;
  try {
    const me = await client.getMe();
    if (!(me instanceof Api.User)) return { peers: 0, sightings: 0 };
    const meId = String(me.id);
    await upsertPeer({
      peerId: meId,
      peerType: 'user',
      username: me.username || undefined,
      title: [me.firstName, me.lastName].filter(Boolean).join(' ') || undefined,
    });
    peers += 1;

    const dialogs = await client.getDialogs({ limit: 200 });
    for (const d of dialogs) {
      const entity = d.entity;
      if (!entity) continue;
      const info = classifyEntity(entity);
      if (!info) continue;
      await upsertPeer(info);
      peers += 1;

      if (info.peerType === 'channel' || info.peerType === 'group') {
        await upsertSighting({
          telegramUserId: meId,
          peerId: info.peerId,
          relation: 'member',
          sourceTenantId: tenantId,
          sourceBotInstanceId: botId,
          confidence: 1,
        });
        sightings += 1;
      }
    }
    console.log(
      `[gramjs] audience sync bot=${botId} peers≈${peers} sightings≈${sightings}`,
    );
    return { peers, sightings };
  } catch (err) {
    console.warn(`[gramjs] audience sync failed bot=${botId}`, err);
    return { peers, sightings };
  } finally {
    audienceSyncing.delete(botId);
  }
}

async function recordInboundSighting(opts: {
  tenantId: string;
  botId: string;
  sender: Api.User;
  chat: object | null;
}) {
  const senderInfo = classifyEntity(opts.sender);
  if (!senderInfo) return;
  await upsertPeer(senderInfo);

  const chatInfo = opts.chat ? classifyEntity(opts.chat) : null;
  if (chatInfo && (chatInfo.peerType === 'channel' || chatInfo.peerType === 'group')) {
    await upsertPeer(chatInfo);
    await upsertSighting({
      telegramUserId: senderInfo.peerId,
      peerId: chatInfo.peerId,
      relation: 'seen_in',
      sourceTenantId: opts.tenantId,
      sourceBotInstanceId: opts.botId,
      confidence: 0.8,
    });
  }
}

async function checkMembership(opts: {
  botId: string;
  userId: string;
  peerId: string;
  tenantId: string;
}): Promise<{ ok: boolean; isMember?: boolean; error?: string; rateLimited?: boolean }> {
  const key = `${opts.botId}:${opts.userId}:${opts.peerId}`;
  const last = membershipCheckAt.get(key) || 0;
  if (Date.now() - last < MEMBERSHIP_CHECK_COOLDOWN_MS) {
    return { ok: false, rateLimited: true, error: 'rate_limited' };
  }
  membershipCheckAt.set(key, Date.now());

  const client = await loadClient(opts.botId);
  if (!client?.connected) return { ok: false, error: 'session not connected' };

  try {
    let peerEntity;
    try {
      peerEntity = await client.getEntity(opts.peerId);
    } catch {
      peerEntity = await client.getEntity(Number(opts.peerId));
    }
    const peerInfo = classifyEntity(peerEntity);
    if (!peerInfo || (peerInfo.peerType !== 'channel' && peerInfo.peerType !== 'group')) {
      return { ok: false, error: 'peer must be channel or group' };
    }
    await upsertPeer(peerInfo);

    let isMember = false;
    try {
      // channels.GetParticipant works for channels/supergroups the account can see
      const inputChannel = await client.getInputEntity(peerEntity);
      const inputUser = await client.getInputEntity(
        Number.isFinite(Number(opts.userId)) ? Number(opts.userId) : opts.userId,
      );
      await client.invoke(
        new Api.channels.GetParticipant({
          channel: inputChannel as unknown as Api.TypeInputChannel,
          participant: inputUser as Api.TypeInputPeer,
        }),
      );
      isMember = true;
    } catch {
      isMember = false;
    }

    if (isMember) {
      await upsertSighting({
        telegramUserId: opts.userId,
        peerId: peerInfo.peerId,
        relation: 'member',
        sourceTenantId: opts.tenantId,
        sourceBotInstanceId: opts.botId,
        confidence: 0.95,
      });
    }
    return { ok: true, isMember };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message || err) };
  }
}

async function ensureBotInstance(tenantId: string, label: string) {
  let bot = await prisma.botInstance.findFirst({
    where: { tenantId, botType: 'ai_gramjs', botUsername: label, status: 'active' },
  });
  if (!bot) {
    bot = await prisma.botInstance.create({
      data: {
        tenantId,
        botType: 'ai_gramjs',
        botUsername: label,
        status: 'active',
        provisionedVia: 'manual',
      },
    });
  }
  return bot;
}

async function persistSession(botId: string, sessionStr: string, me: {
  id: string;
  username?: string;
  firstName?: string;
  premium?: boolean;
}) {
  const existing = await prisma.botInstance.findUnique({
    where: { id: botId },
    select: { warmupSince: true },
  });
  await prisma.botInstance.update({
    where: { id: botId },
    data: {
      botTokenEncrypted: encrypt(sessionStr),
      botUsername: me.username || me.firstName || botId,
      phoneNumberId: me.id,
      status: 'active',
      isPremium: me.premium === true,
      // Warm-up starts on first successful connect (kept if already set).
      ...(existing?.warmupSince ? {} : { warmupSince: new Date() }),
    },
  });
}

/** Connect ack only — CRM history sync is manual (portal «Синхронизировать»). */
async function notifySaasCrmEnrichOnConnect(
  tenantId: string,
  botId: string,
): Promise<void> {
  console.log(
    `[gramjs] skip CRM history sync on connect tenant=${tenantId} bot=${botId} (manual sync only)`,
  );
}

async function loadClient(botId: string): Promise<TelegramClient | null> {
  const existing = clients.get(botId);
  if (existing?.connected) return existing;

  const bot = await prisma.botInstance.findUnique({ where: { id: botId } });
  if (!bot?.botTokenEncrypted || bot.botType !== 'ai_gramjs') return null;
  if (!API_ID || !API_HASH) {
    console.error('[gramjs] TELEGRAM_API_ID / TELEGRAM_API_HASH not set');
    return null;
  }

  const sessionStr = decrypt(bot.botTokenEncrypted);
  const client = new TelegramClient(new StringSession(sessionStr), API_ID, API_HASH, {
    connectionRetries: 5,
  });
  await client.connect();
  clients.set(botId, client);
  attachInboundHandler(client, bot.tenantId, botId);
  void relinkOrphanedGramjsConversations(bot.tenantId, botId);
  // Fire-and-forget audience sync on connect
  void syncAudienceFromDialogs(client, bot.tenantId, botId);
  void refreshPremiumStatus(client, botId);
  return client;
}

/** Best-effort: refresh Telegram Premium flag from the connected account. */
async function refreshPremiumStatus(client: TelegramClient, botId: string) {
  try {
    const me = await client.getMe();
    if (me instanceof Api.User && typeof me.premium === 'boolean') {
      await prisma.botInstance.update({
        where: { id: botId },
        data: { isPremium: me.premium },
      });
    }
  } catch {
    /* best-effort */
  }
}

function attachInboundHandler(client: TelegramClient, tenantId: string, botId: string) {
  if (handlersAttached.has(botId)) return;
  handlersAttached.add(botId);
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg) return;

      // Own outbound (phone or CRM): mirror operator bubble; AI-tagged ids skip echo.
      if (msg.out) {
        const sent = aiSentIds.get(botId);
        if (sent?.has(msg.id)) {
          sent.delete(msg.id);
          return;
        }
        const peer = await msg.getChat();
        if (peer instanceof Api.User && !peer.bot) {
          const peerId = String(peer.id);
          const attachment = extractGramjsAttachment(msg, peerId);
          let content = (msg.message || '').trim();
          if (!content && attachment) {
            content = gramjsAttachmentPlaceholder(
              attachment,
              msg.videoNote ? 'video_note' : undefined,
            );
          }
          if (!content && !attachment) return;
          await pauseOnHumanOutbound({
            tenantId,
            botId,
            platformUserId: peerId,
            content: content || '[media]',
            externalMessageId: String(msg.id),
            attachments: attachment ? [attachment] : undefined,
          });
        }
        return;
      }

      const sender = await msg.getSender();
      if (!sender || !(sender instanceof Api.User) || sender.bot) {
        if (sender instanceof Api.User && sender.bot) {
          console.log(`[gramjs] skip inbound from bot id=${sender.id}`);
        }
        return;
      }

      // Private 1:1 only for AI/CRM. Group/channel chatter must not create deals
      // (INC: MG 8855743233 — group message became Person+Opportunity).
      let chat: object | null = null;
      try {
        chat = (await msg.getChat()) ?? null;
      } catch {
        chat = null;
      }
      const isPrivateDm = chat instanceof Api.User && !chat.bot;
      try {
        await recordInboundSighting({
          tenantId,
          botId,
          sender,
          chat,
        });
      } catch (sightErr) {
        console.warn('[gramjs] inbound sighting failed', sightErr);
      }
      if (!isPrivateDm) {
        const info = chat ? classifyEntity(chat) : null;
        console.log(
          `[gramjs] skip non-private inbound from=${sender.id} chat=${info?.peerType || 'unknown'}:${info?.peerId || '-'}`,
        );
        return;
      }

      const peerId = String(sender.id);
      const attachment = extractGramjsAttachment(msg, peerId);
      let text = (msg.message || '').trim();
      if (!text && attachment) {
        text = gramjsAttachmentPlaceholder(
          attachment,
          msg.videoNote ? 'video_note' : undefined,
        );
      }
      if (!text) {
        console.log(`[gramjs] skip empty from ${sender.id}`);
        return;
      }

      // Check suppressDealCreation before marking as read.
      let shouldMarkRead = true;
      try {
        const conv = await prisma.conversation.findFirst({
          where: {
            tenantId,
            botInstanceId: botId,
            platformUserId: peerId,
          },
          orderBy: { updatedAt: 'desc' },
          select: { suppressDealCreation: true },
        });
        if (conv?.suppressDealCreation === true) {
          shouldMarkRead = false;
          console.log(`[gramjs] skip markRead peer=${peerId} (suppressDealCreation)`);
        }
      } catch (err) {
        console.warn('[gramjs] check suppressDealCreation failed', err);
      }

      // Mark inbound as read immediately (blue ticks / read status).
      if (shouldMarkRead) {
        try {
          await client.invoke(
            new Api.messages.ReadHistory({
              peer: sender,
              maxId: msg.id,
            }),
          );
        } catch (err) {
          console.warn('[gramjs] ReadHistory on inbound failed', err);
        }
      }

      // Api.User.phone is visible when peer is in contacts / shared number (no leading +).
      const phoneRaw =
        typeof sender.phone === 'string' && sender.phone.trim()
          ? sender.phone.trim()
          : undefined;

      // Download images/audio/video/docs for AI vision/ASR/text; CRM re-fetches via gramjs: fileId.
      let mediaBase64: string | undefined;
      let mediaMime: string | undefined;
      const aiDownloadTypes = new Set([
        'photo',
        'sticker',
        'voice',
        'audio',
        'video',
        'document',
      ]);
      const isVideoNote = Boolean(msg.videoNote);
      if (attachment && aiDownloadTypes.has(attachment.type)) {
        const maxBytes =
          attachment.type === 'video' || attachment.type === 'document'
            ? GRAMJS_ASR_MEDIA_MAX_BYTES
            : GRAMJS_VISION_MAX_BYTES;
        const downloaded = await downloadGramjsMediaBuffer(client, msg, maxBytes);
        if (downloaded) {
          mediaBase64 = downloaded.buffer.toString('base64');
          mediaMime =
            attachment.mimeType ||
            (attachment.type === 'video'
              ? 'video/mp4'
              : attachment.type === 'voice' || attachment.type === 'audio'
                ? 'audio/ogg'
                : attachment.type === 'document'
                  ? 'application/octet-stream'
                  : 'image/jpeg');
          if (isVideoNote && !attachment.fileName) {
            attachment.fileName = 'video_note.mp4';
          }
        } else if (attachment.type === 'video') {
          // Download/size fail — still give AI a clear prompt instead of bare [видео].
          const fail = isVideoNote
            ? '[кружочек — не удалось разобрать речь. Опиши текстом, пожалуйста.]'
            : '[видео — не удалось разобрать речь. Опиши текстом, пожалуйста.]';
          const caption =
            text && !(text.startsWith('[') && text.endsWith(']')) ? text : undefined;
          text = caption ? `${caption}\n\n${fail}` : fail;
        } else if (attachment.type === 'document') {
          const name = attachment.fileName || 'document';
          const isPdf = /\.pdf$/i.test(name) || /pdf/i.test(attachment.mimeType || '');
          const isDocx =
            /\.docx$/i.test(name) ||
            /wordprocessingml/i.test(attachment.mimeType || '');
          if (isPdf || isDocx) {
            const kind = isPdf ? 'PDF' : 'DOCX';
            const fail = `[документ ${kind} — не удалось прочитать текст. Опиши текстом, пожалуйста.]`;
            const caption =
              text && !(text.startsWith('[') && text.endsWith(']')) ? text : undefined;
            text = caption ? `${caption}\n\n${fail}` : fail;
          }
        }
      }

      const bubbles = await askAiWorker({
        tenantId,
        botId,
        platformUserId: peerId,
        text,
        firstName: sender.firstName,
        username: sender.username,
        phone: phoneRaw,
        externalMessageId: String(msg.id),
        isBot: Boolean(sender.bot),
        attachments: attachment ? [attachment] : undefined,
        mediaBase64,
        mediaMime,
      });

      const sendStartedAt = new Date();
      for (const bubble of bubbles.slice(0, 4)) {
        if (!bubble.trim()) continue;
        // If client wrote again while we were sending — stop and re-ask AI.
        const conv = await prisma.conversation.findFirst({
          where: {
            tenantId,
            botInstanceId: botId,
            platformUserId: String(sender.id),
          },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        });
        if (conv) {
          const newer = await prisma.chatMessage.count({
            where: {
              conversationId: conv.id,
              role: 'user',
              createdAt: { gt: sendStartedAt },
            },
          });
          if (newer > 0) {
            console.log(
              `[gramjs] outbound aborted peer=${sender.id} — newer inbound will reply`,
            );
            return;
          }
        }
        try {
          await client.invoke(
            new Api.messages.SetTyping({
              peer: sender,
              action: new Api.SendMessageTypingAction(),
            }),
          );
        } catch {
          /* best-effort */
        }
        await sleep(Math.min(4500, Math.max(800, 600 + bubble.length * 25)));
        const sent = await client.sendMessage(sender, { message: bubble });
        if (sent?.id != null) rememberAiSent(botId, Number(sent.id));
        await sleep(3000 + Math.floor(Math.random() * 1000));
      }
    } catch (err) {
      console.error('[gramjs] inbound handler error:', err);
    }
  }, new NewMessage({}));
}

async function askAiWorker(payload: {
  tenantId: string;
  botId: string;
  platformUserId: string;
  text: string;
  firstName?: string;
  username?: string;
  /** Digits from Api.User.phone when session can see it. */
  phone?: string;
  externalMessageId?: string;
  isBot?: boolean;
  attachments?: GramjsAttachment[];
  /** Optional image bytes for AI vision (photo/sticker). */
  mediaBase64?: string;
  mediaMime?: string;
}): Promise<string[]> {
  const res = await fetchWithTimeout(`${AI_WORKER_URL}/internal/inbound`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${AI_WORKER_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, channel: 'telegram_gramjs' }),
    timeout: 15000,
  });
  if (!res.ok) {
    console.error('[gramjs] AI worker HTTP', res.status, await res.text().catch(() => ''));
    return [];
  }
  const data = (await res.json()) as { ok?: boolean; bubbles?: string[]; skipped?: string };
  if (!data.ok || data.skipped) {
    if (data.skipped) console.log(`[gramjs] AI skipped: ${data.skipped}`);
    return data.bubbles || [];
  }
  return data.bubbles || [];
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function resolvePeerEntity(client: TelegramClient, peerUserId: string) {
  try {
    return await client.getEntity(peerUserId);
  } catch {
    try {
      return await client.getEntity(Number(peerUserId));
    } catch {
      return null;
    }
  }
}

type GramjsUserProfile = {
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  about?: string;
  /** ISO date YYYY-MM-DD when year known; else null (day/month only not stored). */
  birthday?: string;
  birthdayDay?: number;
  birthdayMonth?: number;
  birthdayYear?: number;
  /** t.me link for personal channel when visible. */
  personalChannelUrl?: string;
};

function formatBirthdayIso(raw: unknown): {
  birthday?: string;
  birthdayDay?: number;
  birthdayMonth?: number;
  birthdayYear?: number;
} {
  if (!raw || typeof raw !== 'object') return {};
  const day = Number((raw as { day?: unknown }).day);
  const month = Number((raw as { month?: unknown }).month);
  const yearRaw = (raw as { year?: unknown }).year;
  const year =
    yearRaw == null || yearRaw === ''
      ? undefined
      : Number(yearRaw);
  if (!Number.isFinite(day) || !Number.isFinite(month) || day < 1 || month < 1) {
    return {};
  }
  const out: {
    birthday?: string;
    birthdayDay?: number;
    birthdayMonth?: number;
    birthdayYear?: number;
  } = {
    birthdayDay: day,
    birthdayMonth: month,
  };
  if (year != null && Number.isFinite(year) && year >= 1900 && year <= 2100) {
    out.birthdayYear = year;
    out.birthday = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return out;
}

/** MTProto users.GetFullUser — phone/about/birthday when privacy allows (contacts). */
async function fetchUserFullProfile(
  client: TelegramClient,
  opts: { userId?: string; username?: string },
): Promise<GramjsUserProfile | null> {
  const username = opts.username?.replace(/^@/, '').trim();
  const userId = opts.userId?.trim();
  if (!username && !userId) return null;

  let entity: unknown = null;
  if (username) {
    try {
      entity = await client.getEntity(username);
    } catch {
      try {
        entity = await client.getEntity(`@${username}`);
      } catch {
        entity = null;
      }
    }
  }
  if (!entity && userId) {
    entity = await resolvePeerEntity(client, userId);
  }
  if (!(entity instanceof Api.User) || entity.bot) return null;

  let fullUser: any = null;
  try {
    const input = await client.getInputEntity(entity);
    const res: any = await client.invoke(new Api.users.GetFullUser({ id: input }));
    fullUser = res?.fullUser ?? null;
  } catch (err) {
    console.warn(
      `[gramjs] GetFullUser failed user=${entity.id}: ${String((err as Error)?.message || err)}`,
    );
  }

  const phoneRaw =
    typeof entity.phone === 'string' && entity.phone.trim()
      ? entity.phone.trim()
      : undefined;
  const about =
    typeof fullUser?.about === 'string' && fullUser.about.trim()
      ? fullUser.about.trim()
      : undefined;
  const bday = formatBirthdayIso(fullUser?.birthday);

  let personalChannelUrl: string | undefined;
  const channelId = fullUser?.personalChannelId;
  if (channelId != null) {
    try {
      const ch = await client.getEntity(channelId);
      const uname =
        ch && typeof (ch as { username?: string }).username === 'string'
          ? (ch as { username: string }).username
          : undefined;
      if (uname) personalChannelUrl = `https://t.me/${uname}`;
    } catch {
      /* privacy / not in dialogs */
    }
  }

  return {
    userId: String(entity.id),
    username: extractTelegramUsername(entity) || entity.username || undefined,
    firstName: entity.firstName || undefined,
    lastName: entity.lastName || undefined,
    phone: phoneRaw,
    about,
    ...bday,
    personalChannelUrl,
  };
}

/** Prefer Api.User.username; fall back to active entry in usernames[]. */
function extractTelegramUsername(user: Api.User): string | undefined {
  const direct = String(user.username || '').trim().replace(/^@/, '');
  if (direct && /^[A-Za-z0-9_]{5,}$/.test(direct)) return direct;
  const list = (user as { usernames?: Array<{ username?: string; active?: boolean }> })
    .usernames;
  if (Array.isArray(list)) {
    const active =
      list.find((u) => u?.active !== false && u?.username) || list.find((u) => u?.username);
    const fromList = String(active?.username || '')
      .trim()
      .replace(/^@/, '');
    if (fromList && /^[A-Za-z0-9_]{5,}$/.test(fromList)) return fromList;
  }
  return undefined;
}

/**
 * Resolve Telegram account by phone (contacts.ImportContacts).
 * Returns @username when available — never invents t.me/+{phone}.
 * `keepContact`: leave in address book (needed before sendMessage; default cleans up).
 */
async function resolveUserByPhone(
  client: TelegramClient,
  phoneRaw: string,
  opts?: { keepContact?: boolean },
): Promise<{
  exists: boolean;
  userId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  about?: string;
  birthday?: string;
  personalChannelUrl?: string;
} | null> {
  const digits = String(phoneRaw || '').replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  const phone = `+${digits}`;
  try {
    const imported: any = await client.invoke(
      new Api.contacts.ImportContacts({
        contacts: [
          new Api.InputPhoneContact({
            clientId: generateRandomLong(),
            phone,
            firstName: 'Voxly',
            lastName: 'Check',
          }),
        ],
      }),
    );
    const users: any[] = Array.isArray(imported?.users) ? imported.users : [];
    let user = users.find((u) => u instanceof Api.User && !u.bot) as Api.User | undefined;
    if (!user) {
      // Some layers put only userId on imported[] — resolve entity for username.
      const importedRows: any[] = Array.isArray(imported?.imported)
        ? imported.imported
        : [];
      const userId = importedRows[0]?.userId;
      if (userId != null) {
        try {
          const entity = await client.getEntity(userId);
          if (entity instanceof Api.User && !entity.bot) user = entity;
        } catch {
          /* ignore */
        }
      }
    }
    if (!(user instanceof Api.User) || user.bot) {
      return { exists: false, phone: digits };
    }

    let username = extractTelegramUsername(user);
    // Refresh entity before DeleteContacts — username sometimes filled on getEntity.
    if (!username) {
      try {
        const fresh = await client.getEntity(user);
        if (fresh instanceof Api.User) {
          username = extractTelegramUsername(fresh);
          user = fresh;
        }
      } catch {
        /* ignore */
      }
    }

    // ImportContacts temporarily overlays User.firstName/lastName with our probe
    // ("Voxly"/"Check"). Delete the contact first, then GetFullUser for real ФИО.
    // When keepContact (send path), skip profile names — access_hash must remain.
    if (!opts?.keepContact) {
      try {
        const input = await client.getInputEntity(user);
        await client.invoke(new Api.contacts.DeleteContacts({ id: [input] }));
      } catch {
        /* ignore */
      }
    }

    let firstName: string | undefined;
    let lastName: string | undefined;
    let about: string | undefined;
    let birthday: string | undefined;
    let personalChannelUrl: string | undefined;
    if (!opts?.keepContact) {
      try {
        const full = await fetchUserFullProfile(client, {
          userId: String(user.id),
          username,
        });
        if (full) {
          username = full.username || username;
          const fn = String(full.firstName || '').trim();
          const ln = String(full.lastName || '').trim();
          const probe = /^voxly$/i.test(fn) && /^check$/i.test(ln);
          if (!probe) {
            firstName = fn || undefined;
            lastName = ln || undefined;
          }
          about = full.about;
          birthday = full.birthday;
          personalChannelUrl = full.personalChannelUrl;
        }
      } catch {
        /* ignore — still return userId */
      }
    }
    return {
      exists: true,
      userId: String(user.id),
      username,
      firstName,
      lastName,
      phone: typeof user.phone === 'string' && user.phone ? user.phone : digits,
      about,
      birthday,
      personalChannelUrl,
    };
  } catch (err) {
    console.warn(
      `[gramjs] ImportContacts phone=${phone} failed: ${String((err as Error)?.message || err)}`,
    );
    return null;
  }
}

/** Contact online / last-seen from MTProto User.status (privacy-respecting). */
function serializeUserPresence(entity: unknown): {
  online: boolean;
  lastSeenAt: string | null;
  approx: 'recently' | 'last_week' | 'last_month' | null;
} | null {
  if (!(entity instanceof Api.User) || entity.bot) return null;
  const status = entity.status;
  if (!status) return null;
  if (status instanceof Api.UserStatusOnline) {
    return { online: true, lastSeenAt: null, approx: null };
  }
  if (status instanceof Api.UserStatusOffline) {
    const raw = status.wasOnline as unknown;
    let ms: number | null = null;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      ms = raw > 1e12 ? raw : raw * 1000;
    } else if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
      ms = raw.getTime();
    }
    return {
      online: false,
      lastSeenAt: ms != null ? new Date(ms).toISOString() : null,
      approx: null,
    };
  }
  if (status instanceof Api.UserStatusRecently) {
    return { online: false, lastSeenAt: null, approx: 'recently' };
  }
  if (status instanceof Api.UserStatusLastWeek) {
    return { online: false, lastSeenAt: null, approx: 'last_week' };
  }
  if (status instanceof Api.UserStatusLastMonth) {
    return { online: false, lastSeenAt: null, approx: 'last_month' };
  }
  return null;
}

async function startQrLogin(
  tenantId: string,
  name: string,
): Promise<{ botId: string; addonActive: boolean }> {
  if (!API_ID || !API_HASH) {
    throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH required');
  }
  const addonActive = await softCheckAddon(tenantId);
  const bot = await ensureBotInstance(tenantId, name);
  const key = `${tenantId}:${name}`;

  // Reuse existing session if still valid
  if (bot.botTokenEncrypted) {
    try {
      const client = await loadClient(bot.id);
      if (client) {
        const me = await client.getMe();
        if (me instanceof Api.User) {
          const user = {
            id: String(me.id),
            username: me.username,
            firstName: me.firstName,
          };
          await prisma.botInstance
            .update({
              where: { id: bot.id },
              data: { isPremium: me.premium === true },
            })
            .catch(() => undefined);
          qrState.set(key, { status: 'authorized', user, botId: bot.id, tenantId });
          return { botId: bot.id, addonActive };
        }
      }
    } catch {
      // fall through to new QR
    }
  }

  qrState.set(key, { status: 'preparing', botId: bot.id, tenantId });

  void (async () => {
    const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
      connectionRetries: 5,
    });
    try {
      await client.connect();
      await client.signInUserWithQrCode(
        { apiId: API_ID, apiHash: API_HASH },
        {
          qrCode: async ({ token }) => {
            const url = `tg://login?token=${token.toString('base64url')}`;
            qrState.set(key, {
              status: 'qr_ready',
              url,
              botId: bot.id,
              tenantId,
            });
            console.log(`[gramjs] QR ready for ${key}`);
          },
          password: async () =>
            new Promise<string>((resolve) => {
              qrState.set(key, {
                status: 'waiting_password',
                resolvePassword: resolve,
                botId: bot.id,
                tenantId,
              });
            }),
          onError: async (err) => {
            qrState.set(key, {
              status: 'error',
              err: String((err as Error)?.message || err),
              botId: bot.id,
              tenantId,
            });
            return true;
          },
        },
      );

      const me = await client.getMe();
      if (!(me instanceof Api.User)) throw new Error('Unexpected getMe result');
      const user = {
        id: String(me.id),
        username: me.username,
        firstName: me.firstName,
        premium: me.premium === true,
      };
      const sessionStr = client.session.save() as unknown as string;
      await persistSession(bot.id, sessionStr, user);
      clients.set(bot.id, client);
      attachInboundHandler(client, tenantId, bot.id);
      void relinkOrphanedGramjsConversations(tenantId, bot.id);
      void syncAudienceFromDialogs(client, tenantId, bot.id);
      void notifySaasCrmEnrichOnConnect(tenantId, bot.id);
      qrState.set(key, { status: 'authorized', user, botId: bot.id, tenantId });
      console.log(`[gramjs] authorized ${key} as @${user.username || user.id}`);
    } catch (e) {
      qrState.set(key, {
        status: 'error',
        err: String((e as Error)?.message || e),
        botId: bot.id,
        tenantId,
      });
      try {
        await client.disconnect();
      } catch {
        /* ignore */
      }
    }
  })();

  return { botId: bot.id, addonActive };
}

async function restoreActiveSessions() {
  const bots = await prisma.botInstance.findMany({
    where: {
      botType: 'ai_gramjs',
      status: 'active',
      botTokenEncrypted: { not: null },
    },
  });
  for (const bot of bots) {
    try {
      await loadClient(bot.id);
      console.log(`[gramjs] restored session bot=${bot.id} tenant=${bot.tenantId}`);
    } catch (err) {
      console.warn(`[gramjs] restore failed bot=${bot.id}`, err);
    }
  }
}

async function deleteAccount(tenantId: string, botId: string) {
  const bot = await prisma.botInstance.findFirst({
    where: { id: botId, tenantId, botType: 'ai_gramjs' },
  });
  if (!bot) {
    return { status: 404, body: { ok: false, error: 'account not found' } };
  }

  const client = clients.get(botId);
  if (client) {
    try {
      await client.invoke(new Api.auth.LogOut());
    } catch {
      /* already logged out / offline */
    }
    try {
      await client.disconnect();
    } catch {
      /* ignore */
    }
    clients.delete(botId);
  }
  handlersAttached.delete(botId);
  aiSentIds.delete(botId);
  audienceSyncing.delete(botId);
  for (const [key, state] of qrState.entries()) {
    if (state.botId === botId) qrState.delete(key);
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
    body: { ok: true, botId: bot.id, sessionCleared: true },
  };
}

async function main() {
  if (!resolveServiceToken('gramjs-bridge')) {
    console.warn('[gramjs] no service token set (VOXLY_TOKEN_GRAMJS_BRIDGE / VOXLY_SERVICE_TOKEN) — all routes will 401');
  }
  if (!API_ID || !API_HASH) {
    console.warn('[gramjs] TELEGRAM_API_ID/HASH missing — QR login disabled until set');
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    const path = url.pathname;

    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200);
      res.end('ok');
      return;
    }

    if (!requireAuth(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    try {
      if (req.method === 'POST' && path === '/auth/qr/start') {
        const body = await readJson(req);
        const tenantId = String(body.tenantId || '').trim();
        const name = String(body.name || 'default').trim();
        if (!tenantId) {
          sendJson(res, 400, { ok: false, error: 'tenantId required' });
          return;
        }
        const { botId, addonActive } = await startQrLogin(tenantId, name);
        const key = `${tenantId}:${name}`;
        const s = qrState.get(key);
        sendJson(res, 200, {
          ok: true,
          botId,
          name,
          status: s?.status || 'preparing',
          user: s?.user,
          addonActive,
          billingWarning: addonActive
            ? null
            : `Тариф «Личный Telegram» (${PRICING.AI_GRAMJS_MONTHLY} ₽/мес) ещё не оплачен — подключение работает в soft-режиме.`,
        });
        return;
      }

      if (req.method === 'GET' && path === '/auth/qr/status') {
        const tenantId = url.searchParams.get('tenantId') || '';
        const name = url.searchParams.get('name') || 'default';
        const key = `${tenantId}:${name}`;
        const s = qrState.get(key) || { status: 'unknown' };
        sendJson(res, 200, {
          ok: true,
          name,
          botId: s.botId,
          status: s.status,
          qr: s.url || null,
          error: s.err || null,
          user: s.user || null,
        });
        return;
      }

      if (req.method === 'GET' && path === '/auth/qr/png') {
        const tenantId = url.searchParams.get('tenantId') || '';
        const name = url.searchParams.get('name') || 'default';
        const s = qrState.get(`${tenantId}:${name}`);
        if (!s?.url || s.status !== 'qr_ready') {
          sendJson(res, 404, { ok: false, error: 'qr not ready' });
          return;
        }
        const png = await QRCode.toBuffer(s.url, { type: 'png', width: 256, margin: 1 });
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
        res.end(png);
        return;
      }

      if (req.method === 'POST' && path === '/auth/qr/password') {
        const body = await readJson(req);
        const tenantId = String(body.tenantId || '').trim();
        const name = String(body.name || 'default').trim();
        const password = String(body.password || '');
        const s = qrState.get(`${tenantId}:${name}`);
        if (!s?.resolvePassword) {
          sendJson(res, 400, { ok: false, error: 'not waiting for password' });
          return;
        }
        s.resolvePassword(password);
        qrState.set(`${tenantId}:${name}`, { ...s, status: 'processing_password' });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && path === '/sessions/connect') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        if (!botId) {
          sendJson(res, 400, { ok: false, error: 'botId required' });
          return;
        }
        const client = await loadClient(botId);
        if (client?.connected) {
          const bot = await prisma.botInstance.findUnique({
            where: { id: botId },
            select: { tenantId: true },
          });
          if (bot?.tenantId) {
            void notifySaasCrmEnrichOnConnect(bot.tenantId, botId);
          }
        }
        sendJson(res, client ? 200 : 404, {
          ok: !!client,
          botId,
          connected: !!client?.connected,
        });
        return;
      }

      if (req.method === 'POST' && path === '/accounts/delete') {
        const body = await readJson(req);
        const tenantId = String(body.tenantId || '').trim();
        const botId = String(body.botId || '').trim();
        if (!tenantId || !botId) {
          sendJson(res, 400, { ok: false, error: 'tenantId and botId required' });
          return;
        }
        const result = await deleteAccount(tenantId, botId);
        sendJson(res, result.status, result.body);
        return;
      }

      // Full Telegram profile (phone / about / birthday) when session can see it.
      if (req.method === 'POST' && path === '/users/full') {
        const body = await readJson(req);
        let botId = String(body.botId || '').trim();
        const tenantId = String(body.tenantId || '').trim();
        const userId = String(body.userId || body.telegramUserId || '').trim();
        const username = String(body.username || '').trim().replace(/^@/, '');
        if (!botId && tenantId) {
          const bot = await prisma.botInstance.findFirst({
            where: {
              tenantId,
              botType: 'ai_gramjs',
              status: 'active',
              botTokenEncrypted: { not: null },
            },
            orderBy: { updatedAt: 'desc' },
          });
          botId = bot?.id || '';
        }
        if (!botId) {
          sendJson(res, 404, {
            ok: false,
            error: 'no_gramjs_session',
            hint: 'Connect personal Telegram (ai_gramjs) for this tenant',
          });
          return;
        }
        if (!userId && !username) {
          sendJson(res, 400, {
            ok: false,
            error: 'userId or username required',
          });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        const profile = await fetchUserFullProfile(client, { userId, username });
        if (!profile) {
          sendJson(res, 404, { ok: false, error: 'user not found' });
          return;
        }
        sendJson(res, 200, { ok: true, botId, profile });
        return;
      }

      // Resolve Telegram user by phone (ImportContacts) — WA/form enrich → Person.telegram.
      if (req.method === 'POST' && path === '/users/by-phone') {
        const body = await readJson(req);
        let botId = String(body.botId || '').trim();
        const tenantId = String(body.tenantId || '').trim();
        const phone = String(body.phone || body.phoneE164 || '').trim();
        if (!botId && tenantId) {
          const bot = await prisma.botInstance.findFirst({
            where: {
              tenantId,
              botType: 'ai_gramjs',
              status: 'active',
              botTokenEncrypted: { not: null },
            },
            orderBy: { updatedAt: 'desc' },
          });
          botId = bot?.id || '';
        }
        if (!botId) {
          sendJson(res, 404, {
            ok: false,
            error: 'no_gramjs_session',
            hint: 'Connect personal Telegram (ai_gramjs) for this tenant',
          });
          return;
        }
        if (!phone) {
          sendJson(res, 400, { ok: false, error: 'phone required' });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        const resolved = await resolveUserByPhone(client, phone);
        if (!resolved) {
          sendJson(res, 502, { ok: false, error: 'import_contacts_failed' });
          return;
        }
        // Never invent https://t.me/+{phone} — that is not proof of a TG account.
        // Public link only when ImportContacts found a user with @username.
        const publicLink =
          resolved.exists && resolved.username
            ? `https://t.me/${resolved.username.replace(/^@/, '')}`
            : undefined;
        sendJson(res, 200, {
          ok: true,
          botId,
          exists: resolved.exists,
          username: resolved.username,
          userId: resolved.userId,
          firstName: resolved.firstName,
          lastName: resolved.lastName,
          phone: resolved.phone,
          about: resolved.about,
          birthday: resolved.birthday,
          personalChannelUrl: resolved.personalChannelUrl,
          ...(publicLink ? { link: publicLink } : {}),
        });
        return;
      }

      // Private 1:1 dialogs + recent messages for CRM import (groups/channels excluded).
      // dialogLimit <= 0 (default) = all private dialogs; messageLimit capped (default 30).
      if (req.method === 'POST' && path === '/crm/private-dialogs') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        const rawDialogLimit = Number(body.dialogLimit);
        const dialogLimit =
          Number.isFinite(rawDialogLimit) && rawDialogLimit > 0
            ? Math.floor(rawDialogLimit)
            : 0; // 0 = all private
        const messageLimit = Math.min(
          Math.max(Number(body.messageLimit) || 30, 1),
          80,
        );
        if (!botId) {
          sendJson(res, 400, { ok: false, error: 'botId required' });
          return;
        }
        const bot = await prisma.botInstance.findUnique({ where: { id: botId } });
        if (!bot || bot.botType !== 'ai_gramjs') {
          sendJson(res, 404, { ok: false, error: 'account not found' });
          return;
        }
        let client: TelegramClient | null = null;
        try {
          client = await loadClient(botId);
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: String((err as Error)?.message || err) || 'session not connected',
          });
          return;
        }
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        try {
          if (typeof (client as any).isUserAuthorized === 'function') {
            const authed = await (client as any).isUserAuthorized();
            if (!authed) {
              sendJson(res, 400, { ok: false, error: 'session not authorized' });
              return;
            }
          }
          const dialogs = await exportPrivateDialogsForCrm(client, {
            dialogLimit,
            messageLimit,
          });
          sendJson(res, 200, {
            ok: true,
            botId,
            dialogCount: dialogs.length,
            dialogs,
          });
        } catch (err) {
          sendJson(res, 500, {
            ok: false,
            error: String((err as Error)?.message || err),
          });
        }
        return;
      }

      // Trigger dialog → audience sync for a connected session.
      if (req.method === 'POST' && path === '/audience/sync') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        if (!botId) {
          sendJson(res, 400, { ok: false, error: 'botId required' });
          return;
        }
        const bot = await prisma.botInstance.findUnique({ where: { id: botId } });
        if (!bot || bot.botType !== 'ai_gramjs') {
          sendJson(res, 404, { ok: false, error: 'account not found' });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        const result = await syncAudienceFromDialogs(client, bot.tenantId, botId);
        sendJson(res, 200, { ok: true, botId, ...result });
        return;
      }

      // Rate-limited membership check user ∈ peer.
      if (req.method === 'POST' && path === '/audience/check-membership') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        const userId = String(body.userId || body.telegramUserId || '').trim();
        const peerId = String(body.peerId || '').trim();
        if (!botId || !userId || !peerId) {
          sendJson(res, 400, {
            ok: false,
            error: 'botId, userId, and peerId are required',
          });
          return;
        }
        const bot = await prisma.botInstance.findUnique({ where: { id: botId } });
        if (!bot || bot.botType !== 'ai_gramjs') {
          sendJson(res, 404, { ok: false, error: 'account not found' });
          return;
        }
        const result = await checkMembership({
          botId,
          userId,
          peerId,
          tenantId: bot.tenantId,
        });
        sendJson(res, result.rateLimited ? 429 : result.ok ? 200 : 400, result);
        return;
      }

      /**
       * Retry a GramJS call on FloodWaitError (waits err.seconds + jitter).
       * Rethrows after 3 attempts, or immediately when seconds > 300
       * (MAILING-LIMITS: long floods → account-level handling, not a held request).
       */
      async function withFloodRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
        let attempts = 0;
        for (;;) {
          try {
            return await fn();
          } catch (err: any) {
            if (err instanceof FloodWaitError && Number(err.seconds) > 0) {
              if (Number(err.seconds) > 300) throw err;
              attempts += 1;
              if (attempts > 3) throw err;
              const waitMs =
                Number(err.seconds) * 1000 + 1_500 + Math.floor(Math.random() * 1_500);
              console.warn(
                `[gramjs] FloodWait ${err.seconds}s ${label}, attempt=${attempts}, waiting ${waitMs}ms`,
              );
              await sleep(waitMs);
              continue;
            }
            throw err;
          }
        }
      }

      // Operator / CRM reply via personal account (MTProto).
      // Caller (saas-api) persists ChatMessage + pause; we mark id so NewMessage
      // does not treat this as a phone-typed human outbound (double-write).
      if (req.method === 'POST' && path === '/messages/send') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        const peerUserId = String(body.peerUserId || '').trim();
        const textRaw = String(body.text || '');
        const text = textRaw.trim();
        const phoneHint = String(body.phone || '').trim();
        const usernameHint = String(body.username || '')
          .trim()
          .replace(/^@/, '');
        const mediaB64 = String(body.mediaBase64 || '').trim();
        const mimeType = String(body.mimeType || 'application/octet-stream').trim();
        const fileName =
          String(body.fileName || '').trim() ||
          (mediaB64 ? 'file.bin' : '');
        if (!botId || !peerUserId || (!text && !mediaB64)) {
          sendJson(res, 400, {
            ok: false,
            error: 'botId, peerUserId, and text or mediaBase64 are required',
          });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        const resolved = await resolveSendPeer(client, peerUserId, {
          phoneHint,
          usernameHint,
        });
        if (!resolved) {
          sendJson(res, 404, {
            ok: false,
            error:
              'peer not found: нет диалога/контакта в этом Telegram-аккаунте. Нужен телефон контакта для ImportContacts или переписка с этим peer.',
          });
          return;
        }
        const { entity, peerId } = resolved;
        try {
          await client.invoke(
            new Api.messages.SetTyping({
              peer: entity,
              action: new Api.SendMessageTypingAction(),
            }),
          );
        } catch {
          /* best-effort */
        }
        await sleep(400 + Math.floor(Math.random() * 600));

        // Client MD → HTML entities (spoiler; `code` → <pre> for visible mono).
        // GramJS md delimiters omit spoiler — must use parseMode html.
        const htmlText = text ? clientMdToTelegramHtml(textRaw) : '';
        if (htmlText && htmlText !== textRaw) {
          console.log(
            `[gramjs] send format bot=${botId} peer=${peerId} ` +
              `rawLen=${textRaw.length} htmlLen=${htmlText.length} ` +
              `hasPre=${htmlText.includes('<pre>')} hasSpoiler=${htmlText.includes('<spoiler>')}`,
          );
        }
        let sent: { id?: number } | null = null;
        let attachment: GramjsAttachment | null = null;

        if (mediaB64) {
          let buf: Buffer;
          try {
            buf = Buffer.from(mediaB64.split(',').pop() || '', 'base64');
          } catch {
            sendJson(res, 400, { ok: false, error: 'invalid mediaBase64' });
            return;
          }
          if (!buf.length) {
            sendJson(res, 400, { ok: false, error: 'empty media' });
            return;
          }
          if (buf.length > OUTBOUND_MEDIA_MAX_BYTES) {
            sendJson(res, 400, {
              ok: false,
              error: `media too large (>${OUTBOUND_MEDIA_MAX_BYTES} bytes)`,
            });
            return;
          }
          const kind = classifyOutboundUpload(mimeType, fileName);
          const toUpload = new CustomFile(fileName, buf.length, '', buf);
          sent = await withFloodRetry('sendFile', () =>
            client.sendFile(entity, {
              file: toUpload,
              caption: htmlText || undefined,
              parseMode: htmlText ? 'html' : undefined,
              forceDocument: kind.forceDocument,
              voiceNote: kind.voiceNote,
              supportsStreaming: kind.supportsStreaming,
              workers: 1,
            }),
          );
          if (sent?.id != null) {
            attachment = {
              type: kind.type,
              fileId: gramjsFileId(peerId, sent.id),
              fileName,
              mimeType: mimeType || undefined,
            };
          }
        } else {
          sent = await withFloodRetry('sendMessage', () =>
            client.sendMessage(entity, {
              message: htmlText,
              parseMode: 'html',
            }),
          );
        }

        if (sent?.id != null) rememberAiSent(botId, Number(sent.id));
        sendJson(res, 200, {
          ok: true,
          botId,
          peerUserId: peerId,
          messageId: sent?.id != null ? String(sent.id) : null,
          ...(attachment ? { attachment } : {}),
        });
        return;
      }

      // CRM file preview: re-download inbound media by peer + message id.
      if (req.method === 'POST' && path === '/messages/media') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        let peerUserId = String(body.peerUserId || '').trim();
        let messageId = String(body.messageId || '').trim();
        const fileIdRaw = String(body.fileId || '').trim();
        if (fileIdRaw) {
          const parsed = parseGramjsFileId(fileIdRaw);
          if (parsed) {
            peerUserId = peerUserId || parsed.peerUserId;
            messageId = messageId || parsed.messageId;
          }
        }
        if (!botId || !peerUserId || !messageId) {
          sendJson(res, 400, {
            ok: false,
            error: 'botId, peerUserId, and messageId are required (or fileId=gramjs:…)',
          });
          return;
        }
        const msgIdNum = Number(messageId);
        if (!Number.isFinite(msgIdNum) || msgIdNum <= 0) {
          sendJson(res, 400, { ok: false, error: 'invalid messageId' });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        const entity = await resolvePeerEntity(client, peerUserId);
        if (!entity) {
          sendJson(res, 404, { ok: false, error: 'peer not found' });
          return;
        }
        let messages;
        try {
          messages = await client.getMessages(entity, { ids: msgIdNum });
        } catch (err) {
          sendJson(res, 404, {
            ok: false,
            error: `message fetch failed: ${String((err as Error)?.message || err)}`,
          });
          return;
        }
        const msg = Array.isArray(messages) ? messages[0] : null;
        if (!msg || !(msg as { id?: number }).id) {
          sendJson(res, 404, { ok: false, error: 'message not found' });
          return;
        }
        const attachment = extractGramjsAttachment(msg as any, peerUserId);
        const downloaded = await downloadGramjsMediaBuffer(
          client,
          msg as any,
          GRAMJS_CRM_MEDIA_MAX_BYTES,
        );
        if (!downloaded) {
          sendJson(res, 404, { ok: false, error: 'media not available' });
          return;
        }
        const mimeType =
          attachment?.mimeType ||
          (msg as { file?: { mimeType?: string } }).file?.mimeType ||
          'application/octet-stream';
        const fileName =
          attachment?.fileName ||
          (msg as { file?: { name?: string } }).file?.name ||
          undefined;
        sendJson(res, 200, {
          ok: true,
          botId,
          peerUserId,
          messageId: String(msgIdNum),
          type: attachment?.type || 'document',
          mimeType,
          fileName: fileName || null,
          dataBase64: downloaded.buffer.toString('base64'),
          size: downloaded.buffer.length,
        });
        return;
      }

      if (req.method === 'POST' && path === '/stories/send') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        const mediaUrl = String(body.mediaUrl || '').trim();
        const caption = String(body.text || body.caption || '').trim();
        const mediaTypeHint = String(body.mediaType || '').trim();
        const linkUrl = String(body.linkUrl || '').trim();
        const linkText = String(body.linkText || '').trim();
        if (!botId || !mediaUrl) {
          sendJson(res, 400, { ok: false, error: 'botId and mediaUrl required' });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        try {
          const mediaRes = await fetchWithTimeout(mediaUrl, { timeout: 30000 });
          if (!mediaRes.ok) {
            sendJson(res, 400, { ok: false, error: `media fetch HTTP ${mediaRes.status}` });
            return;
          }
          const buf = Buffer.from(await mediaRes.arrayBuffer());
          if (buf.length > 30 * 1024 * 1024) {
            sendJson(res, 400, { ok: false, error: 'media too large (>30MB)' });
            return;
          }
          const contentType =
            (mediaRes.headers.get('content-type') || '').split(';')[0].trim() ||
            (mediaTypeHint === 'video' ? 'video/mp4' : 'image/jpeg');
          const isVideo =
            mediaTypeHint === 'video' ||
            contentType.startsWith('video/') ||
            /\.(mp4|mov|webm)$/i.test(mediaUrl);
          const fileName = isVideo ? 'story.mp4' : 'story.jpg';
          const toUpload = new CustomFile(fileName, buf.length, '', buf);
          const uploaded = await client.uploadFile({ file: toUpload, workers: 1 });
          const media = isVideo
            ? new Api.InputMediaUploadedDocument({
                file: uploaded,
                mimeType: contentType.startsWith('video/') ? contentType : 'video/mp4',
                attributes: [
                  new Api.DocumentAttributeVideo({
                    duration: 1,
                    w: 720,
                    h: 1280,
                    supportsStreaming: true,
                  }),
                ],
              })
            : new Api.InputMediaUploadedPhoto({ file: uploaded });

          const updates = await withFloodRetry('SendStory', () =>
            client.invoke(
              new Api.stories.SendStory({
                peer: new Api.InputPeerSelf(),
                media,
                caption: caption || undefined,
                entities: linkUrl
                  ? [
                      new Api.MessageEntityTextUrl({
                        offset: 0,
                        length: (linkText || caption || '.').length,
                        url: linkUrl,
                      }),
                    ]
                  : undefined,
                privacyRules: [new Api.InputPrivacyValueAllowAll()],
                randomId: generateRandomLong(),
              }),
            ),
          );

          let storyId: number | undefined;
          if (updates instanceof Api.Updates) {
            for (const u of updates.updates) {
              if (u instanceof Api.UpdateStory && u.peer instanceof Api.PeerUser) {
                storyId = u.story.id;
              }
            }
          }

          sendJson(res, 200, { ok: true, botId, storyId, updates: Boolean(updates) });
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: String((err as Error)?.message || err),
          });
        }
        return;
      }

      // Fetch story metrics from Telegram
      if (req.method === 'GET' && path.startsWith('/stories/') && path.endsWith('/metrics')) {
        const parts = path.split('/');
        const storyId = parseInt(parts[2]);
        const botId = String(url.searchParams.get('botId') || '').trim();
        if (!botId || isNaN(storyId)) {
          sendJson(res, 400, { ok: false, error: 'botId and storyId required' });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        try {
          const storiesRes = await client.invoke(
            new Api.stories.GetPeerStories({
              peer: new Api.InputPeerSelf(),
            }),
          );
          const story = (storiesRes as any).stories.find((s: any) => s.id === storyId);
          if (!story) {
            sendJson(res, 404, { ok: false, error: 'story not found' });
            return;
          }
          sendJson(res, 200, {
            ok: true,
            views: story.views?.viewsCount || 0,
            reactions: story.reactions?.results?.reduce((acc: number, r: any) => acc + (r.count || 0), 0) || 0,
          });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: String(err) });
        }
        return;
      }

      if (req.method === 'POST' && path === '/messages/typing') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        const peerUserId = String(body.peerUserId || '').trim();
        if (!botId || !peerUserId) {
          sendJson(res, 400, { ok: false, error: 'botId and peerUserId required' });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        const entity = await resolvePeerEntity(client, peerUserId);
        if (!entity) {
          sendJson(res, 404, { ok: false, error: 'peer not found' });
          return;
        }
        await client.invoke(
          new Api.messages.SetTyping({
            peer: entity,
            action: new Api.SendMessageTypingAction(),
          }),
        );
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && path === '/messages/read') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        const peerUserId = String(body.peerUserId || '').trim();
        if (!botId || !peerUserId) {
          sendJson(res, 400, { ok: false, error: 'botId and peerUserId required' });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        const entity = await resolvePeerEntity(client, peerUserId);
        if (!entity) {
          sendJson(res, 404, { ok: false, error: 'peer not found' });
          return;
        }
        try {
          await client.invoke(
            new Api.messages.ReadHistory({
              peer: entity,
              maxId: 0,
            }),
          );
        } catch (err) {
          console.warn('[gramjs] ReadHistory failed', err);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === 'POST' && path === '/messages/peer-status') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        const peerUserId = String(body.peerUserId || '').trim();
        if (!botId || !peerUserId) {
          sendJson(res, 400, { ok: false, error: 'botId and peerUserId required' });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        const entity = await resolvePeerEntity(client, peerUserId);
        if (!entity) {
          sendJson(res, 404, { ok: false, error: 'peer not found' });
          return;
        }
        const presence = serializeUserPresence(entity);
        sendJson(res, 200, { ok: true, presence });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'not found' });
    } catch (err) {
      console.error('[gramjs] request error:', err);
      sendJson(res, 500, { ok: false, error: String((err as Error)?.message || err) });
    }
  });

  server.listen(PORT, async () => {
    console.log(`[gramjs-bridge] Listening on :${PORT}`);
    try {
      await restoreActiveSessions();
    } catch (err) {
      console.warn('[gramjs] restoreActiveSessions failed', err);
    }
    setInterval(() => {
      for (const [botId, client] of clients.entries()) {
        if (!client.connected) continue;
        void (async () => {
          try {
            const bot = await prisma.botInstance.findUnique({
              where: { id: botId },
              select: { tenantId: true },
            });
            if (!bot) return;
            await syncAudienceFromDialogs(client, bot.tenantId, botId);
          } catch (err) {
            console.warn(`[gramjs] periodic audience sync failed bot=${botId}`, err);
          }
        })();
      }
    }, AUDIENCE_SYNC_MS);
  });
}

main().catch((err) => {
  console.error('[gramjs] fatal', err);
  process.exit(1);
});
