'use client';

import { Bot } from 'lucide-react';

export function AiSecretaryHero({
  title,
  subtitle,
  facts,
  stateLabel,
  stateTone,
  stateHint,
  actionLabel,
  onAction,
  actionDisabled = false,
  footerLabel,
  footerValue,
}: {
  title: string;
  subtitle: string;
  facts: Array<{ label: string; value: string }>;
  stateLabel: string;
  stateTone: 'connected' | 'pending' | 'off';
  stateHint: string;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  footerLabel: string;
  footerValue: string;
}) {
  const toneText =
    stateTone === 'connected'
      ? 'text-[#166534]'
      : stateTone === 'pending'
        ? 'text-[#c2410c]'
        : 'text-black';
  const toneNote =
    stateTone === 'connected' ? 'на связи' : stateTone === 'pending' ? 'нужно действие' : 'выключен';

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
            Телеграм Секретарь
          </p>
          <h1 className="land-display land-rise mt-2 text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.04em]">
            {title}
          </h1>
          <p className="land-rise-delay mt-2 max-w-[52ch] text-sm text-black/65 sm:text-base">
            {subtitle}
          </p>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  {fact.label}
                </dt>
                <dd className="land-display mt-0.5 text-[17px] tabular-nums leading-tight tracking-[-0.03em] text-black">
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div
          role="status"
          aria-live="polite"
          className="w-full rounded-xl border border-black/15 bg-white/70 p-4 backdrop-blur-sm lg:w-[360px]"
        >
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
              Состояние канала
            </p>
            <span className="text-xs font-semibold text-black/55">{toneNote}</span>
          </div>
          <p
            className={`land-display mt-2 text-[22px] leading-tight tracking-[-0.03em] ${toneText}`}
          >
            {stateLabel}
          </p>
          <p className="mt-2 text-xs leading-snug text-black/60">{stateHint}</p>
          <button
            type="button"
            onClick={onAction}
            disabled={actionDisabled}
            className="land-btn mt-3 min-h-11 w-full cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionLabel}
            <Bot className="h-4 w-4" aria-hidden />
          </button>
          <p className="mt-3 flex items-baseline justify-between gap-2 border-t border-black/10 pt-3 text-sm">
            <span className="text-black/55">{footerLabel}</span>
            <span className="land-display text-right text-[17px] leading-tight tracking-[-0.03em] text-black">
              {footerValue}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
