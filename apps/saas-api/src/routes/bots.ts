// Bot routes: Managed Bots provision, gift campaign, channel verify, broadcasts

import type { FastifyPluginAsync } from 'fastify';
import multipart from '@fastify/multipart';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { decrypt, encrypt } from '@voxly/crypto';
import { randomBytes } from 'node:crypto';
import { TwentyClient } from '@voxly/twenty-client';
import {
  DEFAULT_GIFT_FUNNEL,
  DEFAULT_GIFT_PROMO,
  clientMdToMarkdownV2,
  formatPromoButtonLabel,
  promoShowClickCounter,
  giftPromoStartPayload,
  buildVoxlyBotUsername,
  resolveTelegramMedia,
  normalizeGiftMediaType,
  promoMediaType,
  detectStoredMediaKind,
  detectUploadMediaKind,
  isTelegramDocumentFileId,
  GIFT_PROMO_MEDIA_TYPES,
  PRICING,
  PRODUCT_CODES,
  TRIAL_PERIOD_DAYS,
  AI_HANDOFF_PAUSE_MS,
  getGiftBotSlots,
  broadcastPoolIds,
  type GiftFunnelConfig,
  type GiftPromoMediaType,
  type GiftPromoPost,
} from '@voxly/shared';
import {
  requireActiveAddon,
  startChannelTrial,
  trialMeta,
  type ChannelTrialType,
} from '../services/channel-trial.js';
import { VOXLY_OPPORTUNITY_STAGE_OPTIONS } from '../services/twenty-opportunity-ru-defaults.js';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const botsCacheRedis = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
});
const BOTS_COUNTS_CACHE_TTL_SEC = 30;

async function invalidateBotsCache(tenantId: string): Promise<void> {
  try {
    await botsCacheRedis.del(`bots:counts:${tenantId}`);
  } catch {
    // ignore cache errors
  }
}

const giftMediaTypeSchema = z.enum(GIFT_PROMO_MEDIA_TYPES);

function canManageTenant(user: { role?: string; tenantRole?: string }): boolean {
  return user.role === 'superadmin' || user.tenantRole === 'owner' || user.role === 'owner';
}

type GiftProductBotType = 'gift' | 'gift_max';

async function countGiftBotsUsed(
  prisma: any,
  tenantId: string,
  botType: GiftProductBotType,
  opts?: { includePendingProvision?: boolean },
): Promise<number> {
  const used = await prisma.botInstance.count({
    where: { tenantId, botType },
  });
  if (!opts?.includePendingProvision || botType !== 'gift') return used;
  const pending = await prisma.botProvisionRequest.count({
    where: {
      tenantId,
      botType: 'gift',
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
  });
  return used + pending;
}

/** Lazy-migrate missing botSlots → max(1, used) for one product. */
async function ensureGiftBotSlots<T extends { id: string; config: unknown }>(
  prisma: any,
  tenantId: string,
  addon: T | null,
  botType: GiftProductBotType,
): Promise<{ addon: T | null; slots: number; used: number }> {
  const used = await countGiftBotsUsed(prisma, tenantId, botType);
  if (!addon) return { addon: null, slots: 0, used };
  let slots = getGiftBotSlots(addon.config);
  if (slots <= 0) {
    slots = Math.max(1, used);
    const config = {
      ...((addon.config as object) || {}),
      botSlots: slots,
    };
    addon = await prisma.addon.update({
      where: { id: addon.id },
      data: { config },
    });
  }
  return { addon, slots, used };
}

/**
 * Split legacy account-wide gift_bot that also covered MAX bots into gift_bot_max.
 */
async function grandfatherSplitGiftMaxAddon(prisma: any, tenantId: string): Promise<void> {
  const maxUsed = await countGiftBotsUsed(prisma, tenantId, 'gift_max');
  if (maxUsed <= 0) return;
  const existingMax = await prisma.addon.findUnique({
    where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT_MAX } },
  });
  if (existingMax) return;
  const legacy = await prisma.addon.findUnique({
    where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT } },
  });
  if (!legacy || legacy.status !== 'active' || legacy.activeUntil < new Date()) return;

  const tgUsed = await countGiftBotsUsed(prisma, tenantId, 'gift');
  const legacySlots = getGiftBotSlots(legacy.config);
  await prisma.addon.create({
    data: {
      tenantId,
      type: PRODUCT_CODES.GIFT_BOT_MAX,
      status: 'active',
      activeUntil: legacy.activeUntil,
      config: {
        ...((legacy.config as object) || {}),
        botSlots: Math.max(1, maxUsed),
        trial: false,
        trialConsumed: true,
        grandfatheredFrom: 'gift_bot',
      },
    },
  });
  // Shrink TG slots to TG bots only (keep at least 1 if they still have TG capacity paid).
  const nextTgSlots = Math.max(tgUsed, legacySlots > maxUsed ? legacySlots - maxUsed : tgUsed, tgUsed > 0 ? 1 : 0);
  if (nextTgSlots > 0) {
    await prisma.addon.update({
      where: { id: legacy.id },
      data: {
        config: {
          ...((legacy.config as object) || {}),
          botSlots: nextTgSlots,
        },
      },
    });
  }
}

const provisionSchema = z.object({
  botType: z.enum(['gift', 'ai_wa']).default('gift'),
  suggestedUsername: z.string().min(5).max(32).optional(),
  suggestedName: z.string().min(1).max(64).optional(),
});

const optionalHttpsUrl = z.string().url().optional().or(z.literal(''));
const optionalFileId = z.string().min(1).max(256).optional().or(z.literal(''));

const extraButtonSchema = z.object({
  text: z.string().min(1).max(64),
  url: z
    .string()
    .min(1)
    .max(2000)
    .refine((u) => /^https?:\/\//i.test(u), { message: 'URL кнопки должен быть http(s)' }),
});
const extraButtonsSchema = z.array(extraButtonSchema).max(8).optional();

const funnelMessageSchema = z.object({
  delayMinutes: z.number().min(0).max(60 * 24 * 30),
  text: z.string().min(1).max(4000),
  imageUrl: optionalHttpsUrl,
  telegramFileId: optionalFileId,
  mediaType: giftMediaTypeSchema.optional(),
  extraButtons: extraButtonsSchema,
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
      mediaType: giftMediaTypeSchema.optional(),
      extraButtons: extraButtonsSchema,
    }),
    notSubscribed: z.array(funnelMessageSchema).max(10),
    gift: z
      .object({
        type: z.enum(['file', 'link', 'video']),
        url: z.string().max(2000).optional().or(z.literal('')),
        telegramFileId: optionalFileId,
        mediaType: giftMediaTypeSchema.optional(),
        caption: z.string().max(1000).optional(),
        extraButtons: extraButtonsSchema,
      })
      .superRefine((gift, ctx) => {
        const hasUrl = Boolean(gift.url && gift.url.length > 0);
        if (gift.type === 'link') {
          if (!hasUrl) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Укажите ссылку на подарок', path: ['url'] });
          } else if (!/^https?:\/\//i.test(gift.url!)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Ссылка должна быть http(s)', path: ['url'] });
          }
        } else if (hasUrl && !/^https?:\/\//i.test(gift.url!) && !gift.telegramFileId) {
          // Optional draft: file/video may be empty until uploaded; if URL set, must be http(s)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'URL подарка должен быть http(s) или загрузите файл',
            path: ['url'],
          });
        }
        // file/video without media: allowed as draft (worker sends caption-only until upload)
      }),
    afterGift: z.array(funnelMessageSchema).max(10),
    notGifted: z.array(funnelMessageSchema).max(10),
    subscribeButton: z
      .object({ confirmLabel: z.string().min(1).max(64).optional() })
      .optional(),
  }),
});

const giftFunnelPhaseSchema = z.enum(['started', 'awaiting_sub', 'gifted', 'not_gifted']);

const broadcastSchema = z.object({
  segment: z.enum(['gifted', 'not_gifted', 'all']),
  /** Optional AND-filter on GiftSubscriber.funnelPhase */
  funnelPhase: giftFunnelPhaseSchema.optional(),
  text: z.string().min(1).max(4000),
  mediaUrl: optionalHttpsUrl,
  telegramFileId: optionalFileId,
  mediaType: giftMediaTypeSchema.optional(),
  scheduledAt: z.string().datetime().optional(),
  /** Optional account pool for least-loaded rotation (Job 1B.1). */
  botIds: z.array(z.string().min(1)).optional(),
});

/** GramJS / WhatsApp mailing — audience = Conversations for the account */
const channelBroadcastSchema = z.object({
  text: z.string().min(1).max(4000),
  mediaUrl: optionalHttpsUrl,
  mediaType: giftMediaTypeSchema.optional(),
  opportunityStage: z.string().min(1).max(80).optional(),
  giftStarted: z.enum(['any', 'yes', 'no']).optional(),
  funnelPhase: giftFunnelPhaseSchema.optional(),
  readStatus: z.enum(['any', 'read', 'unread']).optional(),
  scheduledAt: z.string().datetime().optional(),
  /** Optional account pool for least-loaded rotation (Job 1B.1). */
  botIds: z.array(z.string().min(1)).optional(),
});

/** Stories — media required; send supported for GramJS only (ADR-019) */
const storyBroadcastSchema = z.object({
  channel: z.literal('story'),
  text: z.string().max(4000).optional().default(''),
  mediaUrl: z.string().url(),
  mediaType: giftMediaTypeSchema.optional(),
  linkUrl: z.string().url().optional(),
  linkText: z.string().max(100).optional(),
  opportunityStage: z.string().min(1).max(80).optional(),
  giftStarted: z.enum(['any', 'yes', 'no']).optional(),
  funnelPhase: giftFunnelPhaseSchema.optional(),
  readStatus: z.enum(['any', 'read', 'unread']).optional(),
  scheduledAt: z.string().datetime().optional(),
});

const patchBroadcastSchema = z.object({
  segment: z.enum(['gifted', 'not_gifted', 'all']).optional(),
  funnelPhase: giftFunnelPhaseSchema.nullable().optional(),
  text: z.string().min(1).max(4000).optional(),
  mediaUrl: optionalHttpsUrl.nullable().optional(),
  telegramFileId: optionalFileId.nullable().optional(),
  mediaType: giftMediaTypeSchema.nullable().optional(),
  opportunityStage: z.string().min(1).max(80).nullable().optional(),
  giftStarted: z.enum(['any', 'yes', 'no']).nullable().optional(),
  readStatus: z.enum(['any', 'read', 'unread']).nullable().optional(),
  scheduledAt: z.string().datetime().optional(),
  /** Optional account pool for least-loaded rotation (Job 1B.1). */
  botIds: z.array(z.string().min(1)).optional(),
});

function giftSubscriberAudienceWhere(input: {
  campaignId: string;
  segment: 'gifted' | 'not_gifted' | 'all';
  funnelPhase?: string | null;
}) {
  const where: Record<string, unknown> = { campaignId: input.campaignId };
  if (input.segment === 'gifted') where.giftDelivered = true;
  if (input.segment === 'not_gifted') where.giftDelivered = false;
  if (input.funnelPhase) where.funnelPhase = input.funnelPhase;
  return where;
}

function conversationAudienceWhere(botId: string | string[], tenantId: string) {
  return {
    tenantId,
    botInstanceId: Array.isArray(botId) ? { in: botId } : botId,
    status: { not: 'closed' },
  };
}

type ChannelAudienceFilters = {
  opportunityStage?: string;
  giftStarted?: 'any' | 'yes' | 'no';
  funnelPhase?: z.infer<typeof giftFunnelPhaseSchema>;
  readStatus?: 'any' | 'read' | 'unread';
};

function normalizeChannelAudienceFilters(input: ChannelAudienceFilters): ChannelAudienceFilters {
  return {
    opportunityStage: input.opportunityStage?.trim() || undefined,
    giftStarted: input.giftStarted && input.giftStarted !== 'any' ? input.giftStarted : undefined,
    funnelPhase: input.funnelPhase || undefined,
    // Applied when ChatMessage.deliveryStatus / BroadcastRecipient exist (Phase 2).
    readStatus: input.readStatus && input.readStatus !== 'any' ? input.readStatus : undefined,
  };
}

async function getTenantTwentyClient(prisma: any, tenantId: string): Promise<TwentyClient | null> {
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
    return null;
  }

  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  return client;
}

async function resolveChannelBroadcastAudience(input: {
  prisma: any;
  tenantId: string;
  botId: string | string[];
  filters: ChannelAudienceFilters;
}): Promise<{ conversationIds: string[]; count: number }> {
  const filters = normalizeChannelAudienceFilters(input.filters);
  const conversations = await input.prisma.conversation.findMany({
    where: conversationAudienceWhere(input.botId, input.tenantId),
    select: {
      id: true,
      platformUserId: true,
      twentyOpportunityId: true,
    },
    take: 10_000,
  });

  let audience = conversations;

  if (filters.opportunityStage) {
    const linked = audience.filter((c: { twentyOpportunityId: string | null }) => c.twentyOpportunityId);
    try {
      const client = await getTenantTwentyClient(input.prisma, input.tenantId);
      if (!client) throw new Error('Twenty workspace credentials are not configured');

      const stages = new Map<string, string | null>();
      const opportunityIds: string[] = [];
      for (const c of linked as Array<{ twentyOpportunityId: string | null }>) {
        if (c.twentyOpportunityId) opportunityIds.push(c.twentyOpportunityId);
      }
      for (const opportunityId of [...new Set(opportunityIds)]) {
        stages.set(opportunityId, await client.getOpportunityStage(opportunityId));
      }
      audience = linked.filter((c: { twentyOpportunityId: string | null }) =>
        c.twentyOpportunityId && stages.get(c.twentyOpportunityId) === filters.opportunityStage,
      );
    } catch (err) {
      console.warn('[bots] channel broadcast opportunity stage filter skipped', err);
    }
  }

  if (filters.giftStarted || filters.funnelPhase) {
    const platformIds = [...new Set(audience.map((c: { platformUserId: string }) => c.platformUserId))];
    const subscribers = platformIds.length
      ? await input.prisma.giftSubscriber.findMany({
          where: {
            tenantId: input.tenantId,
            telegramId: { in: platformIds },
          },
          select: { telegramId: true, funnelPhase: true },
        })
      : [];
    const subscribersByTelegramId = new Map<string, Array<{ funnelPhase: string }>>();
    for (const subscriber of subscribers) {
      const list = subscribersByTelegramId.get(subscriber.telegramId) || [];
      list.push(subscriber);
      subscribersByTelegramId.set(subscriber.telegramId, list);
    }
    audience = audience.filter((conversation: { platformUserId: string }) => {
      const matched = subscribersByTelegramId.get(conversation.platformUserId) || [];
      if (filters.giftStarted === 'yes' && matched.length === 0) return false;
      if (filters.giftStarted === 'no' && matched.length > 0) return false;
      if (filters.funnelPhase && !matched.some((s) => s.funnelPhase === filters.funnelPhase)) return false;
      return true;
    });
  }

  if (filters.readStatus === 'read' || filters.readStatus === 'unread') {
    const ids = audience.map((c: { id: string }) => c.id);
    if (ids.length) {
      const lastOutbound = await input.prisma.chatMessage.findMany({
        where: {
          conversationId: { in: ids },
          role: { in: ['operator', 'assistant'] },
          deliveryStatus: { not: null },
        },
        orderBy: { sentAt: 'desc' },
        distinct: ['conversationId'],
        select: { conversationId: true, deliveryStatus: true },
      });
      const byConv = new Map(
        lastOutbound.map((m: { conversationId: string; deliveryStatus: string | null }) => [
          m.conversationId,
          m.deliveryStatus,
        ]),
      );
      audience = audience.filter((c: { id: string }) => {
        const st = byConv.get(c.id);
        if (filters.readStatus === 'read') return st === 'read';
        // unread = never read (sent/delivered/missing)
        return st !== 'read';
      });
    }
  }

  const conversationIds = audience.map((c: { id: string }) => c.id);
  return { conversationIds, count: conversationIds.length };
}

