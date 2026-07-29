import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowRight, Check, MessageCircle, ShieldCheck } from 'lucide-react';
import { VoxRelay } from '@/components/landing/vox-relay';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { LEGAL, LEGAL_LINKS } from '@/lib/legal';

const BENEFITS = [
  {
    number: '01',
    title: 'Один кабинет вместо трёх',
    text: 'Бот, Telegram, WhatsApp и CRM в одном месте. Зашёл — и видишь всю переписку с клиентом.',
    payoff: 'Меньше вкладок. Меньше «а где он писал?»',
  },
  {
    number: '02',
    title: 'Чат прямо в сделке',
    text: 'Отвечаешь из карточки: этап, сумма и история рядом. AI можно выключить или забрать диалог себе.',
    payoff: 'Не бегаешь между WhatsApp и CRM.',
  },
  {
    number: '03',
    title: 'Платишь только за нужное',
    text: 'CRM Base — 500 ₽ в месяц, внутри 10 пользователей. Бот или WhatsApp — ещё по 500 ₽. Без пакета «всё сразу».',
    payoff: 'Обычно выходит в разы дешевле связки Salebot + Wazzup + amo.',
  },
  {
    number: '04',
    title: 'Сначала пробуешь — потом платишь',
    text: '7 дней на своих клиентах. Карта не нужна. Автосписаний нет.',
    payoff: 'Не нравится — просто не оплачиваешь.',
  },
] as const;

const STEPS = [
  {
    number: '01',
    title: 'Регистрируешься',
    text: 'Минута. Кабинет и CRM уже на месте.',
  },
  {
    number: '02',
    title: 'Подключаешь канал',
    text: 'Бот, WhatsApp по QR или Telegram. Что реально используешь.',
  },
  {
    number: '03',
    title: 'Смотришь на живых клиентах',
    text: 'Сообщение пришло — сделка создалась. Переписка в карточке.',
  },
  {
    number: '04',
    title: 'Оставляешь то, что зашло',
    text: 'После trial платишь только за модули, которыми пользуешься.',
  },
] as const;

const FAQ = [
  {
    q: 'Нужна карта, чтобы начать?',
    a: 'Нет. 7 дней без карты и без автосписания.',
  },
  {
    q: 'А amoCRM отдельно покупать?',
    a: 'Не нужно. Внутри уже CRM с канбаном и чатом в сделке. В базе — до 10 пользователей.',
  },
  {
    q: 'Если менеджер сам отвечает?',
    a: 'Забираешь диалог из CRM. AI встаёт на паузу. История остаётся.',
  },
  {
    q: 'Почему дешевле, чем три сервиса?',
    a: 'Потому что не платишь отдельно за конструктор, коннектор WhatsApp и CRM по местам. Всё в одном счёте — и по модулям.',
  },
  {
    q: 'Это замена Salebot на сложные ветки?',
    a: 'Нет. Если нужна огромная схема из 50 веток — конструктор всё ещё сильнее. Voxly про другое: продажи в мессенджерах + CRM без зоопарка сервисов.',
  },
] as const;

