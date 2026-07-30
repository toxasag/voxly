'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Gift,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  MessageSquare,
  Search,
  Send,
  Shield,
  Smartphone,
  Sparkles,
  UserRound,
  Bell,
  HelpCircle,
  Building2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { readSessionClaims } from '@/lib/session';
import { useEffect, useMemo, useState } from 'react';

type NavItem = {
  href: string;
  label: string;
  match: (pathname: string, hash?: string) => boolean;
  icon: React.ComponentType<{ className?: string }>;
  ownerOnly?: boolean;
};

const CABINET_NAV: NavItem[] = [
  {
    href: '/dashboard',
    label: 'Дашборд',
    match: (p) => p === '/dashboard',
    icon: LayoutDashboard,
    ownerOnly: true,
  },
  {
    href: '/dashboard/crm',
    label: 'CRM портал',
    match: (p) => p.startsWith('/dashboard/crm'),
    icon: Building2,
    ownerOnly: false,
  },
  {
    href: '/dashboard/bots',
    label: 'Gift-боты',
    match: (p) => p.startsWith('/dashboard/bots'),
    icon: Gift,
    ownerOnly: true,
  },
  {
    href: '/dashboard/mailing',
    label: 'Рассылка',
    match: (p) => p.startsWith('/dashboard/mailing'),
    icon: Send,
    ownerOnly: true,
  },
  {
    href: '/dashboard/ai',
    label: 'Telegram Business',
    match: (p) => {
      if (p === '/dashboard/ai') return true;
      if (!p.startsWith('/dashboard/ai/')) return false;
      if (p.startsWith('/dashboard/ai/gramjs')) return false;
      if (p.startsWith('/dashboard/ai/whatsapp')) return false;
      if (p.startsWith('/dashboard/ai/agents')) return false;
      return true;
    },
    icon: MessageSquare,
    ownerOnly: true,
  },
  {
    href: '/dashboard/ai/whatsapp',
    label: 'WhatsApp',
    match: (p) => p.startsWith('/dashboard/ai/whatsapp'),
    icon: Smartphone,
    ownerOnly: true,
  },
  {
    href: '/dashboard/ai/agents',
    label: 'AI-агенты',
    match: (p) => p.startsWith('/dashboard/ai/agents'),
    icon: Sparkles,
    ownerOnly: true,
  },
  {
    href: '/dashboard/ai/gramjs',
    label: 'Личный Telegram',
    match: (p) => p.startsWith('/dashboard/ai/gramjs'),
    icon: UserRound,
    ownerOnly: true,
  },
];

