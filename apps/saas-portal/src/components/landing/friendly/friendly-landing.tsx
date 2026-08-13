'use client';

import Link from 'next/link';
import {
  Bot,
  Brain,
  Check,
  FileInput,
  Gift,
  Sparkles,
  ToggleLeft,
} from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ReferralCapture } from '@/components/landing/referral-capture';
import { RegisterLink } from '@/components/landing/register-link';
import { LEGAL, LEGAL_LINKS } from '@/lib/legal';
import { CustomDevCta } from './custom-dev-cta';
import { GiftWidget } from './gift-widget';
import { PhoneDemo } from './phone-demo';
import { PricingCalculator } from './pricing-calculator';
import { ReferralCalculator } from './referral-calculator';

const FEATURES = [
  {
    icon: Sparkles,
    title: '«Магическая» карточка клиента',
    text: 'Ввели номер — Voxly сам найдёт имя, почту, дату рождения и проверит наличие Telegram, WhatsApp и MAX.',
  },
  {
    icon: FileInput,
    title: 'Умный авто-прогрев через Stories',
    text: 'Загрузите акции один раз. Система сама опубликует их по расписанию в Telegram, WhatsApp и MAX.',
    badge: '100% безопасно, по официальным сценариям',
  },
  {
    icon: Gift,
    title: 'Бот-магнит (Gift-бот)',
    text: 'Дарите подарки за подписку на ваш канал. Бот проверит подписку, выдаст бонус и внесёт человека в базу рассылок.',
  },
  {
    icon: Brain,
    title: 'Самообучающийся AI-ассистент',
    text: 'Загрузите свои базы знаний и файлы. AI учится на успешных сделках и ответит клиенту так же, как ваш лучший менеджер.',
  },
  {
    icon: Bot,
    title: 'Бесплатные формы с Tilda и WordPress',
    text: 'Сколько бы у вас ни было сайтов — заявки прилетают моментально, без дублей и без доплаты.',
  },
  {
    icon: ToggleLeft,
    title: 'Управление AI в один тап',
    text: 'В любой момент переключайте режим AI-помощника в чате: Вкл / Пауза / Выкл.',
  },
] as const;

const FAQ = [
  {
    q: 'Нужно ли привязывать банковскую карту для 7 дней теста?',
    a: 'Нет. Тестовый период на 100% бесплатный и даёт полный доступ ко всем функциям. Карту не просим.',
  },
  {
    q: 'Нужно ли скачивать приложение из App Store или Google Play?',
    a: 'Нет. Voxly работает прямо в мобильном браузере как PWA. Это экономит память смартфона и открывается мгновенно.',
  },
  {
    q: 'Безопасно ли использовать автопостинг сторис и мессенджеры?',
    a: 'Да. Voxly работает по безопасным алгоритмам взаимодействия, исключающим риск блокировок. Stories — по официальным сценариям каналов.',
  },
  {
    q: 'Сложно ли обучить сотрудников?',
    a: 'Интерфейс спроектирован по аналогии с привычными мессенджерами. Обучение команды занимает не более 10 минут.',
  },
] as const;

const NAV = [
  { href: '#integrations', label: 'Интеграции' },
  { href: '#mobile', label: 'С телефона' },
  { href: '#features', label: 'Возможности' },
  { href: '#pricing', label: 'Цены' },
  { href: '#custom-dev', label: 'Под ключ' },
] as const;

const INTEGRATED = [
  { name: 'Telegram', tone: 'bg-[#2AABEE]' },
  { name: 'MAX', tone: 'bg-violet-500' },
  { name: 'WhatsApp', tone: 'bg-[#25D366]' },
  { name: 'Telegram бот выдачи подарков', tone: 'bg-amber-500' },
  { name: 'Бот MAX', tone: 'bg-fuchsia-500' },
] as const;

const COMING_SOON = [
  'Авито',
  'ВКонтакте',
  'Одноклассники',
  'Тенчат',
  'Инстаграм',
  'Фейсбук',
] as const;

type Props = { refCode?: string | null };

