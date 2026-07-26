import type { ReactNode } from 'react';
import Link from 'next/link';
import { LEGAL, LEGAL_LINKS } from '@/lib/legal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

export function LegalPageShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="min-h-screen bg-muted text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-[720px] items-center justify-between px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            {LEGAL.brand}
          </Link>
          <Button asChild variant="secondary" size="sm">
            <Link href="/">На главную</Link>
          </Button>
        </div>
      </header>

      <article className="mx-auto max-w-[720px] px-6 py-12 sm:py-16">
        <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
          Редакция от {LEGAL.revisedAt}
        </p>
        <h1 className="mt-3 text-[28px] font-semibold leading-tight tracking-[-0.03em] sm:text-[32px]">
          {title}
        </h1>
        <Separator className="my-8" />
        <div className="legal-prose space-y-4 text-sm leading-relaxed text-foreground [&_h2]:mt-10 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h3]:mt-6 [&_h3]:text-sm [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_p]:text-muted-foreground [&_strong]:font-medium [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
          {children}
        </div>

        <Card className="mt-12 rounded-lg border-border shadow-none">
          <CardContent className="space-y-2 p-5 text-sm leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">{LEGAL.legalEntityFull}</p>
            <p>
              ИНН {LEGAL.inn} · ОГРНИП {LEGAL.ogrnip}
            </p>
            <p>Юридический адрес: {LEGAL.legalAddress}</p>
            <p>Адрес для корреспонденции: {LEGAL.correspondenceAddress}</p>
            <p>
              <a href={LEGAL.phoneHref} className="text-foreground underline-offset-4 hover:underline">
                {LEGAL.phone}
              </a>
              {' · '}
              <a href={LEGAL.emailHref} className="text-foreground underline-offset-4 hover:underline">
                {LEGAL.email}
              </a>
            </p>
          </CardContent>
        </Card>
      </article>

      <footer className="border-t border-border py-8">
        <nav className="mx-auto flex max-w-[720px] flex-wrap justify-center gap-x-4 gap-y-2 px-6 text-sm text-muted-foreground">
          {LEGAL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </footer>
    </main>
  );
}
