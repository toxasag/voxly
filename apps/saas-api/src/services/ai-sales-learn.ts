import { prisma, Prisma } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { TwentyClient } from '@voxly/twenty-client';
import { embedAndCharge, parseAgentLearnSettings } from '@voxly/ai-core';

const MAX_EXAMPLES_PER_CONVERSATION = 40;

function resolveAgentId(conv: {
  aiAgentId: string | null;
  botInstance?: { defaultAiAgentId: string | null } | null;
}): string | null {
  return conv.aiAgentId || conv.botInstance?.defaultAiAgentId || null;
}

/** Extract user→operator pairs from chronological messages. */
export function extractOperatorPairs(
  messages: Array<{ id: string; role: string; content: string }>,
): Array<{ sourceMessageId: string; userText: string; operatorText: string }> {
  const pairs: Array<{ sourceMessageId: string; userText: string; operatorText: string }> = [];
  let lastUser: { content: string } | null = null;
  for (const m of messages) {
    if (m.role === 'user') {
      lastUser = { content: m.content };
      continue;
    }
    if (m.role === 'operator' && lastUser && m.content.trim()) {
      pairs.push({
        sourceMessageId: m.id,
        userText: lastUser.content.slice(0, 2000),
        operatorText: m.content.slice(0, 2000),
      });
      lastUser = null;
    }
  }
  return pairs.slice(0, MAX_EXAMPLES_PER_CONVERSATION);
}

async function twentyForTenant(tenantId: string): Promise<{
  client: TwentyClient;
  workspaceId: string;
} | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      users: {
        where: { role: 'owner' },
        include: { user: true },
        take: 1,
      },
    },
  });
  if (
    !tenant?.twentyWorkspaceId ||
    !tenant.twentyOwnerPasswordEncrypted ||
    !tenant.users[0]?.user?.email
  ) {
    return null;
  }
  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    tenant.users[0].user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  return { client, workspaceId: tenant.twentyWorkspaceId };
}

export async function ingestWonDealsForAgent(opts: {
  tenantId: string;
  agentId: string;
  force?: boolean;
}): Promise<{ scanned: number; ingestedConversations: number; examplesCreated: number }> {
  const agent = await prisma.aiAgent.findFirst({
    where: { id: opts.agentId, tenantId: opts.tenantId, status: 'active' },
  });
  if (!agent) return { scanned: 0, ingestedConversations: 0, examplesCreated: 0 };

  const learn = parseAgentLearnSettings(agent.settings);
  if (!learn.learnFromWonDeals) {
    return { scanned: 0, ingestedConversations: 0, examplesCreated: 0 };
  }

  const twenty = await twentyForTenant(opts.tenantId);
  if (!twenty) return { scanned: 0, ingestedConversations: 0, examplesCreated: 0 };

  const conversations = await prisma.conversation.findMany({
    where: {
      tenantId: opts.tenantId,
      twentyOpportunityId: { not: null },
      OR: [{ aiAgentId: opts.agentId }, { botInstance: { defaultAiAgentId: opts.agentId } }],
      ...(opts.force ? {} : { salesLearnedAt: null }),
    },
    include: {
      botInstance: { select: { defaultAiAgentId: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true },
      },
    },
    take: 80,
  });

  let ingestedConversations = 0;
  let examplesCreated = 0;

  for (const conv of conversations) {
    const assigned = resolveAgentId(conv);
    if (assigned !== opts.agentId) continue;
    const opportunityId = conv.twentyOpportunityId!;
    let stage: string | null = null;
    try {
      stage = await twenty.client.getOpportunityStage(opportunityId);
    } catch (err) {
      console.warn('[ai-sales] opportunity stage fetch failed', opportunityId, err);
      continue;
    }
    if (!stage || !learn.wonStages.includes(stage)) continue;

    const pairs = extractOperatorPairs(conv.messages);
    if (!pairs.length) {
      await prisma.conversation.update({
        where: { id: conv.id },
        data: { salesLearnedAt: new Date() },
      });
      ingestedConversations += 1;
      continue;
    }

    const texts = pairs.map((p) => `Клиент: ${p.userText}\nПродавец: ${p.operatorText}`);
    let vectors: number[][];
    try {
      vectors = await embedAndCharge(opts.tenantId, texts, opts.agentId);
    } catch (err) {
      console.warn('[ai-sales] embed failed', err);
      continue;
    }

    for (let i = 0; i < pairs.length; i += 1) {
      const p = pairs[i]!;
      try {
        await prisma.aiSalesExample.upsert({
          where: { sourceMessageId: p.sourceMessageId },
          create: {
            tenantId: opts.tenantId,
            aiAgentId: opts.agentId,
            conversationId: conv.id,
            opportunityId,
            userText: p.userText,
            operatorText: p.operatorText,
            embedding: vectors[i] as unknown as Prisma.InputJsonValue,
            sourceMessageId: p.sourceMessageId,
          },
          update: {
            userText: p.userText,
            operatorText: p.operatorText,
            embedding: vectors[i] as unknown as Prisma.InputJsonValue,
            opportunityId,
          },
        });
        examplesCreated += 1;
      } catch (err) {
        console.warn('[ai-sales] upsert example failed', err);
      }
    }

    await prisma.conversation.update({
      where: { id: conv.id },
      data: { salesLearnedAt: new Date() },
    });
    ingestedConversations += 1;
  }

  return {
    scanned: conversations.length,
    ingestedConversations,
    examplesCreated,
  };
}

/** Periodic: all active agents with learning enabled. */
export async function ingestWonDealsAllTenants(): Promise<void> {
  const agents = await prisma.aiAgent.findMany({
    where: { status: 'active' },
    select: { id: true, tenantId: true, settings: true },
    take: 200,
  });
  for (const a of agents) {
    const learn = parseAgentLearnSettings(a.settings);
    if (!learn.learnFromWonDeals) continue;
    try {
      const r = await ingestWonDealsForAgent({ tenantId: a.tenantId, agentId: a.id });
      if (r.ingestedConversations > 0) {
        console.log(
          `[ai-sales] agent=${a.id} scanned=${r.scanned} convs=${r.ingestedConversations} examples=${r.examplesCreated}`,
        );
      }
    } catch (err) {
      console.warn('[ai-sales] ingest agent failed', a.id, err);
    }
  }
}
