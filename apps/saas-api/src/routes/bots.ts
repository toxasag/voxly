// Bot routes: Managed Bots provision, gift campaign, channel verify, broadcasts

import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { decrypt } from '@voxly/crypto';
import { TwentyClient } from '@voxly/twenty-client';
import {
  DEFAULT_GIFT_FUNNEL,
  DEFAULT_GIFT_PROMO,
  clientMdToMarkdownV2,
  formatPromoButtonLabel,
  giftPromoStartPayload,
  buildVoxlyBotUsername,
  resolveTelegramMedia,
  PRICING,
  PRODUCT_CODES,
  TRIAL_PERIOD_DAYS,
  type GiftFunnelConfig,
  type GiftPromoPost,
} from '@voxly/shared';

function canManageTenant(user: { role?: string; tenantRole?: string }): boolean {
  return user.role === 'superadmin' || user.tenantRole === 'owner' || user.role === 'owner';
}

const provisionSchema = z.object({
  botType: z.enum(['gift', 'ai_tg', 'ai_wa']).default('gift'),
  suggestedUsername: z.string().min(5).max(32).optional(),
  suggestedName: z.string().min(1).max(64).optional(),
});

const optionalHttpsUrl = z.string().url().optional().or(z.literal(''));
const optionalFileId = z.string().min(1).max(256).optional().or(z.literal(''));

const funnelMessageSchema = z.object({
  delayMinutes: z.number().min(0).max(60 * 24 * 30),
  text: z.string().min(1).max(4000),
  imageUrl: optionalHttpsUrl,
  telegramFileId: optionalFileId,
  mediaType: z.enum(['photo', 'video']).optional(),
});

const campaignSchema = z.object({
  /** Existing project id; omit to update the latest campaign (legacy) or create when none */
  campaignId: z.string().cuid().optional(),
  name: z.string().min(1).max(120).optional(),
  channelUsername: z.string().min(1).max(100),
  channelId: z.string().optional(),
  giftFileUrl: optionalHttpsUrl,
  funnel: z.object({
    start: z.object({
      text: z.string().min(1).max(4000),
      imageUrl: optionalHttpsUrl,
      telegramFileId: optionalFileId,
      mediaType: z.enum(['photo', 'video']).optional(),
    }),
    notSubscribed: z.array(funnelMessageSchema).max(10),
    gift: z
      .object({
        type: z.enum(['file', 'link', 'video']),
        url: z.string().max(2000).optional().or(z.literal('')),
        telegramFileId: optionalFileId,
        mediaType: z.enum(['photo', 'video']).optional(),
        caption: z.string().max(1000).optional(),
      })
      .superRefine((gift, ctx) => {
        const hasUrl = Boolean(gift.url && gift.url.length > 0);
        const hasFile = Boolean(gift.telegramFileId && gift.telegramFileId.length > 0);
        if (gift.type === 'link') {
          if (!hasUrl) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Укажите ссылку на подарок', path: ['url'] });
          } else if (!/^https?:\/\//i.test(gift.url!)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ссылка должна быть http(s)', path: ['url'] });
          }
        } else if (!hasUrl && !hasFile) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Загрузите файл или укажите URL',
            path: ['telegramFileId'],
          });
        }
      }),
    afterGift: z.array(funnelMessageSchema).max(10),
    notGifted: z.array(funnelMessageSchema).max(10),
    subscribeButton: z
      .object({ confirmLabel: z.string().min(1).max(64).optional() })
      .optional(),
  }),
});

const broadcastSchema = z.object({
  segment: z.enum(['gifted', 'not_gifted', 'all']),
  text: z.string().min(1).max(4000),
  mediaUrl: optionalHttpsUrl,
  telegramFileId: optionalFileId,
  mediaType: z.enum(['photo', 'video']).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const promoSchema = z.object({
  campaignId: z.string().cuid().optional(),
  text: z.string().min(1).max(4000),
  mediaType: z.enum(['photo', 'video']).optional(),
  telegramFileId: optionalFileId,
  telegramFileUniqueId: z.string().min(1).max(256).optional().or(z.literal('')),
  mediaUrl: optionalHttpsUrl,
  /** @deprecated alias for mediaUrl */
  imageUrl: optionalHttpsUrl,
  buttonText: z.string().min(1).max(64),
});

const createCampaignSchema = z.object({
  name: z.string().min(1).max(120).default('Новый проект'),
  /** Copy channel/funnel from this campaign when set */
  cloneFromId: z.string().cuid().optional(),
});

const patchCampaignSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
});

function readPromoPost(raw: unknown): GiftPromoPost {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<GiftPromoPost>;
  const mediaUrl = p.mediaUrl || p.imageUrl || undefined;
  return {
    text: p.text || DEFAULT_GIFT_PROMO.text,
    mediaType: p.mediaType === 'video' ? 'video' : 'photo',
    telegramFileId: p.telegramFileId || undefined,
    telegramFileUniqueId: p.telegramFileUniqueId || undefined,
    mediaUrl,
    buttonText: p.buttonText || DEFAULT_GIFT_PROMO.buttonText,
    clickCount: typeof p.clickCount === 'number' ? p.clickCount : 0,
    telegramMessageId: p.telegramMessageId,
    telegramChatId: p.telegramChatId,
    publishedAt: p.publishedAt,
  };
}

