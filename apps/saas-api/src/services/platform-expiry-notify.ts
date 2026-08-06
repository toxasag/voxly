import type { PrismaClient } from '@voxly/db';
import { sendPlatformTelegramMessage } from './platform-telegram.js';

/**
 * Notify owners whose CRM trial/paid subscription ends within `days`.
 * Dedupes via AuditLog action platform_expiry_notify:{subId}:{dayBucket}.
 */
export async function notifyExpiringSubscriptions(
  prisma: PrismaClient,
  opts: { days: number; kind: 'trial' | 'paid' | 'both'; force?: boolean },
): Promise<{ notified: number; skipped: number }> {
  const now = new Date();
  const until = new Date(now);
  until.setDate(until.getDate() + opts.days);

  const periodFilter =
    opts.kind === 'trial'
      ? { periodMonths: 0 }
      : opts.kind === 'paid'
        ? { periodMonths: { gt: 0 } }
        : {};

  const subs = await prisma.subscription.findMany({
    where: {
      status: 'active',
      productCode: 'crm_base',
      endsAt: { gte: now, lte: until },
      ...periodFilter,
    },
    include: {
      tenant: {
        include: {
          users: {
            where: { role: 'owner' },
            include: { user: true },
            take: 1,
          },
        },
      },
    },
  });

  let notified = 0;
  let skipped = 0;
  const dayBucket = now.toISOString().slice(0, 10);

  for (const sub of subs) {
    const owner = sub.tenant.users[0]?.user;
    const tgId = owner?.telegramUserId;
    if (!tgId) {
      skipped += 1;
      continue;
    }
    const action = `platform_expiry_notify:${sub.id}:${dayBucket}`;
    if (!opts.force) {
      const already = await prisma.auditLog.findFirst({
        where: { action, tenantId: sub.tenantId },
      });
      if (already) {
        skipped += 1;
        continue;
      }
    }

    const subRow = await prisma.platformBotSubscriber.findUnique({
      where: { telegramUserId: tgId },
    });
    if (!subRow || subRow.blocked) {
      skipped += 1;
      continue;
    }

    const isTrial = sub.periodMonths === 0;
    const ends = sub.endsAt.toLocaleDateString('ru-RU');
    const text = isTrial
      ? `Voxly: тестовый период портала «${sub.tenant.slug}» заканчивается ${ends}. Оформите подписку в кабинете: https://getvoxly.ru/dashboard/crm`
      : `Voxly: оплаченный срок CRM «${sub.tenant.slug}» заканчивается ${ends}. Продлите в кабинете: https://getvoxly.ru/dashboard/crm`;

    const ok = await sendPlatformTelegramMessage(subRow.chatId, text);
    if (ok) {
      notified += 1;
      await prisma.auditLog.create({
        data: {
          tenantId: sub.tenantId,
          actorUserId: owner?.id,
          action,
          payload: { subscriptionId: sub.id, kind: isTrial ? 'trial' : 'paid', endsAt: sub.endsAt },
        },
      });
    } else {
      skipped += 1;
    }
    await new Promise((r) => setTimeout(r, 40));
  }

  return { notified, skipped };
}
