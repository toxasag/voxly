'use client';

import { useState } from 'react';
import { Gift, X } from 'lucide-react';
import { RegisterLink } from '@/components/landing/register-link';

type Props = { refCode?: string | null };

export function GiftWidget({ refCode }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed bottom-20 right-4 z-50 md:bottom-6 md:right-6">
      {open ? (
        <div
          role="dialog"
          aria-label="Gift-бот"
          className="mb-3 w-[min(100vw-2rem,20rem)] rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-slate-900">Подарок за 1 клик</p>
            <button
              type="button"
              className="rounded-md p-1 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
              onClick={() => setOpen(false)}
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Нажмите, чтобы получить подарок и протестировать бота прямо сейчас — через регистрацию на 7 дней.
          </p>
          <RegisterLink
            refCode={refCode}
            className="friendly-btn mt-4 flex w-full items-center justify-center text-sm touch-manipulation"
          >
            Получить подарок
          </RegisterLink>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="friendly-gift-fab flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/30 transition hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
        aria-expanded={open}
        aria-label="Открыть виджет подарка"
      >
        <Gift className="h-6 w-6" aria-hidden />
      </button>
    </div>
  );
}
