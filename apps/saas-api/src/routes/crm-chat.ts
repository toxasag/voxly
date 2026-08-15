// CRM chat: messages + formatted reply + media by Twenty Opportunity or Person id
// Auth: portal JWT or short-lived crm-chat JWT from /api/tenant/crm-login
// Also: GiftSubscriber (gift bot) OR Conversation (ai_tg / ai_gramjs) CRM links.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import pg from 'pg';
import { z } from 'zod';
import { decrypt } from '@voxly/crypto';
import {
  clientMdToMarkdownV2,
  AI_HANDOFF_PAUSE_MS,
  readCrmThreadCache,
  writeCrmThreadCache,
  readCrmUnreadCache,
  writeCrmUnreadCache,
  invalidateCrmUnreadCache,
  claimCrmReadDebounce,
  resolveServiceToken,
} from '@voxly/shared';
import IORedis from 'ioredis';
import {
  TwentyClient,
  normalizePhoneToE164,
  parseTelegramPeerFromLink,
  phoneFingerprint,
} from '@voxly/twenty-client';
import { enqueueTimelineSync } from '@voxly/ai-core';
import { resolveTwentyOperatorLabel } from '../services/twenty-member-display-names.js';
import { assertCrmAccessAllowed } from '../services/crm-access.js';
import { runCrmSaveDedupe } from '../services/crm-deal-dedupe.js';

/** Dedicated Redis client for the CRM thread-list cache (Phase 2.2). Lazy — never blocks route boot. */
const CRM_CACHE_REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const crmCacheRedis = new IORedis(CRM_CACHE_REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});

/** Browser-reachable API origin for CRM media <video>/<audio>/<img> src (bypasses Twenty /s JSON size cap). */
function publicApiBase(): string {
  return (
    process.env.VOXLY_PUBLIC_API_URL ||
    process.env.PUBLIC_API_URL ||
    `https://api.${process.env.VOXLY_DOMAIN || 'getvoxly.ru'}`
  ).replace(/\/$/, '');
}

const MEDIA_URL_TTL_SEC = 60 * 60; // 1h

type MediaTokenPayload = {
  v: 1;
  tenantId: string;
  recordId: string;
  fileId: string;
  botId: string;
  exp: number;
};

function mediaSigningSecret(): string {
  return (
    process.env.JWT_SECRET ||
    process.env.VOXLY_SERVICE_TOKEN ||
    'dev-secret-change-me'
  );
}

function mintMediaToken(opts: {
  tenantId: string;
  recordId: string;
  fileId: string;
  botId: string;
}): string {
  const payload: MediaTokenPayload = {
    v: 1,
    tenantId: opts.tenantId,
    recordId: opts.recordId,
    fileId: opts.fileId,
    botId: opts.botId,
    exp: Math.floor(Date.now() / 1000) + MEDIA_URL_TTL_SEC,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', mediaSigningSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

function verifyMediaToken(token: string): MediaTokenPayload | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!body || !sig) return null;
  const expected = createHmac('sha256', mediaSigningSecret())
    .update(body)
    .digest('base64url');
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf8'),
    ) as MediaTokenPayload;
    if (payload.v !== 1) return null;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (
      !payload.tenantId ||
      !payload.recordId ||
      !payload.fileId ||
      !payload.botId
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

type ChatAttachment = {
  type: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker' | 'animation';
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

/** Unified CRM ↔ chat link (gift lead or Conversation: ai_tg / ai_gramjs / ai_wa). */
type CrmChatTarget = {
  source: 'gift_subscriber' | 'conversation';
  telegramId: string;
  username: string | null;
  firstName: string | null;
  conversationId: string | null;
  twentyPersonId: string | null;
  twentyOpportunityId: string | null;
  botInstanceId: string;
  giftSubscriberId: string | null;
  businessConnectionId: string | null;
  updatedAt: Date;
};

type CrmChatThreadMeta = {
  id: string;
  source: 'gift_subscriber' | 'conversation';
  conversationId: string | null;
  giftSubscriberId: string | null;
  botId: string;
  botType: string | null;
  channel: string;
  channelLabel: string;
  identityLabel: string;
  peerLabel: string;
};

function channelMeta(opts: {
  botType: string | null;
  botUsername: string | null;
  displayName: string | null;
  phoneNumberId: string | null;
  channel: string | null;
  peerUsername: string | null;
  peerFirstName: string | null;
  peerId: string;
}): { channelKind: string; channelLabel: string; identityLabel: string; peerLabel: string } {
  const botType = opts.botType;
  const channelKind =
    botType === 'ai_gramjs'
      ? 'telegram_gramjs'
      : botType === 'ai_max'
        ? 'max_personal'
        : botType === 'ai_tg'
          ? 'telegram_business'
          : botType === 'ai_wa'
            ? 'whatsapp'
            : botType === 'gift'
              ? 'telegram_gift'
              : botType === 'gift_max'
                ? 'max_gift'
                : opts.channel || 'telegram';
  const channelLabel =
    channelKind === 'telegram_gramjs'
      ? 'Telegram · личный аккаунт'
      : channelKind === 'max_personal'
        ? 'MAX · личный'
        : channelKind === 'telegram_business'
          ? 'Telegram · Business-бот'
          : channelKind === 'whatsapp'
            ? 'WhatsApp'
            : channelKind === 'telegram_gift'
              ? 'Telegram · бот подарков'
              : channelKind === 'max_gift'
                ? 'MAX · бот подарков'
                : 'Telegram';
  let identityLabel = 'бот';
  if (botType === 'ai_wa') {
    identityLabel =
      opts.displayName ||
      (opts.phoneNumberId ? `+${opts.phoneNumberId}` : null) ||
      opts.botUsername ||
      'WhatsApp';
  } else if (botType === 'ai_gramjs') {
    identityLabel =
      opts.displayName ||
      (opts.botUsername ? `@${opts.botUsername}` : null) ||
      opts.phoneNumberId ||
      'личный аккаунт';
  } else if (botType === 'ai_max') {
    identityLabel =
      opts.displayName ||
      opts.botUsername ||
      opts.phoneNumberId ||
      'личный MAX';
  } else if (opts.botUsername) {
    identityLabel = `@${opts.botUsername}`;
  }
  const peerRaw = opts.peerUsername
    ? `@${opts.peerUsername}`
    : opts.peerFirstName || opts.peerId;
  // WA LID digits in peer id look like a phone — don't surface raw 14–16 digit LIDs as label.
  const peerLooksLikeLid =
    !opts.peerUsername &&
    !opts.peerFirstName &&
    /^\d{14,16}$/.test(String(opts.peerId || ''));
  const peerLabel = peerLooksLikeLid ? 'WhatsApp' : peerRaw;
  return { channelKind, channelLabel, identityLabel, peerLabel };
}

async function listCrmChatTargets(
  prisma: FastifyInstance['prisma'],
  tenantId: string,
  recordId: string,
  extraPersonIds: string[] = [],
): Promise<CrmChatTarget[]> {
  const personOr = [
    { twentyOpportunityId: recordId },
    { twentyPersonId: recordId },
    ...extraPersonIds
      .filter((id) => id && id !== recordId)
      .map((id) => ({ twentyPersonId: id })),
  ];

  const subscribers = await prisma.giftSubscriber.findMany({
    where: {
      tenantId,
      OR: personOr,
    },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: 20,
  });

  // Fast-path (Phase 2.1): CrmRecordLink maps conversationId → CRM record via a
  // dedicated tenant+person/opp index. Pull matching conversation ids so threads
  // are found even when Conversation.twentyPersonId was later cleared. The direct
  // scan below stays as fallback for rows without a link (pre-backfill).
  const linkOr = [
    { twentyOpportunityId: recordId },
    { twentyPersonId: recordId },
    ...extraPersonIds
      .filter((id) => id && id !== recordId)
      .map((id) => ({ twentyPersonId: id })),
  ];
  let linkedConvIds: string[] = [];
  try {
    const links = await prisma.crmRecordLink.findMany({
      where: { tenantId, OR: linkOr },
      select: { conversationId: true },
      take: 60,
    });
    linkedConvIds = [...new Set(links.map((l) => l.conversationId))];
  } catch {
    /* CrmRecordLink unavailable (pre-migration) — rely on direct scan below. */
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      channel: { not: 'telegram_business_account' },
      OR: linkedConvIds.length
        ? [...personOr, { id: { in: linkedConvIds } }]
        : personOr,
    },
    include: { _count: { select: { messages: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 40,
  });

  // Prefer threads that actually have ChatMessages (empty contact-book shells last).
  conversations.sort((a, b) => {
    const msgDelta = (b._count.messages || 0) - (a._count.messages || 0);
    if (msgDelta !== 0) return msgDelta;
    return b.updatedAt.getTime() - a.updatedAt.getTime();
  });

  // Orphaned threads (bot deleted/reconnected) still have messages — resolve a fallback bot.
  const fallbackBot =
    conversations.some((c) => !c.botInstanceId)
      ? await prisma.botInstance.findFirst({
          where: {
            tenantId,
            status: 'active',
            botType: { in: ['ai_gramjs', 'ai_tg', 'ai_wa', 'ai_max'] },
          },
          orderBy: { updatedAt: 'desc' },
          select: { id: true },
        })
      : null;

  const giftConvIds = new Set(
    subscribers.map((s) => s.conversationId).filter((id): id is string => Boolean(id)),
  );

  const targets: CrmChatTarget[] = [];
  for (const subscriber of subscribers) {
    targets.push({
      source: 'gift_subscriber',
      telegramId: subscriber.telegramId,
      username: subscriber.username,
      firstName: subscriber.firstName,
      conversationId: subscriber.conversationId,
      twentyPersonId: subscriber.twentyPersonId,
      twentyOpportunityId: subscriber.twentyOpportunityId,
      botInstanceId: subscriber.botInstanceId,
      giftSubscriberId: subscriber.id,
      businessConnectionId: null,
      updatedAt: subscriber.lastMessageAt || subscriber.updatedAt,
    });
  }
  for (const conversation of conversations) {
    const botInstanceId = conversation.botInstanceId || fallbackBot?.id || null;
    if (!botInstanceId) continue;
    // Avoid duplicating gift-owned conversation rows
    if (giftConvIds.has(conversation.id)) continue;

    // Backfill opportunity link when we found the thread via Person on this deal.
    if (
      !conversation.twentyOpportunityId &&
      conversation.twentyPersonId &&
      extraPersonIds.includes(conversation.twentyPersonId)
    ) {
      try {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { twentyOpportunityId: recordId },
        });
        conversation.twentyOpportunityId = recordId;
      } catch {
        /* ignore */
      }
    }

    targets.push({
      source: 'conversation',
      telegramId: conversation.platformUserId,
      username: conversation.platformUsername,
      firstName: conversation.platformFirstName,
      conversationId: conversation.id,
      twentyPersonId: conversation.twentyPersonId,
      twentyOpportunityId: conversation.twentyOpportunityId || recordId,
      botInstanceId,
      giftSubscriberId: null,
      businessConnectionId: conversation.businessConnectionId,
      updatedAt: conversation.updatedAt,
    });
  }

  targets.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

  // One pill per channel identity (gift bot / Business peer / WA·GramJS peer).
  // Business must include peer id — collapsing by connection alone hid other
  // customers' threads behind one empty chip (INC-055).
  const seen = new Set<string>();
  const deduped: CrmChatTarget[] = [];
  for (const t of targets) {
    let key: string;
    if (t.source === 'gift_subscriber') {
      key = `gift:${t.botInstanceId}`;
    } else if (t.businessConnectionId) {
      key = `biz:${t.botInstanceId}:${t.businessConnectionId}:${t.telegramId}`;
    } else {
      key = `peer:${t.botInstanceId}:${t.telegramId}`;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(t);
  }
  return deduped;
}

/** Resolve Person ids for an Opportunity so Chat tab finds threads linked only by person. */
async function resolveExtraPersonIdsForRecord(
  prisma: FastifyInstance['prisma'],
  tenantId: string,
  recordId: string,
): Promise<string[]> {
  const ids = new Set<string>();

  // Already-linked control rows (person on same deal).
  const linked = await prisma.conversation.findMany({
    where: {
      tenantId,
      twentyOpportunityId: recordId,
      twentyPersonId: { not: null },
    },
    select: { twentyPersonId: true },
    take: 20,
  });
  for (const row of linked) {
    if (row.twentyPersonId) ids.add(row.twentyPersonId);
  }
  const gifts = await prisma.giftSubscriber.findMany({
    where: {
      tenantId,
      twentyOpportunityId: recordId,
      twentyPersonId: { not: null },
    },
    select: { twentyPersonId: true },
    take: 20,
  });
  for (const row of gifts) {
    if (row.twentyPersonId) ids.add(row.twentyPersonId);
  }

  // Twenty Opportunity.pointOfContact — covers GramJS/WA deals where Conversation
  // only stored twentyPersonId (Chat tab «Нет данных» on Opportunity).
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  try {
    const owner = await prisma.tenantMember.findFirst({
      where: { tenantId, role: 'owner' },
      include: { user: true },
    });
    if (
      tenant?.twentyWorkspaceId &&
      tenant.twentyOwnerPasswordEncrypted &&
      owner?.user?.email
    ) {
      const client = new TwentyClient({
        apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
      });
      await client.authenticateWorkspace(
        owner.user.email,
        decrypt(tenant.twentyOwnerPasswordEncrypted),
        tenant.twentyWorkspaceId,
      );
      const personId = await client.getOpportunityPointOfContactId(recordId);
      if (personId) ids.add(personId);
    }
  } catch {
    /* GraphQL optional — SQL fallback below */
  }

  // SQL fallback when GraphQL shape differs / auth flakes (INC-097).
  if (tenant?.twentyWorkspaceId) {
    try {
      const fromSql = await resolvePointOfContactFromTwentyDb(
        tenant.twentyWorkspaceId,
        recordId,
      );
      if (fromSql) ids.add(fromSql);
    } catch {
      /* soft empty still OK */
    }
  }

  return [...ids];
}

async function resolvePointOfContactFromTwentyDb(
  workspaceId: string,
  opportunityId: string,
): Promise<string | null> {
  const pool = twentyPersonPgPool();
  if (!pool || !workspaceId || !opportunityId) return null;
  try {
    const ws = await pool.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return null;
    const row = await pool.query<{ pointOfContactId: string | null }>(
      `SELECT "pointOfContactId" FROM "${schema}".opportunity
       WHERE id = $1::uuid AND "deletedAt" IS NULL
       LIMIT 1`,
      [opportunityId],
    );
    const id = row.rows[0]?.pointOfContactId;
    return id ? String(id) : null;
  } catch {
    return null;
  }
}

/**
 * Read Person.whatsapp (+E.164) from Twenty workspace DB.
 * Used to allow CRM «Пишем от: WhatsApp» when the field is already filled —
 * never invents WA from phone alone.
 */
async function resolvePersonWhatsappFromTwentyDb(
  workspaceId: string,
  personId: string,
): Promise<string | null> {
  const pool = twentyPersonPgPool();
  if (!pool || !workspaceId || !personId) return null;
  try {
    const ws = await pool.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return null;
    const row = await pool.query<{
      whatsapp: string | null;
      whatsappPrimaryLinkUrl: string | null;
    }>(
      `SELECT
         whatsapp,
         "whatsappPrimaryLinkUrl" AS "whatsappPrimaryLinkUrl"
       FROM "${schema}".person
       WHERE id = $1::uuid AND "deletedAt" IS NULL
       LIMIT 1`,
      [personId],
    );
    const raw = row.rows[0]?.whatsappPrimaryLinkUrl || row.rows[0]?.whatsapp;
    const e164 = normalizePhoneToE164(raw);
    return e164 || null;
  } catch {
    return null;
  }
}

type PersonTelegramPeer = {
  userId?: string;
  username?: string;
  /** Optional E.164 for GramJS ImportContacts when entity not in session cache. */
  phoneE164?: string;
};

/**
 * Read Person.telegram LINKS (+ phone) from Twenty.
 * Open/tg or tg:// link means we know the MTProto id for GramJS send —
 * distinct from «есть ссылка открыть профиль» alone in the UI.
 */
async function resolvePersonTelegramPeerFromTwentyDb(
  workspaceId: string,
  personId: string,
): Promise<PersonTelegramPeer | null> {
  const pool = twentyPersonPgPool();
  if (!pool || !workspaceId || !personId) return null;
  try {
    const ws = await pool.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return null;
    const row = await pool.query<{
      telegram: string | null;
      telegramPrimaryLinkUrl: string | null;
      telegramPrimaryLinkLabel: string | null;
      phonesPrimaryPhoneNumber: string | null;
      whatsapp: string | null;
      whatsappPrimaryLinkUrl: string | null;
    }>(
      `SELECT
         telegram,
         "telegramPrimaryLinkUrl" AS "telegramPrimaryLinkUrl",
         "telegramPrimaryLinkLabel" AS "telegramPrimaryLinkLabel",
         "phonesPrimaryPhoneNumber" AS "phonesPrimaryPhoneNumber",
         whatsapp,
         "whatsappPrimaryLinkUrl" AS "whatsappPrimaryLinkUrl"
       FROM "${schema}".person
       WHERE id = $1::uuid AND "deletedAt" IS NULL
       LIMIT 1`,
      [personId],
    );
    const p = row.rows[0];
    if (!p) return null;
    let peer: PersonTelegramPeer | null = null;
    for (const raw of [
      p.telegramPrimaryLinkUrl,
      p.telegramPrimaryLinkLabel,
      p.telegram,
    ]) {
      const parsed = parseTelegramPeerFromLink(raw);
      if (parsed?.userId || parsed?.username) {
        peer = { ...parsed };
        break;
      }
    }
    if (!peer) return null;
    const phoneE164 =
      normalizePhoneToE164(p.phonesPrimaryPhoneNumber) ||
      normalizePhoneToE164(p.whatsappPrimaryLinkUrl) ||
      normalizePhoneToE164(p.whatsapp) ||
      undefined;
    if (phoneE164) peer.phoneE164 = phoneE164;
    return peer;
  } catch {
    return null;
  }
}

/** Person phone for GramJS ImportContacts when peer entity missing from session. */
/** Lazy shared pg pool for direct Twenty DB reads (phone/peer lookup on chat hot path). */
let twentyPersonPg: pg.Pool | null = null;
function twentyPersonPgPool(): pg.Pool | null {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) return null;
  if (!twentyPersonPg) {
    twentyPersonPg = new pg.Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return twentyPersonPg;
}

async function loadPersonPhoneE164(
  prisma: FastifyInstance['prisma'],
  tenantId: string,
  personId: string | null | undefined,
): Promise<string | null> {
  if (!personId) return null;
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { twentyWorkspaceId: true },
  });
  if (!tenant?.twentyWorkspaceId) return null;
  const social = await resolvePersonTelegramPeerFromTwentyDb(
    tenant.twentyWorkspaceId,
    personId,
  );
  // resolvePersonTelegramPeerFromTwentyDb returns null without TG link — still need phone.
  if (social?.phoneE164) return social.phoneE164;
  const pool = twentyPersonPgPool();
  if (!pool) return null;
  try {
    const ws = await pool.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [tenant.twentyWorkspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return null;
    const row = await pool.query<{
      phonesPrimaryPhoneNumber: string | null;
      whatsapp: string | null;
      whatsappPrimaryLinkUrl: string | null;
    }>(
      `SELECT
         "phonesPrimaryPhoneNumber" AS "phonesPrimaryPhoneNumber",
         whatsapp,
         "whatsappPrimaryLinkUrl" AS "whatsappPrimaryLinkUrl"
       FROM "${schema}".person
       WHERE id = $1::uuid AND "deletedAt" IS NULL
       LIMIT 1`,
      [personId],
    );
    const p = row.rows[0];
    if (!p) return null;
    return (
      normalizePhoneToE164(p.phonesPrimaryPhoneNumber) ||
      normalizePhoneToE164(p.whatsappPrimaryLinkUrl) ||
      normalizePhoneToE164(p.whatsapp) ||
      null
    );
  } catch {
    return null;
  }
}

async function resolvePersonIdForRecord(
  prisma: FastifyInstance['prisma'],
  tenantId: string,
  recordId: string,
  baseTarget: CrmChatTarget,
): Promise<string | null> {
  let personId = baseTarget.twentyPersonId || null;
  if (!personId && baseTarget.twentyOpportunityId) {
    // recordId may be the Opportunity — still try base person first
  }
  if (!personId) {
    const extras = await resolveExtraPersonIdsForRecord(prisma, tenantId, recordId);
    personId = extras[0] || null;
  }
  if (!personId && recordId === baseTarget.twentyPersonId) {
    personId = recordId;
  }
  // Opportunity card: recordId is opp id; resolve PoC if needed
  if (!personId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { twentyWorkspaceId: true },
    });
    if (tenant?.twentyWorkspaceId) {
      personId = await resolvePointOfContactFromTwentyDb(
        tenant.twentyWorkspaceId,
        recordId,
      );
    }
  }
  return personId;
}

