// Billing routes: Robokassa checkout, result webhook, success redirect

import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  PRICING,
  PERIOD_DISCOUNTS,
  PRODUCT_CODES,
  REFERRAL_EXCLUDED_PRODUCTS,
  getAiTgExtraSlots,
  getAiAgentSlots,
  isProductInReferralScope,
  isAfterReferralPayoutWindow,
} from '@voxly/shared';
import { calculateSubscriptionPrice, paymentAmountMatchesOutSum } from '@voxly/billing';
import { syncTwentyCrmLock } from '../services/crm-access.js';
import { resolveRuleForReferrer } from '../services/referral-admin.js';
import { releaseBalanceHold } from '../services/referral-program.js';

const checkoutSchema = z.object({
  productCode: z.enum([
    'crm_base',
    'extra_seat',
    'gift_bot',
    'ai_tg',
    'ai_tg_extra_conn',
    'ai_gramjs',
    'ai_wa',
    'ai_agent',
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
  /** How much of the partner balance to redeem against this invoice */
  applyBalanceRub: z.number().nonnegative().optional(),
});

/** Thrown when a conditional balance decrement finds less money than the checkout promised. */
const BALANCE_CONFLICT = 'voxly_balance_conflict';
const BALANCE_CONFLICT_MESSAGE = 'Баланс изменился — обновите страницу и повторите';

function roundRub(value: number): number {
  return Math.round(value * 100) / 100;
}

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
      applyBalanceRub = 0,
    } = parsed.data;
    const { tenantId } = (request as any).user;
    const prisma = fastify.prisma;
    const robokassa = fastify.robokassa;

    // The common abandonment case: the customer opened an invoice, changed their mind and came
    // back. Give the held money back before quoting a new price from the same balance.
    await releaseBalanceHolds(prisma, tenantId);

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
        productCode === PRODUCT_CODES.AI_TG_EXTRA_CONN ||
        productCode === PRODUCT_CODES.AI_AGENT
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

    const grossAmount = roundRub(totalAmount);
    let appliedBalanceRub = 0;
    if (applyBalanceRub > 0) {
      const balance = await prisma.tenantBalance.findUnique({ where: { tenantId } });
      const freeBalance = Number(balance?.balanceRub ?? 0);
      appliedBalanceRub = roundRub(Math.max(0, Math.min(applyBalanceRub, freeBalance, grossAmount)));
    }
    const netAmount = roundRub(grossAmount - appliedBalanceRub);
    // A gross of 0 without redemption is not a balance purchase — leave that path untouched.
    const fullyCovered = netAmount === 0 && appliedBalanceRub > 0;

    if (appliedBalanceRub > 0) {
      description = fullyCovered
        ? `${description} · оплачено партнёрским балансом`.slice(0, 250)
        : `${description} · частично с партнёрского баланса`.slice(0, 250);
      // The receipt must add up to OutSum, which is now the money part only.
      receiptItems = [
        {
          name: description.slice(0, 128),
          quantity: 1,
          price: netAmount,
          tax: 'none',
          paymentMethod: 'full_payment',
          paymentObject: 'service',
        },
      ];
    }

    // InvId is allocated the same way for every payment type so invoice numbering has no holes.
    const invId = await getNextInvId(prisma);
    const idempotencyKey = `${tenantId}-${productCode}-${periodMonths}-${Date.now()}`;

    let payment;
    try {
      payment = await prisma.$transaction(async (tx: any) => {
        // Hold the balance the moment the invoice exists: minutes pass before the webhook
        // arrives and the same money could be sent to a withdrawal meanwhile. Conditional
        // decrement — never compute the new balance in JS.
        if (appliedBalanceRub > 0) {
          const held = await tx.tenantBalance.updateMany({
            where: { tenantId, balanceRub: { gte: appliedBalanceRub } },
            data: { balanceRub: { decrement: appliedBalanceRub } },
          });
          if (held.count === 0) {
            throw Object.assign(new Error(BALANCE_CONFLICT_MESSAGE), { code: BALANCE_CONFLICT });
          }
        }
        return tx.payment.create({
          data: {
            tenantId,
            robokassaInvId: invId,
            amount: netAmount,
            balanceAppliedRub: appliedBalanceRub,
            status: 'pending',
            productCode,
            periodMonths: periodMonths || 1,
            description,
            idempotencyKey,
            shpTenantId: tenantId,
          },
        });
      });
    } catch (err: any) {
      if (err?.code === BALANCE_CONFLICT) {
        return reply.code(400).send({ error: BALANCE_CONFLICT_MESSAGE });
      }
      throw err;
    }

    if (fullyCovered) {
      // Robokassa cannot process a 0 ₽ invoice, so the purchase completes server-side. It goes
      // through `fulfilPaymentTransactional` so the post-commit Twenty CRM unlock still runs.
      const ctx = await loadFulfilPaymentContext(prisma, payment, {});
      const done = await fulfilPaymentTransactional(prisma, payment, ctx, async (tx: any) => {
        const claim = await tx.payment.updateMany({
          where: { id: payment.id, status: 'pending' },
          data: { status: 'paid', paidAt: new Date() },
        });
        if (claim.count === 0) return false;
        await tx.referralTransaction.create({
          data: {
            tenantId,
            kind: 'redeem',
            amountRub: appliedBalanceRub,
            note: `Счёт #${invId} оплачен партнёрским балансом`,
          },
        });
        return true;
      });

      if (!done) {
        return reply.code(400).send({ error: BALANCE_CONFLICT_MESSAGE });
      }

      fastify.log.info(
        { invId, tenantId, appliedBalanceRub },
        'Invoice fully covered by partner balance',
      );
      return reply.send({
        paid: true,
        invId,
        amount: 0,
        grossAmount,
        appliedBalanceRub,
        redirectUrl: '/dashboard/crm?paid=ok',
      });
    }

    const paymentUrl = robokassa.generatePaymentUrl({
      invId,
      amount: netAmount,
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

    return reply.send({ paymentUrl, invId, amount: netAmount, grossAmount, appliedBalanceRub });
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
      const shpKeys = Object.keys(customData).sort();
      fastify.log.warn(
        {
          invId,
          outSum: String(outSum),
          shpKeys,
          sigLen: String(signatureValue).length,
          sigPref: String(signatureValue).slice(0, 12).toLowerCase(),
        },
        'Invalid Robokassa signature',
      );
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

    // OutSum is the cash Robokassa collected; Payment.amount stores that same net figure.
    if (!paymentAmountMatchesOutSum(Number(existing.amount), String(outSum))) {
      fastify.log.warn(
        { invId, outSum, expected: String(existing.amount) },
        'Robokassa OutSum does not match payment.amount',
      );
      return reply.code(400).send('amount mismatch');
    }

    const ctx = await loadFulfilPaymentContext(prisma, existing, customData);

    const claimed = await fulfilPaymentTransactional(prisma, existing, ctx, async (tx: any) => {
      // Conditional claim: only one concurrent delivery may flip pending → paid.
      // `cancelled` is accepted because a Robokassa session can outlive the balance hold, which
      // a later /checkout releases — the customer still paid and must receive the goods.
      const claim = await tx.payment.updateMany({
        where: { id: existing.id, status: { in: ['pending', 'cancelled'] } },
        data: { status: 'paid', paidAt: new Date() },
      });
      if (claim.count === 0) return false;

      const applied = Number(existing.balanceAppliedRub ?? 0);
      if (applied > 0) {
        let holdStanding = existing.status === 'pending';
        if (!holdStanding) {
          // The hold was released; take the money again if it is still there.
          const held = await tx.tenantBalance.updateMany({
            where: { tenantId: existing.tenantId, balanceRub: { gte: applied } },
            data: { balanceRub: { decrement: applied } },
          });
          holdStanding = held.count > 0;
        }
        if (holdStanding) {
          await tx.referralTransaction.create({
            data: {
              tenantId: existing.tenantId,
              kind: 'redeem',
              amountRub: applied,
              note: `Счёт #${invIdNum} частично оплачен партнёрским балансом`,
            },
          });
        } else {
          // Never let the balance go negative: fulfil anyway and eat the redeemed part. The loss
          // is bounded by `applied` and stays visible here.
          fastify.log.error(
            { invId: invIdNum, tenantId: existing.tenantId, applied },
            'Late payment for a released balance hold: not enough balance to re-hold, fulfilling anyway',
          );
        }
      }
      return true;
    });

    if (!claimed) {
      fastify.log.info({ invId }, 'Payment already claimed by another delivery');
      return reply.type('text/plain').send(`OK${invId}`);
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

interface FulfilmentPayment {
  id: string;
  tenantId: string;
  /** Money part only — `gross - balanceAppliedRub`. */
  amount: any;
  /** Part of the invoice closed by the partner balance. */
  balanceAppliedRub?: any;
  productCode: string;
  periodMonths: number | null;
}

/** Inputs the fulfilment body needs beyond the payment row itself. */
interface FulfilPaymentContext {
  /** Robokassa `Shp_*` payload (`quantity`, `extra_seats`); `{}` when there is no gateway. */
  customData: Record<string, string>;
  quantity: number;
  tenantCrmPricing: { seatsIncluded: number };
}

/**
 * Loads the fulfilment inputs. Deliberately runs OUTSIDE the fulfilment transaction (as it
 * always did) so pricing lookups do not extend the write transaction.
 */
async function loadFulfilPaymentContext(
  prisma: any,
  payment: FulfilmentPayment,
  customData: Record<string, string>,
): Promise<FulfilPaymentContext> {
  const quantity = Math.max(1, parseInt(customData.quantity || '1', 10) || 1);

  const { loadCrmPlatformPricing } = await import('../services/crm-pricing-settings.js');
  const { loadTenantCrmPricing } = await import('../services/crm-tenant-pricing.js');
  const crmPlatformPricing = await loadCrmPlatformPricing(prisma);
  const tenantCrmPricing = await loadTenantCrmPricing(
    prisma,
    payment.tenantId,
    crmPlatformPricing,
  );

  return { customData, quantity, tenantCrmPricing };
}

/**
 * The ONLY entry point for fulfilling a payment. Claims the payment, runs `fulfilPayment` in the
 * transaction, and — after commit — runs the effects that must not sit inside a DB transaction
 * (Twenty CRM unlock for `crm_base`).
 *
 * `claim` flips the payment to paid and returns `false` when someone else already fulfilled it;
 * fulfilment is then skipped and this returns `false`.
 *
 * Never call `fulfilPayment` directly: skipping the post-commit unlock leaves a tenant who just
 * paid (including a renewal covered entirely by partner balance) locked out of their CRM.
 */
async function fulfilPaymentTransactional(
  prisma: any,
  payment: FulfilmentPayment,
  ctx: FulfilPaymentContext,
  claim: (tx: any) => Promise<boolean>,
): Promise<boolean> {
  const claimed = await prisma.$transaction(async (tx: any) => {
    if (!(await claim(tx))) {
      return false;
    }
    await fulfilPayment(tx, payment, ctx);
    return true;
  });

  if (!claimed) return false;

  if (payment.productCode === 'crm_base' || payment.productCode === PRODUCT_CODES.CRM_BASE) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: payment.tenantId },
      select: { twentyWorkspaceId: true },
    });
    await syncTwentyCrmLock(tenant?.twentyWorkspaceId, false);
  }

  return true;
}

