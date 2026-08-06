'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';

export function CrmPortalHero({
  title = 'CRM портал',
  subtitle,
  badge,
  crmHost,
  crmUrl,
  crmReady,
  accessLocked = false,
  opening,
  onOpenCrm,
  statusLabel,
  statusValue,
}: {
  title?: string;
  subtitle?: string;
  badge?: string;
  crmHost: string;
  crmUrl: string;
  crmReady: boolean;
  accessLocked?: boolean;
  opening: boolean;
  onOpenCrm: () => void;
  statusLabel: string;
  statusValue: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(crmUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

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
          {badge ? (
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
              {badge}
            </p>
          ) : null}
          <h1 className="land-display land-rise mt-2 text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.04em]">
            {title}
          </h1>
          {subtitle ? (
            <p className="land-rise-delay mt-2 max-w-[52ch] text-sm text-black/65 sm:text-base">
              {subtitle}
            </p>
          ) : null}
        </div>

        <div className="w-full rounded-xl border border-black/15 bg-white/70 p-4 backdrop-blur-sm lg:w-[360px]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
              Адрес CRM
            </p>
            <span className="text-xs font-semibold text-black/55">
              {crmReady ? 'воркспейс готов' : 'создаётся…'}
            </span>
          </div>
          <p className="mt-2 truncate font-mono text-sm text-black" title={crmHost}>
            {crmHost}
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={onOpenCrm}
              disabled={!crmReady || opening || accessLocked}
              className="land-btn min-h-11 flex-1 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-60"
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
            <button
              type="button"
              onClick={() => void copyUrl()}
              aria-label={copied ? 'Адрес скопирован' : 'Скопировать адрес CRM'}
              className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-black/15 bg-white/80 text-black/70 transition-colors duration-200 hover:border-black/35 hover:text-black"
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
            </button>
          </div>
          <p className="mt-3 flex items-baseline justify-between gap-2 border-t border-black/10 pt-3 text-sm">
            <span className="text-black/55">{statusLabel}</span>
            <span className="land-display text-right text-[17px] leading-tight tracking-[-0.03em] text-black">
              {statusValue}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
