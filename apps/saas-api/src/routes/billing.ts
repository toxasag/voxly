// Billing routes: Robokassa checkout, result webhook, success redirect

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  PRICING,
  PERIOD_DISCOUNTS,
  PRODUCT_CODES,
  REFERRAL_EXCLUDED_PRODUCTS,
  getAiTgExtraSlots,
} from '@voxly/shared';
import { calculateSubscriptionPrice } from '@voxly/billing';
import { syncTwentyCrmLock } from '../services/crm-access.js';
import { resolveRuleForReferrer } from '../services/referral-admin.js';

const checkoutSchema = z.object({
  productCode: z.enum([
    'crm_base',
    'extra_seat',
    'gift_bot',
    'ai_tg',
    'ai_tg_extra_conn',
    'ai_gramjs',
    'ai_wa',
    'mailing_bot',
    'mailing_accounts',
    'mailing_stories',
    'ai_topup',
    'analytics_metrika',
    'analytics_ga4',
    'analytics_facebook',
    'analytics_vk',
  ]),
  periodMonths: z.number().int().min(1).max(24).optional(),
  /** For ai_topup — amount in RUB (min AI_TOPUP_MIN_RUB) */
  amountRub: z.number().positive().optional(),
  /** How many extra Business slots to buy (default 1) */
  quantity: z.number().int().min(1).max(50).optional(),
  extraSeats: z.number().int().min(0).optional(),
  email: z.string().email().optional(),
});

