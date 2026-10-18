"use client";

import { Loader2, ShieldOff } from "lucide-react";
import { useAuth } from "@/lib/auth/use-auth";

/**
 * Гейт разделов «Управление платформой».
 *
 * Проверяет глобальную роль `platform_role`, а не тенантную `owner`: иначе
 * владелец любого арендатора получил бы доступ к данным всей платформы.
 *
 * Это только UI: настоящая проверка — `requirePlatformOwner` на бэкенде, который
 * отвечает 403 независимо от того, что отрисовал клиент.
 */
export function PlatformOwnerGuard({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
      </div>
    );
  }

  if (user?.platform_role !== "platform_owner") {
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
      </div>
    );
  }

  return <>{children}</>;
}