function PrimaryCta({
  label = 'Попробовать 7 дней бесплатно',
  variant = 'ink',
}: {
  label?: string;
  variant?: 'ink' | 'amber';
}) {
  return (
    <Link href="/register" className={variant === 'amber' ? 'land-btn-amber' : 'land-btn'}>
      {label}
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
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

function MascotStage({
  className,
  priority = false,
  sizes,
  src = '/mascot/voxly-hero-v5.png',
  aspect = 'aspect-[3/4]',
}: {
  className?: string;
  priority?: boolean;
  sizes: string;
  src?: string;
  aspect?: string;
}) {
  return (
    <div className={`relative w-full max-w-[400px] bg-transparent ${className ?? ''}`}>
      <div className={`relative w-full bg-transparent ${aspect}`}>
        <Image
          src={src}
          alt="Voxly — робот, который помогает вести продажи в мессенджерах"
          fill
          priority={priority}
          sizes={sizes}
          className="bg-transparent object-contain object-bottom"
        />
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <main className="landing-root min-h-screen pb-[5.5rem] md:pb-0">
      {/* ATTENTION */}
      <section className="relative isolate bg-[#f5a623]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(10,10,10,.45) 1px, transparent 1px), linear-gradient(90deg, rgba(10,10,10,.45) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <header className="relative z-30">
          <div className="mx-auto flex h-16 max-w-[1280px] items-center justify-between gap-3 px-5 sm:px-8">
            <Link href="/" className="land-display shrink-0 text-base font-bold uppercase tracking-[-0.04em]">
              Voxly
            </Link>
            <nav className="hidden items-center gap-7 text-sm font-medium md:flex" aria-label="Основная навигация">
              <a href="#problem" className="transition-opacity hover:opacity-55">
                Зачем
              </a>
              <a href="#benefits" className="transition-opacity hover:opacity-55">
                Что умеет
              </a>
              <a href="#how" className="transition-opacity hover:opacity-55">
                Как работает
              </a>
              <a href="#faq" className="transition-opacity hover:opacity-55">
                Вопросы
              </a>
            </nav>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <Link href="/login" className="hidden min-h-11 items-center px-2 text-sm font-semibold sm:inline-flex">
                Войти
              </Link>
              <Link href="/register" className="land-btn min-h-11 px-4 py-2.5 text-sm sm:px-5">
                Попробовать
              </Link>
            </div>
          </div>
        </header>

        <div className="relative mx-auto grid max-w-[1280px] items-end gap-6 px-5 pb-6 pt-6 sm:gap-8 sm:px-8 sm:pb-0 sm:pt-8 lg:min-h-[calc(100svh-4rem)] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-10 lg:pt-10">
          <div className="relative z-10 max-w-[720px] lg:pb-16">
            <Eyebrow>CRM · Telegram · WhatsApp · AI</Eyebrow>
            <p className="land-display land-rise mt-5 text-[clamp(3.25rem,9vw,7.5rem)] font-bold uppercase leading-[0.86] tracking-[-0.07em]">
              Voxly
            </p>
            <h1 className="land-rise-delay mt-6 max-w-[700px] text-[clamp(1.75rem,4.2vw,3.75rem)] leading-[1.12] tracking-[-0.035em]">
              Клиенты пишут в Telegram и WhatsApp. А сделки теряются между сервисами.
            </h1>
            <p className="land-rise-delay-2 mt-5 max-w-[540px] text-base leading-relaxed text-black/70 sm:text-lg">
              Вот в чём история. Бот в одном кабинете. WhatsApp — в другом. CRM — в третьем.
              <br />
              <br />
              Voxly собирает это в одном месте. 7 дней бесплатно. Карта не нужна.
            </p>
            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
              <PrimaryCta />
              <span className="text-sm font-medium text-black/55">Без карты · без автосписаний</span>
            </div>
          </div>

          <div className="relative z-10 flex justify-center lg:justify-end lg:self-end">
            <MascotStage
              priority
              src="/mascot/voxly-hero-v5.png"
              sizes="(max-width: 1024px) 280px, 400px"
              className="w-[min(70vw,280px)] sm:w-[min(80vw,340px)] lg:w-[min(100%,400px)]"
            />
          </div>

          <a
            href="#problem"
            aria-label="Дальше — про проблему"
            className="absolute bottom-6 left-5 z-20 hidden min-h-11 items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] lg:flex"
          >
            Дальше
            <ArrowDown className="h-4 w-4" aria-hidden />
          </a>
        </div>
      </section>

      {/* INTEREST — problem */}
      <section id="problem" className="bg-white">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.45fr)_minmax(0,1.55fr)] lg:gap-16">
            <Eyebrow>01 · Знакомо?</Eyebrow>
            <div className="min-w-0">
              <h2 className="max-w-[900px] text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
                Три сервиса. Три пароля. И клиент, которого никто не успел взять.
              </h2>
              <div className="mt-8 grid gap-6 text-[var(--land-muted)] md:grid-cols-2 md:gap-8">
                <p>
                  Воронка в конструкторе. WhatsApp — в отдельном коннекторе. Сделка — в CRM.
                  Менеджер бегает по вкладкам и копирует сообщения руками.
                </p>
                <p>
                  Ночью человек написал. Утром — уже у конкурента.
                  <br />
                  А счёт за всё это легко уходит за 8–15 тысяч в месяц. Ещё до AI.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-16 grid border-y border-black/15 sm:grid-cols-3">
            {[
              ['3–4', 'сервиса вместо одного'],
              ['8–15 тыс. ₽', 'часто уходит на стек'],
              ['1 лид', 'уже может стоить дороже'],
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

      {/* INTEREST — solution */}
      <section className="bg-[#0a0a0a] text-white">
        <div className="mx-auto grid max-w-[1280px] items-center gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
          <div className="min-w-0">
            <Eyebrow light>02 · Что вместо этого</Eyebrow>
            <h2 className="mt-6 max-w-[760px] text-[clamp(2rem,5vw,4.75rem)] leading-[1.12] tracking-[-0.035em]">
              Один кабинет. От сообщения до сделки.
            </h2>
            <p className="mt-7 max-w-[560px] text-base leading-relaxed text-white/65 sm:text-lg">
              Вот как это работает. Клиент пишет — появляется сделка. Переписка лежит в карточке.
              AI может ответить первым. Ты в любой момент забираешь разговор себе.
            </p>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 border-y border-white/15 py-5 font-mono text-xs uppercase tracking-[0.16em] text-white/50">
              <span>CRM</span>
              <span>Telegram</span>
              <span>WhatsApp</span>
              <span>AI</span>
              <span>Рассылки</span>
            </div>
            <div className="mt-8">
              <PrimaryCta label="Посмотреть, как это выглядит" variant="amber" />
            </div>
          </div>
          <VoxRelay size="lg" pose="solution" light caption="Это Voxly. Он как раз про каналы и сделки." />
        </div>
      </section>

      {/* DESIRE — benefits */}
      <section id="benefits" className="bg-white">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,0.55fr)_minmax(0,1.45fr)] lg:gap-12">
            <div>
              <Eyebrow>03 · Зачем это вам</Eyebrow>
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-[var(--land-muted)]">
                Без воды. Простые вещи, которые экономят нервы и деньги.
              </p>
            </div>
            <h2 className="min-w-0 text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
              Нужное для продаж. Без лишнего в счёте.
            </h2>
          </div>

          <div className="mt-16">
            {BENEFITS.map((item) => (
              <article
                key={item.number}
                className="grid gap-4 border-t border-black/15 py-9 sm:grid-cols-[100px_minmax(0,1fr)] lg:grid-cols-[120px_minmax(0,0.85fr)_minmax(0,1fr)] lg:gap-10 lg:py-12"
              >
                <span className="land-display text-4xl text-[#f5a623] sm:text-5xl">{item.number}</span>
                <h3 className="text-xl sm:text-2xl lg:text-3xl">{item.title}</h3>
                <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                  <p className="text-base text-[var(--land-muted)]">{item.text}</p>
                  <p className="mt-4 flex items-start gap-2 text-sm font-bold text-[var(--land-ink)]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#f5a623]" aria-hidden />
                    {item.payoff}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* DESIRE — workflow */}
      <section id="how" className="bg-[#f3f3f3]">
        <div className="mx-auto max-w-[1280px] px-5 py-20 sm:px-8 sm:py-28">
          <Eyebrow>04 · Как это работает</Eyebrow>
          <h2 className="mt-6 max-w-[860px] text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
            Четыре шага. Без внедрения на полгода.
          </h2>

          <ol className="mt-14 grid gap-0 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li
                key={step.number}
                className={`relative border-t border-black/20 pb-10 pt-7 lg:min-h-[240px] lg:border-l lg:border-t-0 lg:px-7 lg:pb-0 ${
                  index === 0 ? 'lg:border-l-0 lg:pl-0' : ''
                }`}
              >
                <span className="land-display text-sm text-[#f5a623]">{step.number}</span>
                <h3 className="mt-7 text-xl">{step.title}</h3>
                <p className="mt-3 text-sm text-[var(--land-muted)]">{step.text}</p>
              </li>
            ))}
          </ol>

          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
            <PrimaryCta label="Начать с первого шага" />
            <p className="text-sm text-[var(--land-muted)]">Кабинет поднимается за минуту</p>
          </div>
        </div>
      </section>

      {/* Price */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-end lg:gap-16">
          <div className="min-w-0">
            <Eyebrow>05 · Про деньги</Eyebrow>
            <h2 className="mt-6 text-[clamp(1.85rem,4.5vw,4.25rem)] leading-[1.12] tracking-[-0.035em]">
              От 500 ₽. Не от десяти тысяч за стек.
            </h2>
          </div>
          <div className="min-w-0">
            <p className="max-w-[620px] text-lg text-[var(--land-muted)]">
              CRM Base — канбан, контакты, чат в сделке, 10 человек в команде.
              Бот, WhatsApp и рассылки добавляешь, когда реально нужны.
            </p>
            <div className="mt-8 flex flex-wrap items-end gap-3 border-y border-black/15 py-6">
              <span className="land-display text-[clamp(2.75rem,7vw,5.5rem)] leading-none">500 ₽</span>
              <span className="pb-1 text-sm text-[var(--land-muted)]">/ месяц за CRM Base</span>
            </div>
            <ul className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
              {['10 пользователей', 'Чат в карточке сделки', '7 дней без карты', 'Оплата через Robokassa'].map(
                (item) => (
                  <li key={item} className="flex gap-2">
                    <ShieldCheck className="h-5 w-5 shrink-0 text-[#f5a623]" aria-hidden />
                    {item}
                  </li>
                ),
              )}
            </ul>
          </div>
        </div>
      </section>

      <section id="faq" className="bg-[#0a0a0a] text-white">
        <div className="mx-auto grid max-w-[1280px] gap-10 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)] lg:gap-16">
          <div className="min-w-0">
            <Eyebrow light>Перед стартом</Eyebrow>
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

      {/* ACTION */}
      <section className="relative bg-[#f5a623]">
        <div className="mx-auto grid max-w-[1280px] items-end gap-6 px-5 pt-16 sm:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-center lg:gap-10 lg:pt-0">
          <div className="relative z-10 min-w-0 pb-12 lg:py-24">
            <Eyebrow>Последний шаг</Eyebrow>
            <h2 className="mt-6 max-w-[740px] text-[clamp(2rem,5.2vw,5rem)] leading-[1.12] tracking-[-0.035em]">
              Не плати за стек, пока не проверишь на своих.
            </h2>
            <p className="mt-6 max-w-[520px] text-base text-black/65 sm:text-lg">
              7 дней. Полный контур. Если зайдёт — оставишь нужные модули.
              Если нет — просто не оплачиваешь. Всё.
            </p>
            <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
              <PrimaryCta />
              <Link href="/login" className="min-h-11 py-3 text-sm font-bold underline underline-offset-4">
                Уже есть аккаунт
              </Link>
            </div>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-black/45">
              10 пользователей CRM · без карты · без автосписаний
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <MascotStage
              src="/mascot/voxly-cta-v5.png"
              sizes="(max-width: 1024px) 280px, 380px"
              className="w-[min(72vw,300px)] lg:w-[min(100%,380px)]"
            />
          </div>
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
        <Link href="/register" className="land-btn w-full">
          7 дней бесплатно
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <a
        href={LEGAL.phoneHref}
        aria-label={`Позвонить ${LEGAL.phone}`}
        className="fixed bottom-6 right-6 z-30 hidden h-12 w-12 items-center justify-center rounded-full bg-[#0a0a0a] text-white shadow-lg transition-transform hover:scale-105 md:flex"
      >
        <MessageCircle className="h-5 w-5" aria-hidden />
      </a>
    </main>
  );
}
