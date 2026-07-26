// Scheduled jobs: grace period checker, subscription expiry, AI balance alerts

import { GRACE_PERIOD_DAYS } from '@voxly/shared';

// In production, use BullMQ with Redis. For now, simple setInterval-based scheduler.
// Will be replaced with BullMQ workers when Redis is available.

let intervals: NodeJS.Timeout[] = [];

export function startScheduledJobs() {
  // Check expired subscriptions every hour
  const subInterval = setInterval(checkExpiredSubscriptions, 60 * 60 * 1000);
  intervals.push(subInterval);

  // Check AI wallet balance alerts every 6 hours
  const aiInterval = setInterval(checkAiWalletAlerts, 6 * 60 * 60 * 1000);
  intervals.push(aiInterval);

  // Won-deal sales learning for AI agents (~10 min)
  const salesLearnInterval = setInterval(() => {
    void import('../services/ai-sales-learn.js')
      .then((m) => m.ingestWonDealsAllTenants())
      .catch((err) => console.warn('[scheduler] sales learn failed', err));
  }, 10 * 60 * 1000);
  intervals.push(salesLearnInterval);

  // Gift project schedules: start/stop by window (every minute)
  const giftScheduleInterval = setInterval(syncGiftCampaignSchedules, 60 * 1000);
  intervals.push(giftScheduleInterval);

  // Run initial check after 10 seconds
  setTimeout(checkExpiredSubscriptions, 10_000);
  setTimeout(syncGiftCampaignSchedules, 15_000);
  setTimeout(() => {
    void import('../services/ai-sales-learn.js')
      .then((m) => m.ingestWonDealsAllTenants())
      .catch((err) => console.warn('[scheduler] sales learn failed', err));
  }, 45_000);
}

export function stopScheduledJobs() {
  intervals.forEach(clearInterval);
  intervals = [];
}

async function checkExpiredSubscriptions() {
  // Dynamic import to avoid circular deps
  const { prisma } = await import('@voxly/db');
  const now = new Date();
  const graceEnd = new Date(now);
  graceEnd.setDate(graceEnd.getDate() - GRACE_PERIOD_DAYS);

  // Find expired subscriptions still in grace period
  const expiredInGrace = await prisma.subscription.findMany({
    where: {
      status: 'active',
      endsAt: { lt: now },
    },
    include: { tenant: true },
  });

  for (const sub of expiredInGrace) {
    // Trials end after exactly 14 days; the paid-subscription grace period
    // must not silently extend the advertised free period.
    if (sub.periodMonths === 0) {
      const hasPaidSubscription = await prisma.subscription.count({
        where: {
          tenantId: sub.tenantId,
          status: 'active',
          periodMonths: { gt: 0 },
          endsAt: { gt: now },
        },
      });

      await prisma.$transaction([
        ...(hasPaidSubscription === 0
          ? [
              prisma.tenant.update({
                where: { id: sub.tenantId },
                data: { status: 'suspended' },
              }),
            ]
          : []),
        prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'expired' },
        }),
      ]);
      console.log(`[scheduler] Trial expired for tenant ${sub.tenantId}`);
      continue;
    }

    const daysSinceExpiry = Math.floor((now.getTime() - sub.endsAt.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceExpiry >= GRACE_PERIOD_DAYS) {
      // Suspend tenant
      await prisma.tenant.update({
        where: { id: sub.tenantId },
        data: { status: 'suspended' },
      });
      await prisma.subscription.update({
        where: { id: sub.id },
        data: { status: 'expired' },
      });
      console.log(`[scheduler] Suspended tenant ${sub.tenantId} (grace period ended)`);
    } else {
      console.log(`[scheduler] Tenant ${sub.tenantId} in grace period (${daysSinceExpiry}/${GRACE_PERIOD_DAYS} days)`);
    }
  }

  // Expire addons
  await prisma.addon.updateMany({
    where: {
      status: 'active',
      activeUntil: { lt: now },
    },
    data: { status: 'expired' },
  });
}

async function checkAiWalletAlerts() {
  const { prisma } = await import('@voxly/db');

  const lowBalanceWallets = await prisma.aiWallet.findMany({
    where: { balanceRub: { lte: 100 } },
    include: { tenant: { include: { users: { include: { user: true }, where: { role: 'owner' }, take: 1 } } } },
  });

  for (const wallet of lowBalanceWallets) {
    const owner = wallet.tenant.users[0]?.user;
    if (owner) {
      console.log(`[scheduler] Low AI balance alert for ${owner.email} (${wallet.balanceRub}₽)`);
      // TODO: send email notification
    }
  }
}

/** Flip GiftCampaignConfig.isActive from scheduledStartAt / scheduledEndAt. */
async function syncGiftCampaignSchedules() {
  const { prisma } = await import('@voxly/db');
  const now = new Date();

  const campaigns = await prisma.giftCampaignConfig.findMany({
    where: {
      OR: [{ scheduledStartAt: { not: null } }, { scheduledEndAt: { not: null } }],
    },
    select: {
      id: true,
      tenantId: true,
      botInstanceId: true,
      isActive: true,
      scheduledStartAt: true,
      scheduledEndAt: true,
      name: true,
    },
  });

  for (const c of campaigns) {
    const afterStart = !c.scheduledStartAt || now.getTime() >= c.scheduledStartAt.getTime();
    const beforeEnd = !c.scheduledEndAt || now.getTime() < c.scheduledEndAt.getTime();
    const desired = afterStart && beforeEnd;
    if (c.isActive === desired) continue;

    if (desired) {
      await prisma.giftCampaignConfig.updateMany({
        where: {
          botInstanceId: c.botInstanceId,
          tenantId: c.tenantId,
          isActive: true,
          NOT: { id: c.id },
        },
        data: { isActive: false },
      });
      await prisma.giftCampaignConfig.update({
        where: { id: c.id },
        data: { isActive: true },
      });
      console.log(
        `[scheduler] Gift project «${c.name}» (${c.id}) auto-ON by schedule`,
      );
    } else {
      await prisma.giftCampaignConfig.update({
        where: { id: c.id },
        data: { isActive: false },
      });
      console.log(
        `[scheduler] Gift project «${c.name}» (${c.id}) auto-OFF by schedule`,
      );
    }
  }
}
