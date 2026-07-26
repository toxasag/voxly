// Voxly AI Telegram Worker
// Telegram Business + private bot AI: OpenRouter LLM, handoff pause/disable, human-like send.
// Webhooks arrive via gift-bot-worker forward for botType=ai_tg (path /tg/{tenantId}/{botId}).

import { prisma } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
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
import { TwentyClient } from '@voxly/twenty-client';
import {
  AI_HANDOFF_PAUSE_MS,
  AI_MODEL_DEFAULTS,
  isAiConversationMode,
  PRICING,
} from '@voxly/shared';
import OpenAI from 'openai';

const PORT = 3005;
const OPENROUTER_API_KEY =
  process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '';
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const CONTEXT_WINDOW = 20;
const AI_WORKER_URL = process.env.AI_TELEGRAM_WORKER_URL || '';
const AI_INBOUND_DEBOUNCE_MS = Math.max(
  500,
  Number(process.env.AI_INBOUND_DEBOUNCE_MS || DEFAULT_INBOUND_DEBOUNCE_MS) ||
    DEFAULT_INBOUND_DEBOUNCE_MS,
);

if (!OPENROUTER_API_KEY) {
  console.warn(
    '[ai-telegram] OPENROUTER_API_KEY / OPENAI_API_KEY not set — AI replies disabled',
  );
}

const openai = new OpenAI({
  apiKey: OPENROUTER_API_KEY || 'missing',
  baseURL: OPENROUTER_BASE_URL,
  defaultHeaders: {
    'HTTP-Referer': process.env.VOXLY_PUBLIC_URL || 'https://getvoxly.ru',
    'X-Title': 'Voxly AI Telegram',
  },
});

/** business_connection_id → owner telegram user id */
const businessOwnerByConnection = new Map<string, number>();

type TgAiPending = {
  botApi: string;
  tenantId: string;
  botId: string;
  chatId: number;
  telegramId: number;
  businessConnectionId?: string;
  displayText: string;
  messageId?: string;
};

const inboundAiDebouncer = createInboundDebouncer<TgAiPending>({
  settleMs: AI_INBOUND_DEBOUNCE_MS,
  onFlush: async (_key, items) => {
    const last = items[items.length - 1];
    if (!last) return;
    const messageIds = items
      .map((i) => i.messageId)
      .filter((id): id is string => Boolean(id));
    await flushTelegramAiReply(last, messageIds);
  },
});

const DEFAULT_SYSTEM_PROMPT = `Ты — живой менеджер в мессенджере. Пиши по-русски, коротко, как человек в чате.

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
- каждое message — одна мысль, до ~120 символов;
- пустые поля оставь "";
- без эмодзи, без переносов внутри строк.`;

const JSON_FORMAT_HINT = `

Ответь ТОЛЬКО JSON с message1…message4. Обычно заполни 2–4 пузыря, не склеивай всё в message1.`;

async function main() {
  const http = await import('node:http');
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/tg/')) {
      const parts = req.url.split('/').filter(Boolean);
      const tenantId = parts[1];
      const botId = parts[2]?.split('?')[0];

      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const update = JSON.parse(body);
        await handleTelegramUpdate(update, tenantId, botId);
        res.writeHead(200);
        res.end('ok');
      } catch (err) {
        console.error('[ai-telegram] Error:', err);
        res.writeHead(500);
        res.end('error');
      }
    } else if (req.method === 'POST' && req.url === '/internal/inbound') {
      // GramJS bridge → same AI path; returns bubbles (caller sends via MTProto).
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const auth = req.headers.authorization || '';
        const expected = process.env.VOXLY_SERVICE_TOKEN || '';
        if (!expected || auth !== `Bearer ${expected}`) {
          res.writeHead(401);
          res.end(JSON.stringify({ ok: false, error: 'unauthorized' }));
          return;
        }
        const payload = JSON.parse(body) as InternalInboundPayload;
        const result = await handleInternalInbound(payload);
        res.writeHead(result.ok ? 200 : 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('[ai-telegram] internal inbound error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'internal' }));
      }
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200);
      res.end('ok');
    } else {
      res.writeHead(404);
      res.end('not found');
    }
  });

  server.listen(PORT, () => {
    console.log(
      `[ai-telegram-worker] Listening on port ${PORT}` +
        (AI_WORKER_URL ? ` (self=${AI_WORKER_URL})` : ''),
    );
  });
}

type InternalInboundPayload = {
  tenantId: string;
  botId: string;
  platformUserId: string;
  text: string;
  firstName?: string;
  username?: string;
  /** E.164 or raw digits from GramJS User.phone / contact share. */
  phone?: string;
  externalMessageId?: string;
  channel?: string;
  /** When true (or sender is a TG bot), skip AI entirely. */
  isBot?: boolean;
};

/** Shared AI turn for GramJS (and other non-Bot-API channels). Does not send Telegram. */
async function handleInternalInbound(
  payload: InternalInboundPayload,
): Promise<{ ok: boolean; bubbles?: string[]; skipped?: string; error?: string }> {
  const {
    tenantId,
    botId,
    platformUserId,
    text,
    firstName,
    username,
    phone,
    externalMessageId,
  } = payload;
  if (!tenantId || !botId || !platformUserId || !text?.trim()) {
    return { ok: false, error: 'tenantId, botId, platformUserId, text required' };
  }

  if (payload.isBot === true) {
    return { ok: true, skipped: 'from_bot', bubbles: [] };
  }

  const bot = await prisma.botInstance.findFirst({
    where: {
      id: botId,
      tenantId,
      status: 'active',
      botType: { in: ['ai_tg', 'ai_gramjs'] },
    },
  });
  if (!bot) return { ok: false, error: 'bot not found' };

  const channel = payload.channel || 'telegram_gramjs';
  const conversation = await ensureConversation({
    tenantId,
    botId,
    platformUserId,
    username,
    firstName,
    channel,
  });

  // Always sync: validates stale Twenty ids after CRM wipe (INC-042).
  void syncLeadToCrm({
    tenantId,
    botId,
    conversationId: conversation.id,
    platformUserId,
    username,
    firstName,
    phone,
  }).catch((err) => console.warn('[ai-telegram] CRM lead sync failed', err));

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: text,
      externalMessageId: externalMessageId || undefined,
    },
  });
  const storedAt = new Date();

  if (!(await shouldAiReply(conversation.id))) {
    return { ok: true, skipped: 'ai_silent', bubbles: [] };
  }

  // Debounce: wait quiet window; only the last inbound in the burst generates.
  await sleep(AI_INBOUND_DEBOUNCE_MS);
  const newer = await prisma.chatMessage.count({
    where: {
      conversationId: conversation.id,
      role: 'user',
      createdAt: { gt: storedAt },
    },
  });
  if (newer > 0) {
    return { ok: true, skipped: 'debounced', bubbles: [] };
  }
  if (!(await shouldAiReply(conversation.id))) {
    return { ok: true, skipped: 'ai_silent', bubbles: [] };
  }

  if (!(await hasAiBalance(tenantId, 1))) {
    return { ok: true, skipped: 'no_balance', bubbles: [] };
  }
  if (!OPENROUTER_API_KEY) {
    return { ok: true, skipped: 'no_openrouter', bubbles: [] };
  }

  const { bubbles } = await generateAiBubbles({
    tenantId,
    conversationId: conversation.id,
    displayText: text,
  });
  return { ok: true, bubbles: normalizeAiBubbles(bubbles, 4) };
}

