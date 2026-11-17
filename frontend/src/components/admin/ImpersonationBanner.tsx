"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { LogOut, ShieldAlert, Loader2, Building2, ArrowUpRight } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/use-auth";
import { useWorkspaces, switchWorkspace } from "@/lib/api/use-workspaces";
import {
  readImpersonationBackup,
  clearImpersonationBackup,
  restoreAdminSessionDetailed,
  getPlatformAdminUrl,
  type ImpersonationBackup,
} from "@/lib/auth/impersonation";

export function ImpersonationBanner() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { user, tenant, impersonator } = useAuth();
  const { data: workspacesData } = useWorkspaces();
  const [backup, setBackup] = useState<ImpersonationBackup | null>(null);
  const [isExiting, setIsExiting] = useState(false);

  const parentWorkspace = useMemo(
    () => workspacesData?.find((ws) => ws.is_parent) ?? null,
    [workspacesData],
  );

  // Синхронизируем состояние бэкапа при монтировании и при каждом переходе по маршрутам Next.js
  const syncBackup = useCallback(() => {
    const active = readImpersonationBackup();
    setBackup(active);
  }, []);

  useEffect(() => {
    syncBackup();

    const handleStorageChange = () => {
      syncBackup();
    };

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [pathname, syncBackup]);

  const isPlatformOwner = user?.platform_role === "platform_owner";
  const isPartner = Boolean(
    impersonator?.is_partner ||
      user?.is_partner ||
      tenant?.is_partner ||
      user?.role === "partner" ||
      (backup?.isPartner && !backup?.isPlatformOwner),
  );

  const isPrivilegedUser =
    isPlatformOwner ||
    isPartner ||
    user?.role === "owner" ||
    user?.role === "admin" ||
    user?.role === "manager" ||
    Boolean(impersonator) ||
    Boolean(backup);

  // Определяем, находится ли пользователь в своем основном кабинете платформы (Voxly Platform),
  // когда сессия не является имперсонированной (impersonator === null)
  const isPlatformAdminWorkspace =
    !impersonator &&
    user?.platform_role === "platform_owner";

  // Определяем, находится ли партнер в своем личном кабинете партнера
  const isPartnerOwnWorkspace =
    !impersonator &&
    Boolean(
      backup?.isPartner &&
        backup?.adminUserEmail &&
        user?.email?.toLowerCase() === backup.adminUserEmail.toLowerCase() &&
        (!backup.impersonatedTenantSlug || tenant?.slug !== backup.impersonatedTenantSlug),
    );

  // Сбрасываем бэкап ТОЛЬКО тогда, когда пользователь действительно вернулся в свой исходный кабинет
  // и серверный токен подтверждает, что режим имперсонации завершен (!impersonator)
  useEffect(() => {
    if (!impersonator && (isPlatformAdminWorkspace || isPartnerOwnWorkspace) && backup) {
      clearImpersonationBackup();
      setBackup(null);
    }
  }, [impersonator, isPlatformAdminWorkspace, isPartnerOwnWorkspace, backup]);

  // Если в своем собственном кабинете и не в режиме имперсонации — скрываем
  if (isPlatformAdminWorkspace || isPartnerOwnWorkspace) {
    return null;
  }

  const clientTenantName =
    tenant?.tenantName ||
    backup?.impersonatedTenantName ||
    tenant?.slug ||
    backup?.impersonatedTenantSlug ||
    "клиента";

  const handleReturnToAdmin = async () => {
    if (isExiting) return;
    setIsExiting(true);

    // Сброс и полная очистка клиентского кэша TanStack Query без риска утечки данных между клиентами
    try {
      queryClient.clear();
    } catch {
      // Игнорируем ошибки кэша при размонтировании
    }

    try {
      const res = await restoreAdminSessionDetailed();
      const target = res.targetUrl || getPlatformAdminUrl(undefined, backup);
      try {
        const currentUrl = new URL(window.location.href);
        const destUrl = new URL(target, window.location.origin);
        if (currentUrl.origin !== destUrl.origin || currentUrl.pathname !== destUrl.pathname) {
          window.location.href = target;
          return;
        }
        if (destUrl.hash) {
          window.location.hash = destUrl.hash;
        }
        window.location.reload();
      } catch {
        window.location.href = target;
      }
    } catch (err) {
      console.error("Ошибка возврата в сессию администратора/партнера:", err);
      const target = getPlatformAdminUrl(undefined, backup);
      window.location.href = target;
    }
  };

  const handleReturnToParentWorkspace = async () => {
    if (isExiting || !parentWorkspace) return;
    setIsExiting(true);
    try {
      await switchWorkspace(
        parentWorkspace.slug,
        tenant?.slug || "",
        user?.email,
        user?.name,
        isPartner,
        isPlatformOwner,
        true,
      );
    } catch (err) {
      console.error("Ошибка перехода в кабинет партнёра:", err);
      setIsExiting(false);
    }
  };

  // Если не в активной имперсонации, но находимся в дочернем клиентском портале под управлением партнера:
  if (!impersonator && !backup) {
    if (parentWorkspace && isPrivilegedUser && !tenant?.is_partner) {
      return (
        <aside
          role="region"
          aria-label="Клиентский портал партнера"
          data-testid="partner-client-portal-banner"
          className="sticky top-0 z-50 flex w-full flex-wrap items-center justify-between gap-3 border-b border-[#4a38f5]/20 bg-[#4a38f5]/[0.05] px-4 py-2 text-[#4a38f5] shadow-2xs transition-all"
        >
          <div className="flex items-center gap-2 text-xs">
            <Building2 className="h-4 w-4 shrink-0 text-[#4a38f5]" />
            <span className="font-semibold text-[#111111]">
              Клиентский портал:{" "}
              <strong className="underline underline-offset-2 text-[#4a38f5]">
                {clientTenantName}
              </strong>
            </span>
            <span className="hidden text-[11px] text-[#666666] md:inline">
              · Управляющий партнёр: <span className="font-medium text-[#111111]">{parentWorkspace.name}</span>
            </span>
          </div>

          <button
            type="button"
            data-testid="return-to-partner-banner-btn"
            onClick={handleReturnToParentWorkspace}
            disabled={isExiting}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#3d2ee0] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/30 disabled:opacity-50 cursor-pointer"
          >
            {isExiting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Building2 className="h-3.5 w-3.5" />
            )}
            <span>Вернуться в кабинет партнёра</span>
            <ArrowUpRight className="h-3 w-3 opacity-80" />
          </button>
        </aside>
      );
    }
    return null;
  }

  const returnLabel = isExiting
    ? "Возвращение..."
    : isPartner
      ? "Вернуться в кабинет партнёра"
      : "Вернуться в главный кабинет";

  const adminDisplayName =
    impersonator?.name ||
    impersonator?.email ||
    backup?.adminUserName ||
    backup?.adminUserEmail ||
    "";

  return (
    <aside
      role="alert"
      aria-label="Режим просмотра аккаунта клиента"
      data-testid="impersonation-banner"
      className="sticky top-0 z-50 flex w-full flex-wrap items-center justify-between gap-3 border-b border-[#fef08a] bg-[#fefce8] px-4 py-2 text-[#854d0e] shadow-2xs transition-all"
    >
      <div className="flex items-center gap-2 text-xs">
        <ShieldAlert className="h-4 w-4 shrink-0 text-[#854d0e]" />
        <span className="font-semibold text-[#854d0e]">
          {isPartner
            ? `Режим партнёра: вы просматриваете клиентский портал: `
            : `Вы находитесь в кабинете клиента: `}
          <strong className="underline underline-offset-2 text-[#713f12]">
            {clientTenantName}
          </strong>
          .
        </span>
        <span className="font-medium text-[#713f12]">
          Все действия логируются.
        </span>
        {adminDisplayName && (
          <span className="hidden text-[11px] opacity-75 xl:inline">
            (Оператор: {adminDisplayName})
          </span>
        )}
      </div>

      <button
        type="button"
        data-testid="revert-impersonation-btn"
        onClick={handleReturnToAdmin}
        disabled={isExiting}
        className="flex items-center gap-1.5 rounded-[8px] bg-[#111111] px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#333333] focus:outline-none focus:ring-2 focus:ring-[#111111]/30 disabled:opacity-50 cursor-pointer"
      >
        {isExiting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <LogOut className="h-3.5 w-3.5" />
        )}
        <span>{returnLabel}</span>
      </button>
    </aside>
  );
}
