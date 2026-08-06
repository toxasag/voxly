/**
 * Read-only unit-economics report for a control-plane DATABASE_URL.
 * Usage: DATABASE_URL=... pnpm exec tsx scripts/unit-econ-report.ts [--days 30]
 */
import { PrismaClient } from '@prisma/client';

const days = (() => {
  const i = process.argv.indexOf('--days');
  return i >= 0 ? Math.max(1, parseInt(process.argv[i + 1] || '30', 10) || 30) : 30;
})();

const prisma = new PrismaClient();

async function main() {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const [usage, payments, payouts, byChannel] = await Promise.all([
    prisma.aiUsageLog.aggregate({
      where: { createdAt: { gte: since } },
      _sum: { chargedRub: true, providerCostRub: true, uncollectedRub: true },
      _count: true,
    }),
    prisma.payment.aggregate({
      where: { status: 'paid', paidAt: { gte: since } },
      _sum: { amount: true, balanceAppliedRub: true },
      _count: true,
    }),
    prisma.referralTransaction.aggregate({
      where: { kind: 'payout', createdAt: { gte: since } },
      _sum: { amountRub: true },
    }),
    prisma.aiUsageLog.groupBy({
      by: ['channel'],
      where: { createdAt: { gte: since } },
      _sum: { chargedRub: true, providerCostRub: true },
      _count: true,
    }),
  ]);

  const charged = Number(usage._sum.chargedRub ?? 0);
  const cost = Number(usage._sum.providerCostRub ?? 0);
  const uncollected = Number(usage._sum.uncollectedRub ?? 0);
  const revenue = Number(payments._sum.amount ?? 0) + Number(payments._sum.balanceAppliedRub ?? 0);
  const partnerPayouts = Number(payouts._sum.amountRub ?? 0);
  const margin = charged - cost;
  const dialogCost =
    usage._count > 0 ? Math.round((charged / usage._count) * 100) / 100 : 0;

  console.log(JSON.stringify({
    periodDays: days,
    since: since.toISOString(),
    ai: {
      events: usage._count,
      chargedRub: charged,
      providerCostRub: cost,
      marginRub: Math.round(margin * 100) / 100,
      uncollectedRub: uncollected,
      avgChargedPerEventRub: dialogCost,
      byChannel: byChannel.map((r) => ({
        channel: r.channel ?? 'unknown',
        events: r._count,
        chargedRub: Number(r._sum.chargedRub ?? 0),
        providerCostRub: Number(r._sum.providerCostRub ?? 0),
      })),
    },
    payments: {
      count: payments._count,
      cashRub: Number(payments._sum.amount ?? 0),
      balanceAppliedRub: Number(payments._sum.balanceAppliedRub ?? 0),
      grossRub: revenue,
    },
    partnerPayoutsRub: partnerPayouts,
    partnerPayoutShareOfRevenue:
      revenue > 0 ? Math.round((partnerPayouts / revenue) * 10000) / 100 : 0,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
