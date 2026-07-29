/** Start Robokassa checkout; redirects browser to paymentUrl. */
export async function startCheckout(body: {
  productCode: string;
  periodMonths?: number;
  amountRub?: number;
  quantity?: number;
  extraSeats?: number;
}): Promise<void> {
  const res = await fetch('/api/billing/checkout', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('voxly_token') || ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof json.error === 'string'
        ? json.error
        : json.message || 'Не удалось создать платёж',
    );
  }
  if (!json.paymentUrl) throw new Error('Нет ссылки на оплату');
  window.location.href = json.paymentUrl;
}

/**
 * Handle mailing soft-gate 402: trial still available → message;
 * otherwise redirect to Robokassa for productCode.
 */
export async function handleMailingBillingGate(json: {
  error?: string;
  productCode?: string;
  billing?: { trialAvailable?: boolean };
}): Promise<'checkout' | 'message'> {
  const product = json.productCode;
  if (product && !json.billing?.trialAvailable) {
    await startCheckout({ productCode: product, periodMonths: 1 });
    return 'checkout';
  }
  return 'message';
}
