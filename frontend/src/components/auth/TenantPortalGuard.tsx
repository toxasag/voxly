"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/use-auth";
import { currentTenantSlug, shouldRedirectToOwnPortal, tenantPortalUrl } from "@/lib/auth/tenant-host";
import { readImpersonationBackup, writeImpersonationBackup } from "@/lib/auth/impersonation";
import { readAccessToken, readRefreshToken } from "@/lib/auth/session";
import { apiClient } from "@/lib/api/apiClient";
import type { AuthTokensDTO } from "@/lib/auth/use-auth";

/**
 * Keeps the portal in the address bar consistent with the signed-in tenant.
 *
 * Rules:
 *  - Regular tenant members viewing someone else's subdomain are redirected to their own portal.
 *  - Platform owners (superadmin) are never redirected away: if they open a tenant portal,
 *    they automatically enter impersonation view for that tenant so they can inspect data.
 *  - Platform administration routes (/admin/*, /superadmin/*) belong to the platform and
 *    are never bounced to a tenant subdomain.
 *  - Active impersonation sessions are preserved on the client subdomain.
 */
export function TenantPortalGuard({ children }: { children: React.ReactNode }) {
  const { user, tenant, isAuthenticated, isLoading } = useAuth();
  const [isAutoSwitching, setIsAutoSwitching] = useState(false);

  const tenantSlug = tenant?.slug ?? "";
  const hostSlug = currentTenantSlug();

  const isPlatformAdminRoute =
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/admin") ||
      window.location.pathname.startsWith("/superadmin"));

  const isPlatformOwner = user?.platform_role === "platform_owner";
  const isImpersonating = typeof window !== "undefined" && readImpersonationBackup() !== null;

  // Если суперадминистратор платформы целенаправленно открыл поддомен клиента (например, valera.getvoxly.ru/crm/deals),
  // не перенаправляем его назад на voxly.getvoxly.ru. Вместо этого автоматически переводим его в режим просмотра (impersonate)
  // арендатора, сохраняя исходную админскую сессию в бэкап.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !isPlatformOwner || isAutoSwitching) return;
    if (!hostSlug || hostSlug === "voxly" || hostSlug === tenantSlug) return;

    let cancelled = false;
    const enterTenantView = async () => {
      setIsAutoSwitching(true);
      try {
        const currentAccessToken = readAccessToken();
        const currentRefreshToken = readRefreshToken();

        if (currentAccessToken && currentRefreshToken && !readImpersonationBackup()) {
          writeImpersonationBackup({
            accessToken: currentAccessToken,
            refreshToken: currentRefreshToken,
            adminUserEmail: user?.email ?? "",
            adminUserName: user?.name ?? "",
            impersonatedTenantSlug: hostSlug,
            enteredAt: new Date().toISOString(),
          });
        }

        const res = await apiClient.post<AuthTokensDTO>(`/api/v1/admin/tenants/by-slug/${hostSlug}/impersonate`);
        if (!cancelled && res.data) {
          window.location.reload();
        }
      } catch (err) {
        console.error("Не удалось автоматически войти под арендатором", err);
        if (!cancelled) {
          setIsAutoSwitching(false);
        }
      }
    };

    void enterTenantView();

    return () => {
      cancelled = true;
    };
  }, [isLoading, isAuthenticated, isPlatformOwner, hostSlug, tenantSlug, user, isAutoSwitching]);

  const mismatched =
    !isLoading &&
    isAuthenticated &&
    !isPlatformAdminRoute &&
    !isPlatformOwner &&
    !isImpersonating &&
    shouldRedirectToOwnPortal(tenantSlug);

  useEffect(() => {
    if (!mismatched) return;
    window.location.href = tenantPortalUrl(tenantSlug, window.location.pathname);
  }, [mismatched, tenantSlug]);

  if (isAutoSwitching) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-3 text-sm text-[#666666]">
          <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
          Входим в пространство клиента «{hostSlug}»...
        </div>
      </div>
    );
  }

  if (mismatched) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="flex items-center gap-3 text-sm text-[#666666]">
          <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
          Переходим на портал вашей компании...
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