type TgMessage = {
  message_id: number;
  chat: {
    id: number;
    type?: string;
    first_name?: string;
    last_name?: string;
    username?: string;
    title?: string;
  };
  from?: { id: number; first_name?: string; username?: string; is_bot?: boolean };
  text?: string;
  caption?: string;
  voice?: { file_id: string };
  audio?: { file_id: string };
  photo?: Array<{ file_id: string }>;
  document?: { file_id: string; file_name?: string };
  contact?: {
    phone_number?: string;
    first_name?: string;
    last_name?: string;
    user_id?: number;
  };
  business_connection_id?: string;
};

async function handleTelegramUpdate(update: any, tenantId: string, botId: string) {
  const bot = await prisma.botInstance.findFirst({
    where: { id: botId, tenantId, status: 'active', botType: 'ai_tg' },
  });

  if (!bot || !bot.botTokenEncrypted) {
    console.warn(`[ai-telegram] Bot not found or inactive: ${botId}`);
    return;
  }

  const botToken = decrypt(bot.botTokenEncrypted);
  const botApi = `https://api.telegram.org/bot${botToken}`;

  if (update.business_connection) {
    await handleBusinessConnection(update.business_connection, tenantId, botId);
    return;
  }

  if (update.business_message) {
    await handleInboundMessage(update.business_message as TgMessage, botApi, tenantId, botId, true);
    return;
  }

  if (update.edited_business_message) {
    console.log(
      `[ai-telegram] edited_business_message ignored msg=${update.edited_business_message.message_id}`,
    );
    return;
  }

  if (update.deleted_business_messages) {
    console.log('[ai-telegram] deleted_business_messages ignored');
    return;
  }

  if (update.message) {
    await handleInboundMessage(update.message as TgMessage, botApi, tenantId, botId, false);
    return;
  }

  if (update.callback_query) {
    await handleCallback(update, botApi, tenantId, botId);
  }
}

async function handleBusinessConnection(conn: any, tenantId: string, botId: string) {
  const connectionId = String(conn.id);
  const ownerId = Number(conn.user?.id);
  const ownerUsername = conn.user?.username as string | undefined;
  const ownerFirstName = conn.user?.first_name as string | undefined;
  if (connectionId && ownerId) {
    businessOwnerByConnection.set(connectionId, ownerId);
  }

  const enabled = conn.is_enabled !== false;
  console.log(
    `[ai-telegram] business_connection id=${connectionId} enabled=${enabled} owner=${ownerId} @${ownerUsername || ''} tenant=${tenantId} bot=${botId}`,
  );

  // Registry row for portal «Business-аккаунты» (not a customer dialog).
  await upsertBusinessAccountLink({
    tenantId,
    botId,
    connectionId,
    ownerId: ownerId || 0,
    ownerUsername,
    ownerFirstName,
    enabled,
    canReply: conn.can_reply === true,
  });

  if (!enabled) {
    await prisma.conversation.updateMany({
      where: {
        tenantId,
        botInstanceId: botId,
        businessConnectionId: connectionId,
        channel: { not: 'telegram_business_account' },
      },
      data: { status: 'closed' },
    });
    return;
  }

  if (conn.can_reply !== true) {
    console.warn(
      `[ai-telegram] business connection ${connectionId} has can_reply=false — enable reply/read rights in Telegram Business automation or inbound/CRM will not work`,
    );
  }

  const max = PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS;
  const existing = await prisma.conversation.groupBy({
    by: ['businessConnectionId'],
    where: {
      tenantId,
      botInstanceId: botId,
      businessConnectionId: { not: null },
      status: { not: 'closed' },
      channel: { not: 'telegram_business_account' },
    },
  });
  const knownIds = new Set(
    existing.map((r) => r.businessConnectionId).filter(Boolean) as string[],
  );
  if (!knownIds.has(connectionId) && knownIds.size >= max) {
    console.warn(
      `[ai-telegram] business connection limit (${max}) reached for bot=${botId}; new connection=${connectionId} will not get AI`,
    );
  }
}

/** Persist which Telegram Business accounts are linked to this bot (for portal list). */
async function upsertBusinessAccountLink(opts: {
  tenantId: string;
  botId: string;
  connectionId: string;
  ownerId: number;
  ownerUsername?: string;
  ownerFirstName?: string;
  enabled: boolean;
  canReply?: boolean;
}) {
  if (!opts.connectionId || !opts.ownerId) return;
  const existing = await prisma.conversation.findFirst({
    where: {
      tenantId: opts.tenantId,
      botInstanceId: opts.botId,
      channel: 'telegram_business_account',
      businessConnectionId: opts.connectionId,
    },
  });
  // status: closed = disconnected; limited = connected but no reply rights; open = OK
  let status = !opts.enabled
    ? 'closed'
    : opts.canReply === false
      ? 'limited'
      : 'open';

  if (!existing && status !== 'closed') {
    const { getAiTgBusinessCapacity, PRODUCT_CODES } = await import('@voxly/shared');
    const addon = await prisma.addon.findUnique({
      where: {
        tenantId_type: { tenantId: opts.tenantId, type: PRODUCT_CODES.AI_TELEGRAM },
      },
      select: { config: true },
    });
    const capacity = getAiTgBusinessCapacity(addon?.config);
    const activeCount = await prisma.conversation.count({
      where: {
        tenantId: opts.tenantId,
        botInstanceId: opts.botId,
        channel: 'telegram_business_account',
        status: { not: 'closed' },
      },
    });
    if (activeCount >= capacity) {
      console.warn(
        `[ai-telegram] Business capacity full (${activeCount}/${capacity}) for bot ${opts.botId}; refusing new connection ${opts.connectionId}`,
      );
      return;
    }
  }

  const data = {
    platformUserId: String(opts.ownerId),
    platformUsername: opts.ownerUsername?.replace(/^@/, '') || null,
    platformFirstName: opts.ownerFirstName || null,
    status,
    mode: 'human' as const,
    aiDisabled: true,
    channel: 'telegram_business_account',
    businessConnectionId: opts.connectionId,
  };
  if (existing) {
    await prisma.conversation.update({ where: { id: existing.id }, data });
  } else {
    await prisma.conversation.create({
      data: {
        tenantId: opts.tenantId,
        botInstanceId: opts.botId,
        platform: 'telegram',
        ...data,
      },
    });
  }
}

