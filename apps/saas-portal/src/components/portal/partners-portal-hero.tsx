'use client';

import { useState } from 'react';
import { Check, Copy, MousePointerClick } from 'lucide-react';

export function PartnersPortalHero({
  rewardLabel,
  balanceRub,
  mainLink,
  mainCode,
  mainClicks,
}: {
  rewardLabel: string;
  balanceRub: string;
  mainLink: string;
  mainCode: string;
  mainClicks: number;
}) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(mainLink);
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
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            Партнёрская программа
          </p>
          <h1 className="land-display land-rise mt-2 text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.04em]">
            {rewardLabel}
          </h1>
          <p className="land-rise-delay mt-2 max-w-[52ch] text-sm text-black/65 sm:text-base">
            Делитесь ссылкой — мы сами свяжем регистрацию с вами. Вознаграждение приходит на баланс
            после оплаты клиента.
          </p>
        </div>

        <div className="w-full rounded-xl border border-black/15 bg-white/70 p-4 backdrop-blur-sm lg:w-[360px]">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
              Ваша ссылка
            </p>
            <span className="inline-flex items-center gap-1 text-xs text-black/55">
              <MousePointerClick className="h-3.5 w-3.5" aria-hidden />
              {mainClicks} переходов
            </span>
          </div>
          <p className="land-display mt-2 truncate text-[22px] tracking-[-0.03em] text-black">
            {mainCode}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-black/55" title={mainLink}>
            {mainLink}
          </p>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="land-btn mt-3 min-h-11 w-full cursor-pointer text-sm"
          >
            {copied ? (
              <>
                Скопировано
                <Check className="h-4 w-4" aria-hidden />
              </>
            ) : (
              <>
                Скопировать ссылку
                <Copy className="h-4 w-4" aria-hidden />
              </>
            )}
          </button>
          <p className="mt-3 flex items-baseline justify-between gap-2 border-t border-black/10 pt-3 text-sm">
            <span className="text-black/55">Баланс к выплате</span>
            <span className="land-display text-[20px] tracking-[-0.03em] text-black">
              {balanceRub} ₽
            </span>
          </p>
        </div>
      </div>
    </section>
  );
}
