// Voxly AI Core — OpenAI wrapper with per-tenant wallet deduction + markup

import { prisma } from '@voxly/db';
import { applyMarkup } from './markup.js';

export { applyMarkup };

export interface ChargeAiUsageParams {
  tenantId: string;
  providerCostRub: number;
  tokens: number;
  model: string;
  requestType: 'text' | 'transcribe' | 'vision';
  addonId?: string;
}

export interface ChargeResult {
  chargedRub: number;
  markupPercent: number;
  remainingBalance: number;
  paused: boolean;
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

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.aiWallet.findUnique({
      where: { tenantId: params.tenantId },
    });

    if (!wallet) {
      throw new Error(`No AI wallet for tenant ${params.tenantId}`);
    }

    const currentBalance = Number(wallet.balanceRub);
    const newBalance = currentBalance - chargedRub;

    // Update wallet (can go negative slightly, but flag for pause)
    const updatedWallet = await tx.aiWallet.update({
      where: { tenantId: params.tenantId },
      data: { balanceRub: Math.max(0, newBalance) },
    });

    // Log usage
    await tx.aiUsageLog.create({
      data: {
        tenantId: params.tenantId,
        addonId: params.addonId,
        aiWalletId: wallet.id,
        model: params.model,
        tokens: params.tokens,
        providerCostRub: params.providerCostRub,
        markupPercent,
        chargedRub,
        requestType: params.requestType,
      },
    });

    return {
      balance: Number(updatedWallet.balanceRub),
      paused: newBalance <= 0,
    };
  });

  return {
    chargedRub,
    markupPercent,
    remainingBalance: result.balance,
    paused: result.paused,
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
