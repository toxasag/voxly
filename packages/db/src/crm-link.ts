import type { PrismaClient } from '@prisma/client';

/**
 * Fast link: Conversation ↔ CRM record (Person/Opportunity) for instant chat panel
 * lookup (Phase 2.1). Called by workers whenever a Conversation's twentyPersonId /
 * twentyOpportunityId changes. `listCrmChatTargets` reads this table first and
 * falls back to scanning GiftSubscriber/Conversation directly when a link is missing.
 */
export async function upsertCrmRecordLink(
  prisma: PrismaClient,
  data: {
    tenantId: string;
    conversationId: string;
    twentyPersonId?: string | null;
    twentyOpportunityId?: string | null;
    source?: 'inbound' | 'outbound' | 'backfill';
  },
): Promise<void> {
  const twentyPersonId = data.twentyPersonId || null;
  const twentyOpportunityId = data.twentyOpportunityId || null;
  if (!twentyPersonId && !twentyOpportunityId) return;

  const existing = await prisma.crmRecordLink.findFirst({
    where: { conversationId: data.conversationId },
    select: { id: true },
  });

  if (existing) {
    await prisma.crmRecordLink.update({
      where: { id: existing.id },
      data: { twentyPersonId, twentyOpportunityId },
    });
    return;
  }

  await prisma.crmRecordLink
    .create({
      data: {
        tenantId: data.tenantId,
        conversationId: data.conversationId,
        twentyPersonId,
        twentyOpportunityId,
        source: data.source || 'inbound',
      },
    })
    .catch(() => undefined); // Race with a concurrent writer — safe to ignore.
}