async function resolveBusinessOwnerId(
  botApi: string,
  businessConnectionId: string | undefined,
): Promise<number | null> {
  if (!businessConnectionId) return null;
  const cached = businessOwnerByConnection.get(businessConnectionId);
  if (cached) return cached;

  try {
    const res = await fetch(
      `${botApi}/getBusinessConnection?business_connection_id=${encodeURIComponent(businessConnectionId)}`,
    );
    const data = (await res.json()) as any;
    const ownerId = Number(data?.result?.user?.id);
    if (data?.ok && ownerId) {
      businessOwnerByConnection.set(businessConnectionId, ownerId);
      return ownerId;
    }
  } catch (err) {
    console.warn('[ai-telegram] getBusinessConnection failed:', err);
  }
  return null;
}

async function handleInboundMessage(
  message: TgMessage,
  botApi: string,
  tenantId: string,
  botId: string,
  isBusiness: boolean,
) {
  const chatId = message.chat.id;
  const from = message.from;
  if (!from) return;

  // Never reply to / converse with Telegram bots (is_bot from Bot API).
  if (from.is_bot === true) {
    console.log(
      `[ai-telegram] skip inbound from bot id=${from.id} @${from.username || '-'}`,
    );
    return;
  }

  const businessConnectionId = message.business_connection_id;
  const channel = isBusiness || businessConnectionId ? 'telegram_business' : 'telegram_private';

  // Human outbound from Business owner phone → auto-pause ~1h
  if (isBusiness && businessConnectionId) {
    const ownerId = await resolveBusinessOwnerId(botApi, businessConnectionId);
    if (ownerId && from.id === ownerId) {
      // Peer is chat.*, not from.* (from is the business owner).
      const peerFirst =
        [message.chat.first_name, message.chat.last_name].filter(Boolean).join(' ') ||
        message.chat.title ||
        undefined;
      await pauseOnHumanOutbound({
        tenantId,
        botId,
        platformUserId: String(chatId),
        businessConnectionId,
        content: message.text || message.caption || '[media]',
        externalMessageId: String(message.message_id),
        firstName: peerFirst,
        username: message.chat.username,
      });
      return;
    }
  }

  const needsMediaPipeline =
    !!(message.voice || message.audio || (message.photo?.length && !message.caption));
  if (needsMediaPipeline && OPENROUTER_API_KEY) {
    void sendHumanLike({ botApi, chatId, bubbles: ['Секунду…'], businessConnectionId }).catch(() => {});
  }

  const textOrMedia = await extractInboundText(message, botApi, tenantId);
  const text = textOrMedia.text;
  const mediaPlaceholder = textOrMedia.mediaPlaceholder;

  if (!text && !mediaPlaceholder) return;

  const displayText = text || mediaPlaceholder || '[сообщение]';
  const telegramId = from.id;
  const firstName = from.first_name;
  const username = from.username;
  // Contact share (collect_phone / user card) — prefer when user_id matches sender.
  const contactPhone =
    message.contact?.phone_number &&
    (!message.contact.user_id || message.contact.user_id === from.id)
      ? message.contact.phone_number
      : undefined;

  if (text === '/start') {
    await sendHumanLike({ botApi, chatId, bubbles: ['Привет! Чем могу помочь?'], businessConnectionId });
    await fireGoal({
      tenantId,
      goalName: 'ai_bot_start',
      subscriberId: String(telegramId),
    });
    return;
  }

  if (text === '/mode') {
    await showModeSelector(botApi, chatId, businessConnectionId);
    return;
  }

  if (text === '/handoff' || text === '/human') {
    await switchToHuman(botApi, chatId, tenantId, telegramId, businessConnectionId);
    return;
  }

  if (text === '/ai' || text === '/resume') {
    await switchToAi(botApi, chatId, tenantId, telegramId, businessConnectionId);
    return;
  }

  if (text === '/pause') {
    await pauseConversation(tenantId, botId, String(telegramId), AI_HANDOFF_PAUSE_MS);
    await sendHumanLike({
      botApi,
      chatId,
      bubbles: ['AI на паузе примерно на час. /ai — снова включить.'],
      businessConnectionId,
    });
    return;
  }

  if (text === '/off') {
    await setAiDisabled(tenantId, botId, String(telegramId), true);
    await sendHumanLike({
      botApi,
      chatId,
      bubbles: ['AI выключен. /ai — включить снова.'],
      businessConnectionId,
    });
    return;
  }

  const conversation = await ensureConversation({
    tenantId,
    botId,
    platformUserId: String(telegramId),
    username,
    firstName,
    channel,
    businessConnectionId,
  });

  // Always sync: validates stale Twenty ids after CRM wipe (INC-042).
  const businessAccountLabel = await resolveBusinessAccountLabel(
    tenantId,
    botId,
    businessConnectionId,
  );
  void syncLeadToCrm({
    tenantId,
    botId,
    conversationId: conversation.id,
    platformUserId: String(telegramId),
    username,
    firstName,
    phone: contactPhone,
    businessAccountLabel: businessAccountLabel || undefined,
  }).catch((err) => console.warn('[ai-telegram] CRM lead sync failed', err));

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: displayText,
      externalMessageId: String(message.message_id),
      attachments: mediaPlaceholder
        ? [{ type: 'stub', note: mediaPlaceholder }]
        : undefined,
    },
  });

  if (!(await shouldAiReply(conversation.id))) {
    if (!isAiConversationMode(conversation.mode) || conversation.aiDisabled) {
      await notifyHumanOperator(tenantId, conversation.id, displayText);
    }
    return;
  }

  // Debounce AI: wait for quiet period after burst of short messages.
  // Mark read immediately (like a person opening the chat), then wait to reply.
  if (businessConnectionId && message.message_id) {
    void markTelegramRead(
      botApi,
      chatId,
      [String(message.message_id)],
      businessConnectionId,
    );
  }
  inboundAiDebouncer.push(conversation.id, {
    botApi,
    tenantId,
    botId,
    chatId,
    telegramId,
    businessConnectionId,
    displayText,
    messageId: String(message.message_id),
  });
}

