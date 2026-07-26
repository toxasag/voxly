import Link from 'next/link';
import { Button } from '@/components/ui/button';

const FEATURES = [
  {
    title: 'Gift-боты',
    desc: 'Воронки, проверка подписки, отложенные сообщения и рассылки',
  },
  {
    title: 'AI Telegram',
    desc: 'Секретарь для Business и личных аккаунтов с handoff оператору',
  },
  {
    title: 'AI WhatsApp',
    desc: 'Тот же AI-контур для WhatsApp через QR',
  },
  {
    title: 'Сквозная аналитика',
    desc: 'Метрика, GA4, Facebook, VK — offline-конверсии из ботов',
  },
  {
    title: 'Реферальная программа',
    desc: '20% с оплат клиентов, которых вы пригласили',
  },
  {
    title: 'Twenty CRM',
    desc: 'Контакты, сделки и чат на self-hosted Twenty',
  },
] as const;

const PLANS = [
  {
    name: 'CRM Base',
    price: '500 ₽',
    period: '/мес',
    features: ['10 пользователей', 'Twenty CRM', 'Безлимит контактов', 'API доступ'],
  },
  {
    name: 'Gift Bot',
    price: '500 ₽',
    period: '/канал/мес',
    features: ['Воронки', 'Проверка подписки', 'Рассылки', 'Отложенные сообщения'],
  },
  {
    name: 'AI Business',
    price: '1000 ₽',
    period: '/10 акк/мес',
    features: ['Telegram Business', 'Handoff', '+200 ₽ сверх 10', 'AI баланс отдельно'],
  },
  {
    name: 'Личный TG / WA',
    price: '500 ₽',
    period: '/акк/мес',
    features: ['QR-вход', 'AI-агенты', 'CRM-чат', 'AI баланс отдельно'],
  },
  {
    name: 'Аналитика',
    price: '500 ₽',
    period: '/платформа/мес',
    features: ['Яндекс Метрика', 'Google Analytics 4', 'Facebook CAPI', 'VK Pixel'],
  },
] as const;

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-hairline bg-paper">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-6">
          <span className="text-sm font-semibold tracking-tight">Voxly</span>
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/login">Войти</Link>
            </Button>
            <Button asChild variant="solid" size="sm">
              <Link href="/register">Начать</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1280px] px-6 pb-16 pt-20 animate-in sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-mid-gray">
            CRM · боты · AI
          </p>
          <h1 className="mt-4 text-[40px] font-semibold leading-[1.1] tracking-[-0.05em] sm:text-[48px]">
            Voxly
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-mid-gray sm:text-lg">
            Telegram, WhatsApp и Twenty CRM в одной платформе. Воронки, диалоги и конверсии — без
            зоопарка сервисов.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <Button asChild variant="solid" size="lg">
              <Link href="/register">Начать бесплатно</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/login">Войти</Link>
            </Button>
          </div>
          <p className="mt-5 text-sm text-mid-gray">500 ₽/мес · 10 пользователей · 14 дней trial</p>
        </div>

        {/* Living style guide — UI as imagery (DESIGN.md) */}
        <div className="mx-auto mt-16 grid max-w-4xl gap-4 sm:grid-cols-3">
          <div className="rounded-[24px] border border-hairline bg-paper p-5 shadow-[var(--shadow-subtle)]">
            <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-mid-gray">
              Баланс AI
            </p>
            <p className="mt-2 text-[30px] font-semibold tracking-[-0.025em]">1 240 ₽</p>
            <p className="mt-1 text-sm text-mid-gray">списано 180 ₽ за 30 дн.</p>
          </div>
          <div className="rounded-[24px] border border-hairline bg-paper p-5 shadow-[var(--shadow-subtle)]">
            <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-mid-gray">
              Business
            </p>
            <p className="mt-2 text-[30px] font-semibold tracking-[-0.025em]">7/10</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-canvas">
              <div className="h-full w-[70%] rounded-full bg-ink" />
            </div>
          </div>
          <div className="rounded-[24px] border border-hairline bg-paper p-5 shadow-[var(--shadow-subtle)]">
            <p className="mb-3 text-[12px] font-medium uppercase tracking-[0.05em] text-mid-gray">
              Компоненты
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-[18px] bg-ink-soft px-2 py-0.5 text-xs font-medium text-paper">
                active
              </span>
              <span className="rounded-[18px] bg-canvas px-2 py-0.5 text-xs font-medium text-ink-soft">
                trial
              </span>
              <button
                type="button"
                className="h-8 rounded-[18px] bg-ink px-3 text-[13px] font-medium text-paper"
              >
                Создать
              </button>
            </div>
            <div className="mt-3">
              <div className="h-9 w-full rounded-[18px] bg-canvas px-2.5 text-sm leading-9 text-mid-gray">
                you@company.ru
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-hairline bg-paper">
        <div className="mx-auto grid max-w-[1280px] sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <div
              key={f.title}
              className={`px-6 py-10 ${i % 2 === 0 ? '' : 'sm:border-l sm:border-hairline'} ${
                i >= 2 ? 'lg:border-l lg:border-hairline' : ''
              } border-b border-hairline last:border-b-0 lg:border-b-0`}
            >
              <h3 className="text-lg font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mid-gray">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1280px] px-6 py-20">
        <h2 className="text-center text-[30px] font-semibold tracking-[-0.025em]">Тарифы</h2>
        <p className="mt-2 text-center text-sm text-mid-gray">Платите только за то, что подключаете</p>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className="rounded-[24px] border border-hairline bg-paper p-5 shadow-[var(--shadow-subtle)]"
            >
              <h3 className="text-sm font-semibold">{plan.name}</h3>
              <p className="mt-3 text-[30px] font-semibold tracking-[-0.025em]">
                {plan.price}
                <span className="text-sm font-normal text-mid-gray">{plan.period}</span>
              </p>
              <ul className="mt-4 space-y-2">
                {plan.features.map((item) => (
                  <li key={item} className="text-sm text-mid-gray">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-hairline py-8 text-center text-sm text-mid-gray">
        © 2026 Voxly · getvoxly.ru
      </footer>
    </main>
  );
}
