import type { Prisma, PrismaClient } from '@voxly/db';
import { TRIAL_PERIOD_DAYS } from '@voxly/shared';

type AddonConfig = {
  trial?: boolean;
  trialConsumed?: boolean;
  [key: string]: unknown;
};

export type ChannelTrialType =
  | 'ai_gramjs'
  | 'ai_wa'
  | 'mailing_bot'
  | 'mailing_accounts'
  | 'mailing_stories';

/**
 * One-shot trial for a channel/mailing addon.
 * Refuses if already active or trial was used before.
 * Duration = TRIAL_PERIOD_DAYS (global, currently 7).
 */
export async function startChannelTrial(
  prisma: PrismaClient,
  tenantId: string,
  type: ChannelTrialType,
) {
  const now = new Date();
  const existing = await prisma.addon.findUnique({
    where: { tenantId_type: { tenantId, type } },
  });

  if (existing) {
    const cfg = (existing.config as AddonConfig) || {};
    const active = existing.status === 'active' && existing.activeUntil > now;
    if (active) {
      return {
        ok: false as const,
        code: 409,
        error: 'Тариф уже активен',
        addon: existing,
      };
    }
    if (cfg.trialConsumed) {
      return {
        ok: false as const,
        code: 409,
        error: 'Пробный период уже был использован. Оформите оплату.',
        addon: existing,
      };
    }
  }

  const activeUntil = new Date(now);
  activeUntil.setDate(activeUntil.getDate() + TRIAL_PERIOD_DAYS);
  const config = {
    ...((existing?.config as AddonConfig) || {}),
    trial: true,
    trialConsumed: true,
  } as Prisma.InputJsonValue;

  const addon = await prisma.addon.upsert({
    where: { tenantId_type: { tenantId, type } },
    create: {
      tenantId,
      type,
      config,
      activeUntil,
      status: 'active',
    },
    update: {
      status: 'active',
      activeUntil,
      config,
    },
  });

  return {
    ok: true as const,
    addon,
    isTrial: true,
    days: TRIAL_PERIOD_DAYS,
  };
}

export function trialMeta(addon: {
  status: string;
  activeUntil: Date;
  config: unknown;
} | null) {
  const now = new Date();
  const cfg = (addon?.config as AddonConfig) || {};
  const isActive = Boolean(addon && addon.status === 'active' && addon.activeUntil > now);
  const trialConsumed = Boolean(cfg.trialConsumed);
  return {
    isActive,
    isTrial: Boolean(cfg.trial) && isActive,
    trialAvailable: !isActive && !trialConsumed,
    activeUntil: addon?.activeUntil ?? null,
    status: addon?.status ?? null,
  };
}

/** Soft-gate: active addon (paid or trial) required to send/schedule. */
export async function requireActiveAddon(
  prisma: PrismaClient,
  tenantId: string,
  type: ChannelTrialType,
): Promise<{ ok: true } | { ok: false; code: 402; error: string; meta: ReturnType<typeof trialMeta> }> {
  const addon = await prisma.addon.findUnique({
    where: { tenantId_type: { tenantId, type } },
  });
  const meta = trialMeta(addon);
  if (meta.isActive) return { ok: true };
  return {
    ok: false,
    code: 402,
    error: meta.trialAvailable
      ? 'Нужен пробный период или оплата add-on'
      : 'Оформите оплату add-on',
    meta,
  };
}