async function flushTelegramAiReply(pending: TgAiPending, messageIds: string[] = []) {
  const {
    botApi,
    tenantId,
    botId,
    chatId,
    telegramId,
    businessConnectionId,
    displayText,
  } = pending;

  const conversation = await prisma.conversation.findFirst({
    where: {
      tenantId,
      botInstanceId: botId,
      platformUserId: String(telegramId),
      status: { in: ['open', 'waiting_for_human'] },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!conversation || !(await shouldAiReply(conversation.id))) return;

  const hasBalance = await hasAiBalance(tenantId, 1);
  if (!hasBalance) {
    await sendHumanLike({
      botApi,
      chatId,
      bubbles: [
        'Баланс AI исчерпан. Пополните в кабинете. Переключаю на оператора.',
      ],
      businessConnectionId,
    });
    await switchToHuman(botApi, chatId, tenantId, telegramId, businessConnectionId);
    return;
  }

  if (!OPENROUTER_API_KEY) {
    await sendHumanLike({
      botApi,
      chatId,
      bubbles: ['AI временно недоступен (нет ключа OpenRouter).'],
      businessConnectionId,
    });
    return;
  }

  if (businessConnectionId) {
    const canReply = await businessConnectionCanReply(botApi, businessConnectionId);
    if (!canReply) {
      console.warn(
        `[ai-telegram] skip AI send conv=${conversation.id}: business can_reply=false`,
      );
      await prisma.conversation.updateMany({
        where: {
          tenantId,
          botInstanceId: botId,
          channel: 'telegram_business_account',
          businessConnectionId,
        },
        data: { status: 'limited' },
      });
      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: 'assistant',
          content:
            '⚠️ Ответ не отправлен в Telegram: у Business-бота нет права «Отвечать на сообщения». Telegram → Настройки → Business → Чат-боты → включите ответы, затем напишите клиенту ещё раз.',
        },
      });
      return;
    }
  }

  try {
    const ids =
      messageIds.length > 0
        ? messageIds
        : pending.messageId
          ? [pending.messageId]
          : [];
    await markTelegramRead(botApi, chatId, ids, businessConnectionId);
    await sendChatAction(botApi, chatId, 'typing', businessConnectionId);

    const sendStartedAt = new Date();
    const { bubbles, chargeResult } = await generateAiBubbles({
      tenantId,
      conversationId: conversation.id,
      displayText,
      persist: false,
    });

    const sendResult = await sendHumanLike({
      botApi,
      chatId,
      bubbles,
      businessConnectionId,
      conversationId: conversation.id,
      sendStartedAt,
    });

    if (sendResult.aborted) {
      console.log(
        `[ai-telegram] outbound aborted conv=${conversation.id} (new user msg) — newer inbound will reply`,
      );
      return;
    }

    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content:
          sendResult.failed > 0
            ? `⚠️ Не доставлено в Telegram (${sendResult.lastError || 'send failed'}):\n\n${bubbles.join('\n\n')}`
            : bubbles.join('\n\n'),
        tokensUsed: chargeResult.tokensCharged ?? undefined,
        modelUsed: chargeResult.modelUsed,
        providerCostRub: chargeResult.providerCostRub,
        chargedRub: chargeResult.chargedRub,
      },
    });
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastAiMessageAt: new Date() },
    });

    if (chargeResult.remainingBalance < 50 && chargeResult.remainingBalance > 0) {
      await sendHumanLike({
        botApi,
        chatId,
        bubbles: ['Баланс AI скоро закончится — пополните в кабинете.'],
        businessConnectionId,
      });
    }

    await fireGoal({
      tenantId,
      goalName: 'ai_response_sent',
      subscriberId: String(telegramId),
    });

    if (chargeResult.paused) {
      await switchToHuman(botApi, chatId, tenantId, telegramId, businessConnectionId);
    }
  } catch (err) {
    console.error('[ai-telegram] OpenRouter error:', err);
    await sendHumanLike({
      botApi,
      chatId,
      bubbles: ['Произошла ошибка. Попробуйте позже или /handoff'],
      businessConnectionId,
    });
  }
}

/** Build history → OpenRouter → charge → optionally store assistant bubbles. */
async function generateAiBubbles(opts: {
  tenantId: string;
  conversationId: string;
  displayText: string;
  /** When false, caller stores the message after Telegram delivery (Business send). */
  persist?: boolean;
}): Promise<{
  bubbles: string[];
  chargeResult: Awaited<ReturnType<typeof chargeAiUsage>> & {
    modelUsed: string;
    providerCostRub: number;
    tokensCharged: number;
  };
}> {
  const { tenantId, conversationId, displayText } = opts;
  const persist = opts.persist !== false;
  const aiConfig = await getTenantAiConfig(tenantId);
  const assigned = await resolveAssignedAgent(conversationId);
  const historyDesc = await prisma.chatMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: CONTEXT_WINDOW + 1,
  });
  const prior = historyDesc.slice(1).reverse();

  const basePrompt =
    assigned?.systemPrompt || aiConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  let systemPrompt = basePrompt + JSON_FORMAT_HINT;
  try {
    if (assigned?.id) {
      const rag = await retrieveAgentContext({
        aiAgentId: assigned.id,
        query: displayText,
        tenantId,
      });
      systemPrompt += formatRagPromptBlock(rag);
    }
  } catch (err) {
    console.warn('[ai-telegram] RAG retrieve failed', err);
  }
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  for (const msg of prior) {
    const role =
      msg.role === 'user' ? 'user' : msg.role === 'operator' ? 'user' : 'assistant';
    const prefix = msg.role === 'operator' ? '[оператор]: ' : '';
    messages.push({ role, content: prefix + msg.content });
  }
  messages.push({ role: 'user', content: displayText });

  const model = aiConfig.model || AI_MODEL_DEFAULTS.chat;
  let completion;
  try {
    completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: aiConfig.temperature ?? 0.7,
      max_tokens: aiConfig.maxTokens ?? 1000,
      response_format: { type: 'json_object' },
    });
  } catch {
    completion = await openai.chat.completions.create({
      model,
      messages,
      temperature: aiConfig.temperature ?? 0.7,
      max_tokens: aiConfig.maxTokens ?? 1000,
    });
  }

  const raw = completion.choices[0]?.message?.content || 'Извините, не удалось ответить.';
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
    aiAgentId: assigned?.id,
  });

  if (persist) {
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
  }

  return {
    bubbles,
    chargeResult: {
      ...chargeResult,
      modelUsed: model,
      providerCostRub: cost.providerCostRub,
      tokensCharged: tokensUsed,
    },
  };
}

