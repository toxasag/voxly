"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldOff, ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/use-auth";
import { readImpersonationBackup, restoreAdminSession, getPlatformAdminUrl } from "@/lib/auth/impersonation";

/**
 * Гейт разделов «Управление платформой».
 *
 * Проверяет глобальную роль `platform_role`, а не тенантную `owner`: иначе
 * владелец любого арендатора получил бы доступ к данным всей платформы.
 *
 * Если пользователь вошел на страницу администрирования в режиме имперсонации клиента
 * (например, по ссылке, вкладке или кнопке "Назад"), гейт автоматически восстанавливает
 * сессию владельца платформы из безопасного бэкапа и обновляет страницу без блокировок.
 */
export function PlatformOwnerGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
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
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
        {isRestoring && (
          <p className="text-xs text-[#666666]">
            Восстановление сессии администратора платформы...
          </p>
        )}
      </div>
    );
  }

  if (!isPlatformOwner) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10">
          <ShieldOff className="h-6 w-6 text-rose-600" />
        </div>
        <h3 className="text-lg font-semibold text-[#111111]">Доступ закрыт</h3>
        <p className="max-w-sm text-sm text-[#666666]">
          Раздел доступен только владельцу платформы. Если вам нужен доступ, обратитесь к
          администратору GETVOXLY.
        </p>
        {backup && (
          <button
            type="button"
            onClick={() => {
              setIsRestoring(true);
              void restoreAdminSession().then((success) => {
                if (success) window.location.reload();
                else window.location.href = getPlatformAdminUrl();
              });
            }}
            className="mt-2 flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Вернуться в аккаунт администратора {backup.adminUserEmail ? `(${backup.adminUserEmail})` : ""}
          </button>
        )}
      </div>
    );
  }

  return <>{children}</>;
}
