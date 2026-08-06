/**
 * Cross-channel Person enrich by phone:
 * - GramJS ImportContacts + GetFullUser (Telegram)
 * - max-bridge search_by_phone / import_contacts (MAX)
 * - WA worker Evolution IsOnWhatsApp → Person.whatsapp wa.me (never invent without exists)
 * Used by admin backfill, form-lead, TG/MAX sync. Never invents t.me/+phone or max.ru/+phone.
 */
import type { PrismaClient } from '@voxly/db';
import { decrypt } from '@voxly/crypto';
import { TwentyClient, isPlaceholderPersonName } from '@voxly/twenty-client';
import pg from 'pg';

export type EnrichByPhoneRow = {
  personId: string;
  phone: string;
  ok: boolean;
  error?: string;
  fields?: string[];
  name?: string;
  channels?: string[];
};

export type EnrichByPhoneSummary = {
  ok: boolean;
  slug?: string;
  gramjsBotId?: string;
  maxBotId?: string;
  scanned: number;
  enriched: number;
  skipped: number;
  failed: number;
  results: EnrichByPhoneRow[];
  error?: string;
};

function gramjsBridgeBase(): string {
  return (process.env.GRAMJS_BRIDGE_URL || 'http://gramjs-bridge:3008').replace(
    /\/$/,
    '',
  );
}

function maxBridgeBase(): string {
  return (process.env.MAX_BRIDGE_URL || 'http://max-bridge:3010').replace(
    /\/$/,
    '',
  );
}

function whatsappWorkerBase(): string {
  return (
    process.env.AI_WHATSAPP_WORKER_URL || 'http://ai-whatsapp-worker:3006'
  ).replace(/\/$/, '');
}

export type EnrichChannel = 'telegram' | 'max' | 'whatsapp';

function serviceToken(): string {
  return process.env.VOXLY_SERVICE_TOKEN || '';
}