async function extractInboundText(
  message: TgMessage,
  botApi: string,
  tenantId?: string,
): Promise<{ text?: string; mediaPlaceholder?: string }> {
  if (message.text) return { text: message.text };
  if (message.caption && !message.voice && !message.audio) {
    return { text: message.caption };
  }

  if (message.voice || message.audio) {
    const fileId = message.voice?.file_id || message.audio?.file_id;
    if (!fileId) {
      return {
        text: message.caption,
        mediaPlaceholder: '[голосовое сообщение]',
      };
    }
    try {
      const asrModel = await getAsrModel();
      const file = await downloadTelegramFile(botApi, fileId);
      if (!file) {
        return {
          text: message.caption,
          mediaPlaceholder: '[голосовое — файл недоступен]',
        };
      }
      const format = audioFormatFromPath(file.filePath);
      const asr = await transcribeAudio(file.buffer, format, asrModel);
      if (asr?.text) {
        if (tenantId) {
          const estTokens = Math.max(1, Math.ceil(asr.text.length / 4));
          void resolveProviderCostRub({
            model: asrModel,
            usage: asr.usage || { total_tokens: estTokens },
            apiKey: OPENROUTER_API_KEY,
            baseUrl: OPENROUTER_BASE_URL,
          })
            .then((cost) =>
              chargeAiUsage({
                tenantId,
                providerCostRub: cost.providerCostRub,
                tokens: cost.tokens || estTokens,
                model: asrModel,
                requestType: 'transcribe',
              }),
            )
            .catch((err) => console.warn('[ai-telegram] ASR charge failed', err));
        }
        return {
          text: message.caption
            ? `${message.caption}\n\n[голос]: ${asr.text}`
            : asr.text,
        };
      }
      return {
        text: message.caption,
        mediaPlaceholder: '[голосовое — не удалось распознать]',
      };
    } catch (err) {
      console.error('[ai-telegram] ASR failed:', err);
      return {
        text: message.caption,
        mediaPlaceholder: '[голосовое — ошибка ASR]',
      };
    }
  }

  if (message.photo?.length) {
    try {
      const largest = message.photo[message.photo.length - 1];
      const file = await downloadTelegramFile(botApi, largest.file_id);
      if (!file) {
        return {
          text: message.caption,
          mediaPlaceholder: '[фото — файл недоступен]',
        };
      }
      const visionModel =
        process.env.AI_CHAT_MODEL || AI_MODEL_DEFAULTS.chat;
      const vision = await describeImage(
        file.buffer,
        'image/jpeg',
        message.caption,
        visionModel,
      );
      if (vision?.text) {
        if (tenantId) {
          const estTokens = Math.max(1, Math.ceil(vision.text.length / 4));
          void resolveProviderCostRub({
            model: visionModel,
            usage: vision.usage || { total_tokens: estTokens },
            apiKey: OPENROUTER_API_KEY,
            baseUrl: OPENROUTER_BASE_URL,
          })
            .then((cost) =>
              chargeAiUsage({
                tenantId,
                providerCostRub: cost.providerCostRub,
                tokens: cost.tokens || estTokens,
                model: visionModel,
                requestType: 'vision',
              }),
            )
            .catch((err) => console.warn('[ai-telegram] vision charge failed', err));
        }
        return {
          text: message.caption
            ? `${message.caption}\n\n[фото]: ${vision.text}`
            : `[фото]: ${vision.text}`,
        };
      }
      return {
        text: message.caption,
        mediaPlaceholder: '[фото — не удалось описать]',
      };
    } catch (err) {
      console.error('[ai-telegram] vision failed:', err);
      return {
        text: message.caption,
        mediaPlaceholder: '[фото — ошибка vision]',
      };
    }
  }

  if (message.document) {
    return {
      text: message.caption,
      mediaPlaceholder: `[файл: ${message.document.file_name || 'document'}]`,
    };
  }

  return {};
}

function botTokenFromApi(botApi: string): string {
  const m = botApi.match(/\/bot([^/?]+)$/);
  return m?.[1] || '';
}

function audioFormatFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || 'ogg';
  if (ext === 'oga' || ext === 'opus') return 'ogg';
  if (['ogg', 'mp3', 'wav', 'flac', 'm4a', 'webm', 'aac'].includes(ext)) return ext;
  return 'ogg';
}

async function downloadTelegramFile(
  botApi: string,
  fileId: string,
): Promise<{ buffer: Buffer; filePath: string } | null> {
  const metaRes = await fetch(`${botApi}/getFile`, {
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
    console.warn('[ai-telegram] getFile failed:', meta.description || meta);
    return null;
  }
  const token = botTokenFromApi(botApi);
  const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) {
    console.warn('[ai-telegram] file download failed', fileRes.status);
    return null;
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, filePath: meta.result.file_path };
}

