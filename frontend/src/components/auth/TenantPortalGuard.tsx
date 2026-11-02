"use client";

import { useEffect, useState, useRef } from "react";
import { AlertCircle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/lib/auth/use-auth";
import { currentTenantSlug, shouldRedirectToOwnPortal, tenantPortalUrl } from "@/lib/auth/tenant-host";
import { readImpersonationBackup, writeImpersonationBackup } from "@/lib/auth/impersonation";
import { readAccessToken, readRefreshToken, writeTokens } from "@/lib/auth/session";
import { apiClient } from "@/lib/api/apiClient";
import type { AuthTokensDTO } from "@/lib/auth/use-auth";

/**
 * Keeps the portal in the address bar consistent with the signed-in tenant.
 *
 * Rules:
 *  - Regular tenant members viewing someone else's subdomain are redirected to their own portal.
 *  - Platform owners & partners are never redirected away: if they open a tenant portal,
 *    they automatically enter impersonation view for that tenant so they can inspect data.
 *  - Platform administration routes (/admin/*, /superadmin/*) belong to the platform and
 *    are never bounced to a tenant subdomain.
 *  - Active impersonation sessions are preserved on the client subdomain.
 */
export function TenantPortalGuard({ children }: { children: React.ReactNode }) {
  const { user, tenant, isAuthenticated, isLoading } = useAuth();
  const [isAutoSwitching, setIsAutoSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const hasTriggeredRef = useRef(false);

  const tenantSlug = tenant?.slug ?? "";
  const hostSlug = currentTenantSlug();

  const isPlatformAdminRoute =
    typeof window !== "undefined" &&
    (window.location.pathname.startsWith("/admin") ||
      window.location.pathname.startsWith("/superadmin"));

  const isPlatformOwner = user?.platform_role === "platform_owner";
  const canAutoSwitch = isPlatformOwner || user?.role === "partner";

  const isImpersonating = typeof window !== "undefined" && readImpersonationBackup() !== null;

  // Если суперадминистратор или партнер целенаправленно открыл поддомен клиента (например, mpro.getvoxly.ru/crm/contacts),
  // не перенаправляем его назад на voxly.getvoxly.ru. Вместо этого автоматически переводим его в режим просмотра (impersonate)
  // арендатора, сохраняя исходную админскую сессию в бэкап и записывая новые JWT-токены в хранилище.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !canAutoSwitch) return;
    if (!hostSlug || hostSlug === "voxly" || hostSlug === tenantSlug) return;
    if (hasTriggeredRef.current) return;

    hasTriggeredRef.current = true;
    setIsAutoSwitching(true);
    setSwitchError(null);

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      abortController.abort();
      setSwitchError("Превышено время ожидания ответа сервера при переключении пространства");
      setIsAutoSwitching(false);
    }, 12000);

    const enterTenantView = async () => {
      try {
        const currentAccessToken = readAccessToken();
        const currentRefreshToken = readRefreshToken();

        if (currentAccessToken && !readImpersonationBackup()) {
          writeImpersonationBackup({
            accessToken: currentAccessToken,
            refreshToken: currentRefreshToken || currentAccessToken,
            adminUserEmail: user?.email ?? "",
            adminUserName: user?.name ?? "",
            impersonatedTenantSlug: hostSlug,
            enteredAt: new Date().toISOString(),
          });
        }

        const res = await apiClient.post<AuthTokensDTO>(
          `/api/v1/admin/tenants/by-slug/${hostSlug}/impersonate`,
          undefined,
          { signal: abortController.signal },
        );

        clearTimeout(timeoutId);

        if (res.data) {
          const accessToken = res.data.access_token;
          const refreshToken = res.data.refresh_token;

          if (accessToken && refreshToken) {
            writeTokens({ accessToken, refreshToken });
          }

          // Перезагружаем страницу с новыми токенами клиента
          window.location.reload();
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.error("Не удалось автоматически войти в пространство арендатора:", err);
        const msg =
          err instanceof Error && err.name === "AbortError"
            ? "Превышено время ожидания ответа сервера при переключении пространства"
            : "Не удалось войти в клиентское пространство. Возможно, у вас нет прав на этот портал.";
        setSwitchError(msg);
        setIsAutoSwitching(false);
      }
    };

    void enterTenantView();

    return () => {
      clearTimeout(timeoutId);
    };
  }, [
    isLoading,
    isAuthenticated,
    canAutoSwitch,
    hostSlug,
    tenantSlug,
    user?.email,
    user?.name,
  ]);

  const mismatched =
    !isLoading &&
    isAuthenticated &&
    !isPlatformAdminRoute &&
    !canAutoSwitch &&
    !isImpersonating &&
    !isAutoSwitching &&
    !switchError &&
    shouldRedirectToOwnPortal(tenantSlug);

  useEffect(() => {
    if (!mismatched) return;
    window.location.href = tenantPortalUrl(tenantSlug, window.location.pathname);
  }, [mismatched, tenantSlug]);

  if (switchError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-4">
        <div className="w-full max-w-md rounded-[16px] border border-[#e5e5e5] bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3 text-rose-600 mb-3">
            <AlertCircle className="h-6 w-6 shrink-0" />
            <h2 className="text-[15px] font-semibold text-[#111111]">
              Не удалось войти в пространство «{hostSlug}»
            </h2>
          </div>
          <p className="text-[13px] text-[#666666] mb-6">
            {switchError}
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                window.location.href = tenantPortalUrl(tenantSlug || "voxly", "/crm/contacts");
              }}
              className="flex w-full sm:w-auto items-center justify-center gap-2 h-9 rounded-[8px] bg-[#4a38f5] px-4 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]"
            >
              <ArrowLeft className="h-4 w-4" />
              Вернуться на платформу
            </button>
            <button
              type="button"
              onClick={() => {
                hasTriggeredRef.current = false;
                setSwitchError(null);
                setIsAutoSwitching(false);
              }}
              className="flex w-full sm:w-auto items-center justify-center gap-2 h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-4 text-[13px] font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Повторить
            </button>
          </div>
        </div>
      </div>
    );
  }

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
