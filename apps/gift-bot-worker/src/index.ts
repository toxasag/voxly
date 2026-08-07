// Voxly Gift Bot Worker
// Multi-tenant webhook: /tg/{tenantId}/{botId}
// Supports linear funnelJson, delayed nudges, CRM Person+Opportunity, broadcasts

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { prisma } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { fireGoal } from '@voxly/analytics-dispatchers';
import { TwentyClient } from '@voxly/twenty-client';
import {
  DEFAULT_GIFT_FUNNEL,
  AI_MODEL_DEFAULTS,
  AI_USAGE_CHANNELS,
  clientMdToMarkdownV2,
  formatPromoButtonLabel,
  promoShowClickCounter,
  giftPromoStartPayload,
  resolveTelegramMedia,
  detectStoredMediaKind,
  normalizeGiftMediaType,
  isTelegramDocumentFileId,
  type GiftFunnelConfig,
  type GiftFunnelMessage,
  type GiftExtraButton,
  type GiftPromoMediaType,
  type GiftPromoPost,
  isWithinMailingAttributionWindow,
  mailingAttributionNote,
} from '@voxly/shared';
import {
  chargeAiUsage,
  detectDocumentKind,
  extractAudioFromVideo,
  extractDocumentText,
  formatDocumentAiText,
  resolveProviderCostRub,
  DOC_MEDIA_MAX_BYTES,
  type OpenRouterUsageLike,
} from '@voxly/ai-core';

const PORT = 3004;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const USE_POLLING = process.env.GIFT_BOT_USE_POLLING === 'true';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const ASR_MEDIA_MAX_BYTES = 20 * 1024 * 1024;
const ASR_VIDEO_MAX_DURATION_SEC = 180;

const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
const delayQueue = new Queue('gift-bot-delay', { connection });
const broadcastQueue = new Queue('gift-bot-broadcast', { connection });

/** Process-lifetime guard: fill Person.telegram at most once per personId */
const telegramHandleFilled = new Set<string>();

interface DelayJob {
  kind: 'not_subscribed' | 'after_gift' | 'not_gifted';
  index: number;
  tenantId: string;
  botId: string;
  campaignId: string;
  telegramId: string;
  chatId: number;
}

async function main() {
  startDelayWorker();
  startBroadcastWorker();
  startBroadcastScanner();

  if (USE_POLLING) {
    console.log('[gift-bot-worker] Long-polling mode enabled');
    void pollAllBots();
  }

  const http = await import('node:http');
  const AI_TELEGRAM_WORKER_URL =
    process.env.AI_TELEGRAM_WORKER_URL || 'http://ai-telegram-worker:3005';
  const { handleMaxUpdate } = await import('./max-handler.js');
  const { maxGetUpdates } = await import('./max-api.js');
  const USE_MAX_POLLING = process.env.GIFT_MAX_USE_POLLING === 'true' || USE_POLLING;

  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url?.startsWith('/tg/')) {
      const parts = req.url.split('/').filter(Boolean);
      const tenantId = parts[1];
      const botId = parts[2]?.split('?')[0];
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        // Public Traefik route hits gift-bot; forward AI bots to ai-telegram-worker.
        const botMeta = await prisma.botInstance.findFirst({
          where: { id: botId, tenantId },
          select: { botType: true },
        });
        if (botMeta?.botType === 'ai_tg') {
          const upstream = await fetch(`${AI_TELEGRAM_WORKER_URL}${req.url}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
          });
          const text = await upstream.text();
          res.writeHead(upstream.status, { 'Content-Type': 'text/plain' });
          res.end(text);
          return;
        }

        const update = JSON.parse(body);
        await handleTelegramUpdate(update, tenantId, botId);
        res.writeHead(200);
        res.end('ok');
      } catch (err) {
        console.error('[gift-bot] Error:', err);
        res.writeHead(500);
        res.end('error');
      }
    } else if (req.method === 'POST' && req.url?.startsWith('/max/')) {
      const parts = req.url.split('/').filter(Boolean);
      const tenantId = parts[1];
      const botId = parts[2]?.split('?')[0];
      const secretHeader = String(req.headers['x-max-bot-api-secret'] || '');
      let body = '';
      for await (const chunk of req) body += chunk;
      try {
        const bot = await prisma.botInstance.findFirst({
          where: { id: botId, tenantId, botType: 'gift_max' },
          select: { webhookSecret: true },
        });
        if (!bot) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        if (bot.webhookSecret && secretHeader && secretHeader !== bot.webhookSecret) {
          res.writeHead(401);
          res.end('bad secret');
          return;
        }
        const update = JSON.parse(body);
        await handleMaxUpdate(update, tenantId, botId);
        res.writeHead(200);
        res.end('ok');
      } catch (err) {
        console.error('[gift-max] Error:', err);
        res.writeHead(500);
        res.end('error');
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
    console.log(`[gift-bot-worker] Listening on port ${PORT}`);
  });

  if (USE_MAX_POLLING) {
    console.log('[gift-bot-worker] MAX long-polling enabled');
    void pollMaxBots(maxGetUpdates, handleMaxUpdate);
  }
}

function startDelayWorker() {
  new Worker<DelayJob>(
    'gift-bot-delay',
    async (job) => {
      await processDelayJob(job.data);
    },
    { connection },
  );
}

function startBroadcastWorker() {
  new Worker(
    'gift-bot-broadcast',
    async (job) => {
      const { broadcastId } = job.data as { broadcastId: string };
      await processBroadcast(broadcastId);
    },
    { connection, limiter: { max: 25, duration: 1000 } },
  );
}

function startBroadcastScanner() {
  setInterval(async () => {
    try {
      const due = await prisma.broadcast.findMany({
        where: { status: 'scheduled', scheduledAt: { lte: new Date() } },
        take: 5,
      });
      for (const b of due) {
        await prisma.broadcast.update({
          where: { id: b.id },
          data: { status: 'sending' },
        });
        await broadcastQueue.add('send', { broadcastId: b.id });
      }
    } catch (err) {
      console.error('[gift-bot] broadcast scanner:', err);
    }
  }, 15000);
}

async function pollAllBots() {
  const offsets = new Map<string, number>();
  for (;;) {
    try {
      const bots = await prisma.botInstance.findMany({
        where: { status: 'active', botType: 'gift', botTokenEncrypted: { not: null } },
      });
      for (const bot of bots) {
        if (!bot.botTokenEncrypted) continue;
        const token = decrypt(bot.botTokenEncrypted);
        const offset = offsets.get(bot.id) || 0;
        const res = await fetch(
          `https://api.telegram.org/bot${token}/getUpdates?timeout=10&offset=${offset}`,
        );
        const data = (await res.json()) as any;
        if (!data.ok) continue;
        for (const update of data.result || []) {
          offsets.set(bot.id, update.update_id + 1);
          await handleTelegramUpdate(update, bot.tenantId, bot.id);
        }
      }
    } catch (err) {
      console.error('[gift-bot] poll error:', err);
      await sleep(3000);
    }
  }
}

async function pollMaxBots(
  maxGetUpdates: typeof import('./max-api.js').maxGetUpdates,
  handleMaxUpdate: typeof import('./max-handler.js').handleMaxUpdate,
) {
  const markers = new Map<string, number | string>();
  for (;;) {
    try {
      const bots = await prisma.botInstance.findMany({
        where: { status: 'active', botType: 'gift_max', botTokenEncrypted: { not: null } },
      });
      for (const bot of bots) {
        if (!bot.botTokenEncrypted) continue;
        const token = decrypt(bot.botTokenEncrypted);
        const marker = markers.get(bot.id);
        const { updates, marker: next } = await maxGetUpdates({
          token,
          marker: marker ?? null,
          timeout: 25,
        });
        if (next != null) markers.set(bot.id, next);
        for (const update of updates) {
          await handleMaxUpdate(update, bot.tenantId, bot.id);
        }
      }
      if (bots.length === 0) await sleep(5000);
    } catch (err) {
      console.error('[gift-max] poll error:', err);
      await sleep(3000);
    }
  }
}