function mailingChannelForBotType(
  botType: string,
): 'gift' | 'gramjs' | 'wa' | null {
  if (botType === 'gift') return 'gift';
  if (botType === 'ai_gramjs') return 'gramjs';
  if (botType === 'ai_wa') return 'wa';
  return null;
}

function addonTypeForMailingChannel(
  channel: 'gift' | 'gramjs' | 'wa' | 'story',
): ChannelTrialType {
  if (channel === 'gift') return PRODUCT_CODES.MAILING_BOT;
  if (channel === 'story') return PRODUCT_CODES.MAILING_STORIES;
  return PRODUCT_CODES.MAILING_ACCOUNTS;
}

/**
 * Validate a broadcast account pool (Job 1B.1): every member must belong to the
 * tenant, be active and map to the same mailing channel. Always keeps the
 * primary bot; returns `[primary, ...valid extras]` deduplicated.
 */
async function resolveBroadcastPool(
  prisma: any,
  tenantId: string,
  primaryBotId: string,
  extraBotIds: string[] | undefined,
  expectedChannel: 'gift' | 'gramjs' | 'wa',
): Promise<string[]> {
  const requested = [
    ...new Set([
      primaryBotId,
      ...(Array.isArray(extraBotIds) ? extraBotIds.filter(Boolean) : []),
    ]),
  ];
  if (requested.length === 1) return requested;
  const bots = await prisma.botInstance.findMany({
    where: { id: { in: requested }, tenantId },
    select: { id: true, botType: true, status: true },
  });
  const allowed = new Set(
    bots
      .filter(
        (b: { botType: string; status: string }) =>
          b.status === 'active' && mailingChannelForBotType(b.botType) === expectedChannel,
      )
      .map((b: { id: string }) => b.id),
  );
  const pool = requested.filter((id) => allowed.has(id));
  return pool.length > 0 ? pool : [primaryBotId];
}

function normalizeStageRuleChannel(value: unknown): 'gift' | 'gramjs' | 'wa' {
  return value === 'gramjs' || value === 'wa' ? value : 'gift';
}

function botTypeForStageRuleChannel(channel: 'gift' | 'gramjs' | 'wa') {
  if (channel === 'gramjs') return 'ai_gramjs';
  if (channel === 'wa') return 'ai_wa';
  return 'gift';
}

const promoSchema = z.object({
  campaignId: z.string().cuid().optional(),
  text: z.string().min(1).max(4000),
  mediaType: giftMediaTypeSchema.optional(),
  telegramFileId: optionalFileId,
  telegramFileUniqueId: z.string().min(1).max(256).optional().or(z.literal('')),
  mediaUrl: optionalHttpsUrl,
  /** @deprecated alias for mediaUrl */
  imageUrl: optionalHttpsUrl,
  buttonText: z.string().min(1).max(64),
  /** Omit / true = show « · N» on channel button (default for existing bots). */
  showClickCounter: z.boolean().optional(),
});

const createCampaignSchema = z.object({
  name: z.string().min(1).max(120).default('Новый проект'),
  /** Copy channel/funnel from this campaign when set */
  cloneFromId: z.string().cuid().optional(),
});

const patchCampaignSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isActive: z.boolean().optional(),
  /** ISO datetime or null to clear */
  scheduledStartAt: z.union([z.string().datetime(), z.null()]).optional(),
  scheduledEndAt: z.union([z.string().datetime(), z.null()]).optional(),
});

function readPromoPost(raw: unknown): GiftPromoPost {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<GiftPromoPost>;
  const mediaUrl = p.mediaUrl || p.imageUrl || undefined;
  const telegramFileId = p.telegramFileId || undefined;
  const mediaType = telegramFileId
    ? detectStoredMediaKind(telegramFileId, normalizeGiftMediaType(p.mediaType))
    : normalizeGiftMediaType(p.mediaType) || 'photo';
  return {
    text: p.text || DEFAULT_GIFT_PROMO.text,
    mediaType,
    telegramFileId,
    telegramFileUniqueId: p.telegramFileUniqueId || undefined,
    mediaUrl,
    buttonText: p.buttonText || DEFAULT_GIFT_PROMO.buttonText,
    clickCount: typeof p.clickCount === 'number' ? p.clickCount : 0,
    showClickCounter: promoShowClickCounter(p),
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
  scheduledStartAt?: Date | null;
  scheduledEndAt?: Date | null;
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
    scheduledStartAt: c.scheduledStartAt ? c.scheduledStartAt.toISOString() : null,
    scheduledEndAt: c.scheduledEndAt ? c.scheduledEndAt.toISOString() : null,
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

type UploadedMediaKind = GiftPromoMediaType;

type TelegramMediaMethod =
  | 'sendPhoto'
  | 'sendVideo'
  | 'sendDocument'
  | 'sendVoice'
  | 'sendVideoNote'
  | 'sendAudio';
type TelegramMediaField = 'photo' | 'video' | 'document' | 'voice' | 'video_note' | 'audio';

function extractTelegramFileIds(message: any): {
  fileId?: string;
  fileUniqueId?: string;
  kind: UploadedMediaKind;
} {
  if (Array.isArray(message?.photo) && message.photo.length > 0) {
    const best = message.photo[message.photo.length - 1];
    return { fileId: best.file_id, fileUniqueId: best.file_unique_id, kind: 'photo' };
  }
  if (message?.video_note) {
    return {
      fileId: message.video_note.file_id,
      fileUniqueId: message.video_note.file_unique_id,
      kind: 'video_note',
    };
  }
  if (message?.voice) {
    return {
      fileId: message.voice.file_id,
      fileUniqueId: message.voice.file_unique_id,
      kind: 'voice',
    };
  }
  if (message?.audio) {
    return {
      fileId: message.audio.file_id,
      fileUniqueId: message.audio.file_unique_id,
      kind: 'audio',
    };
  }
  if (message?.video) {
    return {
      fileId: message.video.file_id,
      fileUniqueId: message.video.file_unique_id,
      kind: 'video',
    };
  }
  if (message?.animation) {
    return {
      fileId: message.animation.file_id,
      fileUniqueId: message.animation.file_unique_id,
      kind: 'video',
    };
  }
  if (message?.document) {
    return {
      fileId: message.document.file_id,
      fileUniqueId: message.document.file_unique_id,
      kind: 'document',
    };
  }
  return { kind: 'document' };
}

async function telegramSendMedia(opts: {
  botApi: string;
  chatId: string | number;
  buffer: Buffer;
  filename: string;
  mimeType: string;
  method: TelegramMediaMethod;
  field: TelegramMediaField;
  timeoutMs: number;
  caption?: string;
  replyMarkup?: unknown;
  /** Staging uploads mute; channel publish should notify (default true for staging). */
  disableNotification?: boolean;
}): Promise<any> {
  const form = new FormData();
  form.append('chat_id', String(opts.chatId));
  if (opts.disableNotification !== false) {
    form.append('disable_notification', 'true');
  }
  if (opts.caption) {
    form.append('caption', opts.caption);
    form.append('parse_mode', 'MarkdownV2');
  }
  if (opts.replyMarkup) {
    form.append('reply_markup', JSON.stringify(opts.replyMarkup));
  }
  const blob = new Blob([new Uint8Array(opts.buffer)], {
    type: opts.mimeType || 'application/octet-stream',
  });
  form.append(opts.field, blob, opts.filename);

  let tgRes: Response;
  try {
    tgRes = await fetch(`${opts.botApi}/${opts.method}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(opts.timeoutMs),
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new Error(
        'Telegram не ответил вовремя. Уменьшите файл (лучше MP4 до 48 МБ) или проверьте staging-чат (личный Telegram / канал).',
      );
    }
    throw err;
  }
  const tgJson = (await tgRes.json()) as any;
  if (!tgJson.ok) {
    throw new Error(tgJson.description || 'Telegram upload failed');
  }
  return tgJson.result;
}

/** Download Bot API file (≤20 МБ). Used to deliver quality-staged documents as photo/video. */
async function downloadTelegramBotFile(
  botApi: string,
  fileId: string,
): Promise<{ buffer: Buffer; filename: string; mimeType: string } | null> {
  const metaRes = await fetch(`${botApi}/getFile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  const meta = (await metaRes.json()) as {
    ok?: boolean;
    result?: { file_path?: string };
  };
  if (!meta.ok || !meta.result?.file_path) return null;
  const filePath = meta.result.file_path;
  const token = botApi.replace(/^https:\/\/api\.telegram\.org\/bot/, '');
  const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileRes.ok) return null;
  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const filename = filePath.split('/').pop() || 'file.bin';
  const lower = filename.toLowerCase();
  let mimeType = fileRes.headers.get('content-type') || 'application/octet-stream';
  if (/\.jpe?g$/i.test(lower)) mimeType = 'image/jpeg';
  else if (/\.png$/i.test(lower)) mimeType = 'image/png';
  else if (/\.webp$/i.test(lower)) mimeType = 'image/webp';
  else if (/\.gif$/i.test(lower)) mimeType = 'image/gif';
  else if (/\.mp4$/i.test(lower)) mimeType = 'video/mp4';
  else if (/\.mov$/i.test(lower)) mimeType = 'video/quicktime';
  else if (/\.webm$/i.test(lower)) mimeType = 'video/webm';
  return { buffer, filename, mimeType };
}

/**
 * Publish photo/video: if file_id is quality-staged document, download → sendPhoto/Video
 * (one Telegram compress at delivery). Fall back to sendDocument if getFile fails (>20 МБ).
 */
async function publishChannelMedia(opts: {
  botApi: string;
  chatId: string | number;
  media: string;
  kind: GiftPromoMediaType;
  caption: string;
  replyMarkup: unknown;
}): Promise<any> {
  const { botApi, chatId, media, kind, caption, replyMarkup } = opts;
  const wantsVisual = kind === 'photo' || kind === 'video';
  if (wantsVisual && isTelegramDocumentFileId(media)) {
    const downloaded = await downloadTelegramBotFile(botApi, media);
    if (downloaded) {
      try {
        const message = await telegramSendMedia({
          botApi,
          chatId,
          buffer: downloaded.buffer,
          filename: downloaded.filename,
          mimeType: downloaded.mimeType,
          method: kind === 'video' ? 'sendVideo' : 'sendPhoto',
          field: kind === 'video' ? 'video' : 'photo',
          timeoutMs: kind === 'video' ? 180_000 : 120_000,
          caption,
          replyMarkup,
          disableNotification: false,
        });
        return { ok: true, result: message };
      } catch {
        /* fall through to sendDocument with original file_id */
      }
    }
    const tgRes = await fetch(`${botApi}/sendDocument`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        document: media,
        caption,
        parse_mode: 'MarkdownV2',
        reply_markup: replyMarkup,
      }),
    });
    return tgRes.json();
  }

  if (kind === 'video') {
    const tgRes = await fetch(`${botApi}/sendVideo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        video: media,
        caption,
        parse_mode: 'MarkdownV2',
        reply_markup: replyMarkup,
      }),
    });
    return tgRes.json();
  }
  if (kind === 'document') {
    const tgRes = await fetch(`${botApi}/sendDocument`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        document: media,
        caption,
        parse_mode: 'MarkdownV2',
        reply_markup: replyMarkup,
      }),
    });
    return tgRes.json();
  }
  if (kind === 'voice') {
    const tgRes = await fetch(`${botApi}/sendVoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        voice: media,
        caption,
        parse_mode: 'MarkdownV2',
        reply_markup: replyMarkup,
      }),
    });
    return tgRes.json();
  }
  if (kind === 'audio') {
    const tgRes = await fetch(`${botApi}/sendAudio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        audio: media,
        caption,
        parse_mode: 'MarkdownV2',
        reply_markup: replyMarkup,
      }),
    });
    return tgRes.json();
  }
  if (kind === 'video_note') {
    const tgRes = await fetch(`${botApi}/sendVideoNote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        video_note: media,
        reply_markup: replyMarkup,
      }),
    });
    return tgRes.json();
  }
  const tgRes = await fetch(`${botApi}/sendPhoto`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      photo: media,
      caption,
      parse_mode: 'MarkdownV2',
      reply_markup: replyMarkup,
    }),
  });
  return tgRes.json();
}

