"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { ShieldAlert, Loader2, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/use-auth";
import { readImpersonationBackup, restoreAdminSession, getPlatformAdminUrl } from "@/lib/auth/impersonation";

interface PlatformOwnerGuardProps {
  children: ReactNode;
}

/**
 * Гейт платформенной панели: ждёт восстановления сессии, затем пускает только
 * держателей глобальной роли platform_owner. Тенантный owner не проходит —
 * это разные уровни доступа (см. backend requirePlatformOwner).
 *
 * Если пользователь зашел на страницу в режиме клиентской имперсонации,
 * автоматически восстанавливает исходную платформенную сессию.
 */
export function PlatformOwnerGuard({ children }: PlatformOwnerGuardProps) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);

  const backup = typeof window !== "undefined" ? readImpersonationBackup() : null;
  const isPlatformOwner = user?.platform_role === "platform_owner";

  useEffect(() => {
    if (isLoading || isPlatformOwner || isRestoring || restoreFailed) return;

    if (backup) {
      setIsRestoring(true);
      void restoreAdminSession().then((success) => {
        if (success) {
          window.location.reload();
        } else {
          setRestoreFailed(true);
          setIsRestoring(false);
        }
      });
    }
  }, [isLoading, isPlatformOwner, backup, isRestoring, restoreFailed]);

  if (isLoading || isRestoring) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb]">
        <div className="flex items-center gap-3 text-[#666666]">
          <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
          <span className="text-sm">
            {isRestoring ? "Восстановление сессии администратора платформы…" : "Проверка прав доступа…"}
          </span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || user === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-6">
        <div className="rounded-xl border border-[#e5e5e5] bg-white p-8 text-center max-w-md shadow-2xs">
          <ShieldAlert className="mx-auto h-10 w-10 text-[#4a38f5]" />
          <h1 className="mt-4 text-lg font-semibold text-[#111111]">Требуется вход</h1>
          <p className="mt-2 text-sm text-[#666666]">
            Платформенная панель доступна только после авторизации.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-flex items-center rounded-lg bg-[#4a38f5] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#3b2be0] focus-visible:ring-2 focus-visible:ring-[#4a38f5]/50 active:scale-[0.97]"
          >
            Войти
          </Link>
        </div>
      </div>
    );
  }

  if (user.platform_role !== "platform_owner") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-6">
        <div className="rounded-xl border border-rose-200 bg-white p-8 text-center max-w-md shadow-2xs">
          <ShieldAlert className="mx-auto h-10 w-10 text-rose-600" />
          <h1 className="mt-4 text-lg font-semibold text-[#111111]">Доступ запрещён</h1>
          <p className="mt-2 text-sm text-[#666666]">
            Панель платформы доступна только владельцу GETVOXLY. Ваша роль не включает
            платформенные права.
          </p>
          {backup ? (
            <button
              type="button"
              onClick={() => {
                setIsRestoring(true);
                void restoreAdminSession().then((success) => {
                  if (success) window.location.reload();
                  else window.location.href = getPlatformAdminUrl();
                });
              }}
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#4a38f5] px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 hover:bg-[#3b2be0] focus-visible:ring-2 focus-visible:ring-[#4a38f5]/50 active:scale-[0.97]"
            >
              <ArrowLeft className="h-4 w-4" />
              Вернуться в сессию администратора
            </button>
          ) : (
            <Link
              href="/dashboard"
              className="mt-6 inline-flex items-center rounded-lg border border-[#e5e5e5] bg-white px-5 py-2.5 text-sm font-medium text-[#111111] transition-all duration-200 hover:bg-[#fafafa] focus-visible:ring-2 focus-visible:ring-[#4a38f5]/20 active:scale-[0.97]"
            >
              Вернуться в CRM
            </Link>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
