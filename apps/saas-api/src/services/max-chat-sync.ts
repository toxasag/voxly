/**
 * Import private MAX (PyMax) DIALOG chats into CRM.
 * Groups/channels never appear — bridge filters ChatType.DIALOG only.
 * Default: all private dialogs × last 30 messages.
 */
import type { PrismaClient } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { TwentyClient, phoneFingerprint, normalizePhoneToE164 } from '@voxly/twenty-client';
import { enqueueTimelineSync } from '@voxly/ai-core';
import { stripOwnerPhone } from './max-phone-guard.js';

/** 0 = all private dialogs. */
export const MAX_CHAT_SYNC_ALL_DIALOGS = 0;
export const MAX_CHAT_SYNC_MESSAGE_LIMIT = 30;

export type MaxChatSyncSummary = {
  ok: boolean;
  dialogs: number;
  messagesUpserted: number;
  peopleCreated: number;
  opportunitiesCreated: number;
  skippedSuppressed: number;
  error?: string;
};

type BridgeDialog = {
  chatId: string;
  userId?: string;
  username?: string | null;
  firstName?: string | null;
  phone?: string | null;
  /** PyMax User.link when present — never invented from phone. */
  link?: string | null;
  messages: Array<{
    id: number | string;
    out: boolean;
    text: string;
    date: number;
    attachments?: Array<{
      type: string;
      fileId: string;
      fileName?: string;
      mimeType?: string;
      fileSize?: number;
    }>;
  }>;
};

function bridgeBase(): string {
  return (process.env.MAX_BRIDGE_URL || 'http://max-bridge:3010').replace(/\/$/, '');
}

function serviceToken(): string {
  return process.env.VOXLY_SERVICE_TOKEN || '';
}

async function fetchPrivateDialogs(opts: {
  botId: string;
  dialogLimit: number;
  messageLimit: number;
}): Promise<{
  dialogs: BridgeDialog[];
  selfPhone?: string;
  selfMaxUserId?: string;
  error?: string;
}> {
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
    selfPhone?: string | null;
    selfMaxUserId?: string | null;
    error?: string;
    detail?: string;
  };
  if (!res.ok || !json.ok) {
    return {
      dialogs: [],
      error: json.error || json.detail || `HTTP ${res.status}`,
    };
  }
  return {
    dialogs: Array.isArray(json.dialogs) ? json.dialogs : [],
    selfPhone: json.selfPhone ? String(json.selfPhone) : undefined,
    selfMaxUserId: json.selfMaxUserId ? String(json.selfMaxUserId) : undefined,
  };
}

