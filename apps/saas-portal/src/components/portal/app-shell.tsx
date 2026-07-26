'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Gift,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Smartphone,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV = [
  {
    href: '/dashboard',
    label: 'Дашборд',
    match: (p: string) => p === '/dashboard',
    icon: LayoutDashboard,
  },
  {
    href: '/dashboard/bots',
    label: 'Gift-боты',
    match: (p: string) => p.startsWith('/dashboard/bots'),
    icon: Gift,
  },
  {
    href: '/dashboard/ai',
    label: 'Telegram Business',
    match: (p: string) => {
      if (p === '/dashboard/ai') return true;
      if (!p.startsWith('/dashboard/ai/')) return false;
      if (p.startsWith('/dashboard/ai/gramjs')) return false;
      if (p.startsWith('/dashboard/ai/whatsapp')) return false;
      if (p.startsWith('/dashboard/ai/agents')) return false;
      return true; // /dashboard/ai/[botId]
    },
    icon: MessageSquare,
  },
  {
    href: '/dashboard/ai/whatsapp',
    label: 'WhatsApp',
    match: (p: string) => p.startsWith('/dashboard/ai/whatsapp'),
    icon: Smartphone,
  },
  {
    href: '/dashboard/ai/agents',
    label: 'AI-агенты',
    match: (p: string) => p.startsWith('/dashboard/ai/agents'),
    icon: Sparkles,
  },
  {
    href: '/dashboard/ai/gramjs',
    label: 'Личный Telegram',
    match: (p: string) => p.startsWith('/dashboard/ai/gramjs'),
    icon: UserRound,
  },
] as const;

export function AppShell({
  children,
  maxWidth = '5xl',
  showNav = true,
  className,
}: {
  children: React.ReactNode;
  maxWidth?: '2xl' | '3xl' | '5xl' | '6xl';
  showNav?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  const width =
    maxWidth === '2xl'
      ? 'max-w-2xl'
      : maxWidth === '3xl'
        ? 'max-w-3xl'
        : maxWidth === '6xl'
          ? 'max-w-6xl'
          : 'max-w-5xl';

  const logout = () => {
    localStorage.removeItem('voxly_token');
    router.push('/');
  };

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-0.5" aria-label="Основная навигация">
      {NAV.map((item) => {
        const active = item.match(pathname);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-2.5 rounded-[18px] px-3 py-2 text-sm transition-colors duration-[var(--duration-fast)]',
              'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline',
              active
                ? 'bg-paper font-medium text-ink shadow-[inset_0_0_0_1px_#e5e5e5]'
                : 'text-mid-gray hover:bg-canvas hover:text-ink',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  if (!showNav) {
    return (
      <div className="min-h-screen bg-canvas">
        <main className={cn('mx-auto animate-in px-5 py-8 sm:px-6 sm:py-10', width, className)}>
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-hairline bg-surface-alt px-3 py-4 lg:flex">
        <Link
          href="/dashboard"
          className="mb-6 px-3 text-sm font-semibold tracking-tight text-ink"
        >
          Voxly
        </Link>
        <div className="flex-1 overflow-y-auto">
          <NavLinks />
        </div>
        <Button variant="ghost" size="sm" className="mt-4 justify-start gap-2" onClick={logout}>
          <LogOut className="h-4 w-4" />
          Выйти
        </Button>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-40 flex h-12 items-center justify-between border-b border-hairline bg-surface-alt px-4 lg:hidden">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight text-ink">
          Voxly
        </Link>
        <Button
          variant="ghost"
          size="icon"
          aria-label={mobileOpen ? 'Закрыть меню' : 'Открыть меню'}
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
        </Button>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-ink/20"
            aria-label="Закрыть"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface-alt px-3 py-4 shadow-[var(--shadow-subtle)]">
            <div className="mb-4 flex items-center justify-between px-3">
              <span className="text-sm font-semibold">Voxly</span>
              <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </div>
            <Button variant="ghost" size="sm" className="justify-start gap-2" onClick={logout}>
              <LogOut className="h-4 w-4" />
              Выйти
            </Button>
          </aside>
        </div>
      )}

      <main className={cn('min-w-0 flex-1 animate-in px-5 py-8 sm:px-6 sm:py-10', className)}>
        <div className={cn('mx-auto', width)}>{children}</div>
      </main>
    </div>
  );
}

export function LoadingState({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center text-mid-gray animate-fade"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
