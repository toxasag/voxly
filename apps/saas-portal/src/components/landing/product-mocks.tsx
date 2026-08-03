/** Product UI mocks for landing — HTML/CSS, no screenshots required. */

import type { ReactNode } from 'react';

const COLS = [
  {
    title: 'Новый лид',
    cards: [
      { name: 'Анна К.', amount: '42 000 ₽', note: 'Хочет демо', unread: 2 },
      { name: 'Игорь М.', amount: '—', note: 'Спросил цену', unread: 0 },
    ],
  },
  {
    title: 'Квалификация',
    cards: [{ name: 'Сергей П.', amount: '120 000 ₽', note: 'Бриф готов', unread: 1 }],
  },
  {
    title: 'Договор',
    cards: [{ name: 'Мария Л.', amount: '78 000 ₽', note: 'Ждём оплату', unread: 0 }],
  },
  {
    title: 'Успешная',
    cards: [{ name: 'ООО «Север»', amount: '210 000 ₽', note: 'Закрыто', unread: 0 }],
  },
] as const;

export function KanbanMock({
  dimmed = false,
  className = '',
}: {
  dimmed?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`overflow-hidden border border-black/15 bg-white ${dimmed ? 'opacity-40 blur-[0.5px] saturate-50' : ''} ${className}`}
    >
      <div className="flex items-center justify-between border-b border-black/10 px-3 py-2">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-black/45">
          Сделки · Канбан
        </span>
        <span className="font-mono text-[10px] text-black/35">Канбан · Списком</span>
      </div>
      <div className="grid grid-cols-2 gap-2 p-2 sm:grid-cols-4 sm:gap-2.5 sm:p-3">
        {COLS.map((col) => (
          <div key={col.title} className="min-w-0 bg-[#f3f3f3] p-2">
            <p className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-black/50">
              {col.title}
            </p>
            <div className="mt-2 space-y-1.5">
              {col.cards.map((card) => (
                <div key={card.name} className="relative border border-black/10 bg-white p-2">
                  {card.unread > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center bg-[#f5a623] px-1 font-mono text-[9px] font-bold text-black">
                      {card.unread}
                    </span>
                  ) : null}
                  <p className="truncate text-[11px] font-semibold leading-tight">{card.name}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-black/55">{card.amount}</p>
                  <p className="mt-1 truncate text-[10px] text-black/45">{card.note}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export type PhoneScreen = 'kanban' | 'deal' | 'chat' | 'sent';

export function PhoneFrame({
  children,
  className = '',
  label = 'VoxlyCRM',
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={`relative mx-auto w-[min(100%,280px)] overflow-hidden border-[3px] border-[#0a0a0a] bg-white shadow-[12px_20px_40px_rgba(0,0,0,0.12)] ${className}`}
    >
      <div className="flex items-center justify-between bg-[#0a0a0a] px-3 py-2 text-white">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/55">CRM</span>
        <span className="text-[11px] font-semibold tracking-tight">{label}</span>
        <span className="font-mono text-[9px] text-white/55">web</span>
      </div>
      <div className="min-h-[420px] bg-[#fafafa]">{children}</div>
    </div>
  );
}

export function PhoneChatScreen({ annotated = false }: { annotated?: boolean }) {
  return (
    <div className="relative flex h-full min-h-[420px] flex-col">
      <div className="border-b border-black/10 bg-white px-3 py-2">
        <div className="flex gap-3 font-mono text-[9px] uppercase tracking-[0.12em] text-black/35">
          <span>Главная</span>
          <span className="relative text-black">
            Чат
            <span className="absolute -bottom-2 left-0 right-0 h-0.5 bg-[#f5a623]" />
            {annotated ? (
              <span className="absolute -right-5 -top-3 font-mono text-[9px] text-[#f5a623]">01</span>
            ) : null}
          </span>
        </div>
        <p className="mt-2 text-[12px] font-semibold">Анна К. · 42 000 ₽</p>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p className="truncate font-mono text-[9px] text-black/45">
            WhatsApp · от ИП Voxly · @anna
            {annotated ? <span className="ml-1 text-[#f5a623]">02</span> : null}
          </p>
          <span className="shrink-0 font-mono text-[9px] text-emerald-700">online</span>
        </div>
        <div className="mt-2 flex gap-1">
          {['WA', 'TG', 'Gift'].map((t, i) => (
            <span
              key={t}
              className={`border px-1.5 py-0.5 font-mono text-[8px] uppercase ${
                i === 0 ? 'border-black bg-black text-white' : 'border-black/15 text-black/45'
              }`}
            >
              {t}
              {annotated && i === 0 ? <span className="text-[#f5a623]"> 03</span> : null}
            </span>
          ))}
        </div>
      </div>

      <div className="flex-1 space-y-2 overflow-hidden px-3 py-3">
        <div className="max-w-[85%] border border-black/10 bg-white px-2.5 py-2 text-[11px] leading-snug">
          Здравствуйте! Можно записаться на завтра?
        </div>
        <div className="ml-auto max-w-[85%] bg-[#0a0a0a] px-2.5 py-2 text-[11px] leading-snug text-white">
          Да, есть слот в 14:00. Подтверждаю?
        </div>
        <div className="max-w-[85%] border border-black/10 bg-white px-2.5 py-2 text-[11px] leading-snug">
          Да, давайте. Спасибо!
        </div>
      </div>

      <div className="border-t border-black/10 bg-white px-2 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[8px] uppercase tracking-[0.12em] text-black/40">
            AI · пауза
            {annotated ? <span className="text-[#f5a623]"> 04</span> : null}
          </span>
          <span className="font-mono text-[8px] text-black/35">вкл · пауза · выкл</span>
        </div>
        <div className="flex items-center gap-1.5 border border-black/15 bg-[#f3f3f3] px-2 py-1.5">
          <span className="font-mono text-[9px] uppercase text-black/30">file</span>
          <span className="flex-1 text-[11px] text-black/35">Ответить…</span>
          <span className="bg-[#f5a623] px-2 py-1 font-mono text-[9px] font-bold uppercase">
            send
            {annotated ? ' 05' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

export function PhoneScreenContent({ screen }: { screen: PhoneScreen }) {
  if (screen === 'kanban') {
    return (
      <div className="p-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40">Сделки</p>
        <div className="mt-2 space-y-2">
          {[
            { name: 'Анна К.', badge: 2 },
            { name: 'Сергей П.', badge: 1 },
            { name: 'Мария Л.', badge: 0 },
          ].map((row) => (
            <div key={row.name} className="flex items-center justify-between border border-black/10 bg-white px-2.5 py-2">
              <span className="text-[12px] font-semibold">{row.name}</span>
              {row.badge > 0 ? (
                <span className="bg-[#f5a623] px-1.5 font-mono text-[10px] font-bold">{row.badge}</span>
              ) : (
                <span className="font-mono text-[10px] text-black/30">·</span>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (screen === 'deal') {
    return (
      <div className="p-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40">Сделка</p>
        <p className="mt-2 text-[15px] font-semibold">Анна К.</p>
        <p className="mt-1 font-mono text-[12px]">42 000 ₽ · Квалификация</p>
        <p className="mt-3 text-[11px] text-black/55">Заметка: хочет демо завтра, слот 14:00</p>
        <div className="mt-4 border border-black/10 bg-white px-2.5 py-2 text-[11px]">
          Владелец: Вы · Источник: WhatsApp
        </div>
      </div>
    );
  }
  if (screen === 'sent') {
    return (
      <div className="relative flex h-full min-h-[420px] flex-col">
        <PhoneChatScreen />
        <div className="pointer-events-none absolute inset-x-3 bottom-24 border border-black/10 bg-white px-3 py-2 text-center text-[11px] font-semibold shadow-sm">
          Отправлено · WhatsApp
        </div>
      </div>
    );
  }
  return <PhoneChatScreen />;
}

export function HeroSignature() {
  return (
    <div className="relative isolate min-h-[460px] w-full lg:min-h-[520px]">
      <div className="absolute inset-0 -right-8 top-8 hidden overflow-hidden lg:block">
        <KanbanMock dimmed className="h-full min-h-[480px] scale-[1.05]" />
      </div>
      <div className="relative z-10 flex justify-center lg:justify-end lg:pr-4">
        <PhoneFrame className="land-rise-delay-2" label="Сделка · Чат">
          <PhoneChatScreen />
        </PhoneFrame>
      </div>
    </div>
  );
}

export function AnnotatedChatMock() {
  return (
    <div className="relative">
      <PhoneFrame className="mx-0 w-full max-w-[300px]" label="Сделка · Чат">
        <PhoneChatScreen annotated />
      </PhoneFrame>
      <ul className="mt-4 space-y-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-black/50 sm:absolute sm:-right-2 sm:top-10 sm:mt-0 sm:w-40 lg:right-auto lg:-left-2 lg:translate-x-[-100%]">
        <li>
          <span className="text-[#f5a623]">01</span> вкладка чат
        </li>
        <li>
          <span className="text-[#f5a623]">02</span> канал / имя
        </li>
        <li>
          <span className="text-[#f5a623]">03</span> треды
        </li>
        <li>
          <span className="text-[#f5a623]">04</span> ai control
        </li>
        <li>
          <span className="text-[#f5a623]">05</span> composer
        </li>
      </ul>
    </div>
  );
}

export function TransformCompare() {
  return (
    <div className="grid gap-0 border border-black/15 lg:grid-cols-2">
      <div className="border-b border-black/15 bg-[#f3f3f3] p-5 lg:border-b-0 lg:border-r">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-black/40">До</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {['Salebot', 'Wazzup', 'amo', 'ещё чат'].map((tab) => (
            <span
              key={tab}
              className="border border-black/20 bg-white px-3 py-2 font-mono text-[11px] text-black/55"
            >
              {tab}
            </span>
          ))}
        </div>
        <p className="mt-5 text-sm text-[var(--land-muted)]">Четыре вкладки. Один потерянный ночной лид.</p>
      </div>
      <div className="bg-white p-5">
        <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-[#f5a623]">
          После
        </p>
        <div className="mt-4 border border-black/15 bg-[#0a0a0a] px-4 py-3 text-white">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-[#f5a623]">VoxlyCRM</p>
          <p className="mt-2 text-sm font-semibold">сделка + чат + каналы</p>
        </div>
        <p className="mt-5 text-sm text-[var(--land-muted)]">
          Меньше стек на 8–15 тысяч. CRM Base — от 500 ₽ в месяц.
        </p>
      </div>
    </div>
  );
}

export function ModuleMini({
  kind,
}: {
  kind: 'secretary' | 'ai' | 'channel' | 'gift' | 'mailing';
}) {
  if (kind === 'secretary') {
    return (
      <div aria-hidden className="border border-black/15 bg-white p-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40">Inbox · Business</p>
        <div className="mt-2 space-y-1.5">
          {['@studio_a', '@warm_b', '@promo_c'].map((a, i) => (
            <div key={a} className="flex items-center justify-between border border-black/10 px-2 py-1.5 text-[11px]">
              <span>{a}</span>
              <span className="font-mono text-[10px] text-black/40">{i === 0 ? '3 new' : '—'}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (kind === 'ai') {
    return (
      <div aria-hidden className="border border-black/15 bg-white p-3">
        <div className="space-y-1.5">
          <div className="max-w-[90%] border border-black/10 px-2 py-1.5 text-[11px]">Сколько стоит?</div>
          <div className="ml-auto max-w-[90%] bg-[#0a0a0a] px-2 py-1.5 text-[11px] text-white">
            От 500 ₽ за CRM. Расскажу детали…
          </div>
          <p className="font-mono text-[9px] text-black/40">печатает… · AI на паузе</p>
        </div>
      </div>
    );
  }
  if (kind === 'channel') {
    return (
      <div aria-hidden className="flex items-center gap-3 border border-black/15 bg-white p-3">
        <div className="grid h-16 w-16 place-items-center border border-dashed border-black/25 font-mono text-[9px] text-black/40">
          QR
        </div>
        <div>
          <p className="text-[12px] font-semibold">Подключить канал</p>
          <p className="mt-1 font-mono text-[10px] text-black/45">TG · WA · MAX → CRM</p>
        </div>
      </div>
    );
  }
  if (kind === 'gift') {
    return (
      <div aria-hidden className="border border-black/15 bg-white p-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40">Gift funnel</p>
        <div className="mt-2 flex items-center gap-1 font-mono text-[10px]">
          <span className="bg-[#f3f3f3] px-1.5 py-1">start</span>
          <span>→</span>
          <span className="bg-[#f3f3f3] px-1.5 py-1">sub</span>
          <span>→</span>
          <span className="bg-[#f5a623] px-1.5 py-1 font-bold">сделка</span>
        </div>
      </div>
    );
  }
  return (
    <div aria-hidden className="border border-black/15 bg-white p-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-black/40">Рассылка</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {['Новый лид', 'Догрев', 'gift'].map((f) => (
          <span key={f} className="border border-black/15 px-1.5 py-0.5 font-mono text-[9px]">
            {f}
          </span>
        ))}
      </div>
      <p className="mt-2 text-[11px]">Завтра 10:00 · 128 получателей</p>
    </div>
  );
}
