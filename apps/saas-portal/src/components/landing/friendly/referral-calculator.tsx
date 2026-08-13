'use client';

import { useMemo, useState } from 'react';
import { PRICING } from '@voxly/shared';
import { RegisterLink } from '@/components/landing/register-link';

const PCT = PRICING.REFERRAL_PERCENT_DEFAULT;
/** Illustrative ARPU (CRM + typical modules) for the earnings preview */
const EXAMPLE_ARPU = 3000;

type Props = { refCode?: string | null };

export function ReferralCalculator({ refCode }: Props) {
  const [n, setN] = useState(5);
  const income = useMemo(() => Math.round(n * EXAMPLE_ARPU * (PCT / 100)), [n]);
  const covers = income >= PRICING.CRM_BASE_MONTHLY;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <label className="block">
        <div className="flex items-end justify-between gap-3">
          <span className="text-sm font-semibold text-slate-900">Сколько коллег вы можете порекомендовать?</span>
          <span className="tabular-nums text-2xl font-semibold text-blue-600">{n}</span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="friendly-range mt-4 w-full"
        />
      </label>

      <div className="mt-6 rounded-xl bg-blue-50 p-5">
        <p className="text-xs font-medium uppercase tracking-wider text-blue-700/80">Ваш пассивный доход</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
          ~{income.toLocaleString('ru-RU')} ₽
          <span className="ml-1 text-base font-medium text-slate-500">/ мес</span>
        </p>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          {PCT}% с оплат коллег на постоянной основе
          {covers ? ' — это полностью перекрывает вашу подписку CRM.' : '.'}
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Оценка при среднем чеке коллеги ~{EXAMPLE_ARPU.toLocaleString('ru-RU')} ₽/мес (CRM + модули).
        </p>
      </div>

      <RegisterLink
        refCode={refCode}
        className="friendly-btn mt-6 flex w-full items-center justify-center touch-manipulation"
      >
        Заработать с Voxly
      </RegisterLink>
    </div>
  );
}
