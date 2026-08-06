'use client';

import { useState } from 'react';
import {
  AnnotatedChatMock,
  FormToDealMock,
  KanbanMock,
  ModuleMini,
  PhoneFrame,
  PhoneFormLeadScreen,
} from './product-mocks';

const TABS = [
  {
    id: 'kanban',
    label: 'Канбан',
    title: 'Воронка на виду',
    text: 'Сделки по этапам. Side panel — разбор без потери контекста канбана.',
    visual: 'kanban' as const,
  },
  {
    id: 'chat',
    label: 'Чат',
    title: 'Переписка в сделке',
    text: 'TG, WA, MAX и gift — в одной вкладке «Чат». AI на паузе одним тапом.',
    visual: 'chat' as const,
  },
  {
    id: 'forms',
    label: 'Заявки с сайта',
    title: 'Tilda и WordPress → сразу сделка',
    text: 'Webhook из кабинета. Безлимит сайтов. Без доплаты к CRM Base.',
    visual: 'forms' as const,
  },
  {
    id: 'mailing',
    label: 'Рассылки',
    title: 'Догон из той же CRM',
    text: 'По этапам сделки, gift и прочитанности — не из третьего кабинета.',
    visual: 'mailing' as const,
  },
  {
    id: 'ai',
    label: 'AI',
    title: 'Первая линия под контролем',
    text: 'Отвечает в треде. Менеджер забирает диалог, когда нужно.',
    visual: 'ai' as const,
  },
] as const;

export function ProductTabs() {
  const [active, setActive] = useState<(typeof TABS)[number]['id']>('forms');
  const tab = TABS.find((t) => t.id === active) ?? TABS[2]!;

  return (
    <div className="border border-black/15 bg-white">
      <div
        role="tablist"
        aria-label="Возможности VoxlyCRM"
        className="flex gap-1 overflow-x-auto border-b border-black/10 p-2"
      >
        {TABS.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(t.id)}
              className={`min-h-11 shrink-0 touch-manipulation px-3 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                selected ? 'bg-[#0a0a0a] text-white' : 'text-black/50 hover:bg-[#f3f3f3] hover:text-black'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-[#f5a623]">
            VoxlyCRM · {tab.label}
          </p>
          <h3 className="mt-3 text-2xl sm:text-3xl">{tab.title}</h3>
          <p className="mt-4 max-w-[42ch] text-base text-[var(--land-muted)]">{tab.text}</p>
        </div>
        <div className="min-w-0">
          {tab.visual === 'kanban' ? <KanbanMock /> : null}
          {tab.visual === 'chat' ? <AnnotatedChatMock /> : null}
          {tab.visual === 'forms' ? (
            <div className="space-y-4">
              <FormToDealMock />
              <div className="flex justify-center sm:justify-end">
                <PhoneFrame className="w-[min(100%,240px)]" label="Заявка · Tilda">
                  <PhoneFormLeadScreen />
                </PhoneFrame>
              </div>
            </div>
          ) : null}
          {tab.visual === 'mailing' ? <ModuleMini kind="mailing" /> : null}
          {tab.visual === 'ai' ? <ModuleMini kind="ai" /> : null}
        </div>
      </div>
    </div>
  );
}
