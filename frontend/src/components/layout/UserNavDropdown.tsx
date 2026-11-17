"use client";

import { useState, useRef, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Building2,
  ArrowUpRight,
  Handshake,
  User,
  Settings,
  LogOut,
  Loader2,
  Check,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/use-auth";
import { useProfile } from "@/lib/api/use-profile";
import { useWorkspaces, switchWorkspace } from "@/lib/api/use-workspaces";
import {
  readImpersonationBackup,
  restoreAdminSessionDetailed,
} from "@/lib/auth/impersonation";
import { userInitials } from "@/lib/api/use-tenant-users";
import { useClickOutside } from "@/lib/hooks/use-click-outside";

function getRoleLabel(role?: string, isPlatformOwner?: boolean, isPartner?: boolean): string {
  if (isPlatformOwner) return "Суперадмин";
  if (isPartner) return "Партнёр";
  switch (role) {
    case "owner":
      return "Владелец";
    case "admin":
      return "Администратор";
    case "manager":
      return "Менеджер";
    case "technician":
      return "Мастер";
    case "member":
      return "Сотрудник";
    default:
      return "Пользователь";
  }
}

export function UserNavDropdown({ className }: { className?: string }) {
  const router = useRouter();
  const { user, tenant, impersonator, logout } = useAuth();
  const { data: profile } = useProfile();
  const { data: workspacesData } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [switchingSlug, setSwitchingSlug] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  useClickOutside(dropdownRef, () => setOpen(false), open);

  const displayTenant = tenant ?? { tenantName: "", slug: "", plan: "", is_partner: false, installedModules: [] };

  const workspaces = useMemo(() => {
    if (workspacesData && workspacesData.length > 0) return workspacesData;
    if (displayTenant.slug) {
      return [
        {
          id: tenant?.tenantId ?? "current",
          name: displayTenant.tenantName || "Рабочее пространство",
          slug: displayTenant.slug,
          plan: displayTenant.plan,
          status: "active",
          is_current: true,
          is_parent: false,
          is_partner: Boolean(displayTenant.is_partner || tenant?.is_partner),
          role: user?.role ?? "member",
        },
      ];
    }
    return [];
  }, [workspacesData, displayTenant, tenant, user]);

  const currentWorkspace = useMemo(
    () => workspaces.find((ws) => ws.is_current) ?? null,
    [workspaces],
  );
  const parentWorkspace = useMemo(
    () => workspaces.find((ws) => ws.is_parent) ?? null,
    [workspaces],
  );
  const childWorkspaces = useMemo(
    () => workspaces.filter((ws) => !ws.is_current && !ws.is_parent),
    [workspaces],
  );

  const isPlatformOwner = user?.platform_role === "platform_owner";
  const isPartner =
    Boolean(user?.is_partner) ||
    Boolean(tenant?.is_partner) ||
    Boolean(currentWorkspace?.is_partner) ||
    user?.role === "partner" ||
    isPlatformOwner ||
    Boolean(impersonator?.is_partner);

  const backup = typeof window !== "undefined" ? readImpersonationBackup() : null;
  const isImpersonating = Boolean(impersonator || backup);

  const isPrivilegedUser =
    isPlatformOwner ||
    isPartner ||
    user?.role === "owner" ||
    user?.role === "admin" ||
    user?.role === "manager" ||
    isImpersonating;

  const displayName = profile?.name ?? user?.name ?? "Пользователь";
  const displayEmail = profile?.email ?? user?.email ?? "";
  const avatarUrl = profile?.avatarUrl ?? null;
  const roleLabel = getRoleLabel(user?.role, isPlatformOwner, isPartner);

  const handleReturnToParent = async () => {
    if (!parentWorkspace || isReturning) return;
    setIsReturning(true);
    try {
      await switchWorkspace(
        parentWorkspace.slug,
        displayTenant.slug,
        user?.email,
        user?.name,
        isPartner,
        isPlatformOwner,
        true,
      );
    } catch (err) {
      console.error("Не удалось вернуться в кабинет партнёра:", err);
      setIsReturning(false);
    }
  };

  const handleSwitchWorkspace = async (targetSlug: string) => {
    if (targetSlug === displayTenant.slug || switchingSlug !== null) return;
    try {
      setSwitchingSlug(targetSlug);
      await switchWorkspace(
        targetSlug,
        displayTenant.slug,
        user?.email,
        user?.name,
        isPartner,
        isPlatformOwner,
        false,
      );
    } catch (err) {
      console.error("Не удалось переключить организацию:", err);
      setSwitchingSlug(null);
    }
  };

  const handleExitImpersonation = async () => {
    if (isReturning) return;
    setIsReturning(true);
    try {
      const res = await restoreAdminSessionDetailed();
      if (res.targetUrl) {
        window.location.href = res.targetUrl;
        return;
      }
      window.location.reload();
    } catch (err) {
      console.error("Ошибка выхода из имперсонации:", err);
      window.location.href = isPartner ? "/partner" : "/admin/tenants";
    }
  };

  const handleLogout = async () => {
    setOpen(false);
    try {
      await logout();
    } finally {
      window.location.href = "/login";
    }
  };

  return (
    <div className={cn("relative shrink-0", className)} ref={dropdownRef}>
      {/* Кнопка-аватар профиля в хедере */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-full transition-all focus:outline-none cursor-pointer",
          open
            ? "ring-2 ring-[#4a38f5] shadow-xs"
            : "hover:ring-2 hover:ring-black/10",
        )}
        title={displayName}
        aria-label="Профиль пользователя и навигация"
        aria-expanded={open}
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt={displayName}
            className="h-7 w-7 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#4a38f5]/10 text-[11px] font-semibold text-[#4a38f5]">
            {userInitials(displayName)}
          </div>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1.5 w-64 rounded-xl border border-[#e5e5e5] bg-white p-1.5 shadow-lg z-50 text-[13px] animate-in fade-in-0 zoom-in-95 duration-100"
        >
          {/* Блок пользователя */}
          <div className="px-2.5 py-2">
            <div className="flex items-center gap-2.5">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={displayName}
                  className="h-8 w-8 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#4a38f5]/10 text-xs font-semibold text-[#4a38f5]">
                  {userInitials(displayName)}
                </div>
              )}
              <div className="min-w-0 flex-1 overflow-hidden">
                <p className="truncate text-[13px] font-semibold text-[#111111]">
                  {displayName}
                </p>
                <p className="truncate text-[11px] text-[#666666]">
                  {displayEmail}
                </p>
              </div>
            </div>

            {/* Бейджи роли и организации */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="rounded-[4px] border border-black/10 bg-black/[0.04] px-1.5 py-0.2 text-[10px] font-medium text-[#444444]">
                {roleLabel}
              </span>
              <span className="truncate max-w-[140px] rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-1.5 py-0.2 text-[10px] font-medium text-[#666666]" title={displayTenant.tenantName}>
                {displayTenant.tenantName || displayTenant.slug}
              </span>
            </div>
          </div>

          {/* CRM RETURN BRIDGE: Возврат в кабинет партнёра из клиентского портала */}
          {parentWorkspace && isPrivilegedUser && (
            <>
              <div className="my-1 border-t border-[#f0f0f0]" />
              <div className="p-1">
                <button
                  type="button"
                  onClick={handleReturnToParent}
                  disabled={isReturning}
                  className="flex w-full items-center justify-between gap-2.5 rounded-lg border border-[#4a38f5]/20 bg-[#4a38f5]/[0.06] px-2.5 py-2 text-left transition-colors hover:bg-[#4a38f5]/[0.12] cursor-pointer"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Building2 className="h-4 w-4 shrink-0 text-[#4a38f5]" />
                    <div className="min-w-0">
                      <span className="block truncate text-[12px] font-semibold text-[#4a38f5]">
                        Кабинет партнёра
                      </span>
                      <span className="block truncate text-[10px] text-[#666666]">
                        {parentWorkspace.name}
                      </span>
                    </div>
                  </div>
                  {isReturning ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#4a38f5]" />
                  ) : (
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[#4a38f5]" />
                  )}
                </button>
              </div>
            </>
          )}

          {/* Быстрые переходы партнера (если в партнерском кабинете) */}
          {(displayTenant.is_partner || tenant?.is_partner || currentWorkspace?.is_partner) && (
            <>
              <div className="my-1 border-t border-[#f0f0f0]" />
              <Link
                href="/partner"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-[#333333] transition-colors hover:bg-black/[0.04]"
              >
                <Building2 className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span>Кабинет партнёра</span>
              </Link>
              <Link
                href="/crm/deals"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-[#333333] transition-colors hover:bg-black/[0.04]"
              >
                <Handshake className="h-3.5 w-3.5 text-[#666666]" />
                <span>Сделки CRM</span>
              </Link>
            </>
          )}

          {/* Клиентские порталы (если партнер или владелец нескольких пространств) */}
          {childWorkspaces.length > 0 && isPrivilegedUser && (
            <>
              <div className="my-1 border-t border-[#f0f0f0]" />
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#888888]">
                Клиентские порталы ({childWorkspaces.length})
              </div>
              <div className="max-h-32 overflow-y-auto divide-y divide-[#f7f7f7]">
                {childWorkspaces.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    disabled={switchingSlug !== null}
                    onClick={() => handleSwitchWorkspace(ws.slug)}
                    className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-black/[0.03] cursor-pointer"
                  >
                    <span className="truncate text-[#333333]">{ws.name}</span>
                    {switchingSlug === ws.slug ? (
                      <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />
                    ) : (
                      <span className="text-[10px] text-[#888888]">{ws.slug}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Стандартные ссылки профиля */}
          <div className="my-1 border-t border-[#f0f0f0]" />
          <Link
            href="/settings/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] text-[#333333] transition-colors hover:bg-black/[0.04]"
          >
            <User className="h-3.5 w-3.5 text-[#666666]" />
            <span>Мой профиль</span>
          </Link>
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] text-[#333333] transition-colors hover:bg-black/[0.04]"
          >
            <Settings className="h-3.5 w-3.5 text-[#666666]" />
            <span>Настройки компании</span>
          </Link>

          {/* Раздел выхода */}
          <div className="my-1 border-t border-[#f0f0f0]" />
          {isImpersonating ? (
            <button
              type="button"
              onClick={handleExitImpersonation}
              disabled={isReturning}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-amber-700 transition-colors hover:bg-amber-50 cursor-pointer"
            >
              {isReturning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="h-3.5 w-3.5" />
              )}
              <span>Выйти из клиентского портала</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-rose-600 transition-colors hover:bg-rose-50 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Выйти из системы</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
