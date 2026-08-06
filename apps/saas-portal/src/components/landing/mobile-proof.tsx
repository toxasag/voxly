'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneFrame, PhoneScreenContent, type PhoneScreen } from './product-mocks';

const STEPS: { screen: PhoneScreen; title: string; text: string }[] = [
  {
    screen: 'kanban',
    title: 'Канбан',
    text: 'Увидел badge на сделке — прямо в метро.',
  },
  {
    screen: 'deal',
    title: 'Сделка',
    text: 'Сумма, этап и заметка без потери контекста.',
  },
  {
    screen: 'form',
    title: 'Заявка / чат',
    text: 'Заявка с Tilda или переписка из мессенджера — в той же карточке.',
  },
  {
    screen: 'sent',
    title: 'Ответ',
    text: 'Pinned composer, вложение, «отправлено».',
  },
];

export function MobileProof() {
  const pinRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (reduced) return;
    const el = pinRef.current;
    if (!el) return;

    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const viewH = window.innerHeight;
      const total = el.offsetHeight - viewH;
      if (total <= 0) return;
      const scrolled = Math.min(Math.max(-rect.top, 0), total);
      const progress = scrolled / total;
      const next = Math.min(STEPS.length - 1, Math.floor(progress * STEPS.length));
      setIndex(next);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [reduced]);

  const go = useCallback((dir: -1 | 1) => {
    setIndex((i) => Math.min(STEPS.length - 1, Math.max(0, i + dir)));
  }, []);

  const step = STEPS[index]!;

  return (
    <div
      ref={pinRef}
      className={reduced ? 'relative' : 'relative min-h-[220vh] lg:min-h-[280vh]'}
    >
      <div className={reduced ? 'relative' : 'sticky top-16 z-10 py-10 lg:top-20 lg:py-14'}>
        <div className="mx-auto grid max-w-[1280px] items-center gap-10 px-5 sm:px-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
              05 · Мобильный веб
            </p>
            <h2 className="mt-6 max-w-[640px] text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
              CRM в кармане. App Store не нужен.
            </h2>
            <p className="mt-6 max-w-[540px] text-base text-[var(--land-muted)] sm:text-lg">
              Это адаптивный веб-CRM, не урезанная «мобилка» и не обещание магазина приложений.
              Канбан, сделка, заявка с сайта, чат и ответ — в браузере телефона.
            </p>

            <ol className="mt-8 space-y-3">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <button
                    type="button"
                    onClick={() => setIndex(i)}
                    className={`flex w-full min-h-11 items-start gap-3 border-l-2 px-3 py-2 text-left transition-colors ${
                      i === index
                        ? 'border-[#f5a623] bg-[#fff4de]'
                        : 'border-transparent text-[var(--land-muted)] hover:border-black/20'
                    }`}
                  >
                    <span className="font-mono text-[11px] font-semibold text-[#f5a623]">
                      {String(i + 1).padStart(2, '0')}/04
                    </span>
                    <span>
                      <span className="block text-sm font-semibold text-[var(--land-ink)]">{s.title}</span>
                      <span className="mt-0.5 block text-sm">{s.text}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>

            {reduced ? (
              <div className="mt-4 flex gap-2">
                <button type="button" className="land-btn-ghost min-h-11 px-4" onClick={() => go(-1)}>
                  Назад
                </button>
                <button type="button" className="land-btn min-h-11 px-4" onClick={() => go(1)}>
                  Дальше
                </button>
              </div>
            ) : null}

            <p className="mt-8 max-w-[520px] text-sm font-semibold text-[var(--land-ink)]">
              Не нужно ставить iOS или Android приложение команде. Откройте CRM в браузере.
            </p>
            <p className="mt-2 text-sm text-[var(--land-muted)]">
              Сделка, заявка с сайта и переписка — в одном экране. Даже в метро.
            </p>
          </div>

          <div className="flex justify-center lg:justify-end">
            <PhoneFrame label={`${step.title} · web`}>
              <PhoneScreenContent screen={step.screen} />
            </PhoneFrame>
          </div>
        </div>
      </div>
    </div>
  );
}