function serializeCampaign(c: {
  id: string;
  name: string;
  channelId: string;
  channelUsername: string | null;
  giftFileUrl: string | null;
  funnelJson: unknown;
  promoPost: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    name: c.name || 'Проект',
    channelId: c.channelId,
    channelUsername: c.channelUsername,
    giftFileUrl: c.giftFileUrl,
    funnelJson: c.funnelJson,
    promoPost: readPromoPost(c.promoPost),
    isActive: c.isActive,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Pick campaign by id, else first active, else newest */
function pickCampaign<T extends { id: string; isActive: boolean; updatedAt: Date }>(
  campaigns: T[],
  campaignId?: string,
): T | undefined {
  if (campaignId) {
    return campaigns.find((c) => c.id === campaignId);
  }
  return (
    campaigns.find((c) => c.isActive) ||
    [...campaigns].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0]
  );
}

/** At most one active project per bot (keeps newest if duplicates slipped in). */
async function enforceSingleActiveCampaign(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any,
  botId: string,
  tenantId: string,
  keepId?: string,
) {
  const active = (await prisma.giftCampaignConfig.findMany({
    where: { botInstanceId: botId, tenantId, isActive: true },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  })) as { id: string }[];
  if (active.length === 0) return;
  const winner = keepId && active.some((a) => a.id === keepId) ? keepId : active[0].id;
  if (active.length === 1 && active[0].id === winner) return;
  await prisma.giftCampaignConfig.updateMany({
    where: { botInstanceId: botId, tenantId, isActive: true, NOT: { id: winner } },
    data: { isActive: false },
  });
}

function cleanOptional(value?: string | null): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

type UploadedMediaKind = 'photo' | 'video' | 'document';

async function uploadMediaToTelegram(opts: {
  botApi: string;
  chatId: string | number;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  kind: UploadedMediaKind;
}): Promise<{
  fileId: string;
  fileUniqueId?: string;
  mediaType?: 'photo' | 'video';
  kind: UploadedMediaKind;
}> {
  const form = new FormData();
  form.append('chat_id', String(opts.chatId));
  form.append('disable_notification', 'true');
  const blob = new Blob([new Uint8Array(opts.buffer)], {
    type: opts.mimeType || 'application/octet-stream',
  });
  const field = opts.kind === 'photo' ? 'photo' : opts.kind === 'video' ? 'video' : 'document';
  const method = opts.kind === 'photo' ? 'sendPhoto' : opts.kind === 'video' ? 'sendVideo' : 'sendDocument';
  form.append(field, blob, opts.filename);

  const tgRes = await fetch(`${opts.botApi}/${method}`, { method: 'POST', body: form });
  const tgJson = (await tgRes.json()) as any;
  if (!tgJson.ok) {
    throw new Error(tgJson.description || 'Telegram upload failed');
  }

  const message = tgJson.result;
  let fileId: string | undefined;
  let fileUniqueId: string | undefined;
  if (opts.kind === 'photo' && Array.isArray(message.photo) && message.photo.length > 0) {
    const best = message.photo[message.photo.length - 1];
    fileId = best.file_id;
    fileUniqueId = best.file_unique_id;
  } else if (opts.kind === 'video' && message.video) {
    fileId = message.video.file_id;
    fileUniqueId = message.video.file_unique_id;
  } else if (message.document) {
    fileId = message.document.file_id;
    fileUniqueId = message.document.file_unique_id;
  }

  if (!fileId) {
    throw new Error('Telegram не вернул file_id');
  }

  // Remove staging message so channel/DM is not spammed
  if (message.message_id != null) {
    await fetch(`${opts.botApi}/deleteMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: opts.chatId, message_id: message.message_id }),
    }).catch(() => undefined);
  }

  return {
    fileId,
    fileUniqueId,
    mediaType: opts.kind === 'video' ? 'video' : opts.kind === 'photo' ? 'photo' : undefined,
    kind: opts.kind,
  };
}

function detectUploadKind(mimeType: string, filename: string): UploadedMediaKind {
  const lower = `${mimeType} ${filename}`.toLowerCase();
  if (mimeType.startsWith('image/') || /\.(jpe?g|png|gif|webp)$/i.test(filename)) return 'photo';
  if (mimeType.startsWith('video/') || /\.(mp4|mov|webm|mkv)$/i.test(filename)) return 'video';
  if (/\.(mp4|mov|webm)$/i.test(lower)) return 'video';
  return 'document';
}

function normalizeChannelUsername(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\/(t\.me|telegram\.me)\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0];
}

function ensureBotUsername(raw: string): string {
  let u = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
  if (!u.endsWith('bot')) u = `${u}bot`;
  if (u.length < 5) u = `voxly${u}bot`;
  if (u.length > 32) u = `${u.slice(0, 29)}bot`;
  return u;
}

export const botRoutes: FastifyPluginAsync = async (fastify) => {
  await fastify.register(multipart, {
    limits: { fileSize: 48 * 1024 * 1024, files: 1 },
  });

  // --- Start 14-day gift bot trial ---
  fastify.post('/gift/start-trial', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can start gift bot trial' });
    }

    const prisma = fastify.prisma;
    const now = new Date();
    const activeUntil = new Date(now);
    activeUntil.setDate(activeUntil.getDate() + TRIAL_PERIOD_DAYS);

    const addon = await prisma.addon.upsert({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT } },
      create: {
        tenantId,
        type: PRODUCT_CODES.GIFT_BOT,
        config: { trial: true },
        activeUntil,
        status: 'active',
      },
      update: {
        status: 'active',
        activeUntil,
        config: { trial: true },
      },
    });

    return reply.send({
      addon: {
        id: addon.id,
        type: addon.type,
        status: addon.status,
        activeUntil: addon.activeUntil,
        isTrial: true,
      },
    });
  });

  // --- Generate Managed Bots provisioning link ---
  fastify.post('/provision-link', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parsed = provisionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { botType, suggestedUsername, suggestedName } = parsed.data;
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;

    if (botType === 'gift') {
      const addon = await prisma.addon.findUnique({
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT } },
      });
      if (!addon || addon.status !== 'active' || addon.activeUntil < new Date()) {
        return reply.code(402).send({ error: 'Сначала активируйте пробный период или оплатите gift-бота' });
      }
    }

    const managerUsername = process.env.TELEGRAM_MANAGER_BOT_USERNAME || 'VoxlyGiftbot';
    const nonce = nanoid(32);

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true },
    });
    const existingBots = await prisma.botInstance.count({
      where: { tenantId, botType },
    });
    const pendingProvisions = await prisma.botProvisionRequest.count({
      where: {
        tenantId,
        botType,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
    });
    let sequence = existingBots + pendingProvisions + 1;

    // Telegram: 5–32 chars, latin/digits/_, must end with "bot"
    let username: string;
    if (suggestedUsername) {
      username = ensureBotUsername(suggestedUsername);
    } else {
      // Prefer free name: voxly_{tenantSlug}_{01}_bot
      const nick = tenant?.slug || 'client';
      username = buildVoxlyBotUsername(nick, sequence);
      // Bump sequence if username already taken on this tenant or globally
      for (let i = 0; i < 20; i += 1) {
        const taken = await prisma.botInstance.findFirst({
          where: { botUsername: username },
          select: { id: true },
        });
        const pendingTaken = await prisma.botProvisionRequest.findFirst({
          where: {
            suggestedUsername: username,
            status: 'pending',
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!taken && !pendingTaken) break;
        sequence += 1;
        username = buildVoxlyBotUsername(nick, sequence);
      }
    }

    const provisionReq = await prisma.botProvisionRequest.create({
      data: {
        tenantId,
        nonce,
        suggestedUsername: username,
        suggestedName: suggestedName || 'Voxly Gift Bot',
        botType,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const params = new URLSearchParams();
    params.set('name', suggestedName || provisionReq.suggestedName || 'Voxly Gift Bot');

    // Prefer opening inside Telegram app; https://t.me works when Telegram handles the link
    const deepLink = `https://t.me/newbot/${managerUsername}/${username}?${params}`;
    // Without suggested username — Telegram asks user to pick one (more reliable on some clients)
    const deepLinkSimple = `https://t.me/newbot/${managerUsername}?${params}`;
    const linkManager = `https://t.me/${managerUsername}?start=voxly_${nonce}`;

    const owner = await prisma.user.findFirst({
      where: {
        tenantMembers: { some: { tenantId, role: 'owner' } },
      },
      select: { telegramUserId: true },
    });

    return reply.send({
      provisionRequestId: provisionReq.id,
      nonce,
      deepLink,
      deepLinkSimple,
      linkManager,
      managerBot: `@${managerUsername}`,
      suggestedUsername: username,
      telegramLinked: Boolean(owner?.telegramUserId),
      expiresAt: provisionReq.expiresAt,
      steps: owner?.telegramUserId
        ? [
            `Telegram уже привязан. Откройте ссылку создания бота прямо в приложении Telegram (не в Safari/Chrome).`,
            `Подтвердите создание — username @${username} можно изменить.`,
          ]
        : [
            `1. Откройте ${linkManager} и нажмите Start — привязка Telegram`,
            `2. Затем откройте ссылку создания бота внутри Telegram и подтвердите`,
          ],
    });
  });

  // --- List bot instances for tenant ---
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId, sub: userId } = (request as any).user;
    const prisma = fastify.prisma;

    const [bots, addon, user, subCounts] = await Promise.all([
      prisma.botInstance.findMany({
        where: { tenantId },
        include: { giftCampaigns: { orderBy: { updatedAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.addon.findUnique({
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT } },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { telegramUserId: true },
      }),
      prisma.giftSubscriber.groupBy({
        by: ['botInstanceId'],
        where: { tenantId },
        _count: { _all: true },
      }),
    ]);

    const subscribersByBot = new Map(
      subCounts.map((row) => [row.botInstanceId, row._count._all]),
    );

    return reply.send({
      telegramLinked: Boolean(user?.telegramUserId),
      managerBot: `@${process.env.TELEGRAM_MANAGER_BOT_USERNAME || 'VoxlyGiftbot'}`,
      giftBotPriceMonthly: PRICING.GIFT_BOT_MONTHLY,
      giftAddon: addon
        ? {
            id: addon.id,
            status: addon.status,
            activeUntil: addon.activeUntil,
            isTrial: Boolean((addon.config as any)?.trial),
            isActive: addon.status === 'active' && addon.activeUntil > new Date(),
          }
        : null,
      bots: await Promise.all(
        bots.map(async (b) => {
        const activeCount = b.giftCampaigns.filter((c) => c.isActive).length;
        if (activeCount > 1) {
          await enforceSingleActiveCampaign(prisma, b.id, tenantId);
          b.giftCampaigns = await prisma.giftCampaignConfig.findMany({
            where: { botInstanceId: b.id },
            orderBy: { updatedAt: 'desc' },
          });
        }
        const campaigns = [...b.giftCampaigns].sort(
          (a, c) => c.updatedAt.getTime() - a.updatedAt.getTime(),
        );
        const campaign = pickCampaign(campaigns);
        return {
          id: b.id,
          botUsername: b.botUsername,
          botType: b.botType,
          provisionedVia: b.provisionedVia,
          status: b.status,
          createdAt: b.createdAt,
          hasGiftCampaign: campaigns.length > 0,
          subscriberCount: subscribersByBot.get(b.id) ?? 0,
          campaigns: campaigns.map(serializeCampaign),
          /** Active/newest project (compat for older UI) */
          campaign: campaign ? serializeCampaign(campaign) : null,
          botLink: b.botUsername ? `https://t.me/${b.botUsername}` : null,
        };
        }),
      ),
      defaultFunnel: DEFAULT_GIFT_FUNNEL,
    });
  });

  // --- Save / update gift campaign ---
  fastify.put('/:botId/campaign', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const { botId } = request.params as { botId: string };
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can edit campaigns' });
    }

    const parsed = campaignSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: 'gift' },
      include: { giftCampaigns: { orderBy: { updatedAt: 'desc' } } },
    });
    if (!bot) return reply.code(404).send({ error: 'Bot not found' });

    const channelUsername = normalizeChannelUsername(parsed.data.channelUsername);
    const funnel = sanitizeFunnel(parsed.data.funnel);
    const giftFileUrl = parsed.data.giftFileUrl || funnel.gift.url;
    const channelId = parsed.data.channelId || `@${channelUsername}`;
    const name = parsed.data.name?.trim();

    const existing = pickCampaign(bot.giftCampaigns, parsed.data.campaignId);
    if (parsed.data.campaignId && !existing) {
      return reply.code(404).send({ error: 'Проект не найден' });
    }

    const campaign = existing
      ? await prisma.giftCampaignConfig.update({
          where: { id: existing.id },
          data: {
            ...(name ? { name } : {}),
            channelId,
            channelUsername,
            giftFileUrl,
            funnelJson: funnel as object,
          },
        })
      : await prisma.giftCampaignConfig.create({
          data: {
            tenantId,
            botInstanceId: botId,
            name: name || 'Проект',
            channelId,
            channelUsername,
            giftFileUrl,
            funnelJson: funnel as object,
            isActive: true,
          },
        });

    return reply.send({ campaign: serializeCampaign(campaign) });
  });

  // --- Create another project/campaign on the same bot ---
  fastify.post('/:botId/campaigns', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const { botId } = request.params as { botId: string };
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can create campaigns' });
    }
    const parsed = createCampaignSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: 'gift' },
      include: { giftCampaigns: { orderBy: { updatedAt: 'desc' } } },
    });
    if (!bot) return reply.code(404).send({ error: 'Bot not found' });

    let clone =
      parsed.data.cloneFromId
        ? bot.giftCampaigns.find((c) => c.id === parsed.data.cloneFromId)
        : bot.giftCampaigns[0];
    if (parsed.data.cloneFromId && !clone) {
      return reply.code(404).send({ error: 'Исходный проект не найден' });
    }

    await enforceSingleActiveCampaign(prisma, botId, tenantId);
    await prisma.giftCampaignConfig.updateMany({
      where: { botInstanceId: botId, tenantId, isActive: true },
      data: { isActive: false },
    });

    const campaign = await prisma.giftCampaignConfig.create({
      data: {
        tenantId,
        botInstanceId: botId,
        name: parsed.data.name.trim(),
        channelId: clone?.channelId || 'pending',
        channelUsername: clone?.channelUsername || null,
        giftFileUrl: clone?.giftFileUrl || null,
        funnelJson: (clone?.funnelJson as object) || (DEFAULT_GIFT_FUNNEL as object),
        promoPost: clone?.promoPost
          ? ({
              ...readPromoPost(clone.promoPost),
              clickCount: 0,
              telegramMessageId: undefined,
              publishedAt: undefined,
            } as object)
          : undefined,
        isActive: true,
      },
    });

    return reply.code(201).send({ campaign: serializeCampaign(campaign) });
  });

  // --- Rename / enable / disable project (at most one active per bot) ---
  fastify.patch(
    '/:botId/campaigns/:campaignId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId, campaignId } = request.params as { botId: string; campaignId: string };
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can update campaigns' });
      }
      const parsed = patchCampaignSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      if (parsed.data.name === undefined && parsed.data.isActive === undefined) {
        return reply.code(400).send({ error: 'Укажите name и/или isActive' });
      }

      const prisma = fastify.prisma;
      const existing = await prisma.giftCampaignConfig.findFirst({
        where: { id: campaignId, botInstanceId: botId, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Проект не найден' });

      if (parsed.data.isActive === true) {
        await prisma.giftCampaignConfig.updateMany({
          where: { botInstanceId: botId, tenantId, isActive: true, NOT: { id: campaignId } },
          data: { isActive: false },
        });
      }

      const campaign = await prisma.giftCampaignConfig.update({
        where: { id: campaignId },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        },
      });

      if (parsed.data.isActive === true) {
        await enforceSingleActiveCampaign(prisma, botId, tenantId, campaignId);
      }

      return reply.send({ campaign: serializeCampaign(campaign) });
    },
  );

  // --- Save promo post draft ---
  fastify.put('/:botId/promo', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const { botId } = request.params as { botId: string };
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can edit promo posts' });
    }
    const parsed = promoSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: 'gift' },
      include: { giftCampaigns: { orderBy: { updatedAt: 'desc' } } },
    });
    if (!bot) return reply.code(404).send({ error: 'Bot not found' });
    const campaign = pickCampaign(bot.giftCampaigns, parsed.data.campaignId);
    if (!campaign) {
      return reply.code(400).send({ error: 'Сначала создайте проект и сохраните воронку' });
    }

    const prev = readPromoPost(campaign.promoPost);
    const mediaUrl = cleanOptional(parsed.data.mediaUrl || parsed.data.imageUrl);
    const telegramFileId = cleanOptional(parsed.data.telegramFileId);
    const next: GiftPromoPost = {
      ...prev,
      text: parsed.data.text,
      mediaType: parsed.data.mediaType === 'video' ? 'video' : 'photo',
      telegramFileId,
      telegramFileUniqueId:
        cleanOptional(parsed.data.telegramFileUniqueId) ||
        (telegramFileId ? prev.telegramFileUniqueId : undefined),
      mediaUrl: telegramFileId ? undefined : mediaUrl,
      buttonText: parsed.data.buttonText,
    };
    delete (next as { imageUrl?: string }).imageUrl;

    const updated = await prisma.giftCampaignConfig.update({
      where: { id: campaign.id },
      data: { promoPost: next as object },
    });

    return reply.send({ promoPost: readPromoPost(updated.promoPost) });
  });

  // --- Upload media to Telegram → file_id (no public hosting required) ---
  fastify.post('/:botId/media', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId, sub: userId } = user;
    const { botId } = request.params as { botId: string };
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can upload media' });
    }

    const file = await request.file();
    if (!file) {
      return reply.code(400).send({ error: 'Прикрепите файл (поле file)' });
    }

    const queryCampaignId = (request.query as { campaignId?: string } | undefined)?.campaignId;
    const fieldCampaign = (file.fields as Record<string, { value?: string } | undefined> | undefined)
      ?.campaignId?.value;
    const campaignIdField = queryCampaignId || fieldCampaign;

    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: 'gift', status: 'active' },
      include: { giftCampaigns: { orderBy: { updatedAt: 'desc' } } },
    });
    if (!bot?.botTokenEncrypted) {
      return reply.code(404).send({ error: 'Bot not found' });
    }

    const buffer = await file.toBuffer();
    if (!buffer.length) {
      return reply.code(400).send({ error: 'Пустой файл' });
    }

    const filename = file.filename || 'upload.bin';
    const mimeType = file.mimetype || 'application/octet-stream';
    const kind = detectUploadKind(mimeType, filename);

    // Staging chat: current user's Telegram → tenant owner Telegram → verified channel
    const [currentUser, ownerUser] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { telegramUserId: true } }),
      prisma.user.findFirst({
        where: { tenantMembers: { some: { tenantId, role: 'owner' } } },
        select: { telegramUserId: true },
      }),
    ]);
    const campaign = pickCampaign(bot.giftCampaigns, campaignIdField);
    let chatId: string | number | undefined =
      currentUser?.telegramUserId != null
        ? Number(currentUser.telegramUserId)
        : ownerUser?.telegramUserId != null
          ? Number(ownerUser.telegramUserId)
          : undefined;
    if (chatId == null && campaign?.channelId) {
      chatId = campaign.channelId;
    }
    if (chatId == null) {
      return reply.code(400).send({
        error:
          'Чтобы загрузить файл, привяжите Telegram (Manager Bot) или проверьте канал в блоке 1 — бот отправит файл туда, сохранит file_id и удалит сообщение.',
      });
    }

    const token = decrypt(bot.botTokenEncrypted);
    const botApi = `https://api.telegram.org/bot${token}`;

    try {
      const uploaded = await uploadMediaToTelegram({
        botApi,
        chatId,
        buffer,
        filename,
        mimeType,
        kind,
      });
      return reply.send({
        fileId: uploaded.fileId,
        fileUniqueId: uploaded.fileUniqueId,
        mediaType: uploaded.mediaType,
        kind: uploaded.kind,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки в Telegram';
      return reply.code(400).send({ error: message });
    }
  });

  // --- Publish promo post to Telegram channel ---
  fastify.post('/:botId/promo/publish', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const { botId } = request.params as { botId: string };
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can publish promo posts' });
    }

    const body = promoSchema.safeParse(request.body ?? {});
    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: 'gift', status: 'active' },
      include: { giftCampaigns: { orderBy: { updatedAt: 'desc' } } },
    });
    if (!bot?.botTokenEncrypted) {
      return reply.code(404).send({ error: 'Bot not found' });
    }
    const campaign = pickCampaign(
      bot.giftCampaigns,
      body.success ? body.data.campaignId : undefined,
    );
    if (!campaign?.channelId || campaign.channelId === 'pending') {
      return reply.code(400).send({ error: 'Сначала проверьте канал (бот должен быть админом)' });
    }

    const prev = readPromoPost(campaign.promoPost);
    const promo: GiftPromoPost = body.success
      ? {
          ...prev,
          text: body.data.text,
          mediaType: body.data.mediaType === 'video' ? 'video' : 'photo',
          telegramFileId: cleanOptional(body.data.telegramFileId) || prev.telegramFileId,
          telegramFileUniqueId:
            cleanOptional(body.data.telegramFileUniqueId) || prev.telegramFileUniqueId,
          mediaUrl: cleanOptional(body.data.mediaUrl || body.data.imageUrl) || prev.mediaUrl,
          buttonText: body.data.buttonText,
        }
      : prev;
    delete (promo as { imageUrl?: string }).imageUrl;
    if (promo.telegramFileId) {
      promo.mediaUrl = undefined;
    }

    if (!promo.text.trim()) {
      return reply.code(400).send({ error: 'Заполните текст поста' });
    }

    const token = decrypt(bot.botTokenEncrypted);
    const botApi = `https://api.telegram.org/bot${token}`;
    const startPayload = giftPromoStartPayload(campaign.id);
    const buttonUrl = `https://t.me/${bot.botUsername}?start=${startPayload}`;
    const buttonLabel = formatPromoButtonLabel(promo.buttonText, promo.clickCount);
    const replyMarkup = {
      inline_keyboard: [[{ text: buttonLabel, url: buttonUrl }]],
    };
    const media = resolveTelegramMedia(promo);
    const isVideo = promo.mediaType === 'video';
    const caption = clientMdToMarkdownV2(promo.text);

    let tgJson: any;
    if (media && isVideo) {
      const tgRes = await fetch(`${botApi}/sendVideo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: campaign.channelId,
          video: media,
          caption,
          parse_mode: 'MarkdownV2',
          reply_markup: replyMarkup,
        }),
      });
      tgJson = await tgRes.json();
    } else if (media) {
      const tgRes = await fetch(`${botApi}/sendPhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: campaign.channelId,
          photo: media,
          caption,
          parse_mode: 'MarkdownV2',
          reply_markup: replyMarkup,
        }),
      });
      tgJson = await tgRes.json();
    } else {
      const tgRes = await fetch(`${botApi}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: campaign.channelId,
          text: caption,
          parse_mode: 'MarkdownV2',
          reply_markup: replyMarkup,
        }),
      });
      tgJson = await tgRes.json();
    }

    if (!tgJson.ok) {
      return reply.code(400).send({
        error: tgJson.description || 'Не удалось опубликовать в канал',
      });
    }

    const message = tgJson.result;
    const next: GiftPromoPost = {
      ...promo,
      telegramMessageId: message.message_id,
      telegramChatId: String(message.chat?.id ?? campaign.channelId),
      publishedAt: new Date().toISOString(),
    };

    await prisma.giftCampaignConfig.update({
      where: { id: campaign.id },
      data: { promoPost: next as object },
    });

    return reply.send({
      ok: true,
      promoPost: next,
      messageId: message.message_id,
    });
  });

  // --- Verify bot is admin in channel ---
  fastify.post('/:botId/channel/verify', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { botId } = request.params as { botId: string };
    const body = z
      .object({ channelUsername: z.string().min(1) })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: body.error.flatten() });
    }

    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId, status: 'active' },
    });
    if (!bot?.botTokenEncrypted) {
      return reply.code(404).send({ error: 'Bot not found' });
    }

    const token = decrypt(bot.botTokenEncrypted);
    const channel = normalizeChannelUsername(body.data.channelUsername);
    const chatRef = channel.startsWith('-') ? channel : `@${channel}`;

    try {
      const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
      const me = (await meRes.json()) as any;
      if (!me.ok) {
        return reply.code(400).send({ ok: false, error: 'Не удалось получить данные бота' });
      }

      const memberRes = await fetch(`https://api.telegram.org/bot${token}/getChatMember`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatRef, user_id: me.result.id }),
      });
      const member = (await memberRes.json()) as any;
      if (!member.ok) {
        return reply.code(400).send({
          ok: false,
          error: member.description || 'Бот не видит канал. Добавьте бота администратором.',
        });
      }

      const status = member.result?.status as string;
      const isAdmin = status === 'administrator' || status === 'creator';
      let channelId = chatRef;
      try {
        const chatRes = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatRef }),
        });
        const chat = (await chatRes.json()) as any;
        if (chat.ok && chat.result?.id) channelId = String(chat.result.id);
      } catch {
        // keep @username as channelId fallback
      }

      return reply.send({
        ok: isAdmin,
        status,
        channelId,
        channelUsername: channel,
        message: isAdmin
          ? 'Бот — администратор канала. Можно сохранять кампанию.'
          : 'Бот в канале, но не админ. Назначьте администратором (права: видеть участников).',
      });
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: err instanceof Error ? err.message : 'Ошибка проверки канала',
      });
    }
  });

  // --- Broadcast to segment ---
  fastify.post('/:botId/broadcasts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const { botId } = request.params as { botId: string };
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can broadcast' });
    }

    const parsed = broadcastSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId },
      include: { giftCampaigns: { where: { isActive: true }, take: 1 } },
    });
    if (!bot || !bot.giftCampaigns[0]) {
      return reply.code(404).send({ error: 'Active campaign not found' });
    }

    const campaignId = bot.giftCampaigns[0].id;
    const where: any = { campaignId };
    if (parsed.data.segment === 'gifted') where.giftDelivered = true;
    if (parsed.data.segment === 'not_gifted') where.giftDelivered = false;

    const totalCount = await prisma.giftSubscriber.count({ where });
    const when = parsed.data.scheduledAt ? new Date(parsed.data.scheduledAt) : new Date();
    const broadcast = await prisma.broadcast.create({
      data: {
        tenantId,
        status: 'scheduled',
        scheduledAt: when,
        totalCount,
        messageJson: {
          botId,
          campaignId,
          segment: parsed.data.segment,
          text: parsed.data.text,
          mediaUrl: parsed.data.mediaUrl || undefined,
        },
      },
    });

    return reply.send({ broadcast, queued: totalCount });
  });

  // --- Broadcast history ---
  fastify.get('/:botId/broadcasts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { botId } = request.params as { botId: string };
    const prisma = fastify.prisma;

    const rows = await prisma.broadcast.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const broadcasts = rows
      .filter((b) => (b.messageJson as any)?.botId === botId)
      .map((b) => {
        const msg = b.messageJson as any;
        return {
          id: b.id,
          status: b.status,
          scheduledAt: b.scheduledAt,
          sentCount: b.sentCount,
          totalCount: b.totalCount,
          segment: msg?.segment,
          text: msg?.text,
          createdAt: b.createdAt,
        };
      });

    return reply.send({ broadcasts });
  });

  // --- Subscriber list for portal ---
  fastify.get('/:botId/subscribers', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const { botId } = request.params as { botId: string };
    const campaignId = (request.query as { campaignId?: string } | undefined)?.campaignId;
    const prisma = fastify.prisma;

    const subscribers = await prisma.giftSubscriber.findMany({
      where: {
        tenantId,
        botInstanceId: botId,
        ...(campaignId ? { campaignId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return reply.send({
      subscribers: subscribers.map((s) => ({
        id: s.id,
        campaignId: s.campaignId,
        telegramId: s.telegramId,
        username: s.username,
        firstName: s.firstName,
        phone: s.phone,
        subscribed: s.subscribed,
        giftDelivered: s.giftDelivered,
        funnelPhase: s.funnelPhase,
        twentyOpportunityId: s.twentyOpportunityId,
        createdAt: s.createdAt,
      })),
    });
  });

  // --- Conversation messages for portal chat ---
  fastify.get(
    '/:botId/subscribers/:subscriberId/messages',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { botId, subscriberId } = request.params as { botId: string; subscriberId: string };
      const prisma = fastify.prisma;

      const subscriber = await prisma.giftSubscriber.findFirst({
        where: { id: subscriberId, tenantId, botInstanceId: botId },
      });
      if (!subscriber) return reply.code(404).send({ error: 'Not found' });

      if (!subscriber.conversationId) {
        return reply.send({ messages: [], mode: 'bot' });
      }

      const conversation = await prisma.conversation.findFirst({
        where: { id: subscriber.conversationId, tenantId },
      });
      const messages = await prisma.chatMessage.findMany({
        where: { conversationId: subscriber.conversationId },
        orderBy: { sentAt: 'asc' },
        take: 200,
      });

      return reply.send({
        mode: conversation?.mode || 'bot',
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          sentAt: m.sentAt,
        })),
      });
    },
  );

  // --- Reply to subscriber via gift bot ---
  fastify.post('/:botId/subscribers/:subscriberId/reply', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const { botId, subscriberId } = request.params as { botId: string; subscriberId: string };
    const body = z.object({ text: z.string().min(1).max(4000) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
    if (!canManageTenant(user) && user.tenantRole !== 'member' && user.role !== 'member') {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const prisma = fastify.prisma;
    const [bot, subscriber] = await Promise.all([
      prisma.botInstance.findFirst({ where: { id: botId, tenantId, status: 'active' } }),
      prisma.giftSubscriber.findFirst({ where: { id: subscriberId, tenantId, botInstanceId: botId } }),
    ]);
    if (!bot?.botTokenEncrypted || !subscriber) {
      return reply.code(404).send({ error: 'Not found' });
    }

    const token = decrypt(bot.botTokenEncrypted);
    const botApi = `https://api.telegram.org/bot${token}`;
    const tgRes = await fetch(`${botApi}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: subscriber.telegramId,
        text: clientMdToMarkdownV2(body.data.text),
        parse_mode: 'MarkdownV2',
      }),
    });
    let tgJson = (await tgRes.json()) as any;
    if (!tgJson.ok) {
      const plain = await fetch(`${botApi}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: subscriber.telegramId, text: body.data.text }),
      });
      tgJson = await plain.json();
    }
    if (!tgJson.ok) {
      return reply.code(400).send({ error: tgJson.description || 'Telegram send failed' });
    }

    let conversationId = subscriber.conversationId;
    if (!conversationId) {
      const conversation = await prisma.conversation.create({
        data: {
          tenantId,
          botInstanceId: botId,
          platform: 'telegram',
          platformUserId: subscriber.telegramId,
          platformUsername: subscriber.username,
          platformFirstName: subscriber.firstName,
          status: 'open',
          mode: 'human',
        },
      });
      conversationId = conversation.id;
      await prisma.giftSubscriber.update({
        where: { id: subscriber.id },
        data: { conversationId },
      });
    }

    await prisma.chatMessage.create({
      data: {
        conversationId,
        role: 'operator',
        content: body.data.text,
      },
    });
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { mode: 'human' },
    });

    // Best-effort note on Person in Twenty (App ChatMessage objects not installed in 2.21)
    if (subscriber.twentyPersonId) {
      try {
        const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
        const owner = await prisma.tenantMember.findFirst({
          where: { tenantId, role: 'owner' },
          include: { user: true },
        });
        if (tenant?.twentyWorkspaceId && tenant.twentyOwnerPasswordEncrypted && owner?.user?.email) {
          const client = new TwentyClient({
            apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
          });
          await client.authenticateWorkspace(
            owner.user.email,
            decrypt(tenant.twentyOwnerPasswordEncrypted),
            tenant.twentyWorkspaceId,
          );
          await client.createNoteForPerson({
            personId: subscriber.twentyPersonId,
            title: 'Ответ оператора (Telegram)',
            body: body.data.text,
          });
        }
      } catch (err) {
        request.log.warn({ err }, 'Failed to sync operator reply note to Twenty');
      }
    }

    return reply.send({ ok: true });
  });

  // --- Deactivate bot ---
  fastify.delete('/:botId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const { botId } = request.params as { botId: string };
    const prisma = fastify.prisma;

    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can deactivate bots' });
    }

    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId },
    });
    if (!bot) return reply.code(404).send({ error: 'Bot not found' });

    await prisma.botInstance.update({
      where: { id: botId },
      data: { status: 'inactive' },
    });

    return reply.send({ message: 'Bot deactivated' });
  });

  // Relay endpoint kept for compatibility; real TG webhooks hit gift-bot-worker
  fastify.post('/webhook/:botId', async (request, reply) => {
    const { botId } = request.params as { botId: string };
    return reply.send({ ok: true, botId });
  });
};

