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
  Send,
  Smartphone,
  Sparkles,
  UserRound,
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
import { useState } from 'react';

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
    href: '/dashboard/mailing',
    label: 'Рассылка',
    match: (p: string) => p.startsWith('/dashboard/mailing'),
    icon: Send,
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
      return true;
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
    <nav className="flex flex-col gap-1 px-2" aria-label="Основная навигация">
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
          href="/dashboard"
          className="mb-4 px-5 pt-5 text-sm font-semibold tracking-tight text-sidebar-primary"
        >
          Voxly
        </Link>
        <ScrollArea className="flex-1">
          <NavLinks />
        </ScrollArea>
        <Separator className="mx-3 my-3" />
        <div className="px-2 pb-4">
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={logout}>
            <LogOut className="h-4 w-4" />
            Выйти
          </Button>
        </div>
      </aside>

      <div className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-background px-4 lg:hidden">
        <Link href="/dashboard" className="text-sm font-semibold tracking-tight text-primary">
          Voxly
        </Link>
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Открыть меню">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 bg-sidebar p-0 text-sidebar-foreground">
            <SheetHeader className="border-b border-sidebar-border px-4 py-4 text-left">
              <SheetTitle className="text-sm font-semibold text-sidebar-primary">Voxly</SheetTitle>
            </SheetHeader>
            <div className="flex h-[calc(100%-3.5rem)] flex-col py-4">
              <ScrollArea className="flex-1">
                <NavLinks onNavigate={() => setMobileOpen(false)} />
              </ScrollArea>
              <Separator className="mx-3 my-3" />
              <div className="px-2">
                <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={logout}>
                  <LogOut className="h-4 w-4" />
                  Выйти
                </Button>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <main className={cn('min-w-0 flex-1 animate-in px-5 py-8 sm:px-6 sm:py-10', className)}>
        <div className={cn('mx-auto', width)}>{children}</div>
      </main>
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
