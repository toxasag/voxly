import type { PrismaClient, ReferralRule } from '@voxly/db';
import { REFERRAL_WITHDRAWAL_MIN_RUB } from '@voxly/shared';

export type ReferralAttribution = {
  referrerTenantId: string;
  campaignId: string | null;
};

type ReferralDb = Pick<PrismaClient, 'referralCampaign' | 'referralCode'>;

export type RuleDb = Pick<PrismaClient, 'referralRule'>;

/** Personal partner rate wins over the global rule; used by admin views, crediting and the partner cabinet. */
export async function resolveRuleForReferrer(
  db: RuleDb,
  referrerTenantId: string,
): Promise<ReferralRule | null> {
  const personal = await db.referralRule.findFirst({
    where: { tenantId: referrerTenantId, isActive: true },
  });
  if (personal) return personal;
  return db.referralRule.findFirst({
    where: { tenantId: null, isDefault: true, isActive: true },
  });
}

export function generateCampaignCode(name: string): string {
  const base =
    name
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(0, 5)
      .toUpperCase() || 'PRJ';
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${base}${suffix}`;
}

export async function resolveReferralAttribution(
  prisma: ReferralDb,
  code: string,
): Promise<ReferralAttribution | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const campaign = await prisma.referralCampaign.findUnique({
    where: { code: trimmed },
    select: { id: true, tenantId: true, isActive: true },
  });
  if (campaign?.isActive) {
    return { referrerTenantId: campaign.tenantId, campaignId: campaign.id };
  }

  const main = await prisma.referralCode.findUnique({
    where: { code: trimmed },
    select: { tenantId: true, isActive: true },
  });
  if (main?.isActive) {
    return { referrerTenantId: main.tenantId, campaignId: null };
  }

  return null;
}

export async function incrementReferralClick(
  prisma: ReferralDb,
  code: string,
): Promise<boolean> {
  const trimmed = code.trim();
  const campaign = await prisma.referralCampaign.findUnique({
    where: { code: trimmed },
    select: { id: true, isActive: true },
  });
  if (campaign?.isActive) {
    await prisma.referralCampaign.update({
      where: { id: campaign.id },
      data: { clicksCount: { increment: 1 } },
    });
    return true;
  }

  const main = await prisma.referralCode.findUnique({
    where: { code: trimmed },
    select: { id: true, isActive: true },
  });
  if (main?.isActive) {
    await prisma.referralCode.update({
      where: { id: main.id },
      data: { clicksCount: { increment: 1 } },
    });
    return true;
  }

  return false;
}

type WithdrawalRow = {
  id: string;
  amountRub: unknown;
  status: string;
  payoutDetails: string;
  comment: string | null;
  decisionNote: string | null;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Единая форма заявки на вывод для кабинета партнёра и админки. */
export function withdrawalShape(w: WithdrawalRow) {
  return {
    id: w.id,
    amountRub: Number(w.amountRub),
    status: w.status,
    payoutDetails: w.payoutDetails,
    comment: w.comment,
    decisionNote: w.decisionNote,
    createdAt: w.createdAt.toISOString(),
    decidedAt: w.decidedAt?.toISOString() ?? null,
  };
}

export type HoldReleaseResult = {
  released: boolean;
  tenantId: string | null;
  balanceRub: number | null;
};

/**
 * Освободить резерв партнёрского баланса под неоплаченный счёт.
 * Резерв освобождаем только пока `Payment.status = 'pending'` и `balanceAppliedRub > 0`:
 * платёж переводим в `cancelled`, `balanceAppliedRub` возвращаем на `TenantBalance`.
 * `Payment.amount` не трогаем. Условный `updateMany` гарантирует возврат не более одного раза.
 */
export async function releaseBalanceHold(
  prisma: PrismaClient,
  paymentId: string,
  tenantId?: string,
): Promise<HoldReleaseResult> {
  const miss: HoldReleaseResult = { released: false, tenantId: null, balanceRub: null };

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({
      where: {
        id: paymentId,
        ...(tenantId ? { tenantId } : {}),
        status: 'pending',
        balanceAppliedRub: { gt: 0 },
      },
      select: { id: true, tenantId: true, balanceAppliedRub: true },
    });
    if (!payment) return miss;

    const released = await tx.payment.updateMany({
      where: { id: payment.id, status: 'pending', balanceAppliedRub: { gt: 0 } },
      data: { status: 'cancelled' },
    });
    if (released.count === 0) return miss;

    const balance = await tx.tenantBalance.upsert({
      where: { tenantId: payment.tenantId },
      create: { tenantId: payment.tenantId, balanceRub: payment.balanceAppliedRub },
      update: { balanceRub: { increment: payment.balanceAppliedRub } },
    });

    return {
      released: true,
      tenantId: payment.tenantId,
      balanceRub: Number(balance.balanceRub),
    };
  });
}

export function parsePeriod(fromRaw?: string, toRaw?: string): { from: Date; to: Date } {
  const now = new Date();
  const to = toRaw ? new Date(toRaw) : now;
  const from = fromRaw
    ? new Date(fromRaw)
    : new Date(to.getFullYear(), to.getMonth(), 1);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw Object.assign(new Error('Invalid from/to date'), { statusCode: 400 });
  }
  const toEnd = new Date(to);
  toEnd.setHours(23, 59, 59, 999);
  return { from, to: toEnd };
}

export async function buildReferralDashboard(
  prisma: PrismaClient,
  tenantId: string,
  voxlyDomain: string,
  opts: { from?: string; to?: string },
) {
  const { from, to } = parsePeriod(opts.from, opts.to);

  const [
    mainCode,
    balance,
    campaigns,
    referrals,
    earningsInPeriod,
    expensesInPeriod,
    rule,
    holds,
    withdrawals,
    transactions,
    payoutTotal,
  ] = await Promise.all([
    prisma.referralCode.findUnique({ where: { tenantId } }),
    prisma.tenantBalance.findUnique({ where: { tenantId } }),
    prisma.referralCampaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.referral.findMany({
      where: { referrerTenantId: tenantId },
      include: {
        referredTenant: { select: { slug: true, status: true, createdAt: true } },
        campaign: { select: { id: true, name: true, code: true } },
        earnings: true,
      },
      orderBy: { attributedAt: 'desc' },
    }),
    prisma.referralEarning.findMany({
      where: {
        tenantId,
        creditedAt: { gte: from, lte: to },
      },
    }),
    prisma.referralCampaignExpense.findMany({
      where: {
        tenantId,
        spentAt: { gte: from, lte: to },
      },
    }),
    resolveRuleForReferrer(prisma, tenantId),
    // Активные резервы: неоплаченные счета, частично закрытые партнёрским балансом
    prisma.payment.findMany({
      where: { tenantId, status: 'pending', balanceAppliedRub: { gt: 0 } },
      select: {
        id: true,
        robokassaInvId: true,
        balanceAppliedRub: true,
        description: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.referralWithdrawal.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.referralTransaction.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }),
    // Выплачено считаем за всё время на сервере: срез transactions[] по периоду
    // или количеству не должен занижать итог в кабинете
    prisma.referralTransaction.aggregate({
      where: { tenantId, kind: 'payout' },
      _sum: { amountRub: true },
    }),
  ]);

  if (!mainCode) {
    throw Object.assign(new Error('No referral code found'), { statusCode: 404 });
  }

  const linkFor = (code: string) => `https://${voxlyDomain}/r/${code}`;

  const campaignStats = campaigns.map((c) => {
    const campRefs = referrals.filter((r) => r.campaignId === c.id);
    const regsInPeriod = campRefs.filter(
      (r) => r.attributedAt >= from && r.attributedAt <= to,
    ).length;
    const paidInPeriod = campRefs.filter(
      (r) => r.firstPaymentAt && r.firstPaymentAt >= from && r.firstPaymentAt <= to,
    ).length;
    const pending = campRefs.filter((r) => !r.firstPaymentAt).length;
    const earnedRub = earningsInPeriod
      .filter((e) => campRefs.some((r) => r.id === e.referralId))
      .reduce((s, e) => s + Number(e.amountRub), 0);
    const expensesRub = expensesInPeriod
      .filter((e) => e.campaignId === c.id)
      .reduce((s, e) => s + Number(e.amountRub), 0);

    return {
      id: c.id,
      name: c.name,
      code: c.code,
      link: linkFor(c.code),
      isActive: c.isActive,
      clicksCount: c.clicksCount,
      registrations: regsInPeriod,
      paid: paidInPeriod,
      pending,
      earnedRub: Math.round(earnedRub),
      expensesRub: Math.round(expensesRub),
      netRub: Math.round(earnedRub - expensesRub),
    };
  });

  const mainRefs = referrals.filter((r) => !r.campaignId);
  const mainRegs = mainRefs.filter(
    (r) => r.attributedAt >= from && r.attributedAt <= to,
  ).length;
  const mainPaid = mainRefs.filter(
    (r) => r.firstPaymentAt && r.firstPaymentAt >= from && r.firstPaymentAt <= to,
  ).length;
  const mainPending = mainRefs.filter((r) => !r.firstPaymentAt).length;
  const mainEarned = earningsInPeriod
    .filter((e) => mainRefs.some((r) => r.id === e.referralId))
    .reduce((s, e) => s + Number(e.amountRub), 0);

  const totalEarnedPeriod = Math.round(
    earningsInPeriod.reduce((s, e) => s + Number(e.amountRub), 0),
  );
  const totalExpensesPeriod = Math.round(
    expensesInPeriod.reduce((s, e) => s + Number(e.amountRub), 0),
  );
  const totalPending = referrals.filter((r) => !r.firstPaymentAt).length;

  const totalClicks =
    mainCode.clicksCount + campaigns.reduce((s, c) => s + c.clicksCount, 0);

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    rule: rule
      ? {
          type: rule.type,
          value: Number(rule.value),
          durationMonths: rule.durationMonths,
        }
      : null,
    mainCode: {
      code: mainCode.code,
      link: linkFor(mainCode.code),
      clicksCount: mainCode.clicksCount,
      isActive: mainCode.isActive,
      registrations: mainRegs,
      paid: mainPaid,
      pending: mainPending,
      earnedRub: Math.round(mainEarned),
      expensesRub: 0,
      netRub: Math.round(mainEarned),
    },
    // Свободный остаток: резервы и заявки на вывод уже списаны с него
    balanceRub: Number(balance?.balanceRub ?? 0),
    heldRub: Math.round(holds.reduce((s, p) => s + Number(p.balanceAppliedRub), 0) * 100) / 100,
    minWithdrawalRub: REFERRAL_WITHDRAWAL_MIN_RUB,
    paidOutRub: Math.round(Number(payoutTotal._sum.amountRub ?? 0) * 100) / 100,
    holds: holds.map((p) => ({
      paymentId: p.id,
      invId: p.robokassaInvId,
      amountRub: Number(p.balanceAppliedRub),
      description: p.description,
      createdAt: p.createdAt.toISOString(),
    })),
    withdrawals: withdrawals.map(withdrawalShape),
    transactions: transactions.map((t) => ({
      id: t.id,
      kind: t.kind,
      amountRub: Number(t.amountRub),
      note: t.note,
      createdAt: t.createdAt.toISOString(),
    })),
    totalEarnedAllTime: referrals.reduce(
      (s, r) => s + r.earnings.reduce((es, e) => es + Number(e.amountRub), 0),
      0,
    ),
    summary: {
      clicksNote:
        'Переходы — накопительно по ссылкам (без разбивки по датам в v1)',
      clicksTotal: totalClicks,
      registrations: referrals.filter(
        (r) => r.attributedAt >= from && r.attributedAt <= to,
      ).length,
      paid: referrals.filter(
        (r) => r.firstPaymentAt && r.firstPaymentAt >= from && r.firstPaymentAt <= to,
      ).length,
      pending: totalPending,
      earnedRub: totalEarnedPeriod,
      expensesRub: totalExpensesPeriod,
      netRub: totalEarnedPeriod - totalExpensesPeriod,
    },
    campaigns: campaignStats,
    expenses: expensesInPeriod.map((e) => ({
      id: e.id,
      campaignId: e.campaignId,
      amountRub: Number(e.amountRub),
      note: e.note,
      spentAt: e.spentAt.toISOString(),
    })),
    referrals: referrals
      .filter((r) => r.attributedAt >= from && r.attributedAt <= to)
      .slice(0, 50)
      .map((r) => ({
        id: r.id,
        referredSlug: r.referredTenant.slug,
        campaignName: r.campaign?.name ?? 'Основная ссылка',
        attributedAt: r.attributedAt.toISOString(),
        firstPaymentAt: r.firstPaymentAt?.toISOString() ?? null,
        status: r.status,
        earnedRub: r.earnings.reduce((s, e) => s + Number(e.amountRub), 0),
      })),
  };
}