/** Super-admin only — no cabinet product links. */
const ADMIN_NAV: NavItem[] = [
  {
    href: '/admin',
    label: 'Обзор',
    match: (p) => p === '/admin' || p === '/admin/',
    icon: Shield,
  },
  {
    href: '/admin/crm',
    label: 'CRM портал',
    match: (p) => p.startsWith('/admin/crm'),
    icon: Building2,
  },
];

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
  const [tenantRole, setTenantRole] = useState<string | undefined>(undefined);
  const [hash, setHash] = useState('');

  const isAdminShell = pathname.startsWith('/admin');

  useEffect(() => {
    const claims = readSessionClaims();
    setTenantRole(claims?.tenantRole);
  }, [pathname]);

  useEffect(() => {
    const syncHash = () => setHash(window.location.hash.replace(/^#/, ''));
    syncHash();
    window.addEventListener('hashchange', syncHash);
    return () => window.removeEventListener('hashchange', syncHash);
  }, [pathname]);

  const isMember = tenantRole === 'member';
  const navItems = useMemo(() => {
    if (isAdminShell) return ADMIN_NAV;
    return isMember ? CABINET_NAV.filter((item) => !item.ownerOnly) : CABINET_NAV;
  }, [isAdminShell, isMember]);

  useEffect(() => {
    if (!isMember || isAdminShell) return;
    if (pathname.startsWith('/dashboard') && !pathname.startsWith('/dashboard/crm')) {
      router.replace('/dashboard/crm');
    }
  }, [isMember, isAdminShell, pathname, router]);

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

  const homeHref = isAdminShell ? '/admin' : isMember ? '/dashboard/crm' : '/dashboard';
  const brandLabel = isAdminShell ? 'Voxly Admin' : 'Voxly';

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav
      className="flex flex-col gap-1 px-2"
      aria-label={isAdminShell ? 'Навигация супер-админки' : 'Основная навигация'}
    >
      {navItems.map((item) => {
        const active = item.match(pathname, hash);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            onClick={() => {
              if (item.href.includes('#')) {
                setHash(item.href.split('#')[1] || '');
              } else {
                setHash('');
              }
              onNavigate?.();
            }}
            className={cn(
              'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              active
                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
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
      <div className="min-h-screen bg-background">
        <main className={cn('mx-auto animate-in px-5 py-8 sm:px-6 sm:py-10', width, className)}>
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background lg:flex">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
        <Link
          href={homeHref}
          className="mb-4 px-5 pt-5 text-sm font-semibold tracking-tight text-sidebar-primary"
        >
          {brandLabel}
        </Link>
        <ScrollArea className="flex-1">
          <NavLinks />
        </ScrollArea>
        <Separator className="mx-3 my-3" />
        <div className="space-y-1 px-2 pb-4">
          {isAdminShell ? (
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2" asChild>
              <Link href="/dashboard">
                <LayoutDashboard className="h-4 w-4" />
                В кабинет
              </Link>
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Выйти
          </Button>
        </div>
      </aside>

      {/* Header & Main Desktop */}
      <div className="hidden h-screen flex-1 flex-col lg:flex">
        <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-border bg-background px-6 py-3">
          <div className="flex flex-1 items-center gap-6">
            <div className="flex items-center gap-2 rounded-lg bg-neutral-bg-subtle px-4 py-2.5 text-sm text-neutral-text-muted">
              <Search className="h-4 w-4" />
              <span className="hidden sm:inline">Поиск</span>
              <kbd className="ml-auto hidden rounded border border-neutral-border-light bg-white px-2 py-1 text-xs text-neutral-text-placeholder sm:inline-block">
                Ctrl K
              </kbd>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Bell className="h-5 w-5" />
            </Button>
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <HelpCircle className="h-5 w-5" />
            </Button>
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-dark text-sm font-semibold text-white">
              AC
            </div>
          </div>
        </div>

        <main className={cn('min-w-0 flex-1 overflow-auto px-6 py-8 sm:px-8 sm:py-10', className)}>
          <div className={cn('mx-auto', width)}>{children}</div>
        </main>
      </div>

      {/* Mobile & Tablet Layout */}
      <div className="flex flex-1 flex-col lg:hidden">
        <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4">
          <Link href={homeHref} className="text-sm font-semibold tracking-tight text-primary">
            {brandLabel}
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Bell className="h-4 w-4" />
            </Button>
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Открыть меню">
                  <Menu className="h-4 w-4" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
                <SheetHeader className="border-b border-sidebar-border px-4 py-4 text-left">
                  <SheetTitle className="text-sm font-semibold text-sidebar-primary">
                    {brandLabel}
                  </SheetTitle>
                </SheetHeader>
                <div className="flex h-[calc(100%-3.5rem)] flex-col py-4">
                  <ScrollArea className="flex-1">
                    <NavLinks onNavigate={() => setMobileOpen(false)} />
                  </ScrollArea>
                  <Separator className="mx-3 my-3" />
                  <div className="space-y-1 px-2">
                    {isAdminShell ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start gap-2"
                        asChild
                      >
                        <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                          <LayoutDashboard className="h-4 w-4" />
                          В кабинет
                        </Link>
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-2"
                      onClick={logout}
                    >
                      <LogOut className="h-4 w-4" />
                      Выйти
                    </Button>
                  </div>
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>

        <main
          className={cn(
            'min-w-0 flex-1 overflow-auto animate-in px-5 py-8 sm:px-6 sm:py-10',
            className,
          )}
        >
          <div className={cn('mx-auto', width)}>{children}</div>
        </main>
      </div>
    </div>
  );
}

export function LoadingState({ label = 'Загрузка…' }: { label?: string }) {
  return (
    <div
      className="flex min-h-[40vh] items-center justify-center text-muted-foreground animate-fade"
      role="status"
      aria-live="polite"
    >
      <Loader2 className="mr-2 h-4 w-4 animate-spin text-primary" aria-hidden />
      {label}
    </div>
  );
}
