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
    <div className="rounded-xl border border-[rgba(2,8,23,0.1)] bg-white p-5 shadow-[0_20px_50px_-40px_rgba(2,8,23,0.35)] sm:p-8">
      <label className="block">
        <div className="flex items-end justify-between gap-3">
          <span className="text-sm font-semibold text-[#020817]">Сколько коллег вы можете порекомендовать?</span>
          <span className="tabular-nums text-2xl font-semibold text-[#8261fb]">{n}</span>
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={n}
          onChange={(e) => setN(Number(e.target.value))}
          className="vx-range mt-4 w-full"
        />
      </label>

      <div className="mt-6 rounded-lg bg-[#f4f2ff] p-5 ring-1 ring-[rgba(130,97,251,0.15)]">
        <p className="text-xs font-medium uppercase tracking-wider text-[#8261fb]">Ваш пассивный доход</p>
        <p className="mt-1 text-3xl font-semibold tracking-tight text-[#020817] sm:text-4xl">
          ~{income.toLocaleString('ru-RU')} ₽
          <span className="ml-1 text-base font-medium text-[#64686f]">/ мес</span>
        </p>
        <p className="mt-2 text-sm leading-relaxed text-[#4b5160]">
          {PCT}% с оплат коллег на постоянной основе
          {covers ? ' — это полностью перекрывает вашу подписку CRM.' : '.'}
        </p>
        <p className="mt-2 text-xs text-[#9aa0aa]">
          Оценка при среднем чеке коллеги ~{EXAMPLE_ARPU.toLocaleString('ru-RU')} ₽/мес (CRM + модули).
        </p>
      </div>

      <RegisterLink
        refCode={refCode}
        className="vx-btn mt-6 flex w-full items-center justify-center touch-manipulation"
      >
        Заработать с Voxly
      </RegisterLink>
    </div>
  );
}
