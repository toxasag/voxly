"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Plug,
  MessageSquare,
  Handshake,
  Users,
  Building2,
  ListChecks,
  BarChart3,
  PlusCircle,
  Check,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/use-auth";
import { useTenantModules } from "@/lib/api/use-tenant-modules";
import { useProfile } from "@/lib/api/use-profile";
import { userInitials } from "@/lib/api/use-tenant-users";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { CreateTenantDialog } from "@/components/partner/CreateTenantDialog";
import { Logo } from "@/components/brand";
import { useWorkspaces, switchWorkspace } from "@/lib/api/use-workspaces";
import {
  readImpersonationBackup,
  restoreAdminSessionDetailed,
  getPlatformAdminUrl,
} from "@/lib/auth/impersonation";
import {
  MARKETPLACE_NAV,
  PLATFORM_NAV,
  TENANT_MENU,
  visibleChannelNav,
  visibleMainNav,
  visibleMarketingNav,
  type NavItem,
} from "@/lib/navigation/nav-items";

const ENTITY_ICONS: Record<string, string> = {
  "/crm/deals": "text-rose-500",
  "/crm/contacts": "text-sky-600",
  "/crm/companies": "text-blue-600",
  "/crm/tasks": "text-emerald-600",
  "/analytics": "text-purple-600",
  "/dashboard": "text-neutral-600",
  "/inbox": "text-violet-600",
  "/marketing/stories": "text-pink-500",
  "/marketing/funnels": "text-[#4a38f5]",
  "/modules/ai-bots": "text-indigo-600",
  "/repairs": "text-cyan-600",
  "/warehouse": "text-amber-600",
  "/finance": "text-emerald-600",
  "/marketplace": "text-blue-500",
};

/**
 * Пункт навигации Twenty CRM Light UI.
 */
function SidebarLink({
  item,
  pathname,
  collapsed,
}: {
  item: { label: string; href: string; icon: LucideIcon };
  pathname: string;
  collapsed: boolean;
}) {
  const isActive =
    pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
  const iconColor =
    ENTITY_ICONS[item.href] ?? (isActive ? "text-[#111111]" : "text-[#888888]");

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-100",
        collapsed && "justify-center px-1.5",
        isActive
          ? "bg-black/[0.06] font-medium text-[#000000]"
          : "font-normal text-[#333333] hover:bg-black/[0.03] hover:text-[#000000]",
      )}
    >
      <item.icon className={cn("h-4 w-4 shrink-0 transition-colors", iconColor)} />
      {!collapsed && <span className="ml-2.5 truncate">{item.label}</span>}
    </Link>
  );
}