/** OpenRouter STT: POST /audio/transcriptions with base64 input_audio. */
async function transcribeAudio(
  buffer: Buffer,
  format: string,
  model: string,
): Promise<{ text: string; usage?: OpenRouterUsageLike } | null> {
  if (!OPENROUTER_API_KEY) return null;
  const res = await fetch(`${OPENROUTER_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.VOXLY_PUBLIC_URL || 'https://getvoxly.ru',
      'X-Title': 'Voxly AI Telegram ASR',
    },
    body: JSON.stringify({
      model,
      language: 'ru',
      input_audio: {
        data: buffer.toString('base64'),
        format,
      },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error('[ai-telegram] transcription HTTP', res.status, errText.slice(0, 400));
    return null;
  }
  const data = (await res.json()) as {
    text?: string;
    usage?: OpenRouterUsageLike;
  };
  const text = data.text?.trim();
  if (!text) return null;
  return { text, usage: data.usage };
}

/** Multimodal chat (Gemini Flash etc.) → short RU image description. */
async function describeImage(
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

async function getAsrModel(): Promise<string> {
  const row = await prisma.platformSetting.findUnique({ where: { key: 'ai_asr_model' } });
  return row?.value || process.env.AI_ASR_MODEL || AI_MODEL_DEFAULTS.asr;
}

async function ensureConversation(opts: {
  tenantId: string;
  botId: string;
  platformUserId: string;
  username?: string;
  firstName?: string;
  channel: string;
  businessConnectionId?: string;
}) {
  let conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: opts.tenantId,
      botInstanceId: opts.botId,
      platformUserId: opts.platformUserId,
      status: { in: ['open', 'waiting_for_human'] },
      channel: { not: 'telegram_business_account' },
    },
  });
  if (!conversation) {
    conversation = await prisma.conversation.findFirst({
      where: {
        tenantId: opts.tenantId,
        botInstanceId: opts.botId,
        platformUserId: opts.platformUserId,
        channel: { not: 'telegram_business_account' },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  const connectionAllowed = await isBusinessConnectionAllowed(
    opts.tenantId,
    opts.botId,
    opts.businessConnectionId,
  );

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        tenantId: opts.tenantId,
        botInstanceId: opts.botId,
        platform: 'telegram',
        platformUserId: opts.platformUserId,
        platformUsername: opts.username,
        platformFirstName: opts.firstName,
        status: connectionAllowed ? 'open' : 'closed',
        mode: connectionAllowed ? 'ai' : 'human',
        aiDisabled: !connectionAllowed,
        channel: opts.channel,
        businessConnectionId: opts.businessConnectionId,
        lastAiMessageAt: new Date(),
      },
    });
    if (connectionAllowed) {
      await fireGoal({
        tenantId: opts.tenantId,
        goalName: 'conversation_started',
        subscriberId: opts.platformUserId,
      });
    }
  } else {
    const data: {
      businessConnectionId?: string;
      channel?: string;
      aiDisabled?: boolean;
      status?: string;
      mode?: string;
    } = {};
    if (
      opts.businessConnectionId &&
      conversation.businessConnectionId !== opts.businessConnectionId
    ) {
      data.businessConnectionId = opts.businessConnectionId;
      data.channel = opts.channel;
    }
    if (!connectionAllowed && !conversation.aiDisabled) {
      data.aiDisabled = true;
      data.status = 'closed';
      data.mode = 'human';
    }
    if (Object.keys(data).length) {
      conversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data,
      });
    }
  }

  return conversation;
}

async function isBusinessConnectionAllowed(
  tenantId: string,
  botId: string,
  businessConnectionId: string | undefined,
): Promise<boolean> {
  if (!businessConnectionId) return true;
  const max = PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS;

  // Already used this connection on an active conversation → allowed
  const same = await prisma.conversation.findFirst({
    where: {
      tenantId,
      botInstanceId: botId,
      businessConnectionId,
      status: { not: 'closed' },
      aiDisabled: false,
      channel: { not: 'telegram_business_account' },
    },
    select: { id: true },
  });
  if (same) return true;

  const distinctOpen = await prisma.conversation.findMany({
    where: {
      tenantId,
      botInstanceId: botId,
      businessConnectionId: { not: null },
      status: { not: 'closed' },
      channel: { not: 'telegram_business_account' },
    },
    select: { businessConnectionId: true },
    distinct: ['businessConnectionId'],
  });
  return distinctOpen.length < max;
}

/**
 * Upsert Twenty Person + Opportunity for an AI conversation.
 * Dedupe: platformUserId / gift / hint / **phone** (cross-channel WA↔TG).
 * Ambiguous Person matches → needsReview.
 */
async function syncLeadToCrm(opts: {
  tenantId: string;
  botId: string;
  conversationId: string;
  platformUserId: string;
  username?: string;
  firstName?: string;
  /** Raw or E.164 phone when known (GramJS User.phone / contact share). */
  phone?: string;
  /** Business account owner label for Opportunity name / note. */
  businessAccountLabel?: string;
}): Promise<void> {
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
    select: { botUsername: true },
  });

  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );

  // INC-042: stale Twenty ids after CRM wipe must be cleared + recreated.
  let storedPersonId = conversation.twentyPersonId || undefined;
  let storedOpportunityId = conversation.twentyOpportunityId || undefined;
  let clearedStale = false;
  if (storedPersonId) {
    const ok = await client.personExists(storedPersonId);
    if (!ok) {
      console.warn(
        `[ai-telegram] stale twentyPersonId=${storedPersonId} conv=${opts.conversationId}; recreating`,
      );
      storedPersonId = undefined;
      storedOpportunityId = undefined;
      clearedStale = true;
    }
  }
  if (storedOpportunityId) {
    const ok = await client.opportunityExists(storedOpportunityId);
    if (!ok) {
      console.warn(
        `[ai-telegram] stale twentyOpportunityId=${storedOpportunityId} conv=${opts.conversationId}; recreating`,
      );
      storedOpportunityId = undefined;
      clearedStale = true;
    }
  }
  if (clearedStale) {
    await prisma.conversation.update({
      where: { id: opts.conversationId },
      data: { twentyPersonId: null, twentyOpportunityId: null },
    });
  }

  if (storedPersonId && storedOpportunityId) {
    // Still backfill phone/telegram on existing link when newly known.
    if (opts.phone && storedPersonId) {
      try {
        await client.updatePersonPhone(storedPersonId, opts.phone);
      } catch {
        /* ignore */
      }
    }
    if (opts.username && storedPersonId) {
      try {
        await client.updatePersonTelegram(storedPersonId, opts.username);
      } catch {
        /* ignore */
      }
    }
    return;
  }

  const candidateIds = new Set<string>();

  if (storedPersonId) candidateIds.add(storedPersonId);

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
    const priorOk = await client.personExists(priorConv.twentyPersonId);
    if (priorOk) candidateIds.add(priorConv.twentyPersonId);
  }

  const giftLinked = await prisma.giftSubscriber.findFirst({
    where: {
      tenantId: opts.tenantId,
      telegramId: opts.platformUserId,
      twentyPersonId: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (giftLinked?.twentyPersonId) {
    const giftOk = await client.personExists(giftLinked.twentyPersonId);
    if (giftOk) candidateIds.add(giftLinked.twentyPersonId);
  }

  try {
    await client.ensureSocialFields();
  } catch (err) {
    console.warn('[ai-telegram] ensureSocialFields failed', err);
  }

  const hinted = await client.findPersonByHint({
    username: opts.username,
    telegramId: opts.platformUserId,
    lastName: opts.username
      ? `@${opts.username.replace(/^@/, '')}`
      : opts.platformUserId,
  });
  if (hinted?.id) candidateIds.add(hinted.id);

  let phoneMatchIds: string[] = [];
  if (opts.phone) {
    try {
      const byPhone = await client.findPersonByPhone(opts.phone);
      if (byPhone?.ids?.length) {
        phoneMatchIds = byPhone.ids;
        for (const id of byPhone.ids) {
          const ok = await client.personExists(id);
          if (ok) candidateIds.add(id);
        }
      }
    } catch (err) {
      console.warn('[ai-telegram] findPersonByPhone failed', err);
    }
  }

  const needsReview = candidateIds.size > 1 || phoneMatchIds.length > 1;
  let personId =
    storedPersonId ||
    (priorConv?.twentyPersonId && candidateIds.has(priorConv.twentyPersonId)
      ? priorConv.twentyPersonId
      : undefined) ||
    (giftLinked?.twentyPersonId && candidateIds.has(giftLinked.twentyPersonId)
      ? giftLinked.twentyPersonId
      : undefined) ||
    (phoneMatchIds[0] && candidateIds.has(phoneMatchIds[0])
      ? phoneMatchIds[0]
      : undefined) ||
    hinted?.id ||
    undefined;

  // Prefer first phone match when no stronger link (cross-channel WA→TG).
  if (!personId && phoneMatchIds[0]) {
    personId = phoneMatchIds[0];
  }

  if (needsReview) {
    console.warn(
      `[ai-telegram] ambiguous Person match for tg=${opts.platformUserId}: ${[...candidateIds].join(',')}`,
    );
  }

  if (!personId) {
    const created = await client.createPerson({
      firstName: opts.firstName || opts.username || `TG ${opts.platformUserId}`,
      lastName: opts.username
        ? `@${opts.username.replace(/^@/, '')}`
        : opts.platformUserId,
      telegram: opts.username,
      phone: opts.phone,
    });
    personId = created?.id;
  } else {
    if (opts.username) {
      try {
        await client.updatePersonTelegram(personId, opts.username);
      } catch {
        /* ignore */
      }
    }
    if (opts.phone) {
      try {
        await client.updatePersonPhone(personId, opts.phone);
      } catch {
        /* ignore */
      }
    }
  }

  // Reuse Opportunity from any Conversation already linked to this Person (WA/gift/TG).
  let opportunityId =
    storedOpportunityId ||
    (priorConv?.twentyOpportunityId &&
    (await client.opportunityExists(priorConv.twentyOpportunityId))
      ? priorConv.twentyOpportunityId
      : undefined);

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
    const giftOpp = await prisma.giftSubscriber.findFirst({
      where: {
        tenantId: opts.tenantId,
        twentyPersonId: personId,
        twentyOpportunityId: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (
      giftOpp?.twentyOpportunityId &&
      (await client.opportunityExists(giftOpp.twentyOpportunityId))
    ) {
      opportunityId = giftOpp.twentyOpportunityId;
    }
  }

  if (!opportunityId && personId) {
    const who = opts.username
      ? `@${opts.username.replace(/^@/, '')}`
      : opts.platformUserId;
    const botLabel = bot?.botUsername
      ? `@${bot.botUsername.replace(/^@/, '')}`
      : 'AI';
    const bizLabel = opts.businessAccountLabel
      ? ` · Business ${opts.businessAccountLabel}`
      : '';
    const opportunity = await client.createOpportunity({
      name: `${who} · AI · ${botLabel}${bizLabel}`,
      personId,
      stage: 'NEW',
    });
    opportunityId = opportunity?.id;

    await fireGoal({
      tenantId: opts.tenantId,
      goalName: 'ai_lead_created',
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
      platformUsername: opts.username
        ? opts.username.replace(/^@/, '')
        : conversation.platformUsername,
    },
  });

  if (personId && (clearedStale || !conversation.twentyPersonId)) {
    try {
      await client.createNoteForPerson({
        personId,
        title: 'AI чат (Telegram)',
        body: `Диалог начат через AI-бота${bot?.botUsername ? ` @${bot.botUsername}` : ''}.${
          opts.businessAccountLabel
            ? ` Business-аккаунт: ${opts.businessAccountLabel}.`
            : ''
        }${opts.phone ? ` Телефон: ${opts.phone}.` : ''}`,
      });
    } catch {
      /* ignore */
    }
  }
}

/** Conversation.aiAgentId → else BotInstance.defaultAiAgentId; null = AI off (ADR-014). */
async function resolveAssignedAgent(conversationId: string): Promise<{
  id: string;
  name: string;
  systemPrompt: string | null;
  settings: unknown;
  status: string;
} | null> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      aiAgentId: true,
      botInstanceId: true,
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
  // Default OFF until an agent is explicitly assigned (account or chat).
  const agent = await resolveAssignedAgent(conversationId);
  if (!agent) return false;
  return true;
}

async function resolveBusinessAccountLabel(
  tenantId: string,
  botId: string,
  businessConnectionId: string | undefined,
): Promise<string | null> {
  if (!businessConnectionId) return null;
  const link = await prisma.conversation.findFirst({
    where: {
      tenantId,
      botInstanceId: botId,
      channel: 'telegram_business_account',
      businessConnectionId,
    },
    select: { platformUsername: true, platformFirstName: true, platformUserId: true },
  });
  if (!link) return null;
  if (link.platformUsername) return `@${link.platformUsername.replace(/^@/, '')}`;
  if (link.platformFirstName) return link.platformFirstName;
  return `id ${link.platformUserId}`;
}

async function pauseOnHumanOutbound(opts: {
  tenantId: string;
  botId: string;
  platformUserId: string;
  businessConnectionId: string;
  content: string;
  externalMessageId: string;
  firstName?: string;
  username?: string;
}) {
  const conversation = await ensureConversation({
    tenantId: opts.tenantId,
    botId: opts.botId,
    platformUserId: opts.platformUserId,
    username: opts.username,
    firstName: opts.firstName,
    channel: 'telegram_business',
    businessConnectionId: opts.businessConnectionId,
  });

  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'operator',
      content: opts.content,
      externalMessageId: opts.externalMessageId,
    },
  });

  // Owner replied from phone — still create/update CRM lead for this peer.
  // Do NOT auto-pause AI (manual /pause /off / CRM buttons only).
  const businessAccountLabel = await resolveBusinessAccountLabel(
    opts.tenantId,
    opts.botId,
    opts.businessConnectionId,
  );
  void syncLeadToCrm({
    tenantId: opts.tenantId,
    botId: opts.botId,
    conversationId: conversation.id,
    platformUserId: opts.platformUserId,
    username: opts.username,
    firstName: opts.firstName,
    businessAccountLabel: businessAccountLabel || undefined,
  }).catch((err) => console.warn('[ai-telegram] CRM sync on human outbound failed', err));
}

async function pauseConversation(
  tenantId: string,
  botId: string,
  platformUserId: string,
  ms: number,
) {
  await prisma.conversation.updateMany({
    where: {
      tenantId,
      botInstanceId: botId,
      platformUserId,
      status: { in: ['open', 'waiting_for_human'] },
    },
    data: { pausedUntil: new Date(Date.now() + ms) },
  });
}

async function setAiDisabled(
  tenantId: string,
  botId: string,
  platformUserId: string,
  disabled: boolean,
) {
  await prisma.conversation.updateMany({
    where: {
      tenantId,
      botInstanceId: botId,
      platformUserId,
      status: { in: ['open', 'waiting_for_human'] },
    },
    data: disabled
      ? { aiDisabled: true, mode: 'human', status: 'waiting_for_human' }
      : { aiDisabled: false, mode: 'ai', status: 'open', pausedUntil: null },
  });
}

async function handleCallback(update: any, botApi: string, tenantId: string, botId: string) {
  const from = update.callback_query?.from;
  if (from?.is_bot === true) {
    console.log(`[ai-telegram] skip callback from bot id=${from.id}`);
    return;
  }
  const callbackData = update.callback_query.data;
  const chatId = update.callback_query.message.chat.id;
  const telegramId = update.callback_query.from.id;
  const businessConnectionId = update.callback_query.message?.business_connection_id as
    | string
    | undefined;

  await fetch(`${botApi}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: update.callback_query.id }),
  });

  switch (callbackData) {
    case 'mode_ai':
      await switchToAi(botApi, chatId, tenantId, telegramId, businessConnectionId);
      break;
    case 'mode_human':
      await switchToHuman(botApi, chatId, tenantId, telegramId, businessConnectionId);
      break;
    default:
      void botId;
  }
}

