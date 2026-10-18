"use client";

import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth/use-auth";
import { shouldRedirectToOwnPortal, tenantPortalUrl } from "@/lib/auth/tenant-host";

/**
 * Keeps the portal in the address bar consistent with the signed-in tenant.
 *
 * Two cases are handled:
 *   * viewing someone else's subdomain — the user is moved to their own portal;
 *   * viewing a platform host while signed in to a tenant — also moved, so the
 *     URL reflects the workspace being used.
 *
 * This is a navigation affordance, not an access control. The backend scopes
 * every query by the tenant inside the token and RLS enforces it in the
 * database, so landing on a foreign subdomain cannot expose another tenant's
 * data — it would simply render that user's own, which is confusing rather than
 * unsafe.
 *
 * Решение о переходе принимает `shouldRedirectToOwnPortal`, а не сравнение
 * слагов здесь. Прежнее условие сравнивало `currentTenantSlug() !== tenantSlug` и
 * на localhost всегда давало истину: `currentTenantSlug()` там `null` по
 * построению (однометочный хост не может быть портулом), а `tenantPortalUrl`
 * возвращал относительный путь текущей страницы. Итог — присваивание
 * `window.location.href` тем же адресом и бесконечная перезагрузка;
 * восстановление сессии повторялось на каждой итерации, отсюда и наблюдавшийся
 * «цикл /auth/refresh» (`M0.13.15`). Ошибка была в навигации, а не в сессии:
 * каждый refresh отвечал 200.
 */
export function TenantPortalGuard({ children }: { children: React.ReactNode }) {
  const { tenant, isAuthenticated, isLoading } = useAuth();

  const tenantSlug = tenant?.slug ?? "";
  // Only redirect once the session is known, otherwise the first render would
  // bounce every visitor before the token has been restored.
  const mismatched =
    !isLoading && isAuthenticated && shouldRedirectToOwnPortal(tenantSlug);

  useEffect(() => {
    if (!mismatched) return;
    window.location.href = tenantPortalUrl(tenantSlug, window.location.pathname);
  }, [mismatched, tenantSlug]);

  if (mismatched) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <div className="flex items-center gap-3 text-sm text-slate-400">
          <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
          Переходим на портал вашей компании...
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
