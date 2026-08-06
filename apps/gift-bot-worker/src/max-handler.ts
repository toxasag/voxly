/**
 * MAX gift-bot funnel handler (official Bot API).
 * Reuses GiftCampaignConfig / GiftSubscriber; no sales LLM (ADR-025).
 * Channel membership check: degraded — «Продолжить» delivers gift (CAPABILITIES gap).
 */

import { prisma } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { fireGoal } from '@voxly/analytics-dispatchers';
import { TwentyClient } from '@voxly/twenty-client';
import {
  DEFAULT_GIFT_FUNNEL,
  giftPromoStartPayload,
  type GiftFunnelConfig,
} from '@voxly/shared';
import {
  maxInlineKeyboard,
  maxSendText,
  type MaxMe,
} from './max-api.js';

function getFunnel(campaign: { funnelJson?: unknown }): GiftFunnelConfig {
  const raw = campaign.funnelJson as GiftFunnelConfig | null;
  if (!raw || typeof raw !== 'object') return DEFAULT_GIFT_FUNNEL;
  return {
    ...DEFAULT_GIFT_FUNNEL,
    ...raw,
    gift: { ...DEFAULT_GIFT_FUNNEL.gift, ...(raw.gift || {}) },
  };
}

async function activeCampaign(tenantId: string, botId: string, payload?: string) {
  if (payload?.startsWith('g_')) {
    const campaignId = payload.slice(2);
    const byId = await prisma.giftCampaignConfig.findFirst({
      where: { id: campaignId, botInstanceId: botId, tenantId, isActive: true },
    });
    if (byId) return byId;
  }
  return prisma.giftCampaignConfig.findFirst({
    where: { botInstanceId: botId, tenantId, isActive: true },
    orderBy: { updatedAt: 'desc' },
  });
}

async function ensureMaxConversation(
  tenantId: string,
  botId: string,
  peerId: string,
  username?: string | null,
  firstName?: string | null,
) {
  const existing = await prisma.conversation.findFirst({
    where: { tenantId, botInstanceId: botId, platform: 'max', platformUserId: peerId },
  });
  if (existing) {
    await prisma.giftSubscriber.updateMany({
      where: { tenantId, botInstanceId: botId, telegramId: peerId },
      data: { conversationId: existing.id },
    });
    return existing;
  }
  const conversation = await prisma.conversation.create({
    data: {
      tenantId,
      botInstanceId: botId,
      platform: 'max',
      platformUserId: peerId,
      platformUsername: username || null,
      platformFirstName: firstName || null,
      channel: 'max_gift',
      status: 'open',
      mode: 'bot',
    },
  });
  await prisma.giftSubscriber.updateMany({
    where: { tenantId, botInstanceId: botId, telegramId: peerId },
    data: { conversationId: conversation.id },
  });
  return conversation;
}

async function logOutbound(
  tenantId: string,
  botId: string,
  peerId: string,
  text: string,
) {
  try {
    const conversation = await ensureMaxConversation(tenantId, botId, peerId);
    await prisma.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'assistant',
        content: text,
      },
    });
  } catch (err) {
    console.error('[gift-max] logOutbound failed:', err);
  }
}

async function sendMax(
  token: string,
  peerId: string,
  text: string,
  ctx: { tenantId: string; botId: string },
  attachments?: unknown[],
) {
  const result = await maxSendText({
    token,
    userId: peerId,
    text,
    attachments,
  });
  if (!result.ok) {
    throw new Error(result.error || 'MAX send failed');
  }
  await logOutbound(ctx.tenantId, ctx.botId, peerId, text);
  return result;
}

