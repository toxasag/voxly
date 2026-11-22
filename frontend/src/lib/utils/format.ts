// ---------------------------------------------------------------------------
// Единые утилиты форматирования денежных сумм на фронтенде.
// ---------------------------------------------------------------------------

/** Форматирует сумму в рублях (`12 500 ₽`). */
export function formatRub(amount: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits,
  }).format(amount);
}

/** Форматирует сумму в указанной валюте (по умолчанию RUB). */
export function formatMoney(
  amount: number,
  currency = "RUB",
  maximumFractionDigits = 0,
): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits,
  }).format(amount);
}