export function FriendlyLanding({ refCode }: Props) {
  return (
    <div className="friendly-lp min-h-screen bg-white text-slate-900 pb-[5.5rem] md:pb-0">
      <ReferralCapture />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow"
      >
        К основному содержимому
      </a>

      <header className="sticky top-0 z-40 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <Link href="/" className="friendly-brand text-lg font-bold tracking-tight text-slate-900">
            Voxly
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 lg:flex" aria-label="Разделы">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition hover:text-blue-600">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 sm:inline">
              Войти
            </Link>
            <RegisterLink refCode={refCode} className="friendly-btn-sm touch-manipulation">
              7 дней бесплатно
            </RegisterLink>
          </div>
        </div>
      </header>

      {/* 1. Hero */}
      <section id="main" className="relative overflow-hidden">
        <div className="friendly-hero-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pb-16 pt-10 sm:px-6 sm:pb-20 sm:pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-12">
          <div className="friendly-rise">
            <p className="friendly-brand text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
              Voxly
            </p>
            <h1 className="mt-4 max-w-xl text-[1.65rem] font-semibold leading-[1.15] tracking-tight text-slate-900 sm:text-4xl sm:leading-[1.12]">
              Все Ваши клиенты из WhatsApp, Telegram, Max и сайтов — в одном понятном окне на вашем телефоне
            </h1>
            <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600 sm:text-lg">
              Voxly автоматически найдёт все социальные сети клиента, ФИО, Дату рождения и заполнит карточку
              контакта. Без сложных настроек за 5 минут.
            </p>
            <div className="mt-8 flex flex-col items-start gap-3">
              <RegisterLink refCode={refCode} className="friendly-btn touch-manipulation">
                Попробовать 7 дней бесплатно
              </RegisterLink>
              <p className="text-sm text-slate-500">Без банковской карты · Настройка занимает 3 минуты</p>
            </div>
          </div>
          <div className="friendly-rise-delay flex justify-center lg:justify-end">
            <PhoneDemo />
          </div>
        </div>
      </section>

      {/* 2. Integrations */}
      <section id="integrations" className="border-t border-slate-100 bg-[#FAFAFA] py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Мы уже интегрировали в систему:
          </h2>
          <p className="mt-3 max-w-xl text-slate-600">
            Мессенджеры и боты подключены — работаете из одного окна.
          </p>

          <ul className="mt-8 flex flex-wrap gap-3">
            {INTEGRATED.map((item) => (
              <li
                key={item.name}
                className="inline-flex items-center gap-2.5 rounded-2xl bg-white px-4 py-3 text-sm font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200/80"
              >
                <span className={`h-2.5 w-2.5 rounded-full ${item.tone}`} aria-hidden />
                {item.name}
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                  есть
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-10 rounded-3xl border border-dashed border-slate-300 bg-white/70 p-5 sm:p-7">
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">Скоро</p>
            <ul className="mt-4 flex flex-wrap gap-2.5">
              {COMING_SOON.map((name) => (
                <li
                  key={name}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3.5 py-2 text-sm font-medium text-slate-600"
                >
                  {name}
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 ring-1 ring-slate-200">
                    скоро
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* 3. Mobile PWA */}
      <section id="mobile" className="py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Работать в Voxly CRM с телефона так же просто, как в обычном мессенджере
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
              Не нужно скачивать приложения из App Store или Google Play. Откройте сайт с телефона — всё уже работает.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-700">
              {[
                'Управление сделками на канбан доске',
                'Карточка контакта и сделки редактируется',
                'Чат с клиентом из любого мессенджера в одном окне',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex justify-center">
            <PhoneDemo compact />
          </div>
        </div>
      </section>

      {/* 4. Features */}
      <section id="features" className="border-t border-slate-100 bg-[#FAFAFA] py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="max-w-2xl text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Сложные технологии — простым языком
          </h2>
          <p className="mt-3 max-w-xl text-slate-600">Шесть инструментов, которые закрывают хаос в продажах.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              const badge = 'badge' in feature ? feature.badge : null;
              return (
                <article
                  key={feature.title}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-blue-200 hover:shadow-md"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Icon className="h-5 w-5" aria-hidden />
                  </div>
                  <h3 className="mt-4 text-base font-semibold text-slate-900">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{feature.text}</p>
                  {badge ? (
                    <span className="mt-3 inline-block rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-800">
                      {badge}
                    </span>
                  ) : null}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* 5. Pricing */}
      <section id="pricing" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Рассчитайте стоимость за 5 секунд. Никаких скрытых платежей.
            </h2>
            <p className="mt-3 text-slate-600">CRM от 600 ₽ · формы с сайта бесплатно · модули — по желанию.</p>
          </div>
          <div className="mx-auto mt-10 max-w-5xl">
            <PricingCalculator refCode={refCode} />
          </div>
        </div>
      </section>

      {/* 6. Referral */}
      <section id="referral" className="border-t border-slate-100 bg-[#FAFAFA] py-16 sm:py-20">
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Пользуйтесь Voxly бесплатно или зарабатывайте на рекомендациях
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
              Рекомендуйте Voxly коллегам и получайте <strong className="font-semibold text-slate-900">20% с каждой их оплаты</strong> на постоянной основе.
            </p>
          </div>
          <ReferralCalculator refCode={refCode} />
        </div>
      </section>

      {/* 7. Custom development */}
      <section id="custom-dev" className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="rounded-3xl bg-slate-900 px-6 py-10 text-white sm:px-10 sm:py-12">
            <h2 className="max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
              Нужна уникальная функция или интеграция? Сделаем под ключ.
            </h2>
            <p className="mt-3 max-w-xl text-slate-300">
              У вас специфический процесс или самописная система? Наша команда доработает Voxly под ваши задачи.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-slate-200">
              <li>Интеграции с 1С, складскими программами и любыми API.</li>
              <li>Индивидуальные отчёты и аналитические дашборды.</li>
              <li>Персональные AI-сценарии и логика ботов.</li>
            </ul>
            <div className="mt-8 flex flex-col items-start gap-2">
              <CustomDevCta className="friendly-btn-light touch-manipulation" />
              <p className="text-sm text-slate-400">Оценка сроков и стоимости — за 24 часа</p>
            </div>
          </div>
        </div>
      </section>

      {/* 8. Onboarding */}
      <section id="how" className="border-t border-slate-100 bg-[#FAFAFA] py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            3 простых шага к порядку в продажах
          </h2>
          <ol className="mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                n: '1',
                title: 'Быстрая регистрация (1 мин)',
                text: 'Укажите почту или телефон. Карта не нужна.',
              },
              {
                n: '2',
                title: 'Подключение за пару кликов (2 мин)',
                text: 'Отсканируйте QR-код для мессенджеров и вставьте ссылку для Tilda/WP.',
              },
              {
                n: '3',
                title: 'Принимайте первые заявки',
                text: 'Вся работа идёт с телефона или компьютера.',
              },
            ].map((step) => (
              <li key={step.n} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold text-white">
                  {step.n}
                </span>
                <h3 className="mt-4 text-base font-semibold text-slate-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 9. FAQ */}
      <section id="faq" className="py-16 sm:py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Частые вопросы
          </h2>
          <Accordion type="single" collapsible className="mt-8">
            {FAQ.map((item, i) => (
              <AccordionItem key={item.q} value={`faq-${i}`}>
                <AccordionTrigger className="text-left text-base font-medium text-slate-900 hover:no-underline">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="text-sm leading-relaxed text-slate-600">{item.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* 10. Final CTA + footer */}
      <section className="border-t border-slate-100 bg-blue-600 px-4 py-14 text-center text-white sm:px-6 sm:py-16">
        <h2 className="mx-auto max-w-2xl text-2xl font-semibold tracking-tight sm:text-3xl">
          Попробуйте Voxly 7 дней без ограничений и оплаты
        </h2>
        <p className="mx-auto mt-3 max-w-lg text-blue-100">
          Перенесите все чаты и заявки в один экран уже сегодня.
        </p>
        <RegisterLink
          refCode={refCode}
          className="friendly-btn-light mx-auto mt-8 inline-flex touch-manipulation"
        >
          Начать 7 дней бесплатно
        </RegisterLink>
      </section>

      <footer className="border-t border-slate-200 bg-white py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <p className="friendly-brand text-lg font-bold text-slate-900">Voxly</p>
            <p className="mt-1 text-sm text-slate-500">{LEGAL.legalEntityShort}</p>
            <p className="mt-1 text-sm text-slate-500">
              <a href={LEGAL.emailHref} className="hover:text-blue-600">
                {LEGAL.email}
              </a>
            </p>
            <p className="mt-3 text-xs text-slate-400">
              {LEGAL.siteHost}
            </p>
          </div>
          <ul className="flex flex-col gap-2 text-sm text-slate-600">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-blue-600">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </footer>

      {/* Mobile sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 backdrop-blur md:hidden">
        <RegisterLink
          refCode={refCode}
          className="friendly-btn flex w-full items-center justify-center touch-manipulation"
        >
          Попробовать 7 дней бесплатно
        </RegisterLink>
      </div>

      <GiftWidget refCode={refCode} />
    </div>
  );
}

