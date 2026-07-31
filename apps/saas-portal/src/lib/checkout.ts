/**
 * Start Robokassa checkout; redirects the browser to paymentUrl.
 * When the partner balance covers the whole invoice the server returns no
 * paymentUrl — we then follow its redirectUrl and report 'paid'.
 */
export async function startCheckout(body: {
  productCode: string;
  periodMonths?: number;
  amountRub?: number;
  quantity?: number;
  extraSeats?: number;
  applyBalanceRub?: number;
}): Promise<'redirected' | 'paid'> {
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
  if (!json.paymentUrl) {
    if (json.paid) {
      window.location.href =
        typeof json.redirectUrl === 'string' ? json.redirectUrl : '/dashboard/crm?paid=ok';
      return 'paid';
    }
    throw new Error('Нет ссылки на оплату');
  }
  window.location.href = json.paymentUrl;
  return 'redirected';
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