async function resolveStartCampaign(
  tenantId: string,
  botId: string,
  startPayload?: string,
) {
  if (startPayload?.startsWith('g_')) {
    const campaignId = startPayload.slice(2);
    return prisma.giftCampaignConfig.findFirst({
      where: { id: campaignId, botInstanceId: botId, tenantId, isActive: true },
    });
  }
  return prisma.giftCampaignConfig.findFirst({
    where: { botInstanceId: botId, tenantId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
}

async function resolveCallbackCampaign(
  tenantId: string,
  botId: string,
  telegramId: string,
  data: string,
) {
  if (data.startsWith('check_sub:')) {
    const campaignId = data.slice('check_sub:'.length);
    return prisma.giftCampaignConfig.findFirst({
      where: { id: campaignId, botInstanceId: botId, tenantId },
    });
  }
  const sub = await prisma.giftSubscriber.findFirst({
    where: { botInstanceId: botId, tenantId, telegramId },
    orderBy: { updatedAt: 'desc' },
    include: { campaign: true },
  });
  return sub?.campaign ?? null;
}

async function handleTelegramUpdate(update: any, tenantId: string, botId: string) {
  const bot = await prisma.botInstance.findFirst({
    where: { id: botId, tenantId, status: 'active' },
  });
  if (!bot?.botTokenEncrypted) {
    console.warn(`[gift-bot] Bot not found or inactive: ${botId}`);
    return;
  }

  const botToken = decrypt(bot.botTokenEncrypted);
  const botApi = `https://api.telegram.org/bot${botToken}`;

  // Human-mode: if conversation is human, still log inbound but don't auto-reply (except /start reset)
  if (update.message?.text === '/start' || update.message?.text?.startsWith('/start ')) {
    const startPayload = update.message.text?.split(' ')[1] as string | undefined;
    const campaign = await resolveStartCampaign(tenantId, botId, startPayload);
    await handleStart(update, botApi, tenantId, botId, campaign, bot.botUsername);
    return;
  }

  if (update.callback_query) {
    const telegramId = String(update.callback_query.from.id);
    const data = String(update.callback_query.data || '');
    const campaign = await resolveCallbackCampaign(tenantId, botId, telegramId, data);
    await handleCallback(update, botApi, tenantId, botId, campaign);
    return;
  }

  if (
    update.message?.text ||
    update.message?.contact ||
    update.message?.photo ||
    update.message?.video ||
    update.message?.video_note ||
    update.message?.document ||
    update.message?.audio ||
    update.message?.voice ||
    update.message?.sticker ||
    update.message?.animation
  ) {
    await storeInboundMessage(tenantId, botId, update, botApi);
    if (update.message?.contact?.phone_number) {
      const telegramId = String(update.message.from.id);
      const phone = String(update.message.contact.phone_number);
      await prisma.giftSubscriber.updateMany({
        where: { tenantId, botInstanceId: botId, telegramId },
        data: { phone },
      });
      // Push into Twenty Person.phones when linked (Bot API only has phone if user shares contact).
      void syncPhoneToCrmPerson(tenantId, botId, telegramId, phone).catch(() => {
        /* best-effort */
      });
    }
  }
}

async function handleStart(
  update: any,
  botApi: string,
  tenantId: string,
  botId: string,
  campaign: any,
  botUsername?: string | null,
) {
  const chatId = update.message.chat.id;
  const telegramId = String(update.message.from.id);
  const username = update.message.from.username as string | undefined;
  const firstName = update.message.from.first_name as string | undefined;
  const startPayload = update.message.text?.split(' ')[1];

  await fireGoal({
    tenantId,
    goalName: 'bot_start',
    subscriberId: telegramId,
    botInstanceId: botId,
    campaignId: campaign?.id,
    attribution: startPayload?.startsWith('tr_')
      ? { utmCampaign: startPayload.slice(3) }
      : undefined,
  });

  if (!campaign) {
    await sendBotMessage(
      botApi,
      chatId,
      'Привет! Сейчас нет активного проекта. Включите проект в кабинете Voxly.',
    );
    return;
  }

  if (startPayload && startPayload === giftPromoStartPayload(campaign.id)) {
    await trackPromoClick(botApi, tenantId, botId, campaign);
  }

  const funnel = getFunnel(campaign);
  const crm = await syncSubscriberToCRM(tenantId, botId, campaign, botUsername, {
    telegramId,
    username,
    firstName,
  });

  await prisma.giftSubscriber.upsert({
    where: { campaignId_telegramId: { campaignId: campaign.id, telegramId } },
    create: {
      tenantId,
      campaignId: campaign.id,
      botInstanceId: botId,
      telegramId,
      username,
      firstName,
      funnelPhase: 'awaiting_sub',
      twentyPersonId: crm.personId,
      twentyOpportunityId: crm.opportunityId,
      lastMessageAt: new Date(),
    },
    update: {
      username,
      firstName,
      funnelPhase: 'awaiting_sub',
      twentyPersonId: crm.personId || undefined,
      twentyOpportunityId: crm.opportunityId || undefined,
      lastMessageAt: new Date(),
    },
  });

  const conversation = await ensureConversation(tenantId, botId, telegramId, username, firstName);
  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: update.message.text || '/start',
    },
  });
  const sendCtx = { tenantId, botId, telegramId };
  await sendStartWithSubscribeButtons(botApi, chatId, funnel, campaign, sendCtx);
  try {
    // «Не забрали» — только если клиент молчит (не жал «Я подписался»)
    await scheduleChain(tenantId, botId, campaign.id, telegramId, chatId, 'not_gifted', funnel.notGifted);
  } catch (err) {
    console.error('[gift-bot] scheduleChain after start failed:', err);
  }
}

