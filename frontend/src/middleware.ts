import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge middleware: route protection + per-tenant subdomain resolution.
 *
 * Host layout:
 *   getvoxly.ru / www.getvoxly.ru  — landing + shared sign-in
 *   app.getvoxly.ru               — shared portal and superadmin
 *   {slug}.getvoxly.ru            — one tenant's portal (firma.getvoxly.ru)
 *
 * The tenant slug is forwarded to the app as `x-tenant-slug` rather than
 * rewritten into the path: every page keeps its normal URL, and server
 * components read the header when they need to know which portal they are on.
 * Authorisation is NOT done here — the backend verifies that the token's tenant
 * matches the requested slug, since a header set at the edge is not a
 * credential.
 */

const PROTECTED_PREFIXES = [
  "/crm",
  "/repairs",
  "/warehouse",
  "/finance",
  "/inbox",
  "/marketing",
  // Каналы связи. Без этого префикса страница открывалась бы без сессии: гейт
  // `<Guard>` живёт в браузере и не заменяет проверку до рендера.
  "/integrations",
  "/tenants",
  "/marketplace",
  "/settings",
  "/dashboard",
  "/analytics",
  "/modules",
  "/superadmin",
  // Разделы управления платформой. Наличие сессии проверяется здесь, а роль
  // platform_owner — на бэкенде (403) и в PlatformOwnerGuard: JWT на Edge не
  // разбирается, чтобы не тащить секрет подписи в middleware.
  "/admin",
] as const;

/**
 * Pages that must bounce an already-signed-in visitor onward.
 *
 * This is half of the redirect-loop fix: without it, a user with a valid
 * session who lands on /login stays there, and the client-side redirect fights
 * the middleware.
 *
 * `/reset-password` is deliberately absent from both this list and
 * PROTECTED_PREFIXES: it must stay reachable without a session (that is the
 * point of the link), and bouncing a signed-in visitor away from it would break
 * the case where someone requests a reset while still logged in elsewhere.
 */
const AUTH_PAGES = ["/login", "/register"] as const;

/** Must stay in sync with AUTH_COOKIE_NAME in lib/auth/session.ts. */
const AUTH_COOKIE = "getvoxly_auth_token";

/** Header carrying the resolved tenant slug to the application. */
export const TENANT_SLUG_HEADER = "x-tenant-slug";

/**
 * Hosts that are the platform itself, not a tenant. `app` and `www` are real
 * hosts; the rest mirror `reserved_slugs` in the database so a reserved name
 * can never be mistaken for a tenant portal.
 */
const PLATFORM_HOSTS: ReadonlySet<string> = new Set(["app", "www", "api", "admin", "voxly"]);

const DEFAULT_AUTHENTICATED_TARGET = "/crm/contacts";

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/**
 * Extracts the tenant slug from the Host header, or null for platform hosts.
 *
 * The port is stripped so `localhost:3000` and `firma.getvoxly.ru:443` behave
 * the same. Anything with fewer than three labels (getvoxly.ru, localhost) is
 * the platform, not a tenant.
 */
export function resolveTenantSlug(host: string | null): string | null {
  if (host === null || host.length === 0) return null;

  const hostname = host.split(":")[0]?.toLowerCase() ?? "";
  if (hostname.length === 0) return null;

  // An IP address is never a tenant portal.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;

  const labels = hostname.split(".");
  if (labels.length < 3) return null;

  const candidate = labels[0];
  if (candidate === undefined || candidate.length === 0) return null;
  if (PLATFORM_HOSTS.has(candidate)) return null;

  return candidate;
}

/**
 * Redirect target after a successful sign-in, restricted to same-site paths.
 *
 * An absolute or protocol-relative value here would turn `?redirect=` into an
 * open redirect, so anything that is not a plain `/path` is discarded.
 */
function safeRedirectTarget(raw: string | null): string {
  if (raw === null || !raw.startsWith("/") || raw.startsWith("//")) {
    return DEFAULT_AUTHENTICATED_TARGET;
  }
  // Never bounce back to an auth page: that is the loop itself.
  if (isAuthPage(raw)) return DEFAULT_AUTHENTICATED_TARGET;
  return raw;
}

export function middleware(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const slug = resolveTenantSlug(request.headers.get("host"));

  // Presence only. Signature and expiry are verified by the backend on every
  // request; duplicating that here would mean shipping the JWT secret to the
  // edge for no added safety.
  // Check both access token and refresh token: if refresh token is present,
  // the user has an active persistent session (60 days) and client will silently refresh.
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  const refreshToken =
    request.cookies.get("getvoxly_refresh")?.value ||
    request.cookies.get("getvoxly_refresh_token")?.value;
  const sessionMarker = request.cookies.get("getvoxly_session")?.value;
  const hasActiveToken = token !== undefined && token.length > 0;
  const hasSession =
    hasActiveToken ||
    (refreshToken !== undefined && refreshToken.length > 0) ||
    sessionMarker === "active";

  // If visitor is on /login or /register:
  // Only redirect away if they have an ACTIVE access token AND they did not land here
  // with a ?redirect= parameter (which indicates an unauthenticated bounce from a protected route).
  // If redirect parameter is present or only a refresh token is present, we must NEVER
  // redirect away — otherwise an invalid/expired token creates an infinite 307 loop!
  if (isAuthPage(pathname)) {
    const redirectParam = searchParams.get("redirect");
    if (hasActiveToken && !redirectParam) {
      const target = safeRedirectTarget(redirectParam);
      return withTenantHeader(NextResponse.redirect(new URL(target, request.url)), slug);
    }
  }

  if (isProtected(pathname) && !hasSession) {
    const loginUrl = new URL("/login", request.url);
    // Preserved so the user lands where they intended after signing in.
    loginUrl.searchParams.set("redirect", pathname);
    return withTenantHeader(NextResponse.redirect(loginUrl), slug);
  }

  // On a tenant portal subdomain ({slug}.getvoxly.ru), root `/` redirects
  // to the main CRM deals board if signed in, or to /login if not.
  if (pathname === "/" && slug !== null) {
    const target = hasSession ? "/crm/deals" : "/login";
    return withTenantHeader(NextResponse.redirect(new URL(target, request.url)), slug);
  }

  // Superadmin lives on the platform host only: reaching it through a tenant
  // subdomain would imply the tenant owns the platform panel.
  if (pathname.startsWith("/superadmin") && slug !== null) {
    return withTenantHeader(NextResponse.redirect(new URL("/dashboard", request.url)), slug);
  }

  const requestHeaders = new Headers(request.headers);
  if (slug !== null) requestHeaders.set(TENANT_SLUG_HEADER, slug);
  else requestHeaders.delete(TENANT_SLUG_HEADER);

  return NextResponse.next({ request: { headers: requestHeaders } });
}

/** Mirrors the slug onto a redirect response for observability. */
function withTenantHeader(response: NextResponse, slug: string | null): NextResponse {
  if (slug !== null) response.headers.set(TENANT_SLUG_HEADER, slug);
  return response;
}

export const config = {
  /**
   * Runs on everything except static assets and Next internals.
   *
   * Broader than the previous protected-prefix-only matcher on purpose: the
   * subdomain must be resolved for public pages too (the landing and the
   * sign-in form both need to know which portal they belong to), and /login now
   * needs the signed-in check that breaks the loop.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