async function showModeSelector(
  botApi: string,
  chatId: number,
  businessConnectionId?: string,
) {
  await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: 'Выберите режим:',
      business_connection_id: businessConnectionId,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'AI-ассистент', callback_data: 'mode_ai' }],
          [{ text: 'Оператор', callback_data: 'mode_human' }],
        ],
      },
    }),
  });
}

async function switchToAi(
  botApi: string,
  chatId: number,
  tenantId: string,
  telegramId: number,
  businessConnectionId?: string,
) {
  await prisma.conversation.updateMany({
    where: {
      tenantId,
      platformUserId: String(telegramId),
      status: { in: ['open', 'waiting_for_human'] },
    },
    data: {
      mode: 'ai',
      status: 'open',
      aiDisabled: false,
      pausedUntil: null,
    },
  });
  await sendHumanLike({ botApi, chatId, bubbles: ['Режим AI включён.'], businessConnectionId });
}

async function switchToHuman(
  botApi: string,
  chatId: number,
  tenantId: string,
  telegramId: number,
  businessConnectionId?: string,
) {
  await prisma.conversation.updateMany({
    where: {
      tenantId,
      platformUserId: String(telegramId),
      status: { in: ['open', 'waiting_for_human'] },
    },
    data: { mode: 'human', status: 'waiting_for_human' },
  });

  await sendHumanLike({
    botApi,
    chatId,
    bubbles: ['Режим оператора. Ожидайте ответа. Вернуться к AI: /ai'],
    businessConnectionId,
  });

  await fireGoal({
    tenantId,
    goalName: 'human_handoff',
    subscriberId: String(telegramId),
  });
}

