/**
 * Process a FormLead: AttributionSession + Twenty Person/Opportunity + fireGoal.
 */

import { prisma } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { fireGoal } from '@voxly/analytics-dispatchers';
import {
  TwentyClient,
  normalizePhoneToE164,
  phoneFingerprint,
} from '@voxly/twenty-client';
import { retryBackoffMs } from '@voxly/shared';
import type { FormAttribution } from './form-lead-parse.js';
import { sanitizeRawFields } from './form-lead-parse.js';

function splitName(full?: string | null): { firstName: string; lastName: string } {
  const s = String(full || '').trim();
  if (!s) return { firstName: 'Лид', lastName: 'с сайта' };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function sourceLabel(source: string): string {
  if (source === 'tilda') return 'Tilda';
  if (source === 'wordpress') return 'WordPress';
  return 'Сайт';
}

function buildNoteBody(opts: {
  source: string;
  formId?: string | null;
  pageUrl?: string | null;
  referer?: string | null;
  comment?: string | null;
  attribution: FormAttribution;
  rawFields: Record<string, unknown>;
}): string {
  const lines: string[] = [
    `Источник: ${sourceLabel(opts.source)}`,
  ];
  if (opts.formId) lines.push(`Форма: ${opts.formId}`);
  if (opts.pageUrl) lines.push(`Страница: ${opts.pageUrl}`);
  if (opts.referer) lines.push(`Referer: ${opts.referer}`);
  if (opts.comment) lines.push(`Комментарий: ${opts.comment}`);

  const utmBits = [
    opts.attribution.utmSource && `utm_source=${opts.attribution.utmSource}`,
    opts.attribution.utmMedium && `utm_medium=${opts.attribution.utmMedium}`,
    opts.attribution.utmCampaign && `utm_campaign=${opts.attribution.utmCampaign}`,
    opts.attribution.utmContent && `utm_content=${opts.attribution.utmContent}`,
    opts.attribution.utmTerm && `utm_term=${opts.attribution.utmTerm}`,
  ].filter(Boolean);
  if (utmBits.length) lines.push(`UTM: ${utmBits.join(' · ')}`);
  if (opts.attribution.ymUid) lines.push(`_ym_uid: ${opts.attribution.ymUid}`);
  if (opts.attribution.yclid) lines.push(`yclid: ${opts.attribution.yclid}`);
  if (opts.attribution.gclid) lines.push(`gclid: ${opts.attribution.gclid}`);

  const extras = Object.entries(opts.rawFields)
    .filter(([k]) => {
      const lk = k.toLowerCase();
      return !['name', 'phone', 'email', 'comments', 'comment', 'message'].includes(lk);
    })
    .slice(0, 40);
  if (extras.length) {
    lines.push('');
    lines.push('Поля формы:');
    for (const [k, v] of extras) {
      lines.push(`- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
  }
  return lines.join('\n');
}

export async function processFormLead(formLeadId: string): Promise<void> {
  const lead = await prisma.formLead.findUnique({
    where: { id: formLeadId },
    include: { endpoint: true },
  });
  if (!lead) return;
  if (lead.status === 'processed' || lead.status === 'duplicate') return;

  const tenant = await prisma.tenant.findUnique({ where: { id: lead.tenantId } });
  if (!tenant?.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    await prisma.formLead.update({
      where: { id: lead.id },
      data: {
        status: 'failed',
        error: 'CRM workspace не готов (нет twentyWorkspaceId)',
      },
    });
    return;
  }

  const owner = await prisma.tenantMember.findFirst({
    where: { tenantId: lead.tenantId, role: 'owner' },
    include: { user: true },
  });
  if (!owner?.user?.email) {
    await prisma.formLead.update({
      where: { id: lead.id },
      data: { status: 'failed', error: 'Не найден owner email тенанта' },
    });
    return;
  }

  const payload = (lead.payload || {}) as Record<string, unknown>;
  const attribution = (payload.attribution || {}) as FormAttribution;
  const rawFields = sanitizeRawFields(
    (payload.rawFields || {}) as Record<string, unknown>,
  );

  // --- AttributionSession ---
  let attributionId = lead.attributionId || undefined;
  if (!attributionId) {
    const clickId = `fl_${lead.id}`;
    const session = await prisma.attributionSession.upsert({
      where: { clickId },
      create: {
        tenantId: lead.tenantId,
        clickId,
        ymUid: attribution.ymUid || null,
        yclid: attribution.yclid || null,
        gclid: attribution.gclid || null,
        msclkid: attribution.msclkid || null,
        fbp: attribution.fbp || null,
        fbc: attribution.fbc || null,
        rbClickid: attribution.rbClickid || null,
        utmSource: attribution.utmSource || null,
        utmMedium: attribution.utmMedium || null,
        utmCampaign: attribution.utmCampaign || null,
        utmContent: attribution.utmContent || null,
        utmTerm: attribution.utmTerm || null,
        creativeTag: `form:${lead.source}`,
        postId: lead.formId || null,
      },
      update: {
        ymUid: attribution.ymUid || undefined,
        yclid: attribution.yclid || undefined,
        gclid: attribution.gclid || undefined,
        fbp: attribution.fbp || undefined,
        fbc: attribution.fbc || undefined,
        utmSource: attribution.utmSource || undefined,
        utmMedium: attribution.utmMedium || undefined,
        utmCampaign: attribution.utmCampaign || undefined,
      },
    });
    attributionId = session.id;
    await prisma.formLead.update({
      where: { id: lead.id },
      data: { attributionId },
    });
  }

  const client = new TwentyClient({
    apiUrl: process.env.TWENTY_API_URL || 'http://twenty-server:3000/graphql',
  });
  await client.authenticateWorkspace(
    owner.user.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );

  try {
    await client.ensureSocialFields();
  } catch (err) {
    console.warn('[form-lead] ensureSocialFields failed', err);
  }

  const phone = normalizePhoneToE164(lead.phone) || undefined;
  const email = lead.email?.trim().toLowerCase() || undefined;
  const { firstName, lastName } = splitName(lead.name);

  // --- Person dedupe: phone → email → prior FormLead by externalId (already unique) ---
  const candidateIds = new Set<string>();
  let phoneMatchIds: string[] = [];

  if (phone) {
    try {
      const byPhone = await client.findPersonByPhone(phone);
      if (byPhone?.ids?.length) {
        phoneMatchIds = byPhone.ids;
        for (const id of byPhone.ids) {
          if (await client.personExists(id)) candidateIds.add(id);
        }
      }
    } catch (err) {
      console.warn('[form-lead] findPersonByPhone failed', err);
    }
  }

  let emailPersonId: string | undefined;
  if (email) {
    try {
      const byEmail = await client.findPersonByEmail(email);
      if (byEmail?.id && (await client.personExists(byEmail.id))) {
        emailPersonId = byEmail.id;
        candidateIds.add(byEmail.id);
      }
    } catch (err) {
      console.warn('[form-lead] findPersonByEmail failed', err);
    }
  }

  // Prior processed lead with same phone/email on this tenant
  if (!candidateIds.size && (phone || email)) {
    const fp = phoneFingerprint(lead.phone);
    const prior = await prisma.formLead.findFirst({
      where: {
        tenantId: lead.tenantId,
        id: { not: lead.id },
        personId: { not: null },
        status: { in: ['processed', 'needs_review'] },
        OR: [
          fp ? { phoneFingerprint: fp } : undefined,
          email ? { email } : undefined,
        ].filter(Boolean) as any[],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (prior?.personId && (await client.personExists(prior.personId))) {
      candidateIds.add(prior.personId);
    }
  }

  const needsReview = candidateIds.size > 1 || phoneMatchIds.length > 1;
  let personId =
    (lead.personId && (await client.personExists(lead.personId))
      ? lead.personId
      : undefined) ||
    (phoneMatchIds[0] && candidateIds.has(phoneMatchIds[0])
      ? phoneMatchIds[0]
      : undefined) ||
    emailPersonId ||
    [...candidateIds][0] ||
    undefined;

  if (lead.personId && personId === lead.personId) {
    // keep
  } else if (!personId) {
    const created = await client.createPerson({
      firstName,
      lastName: lastName || sourceLabel(lead.source),
      phone,
      email,
    });
    personId = created?.id;
  } else {
    if (phone) {
      try {
        await client.updatePersonPhone(personId, phone);
      } catch {
        /* ignore */
      }
    }
    if (email) {
      try {
        await client.updatePersonEmail(personId, email);
      } catch {
        /* ignore */
      }
    }
    if (lead.name) {
      try {
        await client.updatePersonName(personId, {
          firstName,
          lastName: lastName || undefined,
        });
      } catch {
        /* ignore */
      }
    }
  }

  if (!personId) {
    await prisma.formLead.update({
      where: { id: lead.id },
      data: { status: 'failed', error: 'Не удалось создать Person в Twenty' },
    });
    return;
  }

  // --- Opportunity ---
  const dedupeMode = lead.endpoint.dedupeMode || 'reuse_open';
  let opportunityId: string | undefined =
    lead.opportunityId && (await client.opportunityExists(lead.opportunityId))
      ? lead.opportunityId
      : undefined;
  let createdNewOpp = false;

  if (dedupeMode !== 'always_new') {
    // Prefer prior FormLead opportunity, then Twenty open opp
    const priorOpp = await prisma.formLead.findFirst({
      where: {
        tenantId: lead.tenantId,
        personId,
        opportunityId: { not: null },
        id: { not: lead.id },
        status: { in: ['processed', 'needs_review'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (
      priorOpp?.opportunityId &&
      (await client.opportunityExists(priorOpp.opportunityId))
    ) {
      const stage = await client.getOpportunityStage(priorOpp.opportunityId);
      if (stage && !/USPESHNAYA|SDELKA_PROVALENA|CUSTOMER|FAILED|LOST|WON|CLOSED/i.test(stage)) {
        opportunityId = priorOpp.opportunityId;
      }
    }
    if (!opportunityId) {
      const open = await client.findOpenOpportunityByPerson(personId);
      if (open?.id) opportunityId = open.id;
    }
  }

  if (!opportunityId) {
    const who = lead.name || phone || email || 'Лид';
    const opp = await client.createOpportunity({
      name: `${who} · ${sourceLabel(lead.source)}`,
      personId,
      stage: lead.endpoint.defaultStage || 'NEW',
    });
    opportunityId = opp?.id;
    createdNewOpp = Boolean(opportunityId);
  }

  const noteBody = buildNoteBody({
    source: lead.source,
    formId: lead.formId,
    pageUrl: lead.pageUrl,
    referer: lead.referer,
    comment: lead.comment,
    attribution,
    rawFields,
  });

  try {
    await client.createNoteForPerson({
      personId,
      title: `Заявка с сайта (${sourceLabel(lead.source)})`,
      body: noteBody,
    });
  } catch (err) {
    console.warn('[form-lead] createNoteForPerson failed', err);
  }

  // Cross-channel enrich: phone → TG + MAX + WA (IsOnWhatsApp).
  // 4.4: mandatory bounded retry on hard failure; result stored in payload.enrichment.
  let enrichment:
    | {
        ok: boolean;
        fields?: string[];
        channels?: string[];
        error?: string;
        attempts: number;
        at: string;
      }
    | undefined;
  if (phone) {
    const { enrichPersonCrossChannelByPhone } = await import(
      './enrich-person-by-phone.js'
    );
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        const row = await enrichPersonCrossChannelByPhone({
          prisma,
          twenty: client,
          tenantId: lead.tenantId,
          personId,
          phone,
        });
        enrichment = {
          ok: row.ok,
          fields: row.fields,
          channels: row.channels,
          error: row.error,
          attempts: attempt + 1,
          at: new Date().toISOString(),
        };
        // ok=true (including "not on channel" soft skips) is terminal; only hard-fail retries.
        if (row.ok) break;
      } catch (err) {
        enrichment = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          attempts: attempt + 1,
          at: new Date().toISOString(),
        };
        console.warn(
          `[form-lead] cross-channel enrich failed (attempt ${attempt + 1})`,
          err,
        );
      }
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise((r) => setTimeout(r, retryBackoffMs(attempt)));
      }
    }
  }

  // 4.4: persist enrichment result into payload without clobbering existing keys.
  const nextPayload = enrichment
    ? { ...payload, enrichment }
    : undefined;

  await prisma.formLead.update({
    where: { id: lead.id },
    data: {
      personId,
      opportunityId: opportunityId || null,
      attributionId,
      needsReview,
      status: needsReview ? 'needs_review' : 'processed',
      error: null,
      ...(nextPayload ? { payload: nextPayload as object } : {}),
    },
  });

  // 4.3: record a cross-channel interaction-history row for this lead.
  try {
    await prisma.customerActivity.create({
      data: {
        tenantId: lead.tenantId,
        twentyPersonId: personId,
        phoneFingerprint: phoneFingerprint(lead.phone) || null,
        kind: 'form_lead',
        channel: lead.source,
        title: `Заявка с сайта (${sourceLabel(lead.source)})`,
        description: lead.comment || null,
        formLeadId: lead.id,
        meta: {
          opportunityId: opportunityId || null,
          formId: lead.formId || null,
          pageUrl: lead.pageUrl || null,
          attribution,
          enrichment: enrichment || null,
        } as object,
      },
    });
  } catch (err) {
    console.warn('[form-lead] customerActivity create failed', err);
  }

  // fireGoal — do not break gift goals; new goal name only
  try {
    await fireGoal({
      tenantId: lead.tenantId,
      goalName: 'web_form_lead',
      subscriberId: lead.externalId || lead.id,
      attributionId,
      attribution: {
        ymUid: attribution.ymUid,
        yclid: attribution.yclid,
        gclid: attribution.gclid,
        fbp: attribution.fbp,
        fbc: attribution.fbc,
        rbClickid: attribution.rbClickid,
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        utmCampaign: attribution.utmCampaign,
      },
      payload: {
        personId,
        opportunityId,
        source: lead.source,
        formId: lead.formId,
        endpointId: lead.endpointId,
        createdNewOpp,
        formLeadId: lead.id,
      },
    });
  } catch (err) {
    console.warn('[form-lead] fireGoal failed', err);
  }

  console.log(
    `[form-lead] processed ${lead.id} person=${personId} opp=${opportunityId || '-'} review=${needsReview}`,
  );
}
