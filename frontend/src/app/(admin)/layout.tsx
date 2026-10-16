import type { Metadata } from "next";
import Link from "next/link";
import { Shield, ChevronLeft, Building2, Users } from "lucide-react";

export const metadata: Metadata = {
  title: "Platform Admin — GETVOXLY",
};

// AuthProvider lives in the root layout — see app/layout.tsx.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-slate-950">
      <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-slate-800 bg-slate-900 px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rose-500 text-white">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <span className="text-sm font-bold tracking-tight text-slate-100">GETVOXLY</span>
            <span className="ml-2 rounded bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-400">
              ADMIN
            </span>
          </div>
        </div>

        {/* Route is /tenants — (admin) is a route group and not part of the URL. */}
        <nav className="flex items-center gap-1 ml-8">
          <Link
            href="/tenants"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <Building2 className="h-4 w-4" />
            Tenants
          </Link>
          <Link
            href="/settings/referral"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <Users className="h-4 w-4" />
            Referrals
          </Link>
        </nav>

        <div className="flex-1" />

        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {children}
      </main>
    </div>
  );
}