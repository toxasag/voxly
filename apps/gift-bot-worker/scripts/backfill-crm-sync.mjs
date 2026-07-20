/**
 * One-off: sync GiftSubscriber rows missing Twenty Person/Opportunity ids.
 * Run inside gift-bot-worker container:
 *   node /voxly/apps/gift-bot-worker/scripts/backfill-crm-sync.mjs
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(pathToFileURL('/voxly/apps/gift-bot-worker/package.json'));

async function loadPkg(name, distRel) {
  try {
    return await import(name);
  } catch {
    return await import(pathToFileURL(`/voxly/packages/${distRel}`).href);
  }
}

const { prisma } = await loadPkg('@voxly/db', 'db/dist/index.js');
const { decrypt } = await loadPkg('@voxly/crypto', 'crypto/dist/index.js');
const { TwentyClient } = await loadPkg('@voxly/twenty-client', 'twenty-client/dist/index.js');

const apiUrl = process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql';

const subs = await prisma.giftSubscriber.findMany({
  where: {
    OR: [{ twentyPersonId: null }, { twentyOpportunityId: null }],
  },
  include: { campaign: true },
  orderBy: { updatedAt: 'desc' },
});

console.log(`[backfill] ${subs.length} subscriber(s) without full CRM link`);

for (const sub of subs) {
  const tenant = await prisma.tenant.findUnique({ where: { id: sub.tenantId } });
  if (!tenant?.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    console.warn(`[backfill] skip ${sub.username || sub.telegramId}: no CRM workspace`);
    continue;
  }
  const owner = await prisma.tenantMember.findFirst({
    where: { tenantId: sub.tenantId, role: 'owner' },
    include: { user: true },
  });
  if (!owner?.user?.email) {
    console.warn(`[backfill] skip ${sub.username || sub.telegramId}: no owner`);
    continue;
  }

  const botInstance = await prisma.botInstance.findUnique({
    where: { id: sub.botInstanceId },
  });

  const client = new TwentyClient({ apiUrl });
  await client.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );

  let personId = sub.twentyPersonId;
  if (!personId) {
    const linked = await prisma.giftSubscriber.findFirst({
      where: {
        tenantId: sub.tenantId,
        telegramId: sub.telegramId,
        twentyPersonId: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    personId = linked?.twentyPersonId;
  }
  if (!personId) {
    const found = await client.findPersonByHint({
      username: sub.username || undefined,
      telegramId: sub.telegramId,
      lastName: sub.username ? `@${sub.username.replace(/^@/, '')}` : sub.telegramId,
    });
    personId = found?.id;
  }
  if (!personId) {
    const created = await client.createPerson({
      firstName: sub.firstName || sub.username || `TG ${sub.telegramId}`,
      lastName: sub.username ? `@${sub.username.replace(/^@/, '')}` : sub.telegramId,
    });
    personId = created?.id;
  }

  let opportunityId = sub.twentyOpportunityId;
  if (!opportunityId && personId) {
    const who = sub.username ? `@${sub.username.replace(/^@/, '')}` : sub.telegramId;
    const project = sub.campaign?.name?.trim() || 'Проект';
    const bot = botInstance?.botUsername
      ? `@${String(botInstance.botUsername).replace(/^@/, '')}`
      : 'бот';
    const channel = sub.campaign?.channelUsername
      ? `@${String(sub.campaign.channelUsername).replace(/^@/, '')}`
      : 'канал?';
    const opp = await client.createOpportunity({
      name: `${who} · ${project} · ${bot} · ${channel}`,
      personId,
      stage: 'NEW',
    });
    opportunityId = opp?.id;
  }

  await prisma.giftSubscriber.update({
    where: { id: sub.id },
    data: {
      twentyPersonId: personId || undefined,
      twentyOpportunityId: opportunityId || undefined,
    },
  });

  console.log(
    `[backfill] ${sub.username || sub.telegramId} → person=${personId || '-'} opp=${opportunityId || '-'}`,
  );
}

await prisma.$disconnect();
console.log('[backfill] done');