async function handleCallback(
  update: any,
  botApi: string,
  tenantId: string,
  botId: string,
  campaign: any,
) {
  const cb = update.callback_query;
  const chatId = cb.message.chat.id;
  const telegramId = String(cb.from.id);
  const data = cb.data as string;

  await fetch(`${botApi}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callback_query_id: cb.id,
      text: 'Проверяю подписку…',
      show_alert: false,
    }),
  });

  if (!campaign) return;

  // Allow subscription check even if an operator previously closed a chat
  const funnel = getFunnel(campaign);

  if (data === 'check_subscription' || data.startsWith('check_sub')) {
    // Любое нажатие «Я подписался» — это уже не «молчит», снимаем «не забрали»
    try {
      await cancelPendingDelays(telegramId, campaign.id, ['not_gifted']);
    } catch (err) {
      console.error('[gift-bot] cancel not_gifted failed:', err);
    }

    await fireGoal({
      tenantId,
      goalName: 'subscription_requested',
      subscriberId: telegramId,
      botInstanceId: botId,
      campaignId: campaign.id,
    });

    const subscribed = await checkChannelSubscription(
      botApi,
      campaign.channelId,
      Number(telegramId),
      campaign.channelUsername,
    );

    if (!subscribed) {
      // Нажал, но не в канале → цепочка «Если не подписан»
      try {
        await cancelPendingDelays(telegramId, campaign.id, ['not_subscribed']);
        await scheduleChain(
          tenantId,
          botId,
          campaign.id,
          telegramId,
          chatId,
          'not_subscribed',
          funnel.notSubscribed,
        );
      } catch (err) {
        console.error('[gift-bot] schedule not_subscribed failed:', err);
      }
      await sendBotMessage(
        botApi,
        chatId,
        'Не вижу подписку 😕 Подпишись на канал и нажми кнопку ещё раз.',
        subscribeKeyboard(funnel, campaign),
        { tenantId, botId, telegramId },
      );
      return;
    }

    await fireGoal({
      tenantId,
      goalName: 'subscription_verified',
      subscriberId: telegramId,
      botInstanceId: botId,
      campaignId: campaign.id,
    });

    // Deliver first — if Telegram send fails, do not mark as gifted
    try {
      await deliverGift(botApi, chatId, funnel, { tenantId, botId, telegramId });
    } catch (err) {
      console.error('[gift-bot] deliverGift failed:', err);
      await sendBotMessage(
        botApi,
        chatId,
        'Подписка есть, но не удалось отправить подарок. Нажми «Я подписался» ещё раз или напиши в поддержку.',
        subscribeKeyboard(funnel, campaign),
        { tenantId, botId, telegramId },
      );
      return;
    }

    await prisma.giftSubscriber.updateMany({
      where: { campaignId: campaign.id, telegramId },
      data: { subscribed: true, funnelPhase: 'gifted', giftDelivered: true, lastMessageAt: new Date() },
    });

    await cancelPendingDelays(telegramId, campaign.id);

    await fireGoal({
      tenantId,
      goalName: 'gift_delivered',
      subscriberId: telegramId,
      botInstanceId: botId,
      campaignId: campaign.id,
    });

    await updateCrmGiftTag(tenantId, campaign.id, telegramId, true);
    try {
      await scheduleChain(tenantId, botId, campaign.id, telegramId, chatId, 'after_gift', funnel.afterGift);
    } catch (err) {
      console.error('[gift-bot] schedule after_gift failed:', err);
    }
  }
}

async function deliverGift(
  botApi: string,
  chatId: number,
  funnel: GiftFunnelConfig,
  ctx?: SendCtx,
) {
  const { gift } = funnel;
  const caption = gift.caption || 'Вот твой подарок 🎁';
  const media = gift.telegramFileId || gift.url;
  const keyboard = extraButtonsKeyboard(gift.extraButtons);
  if (gift.type === 'link') {
    await sendBotMessage(botApi, chatId, `${caption}\n\n${gift.url}`, keyboard, ctx);
    return;
  }
  if (!media) {
    await sendBotMessage(botApi, chatId, caption, keyboard, ctx);
    return;
  }

  // Telegram file_id prefix is authoritative (mediaType in DB can be wrong after uploads)
  const hint =
    gift.type === 'video'
      ? 'video'
      : normalizeGiftMediaType(gift.mediaType) || (gift.type === 'file' ? 'document' : undefined);
  const kind = detectStoredMediaKind(media, hint);
  await sendBotStoredMedia(botApi, chatId, media, caption, kind, keyboard, ctx);
}

async function sendStartWithSubscribeButtons(
  botApi: string,
  chatId: number,
  funnel: GiftFunnelConfig,
  campaign: any,
  ctx?: SendCtx,
) {
  const media = resolveTelegramMedia({
    telegramFileId: funnel.start.telegramFileId,
    imageUrl: funnel.start.imageUrl,
  });
  const keyboard = subscribeKeyboard(funnel, campaign, funnel.start.extraButtons);
  if (media) {
    const kind = detectStoredMediaKind(media, funnel.start.mediaType);
    await sendBotStoredMedia(botApi, chatId, media, funnel.start.text, kind, keyboard, ctx);
  } else {
    await sendBotMessage(botApi, chatId, funnel.start.text, keyboard, ctx);
  }
}

/** Valid http(s) URL rows for Telegram inline keyboard */
function appendExtraButtonRows(rows: any[], buttons?: GiftExtraButton[]) {
  for (const b of buttons || []) {
    const text = String(b?.text || '').trim();
    const url = String(b?.url || '').trim();
    if (text && /^https?:\/\//i.test(url)) {
      rows.push([{ text, url }]);
    }
  }
  return rows;
}

function extraButtonsKeyboard(buttons?: GiftExtraButton[]) {
  const rows = appendExtraButtonRows([], buttons);
  return rows.length ? { inline_keyboard: rows } : undefined;
}

function subscribeKeyboard(
  funnel: GiftFunnelConfig,
  campaign: any,
  extraButtons?: GiftExtraButton[],
) {
  const channelUrl = campaign.channelUsername
    ? `https://t.me/${String(campaign.channelUsername).replace(/^@/, '')}`
    : undefined;
  const confirm = funnel.subscribeButton?.confirmLabel || 'Я подписался ✅';
  const rows: any[] = [];
  if (channelUrl) {
    rows.push([{ text: 'Перейти в канал', url: channelUrl }]);
  }
  appendExtraButtonRows(rows, extraButtons);
  rows.push([{ text: confirm, callback_data: `check_sub:${campaign.id}` }]);
  return { inline_keyboard: rows };
}

function getFunnel(campaign: any): GiftFunnelConfig {
  const raw = campaign.funnelJson as GiftFunnelConfig | null;
  if (raw && raw.start && raw.gift) return raw;
  // Legacy steps[] format fallback
  if ((raw as any)?.steps?.[0]) {
    return {
      ...DEFAULT_GIFT_FUNNEL,
      start: { text: (raw as any).steps[0].message || DEFAULT_GIFT_FUNNEL.start.text },
    };
  }
  return DEFAULT_GIFT_FUNNEL;
}

async function scheduleChain(
  tenantId: string,
  botId: string,
  campaignId: string,
  telegramId: string,
  chatId: number,
  kind: DelayJob['kind'],
  messages: GiftFunnelMessage[],
) {
  // BullMQ custom jobId cannot contain ":"
  const safeId = (...parts: Array<string | number>) =>
    parts.map((p) => String(p).replace(/[^a-zA-Z0-9_-]/g, '_')).join('_');

  let cumulative = 0;
  for (let index = 0; index < messages.length; index++) {
    cumulative += Math.max(0, messages[index].delayMinutes);
    const delayMs = cumulative * 60 * 1000;
    const baseId = safeId(campaignId, telegramId, kind, index);
    if (delayMs <= 0 && index === 0) {
      await delayQueue.add(
        `${kind}-${index}`,
        { kind, index, tenantId, botId, campaignId, telegramId, chatId },
        { delay: 1500, jobId: safeId(baseId, Date.now()), removeOnComplete: true },
      );
      continue;
    }
    await delayQueue.add(
      `${kind}-${index}`,
      { kind, index, tenantId, botId, campaignId, telegramId, chatId },
      {
        delay: Math.max(delayMs, 1000),
        jobId: baseId,
        removeOnComplete: true,
      },
    );
  }
}

async function cancelPendingDelays(
  telegramId: string,
  campaignId: string,
  kinds: Array<'not_subscribed' | 'not_gifted' | 'after_gift'> = ['not_subscribed', 'not_gifted'],
) {
  const jobs = await delayQueue.getJobs(['delayed', 'waiting']);
  for (const job of jobs) {
    const data = job.data as DelayJob;
    if (
      data.campaignId === campaignId &&
      data.telegramId === telegramId &&
      kinds.includes(data.kind)
    ) {
      await job.remove();
    }
  }
}

async function processDelayJob(job: DelayJob) {
  const sub = await prisma.giftSubscriber.findUnique({
    where: {
      campaignId_telegramId: { campaignId: job.campaignId, telegramId: job.telegramId },
    },
  });
  if (!sub) return;

  if (job.kind === 'not_subscribed' && (sub.subscribed || sub.giftDelivered)) return;
  if (job.kind === 'not_gifted' && sub.giftDelivered) return;
  if (job.kind === 'after_gift' && !sub.giftDelivered) return;

  const bot = await prisma.botInstance.findFirst({
    where: { id: job.botId, status: 'active' },
    include: { giftCampaigns: { where: { id: job.campaignId }, take: 1 } },
  });
  if (!bot?.botTokenEncrypted || !bot.giftCampaigns[0]) return;

  // Skip if conversation handed to human
  const conversation = await prisma.conversation.findFirst({
    where: {
      tenantId: job.tenantId,
      botInstanceId: job.botId,
      platformUserId: job.telegramId,
      mode: 'human',
    },
  });
  if (conversation) return;

  const funnel = getFunnel(bot.giftCampaigns[0]);
  const list =
    job.kind === 'not_subscribed'
      ? funnel.notSubscribed
      : job.kind === 'after_gift'
        ? funnel.afterGift
        : funnel.notGifted;
  const msg = list[job.index];
  if (!msg) return;

  const botApi = `https://api.telegram.org/bot${decrypt(bot.botTokenEncrypted)}`;
  const keyboard =
    job.kind === 'not_subscribed' || job.kind === 'not_gifted'
      ? subscribeKeyboard(funnel, bot.giftCampaigns[0], msg.extraButtons)
      : extraButtonsKeyboard(msg.extraButtons);
  const ctx: SendCtx = {
    tenantId: job.tenantId,
    botId: job.botId,
    telegramId: job.telegramId,
  };

  if (msg.telegramFileId || msg.imageUrl) {
    const media = resolveTelegramMedia({
      telegramFileId: msg.telegramFileId,
      imageUrl: msg.imageUrl,
    })!;
    const kind = detectStoredMediaKind(media, msg.mediaType);
    await sendBotStoredMedia(botApi, job.chatId, media, msg.text, kind, keyboard, ctx);
  } else {
    await sendBotMessage(botApi, job.chatId, msg.text, keyboard, ctx);
  }

  await prisma.giftSubscriber.update({
    where: { id: sub.id },
    data: { lastMessageAt: new Date() },
  });
}

async function processBroadcast(broadcastId: string) {
  const broadcast = await prisma.broadcast.findUnique({ where: { id: broadcastId } });
  if (!broadcast) return;
  const msg = broadcast.messageJson as any;
  const channel =
    msg?.channel === 'gramjs' || msg?.channel === 'wa' || msg?.channel === 'story'
      ? msg.channel
      : 'gift';

  if (channel === 'story') {
    await processStoryBroadcast(broadcast, msg);
    return;
  }

  if (channel === 'gramjs' || channel === 'wa') {
    await processChannelBroadcast(broadcast, msg, channel);
    return;
  }

  const bot = await prisma.botInstance.findFirst({
    where: { id: msg.botId, tenantId: broadcast.tenantId },
  });
  if (!bot?.botTokenEncrypted) {
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: 'failed' } });
    return;
  }

  const where: any = { campaignId: msg.campaignId };
  if (Array.isArray(msg.subscriberIds) && msg.subscriberIds.length > 0) {
    where.id = { in: msg.subscriberIds.map(String) };
  } else {
    if (msg.segment === 'gifted') where.giftDelivered = true;
    if (msg.segment === 'not_gifted') where.giftDelivered = false;
    // Backward-compatible: older scheduled jobs omit funnelPhase
    if (typeof msg.funnelPhase === 'string' && msg.funnelPhase) {
      where.funnelPhase = msg.funnelPhase;
    }
  }

  const subscribers = await prisma.giftSubscriber.findMany({ where });
  const botApi = `https://api.telegram.org/bot${decrypt(bot.botTokenEncrypted)}`;
  const media = resolveTelegramMedia({
    telegramFileId: msg.telegramFileId,
    mediaUrl: msg.mediaUrl,
  });
  let sent = 0;
  for (const s of subscribers) {
    try {
      const ctx: SendCtx = {
        tenantId: broadcast.tenantId,
        botId: bot.id,
        telegramId: s.telegramId,
      };
      if (media) {
        const kind = detectStoredMediaKind(media, msg.mediaType);
        await sendBotStoredMedia(
          botApi,
          Number(s.telegramId),
          media,
          msg.text,
          kind,
          undefined,
          ctx,
        );
      } else {
        await sendBotMessage(botApi, Number(s.telegramId), msg.text, undefined, ctx);
      }
      await prisma.giftSubscriber.update({
        where: { id: s.id },
        data: {
          lastMailingBroadcastId: broadcast.id,
          lastMailingAt: new Date(),
        },
      });
      sent += 1;
      await sleep(40);
    } catch (err) {
      console.error('[gift-bot] broadcast send failed', s.telegramId, err);
    }
  }
  await prisma.broadcast.update({
    where: { id: broadcastId },
    data: { status: 'sent', sentCount: sent },
  });
}

async function processStoryBroadcast(
  broadcast: { id: string; tenantId: string },
  msg: any,
) {
  const botId = String(msg.botId || '');
  const mediaUrl = String(msg.mediaUrl || '').trim();
  const storyVia = String(msg.storyVia || '');
  if (!botId || !mediaUrl) {
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: 'failed' },
    });
    return;
  }

  if (storyVia !== 'gramjs') {
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        status: 'failed',
        messageJson: {
          ...msg,
          error:
            storyVia === 'wa' || storyVia === 'ai_tg'
              ? `stories_unsupported_${storyVia}`
              : 'stories_unsupported',
        },
      },
    });
    console.warn(
      '[gift-bot] story send unsupported for',
      storyVia,
      '— scheduled job marked failed (ADR-019)',
    );
    return;
  }

  try {
    await sendViaGramjsStory({
      botId,
      mediaUrl,
      text: String(msg.text || ''),
      mediaType: msg.mediaType,
    });
    // Tag open conversations on this account for inbound attribution window
    await prisma.conversation.updateMany({
      where: {
        tenantId: broadcast.tenantId,
        botInstanceId: botId,
        status: { not: 'closed' },
      },
      data: {
        lastMailingBroadcastId: broadcast.id,
        lastMailingAt: new Date(),
      },
    });
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: 'sent', sentCount: 1 },
    });
  } catch (err) {
    console.error('[gift-bot] story send failed', err);
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: {
        status: 'failed',
        messageJson: {
          ...msg,
          error: String((err as Error)?.message || err),
        },
      },
    });
  }
}

