// Admin referral routes: superadmin — partners overview, rules, payouts, blocking

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  REFERRAL_PRODUCT_SCOPES,
  REFERRAL_PRODUCT_SCOPE_VALUES,
  REFERRAL_COMMISSION_SKUS,
  isReferralCommissionSku,
} from '@voxly/shared';
import {
  MAIN_LINK_LABEL,
  buildReferralAdminOverview,
  buildReferralPartnerDetail,
  resolveEffectiveRuleShape,
  listPartnerServiceRates,
  upsertPartnerServiceRate,
  deletePartnerServiceRate,
} from '../services/referral-admin.js';
import { withdrawalShape } from '../services/referral-program.js';

const ruleTypeSchema = z.enum([
  'fixed_first_payment',
  'percent_first_payment',
  'percent_recurring',
  'credit_discount',
  'credit',
]);

const amountSchema = z.number().positive().max(10_000_000);
const durationSchema = z.number().int().positive().max(120).nullable().optional();
const productScopeSchema = z.enum(REFERRAL_PRODUCT_SCOPE_VALUES).optional();
const activeSchema = z.object({ isActive: z.boolean() });
const withdrawalStatusSchema = z.enum(['pending', 'paid', 'rejected', 'cancelled']);

const CANCEL_NOTICE =
  'Начисления и баланс не изменены: отмена привязки не откатывает уже выплаченное. Для списания используйте ручное списание.';

function statusOf(err: unknown): number {
  return (err as { statusCode?: number }).statusCode || 500;
}

