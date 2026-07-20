import Link from 'next/link';
import { Button } from '@/components/ui/button';

const FEATURES = [
  {
    title: 'Gift-боты',
    desc: 'Воронки, проверка подписки, отложенные сообщения и рассылки',
  },
  {
    title: 'AI Telegram',
    desc: 'Ассистент для Telegram с handoff оператору',
  },
  {
    title: 'AI WhatsApp',
    desc: 'Тот же AI-контур для WhatsApp Cloud API',
  },
  {
    title: 'Сквозная аналитика',
    desc: 'Метрика, GA4, Facebook, VK — offline-конверсии из ботов',
  },
  {
    title: 'Реферальная программа',
    desc: 'Приглашайте клиентов и получайте кредиты на баланс',
  },
  {
    title: 'Twenty CRM',
    desc: 'Контакты, сделки и воронки на self-hosted Twenty',
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
    name: 'AI Telegram',
    price: '1000 ₽',
    period: '/10 акк/мес',
    features: ['AI-ассистент', 'Handoff оператору', '10 аккаунтов', 'AI баланс отдельно'],
  },
  {
    name: 'AI WhatsApp',
    price: '1000 ₽',
    period: '/номер/мес',
    features: ['AI-ассистент', 'WhatsApp Cloud API', 'Handoff оператору', 'AI баланс отдельно'],
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
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <span className="text-sm font-semibold tracking-tight">Voxly</span>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/login">Войти</Link>
            </Button>
            <Button asChild variant="solid" size="sm">
              <Link href="/register">Начать</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-5xl px-6 pb-20 pt-20 text-center animate-in sm:pt-24">
        <p className="text-3xl font-semibold tracking-tight sm:text-4xl">Voxly</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl sm:leading-snug">
          CRM для чат-ботов и AI-ассистентов
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-base text-muted-foreground sm:text-lg">
          Telegram-боты, WhatsApp AI и Twenty CRM в одной платформе. Воронки, диалоги и конверсии —
          без зоопарка сервисов.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button asChild variant="solid" size="lg">
            <Link href="/register">Начать бесплатно</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/login">Войти</Link>
          </Button>
        </div>
        <p className="mt-5 text-sm text-muted-foreground">
          500 ₽/мес · 10 пользователей · 14 дней бесплатно
        </p>
      </section>

      <section className="border-t border-border bg-card">
        <div className="mx-auto grid max-w-5xl gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-card px-6 py-8 transition-colors hover:bg-secondary">
              <h3 className="text-base font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-center text-2xl font-semibold tracking-tight">Тарифы</h2>
        <p className="mt-2 text-center text-sm text-muted-foreground">Платите только за то, что подключаете</p>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className="rounded-lg border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] hover:border-foreground/20"
            >
              <h3 className="text-sm font-semibold">{plan.name}</h3>
              <p className="mt-3 text-2xl font-semibold tracking-tight">
                {plan.price}
                <span className="text-sm font-normal text-muted-foreground">{plan.period}</span>
              </p>
              <ul className="mt-4 space-y-2">
                {plan.features.map((item) => (
                  <li key={item} className="text-sm text-muted-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border py-8 text-center text-sm text-muted-foreground">
        © 2026 Voxly · getvoxly.ru
      </footer>
    </main>
  );
}
