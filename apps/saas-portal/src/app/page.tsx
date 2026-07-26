import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LEGAL, LEGAL_LINKS } from '@/lib/legal';

const MARKET = [
  {
    what: 'Конструктор TG-воронок',
    them: 'от 1 599–2 999 ₽',
    themNote: 'BotHelp · Salebot',
    us: '500 ₽',
    usNote: 'Gift-бот / канал',
  },
  {
    what: 'AI + CRM в одной подписке',
    them: 'от 3 990–4 900 ₽',
    themNote: '7sales · Botseller «Старт»',
    us: 'от 1 000 ₽',
    usNote: 'CRM 500 + AI-канал',
  },
  {
    what: 'WhatsApp в CRM',
    them: 'от 1 000–6 000 ₽',
    themNote: 'Wazzup · Pact · Chat2Desk',
    us: '500 ₽',
    usNote: 'личный WA / аккаунт',
  },
  {
    what: 'CRM на 10 менеджеров',
    them: 'от 10 000+ ₽',
    themNote: 'amo / Kommo × места',
    us: '500 ₽',
    usNote: '10 пользователей в базе',
  },
] as const;

const INCLUDES = [
  {
    title: 'CRM и чат в сделке',
    desc: 'Twenty CRM: канбан, контакты, переписка в карточке. Не отдельный inbox и не «виджет сбоку».',
  },
  {
    title: 'Gift-боты и воронки',
    desc: 'Подписка, подарок, отложенные сообщения — то, за что конструкторы берут тысячи в месяц.',
  },
  {
    title: 'AI в Telegram и WhatsApp',
    desc: 'Business, личный TG и WA. Handoff оператору. Платите за канал, AI-баланс — по факту.',
  },
  {
    title: 'Рассылки и аналитика',
    desc: 'Бот, аккаунты, сторис. Офлайн-конверсии в Метрику, GA4, Facebook и VK.',
  },
] as const;

const STEPS = [
  {
    n: '01',
    title: 'Зарегистрируйтесь',
    desc: 'Воркспейс и CRM за минуту. Карта для старта trial не нужна.',
  },
  {
    n: '02',
    title: '7 дней — полный контур',
    desc: 'Подключите бота, AI или WhatsApp. Проверьте на своих клиентах, не на демо.',
  },
  {
    n: '03',
    title: 'Оставьте то, что зашло',
    desc: 'Платите только за модули, которые оставили. Остальное можно не брать.',
  },
] as const;

const MODULES = [
  { name: 'CRM Base', price: '500 ₽', period: '/мес', note: '10 пользователей' },
  { name: 'Доп. пользователь', price: '300 ₽', period: '/мес', note: 'сверх базы' },
  { name: 'Gift Bot', price: '500 ₽', period: '/канал', note: 'воронки и подарки' },
  { name: 'Рассылка ботом', price: '500 ₽', period: '/мес', note: 'сегменты и медиа' },
  { name: 'Рассылка с аккаунтов', price: '500 ₽', period: '/мес', note: 'GramJS + WhatsApp' },
  { name: 'Сторис', price: '1 000 ₽', period: '/мес', note: 'расписание' },
  { name: 'AI Business', price: '1 000 ₽', period: '/10 акк', note: '+200 ₽ сверх' },
  { name: 'Личный TG / WA', price: '500 ₽', period: '/акк', note: 'QR + AI' },
  { name: 'Аналитика', price: '500 ₽', period: '/платформа', note: 'Метрика · GA4 · FB · VK' },
] as const;

const FAQ = [
  {
    q: 'Правда ли 7 дней бесплатно?',
    a: 'Да. После регистрации подключаете модули и проверяете на своих клиентах. Карта для старта trial не нужна. Оплата — только когда решите оставить сервис.',
  },
  {
    q: 'Почему «в 3 раза дешевле»?',
    a: 'Типичная сборка на рынке — конструктор ботов (Salebot/BotHelp) + WhatsApp-коннектор (Wazzup/Pact) + CRM по местам или AI-пакет (7sales/Botseller) — часто 8–15 000 ₽/мес. В Voxly те же задачи закрываются модулями от 500 ₽: CRM + gift + WA ≈ 1 500–2 000 ₽.',
  },
  {
    q: 'Нужен ли отдельный amoCRM?',
    a: 'Нет. В базе — Twenty CRM с чатом в карточке сделки. Можете вести продажи в одном кабинете.',
  },
  {
    q: 'Как оплата?',
    a: 'Через Robokassa, чеки по 54-ФЗ. Перед оплатой — оферта и правила возврата на сайте.',
  },
] as const;