export const billingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post('/checkout', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const parsed = checkoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.flatten() });
    }

    const {
      productCode,
      periodMonths: periodRaw,
      amountRub,
      quantity = 1,
      extraSeats = 0,
      email,
    } = parsed.data;
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;
    const robokassa = fastify.robokassa;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { slug: true, crmSubdomain: true },
    });
    const crmHost = tenant
      ? `${tenant.crmSubdomain || `${tenant.slug}-crm`}.${process.env.VOXLY_DOMAIN?.trim() || 'getvoxly.ru'}`
      : 'crm';

    const { loadCrmPlatformPricing } = await import('../services/crm-pricing-settings.js');
    const { loadTenantCrmPricing } = await import('../services/crm-tenant-pricing.js');
    const crmPlatformPricing = await loadCrmPlatformPricing(prisma);
    const crmPricing = await loadTenantCrmPricing(prisma, tenantId, crmPlatformPricing);

    const isTopup = productCode === PRODUCT_CODES.AI_TOPUP;
    const periodMonths = isTopup ? 0 : periodRaw ?? 1;
    if (!isTopup && (!periodRaw || periodRaw < 1)) {
      return reply.code(400).send({ error: 'periodMonths required' });
    }

    let totalAmount = 0;
    let description = '';
    let receiptItems: Array<{
      name: string;
      quantity: number;
      price: number;
      tax: 'none';
      paymentMethod: 'full_payment';
      paymentObject: 'service';
    }> = [];

    if (isTopup) {
      const amount = Number(amountRub);
      if (!Number.isFinite(amount) || amount < PRICING.AI_TOPUP_MIN_RUB) {
        return reply.code(400).send({
          error: `Минимальное пополнение AI: ${PRICING.AI_TOPUP_MIN_RUB} ₽`,
        });
      }
      totalAmount = Math.round(amount * 100) / 100;
      description = `Voxly AI · ${crmHost} · ${totalAmount} ₽`;
      receiptItems = [
        {
          name: `Пополнение AI · ${crmHost}`,
          quantity: 1,
          price: totalAmount,
          tax: 'none',
          paymentMethod: 'full_payment',
          paymentObject: 'service',
        },
      ];
    } else {
      const basePrice = getBasePrice(productCode, crmPricing);
      const discount = PERIOD_DISCOUNTS[periodMonths] ?? 0;
      const seatCount =
        productCode === PRODUCT_CODES.EXTRA_SEAT ? Math.max(1, quantity) : 0;
      const unit =
        productCode === PRODUCT_CODES.AI_TG_EXTRA_CONN
          ? basePrice * quantity
          : productCode === PRODUCT_CODES.EXTRA_SEAT
            ? basePrice * seatCount
            : basePrice;
      totalAmount = calculateSubscriptionPrice(unit, periodMonths, discount);
      const periodLabel = periodMonths === 1 ? '1 мес' : `${periodMonths} мес`;

      if (productCode === 'crm_base') {
        const baseTotal = calculateSubscriptionPrice(
          crmPricing.baseMonthly,
          periodMonths,
          discount,
        );
        receiptItems.push({
          name: `CRM Base · ${crmHost} · ${periodLabel}`,
          quantity: 1,
          price: baseTotal,
          tax: 'none',
          paymentMethod: 'full_payment',
          paymentObject: 'service',
        });
        if (extraSeats > 0) {
          const seatUnit = calculateSubscriptionPrice(
            crmPricing.extraSeatMonthly,
            periodMonths,
            discount,
          );
          totalAmount += seatUnit * extraSeats;
          receiptItems.push({
            name: `Доп. место CRM · ${crmHost} · ${periodLabel}`,
            quantity: extraSeats,
            price: seatUnit,
            tax: 'none',
            paymentMethod: 'full_payment',
            paymentObject: 'service',
          });
          description = `Voxly CRM · ${crmHost} · ${periodLabel} + ${extraSeats} мест`;
        } else {
          description = `Voxly CRM · ${crmHost} · ${periodLabel}`;
        }
      } else if (productCode === PRODUCT_CODES.EXTRA_SEAT) {
        const seatUnit = calculateSubscriptionPrice(
          crmPricing.extraSeatMonthly,
          periodMonths,
          discount,
        );
        receiptItems.push({
          name: `Доп. место CRM · ${crmHost} · ${periodLabel}`,
          quantity: seatCount,
          price: seatUnit,
          tax: 'none',
          paymentMethod: 'full_payment',
          paymentObject: 'service',
        });
        description = `Voxly CRM · ${crmHost} · доп. ×${seatCount} · ${periodLabel}`;
      } else {
        description = `${buildDescription(productCode, periodMonths, quantity)} · ${crmHost}`;
        receiptItems.push({
          name: description.slice(0, 128),
          quantity: 1,
          price: totalAmount,
          tax: 'none',
          paymentMethod: 'full_payment',
          paymentObject: 'service',
        });
      }
    }

    const invId = await getNextInvId(prisma);
    const idempotencyKey = `${tenantId}-${productCode}-${periodMonths}-${Date.now()}`;

    const payment = await prisma.payment.create({
      data: {
        tenantId,
        robokassaInvId: invId,
        amount: totalAmount,
        status: 'pending',
        productCode,
        periodMonths: periodMonths || 1,
        description,
        idempotencyKey,
        shpTenantId: tenantId,
      },
    });

    const paymentUrl = robokassa.generatePaymentUrl({
      invId,
      amount: totalAmount,
      description,
      email,
      items: receiptItems,
      customData: {
        tenant_id: tenantId,
        payment_id: payment.id,
        quantity: String(quantity),
        extra_seats: String(
          productCode === 'crm_base'
            ? Math.max(0, extraSeats)
            : productCode === PRODUCT_CODES.EXTRA_SEAT
              ? Math.max(1, quantity)
              : 0,
        ),
      },
    });

    return reply.send({ paymentUrl, invId, amount: totalAmount });
  });

  const handleResult = async (request: any, reply: any) => {
    const raw =
      request.method === 'GET'
        ? ((request.query as Record<string, string>) || {})
        : ((request.body as Record<string, string>) || {});
    const outSum = raw['OutSum'];
    const invId = raw['InvId'];
    const signatureValue = raw['SignatureValue'] || '';

    if (!outSum || !invId) {
      return reply.code(400).send('missing OutSum or InvId');
    }

    const customData: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      // Accept Shp_* / shp_* from Robokassa; signature uses Shp_ (docs).
      const m = /^shp_(.+)$/i.exec(key);
      if (m && value != null) {
        customData[m[1]] = String(value);
      }
    }

    const robokassa = fastify.robokassa;
    const isValid = robokassa.verifyResultSignature({
      outSum: String(outSum),
      invId: String(invId),
      signatureValue: String(signatureValue),
      customData,
    });

    if (!isValid) {
      fastify.log.warn({ invId }, 'Invalid Robokassa signature');
      return reply.code(400).send('bad signature');
    }

    const prisma = fastify.prisma;
    const invIdNum = parseInt(String(invId), 10);

    const existing = await prisma.payment.findUnique({
      where: { robokassaInvId: invIdNum },
    });

    if (!existing) {
      fastify.log.error({ invId }, 'Payment not found');
      return reply.code(404).send('payment not found');
    }

    if (existing.status === 'paid') {
      return reply.type('text/plain').send(`OK${invId}`);
    }

    const quantity = Math.max(1, parseInt(customData.quantity || '1', 10) || 1);

    const { loadCrmPlatformPricing } = await import('../services/crm-pricing-settings.js');
    const { loadTenantCrmPricing } = await import('../services/crm-tenant-pricing.js');
    const crmPlatformPricing = await loadCrmPlatformPricing(prisma);
    const tenantCrmPricing = await loadTenantCrmPricing(
      prisma,
      existing.tenantId,
      crmPlatformPricing,
    );

    await prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: existing.id },
        data: { status: 'paid', paidAt: new Date() },
      });

      const periodMonths = existing.periodMonths || 1;
      const now = new Date();
      let endsAt = new Date(now);
      endsAt.setMonth(endsAt.getMonth() + Math.max(1, periodMonths));

      // CRM renewals: extend from current paid/trial end if still in the future
      // (so paying during trial yields trialEnd + period, not now + period).
      if (
        existing.productCode === 'crm_base' ||
        existing.productCode === PRODUCT_CODES.EXTRA_SEAT
      ) {
        const priorCrm = await tx.subscription.findFirst({
          where: {
            tenantId: existing.tenantId,
            productCode: PRODUCT_CODES.CRM_BASE,
            OR: [{ status: 'active' }, { status: 'expired', periodMonths: 0 }],
          },
          orderBy: { endsAt: 'desc' },
        });
        if (priorCrm && priorCrm.endsAt > now) {
          endsAt = new Date(priorCrm.endsAt);
          endsAt.setMonth(endsAt.getMonth() + Math.max(1, periodMonths));
        }
      }

      if (existing.productCode === PRODUCT_CODES.AI_TOPUP) {
        await tx.aiWallet.upsert({
          where: { tenantId: existing.tenantId },
          create: { tenantId: existing.tenantId, balanceRub: Number(existing.amount) },
          update: { balanceRub: { increment: Number(existing.amount) } },
        });
      } else if (existing.productCode === PRODUCT_CODES.AI_TG_EXTRA_CONN) {
        const addon = await tx.addon.findUnique({
          where: {
            tenantId_type: { tenantId: existing.tenantId, type: PRODUCT_CODES.AI_TELEGRAM },
          },
        });
        const prev = getAiTgExtraSlots(addon?.config);
        const nextSlots = prev + quantity;
        const config = {
          ...((addon?.config as object) || {}),
          extraSlots: nextSlots,
          trial: false,
          maxBusinessConnections: PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS,
        };
        if (addon) {
          await tx.addon.update({
            where: { id: addon.id },
            data: {
              config,
              status: 'active',
              activeUntil:
                addon.activeUntil > endsAt ? addon.activeUntil : endsAt,
            },
          });
        } else {
          await tx.addon.create({
            data: {
              tenantId: existing.tenantId,
              type: PRODUCT_CODES.AI_TELEGRAM,
              config,
              activeUntil: endsAt,
              status: 'active',
            },
          });
        }
        await tx.subscription.create({
          data: {
            tenantId: existing.tenantId,
            productCode: existing.productCode,
            periodMonths,
            seatsIncluded: 0,
            startsAt: now,
            endsAt,
            status: 'active',
            payments: { connect: { id: existing.id } },
          },
        });
      } else if (existing.productCode === PRODUCT_CODES.EXTRA_SEAT) {
        const addSeats = Math.max(
          1,
          parseInt(customData.extra_seats || customData.quantity || '1', 10) || 1,
        );
        const activeCrm = await tx.subscription.findFirst({
          where: {
            tenantId: existing.tenantId,
            productCode: PRODUCT_CODES.CRM_BASE,
            status: 'active',
            endsAt: { gt: now },
          },
          orderBy: { endsAt: 'desc' },
        });
        if (activeCrm) {
          await tx.subscription.update({
            where: { id: activeCrm.id },
            data: { extraSeats: { increment: addSeats } },
          });
        }
        await tx.subscription.create({
          data: {
            tenantId: existing.tenantId,
            productCode: existing.productCode,
            periodMonths,
            seatsIncluded: 0,
            extraSeats: addSeats,
            startsAt: now,
            endsAt,
            status: 'active',
            payments: { connect: { id: existing.id } },
          },
        });
      } else {
        if (existing.productCode === 'crm_base') {
          await tx.subscription.updateMany({
            where: {
              tenantId: existing.tenantId,
              status: 'active',
              periodMonths: 0,
            },
            data: { status: 'expired' },
          });
          await tx.tenant.update({
            where: { id: existing.tenantId },
            data: { status: 'active' },
          });
        }

        const extraSeatsPaid =
          existing.productCode === 'crm_base'
            ? Math.max(0, parseInt(customData.extra_seats || '0', 10) || 0)
            : 0;

        await tx.subscription.create({
          data: {
            tenantId: existing.tenantId,
            productCode: existing.productCode,
            periodMonths,
            seatsIncluded:
              existing.productCode === 'crm_base' ? tenantCrmPricing.seatsIncluded : 0,
            extraSeats: extraSeatsPaid,
            startsAt: now,
            endsAt,
            status: 'active',
            payments: { connect: { id: existing.id } },
          },
        });

        if (
          existing.productCode.startsWith('analytics_') ||
          existing.productCode === 'gift_bot' ||
          existing.productCode === PRODUCT_CODES.AI_TELEGRAM ||
          existing.productCode === PRODUCT_CODES.AI_GRAMJS ||
          existing.productCode === PRODUCT_CODES.AI_WHATSAPP ||
          existing.productCode === PRODUCT_CODES.MAILING_BOT ||
          existing.productCode === PRODUCT_CODES.MAILING_ACCOUNTS ||
          existing.productCode === PRODUCT_CODES.MAILING_STORIES
        ) {
          const existingAddon = await tx.addon.findUnique({
            where: {
              tenantId_type: { tenantId: existing.tenantId, type: existing.productCode },
            },
          });
          const prevConfig = (existingAddon?.config as Record<string, unknown>) || {};
          await tx.addon.upsert({
            where: {
              tenantId_type: { tenantId: existing.tenantId, type: existing.productCode },
            },
            create: {
              tenantId: existing.tenantId,
              type: existing.productCode,
              config: {
                ...prevConfig,
                trial: false,
                trialConsumed: true,
                maxBusinessConnections: PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS,
              },
              activeUntil: endsAt,
              status: 'active',
            },
            update: {
              status: 'active',
              activeUntil: endsAt,
              config: {
                ...prevConfig,
                trial: false,
                trialConsumed: true,
                maxBusinessConnections: PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS,
              },
            },
          });
        }
      }

      await creditReferralForPayment(tx, existing);
    });

    if (existing.productCode === 'crm_base' || existing.productCode === PRODUCT_CODES.CRM_BASE) {
      const tenant = await prisma.tenant.findUnique({
        where: { id: existing.tenantId },
        select: { twentyWorkspaceId: true },
      });
      await syncTwentyCrmLock(tenant?.twentyWorkspaceId, false);
    }

    fastify.log.info({ invId, tenantId: existing.tenantId }, 'Payment processed successfully');
    return reply.type('text/plain').send(`OK${invId}`);
  };

  // ResultURL: POST preferred; GET accepted (Robokassa cabinet method).
  fastify.post('/result', handleResult);
  fastify.get('/result', handleResult);

  fastify.get('/success', async (_request, reply) => {
    const voxlyDomain = fastify.voxlyDomain;
    return reply.redirect(302, `https://${voxlyDomain}/dashboard/crm?paid=ok`);
  });

  fastify.get('/fail', async (_request, reply) => {
    const voxlyDomain = fastify.voxlyDomain;
    return reply.redirect(302, `https://${voxlyDomain}/dashboard/crm?paid=fail`);
  });

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
        config: a.config,
        extraSlots:
          a.type === PRODUCT_CODES.AI_TELEGRAM ? getAiTgExtraSlots(a.config) : undefined,
      })),
      aiWallet: aiWallet ? { balanceRub: aiWallet.balanceRub.toString() } : null,
      tenantBalance: tenantBalance ? { balanceRub: tenantBalance.balanceRub.toString() } : null,
    });
  });
};

