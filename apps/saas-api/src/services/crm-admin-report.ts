import type { PrismaClient } from '@voxly/db';

export type CrmAdminReport = {
  period: { from: string; to: string };
  summary: {
    totalCrmTenants: number;
    onTrial: number;
    paidActive: number;
    expiredOrSuspended: number;
  };
  revenue: {
    crmBase: { count: number; totalRub: number };
    extraSeat: { count: number; totalRub: number; seatsPurchased: number };
    totalRub: number;
  };
  payments: Array<{
    id: string;
    paidAt: string;
    tenantId: string;
    tenantSlug: string;
    productCode: string;
    amountRub: number;
    periodMonths: number | null;
    description: string;
  }>;
};

function parseReportRange(fromRaw?: string, toRaw?: string): { from: Date; to: Date } {
  const now = new Date();
  const to = toRaw ? new Date(toRaw) : now;
  const from = fromRaw
    ? new Date(fromRaw)
    : new Date(to.getFullYear(), to.getMonth(), 1);

  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw Object.assign(new Error('Invalid from/to date'), { statusCode: 400 });
  }
  if (from > to) {
    throw Object.assign(new Error('from must be before to'), { statusCode: 400 });
  }

  const toEnd = new Date(to);
  toEnd.setHours(23, 59, 59, 999);
  return { from, to: toEnd };
}

function isTrialTenant(
  status: string,
  sub: { periodMonths: number; endsAt: Date; status: string } | null,
  now: Date,
): boolean {
  if (sub && sub.periodMonths > 0 && sub.status === 'active' && sub.endsAt >= now) {
    return false;
  }
  if (!sub) return status === 'trial';
  return sub.periodMonths === 0;
}

function isPaidActive(
  status: string,
  sub: { periodMonths: number; endsAt: Date; status: string } | null,
  now: Date,
): boolean {
  if (status === 'suspended' || status === 'cancelled') return false;
  return Boolean(
    sub &&
      sub.status === 'active' &&
      sub.periodMonths > 0 &&
      sub.endsAt >= now,
  );
}

export async function buildCrmAdminReport(
  prisma: PrismaClient,
  opts: { from?: string; to?: string },
): Promise<CrmAdminReport> {
  const { from, to } = parseReportRange(opts.from, opts.to);
  const now = new Date();

  const crmTenants = await prisma.tenant.findMany({
    where: { twentyWorkspaceId: { not: null } },
    select: {
      id: true,
      slug: true,
      status: true,
      subscriptions: {
        where: { productCode: 'crm_base', status: 'active' },
        orderBy: { endsAt: 'desc' },
        take: 1,
        select: { periodMonths: true, endsAt: true, status: true },
      },
    },
  });

  let onTrial = 0;
  let paidActive = 0;
  let expiredOrSuspended = 0;

  for (const t of crmTenants) {
    const sub = t.subscriptions[0] ?? null;
    if (t.status === 'suspended' || t.status === 'cancelled') {
      expiredOrSuspended += 1;
    } else if (isPaidActive(t.status, sub, now)) {
      paidActive += 1;
    } else if (isTrialTenant(t.status, sub, now)) {
      onTrial += 1;
    } else {
      expiredOrSuspended += 1;
    }
  }

  const payments = await prisma.payment.findMany({
    where: {
      status: 'paid',
      productCode: { in: ['crm_base', 'extra_seat'] },
      paidAt: { gte: from, lte: to },
    },
    include: { tenant: { select: { slug: true } } },
    orderBy: { paidAt: 'desc' },
  });

  let crmBaseTotal = 0;
  let crmBaseCount = 0;
  let extraSeatTotal = 0;
  let extraSeatCount = 0;
  let seatsPurchased = 0;

  for (const p of payments) {
    const amount = Number(p.amount);
    if (p.productCode === 'crm_base') {
      crmBaseCount += 1;
      crmBaseTotal += amount;
    } else if (p.productCode === 'extra_seat') {
      extraSeatCount += 1;
      extraSeatTotal += amount;
      const qtyMatch = p.description.match(/×(\d+)/);
      seatsPurchased += qtyMatch ? parseInt(qtyMatch[1], 10) || 1 : 1;
    }
  }

  return {
    period: { from: from.toISOString(), to: to.toISOString() },
    summary: {
      totalCrmTenants: crmTenants.length,
      onTrial,
      paidActive,
      expiredOrSuspended,
    },
    revenue: {
      crmBase: { count: crmBaseCount, totalRub: Math.round(crmBaseTotal) },
      extraSeat: {
        count: extraSeatCount,
        totalRub: Math.round(extraSeatTotal),
        seatsPurchased,
      },
      totalRub: Math.round(crmBaseTotal + extraSeatTotal),
    },
    payments: payments.map((p) => ({
      id: p.id,
      paidAt: (p.paidAt ?? p.createdAt).toISOString(),
      tenantId: p.tenantId,
      tenantSlug: p.tenant.slug,
      productCode: p.productCode,
      amountRub: Number(p.amount),
      periodMonths: p.periodMonths,
      description: p.description,
    })),
  };
}
