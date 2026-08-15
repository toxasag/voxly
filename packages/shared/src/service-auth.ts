// Voxly service-to-service authentication helpers.
//
// Goal: allow each internal service (bridges, workers, saas-api internal
// routes, Twenty logic functions) to authenticate with a PER-SERVICE bearer
// token instead of one shared secret, so services can be split across hosts
// and a leaked token only exposes one module. Fully backward compatible: if a
// per-service token is not configured, the shared VOXLY_SERVICE_TOKEN is used,
// so existing single-token deployments keep working unchanged.
//
// The token is keyed by the TARGET service (the one verifying inbound calls).
// A caller resolves the target's token; the target verifies its own token.
//
// Browser-safe: reads process.env lazily and uses a pure-JS constant-time
// compare (no node:crypto), because @voxly/shared is also bundled by the portal.

const SHARED_TOKEN_ENV = 'VOXLY_SERVICE_TOKEN';

function readEnv(name: string): string {
  if (typeof process === 'undefined' || !process || !process.env) return '';
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * Env var name that holds the dedicated token for a service.
 * e.g. 'gramjs-bridge' -> 'VOXLY_TOKEN_GRAMJS_BRIDGE'
 */
export function serviceTokenEnvName(service: string): string {
  const suffix = String(service || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `VOXLY_TOKEN_${suffix}`;
}

/**
 * Outbound: the bearer token a caller must present to reach `targetService`.
 * Prefers the per-service token, falls back to the shared VOXLY_SERVICE_TOKEN.
 */
export function resolveServiceToken(targetService: string): string {
  return readEnv(serviceTokenEnvName(targetService)) || readEnv(SHARED_TOKEN_ENV);
}

/**
 * Constant-time string comparison. Pure JS so it is safe in the browser bundle.
 * Compares over the longer length to avoid leaking length via early exit.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Extract the raw token from an `Authorization: Bearer <token>` header value. */
export function extractBearer(authorizationHeader: string | null | undefined): string {
  const h = String(authorizationHeader || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/**
 * Inbound: verify a presented bearer token for the verifying (`self`) service.
 * Accepts the service's dedicated token OR the shared VOXLY_SERVICE_TOKEN
 * (migration fallback). Returns false when no token is configured or presented.
 *
 * Comparison runs against all candidates without early exit to avoid leaking
 * which candidate matched.
 */
export function verifyServiceToken(
  presentedToken: string | null | undefined,
  selfService: string,
): boolean {
  const token = String(presentedToken || '').trim();
  if (!token) return false;

  const candidates: string[] = [];
  const perService = readEnv(serviceTokenEnvName(selfService));
  if (perService) candidates.push(perService);
  const shared = readEnv(SHARED_TOKEN_ENV);
  if (shared) candidates.push(shared);
  if (candidates.length === 0) return false;

  let ok = false;
  for (const c of candidates) {
    // Bitwise OR keeps both branches evaluated (no short-circuit).
    ok = timingSafeEqualStr(token, c) || ok;
  }
  return ok;
}
