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

/**
 * Маршруты соответствуют существующим страницам.
 *
 * Прежде здесь стояли `/deals/new`, `/modules/service-center/new` и
 * `/modules/ai-bots/new` — ни одного такого маршрута в приложении нет, все три
 * пункта вели на 404. Приёмка открывается параметром `?create=1`, который уже
 * читает страница ремонтов.
 */
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
      {/*
        `px-4` вместо `px-6` и `gap-2` вместо `gap-4` на мобильном: на 360px
        каждые сэкономленные 4px отступа достаются кнопкам, которые иначе уезжают
        за край экрана.
      */}
      <header className="sticky top-0 z-30 flex h-16 items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 md:gap-4 md:px-6">
        {/*
          Search / Command Palette Trigger.

          `min-w-0` обязателен: без него flex-элемент не сжимается ниже размера
          своего содержимого («Поиск сделок, контактов, наряд-заказов…» плюс ⌘K —
          около 374px), и на 360px экране правая группа кнопок уезжала за край.
          `max-w-md` тут не помогал — он ограничивает сверху, а не снизу.

          Само поле скрыто на мобильном: его роль там играет кнопка «Поиск» в
          нижнем баре, а полоса с ⌘K занимала бы всю ширину шапки, вытесняя
          «Создать» и уведомления. Клавиатурного сокращения на телефоне нет.
        */}
        <div className="relative hidden min-w-0 flex-1 max-w-md md:block">
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex w-full items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 py-2 pl-3 pr-4 text-left text-sm text-slate-500 transition-colors hover:border-slate-600 hover:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Поиск сделок, контактов, наряд-заказов...</span>
            <kbd className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-500">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Логотип на мобильном — вместо поля поиска: без него шапка пуста слева. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 md:hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-slate-950">
            <span className="text-xs font-black">G</span>
          </div>
          <span className="truncate text-sm font-semibold text-slate-100">
            {displayTenant.tenantName}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {/* Quick Create */}
          <div className="relative" ref={quickActionRef}>
            <button
              type="button"
              onClick={() => setQuickActionOpen((prev) => !prev)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                quickActionOpen
                  ? "bg-amber-500 text-slate-950"
                  : "bg-amber-500/10 text-amber-400 hover:bg-amber-500/20",
              )}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Создать</span>
            </button>
            {quickActionOpen && (
              <div className="absolute right-0 top-full mt-2 w-56 rounded-xl border border-slate-800 bg-slate-900 p-1.5 shadow-xl">
                {visibleActions.map((action) => (
                  <a
                    key={action.href}
                    href={action.href}
                    onClick={() => setQuickActionOpen(false)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-slate-300 transition-colors hover:bg-slate-800 hover:text-slate-100"
                  >
                    <action.icon className="h-4 w-4 text-slate-400" />
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
            className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
            title={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
            aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
          >
            {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>
      </header>

      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </>
  );
}
