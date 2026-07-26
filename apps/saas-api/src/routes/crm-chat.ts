// CRM chat: messages + formatted reply + media by Twenty Opportunity or Person id
// Auth: portal JWT or short-lived crm-chat JWT from /api/tenant/crm-login
// Also: GiftSubscriber (gift bot) OR Conversation (ai_tg / ai_gramjs) CRM links.

import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { decrypt } from '@voxly/crypto';
import { clientMdToMarkdownV2, AI_HANDOFF_PAUSE_MS } from '@voxly/shared';
import { TwentyClient } from '@voxly/twenty-client';

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
      : botType === 'ai_tg'
        ? 'telegram_business'
        : botType === 'ai_wa'
          ? 'whatsapp'
          : botType === 'gift'
            ? 'telegram_gift'
            : opts.channel || 'telegram';
  const channelLabel =
    channelKind === 'telegram_gramjs'
      ? 'Telegram · личный аккаунт'
      : channelKind === 'telegram_business'
        ? 'Telegram · Business-бот'
        : channelKind === 'whatsapp'
          ? 'WhatsApp'
          : channelKind === 'telegram_gift'
            ? 'Telegram · бот подарков'
            : 'Telegram';
  let identityLabel = 'бот';
  if (botType === 'ai_wa') {
    identityLabel =
      opts.displayName ||
      (opts.phoneNumberId ? `+${opts.phoneNumberId}` : null) ||
      opts.botUsername ||
      'WhatsApp';
  } else if (botType === 'ai_gramjs') {
    identityLabel = opts.botUsername
      ? `@${opts.botUsername}`
      : opts.phoneNumberId || 'личный аккаунт';
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
): Promise<CrmChatTarget[]> {
  const subscribers = await prisma.giftSubscriber.findMany({
    where: {
      tenantId,
      OR: [{ twentyOpportunityId: recordId }, { twentyPersonId: recordId }],
    },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: 20,
  });
  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId,
      botInstanceId: { not: null },
      channel: { not: 'telegram_business_account' },
      OR: [{ twentyOpportunityId: recordId }, { twentyPersonId: recordId }],
    },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  });

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
    if (!conversation.botInstanceId) continue;
    // Avoid duplicating gift-owned conversation rows
    if (giftConvIds.has(conversation.id)) continue;
    targets.push({
      source: 'conversation',
      telegramId: conversation.platformUserId,
      username: conversation.platformUsername,
      firstName: conversation.platformFirstName,
      conversationId: conversation.id,
      twentyPersonId: conversation.twentyPersonId,
      twentyOpportunityId: conversation.twentyOpportunityId,
      botInstanceId: conversation.botInstanceId,
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

async function findCrmChatTarget(
  prisma: FastifyInstance['prisma'],
  tenantId: string,
  recordId: string,
  preferred?: { conversationId?: string | null; giftSubscriberId?: string | null },
): Promise<CrmChatTarget | null> {
  const targets = await listCrmChatTargets(prisma, tenantId, recordId);
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

  return msg;
}

function gramjsBridgeBase(): string {
  return (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(/\/$/, '');
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
}): Promise<void> {
  const token = process.env.VOXLY_SERVICE_TOKEN || '';
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
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    error?: string;
  };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `GramJS send failed (HTTP ${res.status})`);
  }
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
  const token = process.env.VOXLY_SERVICE_TOKEN || '';
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
  const token = process.env.VOXLY_SERVICE_TOKEN || '';
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
  const token = process.env.VOXLY_SERVICE_TOKEN || '';
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
  const token = process.env.VOXLY_SERVICE_TOKEN || '';
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
      const allTargets = await listCrmChatTargets(prisma, tenantId, recordId);
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
      }

      const jwtUser = (request as any).user as { sub?: string; email?: string };
      let operatorName = 'Менеджер';
      if (jwtUser?.sub) {
        const dbUser = await prisma.user.findUnique({
          where: { id: jwtUser.sub },
          select: { firstName: true, lastName: true, email: true },
        });
        if (dbUser) operatorName = formatOperatorName(dbUser);
        else if (jwtUser.email) operatorName = formatOperatorName({ email: jwtUser.email });
      }

      const botIds = [...new Set(allTargets.map((t) => t.botInstanceId))];
      const bots = await prisma.botInstance.findMany({
        where: { tenantId, id: { in: botIds } },
        select: {
          id: true,
          botType: true,
          botUsername: true,
          displayName: true,
          phoneNumberId: true,
          botTokenEncrypted: true,
        },
      });
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

      const messages = conversationId
        ? await prisma.chatMessage.findMany({
            where: { conversationId },
            orderBy: { sentAt: 'asc' },
            take: 300,
          })
        : [];

      // Operator opened chat → mark inbound as read (best-effort). Typing only on send.
      if (botType === 'ai_wa') {
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
      } else if (botType === 'ai_gramjs') {
        fireGramjsPresence({
          botId: target.botInstanceId,
          peerUserId: target.telegramId,
          kind: 'read',
        });
      } else if (
        (botType === 'ai_tg' || botType === 'gift') &&
        bot?.botTokenEncrypted
      ) {
        try {
          const token = decrypt(bot.botTokenEncrypted);
          const botApi = `https://api.telegram.org/bot${token}`;
          void sendTelegramTyping(botApi, target.telegramId, target.businessConnectionId);
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

      const presence = await fetchContactPresence({
        botType,
        botId: target.botInstanceId,
        peerUserId: target.telegramId,
      });

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
        pausedUntil,
        aiAgentId,
        aiControls:
          Boolean(conversationId) &&
          (botType === 'ai_tg' ||
            botType === 'ai_wa' ||
            botType === 'ai_gramjs'),
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
        supportsAttachments: botType !== 'ai_gramjs',
        presence,
        threads,
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
          botInstanceId: target.botInstanceId,
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

  // Proxy Telegram file for CRM chat preview (auth + tenant-scoped)
  fastify.get(
    '/:recordId/file/:fileId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { recordId, fileId } = request.params as {
        recordId: string;
        fileId: string;
      };
      if (!fileId || fileId.length < 10) {
        return reply.code(400).send({ error: 'Invalid file id' });
      }

      const prisma = fastify.prisma;
      const target = await findCrmChatTarget(prisma, tenantId, recordId);
      if (!target) return reply.code(404).send({ error: 'Not found' });

      const bot = await prisma.botInstance.findFirst({
        where: { id: target.botInstanceId, tenantId, status: 'active' },
      });
      if (!bot?.botTokenEncrypted) return reply.code(404).send({ error: 'Bot not found' });
      if (bot.botType === 'ai_gramjs') {
        return reply
          .code(400)
          .send({ error: 'Превью файлов для личного Telegram пока не поддерживается' });
      }
      if (bot.botType === 'ai_wa') {
        return reply
          .code(400)
          .send({ error: 'Превью файлов для WhatsApp пока не поддерживается' });
      }

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
        return reply.code(404).send({ error: meta.description || 'File not found' });
      }

      const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) return reply.code(502).send({ error: 'Failed to fetch Telegram file' });

      const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
      const buf = Buffer.from(await fileRes.arrayBuffer());
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'private, max-age=300')
        .send(buf);
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
          }
        }
        const q = request.query as { conversationId?: string; giftSubscriberId?: string };
        if (!preferredConversationId && typeof q.conversationId === 'string') {
          preferredConversationId = q.conversationId;
        }
        if (!preferredGiftId && typeof q.giftSubscriberId === 'string') {
          preferredGiftId = q.giftSubscriberId;
        }
      } else {
        const body = z
          .object({
            text: z.string().max(4000).optional(),
            message: z.string().max(4000).optional(),
            content: z.string().max(4000).optional(),
            conversationId: z.string().min(10).optional(),
            giftSubscriberId: z.string().min(10).optional(),
          })
          .safeParse(request.body);
        if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
        text = (body.data.text || body.data.message || body.data.content || '').trim();
        preferredConversationId = body.data.conversationId || null;
        preferredGiftId = body.data.giftSubscriberId || null;
      }

      text = text.trim();
      if (!text && !fileBuffer?.length) {
        return reply.code(400).send({ error: 'Нужен текст или файл' });
      }
      if (text.length > 4000) {
        return reply.code(400).send({ error: 'Текст слишком длинный' });
      }

      const prisma = fastify.prisma;
      const target = await findCrmChatTarget(prisma, tenantId, recordId, {
        conversationId: preferredConversationId,
        giftSubscriberId: preferredGiftId,
      });
      if (!target) {
        return reply.code(404).send({ error: 'No chat linked to this CRM record' });
      }

      const bot = await prisma.botInstance.findFirst({
        where: { id: target.botInstanceId, tenantId, status: 'active' },
      });
      if (!bot) {
        return reply.code(404).send({ error: 'Bot not found or inactive' });
      }

      const isGramjs = bot.botType === 'ai_gramjs';
      const isWhatsapp = bot.botType === 'ai_wa';
      if (isGramjs && fileBuffer?.length) {
        return reply
          .code(400)
          .send({
            error: 'Вложения из CRM для личного Telegram пока не поддерживаются',
          });
      }
      if (!isGramjs && !isWhatsapp && !bot.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Bot not found or inactive' });
      }
      if (isGramjs && !bot.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Личный Telegram не подключён (нет сессии)' });
      }
      if (isWhatsapp && !bot.botTokenEncrypted) {
        return reply.code(404).send({ error: 'WhatsApp не подключён (нет сессии)' });
      }

      const chatId = target.telegramId;
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
          await sendViaGramjsBridge({
            botId: bot.id,
            peerUserId: chatId,
            text: text || '[файл]',
          });
        } else if (isWhatsapp) {
          // Worker marks read + types + may split multi-bubble text.
          if (fileBuffer?.length) {
            const kind = detectUploadKind(mimeType, filename);
            const sent = await sendViaWhatsappWorker({
              botId: bot.id,
              peerUserId: chatId,
              text,
              media: {
                mediaBase64: fileBuffer.toString('base64'),
                mimeType,
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
            platform: isWhatsapp ? 'whatsapp' : 'telegram',
            platformUserId: target.telegramId,
            platformUsername: target.username,
            platformFirstName: target.firstName,
            status: 'open',
            // Keep AI mode; CRM reply only pauses via pausedUntil (ADR-014 handoff).
            mode: 'ai',
            channel: isGramjs
              ? 'telegram_gramjs'
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

      const operatorUser = user?.sub
        ? await prisma.user.findUnique({
            where: { id: user.sub },
            select: { firstName: true, lastName: true, email: true },
          })
        : null;
      const operatorLabel = formatOperatorName(
        operatorUser || { email: user?.email || null },
      );
      const storedAttachments = [
        ...attachments,
        { type: 'sender_meta', label: operatorLabel },
      ];

      const message = await prisma.chatMessage.create({
        data: {
          conversationId,
          role: 'operator',
          content: text,
          attachments: storedAttachments,
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
          }
        } catch (err) {
          request.log.warn({ err }, 'Failed to mirror CRM reply note');
        }
      }

      return reply.send({
        ok: true,
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