async function syncCrm(opts: {
  tenantId: string;
  botId: string;
  campaign: { id: string; name?: string | null };
  peerId: string;
  username?: string | null;
  firstName?: string | null;
  botUsername?: string | null;
}): Promise<{ personId?: string; opportunityId?: string }> {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId } });
    const owner = await prisma.tenantMember.findFirst({
      where: { tenantId: opts.tenantId, role: 'owner' },
      include: { user: true },
    });
    if (
      !tenant?.twentyWorkspaceId ||
      !tenant.twentyOwnerPasswordEncrypted ||
      !owner?.user?.email
    ) {
      return {};
    }
    const { decrypt: dec } = await import('@voxly/crypto');
    const client = new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    });
    await client.authenticateWorkspace(
      owner.user.email,
      dec(tenant.twentyOwnerPasswordEncrypted),
      tenant.twentyWorkspaceId,
    );

    const existingSub = await prisma.giftSubscriber.findFirst({
      where: {
        tenantId: opts.tenantId,
        botInstanceId: opts.botId,
        telegramId: opts.peerId,
      },
      orderBy: { updatedAt: 'desc' },
    });

    let personId = existingSub?.twentyPersonId || undefined;
    if (personId && !(await client.personExists(personId))) personId = undefined;

    if (!personId) {
      const who =
        opts.firstName ||
        (opts.username ? `@${opts.username.replace(/^@/, '')}` : null) ||
        `MAX ${opts.peerId}`;
      const created = await client.createPerson({
        firstName: who,
        lastName: opts.username
          ? `@${opts.username.replace(/^@/, '')}`
          : opts.peerId,
      });
      personId = created?.id;
    }

    let opportunityId = existingSub?.twentyOpportunityId || undefined;
    if (opportunityId && !(await client.opportunityExists(opportunityId))) {
      opportunityId = undefined;
    }
    if (!opportunityId && personId) {
      const fromSub = await prisma.giftSubscriber.findFirst({
        where: {
          tenantId: opts.tenantId,
          twentyPersonId: personId,
          twentyOpportunityId: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (
        fromSub?.twentyOpportunityId &&
        (await client.opportunityExists(fromSub.twentyOpportunityId))
      ) {
        opportunityId = fromSub.twentyOpportunityId;
      }
    }
    if (!opportunityId && personId) {
      const who =
        opts.username
          ? `@${opts.username.replace(/^@/, '')}`
          : opts.firstName || opts.peerId;
      const project = opts.campaign.name?.trim() || 'Проект';
      const bot = opts.botUsername ? `@${opts.botUsername.replace(/^@/, '')}` : 'MAX-бот';
      const opp = await client.createOpportunity({
        name: `${who} · ${project} · ${bot} · MAX`,
        personId,
        stage: 'NEW',
      });
      opportunityId = opp?.id;
      await fireGoal({
        tenantId: opts.tenantId,
        goalName: 'lead_created',
        subscriberId: opts.peerId,
        botInstanceId: opts.botId,
        campaignId: opts.campaign.id,
      });
    }
    return { personId, opportunityId };
  } catch (err) {
    console.error('[gift-max] CRM sync error:', err);
    return {};
  }
}

async function deliverGiftMax(
  token: string,
  peerId: string,
  funnel: GiftFunnelConfig,
  ctx: { tenantId: string; botId: string },
) {
  const { gift } = funnel;
  const caption = gift.caption || 'Вот твой подарок 🎁';
  if (gift.type === 'link' || gift.url) {
    await sendMax(token, peerId, `${caption}\n\n${gift.url || ''}`.trim(), ctx);
    return;
  }
  await sendMax(token, peerId, caption, ctx);
}

function continueKeyboard(campaignId: string) {
  return [
    maxInlineKeyboard([
      [
        {
          type: 'callback',
          text: 'Продолжить / я подписался',
          payload: `check_sub:${campaignId}`,
        },
      ],
    ]),
  ];
}

async function handleBotStarted(
  update: any,
  token: string,
  tenantId: string,
  botId: string,
  botUsername?: string | null,
) {
  const user = update.user || update.payload?.user || {};
  const peerId = String(user.user_id || user.id || update.user_id || '');
  if (!peerId) {
    console.warn('[gift-max] bot_started without user id');
    return;
  }
  const username = user.username as string | undefined;
  const firstName = (user.first_name || user.name) as string | undefined;
  const payload = String(update.payload || update.start_payload || update.payload?.payload || '');

  await fireGoal({
    tenantId,
    goalName: 'bot_start',
    subscriberId: peerId,
    botInstanceId: botId,
    campaignId: undefined,
  });

  const campaign = await activeCampaign(tenantId, botId, payload || undefined);
  if (!campaign) {
    await sendMax(
      token,
      peerId,
      'Привет! Сейчас нет активного проекта. Включите проект в кабинете Voxly.',
      { tenantId, botId },
    );
    return;
  }

  if (payload && payload === giftPromoStartPayload(campaign.id)) {
    // best-effort promo click counter
    try {
      const promo = (campaign.promoPost as Record<string, unknown>) || {};
      await prisma.giftCampaignConfig.update({
        where: { id: campaign.id },
        data: {
          promoPost: {
            ...promo,
            clickCount: Number(promo.clickCount || 0) + 1,
          },
        },
      });
    } catch {
      /* ignore */
    }
  }

  const funnel = getFunnel(campaign);
  const crm = await syncCrm({
    tenantId,
    botId,
    campaign,
    peerId,
    username,
    firstName,
    botUsername,
  });

  await prisma.giftSubscriber.upsert({
    where: { campaignId_telegramId: { campaignId: campaign.id, telegramId: peerId } },
    create: {
      tenantId,
      campaignId: campaign.id,
      botInstanceId: botId,
      telegramId: peerId,
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

  const conversation = await ensureMaxConversation(
    tenantId,
    botId,
    peerId,
    username,
    firstName,
  );
  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: payload ? `/start ${payload}` : '/start',
    },
  });

  const welcome =
    funnel.start?.text ||
    'Привет! Чтобы получить подарок, подпишись на канал (если указан в кабинете) и нажми кнопку ниже.';

  // GAP: no reliable MAX channel membership check like TG getChatMember — soft continue.
  await sendMax(token, peerId, welcome, { tenantId, botId }, continueKeyboard(campaign.id));
}

async function handleMessageCreated(
  update: any,
  token: string,
  tenantId: string,
  botId: string,
) {
  const message = update.message || update;
  const sender = message.sender || message.from || update.user || {};
  const peerId = String(
    sender.user_id || sender.id || message.recipient?.user_id || update.chat_id || '',
  );
  if (!peerId) return;
  // Skip bot echoes
  if (sender.is_bot) return;

  const text =
    message.body?.text ||
    message.text ||
    (typeof message.body === 'string' ? message.body : '') ||
    '';
  const username = sender.username as string | undefined;
  const firstName = (sender.first_name || sender.name) as string | undefined;

  const conversation = await ensureMaxConversation(
    tenantId,
    botId,
    peerId,
    username,
    firstName,
  );
  await prisma.chatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'user',
      content: String(text || '[сообщение]').slice(0, 8000),
      externalMessageId: message.body?.mid || message.id
        ? `max:${message.body?.mid || message.id}`
        : undefined,
    },
  });
  await prisma.giftSubscriber.updateMany({
    where: { tenantId, botInstanceId: botId, telegramId: peerId },
    data: { lastMessageAt: new Date() },
  });

  // /start text fallback
  if (String(text).startsWith('/start')) {
    await handleBotStarted(
      {
        user: sender,
        payload: String(text).split(/\s+/)[1] || '',
      },
      token,
      tenantId,
      botId,
    );
  }
}