function uploadAttemptsForKind(
  kind: UploadedMediaKind,
  filename: string,
  mimeType: string,
): Array<{ method: TelegramMediaMethod; field: TelegramMediaField }> {
  const isMp4 = /\.mp4$/i.test(filename) || mimeType === 'video/mp4';
  switch (kind) {
    case 'photo':
      // Document first: keep original bytes (sendPhoto irreversibly recompresses).
      return [
        { method: 'sendDocument', field: 'document' },
        { method: 'sendPhoto', field: 'photo' },
      ];
    case 'video_note':
      return [
        { method: 'sendVideoNote', field: 'video_note' },
        { method: 'sendVideo', field: 'video' },
        { method: 'sendDocument', field: 'document' },
      ];
    case 'voice':
      return [
        { method: 'sendVoice', field: 'voice' },
        { method: 'sendDocument', field: 'document' },
      ];
    case 'audio':
      return [
        { method: 'sendAudio', field: 'audio' },
        { method: 'sendDocument', field: 'document' },
      ];
    case 'video':
      // Document first: avoid Telegram sendVideo re-encode at staging.
      return isMp4
        ? [
            { method: 'sendDocument', field: 'document' },
            { method: 'sendVideo', field: 'video' },
          ]
        : [
            { method: 'sendDocument', field: 'document' },
            { method: 'sendVideo', field: 'video' },
          ];
    default:
      return [{ method: 'sendDocument', field: 'document' }];
  }
}

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
  mediaType: GiftPromoMediaType;
  kind: UploadedMediaKind;
}> {
  const attempts = uploadAttemptsForKind(opts.kind, opts.filename, opts.mimeType);
  const timeoutMs =
    opts.kind === 'video' || opts.kind === 'video_note' ? 180_000 : 120_000;
  let lastError: Error | null = null;
  let message: any;

  for (const attempt of attempts) {
    try {
      message = await telegramSendMedia({
        botApi: opts.botApi,
        chatId: opts.chatId,
        buffer: opts.buffer,
        filename: opts.filename,
        mimeType: opts.mimeType,
        method: attempt.method,
        field: attempt.field,
        timeoutMs,
      });
      lastError = null;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (!message) {
    throw lastError || new Error('Telegram upload failed');
  }

  const extracted = extractTelegramFileIds(message);
  if (!extracted.fileId) {
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

  // Trust Telegram's response kind — except quality-preserving photo/video staging
  // via sendDocument (keep requested kind so delivery can download→sendPhoto/Video).
  let resolvedKind = extracted.kind;
  if (
    extracted.kind === 'document' &&
    (opts.kind === 'photo' || opts.kind === 'video')
  ) {
    resolvedKind = opts.kind;
  }

  return {
    fileId: extracted.fileId,
    fileUniqueId: extracted.fileUniqueId,
    mediaType: resolvedKind,
    kind: resolvedKind,
  };
}

function normalizeChannelUsername(raw: string): string {
  const trimmed = raw.trim();
  // Numeric / -100… chat ids (private groups/channels without @username)
  if (/^-?\d+$/.test(trimmed)) return trimmed;
  return trimmed
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

  // --- Mailing add-ons billing (bot / accounts / stories) ---
  fastify.get('/mailing/billing', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;
    const types = [
      PRODUCT_CODES.MAILING_BOT,
      PRODUCT_CODES.MAILING_ACCOUNTS,
      PRODUCT_CODES.MAILING_STORIES,
    ] as const;
    const addons = await prisma.addon.findMany({
      where: { tenantId, type: { in: [...types] } },
    });
    const byType = Object.fromEntries(addons.map((a) => [a.type, a]));
    const { resolveUnitPrice } = await import('../services/platform-pricing.js');
    const [mailingBotPrice, mailingAccountsPrice, mailingStoriesPrice] = await Promise.all([
      resolveUnitPrice(prisma, tenantId, PRODUCT_CODES.MAILING_BOT),
      resolveUnitPrice(prisma, tenantId, PRODUCT_CODES.MAILING_ACCOUNTS),
      resolveUnitPrice(prisma, tenantId, PRODUCT_CODES.MAILING_STORIES),
    ]);
    return reply.send({
      trialDays: TRIAL_PERIOD_DAYS,
      products: {
        mailing_bot: {
          price: mailingBotPrice,
          ...trialMeta(byType.mailing_bot || null),
        },
        mailing_accounts: {
          price: mailingAccountsPrice,
          ...trialMeta(byType.mailing_accounts || null),
        },
        mailing_stories: {
          price: mailingStoriesPrice,
          ...trialMeta(byType.mailing_stories || null),
        },
      },
    });
  });

  fastify.post('/mailing/start-trial', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can start mailing trial' });
    }
    const type = String((request.body as { type?: string })?.type || '');
    if (
      type !== PRODUCT_CODES.MAILING_BOT &&
      type !== PRODUCT_CODES.MAILING_ACCOUNTS &&
      type !== PRODUCT_CODES.MAILING_STORIES
    ) {
      return reply.code(400).send({ error: 'type must be mailing_bot|mailing_accounts|mailing_stories' });
    }
    const result = await startChannelTrial(fastify.prisma, tenantId, type);
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, addon: result.addon });
    }
    return reply.send({
      ok: true,
      isTrial: true,
      days: result.days,
      addon: result.addon,
    });
  });

  // --- Stage-trigger mailing rules (Opportunity stage enter) ---
  fastify.get('/mailing/stage-rules', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const rules = await fastify.prisma.mailingStageRule.findMany({
      where: { tenantId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return reply.send({
      rules,
      stages: VOXLY_OPPORTUNITY_STAGE_OPTIONS.map((s) => ({
        value: s.value,
        label: s.label,
      })),
    });
  });

  fastify.post('/mailing/stage-rules', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can manage stage rules' });
    }
    const body = (request.body || {}) as {
      botId?: string;
      channel?: string;
      name?: string;
      stageValue?: string;
      text?: string;
      mediaUrl?: string;
      mediaType?: string;
      enabled?: boolean;
    };
    const botId = String(body.botId || '').trim();
    const channel = normalizeStageRuleChannel(body.channel);
    const stageValue = String(body.stageValue || '').trim();
    const text = String(body.text || '').trim();
    if (!botId || !stageValue || !text) {
      return reply.code(400).send({ error: 'botId, stageValue, text required' });
    }
    const bot = await fastify.prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: botTypeForStageRuleChannel(channel) },
    });
    if (!bot) return reply.code(404).send({ error: 'Bot not found' });
    const rule = await fastify.prisma.mailingStageRule.create({
      data: {
        tenantId,
        botId,
        channel,
        name: String(body.name || '').slice(0, 120),
        stageValue,
        text: text.slice(0, 4000),
        mediaUrl: String(body.mediaUrl || '').trim() || undefined,
        mediaType:
          body.mediaType === 'photo' || body.mediaType === 'video' ? body.mediaType : undefined,
        enabled: body.enabled !== false,
      },
    });
    return reply.send({ rule });
  });

  fastify.patch(
    '/mailing/stage-rules/:ruleId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can manage stage rules' });
      }
      const { ruleId } = request.params as { ruleId: string };
      const existing = await fastify.prisma.mailingStageRule.findFirst({
        where: { id: ruleId, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Not found' });
      const body = (request.body || {}) as {
        botId?: string;
        channel?: string;
        name?: string;
        stageValue?: string;
        text?: string;
        mediaUrl?: string | null;
        mediaType?: string | null;
        enabled?: boolean;
      };
      const channel =
        body.channel !== undefined ? normalizeStageRuleChannel(body.channel) : existing.channel;
      if (body.botId || body.channel !== undefined) {
        const bot = await fastify.prisma.botInstance.findFirst({
          where: {
            id: body.botId || existing.botId,
            tenantId,
            botType: botTypeForStageRuleChannel(channel as 'gift' | 'gramjs' | 'wa'),
          },
        });
        if (!bot) return reply.code(404).send({ error: 'Bot not found' });
      }
      const rule = await fastify.prisma.mailingStageRule.update({
        where: { id: ruleId },
        data: {
          ...(body.botId ? { botId: body.botId } : {}),
          ...(body.channel !== undefined ? { channel } : {}),
          ...(body.name !== undefined ? { name: String(body.name).slice(0, 120) } : {}),
          ...(body.stageValue ? { stageValue: String(body.stageValue).trim() } : {}),
          ...(body.text !== undefined ? { text: String(body.text).trim().slice(0, 4000) } : {}),
          ...(body.mediaUrl !== undefined
            ? { mediaUrl: body.mediaUrl ? String(body.mediaUrl).trim() : null }
            : {}),
          ...(body.mediaType !== undefined
            ? {
                mediaType:
                  body.mediaType === 'photo' || body.mediaType === 'video'
                    ? body.mediaType
                    : null,
              }
            : {}),
          ...(body.enabled !== undefined ? { enabled: Boolean(body.enabled) } : {}),
        },
      });
      return reply.send({ rule });
    },
  );

  /** Called from Twenty DB event (opportunity.updated) via crm-chat logic. */
  fastify.post('/mailing/stage-rules/fire', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const body = (request.body || {}) as {
      opportunityId?: string;
      stage?: string;
    };
    const opportunityId = String(body.opportunityId || '').trim();
    const stage = String(body.stage || '').trim();
    if (!opportunityId || !stage) {
      return reply.code(400).send({ error: 'opportunityId and stage required' });
    }

    const rules = await fastify.prisma.mailingStageRule.findMany({
      where: { tenantId, enabled: true, stageValue: stage },
    });
    if (!rules.length) {
      return reply.send({ ok: true, fired: 0 });
    }

    let fired = 0;
    let skipped = 0;
    for (const rule of rules) {
      const channel = normalizeStageRuleChannel(rule.channel);
      if (channel !== 'gift') {
        const conversation = await fastify.prisma.conversation.findFirst({
          where: {
            tenantId,
            botInstanceId: rule.botId,
            twentyOpportunityId: opportunityId,
            status: { not: 'closed' },
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (!conversation) {
          skipped += 1;
          continue;
        }
        await fastify.prisma.broadcast.create({
          data: {
            tenantId,
            status: 'scheduled',
            scheduledAt: new Date(),
            totalCount: 1,
            messageJson: {
              channel,
              botId: rule.botId,
              text: rule.text,
              mediaUrl: rule.mediaUrl || undefined,
              mediaType: rule.mediaType || undefined,
              conversationIds: [conversation.id],
              trigger: 'stage',
              stageValue: stage,
              opportunityId,
              stageRuleId: rule.id,
            },
          },
        });
        fired += 1;
        continue;
      }

      const subscriber = await fastify.prisma.giftSubscriber.findFirst({
        where: { tenantId, botInstanceId: rule.botId, twentyOpportunityId: opportunityId },
        orderBy: { updatedAt: 'desc' },
      });
      if (!subscriber) {
        skipped += 1;
        continue;
      }
      const bot = await fastify.prisma.botInstance.findFirst({
        where: { id: rule.botId, tenantId, botType: { in: ['gift', 'gift_max'] } },
        include: { giftCampaigns: { where: { isActive: true }, take: 1 } },
      });
      if (!bot?.giftCampaigns[0]) {
        skipped += 1;
        continue;
      }
      await fastify.prisma.broadcast.create({
        data: {
          tenantId,
          status: 'scheduled',
          scheduledAt: new Date(),
          totalCount: 1,
          messageJson: {
            channel: 'gift',
            botId: rule.botId,
            campaignId: bot.giftCampaigns[0].id,
            segment: 'all',
            text: rule.text,
            mediaUrl: rule.mediaUrl || undefined,
            mediaType: rule.mediaType || undefined,
            subscriberIds: [subscriber.id],
            trigger: 'stage',
            stageValue: stage,
            opportunityId,
            stageRuleId: rule.id,
          },
        },
      });
      fired += 1;
    }
    return reply.send({ ok: true, fired, skipped });
  });

  // --- Start gift bot trial ---
  fastify.post('/gift/start-trial', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can start gift bot trial' });
    }

    const result = await startChannelTrial(fastify.prisma, tenantId, PRODUCT_CODES.GIFT_BOT);
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, addon: result.addon });
    }
    return reply.send({
      addon: {
        id: result.addon.id,
        type: result.addon.type,
        status: result.addon.status,
        activeUntil: result.addon.activeUntil,
        isTrial: true,
      },
      days: result.days,
    });
  });

  // --- Start MAX gift bot trial (separate product) ---
  fastify.post('/gift/max/start-trial', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can start MAX gift bot trial' });
    }
    await grandfatherSplitGiftMaxAddon(fastify.prisma, tenantId);
    const result = await startChannelTrial(fastify.prisma, tenantId, PRODUCT_CODES.GIFT_BOT_MAX);
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, addon: result.addon });
    }
    return reply.send({
      addon: {
        id: result.addon.id,
        type: result.addon.type,
        status: result.addon.status,
        activeUntil: result.addon.activeUntil,
        isTrial: true,
      },
      days: result.days,
    });
  });

  // --- Connect MAX gift bot by platform token (official Bot API) ---
  fastify.post('/gift/max/connect', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can connect MAX gift bots' });
    }

    const parsed = z
      .object({
        token: z.string().min(20).max(500),
        name: z.string().min(1).max(80).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const prisma = fastify.prisma;
    await grandfatherSplitGiftMaxAddon(prisma, tenantId);
    const addonRaw = await prisma.addon.findUnique({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT_MAX } },
    });
    if (!addonRaw || addonRaw.status !== 'active' || addonRaw.activeUntil < new Date()) {
      return reply.code(402).send({
        error: 'Сначала активируйте пробный период или оплатите бота подарков MAX',
        productCode: PRODUCT_CODES.GIFT_BOT_MAX,
      });
    }
    const { addon, slots, used } = await ensureGiftBotSlots(
      prisma,
      tenantId,
      addonRaw,
      'gift_max',
    );
    if (!addon) {
      return reply.code(402).send({
        error: 'Сначала активируйте пробный период или оплатите бота подарков MAX',
        productCode: PRODUCT_CODES.GIFT_BOT_MAX,
      });
    }

    const token = parsed.data.token.trim();
    const maxBase = (process.env.MAX_BOT_API_URL || 'https://platform-api2.max.ru').replace(
      /\/$/,
      '',
    );
    const meRes = await fetch(`${maxBase}/me`, {
      headers: { Authorization: token, Accept: 'application/json' },
    });
    const meJson = (await meRes.json().catch(() => ({}))) as {
      user_id?: number;
      name?: string;
      username?: string;
      is_bot?: boolean;
      message?: string;
    };
    if (!meRes.ok || !meJson.user_id) {
      return reply.code(400).send({
        error: 'Неверный токен MAX-бота',
        hint: meJson.message || 'Проверьте токен в кабинете MAX для бизнеса',
      });
    }

    const username = (meJson.username || parsed.data.name || `max_${meJson.user_id}`)
      .replace(/^@/, '')
      .trim();
    const displayName = parsed.data.name || meJson.name || username;

    const existingSame = await prisma.botInstance.findFirst({
      where: {
        botType: 'gift_max',
        OR: [{ phoneNumberId: String(meJson.user_id) }, { botUsername: username }],
      },
    });
    if (existingSame && existingSame.tenantId !== tenantId) {
      return reply.code(409).send({ error: 'Этот MAX-бот уже подключён к другому кабинету' });
    }
    if (!existingSame && used >= slots) {
      return reply.code(402).send({
        error: `Лимит MAX-ботов: ${used}/${slots}. Купите ещё слот (500 ₽/мес).`,
        productCode: PRODUCT_CODES.GIFT_BOT_MAX,
        botSlots: slots,
        used,
        intent: 'add',
      });
    }

    const webhookSecret = existingSame?.webhookSecret || randomBytes(16).toString('hex');
    const botData = {
      botUsername: username,
      displayName,
      botTokenEncrypted: encrypt(token),
      phoneNumberId: String(meJson.user_id),
      webhookSecret,
      provisionedVia: 'manual' as const,
      botType: 'gift_max',
      status: 'active',
      addonId: addon.id,
    };

    const bot = existingSame
      ? await prisma.botInstance.update({ where: { id: existingSame.id }, data: botData })
      : await prisma.botInstance.create({
          data: { tenantId, ...botData },
        });

    await invalidateBotsCache(tenantId);

    // Ensure default campaign shell (channel optional for MAX — gap documented)
    const campaignCount = await prisma.giftCampaignConfig.count({
      where: { botInstanceId: bot.id },
    });
    if (campaignCount === 0) {
      await prisma.giftCampaignConfig.create({
        data: {
          tenantId,
          botInstanceId: bot.id,
          name: 'Проект MAX',
          channelId: 'pending',
          funnelJson: DEFAULT_GIFT_FUNNEL as object,
          isActive: true,
        },
      });
    }

    // Prod webhook subscription (HTTPS). Local: long-poll via GIFT_MAX_USE_POLLING.
    const webhookBase =
      process.env.GIFT_BOT_WEBHOOK_BASE_URL ||
      process.env.BOT_WEBHOOK_BASE_URL ||
      '';
    let webhook: { ok: boolean; detail?: string } | null = null;
    if (webhookBase.startsWith('https://')) {
      const url = `${webhookBase.replace(/\/$/, '')}/max/${tenantId}/${bot.id}`;
      const subRes = await fetch(`${maxBase}/subscriptions`, {
        method: 'POST',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          secret: webhookSecret,
          update_types: ['message_created', 'bot_started', 'message_callback'],
        }),
      });
      const subJson = (await subRes.json().catch(() => ({}))) as {
        success?: boolean;
        message?: string;
      };
      webhook = {
        ok: subRes.ok && subJson.success !== false,
        detail: subJson.message || (subRes.ok ? url : `HTTP ${subRes.status}`),
      };
    }

    return reply.send({
      ok: true,
      bot: {
        id: bot.id,
        botUsername: bot.botUsername,
        displayName: bot.displayName,
        botType: bot.botType,
        status: bot.status,
      },
      webhook,
      hint: webhookBase.startsWith('https://')
        ? undefined
        : 'Локально включите GIFT_MAX_USE_POLLING=true у gift-bot-worker (webhook только HTTPS).',
    });
  });

  // --- Start AI Telegram Business bot trial (TRIAL_PERIOD_DAYS) ---
  fastify.post('/ai/start-trial', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can start AI bot trial' });
    }

    const result = await startChannelTrial(fastify.prisma, tenantId, PRODUCT_CODES.AI_TELEGRAM, {
      maxBusinessConnections: PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS,
    });
    if (!result.ok) {
      return reply.code(result.code).send({ error: result.error, addon: result.addon });
    }
    return reply.send({
      addon: {
        id: result.addon.id,
        type: result.addon.type,
        status: result.addon.status,
        activeUntil: result.addon.activeUntil,
        isTrial: true,
      },
      days: result.days,
    });
  });

  // --- Connect AI Telegram Business bot by BotFather token (manual) ---
  fastify.post('/ai/connect', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can connect AI bots' });
    }

    const parsed = z
      .object({
        token: z.string().min(20).max(200),
        username: z.string().min(3).max(64).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const prisma = fastify.prisma;
    const addon = await prisma.addon.findUnique({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_TELEGRAM } },
    });
    if (!addon || addon.status !== 'active' || addon.activeUntil < new Date()) {
      return reply.code(402).send({
        error: 'Сначала активируйте пробный период или оплатите AI-бота (Автоматизация чатов)',
      });
    }

    const token = parsed.data.token.trim();
    const meRes = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meJson = (await meRes.json()) as {
      ok?: boolean;
      description?: string;
      result?: {
        id: number;
        is_bot?: boolean;
        username?: string;
        first_name?: string;
        can_connect_to_business?: boolean;
      };
    };
    if (!meJson.ok || !meJson.result?.is_bot) {
      return reply.code(400).send({
        error: 'Неверный токен бота',
        hint: meJson.description || 'Проверьте токен из @BotFather → /token',
      });
    }

    const tgUser = meJson.result;
    const username = (tgUser.username || parsed.data.username || '')
      .replace(/^@/, '')
      .trim();
    if (!username) {
      return reply.code(400).send({
        error: 'У бота нет @username',
        hint: 'Задайте username в @BotFather и повторите',
      });
    }
    if (parsed.data.username) {
      const want = parsed.data.username.replace(/^@/, '').trim().toLowerCase();
      if (want && want !== username.toLowerCase()) {
        return reply.code(400).send({
          error: `Токен принадлежит @${username}, а не @${want}`,
        });
      }
    }

    const existingSame = await prisma.botInstance.findFirst({
      where: {
        OR: [
          { managedBotUserId: BigInt(tgUser.id) },
          { botUsername: username, botType: 'ai_tg' },
        ],
      },
    });
    if (existingSame && existingSame.tenantId !== tenantId) {
      return reply.code(409).send({
        error: 'Этот бот уже подключён к другому кабинету',
      });
    }

    const botData = {
      botUsername: username,
      displayName: tgUser.first_name || username,
      botTokenEncrypted: encrypt(token),
      managedBotUserId: BigInt(tgUser.id),
      provisionedVia: 'manual' as const,
      botType: 'ai_tg',
      status: 'active',
      addonId: addon.id,
    };

    const bot = existingSame
      ? await prisma.botInstance.update({
          where: { id: existingSame.id },
          data: botData,
        })
      : await prisma.botInstance.create({
          data: { tenantId, ...botData },
        });

    await invalidateBotsCache(tenantId);

    const webhook = await registerAiTgWebhook(token, tenantId, bot.id);
    if (webhook.secret) {
      await prisma.botInstance.update({
        where: { id: bot.id },
        data: { webhookSecret: webhook.secret },
      });
    }

    const businessWarning = tgUser.can_connect_to_business
      ? null
      : 'В @BotFather включите Business Mode (Режим секретаря) для этого бота — иначе Telegram не даст подключить его в «Автоматизация чатов».';

    return reply.send({
      ok: true,
      bot: {
        id: bot.id,
        botUsername: username,
        botType: 'ai_tg',
        status: bot.status,
        canConnectToBusiness: Boolean(tgUser.can_connect_to_business),
      },
      webhookOk: webhook.ok,
      webhookError: webhook.error,
      businessWarning,
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

    // Legacy clients may still POST botType=ai_tg — reject before zod enum if raw body has it
    if ((request.body as { botType?: string })?.botType === 'ai_tg') {
      return reply.code(400).send({
        error: 'AI Telegram Business подключается вручную: токен из @BotFather',
        hint: 'Откройте /dashboard/ai и вставьте username + token',
      });
    }

    if (botType === 'gift') {
      const addon = await prisma.addon.findUnique({
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT } },
      });
      if (!addon || addon.status !== 'active' || addon.activeUntil < new Date()) {
        return reply.code(402).send({
          error: 'Сначала активируйте пробный период или оплатите gift-бота',
          productCode: PRODUCT_CODES.GIFT_BOT,
        });
      }
      const { slots, used } = await ensureGiftBotSlots(prisma, tenantId, addon, 'gift');
      const usedWithPending = await countGiftBotsUsed(prisma, tenantId, 'gift', {
        includePendingProvision: true,
      });
      if (usedWithPending >= slots) {
        return reply.code(402).send({
          error: `Лимит Telegram-ботов: ${used}/${slots}. Купите ещё слот (500 ₽/мес).`,
          productCode: PRODUCT_CODES.GIFT_BOT,
          botSlots: slots,
          used,
          intent: 'add',
        });
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

    const defaultName =
      botType === 'ai_wa' ? 'Voxly WhatsApp' : 'Voxly Gift Bot';

    const provisionReq = await prisma.botProvisionRequest.create({
      data: {
        tenantId,
        nonce,
        suggestedUsername: username,
        suggestedName: suggestedName || defaultName,
        botType,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });

    const params = new URLSearchParams();
    params.set('name', suggestedName || provisionReq.suggestedName || defaultName);

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

    const cacheKey = `bots:counts:${tenantId}`;
    let cached = null;
    try {
      const cachedRaw = await botsCacheRedis.get(cacheKey);
      if (cachedRaw) {
        cached = JSON.parse(cachedRaw);
      }
    } catch {
      // ignore cache errors
    }

    let subCounts, giftedCounts, conversationCounts, businessAccountGroups, businessConnGroups;
    
    // Declare Maps outside if/else so they're accessible later
    const subscribersByBot = new Map<string, number>();
    const giftedByBot = new Map<string, number>();
    const conversationsByBot = new Map<string, number>();
    const businessConnectionsByBot = new Map<string, number>();

    if (cached) {
      subCounts = cached.subCounts;
      giftedCounts = cached.giftedCounts;
      conversationCounts = cached.conversationCounts;
      businessAccountGroups = cached.businessAccountGroups;
      businessConnGroups = cached.businessConnGroups;
    } else {
      [subCounts, giftedCounts, conversationCounts, businessAccountGroups, businessConnGroups] = await Promise.all([
        prisma.giftSubscriber.groupBy({
          by: ['botInstanceId'],
          where: { tenantId },
          _count: { _all: true },
        }),
        prisma.giftSubscriber.groupBy({
          by: ['botInstanceId'],
          where: { tenantId, giftDelivered: true },
          _count: { _all: true },
        }),
        prisma.conversation.groupBy({
          by: ['botInstanceId'],
          where: { tenantId, botInstanceId: { not: null } },
          _count: { _all: true },
        }),
        // Preferred: registry rows from business_connection updates
        prisma.conversation.groupBy({
          by: ['botInstanceId'],
          where: {
            tenantId,
            botInstanceId: { not: null },
            channel: 'telegram_business_account',
            status: { not: 'closed' },
          },
          _count: { _all: true },
        }),
        // Fallback: distinct connection ids on customer dialogs (pre-registry)
        prisma.conversation.groupBy({
          by: ['botInstanceId', 'businessConnectionId'],
          where: {
            tenantId,
            botInstanceId: { not: null },
            businessConnectionId: { not: null },
            status: { not: 'closed' },
            channel: { not: 'telegram_business_account' },
          },
          _count: { _all: true },
        }),
      ]);

      try {
        await botsCacheRedis.set(cacheKey, JSON.stringify({
          subCounts,
          giftedCounts,
          conversationCounts,
          businessAccountGroups,
          businessConnGroups,
        }), 'EX', BOTS_COUNTS_CACHE_TTL_SEC);
      } catch {
        // ignore cache write errors
      }
    }

    // Populate Maps from counts (works for both cached and fresh data)
    for (const row of subCounts) {
      if (row.botInstanceId) subscribersByBot.set(row.botInstanceId, row._count._all);
    }
    for (const row of giftedCounts) {
      if (row.botInstanceId) giftedByBot.set(row.botInstanceId, row._count._all);
    }
    for (const row of conversationCounts) {
      if (row.botInstanceId) conversationsByBot.set(row.botInstanceId, row._count._all);
    }
    for (const row of businessAccountGroups) {
      if (row.botInstanceId) businessConnectionsByBot.set(row.botInstanceId, row._count._all);
    }
    for (const row of businessConnGroups) {
      if (!row.botInstanceId) continue;
      if (businessConnectionsByBot.has(row.botInstanceId)) continue;
      businessConnectionsByBot.set(
        row.botInstanceId,
        (businessConnectionsByBot.get(row.botInstanceId) || 0) + 1,
      );
    }

    const [bots, addon, aiAddon, gramjsAddon, waAddon, user] = await Promise.all([
      prisma.botInstance.findMany({
        where: { tenantId },
        include: { giftCampaigns: { orderBy: { updatedAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.addon.findUnique({
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT } },
      }),
      prisma.addon.findUnique({
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_TELEGRAM } },
      }),
      prisma.addon.findUnique({
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_GRAMJS } },
      }),
      prisma.addon.findUnique({
        where: { tenantId_type: { tenantId, type: PRODUCT_CODES.AI_WHATSAPP } },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { telegramUserId: true },
      }),
    ]);

    await grandfatherSplitGiftMaxAddon(prisma, tenantId);
    const giftMaxAddonRow = await prisma.addon.findUnique({
      where: { tenantId_type: { tenantId, type: PRODUCT_CODES.GIFT_BOT_MAX } },
    });
    const giftSlotsState = await ensureGiftBotSlots(prisma, tenantId, addon, 'gift');
    const giftMaxSlotsState = await ensureGiftBotSlots(
      prisma,
      tenantId,
      giftMaxAddonRow,
      'gift_max',
    );
    const giftAddonResolved = giftSlotsState.addon;
    const giftMaxAddonResolved = giftMaxSlotsState.addon;

    const serializeAddon = (a: typeof addon | typeof giftMaxAddonRow) => {
      const meta = trialMeta(a);
      if (!a) return null;
      return {
        id: a.id,
        status: a.status,
        activeUntil: a.activeUntil,
        isTrial: meta.isTrial,
        isActive: meta.isActive,
        trialAvailable: meta.trialAvailable,
      };
    };

    const { resolveUnitPrice } = await import('../services/platform-pricing.js');
    const [
      giftBotPriceMonthly,
      giftMaxBotPriceMonthly,
      aiBotPriceMonthly,
      gramjsPriceMonthly,
      waPriceMonthly,
    ] = await Promise.all([
      resolveUnitPrice(prisma, tenantId, PRODUCT_CODES.GIFT_BOT),
      resolveUnitPrice(prisma, tenantId, PRODUCT_CODES.GIFT_BOT_MAX),
      resolveUnitPrice(prisma, tenantId, PRODUCT_CODES.AI_TELEGRAM),
      resolveUnitPrice(prisma, tenantId, PRODUCT_CODES.AI_GRAMJS),
      resolveUnitPrice(prisma, tenantId, PRODUCT_CODES.AI_WHATSAPP),
    ]);

    return reply.send({
      telegramLinked: Boolean(user?.telegramUserId),
      managerBot: `@${process.env.TELEGRAM_MANAGER_BOT_USERNAME || 'VoxlyGiftbot'}`,
      giftBotPriceMonthly,
      giftBotSlots: giftSlotsState.slots,
      giftBotsUsed: giftSlotsState.used,
      giftMaxBotPriceMonthly,
      giftMaxBotSlots: giftMaxSlotsState.slots,
      giftMaxBotsUsed: giftMaxSlotsState.used,
      aiBotPriceMonthly,
      gramjsPriceMonthly,
      waPriceMonthly,
      maxBusinessConnections: PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS,
      giftAddon: serializeAddon(giftAddonResolved),
      giftMaxAddon: serializeAddon(giftMaxAddonResolved),
      aiAddon: serializeAddon(aiAddon),
      gramjsAddon: serializeAddon(gramjsAddon),
      waAddon: serializeAddon(waAddon),
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
          displayName: b.displayName,
          botType: b.botType,
          provisionedVia: b.provisionedVia,
          status: b.status,
          createdAt: b.createdAt,
          defaultAiAgentId: b.defaultAiAgentId,
          telegramDescription: b.telegramDescription ?? null,
          telegramShortDescription: b.telegramShortDescription ?? null,
          hasGiftCampaign: campaigns.length > 0,
          subscriberCount: subscribersByBot.get(b.id) ?? 0,
          giftedCount: giftedByBot.get(b.id) ?? 0,
          conversationCount: conversationsByBot.get(b.id) ?? 0,
          businessConnectionCount: businessConnectionsByBot.get(b.id) ?? 0,
          campaigns: campaigns.map(serializeCampaign),
          /** Active/newest project (compat for older UI) */
          campaign: campaign ? serializeCampaign(campaign) : null,
          botLink: b.botUsername
            ? b.botType === 'gift_max'
              ? `max://bot/${b.botUsername}`
              : `https://t.me/${b.botUsername}`
            : null,
        };
        }),
      ),
      defaultFunnel: DEFAULT_GIFT_FUNNEL,
    });
  });

  // --- Telegram bot greeting / profile (pre-/start screen: name, photo, description) ---
  const telegramProfileSchema = z.object({
    name: z.string().max(64).optional(),
    description: z.string().max(512),
    shortDescription: z.string().max(120).optional().nullable(),
  });

  async function loadGiftBotForProfile(opts: {
    prisma: typeof fastify.prisma;
    botId: string;
    tenantId: string;
  }) {
    return opts.prisma.botInstance.findFirst({
      where: { id: opts.botId, tenantId: opts.tenantId, botType: 'gift' },
    });
  }

  async function fetchTelegramProfilePhotoFilePath(
    botApi: string,
    botUserId: number,
  ): Promise<string | null> {
    const photosRes = await fetch(`${botApi}/getUserProfilePhotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: botUserId, limit: 1 }),
    });
    const photosJson = (await photosRes.json()) as {
      ok?: boolean;
      result?: { total_count?: number; photos?: Array<Array<{ file_id: string }>> };
      description?: string;
    };
    const fileId = photosJson.result?.photos?.[0]?.[0]?.file_id;
    if (!photosJson.ok || !fileId) return null;
    const fileRes = await fetch(`${botApi}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    const fileJson = (await fileRes.json()) as {
      ok?: boolean;
      result?: { file_path?: string };
    };
    return fileJson.ok && fileJson.result?.file_path ? fileJson.result.file_path : null;
  }

  fastify.get(
    '/:botId/telegram-profile',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId } = request.params as { botId: string };
      const prisma = fastify.prisma;
      const bot = await loadGiftBotForProfile({ prisma, botId, tenantId });
      if (!bot?.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Bot not found or token missing' });
      }

      const token = decrypt(bot.botTokenEncrypted);
      const botApi = `https://api.telegram.org/bot${token}`;
      const [meRes, nameRes, descRes, shortRes] = await Promise.all([
        fetch(`${botApi}/getMe`),
        fetch(`${botApi}/getMyName`),
        fetch(`${botApi}/getMyDescription`),
        fetch(`${botApi}/getMyShortDescription`),
      ]);
      const meJson = (await meRes.json()) as {
        ok?: boolean;
        result?: { id?: number; first_name?: string; username?: string };
      };
      const nameJson = (await nameRes.json()) as {
        ok?: boolean;
        result?: { name?: string };
      };
      const descJson = (await descRes.json()) as {
        ok?: boolean;
        result?: { description?: string };
      };
      const shortJson = (await shortRes.json()) as {
        ok?: boolean;
        result?: { short_description?: string };
      };

      const name =
        (nameJson.ok && nameJson.result?.name?.trim()) ||
        bot.displayName ||
        meJson.result?.first_name ||
        '';
      const description =
        (descJson.ok && descJson.result?.description) || bot.telegramDescription || '';
      const shortDescription =
        (shortJson.ok && shortJson.result?.short_description) ||
        bot.telegramShortDescription ||
        '';

      let hasProfilePhoto = false;
      if (meJson.result?.id != null) {
        const path = await fetchTelegramProfilePhotoFilePath(botApi, meJson.result.id);
        hasProfilePhoto = Boolean(path);
      }

      if (
        name !== (bot.displayName || '') ||
        description !== (bot.telegramDescription || '') ||
        shortDescription !== (bot.telegramShortDescription || '')
      ) {
        await prisma.botInstance.update({
          where: { id: botId },
          data: {
            displayName: name || null,
            telegramDescription: description || null,
            telegramShortDescription: shortDescription || null,
          },
        });
      }

      return reply.send({
        name,
        description,
        shortDescription,
        username: bot.botUsername || meJson.result?.username || null,
        hasProfilePhoto,
        avatarUrl: hasProfilePhoto
          ? `/api/bots/${encodeURIComponent(botId)}/telegram-profile/avatar`
          : null,
      });
    },
  );

  fastify.put(
    '/:botId/telegram-profile',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId } = request.params as { botId: string };
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can edit bot profile' });
      }
      const parsed = telegramProfileSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const prisma = fastify.prisma;
      const bot = await loadGiftBotForProfile({ prisma, botId, tenantId });
      if (!bot?.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Bot not found or token missing' });
      }

      const token = decrypt(bot.botTokenEncrypted);
      const botApi = `https://api.telegram.org/bot${token}`;
      const description = parsed.data.description.trim();
      const shortDescription =
        typeof parsed.data.shortDescription === 'string'
          ? parsed.data.shortDescription.trim()
          : description.slice(0, 120);
      const name =
        typeof parsed.data.name === 'string' ? parsed.data.name.trim().slice(0, 64) : undefined;

      if (name !== undefined) {
        const nameRes = await fetch(`${botApi}/setMyName`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const nameJson = (await nameRes.json()) as { ok?: boolean; description?: string };
        if (!nameJson.ok) {
          return reply.code(400).send({
            error: nameJson.description || 'Не удалось сохранить название бота в Telegram',
          });
        }
      }

      const descRes = await fetch(`${botApi}/setMyDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      });
      const descJson = (await descRes.json()) as { ok?: boolean; description?: string };
      if (!descJson.ok) {
        return reply.code(400).send({
          error: descJson.description || 'Не удалось сохранить описание бота в Telegram',
        });
      }

      const shortRes = await fetch(`${botApi}/setMyShortDescription`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ short_description: shortDescription }),
      });
      const shortJson = (await shortRes.json()) as { ok?: boolean; description?: string };
      if (!shortJson.ok) {
        return reply.code(400).send({
          error: shortJson.description || 'Не удалось сохранить короткое описание',
        });
      }

      const updated = await prisma.botInstance.update({
        where: { id: botId },
        data: {
          ...(name !== undefined ? { displayName: name || null } : {}),
          telegramDescription: description || null,
          telegramShortDescription: shortDescription || null,
        },
      });
      await invalidateBotsCache(tenantId);

      return reply.send({
        ok: true,
        name: updated.displayName,
        displayName: updated.displayName,
        telegramDescription: updated.telegramDescription,
        telegramShortDescription: updated.telegramShortDescription,
      });
    },
  );

  fastify.patch(
    '/:botId/flood-settings',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId } = request.params as { botId: string };
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can edit flood settings' });
      }
      const body = (request.body ?? {}) as {
        dailySendLimit?: number | string | null;
        dailyStoryLimit?: number | string | null;
      };
      const prisma = fastify.prisma;
      const bot = await prisma.botInstance.findFirst({ where: { id: botId, tenantId } });
      if (!bot) return reply.code(404).send({ error: 'Bot not found' });

      const clamp = (v: number | string | null | undefined, max: number): number | null => {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n) return NaN;
        return Math.min(n, max);
      };

      const data: Record<string, number | null> = {};
      if ('dailySendLimit' in body) {
        const v = clamp(body.dailySendLimit, 5000);
        if (Number.isNaN(v)) {
          return reply.code(400).send({ error: 'dailySendLimit должен быть целым числом ≥ 0' });
        }
        data.dailySendLimit = v;
      }
      if ('dailyStoryLimit' in body) {
        const v = clamp(body.dailyStoryLimit, 1000);
        if (Number.isNaN(v)) {
          return reply.code(400).send({ error: 'dailyStoryLimit должен быть целым числом ≥ 0' });
        }
        data.dailyStoryLimit = v;
      }
      if (Object.keys(data).length === 0) {
        return reply.code(400).send({ error: 'Укажите dailySendLimit и/или dailyStoryLimit' });
      }
      const updated = await prisma.botInstance.update({ where: { id: bot.id }, data });
      await invalidateBotsCache(tenantId);
      return reply.send({
        ok: true,
        dailySendLimit: updated.dailySendLimit,
        dailyStoryLimit: updated.dailyStoryLimit,
      });
    },
  );

  fastify.post(
    '/:botId/telegram-profile/photo',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId } = request.params as { botId: string };
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can edit bot profile' });
      }

      const file = await request.file();
      if (!file) {
        return reply.code(400).send({ error: 'Прикрепите JPG или PNG (поле file)' });
      }

      const prisma = fastify.prisma;
      const bot = await loadGiftBotForProfile({ prisma, botId, tenantId });
      if (!bot?.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Bot not found or token missing' });
      }

      let buffer: Buffer;
      try {
        buffer = await file.toBuffer();
      } catch {
        return reply.code(400).send({ error: 'Не удалось прочитать файл' });
      }
      if (!buffer.length) {
        return reply.code(400).send({ error: 'Пустой файл' });
      }
      if (buffer.length > 5 * 1024 * 1024) {
        return reply.code(413).send({ error: 'Фото профиля до 5 МБ' });
      }

      // Telegram setMyProfilePhoto (static) = JPG only. Portal converts PNG→JPG client-side.
      if (!(buffer[0] === 0xff && buffer[1] === 0xd8)) {
        return reply.code(400).send({
          error:
            'Нужен JPG или PNG. PNG конвертируется в кабинете автоматически — обновите страницу (hard-refresh) и повторите.',
        });
      }

      const token = decrypt(bot.botTokenEncrypted);
      const botApi = `https://api.telegram.org/bot${token}`;
      const form = new FormData();
      form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://avatar' }));
      form.append(
        'avatar',
        new Blob([new Uint8Array(buffer)], { type: 'image/jpeg' }),
        'avatar.jpg',
      );

      const tgRes = await fetch(`${botApi}/setMyProfilePhoto`, {
        method: 'POST',
        body: form,
      });
      const tgJson = (await tgRes.json()) as { ok?: boolean; description?: string };
      if (!tgJson.ok) {
        return reply.code(400).send({
          error:
            tgJson.description ||
            'Не удалось установить фото. Telegram меняет фото профиля не чаще раза в сутки.',
        });
      }

      return reply.send({
        ok: true,
        avatarUrl: `/api/bots/${encodeURIComponent(botId)}/telegram-profile/avatar?t=${Date.now()}`,
      });
    },
  );

  fastify.delete(
    '/:botId/telegram-profile/photo',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId } = request.params as { botId: string };
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can edit bot profile' });
      }
      const prisma = fastify.prisma;
      const bot = await loadGiftBotForProfile({ prisma, botId, tenantId });
      if (!bot?.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Bot not found or token missing' });
      }
      const token = decrypt(bot.botTokenEncrypted);
      const botApi = `https://api.telegram.org/bot${token}`;
      const tgRes = await fetch(`${botApi}/removeMyProfilePhoto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const tgJson = (await tgRes.json()) as { ok?: boolean; description?: string };
      if (!tgJson.ok) {
        return reply.code(400).send({
          error: tgJson.description || 'Не удалось удалить фото профиля',
        });
      }
      return reply.send({ ok: true });
    },
  );

  fastify.get(
    '/:botId/telegram-profile/avatar',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId } = request.params as { botId: string };
      const prisma = fastify.prisma;
      const bot = await loadGiftBotForProfile({ prisma, botId, tenantId });
      if (!bot?.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Bot not found or token missing' });
      }
      const token = decrypt(bot.botTokenEncrypted);
      const botApi = `https://api.telegram.org/bot${token}`;
      const meRes = await fetch(`${botApi}/getMe`);
      const meJson = (await meRes.json()) as {
        ok?: boolean;
        result?: { id?: number };
      };
      if (!meJson.ok || meJson.result?.id == null) {
        return reply.code(404).send({ error: 'Не удалось получить профиль бота' });
      }
      const filePath = await fetchTelegramProfilePhotoFilePath(botApi, meJson.result.id);
      if (!filePath) {
        return reply.code(404).send({ error: 'Фото профиля не установлено' });
      }
      const fileUrl = `https://api.telegram.org/file/bot${token}/${filePath}`;
      const imgRes = await fetch(fileUrl);
      if (!imgRes.ok) {
        return reply.code(502).send({ error: 'Не удалось скачать фото из Telegram' });
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'private, max-age=120')
        .send(buf);
    },
  );

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
      where: { id: botId, tenantId, botType: { in: ['gift', 'gift_max'] } },
      include: { giftCampaigns: { orderBy: { updatedAt: 'desc' } } },
    });
    if (!bot) return reply.code(404).send({ error: 'Bot not found' });

    const channelUsername = normalizeChannelUsername(parsed.data.channelUsername);
    const funnel = sanitizeFunnel(parsed.data.funnel);
    const giftFileUrl = parsed.data.giftFileUrl || funnel.gift.url;
    const channelId =
      parsed.data.channelId
      || (/^-?\d+$/.test(channelUsername) ? channelUsername : `@${channelUsername}`);
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
      where: { id: botId, tenantId, botType: { in: ['gift', 'gift_max'] } },
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
      if (
        parsed.data.name === undefined &&
        parsed.data.isActive === undefined &&
        parsed.data.scheduledStartAt === undefined &&
        parsed.data.scheduledEndAt === undefined
      ) {
        return reply.code(400).send({
          error: 'Укажите name, isActive и/или расписание (scheduledStartAt / scheduledEndAt)',
        });
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
          ...(parsed.data.scheduledStartAt !== undefined
            ? {
                scheduledStartAt:
                  parsed.data.scheduledStartAt === null
                    ? null
                    : new Date(parsed.data.scheduledStartAt),
              }
            : {}),
          ...(parsed.data.scheduledEndAt !== undefined
            ? {
                scheduledEndAt:
                  parsed.data.scheduledEndAt === null
                    ? null
                    : new Date(parsed.data.scheduledEndAt),
              }
            : {}),
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
      where: { id: botId, tenantId, botType: { in: ['gift', 'gift_max'] } },
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
      mediaType: telegramFileId
        ? detectStoredMediaKind(telegramFileId, normalizeGiftMediaType(parsed.data.mediaType))
        : normalizeGiftMediaType(parsed.data.mediaType) || 'photo',
      telegramFileId,
      telegramFileUniqueId:
        cleanOptional(parsed.data.telegramFileUniqueId) ||
        (telegramFileId ? prev.telegramFileUniqueId : undefined),
      mediaUrl: telegramFileId ? undefined : mediaUrl,
      buttonText: parsed.data.buttonText,
      showClickCounter:
        typeof parsed.data.showClickCounter === 'boolean'
          ? parsed.data.showClickCounter
          : promoShowClickCounter(prev),
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
    const fields = file.fields as Record<string, { value?: string } | undefined> | undefined;
    const fieldCampaign = fields?.campaignId?.value;
    const campaignIdField = queryCampaignId || fieldCampaign;
    const asVideoNote =
      fields?.asVideoNote?.value === '1' ||
      fields?.asVideoNote?.value === 'true' ||
      (request.query as { asVideoNote?: string } | undefined)?.asVideoNote === '1';

    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId, botType: { in: ['gift', 'gift_max'] }, status: 'active' },
      include: { giftCampaigns: { orderBy: { updatedAt: 'desc' } } },
    });
    if (!bot?.botTokenEncrypted) {
      return reply.code(404).send({ error: 'Bot not found' });
    }
    if (bot.botType === 'gift_max') {
      return reply.code(400).send({
        error:
          'Загрузка медиа для MAX gift-бота через этот endpoint пока не поддерживается (нужен MAX uploads API).',
      });
    }

    let buffer: Buffer;
    try {
      buffer = await file.toBuffer();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      const msg = err instanceof Error ? err.message : String(err);
      if (code === 'FST_REQ_FILE_TOO_LARGE' || /file too large|maxFileSize/i.test(msg)) {
        return reply.code(413).send({ error: 'Файл слишком большой. Лимит загрузки — 48 МБ.' });
      }
      if (code === 'ERR_STREAM_PREMATURE_CLOSE' || /Premature close/i.test(msg)) {
        return reply.code(400).send({
          error:
            'Загрузка оборвалась (сеть или прокси). Повторите: лучше MP4 до 48 МБ, стабильный интернет.',
        });
      }
      request.log.warn({ err }, 'media upload buffer failed');
      return reply.code(400).send({ error: 'Не удалось прочитать файл' });
    }
    if (!buffer.length) {
      return reply.code(400).send({ error: 'Пустой файл' });
    }

    const filename = file.filename || 'upload.bin';
    const mimeType = file.mimetype || 'application/octet-stream';
    const kind = detectUploadMediaKind(mimeType, filename, { asVideoNote });

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

  // --- Proxy staged Telegram file for portal preview (auth + tenant-scoped) ---
  fastify.get(
    '/:botId/media-file',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId } = request.params as { botId: string };
      const fileId = String((request.query as { fileId?: string })?.fileId || '').trim();
      if (!fileId || fileId.length < 8 || fileId.length > 512) {
        return reply.code(400).send({ error: 'Invalid file id' });
      }

      const prisma = fastify.prisma;
      const bot = await prisma.botInstance.findFirst({
        where: { id: botId, tenantId, botType: { in: ['gift', 'gift_max'] } },
        select: { botTokenEncrypted: true, botType: true },
      });
      if (!bot?.botTokenEncrypted) {
        return reply.code(404).send({ error: 'Bot not found or token missing' });
      }
      if (bot.botType === 'gift_max') {
        return reply.code(400).send({ error: 'Превью медиа для MAX пока не поддерживается' });
      }

      const token = decrypt(bot.botTokenEncrypted);
      const botApi = `https://api.telegram.org/bot${token}`;
      const metaRes = await fetch(`${botApi}/getFile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
      });
      const meta = (await metaRes.json()) as {
        ok?: boolean;
        description?: string;
        result?: { file_path?: string };
      };
      if (!meta.ok || !meta.result?.file_path) {
        return reply.code(404).send({
          error: meta.description || 'Файл недоступен в Telegram (file_id устарел или >20 МБ)',
        });
      }

      const fileUrl = `https://api.telegram.org/file/bot${token}/${meta.result.file_path}`;
      const imgRes = await fetch(fileUrl);
      if (!imgRes.ok) {
        return reply.code(502).send({ error: 'Не удалось скачать файл из Telegram' });
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      const contentType = imgRes.headers.get('content-type') || 'application/octet-stream';
      return reply
        .header('Content-Type', contentType)
        .header('Cache-Control', 'private, max-age=300')
        .send(buf);
    },
  );

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
      where: { id: botId, tenantId, botType: { in: ['gift', 'gift_max'] }, status: 'active' },
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
          mediaType: (() => {
            const fileId =
              cleanOptional(body.data.telegramFileId) || prev.telegramFileId || '';
            return fileId
              ? detectStoredMediaKind(fileId, normalizeGiftMediaType(body.data.mediaType))
              : normalizeGiftMediaType(body.data.mediaType) || 'photo';
          })(),
          telegramFileId: cleanOptional(body.data.telegramFileId) || prev.telegramFileId,
          telegramFileUniqueId:
            cleanOptional(body.data.telegramFileUniqueId) || prev.telegramFileUniqueId,
          mediaUrl: cleanOptional(body.data.mediaUrl || body.data.imageUrl) || prev.mediaUrl,
          buttonText: body.data.buttonText,
          showClickCounter:
            typeof body.data.showClickCounter === 'boolean'
              ? body.data.showClickCounter
              : promoShowClickCounter(prev),
        }
      : prev;
    delete (promo as { imageUrl?: string }).imageUrl;
    if (promo.telegramFileId) {
      promo.mediaUrl = undefined;
      promo.mediaType = detectStoredMediaKind(
        promo.telegramFileId,
        normalizeGiftMediaType(promo.mediaType),
      );
    }

    if (!promo.text.trim()) {
      return reply.code(400).send({ error: 'Заполните текст поста' });
    }

    const token = decrypt(bot.botTokenEncrypted);
    const botApi = `https://api.telegram.org/bot${token}`;
    const startPayload = giftPromoStartPayload(campaign.id);
    const buttonUrl = `https://t.me/${bot.botUsername}?start=${startPayload}`;
    const buttonLabel = formatPromoButtonLabel(
      promo.buttonText,
      promo.clickCount,
      promoShowClickCounter(promo),
    );
    const replyMarkup = {
      inline_keyboard: [[{ text: buttonLabel, url: buttonUrl }]],
    };
    const media = resolveTelegramMedia(promo);
    const kind = promoMediaType(promo);
    const caption = clientMdToMarkdownV2(promo.text);

    let tgJson: any;
    if (media) {
      tgJson = await publishChannelMedia({
        botApi,
        chatId: campaign.channelId,
        media,
        kind,
        caption,
        replyMarkup,
      });
      // video_note has no caption — send text as follow-up
      if (kind === 'video_note' && tgJson.ok && promo.text.trim()) {
        await fetch(`${botApi}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: campaign.channelId,
            text: caption,
            parse_mode: 'MarkdownV2',
          }),
        }).catch(() => undefined);
      }
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
      .object({
        channelUsername: z.string().min(1),
        /** Persist to this project when admin check passes */
        campaignId: z.string().cuid().optional(),
      })
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
    if (!channel) {
      return reply.code(400).send({
        ok: false,
        error: 'Укажите @username канала или числовой chat id (−100…)',
      });
    }
    // Invite links (+…) cannot be resolved via Bot API without a prior update
    if (channel.startsWith('+') || channel.toLowerCase().startsWith('joinchat')) {
      return reply.code(400).send({
        ok: false,
        error:
          'Нужен публичный @username канала/группы или числовой id (−100…). Invite-ссылка t.me/+… не подходит.',
      });
    }
    const chatRef = channel.startsWith('-') || /^-?\d+$/.test(channel) ? channel : `@${channel}`;

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
        const tg = String(member.description || '');
        let hint = 'Добавьте бота администратором канала/группы.';
        if (/chat not found/i.test(tg)) {
          hint =
            'Telegram не находит чат по этому имени. Нужен публичный @username (не название) или id −100…; бот должен быть уже добавлен в чат.';
        } else if (/bot is not a member/i.test(tg)) {
          hint = 'Бот ещё не в чате. Добавьте его админом, затем нажмите проверку снова.';
        }
        return reply.code(400).send({
          ok: false,
          error: tg ? `${tg}. ${hint}` : hint,
        });
      }

      const status = member.result?.status as string;
      const isAdmin = status === 'administrator' || status === 'creator';
      const canPost =
        status === 'creator'
        || Boolean(member.result?.can_post_messages)
        || Boolean(member.result?.can_manage_chat);
      let channelId = chatRef;
      let chatType: string | undefined;
      try {
        const chatRes = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatRef }),
        });
        const chat = (await chatRes.json()) as any;
        if (chat.ok && chat.result?.id) channelId = String(chat.result.id);
        chatType = chat.result?.type;
      } catch {
        // keep chatRef as channelId fallback
      }

      if (isAdmin && body.data.campaignId) {
        const campaign = await prisma.giftCampaignConfig.findFirst({
          where: { id: body.data.campaignId, botInstanceId: botId, tenantId },
        });
        if (campaign) {
          await prisma.giftCampaignConfig.update({
            where: { id: campaign.id },
            data: {
              channelId,
              channelUsername: /^-?\d+$/.test(channel) ? channel : channel.replace(/^@/, ''),
            },
          });
        }
      } else if (isAdmin) {
        // Persist to active/newest project so verify is not lost on refresh
        const campaign = await prisma.giftCampaignConfig.findFirst({
          where: { botInstanceId: botId, tenantId },
          orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
        });
        if (campaign) {
          await prisma.giftCampaignConfig.update({
            where: { id: campaign.id },
            data: {
              channelId,
              channelUsername: /^-?\d+$/.test(channel) ? channel : channel.replace(/^@/, ''),
            },
          });
        }
      }

      return reply.send({
        ok: isAdmin,
        status,
        canPost,
        chatType,
        channelId,
        channelUsername: /^-?\d+$/.test(channel) ? channel : channel.replace(/^@/, ''),
        message: isAdmin
          ? canPost || chatType === 'supergroup' || chatType === 'group'
            ? 'Бот — администратор. Канал сохранён в проект.'
            : 'Бот — админ, но без права публиковать. Включите «Публикация сообщений».'
          : 'Бот в канале, но не админ. Назначьте администратором (права: видеть участников и публиковать).',
      });
    } catch (err) {
      return reply.code(500).send({
        ok: false,
        error: err instanceof Error ? err.message : 'Ошибка проверки канала',
      });
    }
  });

  // --- Broadcast to segment / channel audience / stories ---
  fastify.post('/:botId/broadcasts', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const { tenantId } = user;
    const { botId } = request.params as { botId: string };
    if (!canManageTenant(user)) {
      return reply.code(403).send({ error: 'Only owners can broadcast' });
    }

    const prisma = fastify.prisma;
    const bot = await prisma.botInstance.findFirst({
      where: { id: botId, tenantId },
      include: { giftCampaigns: { where: { isActive: true }, take: 1 } },
    });
    if (!bot) {
      return reply.code(404).send({ error: 'Bot not found' });
    }

    const body = (request.body || {}) as Record<string, unknown>;
    const whenFrom = (scheduledAt?: string) =>
      scheduledAt ? new Date(scheduledAt) : new Date();

    // --- Stories ---
    if (body.channel === 'story') {
      const parsed = storyBroadcastSchema.safeParse(body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      const storyVia =
        bot.botType === 'ai_gramjs'
          ? 'gramjs'
          : bot.botType === 'ai_wa'
            ? 'wa'
            : bot.botType === 'ai_tg'
              ? 'ai_tg'
              : null;
      if (!storyVia) {
        return reply.code(400).send({
          error: 'Сторис: нужен аккаунт GramJS, WhatsApp или Business-бот',
        });
      }
      const gate = await requireActiveAddon(
        prisma,
        tenantId,
        PRODUCT_CODES.MAILING_STORIES,
      );
      if (!gate.ok) {
        return reply.code(gate.code).send({
          error: gate.error,
          billing: gate.meta,
          productCode: gate.productCode,
          payUrl: true,
        });
      }

      const filters = normalizeChannelAudienceFilters(parsed.data);
      const broadcast = await prisma.broadcast.create({
        data: {
          tenantId,
          status: 'scheduled',
          scheduledAt: whenFrom(parsed.data.scheduledAt),
          totalCount: 1,
          messageJson: {
            channel: 'story',
            storyVia,
            botId,
            text: parsed.data.text || '',
            mediaUrl: parsed.data.mediaUrl,
            mediaType: parsed.data.mediaType || undefined,
            linkUrl: parsed.data.linkUrl || undefined,
            linkText: parsed.data.linkText || undefined,
            opportunityStage: filters.opportunityStage,
            giftStarted: filters.giftStarted || 'any',
            funnelPhase: filters.funnelPhase,
            readStatus: parsed.data.readStatus || 'any',
          },
        },
      });
      return reply.send({ broadcast, queued: 1 });
    }

    const channel = mailingChannelForBotType(bot.botType);
    if (!channel) {
      return reply.code(400).send({ error: 'Broadcasts not supported for this bot type' });
    }

    const gate = await requireActiveAddon(
      prisma,
      tenantId,
      addonTypeForMailingChannel(channel),
    );
    if (!gate.ok) {
      return reply.code(gate.code).send({
        error: gate.error,
        billing: gate.meta,
        productCode: gate.productCode,
        payUrl: true,
      });
    }

    if (channel === 'gift') {
      const parsed = broadcastSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }
      if (!bot.giftCampaigns[0]) {
        return reply.code(404).send({ error: 'Active campaign not found' });
      }
      if (bot.status !== 'active') {
        return reply.code(409).send({ error: 'Аккаунт не активен' });
      }

      const campaignId = bot.giftCampaigns[0].id;
      const poolBotIds = await resolveBroadcastPool(
        prisma,
        tenantId,
        botId,
        parsed.data.botIds,
        'gift',
      );
      const where = giftSubscriberAudienceWhere({
        campaignId,
        segment: parsed.data.segment,
        funnelPhase: parsed.data.funnelPhase,
      });

      const totalCount = await prisma.giftSubscriber.count({ where });
      const broadcast = await prisma.broadcast.create({
        data: {
          tenantId,
          status: 'scheduled',
          scheduledAt: whenFrom(parsed.data.scheduledAt),
          totalCount,
          messageJson: {
            channel: 'gift',
            botId,
            botIds: poolBotIds.length > 1 ? poolBotIds : undefined,
            campaignId,
            segment: parsed.data.segment,
            funnelPhase: parsed.data.funnelPhase || undefined,
            text: parsed.data.text,
            mediaUrl: parsed.data.telegramFileId ? undefined : parsed.data.mediaUrl || undefined,
            telegramFileId: parsed.data.telegramFileId || undefined,
            mediaType: parsed.data.mediaType || undefined,
          },
        },
      });

      return reply.send({ broadcast, queued: totalCount });
    }

    const parsed = channelBroadcastSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    if (bot.status !== 'active') {
      return reply.code(409).send({ error: 'Аккаунт не активен' });
    }

    const poolBotIds = await resolveBroadcastPool(
      prisma,
      tenantId,
      botId,
      parsed.data.botIds,
      channel,
    );
    const filters = normalizeChannelAudienceFilters(parsed.data);
    const audience = await resolveChannelBroadcastAudience({
      prisma,
      tenantId,
      botId: poolBotIds,
      filters,
    });
    const broadcast = await prisma.broadcast.create({
      data: {
        tenantId,
        status: 'scheduled',
        scheduledAt: whenFrom(parsed.data.scheduledAt),
        totalCount: audience.count,
        messageJson: {
          channel,
          botId,
          botIds: poolBotIds.length > 1 ? poolBotIds : undefined,
          text: parsed.data.text,
          mediaUrl: parsed.data.mediaUrl || undefined,
          mediaType: parsed.data.mediaType || undefined,
          opportunityStage: filters.opportunityStage,
          giftStarted: parsed.data.giftStarted || 'any',
          funnelPhase: filters.funnelPhase,
          readStatus: parsed.data.readStatus || 'any',
          conversationIds: audience.conversationIds,
        },
      },
    });

    return reply.send({ broadcast, queued: audience.count });
  });

  // --- Edit scheduled broadcast (before scanner picks it up) ---
  fastify.patch(
    '/:botId/broadcasts/:broadcastId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId, broadcastId } = request.params as { botId: string; broadcastId: string };
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can broadcast' });
      }

      const prisma = fastify.prisma;
      const existing = await prisma.broadcast.findFirst({
        where: { id: broadcastId, tenantId },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'Broadcast not found' });
      }
      if (existing.status !== 'scheduled') {
        return reply.code(409).send({ error: 'Можно редактировать только запланированные рассылки' });
      }

      const prev = (existing.messageJson || {}) as Record<string, unknown>;
      if (!broadcastPoolIds(prev).includes(botId)) {
        return reply.code(404).send({ error: 'Broadcast not found' });
      }
      // Anchor primary to the stored botId so a pool member cannot silently
      // reassign the broadcast's primary account while editing (Job 1B.1).
      const anchorBotId = typeof prev.botId === 'string' && prev.botId ? prev.botId : botId;

      const bot = await prisma.botInstance.findFirst({
        where: { id: anchorBotId, tenantId },
        include: { giftCampaigns: { where: { isActive: true }, take: 1 } },
      });
      if (!bot) {
        return reply.code(404).send({ error: 'Bot not found' });
      }
      if (bot.status !== 'active') {
        return reply.code(409).send({ error: 'Аккаунт не активен' });
      }

      const channel =
        prev.channel === 'gramjs' ||
        prev.channel === 'wa' ||
        prev.channel === 'gift' ||
        prev.channel === 'story'
          ? prev.channel
          : mailingChannelForBotType(bot.botType) || 'gift';

      if (channel === 'story') {
        const gate = await requireActiveAddon(
          prisma,
          tenantId,
          PRODUCT_CODES.MAILING_STORIES,
        );
        if (!gate.ok) {
          return reply.code(gate.code).send({
            error: gate.error,
            billing: gate.meta,
            productCode: gate.productCode,
            payUrl: true,
          });
        }
        const parsed = patchBroadcastSchema
          .pick({
            text: true,
            mediaUrl: true,
            mediaType: true,
            opportunityStage: true,
            giftStarted: true,
            funnelPhase: true,
            readStatus: true,
            scheduledAt: true,
          })
          .safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.flatten() });
        }
        const text =
          parsed.data.text !== undefined
            ? parsed.data.text
            : typeof prev.text === 'string'
              ? prev.text
              : '';
        let mediaUrl: string | undefined =
          typeof prev.mediaUrl === 'string' ? prev.mediaUrl : undefined;
        let mediaType: GiftPromoMediaType | undefined =
          normalizeGiftMediaType(
            typeof prev.mediaType === 'string' ? prev.mediaType : null,
          ) || undefined;
        if (parsed.data.mediaUrl !== undefined) {
          mediaUrl = parsed.data.mediaUrl || undefined;
        }
        if (parsed.data.mediaType !== undefined) {
          mediaType = parsed.data.mediaType || undefined;
        }
        if (!mediaUrl) {
          return reply.code(400).send({ error: 'mediaUrl required for stories' });
        }
        const opportunityStage =
          parsed.data.opportunityStage === null
            ? undefined
            : parsed.data.opportunityStage !== undefined
              ? parsed.data.opportunityStage
              : typeof prev.opportunityStage === 'string'
                ? prev.opportunityStage
                : undefined;
        const giftStarted =
          parsed.data.giftStarted === null
            ? 'any'
            : parsed.data.giftStarted !== undefined
              ? parsed.data.giftStarted
              : prev.giftStarted === 'yes' || prev.giftStarted === 'no'
                ? prev.giftStarted
                : 'any';
        const funnelPhase =
          parsed.data.funnelPhase === null
            ? undefined
            : parsed.data.funnelPhase !== undefined
              ? parsed.data.funnelPhase
              : typeof prev.funnelPhase === 'string'
                ? prev.funnelPhase
                : undefined;
        const readStatus =
          parsed.data.readStatus === null
            ? 'any'
            : parsed.data.readStatus !== undefined
              ? parsed.data.readStatus
              : prev.readStatus === 'read' || prev.readStatus === 'unread'
                ? prev.readStatus
                : 'any';
        const scheduledAt = parsed.data.scheduledAt
          ? new Date(parsed.data.scheduledAt)
          : existing.scheduledAt;
        const broadcast = await prisma.broadcast.update({
          where: { id: broadcastId },
          data: {
            scheduledAt,
            messageJson: {
              ...prev,
              channel: 'story',
              botId: anchorBotId,
              text,
              mediaUrl,
              mediaType: mediaType || undefined,
              opportunityStage: opportunityStage || undefined,
              giftStarted,
              funnelPhase: funnelPhase || undefined,
              readStatus,
            },
          },
        });
        return reply.send({ broadcast, queued: 1 });
      }

      const gate = await requireActiveAddon(
        prisma,
        tenantId,
        addonTypeForMailingChannel(channel === 'gift' ? 'gift' : channel),
      );
      if (!gate.ok) {
        return reply.code(gate.code).send({
          error: gate.error,
          billing: gate.meta,
          productCode: gate.productCode,
          payUrl: true,
        });
      }

      if (channel === 'gift') {
        const parsed = patchBroadcastSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.code(400).send({ error: parsed.error.flatten() });
        }
        if (!bot.giftCampaigns[0]) {
          return reply.code(404).send({ error: 'Active campaign not found' });
        }

        const segment =
          parsed.data.segment ??
          (prev.segment === 'gifted' || prev.segment === 'not_gifted' || prev.segment === 'all'
            ? prev.segment
            : 'all');
        const funnelPhase =
          parsed.data.funnelPhase === null
            ? undefined
            : parsed.data.funnelPhase !== undefined
              ? parsed.data.funnelPhase
              : typeof prev.funnelPhase === 'string'
                ? prev.funnelPhase
                : undefined;
        const text =
          parsed.data.text ?? (typeof prev.text === 'string' ? prev.text : '');
        if (!text.trim()) {
          return reply.code(400).send({ error: 'text required' });
        }

        let telegramFileId: string | undefined =
          typeof prev.telegramFileId === 'string' ? prev.telegramFileId : undefined;
        let mediaUrl: string | undefined =
          typeof prev.mediaUrl === 'string' ? prev.mediaUrl : undefined;
        let mediaType: GiftPromoMediaType | undefined =
          normalizeGiftMediaType(
            typeof prev.mediaType === 'string' ? prev.mediaType : null,
          ) || undefined;

        if (parsed.data.telegramFileId !== undefined) {
          telegramFileId = parsed.data.telegramFileId || undefined;
          if (telegramFileId) mediaUrl = undefined;
        }
        if (parsed.data.mediaUrl !== undefined) {
          mediaUrl = parsed.data.mediaUrl || undefined;
          if (mediaUrl) telegramFileId = undefined;
        }
        if (parsed.data.mediaType !== undefined) {
          mediaType = parsed.data.mediaType || undefined;
        }
        if (!telegramFileId && !mediaUrl) mediaType = undefined;

        const campaignId = bot.giftCampaigns[0].id;
        const prevPool = broadcastPoolIds(prev);
        const poolBotIds = await resolveBroadcastPool(
          prisma,
          tenantId,
          anchorBotId,
          parsed.data.botIds ?? (prevPool.length > 1 ? prevPool : undefined),
          'gift',
        );
        const where = giftSubscriberAudienceWhere({ campaignId, segment, funnelPhase });
        const totalCount = await prisma.giftSubscriber.count({ where });
        const scheduledAt = parsed.data.scheduledAt
          ? new Date(parsed.data.scheduledAt)
          : existing.scheduledAt;

        const broadcast = await prisma.broadcast.update({
          where: { id: broadcastId },
          data: {
            scheduledAt,
            totalCount,
            messageJson: {
              ...prev,
              channel: 'gift',
              botId: anchorBotId,
              botIds: poolBotIds.length > 1 ? poolBotIds : undefined,
              campaignId,
              segment,
              funnelPhase: funnelPhase || undefined,
              text,
              mediaUrl: telegramFileId ? undefined : mediaUrl,
              telegramFileId: telegramFileId || undefined,
              mediaType: mediaType || undefined,
            },
          },
        });

        return reply.send({ broadcast, queued: totalCount });
      }

      const parsed = patchBroadcastSchema
        .pick({
          text: true,
          mediaUrl: true,
          mediaType: true,
          opportunityStage: true,
          giftStarted: true,
          funnelPhase: true,
          readStatus: true,
          scheduledAt: true,
          botIds: true,
        })
        .safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const text =
        parsed.data.text ?? (typeof prev.text === 'string' ? prev.text : '');
      if (!text.trim()) {
        return reply.code(400).send({ error: 'text required' });
      }

      let mediaUrl: string | undefined =
        typeof prev.mediaUrl === 'string' ? prev.mediaUrl : undefined;
      let mediaType: GiftPromoMediaType | undefined =
        normalizeGiftMediaType(
          typeof prev.mediaType === 'string' ? prev.mediaType : null,
        ) || undefined;
      if (parsed.data.mediaUrl !== undefined) {
        mediaUrl = parsed.data.mediaUrl || undefined;
      }
      if (parsed.data.mediaType !== undefined) {
        mediaType = parsed.data.mediaType || undefined;
      }
      if (!mediaUrl) mediaType = undefined;

      const filters = normalizeChannelAudienceFilters({
        opportunityStage:
          parsed.data.opportunityStage === null
            ? undefined
            : parsed.data.opportunityStage !== undefined
              ? parsed.data.opportunityStage
              : typeof prev.opportunityStage === 'string'
                ? prev.opportunityStage
                : undefined,
        giftStarted:
          parsed.data.giftStarted === null
            ? 'any'
            : parsed.data.giftStarted !== undefined
              ? parsed.data.giftStarted
              : prev.giftStarted === 'yes' || prev.giftStarted === 'no'
                ? prev.giftStarted
                : 'any',
        funnelPhase:
          parsed.data.funnelPhase === null
            ? undefined
            : parsed.data.funnelPhase !== undefined
              ? parsed.data.funnelPhase
              : typeof prev.funnelPhase === 'string'
                ? (prev.funnelPhase as z.infer<typeof giftFunnelPhaseSchema>)
                : undefined,
        readStatus:
          parsed.data.readStatus === null
            ? 'any'
            : parsed.data.readStatus !== undefined
              ? parsed.data.readStatus
              : prev.readStatus === 'read' || prev.readStatus === 'unread'
                ? prev.readStatus
                : 'any',
      });
      const prevPool = broadcastPoolIds(prev);
      const poolBotIds = await resolveBroadcastPool(
        prisma,
        tenantId,
        anchorBotId,
        parsed.data.botIds ?? (prevPool.length > 1 ? prevPool : undefined),
        channel,
      );
      const audience = await resolveChannelBroadcastAudience({
        prisma,
        tenantId,
        botId: poolBotIds,
        filters,
      });
      const scheduledAt = parsed.data.scheduledAt
        ? new Date(parsed.data.scheduledAt)
        : existing.scheduledAt;

      const broadcast = await prisma.broadcast.update({
        where: { id: broadcastId },
        data: {
          scheduledAt,
          totalCount: audience.count,
          messageJson: {
            ...prev,
            channel,
            botId: anchorBotId,
            botIds: poolBotIds.length > 1 ? poolBotIds : undefined,
            text,
            mediaUrl: mediaUrl || undefined,
            mediaType: mediaType || undefined,
            opportunityStage: filters.opportunityStage,
            giftStarted: filters.giftStarted || 'any',
            funnelPhase: filters.funnelPhase,
            readStatus: filters.readStatus || 'any',
            conversationIds: audience.conversationIds,
          },
        },
      });

      return reply.send({ broadcast, queued: audience.count });
    },
  );

  // --- Delete draft/scheduled broadcast ---
  fastify.delete(
    '/:botId/broadcasts/:broadcastId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId, broadcastId } = request.params as { botId: string; broadcastId: string };
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can delete broadcasts' });
      }

      const broadcast = await fastify.prisma.broadcast.findFirst({
        where: { id: broadcastId, tenantId },
      });
      if (!broadcast || !broadcastPoolIds(broadcast.messageJson as any).includes(botId)) {
        return reply.code(404).send({ error: 'Broadcast not found' });
      }
      if (broadcast.status === 'sending') {
        return reply.code(409).send({ error: 'Нельзя удалить рассылку во время отправки' });
      }
      if (broadcast.status !== 'scheduled' && broadcast.status !== 'draft') {
        return reply.code(409).send({ error: 'Можно удалить только черновик или запланированную рассылку' });
      }

      await fastify.prisma.broadcast.delete({ where: { id: broadcastId } });
      return reply.send({ ok: true });
    },
  );

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
      .filter((b) => broadcastPoolIds(b.messageJson as any).includes(botId))
      .map((b) => {
        const msg = b.messageJson as any;
        return {
          id: b.id,
          status: b.status,
          scheduledAt: b.scheduledAt,
          sentCount: b.sentCount,
          totalCount: b.totalCount,
          channel: msg?.channel || 'gift',
          botIds: Array.isArray(msg?.botIds) ? msg.botIds : null,
          segment: msg?.segment,
          funnelPhase: msg?.funnelPhase ?? null,
          opportunityStage: msg?.opportunityStage ?? null,
          giftStarted: msg?.giftStarted ?? 'any',
          readStatus: msg?.readStatus ?? 'any',
          text: msg?.text,
          mediaUrl: msg?.mediaUrl ?? null,
          telegramFileId: msg?.telegramFileId ?? null,
          mediaType: msg?.mediaType ?? null,
          deliveredCount: msg?.deliveredCount ?? null,
          readCount: msg?.readCount ?? null,
          failedCount: msg?.failedCount ?? null,
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
      data: {
        mode: 'human',
        pausedUntil: new Date(Date.now() + AI_HANDOFF_PAUSE_MS),
      },
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

  // --- List AI conversations for a bot ---
  fastify.get(
    '/:botId/conversations',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { botId } = request.params as { botId: string };
      const prisma = fastify.prisma;

      const bot = await prisma.botInstance.findFirst({
        where: { id: botId, tenantId },
        select: { id: true, botType: true },
      });
      if (!bot) return reply.code(404).send({ error: 'Bot not found' });

      const conversations = await prisma.conversation.findMany({
        where: {
          tenantId,
          botInstanceId: botId,
          channel: { not: 'telegram_business_account' },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        include: {
          aiAgent: { select: { id: true, name: true, status: true } },
          messages: {
            orderBy: { sentAt: 'desc' },
            take: 1,
            select: { id: true, role: true, content: true, sentAt: true },
          },
        },
      });

      const businessAccounts = await prisma.conversation.findMany({
        where: {
          tenantId,
          botInstanceId: botId,
          channel: 'telegram_business_account',
        },
        orderBy: { updatedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          platformUserId: true,
          platformUsername: true,
          platformFirstName: true,
          businessConnectionId: true,
          status: true,
          updatedAt: true,
          createdAt: true,
        },
      });

      const botDefault = await prisma.botInstance.findFirst({
        where: { id: botId, tenantId },
        select: {
          defaultAiAgentId: true,
          defaultAiAgent: { select: { id: true, name: true, status: true } },
        },
      });

      const aiAddon = await prisma.addon.findUnique({
        where: { tenantId_type: { tenantId, type: 'ai_tg' } },
      });
      const { getAiTgBusinessCapacity, getAiTgExtraSlots, PRICING, PRODUCT_CODES } = await import(
        '@voxly/shared'
      );
      const { resolveUnitPrice } = await import('../services/platform-pricing.js');
      const extraSlots = getAiTgExtraSlots(aiAddon?.config);
      const capacity = getAiTgBusinessCapacity(aiAddon?.config);
      const activeBusiness = businessAccounts.filter((a) => a.status !== 'closed').length;
      const extraPriceMonthly = await resolveUnitPrice(
        prisma,
        tenantId,
        PRODUCT_CODES.AI_TG_EXTRA_CONN,
      );

      return reply.send({
        defaultAiAgentId: botDefault?.defaultAiAgentId ?? null,
        defaultAiAgent: botDefault?.defaultAiAgent ?? null,
        businessCapacity: {
          included: PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS,
          extraSlots,
          capacity,
          active: activeBusiness,
          extraPriceMonthly,
        },
        businessAccounts: businessAccounts.map((a) => ({
          id: a.id,
          ownerTelegramId: a.platformUserId,
          ownerUsername: a.platformUsername,
          ownerFirstName: a.platformFirstName,
          businessConnectionId: a.businessConnectionId,
          status: a.status,
          connected: a.status !== 'closed',
          canReply: a.status !== 'limited' && a.status !== 'closed',
          updatedAt: a.updatedAt,
          createdAt: a.createdAt,
        })),
        conversations: conversations.map((c) => ({
          id: c.id,
          platformUserId: c.platformUserId,
          platformUsername: c.platformUsername,
          platformFirstName: c.platformFirstName,
          status: c.status,
          mode: c.mode,
          aiDisabled: c.aiDisabled,
          pausedUntil: c.pausedUntil,
          channel: c.channel,
          businessConnectionId: c.businessConnectionId,
          aiAgentId: c.aiAgentId,
          aiAgent: c.aiAgent,
          effectiveAiAgent: c.aiAgent || botDefault?.defaultAiAgent || null,
          twentyPersonId: c.twentyPersonId,
          twentyOpportunityId: c.twentyOpportunityId,
          needsReview: c.needsReview,
          lastAiMessageAt: c.lastAiMessageAt,
          updatedAt: c.updatedAt,
          createdAt: c.createdAt,
          lastMessage: c.messages[0]
            ? {
                id: c.messages[0].id,
                role: c.messages[0].role,
                content: c.messages[0].content.slice(0, 200),
                sentAt: c.messages[0].sentAt,
              }
            : null,
        })),
      });
    },
  );

  // Soft-unlink Business account → frees a slot (swap)
  fastify.delete(
    '/:botId/business-accounts/:accountId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId, accountId } = request.params as { botId: string; accountId: string };
      if (!canManageTenant(user)) {
        return reply.code(403).send({ error: 'Only owners can unlink Business accounts' });
      }
      const row = await fastify.prisma.conversation.findFirst({
        where: {
          id: accountId,
          tenantId,
          botInstanceId: botId,
          channel: 'telegram_business_account',
        },
      });
      if (!row) return reply.code(404).send({ error: 'Account not found' });
      await fastify.prisma.conversation.update({
        where: { id: row.id },
        data: { status: 'closed' },
      });
      return reply.send({ ok: true, id: row.id, status: 'closed' });
    },
  );

  // --- Messages for one conversation ---
  fastify.get(
    '/:botId/conversations/:conversationId/messages',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { botId, conversationId } = request.params as {
        botId: string;
        conversationId: string;
      };
      const prisma = fastify.prisma;

      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId, botInstanceId: botId },
      });
      if (!conversation) return reply.code(404).send({ error: 'Not found' });

      const messages = await prisma.chatMessage.findMany({
        where: { conversationId },
        orderBy: { sentAt: 'asc' },
        take: 200,
        select: {
          id: true,
          role: true,
          content: true,
          sentAt: true,
          attachments: true,
        },
      });

      return reply.send({
        conversation: {
          id: conversation.id,
          mode: conversation.mode,
          aiDisabled: conversation.aiDisabled,
          pausedUntil: conversation.pausedUntil,
          status: conversation.status,
          needsReview: conversation.needsReview,
          twentyPersonId: conversation.twentyPersonId,
          twentyOpportunityId: conversation.twentyOpportunityId,
          platformUsername: conversation.platformUsername,
          platformFirstName: conversation.platformFirstName,
          platformUserId: conversation.platformUserId,
          channel: conversation.channel,
        },
        messages,
      });
    },
  );

  // --- AI handoff controls (mode / pause / disable) ---
  fastify.patch(
    '/:botId/conversations/:conversationId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const user = (request as any).user;
      const { tenantId } = user;
      const { botId, conversationId } = request.params as {
        botId: string;
        conversationId: string;
      };
      const body = z
        .object({
          mode: z.enum(['ai', 'human', 'bot']).optional(),
          aiDisabled: z.boolean().optional(),
          /** true → pause AI_HANDOFF_PAUSE_MS; false → clear pause */
          pause: z.boolean().optional(),
          pausedUntil: z.string().datetime().nullable().optional(),
          needsReview: z.boolean().optional(),
          /** null clears chat override (falls back to bot default); omit = no change */
          aiAgentId: z.string().nullable().optional(),
        })
        .safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: body.error.flatten() });
      if (!canManageTenant(user) && user.tenantRole !== 'member' && user.role !== 'member') {
        return reply.code(403).send({ error: 'Forbidden' });
      }

      const prisma = fastify.prisma;
      const conversation = await prisma.conversation.findFirst({
        where: { id: conversationId, tenantId, botInstanceId: botId },
      });
      if (!conversation) return reply.code(404).send({ error: 'Not found' });

      if (body.data.aiAgentId) {
        const agent = await prisma.aiAgent.findFirst({
          where: { id: body.data.aiAgentId, tenantId, status: 'active' },
        });
        if (!agent) return reply.code(404).send({ error: 'Agent not found' });
      }

      const data: {
        mode?: string;
        aiDisabled?: boolean;
        pausedUntil?: Date | null;
        status?: string;
        needsReview?: boolean;
        aiAgentId?: string | null;
      } = {};

      if (body.data.mode !== undefined) {
        data.mode = body.data.mode === 'bot' ? 'ai' : body.data.mode;
        data.status = data.mode === 'human' ? 'waiting_for_human' : 'open';
      }
      if (body.data.aiDisabled !== undefined) {
        data.aiDisabled = body.data.aiDisabled;
        if (body.data.aiDisabled) {
          data.mode = 'human';
          data.status = 'waiting_for_human';
        } else {
          data.mode = data.mode || 'ai';
          data.status = 'open';
          data.pausedUntil = null;
        }
      }
      if (body.data.pause === true) {
        data.pausedUntil = new Date(Date.now() + AI_HANDOFF_PAUSE_MS);
      } else if (body.data.pause === false) {
        data.pausedUntil = null;
      }
      if (body.data.pausedUntil !== undefined) {
        data.pausedUntil = body.data.pausedUntil
          ? new Date(body.data.pausedUntil)
          : null;
      }
      if (body.data.needsReview !== undefined) {
        data.needsReview = body.data.needsReview;
      }
      if (body.data.aiAgentId !== undefined) {
        data.aiAgentId = body.data.aiAgentId;
        // Assigning an agent implies AI ready (unless explicitly disabled in same request).
        if (body.data.aiAgentId && body.data.aiDisabled !== true) {
          data.mode = data.mode || 'ai';
          data.status = data.status || 'open';
          if (body.data.aiDisabled === undefined) {
            data.aiDisabled = false;
          }
        }
      }

      const updated = await prisma.conversation.update({
        where: { id: conversationId },
        data,
        include: { aiAgent: { select: { id: true, name: true, status: true } } },
      });

      return reply.send({
        id: updated.id,
        mode: updated.mode,
        aiDisabled: updated.aiDisabled,
        pausedUntil: updated.pausedUntil,
        status: updated.status,
        needsReview: updated.needsReview,
        aiAgentId: updated.aiAgentId,
        aiAgent: updated.aiAgent,
      });
    },
  );

  // --- Deactivate / remove bot ---
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

    // AI Telegram Business: drop webhook + remove from portal (hard delete when possible)
    if (bot.botType === 'ai_tg') {
      if (bot.botTokenEncrypted) {
        try {
          const token = decrypt(bot.botTokenEncrypted);
          await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ drop_pending_updates: false }),
          });
        } catch {
          /* ignore */
        }
      }
      await prisma.conversation.updateMany({
        where: { botInstanceId: botId },
        data: { botInstanceId: null },
      });
      try {
        await prisma.botInstance.delete({ where: { id: botId } });
        await invalidateBotsCache(tenantId);
        return reply.send({ ok: true, botId, deleted: true });
      } catch {
        await prisma.botInstance.update({
          where: { id: botId },
          data: {
            status: 'inactive',
            botTokenEncrypted: null,
            managedBotUserId: null,
          },
        });
        return reply.send({ ok: true, botId, softDeleted: true });
      }
    }

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

async function registerAiTgWebhook(
  botToken: string,
  tenantId: string,
  botId: string,
): Promise<{ ok: boolean; secret: string; error?: string }> {
  const secret = randomBytes(24).toString('hex');
  const publicBase =
    process.env.GIFT_BOT_WEBHOOK_BASE_URL ||
    process.env.BOT_WEBHOOK_BASE_URL ||
    `https://api.${process.env.VOXLY_DOMAIN || 'getvoxly.ru'}`;
  const webhookUrl = `${publicBase.replace(/\/+$/, '')}/tg/${tenantId}/${botId}`;

  if (process.env.GIFT_BOT_USE_POLLING === 'true' || webhookUrl.includes('localhost')) {
    return { ok: true, secret };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        allowed_updates: [
          'message',
          'callback_query',
          'business_connection',
          'business_message',
          'edited_business_message',
          'deleted_business_messages',
        ],
        drop_pending_updates: true,
      }),
    });
    const json = (await res.json()) as { ok?: boolean; description?: string };
    if (!json.ok) {
      return { ok: false, secret, error: json.description || 'setWebhook failed' };
    }
    return { ok: true, secret };
  } catch (err) {
    return { ok: false, secret, error: String((err as Error)?.message || err) };
  }
}

