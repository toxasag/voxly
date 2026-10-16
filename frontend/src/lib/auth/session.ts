// ---------------------------------------------------------------------------
// Session storage.
//
// Single source of truth for where the tokens live, shared by `apiClient`,
// `use-auth` and the Edge middleware.
//
// Why a cookie in addition to localStorage: `middleware.ts` runs on the Edge
// runtime, which has no access to localStorage. Route protection therefore
// needs a cookie. The backend still returns tokens in the response body
// (httpOnly cookies are M0.6.5), so until then the client writes a readable
// cookie itself.
//
// Tradeoff, stated plainly: a JS-readable token is exposed to XSS. It is the
// same exposure the previous localStorage-only version had, so this is not a
// regression — but it is not the end state either. Once the backend sets an
// httpOnly cookie, `writeTokens` should stop writing the cookie and
// `readAccessToken` should stop reading it; the middleware keeps working
// unchanged because it only ever checks for presence.
//
// Two properties are essential for the per-tenant subdomains
// ({slug}.getvoxly.ru) and both were missing, which produced a redirect loop:
//
//  1. `Domain=.getvoxly.ru` — a host-only cookie set on app.getvoxly.ru is not
//     sent to firma.getvoxly.ru, so the middleware saw no token there and
//     bounced to /login, where the client still had a valid localStorage
//     session and sent the user back. Sharing the cookie across the parent
//     domain is what makes a cross-subdomain redirect survive.
//  2. `Max-Age` — as a pure session cookie it disappeared on browser restart
//     while the refresh token in localStorage survived, leaving the two stores
//     disagreeing: middleware said "signed out", the app said "signed in".
// ---------------------------------------------------------------------------

export const ACCESS_TOKEN_KEY = "getvoxly_auth_token";
export const REFRESH_TOKEN_KEY = "getvoxly_refresh_token";

/**
 * Refresh token cookie name.
 *
 * localStorage is per-origin, so app.getvoxly.ru and demo.getvoxly.ru keep
 * separate stores. Signing in on the shared host and landing on the tenant
 * subdomain therefore arrived with no refresh token: the session could not be
 * restored, permissions stayed empty and every page rendered its "no access"
 * state. Mirroring the refresh token into a domain-scoped cookie is what makes
 * the session portable across subdomains. Verified in the browser — before this
 * the redirect produced a signed-in URL with a signed-out UI.
 */
export const REFRESH_COOKIE_NAME = "getvoxly_refresh";

/**
 * Cookie lifetime. Deliberately longer than the 15-minute access token: the
 * cookie only tells the middleware "a session exists", and a still-valid
 * refresh token must not be discarded just because the access token aged out.
 */
const AUTH_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Parent domain the cookie is scoped to, so every {slug}.getvoxly.ru portal
 * shares one session.
 *
 * Derived from the current host rather than hardcoded: on localhost and on
 * Vercel-style preview hosts a `Domain` attribute would be rejected outright
 * (and `Domain=.localhost` is invalid), so it is omitted there.
 */
function cookieDomainAttribute(): string {
  if (!isBrowser()) return "";

  const host = window.location.hostname;

  // IP literals and single-label hosts (localhost) cannot carry a Domain.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "";

  const labels = host.split(".");
  if (labels.length < 2) return "";

  // Last two labels: getvoxly.ru from app.getvoxly.ru or firma.getvoxly.ru.
  const parent = labels.slice(-2).join(".");
  return `; Domain=.${parent}`;
}

/** Read by `middleware.ts`; presence alone gates the route. */
export const AUTH_COOKIE_NAME = ACCESS_TOKEN_KEY;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/** Writes a domain-scoped cookie shared by every {slug}.getvoxly.ru portal. */
function writeCookie(name: string, value: string): void {
  if (!isBrowser()) return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  document.cookie =
    `${name}=${encodeURIComponent(value)}` +
    `; Path=/; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax` +
    `${cookieDomainAttribute()}${secure}`;
}

function clearCookie(name: string): void {
  if (!isBrowser()) return;

  const secure = window.location.protocol === "https:" ? "; Secure" : "";

  // Cleared with the same Domain and Path it was written with — a mismatch
  // leaves the original cookie in place and the user appears signed in forever.
  document.cookie =
    `${name}=; Path=/; Max-Age=0; SameSite=Lax${cookieDomainAttribute()}${secure}`;

  // Also drop a host-only cookie from before Domain scoping existed; otherwise
  // it shadows the domain cookie and survives sign-out.
  document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function readCookie(name: string): string | null {
  if (!isBrowser()) return null;

  for (const part of document.cookie.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) {
      const value = rest.join("=");
      return value.length > 0 ? decodeURIComponent(value) : null;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function readAccessToken(): string | null {
  if (!isBrowser()) return null;
  // Cookie is the fallback, and on a freshly-entered subdomain it is the only
  // copy: localStorage did not travel with the redirect.
  return localStorage.getItem(ACCESS_TOKEN_KEY) ?? readCookie(AUTH_COOKIE_NAME);
}

export function readRefreshToken(): string | null {
  if (!isBrowser()) return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY) ?? readCookie(REFRESH_COOKIE_NAME);
}

export function writeTokens({ accessToken, refreshToken }: SessionTokens): void {
  if (!isBrowser()) return;

  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);

  // Both tokens are mirrored into domain-scoped cookies so the session survives
  // a hop to another subdomain, where localStorage starts empty.
  writeCookie(AUTH_COOKIE_NAME, accessToken);
  writeCookie(REFRESH_COOKIE_NAME, refreshToken);
}

export function clearSession(): void {
  if (!isBrowser()) return;

  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  clearCookie(AUTH_COOKIE_NAME);
  clearCookie(REFRESH_COOKIE_NAME);
}

export function hasSession(): boolean {
  return readAccessToken() !== null;
}
