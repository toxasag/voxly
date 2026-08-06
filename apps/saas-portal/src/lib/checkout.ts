/**
 * Start Robokassa checkout; redirects the browser to paymentUrl.
 * When the partner balance covers the whole invoice the server returns no
 * paymentUrl — we then follow its redirectUrl and report 'paid'.
 */

import { checkoutPaidRedirect } from '@/lib/partner-balance';

export async function startCheckout(body: {
  productCode: string;
  periodMonths?: number;
  amountRub?: number;
  quantity?: number;
  /** gift_bot: add slot vs renew all slots */
  intent?: 'add' | 'renew';
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
        typeof json.redirectUrl === 'string'
          ? json.redirectUrl
          : checkoutPaidRedirect(body.productCode);
      return 'paid';
    }
    throw new Error('Нет ссылки на оплату');
  }
  window.location.href = json.paymentUrl;
  return 'redirected';
}

/** Portal path for mailing add-on pay UI (balance opt-in lives on the banner). */
export function mailingProductPayPath(productCode: string): string {
  switch (productCode) {
    case 'mailing_bot':
      return '/dashboard/mailing/bot?pay=1';
    case 'mailing_accounts':
      return '/dashboard/mailing/gramjs?pay=1';
    case 'mailing_stories':
      return '/dashboard/mailing/stories?pay=1';
    default:
      return '/dashboard/mailing';
  }
}

/**
 * Handle mailing soft-gate 402: trial still available → message;
 * otherwise open the mailing pay page so the user can opt into partner balance
 * (default OFF). Auto-checkout without UI would skip the checkbox.
 */
export async function handleMailingBillingGate(json: {
  error?: string;
  productCode?: string;
  billing?: { trialAvailable?: boolean };
}): Promise<'checkout' | 'message'> {
  const product = json.productCode;
  if (product && !json.billing?.trialAvailable) {
    window.location.href = mailingProductPayPath(product);
    return 'checkout';
  }
  return 'message';
}
