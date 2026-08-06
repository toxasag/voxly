'use client';

import { useEffect, useState } from 'react';
import { authHeaders } from '@/lib/auth';
import { computeAppliedBalanceRub } from '@/lib/partner-balance';

/**
 * Loads free partner-referral balance and tracks opt-in redemption against an invoice.
 * Default off — nothing is spent until the user checks the box.
 */
export function usePartnerBalanceApply(invoiceRub: number) {
  const [availableRub, setAvailableRub] = useState(0);
  const [useBalance, setUseBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/billing/status', { headers: authHeaders() });
        if (!res.ok) return;
        const json = (await res.json()) as {
          tenantBalance?: { balanceRub?: string | number } | null;
        };
        const bal = Number(json.tenantBalance?.balanceRub ?? 0);
        if (!cancelled) setAvailableRub(Number.isFinite(bal) ? bal : 0);
      } catch {
        /* optional UX — checkout still works without balance */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const balanceCap = Math.min(Math.max(0, availableRub), Math.max(0, invoiceRub));
  const appliedRub = computeAppliedBalanceRub({
    useBalance,
    availableRub,
    invoiceRub,
    inputRub: Number(balanceInput) || 0,
  });
  const netRub = Math.round((Math.max(0, invoiceRub) - appliedRub) * 100) / 100;

  const setUseBalanceChecked = (on: boolean) => {
    setUseBalance(on);
    setBalanceInput(on ? String(balanceCap) : '');
  };

  return {
    loaded,
    availableRub,
    useBalance,
    setUseBalance: setUseBalanceChecked,
    balanceInput,
    setBalanceInput,
    balanceCap,
    appliedRub,
    netRub,
    /** Spread into startCheckout when > 0 */
    applyBalancePayload:
      appliedRub > 0 ? ({ applyBalanceRub: appliedRub } as const) : ({} as const),
  };
}
