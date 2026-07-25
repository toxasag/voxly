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
  clientMdToMarkdownV2,
  formatPromoButtonLabel,
  giftPromoStartPayload,
  resolveTelegramMedia,
  type GiftFunnelConfig,
  type GiftFunnelMessage,
  type GiftPromoPost,
} from '@voxly/shared';

const PORT = 3004;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const USE_POLLING = process.env.GIFT_BOT_USE_POLLING === 'true';

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
    update.message?.document ||
    update.message?.audio ||
    update.message?.voice ||
    update.message?.sticker ||
    update.message?.animation
  ) {
    await storeInboundMessage(tenantId, botId, update);
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
  if (gift.type === 'link') {
    await sendBotMessage(botApi, chatId, `${caption}\n\n${gift.url}`, undefined, ctx);
    return;
  }
  if (!media) {
    await sendBotMessage(botApi, chatId, caption, undefined, ctx);
    return;
  }

  // Telegram file_id prefix is authoritative (mediaType in DB can be wrong after uploads)
  const kind = detectStoredMediaKind(media, gift.mediaType, gift.type);
  if (kind === 'video') {
    await sendBotVideo(botApi, chatId, media, caption, undefined, ctx);
    return;
  }
  if (kind === 'photo') {
    await sendBotPhoto(botApi, chatId, media, caption, undefined, ctx);
    return;
  }
  await sendBotDocument(botApi, chatId, media, caption, ctx);
}

/** Infer send method from Telegram file_id + optional stored hints. */
function detectStoredMediaKind(
  fileId: string,
  mediaType?: 'photo' | 'video',
  giftType?: 'file' | 'link' | 'video',
): 'photo' | 'video' | 'document' {
  if (giftType === 'video' || mediaType === 'video' || fileId.startsWith('BAAC')) return 'video';
  // Document / audio / etc. — must not use sendPhoto
  if (fileId.startsWith('BQAC') || fileId.startsWith('BQAD') || fileId.startsWith('CQAC')) {
    return 'document';
  }
  if (mediaType === 'photo' || fileId.startsWith('AgAC')) return 'photo';
  if (giftType === 'file') return 'document';
  return 'document';
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
  const keyboard = subscribeKeyboard(funnel, campaign);
  if (media) {
    if (funnel.start.mediaType === 'video') {
      await sendBotVideo(botApi, chatId, media, funnel.start.text, keyboard, ctx);
    } else {
      await sendBotPhoto(botApi, chatId, media, funnel.start.text, keyboard, ctx);
    }
  } else {
    await sendBotMessage(botApi, chatId, funnel.start.text, keyboard, ctx);
  }
}

