/**
 * INC-113: never treat the connected MAX account phone as a CRM peer phone.
 * Shared by live inbound, history sync, and cross-channel enrich callers.
 */

export function phoneDigitsOnly(raw?: string | null): string {
  return String(raw || '').replace(/\D/g, '');
}

/** True when two phones match (exact digits or last-10 RU-style). */
export function phonesLikelySame(
  a?: string | null,
  b?: string | null,
): boolean {
  const da = phoneDigitsOnly(a);
  const db = phoneDigitsOnly(b);
  if (!da || !db || da.length < 10 || db.length < 10) return false;
  if (da === db) return true;
  return da.slice(-10) === db.slice(-10);
}

/**
 * Drop phone when it equals the connected MAX account phone.
 * Returns undefined so callers skip createPerson phone + applyMaxProfile phone + enrich.
 */
export function stripOwnerPhone(
  phone?: string | null,
  selfPhone?: string | null,
): string | undefined {
  const digits = phoneDigitsOnly(phone);
  if (digits.length < 10) return undefined;
  if (phonesLikelySame(digits, selfPhone)) return undefined;
  return digits;
}
