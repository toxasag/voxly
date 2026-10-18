"use client";

import { useState, useRef, useEffect } from "react";
import {
  Search,
  Plus,
  Sun,
  Moon,
  Handshake,
  Wrench,
  Bot,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isModuleInstalled } from "@/lib/context/tenant";
import { useAuth } from "@/lib/auth/use-auth";
import type { ModuleSlug } from "@/types";
import { useTheme } from "@/lib/hooks/use-theme";
import { CommandMenu } from "@/components/shared/CommandMenu";
import { NotificationDropdown } from "@/components/layout/NotificationDropdown";

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
  const { tenant } = useAuth();
  const displayTenant = tenant ?? { tenantName: "", plan: "", installedModules: [] };
  const { theme, toggleTheme } = useTheme();
  const [quickActionOpen, setQuickActionOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);

  const quickActionRef = useRef<HTMLDivElement>(null);

  const visibleActions = QUICK_ACTIONS.filter((action) => {
    if (!action.moduleSlug) return true;
    return isModuleInstalled(displayTenant.installedModules, action.moduleSlug);
  });

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (quickActionRef.current && !quickActionRef.current.contains(e.target as Node)) {
        setQuickActionOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <>
      <header className="sticky top-0 z-30 flex h-11 items-center gap-2 border-b border-[#e5e5e5] bg-white px-4 md:gap-3 md:px-5">
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
          <span className="truncate text-[13px] font-semibold text-[#111111]">
            {displayTenant.tenantName}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 ml-auto">
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
        </div>
      </header>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}