/**
 * Applies everything a paid payment grants: subscription period, addons/wallet/seats and the
 * referral commission. Runs inside the caller's transaction, after the payment was claimed.
 *
 * Go through `fulfilPaymentTransactional` — it owns the post-commit CRM unlock.
 */
async function fulfilPayment(
  tx: any,
  payment: FulfilmentPayment,
  ctx: FulfilPaymentContext,
): Promise<void> {
  const { customData, quantity, tenantCrmPricing } = ctx;

  const periodMonths = payment.periodMonths || 1;
  const now = new Date();
  let endsAt = new Date(now);
  endsAt.setMonth(endsAt.getMonth() + Math.max(1, periodMonths));

  // CRM renewals: extend from current paid/trial end if still in the future
  // (so paying during trial yields trialEnd + period, not now + period).
  if (payment.productCode === 'crm_base' || payment.productCode === PRODUCT_CODES.EXTRA_SEAT) {
    const priorCrm = await tx.subscription.findFirst({
      where: {
        tenantId: payment.tenantId,
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

  if (payment.productCode === PRODUCT_CODES.AI_TOPUP) {
    // The wallet gets the GROSS top-up: `amount` is only the money part, the rest was closed
    // by the partner balance. Crediting `amount` alone silently short-changes the customer.
    const topupRub = Number(payment.amount) + Number(payment.balanceAppliedRub ?? 0);
    await tx.aiWallet.upsert({
      where: { tenantId: payment.tenantId },
      create: { tenantId: payment.tenantId, balanceRub: topupRub },
      update: { balanceRub: { increment: topupRub } },
    });
  } else if (payment.productCode === PRODUCT_CODES.AI_TG_EXTRA_CONN) {
    const addon = await tx.addon.findUnique({
      where: {
        tenantId_type: { tenantId: payment.tenantId, type: PRODUCT_CODES.AI_TELEGRAM },
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
          activeUntil: addon.activeUntil > endsAt ? addon.activeUntil : endsAt,
        },
      });
    } else {
      await tx.addon.create({
        data: {
          tenantId: payment.tenantId,
          type: PRODUCT_CODES.AI_TELEGRAM,
          config,
          activeUntil: endsAt,
          status: 'active',
        },
      });
    }
    await tx.subscription.create({
      data: {
        tenantId: payment.tenantId,
        productCode: payment.productCode,
        periodMonths,
        seatsIncluded: 0,
        startsAt: now,
        endsAt,
        status: 'active',
        payments: { connect: { id: payment.id } },
      },
    });
  } else if (payment.productCode === PRODUCT_CODES.AI_AGENT) {
    const addon = await tx.addon.findUnique({
      where: {
        tenantId_type: { tenantId: payment.tenantId, type: PRODUCT_CODES.AI_AGENT },
      },
    });
    const prev = getAiAgentSlots(addon?.config);
    const nextSlots = prev + quantity;
    const config = {
      ...((addon?.config as object) || {}),
      agentSlots: nextSlots,
    };
    if (addon) {
      await tx.addon.update({
        where: { id: addon.id },
        data: {
          config,
          status: 'active',
          activeUntil: addon.activeUntil > endsAt ? addon.activeUntil : endsAt,
        },
      });
    } else {
      await tx.addon.create({
        data: {
          tenantId: payment.tenantId,
          type: PRODUCT_CODES.AI_AGENT,
          config,
          activeUntil: endsAt,
          status: 'active',
        },
      });
    }
    await tx.subscription.create({
      data: {
        tenantId: payment.tenantId,
        productCode: payment.productCode,
        periodMonths,
        seatsIncluded: 0,
        startsAt: now,
        endsAt,
        status: 'active',
        payments: { connect: { id: payment.id } },
      },
    });
  } else if (payment.productCode === PRODUCT_CODES.EXTRA_SEAT) {
    const addSeats = Math.max(
      1,
      parseInt(customData.extra_seats || customData.quantity || '1', 10) || 1,
    );
    const activeCrm = await tx.subscription.findFirst({
      where: {
        tenantId: payment.tenantId,
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
        tenantId: payment.tenantId,
        productCode: payment.productCode,
        periodMonths,
        seatsIncluded: 0,
        extraSeats: addSeats,
        startsAt: now,
        endsAt,
        status: 'active',
        payments: { connect: { id: payment.id } },
      },
    });
  } else {
    if (payment.productCode === 'crm_base') {
      await tx.subscription.updateMany({
        where: {
          tenantId: payment.tenantId,
          status: 'active',
          periodMonths: 0,
        },
        data: { status: 'expired' },
      });
      await tx.tenant.update({
        where: { id: payment.tenantId },
        data: { status: 'active' },
      });
    }

    const extraSeatsPaid =
      payment.productCode === 'crm_base'
        ? Math.max(0, parseInt(customData.extra_seats || '0', 10) || 0)
        : 0;

    await tx.subscription.create({
      data: {
        tenantId: payment.tenantId,
        productCode: payment.productCode,
        periodMonths,
        seatsIncluded: payment.productCode === 'crm_base' ? tenantCrmPricing.seatsIncluded : 0,
        extraSeats: extraSeatsPaid,
        startsAt: now,
        endsAt,
        status: 'active',
        payments: { connect: { id: payment.id } },
      },
    });

    if (
      payment.productCode.startsWith('analytics_') ||
      payment.productCode === 'gift_bot' ||
      payment.productCode === PRODUCT_CODES.AI_TELEGRAM ||
      payment.productCode === PRODUCT_CODES.AI_GRAMJS ||
      payment.productCode === PRODUCT_CODES.AI_WHATSAPP ||
      payment.productCode === PRODUCT_CODES.MAILING_BOT ||
      payment.productCode === PRODUCT_CODES.MAILING_ACCOUNTS ||
      payment.productCode === PRODUCT_CODES.MAILING_STORIES
    ) {
      const existingAddon = await tx.addon.findUnique({
        where: {
          tenantId_type: { tenantId: payment.tenantId, type: payment.productCode },
        },
      });
      const prevConfig = (existingAddon?.config as Record<string, unknown>) || {};
      await tx.addon.upsert({
        where: {
          tenantId_type: { tenantId: payment.tenantId, type: payment.productCode },
        },
        create: {
          tenantId: payment.tenantId,
          type: payment.productCode,
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

  await creditReferralForPayment(tx, payment);
}

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
  if (!isProductInReferralScope(payment.productCode, rule.productScope)) return;

  // `payment.amount` is the NET money part. The redeemed part was already credited to another
  // partner, so paying commission on it again would disburse the same money twice.
  const amount = Number(payment.amount);
  let earningAmount = 0;
  const isFirst = !referral.firstPaymentAt;

  if (rule.type === 'percent_recurring') {
    if (
      rule.durationMonths &&
      isAfterReferralPayoutWindow(referral.firstPaymentAt, rule.durationMonths)
    ) {
      return;
    }
    earningAmount = (amount * Number(rule.value)) / 100;
  } else if (rule.type === 'percent_first_payment' && isFirst) {
    earningAmount = (amount * Number(rule.value)) / 100;
  } else if (
    // `credit` duplicated `fixed_first_payment` verbatim and `credit_discount` had no branch at
    // all, so it earned nothing AND never stamped `firstPaymentAt` — the referral stayed pending.
    (rule.type === 'fixed_first_payment' ||
      rule.type === 'credit' ||
      rule.type === 'credit_discount') &&
    isFirst
  ) {
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
    ai_agent: PRICING.AI_AGENT_MONTHLY,
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
    ai_tg: 'Voxly — Телеграм Секретарь',
    ai_tg_extra_conn: `Voxly — доп. аккаунт секретаря ×${quantity}`,
    ai_gramjs: 'Voxly — Telegram',
    ai_wa: 'Voxly — WhatsApp',
    ai_agent: quantity > 1 ? `Voxly — AI-агент ×${quantity}` : 'Voxly — AI-агент',
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

/**
 * Releases this tenant's open balance holds. Release semantics live in `releaseBalanceHold`,
 * which the partner-facing route and the hourly sweeper also call — keep them a single source
 * of truth, since a divergence here refunds money twice or not at all.
 */
async function releaseBalanceHolds(prisma: any, tenantId: string): Promise<number> {
  const holds = await prisma.payment.findMany({
    where: { tenantId, status: 'pending', balanceAppliedRub: { gt: 0 } },
    select: { id: true, balanceAppliedRub: true },
  });

  let released = 0;
  for (const hold of holds) {
    const result = await releaseBalanceHold(prisma, hold.id, tenantId);
    if (result.released) released += Number(hold.balanceAppliedRub);
  }
  return released;
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
