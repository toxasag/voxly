import bcrypt from 'bcryptjs';
import { prisma } from '@voxly/db';
import { PRODUCT_CODES } from '@voxly/shared';

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

export async function createTenantWithOwner(opts?: {
  email?: string;
  role?: 'owner' | 'member';
  slug?: string;
}) {
  const slug = opts?.slug || uniq('t');
  const email = opts?.email || `${uniq('u')}@test.local`;
  const passwordHash = await bcrypt.hash('password123', 4);
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      portalHost: `${slug}.getvoxly.ru`,
      status: 'active',
    },
  });
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'Test',
      lastName: 'Owner',
      role: 'owner',
    },
  });
  const membership = await prisma.tenantMember.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      role: opts?.role || 'owner',
    },
  });
  await prisma.tenantBalance.create({
    data: { tenantId: tenant.id, balanceRub: 0 },
  });
  await prisma.aiWallet.create({
    data: { tenantId: tenant.id, balanceRub: 100 },
  });
  return { tenant, user, membership, email, password: 'password123' };
}

export async function createPendingPayment(input: {
  tenantId: string;
  amount: number;
  productCode?: string;
  balanceAppliedRub?: number;
  invId?: number;
}) {
  const invId = input.invId ?? Math.floor(Math.random() * 1_000_000_000) + 1;
  return prisma.payment.create({
    data: {
      tenantId: input.tenantId,
      robokassaInvId: invId,
      amount: input.amount,
      balanceAppliedRub: input.balanceAppliedRub ?? 0,
      status: 'pending',
      productCode: input.productCode || PRODUCT_CODES.CRM_BASE,
      periodMonths: 1,
      description: 'test payment',
      idempotencyKey: uniq('pay'),
      shpTenantId: input.tenantId,
    },
  });
}

export async function cleanupTenant(tenantId: string) {
  await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);
}
