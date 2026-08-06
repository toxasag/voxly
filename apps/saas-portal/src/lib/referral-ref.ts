/** sessionStorage key for referral code carried from landing → register */
export const REF_STORAGE_KEY = 'voxly_ref';

export function registerHref(ref?: string | null): string {
  const code = ref?.trim();
  if (!code) return '/register';
  return `/register?ref=${encodeURIComponent(code)}`;
}

export function referralLandingUrl(domain: string, code: string): string {
  return `https://${domain}/?ref=${encodeURIComponent(code.trim())}`;
}

export function readStoredRef(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return sessionStorage.getItem(REF_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

export function storeRef(code: string): void {
  try {
    sessionStorage.setItem(REF_STORAGE_KEY, code.trim());
  } catch {
    // ignore quota / private mode
  }
}
