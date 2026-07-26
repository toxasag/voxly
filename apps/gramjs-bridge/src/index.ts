// Voxly GramJS bridge — personal Telegram account sessions (QR login).
// Pattern from reference server.js; auth is Voxly-internal (Bearer VOXLY_SERVICE_TOKEN).
// Inbound text → ai-telegram-worker POST /internal/inbound → send bubbles via MTProto.

import http from 'node:http';
import { URL } from 'node:url';
import QRCode from 'qrcode';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import { prisma } from '@voxly/db';
import { encrypt, decrypt } from '@voxly/crypto';
import { PRODUCT_CODES, PRICING } from '@voxly/shared';

const PORT = Number(process.env.GRAMJS_BRIDGE_PORT || 3008);
const API_ID = Number(process.env.TELEGRAM_API_ID || process.env.API_ID || 0);
const API_HASH = String(process.env.TELEGRAM_API_HASH || process.env.API_HASH || '');
const SERVICE_TOKEN = process.env.VOXLY_SERVICE_TOKEN || '';
const AI_WORKER_URL =
  process.env.AI_TELEGRAM_WORKER_URL || 'http://ai-telegram-worker:3005';
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
  if (!SERVICE_TOKEN) return false;
  return req.headers.authorization === `Bearer ${SERVICE_TOKEN}`;
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
}) {
  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: opts.tenantId,
      botInstanceId: opts.botId,
      platformUserId: opts.platformUserId,
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!conversation) {
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

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'operator',
      content: opts.content || '[outbound]',
      externalMessageId: opts.externalMessageId,
    },
  });
  // Do NOT auto-pause AI (manual pause/off only).
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
}) {
  await prisma.botInstance.update({
    where: { id: botId },
    data: {
      botTokenEncrypted: encrypt(sessionStr),
      botUsername: me.username || me.firstName || botId,
      phoneNumberId: me.id,
      status: 'active',
    },
  });
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
  // Fire-and-forget audience sync on connect
  void syncAudienceFromDialogs(client, bot.tenantId, botId);
  return client;
}

function attachInboundHandler(client: TelegramClient, tenantId: string, botId: string) {
  if (handlersAttached.has(botId)) return;
  handlersAttached.add(botId);
  client.addEventHandler(async (event) => {
    try {
      const msg = event.message;
      if (!msg) return;

      // Own outbound: AI replies are tagged; everything else = human → 1h pause
      if (msg.out) {
        const sent = aiSentIds.get(botId);
        if (sent?.has(msg.id)) {
          sent.delete(msg.id);
          return;
        }
        const peer = await msg.getChat();
        if (peer instanceof Api.User && !peer.bot) {
          await pauseOnHumanOutbound({
            tenantId,
            botId,
            platformUserId: String(peer.id),
            content: (msg.message || '').trim() || '[media]',
            externalMessageId: String(msg.id),
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

      try {
        const chat = await msg.getChat();
        await recordInboundSighting({
          tenantId,
          botId,
          sender,
          chat: chat || null,
        });
      } catch (sightErr) {
        console.warn('[gramjs] inbound sighting failed', sightErr);
      }

      const text = (msg.message || '').trim();
      if (!text) {
        // Media on GramJS: ASR/vision stays in Bot API worker; text-only MVP here.
        console.log(`[gramjs] skip non-text from ${sender.id}`);
        return;
      }

      // Mark inbound as read immediately (blue ticks / read status).
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

      // Api.User.phone is visible when peer is in contacts / shared number (no leading +).
      const phoneRaw =
        typeof sender.phone === 'string' && sender.phone.trim()
          ? sender.phone.trim()
          : undefined;

      const bubbles = await askAiWorker({
        tenantId,
        botId,
        platformUserId: String(sender.id),
        text,
        firstName: sender.firstName,
        username: sender.username,
        phone: phoneRaw,
        externalMessageId: String(msg.id),
        isBot: Boolean(sender.bot),
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
}): Promise<string[]> {
  const res = await fetch(`${AI_WORKER_URL}/internal/inbound`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SERVICE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...payload, channel: 'telegram_gramjs' }),
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
      };
      const sessionStr = client.session.save() as unknown as string;
      await persistSession(bot.id, sessionStr, user);
      clients.set(bot.id, client);
      attachInboundHandler(client, tenantId, bot.id);
      void syncAudienceFromDialogs(client, tenantId, bot.id);
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
  if (!SERVICE_TOKEN) {
    console.warn('[gramjs] VOXLY_SERVICE_TOKEN not set — all routes will 401');
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

      // Operator / CRM reply via personal account (MTProto).
      // Caller (saas-api) persists ChatMessage + pause; we mark id so NewMessage
      // does not treat this as a phone-typed human outbound (double-write).
      if (req.method === 'POST' && path === '/messages/send') {
        const body = await readJson(req);
        const botId = String(body.botId || '').trim();
        const peerUserId = String(body.peerUserId || '').trim();
        const text = String(body.text || '').trim();
        if (!botId || !peerUserId || !text) {
          sendJson(res, 400, {
            ok: false,
            error: 'botId, peerUserId, and text are required',
          });
          return;
        }
        const client = await loadClient(botId);
        if (!client?.connected) {
          sendJson(res, 404, { ok: false, error: 'session not connected' });
          return;
        }
        let entity;
        try {
          entity = await client.getEntity(peerUserId);
        } catch {
          try {
            entity = await client.getEntity(Number(peerUserId));
          } catch (err) {
            sendJson(res, 404, {
              ok: false,
              error: `peer not found: ${String((err as Error)?.message || err)}`,
            });
            return;
          }
        }
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
        const sent = await client.sendMessage(entity, { message: text });
        if (sent?.id != null) rememberAiSent(botId, Number(sent.id));
        sendJson(res, 200, {
          ok: true,
          botId,
          peerUserId,
          messageId: sent?.id != null ? String(sent.id) : null,
        });
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