async function findCrmChatTarget(
  prisma: FastifyInstance['prisma'],
  tenantId: string,
  recordId: string,
  preferred?: { conversationId?: string | null; giftSubscriberId?: string | null },
): Promise<CrmChatTarget | null> {
  let targets = await listCrmChatTargets(prisma, tenantId, recordId);
  if (!targets.length) {
    const extraPersonIds = await resolveExtraPersonIdsForRecord(
      prisma,
      tenantId,
      recordId,
    );
    if (extraPersonIds.length) {
      targets = await listCrmChatTargets(prisma, tenantId, recordId, extraPersonIds);
    }
  }
  if (!targets.length) return null;

  if (preferred?.conversationId) {
    const hit = targets.find((t) => t.conversationId === preferred.conversationId);
    if (hit) return hit;
  }
  if (preferred?.giftSubscriberId) {
    const hit = targets.find((t) => t.giftSubscriberId === preferred.giftSubscriberId);
    if (hit) return hit;
  }
  return targets[0];
}

type CrmSendFromOption = {
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

type OutboundPeerResolve =
  | {
      ok: true;
      peerId: string;
      username: string | null;
      firstName: string | null;
      conversationId: string | null;
      giftSubscriberId: string | null;
      businessConnectionId: string | null;
      twentyPersonId: string | null;
      twentyOpportunityId: string | null;
      /** E.164 for GramJS ImportContacts when peer entity missing from session. */
      phoneE164?: string | null;
      /**
       * Phase 5.2 write-first (MAX): peer id is not known yet — the reply path must
       * resolve it from this phone via the MAX bridge (`/users/by-phone`) before sending.
       * Set only when `peerId` is empty. Never used on the hot GET path.
       */
      maxResolvePhone?: string | null;
    }
  | { ok: false; error: string };

function recordLinkFilter(recordId: string) {
  return [{ twentyOpportunityId: recordId }, { twentyPersonId: recordId }];
}

async function resolveOutboundPeer(opts: {
  prisma: FastifyInstance['prisma'];
  tenantId: string;
  recordId: string;
  bot: {
    id: string;
    botType: string;
  };
  baseTarget: CrmChatTarget;
}): Promise<OutboundPeerResolve> {
  const { prisma, tenantId, recordId, bot, baseTarget } = opts;
  const linkOr = recordLinkFilter(recordId);

  if (bot.botType === 'ai_wa') {
    const sameBot = await prisma.conversation.findFirst({
      where: {
        tenantId,
        botInstanceId: bot.id,
        platform: 'whatsapp',
        OR: linkOr,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (sameBot) {
      return {
        ok: true,
        peerId: sameBot.platformUserId,
        username: sameBot.platformUsername,
        firstName: sameBot.platformFirstName,
        conversationId: sameBot.id,
        giftSubscriberId: null,
        businessConnectionId: sameBot.businessConnectionId,
        twentyPersonId: sameBot.twentyPersonId || baseTarget.twentyPersonId,
        twentyOpportunityId: sameBot.twentyOpportunityId || baseTarget.twentyOpportunityId,
      };
    }
    const anyWa = await prisma.conversation.findFirst({
      where: {
        tenantId,
        platform: 'whatsapp',
        OR: linkOr,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (anyWa) {
      return {
        ok: true,
        peerId: anyWa.platformUserId,
        username: anyWa.platformUsername,
        firstName: anyWa.platformFirstName,
        conversationId: null,
        giftSubscriberId: null,
        businessConnectionId: null,
        twentyPersonId: anyWa.twentyPersonId || baseTarget.twentyPersonId,
        twentyOpportunityId: anyWa.twentyOpportunityId || baseTarget.twentyOpportunityId,
      };
    }

    // Verified Person.whatsapp (filled in CRM) → allow first outbound without prior WA thread.
    // Do not invent WA from phones alone / IsOnWhatsApp here.
    let personId = baseTarget.twentyPersonId || null;
    if (!personId) {
      const extras = await resolveExtraPersonIdsForRecord(prisma, tenantId, recordId);
      personId = extras[0] || null;
    }
    if (personId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { twentyWorkspaceId: true },
      });
      if (tenant?.twentyWorkspaceId) {
        const waE164 = await resolvePersonWhatsappFromTwentyDb(
          tenant.twentyWorkspaceId,
          personId,
        );
        if (waE164) {
          const digits = waE164.replace(/\D/g, '');
          return {
            ok: true,
            peerId: digits,
            username: waE164,
            firstName: baseTarget.firstName,
            conversationId: null,
            giftSubscriberId: null,
            businessConnectionId: null,
            twentyPersonId: personId,
            twentyOpportunityId: baseTarget.twentyOpportunityId,
          };
        }
      }
    }

    return {
      ok: false,
      error:
        'Нет WhatsApp у этого контакта — нужен заполненный WhatsApp в карточке или существующий WA-диалог. С Telegram-лида без поля WhatsApp отправить нельзя.',
    };
  }

  if (bot.botType === 'ai_tg') {
    // Business replies need the same connection — only allow existing thread for this bot.
    const same = await prisma.conversation.findFirst({
      where: {
        tenantId,
        botInstanceId: bot.id,
        OR: linkOr,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (same?.businessConnectionId) {
      return {
        ok: true,
        peerId: same.platformUserId,
        username: same.platformUsername,
        firstName: same.platformFirstName,
        conversationId: same.id,
        giftSubscriberId: null,
        businessConnectionId: same.businessConnectionId,
        twentyPersonId: same.twentyPersonId || baseTarget.twentyPersonId,
        twentyOpportunityId: same.twentyOpportunityId || baseTarget.twentyOpportunityId,
      };
    }
    return {
      ok: false,
      error:
        'Telegram Business: ответить можно только из уже связанного Business-диалога с этим контактом.',
    };
  }

  // Gift bots: only when this peer is a GiftSubscriber / conversation on THIS bot.
  // Do not reuse arbitrary GramJS private-chat telegramId (send would fail / wrong product).
  if (bot.botType === 'gift' || bot.botType === 'gift_max') {
    const giftForBot = await prisma.giftSubscriber.findFirst({
      where: {
        tenantId,
        botInstanceId: bot.id,
        OR: linkOr,
      },
      orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    });
    if (giftForBot) {
      return {
        ok: true,
        peerId: giftForBot.telegramId,
        username: giftForBot.username,
        firstName: giftForBot.firstName,
        conversationId: giftForBot.conversationId,
        giftSubscriberId: giftForBot.id,
        businessConnectionId: null,
        twentyPersonId: giftForBot.twentyPersonId || baseTarget.twentyPersonId,
        twentyOpportunityId:
          giftForBot.twentyOpportunityId || baseTarget.twentyOpportunityId,
      };
    }
    const convForBot = await prisma.conversation.findFirst({
      where: {
        tenantId,
        botInstanceId: bot.id,
        OR: linkOr,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (convForBot) {
      return {
        ok: true,
        peerId: convForBot.platformUserId,
        username: convForBot.platformUsername,
        firstName: convForBot.platformFirstName,
        conversationId: convForBot.id,
        giftSubscriberId: null,
        businessConnectionId: convForBot.businessConnectionId,
        twentyPersonId: convForBot.twentyPersonId || baseTarget.twentyPersonId,
        twentyOpportunityId:
          convForBot.twentyOpportunityId || baseTarget.twentyOpportunityId,
      };
    }
    return {
      ok: false,
      error:
        'Этот контакт не подписан на gift-бота — писать от gift-бота нельзя. Выберите личный Telegram или WhatsApp.',
    };
  }

  // Personal Telegram / MAX: prefer same-bot thread, else channel-matched peer.
  // CRITICAL: never reuse MAX platformUserId as GramJS peer (or TG id as MAX) — INC-109.
  const convForBot = await prisma.conversation.findFirst({
    where: {
      tenantId,
      botInstanceId: bot.id,
      OR: linkOr,
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (convForBot) {
    const phoneE164 = await loadPersonPhoneE164(
      prisma,
      tenantId,
      convForBot.twentyPersonId || baseTarget.twentyPersonId,
    );
    return {
      ok: true,
      peerId: convForBot.platformUserId,
      username: convForBot.platformUsername,
      firstName: convForBot.platformFirstName,
      conversationId: convForBot.id,
      giftSubscriberId: null,
      businessConnectionId: convForBot.businessConnectionId,
      twentyPersonId: convForBot.twentyPersonId || baseTarget.twentyPersonId,
      twentyOpportunityId: convForBot.twentyOpportunityId || baseTarget.twentyOpportunityId,
      phoneE164,
    };
  }

  const anyGift = await prisma.giftSubscriber.findFirst({
    where: { tenantId, OR: linkOr },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
  });
  if (anyGift && bot.botType === 'ai_gramjs') {
    const phoneE164 = await loadPersonPhoneE164(
      prisma,
      tenantId,
      anyGift.twentyPersonId || baseTarget.twentyPersonId,
    );
    return {
      ok: true,
      peerId: anyGift.telegramId,
      username: anyGift.username,
      firstName: anyGift.firstName,
      conversationId: null,
      giftSubscriberId: null,
      businessConnectionId: null,
      twentyPersonId: anyGift.twentyPersonId || baseTarget.twentyPersonId,
      twentyOpportunityId: anyGift.twentyOpportunityId || baseTarget.twentyOpportunityId,
      phoneE164,
    };
  }

  // Same channel only — do not treat MAX dialog as Telegram peer (and vice versa).
  if (bot.botType === 'ai_gramjs' || bot.botType === 'ai_max') {
    const platformWanted = bot.botType === 'ai_max' ? 'max' : 'telegram';
    const anySameChannel = await prisma.conversation.findFirst({
      where: {
        tenantId,
        platform: platformWanted,
        OR: linkOr,
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (anySameChannel) {
      const phoneE164 = await loadPersonPhoneE164(
        prisma,
        tenantId,
        anySameChannel.twentyPersonId || baseTarget.twentyPersonId,
      );
      return {
        ok: true,
        peerId: anySameChannel.platformUserId,
        username: anySameChannel.platformUsername,
        firstName: anySameChannel.platformFirstName,
        conversationId: null,
        giftSubscriberId: null,
        businessConnectionId: null,
        twentyPersonId: anySameChannel.twentyPersonId || baseTarget.twentyPersonId,
        twentyOpportunityId:
          anySameChannel.twentyOpportunityId || baseTarget.twentyOpportunityId,
        phoneE164,
      };
    }
  }

  // Person.telegram LINKS (userId / @username) — enable GramJS even when chat opened from WA/MAX
  // and there is no prior GramJS Conversation. Open/tg link ≠ gift; gift gate stays above.
  if (bot.botType === 'ai_gramjs') {
    const personId = await resolvePersonIdForRecord(prisma, tenantId, recordId, baseTarget);
    if (personId) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { twentyWorkspaceId: true },
      });
      if (tenant?.twentyWorkspaceId) {
        const socialPeer = await resolvePersonTelegramPeerFromTwentyDb(
          tenant.twentyWorkspaceId,
          personId,
        );
        if (socialPeer?.userId || socialPeer?.username) {
          return {
            ok: true,
            peerId: socialPeer.userId || socialPeer.username!,
            username: socialPeer.username || null,
            firstName: baseTarget.firstName,
            conversationId: null,
            giftSubscriberId: null,
            businessConnectionId: null,
            twentyPersonId: personId,
            twentyOpportunityId: baseTarget.twentyOpportunityId,
            phoneE164: socialPeer.phoneE164 || null,
          };
        }
      }
    }
  }

  if (
    baseTarget.telegramId &&
    (bot.botType === 'ai_gramjs' || bot.botType === 'ai_max')
  ) {
    const botOfBase = await prisma.botInstance.findFirst({
      where: { id: baseTarget.botInstanceId, tenantId },
      select: { botType: true },
    });
    // Allow peer reuse only from same-family base threads.
    // WA telegramId is often a phone JID; MAX id must never be used as GramJS peer.
    const baseOk =
      botOfBase &&
      ((bot.botType === 'ai_gramjs' &&
        (botOfBase.botType === 'ai_gramjs' ||
          botOfBase.botType === 'ai_tg' ||
          botOfBase.botType === 'gift')) ||
        (bot.botType === 'ai_max' &&
          (botOfBase.botType === 'ai_max' || botOfBase.botType === 'gift_max')));
    if (baseOk) {
      const phoneE164 = await loadPersonPhoneE164(
        prisma,
        tenantId,
        baseTarget.twentyPersonId,
      );
      return {
        ok: true,
        peerId: baseTarget.telegramId,
        username: baseTarget.username,
        firstName: baseTarget.firstName,
        conversationId: null,
        giftSubscriberId: null,
        businessConnectionId: null,
        twentyPersonId: baseTarget.twentyPersonId,
        twentyOpportunityId: baseTarget.twentyOpportunityId,
        phoneE164,
      };
    }
  }

  // Phase 5.2: MAX write-first — signal maxResolvePhone for send-time resolve.
  if (bot.botType === 'ai_max') {
    const personId = await resolvePersonIdForRecord(prisma, tenantId, recordId, baseTarget);
    if (personId) {
      const phoneE164 = await loadPersonPhoneE164(prisma, tenantId, personId);
      if (phoneE164) {
        return {
          ok: true,
          peerId: '',
          username: null,
          firstName: baseTarget.firstName,
          conversationId: null,
          giftSubscriberId: null,
          businessConnectionId: null,
          twentyPersonId: personId,
          twentyOpportunityId: baseTarget.twentyOpportunityId,
          phoneE164,
          maxResolvePhone: phoneE164,
        };
      }
    }
  }

  if (bot.botType === 'ai_max') {
    return {
      ok: false,
      error:
        'Нет MAX-контакта — нельзя отправить с личного MAX. Нужен телефон в карточке или существующий MAX-диалог.',
    };
  }

  const channelName = bot.botType === 'ai_gramjs' ? 'личного Telegram' : 'бота';
  return {
    ok: false,
    error: `Нет Telegram ID контакта — нельзя отправить с ${channelName}. Нужен Telegram в карточке (user id / @username) или gift/Telegram-диалог.`,
  };
}

async function buildSendFromOptions(opts: {
  prisma: FastifyInstance['prisma'];
  tenantId: string;
  recordId: string;
  baseTarget: CrmChatTarget;
  threads: CrmChatThreadMeta[];
}): Promise<CrmSendFromOption[]> {
  const { prisma, tenantId, recordId, baseTarget, threads } = opts;
  const threadByBot = new Map(threads.map((t) => [t.botId, t]));

  const accounts = await prisma.botInstance.findMany({
    where: {
      tenantId,
      status: 'active',
      botType: { in: ['gift', 'gift_max', 'ai_gramjs', 'ai_wa', 'ai_max'] },
      botTokenEncrypted: { not: null },
    },
    select: {
      id: true,
      botType: true,
      botUsername: true,
      displayName: true,
      phoneNumberId: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
  });

  // Always include thread bots (incl. ai_tg) even if filtered above
  const threadBotIds = threads.map((t) => t.botId).filter(Boolean);
  const missingThreadBots = threadBotIds.filter((id) => !accounts.some((a) => a.id === id));
  if (missingThreadBots.length) {
    const extra = await prisma.botInstance.findMany({
      where: { tenantId, id: { in: missingThreadBots } },
      select: {
        id: true,
        botType: true,
        botUsername: true,
        displayName: true,
        phoneNumberId: true,
      },
    });
    accounts.push(...extra);
  }

  const options: CrmSendFromOption[] = [];
  const seen = new Set<string>();

  for (const bot of accounts) {
    if (seen.has(bot.id)) continue;
    seen.add(bot.id);
    const meta = channelMeta({
      botType: bot.botType,
      botUsername: bot.botUsername,
      displayName: bot.displayName,
      phoneNumberId: bot.phoneNumberId,
      channel: null,
      peerUsername: baseTarget.username,
      peerFirstName: baseTarget.firstName,
      peerId: baseTarget.telegramId,
    });
    const thread = threadByBot.get(bot.id);
    const resolved = await resolveOutboundPeer({
      prisma,
      tenantId,
      recordId,
      bot,
      baseTarget,
    });
    const available = resolved.ok;
    // Gift bots: hide entirely unless this peer is subscribed / has gift conversation.
    if (
      (bot.botType === 'gift' || bot.botType === 'gift_max') &&
      !available
    ) {
      continue;
    }
    options.push({
      botId: bot.id,
      botType: bot.botType,
      label: `${meta.channelLabel} · ${meta.identityLabel}`,
      channelLabel: meta.channelLabel,
      identityLabel: meta.identityLabel,
      available,
      unavailableReason: available ? undefined : resolved.error,
      conversationId: thread?.conversationId ?? (resolved.ok ? resolved.conversationId : null),
      giftSubscriberId:
        thread?.giftSubscriberId ?? (resolved.ok ? resolved.giftSubscriberId : null),
      threadId: thread?.id ?? null,
      isDefault: bot.id === baseTarget.botInstanceId,
    });
  }

  // Default first, then available, then rest
  options.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    if (a.available && !b.available) return -1;
    if (!a.available && b.available) return 1;
    return a.label.localeCompare(b.label, 'ru');
  });
  return options;
}

function canReply(user: { role?: string; tenantRole?: string }): boolean {
  return (
    user.role === 'superadmin' ||
    user.tenantRole === 'owner' ||
    user.tenantRole === 'member' ||
    user.role === 'owner' ||
    user.role === 'member'
  );
}

function detectUploadKind(
  mimeType: string,
  filename: string,
): 'photo' | 'video' | 'document' {
  if (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(filename)) return 'photo';
  if (mimeType.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(filename)) return 'video';
  return 'document';
}

/** Browser <video>/<audio> need a real mime; Telegram/WA often return octet-stream. */
function sniffMediaContentType(
  buf: Buffer,
  hints: {
    contentType?: string | null;
    filePath?: string | null;
    fileName?: string | null;
    mimeType?: string | null;
  } = {},
): string {
  const rawHint = String(hints.mimeType || hints.contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (
    rawHint &&
    rawHint !== 'application/octet-stream' &&
    !rawHint.includes('json') &&
    !rawHint.includes('text/')
  ) {
    return rawHint;
  }

  if (buf.length >= 12) {
    // ISO BMFF (mp4 / m4a / mov)
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
      const brand = buf.slice(8, 12).toString('ascii');
      if (/^M4A|^M4B/i.test(brand)) return 'audio/mp4';
      return 'video/mp4';
    }
    if (buf.slice(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
    if (buf.slice(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
    if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'audio/mpeg';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF') {
      const form = buf.slice(8, 12).toString('ascii');
      if (form === 'WAVE') return 'audio/wav';
      if (form === 'WEBP') return 'image/webp';
      if (form === 'AVI ') return 'video/avi';
    }
    // EBML → webm/mkv
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
      return 'video/webm';
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      return 'image/png';
    }
    if (buf.slice(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  }

  const pathHint = `${hints.filePath || ''} ${hints.fileName || ''}`.toLowerCase();
  if (/video_note|\.mp4(\b|$)/i.test(pathHint)) return 'video/mp4';
  if (/\.webm(\b|$)/i.test(pathHint)) return 'video/webm';
  if (/\.mov(\b|$)/i.test(pathHint)) return 'video/quicktime';
  if (/\.(ogg|oga|opus)(\b|$)/i.test(pathHint)) return 'audio/ogg';
  if (/\.mp3(\b|$)/i.test(pathHint)) return 'audio/mpeg';
  if (/\.m4a(\b|$)/i.test(pathHint)) return 'audio/mp4';
  if (/\.wav(\b|$)/i.test(pathHint)) return 'audio/wav';
  if (/\.jpe?g(\b|$)/i.test(pathHint)) return 'image/jpeg';
  if (/\.png(\b|$)/i.test(pathHint)) return 'image/png';
  if (/\.webp(\b|$)/i.test(pathHint)) return 'image/webp';

  return rawHint || 'application/octet-stream';
}

type StoredAttachmentContext = {
  mimeType?: string;
  fileName?: string;
  type?: string;
  botInstanceId: string;
  conversationId: string;
  peerUserId: string;
  /** ChatMessage.role — operator outbound → WA fromMe=true */
  role?: string;
};

/**
 * Resolve attachment owner across ALL channels on the CRM record.
 * Default findCrmChatTarget picks the busiest thread (e.g. MAX over WA) — wrong bot
 * → 400 "preview not supported" for the other channel's fileIds (INC-115).
 */
async function findAttachmentContext(
  prisma: FastifyInstance['prisma'],
  opts: { tenantId: string; recordId: string; fileId: string },
): Promise<StoredAttachmentContext | null> {
  const targets = await listCrmChatTargets(prisma, opts.tenantId, opts.recordId);
  const convIds = [
    ...new Set(
      targets
        .map((t) => t.conversationId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  if (!convIds.length) return null;

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: { in: convIds } },
    orderBy: { sentAt: 'desc' },
    take: 200,
    select: {
      role: true,
      attachments: true,
      conversationId: true,
      conversation: {
        select: { botInstanceId: true, platformUserId: true },
      },
    },
  });
  for (const m of messages) {
    if (!Array.isArray(m.attachments)) continue;
    for (const raw of m.attachments) {
      if (!raw || typeof raw !== 'object') continue;
      const a = raw as Record<string, unknown>;
      if (a.fileId !== opts.fileId) continue;
      const botInstanceId = m.conversation?.botInstanceId;
      if (!botInstanceId) continue;
      return {
        mimeType: typeof a.mimeType === 'string' ? a.mimeType : undefined,
        fileName: typeof a.fileName === 'string' ? a.fileName : undefined,
        type: typeof a.type === 'string' ? a.type : undefined,
        botInstanceId,
        conversationId: m.conversationId,
        peerUserId: m.conversation.platformUserId || '',
        role: m.role,
      };
    }
  }
  return null;
}

async function lookupStoredAttachmentMeta(
  prisma: FastifyInstance['prisma'],
  opts: { tenantId: string; recordId: string; fileId: string },
): Promise<{ mimeType?: string; fileName?: string; type?: string } | null> {
  const ctx = await findAttachmentContext(prisma, opts);
  if (!ctx) return null;
  return {
    mimeType: ctx.mimeType,
    fileName: ctx.fileName,
    type: ctx.type,
  };
}

function mapAttachment(att: unknown): ChatAttachment | null {
  if (!att || typeof att !== 'object') return null;
  const a = att as Record<string, unknown>;
  if (a.type === 'sender_meta') return null;
  if (typeof a.fileId !== 'string' || typeof a.type !== 'string') return null;
  return {
    type: a.type as ChatAttachment['type'],
    fileId: a.fileId,
    fileUniqueId: typeof a.fileUniqueId === 'string' ? a.fileUniqueId : undefined,
    fileName: typeof a.fileName === 'string' ? a.fileName : undefined,
    mimeType: typeof a.mimeType === 'string' ? a.mimeType : undefined,
    fileSize: typeof a.fileSize === 'number' ? a.fileSize : undefined,
  };
}

function extractSenderLabel(attachments: unknown): string | null {
  if (!Array.isArray(attachments)) return null;
  for (const att of attachments) {
    if (!att || typeof att !== 'object') continue;
    const a = att as Record<string, unknown>;
    if (a.type === 'sender_meta' && typeof a.label === 'string' && a.label.trim()) {
      return a.label.trim();
    }
  }
  return null;
}

function formatOperatorName(user: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (name) return name;
  const email = String(user.email || '').trim();
  if (email.includes('@')) return email.split('@')[0] || email;
  return email || 'Менеджер';
}

/**
 * CRM Chat replies via Twenty `/s/*` use VOXLY_SERVICE_TOKEN (sub=twenty-app),
 * so Voxly User names are missing. Resolve from Twenty workspaceMember instead.
 */
async function resolveOperatorLabel(opts: {
  prisma: FastifyInstance['prisma'];
  tenantId: string;
  user: {
    sub?: string;
    email?: string;
    purpose?: string;
  };
  headers: Record<string, unknown>;
}): Promise<string> {
  const headerUw = String(
    opts.headers['x-twenty-user-workspace-id'] || '',
  ).trim();
  const tenant = await opts.prisma.tenant.findUnique({
    where: { id: opts.tenantId },
    select: { twentyWorkspaceId: true },
  });

  let dbUser: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null = null;
  if (opts.user.sub && opts.user.sub !== 'twenty-app') {
    dbUser = await opts.prisma.user.findUnique({
      where: { id: opts.user.sub },
      select: { firstName: true, lastName: true, email: true },
    });
  }

  const fromVoxly = dbUser
    ? formatOperatorName(dbUser)
    : opts.user.email
      ? formatOperatorName({ email: opts.user.email })
      : null;
  // Prefer real names over email-local-part / generic fallback.
  if (fromVoxly && fromVoxly !== 'Менеджер') {
    const looksLikeEmailLocal =
      !!dbUser &&
      !dbUser.firstName &&
      !dbUser.lastName &&
      !!dbUser.email;
    if (!looksLikeEmailLocal) return fromVoxly;
  }

  const fromTwenty = await resolveTwentyOperatorLabel({
    workspaceId: tenant?.twentyWorkspaceId,
    userWorkspaceId: headerUw || null,
    email: dbUser?.email || opts.user.email || null,
  });
  if (fromTwenty) return fromTwenty;
  return fromVoxly || 'Менеджер';
}

function formatBotAgentLabel(opts: {
  botType: string | null;
  botUsername: string | null;
  displayName: string | null;
  phoneNumberId?: string | null;
  agentName?: string | null;
}): string {
  let botPart = '';
  if (opts.botType === 'ai_wa') {
    botPart =
      opts.displayName ||
      (opts.phoneNumberId ? `WA ${opts.phoneNumberId}` : null) ||
      opts.botUsername ||
      'WhatsApp';
  } else if (opts.botType === 'ai_gramjs') {
    botPart =
      opts.displayName ||
      (opts.botUsername ? `@${opts.botUsername.replace(/^@/, '')}` : null) ||
      'Личный Telegram';
  } else if (opts.botType === 'ai_max') {
    botPart =
      opts.displayName ||
      opts.botUsername ||
      opts.phoneNumberId ||
      'Личный MAX';
  } else {
    botPart =
      (opts.botUsername ? `@${opts.botUsername.replace(/^@/, '')}` : null) ||
      opts.displayName ||
      'Бот';
  }
  if (opts.agentName?.trim()) return `${botPart} · ${opts.agentName.trim()}`;
  return botPart;
}

/**
 * Map Telegram / GramJS / Evolution / Bot API send failures to short Russian UI copy.
 * Keep already-localized and LID/media messages intact.
 */
function humanizeCrmChatSendError(raw: string): string {
  const msg = String(raw || '').trim();
  if (!msg) return 'Не удалось отправить сообщение';

  // Preserve our explicit RU / product messages (attachments, LID, session hints).
  if (
    /[А-Яа-яЁё]/.test(msg) ||
    /@lid|linked.?id|whatsapp lid/i.test(msg) ||
    /вложен/i.test(msg)
  ) {
    return msg;
  }

  if (
    /user_deactivated|input_user_deactivated|user_deactivated_ban|deactivated|account.*(deleted|unavailable)|peer_id_invalid|peer not found|could not find the input entity|input entity|chat not found|user not found|USER_ID_INVALID/i.test(
      msg,
    )
  ) {
    return 'Аккаунт удалён или недоступен';
  }

  if (
    /privacy|user_privacy_restricted|chat_write_forbidden|you_blocked_user|user_is_blocked|blocked.*(user|bot)|bots? can'?t initiate|can'?t initiate|forbidden: bot was blocked|have no rights to send|PEER_FLOOD|USER_IS_BLOCKED|YOU_BLOCKED_USER/i.test(
      msg,
    )
  ) {
    return 'Нельзя написать этому контакту (приватность или блокировка)';
  }

  if (
    /exists\s*:\s*false|not.*(registered|on whatsapp)|number.*not.*whatsapp|is not on whatsapp/i.test(
      msg,
    )
  ) {
    return 'Номер не найден в WhatsApp';
  }

  if (
    /BUSINESS_PEER_INVALID|BUSINESS_CONNECTION_INVALID|BUSINESS_PEER_USAGE_MISSING|can_reply|нет права отвечать/i.test(
      msg,
    )
  ) {
    return 'У Business-бота нет права отвечать. В Telegram: Настройки → Telegram Business → Чат-боты → ваш бот → включите «Отвечать на сообщения», затем попросите клиента написать ещё раз.';
  }

  if (/^bad request$/i.test(msg)) {
    return 'Не удалось отправить: контакт недоступен в WhatsApp';
  }

  // MAX personal / PyMax session death (INC-111).
  if (
    /token has expired|FAIL_LOGIN_TOKEN|FAIL_LOGOUT_ALL|сессия max истекла|login.?token|session.*(expired|invalid)/i.test(
      msg,
    )
  ) {
    return 'Сессия MAX истекла. Откройте /dashboard/ai/max → «Показать QR» и заново привяжите устройство в MAX → Devices.';
  }

  return msg;
}

/** Outbound service tokens, resolved per target service (per-service or shared). */
function gramjsToken(): string {
  return resolveServiceToken('gramjs-bridge');
}
function maxToken(): string {
  return resolveServiceToken('max-bridge');
}
function whatsappToken(): string {
  return resolveServiceToken('ai-whatsapp-worker');
}

function gramjsBridgeBase(): string {
  return (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(/\/$/, '');
}

function maxBridgeBase(): string {
  return (process.env.MAX_BRIDGE_URL || 'http://max-bridge:3010').replace(/\/$/, '');
}

function whatsappWorkerBase(): string {
  return (process.env.AI_WHATSAPP_WORKER_URL || 'http://ai-whatsapp-worker:3006').replace(
    /\/$/,
    '',
  );
}

async function sendViaGramjsBridge(opts: {
  botId: string;
  peerUserId: string;
  text: string;
  /** Optional E.164 — bridge ImportContacts when peer not in session cache. */
  phone?: string | null;
  /** Optional @username — getEntity fallback when id not in dialogs. */
  username?: string | null;
  media?: {
    mediaBase64: string;
    mimeType: string;
    fileName: string;
  } | null;
}): Promise<ChatAttachment | null> {
  const token = gramjsToken();
  if (!token) {
    throw new Error('VOXLY_SERVICE_TOKEN is not configured');
  }
  const res = await fetch(`${gramjsBridgeBase()}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      peerUserId: opts.peerUserId,
      text: opts.text,
      ...(opts.phone ? { phone: opts.phone } : {}),
      ...(opts.username ? { username: opts.username } : {}),
      ...(opts.media
        ? {
            mediaBase64: opts.media.mediaBase64,
            mimeType: opts.media.mimeType,
            fileName: opts.media.fileName,
          }
        : {}),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    attachment?: {
      type?: string;
      fileId?: string;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
    };
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `GramJS send failed (HTTP ${res.status})`);
  }
  if (json.attachment?.fileId && json.attachment.type) {
    return {
      type: json.attachment.type as ChatAttachment['type'],
      fileId: json.attachment.fileId,
      fileName: json.attachment.fileName,
      mimeType: json.attachment.mimeType,
      fileSize: json.attachment.fileSize,
    };
  }
  return null;
}

async function sendViaMaxBridge(opts: {
  botId: string;
  peerUserId: string;
  text: string;
  /** Phase 5.2 write-first: bridge resolves the peer from this E.164 when peerUserId is empty. */
  resolvePhone?: string | null;
  media?: {
    mediaBase64: string;
    mimeType: string;
    fileName: string;
  } | null;
}): Promise<{ attachment: ChatAttachment | null; chatId: string | null }> {
  const token = maxToken();
  if (!token) {
    throw new Error('VOXLY_SERVICE_TOKEN is not configured');
  }
  const res = await fetch(`${maxBridgeBase()}/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      peerUserId: opts.peerUserId,
      ...(opts.resolvePhone ? { resolvePhone: opts.resolvePhone } : {}),
      text: opts.text,
      ...(opts.media
        ? {
            mediaBase64: opts.media.mediaBase64,
            mimeType: opts.media.mimeType,
            fileName: opts.media.fileName,
          }
        : {}),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    chatId?: string;
    attachment?: {
      type?: string;
      fileId?: string;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
    };
  };
  if (!res.ok || !json.ok) {
    throw new Error(
      json.error || json.detail || `MAX send failed (HTTP ${res.status})`,
    );
  }
  const chatId = json.chatId ? String(json.chatId) : null;
  if (json.attachment?.fileId && json.attachment.type) {
    return {
      attachment: {
        type: json.attachment.type as ChatAttachment['type'],
        fileId: json.attachment.fileId,
        fileName: json.attachment.fileName,
        mimeType: json.attachment.mimeType,
        fileSize: json.attachment.fileSize,
      },
      chatId,
    };
  }
  return { attachment: null, chatId };
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

async function fetchGramjsMedia(opts: {
  botId: string;
  fileId: string;
}): Promise<{ buffer: Buffer; contentType: string } | null> {
  const token = gramjsToken();
  if (!token) {
    throw new Error('VOXLY_SERVICE_TOKEN is not configured');
  }
  const parsed = parseGramjsFileId(opts.fileId);
  if (!parsed) return null;
  const res = await fetch(`${gramjsBridgeBase()}/messages/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      peerUserId: parsed.peerUserId,
      messageId: parsed.messageId,
      fileId: opts.fileId,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    dataBase64?: string;
    mimeType?: string;
  };
  if (!res.ok || !json.ok || !json.dataBase64) {
    throw new Error(json.error || `GramJS media failed (HTTP ${res.status})`);
  }
  return {
    buffer: Buffer.from(json.dataBase64, 'base64'),
    contentType: json.mimeType || 'application/octet-stream',
  };
}

async function fetchWhatsappMedia(opts: {
  botId: string;
  fileId: string;
  peerUserId?: string;
  /** Evolution key.fromMe — true for CRM/operator outbound */
  fromMe?: boolean;
}): Promise<{ buffer: Buffer; contentType: string } | null> {
  const token = whatsappToken();
  if (!token) {
    throw new Error('VOXLY_SERVICE_TOKEN is not configured');
  }
  const res = await fetch(`${whatsappWorkerBase()}/internal/messages/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      fileId: opts.fileId,
      messageId: opts.fileId,
      peerUserId: opts.peerUserId,
      ...(opts.fromMe !== undefined ? { fromMe: opts.fromMe } : {}),
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    dataBase64?: string;
    mimeType?: string;
  };
  if (!res.ok || !json.ok || !json.dataBase64) {
    throw new Error(json.error || `WhatsApp media failed (HTTP ${res.status})`);
  }
  return {
    buffer: Buffer.from(json.dataBase64, 'base64'),
    contentType: json.mimeType || 'application/octet-stream',
  };
}

async function sendViaWhatsappWorker(opts: {
  botId: string;
  peerUserId: string;
  text: string;
  media?: {
    mediaBase64: string;
    mimeType: string;
    fileName: string;
  };
}): Promise<ChatAttachment | null> {
  const token = whatsappToken();
  if (!token) {
    throw new Error('VOXLY_SERVICE_TOKEN is not configured');
  }
  const body: Record<string, unknown> = {
    botId: opts.botId,
    to: opts.peerUserId,
    text: opts.text || '',
  };
  if (opts.media?.mediaBase64) {
    body.mediaBase64 = opts.media.mediaBase64;
    body.mimeType = opts.media.mimeType;
    body.fileName = opts.media.fileName;
  }
  const res = await fetch(`${whatsappWorkerBase()}/internal/messages/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    attachment?: {
      type?: string;
      fileId?: string;
      fileName?: string;
      mimeType?: string;
    } | null;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `WhatsApp send failed (HTTP ${res.status})`);
  }
  if (json.attachment?.fileId && json.attachment.type) {
    return {
      type: json.attachment.type as ChatAttachment['type'],
      fileId: json.attachment.fileId,
      fileName: json.attachment.fileName,
      mimeType: json.attachment.mimeType,
    };
  }
  return null;
}

/** Best-effort WA typing / read — never fail the CRM request. */
function fireWhatsappPresence(opts: {
  botId: string;
  peerUserId: string;
  kind: 'typing' | 'read';
  messageIds?: string[];
}): void {
  const token = whatsappToken();
  if (!token) return;
  const path =
    opts.kind === 'typing' ? '/internal/chat/typing' : '/internal/chat/read';
  const body: Record<string, unknown> = {
    botId: opts.botId,
    to: opts.peerUserId,
  };
  if (opts.kind === 'read' && opts.messageIds?.length) {
    body.messageIds = opts.messageIds;
  }
  void fetch(`${whatsappWorkerBase()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

/** Best-effort GramJS typing / read via MTProto bridge. */
function fireGramjsPresence(opts: {
  botId: string;
  peerUserId: string;
  kind: 'typing' | 'read';
}): void {
  const token = gramjsToken();
  if (!token) return;
  const path =
    opts.kind === 'typing' ? '/messages/typing' : '/messages/read';
  void fetch(`${gramjsBridgeBase()}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      peerUserId: opts.peerUserId,
    }),
  }).catch(() => undefined);
}

/** Best-effort MAX read via PyMax read_message. Typing: PyMax has no public send-typing API. */
function fireMaxPresence(opts: {
  botId: string;
  peerUserId: string;
  kind: 'read';
  messageIds?: string[];
}): void {
  const token = maxToken();
  if (!token) return;
  void fetch(`${maxBridgeBase()}/messages/read`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      peerUserId: opts.peerUserId,
      messageIds: opts.messageIds || [],
    }),
  }).catch(() => undefined);
}

async function fetchMaxMedia(opts: {
  botId: string;
  fileId: string;
}): Promise<{ buffer: Buffer; contentType: string } | null> {
  const token = maxToken();
  if (!token) {
    throw new Error('VOXLY_SERVICE_TOKEN is not configured');
  }
  if (!opts.fileId.startsWith('max:')) return null;
  const res = await fetch(`${maxBridgeBase()}/messages/media`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      fileId: opts.fileId,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
    detail?: string;
    dataBase64?: string;
    mimeType?: string;
  };
  if (!res.ok || !json.ok || !json.dataBase64) {
    throw new Error(json.error || json.detail || `MAX media failed (HTTP ${res.status})`);
  }
  return {
    buffer: Buffer.from(json.dataBase64, 'base64'),
    contentType: json.mimeType || 'application/octet-stream',
  };
}

type CrmChatPresence = {
  online: boolean;
  lastSeenAt: string | null;
  approx: 'recently' | 'last_week' | 'last_month' | null;
};

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms = 2500,
): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Contact online / last-seen for CRM chat header — never blocks/fails the GET. */
async function fetchContactPresence(opts: {
  botType: string | null;
  botId: string;
  peerUserId: string;
}): Promise<CrmChatPresence | null> {
  const token = gramjsToken();
  if (!token || !opts.botId || !opts.peerUserId) return null;

  if (opts.botType === 'ai_gramjs') {
    const res = await fetchWithTimeout(`${gramjsBridgeBase()}/messages/peer-status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ botId: opts.botId, peerUserId: opts.peerUserId }),
    });
    if (!res?.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      presence?: CrmChatPresence | null;
    } | null;
    return usablePresence(json?.presence || null);
  }

  if (opts.botType === 'ai_wa') {
    const qs = new URLSearchParams({
      botId: opts.botId,
      to: opts.peerUserId,
    });
    const res = await fetchWithTimeout(
      `${whatsappWorkerBase()}/internal/chat/presence?${qs.toString()}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    if (!res?.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      presence?: CrmChatPresence | null;
    } | null;
    return usablePresence(json?.presence || null);
  }

  // Bot API (Business / gift) does not expose contact last-seen.
  return null;
}

function usablePresence(p: CrmChatPresence | null): CrmChatPresence | null {
  if (!p) return null;
  if (p.online) return p;
  if (p.lastSeenAt || p.approx) return p;
  return null;
}

async function sendTelegramTyping(
  botApi: string,
  chatId: string,
  businessConnectionId?: string | null,
): Promise<void> {
  const withBiz = businessConnectionId
    ? { business_connection_id: businessConnectionId }
    : {};
  await fetch(`${botApi}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing', ...withBiz }),
  }).catch(() => undefined);
}

/** Live-check Telegram Business connection can_reply before CRM outbound. */
async function assertBusinessCanReply(botApi: string, businessConnectionId: string): Promise<void> {
  const res = await fetch(
    `${botApi}/getBusinessConnection?business_connection_id=${encodeURIComponent(businessConnectionId)}`,
  );
  const json = (await res.json()) as {
    ok?: boolean;
    description?: string;
    result?: { can_reply?: boolean; is_enabled?: boolean };
  };
  if (!json.ok) {
    throw new Error(json.description || 'BUSINESS_CONNECTION_INVALID');
  }
  if (json.result?.is_enabled === false) {
    throw new Error('BUSINESS_CONNECTION_INVALID');
  }
  if (json.result?.can_reply !== true) {
    throw new Error('can_reply=false');
  }
}

/** TG Business read receipts (n8n human-imitation port). Best-effort. */
async function readTelegramBusinessMessages(opts: {
  botApi: string;
  chatId: string;
  businessConnectionId: string;
  messageIds: string[];
}): Promise<void> {
  for (const messageId of opts.messageIds.slice(0, 10)) {
    const idNum = Number(messageId);
    if (!Number.isFinite(idNum)) continue;
    await fetch(`${opts.botApi}/readBusinessMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_connection_id: opts.businessConnectionId,
        chat_id: opts.chatId,
        message_id: idNum,
      }),
    }).catch(() => undefined);
  }
}

async function sendTelegramText(
  botApi: string,
  chatId: string,
  text: string,
  businessConnectionId?: string | null,
): Promise<void> {
  const withBiz = businessConnectionId
    ? { business_connection_id: businessConnectionId }
    : {};
  const tgRes = await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: clientMdToMarkdownV2(text),
      parse_mode: 'MarkdownV2',
      ...withBiz,
    }),
  });
  const tgJson = (await tgRes.json()) as { ok?: boolean; description?: string };
  if (tgJson.ok) return;

  const plain = await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, ...withBiz }),
  });
  const plainJson = (await plain.json()) as { ok?: boolean; description?: string };
  if (!plainJson.ok) {
    throw new Error(plainJson.description || tgJson.description || 'Telegram send failed');
  }
}

async function sendTelegramMedia(opts: {
  botApi: string;
  chatId: string;
  kind: 'photo' | 'video' | 'document';
  buffer: Buffer;
  filename: string;
  mimeType: string;
  caption?: string;
  businessConnectionId?: string | null;
}): Promise<ChatAttachment> {
  const form = new FormData();
  form.append('chat_id', opts.chatId);
  if (opts.businessConnectionId) {
    form.append('business_connection_id', opts.businessConnectionId);
  }
  if (opts.caption) {
    form.append('caption', clientMdToMarkdownV2(opts.caption));
    form.append('parse_mode', 'MarkdownV2');
  }
  const blob = new Blob([new Uint8Array(opts.buffer)], {
    type: opts.mimeType || 'application/octet-stream',
  });
  const field = opts.kind === 'photo' ? 'photo' : opts.kind === 'video' ? 'video' : 'document';
  const method =
    opts.kind === 'photo' ? 'sendPhoto' : opts.kind === 'video' ? 'sendVideo' : 'sendDocument';
  form.append(field, blob, opts.filename);

  let tgRes = await fetch(`${opts.botApi}/${method}`, { method: 'POST', body: form });
  let tgJson = (await tgRes.json()) as any;
  if (!tgJson.ok && opts.caption) {
    // Retry without MarkdownV2 if caption parse fails
    const form2 = new FormData();
    form2.append('chat_id', opts.chatId);
    if (opts.businessConnectionId) {
      form2.append('business_connection_id', opts.businessConnectionId);
    }
    form2.append('caption', opts.caption);
    form2.append(field, blob, opts.filename);
    tgRes = await fetch(`${opts.botApi}/${method}`, { method: 'POST', body: form2 });
    tgJson = await tgRes.json();
  }
  if (!tgJson.ok) {
    throw new Error(tgJson.description || 'Telegram media send failed');
  }

  const message = tgJson.result;
  if (opts.kind === 'photo' && Array.isArray(message.photo) && message.photo.length > 0) {
    const best = message.photo[message.photo.length - 1];
    return {
      type: 'photo',
      fileId: best.file_id,
      fileUniqueId: best.file_unique_id,
      fileSize: best.file_size,
    };
  }
  if (opts.kind === 'video' && message.video) {
    return {
      type: 'video',
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      mimeType: message.video.mime_type,
      fileName: message.video.file_name || opts.filename,
      fileSize: message.video.file_size,
    };
  }
  if (message.document) {
    return {
      type: 'document',
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      mimeType: message.document.mime_type,
      fileName: message.document.file_name || opts.filename,
      fileSize: message.document.file_size,
    };
  }
  throw new Error('Telegram не вернул file_id');
}

export const crmChatRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, {
    limits: { fileSize: 48 * 1024 * 1024, files: 1 },
  });

  /**
   * Save-time duplicate check (Twenty opportunity.created/updated + person.updated).
   * Soft-merges People by filled phone / Person.whatsapp; never invents numbers.
   */
  fastify.post(
    '/dedupe',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const body = (request.body || {}) as {
        opportunityId?: string;
        personId?: string;
      };
      const opportunityId = String(body.opportunityId || '').trim();
      const personId = String(body.personId || '').trim();
      if (!opportunityId && !personId) {
        return reply
          .code(400)
          .send({ error: 'opportunityId or personId required' });
      }
      try {
        const result = await runCrmSaveDedupe({
          prisma: fastify.prisma,
          tenantId,
          opportunityId: opportunityId || undefined,
          personId: personId || undefined,
        });
        if (!result.ok && result.error === 'tenant_not_found') {
          return reply.code(404).send(result);
        }
        if (!result.ok && result.error === 'crm_not_provisioned') {
          return reply.code(409).send(result);
        }
        return reply.send(result);
      } catch (err) {
        request.log.warn({ err }, 'CRM save dedupe failed');
        return reply.code(500).send({
          ok: false,
          error: err instanceof Error ? err.message : 'dedupe_failed',
        });
      }
    },
  );

  /**
   * Recent inbound ChatMessages for CRM left-snack toasts (shell-ux poll).
   * Auth: portal / crm-chat JWT or VOXLY_SERVICE_TOKEN + workspace header.
   */
  fastify.get(
    '/inbound-toasts',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const q = request.query as { since?: string; limit?: string };
      const limit = Math.min(
        30,
        Math.max(1, parseInt(String(q.limit || '15'), 10) || 15),
      );
      let since = new Date(Date.now() - 60_000);
      if (typeof q.since === 'string' && q.since.trim()) {
        const parsed = new Date(q.since);
        if (!Number.isNaN(parsed.getTime())) {
          // Cap lookback to 10 minutes to avoid huge backfills on first poll.
          const minSince = new Date(Date.now() - 10 * 60_000);
          since = parsed < minSince ? minSince : parsed;
        }
      }

      const prisma = fastify.prisma;
      const rows = await prisma.chatMessage.findMany({
        where: {
          role: 'user',
          sentAt: { gt: since },
          conversation: { tenantId },
        },
        orderBy: { sentAt: 'asc' },
        take: limit,
        select: {
          id: true,
          content: true,
          sentAt: true,
          conversation: {
            select: {
              id: true,
              platform: true,
              channel: true,
              platformFirstName: true,
              platformUsername: true,
              platformUserId: true,
              twentyPersonId: true,
              twentyOpportunityId: true,
              botInstanceId: true,
            },
          },
        },
      });

      const convIds = [...new Set(rows.map((r) => r.conversation.id))];
      const giftSubs =
        convIds.length === 0
          ? []
          : await prisma.giftSubscriber.findMany({
              where: {
                tenantId,
                conversationId: { in: convIds },
              },
              select: {
                conversationId: true,
                twentyPersonId: true,
                twentyOpportunityId: true,
                firstName: true,
                username: true,
              },
            });
      const giftByConv = new Map(
        giftSubs
          .filter((g) => g.conversationId)
          .map((g) => [g.conversationId as string, g]),
      );

      // Also resolve gift leads linked only by telegramId (conversationId unset).
      const orphanTelegramIds = [
        ...new Set(
          rows
            .filter((r) => !r.conversation.twentyPersonId && !giftByConv.get(r.conversation.id))
            .map((r) => r.conversation.platformUserId),
        ),
      ];
      const giftByTg =
        orphanTelegramIds.length === 0
          ? []
          : await prisma.giftSubscriber.findMany({
              where: {
                tenantId,
                telegramId: { in: orphanTelegramIds },
                twentyPersonId: { not: null },
              },
              orderBy: { updatedAt: 'desc' },
              select: {
                telegramId: true,
                twentyPersonId: true,
                twentyOpportunityId: true,
                firstName: true,
                username: true,
              },
            });
      const giftByTelegram = new Map<string, (typeof giftByTg)[0]>();
      for (const g of giftByTg) {
        if (!giftByTelegram.has(g.telegramId)) giftByTelegram.set(g.telegramId, g);
      }

      const items = rows.map((row) => {
        const conv = row.conversation;
        const gift = giftByConv.get(conv.id) || giftByTelegram.get(conv.platformUserId);
        const personId = conv.twentyPersonId || gift?.twentyPersonId || null;
        const opportunityId =
          conv.twentyOpportunityId || gift?.twentyOpportunityId || null;
        const nickname =
          (conv.platformFirstName && conv.platformFirstName.trim()) ||
          (gift?.firstName && String(gift.firstName).trim()) ||
          (conv.platformUsername && `@${String(conv.platformUsername).replace(/^@/, '')}`) ||
          (gift?.username && `@${String(gift.username).replace(/^@/, '')}`) ||
          'Клиент';
        const text = String(row.content || '').trim() || 'Новое сообщение';
        return {
          id: row.id,
          sentAt: row.sentAt.toISOString(),
          nickname,
          text: text.length > 280 ? `${text.slice(0, 277)}…` : text,
          personId,
          opportunityId,
          channel: conv.channel || conv.platform || null,
          conversationId: conv.id,
        };
      });

      return reply.send({ items, serverTime: new Date().toISOString() });
    },
  );

  /**
   * Unread inbound counts for CRM board/list badges (shell-ux poll).
   * Unread = ChatMessage role=user with sentAt > Conversation.lastOperatorReadAt
   * (or all user msgs if never opened in CRM Chat). Aggregated by Person / Opportunity.
   */
  fastify.get(
    '/unread-badges',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const prisma = fastify.prisma;

      // Phase 2.4: serve the small aggregated response from Redis when warm.
      // SQL below is authoritative; workers invalidate on inbound and opening a
      // chat (mark-read) invalidates too, so counts refresh before the TTL.
      const cachedUnread = await readCrmUnreadCache<{
        opportunities: { id: string; count: number }[];
        persons: { id: string; count: number }[];
        serverTime: string;
      }>(crmCacheRedis, tenantId);
      if (cachedUnread) {
        return reply.send({ ...cachedUnread, cached: true });
      }

      type UnreadRow = {
        conversationId: string;
        personId: string | null;
        opportunityId: string | null;
        platformUserId: string;
        count: number;
      };

      const rows = await prisma.$queryRaw<UnreadRow[]>`
        SELECT
          c.id AS "conversationId",
          c."twentyPersonId" AS "personId",
          c."twentyOpportunityId" AS "opportunityId",
          c."platformUserId" AS "platformUserId",
          COUNT(m.id)::int AS count
        FROM "ChatMessage" m
        INNER JOIN "Conversation" c ON c.id = m."conversationId"
        WHERE c."tenantId" = ${tenantId}
          AND m.role = 'user'
          AND (
            c."lastOperatorReadAt" IS NULL
            OR m."sentAt" > c."lastOperatorReadAt"
          )
        GROUP BY c.id, c."twentyPersonId", c."twentyOpportunityId", c."platformUserId"
        HAVING COUNT(m.id) > 0
        LIMIT 500
      `;

      if (rows.length === 0) {
        const empty = {
          opportunities: [] as { id: string; count: number }[],
          persons: [] as { id: string; count: number }[],
          serverTime: new Date().toISOString(),
        };
        await writeCrmUnreadCache(crmCacheRedis, tenantId, empty);
        return reply.send(empty);
      }

      const needGift = rows.filter((r) => !r.personId && !r.opportunityId);
      const giftByConv = new Map<
        string,
        { twentyPersonId: string | null; twentyOpportunityId: string | null }
      >();
      const giftByTg = new Map<
        string,
        { twentyPersonId: string | null; twentyOpportunityId: string | null }
      >();

      if (needGift.length > 0) {
        const convIds = needGift.map((r) => r.conversationId);
        const tgIds = [...new Set(needGift.map((r) => r.platformUserId))];
        const gifts = await prisma.giftSubscriber.findMany({
          where: {
            tenantId,
            OR: [
              { conversationId: { in: convIds } },
              { telegramId: { in: tgIds }, twentyPersonId: { not: null } },
            ],
          },
          orderBy: { updatedAt: 'desc' },
          select: {
            conversationId: true,
            telegramId: true,
            twentyPersonId: true,
            twentyOpportunityId: true,
          },
        });
        for (const g of gifts) {
          if (
            g.conversationId &&
            !giftByConv.has(g.conversationId) &&
            (g.twentyPersonId || g.twentyOpportunityId)
          ) {
            giftByConv.set(g.conversationId, g);
          }
          if (
            !giftByTg.has(g.telegramId) &&
            (g.twentyPersonId || g.twentyOpportunityId)
          ) {
            giftByTg.set(g.telegramId, g);
          }
        }
      }

      const oppCounts = new Map<string, number>();
      const personCounts = new Map<string, number>();
      for (const row of rows) {
        const gift =
          giftByConv.get(row.conversationId) ||
          giftByTg.get(row.platformUserId);
        const personId = row.personId || gift?.twentyPersonId || null;
        const opportunityId =
          row.opportunityId || gift?.twentyOpportunityId || null;
        if (opportunityId) {
          oppCounts.set(
            opportunityId,
            (oppCounts.get(opportunityId) || 0) + row.count,
          );
        }
        if (personId) {
          personCounts.set(
            personId,
            (personCounts.get(personId) || 0) + row.count,
          );
        }
      }

      const toList = (map: Map<string, number>) =>
        [...map.entries()]
          .map(([id, count]) => ({ id, count }))
          .sort((a, b) => b.count - a.count);

      const payload = {
        opportunities: toList(oppCounts),
        persons: toList(personCounts),
        serverTime: new Date().toISOString(),
      };
      await writeCrmUnreadCache(crmCacheRedis, tenantId, payload);
      return reply.send(payload);
    },
  );

  fastify.get(
    '/:recordId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { recordId } = request.params as { recordId: string };
      if (!recordId || recordId.length < 10) {
        return reply.code(400).send({ error: 'Invalid CRM record id' });
      }

      const q = request.query as { conversationId?: string; giftSubscriberId?: string };
      const preferred = {
        conversationId: typeof q.conversationId === 'string' ? q.conversationId : null,
        giftSubscriberId: typeof q.giftSubscriberId === 'string' ? q.giftSubscriberId : null,
      };

      const prisma = fastify.prisma;
      // Phase 2.2: cache the resolved thread list (channel pills) for a few seconds.
      // Messages + active target are still read live below; workers invalidate this
      // key on inbound so a new thread appears immediately, not after the TTL.
      let allTargets = await readCrmThreadCache<CrmChatTarget[]>(
        crmCacheRedis,
        tenantId,
        recordId,
      );
      if (!allTargets) {
        allTargets = await listCrmChatTargets(prisma, tenantId, recordId);
        if (!allTargets.length) {
          const extraPersonIds = await resolveExtraPersonIdsForRecord(
            prisma,
            tenantId,
            recordId,
          );
          if (extraPersonIds.length) {
            allTargets = await listCrmChatTargets(
              prisma,
              tenantId,
              recordId,
              extraPersonIds,
            );
          }
        }
        await writeCrmThreadCache(crmCacheRedis, tenantId, recordId, allTargets);
      }
      const target = await findCrmChatTarget(prisma, tenantId, recordId, preferred);
      if (!target) {
        // 200 (not 404): RestApiClient in CRM Chat tab treats non-2xx as hard failure.
        // No bot / no lead yet is a normal empty state, not a broken tab.
        return reply.send({
          recordId,
          messages: [],
          threads: [],
          info: 'Нет чата для этой записи. Напишите клиенту в Telegram / WhatsApp или дождитесь входящего сообщения.',
        });
      }

      let conversationId = target.conversationId;
      let mode = 'bot';
      let channel: string | null = null;
      let aiDisabled = false;
      let suppressDealCreation = false;
      let pausedUntil: string | null = null;
      let aiAgentId: string | null = null;
      let agentName: string | null = null;
      if (conversationId) {
        const conversation = await prisma.conversation.findFirst({
          where: { id: conversationId, tenantId },
          select: {
            mode: true,
            channel: true,
            aiDisabled: true,
            suppressDealCreation: true,
            pausedUntil: true,
            aiAgentId: true,
            aiAgent: { select: { name: true, status: true } },
            botInstance: {
              select: {
                defaultAiAgent: { select: { name: true, status: true } },
              },
            },
          },
        });
        mode = conversation?.mode || 'bot';
        channel = conversation?.channel || null;
        aiDisabled = conversation?.aiDisabled === true;
        suppressDealCreation = conversation?.suppressDealCreation === true;
        pausedUntil = conversation?.pausedUntil
          ? conversation.pausedUntil.toISOString()
          : null;
        aiAgentId = conversation?.aiAgentId || null;
        const agent =
          (conversation?.aiAgent?.status === 'active' ? conversation.aiAgent : null) ||
          (conversation?.botInstance?.defaultAiAgent?.status === 'active'
            ? conversation.botInstance.defaultAiAgent
            : null);
        agentName = agent?.name || null;
      } else if (target.giftSubscriberId) {
        const gift = await prisma.giftSubscriber.findFirst({
          where: { id: target.giftSubscriberId, tenantId },
          select: { suppressDealCreation: true },
        });
        suppressDealCreation = gift?.suppressDealCreation === true;
      }

      const jwtUser = (request as any).user as {
        sub?: string;
        email?: string;
        purpose?: string;
      };

      const botIds = [...new Set(allTargets.map((t) => t.botInstanceId))];

      // Phase 2.5: run the independent hot-path reads in parallel instead of
      // sequentially (operator label + bots + messages). operatorName may hit
      // the Twenty DB, but it never blocks messages/bots now.
      const [operatorName, bots, messages] = await Promise.all([
        resolveOperatorLabel({
          prisma,
          tenantId,
          user: jwtUser,
          headers: request.headers as Record<string, unknown>,
        }),
        prisma.botInstance.findMany({
          where: { tenantId, id: { in: botIds } },
          select: {
            id: true,
            botType: true,
            botUsername: true,
            displayName: true,
            phoneNumberId: true,
            botTokenEncrypted: true,
          },
        }),
        conversationId
          ? prisma.chatMessage.findMany({
              where: { conversationId },
              orderBy: { sentAt: 'asc' },
              take: 300,
            })
          : Promise.resolve([] as Awaited<ReturnType<typeof prisma.chatMessage.findMany>>),
      ]);
      const botById = new Map(bots.map((b) => [b.id, b]));

      const threads: CrmChatThreadMeta[] = allTargets.map((t) => {
        const b = botById.get(t.botInstanceId);
        const meta = channelMeta({
          botType: b?.botType || (t.source === 'gift_subscriber' ? 'gift' : null),
          botUsername: b?.botUsername || null,
          displayName: b?.displayName || null,
          phoneNumberId: b?.phoneNumberId || null,
          channel: null,
          peerUsername: t.username,
          peerFirstName: t.firstName,
          peerId: t.telegramId,
        });
        return {
          id: t.conversationId || t.giftSubscriberId || t.botInstanceId,
          source: t.source,
          conversationId: t.conversationId,
          giftSubscriberId: t.giftSubscriberId,
          botId: t.botInstanceId,
          botType: b?.botType || null,
          channel: meta.channelKind,
          channelLabel: meta.channelLabel,
          identityLabel: meta.identityLabel,
          peerLabel: meta.peerLabel,
        };
      });

      const bot = botById.get(target.botInstanceId);
      const botType = bot?.botType || (target.source === 'gift_subscriber' ? 'gift' : null);
      const meta = channelMeta({
        botType,
        botUsername: bot?.botUsername || null,
        displayName: bot?.displayName || null,
        phoneNumberId: bot?.phoneNumberId || null,
        channel,
        peerUsername: target.username,
        peerFirstName: target.firstName,
        peerId: target.telegramId,
      });

      // CRM unread badges: opening Chat marks ALL linked threads read.
      // Badges aggregate every conversation for the Person/Opportunity; marking only
      // the active thread left counts stuck when multi-channel (WA+TG+gift).
      // Phase 2.5: debounce the mark-read + channel read-receipts per active
      // conversation so rapid polls of the same open chat don't re-write
      // lastOperatorReadAt / re-fire presence every few seconds.
      const readConvIds = [
        ...new Set(
          allTargets
            .map((t) => t.conversationId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const shouldFireRead = conversationId
        ? await claimCrmReadDebounce(crmCacheRedis, tenantId, conversationId)
        : readConvIds.length > 0;
      if (readConvIds.length > 0 && shouldFireRead) {
        try {
          await prisma.conversation.updateMany({
            where: { id: { in: readConvIds }, tenantId },
            data: { lastOperatorReadAt: new Date() },
          });
          // Marking read changes unread badges — drop the cached aggregate (Phase 2.4).
          await invalidateCrmUnreadCache(crmCacheRedis, tenantId);
        } catch {
          /* ignore */
        }
      }

      // Operator opened chat → mark inbound as read on channel (best-effort). Typing only on send.
      if (shouldFireRead && botType === 'ai_wa') {
        const inboundIds = messages
          .filter((m) => m.role === 'user' && m.externalMessageId)
          .slice(-10)
          .map((m) => String(m.externalMessageId));
        fireWhatsappPresence({
          botId: target.botInstanceId,
          peerUserId: target.telegramId,
          kind: 'read',
          messageIds: inboundIds,
        });
      } else if (shouldFireRead && botType === 'ai_gramjs') {
        fireGramjsPresence({
          botId: target.botInstanceId,
          peerUserId: target.telegramId,
          kind: 'read',
        });
      } else if (shouldFireRead && botType === 'ai_max') {
        const inboundIds = messages
          .filter((m) => m.role === 'user' && m.externalMessageId)
          .slice(-10)
          .map((m) => String(m.externalMessageId));
        fireMaxPresence({
          botId: target.botInstanceId,
          peerUserId: target.telegramId,
          kind: 'read',
          messageIds: inboundIds,
        });
      } else if (
        shouldFireRead &&
        (botType === 'ai_tg' || botType === 'gift') &&
        bot?.botTokenEncrypted
      ) {
        try {
          const token = decrypt(bot.botTokenEncrypted);
          const botApi = `https://api.telegram.org/bot${token}`;
          // Read receipts only on open — never sendChatAction(typing) here (stuck «печатает»).
          if (target.businessConnectionId) {
            const inboundIds = messages
              .filter((m) => m.role === 'user' && m.externalMessageId)
              .slice(-5)
              .map((m) => String(m.externalMessageId));
            void readTelegramBusinessMessages({
              botApi,
              chatId: target.telegramId,
              businessConnectionId: target.businessConnectionId,
              messageIds: inboundIds,
            });
          }
        } catch {
          /* ignore */
        }
      }

      // Phase 2.5: presence (external channel call) and send-from options (DB)
      // are independent — run them in parallel to shave hot-path latency.
      const [presence, sendFromOptions] = await Promise.all([
        fetchContactPresence({
          botType,
          botId: target.botInstanceId,
          peerUserId: target.telegramId,
        }),
        buildSendFromOptions({
          prisma,
          tenantId,
          recordId,
          baseTarget: target,
          threads,
        }),
      ]);

      return reply.send({
        recordId,
        opportunityId: target.twentyOpportunityId,
        personId: target.twentyPersonId,
        subscriberId: target.giftSubscriberId,
        botId: target.botInstanceId,
        telegramId: target.telegramId,
        username: target.username,
        firstName: target.firstName,
        source: target.source,
        conversationId,
        mode,
        aiDisabled,
        suppressDealCreation,
        pausedUntil,
        aiAgentId,
        aiControls:
          Boolean(conversationId) &&
          (botType === 'ai_tg' ||
            botType === 'ai_wa' ||
            botType === 'ai_gramjs' ||
            botType === 'ai_max'),
        channel: meta.channelKind,
        channelLabel: meta.channelLabel,
        identityLabel: meta.identityLabel,
        peerLabel: meta.peerLabel,
        contactName:
          meta.peerLabel ||
          target.firstName ||
          (target.username ? `@${target.username}` : null) ||
          'Клиент',
        botAgentLabel: formatBotAgentLabel({
          botType,
          botUsername: bot?.botUsername || null,
          displayName: bot?.displayName || null,
          phoneNumberId: bot?.phoneNumberId || null,
          agentName,
        }),
        operatorName,
        botType,
        supportsAttachments: botType !== 'gift_max',
        presence,
        threads,
        sendFromOptions,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          senderLabel: extractSenderLabel(m.attachments),
          attachments: Array.isArray(m.attachments)
            ? (m.attachments as unknown[])
                .map(mapAttachment)
                .filter((a): a is ChatAttachment => Boolean(a))
            : [],
          sentAt: m.sentAt,
        })),
      });
    },
  );

  /**
   * Phase 2.3: lightweight delta poll for an already-open thread.
   * Returns only ChatMessages with sentAt > `since` for one tenant-scoped
   * conversation — no target resolution, no bots / sendFromOptions / presence /
   * Twenty calls / mark-read. The panel uses this between full `GET /:recordId`
   * loads to append new bubbles cheaply. `since` is an ISO timestamp; omit it to
   * get the latest tail. Response `serverTime` should be echoed as the next `since`.
   */
  fastify.get(
    '/:recordId/stream',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { recordId } = request.params as { recordId: string };
      if (!recordId || recordId.length < 10) {
        return reply.code(400).send({ error: 'Invalid CRM record id' });
      }
      const q = request.query as { conversationId?: string; since?: string; limit?: string };
      const conversationId =
        typeof q.conversationId === 'string' && q.conversationId ? q.conversationId : null;
      if (!conversationId) {
        return reply.code(400).send({ error: 'conversationId is required' });
      }
      const limit = Math.min(100, Math.max(1, parseInt(String(q.limit || '50'), 10) || 50));

      let since: Date | null = null;
      if (typeof q.since === 'string' && q.since.trim()) {
        const parsed = new Date(q.since);
        if (!Number.isNaN(parsed.getTime())) since = parsed;
      }

      const prisma = fastify.prisma;
      // Tenant-scope the conversation before reading its messages (never leak cross-tenant).
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId },
        select: { id: true },
      });
      if (!conv) {
        return reply.code(404).send({ error: 'No chat linked to this CRM record' });
      }

      const rows = await prisma.chatMessage.findMany({
        where: {
          conversationId,
          ...(since ? { sentAt: { gt: since } } : {}),
        },
        orderBy: { sentAt: since ? 'asc' : 'desc' },
        take: limit,
        select: { id: true, role: true, content: true, attachments: true, sentAt: true },
      });
      // When no `since`, we fetched the newest tail desc — return it chronological.
      const ordered = since ? rows : [...rows].reverse();

      return reply.send({
        recordId,
        conversationId,
        serverTime: new Date().toISOString(),
        messages: ordered.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          senderLabel: extractSenderLabel(m.attachments),
          attachments: Array.isArray(m.attachments)
            ? (m.attachments as unknown[])
                .map(mapAttachment)
                .filter((a): a is ChatAttachment => Boolean(a))
            : [],
          sentAt: m.sentAt,
        })),
      });
    },
  );

  /** Enable / pause (~1h) / disable AI for the active CRM chat thread. */
  fastify.post(
    '/:recordId/ai',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canReply(user)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { recordId } = request.params as { recordId: string };
      const body = z
        .object({
          conversationId: z.string().min(1),
          action: z.enum(['enable', 'pause', 'disable']),
        })
        .safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten() });
      }

      const prisma = fastify.prisma;
      const target = await findCrmChatTarget(prisma, tenantId, recordId, {
        conversationId: body.data.conversationId,
      });
      if (!target?.conversationId) {
        return reply.code(404).send({ error: 'No chat linked to this CRM record' });
      }
      if (target.conversationId !== body.data.conversationId) {
        return reply.code(404).send({ error: 'Conversation not linked to this record' });
      }

      const conversation = await prisma.conversation.findFirst({
        where: {
          id: body.data.conversationId,
          tenantId,
        },
      });
      if (!conversation) return reply.code(404).send({ error: 'Not found' });

      const data: {
        mode?: string;
        aiDisabled?: boolean;
        pausedUntil?: Date | null;
        status?: string;
      } = {};

      if (body.data.action === 'enable') {
        data.mode = 'ai';
        data.aiDisabled = false;
        data.pausedUntil = null;
        data.status = 'open';
      } else if (body.data.action === 'pause') {
        data.pausedUntil = new Date(Date.now() + AI_HANDOFF_PAUSE_MS);
        if (!conversation.aiDisabled) {
          data.mode = 'ai';
          data.status = 'open';
        }
      } else {
        data.aiDisabled = true;
        data.mode = 'human';
        data.status = 'waiting_for_human';
        data.pausedUntil = null;
      }

      const updated = await prisma.conversation.update({
        where: { id: conversation.id },
        data,
        select: {
          id: true,
          mode: true,
          aiDisabled: true,
          pausedUntil: true,
          status: true,
        },
      });

      return reply.send({
        conversationId: updated.id,
        mode: updated.mode,
        aiDisabled: updated.aiDisabled,
        pausedUntil: updated.pausedUntil ? updated.pausedUntil.toISOString() : null,
        status: updated.status,
        action: body.data.action,
      });
    },
  );

  /** Toggle «Не создавать сделку при новых сообщениях» for this thread. */
  fastify.post(
    '/:recordId/suppress-deal',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canReply(user)) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const { recordId } = request.params as { recordId: string };
      const body = z
        .object({
          conversationId: z.string().min(1).optional(),
          giftSubscriberId: z.string().min(1).optional(),
          suppress: z.boolean(),
        })
        .safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: body.error.flatten() });
      }

      const prisma = fastify.prisma;
      const preferred = {
        conversationId: body.data.conversationId,
        giftSubscriberId: body.data.giftSubscriberId,
      };
      const target = await findCrmChatTarget(prisma, tenantId, recordId, preferred);
      if (!target) {
        return reply.code(404).send({ error: 'No chat linked to this CRM record' });
      }

      let suppressDealCreation = body.data.suppress;

      if (target.conversationId) {
        const updated = await prisma.conversation.update({
          where: { id: target.conversationId },
          data: { suppressDealCreation },
          select: { id: true, suppressDealCreation: true },
        });
        suppressDealCreation = updated.suppressDealCreation;
      }
      if (target.giftSubscriberId) {
        const updated = await prisma.giftSubscriber.update({
          where: { id: target.giftSubscriberId },
          data: { suppressDealCreation },
          select: { id: true, suppressDealCreation: true },
        });
        suppressDealCreation = updated.suppressDealCreation;
      }
      if (!target.conversationId && !target.giftSubscriberId) {
        return reply.code(404).send({ error: 'No conversation to update' });
      }

      return reply.send({
        ok: true,
        conversationId: target.conversationId,
        giftSubscriberId: target.giftSubscriberId,
        suppressDealCreation,
      });
    },
  );

  async function resolveCrmMediaBuffer(opts: {
    tenantId: string;
    recordId: string;
    fileId: string;
    botId?: string;
  }): Promise<
    | { buffer: Buffer; contentType: string; fileName?: string | null }
    | { error: string; status: number }
  > {
    const prisma = fastify.prisma;
    const target = await findCrmChatTarget(prisma, opts.tenantId, opts.recordId);
    if (!target) return { error: 'Not found', status: 404 };

    const fileId = opts.fileId;
    // Prefer the conversation that actually stores this fileId (multi-channel Person).
    const attCtx = await findAttachmentContext(prisma, {
      tenantId: opts.tenantId,
      recordId: opts.recordId,
      fileId,
    });
    const resolvedBotId =
      attCtx?.botInstanceId || opts.botId || target.botInstanceId;

    const bot = await prisma.botInstance.findFirst({
      where: {
        id: resolvedBotId,
        tenantId: opts.tenantId,
        status: 'active',
      },
    });
    if (!bot) return { error: 'Bot not found', status: 404 };
    // Do not require botId === default target — same Person may have MAX + WA threads.

    const storedMeta = attCtx
      ? {
          mimeType: attCtx.mimeType,
          fileName: attCtx.fileName,
          type: attCtx.type,
        }
      : await lookupStoredAttachmentMeta(prisma, {
          tenantId: opts.tenantId,
          recordId: opts.recordId,
          fileId,
        });
    const withMeta = (media: { buffer: Buffer; contentType: string }) => ({
      ...media,
      fileName: storedMeta?.fileName || null,
    });
    const peerUserId = attCtx?.peerUserId || target.telegramId || undefined;
    const waFromMe =
      attCtx?.role === 'operator' || attCtx?.role === 'assistant'
        ? true
        : attCtx?.role === 'user'
          ? false
          : undefined;

    if (bot.botType === 'ai_gramjs') {
      if (!fileId.startsWith('gramjs:')) {
        return {
          error: 'Превью файлов для личного Telegram пока не поддерживается',
          status: 400,
        };
      }
      try {
        const media = await fetchGramjsMedia({ botId: bot.id, fileId });
        if (!media) return { error: 'Invalid GramJS file id', status: 400 };
        return withMeta({
          buffer: media.buffer,
          contentType: sniffMediaContentType(media.buffer, {
            contentType: media.contentType,
            mimeType: storedMeta?.mimeType,
            fileName: storedMeta?.fileName,
          }),
        });
      } catch (err) {
        return {
          error: (err as Error).message || 'Failed to fetch GramJS media',
          status: 502,
        };
      }
    }

    if (bot.botType === 'ai_max') {
      if (!fileId.startsWith('max:')) {
        return {
          error: 'Превью файлов для личного MAX пока не поддерживается',
          status: 400,
        };
      }
      try {
        const media = await fetchMaxMedia({ botId: bot.id, fileId });
        if (!media) return { error: 'Invalid MAX file id', status: 400 };
        return withMeta({
          buffer: media.buffer,
          contentType: sniffMediaContentType(media.buffer, {
            contentType: media.contentType,
            mimeType: storedMeta?.mimeType,
            fileName: storedMeta?.fileName,
          }),
        });
      } catch (err) {
        return {
          error: (err as Error).message || 'Failed to fetch MAX media',
          status: 502,
        };
      }
    }

    if (bot.botType === 'ai_wa') {
      try {
        const media = await fetchWhatsappMedia({
          botId: bot.id,
          fileId,
          peerUserId,
          fromMe: waFromMe,
        });
        if (!media) return { error: 'WhatsApp media not found', status: 404 };
        return withMeta({
          buffer: media.buffer,
          contentType: sniffMediaContentType(media.buffer, {
            contentType: media.contentType,
            mimeType: storedMeta?.mimeType,
            fileName: storedMeta?.fileName,
          }),
        });
      } catch (err) {
        return {
          error: (err as Error).message || 'Failed to fetch WhatsApp media',
          status: 502,
        };
      }
    }

    if (!bot.botTokenEncrypted) return { error: 'Bot not found', status: 404 };

    const token = decrypt(bot.botTokenEncrypted);
    const metaRes = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const meta = (await metaRes.json()) as {
      ok?: boolean;
      result?: { file_path?: string };
      description?: string;
    };
    if (!meta.ok || !meta.result?.file_path) {
      return { error: meta.description || 'File not found', status: 404 };
    }

    const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok) return { error: 'Failed to fetch Telegram file', status: 502 };

    const headerType = fileRes.headers.get('content-type') || 'application/octet-stream';
    const buf = Buffer.from(await fileRes.arrayBuffer());
    return withMeta({
      buffer: buf,
      contentType: sniffMediaContentType(buf, {
        contentType: headerType,
        filePath: meta.result.file_path,
        mimeType: storedMeta?.mimeType,
        fileName: storedMeta?.fileName,
      }),
    });
  }

  function sendMediaBuffer(
    reply: import('fastify').FastifyReply,
    request: import('fastify').FastifyRequest,
    result: { buffer: Buffer; contentType: string; fileName?: string | null },
  ) {
    const buf = result.buffer;
    const contentType = result.contentType;
    const rawName = String(result.fileName || '').trim();
    const safeName = rawName.replace(/[^\w.\- ()а-яА-ЯёЁ]+/gi, '_').slice(0, 120);
    const isDoc =
      contentType.startsWith('application/') ||
      contentType === 'text/plain' ||
      /\.(pdf|docx?|xlsx?|zip)$/i.test(safeName);
    const disposition = isDoc
      ? `attachment; filename="${safeName || 'file.bin'}"`
      : 'inline';
    reply
      .header('Content-Type', contentType)
      .header('Cache-Control', 'private, max-age=300')
      .header('Content-Disposition', disposition)
      .header('Accept-Ranges', 'bytes');

    const range = String(request.headers.range || '');
    const m = /^bytes=(\d+)-(\d+)?$/i.exec(range);
    if (m) {
      const size = buf.length;
      let start = Number(m[1]);
      let end = m[2] != null && m[2] !== '' ? Number(m[2]) : size - 1;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end < start ||
        start >= size
      ) {
        return reply
          .code(416)
          .header('Content-Range', `bytes */${size}`)
          .send({ error: 'Range Not Satisfiable' });
      }
      end = Math.min(end, size - 1);
      const chunk = buf.subarray(start, end + 1);
      return reply
        .code(206)
        .header('Content-Range', `bytes ${start}-${end}/${size}`)
        .header('Content-Length', chunk.length)
        .send(chunk);
    }

    return reply.header('Content-Length', buf.length).send(buf);
  }

  // HMAC-signed media stream for <video>/<audio>/<img> (no Twenty /s base64 size limit).
  // Wildcard path so long base64url.sig tokens (with `.`) match; also needs
  // Fastify maxParamLength ≫ 100 (set in index.ts) — INC-063 reopen.
  fastify.get('/media/*', async (request, reply) => {
    const wildcard = String((request.params as { '*': string })['*'] || '').replace(
      /^\/+/,
      '',
    );
    const payload = verifyMediaToken(wildcard);
    if (!payload) {
      return reply.code(401).send({ error: 'Invalid or expired media token' });
    }
    const denied = await assertCrmAccessAllowed(fastify.prisma, payload.tenantId);
    if (denied) {
      return reply.code(denied.code || 403).send({
        error: denied.error,
        reason: denied.reason,
        crmAccessLocked: true,
      });
    }
    const result = await resolveCrmMediaBuffer({
      tenantId: payload.tenantId,
      recordId: payload.recordId,
      fileId: payload.fileId,
      botId: payload.botId,
    });
    if ('error' in result) {
      return reply.code(result.status).send({ error: result.error });
    }
    return sendMediaBuffer(reply, request, result);
  });

  // Small JSON: signed URL for CRM chat panel (photos still work; video/audio play natively).
  fastify.get(
    '/:recordId/file/:fileId/signed-url',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { recordId, fileId } = request.params as {
        recordId: string;
        fileId: string;
      };
      if (!fileId || fileId.length < 8) {
        return reply.code(400).send({ error: 'Invalid file id' });
      }

      const prisma = fastify.prisma;
      const target = await findCrmChatTarget(prisma, tenantId, recordId);
      if (!target) return reply.code(404).send({ error: 'Not found' });

      const attCtx = await findAttachmentContext(prisma, {
        tenantId,
        recordId,
        fileId,
      });
      const bot = await prisma.botInstance.findFirst({
        where: {
          id: attCtx?.botInstanceId || target.botInstanceId,
          tenantId,
          status: 'active',
        },
      });
      if (!bot) return reply.code(404).send({ error: 'Bot not found' });

      const storedMeta = attCtx
        ? {
            mimeType: attCtx.mimeType,
            fileName: attCtx.fileName,
            type: attCtx.type,
          }
        : await lookupStoredAttachmentMeta(prisma, {
            tenantId,
            recordId,
            fileId,
          });
      const mediaToken = mintMediaToken({
        tenantId,
        recordId,
        fileId,
        botId: bot.id,
      });
      const hintType =
        storedMeta?.mimeType ||
        (storedMeta?.type === 'video' || storedMeta?.type === 'animation'
          ? 'video/mp4'
          : storedMeta?.type === 'voice' || storedMeta?.type === 'audio'
            ? 'audio/ogg'
            : storedMeta?.type === 'photo' || storedMeta?.type === 'sticker'
              ? 'image/jpeg'
              : undefined);
      return reply.send({
        url: `${publicApiBase()}/api/crm/chat/media/${mediaToken}`,
        expiresIn: MEDIA_URL_TTL_SEC,
        contentType: hintType || null,
        fileName: storedMeta?.fileName || null,
      });
    },
  );

  // Proxy Telegram / GramJS / WA file for CRM chat preview (auth + tenant-scoped)
  fastify.get(
    '/:recordId/file/:fileId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { recordId, fileId } = request.params as {
        recordId: string;
        fileId: string;
      };
      if (!fileId || fileId.length < 8) {
        return reply.code(400).send({ error: 'Invalid file id' });
      }

      const result = await resolveCrmMediaBuffer({ tenantId, recordId, fileId });
      if ('error' in result) {
        return reply.code(result.status).send({ error: result.error });
      }
      return sendMediaBuffer(reply, request, result);
    },
  );

  fastify.post(
    '/:recordId/reply',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canReply(user)) return reply.code(403).send({ error: 'Forbidden' });

      const { recordId } = request.params as { recordId: string };

      let text = '';
      let fileBuffer: Buffer | null = null;
      let filename = 'upload.bin';
      let mimeType = 'application/octet-stream';

      const contentType = String(request.headers['content-type'] || '');
      let preferredConversationId: string | null = null;
      let preferredGiftId: string | null = null;
      let sendFromBotId: string | null = null;

      if (contentType.includes('multipart/form-data')) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            fileBuffer = await part.toBuffer();
            filename = part.filename || filename;
            mimeType = part.mimetype || mimeType;
          } else if (part.type === 'field') {
            if (part.fieldname === 'text') text = String(part.value || '');
            if (part.fieldname === 'conversationId') {
              preferredConversationId = String(part.value || '') || null;
            }
            if (part.fieldname === 'giftSubscriberId') {
              preferredGiftId = String(part.value || '') || null;
            }
            if (part.fieldname === 'sendFromBotId') {
              sendFromBotId = String(part.value || '') || null;
            }
          }
        }
        const q = request.query as {
          conversationId?: string;
          giftSubscriberId?: string;
          sendFromBotId?: string;
        };
        if (!preferredConversationId && typeof q.conversationId === 'string') {
          preferredConversationId = q.conversationId;
        }
        if (!preferredGiftId && typeof q.giftSubscriberId === 'string') {
          preferredGiftId = q.giftSubscriberId;
        }
        if (!sendFromBotId && typeof q.sendFromBotId === 'string') {
          sendFromBotId = q.sendFromBotId;
        }
      } else {
        const body = z
          .object({
            text: z.string().max(4000).optional(),
            message: z.string().max(4000).optional(),
            content: z.string().max(4000).optional(),
            conversationId: z.string().min(10).optional(),
            giftSubscriberId: z.string().min(10).optional(),
            sendFromBotId: z.string().min(10).optional(),
          })
          .safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
        text = (body.data.text || body.data.message || body.data.content || '').trim();
        preferredConversationId = body.data.conversationId || null;
        preferredGiftId = body.data.giftSubscriberId || null;
        sendFromBotId = body.data.sendFromBotId || null;
      }

      text = text.trim();
      if (!text && !fileBuffer?.length) {
        return reply.code(400).send({ error: 'Нужен текст или файл' });
      }
      if (text.length > 4000) {
        return reply.code(400).send({ error: 'Текст слишком длинный' });
      }

      const prisma = fastify.prisma;
      const baseTarget = await findCrmChatTarget(prisma, tenantId, recordId, {
        conversationId: preferredConversationId,
        giftSubscriberId: preferredGiftId,
      });
      if (!baseTarget) {
        return reply.code(404).send({ error: 'No chat linked to this CRM record' });
      }

      let bot = await prisma.botInstance.findFirst({
        where: { id: baseTarget.botInstanceId, tenantId, status: 'active' },
      });
      if (!bot) {
        return reply.code(404).send({ error: 'Bot not found or inactive' });
      }

      // Outbound identity — defaults to the active thread bot (unchanged path).
      let target: CrmChatTarget = { ...baseTarget };
      let gramjsPhoneE164: string | null = null;
      /** Phase 5.2 write-first (MAX): bridge resolves the peer from this phone at send-time. */
      let maxResolvePhone: string | null = null;
      if (sendFromBotId && sendFromBotId !== baseTarget.botInstanceId) {
        const altBot = await prisma.botInstance.findFirst({
          where: { id: sendFromBotId, tenantId, status: 'active' },
        });
        if (!altBot) {
          return reply.code(404).send({ error: 'Выбранный аккаунт не найден или неактивен' });
        }
        const resolved = await resolveOutboundPeer({
          prisma,
          tenantId,
          recordId,
          bot: altBot,
          baseTarget,
        });
        if (!resolved.ok) {
          return reply.code(400).send({ error: resolved.error });
        }
        bot = altBot;
        gramjsPhoneE164 = resolved.phoneE164 || null;
        maxResolvePhone = resolved.maxResolvePhone || null;
        target = {
          source: resolved.giftSubscriberId ? 'gift_subscriber' : 'conversation',
          telegramId: resolved.peerId,
          username: resolved.username,
          firstName: resolved.firstName,
          conversationId: resolved.conversationId,
          twentyPersonId: resolved.twentyPersonId,
          twentyOpportunityId: resolved.twentyOpportunityId,
          botInstanceId: altBot.id,
          giftSubscriberId: resolved.giftSubscriberId,
          businessConnectionId: resolved.businessConnectionId,
          updatedAt: new Date(),
        };
      } else if (bot.botType === 'ai_gramjs' && target.twentyPersonId) {
        // Same-bot GramJS send may still need phone to resolve peer entity.
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { twentyWorkspaceId: true },
        });
        if (tenant?.twentyWorkspaceId) {
          const socialPeer = await resolvePersonTelegramPeerFromTwentyDb(
            tenant.twentyWorkspaceId,
            target.twentyPersonId,
          );
          gramjsPhoneE164 = socialPeer?.phoneE164 || null;
        }
      }

      const isGramjs = bot.botType === 'ai_gramjs';
      const isMax = bot.botType === 'ai_max';
      const isGiftMax = bot.botType === 'gift_max';
      const isWhatsapp = bot.botType === 'ai_wa';
      if (isGiftMax && fileBuffer?.length) {
        return reply
          .code(400)
          .send({ error: 'Вложения из CRM для MAX gift-бота пока не поддерживаются' });
      }
      if (!isGramjs && !isMax && !isWhatsapp && !bot.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Bot not found or inactive' });
      }
      if (isGramjs && !bot.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Личный Telegram не подключён (нет сессии)' });
      }
      if (isMax && !bot.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Личный MAX не подключён (нет сессии)' });
      }
      if (isWhatsapp && !bot.botTokenEncrypted) {
        return reply.code(404).send({ error: 'WhatsApp не подключён (нет сессии)' });
      }

      let chatId = target.telegramId;
      const bizId = target.businessConnectionId;

      let attachments: ChatAttachment[] = [];
      try {
        if (isGramjs) {
          fireGramjsPresence({
            botId: bot.id,
            peerUserId: chatId,
            kind: 'read',
          });
          fireGramjsPresence({
            botId: bot.id,
            peerUserId: chatId,
            kind: 'typing',
          });
          if (fileBuffer?.length) {
            const kind = detectUploadKind(mimeType, filename);
            const effectiveMime =
              kind === 'video' && !mimeType.startsWith('video/')
                ? 'video/mp4'
                : kind === 'photo' && !mimeType.startsWith('image/')
                  ? 'image/jpeg'
                  : mimeType;
            const sent = await sendViaGramjsBridge({
              botId: bot.id,
              peerUserId: chatId,
              text: text || '',
              phone: gramjsPhoneE164,
              username: target.username,
              media: {
                mediaBase64: fileBuffer.toString('base64'),
                mimeType: effectiveMime,
                fileName: filename,
              },
            });
            if (sent) attachments = [sent];
            if (!text) {
              text =
                kind === 'photo'
                  ? '[фото]'
                  : kind === 'video'
                    ? '[видео]'
                    : `[файл: ${filename}]`;
            }
          } else {
            await sendViaGramjsBridge({
              botId: bot.id,
              peerUserId: chatId,
              text,
              phone: gramjsPhoneE164,
              username: target.username,
            });
          }
        } else if (isMax) {
          // Write-first: no peer id yet — bridge resolves it from the phone.
          if (!chatId && !maxResolvePhone) {
            return reply.code(400).send({
              error: 'Нет peer MAX для отправки — нужен телефон в карточке или диалог MAX.',
            });
          }
          if (target.conversationId) {
            const recentInbound = await prisma.chatMessage.findMany({
              where: {
                conversationId: target.conversationId,
                role: 'user',
                externalMessageId: { not: null },
              },
              orderBy: { sentAt: 'desc' },
              take: 5,
              select: { externalMessageId: true },
            });
            fireMaxPresence({
              botId: bot.id,
              peerUserId: chatId,
              kind: 'read',
              messageIds: recentInbound
                .map((m) => m.externalMessageId)
                .filter((id): id is string => Boolean(id)),
            });
          }
          if (fileBuffer?.length) {
            const kind = detectUploadKind(mimeType, filename);
            // Browser often sends application/octet-stream for .mp4 — force video mime
            // so max-bridge uploads Video (not File) and stores type=video.
            const effectiveMime =
              kind === 'video' && !mimeType.startsWith('video/')
                ? 'video/mp4'
                : kind === 'photo' && !mimeType.startsWith('image/')
                  ? 'image/jpeg'
                  : mimeType;
            const result = await sendViaMaxBridge({
              botId: bot.id,
              peerUserId: chatId,
              resolvePhone: chatId ? null : maxResolvePhone,
              text: text || '',
              media: {
                mediaBase64: fileBuffer.toString('base64'),
                mimeType: effectiveMime,
                fileName: filename,
              },
            });
            if (!chatId && result.chatId) chatId = result.chatId;
            const sent = result.attachment;
            if (sent) {
              // Prefer UI type from filename/mime if bridge still returned document.
              const storedType =
                kind === 'video' && sent.type === 'document' ? 'video' : sent.type;
              attachments = [
                {
                  ...sent,
                  type: storedType,
                  mimeType:
                    storedType === 'video' && !sent.mimeType?.startsWith('video/')
                      ? 'video/mp4'
                      : sent.mimeType,
                },
              ];
            }
            if (!text) {
              text =
                kind === 'photo'
                  ? '[фото]'
                  : kind === 'video'
                    ? '[видео]'
                    : `[файл: ${filename}]`;
            }
          } else {
            const result = await sendViaMaxBridge({
              botId: bot.id,
              peerUserId: chatId,
              resolvePhone: chatId ? null : maxResolvePhone,
              text,
            });
            if (!chatId && result.chatId) chatId = result.chatId;
          }
        } else if (isGiftMax) {
          const token = decrypt(bot.botTokenEncrypted!);
          const maxBase = (
            process.env.MAX_BOT_API_URL || 'https://platform-api2.max.ru'
          ).replace(/\/$/, '');
          const url = new URL(`${maxBase}/messages`);
          url.searchParams.set('user_id', String(chatId));
          const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              Authorization: token,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: text || '[файл]' }),
          });
          const json = (await res.json().catch(() => ({}))) as {
            success?: boolean;
            message?: string;
            error?: string;
          };
          if (!res.ok || json.success === false) {
            throw new Error(json.message || json.error || `MAX send HTTP ${res.status}`);
          }
        } else if (isWhatsapp) {
          // Worker marks read + types + may split multi-bubble text.
          if (fileBuffer?.length) {
            const kind = detectUploadKind(mimeType, filename);
            // Browser often sends application/octet-stream — force real media mime
            // so worker stores type=photo|video (parity with MAX INC-112 path).
            const effectiveMime =
              kind === 'video' && !mimeType.startsWith('video/')
                ? 'video/mp4'
                : kind === 'photo' && !mimeType.startsWith('image/')
                  ? 'image/jpeg'
                  : mimeType;
            const sent = await sendViaWhatsappWorker({
              botId: bot.id,
              peerUserId: chatId,
              text,
              media: {
                mediaBase64: fileBuffer.toString('base64'),
                mimeType: effectiveMime,
                fileName: filename,
              },
            });
            if (sent) attachments = [sent];
            if (!text) {
              text =
                kind === 'photo'
                  ? '[фото]'
                  : kind === 'video'
                    ? '[видео]'
                    : `[файл: ${filename}]`;
            }
          } else {
            await sendViaWhatsappWorker({
              botId: bot.id,
              peerUserId: chatId,
              text,
            });
          }
        } else {
          const token = decrypt(bot.botTokenEncrypted!);
          const botApi = `https://api.telegram.org/bot${token}`;
          if (bizId) {
            // Fast fail with RU copy when Telegram Business lacks reply rights (INC-054).
            const link = await prisma.conversation.findFirst({
              where: {
                tenantId,
                botInstanceId: bot.id,
                channel: 'telegram_business_account',
                businessConnectionId: bizId,
              },
              select: { status: true },
            });
            if (link?.status === 'closed') {
              throw new Error('BUSINESS_CONNECTION_INVALID');
            }
            if (link?.status === 'limited') {
              throw new Error('can_reply=false');
            }
            await assertBusinessCanReply(botApi, bizId);
          }
          void sendTelegramTyping(botApi, chatId, bizId);
          if (bizId && target.conversationId) {
            const recentInbound = await prisma.chatMessage.findMany({
              where: {
                conversationId: target.conversationId,
                role: 'user',
                externalMessageId: { not: null },
              },
              orderBy: { sentAt: 'desc' },
              take: 5,
              select: { externalMessageId: true },
            });
            void readTelegramBusinessMessages({
              botApi,
              chatId,
              businessConnectionId: bizId,
              messageIds: recentInbound
                .map((m) => m.externalMessageId)
                .filter((id): id is string => Boolean(id)),
            });
          }
          if (fileBuffer?.length) {
            const kind = detectUploadKind(mimeType, filename);
            const sent = await sendTelegramMedia({
              botApi,
              chatId,
              kind,
              buffer: fileBuffer,
              filename,
              mimeType,
              caption: text || undefined,
              businessConnectionId: bizId,
            });
            attachments = [sent];
            if (!text) {
              text =
                kind === 'photo'
                  ? '[фото]'
                  : kind === 'video'
                    ? '[видео]'
                    : `[файл: ${filename}]`;
            }
          } else {
            await sendTelegramText(botApi, chatId, text, bizId);
          }
        }
      } catch (err) {
        const raw = err instanceof Error ? err.message : 'Send failed';
        const message = humanizeCrmChatSendError(raw);
        request.log.warn(
          { err, botId: bot.id, botType: bot.botType, chatId, isGramjs, isWhatsapp, raw },
          'CRM chat reply send failed',
        );
        return reply.code(400).send({ error: message });
      }

      let conversationId = target.conversationId;
      if (!conversationId) {
        const conversation = await prisma.conversation.create({
          data: {
            tenantId,
            botInstanceId: bot.id,
            platform: isWhatsapp ? 'whatsapp' : isMax || isGiftMax ? 'max' : 'telegram',
            // Write-first MAX: peer id becomes known only after the bridge resolved it.
            platformUserId: chatId || target.telegramId,
            platformUsername: target.username,
            platformFirstName: target.firstName,
            status: 'open',
            // Keep AI mode; CRM reply only pauses via pausedUntil (ADR-014 handoff).
            mode: 'ai',
            channel: isGramjs
              ? 'telegram_gramjs'
              : isMax
                ? 'max_personal'
                : isGiftMax
                  ? 'max_gift'
                  : isWhatsapp
                    ? 'whatsapp'
                    : bot.botType === 'ai_tg'
                      ? 'telegram_business'
                      : undefined,
            businessConnectionId: bizId || undefined,
            twentyPersonId: target.twentyPersonId || undefined,
            twentyOpportunityId: target.twentyOpportunityId || undefined,
          },
        });
        conversationId = conversation.id;
        if (target.giftSubscriberId) {
          await prisma.giftSubscriber.update({
            where: { id: target.giftSubscriberId },
            data: { conversationId },
          });
        }
      }

      const operatorLabel = await resolveOperatorLabel({
        prisma,
        tenantId,
        user,
        headers: request.headers as Record<string, unknown>,
      });
      const storedAttachments = [
        ...attachments,
        { type: 'sender_meta', label: operatorLabel },
      ];
      // WA/Evolution media preview uses message key id as fileId — persist for
      // getBase64FromMediaMessage lookup (convertToMp4 / fromMe hints).
      const outboundExternalId =
        isWhatsapp && attachments[0]?.fileId
          ? attachments[0].fileId
          : undefined;

      const message = await prisma.chatMessage.create({
        data: {
          conversationId,
          role: 'operator',
          content: text,
          attachments: storedAttachments,
          ...(outboundExternalId
            ? { externalMessageId: outboundExternalId }
            : {}),
        },
      });
      // AI stays on until manual pause/off (CRM buttons / /pause / /off).
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { updatedAt: new Date() },
      });
      if (target.giftSubscriberId) {
        await prisma.giftSubscriber.update({
          where: { id: target.giftSubscriberId },
          data: { lastMessageAt: new Date() },
        });
      }

      if (target.twentyPersonId) {
        try {
          const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
          const owner = await prisma.tenantMember.findFirst({
            where: { tenantId, role: 'owner' },
            include: { user: true },
          });
          if (
            tenant?.twentyWorkspaceId &&
            tenant.twentyOwnerPasswordEncrypted &&
            owner?.user?.email
          ) {
            const client = new TwentyClient({
              apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
            });
            await client.authenticateWorkspace(
              owner.user.email,
              decrypt(tenant.twentyOwnerPasswordEncrypted),
              tenant.twentyWorkspaceId,
            );
            await client.createNoteForPerson({
              personId: target.twentyPersonId,
              title: isWhatsapp ? 'Ответ оператора (WhatsApp)' : 'Ответ оператора (Telegram)',
              body: text,
            });
            const oppId =
              target.twentyOpportunityId ||
              (
                await prisma.conversation.findUnique({
                  where: { id: conversationId },
                  select: { twentyOpportunityId: true },
                })
              )?.twentyOpportunityId;
            if (oppId) {
              await client.touchOpportunityActivity(oppId);
            }
          }
        } catch (err) {
          request.log.warn({ err }, 'Failed to mirror CRM reply note');
        }
      } else if (target.twentyOpportunityId) {
        try {
          const { touchOpportunityFromConversation } = await import(
            '../services/sync-opportunity-chat-activity.js'
          );
          await touchOpportunityFromConversation({
            prisma,
            tenantId,
            conversationId,
          });
        } catch {
          /* ignore */
        }
      }

      // Timeline sync (Phase 5.3) — enqueue chat_outbound
      const outboundPhone = gramjsPhoneE164 || maxResolvePhone;
      const phoneFp = outboundPhone
        ? phoneFingerprint(normalizePhoneToE164(outboundPhone))
        : null;
      void enqueueTimelineSync({
        tenantId,
        twentyPersonId: target.twentyPersonId || null,
        phoneFingerprint: phoneFp ?? null,
        kind: 'chat_outbound',
        channel: bot.botType,
        title: `Исходящее (оператор): ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`,
        description: text,
        meta: {
          conversationId,
          operatorLabel,
          botId: bot.id,
          botType: bot.botType,
        },
        conversationId,
        messageId: message.id,
      });

      return reply.send({
        ok: true,
        botId: bot.id,
        conversationId,
        message: {
          id: message.id,
          role: message.role,
          content: message.content,
          attachments,
          sentAt: message.sentAt,
        },
      });
    },
  );
};
