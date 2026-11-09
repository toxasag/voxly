"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldOff, ArrowLeft, ExternalLink, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth/use-auth";
import {
  readImpersonationBackup,
  restoreAdminSessionDetailed,
  getPlatformAdminUrl,
} from "@/lib/auth/impersonation";

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
  const { user, isLoading, logout } = useAuth();
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);

  const backup = typeof window !== "undefined" ? readImpersonationBackup() : null;
  const isPlatformOwner = user?.platform_role === "platform_owner";

  useEffect(() => {
    if (isLoading || isPlatformOwner || isRestoring || restoreFailed) return;

    if (backup) {
      setIsRestoring(true);
      void restoreAdminSessionDetailed().then((res) => {
        if (res.success) {
          if (res.targetUrl && typeof window !== "undefined" && !window.location.href.includes(res.targetUrl)) {
            window.location.href = res.targetUrl;
          } else {
            window.location.reload();
          }
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
    const isTenantSubdomain =
      typeof window !== "undefined" &&
      window.location.hostname.includes(".") &&
      !window.location.hostname.startsWith("voxly.");

    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center px-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10">
          <ShieldOff className="h-6 w-6 text-rose-600" />
        </div>
        <div className="space-y-1">
          <h3 className="text-lg font-semibold text-[#111111]">Доступ закрыт</h3>
          <p className="max-w-md text-sm text-[#666666]">
            Раздел предназначен для управления платформой и доступен только владельцу GETVOXLY.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2.5 mt-2">
          {backup && (
            <button
              type="button"
              onClick={() => {
                setIsRestoring(true);
                void restoreAdminSessionDetailed().then((res) => {
                  window.location.href = res.targetUrl || getPlatformAdminUrl();
                });
              }}
              className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Вернуться в аккаунт администратора {backup.adminUserEmail ? `(${backup.adminUserEmail})` : ""}
            </button>
          )}

          <Link
            href="/crm/deals"
            className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-2 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa]"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Вернуться в CRM
          </Link>

          {isTenantSubdomain && (
            <a
              href="https://voxly.getvoxly.ru/admin/tenants"
              className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-2 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa]"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Перейти на voxly.getvoxly.ru
            </a>
          )}

          <button
            type="button"
            onClick={() => {
              void logout().finally(() => {
                window.location.href = "/login";
              });
            }}
            className="flex items-center gap-2 rounded-[8px] border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-600 shadow-2xs transition-colors hover:bg-rose-100"
          >
            <LogOut className="h-3.5 w-3.5" />
            Сменить аккаунт / Выйти
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
