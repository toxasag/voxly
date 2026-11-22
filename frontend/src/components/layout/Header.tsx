"use client";

import { useState, useRef, useMemo } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Search,
  Plus,
  Sun,
  Moon,
  Handshake,
  Wrench,
  Bot,
  Building2,
  ArrowUpRight,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useClickOutside } from "@/lib/hooks/use-click-outside";
import { isModuleInstalled } from "@/lib/context/tenant";
import { useAuth } from "@/lib/auth/use-auth";
import type { ModuleSlug } from "@/types";
import { useTheme } from "@/lib/hooks/use-theme";
import { CommandMenu } from "@/components/shared/CommandMenu";
import { NotificationDropdown } from "@/components/layout/NotificationDropdown";
import { UserNavDropdown } from "@/components/layout/UserNavDropdown";
import { useWorkspaces, switchWorkspace } from "@/lib/api/use-workspaces";
import { Logo } from "@/components/brand";

interface QuickAction {
  label: string;
  icon: LucideIcon;
  href: string;
  moduleSlug?: ModuleSlug;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Новая сделка", icon: Handshake, href: "/crm/deals" },
  {
    label: "Новая приёмка",
    icon: Wrench,
    href: "/repairs?create=1",
    moduleSlug: "service_center",
  },
  { label: "Новый AI-бот", icon: Bot, href: "/modules/ai-bots", moduleSlug: "ai_bots" },
];

export function Header() {
  const pathname = usePathname();
  const { user, tenant, impersonator } = useAuth();
  const displayTenant = tenant ?? { tenantName: "", slug: "", plan: "", is_partner: false, installedModules: [] };
  const { data: workspacesData } = useWorkspaces();
  const { theme, toggleTheme } = useTheme();
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [isReturning, setIsReturning] = useState(false);

  const quickActionRef = useRef<HTMLDivElement>(null);

  const parentWorkspace = useMemo(
    () => workspacesData?.find((ws) => ws.is_parent) ?? null,
    [workspacesData],
  );

  const isPlatformOwner = user?.platform_role === "platform_owner";
  const isPartner =
    Boolean(user?.is_partner) ||
    Boolean(tenant?.is_partner) ||
    Boolean(displayTenant.is_partner) ||
    user?.role === "partner" ||
    isPlatformOwner ||
    Boolean(impersonator?.is_partner);

  const isPrivilegedUser =
    isPlatformOwner ||
    isPartner ||
    user?.role === "owner" ||
    user?.role === "admin" ||
    user?.role === "manager" ||
    Boolean(impersonator);

  const handleReturnToPartner = async () => {
    if (!parentWorkspace || isReturning) return;
    setIsReturning(true);
    try {
      await switchWorkspace(
        parentWorkspace.slug,
        displayTenant.slug || "",
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

  const visibleActions = QUICK_ACTIONS.filter((action) => {
    if (!action.moduleSlug) return true;
    return isModuleInstalled(displayTenant.installedModules, action.moduleSlug);
  });

  useClickOutside(quickActionRef, () => setQuickActionOpen(false), quickActionOpen);

  const isPartnerPortal = Boolean(displayTenant.is_partner || tenant?.is_partner);
  const isPartnerRoute = pathname?.startsWith("/partner");

  return (
    <>
      <header className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-[#e5e5e5] bg-white px-4 md:gap-3 md:px-5 dark:border-[#27272a] dark:bg-[#111111] transition-colors">
        {/* Search / Command Palette Trigger */}
        <div className="relative hidden min-w-0 flex-1 max-w-sm md:block">
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex h-7 w-full items-center gap-2 rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-2.5 text-left text-[12px] text-[#888888] transition-colors hover:border-[#cccccc] hover:text-[#444444]"
          >
            <Search className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Поиск сделок, контактов, наряд-заказов...</span>
            <kbd className="shrink-0 rounded bg-black/[0.05] px-1 py-0.2 text-[10px] text-[#888888]">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Mobile brand text */}
        <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
          <Logo variant="mark" size="xs" href="/dashboard" />
          <span className="truncate text-[13px] font-semibold text-[#111111] dark:text-white">
            {displayTenant.tenantName}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 ml-auto">
          {/* CRM RETURN BRIDGE: Прямая кнопка возврата в кабинет партнёра (десктоп и мобильный) */}
          {parentWorkspace && isPrivilegedUser && (
            <button
              type="button"
              onClick={handleReturnToPartner}
              disabled={isReturning}
              className="flex h-7 items-center gap-1.5 rounded-lg border border-[#4a38f5]/25 bg-[#4a38f5]/10 px-2.5 text-[12px] font-semibold text-[#4a38f5] shadow-2xs transition-colors hover:bg-[#4a38f5]/15 focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/30 cursor-pointer"
              title={`Вернуться в кабинет партнёра (${parentWorkspace.name})`}
            >
              {isReturning ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Building2 className="h-3.5 w-3.5 text-[#4a38f5]" />
              )}
              <span className="hidden sm:inline">Кабинет партнёра</span>
              <ArrowUpRight className="h-3 w-3 text-[#4a38f5]/70" />
            </button>
          )}

          {/* Быстрый переключатель между партнерским кабинетом и CRM-панелью для партнера */}
          {isPartnerPortal && !parentWorkspace && (
            isPartnerRoute ? (
              <Link
                href="/crm/deals"
                className="flex h-7 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-2.5 text-[12px] font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#f7f7f7]"
                title="Перейти в панель CRM (Сделки)"
              >
                <Handshake className="h-3.5 w-3.5 text-[#666666]" />
                <span className="hidden sm:inline">В CRM</span>
              </Link>
            ) : (
              <Link
                href="/partner"
                className="flex h-7 items-center gap-1.5 rounded-lg border border-[#4a38f5]/25 bg-[#4a38f5]/10 px-2.5 text-[12px] font-medium text-[#4a38f5] shadow-2xs transition-colors hover:bg-[#4a38f5]/15"
                title="Перейти в кабинет партнёра"
              >
                <Building2 className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span className="hidden sm:inline">Кабинет партнёра</span>
              </Link>
            )
          )}

          {/* Quick Create Button */}
          <div className="relative" ref={quickActionRef}>
            <button
              type="button"
              onClick={() => setQuickActionOpen((prev) => !prev)}
              className={cn(
                "flex h-7 items-center gap-1 rounded-lg border border-[#e5e5e5] px-2.5 text-[12px] font-medium text-[#111111] shadow-2xs transition-colors",
                quickActionOpen ? "bg-[#f4f4f5]" : "bg-white hover:bg-[#f7f7f7]",
              )}
            >
              <Plus className="h-3.5 w-3.5 text-[#666666]" />
              <span className="hidden sm:inline">Создать</span>
            </button>
            {quickActionOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-[#e5e5e5] bg-white p-1 shadow-lg">
                {visibleActions.map((action) => (
                  <a
                    key={action.href}
                    href={action.href}
                    onClick={() => setQuickActionOpen(false)}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] text-[#333333] transition-colors hover:bg-black/[0.04] hover:text-[#000000]"
                  >
                    <action.icon className="h-4 w-4 text-[#666666]" />
                    {action.label}
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Notifications */}
          <NotificationDropdown />

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[#666666] transition-colors hover:bg-black/[0.04] hover:text-[#111111]"
            title={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
            aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {/* User Profile & Navigation Bridge Dropdown */}
          <UserNavDropdown />
        </div>
      </header>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}
