import Link from "next/link";
import { LogIn } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-slate-800 px-6 py-12">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 sm:flex-row">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold text-slate-100">GETVOXLY</span>
          <span className="text-sm text-slate-500">— модульная CRM-платформа</span>
        </div>

        <Link
          href="/login"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-5 py-2 text-sm font-medium text-slate-100 transition-all duration-200 hover:border-slate-600 hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400/30 active:scale-[0.97]"
        >
          <LogIn className="h-4 w-4" />
          Войти в аккаунт
        </Link>
      </div>
    </footer>
  );
}
