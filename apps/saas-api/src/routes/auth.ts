// Auth routes: register, login, invite members

import type { FastifyPluginAsync } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { PRICING, PRODUCT_CODES, TRIAL_PERIOD_DAYS, pickPrimaryMembership } from '@voxly/shared';
import { encrypt, generateSecret } from '@voxly/crypto';
import { provisionWorkspace } from '../services/provisioning.js';
import { provisionTwentyMemberForTenant } from '../services/twenty-member-provision.js';
import { assertCrmAccessAllowed } from '../services/crm-access.js';
import {
  createLoginChallenge,
  createRegisterChallenge,
  linkTelegramToUser,
  verifyOtpChallenge,
} from '../services/auth-otp.js';
import { platformBotUsername } from '../services/platform-telegram.js';

function buildCrmPublicUrl(crmSubdomain: string | null | undefined, slug: string): string {
  const voxlyDomain = process.env.VOXLY_DOMAIN?.trim() || 'getvoxly.ru';
  const host = crmSubdomain ? `${crmSubdomain}.${voxlyDomain}` : `${slug}-crm.${voxlyDomain}`;
  return `https://${host}`;
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  companySlug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/),
  referralCode: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const otpConfirmSchema = z.object({
  nonce: z.string().min(8),
  code: z.string().min(4).max(12),
});

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'member']).default('member'),
});

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // --- Register step 1: pending OTP session (no user yet) ---
  fastify.post('/register/start', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { password, firstName, lastName, companySlug, referralCode } = parsed.data;
    const email = parsed.data.email.trim().toLowerCase();
    const prisma = fastify.prisma;

    if (await prisma.user.findUnique({ where: { email } })) {
      return reply.code(409).send({ error: 'Email already registered' });
    }
    if (await prisma.tenant.findUnique({ where: { slug: companySlug } })) {
      return reply.code(409).send({ error: 'Company slug already taken' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const challenge = await createRegisterChallenge(prisma, {
      email,
      passwordHash,
      firstName: firstName || null,
      lastName: lastName || null,
      companySlug,
      referralCode: referralCode || null,
    });

    return reply.code(200).send({
      needsOtp: true,
      ...challenge,
      message: `Откройте @${platformBotUsername()} по ссылке и введите код из бота`,
    });
  });

  // --- Register step 2: confirm OTP → create tenant + provision ---
  fastify.post('/register/confirm', async (request, reply) => {
    const parsed = otpConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const prisma = fastify.prisma;
    const voxlyDomain = fastify.voxlyDomain;

    const verified = await verifyOtpChallenge({
      prisma,
      nonce: parsed.data.nonce,
      code: parsed.data.code,
      expectedPurposes: ['register'],
    });
    if (!verified.ok) {
      return reply.code(verified.status).send({ error: verified.error });
    }

    const challenge = verified.challenge;
    const pending = (challenge.pendingPayload || {}) as {
      email?: string;
      passwordHash?: string;
      firstName?: string | null;
      lastName?: string | null;
      companySlug?: string;
      referralCode?: string | null;
    };
    const email = String(pending.email || '').toLowerCase();
    const companySlug = String(pending.companySlug || '');
    const passwordHash = String(pending.passwordHash || '');
    if (!email || !companySlug || !passwordHash || !challenge.telegramUserId || !challenge.chatId) {
      return reply.code(400).send({ error: 'Неполная сессия регистрации' });
    }
    if (await prisma.user.findUnique({ where: { email } })) {
      return reply.code(409).send({ error: 'Email already registered' });
    }
    if (await prisma.tenant.findUnique({ where: { slug: companySlug } })) {
      return reply.code(409).send({ error: 'Company slug already taken' });
    }

    const tgTaken = await prisma.user.findFirst({
      where: { telegramUserId: challenge.telegramUserId },
    });
    if (tgTaken) {
      return reply.code(409).send({
        error: 'Этот Telegram уже привязан к другому аккаунту. Войдите или отвяжите его.',
      });
    }

    const trialStartsAt = new Date();
    const trialEndsAt = new Date(trialStartsAt);
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_PERIOD_DAYS);
    const twentyOwnerPassword = generateSecret(24);
    const twentyOwnerPasswordEncrypted = encrypt(twentyOwnerPassword);
    const firstName = pending.firstName || undefined;
    const lastName = pending.lastName || undefined;
    const referralCode = pending.referralCode || undefined;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          firstName,
          lastName,
          telegramUserId: challenge.telegramUserId!,
          telegramLinkedAt: new Date(),
        },
      });

      const tenant = await tx.tenant.create({
        data: {
          slug: companySlug,
          portalHost: `${companySlug}.${voxlyDomain}`,
          crmSubdomain: `${companySlug}-crm`,
          twentyOwnerPasswordEncrypted,
          status: 'trial',
          subscriptions: {
            create: {
              productCode: PRODUCT_CODES.CRM_BASE,
              periodMonths: 0,
              seatsIncluded: PRICING.SEATS_INCLUDED,
              startsAt: trialStartsAt,
              endsAt: trialEndsAt,
              status: 'active',
            },
          },
          users: {
            create: {
              userId: user.id,
              role: 'owner',
            },
          },
          aiWallet: { create: { balanceRub: 0 } },
          tenantBalance: { create: { balanceRub: 0 } },
          referralCode: {
            create: {
              code: generateReferralCode(companySlug),
            },
          },
        },
      });

      if (referralCode) {
        const { resolveReferralAttribution } = await import('../services/referral-program.js');
        const attr = await resolveReferralAttribution(tx, referralCode);
        if (attr && attr.referrerTenantId !== tenant.id) {
          await tx.referral.create({
            data: {
              referrerTenantId: attr.referrerTenantId,
              referredTenantId: tenant.id,
              campaignId: attr.campaignId,
              status: 'attributed',
            },
          });
        }
      }

      await tx.platformBotSubscriber.upsert({
        where: { telegramUserId: challenge.telegramUserId! },
        create: {
          telegramUserId: challenge.telegramUserId!,
          chatId: challenge.chatId!,
          userId: user.id,
        },
        update: {
          chatId: challenge.chatId!,
          userId: user.id,
          blocked: false,
          updatedAt: new Date(),
        },
      });

      return { user, tenant };
    });

    try {
      await provisionWorkspace({
        tenantId: result.tenant.id,
        workspaceName: companySlug,
        subdomain: companySlug,
        ownerEmail: email,
        ownerPasswordEncrypted: twentyOwnerPasswordEncrypted,
        ownerFirstName: firstName,
        ownerLastName: lastName,
      });
    } catch (error) {
      fastify.log.error({ err: error, tenantId: result.tenant.id }, 'Failed to enqueue CRM provisioning');
      await prisma.tenant.update({
        where: { id: result.tenant.id },
        data: { status: 'provisioning_failed' },
      });
    }

    const token = fastify.jwt.sign({
      sub: result.user.id,
      email: result.user.email,
      role: result.user.role,
      tenantRole: 'owner',
      tenantId: result.tenant.id,
    });

    return reply.code(201).send({
      token,
      user: { id: result.user.id, email, firstName, lastName },
      tenant: { id: result.tenant.id, slug: result.tenant.slug, portalHost: result.tenant.portalHost },
    });
  });

  // Legacy /register → force OTP flow
  fastify.post('/register', async (_request, reply) => {
    return reply.code(400).send({
      error: 'Use /api/auth/register/start then /register/confirm with Telegram OTP',
      needsOtp: true,
    });
  });

  // --- Login: superadmin JWT; others need Telegram OTP ---
  fastify.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid credentials' });
    }

    const { email, password } = parsed.data;
    const prisma = fastify.prisma;

    const user = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: {
        tenantMembers: {
          include: { tenant: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Invalid credentials' });
    }

    const primaryMembership = pickPrimaryMembership(user.tenantMembers);

    if (user.role === 'superadmin') {
      const token = fastify.jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        tenantRole: primaryMembership?.role,
        tenantId: primaryMembership?.tenantId,
      });
      return reply.send({
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantRole: primaryMembership?.role,
        },
        tenants: user.tenantMembers.map((m) => ({
          id: m.tenant.id,
          slug: m.tenant.slug,
          portalHost: m.tenant.portalHost,
          role: m.role,
        })),
      });
    }

    const challenge = await createLoginChallenge(prisma, user.id, user.telegramUserId);
    return reply.send({
      needsOtp: true,
      ...challenge,
      message: challenge.needsTelegramLink
        ? `Привяжите Telegram: откройте @${platformBotUsername()} по ссылке`
        : `Код отправлен в @${platformBotUsername()}`,
    });
  });

  fastify.post('/login/confirm', async (request, reply) => {
    const parsed = otpConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }
    const prisma = fastify.prisma;

    const verified = await verifyOtpChallenge({
      prisma,
      nonce: parsed.data.nonce,
      code: parsed.data.code,
      expectedPurposes: ['login', 'link'],
    });
    if (!verified.ok) {
      return reply.code(verified.status).send({ error: verified.error });
    }

    const challenge = verified.challenge;
    if (!challenge.userId || !challenge.telegramUserId || !challenge.chatId) {
      return reply.code(400).send({ error: 'Неполная сессия входа' });
    }

    const user = await prisma.user.findUnique({
      where: { id: challenge.userId },
      include: {
        tenantMembers: {
          include: { tenant: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    await linkTelegramToUser(
      prisma,
      user.id,
      challenge.telegramUserId,
      challenge.chatId,
    );

    const primaryMembership = pickPrimaryMembership(user.tenantMembers);
    const token = fastify.jwt.sign({
      sub: user.id,
      email: user.email,
      role: user.role,
      tenantRole: primaryMembership?.role,
      tenantId: primaryMembership?.tenantId,
    });

    return reply.send({
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantRole: primaryMembership?.role,
      },
      tenants: user.tenantMembers.map((m) => ({
        id: m.tenant.id,
        slug: m.tenant.slug,
        portalHost: m.tenant.portalHost,
        role: m.role,
      })),
    });
  });

  // --- Get current user ---
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = (request as any).user.sub;
    const prisma = fastify.prisma;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenantMembers: {
          include: {
            tenant: {
              include: {
                subscriptions: { orderBy: { endsAt: 'desc' } },
                addons: true,
                aiWallet: true,
                referralCode: true,
                users: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return reply.code(404).send({ error: 'User not found' });
    }

    const primary = user.tenantMembers[0];
    const tenant = primary?.tenant;
    const activeSub =
      tenant?.subscriptions.find((s) => s.status === 'active') ?? tenant?.subscriptions[0] ?? null;

    // Flat shape expected by the portal dashboard
    return reply.send({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      telegramUserId: user.telegramUserId?.toString(),
      tenant: tenant
        ? {
            id: tenant.id,
            slug: tenant.slug,
            name: tenant.slug,
            status: tenant.status,
            portalHost: tenant.portalHost,
            crmSubdomain: tenant.crmSubdomain,
            twentyWorkspaceId: tenant.twentyWorkspaceId,
            membershipRole: primary.role,
            subscription: activeSub
              ? {
                  status: activeSub.status,
                  plan: activeSub.productCode,
                  isTrial: activeSub.periodMonths === 0,
                  startsAt: activeSub.startsAt,
                  expiresAt: activeSub.endsAt,
                  seatsUsed: tenant.users.length,
                  seatsIncluded: activeSub.seatsIncluded + activeSub.extraSeats,
                }
              : null,
            addons: tenant.addons.map((a) => ({
              id: a.id,
              type: a.type,
              status: a.status,
            })),
            aiWallet: {
              balanceRub: Number(tenant.aiWallet?.balanceRub ?? 0),
            },
            referralCode: tenant.referralCode
              ? { code: tenant.referralCode.code }
              : null,
          }
        : null,
      tenants: user.tenantMembers.map((m) => ({
        id: m.tenant.id,
        slug: m.tenant.slug,
        portalHost: m.tenant.portalHost,
        crmSubdomain: m.tenant.crmSubdomain,
        status: m.tenant.status,
        role: m.role,
      })),
    });
  });

  // --- Invite member to tenant ---
  fastify.post('/invite', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const email = parsed.data.email.trim().toLowerCase();
    const { role } = parsed.data;
    const { tenantId, sub: ownerUserId, email: ownerEmail, role: userRole, tenantRole } =
      (request as any).user;
    const prisma = fastify.prisma;

    // Only owner or superadmin can invite
    if (userRole !== 'superadmin' && tenantRole !== 'owner' && userRole !== 'owner') {
      return reply.code(403).send({ error: 'Only workspace owners can invite' });
    }

    // Check seat limit
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: {
        subscriptions: {
          where: { status: 'active', productCode: 'crm_base' },
          orderBy: { endsAt: 'desc' },
          take: 1,
        },
        users: true,
      },
    });

    if (!tenant) {
      return reply.code(404).send({ error: 'Tenant not found' });
    }

    const denied = await assertCrmAccessAllowed(prisma, tenantId);
    if (denied) {
      return reply.code(denied.code || 403).send({
        error: denied.error,
        reason: denied.reason,
        crmAccessLocked: true,
        message: denied.error,
      });
    }

    const activeSub = tenant.subscriptions[0];
    const seatLimit = activeSub ? activeSub.seatsIncluded + activeSub.extraSeats : PRICING.SEATS_INCLUDED;
    if (tenant.users.length >= seatLimit) {
      return reply.code(403).send({
        error: 'Seat limit reached',
        current: tenant.users.length,
        limit: seatLimit,
        message: 'Purchase additional seats to invite more members',
      });
    }

    const tempPassword = nanoid(16);
    const crmUrl = buildCrmPublicUrl(tenant.crmSubdomain, tenant.slug);
    const resolvedOwnerEmail =
      typeof ownerEmail === 'string' && ownerEmail
        ? ownerEmail
        : (
            await prisma.user.findUnique({
              where: { id: ownerUserId },
              select: { email: true },
            })
          )?.email;

    if (!resolvedOwnerEmail) {
      return reply.code(500).send({ error: 'Owner email not found' });
    }

    const provisionAndStore = async (memberId: string) => {
      const provisioned = await provisionTwentyMemberForTenant({
        tenant,
        ownerEmail: resolvedOwnerEmail,
        memberEmail: email,
        memberPassword: tempPassword,
        log: fastify.log,
      });
      if (provisioned.ok && provisioned.twentyPasswordEncrypted) {
        await prisma.tenantMember.update({
          where: { id: memberId },
          data: { twentyPasswordEncrypted: provisioned.twentyPasswordEncrypted },
        });
        return { twentyProvisioned: true as const };
      }
      return {
        twentyProvisioned: false as const,
        warning: provisioned.error || 'CRM user was not created in Twenty',
      };
    };

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingMember = await prisma.tenantMember.findUnique({
        where: { tenantId_userId: { tenantId, userId: existingUser.id } },
      });
      if (existingMember) {
        return reply.code(409).send({ error: 'User already a member' });
      }

      // Reset password so invite credentials work for both Voxly + Twenty
      const passwordHash = await bcrypt.hash(tempPassword, 12);
      await prisma.user.update({
        where: { id: existingUser.id },
        data: { passwordHash },
      });
      const member = await prisma.tenantMember.create({
        data: { tenantId, userId: existingUser.id, role },
      });
      const provision = await provisionAndStore(member.id);

      return reply.code(201).send({
        message: 'Existing user added to workspace',
        userId: existingUser.id,
        memberId: member.id,
        email,
        tempPassword,
        crmUrl,
        ...provision,
      });
    }

    const passwordHash = await bcrypt.hash(tempPassword, 12);
    const newUser = await prisma.user.create({
      data: {
        email,
        passwordHash,
        tenantMembers: { create: { tenantId, role } },
      },
      include: { tenantMembers: { where: { tenantId } } },
    });
    const member = newUser.tenantMembers[0];
    const provision = member
      ? await provisionAndStore(member.id)
      : { twentyProvisioned: false as const, warning: 'Member row missing after create' };

    return reply.code(201).send({
      message: 'Member invited',
      userId: newUser.id,
      memberId: member?.id,
      email,
      tempPassword,
      crmUrl,
      ...provision,
    });
  });
};

function generateReferralCode(slug: string): string {
  const prefix = slug.slice(0, 4).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${suffix}`;
}