async function creditReferralForPayment(
  tx: any,
  payment: { id: string; tenantId: string; amount: any; productCode: string },
) {
  if (REFERRAL_EXCLUDED_PRODUCTS.has(payment.productCode)) return;

  const referral = await tx.referral.findUnique({
    where: { referredTenantId: payment.tenantId },
  });
  if (!referral) return;

  const rule = await resolveRuleForReferrer(tx, referral.referrerTenantId);
  if (!rule) return;

  const amount = Number(payment.amount);
  let earningAmount = 0;
  const isFirst = !referral.firstPaymentAt;

  if (rule.type === 'percent_recurring') {
    earningAmount = (amount * Number(rule.value)) / 100;
  } else if (rule.type === 'percent_first_payment' && isFirst) {
    earningAmount = (amount * Number(rule.value)) / 100;
  } else if (rule.type === 'fixed_first_payment' && isFirst) {
    earningAmount = Number(rule.value);
  } else if (rule.type === 'credit' && isFirst) {
    earningAmount = Number(rule.value);
  }

  if (earningAmount <= 0) return;

  if (isFirst) {
    await tx.referral.update({
      where: { id: referral.id },
      data: { firstPaymentAt: new Date(), status: 'earned' },
    });
  }

  await tx.referralEarning.create({
    data: {
      referralId: referral.id,
      paymentId: payment.id,
      tenantId: referral.referrerTenantId,
      amountRub: earningAmount,
      ruleApplied: rule.type,
    },
  });
  await tx.tenantBalance.upsert({
    where: { tenantId: referral.referrerTenantId },
    create: { tenantId: referral.referrerTenantId, balanceRub: earningAmount },
    update: { balanceRub: { increment: earningAmount } },
  });
}

