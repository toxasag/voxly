'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import {
  Bot,
  Brain,
  Check,
  FileInput,
  Gift,
  Inbox,
  LayoutGrid,
  Radio,
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
import { CustomDevCta } from '../friendly/custom-dev-cta';
import { GiftWidget } from '../friendly/gift-widget';
import { PricingCalculator } from '../friendly/pricing-calculator';
import { ReferralCalculator } from '../friendly/referral-calculator';
import { HeroShowcase } from './hero-showcase';
import { PhoneEnrichDemo } from './phone-enrich-demo';
import { Reveal, RevealGroup, RevealItem } from './reveal';

const NAV = [
  { href: '#integrations', label: 'Интеграции' },
  { href: '#inbox', label: 'Один чат' },
  { href: '#features', label: 'Возможности' },
  { href: '#pricing', label: 'Цены' },
  { href: '#custom-dev', label: 'Под ключ' },
] as const;

const INTEGRATED = [
  { name: 'Telegram', tone: '#2aabee' },
  { name: 'WhatsApp', tone: '#25d366' },
  { name: 'MAX', tone: '#a855f7' },
  { name: 'Telegram бот выдачи подарков', tone: '#f59e0b' },
  { name: 'Бот MAX', tone: '#d946ef' },
  { name: 'Формы с Tilda и WordPress', tone: '#0ea5e9' },
] as const;

const COMING_SOON = [
  'Instagram',
  'Facebook',
  'Авито',
  'TenChat',
  'LinkedIn',
  'ВКонтакте',
  'Одноклассники',
] as const;

const FEATURES = [
  {
    icon: Sparkles,
    title: '«Магическая» карточка клиента',
    text: 'Ввели номер — Voxly сам найдёт имя, дату рождения и проверит наличие Telegram, WhatsApp и MAX. Честные ссылки без выдумки.',
  },
  {
    icon: Inbox,
    title: 'Один чат для всех мессенджеров',
    text: 'WhatsApp, Telegram и MAX клиента — в одной ленте сделки. Пишите в любой канал в один тап, не переключая приложения.',
  },
  {
    icon: Radio,
    title: 'Прогрев через Stories',
    text: 'Ваши Stories видят те, кто с вами уже переписывается — самая тёплая аудитория. Автопостинг по расписанию, безопасно.',
    badge: '100% по официальным сценариям',
  },
  {
    icon: Brain,
    title: 'Самообучающийся AI-агент',
    text: 'Загрузите базы знаний и файлы. AI учится на успешных сделках и отвечает клиенту как ваш лучший менеджер — во всех каналах.',
  },
  {
    icon: Gift,
    title: 'Бот-магнит (Gift-бот)',
    text: 'Дарите подарки за подписку на канал. Бот проверит подписку, выдаст бонус и внесёт человека в базу рассылок.',
  },
  {
    icon: FileInput,
    title: 'Бесплатные формы с сайтов',
    text: 'Сколько бы ни было сайтов на Tilda или WordPress — заявки прилетают моментально, без дублей и без доплаты.',
  },
] as const;

const STEPS = [
  { n: '1', title: 'Регистрация за 1 минуту', text: 'Укажите почту или телефон. Карта не нужна.' },
  { n: '2', title: 'Подключение за пару кликов', text: 'QR-код для мессенджеров, ссылка для Tilda / WordPress.' },
  { n: '3', title: 'Принимайте первые заявки', text: 'Вся работа идёт с телефона или компьютера.' },
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
    q: 'Безопасно ли использовать автопостинг Stories и мессенджеры?',
    a: 'Да. Voxly работает по безопасным алгоритмам взаимодействия, исключающим риск блокировок. Stories — по официальным сценариям каналов.',
  },
  {
    q: 'Сложно ли обучить сотрудников?',
    a: 'Интерфейс спроектирован по аналогии с привычными мессенджерами. Обучение команды занимает не более 10 минут.',
  },
] as const;