export async function runMaxPrivateChatSync(opts: {
  prisma: PrismaClient;
  twenty?: TwentyClient;
  tenantId: string;
  botId: string;
  dialogLimit?: number;
  messageLimit?: number;
}): Promise<MaxChatSyncSummary> {
  const { prisma, tenantId, botId } = opts;
  const rawDialog = opts.dialogLimit;
  const dialogLimit =
    typeof rawDialog === 'number' && Number.isFinite(rawDialog) && rawDialog > 0
      ? Math.floor(rawDialog)
      : MAX_CHAT_SYNC_ALL_DIALOGS;
  const messageLimit = Math.min(
    Math.max(opts.messageLimit ?? MAX_CHAT_SYNC_MESSAGE_LIMIT, 1),
    80,
  );

  const bot = await prisma.botInstance.findFirst({
    where: {
      id: botId,
      tenantId,
      botType: 'ai_max',
      status: 'active',
      botTokenEncrypted: { not: null },
    },
    select: { id: true, displayName: true, botUsername: true, phoneNumberId: true },
  });
  if (!bot) {
    return {
      ok: false,
      dialogs: 0,
      messagesUpserted: 0,
      peopleCreated: 0,
      opportunitiesCreated: 0,
      skippedSuppressed: 0,
      error: 'max_bot_not_found',
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

  const { dialogs, selfPhone, selfMaxUserId, error } = await fetchPrivateDialogs({
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
  const botLabel = bot.displayName || bot.botUsername || 'личный';

  const selfMaxId =
    String(selfMaxUserId || bot.phoneNumberId || '').trim();

  for (const d of dialogs) {
    // Match live inbound: platformUserId = chat id (send/read). Profile id = userId.
    const platformUserId = String(d.chatId || d.userId || '').trim();
    if (!platformUserId || platformUserId === '0') continue;
    // Channels/groups (negative ids) — never Person/Opportunity (INC-113).
    if (platformUserId.startsWith('-')) continue;
    const peerUserId = String(d.userId || '').trim();
    // Skip self / Saved Messages style peers
    if (selfMaxId && (peerUserId === selfMaxId || platformUserId === selfMaxId)) continue;

    let conversation = await prisma.conversation.findFirst({
      where: {
        tenantId,
        botInstanceId: botId,
        platform: 'max',
        platformUserId,
        channel: 'max_personal',
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: {
          tenantId,
          botInstanceId: botId,
          platform: 'max',
          platformUserId,
          platformUsername: d.username || undefined,
          platformFirstName: d.firstName || undefined,
          channel: 'max_personal',
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
      const externalMessageId = `max:${m.id}`;
      const atts = Array.isArray(m.attachments) ? m.attachments : [];
      const content =
        (m.text || '').trim() ||
        (atts[0]?.type === 'photo'
          ? '[фото]'
          : atts[0]?.type === 'video'
            ? '[видео]'
            : atts[0]?.type === 'voice' || atts[0]?.type === 'audio'
              ? '[голосовое]'
              : atts[0]?.fileName
                ? `[файл: ${atts[0].fileName}]`
                : atts.length
                  ? '[файл]'
                  : '[сообщение]');
      const existing = await prisma.chatMessage.findFirst({
        where: {
          conversationId: conversation.id,
          externalMessageId,
        },
        select: { id: true, content: true, attachments: true },
      });
      if (existing) {
        // Backfill placeholders when sync now has typed media (mirror GramJS).
        const isPlaceholder =
          !existing.content ||
          existing.content === '[сообщение]' ||
          existing.content === '[media]' ||
          existing.content.startsWith('[media:');
        const hasAtts = Array.isArray(existing.attachments) && existing.attachments.length > 0;
        if (isPlaceholder && atts.length && !hasAtts) {
          await prisma.chatMessage.update({
            where: { id: existing.id },
            data: { content, attachments: atts },
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
          ...(atts.length ? { attachments: atts } : {}),
        },
      });
      messagesUpserted += 1;

      // Timeline sync (Phase 5.3) — fire-and-forget
      if (!m.out) {
        const phoneFp = d.phone ? phoneFingerprint(normalizePhoneToE164(d.phone)) : null;
        void enqueueTimelineSync({
          tenantId,
          twentyPersonId: conversation.twentyPersonId || null,
          phoneFingerprint: phoneFp ?? null,
          kind: 'chat_inbound',
          channel: 'max_personal',
          title: `Входящее (MAX): ${content.slice(0, 80)}${content.length > 80 ? '…' : ''}`,
          description: content,
          meta: {
            conversationId: conversation.id,
            externalMessageId,
            maxUserId: d.userId || platformUserId,
            username: d.username,
            firstName: d.firstName,
          },
          conversationId: conversation.id,
          messageId: externalMessageId,
        });
      }
    }

    let personId = conversation.twentyPersonId || undefined;
    let opportunityId = conversation.twentyOpportunityId || undefined;
    const suppressDeal = conversation.suppressDealCreation === true;

    if (personId && !(await client.personExists(personId))) personId = undefined;
    if (opportunityId && !(await client.opportunityExists(opportunityId))) {
      opportunityId = undefined;
    }

    // Never write connected-account phone onto peer (INC-113); fill-empty only via applyMaxProfile.
    const phone = stripOwnerPhone(d.phone || undefined, selfPhone);

    if (!personId) {
      const prior = await prisma.conversation.findFirst({
        where: {
          tenantId,
          platform: 'max',
          platformUserId,
          twentyPersonId: { not: null },
          NOT: { id: conversation.id },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (prior?.twentyPersonId && (await client.personExists(prior.twentyPersonId))) {
        personId = prior.twentyPersonId;
        if (
          prior.twentyOpportunityId &&
          (await client.opportunityExists(prior.twentyOpportunityId))
        ) {
          opportunityId = prior.twentyOpportunityId;
        }
      }
    }

    if (!personId && phone) {
      try {
        const byPhone = await client.findPersonByPhone(phone);
        personId = byPhone?.id || byPhone?.ids?.[0];
      } catch {
        /* ignore */
      }
    }

    if (!personId) {
      const hinted = await client.findPersonByHint({
        username: d.username || undefined,
        lastName: d.username
          ? `@${String(d.username).replace(/^@/, '')}`
          : platformUserId,
      });
      personId = hinted?.id;
    }

    if (!personId) {
      const who =
        d.firstName ||
        (d.username ? `@${String(d.username).replace(/^@/, '')}` : null) ||
        `MAX ${platformUserId}`;
      const created = await client.createPerson({
        firstName: who,
        lastName: d.username
          ? `@${String(d.username).replace(/^@/, '')}`
          : platformUserId,
        phone,
      });
      personId = created?.id;
      if (personId) peopleCreated += 1;
    }

    if (personId && (d.link || d.firstName || peerUserId || phone)) {
      try {
        await client.applyMaxProfile(personId, {
          firstName: d.firstName || undefined,
          link: d.link || undefined,
          // Real MAX user id for /open/max — not chat id (INC-113).
          userId: peerUserId || platformUserId,
          // fill-empty only inside applyMaxProfile — never overwrite different phone.
          phone: phone ? `+${phone}` : undefined,
        });
      } catch {
        /* optional */
      }
    }

    if (personId && phone) {
      try {
        const { enrichPersonCrossChannelByPhone } = await import(
          './enrich-person-by-phone.js'
        );
        await enrichPersonCrossChannelByPhone({
          prisma,
          twenty: client,
          tenantId,
          personId,
          phone,
          channels: ['telegram', 'whatsapp'],
          forbidPhones: selfPhone ? [selfPhone] : undefined,
        });
      } catch (err) {
        console.warn('[max-chat-sync] cross-channel enrich failed', err);
      }
    }

    if (!opportunityId && personId && !suppressDeal) {
      try {
        const open = await client.findOpenOpportunityByPerson(personId);
        if (open?.id) opportunityId = open.id;
      } catch {
        /* ignore */
      }
    }

    if (!opportunityId && personId && !suppressDeal) {
      const who = d.username
        ? `@${String(d.username).replace(/^@/, '')}`
        : d.firstName || platformUserId;
      const opportunity = await client.createOpportunity({
        name: `${who} · MAX · ${botLabel}`,
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

    if (opportunityId && d.messages?.length) {
      try {
        await client.touchOpportunityActivity(opportunityId);
      } catch {
        /* ignore */
      }
    }
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
