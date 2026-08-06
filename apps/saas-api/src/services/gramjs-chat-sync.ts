/**
 * Import private GramJS dialogs into CRM (Person + Opportunity + ChatMessage).
 * Groups/channels never appear here — bridge filters to Api.User only.
 * Default: all private dialogs × last 30 messages (rate-limited in bridge).
 */
import type { PrismaClient } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { TwentyClient } from '@voxly/twenty-client';

/** 0 = all private dialogs (paginate until done). */
export const GRAMJS_CHAT_SYNC_ALL_DIALOGS = 0;
/** Per-dialog message depth (TG API / FloodWait bound). */
export const GRAMJS_CHAT_SYNC_MESSAGE_LIMIT = 30;

export type GramjsChatSyncSummary = {
  ok: boolean;
  dialogs: number;
  messagesUpserted: number;
  peopleCreated: number;
  opportunitiesCreated: number;
  skippedSuppressed: number;
  error?: string;
};

type BridgeAttachment = {
  type: string;
  fileId: string;
  fileName?: string;
  mimeType?: string;
};

type BridgeDialog = {
  userId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  messages: Array<{
    id: number;
    out: boolean;
    text: string;
    date: number;
    attachment?: BridgeAttachment;
  }>;
};

function bridgeBase(): string {
  return (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(/\/$/, '');
}

function serviceToken(): string {
  return process.env.VOXLY_SERVICE_TOKEN || '';
}

async function fetchPrivateDialogs(opts: {
  botId: string;
  dialogLimit: number;
  messageLimit: number;
}): Promise<{ dialogs: BridgeDialog[]; error?: string }> {
  const token = serviceToken();
  if (!token) return { dialogs: [], error: 'VOXLY_SERVICE_TOKEN unset' };
  const res = await fetch(`${bridgeBase()}/crm/private-dialogs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      dialogLimit: opts.dialogLimit,
      messageLimit: opts.messageLimit,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    dialogs?: BridgeDialog[];
    error?: string;
  };
  if (!res.ok || !json.ok) {
    return { dialogs: [], error: json.error || `HTTP ${res.status}` };
  }
  return { dialogs: Array.isArray(json.dialogs) ? json.dialogs : [] };
}

export async function runGramjsPrivateChatSync(opts: {
  prisma: PrismaClient;
  twenty?: TwentyClient;
  tenantId: string;
  botId: string;
  /** Positive = cap; omit/0 = all private dialogs. */
  dialogLimit?: number;
  messageLimit?: number;
}): Promise<GramjsChatSyncSummary> {
  const { prisma, tenantId, botId } = opts;
  const rawDialog = opts.dialogLimit;
  const dialogLimit =
    typeof rawDialog === 'number' && Number.isFinite(rawDialog) && rawDialog > 0
      ? Math.floor(rawDialog)
      : GRAMJS_CHAT_SYNC_ALL_DIALOGS;
  const messageLimit = Math.min(
    Math.max(opts.messageLimit ?? GRAMJS_CHAT_SYNC_MESSAGE_LIMIT, 1),
    80,
  );

  const bot = await prisma.botInstance.findFirst({
    where: {
      id: botId,
      tenantId,
      botType: 'ai_gramjs',
      status: 'active',
      botTokenEncrypted: { not: null },
    },
    select: { id: true, botUsername: true },
  });
  if (!bot) {
    return {
      ok: false,
      dialogs: 0,
      messagesUpserted: 0,
      peopleCreated: 0,
      opportunitiesCreated: 0,
      skippedSuppressed: 0,
      error: 'gramjs_bot_not_found',
    };
  }

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
  if (!tenant?.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    return {
      ok: false,
      dialogs: 0,
      messagesUpserted: 0,
      peopleCreated: 0,
      opportunitiesCreated: 0,
      skippedSuppressed: 0,
      error: 'crm_not_provisioned',
    };
  }
  const owner = tenant.users[0]?.user;
  if (!owner?.email) {
    return {
      ok: false,
      dialogs: 0,
      messagesUpserted: 0,
      peopleCreated: 0,
      opportunitiesCreated: 0,
      skippedSuppressed: 0,
      error: 'owner_not_found',
    };
  }

  const { dialogs, error } = await fetchPrivateDialogs({
    botId,
    dialogLimit,
    messageLimit,
  });
  if (error) {
    return {
      ok: false,
      dialogs: 0,
      messagesUpserted: 0,
      peopleCreated: 0,
      opportunitiesCreated: 0,
      skippedSuppressed: 0,
      error,
    };
  }

  const client =
    opts.twenty ||
    new TwentyClient({
      apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
    });
  await client.authenticateWorkspace(
    owner.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  try {
    await client.ensureSocialFields();
  } catch {
    /* optional */
  }

  let messagesUpserted = 0;
  let peopleCreated = 0;
  let opportunitiesCreated = 0;
  let skippedSuppressed = 0;
  const botLabel = bot.botUsername
    ? `@${bot.botUsername.replace(/^@/, '')}`
    : 'AI';

  for (const d of dialogs) {
    const platformUserId = String(d.userId || '').trim();
    if (!platformUserId) continue;

    let conversation = await prisma.conversation.findFirst({
      where: {
        tenantId,
        botInstanceId: botId,
        platformUserId,
        channel: { not: 'telegram_business_account' },
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId,
          botInstanceId: botId,
          platform: 'telegram',
          platformUserId,
          platformUsername: d.username || undefined,
          platformFirstName: d.firstName || undefined,
          channel: 'telegram_gramjs',
          status: 'open',
          mode: 'ai',
        },
      });
    } else {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          platformUsername: d.username || conversation.platformUsername,
          platformFirstName: d.firstName || conversation.platformFirstName,
          botInstanceId: botId,
        },
      });
      conversation = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
    }

    for (const m of d.messages) {
      const externalMessageId = String(m.id);
      const content = (m.text || '').trim() || '[media]';
      const attachments = m.attachment
        ? [
            {
              type: m.attachment.type,
              fileId: m.attachment.fileId,
              ...(m.attachment.fileName
                ? { fileName: m.attachment.fileName }
                : {}),
              ...(m.attachment.mimeType
                ? { mimeType: m.attachment.mimeType }
                : {}),
            },
          ]
        : undefined;
      const existing = await prisma.chatMessage.findFirst({
        where: {
          conversationId: conversation.id,
          externalMessageId,
        },
        select: { id: true, content: true, attachments: true },
      });
      if (existing) {
        // Backfill history-imported placeholders that had no attachment meta.
        const hadAtt =
          Array.isArray(existing.attachments) && existing.attachments.length > 0;
        if (attachments?.length && !hadAtt) {
          await prisma.chatMessage.update({
            where: { id: existing.id },
            data: {
              content:
                existing.content === '[media]' || !existing.content?.trim()
                  ? content
                  : existing.content,
              attachments,
            },
          });
          messagesUpserted += 1;
        }
        continue;
      }
      const sentAt =
        m.date && m.date > 0 ? new Date(m.date * 1000) : new Date();
      await prisma.chatMessage.create({
        data: {
          conversationId: conversation.id,
          role: m.out ? 'operator' : 'user',
          content,
          externalMessageId,
          sentAt,
          ...(attachments ? { attachments } : {}),
        },
      });
      messagesUpserted += 1;
    }

    // CRM Person + Opportunity (honor manual suppressDealCreation only).
    let personId = conversation.twentyPersonId || undefined;
    let opportunityId = conversation.twentyOpportunityId || undefined;
    let suppressDeal = conversation.suppressDealCreation === true;

    if (personId && !(await client.personExists(personId))) {
      personId = undefined;
    }
    if (opportunityId && !(await client.opportunityExists(opportunityId))) {
      opportunityId = undefined;
    }

    if (!personId) {
      const hinted = await client.findPersonByHint({
        username: d.username,
        telegramId: platformUserId,
        lastName: d.username
          ? `@${d.username.replace(/^@/, '')}`
          : platformUserId,
      });
      personId = hinted?.id;
    }
    if (!personId && d.phone) {
      try {
        const byPhone = await client.findPersonByPhone(d.phone);
        personId = byPhone?.id || byPhone?.ids?.[0];
      } catch {
        /* ignore */
      }
    }
    if (!personId) {
      const created = await client.createPerson({
        firstName: d.firstName || d.username || `TG ${platformUserId}`,
        lastName: d.username
          ? `@${d.username.replace(/^@/, '')}`
          : d.lastName || platformUserId,
        telegram: d.username,
        telegramUserId: platformUserId,
        phone: d.phone,
      });
      personId = created?.id;
      if (personId) peopleCreated += 1;
    } else {
      try {
        await client.updatePersonTelegram(personId, {
          username: d.username,
          userId: platformUserId,
        });
      } catch {
        /* ignore */
      }
    }

    if (!opportunityId && personId && !suppressDeal) {
      const who = d.username
        ? `@${d.username.replace(/^@/, '')}`
        : platformUserId;
      const opportunity = await client.createOpportunity({
        name: `${who} · AI · ${botLabel}`,
        personId,
        stage: 'NEW',
      });
      opportunityId = opportunity?.id;
      if (opportunityId) opportunitiesCreated += 1;
    } else if (!opportunityId && personId && suppressDeal) {
      skippedSuppressed += 1;
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        twentyPersonId: personId || null,
        twentyOpportunityId: opportunityId || null,
        suppressDealCreation: suppressDeal,
        platformUsername: d.username || conversation.platformUsername,
        platformFirstName: d.firstName || conversation.platformFirstName,
      },
    });
  }

  return {
    ok: true,
    dialogs: dialogs.length,
    messagesUpserted,
    peopleCreated,
    opportunitiesCreated,
    skippedSuppressed,
  };
}
