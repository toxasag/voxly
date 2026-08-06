/**
 * CRM hard-access gate: load tenant + crm_base and evaluate (shared rules).
 * Also syncs Twenty workspace activationStatus for direct-login lock.
 */
import type { PrismaClient } from '@voxly/db';
import {
  evaluateCrmAccess,
  type CrmAccessEvaluation,
  PRODUCT_CODES,
} from '@voxly/shared';
import { setTwentyWorkspaceActivation } from './twenty-workspace-activation.js';

export type { CrmAccessEvaluation };

export async function loadCrmAccessForTenant(
  prisma: PrismaClient,
  tenantId: string,
  now = new Date(),
): Promise<{
  tenant: {
    id: string;
    status: string;
    twentyWorkspaceId: string | null;
  } | null;
  evaluation: CrmAccessEvaluation;
}> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, status: true, twentyWorkspaceId: true },
  });
  if (!tenant) {
    return {
      tenant: null,
      evaluation: evaluateCrmAccess({
        tenantStatus: 'cancelled',
        crmSubscription: null,
        now,
      }),
    };
  }

  const crmSub = await prisma.subscription.findFirst({
    where: {
      tenantId,
      productCode: PRODUCT_CODES.CRM_BASE,
      status: 'active',
    },
    orderBy: { endsAt: 'desc' },
    select: { status: true, endsAt: true, periodMonths: true },
  });

  return {
    tenant,
    evaluation: evaluateCrmAccess({
      tenantStatus: tenant.status,
      crmSubscription: crmSub,
      now,
    }),
  };
}

/** Deny helper for routes: returns evaluation when locked, else null. */
export async function assertCrmAccessAllowed(
  prisma: PrismaClient,
  tenantId: string,
  now = new Date(),
): Promise<CrmAccessEvaluation | null> {
  const { evaluation } = await loadCrmAccessForTenant(prisma, tenantId, now);
  return evaluation.locked ? evaluation : null;
}

/** Reversible Twenty gate: INACTIVE blocks direct email/password login. */
export async function syncTwentyCrmLock(
  twentyWorkspaceId: string | null | undefined,
  lock: boolean,
): Promise<void> {
  if (!twentyWorkspaceId) return;
  await setTwentyWorkspaceActivation(twentyWorkspaceId, lock ? 'INACTIVE' : 'ACTIVE');
}
