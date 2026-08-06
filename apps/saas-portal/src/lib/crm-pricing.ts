import { PERIOD_DISCOUNTS } from '@voxly/shared';

export function calculateSubscriptionPrice(
  monthlyPrice: number,
  periodMonths: number,
  discountPercent: number,
): number {
  const base = monthlyPrice * periodMonths;
  const discount = (base * discountPercent) / 100;
  return Math.round((base - discount) * 100) / 100;
}

export type CrmCheckoutRates = {
  baseMonthly: number;
  extraSeatMonthly: number;
};

export function computeCrmCheckoutTotals(
  periodMonths: number,
  extraSeats: number,
  rates: CrmCheckoutRates,
) {
  const discount = PERIOD_DISCOUNTS[periodMonths] ?? 0;
  const baseTotal = calculateSubscriptionPrice(rates.baseMonthly, periodMonths, discount);
  const extraTotal =
    extraSeats > 0
      ? calculateSubscriptionPrice(
          rates.extraSeatMonthly * extraSeats,
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
