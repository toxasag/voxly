"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  LogOut,
  ShieldCheck,
  Plug,
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
  PLATFORM_NAV,
  TENANT_MENU,
  visibleChannelNav,
  visibleMainNav,
} from "@/lib/navigation/nav-items";

/**
 * Пункт навигации.
 *
 * Вынесен в компонент, потому что тот же блок разметки нужен трём спискам —
 * разделам, каналам и платформенным пунктам. Четвёртая копия расходилась бы с
 * остальными при первой правке стилей.
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
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
  const activeText = accent === "amber" ? "text-amber-400" : "text-orange-400";

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cn(
        "flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        collapsed && "justify-center px-2",
        isActive
          ? cn(accent === "amber" ? "bg-amber-500/10" : "bg-orange-400/10", activeText)
          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200",
      )}
    >
      <item.icon className={cn("h-5 w-5 shrink-0", isActive && activeText)} />
      {!collapsed && <span className="ml-3 truncate">{item.label}</span>}
      {!collapsed && isActive && (
        <span
          className={cn(
            "ml-auto h-1.5 w-1.5 rounded-full",
            accent === "amber" ? "bg-amber-500" : "bg-orange-400",
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
  const { tenant, user } = useAuth();
  const { logout } = useAuth();
  const { data: liveModules } = useTenantModules(tenant?.tenantId ?? null);
  const [tenantMenuOpen, setTenantMenuOpen] = useState(false);
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Аватар и имя берутся из профиля, а не только из токена: токен не содержит
  // avatar_url, и после смены фото или имени сайдбар показывал бы прежние
  // значения до полной перезагрузки страницы.
  const { data: profile } = useProfile();

  const displayTenant = tenant ?? { tenantName: "", slug: "", plan: "", installedModules: [] };
  // Пока первый запрос модулей не завершён, берём сессию только как временный
  // fallback. После ответа query всегда побеждает и Sidebar не держит старый
  // захардкоженный список.
  // useMemo: новый Set на каждый рендер менял бы зависимости `isVisible` ниже и
  // пересоздавал фильтры при любом изменении состояния сайдбара.
  const installedSlugs = useMemo(
    () => new Set((liveModules ?? []).map((module) => module.slug)),
    [liveModules],
  );
  // Профиль приоритетнее токена: он свежее и содержит аватар. Токен остаётся
  // источником на время первого запроса, чтобы блок не был пустым.
  const displayUser = {
    name: profile?.name ?? user?.name ?? "",
    email: profile?.email ?? user?.email ?? "",
    avatarUrl: profile?.avatarUrl ?? null,
  };
  const isPlatformOwner = user?.platform_role === "platform_owner";
  const isProfileActive = pathname === "/settings/profile";
  // null, пока сессия не восстановлена: в этот момент скрывать пункты по правам
  // нельзя — меню мигало бы при каждой перезагрузке.
  const permissions = user?.permissions ?? null;

  const toggleCollapsed = onToggle;

  const handleLogout = useCallback(async () => {
    setIsLoggingOut(true);

    // Revoke first, then navigate — otherwise the redirect can cancel the
    // in-flight request and leave the refresh token active.
    //
    // `isLoggingOut` не сбрасывается в finally: сразу после этого происходит
    // переход, и снятие флага только вернуло бы кнопке активный вид на миг.
    await logout().finally(() => {
      window.location.href = "/login";
    });
  }, [logout]);

  // Списки и правило видимости лежат в `lib/navigation/nav-items`: те же разделы
  // показывает мобильное меню `/menu`, и вторая копия правил разошлась бы с этой.
  const visibleNav = visibleMainNav(installedSlugs, permissions);
  const visibleChannels = visibleChannelNav(installedSlugs, permissions);

  return (
    <aside
      className={cn(
        // `hidden md:flex`, а не ветка по `useIsMobile`: `matchMedia` недоступен
        // при SSR, и структурная зависимость от хука дала бы вспышку сайдбара на
        // телефоне при каждой загрузке. На мобильном его навигацию берут на себя
        // маршрут `/menu` и нижний бар.
        "fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-slate-800 bg-slate-900 transition-all duration-200 ease-in-out md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* Logo + Mascot */}
      <div
        className={cn(
          "flex h-16 items-center border-b border-slate-800 px-4",
          collapsed ? "justify-center" : "gap-3",
        )}
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-slate-950">
          <span className="text-sm font-black">G</span>
        </div>
        {!collapsed && (
          <div className="flex-1 overflow-hidden">
            <span className="block text-sm font-bold tracking-tight text-slate-100 truncate">
              GETVOXLY
            </span>
            <span className="block text-xs text-slate-500">Платформа для бизнеса</span>
          </div>
        )}
      </div>

      {/* Tenant Switcher */}
      <div className="relative border-b border-slate-800 px-3 py-3">
        {/*
          Кнопка была без обработчика — стрелка ChevronsUpDown обещала меню,
          которого не существовало. Теперь она открывает разделы компании.
        */}
        <button
          type="button"
          onClick={() => setTenantMenuOpen((prev) => !prev)}
          aria-expanded={tenantMenuOpen}
          aria-haspopup="menu"
          className={cn(
            "flex w-full items-center rounded-lg border bg-slate-950/50 transition-colors",
            tenantMenuOpen ? "border-slate-700" : "border-slate-800 hover:border-slate-700",
            collapsed ? "justify-center px-2 py-2.5" : "gap-2.5 px-3 py-2",
          )}
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-xs font-bold text-amber-400">
            {displayTenant.tenantName.charAt(0)}
          </div>
          {!collapsed && (
            <>
              <div className="flex-1 text-left overflow-hidden">
                <p className="truncate text-xs font-medium text-slate-200">{displayTenant.tenantName}</p>
                {/* Показываем поддомен, а не только план: пользователю нужно
                    видеть, в каком именно портале он работает. */}
                <p className="truncate text-xs text-slate-500">
                  {displayTenant.slug.length > 0
                    ? `${displayTenant.slug}.getvoxly.ru`
                    : displayTenant.plan}
                </p>
              </div>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
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
                "absolute z-50 mt-1 overflow-hidden rounded-lg border border-slate-700 bg-slate-800 shadow-xl",
                collapsed ? "left-full top-3 ml-2 w-56" : "left-3 right-3",
              )}
            >
              <p className="border-b border-slate-700 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Компания
              </p>
              {TENANT_MENU.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  onClick={() => setTenantMenuOpen(false)}
                  className="flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-slate-700"
                >
                  <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-slate-200">
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
        {visibleNav.map((item) => (
          <SidebarLink
            key={item.href}
            item={item}
            pathname={pathname}
            collapsed={collapsed}
          />
        ))}

        {/*
          Каналы связи. Отдельный блок, а не пункты вперемешку с модулями: их до
          пяти, и в общем списке они вытеснили бы разделы CRM за пределы экрана.
          Заголовок появляется только когда хотя бы один канал подключён —
          пустая подпись без пунктов выглядела бы как сбой загрузки.
        */}
        {visibleChannels.length > 0 && (
          <>
            <div
              className={cn(
                "mt-4 mb-1 flex items-center gap-2 border-t border-slate-800 pt-4",
                collapsed ? "justify-center px-0" : "px-3",
              )}
            >
              <Plug className="h-3.5 w-3.5 shrink-0 text-slate-500" />
              {!collapsed && (
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
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

        {isPlatformOwner && (
          <>
            <div
              className={cn(
                "mt-4 mb-1 flex items-center gap-2 border-t border-slate-800 pt-4",
                collapsed ? "justify-center px-0" : "px-3",
              )}
            >
              <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-orange-400" />
              {!collapsed && (
                <span className="text-xs font-semibold uppercase tracking-wider text-orange-400">
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

      {/*
        Блок пользователя. Отдельный пункт «Настройки» отсюда убран: он дублировал
        меню компании сверху, где те же разделы уже собраны. Здесь остаётся только
        личное — переход в свой профиль и выход.

        Аватар и имя — ссылка на /settings/profile: это ожидаемое поведение, и
        прежде блок выглядел интерактивным (hover менял фон), но клик ничего не
        делал.
      */}
      <div className="border-t border-slate-800 p-3">
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
              "flex min-w-0 flex-1 items-center rounded-lg transition-colors hover:bg-slate-800",
              isProfileActive && "bg-amber-500/10",
              collapsed ? "justify-center p-2" : "gap-3 p-2",
            )}
          >
            {displayUser.avatarUrl !== null && displayUser.avatarUrl !== undefined ? (
              /* eslint-disable-next-line @next/next/no-img-element -- Base64 data-URI: next/image требует загрузчик и внешний URL */
              <img
                src={displayUser.avatarUrl}
                alt=""
                className="h-8 w-8 shrink-0 rounded-full object-cover"
              />
            ) : (
              <div
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isProfileActive ? "bg-amber-500/20 text-amber-300" : "bg-slate-700 text-slate-200",
                )}
              >
                {userInitials(displayUser.name)}
              </div>
            )}

            {!collapsed && (
              <div className="min-w-0 flex-1 overflow-hidden">
                <p
                  className={cn(
                    "truncate text-xs font-medium",
                    isProfileActive ? "text-amber-400" : "text-slate-200",
                  )}
                >
                  {displayUser.name}
                </p>
                <p className="truncate text-xs text-slate-500">{displayUser.email}</p>
              </div>
            )}
          </Link>

          {/*
            Подтверждение обязательно: прежде клик по иконке немедленно завершал
            сессию, и промах по кнопке рядом с профилем выбрасывал из системы.
          */}
          {!collapsed && (
            <button
              type="button"
              onClick={() => setLogoutOpen(true)}
              aria-label="Выйти"
              className="shrink-0 rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-rose-400"
            >
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* В свёрнутом состоянии выход выносится отдельной строкой: иначе он не
            поместился бы рядом с аватаром. */}
        {collapsed && (
          <button
            type="button"
            onClick={() => setLogoutOpen(true)}
            aria-label="Выйти"
            className="mt-1 flex w-full items-center justify-center rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-800 hover:text-rose-400"
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
        className="absolute -right-3 top-20 flex h-6 w-6 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-500 hover:text-slate-300 transition-colors"
      >
        {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronLeft className="h-3 w-3" />}
      </button>
    </aside>
  );
}