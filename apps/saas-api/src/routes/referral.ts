// Referral routes: dashboard, campaigns, click tracking

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  buildReferralDashboard,
  generateCampaignCode,
  incrementReferralClick,
  resolveReferralAttribution,
} from '../services/referral-program.js';

export const referralRoutes: FastifyPluginAsync = async (fastify) => {
  // --- Partner dashboard (stats + campaigns) ---
  fastify.get('/dashboard', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const q = request.query as { from?: string; to?: string };
    try {
      const data = await buildReferralDashboard(
        fastify.prisma,
        tenantId,
        fastify.voxlyDomain,
        q,
      );
      return reply.send(data);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'Dashboard failed',
      });
    }
  });

  // --- Legacy summary (keep for compatibility) ---
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    try {
      const data = await buildReferralDashboard(
        fastify.prisma,
        tenantId,
        fastify.voxlyDomain,
        {},
      );
      return reply.send({
        code: data.mainCode.code,
        link: data.mainCode.link,
        isActive: data.mainCode.isActive,
        clicksCount: data.mainCode.clicksCount,
        totalEarnings: String(data.totalEarnedAllTime),
        balance: String(data.balanceRub),
        referrals: data.referrals,
      });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 500;
      return reply.code(status).send({
        error: err instanceof Error ? err.message : 'Failed',
      });
    }
  });

  // --- Create project campaign / custom link ---
  fastify.post('/campaigns', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const body = z
      .object({
        name: z.string().min(1).max(120),
        code: z
          .string()
          .min(4)
          .max(32)
          .regex(/^[A-Za-z0-9]+$/)
          .optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'name required; code optional alphanumeric 4-32' });
    }

    let code = body.data.code?.toUpperCase() ?? generateCampaignCode(body.data.name);
    const prisma = fastify.prisma;

    for (let attempt = 0; attempt < 5; attempt++) {
      const exists =
        (await prisma.referralCampaign.findUnique({ where: { code } })) ||
        (await prisma.referralCode.findUnique({ where: { code } }));
      if (!exists) break;
      code = generateCampaignCode(body.data.name);
    }

    try {
      const campaign = await prisma.referralCampaign.create({
        data: {
          tenantId,
          name: body.data.name.trim(),
          code,
        },
      });
      return reply.code(201).send({
        ...campaign,
        link: `https://${fastify.voxlyDomain}/r/${campaign.code}`,
      });
    } catch (err) {
      return reply.code(409).send({
        error: err instanceof Error ? err.message : 'Code already exists',
      });
    }
  });

  // --- Manual expense for a project ---
  fastify.post(
    '/campaigns/:id/expenses',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { id } = request.params as { id: string };
      const body = z
        .object({
          amountRub: z.number().positive().max(10_000_000),
          note: z.string().max(500).optional(),
          spentAt: z.string().datetime().optional(),
        })
        .safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({ error: 'amountRub required (positive number)' });
      }

      const campaign = await fastify.prisma.referralCampaign.findFirst({
        where: { id, tenantId },
      });
      if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });

      const expense = await fastify.prisma.referralCampaignExpense.create({
        data: {
          tenantId,
          campaignId: id,
          amountRub: body.data.amountRub,
          note: body.data.note?.trim() || null,
          spentAt: body.data.spentAt ? new Date(body.data.spentAt) : new Date(),
        },
      });

      return reply.code(201).send({
        id: expense.id,
        campaignId: expense.campaignId,
        amountRub: Number(expense.amountRub),
        note: expense.note,
        spentAt: expense.spentAt.toISOString(),
      });
    },
  );

  // --- Admin: list referral rules ---
  fastify.get('/rules', { preHandler: [fastify.requireSuperadmin] }, async (_request, reply) => {
    const rules = await fastify.prisma.referralRule.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return reply.send({ rules });
  });

  // --- Admin: create/update referral rule ---
  fastify.post('/rules', { preHandler: [fastify.requireSuperadmin] }, async (request, reply) => {
    const body = request.body as {
      type: 'fixed_first_payment' | 'percent_first_payment' | 'percent_recurring' | 'credit_discount';
      value: number;
      durationMonths?: number;
      productScope?: string;
      isDefault?: boolean;
    };

    if (body.isDefault) {
      await fastify.prisma.referralRule.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const rule = await fastify.prisma.referralRule.create({
      data: {
        type: body.type,
        value: body.value,
        durationMonths: body.durationMonths,
        productScope: body.productScope || 'all',
        isDefault: body.isDefault || false,
      },
    });

    return reply.code(201).send(rule);
  });

  // --- Track referral click (public) → register with ref ---
  fastify.get('/click/:code', async (request, reply) => {
    const { code } = request.params as { code: string };
    const voxlyDomain = fastify.voxlyDomain;

    await incrementReferralClick(fastify.prisma, code);

    return reply.redirect(
      302,
      `https://${voxlyDomain}/register?ref=${encodeURIComponent(code)}`,
    );
  });
};

export { resolveReferralAttribution };
