import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { MobileProof } from '@/components/landing/mobile-proof';
import {
  AnnotatedChatMock,
  HeroSignature,
  KanbanMock,
  ModuleMini,
  TransformCompare,
} from '@/components/landing/product-mocks';
import { ReferralCapture } from '@/components/landing/referral-capture';
import { RegisterLink } from '@/components/landing/register-link';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { LEGAL, LEGAL_LINKS } from '@/lib/legal';

const CRM_CHAPTERS = [
  {
    id: 'crm-funnel',
    num: '01',
    label: 'Воронка',
    title: 'Воронка и канбан',
    scenario:
      'Утро понедельника. Открываешь канбан — новые лиды слева, деньги справа. Карточка уже с именем, суммой и заметкой.',
    bullets: [
      'Виды: Канбан (по умолчанию) и Списком',
      'Сделка: сумма, этап, заметки, владелец',
      'Этапы: зафиксированы «Новый лид» / «Успешная» / «Провалена»; середину настраивает команда',
      'Запись открывается в боковой панели — контекст канбана не теряется',
      'На карточке: имя, дата, сумма, заметки',
    ],
    visual: 'kanban' as const,
  },
  {
    id: 'crm-chat',
    num: '02',
    label: 'Чат',
    title: 'Чат в сделке — сердце продукта',
    scenario:
      'Открыл сделку → вкладка «Чат» сразу после «Главная». История канала, ответ из карточки, AI на паузе одним тапом.',
    bullets: [
      'Чат на контакте и на сделке',
      'Multi-channel: gift-бот / Telegram Business / личный Telegram / WhatsApp / MAX',
      'Переключатель тредов, если каналов несколько',
      'Шапка: канал · от чьего имени · peer; presence / last-seen где канал умеет',
      'Toolbar, MarkdownV2, кликабельные ссылки; вложения с preview PDF/DOCX',
      'Pinned composer; AI вкл / пауза / выкл; открыл чат = прочитано',
    ],
    punch: 'Ни один лид не должен ждать ответа в пустом мессенджере.',
    visual: 'chat' as const,
  },
  {
    id: 'crm-contacts',
    num: '03',
    label: 'Контакты',
    title: 'Контакты и соцполя',
    scenario:
      'Тот же человек написал в Telegram, потом в WhatsApp. В CRM это один контакт — не два «новых клиента».',
    bullets: [
      'Person: имя, телефоны, соцсети',
      'Поля: Telegram, WhatsApp, VK, OK, Instagram, Facebook, Threads, LinkedIn, сайт',
      'Входящее → контакт + сделка (не теряется в мессенджере)',
      'Cross-channel merge по телефону (TG ↔ WA)',
      'Сообщения пишутся всегда; AI отвечает только если назначен агент',
    ],
    visual: 'none' as const,
  },
  {
    id: 'crm-team',
    num: '04',
    label: 'Команда',
    title: 'Команда — 10 человек в Base',
    scenario:
      'Десять менеджеров в CRM Base. Каждый отвечает из CRM — от имени подключённого канала.',
    bullets: [
      '10 пользователей в CRM Base',
      'Инвайт сотрудников, доступы, учётные данные',
      'В сайдбаре: «Кабинет Voxly» и «Рассылка»',
      'Extra seat — 300 ₽',
    ],
    visual: 'none' as const,
  },
  {
    id: 'crm-mailing',
    num: '05',
    label: 'Рассылки',
    title: 'Рассылки из CRM',
    scenario:
      'Сделка перешла на этап «Догрев» — ушла отложенная серия. Всё из папки «Рассылка» внутри CRM, не из третьего кабинета.',
    bullets: [
      'Папка: бот / аккаунты / WhatsApp / сторис',
      'Фильтры: этап сделки, статусы, gift, прочитанность',
      'Правила автоотправки при смене этапа',
      'История, превью, редактирование отложенных',
    ],
    visual: 'mailing' as const,
  },
  {
    id: 'crm-signals',
    num: '06',
    label: 'Сигналы',
    title: 'Badges и toasts',
    scenario:
      'На канбане unread. Слева toast «новое входящее». Открытый чат подтягивает сообщение сам.',
    bullets: [
      'Unread badges на карточках сделок и контактов',
      'Toast слева + автообновление открытого чата',
      'Mark read при открытии чата',
    ],
    visual: 'kanban' as const,
  },
] as const;

