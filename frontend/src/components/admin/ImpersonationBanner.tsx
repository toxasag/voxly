"use client";

import { useEffect, useState, useCallback } from "react";
import { usePathname } from "next/navigation";
import { LogOut, ShieldAlert } from "lucide-react";
import { writeTokens } from "@/lib/auth/session";
import {
  readImpersonationBackup,
  clearImpersonationBackup,
  getPlatformAdminUrl,
  type ImpersonationBackup,
} from "@/lib/auth/impersonation";

export function ImpersonationBanner() {
  const pathname = usePathname();
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

  const handleReturnToAdmin = () => {
    if (!backup || isExiting) return;
    setIsExiting(true);

    try {
      // 1. Восстанавливаем токены администратора
      writeTokens({
        accessToken: backup.accessToken,
        refreshToken: backup.refreshToken,
      });

      // 2. Очищаем бэкап имперсонации из cookie и localStorage
      clearImpersonationBackup();

      // 3. Безопасно переходим в панель администратора на хосте платформы
      window.location.href = getPlatformAdminUrl();
    } catch (err) {
      console.error("Ошибка возврата в сессию администратора", err);
      setIsExiting(false);
    }
  };

  if (!backup) return null;

  return (
    <aside
      role="alert"
      aria-label="Режим просмотра аккаунта клиента"
      className="sticky top-0 z-50 flex w-full flex-wrap items-center justify-between gap-3 border-b border-amber-300 bg-amber-400 px-4 py-2 text-slate-950 shadow-xs transition-all"
    >
      <div className="flex items-center gap-2 text-xs">
        <ShieldAlert className="h-4 w-4 shrink-0 text-slate-950" />
        <span className="font-semibold">Режим просмотра арендатора:</span>
        <span className="font-medium">
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
        className="flex items-center gap-1.5 rounded-[6px] bg-slate-950 px-3 py-1 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-950/40 disabled:opacity-50"
      >
        <LogOut className="h-3.5 w-3.5" />
        <span>{isExiting ? "Возвращение..." : "Вернуться в панель администратора"}</span>
      </button>
    </aside>
  );
}
