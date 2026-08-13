/**
 * Public pricing catalogue for landing calculator / marketing.
 * Platform defaults only (no tenant overrides).
 */
import type { FastifyPluginAsync } from 'fastify';
import { PRICING } from '@voxly/shared';
import {
  MONTHLY_PRICE_SKUS,
  SKU_LABELS,
  loadPlatformPrices,
  type MonthlyPriceSku,
} from '../services/platform-pricing.js';

export const publicPricingRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/catalog', async (_request, reply) => {
    const platform = await loadPlatformPrices(fastify.prisma);

    const seatsRow = await fastify.prisma.platformSetting.findUnique({
      where: { key: 'subscription_seats_included' },
      select: { value: true },
    });
    const seatsParsed = Number(seatsRow?.value);
    const seatsIncluded =
      Number.isFinite(seatsParsed) && seatsParsed >= 1
        ? Math.round(seatsParsed)
        : platform.seatsIncluded;

    const prices = Object.fromEntries(
      MONTHLY_PRICE_SKUS.map((code) => [code, platform[code]]),
    ) as Record<MonthlyPriceSku, number>;

    return reply.header('Cache-Control', 'public, max-age=60').send({
      currency: 'RUB',
      seatsIncluded,
      secretaryIncludedAccounts: PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS,
      prices,
      skus: MONTHLY_PRICE_SKUS.map((code) => ({
        productCode: code,
        label: SKU_LABELS[code],
        priceMonthly: platform[code],
      })),
    });
  });
};
