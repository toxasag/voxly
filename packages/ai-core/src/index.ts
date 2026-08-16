// Voxly AI Core — OpenAI wrapper with per-tenant wallet deduction + markup

import { prisma } from '@voxly/db';
import type { AiUsageChannel } from '@voxly/shared';
import { applyMarkup } from './markup.js';
export {
  applyMarkup,
};
export {
  AI_USAGE_QUEUE_NAME,
  buildUsageChargeKey,
  enqueueAiUsageCharge,
  startAiUsageWorker,
  type AiUsageJobData,
} from './ai-usage-queue.js';
export {
  TIMELINE_SYNC_QUEUE_NAME,
  buildTimelineSyncKey,
  enqueueTimelineSync,
  setTimelineSyncExternalSink,
  startTimelineSyncWorker,
  type TimelineSyncJobData,
} from './timeline-sync-queue.js';
export {
  costUsdFromOpenRouter,
  resolveProviderCostRub,
  usdToProviderCostRub,
  getUsdRubRate,
  loadOpenRouterModelPricing,
  resetOpenRouterPricingCache,
  type CostSource,
  type OpenRouterUsageLike,
  type ModelTokenPricing,
} from './openrouter-cost.js';
export {
  chunkText,
  cosineSimilarity,
  embedTexts,
  embedAndCharge,
  retrieveAgentContext,
  formatRagPromptBlock,
  parseAgentLearnSettings,
  DEFAULT_WON_STAGES,
  type AgentLearnSettings,
} from './rag.js';
export {
  createInboundDebouncer,
  humanBubbleGapMs,
  normalizeAiBubbles,
  filterHistoryAfterAgentUpdate,
  filterMediaCapabilityRefusals,
  isMediaCapabilityRefusal,
  hasEnrichedMediaTag,
  isNearDuplicateReply,
  AGENT_PROMPT_PRIORITY_HINT,
  MEDIA_INBOUND_HINT,
  MEDIA_REFUSAL_RETRY_USER,
  DEFAULT_INBOUND_DEBOUNCE_MS,
  type InboundDebouncer,
} from './inbound-debounce.js';
export {
  DOC_TEXT_MAX_CHARS,
  DOC_MEDIA_MAX_BYTES,
  detectDocumentKind,
  extractDocumentText,
  formatDocumentAiText,
  type DocumentKind,
} from './document-text.js';
export {
  extractAudioFromVideo,
  type ExtractedAudio,
} from './extract-audio.js';

export interface ChargeAiUsageParams {
  tenantId: string;
  providerCostRub: number;
  tokens: number;
  model: string;
  requestType: 'text' | 'transcribe' | 'vision';
  addonId?: string;
  aiAgentId?: string | null;
  /** Which surface consumed the tokens; omitted only by callers that predate the breakdown. */
  channel?: AiUsageChannel;
  /**
   * No-debt mode: when the wallet cannot cover the charge, skip the debit entirely
   * and return `insufficient: true` instead of draining the wallet to zero and logging
   * uncollected debt (legacy behaviour). When omitted, falls back to the value of
   * `isNoDebtModeEnabled()` (env `VOXLY_AI_NO_DEBT`).
   */
  noDebt?: boolean;
  /**
   * Idempotency key for the usage charge. When set, a duplicate charge with the same
   * key is a no-op (`duplicate: true`) enforced by the unique `AiUsageLog.usageChargeKey`.
   */
  usageChargeKey?: string;
}

export interface ChargeResult {
  chargedRub: number;
  markupPercent: number;
  remainingBalance: number;
  paused: boolean;
  /** True when no-debt mode skipped the charge because the wallet could not cover it. */
  insufficient?: boolean;
  /** True when the charge was skipped because `usageChargeKey` was already recorded. */
  duplicate?: boolean;
}

/**
 * Whether AI billing runs in "no-debt" mode by default.
 * Reads env `VOXLY_AI_NO_DEBT` (accepts `1`/`true`/`yes`, trimmed + lowercased).
 * A per-call `noDebt` param always overrides this.
 */
export function isNoDebtModeEnabled(): boolean {
  const raw = (process.env.VOXLY_AI_NO_DEBT ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Get the effective AI markup percentage for a tenant
 * (tenant override > platform default)
 */
export async function getEffectiveMarkup(tenantId: string): Promise<number> {
  // Check tenant override
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { aiMarkupPercent: true },
  });
  if (tenant?.aiMarkupPercent !== null && tenant?.aiMarkupPercent !== undefined) {
    return tenant.aiMarkupPercent;
  }
  // Check platform setting
  const setting = await prisma.platformSetting.findUnique({
    where: { key: 'ai_markup_percent' },
  });
  return setting ? parseInt(setting.value, 10) : 50;
}

/**
 * Charge AI usage to tenant wallet with markup
 * Pauses agent if balance reaches zero
 */
