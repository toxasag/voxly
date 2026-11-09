// ---------------------------------------------------------------------------
// Impersonation session storage & persistence.
//
// Allows a platform superadmin to browse a tenant workspace ("Impersonate")
// while maintaining a persistent banner with a "Return to Admin" button.
//
// Problem solved:
//  1. Cross-subdomain sharing: localStorage is per-origin, so entering an
//     account on app.getvoxly.ru and redirecting to {slug}.getvoxly.ru loses
//     localStorage. Mirroring into a domain-scoped cookie (.getvoxly.ru)
//     preserves the admin backup across all tenant subdomains.
//  2. Layout persistence: the banner remains active and visible on all routes
//     (/marketplace, /settings, /contacts, etc.) until the admin explicitly exits.
//  3. Safe return: redirecting from a client subdomain back to the platform
//     host (app.getvoxly.ru/admin/tenants) restores admin tokens seamlessly.
// ---------------------------------------------------------------------------

import { apiClient } from "@/lib/api/apiClient";
import { writeTokens } from "@/lib/auth/session";

export interface ImpersonationBackup {
  accessToken: string;
  refreshToken?: string;
  adminUserEmail?: string;
  adminUserName?: string;
  adminOriginHost?: string;
  impersonatedTenantSlug?: string;
  impersonatedTenantName?: string;
  impersonatedUserEmail?: string;
  enteredAt?: string;
}

export const BACKUP_STORAGE_KEY = "voxly_impersonator_backup";
export const BACKUP_COOKIE_NAME = "voxly_impersonator_backup";

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

/**
 * Returns parent domain attribute (e.g. `; Domain=.getvoxly.ru`) so the
 * impersonation state is shared across app.getvoxly.ru and all tenant subdomains.
 */
function cookieDomainAttribute(): string {
  if (!isBrowser()) return "";

  const host = window.location.hostname;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return "";

  const labels = host.split(".");
  if (labels.length < 2) return "";

  const parent = labels.slice(-2).join(".");
  return `; Domain=.${parent}`;
}

/**
 * Writes the impersonation backup into BOTH domain-scoped cookie and localStorage.
 */
export function writeImpersonationBackup(backup: ImpersonationBackup): void {
  if (!isBrowser()) return;

  const raw = JSON.stringify(backup);

  try {
    localStorage.setItem(BACKUP_STORAGE_KEY, raw);
  } catch {
    // Ignore localStorage write failures (e.g. private browsing restrictions)
  }

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const domain = cookieDomainAttribute();
  // 1-day validity for admin impersonation session across all subdomains
  document.cookie = `${BACKUP_COOKIE_NAME}=${encodeURIComponent(raw)}; Path=/; Max-Age=86400; SameSite=Lax${domain}${secure}`;

  // If scoped to parent domain, expire any conflicting host-only cookie
  if (domain) {
    const epoch = "; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
    document.cookie = `${BACKUP_COOKIE_NAME}=; Path=/; Max-Age=0${epoch}; SameSite=Lax${secure}`;
  }
}

/**
 * Reads the impersonation backup, checking the domain-scoped cookie first,
 * then falling back to localStorage.
 */
export function readImpersonationBackup(): ImpersonationBackup | null {
  if (!isBrowser()) return null;

  // 1. Try reading from cookie using split-trim (immune to whitespace irregularities)
  try {
    for (const part of document.cookie.split(";")) {
      const [rawName, ...rest] = part.trim().split("=");
      if (rawName === BACKUP_COOKIE_NAME) {
        const value = rest.join("=");
        if (value.length > 0) {
          const decoded = decodeURIComponent(value);
          const parsed = JSON.parse(decoded) as ImpersonationBackup;
          if (parsed && typeof parsed.accessToken === "string" && parsed.accessToken.length > 0) {
            return parsed;
          }
        }
      }
    }
  } catch {
    // Fall through to localStorage on cookie decode/parse failure
  }

  // 2. Fallback to localStorage
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ImpersonationBackup;
      if (parsed && typeof parsed.accessToken === "string" && parsed.accessToken.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Ignore invalid JSON in localStorage
  }

  return null;
}

/**
 * Clears the impersonation backup from both cookie and localStorage.
 */
