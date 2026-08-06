/**
 * Portal dashboard base for sidebar LINKs.
 * Must be an absolute https URL — Twenty treats paths like `/dashboard/…`
 * as in-app routes (or `https:///dashboard/…` → current CRM host).
 * Override at tarball build: VOXLY_CABINET_URL=https://getvoxly.ru/dashboard
 */
export function voxlyCabinetUrl(): string {
  const raw =
    process.env.VOXLY_CABINET_URL?.trim() || 'https://getvoxly.ru/dashboard';
  const trimmed = raw.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  // Guard against accidental relative override during local builds.
  return `https://getvoxly.ru/${trimmed.replace(/^\/+/, '')}`.replace(
    /\/+$/,
    '',
  );
}
