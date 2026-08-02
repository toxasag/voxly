'use client';

import { Gift } from 'lucide-react';
import Link from 'next/link';

export function GiftBotsHero({
  title,
  subtitle,
  facts,
  stateLabel,
  stateTone,
  stateHint,
  actionLabel,
  onAction,
  actionDisabled = false,
  secondaryActionLabel,
  onSecondaryAction,
  footerLabel,
  footerValue,
  partnerHint = false,
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
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  footerLabel: string;
  footerValue: string;
  /** Short note that partner balance can cover checkout */
  partnerHint?: boolean;
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
            Бот выдачи подарков
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
              Тариф
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
            <Gift className="h-4 w-4" aria-hidden />
          </button>
          {secondaryActionLabel && onSecondaryAction ? (
            <button
              type="button"
              onClick={onSecondaryAction}
              disabled={actionDisabled}
              className="land-btn-ghost mt-2 min-h-11 w-full cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {secondaryActionLabel}
            </button>
          ) : null}
          {partnerHint ? (
            <p className="mt-2 text-[11px] leading-snug text-black/50">
              На оплате можно списать партнёрский баланс.{' '}
              <Link href="/dashboard/partners" className="underline underline-offset-2">
                Партнёрская
              </Link>
            </p>
          ) : null}
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
