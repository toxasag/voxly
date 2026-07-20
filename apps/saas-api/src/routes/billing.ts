// Billing routes: Robokassa checkout, result webhook, success redirect

import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { PRICING, PERIOD_DISCOUNTS } from '@voxly/shared';
import { calculateSubscriptionPrice } from '@voxly/billing';

const checkoutSchema = z.object({
  productCode: z.enum(['crm_base', 'extra_seat', 'gift_bot', 'ai_tg', 'ai_wa',
    'analytics_metrika', 'analytics_ga4', 'analytics_facebook', 'analytics_vk']),
  periodMonths: z.number().int().min(1).max(24),
  extraSeats: z.number().int().min(0).optional(),
  email: z.string().email().optional(),
});

export const billingRoutes: FastifyPluginAsync = async (fastify) => {
  // --- Create checkout URL ---
  fastify.post('/checkout', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const { productCode, periodMonths, extraSeats = 0, email } = parsed.data;
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;
    const robokassa = fastify.robokassa;

    // Get pricing (check overrides)
    const basePrice = getBasePrice(productCode);
    const discount = PERIOD_DISCOUNTS[periodMonths] ?? 0;
    let totalAmount = calculateSubscriptionPrice(basePrice, periodMonths, discount);

    // Add extra seats if CRM base
    if (productCode === 'crm_base' && extraSeats > 0) {
      totalAmount += calculateSubscriptionPrice(
        PRICING.EXTRA_SEAT_MONTHLY * extraSeats,
        periodMonths,
        discount,
      );
    }

    // Create payment record
    const invId = await getNextInvId(prisma);
    const idempotencyKey = `${tenantId}-${productCode}-${periodMonths}-${Date.now()}`;

    const payment = await prisma.payment.create({
      data: {
        tenantId,
        robokassaInvId: invId,
        amount: totalAmount,
        status: 'pending',
        productCode,
        periodMonths,
        description: buildDescription(productCode, periodMonths),
        idempotencyKey,
        shpTenantId: tenantId,
      },
    });

    // Generate Robokassa URL
    const paymentUrl = robokassa.generatePaymentUrl({
      invId,
      amount: totalAmount,
      description: buildDescription(productCode, periodMonths),
      email,
      items: [
        {
          name: buildDescription(productCode, periodMonths),
          quantity: 1,
          price: totalAmount,
          tax: 'none',
          paymentMethod: 'full',
          paymentObject: 'service',
        },
      ],
      customData: {
        tenant_id: tenantId,
        payment_id: payment.id,
      },
    });

    return reply.send({ paymentUrl, invId, amount: totalAmount });
  });

  // --- Robokassa Result URL webhook (server-to-server) ---
  // Robokassa calls this after payment is processed
  fastify.post('/result', async (request, reply) => {
    const body = request.body as Record<string, string>;
    const outSum = body['OutSum'];
    const invId = body['InvId'];
    const signatureValue = body['SignatureValue'] || '';

    // Extract shp_* params
    const customData: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (key.startsWith('shp_')) {
        customData[key.slice(4)] = value;
      }
    }

    const robokassa = fastify.robokassa;
    const isValid = robokassa.verifyResultSignature({
      outSum,
      invId,
      signatureValue,
      customData,
    });

    if (!isValid) {
      fastify.log.warn({ invId }, 'Invalid Robokassa signature');
      return reply.code(400).send('bad signature');
    }

    const prisma = fastify.prisma;
    const invIdNum = parseInt(invId, 10);

    // Idempotency: check if already processed
    const existing = await prisma.payment.findUnique({
      where: { robokassaInvId: invIdNum },
    });

    if (!existing) {
      fastify.log.error({ invId }, 'Payment not found');
      return reply.code(404).send('payment not found');
    }

    if (existing.status === 'paid') {
      // Already processed — just respond OK
      return reply.type('text/plain').send(`OK${invId}`);
    }

    // Mark as paid and activate subscription
    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status: 'paid',
          paidAt: new Date(),
        },
      });

      // Activate or extend subscription
      const periodMonths = existing.periodMonths || 1;
      const now = new Date();
      const startsAt = now;
      const endsAt = new Date(now);
      endsAt.setMonth(endsAt.getMonth() + periodMonths);

      if (existing.productCode === 'crm_base') {
        await tx.subscription.updateMany({
          where: {
            tenantId: existing.tenantId,
            status: 'active',
            periodMonths: 0,
          },
          data: { status: 'expired' },
        });
      }

      await tx.subscription.create({
        data: {
          tenantId: existing.tenantId,
          productCode: existing.productCode,
          periodMonths,
          seatsIncluded: existing.productCode === 'crm_base' ? PRICING.SEATS_INCLUDED : 0,
          startsAt,
          endsAt,
          status: 'active',
          payments: { connect: { id: existing.id } },
        },
      });

      // If CRM base — update tenant status to active
      if (existing.productCode === 'crm_base') {
        await tx.tenant.update({
          where: { id: existing.tenantId },
          data: { status: 'active' },
        });
      }

      // If add-on — create addon record
      if (existing.productCode.startsWith('analytics_') ||
          existing.productCode === 'gift_bot' ||
          existing.productCode.startsWith('ai_')) {
        await tx.addon.create({
          data: {
            tenantId: existing.tenantId,
            type: existing.productCode,
            config: {},
            activeUntil: endsAt,
            status: 'active',
          },
        });
      }

      // Process referral earnings
      const referral = await tx.referral.findUnique({
        where: { referredTenantId: existing.tenantId },
      });
      if (referral && !referral.firstPaymentAt) {
        await tx.referral.update({
          where: { id: referral.id },
          data: { firstPaymentAt: now, status: 'earned' },
        });
        // Calculate and credit referral earning
        const defaultRule = await tx.referralRule.findFirst({
          where: { isDefault: true, isActive: true },
        });
        if (defaultRule) {
          let earningAmount = 0;
          if (defaultRule.type === 'percent_first_payment') {
            earningAmount = Number(existing.amount) * Number(defaultRule.value) / 100;
          } else if (defaultRule.type === 'fixed_first_payment') {
            earningAmount = Number(defaultRule.value);
          }
          if (earningAmount > 0) {
            await tx.referralEarning.create({
              data: {
                referralId: referral.id,
                paymentId: existing.id,
                tenantId: referral.referrerTenantId,
                amountRub: earningAmount,
                ruleApplied: defaultRule.type,
              },
            });
            await tx.tenantBalance.upsert({
              where: { tenantId: referral.referrerTenantId },
              create: { tenantId: referral.referrerTenantId, balanceRub: earningAmount },
              update: { balanceRub: { increment: earningAmount } },
            });
          }
        }
      }
    });

    fastify.log.info({ invId, tenantId: existing.tenantId }, 'Payment processed successfully');

    // Enqueue provisioning job (handled by BullMQ)
    // provisioningQueue.add('provision', { paymentId: existing.id, tenantId: existing.tenantId });

    return reply.type('text/plain').send(`OK${invId}`);
  });

  // --- Success URL (browser redirect after payment) ---
  fastify.get('/success', async (request, reply) => {
    const query = request.query as Record<string, string>;
    const invId = query['InvId'];
    const voxlyDomain = fastify.voxlyDomain;

    // Redirect to portal success page
    return reply.redirect(302, `https://app.${voxlyDomain}/billing/success?invId=${invId}`);
  });

  // --- Get current subscription status ---
  fastify.get('/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;

    const subscriptions = await prisma.subscription.findMany({
      where: { tenantId, status: 'active' },
      orderBy: { endsAt: 'desc' },
    });

    const addons = await prisma.addon.findMany({
      where: { tenantId, status: 'active' },
    });

    const aiWallet = await prisma.aiWallet.findUnique({ where: { tenantId } });
    const tenantBalance = await prisma.tenantBalance.findUnique({ where: { tenantId } });

    return reply.send({
      subscriptions: subscriptions.map((s) => ({
        id: s.id,
        productCode: s.productCode,
        periodMonths: s.periodMonths,
        seatsIncluded: s.seatsIncluded,
        extraSeats: s.extraSeats,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: s.status,
      })),
      addons: addons.map((a) => ({
        id: a.id,
        type: a.type,
        activeUntil: a.activeUntil,
        status: a.status,
      })),
      aiWallet: aiWallet ? { balanceRub: aiWallet.balanceRub.toString() } : null,
      tenantBalance: tenantBalance ? { balanceRub: tenantBalance.balanceRub.toString() } : null,
    });
  });
};