async function notifyHumanOperator(
  tenantId: string,
  conversationId: string,
  lastMessage: string,
) {
  console.log(
    `[ai-telegram] Human operator notification: tenant=${tenantId} conv=${conversationId} msg=${lastMessage}`,
  );
}

async function getTenantAiConfig(tenantId: string) {
  const settings = await prisma.platformSetting.findMany({
    where: {
      OR: [
        { key: { startsWith: `ai_config_${tenantId}_` } },
        { key: 'ai_default_model' },
        { key: 'ai_chat_model' },
        { key: 'ai_default_system_prompt' },
      ],
    },
  });

  const config: Record<string, string> = {};
  for (const s of settings) {
    if (s.key.startsWith(`ai_config_${tenantId}_`)) {
      const field = s.key.replace(`ai_config_${tenantId}_`, '');
      config[field] = s.value;
    } else if (s.key === 'ai_chat_model' || s.key === 'ai_default_model') {
      config.model = config.model || s.value;
    } else if (s.key === 'ai_default_system_prompt') {
      config.systemPrompt = config.systemPrompt || s.value;
    }
  }

  return {
    model: config.model || process.env.AI_CHAT_MODEL || AI_MODEL_DEFAULTS.chat,
    systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
    temperature: config.temperature ? parseFloat(config.temperature) : 0.7,
    maxTokens: config.maxTokens ? parseInt(config.maxTokens, 10) : 1000,
  };
}

/** Parse n8n-style multi-bubble JSON; fallback to single bubble. */
function parseAiBubbles(raw: string): string[] {
  const trimmed = raw.trim();
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
    // fall through
  }

  return [trimmed];
}

function typingDelayMs(text: string): number {
  const base = 800;
  const perChar = 30;
  return Math.min(5000, Math.max(600, base + text.length * perChar));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function markTelegramRead(
  botApi: string,
  chatId: number,
  messageIds: string[],
  businessConnectionId?: string,
) {
  const ids = messageIds.map((id) => String(id || '').trim()).filter(Boolean);
  if (!ids.length) return;

  if (businessConnectionId) {
    for (const messageId of ids) {
      await fetch(`${botApi}/readBusinessMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          business_connection_id: businessConnectionId,
          chat_id: chatId,
          message_id: Number(messageId),
        }),
      }).catch(() => undefined);
    }
    return;
  }

  // Private bot chats: best-effort (Bot API has no universal read receipt).
  const maxId = Math.max(...ids.map((id) => Number(id) || 0));
  if (maxId > 0) {
    await fetch(`${botApi}/readChatHistory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, max_id: maxId }),
    }).catch(() => undefined);
  }
}

async function sendChatAction(
  botApi: string,
  chatId: number,
  action: string,
  businessConnectionId?: string,
) {
  await fetch(`${botApi}/sendChatAction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      action,
      ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}),
    }),
  }).catch(() => undefined);
}

async function businessConnectionCanReply(
  botApi: string,
  businessConnectionId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${botApi}/getBusinessConnection?business_connection_id=${encodeURIComponent(businessConnectionId)}`,
    );
    const json = (await res.json()) as {
      ok?: boolean;
      result?: { can_reply?: boolean; is_enabled?: boolean };
    };
    return json.ok === true && json.result?.is_enabled !== false && json.result?.can_reply === true;
  } catch {
    return false;
  }
}

async function sendHumanLike(opts: {
  botApi: string;
  chatId: number;
  bubbles: string[];
  businessConnectionId?: string;
  conversationId?: string;
  sendStartedAt?: Date;
}): Promise<{ sent: number; failed: number; lastError?: string; aborted?: boolean }> {
  const parts = opts.bubbles.filter((b) => b && b.trim()).slice(0, 4);
  if (!parts.length) return { sent: 0, failed: 0 };

  let sent = 0;
  let failed = 0;
  let lastError: string | undefined;
  for (let i = 0; i < parts.length; i += 1) {
    if (
      opts.conversationId &&
      opts.sendStartedAt &&
      (await hasNewerUserMessage(opts.conversationId, opts.sendStartedAt))
    ) {
      return { sent, failed, lastError, aborted: true };
    }
    const text = parts[i];
    await sendChatAction(opts.botApi, opts.chatId, 'typing', opts.businessConnectionId);
    await sleep(typingDelayMs(text));
    if (
      opts.conversationId &&
      opts.sendStartedAt &&
      (await hasNewerUserMessage(opts.conversationId, opts.sendStartedAt))
    ) {
      return { sent, failed, lastError, aborted: true };
    }
    const ok = await sendBotMessage(
      opts.botApi,
      opts.chatId,
      text,
      opts.businessConnectionId,
    );
    if (ok) sent += 1;
    else {
      failed += 1;
      lastError = 'BUSINESS_PEER_INVALID or Telegram send failed';
    }
    if (i < parts.length - 1) {
      await sleep(humanBubbleGapMs());
    }
  }
  return { sent, failed, lastError };
}

async function sendBotMessage(
  botApi: string,
  chatId: number,
  text: string,
  businessConnectionId?: string,
): Promise<boolean> {
  const res = await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}),
    }),
  });
  const data = (await res.json()) as any;
  if (!data.ok) {
    console.warn('[ai-telegram] sendMessage failed:', data);
    return false;
  }
  return true;
}

main().catch(console.error);
