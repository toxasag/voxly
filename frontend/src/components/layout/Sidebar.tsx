"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Home,
  LogOut,
  ShieldCheck,
  Plug,
  MessageSquare,
  Sparkles,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { useState, useCallback, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth/use-auth";
import { useTenantModules } from "@/lib/api/use-tenant-modules";
import { useProfile } from "@/lib/api/use-profile";
import { userInitials } from "@/lib/api/use-tenant-users";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  INBOX_NAV,
  MARKETPLACE_NAV,
  PLATFORM_NAV,
  TENANT_MENU,
  visibleChannelNav,
  visibleMainNav,
  visibleMarketingNav,
} from "@/lib/navigation/nav-items";

const ENTITY_ICONS: Record<string, string> = {
  "/crm/deals": "text-rose-500",
  "/crm/contacts": "text-sky-600",
  "/crm/companies": "text-blue-600",
  "/crm/tasks": "text-emerald-600",
  "/analytics": "text-purple-600",
  "/dashboard": "text-blue-600",
  "/inbox": "text-violet-600",
  "/marketing/stories": "text-pink-500",
  "/marketing/funnels": "text-amber-500",
  "/modules/ai-bots": "text-indigo-600",
  "/repairs": "text-cyan-600",
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
  accent = "amber",
}: {
  item: { label: string; href: string; icon: LucideIcon };
  pathname: string;
  collapsed: boolean;
  accent?: "amber" | "orange";
}) {
  const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href + "/"));
  const iconColor = ENTITY_ICONS[item.href] ?? (isActive ? (accent === "orange" ? "text-orange-500" : "text-blue-600") : "text-slate-400");

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center rounded-lg px-2.5 py-2 text-sm transition-all duration-150",
        collapsed && "justify-center px-2",
        isActive
          ? "bg-slate-100 font-semibold text-slate-900 shadow-2xs"
          : "font-normal text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      )}
    >
      <item.icon className={cn("h-4 w-4 shrink-0 transition-colors", iconColor)} />
      {!collapsed && <span className="ml-2.5 truncate">{item.label}</span>}
      {!collapsed && isActive && (
        <span
          className={cn(
            "ml-auto h-1.5 w-1.5 rounded-full",
            accent === "orange" ? "bg-orange-500" : "bg-blue-600",
          )}
        />
      )}
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

  const { data: profile } = useProfile();

  const displayTenant = tenant ?? { tenantName: "", slug: "", plan: "", installedModules: [] };

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

  const toggleCollapsed = onToggle;

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);
    await logout().finally(() => {
      window.location.href = "/login";
    });
  }, [logout]);

  const visibleNav = visibleMainNav(installedSlugs, permissions);
  const visibleChannels = visibleChannelNav(installedSlugs, permissions);
  const visibleMarketing = visibleMarketingNav();
  const visibleModules = visibleNav.filter((item) => item.moduleSlug !== undefined);
  const coreLinks = visibleNav.filter(
    (item) => item.href !== "/marketplace" && !item.moduleSlug && item.href !== "/dashboard",
  );

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-slate-200 bg-[#fbfbfb] text-slate-800 transition-all duration-200 ease-in-out md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Workspace Header & Switcher */}
      <div className="relative border-b border-slate-200/80 px-3 py-3">
        <button
          type="button"
          onClick={() => setTenantMenuOpen((prev) => !prev)}
          aria-expanded={tenantMenuOpen}
          aria-haspopup="menu"
          className={cn(
            "flex w-full items-center rounded-lg border border-slate-200/80 bg-white p-2 shadow-2xs transition-colors hover:border-slate-300",
            collapsed ? "justify-center p-2" : "gap-2.5 px-3 py-2",
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-600 text-xs font-bold text-white shadow-2xs">
            {displayTenant.tenantName.charAt(0) || "V"}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 text-left overflow-hidden">
                <p className="truncate text-xs font-semibold text-slate-900">
                  {displayTenant.tenantName || "Рабочее пространство"}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {displayTenant.slug.length > 0
                    ? `${displayTenant.slug}.getvoxly.ru`
                    : displayTenant.plan || "Twenty CRM"}
                </p>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            </>
          )}
        </button>

        {!collapsed && (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-slate-100/70 p-1">
            <Link
              href="/dashboard"
              title="Панель"
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition-colors",
                pathname === "/dashboard"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <Home className="h-3.5 w-3.5" />
              <span>Главная</span>
            </Link>
            <Link
              href="/inbox"
              title="Входящие"
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition-colors",
                pathname === "/inbox"
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <MessageSquare className="h-3.5 w-3.5 text-violet-600" />
              <span>Входящие</span>
            </Link>
            <Link
              href="/settings"
              title="Настройки"
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-white text-slate-900 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900",
              )}
            >
              <Settings className="h-3.5 w-3.5" />
              <span>Настройки</span>
            </Link>
          </div>
        )}

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
                "absolute z-50 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl",
                collapsed ? "left-full top-3 ml-2 w-56" : "left-3 right-3",
              )}
            >
              <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Компания
              </p>
              {TENANT_MENU.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setTenantMenuOpen(false)}
                  className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-slate-800">
                      {item.label}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {item.description}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {!collapsed && (
          <div className="px-2.5 pb-1 pt-1">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Рабочее пространство
            </span>
          </div>
        )}

        {/* Core CRM links: Inbox, Deals, Contacts, Companies, Tasks, Analytics */}
        <SidebarLink
          item={INBOX_NAV}
          pathname={pathname}
          collapsed={collapsed}
        />
        {coreLinks.map((item) => (
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
                "mt-4 mb-1 flex items-center gap-2 border-t border-slate-200/80 pt-3",
                collapsed ? "justify-center px-0" : "px-2.5",
              )}
            >
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-pink-500" />
              {!collapsed && (
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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
                "mt-4 mb-1 flex items-center gap-2 border-t border-slate-200/80 pt-3",
                collapsed ? "justify-center px-0" : "px-2.5",
              )}
            >
              {!collapsed && (
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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
                "mt-4 mb-1 flex items-center gap-2 border-t border-slate-200/80 pt-3",
                collapsed ? "justify-center px-0" : "px-2.5",
              )}
            >
              <Plug className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              {!collapsed && (
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
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
                "mt-4 mb-1 flex items-center gap-2 border-t border-slate-200/80 pt-3",
                collapsed ? "justify-center px-0" : "px-2.5",
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-orange-400" />
              {!collapsed && (
                <span className="text-[11px] font-semibold uppercase tracking-wider text-orange-500">
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
                accent="orange"
              />
            ))}
          </>
        )}
      </nav>

      {/* User profile & Logout */}
      <div className="border-t border-slate-200/80 p-2.5 bg-slate-50/50">
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
              "flex min-w-0 flex-1 items-center rounded-lg transition-colors hover:bg-slate-100",
              isProfileActive && "bg-slate-100",
              collapsed ? "justify-center p-1.5" : "gap-2.5 p-1.5",
            )}
          >
            {displayUser.avatarUrl !== null && displayUser.avatarUrl !== undefined ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={displayUser.avatarUrl}
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isProfileActive ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-700",
                )}
              >
                {userInitials(displayUser.name)}
              </div>
            )}

            {!collapsed && (
              <div className="min-w-0 flex-1 overflow-hidden text-left">
                <p className="truncate text-xs font-medium text-slate-800">
                  {displayUser.name}
                </p>
                <p className="truncate text-[11px] text-slate-500">{displayUser.email}</p>
              </div>
            )}
          </Link>

          {!collapsed && (
            <button
              type="button"
              onClick={() => setLogoutOpen(true)}
              aria-label="Выйти"
              className="shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-600"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={() => setLogoutOpen(true)}
            aria-label="Выйти"
            className="mt-1 flex w-full items-center justify-center rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-rose-600"
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}
      </div>

      <ConfirmDialog
        open={logoutOpen}
        onClose={() => setLogoutOpen(false)}
        onConfirm={handleLogout}
        title="Выйти из системы?"
        description="Текущая сессия будет завершена. Для входа снова потребуется пароль и код подтверждения."
        confirmLabel="Выйти"
        variant="destructive"
        isPending={isLoggingOut}
      />

      {/* Collapse Toggle */}
      <button
        type="button"
        onClick={toggleCollapsed}
        className="absolute -right-3 top-5 flex h-6 w-6 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-xs hover:text-slate-800 transition-colors"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>
    </aside>
  );
}