type Props = { refCode?: string | null };

export function VoxlyLanding({ refCode }: Props) {
  return (
    <div className="voxly-lp min-h-screen pb-[5.5rem] md:pb-0">
      <ReferralCapture />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-slate-900 focus:shadow"
      >
        К основному содержимому
      </a>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-[rgba(2,8,23,0.08)] bg-[#f9f9f9]/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:h-16 sm:px-6">
          <Link href="/" className="vx-brand text-lg font-bold tracking-tight text-[#020817]">
            Voxly
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium text-[#64686f] lg:flex" aria-label="Разделы">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="transition hover:text-[#020817]">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden text-sm font-medium text-[#64686f] hover:text-[#020817] sm:inline">
              Войти
            </Link>
            <RegisterLink refCode={refCode} className="vx-btn h-9 min-h-0 px-3.5 text-[13px] touch-manipulation">
              7 дней бесплатно
            </RegisterLink>
          </div>
        </div>
      </header>

      {/* 01 — Hero */}
      <section id="main" className="relative overflow-hidden">
        <div className="vx-hero-bg pointer-events-none absolute inset-0" aria-hidden />
        <div className="vx-grid-lines pointer-events-none absolute inset-0" aria-hidden />
        <span className="vx-section-no pointer-events-none absolute right-4 top-24 text-6xl sm:right-10 sm:text-8xl" aria-hidden>
          01
        </span>
        <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-12 sm:px-6 sm:pb-24 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-12">
          <div>
            <motion.p
              className="vx-eyebrow"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
            >
              ./все-мессенджеры-в-одном-окне
            </motion.p>
            <motion.h1
              className="mt-4 max-w-xl text-[2rem] font-bold leading-[1.05] text-[#020817] sm:text-[3.25rem]"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05 }}
            >
              Все клиенты из WhatsApp, Telegram и MAX — в{' '}
              <span className="vx-gradient-text">одном окне</span> на телефоне
            </motion.h1>
            <motion.p
              className="mt-5 max-w-lg text-base leading-relaxed text-[#4b5160] sm:text-lg"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.15 }}
            >
              Введите номер — Voxly сам найдёт имя, дату рождения и соцсети клиента. Пишите во все
              мессенджеры из одного чата. AI отвечает как ваш лучший менеджер.
            </motion.p>
            <motion.div
              className="mt-8 flex flex-col items-start gap-3"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.25 }}
            >
              <div className="flex flex-wrap gap-3">
                <RegisterLink refCode={refCode} className="vx-btn touch-manipulation">
                  Попробовать 7 дней бесплатно
                </RegisterLink>
                <a href="#inbox" className="vx-btn-ghost touch-manipulation">
                  Как это работает
                </a>
              </div>
              <p className="text-sm text-[#7a7f89]">
                Без банковской карты · Настройка за 3 минуты · Работает в браузере телефона
              </p>
            </motion.div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroShowcase />
          </div>
        </div>
      </section>

      {/* 02 — Integrations */}
      <Section id="integrations" no="02" alt>
        <SectionHead
          eyebrow="./интеграции"
          title="Мессенджеры и боты уже подключены"
          subtitle="Работаете из одного окна. Новые каналы и выкладка Stories в них — на подходе."
        />
        <RevealGroup className="mt-8 flex flex-wrap gap-3">
          {INTEGRATED.map((item) => (
            <RevealItem
              key={item.name}
              as="div"
              className="vx-chip inline-flex items-center gap-2.5 px-4 py-3 text-sm font-semibold text-[#020817]"
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.tone }} aria-hidden />
              {item.name}
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                есть
              </span>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="mt-10 rounded-lg border border-dashed border-[rgba(2,8,23,0.18)] bg-white p-5 sm:p-7">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#8261fb]">
            Скоро — вместе с выкладкой Stories
          </p>
          <ul className="mt-4 flex flex-wrap gap-2.5">
            {COMING_SOON.map((name) => (
              <li
                key={name}
                className="inline-flex items-center gap-2 rounded-full bg-[#f3f4f6] px-3.5 py-2 text-sm font-medium text-[#4b5160]"
              >
                {name}
                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8261fb] ring-1 ring-[rgba(130,97,251,0.25)]">
                  скоро
                </span>
              </li>
            ))}
          </ul>
        </Reveal>
      </Section>

      {/* 03 — Magic card / phone enrich */}
      <Section id="magic" no="03">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <p className="vx-eyebrow">./magic-card</p>
            <h2 className="mt-3 text-2xl font-bold text-[#020817] sm:text-4xl">
              Один номер — вся карточка клиента заполнена
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[#4b5160] sm:text-lg">
              При создании сделки вводите телефон — Voxly проверяет Telegram, WhatsApp и MAX, находит
              профили, имя и дату рождения и подтягивает кликабельные ссылки на соцсети. Ничего не
              выдумывает: <code className="rounded bg-[#eef0f3] px-1.5 py-0.5 text-sm text-[#020817]">wa.me</code>{' '}
              покажется, только если WhatsApp реально существует.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-[#3a4050]">
              {[
                'Данные из Telegram, WhatsApp, MAX и форм с сайта',
                'Имя, дата рождения, кликабельные соцсети',
                'Автоматическое объединение дублей по номеру',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <PhoneEnrichDemo />
          </Reveal>
        </div>
      </Section>

      {/* 04 — One inbox */}
      <Section id="inbox" no="04" alt>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal delay={0.1} className="order-2 lg:order-1">
            <InboxMock />
          </Reveal>
          <Reveal className="order-1 lg:order-2">
            <p className="vx-eyebrow">./one-inbox</p>
            <h2 className="mt-3 text-2xl font-bold text-[#020817] sm:text-4xl">
              Пишите клиенту в любой мессенджер из одного чата
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[#4b5160] sm:text-lg">
              WhatsApp, Telegram, MAX и заявки с сайта — в одном окне прямо внутри сделки. Видно, где
              клиент на связи, и можно ответить в нужный канал в один тап. Текст, фото, видео,
              голосовые и документы — всё в одном месте.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-[#3a4050]">
              {[
                'Все каналы клиента — в одной ленте сделки',
                'Отправка текста и медиа в любой мессенджер',
                'Статусы «печатает» и отметки о прочтении',
                'Один человек — один диалог, без дублей',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </Section>

      {/* 05 — Features grid */}
      <Section id="features" no="05">
        <SectionHead
          eyebrow="./возможности"
          title="Сложные технологии — простым языком"
          subtitle="Шесть инструментов, которые закрывают хаос в продажах."
        />
        <RevealGroup className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            const badge = 'badge' in feature ? feature.badge : null;
            return (
              <RevealItem key={feature.title} as="article" className="vx-card p-5">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#f4f2ff] text-[#8261fb] ring-1 ring-[rgba(130,97,251,0.2)]">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <h3 className="mt-4 text-base font-semibold text-[#020817]">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#4b5160]">{feature.text}</p>
                {badge ? (
                  <span className="mt-3 inline-block rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                    {badge}
                  </span>
                ) : null}
              </RevealItem>
            );
          })}
        </RevealGroup>
      </Section>

      {/* 06 — AI agent */}
      <Section id="ai" no="06" alt>
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <p className="vx-eyebrow">./ai-agent</p>
            <h2 className="mt-3 text-2xl font-bold text-[#020817] sm:text-4xl">
              AI-ассистент, который отвечает как ваш лучший менеджер
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[#4b5160] sm:text-lg">
              Загрузите базы знаний и файлы (txt, md, pdf) — AI учится на ваших успешных сделках и
              отвечает клиентам в вашем стиле. Понимает голосовые, видео, фото и документы. Один агент
              работает во всех каналах.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-[#3a4050]">
              {[
                'Обучение на выигранных сделках и вашей базе знаний',
                'Понимает голос, видео, фото и PDF',
                'Управление в один тап: Вкл / Пауза / Выкл',
                'Кошелёк не уходит в минус — без сюрпризов по счетам',
              ].map((t) => (
                <li key={t} className="flex items-start gap-2">
                  <ToggleLeft className="mt-0.5 h-4 w-4 shrink-0 text-[#8261fb]" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={0.1}>
            <AiMock />
          </Reveal>
        </div>
      </Section>

      {/* 07 — Pricing */}
      <Section id="pricing" no="07">
        <SectionHead
          center
          eyebrow="./цены"
          title="Рассчитайте стоимость за 5 секунд"
          subtitle="CRM от 600 ₽ · формы с сайта бесплатно · модули — по желанию. Никаких скрытых платежей."
        />
        <Reveal className="mx-auto mt-10 max-w-5xl">
          <PricingCalculator refCode={refCode} />
        </Reveal>
      </Section>

      {/* Referral */}
      <Section id="referral" no="08" alt>
        <div className="grid items-start gap-10 lg:grid-cols-2">
          <Reveal>
            <p className="vx-eyebrow">./партнёрам</p>
            <h2 className="mt-3 text-2xl font-bold text-[#020817] sm:text-4xl">
              Пользуйтесь Voxly бесплатно или зарабатывайте на рекомендациях
            </h2>
            <p className="mt-4 text-base leading-relaxed text-[#4b5160] sm:text-lg">
              Рекомендуйте Voxly коллегам и получайте{' '}
              <strong className="font-semibold text-[#020817]">20% с каждой их оплаты</strong> на
              постоянной основе.
            </p>
          </Reveal>
          <Reveal delay={0.1}>
            <ReferralCalculator refCode={refCode} />
          </Reveal>
        </div>
      </Section>

      {/* Custom dev — light card with lime accent */}
      <Section id="custom-dev" no="09">
        <Reveal className="relative overflow-hidden rounded-xl border border-[rgba(2,8,23,0.1)] bg-white px-6 py-10 shadow-[0_24px_60px_-40px_rgba(2,8,23,0.35)] sm:px-10 sm:py-12">
          <div
            className="pointer-events-none absolute inset-0 opacity-80"
            style={{
              background:
                'radial-gradient(ellipse 45% 70% at 100% 0%, rgba(224,254,86,0.35), transparent 55%), radial-gradient(ellipse 40% 60% at 0% 100%, rgba(130,97,251,0.12), transparent 55%)',
            }}
            aria-hidden
          />
          <div className="relative">
            <p className="vx-eyebrow">./под-ключ</p>
            <h2 className="mt-3 max-w-2xl text-2xl font-bold text-[#020817] sm:text-3xl">
              Нужна уникальная функция или интеграция? Сделаем под ключ.
            </h2>
            <p className="mt-3 max-w-xl text-[#4b5160]">
              У вас специфический процесс или самописная система? Наша команда доработает Voxly под
              ваши задачи.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-[#3a4050]">
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Интеграции с 1С, складскими программами и любыми API.
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Индивидуальные отчёты и аналитические дашборды.
              </li>
              <li className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                Персональные AI-сценарии и логика ботов.
              </li>
            </ul>
            <div className="mt-8 flex flex-col items-start gap-2">
              <CustomDevCta className="vx-btn touch-manipulation" />
              <p className="text-sm text-[#7a7f89]">Оценка сроков и стоимости — за 24 часа</p>
            </div>
          </div>
        </Reveal>
      </Section>

      {/* Steps */}
      <Section id="how" no="10" alt>
        <SectionHead eyebrow="./старт" title="3 простых шага к порядку в продажах" />
        <RevealGroup className="mt-10 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step) => (
            <RevealItem key={step.n} as="div" className="vx-card p-5">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#020817] text-sm font-bold text-white">
                {step.n}
              </span>
              <h3 className="mt-4 text-base font-semibold text-[#020817]">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#4b5160]">{step.text}</p>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      {/* FAQ */}
      <Section id="faq" no="11">
        <div className="mx-auto max-w-3xl">
          <SectionHead center eyebrow="./faq" title="Частые вопросы" />
          <Reveal className="mt-8">
            <Accordion type="single" collapsible>
              {FAQ.map((item, i) => (
                <AccordionItem key={item.q} value={`faq-${i}`} className="border-[rgba(2,8,23,0.1)]">
                  <AccordionTrigger className="text-left text-base font-medium text-[#020817] hover:no-underline">
                    {item.q}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-[#4b5160]">
                    {item.a}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </Reveal>
        </div>
      </Section>

      {/* Final CTA — light with lime glow */}
      <section className="relative overflow-hidden border-t border-[rgba(2,8,23,0.06)] bg-white px-4 py-16 text-center sm:px-6 sm:py-20">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse 55% 75% at 50% 0%, rgba(224,254,86,0.4), transparent 60%), radial-gradient(ellipse 40% 60% at 50% 100%, rgba(130,97,251,0.1), transparent 60%)',
          }}
          aria-hidden
        />
        <Reveal className="relative">
          <p className="vx-eyebrow">./старт</p>
          <h2 className="mx-auto mt-3 max-w-2xl text-2xl font-bold text-[#020817] sm:text-4xl">
            Попробуйте Voxly 7 дней без ограничений и оплаты
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-[#4b5160]">
            Перенесите все чаты и заявки в один экран уже сегодня.
          </p>
          <RegisterLink refCode={refCode} className="vx-btn mx-auto mt-8 inline-flex touch-manipulation">
            Начать 7 дней бесплатно
          </RegisterLink>
        </Reveal>
      </section>

      {/* Footer */}
      <footer className="border-t border-[rgba(2,8,23,0.1)] bg-[#f9f9f9] py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <p className="vx-brand text-lg font-bold text-[#020817]">Voxly</p>
            <p className="mt-1 text-sm text-[#64686f]">{LEGAL.legalEntityShort}</p>
            <p className="mt-1 text-sm text-[#64686f]">
              <a href={LEGAL.emailHref} className="hover:text-[#020817]">
                {LEGAL.email}
              </a>
            </p>
            <p className="mt-3 text-xs text-[#9aa0aa]">{LEGAL.siteHost}</p>
          </div>
          <ul className="flex flex-col gap-2 text-sm text-[#64686f]">
            {LEGAL_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-[#020817]">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </footer>

      {/* Mobile sticky CTA */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[rgba(2,8,23,0.1)] bg-[#f9f9f9]/95 p-3 backdrop-blur md:hidden">
        <RegisterLink
          refCode={refCode}
          className="vx-btn flex w-full items-center justify-center touch-manipulation"
        >
          Попробовать 7 дней бесплатно
        </RegisterLink>
      </div>

      <GiftWidget refCode={refCode} />
    </div>
  );
}

/* —— Section scaffolding —— */

function Section({
  id,
  no,
  alt,
  children,
}: {
  id: string;
  no: string;
  alt?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className={`relative border-t border-[rgba(2,8,23,0.06)] py-16 sm:py-24 ${alt ? 'bg-white' : ''}`}
    >
      <span className="vx-section-no pointer-events-none absolute right-4 top-8 text-5xl sm:right-10 sm:text-7xl" aria-hidden>
        {no}
      </span>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

function SectionHead({
  eyebrow,
  title,
  subtitle,
  center,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <Reveal className={center ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl'}>
      <p className="vx-eyebrow">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-bold text-[#020817] sm:text-4xl">{title}</h2>
      {subtitle ? <p className="mt-3 text-[#4b5160]">{subtitle}</p> : null}
    </Reveal>
  );
}

/* —— Light mocks —— */

function InboxMock() {
  const rows = [
    { ch: 'Telegram', color: '#2aabee', side: 'in' as const, text: 'Здравствуйте! Есть доставка на завтра?' },
    { ch: 'WhatsApp', color: '#25d366', side: 'out' as const, text: 'Да, можем к 14:00. Оформим?' },
    { ch: 'MAX', color: '#a855f7', side: 'in' as const, text: 'Отлично, давайте' },
  ];
  return (
    <div className="vx-card mx-auto max-w-sm overflow-hidden p-0 shadow-[0_20px_50px_-30px_rgba(2,8,23,0.3)]">
      <div className="flex items-center gap-2 border-b border-[rgba(2,8,23,0.08)] px-4 py-3">
        <LayoutGrid className="h-4 w-4 text-[#8261fb]" />
        <span className="text-sm font-semibold text-[#020817]">Мария К. · одно окно</span>
      </div>
      <div className="flex gap-1.5 border-b border-[rgba(2,8,23,0.08)] px-3 py-2">
        {['Telegram', 'WhatsApp', 'MAX'].map((c, i) => (
          <span
            key={c}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
              i === 0 ? 'bg-[#020817] text-white' : 'text-[#8a8f99]'
            }`}
          >
            {c}
          </span>
        ))}
      </div>
      <div className="space-y-2.5 bg-[#fafafa] p-4">
        {rows.map((r, i) => (
          <div key={i} className={`flex ${r.side === 'out' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[80%]">
              <div className="mb-1 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: r.color }} />
                <span className="text-[10px] text-[#9aa0aa]">{r.ch}</span>
              </div>
              <div
                className={`rounded-2xl px-3 py-2 text-[12px] leading-snug ${
                  r.side === 'out'
                    ? 'rounded-br-md bg-[#020817] text-white'
                    : 'rounded-bl-md bg-white text-[#3a4050] ring-1 ring-[rgba(2,8,23,0.08)]'
                }`}
              >
                {r.text}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t border-[rgba(2,8,23,0.08)] px-4 py-2.5 text-[11px] text-[#9aa0aa]">
        Ответ уходит в выбранный канал · AI на паузе
      </div>
    </div>
  );
}

function AiMock() {
  return (
    <div className="vx-card mx-auto max-w-sm p-4 shadow-[0_20px_50px_-30px_rgba(2,8,23,0.3)]">
      <div className="flex items-center gap-2 border-b border-[rgba(2,8,23,0.08)] pb-3">
        <Bot className="h-4 w-4 text-[#8261fb]" />
        <span className="text-sm font-semibold text-[#020817]">AI-агент · Продажи</span>
        <span className="ml-auto rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
          Вкл
        </span>
      </div>
      <div className="space-y-2.5 pt-4">
        <div className="flex justify-start">
          <div className="max-w-[82%] rounded-2xl rounded-bl-md bg-[#f3f4f6] px-3 py-2 text-[12px] text-[#3a4050]">
            🎤 голосовое · <span className="text-[#8a8f99]">«Сколько стоит и когда доставите?»</span>
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[82%] rounded-2xl rounded-br-md bg-[#020817] px-3 py-2 text-[12px] text-white">
            Курс «Старт» — 48 000 ₽.
          </div>
        </div>
        <div className="flex justify-end">
          <div className="max-w-[82%] rounded-2xl rounded-br-md bg-[#020817] px-3 py-2 text-[12px] text-white">
            Доставим завтра к 14:00. Оформляем? 😊
          </div>
        </div>
      </div>
      <p className="mt-3 border-t border-[rgba(2,8,23,0.08)] pt-2.5 text-[11px] text-[#9aa0aa]">
        Расшифровал голосовое и ответил как менеджер
      </p>
    </div>
  );
}