function normalizeDigits(raw: string): string {
  return String(raw || '').replace(/\D/g, '');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Candidate = { personId: string; phone: string; firstName: string; lastName: string };

async function listWaEnrichCandidates(
  workspaceId: string,
  limit: number,
): Promise<Candidate[]> {
  const connectionString = process.env.TWENTY_DATABASE_URL?.trim();
  if (!connectionString) return [];
  const client = new pg.Client({ connectionString });
  try {
    await client.connect();
    const ws = await client.query<{ databaseSchema: string | null }>(
      `SELECT "databaseSchema" FROM core.workspace WHERE id = $1::uuid`,
      [workspaceId],
    );
    const schema = ws.rows[0]?.databaseSchema;
    if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) return [];

    const cols = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'person'
         AND column_name IN ('maxPrimaryLinkUrl', 'max')`,
      [schema],
    );
    const colNames = new Set(cols.rows.map((r) => r.column_name));
    const maxCol = colNames.has('maxPrimaryLinkUrl')
      ? '"maxPrimaryLinkUrl"'
      : colNames.has('max')
        ? 'max'
        : null;
    const maxEmptyClause = maxCol
      ? `OR COALESCE(${maxCol}::text, '') = ''`
      : '';

    const q = await client.query<{
      id: string;
      nameFirstName: string | null;
      nameLastName: string | null;
      phonesPrimaryPhoneNumber: string | null;
      whatsappPrimaryLinkUrl: string | null;
      telegramPrimaryLinkUrl: string | null;
    }>(
      `SELECT id, "nameFirstName", "nameLastName", "phonesPrimaryPhoneNumber",
              "whatsappPrimaryLinkUrl", "telegramPrimaryLinkUrl"
       FROM "${schema}".person
       WHERE "deletedAt" IS NULL
         AND (
           COALESCE("phonesPrimaryPhoneNumber", '') <> ''
           OR COALESCE("whatsappPrimaryLinkUrl", '') ~ 'wa\\.me/[0-9]{10,15}'
         )
         AND (
           "nameFirstName" ~* '^noname[0-9]*$'
           OR COALESCE("telegramPrimaryLinkUrl", '') = ''
           ${maxEmptyClause}
         )
       ORDER BY "updatedAt" DESC
       LIMIT $1`,
      [limit],
    );
    return q.rows
      .map((r) => {
        const fromPhone = normalizeDigits(r.phonesPrimaryPhoneNumber || '');
        const waMatch = String(r.whatsappPrimaryLinkUrl || '').match(
          /wa\.me\/(\d{10,15})/i,
        );
        const fromWa = waMatch ? waMatch[1]! : '';
        // Prefer longer E.164 (wa.me) when phones field was truncated (e.g. 778… vs 7778…).
        const phone =
          fromWa.length >= fromPhone.length && fromWa.length >= 10
            ? fromWa
            : fromPhone;
        return {
          personId: r.id,
          phone,
          firstName: String(r.nameFirstName || ''),
          lastName: String(r.nameLastName || ''),
        };
      })
      .filter((r) => r.phone.length >= 10 && r.phone.length <= 15);
  } catch (err) {
    console.warn(
      '[enrich-by-phone] list candidates failed',
      err instanceof Error ? err.message : err,
    );
    return [];
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function resolveTelegramByPhone(opts: {
  botId: string;
  tenantId: string;
  phone: string;
}): Promise<{
  exists?: boolean;
  userId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  about?: string;
  birthday?: string;
  personalChannelUrl?: string;
  phone?: string;
  error?: string;
}> {
  const token = serviceToken();
  if (!token) return { error: 'VOXLY_SERVICE_TOKEN unset' };
  const res = await fetch(`${gramjsBridgeBase()}/users/by-phone`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      tenantId: opts.tenantId,
      phone: `+${opts.phone}`,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    exists?: boolean;
    userId?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    about?: string;
    birthday?: string;
    personalChannelUrl?: string;
    phone?: string;
    error?: string;
  };
  if (!res.ok || !json.ok) {
    return { error: json.error || `HTTP ${res.status}` };
  }
  return json;
}

async function resolveMaxByPhone(opts: {
  botId: string;
  phone: string;
}): Promise<{
  exists?: boolean;
  userId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  link?: string;
  about?: string;
  phone?: string;
  error?: string;
}> {
  const token = serviceToken();
  if (!token) return { error: 'VOXLY_SERVICE_TOKEN unset' };
  const res = await fetch(`${maxBridgeBase()}/users/by-phone`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      botId: opts.botId,
      phone: `+${opts.phone}`,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    exists?: boolean;
    userId?: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    link?: string;
    about?: string;
    phone?: string;
    error?: string;
    detail?: string;
  };
  if (!res.ok || !json.ok) {
    return { error: json.error || json.detail || `HTTP ${res.status}` };
  }
  return json;
}

/**
 * Enrich one Person from phone → GramJS. Shared contract with WA worker enrich.
 */
export async function enrichOnePersonByPhone(opts: {
  twenty: TwentyClient;
  tenantId: string;
  botId: string;
  personId: string;
  phone: string;
}): Promise<EnrichByPhoneRow> {
  const phone = normalizeDigits(opts.phone);
  if (!opts.personId || phone.length < 10) {
    return { personId: opts.personId, phone, ok: false, error: 'bad_input' };
  }

  const resolved = await resolveTelegramByPhone({
    botId: opts.botId,
    tenantId: opts.tenantId,
    phone,
  });
  if (resolved.error) {
    return {
      personId: opts.personId,
      phone,
      ok: false,
      error: resolved.error,
      channels: ['telegram'],
    };
  }
  if (resolved.exists === false) {
    return {
      personId: opts.personId,
      phone,
      ok: true,
      fields: [],
      error: 'not_on_telegram',
      channels: ['telegram'],
    };
  }
  if (!resolved.userId && !resolved.username) {
    return {
      personId: opts.personId,
      phone,
      ok: false,
      error: 'no_user_id',
      channels: ['telegram'],
    };
  }

  const fn = String(resolved.firstName || '').trim();
  const ln = String(resolved.lastName || '').trim();
  const probe = isPlaceholderPersonName(fn, ln);

  await opts.twenty.applyTelegramProfile(opts.personId, {
    userId: resolved.userId,
    username: resolved.username,
    firstName: probe ? undefined : fn || undefined,
    lastName: probe ? undefined : ln || undefined,
    about: resolved.about,
    birthday: resolved.birthday,
    personalChannelUrl: resolved.personalChannelUrl,
    // Only write phone when it matches the WA/source E.164 we already trust.
    phone:
      normalizeDigits(resolved.phone || '') === phone ? `+${phone}` : undefined,
  });

  const fields = [
    (resolved.username || resolved.userId) && 'telegram',
    !probe && (fn || ln) && 'name',
    resolved.about && 'about',
    resolved.birthday && 'birthday',
    resolved.personalChannelUrl && 'website',
  ].filter(Boolean) as string[];

  return {
    personId: opts.personId,
    phone,
    ok: true,
    fields,
    name: !probe && (fn || ln) ? [fn, ln].filter(Boolean).join(' ') : undefined,
    channels: ['telegram'],
  };
}

/**
 * Enrich one Person from phone → MAX (PyMax search_by_phone).
 * Writes name (placeholder only) + Person.max when link present. No birthday.
 */
export async function enrichOnePersonMaxByPhone(opts: {
  twenty: TwentyClient;
  botId: string;
  personId: string;
  phone: string;
}): Promise<EnrichByPhoneRow> {
  const phone = normalizeDigits(opts.phone);
  if (!opts.personId || phone.length < 10) {
    return {
      personId: opts.personId,
      phone,
      ok: false,
      error: 'bad_input',
      channels: ['max'],
    };
  }

  const resolved = await resolveMaxByPhone({
    botId: opts.botId,
    phone,
  });
  if (resolved.error) {
    return {
      personId: opts.personId,
      phone,
      ok: false,
      error: resolved.error,
      channels: ['max'],
    };
  }
  if (resolved.exists === false) {
    return {
      personId: opts.personId,
      phone,
      ok: true,
      fields: [],
      error: 'not_on_max',
      channels: ['max'],
    };
  }
  if (!resolved.userId && !resolved.link) {
    return {
      personId: opts.personId,
      phone,
      ok: false,
      error: 'no_user',
      channels: ['max'],
    };
  }

  const fn = String(resolved.firstName || '').trim();
  const ln = String(resolved.lastName || '').trim();
  const probe = isPlaceholderPersonName(fn, ln);

  // Prefer real User.link; else @username / u/… handle (never phone digits).
  const handle = String(resolved.username || '').trim().replace(/^@/, '');
  const linkFromHandle =
    !resolved.link &&
    handle &&
    !/^\d{5,}$/.test(handle) &&
    !/^u$/i.test(handle)
      ? handle
      : undefined;

  await opts.twenty.applyMaxProfile(opts.personId, {
    firstName: probe ? undefined : fn || undefined,
    lastName: probe ? undefined : ln || undefined,
    link: resolved.link || linkFromHandle,
    userId: resolved.userId,
    about: resolved.about,
    phone:
      normalizeDigits(resolved.phone || '') === phone ? `+${phone}` : undefined,
  });

  const fields = [
    (resolved.link || linkFromHandle || resolved.userId) && 'max',
    !probe && (fn || ln) && 'name',
    resolved.about && 'about',
  ].filter(Boolean) as string[];

  return {
    personId: opts.personId,
    phone,
    ok: true,
    fields,
    name: !probe && (fn || ln) ? [fn, ln].filter(Boolean).join(' ') : undefined,
    channels: ['max'],
  };
}

/**
 * Enrich one Person from phone → Evolution IsOnWhatsApp → Person.whatsapp wa.me.
 */
export async function enrichOnePersonWhatsappByPhone(opts: {
  twenty: TwentyClient;
  tenantId: string;
  personId: string;
  phone: string;
  botId?: string;
}): Promise<EnrichByPhoneRow> {
  const phone = normalizeDigits(opts.phone);
  if (!opts.personId || phone.length < 10) {
    return {
      personId: opts.personId,
      phone,
      ok: false,
      error: 'bad_input',
      channels: ['whatsapp'],
    };
  }

  const token = serviceToken();
  if (!token) {
    return {
      personId: opts.personId,
      phone,
      ok: false,
      error: 'VOXLY_SERVICE_TOKEN unset',
      channels: ['whatsapp'],
    };
  }

  try {
    const res = await fetch(
      `${whatsappWorkerBase()}/internal/crm/check-on-whatsapp`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tenantId: opts.tenantId,
          phone: `+${phone}`,
          botId: opts.botId,
        }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      exists?: boolean;
      phone?: string;
      error?: string;
    };
    if (!res.ok || !json.ok) {
      return {
        personId: opts.personId,
        phone,
        ok: false,
        error: json.error || `HTTP ${res.status}`,
        channels: ['whatsapp'],
      };
    }
    if (json.error === 'no_wa_session') {
      return {
        personId: opts.personId,
        phone,
        ok: true,
        fields: [],
        error: 'no_wa_session',
        channels: ['whatsapp'],
      };
    }
    if (!json.exists) {
      return {
        personId: opts.personId,
        phone,
        ok: true,
        fields: [],
        error: 'not_on_whatsapp',
        channels: ['whatsapp'],
      };
    }

    await opts.twenty.updatePersonWhatsapp(opts.personId, `+${phone}`);
    return {
      personId: opts.personId,
      phone,
      ok: true,
      fields: ['whatsapp'],
      channels: ['whatsapp'],
    };
  } catch (err) {
    return {
      personId: opts.personId,
      phone,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      channels: ['whatsapp'],
    };
  }
}

const SOFT_ENRICH_ERRORS = new Set([
  'not_on_telegram',
  'not_on_max',
  'not_on_whatsapp',
  'no_wa_session',
]);

function mergeEnrichRows(
  personId: string,
  phone: string,
  parts: EnrichByPhoneRow[],
): EnrichByPhoneRow {
  if (parts.length === 0) {
    return { personId, phone, ok: false, error: 'no_channels' };
  }
  const fields = [...new Set(parts.flatMap((p) => p.fields || []))];
  const channels = [...new Set(parts.flatMap((p) => p.channels || []))];
  const name = parts.map((p) => p.name).find(Boolean);
  const hardFail = parts.every((p) => !p.ok);
  const softSkip = parts.every(
    (p) =>
      p.ok &&
      (!(p.fields?.length ?? 0) ||
        (p.error != null && SOFT_ENRICH_ERRORS.has(p.error))),
  );
  const errors = parts
    .map((p) => p.error)
    .filter((e): e is string => typeof e === 'string' && !SOFT_ENRICH_ERRORS.has(e));
  return {
    personId,
    phone,
    ok: !hardFail,
    fields,
    name,
    channels,
    error: hardFail
      ? errors[0] || parts[0]?.error
      : softSkip && fields.length === 0
        ? parts.map((p) => p.error).filter(Boolean).join('+') || undefined
        : errors[0],
  };
}

/**
 * Best-effort: phone → TG + MAX + WA for one Person (skip missing sessions).
 * Call after form-lead / TG / MAX sync when E.164 is known.
 */
export async function enrichPersonCrossChannelByPhone(opts: {
  prisma: PrismaClient;
  twenty: TwentyClient;
  tenantId: string;
  personId: string;
  phone: string;
  /** Default: all available sessions. Omit source channel if already written. */
  channels?: EnrichChannel[];
}): Promise<EnrichByPhoneRow> {
  const phone = normalizeDigits(opts.phone);
  if (!opts.personId || phone.length < 10) {
    return { personId: opts.personId, phone, ok: false, error: 'bad_input' };
  }

  const want = new Set<EnrichChannel>(
    opts.channels?.length
      ? opts.channels
      : (['telegram', 'max', 'whatsapp'] as EnrichChannel[]),
  );

  const parts: EnrichByPhoneRow[] = [];

  if (want.has('telegram')) {
    const gramjs = await opts.prisma.botInstance.findFirst({
      where: {
        tenantId: opts.tenantId,
        botType: 'ai_gramjs',
        status: 'active',
        botTokenEncrypted: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (gramjs) {
      parts.push(
        await enrichOnePersonByPhone({
          twenty: opts.twenty,
          tenantId: opts.tenantId,
          botId: gramjs.id,
          personId: opts.personId,
          phone,
        }),
      );
    }
  }

  if (want.has('max')) {
    const maxBot = await opts.prisma.botInstance.findFirst({
      where: {
        tenantId: opts.tenantId,
        botType: 'ai_max',
        status: 'active',
        botTokenEncrypted: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (maxBot) {
      parts.push(
        await enrichOnePersonMaxByPhone({
          twenty: opts.twenty,
          botId: maxBot.id,
          personId: opts.personId,
          phone,
        }),
      );
    }
  }

  if (want.has('whatsapp')) {
    const wa = await opts.prisma.botInstance.findFirst({
      where: {
        tenantId: opts.tenantId,
        botType: 'ai_wa',
        status: 'active',
        botTokenEncrypted: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });
    if (wa) {
      parts.push(
        await enrichOnePersonWhatsappByPhone({
          twenty: opts.twenty,
          tenantId: opts.tenantId,
          botId: wa.id,
          personId: opts.personId,
          phone,
        }),
      );
    }
  }

  if (parts.length === 0) {
    return {
      personId: opts.personId,
      phone,
      ok: true,
      fields: [],
      error: 'no_enrich_session',
    };
  }

  const merged = mergeEnrichRows(opts.personId, phone, parts);
  if ((merged.fields?.length ?? 0) > 0) {
    console.log(
      `[enrich-by-phone] person=${opts.personId} phone=+${phone} fields=${merged.fields?.join(',')}`,
    );
  }
  return merged;
}

export async function runEnrichPersonsByPhone(opts: {
  prisma: PrismaClient;
  twenty: TwentyClient;
  tenantId: string;
  botId?: string;
  maxBotId?: string;
  limit?: number;
  /** Explicit targets; omit → auto-scan noname/empty-TG/empty-MAX with phone. */
  targets?: Array<{ personId: string; phone: string }>;
  /** Delay between phone lookups (flood control). Default 1500ms. */
  delayMs?: number;
  /** Channels to try. Default all when sessions exist. */
  channels?: EnrichChannel[];
}): Promise<EnrichByPhoneSummary> {
  const limit = Math.min(Math.max(opts.limit ?? 40, 1), 150);
  const delayMs = Math.min(Math.max(opts.delayMs ?? 1500, 200), 10_000);
  const wantTg = !opts.channels || opts.channels.includes('telegram');
  const wantMax = !opts.channels || opts.channels.includes('max');
  const wantWa = !opts.channels || opts.channels.includes('whatsapp');

  const tenant = await opts.prisma.tenant.findUnique({
    where: { id: opts.tenantId },
    include: {
      users: {
        where: { role: 'owner' },
        include: { user: true },
        take: 1,
      },
    },
  });
  if (!tenant) {
    return {
      ok: false,
      scanned: 0,
      enriched: 0,
      skipped: 0,
      failed: 0,
      results: [],
      error: 'tenant_not_found',
    };
  }
  if (!tenant.twentyWorkspaceId || !tenant.twentyOwnerPasswordEncrypted) {
    return {
      ok: false,
      slug: tenant.slug,
      scanned: 0,
      enriched: 0,
      skipped: 0,
      failed: 0,
      results: [],
      error: 'crm_not_provisioned',
    };
  }
  const owner = tenant.users[0]?.user;
  if (!owner?.email) {
    return {
      ok: false,
      slug: tenant.slug,
      scanned: 0,
      enriched: 0,
      skipped: 0,
      failed: 0,
      results: [],
      error: 'owner_not_found',
    };
  }

  const gramjs = wantTg
    ? opts.botId
      ? await opts.prisma.botInstance.findFirst({
          where: {
            id: opts.botId,
            tenantId: opts.tenantId,
            botType: 'ai_gramjs',
            status: 'active',
            botTokenEncrypted: { not: null },
          },
        })
      : await opts.prisma.botInstance.findFirst({
          where: {
            tenantId: opts.tenantId,
            botType: 'ai_gramjs',
            status: 'active',
            botTokenEncrypted: { not: null },
          },
          orderBy: { updatedAt: 'desc' },
        })
    : null;

  const maxBot = wantMax
    ? opts.maxBotId
      ? await opts.prisma.botInstance.findFirst({
          where: {
            id: opts.maxBotId,
            tenantId: opts.tenantId,
            botType: 'ai_max',
            status: 'active',
            botTokenEncrypted: { not: null },
          },
        })
      : await opts.prisma.botInstance.findFirst({
          where: {
            tenantId: opts.tenantId,
            botType: 'ai_max',
            status: 'active',
            botTokenEncrypted: { not: null },
          },
          orderBy: { updatedAt: 'desc' },
        })
    : null;

  const waBot = wantWa
    ? await opts.prisma.botInstance.findFirst({
        where: {
          tenantId: opts.tenantId,
          botType: 'ai_wa',
          status: 'active',
          botTokenEncrypted: { not: null },
        },
        orderBy: { updatedAt: 'desc' },
      })
    : null;

  if (!gramjs && !maxBot && !waBot) {
    return {
      ok: false,
      slug: tenant.slug,
      scanned: 0,
      enriched: 0,
      skipped: 0,
      failed: 0,
      results: [],
      error: 'no_enrich_session',
    };
  }

  await opts.twenty.authenticateWorkspace(
    owner.email,
    decrypt(tenant.twentyOwnerPasswordEncrypted),
    tenant.twentyWorkspaceId,
  );
  try {
    await opts.twenty.ensureSocialFields();
  } catch {
    /* optional */
  }

  let candidates: Candidate[];
  if (opts.targets?.length) {
    candidates = opts.targets
      .map((t) => ({
        personId: t.personId,
        phone: normalizeDigits(t.phone),
        firstName: '',
        lastName: '',
      }))
      .filter((t) => t.personId && t.phone.length >= 10)
      .slice(0, limit);
  } else {
    candidates = await listWaEnrichCandidates(tenant.twentyWorkspaceId, limit);
  }

  const results: EnrichByPhoneRow[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
    const parts: EnrichByPhoneRow[] = [];
    try {
      if (gramjs) {
        parts.push(
          await enrichOnePersonByPhone({
            twenty: opts.twenty,
            tenantId: opts.tenantId,
            botId: gramjs.id,
            personId: c.personId,
            phone: c.phone,
          }),
        );
      }
      if (maxBot) {
        parts.push(
          await enrichOnePersonMaxByPhone({
            twenty: opts.twenty,
            botId: maxBot.id,
            personId: c.personId,
            phone: c.phone,
          }),
        );
      }
      if (waBot) {
        parts.push(
          await enrichOnePersonWhatsappByPhone({
            twenty: opts.twenty,
            tenantId: opts.tenantId,
            botId: waBot.id,
            personId: c.personId,
            phone: c.phone,
          }),
        );
      }
      results.push(mergeEnrichRows(c.personId, c.phone, parts));
    } catch (err) {
      results.push({
        personId: c.personId,
        phone: c.phone,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    if (i < candidates.length - 1) await sleep(delayMs);
  }

  return {
    ok: true,
    slug: tenant.slug,
    gramjsBotId: gramjs?.id,
    maxBotId: maxBot?.id,
    scanned: candidates.length,
    enriched: results.filter((r) => r.ok && (r.fields?.length ?? 0) > 0).length,
    skipped: results.filter(
      (r) => r.ok && !(r.fields?.length ?? 0),
    ).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
