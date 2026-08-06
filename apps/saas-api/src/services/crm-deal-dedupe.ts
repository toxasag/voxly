/**
 * Save-time CRM duplicate check (Opportunity / Person).
 * Soft-merges People by phone or Person.whatsapp; retargets Conversations,
 * GiftSubscribers, and Opportunity.pointOfContact. Does not invent phones.
 */
import type { PrismaClient } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { TwentyClient, normalizePhoneToE164 } from '@voxly/twenty-client';
import pg from 'pg';

export type CrmSaveDedupeResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  personId?: string;
  phone?: string;
  canonical?: string;
  losers?: string[];
  needsReview?: boolean;
  opportunitiesRetargeted?: number;
  error?: string;
};

async function twentySchemaName(
  client: pg.Client,
  workspaceId: string,
): Promise<string | null> {
  const ws = await client.query<{ databaseSchema: string | null }>(
    `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
    [workspaceId],
  );
  const schema = ws.rows[0]?.databaseSchema;
  if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return null;
  return schema;
}

/** Read Person phones / whatsapp from Twenty workspace DB (no invent). */
export async function readPersonContactPhonesFromTwentyDb(
  workspaceId: string,
  personId: string,
): Promise<{ phone?: string; whatsapp?: string }> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString || !workspaceId || !personId) return {};
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const schema = await twentySchemaName(client, workspaceId);
    if (!schema) return {};
    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'person'
         AND column_name IN ('whatsapp','whatsappPrimaryLinkUrl','phonesPrimaryPhoneNumber','phonesPrimaryPhoneCallingCode')`,
      [schema],
    );
    const have = new Set(cols.rows.map((c) => c.column_name));
    const selectParts = [
      have.has('whatsapp') ? 'whatsapp' : 'NULL::text AS whatsapp',
      have.has('whatsappPrimaryLinkUrl')
        ? '"whatsappPrimaryLinkUrl"'
        : 'NULL::text AS "whatsappPrimaryLinkUrl"',
      have.has('phonesPrimaryPhoneNumber')
        ? '"phonesPrimaryPhoneNumber"'
        : 'NULL::text AS "phonesPrimaryPhoneNumber"',
      have.has('phonesPrimaryPhoneCallingCode')
        ? '"phonesPrimaryPhoneCallingCode"'
        : 'NULL::text AS "phonesPrimaryPhoneCallingCode"',
    ];
    const row = await client.query<{
      whatsapp: string | null;
      whatsappPrimaryLinkUrl: string | null;
      phonesPrimaryPhoneNumber: string | null;
      phonesPrimaryPhoneCallingCode: string | null;
    }>(
      `SELECT ${selectParts.join(', ')}
       FROM "${schema}".person
       WHERE id = $1::uuid AND "deletedAt" IS NULL
       LIMIT 1`,
      [personId],
    );
    const r = row.rows[0];
    if (!r) return {};
    const waRaw = r.whatsappPrimaryLinkUrl || r.whatsapp;
    const wa =
      normalizePhoneToE164(waRaw) ||
      normalizePhoneToE164(
        String(waRaw || '').replace(/^https?:\/\/wa\.me\//i, ''),
      );
    const combined =
      r.phonesPrimaryPhoneCallingCode && r.phonesPrimaryPhoneNumber
        ? `${r.phonesPrimaryPhoneCallingCode}${r.phonesPrimaryPhoneNumber}`
        : r.phonesPrimaryPhoneNumber;
    const phone = normalizePhoneToE164(combined) || normalizePhoneToE164(r.phonesPrimaryPhoneNumber);
    return {
      ...(wa ? { whatsapp: wa } : {}),
      ...(phone ? { phone } : {}),
    };
  } catch {
    return {};
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Soft-merge duplicate People by phone/whatsapp.
 * Relinks GiftSubscriber + Conversation; retargets open Opportunities.
 * Notes only when something actually moved (idempotent on re-save).
 */
export async function softMergePeopleByPhone(opts: {
  prisma: PrismaClient;
  client: TwentyClient;
  tenantId: string;
  personId: string;
  phone: string;
}): Promise<{
  canonical: string;
  losers: string[];
  needsReview: boolean;
  opportunitiesRetargeted: number;
  moved: boolean;
}> {
  const { prisma, client, tenantId, personId, phone } = opts;
  const byPhone = await client.findPersonByPhone(phone);
  if (!byPhone?.ids?.length) {
    return {
      canonical: personId,
      losers: [],
      needsReview: false,
      opportunitiesRetargeted: 0,
      moved: false,
    };
  }
  const ids = [...new Set(byPhone.ids)];
  if (!ids.includes(personId)) ids.push(personId);
  if (ids.length <= 1) {
    return {
      canonical: personId,
      losers: [],
      needsReview: false,
      opportunitiesRetargeted: 0,
      moved: false,
    };
  }

  const scored = await Promise.all(
    ids.map(async (id) => {
      const [gifts, convs] = await Promise.all([
        prisma.giftSubscriber.count({ where: { tenantId, twentyPersonId: id } }),
        prisma.conversation.count({ where: { tenantId, twentyPersonId: id } }),
      ]);
      return {
        id,
        score: gifts + convs * 2 + (id === personId ? 0.5 : 0),
      };
    }),
  );
  scored.sort((a, b) => b.score - a.score);
  const canonical = scored[0]!.id;
  const losers = scored.slice(1).map((s) => s.id);
  const needsReview = ids.length > 2;

  let moved = false;
  let opportunitiesRetargeted = 0;

  for (const loser of losers) {
    const giftRes = await prisma.giftSubscriber.updateMany({
      where: { tenantId, twentyPersonId: loser },
      data: { twentyPersonId: canonical },
    });
    const convRes = await prisma.conversation.updateMany({
      where: { tenantId, twentyPersonId: loser },
      data: {
        twentyPersonId: canonical,
        ...(needsReview ? { needsReview: true } : {}),
      },
    });

    let loserOppRetargeted = 0;
    const oppIds = await client.listOpenOpportunityIdsByPerson(loser);
    for (const oppId of oppIds) {
      const ok = await client.setOpportunityPointOfContact(oppId, canonical);
      if (ok) {
        loserOppRetargeted += 1;
        await prisma.conversation.updateMany({
          where: { tenantId, twentyOpportunityId: oppId },
          data: { twentyPersonId: canonical },
        });
        await prisma.giftSubscriber.updateMany({
          where: { tenantId, twentyOpportunityId: oppId },
          data: { twentyPersonId: canonical },
        });
      }
    }
    opportunitiesRetargeted += loserOppRetargeted;

    const loserMoved =
      giftRes.count > 0 || convRes.count > 0 || loserOppRetargeted > 0;
    if (!loserMoved) continue;
    moved = true;

    try {
      await client.createNoteForPerson({
        personId: loser,
        title: 'Дубликат — склеен',
        body: `Диалоги и подписчики перенесены на контакт ${canonical} (совпадение телефона ${phone}). Карточку можно архивировать вручную.`,
      });
      await client.createNoteForPerson({
        personId: canonical,
        title: 'Склейка дубликата',
        body: `Влит контакт ${loser} по телефону ${phone}.`,
      });
    } catch {
      /* notes optional */
    }
  }

  if (needsReview) {
    await prisma.conversation.updateMany({
      where: { tenantId, twentyPersonId: canonical },
      data: { needsReview: true },
    });
  }

  return {
    canonical,
    losers,
    needsReview,
    opportunitiesRetargeted,
    moved,
  };
}

async function authenticateTenantTwenty(
  prisma: PrismaClient,
  tenantId: string,
): Promise<{ twenty: TwentyClient; workspaceId: string } | { error: string }> {
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
  if (!tenant) return { error: 'tenant_not_found' };
  if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    return { error: 'crm_not_provisioned' };
  }
  const owner = tenant.users[0]?.user;
  if (!owner?.email) return { error: 'owner_not_found' };

  const twenty = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await twenty.authenticateWorkspace(
    owner.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  try {
    await twenty.ensureSocialFields();
  } catch {
    /* optional */
  }
  return { twenty, workspaceId: tenant.twentyWorkspaceId };
}

/**
 * Run on Opportunity save (any field, incl. contact/company) or Person save
 * when phone/whatsapp changed. Uses filled phones/whatsapp only.
 */
export async function runCrmSaveDedupe(opts: {
  prisma: PrismaClient;
  tenantId: string;
  opportunityId?: string;
  personId?: string;
}): Promise<CrmSaveDedupeResult> {
  const { prisma, tenantId } = opts;
  const auth = await authenticateTenantTwenty(prisma, tenantId);
  if ('error' in auth) {
    return { ok: false, error: auth.error };
  }
  const { twenty, workspaceId } = auth;

  let personId = opts.personId?.trim() || '';
  if (!personId && opts.opportunityId) {
    personId =
      (await twenty.getOpportunityPointOfContactId(opts.opportunityId)) || '';
  }
  if (!personId) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_point_of_contact',
    };
  }

  const contacts = await readPersonContactPhonesFromTwentyDb(workspaceId, personId);
  const phone = contacts.whatsapp || contacts.phone;
  if (!phone) {
    return {
      ok: true,
      skipped: true,
      reason: 'no_phone_or_whatsapp',
      personId,
    };
  }

  const merge = await softMergePeopleByPhone({
    prisma,
    client: twenty,
    tenantId,
    personId,
    phone,
  });

  const canonicalPerson = merge.canonical || personId;
  // Collapse duplicate open Opportunities on the same Person (WA sync race).
  // Keep the Opp linked to an open Conversation; soft-delete the rest.
  let opportunitiesCollapsed = 0;
  try {
    const openOppIds = await twenty.listOpenOpportunityIdsByPerson(canonicalPerson);
    if (openOppIds.length > 1) {
      const linked = await prisma.conversation.findMany({
        where: {
          tenantId,
          twentyPersonId: canonicalPerson,
          twentyOpportunityId: { in: openOppIds },
          status: { not: 'closed' },
        },
        select: { twentyOpportunityId: true },
        orderBy: { updatedAt: 'desc' },
      });
      const keep =
        linked.find((c) => c.twentyOpportunityId)?.twentyOpportunityId ||
        openOppIds[0]!;
      for (const oppId of openOppIds) {
        if (oppId === keep) continue;
        const stillUsed = await prisma.conversation.findFirst({
          where: {
            tenantId,
            twentyOpportunityId: oppId,
            status: { not: 'closed' },
          },
          select: { id: true },
        });
        if (stillUsed) continue;
        if (await twenty.softDeleteOpportunity(oppId)) {
          opportunitiesCollapsed += 1;
        }
      }
    }
  } catch {
    /* best-effort */
  }

  return {
    ok: true,
    personId,
    phone,
    canonical: merge.canonical,
    losers: merge.losers,
    needsReview: merge.needsReview,
    opportunitiesRetargeted:
      (merge.opportunitiesRetargeted || 0) + opportunitiesCollapsed,
    skipped:
      !merge.moved &&
      merge.losers.length === 0 &&
      opportunitiesCollapsed === 0,
    reason: opportunitiesCollapsed
      ? 'collapsed_opportunities'
      : merge.moved
        ? 'merged'
        : merge.losers.length
          ? 'already_linked'
          : 'unique',
  };
}
