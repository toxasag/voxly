'use client';

import { Wallet } from 'lucide-react';

export type AiBalanceState = 'empty' | 'low' | 'ok' | 'idle';

const BALANCE_BADGE: Record<AiBalanceState, { label: string; className: string }> = {
  empty: { label: 'Баланс исчерпан', className: 'bg-[#fff1ea] text-[#c2410c]' },
  low: { label: 'Скоро закончится', className: 'bg-amber-100 text-amber-900' },
  ok: { label: 'Хватает', className: 'bg-emerald-100 text-emerald-800' },
  idle: { label: 'Расхода ещё не было', className: 'bg-black/5 text-black/60' },
};

export function AiAgentsPortalHero({
  headline,
  subtitle,
  facts,
  balanceLabel,
  balanceState,
  balanceHint,
}: {
  headline: string;
  subtitle: string;
  facts: Array<{ label: string; value: string }>;
  balanceLabel: string;
  balanceState: AiBalanceState;
  balanceHint: string;
}) {
  const badge = BALANCE_BADGE[balanceState];

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
            AI-агенты
          </p>
          <h1 className="land-display land-rise mt-2 text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.04em]">
            {headline}
          </h1>
          <p className="land-rise-delay mt-2 max-w-[52ch] text-sm text-black/65 sm:text-base">
            {subtitle}
          </p>
          <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            {facts.map((fact) => (
              <div key={fact.label} className="min-w-0">
                <dt className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  {fact.label}
                </dt>
                <dd className="land-display text-[18px] tabular-nums tracking-[-0.03em] text-black">
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
            <span
              className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${badge.className}`}
            >
              {badge.label}
            </span>
          </div>
          <p className="land-display mt-2 text-[30px] tabular-nums leading-none tracking-[-0.03em] text-black">
            {balanceLabel} ₽
          </p>
          <p className="mt-2 text-xs leading-snug text-black/60">{balanceHint}</p>
          <a href="#balance" className="land-btn mt-3 min-h-11 w-full cursor-pointer text-sm">
            Пополнить баланс
            <Wallet className="h-4 w-4" aria-hidden />
          </a>
          <p className="mt-3 border-t border-black/10 pt-3 text-xs leading-snug text-black/55">
            Списывается только за ответы AI клиентам. Когда баланс кончится, агент напишет клиенту и
            переведёт диалог на оператора.
          </p>
        </div>
      </div>
    </section>
  );
}
