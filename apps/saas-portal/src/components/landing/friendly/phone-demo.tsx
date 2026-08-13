'use client';

import { useState } from 'react';
import { Check, MessageCircle, UserRound, LayoutGrid } from 'lucide-react';

const TABS = [
  { id: 'funnel', label: 'Воронка', icon: LayoutGrid },
  { id: 'chat', label: 'Чат в сделке', icon: MessageCircle },
  { id: 'card', label: 'Карточка', icon: UserRound },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function PhoneDemo({ compact = false }: { compact?: boolean }) {
  const [tab, setTab] = useState<TabId>('card');

  return (
    <div className={`mx-auto w-full ${compact ? 'max-w-[280px]' : 'max-w-[300px]'}`}>
      <div className="friendly-phone relative overflow-hidden rounded-[2.2rem] border-[10px] border-slate-900 bg-white shadow-[0_24px_60px_-20px_rgba(15,23,42,0.35)]">
        <div className="absolute left-1/2 top-2 z-10 h-5 w-24 -translate-x-1/2 rounded-full bg-slate-900" aria-hidden />
        <div className="flex h-[520px] flex-col bg-[#FAFAFA] pt-8">
          <div className="px-4 pb-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Voxly · на телефоне</p>
            <p className="mt-0.5 text-sm font-semibold text-slate-900">Сделка · Мария К.</p>
          </div>

          <div className="flex-1 overflow-hidden px-3 pb-2">
            {tab === 'funnel' && <FunnelScreen />}
            {tab === 'chat' && <ChatScreen />}
            {tab === 'card' && <CardScreen />}
          </div>

          <div className="grid grid-cols-3 gap-1 border-t border-slate-200 bg-white p-2" role="tablist" aria-label="Экраны демо">
            {TABS.map(({ id, label, icon: Icon }) => {
              const active = tab === id;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(id)}
                  className={`flex flex-col items-center gap-0.5 rounded-xl px-1 py-2 text-[10px] font-medium transition-colors ${
                    active ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  <span className="leading-tight">{label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function FunnelScreen() {
  const cols = [
    { title: 'Новый', color: 'bg-sky-100 text-sky-800', items: ['Анна', 'Игорь'] },
    { title: 'В работе', color: 'bg-amber-100 text-amber-900', items: ['Мария'] },
    { title: 'Успех', color: 'bg-emerald-100 text-emerald-800', items: ['Олег'] },
  ];
  return (
    <div className="flex h-full gap-2 overflow-x-auto pb-1">
      {cols.map((col) => (
        <div key={col.title} className="min-w-[88px] flex-1 rounded-xl bg-white p-2 shadow-sm ring-1 ring-slate-100">
          <span className={`inline-block rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${col.color}`}>
            {col.title}
          </span>
          <ul className="mt-2 space-y-1.5">
            {col.items.map((name) => (
              <li key={name} className="rounded-lg bg-slate-50 px-2 py-2 text-[11px] font-medium text-slate-800">
                {name}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ChatScreen() {
  return (
    <div className="flex h-full flex-col rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
      <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-semibold text-slate-700">
        WhatsApp · Мария
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        <Bubble side="in">Здравствуйте! Есть доставка на завтра?</Bubble>
        <Bubble side="out">Да, можем к 14:00. Оформим?</Bubble>
        <Bubble side="in">Да, давайте</Bubble>
      </div>
      <div className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-400">Ответ из сделки · AI на паузе</div>
    </div>
  );
}

function CardScreen() {
  return (
    <div className="friendly-card-pulse flex h-full flex-col rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-100">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-slate-900">Мария Ковалёва</p>
          <p className="mt-0.5 text-xs text-slate-500">Сделка · Курс «Старт»</p>
        </div>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          В работе
        </span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-900">48 000 ₽</p>
      <div className="mt-4 space-y-2">
        <Tag ok>WhatsApp найден</Tag>
        <Tag ok>Telegram найден</Tag>
        <Tag ok>MAX проверен</Tag>
      </div>
      <p className="mt-auto pt-4 text-[11px] leading-relaxed text-slate-500">
        Номер ввели один раз — имя и мессенджеры подтянулись сами.
      </p>
    </div>
  );
}

function Tag({ children, ok }: { children: React.ReactNode; ok?: boolean }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-medium ${
        ok ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-50 text-slate-600'
      }`}
    >
      {ok ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
      {children}
    </div>
  );
}

function Bubble({ children, side }: { children: React.ReactNode; side: 'in' | 'out' }) {
  return (
    <div
      className={`max-w-[85%] rounded-2xl px-3 py-2 text-[11px] leading-snug ${
        side === 'out'
          ? 'ml-auto rounded-br-md bg-blue-600 text-white'
          : 'rounded-bl-md bg-slate-100 text-slate-800'
      }`}
    >
      {children}
    </div>
  );
}
