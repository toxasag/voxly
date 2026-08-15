'use client';

import { useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Loader2, Phone, Search } from 'lucide-react';

type Field = { label: string; value: string; color?: string };

const RESULT: Field[] = [
  { label: 'ФИО', value: 'Мария Ковалёва' },
  { label: 'Дата рождения', value: '14 марта' },
  { label: 'Telegram', value: '@maria_k', color: '#2aabee' },
  { label: 'WhatsApp', value: 'на связи', color: '#25d366' },
  { label: 'MAX', value: 'профиль найден', color: '#a855f7' },
];

const SAMPLE = '+7 903 555-22-14';

/**
 * Interactive "magic card" demo for the public landing.
 *
 * IMPORTANT: this is an ILLUSTRATIVE demo — it does NOT perform a real lookup.
 * A real reverse-phone lookup against the tenant's connected Telegram/WhatsApp/MAX
 * accounts must never be exposed on a public, unauthenticated page: it would be a
 * free reverse-lookup tool over real people's data (152-ФЗ / privacy) and would put
 * the connected accounts at ban risk. The real enrichment runs inside the CRM
 * (`POST /internal/crm/enrich-by-phone`, service-token only, bound to a Person in a
 * provisioned workspace). Here we only animate the result to show the concept.
 */
export function PhoneEnrichDemo() {
  const reduce = useReducedMotion();
  const [phone, setPhone] = useState('');
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');

  const hasEnough = phone.replace(/\D/g, '').length >= 10;

  function run() {
    if (state === 'loading' || !hasEnough) return;
    setState('loading');
    setTimeout(() => setState('done'), reduce ? 200 : 1100);
  }

  function reset() {
    setState('idle');
    setPhone('');
  }

  return (
    <div className="vx-card overflow-hidden p-5 shadow-[0_20px_50px_-30px_rgba(2,8,23,0.3)] sm:p-6">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label htmlFor="vx-demo-phone" className="text-sm font-semibold text-[#020817]">
          Введите номер телефона клиента
        </label>
        <button
          type="button"
          onClick={() => {
            setPhone(SAMPLE);
            setState('idle');
          }}
          className="text-xs font-medium text-[#8261fb] hover:underline"
        >
          Подставить пример
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa0aa]" />
          <input
            id="vx-demo-phone"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (state === 'done') setState('idle');
            }}
            onKeyDown={(e) => e.key === 'Enter' && run()}
            placeholder="+7 ___ ___-__-__"
            className="w-full rounded-md border border-[rgba(2,8,23,0.14)] bg-white py-3 pl-9 pr-3 text-sm text-[#020817] placeholder:text-[#9aa0aa] outline-none transition focus:border-[#8261fb]"
            aria-label="Номер телефона клиента"
          />
        </div>
        <button
          type="button"
          onClick={state === 'done' ? reset : run}
          className="vx-btn shrink-0 disabled:opacity-45"
          disabled={state === 'loading' || (state !== 'done' && !hasEnough)}
        >
          {state === 'loading' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Ищем…
            </>
          ) : state === 'done' ? (
            'Сбросить'
          ) : (
            <>
              <Search className="h-4 w-4" /> Найти
            </>
          )}
        </button>
      </div>
      <p className="mt-2 text-xs text-[#9aa0aa]">
        {hasEnough || state === 'done'
          ? 'Нажмите «Найти» — Voxly соберёт карточку по номеру.'
          : 'Введите номер в любом формате: +7…, 8…, или 10 цифр.'}
      </p>

      <div className="mt-5 rounded-md border border-[rgba(2,8,23,0.08)] bg-[#fafafa] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9aa0aa]">
          Карточка клиента
        </p>
        <div className="mt-3 space-y-2">
          <AnimatePresence mode="popLayout">
            {state !== 'done' ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-2"
              >
                {RESULT.map((f) => (
                  <div
                    key={f.label}
                    className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm ring-1 ring-[rgba(2,8,23,0.06)]"
                  >
                    <span className="text-[#8a8f99]">{f.label}</span>
                    <span className="text-[#c3c7cf]">{state === 'loading' ? '···' : '—'}</span>
                  </div>
                ))}
              </motion.div>
            ) : (
              <motion.div
                key="filled"
                initial="hidden"
                animate="show"
                variants={{ show: { transition: { staggerChildren: 0.12 } } }}
                className="space-y-2"
              >
                {RESULT.map((f) => (
                  <motion.div
                    key={f.label}
                    variants={{
                      hidden: { opacity: 0, x: reduce ? 0 : -10 },
                      show: { opacity: 1, x: 0, transition: { duration: 0.35 } },
                    }}
                    className="flex items-center justify-between rounded-md bg-white px-3 py-2 text-sm ring-1 ring-[rgba(2,8,23,0.08)]"
                  >
                    <span className="flex items-center gap-2 text-[#64686f]">
                      {f.color ? (
                        <span className="h-2 w-2 rounded-full" style={{ background: f.color }} />
                      ) : null}
                      {f.label}
                    </span>
                    <span className="flex items-center gap-1.5 font-medium text-[#020817]">
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      {f.value}
                    </span>
                  </motion.div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-[#9aa0aa]">
        Наглядный пример. В вашем кабинете данные подтягиваются по номеру из подключённых Telegram,
        WhatsApp, MAX и форм с сайта.
      </p>
    </div>
  );
}
