import Link from "next/link";
import { LogIn } from "lucide-react";
import { Logo } from "@/components/brand";

export function Footer() {
  return (
    <footer className="border-t border-[#e5e5e5] bg-[#fafafa] px-6 py-12 dark:border-[#27272a] dark:bg-[#18181b] transition-colors">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-2">
          <Logo size="sm" href="/" />
          <span className="text-[13px] text-[#666666] dark:text-[#a1a1aa]">— модульная CRM-платформа</span>
        </div>

        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-2 text-sm font-medium text-[#111111] shadow-2xs transition-all duration-200 hover:border-[#cccccc] hover:bg-[#f0f0f0] focus-visible:ring-2 focus-visible:ring-[#4a38f5]/30 active:scale-[0.97] dark:border-[#27272a] dark:bg-[#111111] dark:text-white dark:hover:bg-[#1f1f23]"
        >
          <LogIn className="h-4 w-4" />
          Войти в аккаунт
        </Link>
      </div>
    </footer>
  );
}