async function sendViaGramjsStory(opts: {
  botId: string;
  mediaUrl: string;
  text: string;
  mediaType?: string;
}): Promise<void> {
  const token = serviceToken();
  if (!token) throw new Error('VOXLY_SERVICE_TOKEN is not configured');
  const res = await fetch(`${gramjsBridgeBase()}/stories/send`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      mediaUrl: opts.mediaUrl,
      text: opts.text,
      mediaType: opts.mediaType,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `GramJS story send failed (HTTP ${res.status})`);
  }
}

async function processChannelBroadcast(
  broadcast: { id: string; tenantId: string },
  msg: any,
  channel: 'gramjs' | 'wa',
) {
  const botId = String(msg.botId || '');
  const text = String(msg.text || '').trim();
  if (!botId || !text) {
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: 'failed' },
    });
    return;
  }

  const bot = await prisma.botInstance.findFirst({
    where: {
      id: botId,
      tenantId: broadcast.tenantId,
      botType: channel === 'gramjs' ? 'ai_gramjs' : 'ai_wa',
    },
  });
  if (!bot || bot.status !== 'active') {
    await prisma.broadcast.update({
      where: { id: broadcast.id },
      data: { status: 'failed' },
    });
    return;
  }

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId: broadcast.tenantId,
      botInstanceId: botId,
      status: { not: 'closed' },
      ...(Array.isArray(msg.conversationIds) && msg.conversationIds.length > 0
        ? { id: { in: msg.conversationIds.map(String) } }
        : {}),
    },
    select: { id: true, platformUserId: true },
  });

  let mediaPayload:
    | { mediaBase64: string; mimeType: string; fileName: string }
    | undefined;
  if (channel === 'wa' && typeof msg.mediaUrl === 'string' && msg.mediaUrl) {
    try {
      mediaPayload = await fetchMediaAsBase64(msg.mediaUrl, msg.mediaType);
    } catch (err) {
      console.error('[gift-bot] channel broadcast media fetch failed', err);
    }
  } else if (channel === 'gramjs' && msg.mediaUrl) {
    console.warn(
      '[gift-bot] GramJS mailing: media skipped (outbound media not supported); text only',
    );
  }

  let sent = 0;
  for (const conv of conversations) {
    try {
      if (channel === 'gramjs') {
        await sendViaGramjsBridge({
          botId,
          peerUserId: conv.platformUserId,
          text,
        });
      } else {
        await sendViaWhatsappWorker({
          botId,
          peerUserId: conv.platformUserId,
          text,
          media: mediaPayload,
        });
      }
      await prisma.chatMessage.create({
        data: {
          conversationId: conv.id,
          role: 'operator',
          content: text,
          deliveryStatus: 'sent',
        },
      });
      try {
        await prisma.broadcastRecipient.create({
          data: {
            broadcastId: broadcast.id,
            conversationId: conv.id,
            status: 'sent',
            sentAt: new Date(),
          },
        });
      } catch (err) {
        console.warn('[gift-bot] BroadcastRecipient create skipped', err);
      }
      await prisma.conversation.update({
        where: { id: conv.id },
        data: {
          lastMailingBroadcastId: broadcast.id,
          lastMailingAt: new Date(),
        },
      });
      sent += 1;
      await sleep(channel === 'gramjs' ? 120 : 80);
    } catch (err) {
      console.error(
        '[gift-bot] channel broadcast send failed',
        channel,
        conv.platformUserId,
        err,
      );
      try {
        await prisma.broadcastRecipient.create({
          data: {
            broadcastId: broadcast.id,
            conversationId: conv.id,
            status: 'failed',
            error: err instanceof Error ? err.message : String(err),
          },
        });
      } catch {
        // ignore until migrate
      }
    }
  }

  let deliveredCount = 0;
  let readCount = 0;
  let failedCount = 0;
  try {
    const recipients = await prisma.broadcastRecipient.findMany({
      where: { broadcastId: broadcast.id },
      select: { status: true },
    });
    for (const r of recipients) {
      if (r.status === 'delivered' || r.status === 'read') deliveredCount += 1;
      if (r.status === 'read') readCount += 1;
      if (r.status === 'failed') failedCount += 1;
    }
  } catch {
    // table may not exist until migrate
  }

  await prisma.broadcast.update({
    where: { id: broadcast.id },
    data: {
      status: sent > 0 ? 'sent' : 'failed',
      sentCount: sent,
      messageJson: {
        ...msg,
        deliveredCount,
        readCount,
        failedCount,
      },
    },
  });
}

function serviceToken(): string {
  return process.env.VOXLY_SERVICE_TOKEN || '';
}

