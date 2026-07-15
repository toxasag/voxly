// Provisioning service: enqueue workspace provisioning via BullMQ

import { prisma } from '@voxly/db';
import { enqueueProvisioning } from '../jobs/queues.js';

export interface ProvisioningParams {
  tenantId: string;
  workspaceName: string;
  subdomain: string;
  ownerEmail: string;
  ownerPassword: string;
  ownerFirstName?: string;
  ownerLastName?: string;
}

/**
 * Enqueue workspace provisioning as a background job (BullMQ).
 * The actual provisioning happens in the worker (jobs/queues.ts).
 */
export async function provisionWorkspace(params: ProvisioningParams) {
  // Mark tenant as provisioning
  await prisma.tenant.update({
    where: { id: params.tenantId },
    data: { status: 'provisioning' },
  });

  // Enqueue async job
  await enqueueProvisioning({
    tenantId: params.tenantId,
    ownerEmail: params.ownerEmail,
    ownerFirstName: params.ownerFirstName,
    workspaceName: params.workspaceName,
    slug: params.subdomain,
  });

  return { status: 'queued', tenantId: params.tenantId };
}

/**
 * Generate a temporary password for the workspace owner
 * (They'll set their own password on first login to Twenty)
 */
export function generateTempPassword(): string {
  return Math.random().toString(36).slice(2, 14) + Math.random().toString(36).slice(2, 6);
}