function getBasePrice(productCode: string): number {
  const prices: Record<string, number> = {
    crm_base: PRICING.CRM_BASE_MONTHLY,
    extra_seat: PRICING.EXTRA_SEAT_MONTHLY,
    gift_bot: PRICING.GIFT_BOT_MONTHLY,
    ai_tg: PRICING.AI_TELEGRAM_MONTHLY,
    ai_wa: PRICING.AI_WHATSAPP_MONTHLY,
    analytics_metrika: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_ga4: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_facebook: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_vk: PRICING.ANALYTICS_PLATFORM_MONTHLY,
  };
  return prices[productCode] ?? 0;
}

function buildDescription(productCode: string, periodMonths: number): string {
  const names: Record<string, string> = {
    crm_base: 'Voxly CRM',
    extra_seat: 'Voxly CRM — доп. место',
    gift_bot: 'Voxly — бот выдачи подарков',
    ai_tg: 'Voxly — AI агент Telegram',
    ai_wa: 'Voxly — AI агент WhatsApp',
    analytics_metrika: 'Voxly — аналитика Яндекс Метрика',
    analytics_ga4: 'Voxly — аналитика GA4',
    analytics_facebook: 'Voxly — аналитика Facebook',
    analytics_vk: 'Voxly — аналитика ВКонтакте',
  };
  const name = names[productCode] || productCode;
  const period = periodMonths === 1 ? '1 мес' : `${periodMonths} мес`;
  return `${name} — ${period}`;
}

async function getNextInvId(prisma: any): Promise<number> {
  const lastPayment = await prisma.payment.findFirst({
    orderBy: { robokassaInvId: 'desc' },
    select: { robokassaInvId: true },
  });
  return (lastPayment?.robokassaInvId || 1000) + 1;
}