function sanitizeFunnel(input: z.infer<typeof campaignSchema>['funnel']): GiftFunnelConfig {
  const mapMsg = (m: z.infer<typeof funnelMessageSchema>) => {
    const telegramFileId = cleanOptional(m.telegramFileId);
    return {
      delayMinutes: m.delayMinutes,
      text: m.text,
      imageUrl: telegramFileId ? undefined : cleanOptional(m.imageUrl),
      telegramFileId,
      mediaType: (m.mediaType === 'video'
        ? 'video'
        : telegramFileId
          ? 'photo'
          : undefined) as GiftFunnelConfig['start']['mediaType'],
    };
  };
  const giftFileId = cleanOptional(input.gift.telegramFileId);
  const giftMediaType: GiftFunnelConfig['gift']['mediaType'] =
    input.gift.type === 'video' || input.gift.mediaType === 'video'
      ? 'video'
      : input.gift.mediaType === 'photo'
        ? 'photo'
        : giftFileId && input.gift.type === 'file'
          ? undefined
          : giftFileId
            ? 'photo'
            : undefined;
  return {
    start: {
      text: input.start.text,
      imageUrl: cleanOptional(input.start.telegramFileId) ? undefined : cleanOptional(input.start.imageUrl),
      telegramFileId: cleanOptional(input.start.telegramFileId),
      mediaType:
        input.start.mediaType === 'video'
          ? 'video'
          : cleanOptional(input.start.telegramFileId)
            ? 'photo'
            : undefined,
    },
    notSubscribed: input.notSubscribed.map(mapMsg),
    gift: {
      type: input.gift.type,
      url: cleanOptional(input.gift.url) || '',
      telegramFileId: giftFileId,
      mediaType: giftMediaType,
      caption: input.gift.caption,
    },
    afterGift: input.afterGift.map(mapMsg),
    notGifted: input.notGifted.map(mapMsg),
    subscribeButton: {
      confirmLabel: input.subscribeButton?.confirmLabel || 'Я подписался ✅',
    },
  };
}