export function Sidebar({
  collapsed,
  onToggle,
}: {
  /** Управляется DashboardShell: отступ контента синхронен ширине панели. */
  collapsed: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const { tenant, user, logout } = useAuth();
  const { data: liveModules } = useTenantModules(tenant?.tenantId ?? null);
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [createTenantOpen, setCreateTenantOpen] = useState(false);
  const [switchingSlug, setSwitchingSlug] = useState<string | null>(null);

  const { data: profile } = useProfile();
  const { data: workspacesData } = useWorkspaces();

  const displayTenant = tenant ?? { tenantName: "", slug: "", plan: "", installedModules: [] };

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
          role: user?.role ?? "member",
        },
      ];
    }
    return [];
  }, [workspacesData, displayTenant, tenant, user]);

  const handleSwitchWorkspace = async (targetSlug: string) => {
    if (targetSlug === displayTenant.slug) {
      setTenantMenuOpen(false);
      return;
    }
    try {
      setSwitchingSlug(targetSlug);
      await switchWorkspace(
        targetSlug,
        displayTenant.slug,
        user?.email,
        user?.name,
      );
    } catch (err) {
      console.error("Не удалось переключить организацию", err);
      setSwitchingSlug(null);
    }
  };

  const installedSlugs = useMemo(
    () => new Set((liveModules ?? []).map((module) => module.slug)),
    [liveModules],
  );

  const displayUser = {
    name: profile?.name ?? user?.name ?? "",
    email: profile?.email ?? user?.email ?? "",
    avatarUrl: profile?.avatarUrl ?? null,
  };
  const isPlatformOwner = user?.platform_role === "platform_owner";
  const isProfileActive = pathname === "/settings/profile";
  const permissions = user?.permissions ?? null;

  const canCreateTenant =
    user?.role === "partner" ||
    user?.role === "owner" ||
    user?.role === "admin" ||
    user?.platform_role === "platform_owner" ||
    Boolean(user?.permissions?.has("tenant:admin"));

  const backup = typeof window !== "undefined" ? readImpersonationBackup() : null;
  const isImpersonatingClient = Boolean(
    backup && (!isPlatformOwner || (tenant?.slug !== "voxly" && Boolean(tenant?.slug))),
  );

  const toggleCollapsed = onToggle;

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);

    if (isImpersonatingClient) {
      try {
        const res = await restoreAdminSessionDetailed();
        window.location.href = res.targetUrl || getPlatformAdminUrl();
        return;
      } catch (err) {
        console.error("Ошибка выхода из аккаунта клиента:", err);
        window.location.href = getPlatformAdminUrl();
        return;
      }
    }

    await logout().finally(() => {
      window.location.href = "/login";
    });
  }, [isImpersonatingClient, logout]);

  const visibleNav = visibleMainNav(installedSlugs, permissions);
  const visibleChannels = visibleChannelNav(installedSlugs, permissions);
  const visibleMarketing = visibleMarketingNav();
  const visibleModules = visibleNav.filter((item) => item.moduleSlug !== undefined);

  // Core Twenty workspace items
  const workspaceItems: NavItem[] = [
    { label: "Главная", href: "/dashboard", icon: LayoutDashboard, always: true },
    { label: "Входящие", href: "/inbox", icon: MessageSquare, always: true },
    { label: "Сделки", href: "/crm/deals", icon: Handshake, always: true },
    { label: "Контакты", href: "/crm/contacts", icon: Users, always: true },
    { label: "Компании", href: "/crm/companies", icon: Building2, always: true },
    { label: "Задачи", href: "/crm/tasks", icon: ListChecks, always: true },
    { label: "Аналитика", href: "/analytics", icon: BarChart3, always: true },
  ];

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-[#e5e5e5] bg-[#fbfbfb] text-[#111111] transition-all duration-200 ease-in-out md:flex dark:border-[#27272a] dark:bg-[#111111]",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Platform Brand Anchor */}
      <div
        className={cn(
          "flex h-11 items-center border-b border-[#e5e5e5] dark:border-[#27272a] px-3.5 transition-colors",
          collapsed ? "justify-center px-1" : "justify-between",
        )}
      >
        <Logo
          variant={collapsed ? "mark" : "full"}
          size="xs"
          href="/dashboard"
        />
      </div>

      {/* Workspace Header & Switcher */}
      <div className="relative border-b border-[#e5e5e5] px-2.5 py-2.5">
        <button
          type="button"
          onClick={() => setTenantMenuOpen((prev) => !prev)}
          aria-expanded={tenantMenuOpen}
          aria-haspopup="menu"
          className={cn(
            "flex w-full items-center rounded-lg p-1.5 transition-colors hover:bg-black/[0.04]",
            collapsed ? "justify-center" : "gap-2.5",
          )}
        >
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-black/[0.07] text-xs font-semibold text-[#111111]">
            {displayTenant.tenantName.charAt(0) || "V"}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 text-left overflow-hidden">
                <p className="truncate text-[13px] font-medium text-[#000000]">
                  {displayTenant.tenantName || "Рабочее пространство"}
                </p>
                <p className="truncate text-[11px] text-[#888888]">
                  {displayTenant.slug.length > 0
                    ? `${displayTenant.slug}.getvoxly.ru`
                    : displayTenant.plan || "Twenty CRM"}
                </p>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
            </>
          )}
        </button>

        {tenantMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setTenantMenuOpen(false)}
              aria-hidden="true"
            />
            <div
              role="menu"
              className={cn(
                "absolute z-50 mt-1 max-h-[85vh] overflow-y-auto rounded-xl border border-[#e5e5e5] bg-white shadow-lg",
                collapsed ? "left-full top-2 ml-2 w-64" : "left-2.5 right-2.5",
              )}
            >
              <div className="border-b border-[#f0f0f0] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#888888]">
                Организации
              </div>
              <div className="max-h-52 overflow-y-auto divide-y divide-[#f7f7f7]">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    type="button"
                    disabled={switchingSlug !== null}
                    onClick={() => handleSwitchWorkspace(ws.slug)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-black/[0.03]",
                      ws.is_current && "bg-[#4a38f5]/[0.04]",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <div
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-semibold",
                          ws.is_current
                            ? "bg-[#4a38f5] text-white"
                            : "bg-black/[0.07] text-[#111111]",
                        )}
                      >
                        {ws.name.charAt(0)}
                      </div>
                      <div className="min-w-0 truncate">
                        <span
                          className={cn(
                            "block truncate text-[13px]",
                            ws.is_current
                              ? "font-semibold text-[#111111]"
                              : "font-medium text-[#333333]",
                          )}
                        >
                          {ws.name}
                        </span>
                        <span className="block truncate text-[10px] text-[#888888]">
                          {ws.slug}.getvoxly.ru
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {switchingSlug === ws.slug ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                      ) : ws.is_current ? (
                        <Check className="h-3.5 w-3.5 text-[#4a38f5]" />
                      ) : (
                        <span className="rounded-[4px] border border-emerald-200 bg-emerald-50 px-1.5 py-0.2 text-[10px] font-medium text-emerald-700">
                          {ws.status === "active" ? "активен" : ws.status}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              <div className="border-t border-[#f0f0f0]">
                <p className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#888888]">
                  Компания
                </p>
                {TENANT_MENU.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    onClick={() => setTenantMenuOpen(false)}
                    className="flex items-start gap-2.5 px-3 py-2 text-[13px] transition-colors hover:bg-black/[0.03]"
                  >
                    <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#666666]" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-[#111111]">
                        {item.label}
                      </span>
                      <span className="block truncate text-[11px] text-[#888888]">
                        {item.description}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>

              {canCreateTenant && (
                <>
                  <div className="my-1 border-t border-[#f0f0f0]" />
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setTenantMenuOpen(false);
                      setCreateTenantOpen(true);
                    }}
                    className="flex w-full items-start gap-2.5 px-3 py-2 text-left text-[13px] transition-colors hover:bg-black/[0.03]"
                  >
                    <PlusCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#4a38f5]" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 font-medium text-[#111111]">
                        Создать компанию
                        <span className="rounded-[4px] bg-[#4a38f5]/10 px-1.5 py-0.2 text-[10px] font-semibold text-[#4a38f5]">
                          Партнёр
                        </span>
                      </span>
                      <span className="block truncate text-[11px] text-[#888888]">
                        Новый клиентский портал
                      </span>
                    </span>
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {!collapsed && (
          <div className="px-2.5 pb-1 pt-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#888888]">
              Рабочее пространство
            </span>
          </div>
        )}

        {/* Core CRM links: Home, Inbox, Deals, Contacts, Companies, Tasks, Analytics */}
        {workspaceItems.map((item) => (
          <SidebarLink
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={collapsed}
          />
        ))}

        {/* Marketing: Stories and Funnels */}
        {visibleMarketing.length > 0 && (
          <>
            <div
              className={cn(
                "mt-3 mb-1 flex items-center gap-2 border-t border-[#f0f0f0] pt-2.5",
                collapsed ? "justify-center px-0" : "px-2.5",
              )}
            >
              {!collapsed && (
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#888888]">
                  Маркетинг
                </span>
              )}
            </div>

            {visibleMarketing.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
              />
            ))}
          </>
        )}

        {/* Modules: AI Bots, Repairs, Finance, etc. */}
        {visibleModules.length > 0 && (
          <>
            <div
              className={cn(
                "mt-3 mb-1 flex items-center gap-2 border-t border-[#f0f0f0] pt-2.5",
                collapsed ? "justify-center px-0" : "px-2.5",
              )}
            >
              {!collapsed && (
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#888888]">
                  Модули
                </span>
              )}
            </div>

            {visibleModules.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
              />
            ))}
          </>
        )}

        {/* Marketplace */}
        <SidebarLink
          item={MARKETPLACE_NAV}
          pathname={pathname}
          collapsed={collapsed}
        />

        {/* Channels */}
        {visibleChannels.length > 0 && (
          <>
            <div
              className={cn(
                "mt-3 mb-1 flex items-center gap-2 border-t border-[#f0f0f0] pt-2.5",
                collapsed ? "justify-center px-0" : "px-2.5",
              )}
            >
              <Plug className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
              {!collapsed && (
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#888888]">
                  Каналы связи
                </span>
              )}
            </div>

            {visibleChannels.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
              />
            ))}
          </>
        )}

        {/* Platform Admin */}
        {isPlatformOwner && (
          <>
            <div
              className={cn(
                "mt-3 mb-1 flex items-center gap-2 border-t border-[#f0f0f0] pt-2.5",
                collapsed ? "justify-center px-0" : "px-2.5",
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#4a38f5]" />
              {!collapsed && (
                <span className="text-[11px] font-medium uppercase tracking-wider text-[#4a38f5]">
                  Управление платформой
                </span>
              )}
            </div>

            {PLATFORM_NAV.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                pathname={pathname}
                collapsed={collapsed}
              />
            ))}
          </>
        )}
      </nav>

      {/* User profile & Logout */}
      <div className="border-t border-[#e5e5e5] p-2 bg-[#fafafa]">
        <div
          className={cn(
            "flex items-center rounded-lg",
            collapsed ? "justify-center" : "gap-1",
          )}
        >
          <Link
            href="/settings/profile"
            title={collapsed ? displayUser.name : undefined}
            className={cn(
              "flex min-w-0 flex-1 items-center rounded-lg transition-colors hover:bg-black/[0.04]",
              isProfileActive && "bg-black/[0.05]",
              collapsed ? "justify-center p-1.5" : "gap-2.5 p-1.5",
            )}
          >
            {displayUser.avatarUrl !== null && displayUser.avatarUrl !== undefined ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={displayUser.avatarUrl}
                alt=""
                className="h-6 w-6 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                  isProfileActive ? "bg-black text-white" : "bg-black/[0.08] text-[#111111]",
                )}
              >
                {userInitials(displayUser.name)}
              </div>
            )}

            {!collapsed && (
              <div className="min-w-0 flex-1 overflow-hidden text-left">
                <p className="truncate text-[12px] font-medium text-[#111111]">
                  {displayUser.name}
                </p>
                <p className="truncate text-[11px] text-[#888888]">{displayUser.email}</p>
              </div>
            )}
          </Link>

          {!collapsed && (
            <button
              type="button"
              onClick={() => setLogoutOpen(true)}
              aria-label={isImpersonatingClient ? "Вернуться в панель администратора" : "Выйти"}
              title={isImpersonatingClient ? "Выйти из аккаунта клиента" : "Выйти"}
              className={cn(
                "shrink-0 rounded-md p-1.5 transition-colors",
                isImpersonatingClient
                  ? "text-[#854d0e] hover:bg-[#fefce8] hover:text-[#713f12]"
                  : "text-[#888888] hover:bg-black/[0.04] hover:text-rose-600",
              )}
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={() => setLogoutOpen(true)}
            aria-label={isImpersonatingClient ? "Вернуться в панель администратора" : "Выйти"}
            title={isImpersonatingClient ? "Выйти из аккаунта клиента" : "Выйти"}
            className={cn(
              "mt-1 flex w-full items-center justify-center rounded-md p-1.5 transition-colors",
              isImpersonatingClient
                ? "text-[#854d0e] hover:bg-[#fefce8] hover:text-[#713f12]"
                : "text-[#888888] hover:bg-black/[0.04] hover:text-rose-600",
            )}
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>

      <ConfirmDialog
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={handleLogout}
        title={isImpersonatingClient ? "Выйти из аккаунта клиента?" : "Выйти из системы?"}
        description={
          isImpersonatingClient
            ? `Вы завершите просмотр организации «${displayTenant.tenantName || displayTenant.slug}» и вернётесь в панель администратора GETVOXLY.`
            : "Текущая сессия будет завершена. Для входа снова потребуется пароль и код подтверждения."
        }
        confirmLabel={isImpersonatingClient ? "Вернуться в админку" : "Выйти"}
        variant={isImpersonatingClient ? "default" : "destructive"}
        isPending={isLoggingOut}
      />

      <CreateTenantDialog
        open={createTenantOpen}
        onClose={() => setCreateTenantOpen(false)}
      />

      {/* Collapse Toggle */}
      <button
        type="button"
        onClick={toggleCollapsed}
        className="absolute -right-3 top-3.5 flex h-6 w-6 items-center justify-center rounded-full border border-[#e5e5e5] bg-white text-[#888888] shadow-xs hover:text-[#000000] transition-colors"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>
    </aside>
  );
}