// Provisioning service: enqueue workspace provisioning via BullMQ

import { prisma } from '@voxly/db';
import { enqueueProvisioning } from '../jobs/queues.js';

export interface ProvisioningParams {
  tenantId: string;
  workspaceName: string;
  subdomain: string;
  ownerEmail: string;
  ownerPasswordEncrypted: string;
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
    ownerPasswordEncrypted: params.ownerPasswordEncrypted,
    ownerFirstName: params.ownerFirstName,
    workspaceName: params.workspaceName,
    slug: params.subdomain,
  });

  return { status: 'queued', tenantId: params.tenantId };
}