export const adminReferralRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.requireSuperadmin);

  const prisma = fastify.prisma;
  const tenantExists = async (tenantId: string): Promise<boolean> =>
    (await prisma.tenant.count({ where: { id: tenantId } })) > 0;

  // --- Overview: summary + all partners ---
  fastify.get('/', async (request, reply) => {
    const q = request.query as { from?: string; to?: string };
    try {
      return reply.send(await buildReferralAdminOverview(prisma, q));
    } catch (err) {
      return reply
        .code(statusOf(err))
        .send({ error: err instanceof Error ? err.message : 'Не удалось собрать отчёт' });
    }
  });

  // --- Single partner: codes, campaigns, referrals, balance history ---
  fastify.get('/partners/:tenantId', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    try {
      return reply.send(await buildReferralPartnerDetail(prisma, tenantId));
    } catch (err) {
      return reply
        .code(statusOf(err))
        .send({ error: err instanceof Error ? err.message : 'Не удалось загрузить партнёра' });
    }
  });

  // --- Global reward rule (single row: tenantId = null, isDefault) ---
  fastify.put('/rule', async (request, reply) => {
    const body = z
      .object({
        type: ruleTypeSchema,
        value: z.number().min(0).max(10_000_000),
        durationMonths: durationSchema,
        productScope: productScopeSchema,
        isActive: z.boolean(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Проверьте тип, значение и статус правила' });
    }
    const data = body.data;

    const rule = await prisma.$transaction(async (tx) => {
      const [primary, ...duplicates] = await tx.referralRule.findMany({
        where: { tenantId: null, isDefault: true },
        orderBy: { createdAt: 'asc' },
      });
      // Legacy POST /rules could create several defaults; keep exactly one
      if (duplicates.length) {
        await tx.referralRule.updateMany({
          where: { id: { in: duplicates.map((r) => r.id) } },
          data: { isDefault: false },
        });
      }
      const payload = {
        type: data.type,
        value: data.value,
        durationMonths: data.durationMonths ?? null,
        productScope: data.productScope ?? REFERRAL_PRODUCT_SCOPES.ALL,
        isActive: data.isActive,
      };
      return primary
        ? tx.referralRule.update({ where: { id: primary.id }, data: payload })
        : tx.referralRule.create({ data: { ...payload, tenantId: null, isDefault: true } });
    });

    return reply.send({
      defaultRule: {
        id: rule.id,
        type: rule.type,
        value: Number(rule.value),
        durationMonths: rule.durationMonths,
        productScope: rule.productScope,
        isActive: rule.isActive,
      },
    });
  });

  // --- Personal partner rate (overrides the global rule) ---
  fastify.put('/partners/:tenantId/rule', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = z
      .union([
        z.object({ reset: z.literal(true) }),
        z.object({
          type: ruleTypeSchema,
          value: z.number().min(0).max(10_000_000),
          durationMonths: durationSchema,
          productScope: productScopeSchema,
        }),
      ])
      .safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Укажите тип и значение ставки либо { reset: true }' });
    }
    if (!(await tenantExists(tenantId))) {
      return reply.code(404).send({ error: 'Партнёр не найден' });
    }

    if ('reset' in body.data) {
      await prisma.referralRule.deleteMany({ where: { tenantId } });
    } else {
      const { type, value, durationMonths, productScope } = body.data;
      await prisma.$transaction([
        prisma.referralRule.deleteMany({ where: { tenantId } }),
        prisma.referralRule.create({
          data: {
            tenantId,
            type,
            value,
            durationMonths: durationMonths ?? null,
            productScope: productScope ?? REFERRAL_PRODUCT_SCOPES.ALL,
            isDefault: false,
            isActive: true,
          },
        }),
      ]);
    }

    return reply.send({ rule: await resolveEffectiveRuleShape(prisma, tenantId) });
  });

  // --- Per-partner per-SKU commission % (overrides rule.value for that product) ---
  const serviceRateBody = z.object({
    productCode: z.enum(REFERRAL_COMMISSION_SKUS),
    percent: z.number().min(0).max(100),
  });

  fastify.put('/partners/:tenantId/service-rates', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = serviceRateBody.safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Укажите сервис из каталога и процент от 0 до 100' });
    }
    if (!(await tenantExists(tenantId))) {
      return reply.code(404).send({ error: 'Партнёр не найден' });
    }

    const rate = await upsertPartnerServiceRate(
      prisma,
      tenantId,
      body.data.productCode,
      body.data.percent,
    );
    return reply.send({
      rate,
      serviceRates: await listPartnerServiceRates(prisma, tenantId),
    });
  });

  fastify.delete('/partners/:tenantId/service-rates/:productCode', async (request, reply) => {
    const { tenantId, productCode } = request.params as {
      tenantId: string;
      productCode: string;
    };
    if (!(await tenantExists(tenantId))) {
      return reply.code(404).send({ error: 'Партнёр не найден' });
    }
    if (!isReferralCommissionSku(productCode)) {
      return reply.code(400).send({ error: 'Неизвестный сервис' });
    }

    const removed = await deletePartnerServiceRate(prisma, tenantId, productCode);
    if (!removed) return reply.code(404).send({ error: 'Ставка для сервиса не найдена' });

    return reply.send({
      removed: true,
      productCode,
      serviceRates: await listPartnerServiceRates(prisma, tenantId),
    });
  });

  // --- Balance movement: payout or manual correction ---
  fastify.post('/partners/:tenantId/transactions', async (request, reply) => {
    const { tenantId } = request.params as { tenantId: string };
    const body = z
      .object({
        kind: z.enum(['payout', 'manual_credit', 'manual_debit']),
        amountRub: amountSchema,
        note: z.string().trim().max(500).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply
        .code(400)
        .send({ error: 'Укажите тип операции и сумму больше 0 (не более 10 000 000 ₽)' });
    }
    if (!(await tenantExists(tenantId))) {
      return reply.code(404).send({ error: 'Партнёр не найден' });
    }

    const { kind, amountRub, note } = body.data;
    const adminUserId = ((request as any).user?.sub as string | undefined) ?? null;

    try {
      const result = await prisma.$transaction(async (tx) => {
        if (kind === 'manual_credit') {
          await tx.tenantBalance.upsert({
            where: { tenantId },
            create: { tenantId, balanceRub: amountRub },
            update: { balanceRub: { increment: amountRub } },
          });
        } else {
          // Conditional update keeps the balance from going negative under concurrency
          const debited = await tx.tenantBalance.updateMany({
            where: { tenantId, balanceRub: { gte: amountRub } },
            data: { balanceRub: { decrement: amountRub } },
          });
          if (debited.count === 0) {
            throw Object.assign(
              new Error('Сумма больше текущего баланса партнёра — операция отменена'),
              { statusCode: 400 },
            );
          }
        }

        const transaction = await tx.referralTransaction.create({
          data: { tenantId, kind, amountRub, note: note || null, adminUserId },
        });
        const balance = await tx.tenantBalance.findUnique({ where: { tenantId } });

        return { transaction, balanceRub: Number(balance?.balanceRub ?? 0) };
      });

      return reply.code(201).send({
        transaction: {
          id: result.transaction.id,
          kind: result.transaction.kind,
          amountRub: Number(result.transaction.amountRub),
          note: result.transaction.note,
          createdAt: result.transaction.createdAt.toISOString(),
        },
        balanceRub: result.balanceRub,
      });
    } catch (err) {
      const status = statusOf(err);
      if (status === 500) {
        request.log.error({ err, tenantId }, 'referral transaction failed');
      }
      return reply.code(status).send({
        error: err instanceof Error && status !== 500 ? err.message : 'Не удалось провести операцию',
      });
    }
  });

  // --- Withdrawal requests queue ---
  fastify.get('/withdrawals', async (request, reply) => {
    const parsed = withdrawalStatusSchema
      .optional()
      .safeParse((request.query as { status?: string }).status || undefined);
    if (!parsed.success) return reply.code(400).send({ error: 'Неизвестный статус заявки' });
    const status = parsed.data;

    const [rows, pendingAgg] = await Promise.all([
      prisma.referralWithdrawal.findMany({
        where: status ? { status } : {},
        // Очередь на рассмотрении — по возрастанию: первым обрабатываем самое старое
        orderBy: { createdAt: status === 'pending' ? 'asc' : 'desc' },
      }),
      prisma.referralWithdrawal.aggregate({
        where: { status: 'pending' },
        _count: { _all: true },
        _sum: { amountRub: true },
      }),
    ]);

    const tenantIds = [...new Set(rows.map((w) => w.tenantId))];
    const [tenants, balances] = await Promise.all([
      prisma.tenant.findMany({
        where: { id: { in: tenantIds } },
        select: {
          id: true,
          slug: true,
          users: {
            where: { role: 'owner' },
            take: 1,
            select: { user: { select: { email: true } } },
          },
        },
      }),
      prisma.tenantBalance.findMany({
        where: { tenantId: { in: tenantIds } },
        select: { tenantId: true, balanceRub: true },
      }),
    ]);
    const tenantById = new Map(tenants.map((t) => [t.id, t]));
    const balanceByTenant = new Map(balances.map((b) => [b.tenantId, Number(b.balanceRub)]));

    return reply.send({
      withdrawals: rows.map((w) => ({
        ...withdrawalShape(w),
        tenantId: w.tenantId,
        slug: tenantById.get(w.tenantId)?.slug ?? null,
        ownerEmail: tenantById.get(w.tenantId)?.users[0]?.user.email ?? null,
        balanceRub: balanceByTenant.get(w.tenantId) ?? 0,
      })),
      summary: {
        pendingCount: pendingAgg._count._all,
        pendingRub: Number(pendingAgg._sum.amountRub ?? 0),
      },
    });
  });

  // --- Approve (paid) or reject a withdrawal request ---
  fastify.patch('/withdrawals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        action: z.enum(['paid', 'rejected']),
        note: z.string().trim().max(500).optional(),
      })
      .safeParse(request.body);
    if (!body.success) {
      return reply.code(400).send({ error: 'Укажите действие: paid или rejected' });
    }
    const { action, note } = body.data;
    if (action === 'rejected' && !note) {
      return reply.code(400).send({ error: 'Укажите причину отказа' });
    }
    const adminUserId = ((request as any).user?.sub as string | undefined) ?? null;

    try {
      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.referralWithdrawal.findUnique({ where: { id } });
        if (!existing) {
          throw Object.assign(new Error('Заявка не найдена'), { statusCode: 404 });
        }

        const decided = await tx.referralWithdrawal.updateMany({
          where: { id, status: 'pending' },
          data: {
            status: action,
            decisionNote: note || null,
            decidedAt: new Date(),
            decidedByUserId: adminUserId,
          },
        });
        if (decided.count === 0) {
          throw Object.assign(new Error('Заявка уже обработана'), { statusCode: 409 });
        }

        if (action === 'paid') {
          // Баланс не трогаем: деньги ушли с него в момент создания заявки
          await tx.referralTransaction.create({
            data: {
              tenantId: existing.tenantId,
              kind: 'payout',
              amountRub: existing.amountRub,
              note: note || 'Выплата по заявке',
              adminUserId,
            },
          });
        } else {
          await tx.tenantBalance.upsert({
            where: { tenantId: existing.tenantId },
            create: { tenantId: existing.tenantId, balanceRub: existing.amountRub },
            update: { balanceRub: { increment: existing.amountRub } },
          });
        }

        const withdrawal = await tx.referralWithdrawal.findUniqueOrThrow({ where: { id } });
        const balance = await tx.tenantBalance.findUnique({
          where: { tenantId: existing.tenantId },
        });

        return { withdrawal, balanceRub: Number(balance?.balanceRub ?? 0) };
      });

      return reply.send({
        withdrawal: withdrawalShape(result.withdrawal),
        balanceRub: result.balanceRub,
      });
    } catch (err) {
      const status = statusOf(err);
      if (status === 500) request.log.error({ err, id }, 'withdrawal decision failed');
      return reply.code(status).send({
        error:
          err instanceof Error && status !== 500 ? err.message : 'Не удалось обработать заявку',
      });
    }
  });

  // --- Toggle main referral code ---
  fastify.patch('/codes/:id', async (request, reply) => {
    const parsed = activeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажите isActive' });
    const { id } = request.params as { id: string };

    const updated = await prisma.referralCode.updateMany({
      where: { id },
      data: { isActive: parsed.data.isActive },
    });
    if (!updated.count) return reply.code(404).send({ error: 'Код не найден' });

    return reply.send({ id, isActive: parsed.data.isActive });
  });

  // --- Toggle project campaign link ---
  fastify.patch('/campaigns/:id', async (request, reply) => {
    const parsed = activeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажите isActive' });
    const { id } = request.params as { id: string };

    const updated = await prisma.referralCampaign.updateMany({
      where: { id },
      data: { isActive: parsed.data.isActive },
    });
    if (!updated.count) return reply.code(404).send({ error: 'Проект не найден' });

    return reply.send({ id, isActive: parsed.data.isActive });
  });

  // --- Block partner: main code + every campaign at once ---
  fastify.patch('/partners/:tenantId/block', async (request, reply) => {
    const parsed = z.object({ blocked: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажите blocked' });
    const { tenantId } = request.params as { tenantId: string };
    if (!(await tenantExists(tenantId))) {
      return reply.code(404).send({ error: 'Партнёр не найден' });
    }

    const isActive = !parsed.data.blocked;
    await prisma.$transaction([
      prisma.referralCode.updateMany({ where: { tenantId }, data: { isActive } }),
      prisma.referralCampaign.updateMany({ where: { tenantId }, data: { isActive } }),
    ]);

    return reply.send({ blocked: parsed.data.blocked });
  });

  // --- Re-attach referral to another project / change status ---
  fastify.patch('/referrals/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = z
      .object({
        campaignId: z.string().min(1).nullable().optional(),
        status: z.enum(['attributed', 'earned', 'cancelled']).optional(),
      })
      .safeParse(request.body);
    if (!body.success || (body.data.campaignId === undefined && !body.data.status)) {
      return reply.code(400).send({ error: 'Укажите campaignId и/или status' });
    }
    const { campaignId, status } = body.data;

    const referral = await prisma.referral.findUnique({
      where: { id },
      select: { id: true, referrerTenantId: true, earnings: { select: { id: true } } },
    });
    if (!referral) return reply.code(404).send({ error: 'Привязка не найдена' });

    if (campaignId) {
      const campaign = await prisma.referralCampaign.findFirst({
        where: { id: campaignId, tenantId: referral.referrerTenantId },
        select: { id: true },
      });
      if (!campaign) {
        return reply
          .code(400)
          .send({ error: 'Проект принадлежит другому партнёру — привязка невозможна' });
      }
    }

    const updated = await prisma.referral.update({
      where: { id },
      data: {
        ...(campaignId !== undefined ? { campaignId } : {}),
        ...(status ? { status } : {}),
      },
      include: { campaign: { select: { name: true } } },
    });

    // Cancelling never rolls back ReferralEarning / TenantBalance — see manual_debit
    const earningsKept = status === 'cancelled' && referral.earnings.length > 0;

    return reply.send({
      id: updated.id,
      campaignId: updated.campaignId,
      campaignName: updated.campaign?.name ?? MAIN_LINK_LABEL,
      status: updated.status,
      earningsKept,
      notice: earningsKept ? CANCEL_NOTICE : null,
    });
  });
};
