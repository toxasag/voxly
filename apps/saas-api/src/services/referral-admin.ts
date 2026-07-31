// Admin-side aggregation of the referral program: partners overview, partner detail, effective rule

import type { PrismaClient, ReferralRule } from '@voxly/db';
import { REFERRAL_PRODUCT_SCOPES } from '@voxly/shared';
import {
  parsePeriod,
  resolveRuleForReferrer,
  withdrawalShape,
  type RuleDb,
} from './referral-program.js';

export { resolveRuleForReferrer };

export const MAIN_LINK_LABEL = 'Основная ссылка';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function ruleShape(rule: ReferralRule | null, isOverride: boolean) {
  if (!rule) {
    return {
      type: 'none',
      value: 0,
      durationMonths: null as number | null,
      productScope: REFERRAL_PRODUCT_SCOPES.ALL as string,
      isOverride: false,
    };
  }
  return {
    type: rule.type as string,
    value: Number(rule.value),
    durationMonths: rule.durationMonths,
    productScope: rule.productScope,
    isOverride,
  };
}

/** The single global rule. `findFirst` order is fixed so every caller resolves the same row. */
export function findGlobalRule(db: RuleDb): Promise<ReferralRule | null> {
  return db.referralRule.findFirst({
    where: { tenantId: null, isDefault: true },
    orderBy: { createdAt: 'asc' },
  });
}

export async function resolveEffectiveRuleShape(db: RuleDb, tenantId: string) {
  const personal = await db.referralRule.findFirst({
    where: { tenantId, isActive: true },
  });
  if (personal) return ruleShape(personal, true);
  return ruleShape(await findGlobalRule(db), false);
}

export async function buildReferralAdminOverview(
  prisma: PrismaClient,
  opts: { from?: string; to?: string },
) {
  const { from, to } = parsePeriod(opts.from, opts.to);
  const inPeriod = (d: Date | null) => Boolean(d && d >= from && d <= to);

  const [
    defaultRule,
    codes,
    campaigns,
    referrals,
    earnings,
    transactions,
    balances,
    personalRules,
    pendingWithdrawals,
  ] = await Promise.all([
    findGlobalRule(prisma),
    prisma.referralCode.findMany({
      select: { tenantId: true, code: true, isActive: true, clicksCount: true },
    }),
    prisma.referralCampaign.findMany({
      select: { tenantId: true, isActive: true, clicksCount: true },
    }),
    prisma.referral.findMany({
      select: { referrerTenantId: true, attributedAt: true, firstPaymentAt: true },
    }),
    prisma.referralEarning.findMany({
      select: { tenantId: true, amountRub: true, creditedAt: true },
    }),
    prisma.referralTransaction.findMany({
      select: { tenantId: true, kind: true, amountRub: true, createdAt: true },
    }),
    prisma.tenantBalance.findMany({ select: { tenantId: true, balanceRub: true } }),
    prisma.referralRule.findMany({ where: { tenantId: { not: null }, isActive: true } }),
    prisma.referralWithdrawal.findMany({
      where: { status: 'pending' },
      select: { tenantId: true, amountRub: true },
    }),
  ]);

  const partnerIds = new Set<string>([
    ...codes.map((c) => c.tenantId),
    ...referrals.map((r) => r.referrerTenantId),
  ]);

  const tenants = await prisma.tenant.findMany({
    where: { id: { in: [...partnerIds] } },
    select: {
      id: true,
      slug: true,
      users: {
        where: { role: 'owner' },
        take: 1,
        select: { user: { select: { email: true } } },
      },
    },
  });

  const codeByTenant = new Map(codes.map((c) => [c.tenantId, c]));
  const balanceByTenant = new Map(balances.map((b) => [b.tenantId, Number(b.balanceRub)]));
  const personalRuleByTenant = new Map(personalRules.map((r) => [r.tenantId as string, r]));
  const globalShape = ruleShape(defaultRule, false);

  const partners = tenants
    .map((tenant) => {
      const code = codeByTenant.get(tenant.id) ?? null;
      const tenantCampaigns = campaigns.filter((c) => c.tenantId === tenant.id);
      const tenantRefs = referrals.filter((r) => r.referrerTenantId === tenant.id);
      const tenantEarnings = earnings.filter((e) => e.tenantId === tenant.id);
      const campaignsActive = tenantCampaigns.filter((c) => c.isActive).length;
      const personal = personalRuleByTenant.get(tenant.id) ?? null;

      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        ownerEmail: tenant.users[0]?.user.email ?? null,
        code: code?.code ?? null,
        codeActive: Boolean(code?.isActive),
        campaignsCount: tenantCampaigns.length,
        campaignsActive,
        clicks:
          (code?.clicksCount ?? 0) + tenantCampaigns.reduce((s, c) => s + c.clicksCount, 0),
        referrals: tenantRefs.filter((r) => inPeriod(r.attributedAt)).length,
        paid: tenantRefs.filter((r) => inPeriod(r.firstPaymentAt)).length,
        pending: tenantRefs.filter((r) => !r.firstPaymentAt).length,
        earnedPeriodRub: round2(
          tenantEarnings
            .filter((e) => inPeriod(e.creditedAt))
            .reduce((s, e) => s + Number(e.amountRub), 0),
        ),
        earnedAllTimeRub: round2(
          tenantEarnings.reduce((s, e) => s + Number(e.amountRub), 0),
        ),
        balanceRub: round2(balanceByTenant.get(tenant.id) ?? 0),
        paidOutRub: round2(
          transactions
            .filter((t) => t.tenantId === tenant.id && t.kind === 'payout')
            .reduce((s, t) => s + Number(t.amountRub), 0),
        ),
        pendingWithdrawalRub: round2(
          pendingWithdrawals
            .filter((w) => w.tenantId === tenant.id)
            .reduce((s, w) => s + Number(w.amountRub), 0),
        ),
        rule: personal ? ruleShape(personal, true) : globalShape,
        blocked: !code?.isActive && campaignsActive === 0,
      };
    })
    .sort((a, b) => b.earnedPeriodRub - a.earnedPeriodRub || a.slug.localeCompare(b.slug));

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    defaultRule: defaultRule
      ? {
          id: defaultRule.id,
          type: defaultRule.type,
          value: Number(defaultRule.value),
          durationMonths: defaultRule.durationMonths,
          productScope: defaultRule.productScope,
          isActive: defaultRule.isActive,
        }
      : null,
    summary: {
      partnersTotal: partnerIds.size,
      partnersActive: partners.filter((p) => p.referrals > 0).length,
      referralsTotal: referrals.filter((r) => inPeriod(r.attributedAt)).length,
      paidTotal: referrals.filter((r) => inPeriod(r.firstPaymentAt)).length,
      earnedRub: round2(
        earnings
          .filter((e) => inPeriod(e.creditedAt))
          .reduce((s, e) => s + Number(e.amountRub), 0),
      ),
      paidOutRub: round2(
        transactions
          .filter((t) => t.kind === 'payout' && inPeriod(t.createdAt))
          .reduce((s, t) => s + Number(t.amountRub), 0),
      ),
      balanceOwedRub: round2(balances.reduce((s, b) => s + Number(b.balanceRub), 0)),
      pendingWithdrawalsCount: pendingWithdrawals.length,
      pendingWithdrawalsRub: round2(
        pendingWithdrawals.reduce((s, w) => s + Number(w.amountRub), 0),
      ),
      clicksTotal:
        codes.reduce((s, c) => s + c.clicksCount, 0) +
        campaigns.reduce((s, c) => s + c.clicksCount, 0),
    },
    partners,
  };
}

