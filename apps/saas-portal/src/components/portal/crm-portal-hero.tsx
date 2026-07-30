'use client';

import { ExternalLink } from 'lucide-react';

export function CrmPortalHero({
  title = 'CRM портал',
  subtitle,
  badge,
  crmReady,
  accessLocked = false,
  opening,
  onOpenCrm,
}: {
  title?: string;
  subtitle?: string;
  badge?: string;
  crmReady: boolean;
  accessLocked?: boolean;
  opening: boolean;
  onOpenCrm: () => void;
}) {
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
      <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {badge ? (
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
              {badge}
            </p>
          ) : null}
          <h1 className="land-display land-rise mt-2 text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.04em]">
            {title}
          </h1>
          {subtitle ? (
            <p className="land-rise-delay mt-2 max-w-[42ch] text-sm text-black/65 sm:text-base">
              {subtitle}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onOpenCrm}
          disabled={!crmReady || opening || accessLocked}
          className="land-btn shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {opening
            ? 'Открываем…'
            : accessLocked
              ? 'CRM закрыта'
              : crmReady
                ? 'Открыть CRM'
                : 'CRM создаётся…'}
          <ExternalLink className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
