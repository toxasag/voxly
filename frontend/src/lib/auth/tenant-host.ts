// ---------------------------------------------------------------------------
// Tenant host resolution (client side).
//
// Mirrors `resolveTenantSlug` in middleware.ts, which does the same job at the
// edge. Kept as a separate module rather than imported from the middleware:
// importing it would pull the Next server runtime into the client bundle.
// ---------------------------------------------------------------------------

/** Hosts that belong to the platform rather than to a tenant. */
const PLATFORM_HOSTS: ReadonlySet<string> = new Set(["app", "www", "api", "admin", "voxly"]);

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/** Slug of the portal currently being viewed, or null on a platform host. */
export function currentTenantSlug(): string | null {
  if (!isBrowser()) return null;

  const hostname = window.location.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;

  const labels = hostname.split(".");
  if (labels.length < 3) return null;

  const candidate = labels[0];
  if (candidate === undefined || candidate.length === 0) return null;
  if (PLATFORM_HOSTS.has(candidate)) return null;

  return candidate;
}

/**
 * Можно ли на текущем хосте построить адрес персонального портала.
 *
 * `false` для localhost, IP-адреса и любого однометочного хоста: `slug.localhost`
 * не разрешается в DNS (проверено — `ENOTFOUND`), поэтому per-tenant хостов там
 * не существует.
 *
 * Введено потому, что `tenantPortalUrl` в таких условиях возвращает
 * относительный путь, то есть адрес **той же самой страницы**. `TenantPortalGuard`
 * трактовал это как переход и присваивал `window.location.href`, получая полную
 * перезагрузку с тем же результатом — бесконечный цикл. Наблюдалось локально:
 * `/crm/contacts` перезагружалась по кругу, а `/auth/refresh` вызывался на каждой
 * итерации (все с кодом 200 — то есть сессия была в порядке, ломала именно
 * навигация). Это и есть настоящая причина `M0.13.15`; cookie, на которую
 * указывала прежняя формулировка, ставится на localhost корректно — проверено в
 * браузере, `Domain` для однометочного хоста опускается.
 */
export function tenantHostsSupported(): boolean {
  if (!isBrowser()) return false;

  const hostname = window.location.hostname.toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;

  return hostname.split(".").length >= 2;
}

/**
 * Absolute URL of a tenant's portal.
 *
 * Returns a relative path when a per-tenant host cannot be built — on
 * localhost, on an IP address, or for a two-label host — because
 * `slug.localhost` does not resolve and sending the user there would strand
 * them. Local development therefore stays on one origin.
 */
export function tenantPortalUrl(slug: string, path = "/dashboard"): string {
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;

  if (!isBrowser() || slug.length === 0) return normalisedPath;

  const { hostname, protocol, port } = window.location;

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return normalisedPath;

  const labels = hostname.split(".");
  if (labels.length < 2) return normalisedPath;

  // Replace the leading label on a tenant/platform host, or prepend on the apex.
  const parent = labels.length >= 3 ? labels.slice(1).join(".") : hostname;
  const suffix = port.length > 0 ? `:${port}` : "";

  return `${protocol}//${slug}.${parent}${suffix}${normalisedPath}`;
}

/**
 * True when the signed-in tenant does not match the portal being viewed, i.e.
 * the user opened someone else's subdomain.
 *
 * Advisory only: the backend scopes every query by the token's tenant, so a
 * mismatch cannot leak data. This exists to redirect the user somewhere useful
 * rather than showing an empty portal.
 */
export function isForeignPortal(tenantSlug: string | null): boolean {
  const host = currentTenantSlug();
  if (host === null || tenantSlug === null || tenantSlug.length === 0) return false;
  return host !== tenantSlug;
}

/**
 * Нужно ли уводить пользователя на его собственный портал.
 *
 * Единственный источник этого решения — прежде условие было записано в
 * `TenantPortalGuard` и не учитывало, что на localhost перенаправлять некуда.
 *
 * Возвращает `false`, когда per-tenant хостов на этом окружении не бывает: иначе
 * «переход» ведёт на текущий же адрес и превращается в цикл перезагрузок.
 */
export function shouldRedirectToOwnPortal(tenantSlug: string | null): boolean {
  if (tenantSlug === null || tenantSlug.length === 0) return false;
  if (!tenantHostsSupported()) return false;
  return currentTenantSlug() !== tenantSlug;
}