function getBasePrice(
  productCode: string,
  crmPricing?: { baseMonthly: number; extraSeatMonthly: number },
): number {
  const prices: Record<string, number> = {
    crm_base: crmPricing?.baseMonthly ?? PRICING.CRM_BASE_MONTHLY,
    extra_seat: crmPricing?.extraSeatMonthly ?? PRICING.EXTRA_SEAT_MONTHLY,
    gift_bot: PRICING.GIFT_BOT_MONTHLY,
    ai_tg: PRICING.AI_TELEGRAM_MONTHLY,
    ai_tg_extra_conn: PRICING.AI_TG_EXTRA_CONN_MONTHLY,
    ai_gramjs: PRICING.AI_GRAMJS_MONTHLY,
    ai_wa: PRICING.AI_WHATSAPP_MONTHLY,
    mailing_bot: PRICING.MAILING_BOT_MONTHLY,
    mailing_accounts: PRICING.MAILING_ACCOUNTS_MONTHLY,
    mailing_stories: PRICING.MAILING_STORIES_MONTHLY,
    analytics_metrika: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_ga4: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_facebook: PRICING.ANALYTICS_PLATFORM_MONTHLY,
    analytics_vk: PRICING.ANALYTICS_PLATFORM_MONTHLY,
  };
  return prices[productCode] ?? 0;
}