async function handleCallback(
  update: any,
  token: string,
  tenantId: string,
  botId: string,
) {
  const cb = update.callback || update;
  const payload = String(cb.payload || cb.callback_id || update.payload || '');
  const user = cb.user || update.user || {};
  const peerId = String(user.user_id || user.id || '');
  if (!peerId) return;

  let campaignId: string | null = null;
  if (payload.startsWith('check_sub:')) {
    campaignId = payload.slice('check_sub:'.length);
  } else if (payload === 'check_subscription') {
    const sub = await prisma.giftSubscriber.findFirst({
      where: { tenantId, botInstanceId: botId, telegramId: peerId },
      orderBy: { updatedAt: 'desc' },
    });
    campaignId = sub?.campaignId || null;
  }
  if (!campaignId) return;

  const campaign = await prisma.giftCampaignConfig.findFirst({
    where: { id: campaignId, botInstanceId: botId, tenantId },
  });
  if (!campaign) return;

  const funnel = getFunnel(campaign);

  await fireGoal({
    tenantId,
    goalName: 'subscription_requested',
    subscriberId: peerId,
    botInstanceId: botId,
    campaignId: campaign.id,
  });

  // Soft verify: MAX Bot API channel membership not parity with TG — deliver gift.
  await fireGoal({
    tenantId,
    goalName: 'subscription_verified',
    subscriberId: peerId,
    botInstanceId: botId,
    campaignId: campaign.id,
  });

  try {
    await deliverGiftMax(token, peerId, funnel, { tenantId, botId });
  } catch (err) {
    console.error('[gift-max] deliverGift failed:', err);
    await sendMax(
      token,
      peerId,
      'Не удалось отправить подарок. Нажми кнопку ещё раз или напиши в поддержку.',
      { tenantId, botId },
      continueKeyboard(campaign.id),
    );
    return;
  }

  await prisma.giftSubscriber.updateMany({
    where: { campaignId: campaign.id, telegramId: peerId },
    data: {
      subscribed: true,
      funnelPhase: 'gifted',
      giftDelivered: true,
      lastMessageAt: new Date(),
    },
  });

  await fireGoal({
    tenantId,
    goalName: 'gift_delivered',
    subscriberId: peerId,
    botInstanceId: botId,
    campaignId: campaign.id,
  });
}

export async function handleMaxUpdate(
  update: any,
  tenantId: string,
  botId: string,
): Promise<void> {
  const bot = await prisma.botInstance.findFirst({
    where: { id: botId, tenantId, status: 'active', botType: 'gift_max' },
  });
  if (!bot?.botTokenEncrypted) {
    console.warn(`[gift-max] Bot not found or inactive: ${botId}`);
    return;
  }
  const token = decrypt(bot.botTokenEncrypted);
  const type = String(update.update_type || update.type || '');

  if (type === 'bot_started') {
    await handleBotStarted(update, token, tenantId, botId, bot.botUsername);
    return;
  }
  if (type === 'message_created') {
    await handleMessageCreated(update, token, tenantId, botId);
    return;
  }
  if (type === 'message_callback') {
    await handleCallback(update, token, tenantId, botId);
    return;
  }
  // Some payloads nest update
  if (update.update && typeof update.update === 'object') {
    await handleMaxUpdate(update.update, tenantId, botId);
  }
}

export type { MaxMe };
