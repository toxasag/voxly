// Scheduled jobs: grace period checker, subscription expiry, AI balance alerts

import { GRACE_PERIOD_DAYS } from '@voxly/shared';
import { withSchedulerLock } from './scheduler-lock.js';

// In production, use BullMQ with Redis. For now, simple setInterval-based scheduler
// with a Redis NX lock so multiple saas-api replicas do not double-run jobs.

let intervals: NodeJS.Timeout[] = [];

/** Wrap an async job so timer callbacks never produce unhandled rejections. */
function safeJob(name: string, fn: () => Promise<void>, ttlSeconds: number): () => void {
  return () => {
    withSchedulerLock(name, ttlSeconds, fn).catch((err) =>
      console.warn(`[scheduler] ${name} failed`, err),
    );
  };
}

export function startScheduledJobs() {
  // Check expired subscriptions every hour
  const subInterval = setInterval(
    safeJob('check-expired-subscriptions', checkExpiredSubscriptions, 50 * 60),
    60 * 60 * 1000,
  );
  intervals.push(subInterval);

  // Check AI wallet balance alerts every 6 hours
  const aiInterval = setInterval(
    safeJob('check-ai-wallet-alerts', checkAiWalletAlerts, 5 * 60 * 60),
    6 * 60 * 60 * 1000,
  );
  intervals.push(aiInterval);

  // Won-deal sales learning for AI agents (~10 min)
  const salesLearnInterval = setInterval(
    safeJob(
      'ingest-won-deals',
      async () => {
        const m = await import('../services/ai-sales-learn.js');
        await m.ingestWonDealsAllTenants();
      },
      8 * 60,
    ),
    10 * 60 * 1000,
  );
  intervals.push(salesLearnInterval);

  // Gift project schedules: start/stop by window (every minute)
  const giftScheduleInterval = setInterval(
    safeJob('sync-gift-campaign-schedules', syncGiftCampaignSchedules, 50),
    60 * 1000,
  );
  intervals.push(giftScheduleInterval);

  // Release abandoned partner-balance holds every hour
  const holdSweepInterval = setInterval(
    safeJob('release-stale-balance-holds', releaseStaleBalanceHolds, 50 * 60),
    60 * 60 * 1000,
  );
  intervals.push(holdSweepInterval);

  // Run initial check after 10 seconds
  setTimeout(safeJob('check-expired-subscriptions', checkExpiredSubscriptions, 50 * 60), 10_000);
  setTimeout(safeJob('sync-gift-campaign-schedules', syncGiftCampaignSchedules, 50), 15_000);
  setTimeout(safeJob('release-stale-balance-holds', releaseStaleBalanceHolds, 50 * 60), 30_000);
  setTimeout(
    safeJob(
      'ingest-won-deals',
      async () => {
        const m = await import('../services/ai-sales-learn.js');
        await m.ingestWonDealsAllTenants();
      },
      8 * 60,
    ),
    45_000,
  );
}

export function stopScheduledJobs() {
  intervals.forEach(clearInterval);
  intervals = [];
}

async function checkExpiredSubscriptions() {
  // Dynamic import to avoid circular deps
  const { prisma } = await import('@voxly/db');
  const { syncTwentyCrmLock } = await import('../services/crm-access.js');
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
      if (hasPaidSubscription === 0) {
        await syncTwentyCrmLock(sub.tenant.twentyWorkspaceId, true);
      }
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
      await syncTwentyCrmLock(sub.tenant.twentyWorkspaceId, true);
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

const HOLD_TTL_MS = 24 * 60 * 60 * 1000;

/** Return the partner balance from holds abandoned on unpaid invoices older than 24h. */
async function releaseStaleBalanceHolds() {
  const { prisma } = await import('@voxly/db');
  const { releaseBalanceHold } = await import('../services/referral-program.js');

  const stale = await prisma.payment.findMany({
    where: {
      status: 'pending',
      balanceAppliedRub: { gt: 0 },
      createdAt: { lt: new Date(Date.now() - HOLD_TTL_MS) },
    },
    select: { id: true },
  });

  for (const payment of stale) {
    const result = await releaseBalanceHold(prisma, payment.id);
    if (result.released) {
      console.log(`[scheduler] Released stale balance hold on payment ${payment.id}`);
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
    take: 5_000,
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
