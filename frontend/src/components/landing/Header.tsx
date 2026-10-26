"use client";

import Link from "next/link";
import { Sun, Moon, LogIn } from "lucide-react";
import { Logo } from "@/components/brand";
import { useTheme } from "@/lib/hooks/use-theme";

export function Header() {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#e5e5e5] bg-white/90 backdrop-blur-md transition-colors dark:border-[#27272a] dark:bg-[#111111]/90">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        {/* Brand Logo */}
        <Logo size="sm" href="/" />

        {/* Center Navigation */}
        <nav className="hidden items-center gap-6 sm:flex">
          <Link
            href="#features"
            className="text-[13px] font-medium text-[#666666] transition-colors hover:text-[#111111] dark:text-[#a1a1aa] dark:hover:text-white"
          >
            Возможности
          </Link>
          <Link
            href="#pricing"
            className="text-[13px] font-medium text-[#666666] transition-colors hover:text-[#111111] dark:text-[#a1a1aa] dark:hover:text-white"
          >
            Тарифы
          </Link>
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#666666] transition-colors hover:bg-black/[0.04] hover:text-[#111111] dark:text-[#a1a1aa] dark:hover:bg-white/[0.08] dark:hover:text-white"
            title={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
            aria-label={theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему"}
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <Link
            href="/login"
            className="hidden items-center gap-1.5 text-[13px] font-medium text-[#666666] transition-colors hover:text-[#111111] dark:text-[#a1a1aa] dark:hover:text-white sm:inline-flex"
          >
            <LogIn className="h-3.5 w-3.5" />
            Войти
          </Link>

          <Link
            href="/register"
            className="inline-flex h-8 items-center justify-center rounded-[8px] bg-[#4a38f5] px-3.5 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] active:scale-[0.98]"
          >
            Регистрация
          </Link>
        </div>
      </div>
    </header>
  );
}