function gramjsBridgeBase(): string {
  return (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(/\/$/, '');
}

/** Pull phone/about/birthday/name via personal TG session (Bot API cannot see these). */
async function enrichPersonFromGramjs(
  tenantId: string,
  client: TwentyClient,
  personId: string,
  opts: { telegramId?: string; username?: string },
): Promise<void> {
  const token = serviceToken();
  if (!token || !personId) return;

  const gramjs = await prisma.botInstance.findFirst({
    where: {
      tenantId,
      botType: 'ai_gramjs',
      status: 'active',
      botTokenEncrypted: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (!gramjs) {
    console.warn(
      `[gift-bot] GramJS profile enrich skipped (no ai_gramjs) tenant=${tenantId}`,
    );
    return;
  }

  try {
    const res = await fetch(`${gramjsBridgeBase()}/users/full`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        botId: gramjs.id,
        tenantId,
        userId: opts.telegramId,
        username: opts.username,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      profile?: {
        username?: string;
        firstName?: string;
        lastName?: string;
        phone?: string;
        about?: string;
        birthday?: string;
        personalChannelUrl?: string;
      };
      error?: string;
    };
    if (!res.ok || !json.ok || !json.profile) {
      console.warn(
        `[gift-bot] GramJS /users/full failed: ${json.error || `HTTP ${res.status}`}`,
      );
      return;
    }
    await client.applyTelegramProfile(personId, json.profile);
    if (json.profile.phone && opts.telegramId) {
      await prisma.giftSubscriber.updateMany({
        where: { tenantId, telegramId: opts.telegramId },
        data: { phone: json.profile.phone },
      });
    }
  } catch (err) {
    console.warn('[gift-bot] GramJS profile enrich error', err);
  }
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
  const token = serviceToken();
  if (!token) throw new Error('VOXLY_SERVICE_TOKEN is not configured');
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
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `GramJS send failed (HTTP ${res.status})`);
  }
}

async function sendViaWhatsappWorker(opts: {
  botId: string;
  peerUserId: string;
  text: string;
  media?: { mediaBase64: string; mimeType: string; fileName: string };
}): Promise<void> {
  const token = serviceToken();
  if (!token) throw new Error('VOXLY_SERVICE_TOKEN is not configured');
  const body: Record<string, unknown> = {
    botId: opts.botId,
    to: opts.peerUserId,
    text: opts.text || '',
    markRead: false,
  };
  if (opts.media) {
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
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.error || `WhatsApp send failed (HTTP ${res.status})`);
  }
}

async function fetchMediaAsBase64(
  mediaUrl: string,
  mediaType?: string,
): Promise<{ mediaBase64: string; mimeType: string; fileName: string }> {
  const res = await fetch(mediaUrl);
  if (!res.ok) throw new Error(`media fetch HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 15 * 1024 * 1024) {
    throw new Error('media too large (>15MB)');
  }
  const contentType = res.headers.get('content-type') || '';
  const mimeType =
    contentType.split(';')[0].trim() ||
    (mediaType === 'video' ? 'video/mp4' : 'image/jpeg');
  const ext = mimeType.includes('video')
    ? 'mp4'
    : mimeType.includes('png')
      ? 'png'
      : mimeType.includes('webp')
        ? 'webp'
        : 'jpg';
  return {
    mediaBase64: buf.toString('base64'),
    mimeType,
    fileName: `broadcast.${ext}`,
  };
}

async function trackPromoClick(
  botApi: string,
  tenantId: string,
  botId: string,
  campaign: any,
) {
  const promo = (campaign.promoPost || {}) as GiftPromoPost;
  const nextCount = (promo.clickCount || 0) + 1;
  const showCounter = promoShowClickCounter(promo);
  const next: GiftPromoPost = {
    text: promo.text || '',
    mediaType: promo.telegramFileId
      ? detectStoredMediaKind(promo.telegramFileId, normalizeGiftMediaType(promo.mediaType))
      : normalizeGiftMediaType(promo.mediaType) || 'photo',
    telegramFileId: promo.telegramFileId,
    telegramFileUniqueId: promo.telegramFileUniqueId,
    mediaUrl: promo.mediaUrl || promo.imageUrl,
    buttonText: promo.buttonText || 'Получить подарок',
    clickCount: nextCount,
    showClickCounter: showCounter,
    telegramMessageId: promo.telegramMessageId,
    telegramChatId: promo.telegramChatId,
    publishedAt: promo.publishedAt,
  };

  await prisma.giftCampaignConfig.update({
    where: { id: campaign.id },
    data: { promoPost: next as object },
  });
  // Keep in-memory campaign in sync for this request
  campaign.promoPost = next;

  // Only rewrite channel button when the counter is shown on the label
  if (showCounter && next.telegramMessageId && next.telegramChatId) {
    const bot = await prisma.botInstance.findUnique({
      where: { id: botId },
      select: { botUsername: true },
    });
    if (bot?.botUsername) {
      const buttonUrl = `https://t.me/${bot.botUsername}?start=${giftPromoStartPayload(campaign.id)}`;
      const label = formatPromoButtonLabel(next.buttonText, nextCount, true);
      try {
        await fetch(`${botApi}/editMessageReplyMarkup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: next.telegramChatId,
            message_id: next.telegramMessageId,
            reply_markup: {
              inline_keyboard: [[{ text: label, url: buttonUrl }]],
            },
          }),
        });
      } catch (err) {
        console.error('[gift-bot] editMessageReplyMarkup failed:', err);
      }
    }
  }

  await fireGoal({
    tenantId,
    goalName: 'promo_click',
    subscriberId: campaign.id,
    botInstanceId: botId,
    campaignId: campaign.id,
  });
}

async function fillExistingPersonTelegram(
  tenantId: string,
  personId: string,
  opts: { username?: string; userId?: string },
): Promise<void> {
  if (!opts.username && !opts.userId) return;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const owner = await prisma.tenantMember.findFirst({
    where: { tenantId, role: 'owner' },
    include: { user: true },
  });
  if (
    !tenant?.twentyWorkspaceId ||
    !tenant.twentyOwnerPasswordEncrypted ||
    !owner?.user?.email
  ) {
    return;
  }
  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  try {
    await client.ensureTelegramField();
  } catch {
    /* continue — update may still work if field exists */
  }
  await client.updatePersonTelegram(personId, {
    username: opts.username,
    userId: opts.userId,
  });
}

/** Push shared Telegram contact phone → Twenty Person.phones (best-effort). */
async function syncPhoneToCrmPerson(
  tenantId: string,
  botId: string,
  telegramId: string,
  phone: string,
): Promise<void> {
  const sub = await prisma.giftSubscriber.findFirst({
    where: {
      tenantId,
      botInstanceId: botId,
      telegramId,
      twentyPersonId: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
  });
  const personId = sub?.twentyPersonId;
  if (!personId) return;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const owner = await prisma.tenantMember.findFirst({
    where: { tenantId, role: 'owner' },
    include: { user: true },
  });
  if (
    !tenant?.twentyWorkspaceId ||
    !tenant.twentyOwnerPasswordEncrypted ||
    !owner?.user?.email
  ) {
    return;
  }
  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  await client.updatePersonPhone(personId, phone);

  // Phone shared → TG already known; fill MAX + WA via saas-api.
  const token = process.env.VOXLY_SERVICE_TOKEN || '';
  const saas =
    (process.env.SAAS_API_URL || 'http://saas-api:3002').replace(/\/$/, '');
  if (token) {
    try {
      await fetch(`${saas}/api/internal/crm/enrich-by-phone`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Voxly-Service': 'gift-bot-worker',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId,
          personId,
          phone,
          channels: ['max', 'whatsapp', 'telegram'],
        }),
      });
    } catch (err) {
      console.warn('[gift-bot] cross-channel enrich failed', err);
    }
  }
}

async function syncSubscriberToCRM(
  tenantId: string,
  botId: string,
  campaign: { id: string; name?: string | null; channelUsername?: string | null },
  botUsername: string | null | undefined,
  person: { telegramId: string; username?: string; firstName?: string },
): Promise<{ personId?: string; opportunityId?: string }> {
  try {
    const existingSub = await prisma.giftSubscriber.findUnique({
      where: {
        campaignId_telegramId: { campaignId: campaign.id, telegramId: person.telegramId },
      },
    });
    if (existingSub?.twentyPersonId && existingSub?.twentyOpportunityId) {
      if (
        (person.username || person.telegramId) &&
        !telegramHandleFilled.has(existingSub.twentyPersonId)
      ) {
        telegramHandleFilled.add(existingSub.twentyPersonId);
        void fillExistingPersonTelegram(tenantId, existingSub.twentyPersonId, {
          username: person.username,
          userId: person.telegramId,
        }).catch(() => {
          telegramHandleFilled.delete(existingSub.twentyPersonId!);
        });
      }
      // Best-effort: refresh phone/ДР/bio when personal TG session can see the peer.
      void (async () => {
        try {
          const tenantRow = await prisma.tenant.findUnique({ where: { id: tenantId } });
          const ownerRow = await prisma.tenantMember.findFirst({
            where: { tenantId, role: 'owner' },
            include: { user: true },
          });
          if (
            !tenantRow?.twentyWorkspaceId ||
            !tenantRow.twentyOwnerPasswordEncrypted ||
            !ownerRow?.user?.email
          ) {
            return;
          }
          const tc = new TwentyClient({
            apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
          });
          await tc.authenticateWorkspace(
            ownerRow.user.email,
            decrypt(tenantRow.twentyOwnerPasswordEncrypted),
            tenantRow.twentyWorkspaceId,
          );
          await enrichPersonFromGramjs(tenantId, tc, existingSub.twentyPersonId!, {
            telegramId: person.telegramId,
            username: person.username,
          });
        } catch {
          /* ignore */
        }
      })();
      return {
        personId: existingSub.twentyPersonId,
        opportunityId: existingSub.twentyOpportunityId,
      };
    }

    // Reuse Person from any prior bot/campaign for this Telegram user (anti-dupe)
    const linkedElsewhere = await prisma.giftSubscriber.findFirst({
      where: {
        tenantId,
        telegramId: person.telegramId,
        twentyPersonId: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
      return {
        personId: existingSub?.twentyPersonId || linkedElsewhere?.twentyPersonId || undefined,
        opportunityId: existingSub?.twentyOpportunityId || undefined,
      };
    }

    const owner = await prisma.tenantMember.findFirst({
      where: { tenantId, role: 'owner' },
      include: { user: true },
    });
    if (!owner?.user?.email) {
      return {
        personId: existingSub?.twentyPersonId || linkedElsewhere?.twentyPersonId || undefined,
        opportunityId: existingSub?.twentyOpportunityId || undefined,
      };
    }

    const client = new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    });
    const password = decrypt(tenant.twentyOwnerPasswordEncrypted);
    await client.authenticateWorkspace(
      owner.user.email,
      password,
      tenant.twentyWorkspaceId,
    );

    try {
      await client.ensureTelegramField();
    } catch (err) {
      console.warn('[gift-bot] ensureTelegramField failed', err);
    }

    let personId =
      existingSub?.twentyPersonId || linkedElsewhere?.twentyPersonId || undefined;

    if (!personId) {
      const found = await client.findPersonByHint({
        username: person.username,
        telegramId: person.telegramId,
        lastName: person.username
          ? `@${person.username.replace(/^@/, '')}`
          : person.telegramId,
      });
      personId = found?.id;
    }

    if (!personId) {
      const createdPerson = await client.createPerson({
        firstName: person.firstName || person.username || `TG ${person.telegramId}`,
        lastName: person.username
          ? `@${person.username.replace(/^@/, '')}`
          : person.telegramId,
        telegram: person.username,
        telegramUserId: person.telegramId,
        phone: existingSub?.phone || undefined,
      });
      personId = createdPerson?.id;
    } else if (person.username || person.telegramId) {
      // Best-effort: fill Telegram open link (@username or tg:// via user id)
      try {
        await client.updatePersonTelegram(personId, {
          username: person.username,
          userId: person.telegramId,
        });
        telegramHandleFilled.add(personId);
      } catch {
        /* ignore */
      }
    }

    let opportunityId = existingSub?.twentyOpportunityId || undefined;
    // suppressDealCreation is manual only (CRM «Не создавать сделку») — never auto-set on delete.
    let suppressDeal =
      (existingSub as { suppressDealCreation?: boolean } | null | undefined)
        ?.suppressDealCreation === true;
    if (
      opportunityId &&
      !(await client.opportunityExists(opportunityId))
    ) {
      opportunityId = undefined;
      if (existingSub?.id) {
        await prisma.giftSubscriber.update({
          where: { id: existingSub.id },
          data: { twentyOpportunityId: null },
        });
      }
    }

    // Reuse open deal for this Person (AI/GramJS/WA/other gift) — anti-dupe leads.
    if (!opportunityId && personId) {
      const fromGift = await prisma.giftSubscriber.findFirst({
        where: {
          tenantId,
          twentyPersonId: personId,
          twentyOpportunityId: { not: null },
          NOT: existingSub?.id ? { id: existingSub.id } : undefined,
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (
        fromGift?.twentyOpportunityId &&
        (await client.opportunityExists(fromGift.twentyOpportunityId))
      ) {
        opportunityId = fromGift.twentyOpportunityId;
      }
    }
    if (!opportunityId && personId) {
      const fromConv = await prisma.conversation.findFirst({
        where: {
          tenantId,
          twentyPersonId: personId,
          twentyOpportunityId: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (
        fromConv?.twentyOpportunityId &&
        (await client.opportunityExists(fromConv.twentyOpportunityId))
      ) {
        opportunityId = fromConv.twentyOpportunityId;
      }
    }

    if (!opportunityId && personId && !suppressDeal) {
      const who = person.username
        ? `@${person.username.replace(/^@/, '')}`
        : person.telegramId;
      const project = campaign.name?.trim() || 'Проект';
      const bot = botUsername ? `@${botUsername.replace(/^@/, '')}` : 'бот';
      const channel = campaign.channelUsername
        ? `@${String(campaign.channelUsername).replace(/^@/, '')}`
        : 'канал?';
      const opportunity = await client.createOpportunity({
        name: `${who} · ${project} · ${bot} · ${channel}`,
        personId,
        stage: 'NEW',
      });
      opportunityId = opportunity?.id;

      await fireGoal({
        tenantId,
        goalName: 'lead_created',
        subscriberId: person.telegramId,
        botInstanceId: botId,
        campaignId: campaign.id,
      });
    } else if (!opportunityId && personId && suppressDeal) {
      console.log(
        `[gift-bot] skip Opportunity create tg=${person.telegramId} (suppressDealCreation)`,
      );
    }

    if (personId) {
      try {
        await enrichPersonFromGramjs(tenantId, client, personId, {
          telegramId: person.telegramId,
          username: person.username,
        });
      } catch (err) {
        console.warn('[gift-bot] post-create GramJS enrich failed', err);
      }
    }

    return { personId, opportunityId };
  } catch (err) {
    console.error('[gift-bot] CRM sync error:', err);
    return {};
  }
}

async function updateCrmGiftTag(
  tenantId: string,
  campaignId: string,
  telegramId: string,
  gifted: boolean,
) {
  await prisma.giftSubscriber.updateMany({
    where: { campaignId, telegramId, tenantId },
    data: {
      giftDelivered: gifted,
      funnelPhase: gifted ? 'gifted' : 'not_gifted',
    },
  });
}

async function ensureConversation(
  tenantId: string,
  botId: string,
  telegramId: string,
  username?: string,
  firstName?: string,
) {
  const existing = await prisma.conversation.findFirst({
    where: { tenantId, botInstanceId: botId, platformUserId: telegramId },
  });
  if (existing) {
    await prisma.giftSubscriber.updateMany({
      where: { tenantId, botInstanceId: botId, telegramId },
      data: { conversationId: existing.id },
    });
    return existing;
  }
  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      botInstanceId: botId,
      platform: 'telegram',
      platformUserId: telegramId,
      platformUsername: username,
      platformFirstName: firstName,
      status: 'open',
      mode: 'bot',
    },
  });
  await prisma.giftSubscriber.updateMany({
    where: { tenantId, botInstanceId: botId, telegramId },
    data: { conversationId: conversation.id },
  });
  return conversation;
}

async function storeInboundMessage(
  tenantId: string,
  botId: string,
  update: any,
  botApi: string,
) {
  const telegramId = String(update.message.from.id);
  const attachments = extractTelegramAttachments(update.message);
  let text =
    update.message.text ||
    update.message.caption ||
    update.message.contact?.phone_number ||
    (attachments.length ? attachmentPlaceholder(attachments[0]) : '');
  if (!text && attachments.length === 0) return;

  // Same media understanding as Business AI path — enrich CRM ChatMessage for operators.
  // Gift funnel itself does not LLM-reply; ai_tg bots are forwarded upstream.
  if (attachments.length && OPENROUTER_API_KEY && !update.message.text) {
    try {
      text = await enrichGiftInboundMedia({
        tenantId,
        botApi,
        message: update.message,
        attachments,
        fallbackText: text,
      });
    } catch (err) {
      console.warn('[gift-bot] media enrich failed', err);
    }
  }

  const conversation = await ensureConversation(
    tenantId,
    botId,
    telegramId,
    update.message.from.username,
    update.message.from.first_name,
  );
  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: text || attachmentPlaceholder(attachments[0]),
      attachments: attachments.length ? attachments : undefined,
      externalMessageId:
        update.message.message_id != null ? String(update.message.message_id) : undefined,
    },
  });
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  // Mirror into Twenty Person note (ChatMessage custom object not installed yet)
  const sub = await prisma.giftSubscriber.findFirst({
    where: { tenantId, botInstanceId: botId, telegramId },
  });
  if (sub?.twentyPersonId && text) {
    await syncChatNoteToCRM(tenantId, sub.twentyPersonId, 'Сообщение из Telegram', text);
  }
  void maybeAttributeGiftMailingReply(tenantId, botId, telegramId, sub).catch((err) =>
    console.warn('[gift-bot] mailing attribution failed', err),
  );
}

type TgAttachment = {
  type: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'video_note' | 'sticker' | 'animation';
  fileId: string;
  fileUniqueId?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
};

function extractTelegramAttachments(message: any): TgAttachment[] {
  const out: TgAttachment[] = [];
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const best = message.photo[message.photo.length - 1];
    out.push({
      type: 'photo',
      fileId: best.file_id,
      fileUniqueId: best.file_unique_id,
      fileSize: best.file_size,
    });
  }
  if (message.video) {
    out.push({
      type: 'video',
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      mimeType: message.video.mime_type,
      fileName: message.video.file_name,
      fileSize: message.video.file_size,
    });
  }
  if (message.video_note) {
    out.push({
      type: 'video',
      fileId: message.video_note.file_id,
      fileUniqueId: message.video_note.file_unique_id,
      mimeType: 'video/mp4',
      fileName: 'video_note.mp4',
      fileSize: message.video_note.file_size,
    });
  }
  if (message.document) {
    out.push({
      type: 'document',
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      mimeType: message.document.mime_type,
      fileName: message.document.file_name,
      fileSize: message.document.file_size,
    });
  }
  if (message.audio) {
    out.push({
      type: 'audio',
      fileId: message.audio.file_id,
      fileUniqueId: message.audio.file_unique_id,
      mimeType: message.audio.mime_type,
      fileName: message.audio.file_name,
      fileSize: message.audio.file_size,
    });
  }
  if (message.voice) {
    out.push({
      type: 'voice',
      fileId: message.voice.file_id,
      fileUniqueId: message.voice.file_unique_id,
      mimeType: message.voice.mime_type,
      fileSize: message.voice.file_size,
    });
  }
  if (message.sticker) {
    out.push({
      type: 'sticker',
      fileId: message.sticker.file_id,
      fileUniqueId: message.sticker.file_unique_id,
      fileSize: message.sticker.file_size,
    });
  }
  if (message.animation) {
    out.push({
      type: 'animation',
      fileId: message.animation.file_id,
      fileUniqueId: message.animation.file_unique_id,
      mimeType: message.animation.mime_type,
      fileName: message.animation.file_name,
      fileSize: message.animation.file_size,
    });
  }
  return out;
}

function attachmentPlaceholder(a?: TgAttachment): string {
  if (!a) return '';
  if (a.type === 'photo') return '[фото]';
  if (a.fileName === 'video_note.mp4' || /video_note/i.test(a.fileName || '')) {
    return '[кружочек]';
  }
  if (a.type === 'video' || a.type === 'animation') return '[видео]';
  if (a.type === 'voice') return '[голосовое]';
  if (a.type === 'audio') return '[аудио]';
  if (a.type === 'sticker') return '[стикер]';
  return a.fileName ? `[файл: ${a.fileName}]` : '[файл]';
}

async function downloadGiftTelegramFile(
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
    console.warn('[gift-bot] getFile failed:', meta.description || meta);
    return null;
  }
  const token = botApi.replace(/^https:\/\/api\.telegram\.org\/bot/, '');
  const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) {
    console.warn('[gift-bot] file download failed', fileRes.status);
    return null;
  }
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  return { buffer, filePath: meta.result.file_path };
}

function giftAudioFormatFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.wav')) return 'wav';
  if (lower.endsWith('.m4a') || lower.endsWith('.mp4')) return 'm4a';
  if (lower.endsWith('.webm')) return 'webm';
  if (lower.endsWith('.flac')) return 'flac';
  return 'ogg';
}

async function softChargeGiftMedia(
  tenantId: string,
  model: string,
  usage: OpenRouterUsageLike | undefined,
  textLen: number,
  requestType: 'transcribe' | 'vision',
): Promise<void> {
  const estTokens = Math.max(1, Math.ceil(textLen / 4));
  try {
    const cost = await resolveProviderCostRub({
      model,
      usage: usage || { total_tokens: estTokens },
      apiKey: OPENROUTER_API_KEY,
      baseUrl: OPENROUTER_BASE_URL,
    });
    await chargeAiUsage({
      tenantId,
      providerCostRub: cost.providerCostRub,
      tokens: cost.tokens || estTokens,
      model,
      requestType,
      channel: AI_USAGE_CHANNELS.GIFT_BOT,
    });
  } catch (err) {
    // Gift tenants may lack AI wallet — enrichment still useful for CRM.
    console.warn('[gift-bot] media charge skipped', err);
  }
}

async function giftTranscribeAudio(
  buffer: Buffer,
  format: string,
  model: string,
): Promise<{ text: string; usage?: OpenRouterUsageLike } | null> {
  if (!OPENROUTER_API_KEY) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/audio/transcriptions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.VOXLY_PUBLIC_URL || 'https://getvoxly.ru',
        'X-Title': 'Voxly Gift Bot ASR',
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
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[gift-bot] transcription HTTP', res.status, errText.slice(0, 300));
      return null;
    }
    const data = (await res.json()) as { text?: string; usage?: OpenRouterUsageLike };
    const text = data.text?.trim();
    return text ? { text, usage: data.usage } : null;
  } catch (err) {
    console.warn('[gift-bot] transcription failed', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function giftDescribeImage(
  buffer: Buffer,
  mime: string,
  caption: string | undefined,
  model: string,
): Promise<{ text: string; usage?: OpenRouterUsageLike } | null> {
  if (!OPENROUTER_API_KEY) return null;
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const prompt =
    'Опиши изображение кратко для оператора CRM: что на фото, текст/цены если видны. 1–3 предложения на русском, только факты.' +
    (caption ? ` Подпись пользователя: ${caption}` : '');
  try {
    const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.VOXLY_PUBLIC_URL || 'https://getvoxly.ru',
        'X-Title': 'Voxly Gift Bot Vision',
      },
      body: JSON.stringify({
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
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[gift-bot] vision HTTP', res.status, errText.slice(0, 300));
      return null;
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: OpenRouterUsageLike;
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    return text ? { text, usage: data.usage } : null;
  } catch (err) {
    console.warn('[gift-bot] vision failed', err);
    return null;
  }
}

async function enrichGiftInboundMedia(opts: {
  tenantId: string;
  botApi: string;
  message: any;
  attachments: TgAttachment[];
  fallbackText: string;
}): Promise<string> {
  const a = opts.attachments[0];
  if (!a?.fileId) return opts.fallbackText;
  const caption =
    typeof opts.message.caption === 'string' ? opts.message.caption.trim() : '';
  const isVideoNote =
    Boolean(opts.message.video_note) ||
    a.fileName === 'video_note.mp4' ||
    /video_note/i.test(a.fileName || '');
  const isVideo =
    !isVideoNote &&
    (a.type === 'video' ||
      Boolean(opts.message.video) ||
      (a.type === 'document' && (a.mimeType || '').startsWith('video/')));
  const isAudio = a.type === 'voice' || a.type === 'audio';
  const isImage = a.type === 'photo' || a.type === 'sticker';
  const docKind =
    a.type === 'document' && !isVideo
      ? detectDocumentKind({ mimeType: a.mimeType, fileName: a.fileName })
      : null;

  if (a.type === 'animation') return opts.fallbackText;

  if (isVideo || isVideoNote) {
    const duration =
      opts.message.video_note?.duration ?? opts.message.video?.duration;
    const tooBig =
      typeof a.fileSize === 'number' && a.fileSize > ASR_MEDIA_MAX_BYTES;
    const tooLong =
      typeof duration === 'number' && duration > ASR_VIDEO_MAX_DURATION_SEC;
    const tag = isVideoNote ? 'кружочек' : 'видео';
    const fail = caption
      ? `${caption}\n\n[${tag} — не удалось разобрать речь. Опиши текстом, пожалуйста.]`
      : `[${tag} — не удалось разобрать речь. Опиши текстом, пожалуйста.]`;
    if (tooBig || tooLong) return fail;
    const file = await downloadGiftTelegramFile(opts.botApi, a.fileId);
    if (!file || file.buffer.length === 0 || file.buffer.length > ASR_MEDIA_MAX_BYTES) {
      return fail;
    }
    const asrModel = process.env.AI_ASR_MODEL || AI_MODEL_DEFAULTS.asr;
    let asrBuf = file.buffer;
    let format = 'mp4';
    const extracted = await extractAudioFromVideo(file.buffer, 'mp4');
    if (extracted) {
      asrBuf = Buffer.from(extracted.buffer);
      format = extracted.format;
    }
    const asr = await giftTranscribeAudio(asrBuf, format, asrModel);
    if (!asr?.text) return fail;
    void softChargeGiftMedia(opts.tenantId, asrModel, asr.usage, asr.text.length, 'transcribe');
    return caption
      ? `${caption}\n\n[${tag}]: ${asr.text}`
      : `[${tag}]: ${asr.text}`;
  }

  if (isAudio) {
    const fail = caption
      ? `${caption}\n\n[голосовое — не удалось распознать]`
      : '[голосовое — не удалось распознать]';
    const file = await downloadGiftTelegramFile(opts.botApi, a.fileId);
    if (!file) return fail;
    const asrModel = process.env.AI_ASR_MODEL || AI_MODEL_DEFAULTS.asr;
    const format = giftAudioFormatFromPath(file.filePath);
    const asr = await giftTranscribeAudio(file.buffer, format, asrModel);
    if (!asr?.text) return fail;
    void softChargeGiftMedia(opts.tenantId, asrModel, asr.usage, asr.text.length, 'transcribe');
    return caption
      ? `${caption}\n\n[голос]: ${asr.text}`
      : `[голос]: ${asr.text}`;
  }

  if (docKind) {
    if (typeof a.fileSize === 'number' && a.fileSize > DOC_MEDIA_MAX_BYTES) {
      return formatDocumentAiText({ kind: docKind, text: null, caption });
    }
    const file = await downloadGiftTelegramFile(opts.botApi, a.fileId);
    if (!file || file.buffer.length > DOC_MEDIA_MAX_BYTES) {
      return formatDocumentAiText({ kind: docKind, text: null, caption });
    }
    const extracted = await extractDocumentText(file.buffer, docKind);
    return formatDocumentAiText({
      kind: docKind,
      text: extracted,
      caption,
      fileName: a.fileName,
    });
  }

  if (isImage) {
    const fail = caption
      ? `${caption}\n\n[${a.type === 'sticker' ? 'стикер' : 'фото'} — не удалось описать]`
      : `[${a.type === 'sticker' ? 'стикер' : 'фото'} — не удалось описать]`;
    const file = await downloadGiftTelegramFile(opts.botApi, a.fileId);
    if (!file) return fail;
    const visionModel = process.env.AI_CHAT_MODEL || AI_MODEL_DEFAULTS.chat;
    const mime = a.type === 'sticker' ? 'image/webp' : a.mimeType || 'image/jpeg';
    const vision = await giftDescribeImage(file.buffer, mime, caption || undefined, visionModel);
    if (!vision?.text) return fail;
    void softChargeGiftMedia(opts.tenantId, visionModel, vision.usage, vision.text.length, 'vision');
    const tag = a.type === 'sticker' ? '[стикер]' : '[фото]';
    return caption ? `${caption}\n\n${tag}: ${vision.text}` : `${tag}: ${vision.text}`;
  }

  return opts.fallbackText;
}

async function maybeAttributeGiftMailingReply(
  tenantId: string,
  botId: string,
  telegramId: string,
  sub: {
    twentyPersonId: string | null;
    lastMailingBroadcastId: string | null;
    lastMailingAt: Date | null;
  } | null,
): Promise<void> {
  if (
    !sub?.lastMailingBroadcastId ||
    !sub.twentyPersonId ||
    !isWithinMailingAttributionWindow(sub.lastMailingAt)
  ) {
    // Also check Conversation tags (channel mailing / stories)
    const conv = await prisma.conversation.findFirst({
      where: { tenantId, botInstanceId: botId, platformUserId: telegramId },
    });
    if (
      !conv?.lastMailingBroadcastId ||
      !conv.twentyPersonId ||
      !isWithinMailingAttributionWindow(conv.lastMailingAt)
    ) {
      return;
    }
    await syncChatNoteToCRM(
      tenantId,
      conv.twentyPersonId,
      'Ответ после рассылки',
      mailingAttributionNote({
        broadcastId: conv.lastMailingBroadcastId,
        kind:
          ((await prisma.broadcast.findUnique({ where: { id: conv.lastMailingBroadcastId } }))
            ?.messageJson as { channel?: string } | null)?.channel === 'story'
            ? 'story'
            : 'broadcast',
      }),
    );
    await fireGoal({
      tenantId,
      goalName: 'mailing_reply',
      subscriberId: telegramId,
      botInstanceId: botId,
    });
    return;
  }

  await syncChatNoteToCRM(
    tenantId,
    sub.twentyPersonId,
    'Ответ после рассылки',
    mailingAttributionNote({ broadcastId: sub.lastMailingBroadcastId }),
  );
  await fireGoal({
    tenantId,
    goalName: 'mailing_reply',
    subscriberId: telegramId,
    botInstanceId: botId,
  });
}

async function syncChatNoteToCRM(
  tenantId: string,
  personId: string,
  title: string,
  body: string,
) {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant?.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) return;

    const owner = await prisma.tenantMember.findFirst({
      where: { tenantId, role: 'owner' },
      include: { user: true },
    });
    if (!owner?.user?.email) return;

    const client = new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    });
    const password = decrypt(tenant.twentyOwnerPasswordEncrypted);
    await client.authenticateWorkspace(
      owner.user.email,
      password,
      tenant.twentyWorkspaceId,
    );
    await client.createNoteForPerson({ personId, title, body });
  } catch (err) {
    console.error('[gift-bot] CRM note sync error:', err);
  }
}

async function checkChannelSubscription(
  botApi: string,
  channelId: string,
  telegramUserId: number,
  channelUsername?: string | null,
): Promise<boolean> {
  const candidates = [
    channelId,
    channelUsername ? `@${String(channelUsername).replace(/^@/, '')}` : null,
  ].filter(Boolean) as string[];

  for (const chatId of candidates) {
    try {
      const res = await fetch(`${botApi}/getChatMember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, user_id: telegramUserId }),
      });
      const data = (await res.json()) as any;
      if (!data.ok) {
        console.warn('[gift-bot] getChatMember failed:', chatId, data.description);
        continue;
      }
      const status = data.result?.status;
      if (['member', 'administrator', 'creator', 'restricted'].includes(status)) {
        return true;
      }
    } catch (err) {
      console.error('[gift-bot] checkChannelSubscription error:', chatId, err);
    }
  }
  return false;
}

