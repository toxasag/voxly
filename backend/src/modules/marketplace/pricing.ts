import type { BillingKind } from "./marketplace.types.js";

// ---------------------------------------------------------------------------
// Расчёт стоимости подписки.
//
// Вынесен в отдельный модуль и работает на чистых данных: одна и та же функция
// считает сумму для карточки маркетплейса и для сводки по подписке, поэтому
// цифра в интерфейсе не может разойтись со счётом.
// ---------------------------------------------------------------------------

export interface PricingInput {
  billingKind: BillingKind;
  basePrice: number;
  unitPrice: number;
  includedUnits: number;
  /** Число подключённых единиц (агентов, аккаунтов). Для flat игнорируется. */
  quantity: number;
  /**
   * Число пользователей арендатора — нужно только для per_seat.
   * Считается по таблице users, а не берётся из клиента.
   */
  usersCount: number;
}

/**
 * Месячная стоимость модуля без учёта пробного периода.
 *
 *  flat      — фиксированная сумма пакета.
 *  per_seat  — пакет + доплата за каждого пользователя свыше включённых.
 *              Отрицательный излишек отсекается: при 3 пользователях из 10
 *              включённых доплаты нет, а не «минус 7 мест».
 *  per_unit  — цена единицы × количество.
 */
export function monthlyPrice(input: PricingInput): number {
  switch (input.billingKind) {
    case "flat":
      return input.basePrice;

    case "per_seat": {
      const extraSeats = Math.max(0, input.usersCount - input.includedUnits);
      return input.basePrice + extraSeats * input.unitPrice;
    }

    case "per_unit":
      return input.unitPrice * Math.max(1, input.quantity);
  }
}

/**
 * Активен ли пробный период.
 *
 * Вычисляется на сервере: браузерные часы можно перевести, и клиент показал бы
 * «бесплатно» для уже платного модуля.
 */
export function isTrialActive(trialEndsAt: Date | string | null): boolean {
  if (trialEndsAt === null) return false;
  const ends = trialEndsAt instanceof Date ? trialEndsAt : new Date(trialEndsAt);
  return ends.getTime() > Date.now();
}

/** Сумма к оплате: во время пробного периода — 0. */
export function effectiveMonthly(input: PricingInput, trialEndsAt: Date | string | null): number {
  return isTrialActive(trialEndsAt) ? 0 : monthlyPrice(input);
}
