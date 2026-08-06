'use client';

import Link from 'next/link';
import { ExternalLink, LifeBuoy } from 'lucide-react';

export function DashboardPortalHero({
  workspaceName,
  crmReady,
  crmLocked,
  crmOpening,
  onOpenCrm,
}: {
  workspaceName: string;
  crmReady: boolean;
  crmLocked: boolean;
  crmOpening: boolean;
  onOpenCrm: () => void;
}) {
  const crmLabel = crmOpening
    ? 'Открываем…'
    : crmLocked
      ? 'CRM закрыта — оплатить'
      : crmReady
        ? 'Открыть CRM'
        : 'CRM создаётся…';

  return (
    <section className="relative isolate overflow-hidden rounded-2xl bg-[#f5a623] px-5 py-6 sm:px-8 sm:py-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(10,10,10,.45) 1px, transparent 1px), linear-gradient(90deg, rgba(10,10,10,.45) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div className="relative z-10 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            00 · Кабинет
          </p>
          <h1 className="land-display land-rise mt-2 text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.04em]">
            {workspaceName}
          </h1>
          <p className="land-rise-delay mt-2 max-w-[52ch] text-sm text-black/65 sm:text-base">
            Лиды, каналы и AI в одном месте. Смотрите пульс и переходите к нужному разделу.
          </p>
        </div>

        <div className="w-full rounded-xl border border-black/15 bg-white/70 p-4 backdrop-blur-sm lg:w-[320px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
            Быстрый вход
          </p>
          <button
            type="button"
            onClick={onOpenCrm}
            disabled={(!crmReady && !crmLocked) || crmOpening}
            className="land-btn mt-3 min-h-11 w-full cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-60"
          >
            {crmLabel}
            <ExternalLink className="h-4 w-4" aria-hidden />
          </button>
          <Link
            href="https://t.me/GetVoxlybot"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-black/15 bg-white/50 px-4 text-sm font-semibold text-black/80 transition-colors hover:bg-white"
          >
            <LifeBuoy className="h-4 w-4" aria-hidden />
            Поддержка @GetVoxlybot
          </Link>
        </div>
      </div>
    </section>
  );
}
