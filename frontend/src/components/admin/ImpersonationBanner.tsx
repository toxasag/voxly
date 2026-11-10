"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { LogOut, ShieldAlert } from "lucide-react";
import { writeTokens } from "@/lib/auth/session";
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
  const { user, tenant } = useAuth();
  const [backup, setBackup] = useState<ImpersonationBackup | null>(null);
  const [isExiting, setIsExiting] = useState(false);

  // Синхронизируем состояние при монтировании и при каждом переходе по маршрутам Next.js
  const syncBackup = useCallback(() => {
    const active = readImpersonationBackup();
    setBackup(active);
  }, []);

  useEffect(() => {
    syncBackup();

    // Слушаем storage events на случай смены сессии в соседних вкладках
    const handleStorageChange = () => {
      syncBackup();
    };

    window.addEventListener("storage", handleStorageChange);
    return () => {
      window.removeEventListener("storage", handleStorageChange);
    };
  }, [pathname, syncBackup]);

  // Если пользователь находится в своём основном рабочем пространстве администратора платформы (Voxly Platform),
  // или в личном кабинете партнера (где email совпадает с исходным adminUserEmail),
  // он НЕ находится в режиме имперсонации клиента. Плашка категорически не должна отображаться.
  const isPlatformAdminWorkspace =
    user?.platform_role === "platform_owner" &&
    (tenant?.slug === "voxly" || !tenant?.slug || tenant?.tenantName?.toLowerCase().includes("platform"));

  const isPartnerOwnWorkspace = Boolean(
    backup?.isPartner &&
      backup?.adminUserEmail &&
      user?.email?.toLowerCase() === backup.adminUserEmail.toLowerCase() &&
      (!backup.impersonatedTenantSlug || tenant?.slug !== backup.impersonatedTenantSlug),
  );

  // Если админ или партнер вернулся в свой кабинет, сбрасываем оставшийся бэкап
  useEffect(() => {
    if ((isPlatformAdminWorkspace || isPartnerOwnWorkspace) && backup) {
      clearImpersonationBackup();
      setBackup(null);
    }
  }, [isPlatformAdminWorkspace, isPartnerOwnWorkspace, backup]);

  if (isPlatformAdminWorkspace || isPartnerOwnWorkspace || !backup) return null;

  // Если текущий авторизованный пользователь — сам суперадминистратор/партнер вне клиента
  if (
    backup.adminUserEmail &&
    user?.email?.toLowerCase() === backup.adminUserEmail.toLowerCase() &&
    (!backup.impersonatedTenantSlug || tenant?.slug !== backup.impersonatedTenantSlug)
  ) {
    return null;
  }

  const handleReturnToAdmin = async () => {
    if (isExiting) return;
    setIsExiting(true);

    try {
      const res = await restoreAdminSessionDetailed();
      if (res.success && res.targetUrl) {
        window.location.href = res.targetUrl;
        return;
      }
      window.location.href = getPlatformAdminUrl();
    } catch (err) {
      console.error("Ошибка возврата в сессию администратора/партнера", err);
      window.location.href = getPlatformAdminUrl();
    }
  };

  const returnLabel = isExiting
    ? "Возвращение..."
    : backup.isPartner && !backup.isPlatformOwner
    ? "Вернуться в кабинет партнёра"
    : "Вернуться в панель администратора";

  const headerRoleText =
    backup.isPartner && !backup.isPlatformOwner
      ? "Режим просмотра клиента:"
      : "Режим просмотра арендатора:";

  return (
    <aside
      role="alert"
      aria-label="Режим просмотра аккаунта клиента"
      className="sticky top-0 z-50 flex w-full flex-wrap items-center justify-between gap-3 border-b border-[#fef08a] bg-[#fefce8] px-4 py-2 text-[#854d0e] shadow-2xs transition-all"
    >
      <div className="flex items-center gap-2 text-xs">
        <ShieldAlert className="h-4 w-4 shrink-0 text-[#854d0e]" />
        <span className="font-semibold">{headerRoleText}</span>
        <span className="font-medium text-[#713f12]">
          вы вошли от имени{" "}
          <strong className="underline underline-offset-2">
            {backup.impersonatedTenantName || "компании"}
          </strong>
          {backup.impersonatedUserEmail ? ` (${backup.impersonatedUserEmail})` : ""}
        </span>
        <span className="hidden text-[11px] opacity-80 lg:inline">
          — действия в CRM применяются от лица этого клиента
        </span>
      </div>

      <button
        type="button"
        onClick={handleReturnToAdmin}
        disabled={isExiting}
        className="flex items-center gap-1.5 rounded-[8px] bg-[#111111] px-3 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#333333] focus:outline-none focus:ring-2 focus:ring-[#111111]/30 disabled:opacity-50 cursor-pointer"
      >
        <LogOut className="h-3.5 w-3.5" />
        <span>{returnLabel}</span>
      </button>
    </aside>
  );
}