function buildDescription(productCode: string, periodMonths: number, quantity = 1): string {
  const names: Record<string, string> = {
    crm_base: 'Voxly CRM',
    extra_seat: 'Voxly CRM — доп. место',
    gift_bot: 'Voxly — бот выдачи подарков',
    ai_tg: 'Voxly — бот-секретарь Telegram Business',
    ai_tg_extra_conn: `Voxly — доп. Business-аккаунт ×${quantity}`,
    ai_gramjs: 'Voxly — личный Telegram',
    ai_wa: 'Voxly — WhatsApp',
    mailing_bot: 'Voxly — рассылка ботом',
    mailing_accounts: 'Voxly — рассылка с аккаунтов',
    mailing_stories: 'Voxly — постинг сторис',
    analytics_metrika: 'Voxly — аналитика Яндекс Метрика',
    analytics_ga4: 'Voxly — аналитика GA4',
    analytics_facebook: 'Voxly — аналитика Facebook',
    analytics_vk: 'Voxly — аналитика ВКонтакте',
  };
  const name =
    productCode === 'extra_seat' && quantity > 1
      ? `Voxly CRM — доп. место ×${quantity}`
      : names[productCode] || productCode;
  const period = periodMonths === 1 ? '1 мес' : `${periodMonths} мес`;
  return `${name} — ${period}`;
}

async function getNextInvId(prisma: any): Promise<number> {
  // Serialize InvId allocation (advisory lock) so parallel checkouts cannot collide.
  return prisma.$transaction(async (tx: any) => {
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(87236401)`);
    const lastPayment = await tx.payment.findFirst({
      orderBy: { robokassaInvId: 'desc' },
      select: { robokassaInvId: true },
    });
    return (lastPayment?.robokassaInvId || 1000) + 1;
  });
}
