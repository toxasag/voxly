'use client';

import { Wallet } from 'lucide-react';

export function AiOverviewHero({
  eyebrow = 'AI-модуль',
  title,
  subtitle,
  facts,
  balanceValue,
  balanceTone,
  balanceHint,
  topUpLabel,
  onTopUp,
  footerLabel,
  footerValue,
}: {
  eyebrow?: string;
  title: string;
  subtitle: string;
  facts: Array<{ label: string; value: string }>;
  balanceValue: string;
  balanceTone: 'ok' | 'low' | 'empty';
  balanceHint: string;
  topUpLabel: string;
  onTopUp: () => void;
  footerLabel: string;
  footerValue: string;
}) {
  const toneText =
    balanceTone === 'empty'
      ? 'text-[#b91c1c]'
      : balanceTone === 'low'
        ? 'text-[#c2410c]'
        : 'text-black';
  const toneBadge =
    balanceTone === 'empty'
      ? 'Пусто'
      : balanceTone === 'low'
        ? 'Заканчивается'
        : 'Хватает';

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
            {eyebrow}
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

        <div className="w-full rounded-xl border border-black/15 bg-white/70 p-4 backdrop-blur-sm lg:w-[360px]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
              Баланс AI
            </p>
            <span className="text-xs font-semibold text-black/55">{toneBadge}</span>
          </div>
          <p
            className={`land-display mt-2 text-[32px] tabular-nums leading-none tracking-[-0.03em] ${toneText}`}
          >
            {balanceValue} ₽
          </p>
          <p className="mt-2 text-xs leading-snug text-black/60">{balanceHint}</p>
          <button
            type="button"
            onClick={onTopUp}
            className="land-btn mt-3 min-h-11 w-full cursor-pointer text-sm"
          >
            {topUpLabel}
            <Wallet className="h-4 w-4" aria-hidden />
          </button>
          <p className="mt-3 flex items-baseline justify-between gap-2 border-t border-black/10 pt-3 text-sm">
            <span className="text-black/55">{footerLabel}</span>
            <span className="land-display text-right text-[17px] tabular-nums leading-tight tracking-[-0.03em] text-black">
              {footerValue}
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