function parseAttributionFromStart(payload?: string) {
  if (!payload?.startsWith('tr_')) return undefined;
  return { utmCampaign: payload.slice(3) };
}

type SendCtx = { tenantId: string; botId: string; telegramId: string };

async function logBotOutbound(
  ctx: SendCtx,
  text: string,
  attachments?: TgAttachment[],
) {
  try {
    const conversation = await ensureConversation(ctx.tenantId, ctx.botId, ctx.telegramId);
    const atts = attachments?.filter((a) => a?.fileId) || [];
    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: text || (atts[0] ? attachmentPlaceholder(atts[0]) : ''),
        attachments: atts.length ? atts : undefined,
      },
    });
  } catch (err) {
    console.error('[gift-bot] logBotOutbound failed:', err);
  }
}

/** Prefer file_id from Telegram send* result; fall back to the media we sent. */
function attachmentFromSendResult(
  type: TgAttachment['type'],
  media: string,
  result: any,
): TgAttachment {
  if (type === 'photo' && Array.isArray(result?.photo) && result.photo.length > 0) {
    const best = result.photo[result.photo.length - 1];
    return {
      type: 'photo',
      fileId: best.file_id || media,
      fileUniqueId: best.file_unique_id,
      fileSize: best.file_size,
    };
  }
  if (type === 'video' && result?.video?.file_id) {
    return {
      type: 'video',
      fileId: result.video.file_id,
      fileUniqueId: result.video.file_unique_id,
      mimeType: result.video.mime_type,
      fileName: result.video.file_name,
      fileSize: result.video.file_size,
    };
  }
  if (type === 'document' && result?.document?.file_id) {
    return {
      type: 'document',
      fileId: result.document.file_id,
      fileUniqueId: result.document.file_unique_id,
      mimeType: result.document.mime_type,
      fileName: result.document.file_name,
      fileSize: result.document.file_size,
    };
  }
  if (type === 'voice' && result?.voice?.file_id) {
    return {
      type: 'voice',
      fileId: result.voice.file_id,
      fileUniqueId: result.voice.file_unique_id,
      mimeType: result.voice.mime_type,
      fileSize: result.voice.file_size,
    };
  }
  if (type === 'audio' && result?.audio?.file_id) {
    return {
      type: 'audio',
      fileId: result.audio.file_id,
      fileUniqueId: result.audio.file_unique_id,
      mimeType: result.audio.mime_type,
      fileName: result.audio.file_name,
      fileSize: result.audio.file_size,
    };
  }
  if (type === 'video_note' && result?.video_note?.file_id) {
    return {
      type: 'video_note',
      fileId: result.video_note.file_id,
      fileUniqueId: result.video_note.file_unique_id,
      fileSize: result.video_note.file_size,
    };
  }
  return { type, fileId: media };
}