const STEPS = [
  {
    number: '01',
    title: 'Регистрация',
    text: 'Минута. Кабинет уже на месте.',
  },
  {
    number: '02',
    title: 'CRM готова',
    text: 'Рабочее пространство провижинится при регистрации.',
  },
  {
    number: '03',
    title: 'Канал',
    text: 'Бот, WhatsApp QR, Telegram или MAX — что используешь.',
  },
  {
    number: '04',
    title: 'Ответ из сделки',
    text: 'С компьютера или с телефона — в том же чате.',
  },
] as const;

const MODULES = [
  {
    num: '01',
    title: 'Телеграм Секретарь',
    price: '1000 ₽ / 10 Business · +200 ₽ extra',
    pain: 'Сторис и прогрев размазаны по аккаунтам — inbox никто не видит в CRM.',
    does: 'До 10 Business-аккаунтов → один inbox.',
    inCrm: 'Треды в чате сделки и контакта.',
    kind: 'secretary' as const,
  },
  {
    num: '02',
    title: 'AI-агент',
    price: '500 ₽ / слот',
    pain: 'Ночной лид без ответа.',
    does: 'KB + обучение на успешных сделках; пачки, «печатает», пауза/выкл.',
    inCrm: 'Тумблеры AI прямо в чате сделки.',
    punch: 'AI отвечает первым. Менеджер забирает диалог одним тапом.',
    kind: 'ai' as const,
  },
  {
    num: '03',
    title: 'Личный Telegram / WhatsApp / MAX',
    price: 'по 500 ₽',
    pain: 'Личные переписки вне CRM.',
    does: 'QR/подключение → диалоги в той же CRM.',
    inCrm: 'Тот же чат, тот же mark-read.',
    kind: 'channel' as const,
  },
  {
    num: '04',
    title: 'Gift-бот',
    price: '500 ₽',
    pain: 'Подписка и подарки живут в боте, сделки — «потом вручную».',
    does: 'Подписка, воронка, подарки по расписанию → лиды в CRM.',
    inCrm: 'Контакт + сделка с этапа «Новый лид».',
    kind: 'gift' as const,
  },
  {
    num: '05',
    title: 'Рассылки и сторис',
    price: 'bot 500 · accounts 500 · stories 1000',
    pain: 'Догон аудитории в отдельном кабинете.',
    does: 'По этапам CRM, аудиториям, расписанию; постинг сторис.',
    inCrm: 'Папка «Рассылка» внутри CRM.',
    kind: 'mailing' as const,
  },
] as const;

const AUDIENCE = [
  'Команда 2–10, продажи в мессенджерах',
  'Уже есть трафик/лиды — нужна дисциплина закрытия',
  'Не хотят три биллинга и три приложения',
  'Нужен AI на первой линии с handoff человеку',
] as const;

const SKUS = [
  { sku: 'CRM_BASE', price: '500 ₽ / 10 мест' },
  { sku: 'EXTRA_SEAT', price: '300 ₽' },
  { sku: 'AI_TG Секретарь', price: '1000 ₽ / 10 акк · +200' },
  { sku: 'AI_AGENT', price: '500 ₽ / слот' },
  { sku: 'AI_GRAMJS / WA / MAX', price: '500 ₽' },
  { sku: 'GIFT_BOT', price: '500 ₽' },
  { sku: 'MAILING_BOT / ACCOUNTS', price: '500 ₽' },
  { sku: 'MAILING_STORIES', price: '1000 ₽' },
] as const;

const FAQ = [
  {
    q: 'Нужно ли приложение?',
    a: 'Нет. VoxlyCRM — веб в браузере на компьютере и телефоне.',
  },
  {
    q: 'Можно ли работать только с телефона?',
    a: 'Да. Канбан, сделка, чат, ответ и вложения доступны в мобильном вебе.',
  },
  {
    q: 'Что входит в 500 ₽?',
    a: 'CRM Base: рабочее пространство, канбан/список, чат в сделке, до 10 пользователей. Каналы и AI — отдельными модулями.',
  },
  {
    q: 'Чем это не amo/Bitrix + Wazzup?',
    a: 'Не склеиваем чужие кабинеты. Чат, сделки и каналы изначально в одной CRM; биллинг модульный, без обязательного трио «места × коннектор × конструктор».',
  },
  {
    q: 'AI обязателен?',
    a: 'Нет. Сообщения пишутся в CRM всегда. AI отвечает только если назначен агент; в любой момент пауза или handoff.',
  },
  {
    q: 'Куда падают лиды после сторис/рассылки?',
    a: 'В контакты и сделки VoxlyCRM. Дальше — этап, чат, команда.',
  },
  {
    q: 'Сколько менеджеров?',
    a: '10 в Base, каждый следующий — 300 ₽.',
  },
  {
    q: 'Что после 7 дней?',
    a: 'Без оплаты CRM уходит в hard lock до подписки. Карту для старта не просим; автосписаний нет.',
  },
] as const;

