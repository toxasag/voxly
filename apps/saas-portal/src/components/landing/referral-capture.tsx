'use client';

import { useEffect } from 'react';
import { REF_STORAGE_KEY, storeRef } from '@/lib/referral-ref';

/**
 * On `/?ref=CODE`: persist code for CTAs + register, count one click per session.
 */
export function ReferralCapture() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref')?.trim();
    if (!ref) return;

    storeRef(ref);

    const clickKey = `${REF_STORAGE_KEY}_click_${ref}`;
    try {
      if (sessionStorage.getItem(clickKey)) return;
      sessionStorage.setItem(clickKey, '1');
    } catch {
      // still attempt track once this page load
    }

    void fetch(`/api/referrals/click/${encodeURIComponent(ref)}`, {
      redirect: 'manual',
    }).catch(() => {});
  }, []);

  return null;
}