export function clearImpersonationBackup(): void {
  if (!isBrowser()) return;

  try {
    localStorage.removeItem(BACKUP_STORAGE_KEY);
  } catch {
    // Ignore
  }

  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  // Clear domain-scoped cookie
  document.cookie = `${BACKUP_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${cookieDomainAttribute()}${secure}`;
  // Also clear host-only cookie just in case
  document.cookie = `${BACKUP_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

/**
 * Returns the absolute or relative URL to the platform admin tenants page.
 * If currently on a tenant subdomain (e.g. remtoua.getvoxly.ru), navigates
 * to https://app.getvoxly.ru/admin/tenants.
 */
export function getPlatformAdminUrl(token?: string): string {
  if (!isBrowser()) return "/admin/tenants";

  const { hostname, protocol, port } = window.location;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return "/admin/tenants";

  const labels = hostname.split(".");
  if (labels.length < 2) return "/admin/tenants";

  const parent = labels.length >= 3 ? labels.slice(1).join(".") : labels.join(".");
  const suffix = port ? `:${port}` : "";
  const backup = readImpersonationBackup();
  const platformPrefix = backup?.adminOriginHost?.split(".")[0]?.split(":")[0] || "voxly";
  const base = `${protocol}//${platformPrefix}.${parent}${suffix}/admin/tenants`;
  if (token) {
    return `${base}#restore_token=${encodeURIComponent(token)}`;
  }
  return base;
}

export interface RestoreSessionResult {
  success: boolean;
  accessToken?: string;
  targetUrl: string;
}

/**
 * Безопасно восстанавливает сессию владельца платформы:
 * 1. Отправляет запрос на бэкенд (/auth/exit-impersonation), чтобы сервер обновил
 *    долгоживущие HttpOnly cookies (getvoxly_refresh) на общем домене .getvoxly.ru.
 * 2. Записывает свежие токены в localStorage и cookie getvoxly_auth_token.
 * 3. Сохраняет свежие токены в бэкап (не уничтожает его раньше времени, чтобы при навигации
 *    на voxly.getvoxly.ru гейты гарантированно имели доступ к платформенным правам).
 * 4. Формирует целевой URL с handoff токена в hash fragment (#restore_token=...) для
 *    немедленного применения в origin storage домена voxly.getvoxly.ru.
 */
export async function restoreAdminSessionDetailed(): Promise<RestoreSessionResult> {
  if (!isBrowser()) return { success: false, targetUrl: "/admin/tenants" };

  const backup = readImpersonationBackup();
  const defaultUrl = getPlatformAdminUrl();

  if (!backup?.accessToken && !backup?.refreshToken) {
    return { success: false, targetUrl: defaultUrl };
  }

  // 1. Полноценная серверная ротация с выставлением HttpOnly cookie
  try {
    const res = await apiClient.post<{
      access_token?: string;
      refresh_token?: string;
      accessToken?: string;
      refreshToken?: string;
    }>("/auth/exit-impersonation", {
      admin_refresh_token: backup.refreshToken || undefined,
      admin_access_token: backup.accessToken || undefined,
    });

    const newAccessToken = res.data?.access_token ?? res.data?.accessToken;
    const newRefreshToken = res.data?.refresh_token ?? res.data?.refreshToken;

    if (newAccessToken && newRefreshToken) {
      writeTokens({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });

      // Обновляем бэкап свежими токенами администратора (очистится уже на voxly.getvoxly.ru)
      writeImpersonationBackup({
        ...backup,
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      });

      const targetUrl = getPlatformAdminUrl(newAccessToken);
      return { success: true, accessToken: newAccessToken, targetUrl };
    }
  } catch (err) {
    console.warn("Серверный выход из имперсонации не удался, пробуем локальный бэкап:", err);
  }

  // 2. Локальный фоллбэк: восстанавливаем токены из бэкапа
  if (backup.accessToken) {
    try {
      writeTokens({
        accessToken: backup.accessToken,
        refreshToken: backup.refreshToken || backup.accessToken,
      });
      const targetUrl = getPlatformAdminUrl(backup.accessToken);
      return { success: true, accessToken: backup.accessToken, targetUrl };
    } catch (err) {
      console.error("Ошибка локального восстановления сессии администратора:", err);
    }
  }

  return { success: false, targetUrl: defaultUrl };
}

export async function restoreAdminSession(): Promise<boolean> {
  const result = await restoreAdminSessionDetailed();
  return result.success;
}