async function sendBotMessage(
  botApi: string,
  chatId: number,
  text: string,
  replyMarkup?: any,
  ctx?: SendCtx,
) {
  const res = await fetch(`${botApi}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: clientMdToMarkdownV2(text),
      parse_mode: 'MarkdownV2',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const json = (await res.json()) as any;
  if (!json.ok) {
    console.error('[gift-bot] sendMessage failed:', json.description);
    // Fallback without parse_mode so the user still gets something
    const plain = await fetch(`${botApi}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    const plainJson = (await plain.json()) as any;
    if (!plainJson.ok) throw new Error(plainJson.description || 'sendMessage failed');
  }
  if (ctx) await logBotOutbound(ctx, text);
}

async function sendBotStoredMedia(
  botApi: string,
  chatId: number,
  media: string,
  caption: string,
  kind: GiftPromoMediaType,
  replyMarkup?: any,
  ctx?: SendCtx,
) {
  if (kind === 'video') {
    await sendBotVideo(botApi, chatId, media, caption, replyMarkup, ctx);
    return;
  }
  if (kind === 'photo') {
    await sendBotPhoto(botApi, chatId, media, caption, replyMarkup, ctx);
    return;
  }
  if (kind === 'voice') {
    await sendBotVoice(botApi, chatId, media, caption, replyMarkup, ctx);
    return;
  }
  if (kind === 'audio') {
    await sendBotAudio(botApi, chatId, media, caption, replyMarkup, ctx);
    return;
  }
  if (kind === 'video_note') {
    await sendBotVideoNote(botApi, chatId, media, replyMarkup, ctx);
    if (caption?.trim()) {
      await sendBotMessage(botApi, chatId, caption, undefined, ctx);
    } else if (replyMarkup) {
      // keyboard already on video_note
    }
    return;
  }
  await sendBotDocument(botApi, chatId, media, caption, ctx);
  if (replyMarkup) await sendBotMessage(botApi, chatId, '👇', replyMarkup, ctx);
}

