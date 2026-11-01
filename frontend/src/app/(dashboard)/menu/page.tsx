"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Check, Loader2, LogOut, Plug, PlusCircle, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaces, switchWorkspace } from "@/lib/api/use-workspaces";

import { useAuth } from "@/lib/auth/use-auth";
import { useTenantModules } from "@/lib/api/use-tenant-modules";
import { useProfile } from "@/lib/api/use-profile";
import { userInitials } from "@/lib/api/use-tenant-users";
import { Logo } from "@/components/brand";
import { CreateTenantDialog } from "@/components/partner/CreateTenantDialog";
import {
  PLATFORM_NAV,
  TENANT_MENU,
  visibleChannelNav,
  visibleMainNav,
  type NavItem,
} from "@/lib/navigation/nav-items";

// ---------------------------------------------------------------------------
// Мобильное меню разделов.
//
// Маршрут, а не выдвижная панель. Причина одна и практическая: на телефоне
// системная кнопка «назад» обязана закрывать меню, а не уводить со страницы, и
// маршрут даёт это бесплатно — панель потребовала бы перехвата истории вручную.
// Так же у Twenty: `MobileNavigationBar` ведёт на отдельный экран, а не открывает
// оверлей.
//
// Разделы берутся из `lib/navigation/nav-items` — того же модуля, что и сайдбар.
// Дублировать списки здесь означало бы, что скрытый в сайдбаре раздел останется
// видимым в меню, и пользователь получит «нет доступа» по ссылке из меню.
//
// Страница видна и на десктопе, если открыть адрес напрямую: скрывать её по
// ширине незачем — это обычный список ссылок, а не мобильная копия интерфейса.
// ---------------------------------------------------------------------------

