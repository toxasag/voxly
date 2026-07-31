// Referral routes: dashboard, campaigns, click tracking

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { REFERRAL_WITHDRAWAL_MIN_RUB, normalizeReferralProductScope } from '@voxly/shared';
import {
  buildReferralDashboard,
  generateCampaignCode,
  incrementReferralClick,
  releaseBalanceHold,
  resolveReferralAttribution,
  withdrawalShape,
} from '../services/referral-program.js';

const campaignCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .regex(/^[A-Za-z0-9]+$/)
  .toUpperCase();

function codeIssueMessage(issue: z.ZodIssue | undefined): string {
  if (issue?.code === 'invalid_type') return 'Укажите код проекта';
  if (issue?.code === 'too_small') return 'Код должен быть не короче 4 символов';
  if (issue?.code === 'too_big') return 'Код должен быть не длиннее 32 символов';
  return 'Код может содержать только латинские буквы и цифры, без пробелов';
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string })?.code === 'P2002';
}

const codeTakenMessage = (code: string) => `Код ${code} уже занят — выберите другой`;

const withdrawalSchema = z.object({
  amountRub: z.number().positive().max(10_000_000),
  payoutDetails: z.string().trim().min(1).max(500),
  comment: z.string().trim().max(500).optional(),
});

function statusOf(err: unknown): number {
  return (err as { statusCode?: number }).statusCode || 500;
}

export const referralRoutes: FastifyPluginAsync = async (fastify) => {
  const isCodeTaken = async (code: string): Promise<boolean> =>
    Boolean(
      (await fastify.prisma.referralCampaign.findUnique({ where: { code } })) ||
        (await fastify.prisma.referralCode.findUnique({ where: { code } })),
    );

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
        name: z.string().trim().min(1).max(120),
        code: campaignCodeSchema.optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      const issue = body.error.issues[0];
      return reply.code(400).send({
        error:
          issue?.path[0] === 'code'
            ? codeIssueMessage(issue)
            : 'Укажите название проекта (от 1 до 120 символов)',
      });
    }

    const customCode = body.data.code ?? null;
    const prisma = fastify.prisma;
    let code = customCode ?? generateCampaignCode(body.data.name);

    for (let attempt = 0; attempt < (customCode ? 1 : 5); attempt++) {
      if (await isCodeTaken(code)) {
        if (customCode) return reply.code(409).send({ error: codeTakenMessage(code) });
        code = generateCampaignCode(body.data.name);
        continue;
      }

      try {
        const campaign = await prisma.referralCampaign.create({
          data: {
            tenantId,
            name: body.data.name,
            code,
          },
        });
        return reply.code(201).send({
          ...campaign,
          link: `https://${fastify.voxlyDomain}/r/${campaign.code}`,
        });
      } catch (err) {
        if (!isUniqueViolation(err)) {
          request.log.error({ err }, 'referral campaign create failed');
          return reply.code(500).send({ error: 'Не удалось создать ссылку' });
        }
        if (customCode) return reply.code(409).send({ error: codeTakenMessage(code) });
        code = generateCampaignCode(body.data.name);
      }
    }

    return reply.code(409).send({
      error: 'Не удалось подобрать свободный код — попробуйте ещё раз',
    });
  });

  // --- Check whether a campaign code is free (for inline validation) ---
  fastify.get(
    '/campaigns/code-available',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = campaignCodeSchema.safeParse((request.query as { code?: string }).code);
      if (!parsed.success) {
        return reply.code(400).send({ error: codeIssueMessage(parsed.error.issues[0]) });
      }
      return reply.send({ available: !(await isCodeTaken(parsed.data)) });
    },
  );

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

  // --- Request a payout of the partner balance ---
  fastify.post('/withdrawals', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const body = withdrawalSchema.safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Укажите сумму и реквизиты для выплаты' });
    }
    const { amountRub, payoutDetails, comment } = body.data;

    if (amountRub < REFERRAL_WITHDRAWAL_MIN_RUB) {
      return reply
        .code(400)
        .send({ error: `Минимальная сумма вывода — ${REFERRAL_WITHDRAWAL_MIN_RUB} ₽` });
    }

    const prisma = fastify.prisma;
    const alreadyPending = await prisma.referralWithdrawal.count({
      where: { tenantId, status: 'pending' },
    });
    if (alreadyPending > 0) {
      return reply.code(409).send({ error: 'У вас уже есть заявка на рассмотрении' });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Conditional update keeps the balance from going negative under concurrency
        const debited = await tx.tenantBalance.updateMany({
          where: { tenantId, balanceRub: { gte: amountRub } },
          data: { balanceRub: { decrement: amountRub } },
        });
        if (debited.count === 0) {
          throw Object.assign(new Error('Сумма больше доступного баланса'), { statusCode: 400 });
        }

        const withdrawal = await tx.referralWithdrawal.create({
          data: { tenantId, amountRub, payoutDetails, comment: comment || null },
        });
        const balance = await tx.tenantBalance.findUnique({ where: { tenantId } });

        return { withdrawal, balanceRub: Number(balance?.balanceRub ?? 0) };
      });

      return reply.code(201).send({
        withdrawal: withdrawalShape(result.withdrawal),
        balanceRub: result.balanceRub,
      });
    } catch (err) {
      const status = statusOf(err);
      if (status === 500) request.log.error({ err, tenantId }, 'withdrawal request failed');
      return reply.code(status).send({
        error:
          err instanceof Error && status !== 500 ? err.message : 'Не удалось создать заявку',
      });
    }
  });

  // --- Cancel own pending request: the reserved money goes back to the balance ---
  fastify.post(
    '/withdrawals/:id/cancel',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { id } = request.params as { id: string };
      const prisma = fastify.prisma;

      try {
        const result = await prisma.$transaction(async (tx) => {
          const cancelled = await tx.referralWithdrawal.updateMany({
            where: { id, tenantId, status: 'pending' },
            data: { status: 'cancelled' },
          });
          if (cancelled.count === 0) {
            throw Object.assign(new Error('Заявка не найдена или уже обработана'), {
              statusCode: 404,
            });
          }

          const withdrawal = await tx.referralWithdrawal.findUniqueOrThrow({ where: { id } });
          const balance = await tx.tenantBalance.upsert({
            where: { tenantId },
            create: { tenantId, balanceRub: withdrawal.amountRub },
            update: { balanceRub: { increment: withdrawal.amountRub } },
          });

          return { withdrawal, balanceRub: Number(balance.balanceRub) };
        });

        return reply.send({
          withdrawal: withdrawalShape(result.withdrawal),
          balanceRub: result.balanceRub,
        });
      } catch (err) {
        const status = statusOf(err);
        if (status === 500) request.log.error({ err, tenantId, id }, 'withdrawal cancel failed');
        return reply.code(status).send({
          error:
            err instanceof Error && status !== 500 ? err.message : 'Не удалось отменить заявку',
        });
      }
    },
  );

  // --- Release a balance hold on an unpaid invoice ---
  fastify.post(
    '/holds/:paymentId/release',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { tenantId } = (request as any).user;
      const { paymentId } = request.params as { paymentId: string };

      const result = await releaseBalanceHold(fastify.prisma, paymentId, tenantId);
      if (!result.released) return reply.code(404).send({ error: 'Резерв не найден' });

      return reply.send({ balanceRub: result.balanceRub ?? 0 });
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
        productScope: normalizeReferralProductScope(body.productScope),
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