async function sendBotDocument(
  botApi: string,
  chatId: number,
  media: string,
  caption: string,
  ctx?: SendCtx,
) {
  const res = await fetch(`${botApi}/sendDocument`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      document: media,
      caption: clientMdToMarkdownV2(caption),
      parse_mode: 'MarkdownV2',
    }),
  });
  const json = (await res.json()) as any;
  if (!json.ok) throw new Error(json.description || 'sendDocument failed');
  if (ctx) {
    const att = attachmentFromSendResult('document', media, json.result);
    await logBotOutbound(ctx, caption || '[документ]', [att]);
  }
}

async function sendBotVoice(
  botApi: string,
  chatId: number,
  media: string,
  caption: string,
  replyMarkup?: any,
  ctx?: SendCtx,
) {
  const res = await fetch(`${botApi}/sendVoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      voice: media,
      ...(caption
        ? { caption: clientMdToMarkdownV2(caption), parse_mode: 'MarkdownV2' }
        : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const json = (await res.json()) as any;
  if (!json.ok) throw new Error(json.description || 'sendVoice failed');
  if (ctx) {
    const att = attachmentFromSendResult('voice', media, json.result);
    await logBotOutbound(ctx, caption || '[голосовое]', [att]);
  }
}

async function sendBotAudio(
  botApi: string,
  chatId: number,
  media: string,
  caption: string,
  replyMarkup?: any,
  ctx?: SendCtx,
) {
  const res = await fetch(`${botApi}/sendAudio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      audio: media,
      ...(caption
        ? { caption: clientMdToMarkdownV2(caption), parse_mode: 'MarkdownV2' }
        : {}),
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const json = (await res.json()) as any;
  if (!json.ok) throw new Error(json.description || 'sendAudio failed');
  if (ctx) {
    const att = attachmentFromSendResult('audio', media, json.result);
    await logBotOutbound(ctx, caption || '[аудио]', [att]);
  }
}

async function sendBotVideoNote(
  botApi: string,
  chatId: number,
  media: string,
  replyMarkup?: any,
  ctx?: SendCtx,
) {
  const res = await fetch(`${botApi}/sendVideoNote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      video_note: media,
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const json = (await res.json()) as any;
  if (!json.ok) throw new Error(json.description || 'sendVideoNote failed');
  if (ctx) {
    const att = attachmentFromSendResult('video_note', media, json.result);
    await logBotOutbound(ctx, '[кружочек]', [att]);
  }
}

async function sendBotVideo(
  botApi: string,
  chatId: number,
  media: string,
  caption: string,
  replyMarkup?: any,
  ctx?: SendCtx,
) {
  // Quality-staged originals are document file_ids — download → sendVideo once.
  if (isTelegramDocumentFileId(media)) {
    const downloaded = await downloadGiftTelegramFile(botApi, media);
    if (downloaded) {
      const filename = downloaded.filePath.split('/').pop() || 'video.mp4';
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', clientMdToMarkdownV2(caption));
      form.append('parse_mode', 'MarkdownV2');
      if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
      form.append(
        'video',
        new Blob([new Uint8Array(downloaded.buffer)], { type: 'video/mp4' }),
        filename,
      );
      const res = await fetch(`${botApi}/sendVideo`, { method: 'POST', body: form });
      const json = (await res.json()) as any;
      if (json.ok) {
        if (ctx) {
          const att = attachmentFromSendResult('video', media, json.result);
          await logBotOutbound(ctx, caption || '[видео]', [att]);
        }
        return;
      }
    }
    // getFile ≤20MB / sendVideo failed — keep original as document
    await sendBotDocument(botApi, chatId, media, caption, ctx);
    if (replyMarkup) await sendBotMessage(botApi, chatId, '👇', replyMarkup, ctx);
    return;
  }

  const res = await fetch(`${botApi}/sendVideo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      video: media,
      caption: clientMdToMarkdownV2(caption),
      parse_mode: 'MarkdownV2',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const json = (await res.json()) as any;
  if (!json.ok) throw new Error(json.description || 'sendVideo failed');
  if (ctx) {
    const att = attachmentFromSendResult('video', media, json.result);
    await logBotOutbound(ctx, caption || '[видео]', [att]);
  }
}

async function sendBotPhoto(
  botApi: string,
  chatId: number,
  media: string,
  caption: string,
  replyMarkup?: any,
  ctx?: SendCtx,
) {
  // Quality-staged originals are document file_ids — download → sendPhoto once.
  if (isTelegramDocumentFileId(media)) {
    const downloaded = await downloadGiftTelegramFile(botApi, media);
    if (downloaded) {
      const filename = downloaded.filePath.split('/').pop() || 'photo.jpg';
      const lower = filename.toLowerCase();
      const mime = /\.png$/i.test(lower)
        ? 'image/png'
        : /\.webp$/i.test(lower)
          ? 'image/webp'
          : 'image/jpeg';
      const form = new FormData();
      form.append('chat_id', String(chatId));
      form.append('caption', clientMdToMarkdownV2(caption));
      form.append('parse_mode', 'MarkdownV2');
      if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
      form.append(
        'photo',
        new Blob([new Uint8Array(downloaded.buffer)], { type: mime }),
        filename,
      );
      const res = await fetch(`${botApi}/sendPhoto`, { method: 'POST', body: form });
      const json = (await res.json()) as any;
      if (json.ok) {
        if (ctx) {
          const att = attachmentFromSendResult('photo', media, json.result);
          await logBotOutbound(ctx, caption || '[фото]', [att]);
        }
        return;
      }
      // Retry without MarkdownV2
      const formPlain = new FormData();
      formPlain.append('chat_id', String(chatId));
      formPlain.append('caption', caption);
      if (replyMarkup) formPlain.append('reply_markup', JSON.stringify(replyMarkup));
      formPlain.append(
        'photo',
        new Blob([new Uint8Array(downloaded.buffer)], { type: mime }),
        filename,
      );
      const plain = await fetch(`${botApi}/sendPhoto`, { method: 'POST', body: formPlain });
      const plainJson = (await plain.json()) as any;
      if (plainJson.ok) {
        if (ctx) {
          const att = attachmentFromSendResult('photo', media, plainJson.result);
          await logBotOutbound(ctx, caption || '[фото]', [att]);
        }
        return;
      }
    }
    await sendBotDocument(botApi, chatId, media, caption, ctx);
    if (replyMarkup) await sendBotMessage(botApi, chatId, '👇', replyMarkup, ctx);
    return;
  }

  const res = await fetch(`${botApi}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: media,
      caption: clientMdToMarkdownV2(caption),
      parse_mode: 'MarkdownV2',
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  const json = (await res.json()) as any;
  let result = json.result;
  if (!json.ok) {
    // Retry without MarkdownV2 (emoji/caption edge cases)
    const plain = await fetch(`${botApi}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: media,
        caption,
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    const plainJson = (await plain.json()) as any;
    if (!plainJson.ok) throw new Error(plainJson.description || json.description || 'sendPhoto failed');
    result = plainJson.result;
  }
  if (ctx) {
    const att = attachmentFromSendResult('photo', media, result);
    await logBotOutbound(ctx, caption || '[фото]', [att]);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch(console.error);