function PrimaryCta({
  label = 'Попробовать 7 дней бесплатно',
  variant = 'ink',
  refCode,
  className = '',
}: {
  label?: string;
  variant?: 'ink' | 'amber';
  refCode?: string | null;
  className?: string;
}) {
  return (
    <RegisterLink
      className={`${variant === 'amber' ? 'land-btn-amber' : 'land-btn'} touch-manipulation ${className}`}
      refCode={refCode}
    >
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </RegisterLink>
  );
}

function Eyebrow({ children, light = false }: { children: React.ReactNode; light?: boolean }) {
  return (
    <p
      className={`font-mono text-[11px] font-semibold uppercase tracking-[0.2em] ${
        light ? 'text-[#f5a623]' : 'text-black/45'
      }`}
    >
      {children}
    </p>
  );
}

export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref: rawRef } = await searchParams;
  const refCode = rawRef?.trim() || null;

  return (
    <main className="landing-root min-h-screen pb-[5.5rem] md:pb-0">
      <ReferralCapture />
      <a
        href="#crm"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-white focus:px-4 focus:py-2"
      >
        К описанию CRM
      </a>

      <header className="sticky top-0 z-40 border-b border-black/10 bg-white/95 backdrop-blur-sm">
        <div className="h-1 w-full bg-[#f5a623]" aria-hidden />
        <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-3 px-5 sm:h-16 sm:px-8">
          <Link
            href="/"
            className="land-display shrink-0 text-base font-bold uppercase tracking-[-0.04em]"
          >
            Voxly
          </Link>
          <nav className="hidden items-center gap-6 text-sm font-medium lg:flex" aria-label="Основная навигация">
            <a href="#crm" className="min-h-11 py-3 transition-opacity hover:opacity-55">
              CRM
            </a>
            <a href="#modules" className="min-h-11 py-3 transition-opacity hover:opacity-55">
              Возможности
            </a>
            <a href="#pricing" className="min-h-11 py-3 transition-opacity hover:opacity-55">
              Цены
            </a>
            <a href="#faq" className="min-h-11 py-3 transition-opacity hover:opacity-55">
              FAQ
            </a>
          </nav>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <Link
              href="/login"
              className="hidden min-h-11 items-center px-2 text-sm font-semibold sm:inline-flex"
            >
              Войти
            </Link>
            <RegisterLink className="land-btn min-h-11 px-4 py-2.5 text-sm touch-manipulation" refCode={refCode}>
              7 дней бесплатно
            </RegisterLink>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative isolate overflow-hidden bg-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-[#f5a623]"
        />
        <div className="mx-auto grid max-w-[1280px] items-center gap-10 px-5 pb-16 pt-10 sm:px-8 sm:pb-20 sm:pt-14 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-8 lg:pb-24">
          <div className="relative z-10 max-w-[720px]">
            <Eyebrow>01 · VoxlyCRM</Eyebrow>
            <p className="land-display land-rise mt-5 text-[clamp(3.5rem,10vw,8rem)] font-bold uppercase leading-[0.86] tracking-[-0.07em]">
              Voxly
            </p>
            <h1 className="land-rise-delay mt-6 max-w-[680px] text-[clamp(1.75rem,4vw,3.25rem)] leading-[1.12] tracking-[-0.035em]">
              Командный центр продаж. В браузере — с компьютера и с телефона.
            </h1>
            <p className="land-rise-delay-2 mt-5 max-w-[540px] text-base leading-relaxed text-[var(--land-muted)] sm:text-lg">
              Клиент пишет в Telegram или WhatsApp — сделка и чат уже в CRM. Отвечай с компьютера
              или с телефона. Приложения ставить не нужно.
            </p>
            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
              <PrimaryCta refCode={refCode} />
              <a href="#crm" className="land-btn-ghost touch-manipulation">
                Смотреть CRM
              </a>
            </div>
            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-black/45">
              Без карты · CRM Base от 500 ₽ · 10 мест
            </p>
          </div>
          <HeroSignature />
        </div>
      </section>

      {/* PROBLEM */}
      <section id="problem" className="bg-white">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.4fr)_minmax(0,1.6fr)] lg:gap-16">
            <Eyebrow>02 · До</Eyebrow>
            <div className="min-w-0">
              <h2 className="max-w-[900px] text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
                Вкладки. Ночной лид. И ещё одно приложение «для команды».
              </h2>
              <div className="mt-8 grid gap-6 text-[var(--land-muted)] md:grid-cols-2 md:gap-8">
                <p>
                  Воронка в одном сервисе. WhatsApp — в другом. Сделка — в третьем. Менеджер
                  копирует сообщения руками и теряет контекст.
                </p>
                <p>
                  Ночью человек написал. Утром он уже у конкурента. А счёт за стек легко уходит за
                  8–15 тысяч — ещё до AI.
                </p>
              </div>
            </div>
          </div>
          <div className="mt-16 grid border-y border-black/15 sm:grid-cols-3">
            {[
              ['3–4', 'сервиса вместо одного экрана'],
              ['8–15 тыс. ₽', 'типичный ориентир стека'],
              ['1 лид', 'может стоить дороже подписки'],
            ].map(([value, label], index) => (
              <div
                key={label}
                className={`py-7 sm:px-8 ${index > 0 ? 'border-t border-black/15 sm:border-l sm:border-t-0' : ''}`}
              >
                <p className="land-display text-3xl sm:text-4xl">{value}</p>
                <p className="mt-2 text-sm text-[var(--land-muted)]">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TRANSFORM */}
      <section className="bg-[#f3f3f3]">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <Eyebrow>03 · После</Eyebrow>
          <h2 className="mt-6 max-w-[860px] text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
            Одна VoxlyCRM вместо зоопарка вкладок.
          </h2>
          <div className="mt-12">
            <TransformCompare />
          </div>
          <p className="mt-6 max-w-[640px] text-sm text-[var(--land-muted)]">
            Цены конкурентов — публичный ориентир; у всех меняются. Сравнивайте свой счёт.
          </p>
        </div>
      </section>

      {/* CRM DEEP DIVE */}
      <section id="crm" className="bg-white">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <Eyebrow>04 · VoxlyCRM</Eyebrow>
          <h2 className="mt-6 max-w-[900px] text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
            Не табличка лидов. Рабочее пространство продаж.
          </h2>
          <p className="mt-6 max-w-[640px] text-base text-[var(--land-muted)] sm:text-lg">
            Единое окно: контакты, сделки, переписка из мессенджеров, AI и рассылки — в одной
            системе. Русские лейблы. Открывается в браузере на компьютере и на телефоне.
          </p>

          <nav
            aria-label="Разделы CRM"
            className="sticky top-[3.75rem] z-20 -mx-5 mt-12 overflow-x-auto border-y border-black/10 bg-white/95 px-5 py-2 backdrop-blur-sm sm:-mx-8 sm:px-8 lg:top-[4.25rem]"
          >
            <ul className="flex min-w-max gap-1">
              {CRM_CHAPTERS.map((ch) => (
                <li key={ch.id}>
                  <a
                    href={`#${ch.id}`}
                    className="inline-flex min-h-11 items-center px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-black/50 transition-colors hover:bg-[#fff4de] hover:text-black"
                  >
                    {ch.num} · {ch.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="mt-4">
            {CRM_CHAPTERS.map((ch) => (
              <article
                key={ch.id}
                id={ch.id}
                className="scroll-mt-36 grid gap-8 border-t border-black/15 py-14 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-14 lg:scroll-mt-40"
              >
                <div className="min-w-0">
                  <span className="land-display text-4xl text-[#f5a623] sm:text-5xl">{ch.num}</span>
                  <h3 className="mt-4 text-2xl sm:text-3xl">{ch.title}</h3>
                  <p className="mt-4 text-base text-[var(--land-muted)]">{ch.scenario}</p>
                  <ul className="mt-6 space-y-3">
                    {ch.bullets.map((b) => (
                      <li key={b} className="flex gap-2 text-sm sm:text-base">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#f5a623]" aria-hidden />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  {'punch' in ch && ch.punch ? (
                    <p className="mt-6 border-l-2 border-[#f5a623] pl-4 text-sm font-semibold">
                      {ch.punch}
                    </p>
                  ) : null}
                </div>
                <div className="min-w-0">
                  {ch.visual === 'kanban' ? <KanbanMock /> : null}
                  {ch.visual === 'chat' ? <AnnotatedChatMock /> : null}
                  {ch.visual === 'mailing' ? <ModuleMini kind="mailing" /> : null}
                  {ch.visual === 'none' ? (
                    <div className="border border-black/15 bg-[#f3f3f3] p-6 font-mono text-[11px] uppercase tracking-[0.14em] text-black/40">
                      {ch.label} · в том же рабочем пространстве
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>

          <div className="mt-6 flex flex-col items-start gap-3 border border-black/15 bg-[#fff4de] p-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <p className="text-base font-semibold">Открыть CRM на 7 дней</p>
            <PrimaryCta label="Начать trial" refCode={refCode} />
          </div>
        </div>
      </section>

      {/* MOBILE PROOF */}
      <section id="mobile" className="bg-[#f3f3f3]">
        <MobileProof />
      </section>

      {/* HOW */}
      <section id="how" className="bg-white">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <Eyebrow>06 · Запуск</Eyebrow>
          <h2 className="mt-6 max-w-[860px] text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
            Четыре шага. Без внедрения на полгода.
          </h2>
          <ol className="mt-14 grid gap-0 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li
                key={step.number}
                className={`relative border-t border-black/20 pb-10 pt-7 lg:min-h-[220px] lg:border-l lg:border-t-0 lg:px-7 lg:pb-0 ${
                  index === 0 ? 'lg:border-l-0 lg:pl-0' : ''
                }`}
              >
                <span className="land-display text-sm text-[#f5a623]">{step.number}</span>
                <h3 className="mt-7 text-xl">{step.title}</h3>
                <p className="mt-3 text-sm text-[var(--land-muted)]">{step.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* MODULES */}
      <section id="modules" className="bg-[#f3f3f3]">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <Eyebrow>07 · Оружие CRM</Eyebrow>
          <h2 className="mt-6 max-w-[900px] text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
            Модули подключаются к сделке — не живут отдельной жизнью.
          </h2>
          <p className="mt-6 max-w-[560px] text-base text-[var(--land-muted)]">
            Каждый модуль кормит одну воронку в VoxlyCRM.
          </p>

          <div className="mt-14 space-y-0">
            {MODULES.map((mod) => (
              <article
                key={mod.num}
                className="grid gap-6 border-t border-black/15 py-10 lg:grid-cols-[80px_minmax(0,1fr)_minmax(0,280px)] lg:gap-10 lg:py-12"
              >
                <span className="land-display text-3xl text-[#f5a623]">{mod.num}</span>
                <div className="min-w-0">
                  <h3 className="text-xl sm:text-2xl">{mod.title}</h3>
                  <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.12em] text-black/45">
                    {mod.price}
                  </p>
                  <dl className="mt-5 space-y-3 text-sm text-[var(--land-muted)]">
                    <div>
                      <dt className="font-semibold text-[var(--land-ink)]">Боль</dt>
                      <dd className="mt-1">{mod.pain}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-[var(--land-ink)]">Что делает</dt>
                      <dd className="mt-1">{mod.does}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-[var(--land-ink)]">В CRM</dt>
                      <dd className="mt-1">{mod.inCrm}</dd>
                    </div>
                  </dl>
                  {'punch' in mod && mod.punch ? (
                    <p className="mt-4 text-sm font-semibold text-[var(--land-ink)]">{mod.punch}</p>
                  ) : null}
                  <div className="mt-5">
                    <PrimaryCta label="Подключить в trial" refCode={refCode} className="text-sm" />
                  </div>
                </div>
                <ModuleMini kind={mod.kind} />
              </article>
            ))}
          </div>

          <div className="mt-12 border border-black/15 bg-white p-6 sm:p-8">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">
              Кому подходит
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {AUDIENCE.map((item) => (
                <li key={item} className="flex gap-2 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#f5a623]" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="bg-white">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <Eyebrow>08 · Цены</Eyebrow>
          <h2 className="mt-6 max-w-[860px] text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
            Собери свой контур. Плати за то, чем пользуешься.
          </h2>

          <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-16">
            <div className="border border-black/15 bg-[#0a0a0a] p-6 text-white sm:p-8">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-[#f5a623]">
                CRM_BASE
              </p>
              <p className="land-display mt-4 text-[clamp(2.75rem,7vw,5rem)] leading-none">500 ₽</p>
              <p className="mt-2 text-sm text-white/60">/ месяц · 10 мест</p>
              <p className="mt-4 text-sm text-white/70">Extra seat — 300 ₽</p>
              <p className="mt-6 border-t border-white/15 pt-5 text-sm">
                Trial 7 дней · без карты
              </p>
              <p className="mt-3 text-sm text-white/55">
                После trial доступ к CRM требует подписки (hard lock). Честно.
              </p>
              <div className="mt-8">
                <PrimaryCta label="Собрать и начать 7 дней" variant="amber" refCode={refCode} />
              </div>
            </div>

            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-black/45">
                Модульная сетка
              </p>
              <ul className="mt-4 divide-y divide-black/15 border-y border-black/15">
                {SKUS.map((row) => (
                  <li
                    key={row.sku}
                    className="flex flex-col gap-1 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                  >
                    <span className="font-mono text-[12px] uppercase tracking-[0.08em]">{row.sku}</span>
                    <span className="text-sm text-[var(--land-muted)]">{row.price}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm text-[var(--land-muted)]">
                Ориентир рынка 8–15 тыс. за разрозненный стек → Voxly от 500 ₽ за CRM-ядро.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="bg-[#0a0a0a] text-white">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
          <div className="min-w-0">
            <Eyebrow light>09 · FAQ</Eyebrow>
            <h2 className="mt-6 text-[clamp(1.85rem,4.2vw,3.75rem)] leading-[1.12] tracking-[-0.035em]">
              Частые вопросы
            </h2>
          </div>
          <Accordion type="single" collapsible className="min-w-0">
            {FAQ.map((item, index) => (
              <AccordionItem key={item.q} value={`faq-${index}`} className="border-white/15">
                <AccordionTrigger className="min-h-16 text-left text-base font-semibold hover:no-underline sm:text-lg">
                  {item.q}
                </AccordionTrigger>
                <AccordionContent className="max-w-[680px] text-base leading-relaxed text-white/60">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="bg-[#f5a623]">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <Eyebrow>Последний шаг</Eyebrow>
          <h2 className="mt-6 max-w-[840px] text-[clamp(2rem,5.2vw,5rem)] leading-[1.12] tracking-[-0.035em]">
            Открой командный центр. С телефона — в браузере.
          </h2>
          <p className="mt-6 max-w-[540px] text-base text-black/65 sm:text-lg">
            7 дней на своих диалогах. Без карты. После trial — подписка на CRM, если оставляешь.
          </p>
          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
            <PrimaryCta refCode={refCode} />
            <Link href="/login" className="min-h-11 py-3 text-sm font-bold underline underline-offset-4">
              Уже есть аккаунт
            </Link>
          </div>
          <p className="mt-6 text-sm font-semibold text-black/55">
            Не ставьте приложения команде. Откройте CRM в браузере.
          </p>
        </div>
      </section>

      <footer className="bg-[#0a0a0a] text-white/55">
        <div className="mx-auto grid max-w-[1280px] gap-8 px-5 py-12 text-sm sm:px-8 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <p className="land-display text-xl uppercase text-white">Voxly</p>
            <p className="mt-3">{LEGAL.legalEntityFull}</p>
            <p className="mt-1">
              ИНН {LEGAL.inn} · ОГРНИП {LEGAL.ogrnip}
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 lg:justify-end" aria-label="Юридические документы">
            {LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="min-h-11 py-3 transition-colors hover:text-white">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-black/15 bg-[#f5a623] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <RegisterLink className="land-btn w-full touch-manipulation" refCode={refCode}>
          7 дней бесплатно · без карты
          <ArrowRight className="h-4 w-4" aria-hidden />
        </RegisterLink>
      </div>
    </main>
  );
}
