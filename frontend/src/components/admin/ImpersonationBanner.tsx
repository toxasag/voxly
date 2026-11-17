"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { LogOut, ShieldAlert, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth/use-auth";
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
  const [backup, setBackup] = useState<ImpersonationBackup | null>(null);
  const [isExiting, setIsExiting] = useState(false);

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

  // Определяем, находится ли пользователь в своем основном кабинете платформы (Voxly Platform),
  // когда сессия не является имперсонированной (impersonator === null)
  const isPlatformAdminWorkspace =
    !impersonator &&
    user?.platform_role === "platform_owner" &&
    (tenant?.slug === "voxly" || tenant?.tenantName?.toLowerCase().includes("platform"));

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
      if (
        backup.impersonatedTenantSlug &&
        tenant?.slug &&
        tenant.slug !== backup.impersonatedTenantSlug
      ) {
        clearImpersonationBackup();
        setBackup(null);
      }
    }
  }, [impersonator, isPlatformAdminWorkspace, isPartnerOwnWorkspace, backup, tenant?.slug]);

  // Если в своем собственном кабинете и не в режиме имперсонации — скрываем
  if (isPlatformAdminWorkspace || isPartnerOwnWorkspace) {
    return null;
  }

  // Если ни серверный флаг impersonator, ни локальный бэкап не найдены — не показываем
  if (!impersonator && !backup) {
    return null;
  }

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
      if (res.success && res.targetUrl) {
        window.location.href = res.targetUrl;
        return;
      }
      window.location.href = getPlatformAdminUrl(undefined, backup);
    } catch (err) {
      console.error("Ошибка возврата в сессию администратора/партнера:", err);
      window.location.href = getPlatformAdminUrl(undefined, backup);
    }
  };

  const isPartner = Boolean(
    impersonator?.is_partner ||
      (backup?.isPartner && !backup?.isPlatformOwner),
  );

  const returnLabel = isExiting
    ? "Возвращение..."
    : "Вернуться в главный кабинет";

  const adminDisplayName =
    impersonator?.name ||
    impersonator?.email ||
    backup?.adminUserName ||
    backup?.adminUserEmail ||
    "";

  const clientTenantName =
    tenant?.tenantName ||
    backup?.impersonatedTenantName ||
    tenant?.slug ||
    backup?.impersonatedTenantSlug ||
    "клиента";

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
          Вы находитесь в кабинете клиента:{" "}
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
