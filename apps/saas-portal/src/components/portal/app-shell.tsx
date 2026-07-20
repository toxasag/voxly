'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/dashboard', label: 'Кабинет', match: (p: string) => p === '/dashboard' },
  {
    href: '/dashboard/bots',
    label: 'Боты',
    match: (p: string) => p.startsWith('/dashboard/bots'),
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
  const width =
    maxWidth === '2xl'
      ? 'max-w-2xl'
      : maxWidth === '3xl'
        ? 'max-w-3xl'
        : maxWidth === '6xl'
          ? 'max-w-6xl'
          : 'max-w-5xl';

  return (
    <div className="min-h-screen bg-background">
      {showNav && (
        <header className="sticky top-0 z-40 border-b border-border/80 bg-card/90 backdrop-blur-md">
          <div className={cn('mx-auto flex h-12 items-center justify-between gap-4 px-5 sm:px-6', width)}>
            <div className="flex min-w-0 items-center gap-4 sm:gap-6">
              <Link
                href="/dashboard"
                className="shrink-0 text-sm font-semibold tracking-tight text-foreground transition-opacity duration-[var(--duration-fast)] hover:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 rounded-sm"
              >
                Voxly
              </Link>
              <nav className="flex items-center gap-0.5" aria-label="Основная навигация">
                {NAV.map((item) => {
                  const active = item.match(pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'rounded-md px-2.5 py-1.5 text-sm cursor-pointer',
                        'transition-colors duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40',
                        active
                          ? 'bg-secondary font-medium text-foreground shadow-[inset_0_0_0_1px_hsl(var(--border))]'
                          : 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                localStorage.removeItem('voxly_token');
                router.push('/');
              }}
            >
              Выйти
            </Button>
          </div>
        </header>
      )}
      <main className={cn('mx-auto animate-in px-5 py-8 sm:px-6 sm:py-10', width, className)}>
        {children}
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
      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}
