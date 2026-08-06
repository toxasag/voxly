/** Decode JWT payload for client UI (not verified — server still enforces auth). */
export function readSessionClaims(): {
  role?: string;
  tenantRole?: string;
  tenantId?: string;
  email?: string;
} | null {
  if (typeof window === 'undefined') return null;
  const token = localStorage.getItem('voxly_token');
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json) as {
      role?: string;
      tenantRole?: string;
      tenantId?: string;
      email?: string;
    };
  } catch {
    return null;
  }
}