function sanitizeExtraButtons(
  buttons?: z.infer<typeof extraButtonsSchema>,
): GiftFunnelConfig['start']['extraButtons'] {
  if (!buttons?.length) return undefined;
  const cleaned = buttons
    .map((b) => ({ text: b.text.trim(), url: b.url.trim() }))
    .filter((b) => b.text.length > 0 && /^https?:\/\//i.test(b.url));
  return cleaned.length ? cleaned : undefined;
}

function sanitizeFunnel(input: z.infer<typeof campaignSchema>['funnel']): GiftFunnelConfig {
  const mapMsg = (m: z.infer<typeof funnelMessageSchema>) => {
    const telegramFileId = cleanOptional(m.telegramFileId);
    const mediaType = normalizeGiftMediaType(m.mediaType);
    const extraButtons = sanitizeExtraButtons(m.extraButtons);
    return {
      delayMinutes: m.delayMinutes,
      text: m.text,
      imageUrl: telegramFileId ? undefined : cleanOptional(m.imageUrl),
      telegramFileId,
      mediaType: (telegramFileId
        ? detectStoredMediaKind(telegramFileId, mediaType)
        : mediaType) as GiftFunnelConfig['start']['mediaType'],
      ...(extraButtons ? { extraButtons } : {}),
    };
  };
  const giftFileId = cleanOptional(input.gift.telegramFileId);
  const giftHint = normalizeGiftMediaType(input.gift.mediaType);
  const giftMediaType: GiftFunnelConfig['gift']['mediaType'] =
    input.gift.type === 'video'
      ? 'video'
      : giftFileId
        ? detectStoredMediaKind(giftFileId, giftHint)
        : giftHint;
  const startExtra = sanitizeExtraButtons(input.start.extraButtons);
  const giftExtra = sanitizeExtraButtons(input.gift.extraButtons);
  return {
    start: {
      text: input.start.text,
      imageUrl: cleanOptional(input.start.telegramFileId) ? undefined : cleanOptional(input.start.imageUrl),
      telegramFileId: cleanOptional(input.start.telegramFileId),
      mediaType: (() => {
        const fileId = cleanOptional(input.start.telegramFileId);
        const hint = normalizeGiftMediaType(input.start.mediaType);
        if (fileId) return detectStoredMediaKind(fileId, hint);
        return hint;
      })(),
      ...(startExtra ? { extraButtons: startExtra } : {}),
    },
    notSubscribed: input.notSubscribed.map(mapMsg),
    gift: {
      type: input.gift.type,
      url: cleanOptional(input.gift.url) || '',
      telegramFileId: giftFileId,
      mediaType: giftMediaType,
      caption: input.gift.caption,
      ...(giftExtra ? { extraButtons: giftExtra } : {}),
    },
    afterGift: input.afterGift.map(mapMsg),
    notGifted: input.notGifted.map(mapMsg),
    subscribeButton: {
      confirmLabel: input.subscribeButton?.confirmLabel || 'Я подписался ✅',
    },
  };
}
