import Link from 'next/link';
import type { ReactNode } from 'react';

type Props = {
  eyebrow: string;
  title: string;
  subtitle: string;
  headerAction: { href: string; label: string };
  children: ReactNode;
};

/** Auth layout matching Friendly LP (white / slate / blue) — no mascot. */
export function AuthShell({ eyebrow, title, subtitle, headerAction, children }: Props) {
  return (
    <main className="friendly-lp min-h-svh bg-white text-slate-900">
      <div className="grid min-h-svh lg:grid-cols-2">
        <section className="relative isolate flex flex-col overflow-hidden px-5 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10">
          <div className="friendly-hero-bg pointer-events-none absolute inset-0" aria-hidden />
          <header className="relative z-10 flex items-center justify-between gap-3">
            <Link href="/" className="friendly-brand text-lg font-bold tracking-tight text-slate-900">
              Voxly
            </Link>
            <Link href={headerAction.href} className="friendly-btn-sm touch-manipulation">
              {headerAction.label}
            </Link>
          </header>

          <div className="relative z-10 mt-10 flex flex-1 flex-col justify-center lg:mt-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600/80">
              {eyebrow}
            </p>
            <h1 className="mt-4 max-w-[16ch] text-[clamp(2rem,4.2vw,3.25rem)] font-semibold leading-[1.1] tracking-tight text-slate-900">
              {title}
            </h1>
            <p className="mt-4 max-w-[38ch] text-base leading-relaxed text-slate-600">{subtitle}</p>
            <ul className="mt-8 space-y-3 text-sm text-slate-700">
              {[
                'WhatsApp, Telegram, Max и заявки с сайта — в одном окне',
                'Карточка контакта заполняется сама',
                '7 дней бесплатно, без банковской карты',
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-600" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="flex items-center border-t border-slate-100 bg-white px-5 py-10 sm:px-10 lg:border-t-0 lg:border-l lg:border-slate-100 lg:px-16">
          <div className="mx-auto w-full max-w-[400px]">{children}</div>
        </section>
      </div>
    </main>
  );
}
