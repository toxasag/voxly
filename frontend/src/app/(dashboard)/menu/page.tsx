"use client";

import { useMemo } from "react";
import Link from "next/link";
import { LogOut, Plug, ShieldCheck } from "lucide-react";

import { useAuth } from "@/lib/auth/use-auth";
import { useTenantModules } from "@/lib/api/use-tenant-modules";
import { useProfile } from "@/lib/api/use-profile";
import { userInitials } from "@/lib/api/use-tenant-users";
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
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800/70">
        {items.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            // `py-3` даёт область нажатия около 48px — выше минимума 44px.
            className="flex items-center gap-3 px-4 py-3 text-sm text-slate-200 transition-colors hover:bg-slate-800"
          >
            <item.icon className="h-4 w-4 shrink-0 text-slate-400" />
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

  const displayName = profile?.name ?? user?.name ?? "";
  const displayEmail = profile?.email ?? user?.email ?? "";
  const avatarUrl = profile?.avatarUrl ?? null;

  return (
    <div className="space-y-5 pb-4">
      {/* Блок пользователя: на десктопе он живёт в нижней части сайдбара. */}
      <Link
        href="/settings/profile"
        className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 transition-colors hover:bg-slate-800"
      >
        {avatarUrl !== null ? (
          // eslint-disable-next-line @next/next/no-img-element -- аватар приходит base64 из профиля
          <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#4a38f5]/10 text-sm font-bold text-amber-400">
            {userInitials(displayName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-100">{displayName}</p>
          <p className="truncate text-xs text-slate-500">{displayEmail}</p>
        </div>
      </Link>

      <NavSection title="Рабочее пространство" items={mainNav} />

      {channelNav.length > 0 && <NavSection title="Каналы связи" items={channelNav} />}

      {/* Разделы компании: те же, что в выпадающем меню сайдбара, но с описанием —
          на экране меню место есть, а подпись объясняет назначение раздела. */}
      <section className="space-y-1">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
          {tenant?.tenantName ?? "Компания"}
        </h2>
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800/70">
          {TENANT_MENU.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-slate-800"
            >
              <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-200">{item.label}</span>
                <span className="block truncate text-xs text-slate-500">{item.description}</span>
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Платформенные разделы — по `platform_role`, а не по тенантной роли:
          иначе владелец любого арендатора увидел бы управление платформой. */}
      {isPlatformOwner && (
        <section className="space-y-1">
          <h2 className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <ShieldCheck className="h-3 w-3" />
            Управление платформой
          </h2>
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800/70">
            {PLATFORM_NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-3 px-4 py-3 text-sm text-slate-200 transition-colors hover:bg-slate-800"
              >
                <item.icon className="h-4 w-4 shrink-0 text-slate-400" />
                <span className="truncate">{item.label}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-1">
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900 divide-y divide-slate-800/70">
          <Link
            href="/integrations"
            className="flex items-center gap-3 px-4 py-3 text-sm text-slate-200 transition-colors hover:bg-slate-800"
          >
            <Plug className="h-4 w-4 shrink-0 text-slate-400" />
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
            className="flex w-full items-center gap-3 px-4 py-3 text-sm text-rose-400 transition-colors hover:bg-rose-500/10"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Выйти
          </button>
        </div>
      </section>
    </div>
  );
}