export async function chargeAiUsage(params: ChargeAiUsageParams): Promise<ChargeResult> {
  const markupPercent = await getEffectiveMarkup(params.tenantId);
  const chargedRub = applyMarkup(params.providerCostRub, markupPercent);
  const noDebt = params.noDebt ?? isNoDebtModeEnabled();

  const result = await prisma.$transaction(async (tx) => {
    // Idempotency: if this usageChargeKey was already recorded, treat as duplicate no-op.
    if (params.usageChargeKey) {
      const existing = await tx.aiUsageLog.findUnique({
        where: { usageChargeKey: params.usageChargeKey },
        select: { chargedRub: true },
      });
      if (existing) {
        const wallet = await tx.aiWallet.findUnique({
          where: { tenantId: params.tenantId },
          select: { balanceRub: true },
        });
        const balance = Number(wallet?.balanceRub ?? 0);
        return {
          balance,
          paused: balance <= 0,
          insufficient: false,
          duplicate: true,
          chargedRub: Number(existing.chargedRub),
        };
      }
    }

    const wallet = await tx.aiWallet.findUnique({
      where: { tenantId: params.tenantId },
    });

    if (!wallet) {
      throw new Error(`No AI wallet for tenant ${params.tenantId}`);
    }

    // Conditional decrement keeps concurrent charges from overwriting each other
    const debited = await tx.aiWallet.updateMany({
      where: { tenantId: params.tenantId, balanceRub: { gte: chargedRub } },
      data: { balanceRub: { decrement: chargedRub } },
    });

    let balance: number;
    let uncollectedRub = 0;

    if (debited.count > 0) {
      const updatedWallet = await tx.aiWallet.findUnique({
        where: { tenantId: params.tenantId },
      });
      balance = Number(updatedWallet?.balanceRub ?? 0);
    } else if (noDebt) {
      // No-debt mode: do not drain the wallet, do not log usage, signal insufficient funds.
      const current = await tx.aiWallet.findUnique({
        where: { tenantId: params.tenantId },
        select: { balanceRub: true },
      });
      return {
        balance: Number(current?.balanceRub ?? 0),
        paused: true,
        insufficient: true,
        duplicate: false,
        chargedRub: 0,
      };
    } else {
      // Wallet cannot cover the charge: lock the row, collect what is actually there
      const locked = await tx.$queryRaw<Array<{ balanceRub: unknown }>>`
        SELECT "balanceRub" FROM "AiWallet" WHERE "tenantId" = ${params.tenantId} FOR UPDATE
      `;
      const collected = Number(locked[0]?.balanceRub ?? 0);
      uncollectedRub = Math.round((chargedRub - collected) * 10000) / 10000;
      await tx.aiWallet.update({
        where: { tenantId: params.tenantId },
        data: { balanceRub: 0 },
      });
      balance = 0;
    }

    // Log usage
    await tx.aiUsageLog.create({
      data: {
        tenantId: params.tenantId,
        addonId: params.addonId,
        aiAgentId: params.aiAgentId || undefined,
        aiWalletId: wallet.id,
        model: params.model,
        tokens: params.tokens,
        providerCostRub: params.providerCostRub,
        markupPercent,
        chargedRub,
        uncollectedRub: uncollectedRub > 0 ? uncollectedRub : undefined,
        requestType: params.requestType,
        channel: params.channel,
        usageChargeKey: params.usageChargeKey,
      },
    });

    return {
      balance,
      paused: balance <= 0,
      insufficient: false,
      duplicate: false,
      chargedRub,
    };
  });

  return {
    chargedRub: result.chargedRub,
    markupPercent,
    remainingBalance: result.balance,
    paused: result.paused,
    insufficient: result.insufficient,
    duplicate: result.duplicate,
  };
}

/**
 * Check if tenant has sufficient AI balance
 */
export async function hasAiBalance(tenantId: string, minAmount = 1): Promise<boolean> {
  const wallet = await prisma.aiWallet.findUnique({
    where: { tenantId },
  });
  if (!wallet) return false;
  return Number(wallet.balanceRub) >= minAmount;
}

/**
 * Top up AI wallet (called after Robokassa payment for AI balance)
 */
export async function topUpWallet(tenantId: string, amountRub: number): Promise<void> {
  await prisma.aiWallet.upsert({
    where: { tenantId },
    create: { tenantId, balanceRub: amountRub },
    update: { balanceRub: { increment: amountRub } },
  });
}

/**
 * Get AI usage report for admin
 */
export async function getAiUsageReport(tenantId?: string) {
  const where = tenantId ? { tenantId } : {};
  const [totals, byModel, recent] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      where,
      _sum: { providerCostRub: true, chargedRub: true, tokens: true },
      _count: true,
    }),
    prisma.aiUsageLog.groupBy({
      by: ['model'],
      where,
      _sum: { chargedRub: true, tokens: true },
      _count: true,
    }),
    prisma.aiUsageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);

  const margin = (Number(totals._sum.chargedRub) || 0) - (Number(totals._sum.providerCostRub) || 0);

  return {
    totalRequests: totals._count,
    totalTokens: totals._sum.tokens || 0,
    totalProviderCost: totals._sum.providerCostRub?.toString() || '0',
    totalCharged: totals._sum.chargedRub?.toString() || '0',
    margin: margin.toFixed(2),
    byModel: byModel.map((m) => ({
      model: m.model,
      requests: m._count,
      tokens: m._sum.tokens || 0,
      charged: m._sum.chargedRub?.toString() || '0',
    })),
    recent,
  };
}