function NavSection({ title, items }: { title: string; items: readonly NavItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="space-y-1">
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[#888888]">
        {title}
      </h2>
      <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0] shadow-2xs">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            // `py-3` даёт область нажатия около 48px — выше минимума 44px.
            className="flex items-center gap-3 px-4 py-3 text-[13px] text-[#111111] transition-colors hover:bg-[#fafafa]"
          >
            <item.icon className="h-4 w-4 shrink-0 text-[#666666]" />
            <span className="truncate">{item.label}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function MenuPage() {
  const { tenant, user, logout } = useAuth();
  const { data: liveModules } = useTenantModules(tenant?.tenantId ?? null);
  const { data: profile } = useProfile();

  const installedSlugs = useMemo(
    () => new Set((liveModules ?? []).map((module) => module.slug)),
    [liveModules],
  );

  // `null`, пока сессия восстанавливается: скрывать пункты в этот момент нельзя,
  // иначе меню мигает при загрузке. Правило то же, что в сайдбаре, — оно и лежит
  // в общем модуле.
  const permissions = user?.permissions ?? null;

  const mainNav = visibleMainNav(installedSlugs, permissions);
  const channelNav = visibleChannelNav(installedSlugs, permissions);
  const isPlatformOwner = user?.platform_role === "platform_owner";
  const [createTenantOpen, setCreateTenantOpen] = useState(false);
  const [switchingSlug, setSwitchingSlug] = useState<string | null>(null);

  const { data: workspacesData } = useWorkspaces();
  const currentSlug = tenant?.slug ?? "";

  const workspaces = useMemo(() => {
    if (workspacesData && workspacesData.length > 0) return workspacesData;
    if (currentSlug) {
      return [
        {
          id: tenant?.tenantId ?? "current",
          name: tenant?.tenantName ?? "Рабочее пространство",
          slug: currentSlug,
          plan: tenant?.plan ?? "",
          status: "active",
          is_current: true,
          is_parent: false,
          role: user?.role ?? "member",
        },
      ];
    }
    return [];
  }, [workspacesData, currentSlug, tenant, user]);

  const handleSwitchWorkspace = async (targetSlug: string) => {
    if (targetSlug === currentSlug) return;
    try {
      setSwitchingSlug(targetSlug);
      await switchWorkspace(targetSlug, currentSlug, user?.email, user?.name);
    } catch (err) {
      console.error("Не удалось переключить организацию", err);
      setSwitchingSlug(null);
    }
  };

  const canCreateTenant =
    user?.role === "partner" ||
    user?.role === "owner" ||
    user?.role === "admin" ||
    user?.platform_role === "platform_owner" ||
    Boolean(user?.permissions?.has("tenant:admin"));

  const displayName = profile?.name ?? user?.name ?? "";
  const displayEmail = profile?.email ?? user?.email ?? "";
  const avatarUrl = profile?.avatarUrl ?? null;

  return (
    <div className="space-y-5 pb-4">
      {/* Brand Header */}
      <div className="flex items-center justify-between px-1 pt-1">
        <Logo size="sm" href="/dashboard" />
      </div>

      {/* Блок пользователя: на десктопе он живёт в нижней части сайдбара. */}
      <Link
        href="/settings/profile"
        className="flex items-center gap-3 rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-3 shadow-2xs transition-colors hover:bg-[#fafafa]"
      >
        {avatarUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- аватар приходит base64 из профиля
          <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#4a38f5]/10 text-xs font-bold text-[#4a38f5]">
            {userInitials(displayName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-[#111111]">{displayName}</p>
          <p className="truncate text-xs text-[#666666]">{displayEmail}</p>
        </div>
      </Link>

      <NavSection title="Рабочее пространство" items={mainNav} />

      {channelNav.length > 0 && <NavSection title="Каналы связи" items={channelNav} />}

      {/* Список организаций / переключатель пространств */}
      {workspaces.length > 0 && (
        <section className="space-y-1">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[#888888]">
            Организации
          </h2>
          <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0] shadow-2xs">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                type="button"
                disabled={switchingSlug !== null}
                onClick={() => handleSwitchWorkspace(ws.slug)}
                className={cn(
                  "flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-[#fafafa]",
                  ws.is_current && "bg-[#4a38f5]/[0.03]",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-xs font-semibold",
                      ws.is_current
                        ? "bg-[#4a38f5] text-white"
                        : "bg-black/[0.07] text-[#111111]",
                    )}
                  >
                    {ws.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "truncate text-[13px]",
                        ws.is_current
                          ? "font-semibold text-[#111111]"
                          : "font-medium text-[#333333]",
                      )}
                    >
                      {ws.name}
                    </p>
                    <p className="truncate text-xs text-[#888888]">
                      {ws.slug}.getvoxly.ru
                    </p>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  {switchingSlug === ws.slug ? (
                    <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
                  ) : ws.is_current ? (
                    <Check className="h-4 w-4 text-[#4a38f5]" />
                  ) : (
                    <span className="rounded-[4px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                      {ws.status === "active" ? "активен" : ws.status}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Разделы компании: те же, что в выпадающем меню сайдбара, но с описанием —
          на экране меню место есть, а подпись объясняет назначение раздела. */}
      <section className="space-y-1">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[#888888]">
          {tenant?.tenantName ?? "Компания"}
        </h2>
        <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0] shadow-2xs">
          {TENANT_MENU.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[#fafafa]"
            >
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#666666]" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-[#111111]">{item.label}</span>
                <span className="block truncate text-xs text-[#666666]">{item.description}</span>
              </span>
            </Link>
          ))}
          {canCreateTenant && (
            <button
              type="button"
              onClick={() => setCreateTenantOpen(true)}
              className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[#fafafa]"
            >
              <PlusCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#4a38f5]" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-[#111111]">
                  Создать компанию
                  <span className="rounded-[4px] bg-[#4a38f5]/10 px-1.5 py-0.2 text-[10px] font-semibold text-[#4a38f5]">
                    Партнёр
                  </span>
                </span>
                <span className="block truncate text-xs text-[#666666]">
                  Новый клиентский портал
                </span>
              </span>
            </button>
          )}
        </div>
      </section>

      {/* Платформенные разделы — по `platform_role`, а не по тенантной роли:
          иначе владелец любого арендатора увидел бы управление платформой. */}
      {isPlatformOwner && (
        <section className="space-y-1">
          <h2 className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-[#888888]">
            <ShieldCheck className="h-3 w-3" />
            Управление платформой
          </h2>
          <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0] shadow-2xs">
            {PLATFORM_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3 text-[13px] text-[#111111] transition-colors hover:bg-[#fafafa]"
              >
                <item.icon className="h-4 w-4 shrink-0 text-[#666666]" />
                <span className="truncate">{item.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-1">
        <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0] shadow-2xs">
          <Link
            href="/integrations"
            className="flex items-center gap-3 px-4 py-3 text-[13px] text-[#111111] transition-colors hover:bg-[#fafafa]"
          >
            <Plug className="h-4 w-4 shrink-0 text-[#666666]" />
            Интеграции
          </Link>
          {/*
            Выход без диалога подтверждения, в отличие от сайдбара: там кнопка
            стоит рядом с пунктами меню и нажимается случайно, а здесь это
            последняя строка отдельного экрана, до которой нужно долистать.
          */}
          <button
            type="button"
            onClick={() => {
              void logout().finally(() => {
                window.location.href = "/login";
              });
            }}
            className="flex w-full items-center gap-3 px-4 py-3 text-[13px] text-rose-600 transition-colors hover:bg-rose-50"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Выйти
          </button>
        </div>
      </section>

      <CreateTenantDialog
        open={createTenantOpen}
        onClose={() => setCreateTenantOpen(false)}
      />
    </div>
  );
}
