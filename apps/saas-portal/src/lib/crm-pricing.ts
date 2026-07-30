import { PERIOD_DISCOUNTS, PRICING } from '@voxly/shared';

export function calculateSubscriptionPrice(
  monthlyPrice: number,
  periodMonths: number,
  discountPercent: number,
): number {
  const base = monthlyPrice * periodMonths;
  const discount = (base * discountPercent) / 100;
  return Math.round((base - discount) * 100) / 100;
}

export function computeCrmCheckoutTotals(periodMonths: number, extraSeats: number) {
  const discount = PERIOD_DISCOUNTS[periodMonths] ?? 0;
  const baseTotal = calculateSubscriptionPrice(PRICING.CRM_BASE_MONTHLY, periodMonths, discount);
  const extraTotal =
    extraSeats > 0
      ? calculateSubscriptionPrice(
          PRICING.EXTRA_SEAT_MONTHLY * extraSeats,
          periodMonths,
          discount,
        )
      : 0;
  return {
    discount,
    baseTotal,
    extraTotal,
    combinedTotal: Math.round((baseTotal + extraTotal) * 100) / 100,
  };
}