function ProductPreview() {
  return (
    <Card className="overflow-hidden rounded-xl border-border shadow-[var(--shadow-subtle)]" aria-hidden>
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="h-2.5 w-2.5 rounded-full bg-border" />
          <span className="ml-2 text-[12px] font-medium text-muted-foreground">Сделка · Чат</span>
        </div>
        <Badge variant="secondary">trial · день 3/7</Badge>
      </div>
      <div className="grid sm:grid-cols-[200px_1fr]">
        <div className="hidden border-r border-border bg-sidebar p-4 sm:block">
          <p className="text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">Этапы</p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground">Новый лид</li>
            <li className="rounded-md px-2.5 py-1.5 text-muted-foreground">Квалификация</li>
            <li className="rounded-md px-2.5 py-1.5 text-muted-foreground">Успешная</li>
          </ul>
          <p className="mt-6 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
            Экономия
          </p>
          <p className="mt-2 text-sm leading-snug text-foreground">
            Рынок ~4 000 ₽
            <br />
            <span className="font-semibold">Voxly ~1 500 ₽</span>
          </p>
        </div>
        <div className="flex min-h-[260px] flex-col bg-muted p-4 sm:min-h-[300px]">
          <div className="space-y-3">
            <div className="max-w-[88%] rounded-lg rounded-bl-[6px] border border-border bg-card px-3.5 py-2.5 text-sm leading-relaxed text-foreground">
              У вас есть CRM + WhatsApp + бот в одном месте? Сколько это стоит?
            </div>
            <div className="ml-auto max-w-[88%] rounded-lg rounded-br-[6px] bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
              7 дней бесплатно. Потом от 500 ₽ за модуль — обычно в 3 раза дешевле сборки из
              Salebot + Wazzup + amo.
              <span className="mt-1 block text-[11px] text-primary-foreground/60">AI · можно перехватить</span>
            </div>
          </div>
          <div className="mt-auto flex items-center gap-2 pt-6">
            <div className="h-9 flex-1 rounded-lg border border-border bg-card px-3 text-sm leading-9 text-muted-foreground">
              Ответить клиенту…
            </div>
            <div className="flex h-9 items-center rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground">
              Отправить
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-muted text-foreground">
      <div
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            'radial-gradient(ellipse 90% 55% at 50% -15%, #ffffff 0%, transparent 55%), radial-gradient(ellipse 50% 35% at 0% 40%, rgba(23,23,23,0.035) 0%, transparent 55%), #f5f5f5',
        }}
      />

      <header className="sticky top-0 z-20 border-b border-border/80 bg-card/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between px-6">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Voxly
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a href="#compare" className="hover:text-foreground">
              Сравнение
            </a>
            <a href="#product" className="hover:text-foreground">
              Возможности
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Цены
            </a>
            <a href="#faq" className="hover:text-foreground">
              FAQ
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/login">Войти</Link>
            </Button>
            <Button asChild variant="solid" size="sm">
              <Link href="/register">7 дней бесплатно</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1280px] px-6 pb-12 pt-14 animate-in sm:pb-16 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <Badge variant="outline" className="mb-4">
            CRM · боты · AI
          </Badge>
          <p className="text-[13px] font-semibold tracking-tight text-foreground">Voxly</p>
          <h1 className="mt-4 text-[32px] font-semibold leading-[1.08] tracking-[-0.045em] sm:text-[46px]">
            Функционал дорогих сервисов —{' '}
            <span className="whitespace-nowrap">7 дней бесплатно</span>, потом в 3 раза дешевле
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            CRM, gift-боты, AI в Telegram/WhatsApp и рассылки. На рынке это Salebot + Wazzup + amo
            и счёт на тысячи. У нас — модули от 500 ₽ и полный trial без карты.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
            <Button asChild variant="solid" size="lg">
              <Link href="/register">
                Попробовать 7 дней бесплатно
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <a href="#compare">Сравнить с рынком</a>
            </Button>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            Без карты · от 500 ₽/мес после trial · 10 пользователей в CRM Base
          </p>
        </div>

        <div className="mx-auto mt-12 max-w-4xl animate-fade sm:mt-14" style={{ animationDelay: '120ms' }}>
          <ProductPreview />
        </div>
      </section>

      <section className="border-y border-border bg-primary text-primary-foreground">
        <div className="mx-auto grid max-w-[1280px] sm:grid-cols-3">
          {[
            { k: 'Рынок', v: '~4 000–12 000 ₽', d: 'типичный стек: бот + WA + CRM/AI' },
            { k: 'Voxly', v: '~1 500 ₽', d: 'CRM + gift или AI-канал — те же задачи' },
            { k: 'Разница', v: '×3 и больше', d: 'плюс 7 дней, чтобы проверить до оплаты' },
          ].map((item, i) => (
            <div
              key={item.k}
              className={`px-6 py-8 text-center sm:text-left ${
                i > 0 ? 'border-t border-paper/10 sm:border-l sm:border-t-0' : ''
              }`}
            >
              <p className="text-[12px] font-medium uppercase tracking-[0.06em] text-primary-foreground/50">
                {item.k}
              </p>
              <p className="mt-2 text-[26px] font-semibold tracking-[-0.03em]">{item.v}</p>
              <p className="mt-1 text-sm text-primary-foreground/60">{item.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="compare" className="mx-auto max-w-[1280px] px-6 py-20">
        <h2 className="max-w-2xl text-[28px] font-semibold tracking-[-0.03em] sm:text-[30px]">
          Что обычно покупают по отдельности — у нас в одном кабинете и дешевле
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          Ориентиры по публичным тарифам российских сервисов (середина 2026). Цены конкурентов
          меняются — смысл один: вход на рынок в разы выше, а trial короче или режет функции.
        </p>

        <Card className="mt-10 overflow-hidden rounded-xl border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="text-muted-foreground">Задача</TableHead>
                <TableHead className="text-muted-foreground">Рынок</TableHead>
                <TableHead className="text-foreground">Voxly</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {MARKET.map((row) => (
                <TableRow key={row.what}>
                  <TableCell className="font-medium text-foreground">{row.what}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <span className="text-foreground">{row.them}</span>
                    <span className="mt-0.5 block text-xs">{row.themNote}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-semibold text-foreground">{row.us}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{row.usNote}</span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <Card className="rounded-xl border-border">
            <CardHeader>
              <CardDescription>Как на рынке</CardDescription>
              <CardTitle className="text-2xl tracking-tight">~8 000–15 000 ₽/мес</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              Конструктор ботов + коннектор WhatsApp + CRM по местам + отдельно AI. Три кабинета,
              три счёта.
            </CardContent>
          </Card>
          <Card className="rounded-xl border-ink bg-primary text-primary-foreground">
            <CardHeader>
              <CardDescription className="text-primary-foreground/55">В Voxly</CardDescription>
              <CardTitle className="text-2xl tracking-tight text-primary-foreground">
                ~1 500–2 000 ₽/мес
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-relaxed text-primary-foreground/75">
              <p>CRM Base 500 + Gift 500 + WA 500. Один кабинет. Сначала 7 дней бесплатно.</p>
              <Button asChild variant="secondary" size="lg" className="w-full sm:w-auto">
                <Link href="/register">Запустить бесплатный trial</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      <section id="product" className="bg-card">
        <div className="mx-auto max-w-[1280px] px-6 py-20">
          <h2 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[30px]">
            Всё, за что рынок берёт абонентку — внутри Voxly
          </h2>
          <p className="mt-3 max-w-xl text-sm text-muted-foreground sm:text-base">
            Не «ещё один конструктор». Единый контур: диалог → сделка → AI → рассылка → аналитика.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2">
            {INCLUDES.map((item) => (
              <Card key={item.title} className="rounded-xl border-border shadow-none">
                <CardHeader>
                  <CardTitle className="text-lg">{item.title}</CardTitle>
                  <CardDescription className="text-sm leading-relaxed">{item.desc}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1280px] px-6 py-20">
        <h2 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[30px]">
          Сначала пробуете. Потом платите — если зашло
        </h2>
        <ol className="stagger mt-12 grid gap-4 sm:grid-cols-3">
          {STEPS.map((s) => (
            <Card key={s.n} className="rounded-xl border-border shadow-none">
              <CardHeader>
                <Badge variant="secondary" className="w-fit">
                  {s.n}
                </Badge>
                <CardTitle className="text-lg">{s.title}</CardTitle>
                <CardDescription>{s.desc}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </ol>
        <div className="mt-12 flex flex-wrap items-center gap-3">
          <Button asChild variant="solid" size="lg">
            <Link href="/register">Начать 7 дней бесплатно</Link>
          </Button>
          <p className="text-sm text-muted-foreground">Автосписаний нет. Оплата — только когда решите.</p>
        </div>
      </section>

      <section id="pricing" className="border-y border-border bg-card">
        <div className="mx-auto max-w-[1280px] px-6 py-20">
          <div className="max-w-2xl">
            <h2 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[30px]">
              Цены после trial
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Платите по модулям. Не тяните «пакет за 4 900», если нужен один канал.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:items-start">
            <Card className="rounded-xl border-ink bg-primary text-primary-foreground">
              <CardHeader>
                <Badge variant="secondary" className="w-fit bg-card/10 text-primary-foreground">
                  База
                </Badge>
                <CardTitle className="text-xl text-primary-foreground">CRM Base</CardTitle>
                <p className="text-[40px] font-semibold tracking-[-0.04em] text-primary-foreground">
                  500 ₽
                  <span className="text-base font-normal text-primary-foreground/55">/мес</span>
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm text-primary-foreground/75">
                  {[
                    '10 пользователей — на рынке это отдельные места',
                    'Twenty CRM на вашем поддомене',
                    'Чаты внутри сделок',
                    '7 дней trial на модулях до оплаты',
                  ].map((line) => (
                    <li key={line} className="flex gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-foreground/60" />
                      {line}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-card px-5 text-sm font-medium text-foreground transition-opacity duration-[var(--duration-fast)] hover:opacity-90"
                >
                  Попробовать бесплатно
                </Link>
              </CardContent>
            </Card>

            <Card className="rounded-xl border-border shadow-none">
              <CardHeader>
                <CardTitle className="text-base">Модули (после trial)</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableBody>
                    {MODULES.filter((m) => m.name !== 'CRM Base').map((m) => (
                      <TableRow key={m.name}>
                        <TableCell>
                          <span className="font-medium text-foreground">{m.name}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">{m.note}</span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-foreground">
                          {m.price}
                          <span className="text-muted-foreground">{m.period}</span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="border-t border-border px-6 py-4 text-xs leading-relaxed text-muted-foreground">
                  Рефералка: 20% с оплат приглашённых (кроме пополнения AI). Сравнение с рынком —
                  ориентир по публичным тарифам.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-[1280px] px-6 py-20">
        <h2 className="text-[28px] font-semibold tracking-[-0.03em] sm:text-[30px]">Вопросы</h2>
        <Accordion type="single" collapsible className="mt-8 max-w-2xl">
          {FAQ.map((item, i) => (
            <AccordionItem key={item.q} value={`faq-${i}`}>
              <AccordionTrigger className="text-left text-base font-medium">
                {item.q}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-muted-foreground">
                {item.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      <section className="mx-auto max-w-[1280px] px-6 pb-20">
        <Alert className="rounded-xl border-border bg-card">
          <AlertTitle className="text-lg font-semibold tracking-tight">
            Не платите за стек, пока не убедитесь
          </AlertTitle>
          <AlertDescription className="mt-2 space-y-4 text-muted-foreground">
            <p>
              7 дней бесплатно. Если контур зайдёт — оставите модули от 500 ₽. Если нет — просто не
              оплачиваете.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="solid" size="lg">
                <Link href="/register">Попробовать 7 дней бесплатно</Link>
              </Button>
              <Button asChild variant="secondary" size="lg">
                <Link href="/login">Уже есть аккаунт</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </section>

      <section id="contacts" className="border-t border-border bg-card">
        <div className="mx-auto max-w-[1280px] px-6 py-14">
          <h2 className="text-[24px] font-semibold tracking-[-0.025em]">Контакты и реквизиты</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Оплата через Robokassa. Перед оплатой —{' '}
            <Link href="/terms" className="text-foreground underline-offset-4 hover:underline">
              оферта
            </Link>{' '}
            и{' '}
            <Link href="/refund" className="text-foreground underline-offset-4 hover:underline">
              правила возврата
            </Link>
            .
          </p>
          <div className="mt-8 grid gap-8 text-sm sm:grid-cols-2">
            <div className="space-y-2 text-muted-foreground">
              <p className="font-medium text-foreground">{LEGAL.legalEntityFull}</p>
              <p>
                ИНН {LEGAL.inn}
                <br />
                ОГРНИП {LEGAL.ogrnip}
              </p>
              <p>Юр. адрес: {LEGAL.legalAddress}</p>
              <p>Для корреспонденции: {LEGAL.correspondenceAddress}</p>
            </div>
            <div className="space-y-2 text-muted-foreground">
              <p>
                Телефон:{' '}
                <a href={LEGAL.phoneHref} className="text-foreground underline-offset-4 hover:underline">
                  {LEGAL.phone}
                </a>
              </p>
              <p>
                Email:{' '}
                <a href={LEGAL.emailHref} className="text-foreground underline-offset-4 hover:underline">
                  {LEGAL.email}
                </a>
              </p>
              <p>Сайт: {LEGAL.siteHost}</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border py-8">
        <div className="mx-auto flex max-w-[1280px] flex-col items-center gap-4 px-6 text-center text-sm text-muted-foreground">
          <nav className="flex flex-wrap justify-center gap-x-4 gap-y-2">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <p>
            © 2026 {LEGAL.brand} · {LEGAL.siteHost} · ИНН {LEGAL.inn}
          </p>
        </div>
      </footer>
    </main>
  );
}
