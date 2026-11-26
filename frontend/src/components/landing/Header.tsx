"use client";

import Link from "next/link";
import { LogIn } from "lucide-react";
import { Logo } from "@/components/brand";

export function Header() {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#e5e5e5] bg-white/90 backdrop-blur-md transition-colors">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        {/* Brand Logo */}
        <Logo size="sm" href="/" />

        {/* Center Navigation */}
        <nav className="hidden items-center gap-6 sm:flex">
          <Link
            href="#features"
            className="text-[13px] font-medium text-[#666666] transition-colors hover:text-[#111111]"
          >
            Возможности
          </Link>
          <Link
            href="#pricing"
            className="text-[13px] font-medium text-[#666666] transition-colors hover:text-[#111111]"
          >
            Тарифы
          </Link>
        </nav>

        {/* Right Actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="hidden items-center gap-1.5 text-[13px] font-medium text-[#666666] transition-colors hover:text-[#111111] sm:inline-flex"
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