export async function buildReferralPartnerDetail(prisma: PrismaClient, tenantId: string) {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      slug: true,
      status: true,
      users: {
        where: { role: 'owner' },
        take: 1,
        select: { user: { select: { email: true } } },
      },
    },
  });
  if (!tenant) {
    throw Object.assign(new Error('Партнёр не найден'), { statusCode: 404 });
  }

  const [
    mainCode,
    campaigns,
    referrals,
    balance,
    transactions,
    rule,
    withdrawals,
  ] = await Promise.all([
    prisma.referralCode.findUnique({ where: { tenantId } }),
    prisma.referralCampaign.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }),
    prisma.referral.findMany({
      where: { referrerTenantId: tenantId },
      include: {
        referredTenant: { select: { slug: true } },
        campaign: { select: { name: true } },
        earnings: { select: { amountRub: true } },
      },
      orderBy: { attributedAt: 'desc' },
    }),
    prisma.tenantBalance.findUnique({ where: { tenantId } }),
    prisma.referralTransaction.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }),
    resolveEffectiveRuleShape(prisma, tenantId),
    prisma.referralWithdrawal.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const earnedOf = (referralIds: Set<string>) =>
    round2(
      referrals
        .filter((r) => referralIds.has(r.id))
        .reduce((s, r) => s + r.earnings.reduce((es, e) => es + Number(e.amountRub), 0), 0),
    );

  return {
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      ownerEmail: tenant.users[0]?.user.email ?? null,
      status: tenant.status,
    },
    rule,
    balanceRub: round2(Number(balance?.balanceRub ?? 0)),
    earnedAllTimeRub: earnedOf(new Set(referrals.map((r) => r.id))),
    paidOutRub: round2(
      transactions
        .filter((t) => t.kind === 'payout')
        .reduce((s, t) => s + Number(t.amountRub), 0),
    ),
    mainCode: mainCode
      ? {
          id: mainCode.id,
          code: mainCode.code,
          isActive: mainCode.isActive,
          clicksCount: mainCode.clicksCount,
        }
      : null,
    campaigns: campaigns.map((c) => {
      const campRefs = referrals.filter((r) => r.campaignId === c.id);
      return {
        id: c.id,
        name: c.name,
        code: c.code,
        isActive: c.isActive,
        clicksCount: c.clicksCount,
        referrals: campRefs.length,
        paid: campRefs.filter((r) => r.firstPaymentAt).length,
        earnedRub: earnedOf(new Set(campRefs.map((r) => r.id))),
      };
    }),
    referrals: referrals.map((r) => ({
      id: r.id,
      referredTenantId: r.referredTenantId,
      referredSlug: r.referredTenant.slug,
      campaignId: r.campaignId,
      campaignName: r.campaign?.name ?? MAIN_LINK_LABEL,
      attributedAt: r.attributedAt.toISOString(),
      firstPaymentAt: r.firstPaymentAt?.toISOString() ?? null,
      status: r.status,
      earnedRub: round2(r.earnings.reduce((s, e) => s + Number(e.amountRub), 0)),
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      kind: t.kind,
      amountRub: Number(t.amountRub),
      note: t.note,
      createdAt: t.createdAt.toISOString(),
    })),
    withdrawals: withdrawals.map((w) => ({
      ...withdrawalShape(w),
      tenantId: w.tenantId,
      balanceRub: round2(Number(balance?.balanceRub ?? 0)),
    })),
  };
}
