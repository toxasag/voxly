'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { readStoredRef, registerHref, storeRef } from '@/lib/referral-ref';

type Props = {
  children: ReactNode;
  className?: string;
  /** From server `/?ref=` — avoids flash/race without query on Link. */
  refCode?: string | null;
};

/** Register CTA that keeps `?ref=` from URL, prop, or sessionStorage. */
export function RegisterLink({ children, className, refCode }: Props) {
  const [href, setHref] = useState(() => registerHref(refCode));

  useEffect(() => {
    if (refCode?.trim()) {
      storeRef(refCode);
      setHref(registerHref(refCode));
      return;
    }
    const fromUrl = new URLSearchParams(window.location.search).get('ref')?.trim();
    setHref(registerHref(fromUrl || readStoredRef()));
  }, [refCode]);

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
