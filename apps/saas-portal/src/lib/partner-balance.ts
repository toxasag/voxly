/** Cap and round a partner-balance redemption against an invoice. */
export function computeAppliedBalanceRub(opts: {
  useBalance: boolean;
  availableRub: number;
  invoiceRub: number;
  inputRub: number;
}): number {
  if (!opts.useBalance) return 0;
  const available = Math.max(0, Number(opts.availableRub) || 0);
  const invoice = Math.max(0, Number(opts.invoiceRub) || 0);
  const cap = Math.min(available, invoice);
  const wanted = Math.round((Number(opts.inputRub) || 0) * 100) / 100;
  return Math.max(0, Math.min(cap, wanted));
}

/** Portal path after a balance-only (zero-card) checkout. */
export function checkoutPaidRedirect(productCode: string): string {
  switch (productCode) {
    case 'crm_base':
    case 'extra_seat':
      return '/dashboard/crm?paid=ok';
    case 'gift_bot':
      return '/dashboard/bots?paid=ok';
    case 'gift_bot_max':
      return '/dashboard/bots/max?paid=ok';
    case 'ai_tg':
    case 'ai_tg_extra_conn':
      return '/dashboard/ai?paid=ok';
    case 'ai_gramjs':
      return '/dashboard/ai/gramjs?paid=ok';
    case 'ai_wa':
      return '/dashboard/ai/whatsapp?paid=ok';
    case 'ai_agent':
    case 'ai_topup':
      return '/dashboard/ai/agents?paid=ok';
    case 'mailing_bot':
      return '/dashboard/mailing/bot?paid=ok';
    case 'mailing_accounts':
      return '/dashboard/mailing/gramjs?paid=ok';
    case 'mailing_stories':
      return '/dashboard/mailing/stories?paid=ok';
    default:
      return '/dashboard?paid=ok';
  }
}