function subscribeKeyboard(funnel: GiftFunnelConfig, campaign: any) {
  const channelUrl = campaign.channelUsername
    ? `https://t.me/${String(campaign.channelUsername).replace(/^@/, '')}`
    : undefined;
  const confirm = funnel.subscribeButton?.confirmLabel || 'Я подписался ✅';
  const rows: any[] = [];
  if (channelUrl) {
    rows.push([{ text: 'Перейти в канал', url: channelUrl }]);
  }
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
      ? subscribeKeyboard(funnel, bot.giftCampaigns[0])
      : undefined;
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
    if (msg.mediaType === 'video') {
      await sendBotVideo(botApi, job.chatId, media, msg.text, keyboard, ctx);
    } else {
      await sendBotPhoto(botApi, job.chatId, media, msg.text, keyboard, ctx);
    }
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
  const bot = await prisma.botInstance.findFirst({
    where: { id: msg.botId, tenantId: broadcast.tenantId },
  });
  if (!bot?.botTokenEncrypted) {
    await prisma.broadcast.update({ where: { id: broadcastId }, data: { status: 'failed' } });
    return;
  }

  const where: any = { campaignId: msg.campaignId };
  if (msg.segment === 'gifted') where.giftDelivered = true;
  if (msg.segment === 'not_gifted') where.giftDelivered = false;

  const subscribers = await prisma.giftSubscriber.findMany({ where });
  const botApi = `https://api.telegram.org/bot${decrypt(bot.botTokenEncrypted)}`;
  let sent = 0;
  for (const s of subscribers) {
    try {
      const ctx: SendCtx = {
        tenantId: broadcast.tenantId,
        botId: bot.id,
        telegramId: s.telegramId,
      };
      if (msg.mediaUrl) {
        await sendBotPhoto(botApi, Number(s.telegramId), msg.mediaUrl, msg.text, undefined, ctx);
      } else {
        await sendBotMessage(botApi, Number(s.telegramId), msg.text, undefined, ctx);
      }
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

async function trackPromoClick(
  botApi: string,
  tenantId: string,
  botId: string,
  campaign: any,
) {
  const promo = (campaign.promoPost || {}) as GiftPromoPost;
  const nextCount = (promo.clickCount || 0) + 1;
  const next: GiftPromoPost = {
    text: promo.text || '',
    mediaType: promo.mediaType === 'video' ? 'video' : 'photo',
    telegramFileId: promo.telegramFileId,
    telegramFileUniqueId: promo.telegramFileUniqueId,
    mediaUrl: promo.mediaUrl || promo.imageUrl,
    buttonText: promo.buttonText || 'Получить подарок',
    clickCount: nextCount,
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

  if (next.telegramMessageId && next.telegramChatId) {
    const bot = await prisma.botInstance.findUnique({
      where: { id: botId },
      select: { botUsername: true },
    });
    if (bot?.botUsername) {
      const buttonUrl = `https://t.me/${bot.botUsername}?start=${giftPromoStartPayload(campaign.id)}`;
      const label = formatPromoButtonLabel(next.buttonText, nextCount);
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
  username: string,
): Promise<void> {
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
  await client.updatePersonTelegram(personId, username);
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
        person.username &&
        !telegramHandleFilled.has(existingSub.twentyPersonId)
      ) {
        telegramHandleFilled.add(existingSub.twentyPersonId);
        void fillExistingPersonTelegram(
          tenantId,
          existingSub.twentyPersonId,
          person.username,
        ).catch(() => {
          telegramHandleFilled.delete(existingSub.twentyPersonId!);
        });
      }
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
        phone: existingSub?.phone || undefined,
      });
      personId = createdPerson?.id;
    } else if (person.username) {
      // Best-effort: fill Telegram field on reused contacts
      try {
        await client.updatePersonTelegram(personId, person.username);
        telegramHandleFilled.add(personId);
      } catch {
        /* ignore */
      }
    }

    let opportunityId = existingSub?.twentyOpportunityId || undefined;
    if (
      opportunityId &&
      !(await client.opportunityExists(opportunityId))
    ) {
      opportunityId = undefined;
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

    if (!opportunityId && personId) {
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

async function storeInboundMessage(tenantId: string, botId: string, update: any) {
  const telegramId = String(update.message.from.id);
  const attachments = extractTelegramAttachments(update.message);
  const text =
    update.message.text ||
    update.message.caption ||
    update.message.contact?.phone_number ||
    (attachments.length ? attachmentPlaceholder(attachments[0]) : '');
  if (!text && attachments.length === 0) return;

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
}

type TgAttachment = {
  type: 'photo' | 'video' | 'document' | 'audio' | 'voice' | 'sticker' | 'animation';
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
  if (a.type === 'video' || a.type === 'animation') return '[видео]';
  if (a.type === 'voice') return '[голосовое]';
  if (a.type === 'audio') return '[аудио]';
  if (a.type === 'sticker') return '[стикер]';
  return a.fileName ? `[файл: ${a.fileName}]` : '[файл]';
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

async function sendBotVideo(
  botApi: string,
  chatId: number,
  media: string,
  caption: string,
  replyMarkup?: any,
  ctx?: SendCtx,
) {
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
