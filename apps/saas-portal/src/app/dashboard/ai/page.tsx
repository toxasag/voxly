'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, MessageSquare, Plus, Trash2 } from 'lucide-react';
import { PRICING, TRIAL_PERIOD_DAYS } from '@voxly/shared';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { AiOverviewHero } from '@/components/portal/ai-overview-hero';

interface AddonState {
  isActive: boolean;
  isTrial: boolean;
  trialAvailable?: boolean;
  activeUntil: string | null;
}

interface OverviewPayload {
  products: {
    aiBusiness: AddonState & {
      includedSlots: number;
      extraSlots?: number;
      activeAccounts: number;
      limitedAccounts: number;
    };
    gramjs: AddonState;
    whatsapp: AddonState;
  };
  accounts: {
    aiBusinessBots: number;
    gramjs: number;
    whatsapp: number;
    agents: number;
  };
  traffic: {
    messages30d: number;
    conversationsOpen: number;
    conversationsTotal: number;
  };
  money: {
    aiWalletRub: number;
    aiSpent30dRub: number;
    aiTokens30d?: number;
    aiRequests30d: number;
  };
}

interface UsageChannelRow {
  channel: string | null;
  label: string;
  requests: number;
  tokens: number;
  chargedRub: number;
}

interface UsagePayload {
  days: number;
  byChannel?: UsageChannelRow[];
}

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  conversationCount?: number;
  businessConnectionCount?: number;
}

interface BotsResponse {
  aiBotPriceMonthly?: number;
  maxBusinessConnections?: number;
  bots: BotRow[];
}

const TOPUP_PRESETS = [500, 1000, 3000, 5000];
const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';

function formatRub(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v.toLocaleString('ru-RU', {
    minimumFractionDigits: v > 0 && v < 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function formatInt(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString('ru-RU');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU');
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        accent ? 'border-[#f5a623]/50 bg-[#fffaf0]' : 'border-black/10 bg-white'
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">{label}</p>
      <p className="land-display mt-1.5 text-[28px] tabular-nums tracking-[-0.03em] text-black">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs leading-snug text-black/55">{hint}</p> : null}
    </div>
  );
}

function SectionHead({
  index,
  kicker,
  title,
  description,
}: {
  index: string;
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/40">
        {index} · {kicker}
      </p>
      <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">{title}</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-black/55">{description}</p>
    </div>
  );
}

function addonBadge(addon: AddonState): { variant: 'success' | 'warning' | 'secondary'; text: string } {
  if (addon.isActive && addon.isTrial) return { variant: 'warning', text: 'Пробный период' };
  if (addon.isActive) return { variant: 'success', text: 'Подписка активна' };
  if (addon.trialAvailable) return { variant: 'secondary', text: 'Не подключён' };
  return { variant: 'warning', text: 'Подписка закончилась' };
}

export default function AiOverviewPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [botsData, setBotsData] = useState<BotsResponse | null>(null);
  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('1000');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const tokenInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const session = localStorage.getItem('voxly_token');
    if (!session) {
      router.push('/login');
      return;
    }
    try {
      const [overviewRes, botsRes, usageRes] = await Promise.all([
        fetch('/api/tenant/dashboard', { headers: authHeaders() }),
        fetch('/api/bots', { headers: authHeaders() }),
        fetch('/api/ai/agents/usage?days=30', { headers: authHeaders() }),
      ]);
      if (!overviewRes.ok) throw new Error('Не удалось загрузить состояние AI-модуля');
      if (!botsRes.ok) throw new Error('Не удалось загрузить список ботов');
      setOverview((await overviewRes.json()) as OverviewPayload);
      setBotsData((await botsRes.json()) as BotsResponse);
      // Breakdown is supplementary: a failure here must not blank the whole page.
      setUsage(usageRes.ok ? ((await usageRes.json()) as UsagePayload) : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const topUp = async () => {
    const amount = Number(topUpAmount.replace(',', '.'));
    if (!Number.isFinite(amount) || amount < PRICING.AI_TOPUP_MIN_RUB) {
      setError(`Минимальное пополнение — ${PRICING.AI_TOPUP_MIN_RUB} ₽`);
      return;
    }
    setBusy('topup');
    setError('');
    try {
      await startCheckout({ productCode: 'ai_topup', amountRub: Math.round(amount * 100) / 100 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось перейти к оплате');
      setBusy('');
    }
  };

  const payChannel = async (productCode: 'ai_tg' | 'ai_wa' | 'ai_gramjs') => {
    setBusy(`pay:${productCode}`);
    setError('');
    try {
      await startCheckout({ productCode, periodMonths: 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось перейти к оплате');
      setBusy('');
    }
  };

  const startTrial = async () => {
    setBusy('trial');
    setError('');
    try {
      const res = await fetch('/api/bots/ai/start-trial', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось активировать пробный период');
      await load();
      setShowTokenForm(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const connectBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('connect');
    setError('');
    setInfo('');
    try {
      if (!overview?.products.aiBusiness.isActive) {
        const trialRes = await fetch('/api/bots/ai/start-trial', {
          method: 'POST',
          headers: authHeaders(),
          body: '{}',
        });
        const trialJson = await trialRes.json();
        if (!trialRes.ok) {
          throw new Error(trialJson.error || 'Не удалось активировать пробный период');
        }
      }
      const res = await fetch('/api/bots/ai/connect', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), username: username.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          [json.error, json.hint].filter(Boolean).join(' — ') || 'Не удалось подключить бота',
        );
      }
      setToken('');
      setUsername('');
      setShowTokenForm(false);
      if (json.businessWarning) setInfo(json.businessWarning);
      if (json.webhookOk === false && json.webhookError) {
        setError(
          `Бот сохранён, но Telegram не принял webhook: ${json.webhookError}. Сообщения могут не доходить — попробуйте переподключить бота или напишите в поддержку.`,
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка подключения');
    } finally {
      setBusy('');
    }
  };

  const deleteBot = async (botId: string) => {
    setBusy(`del:${botId}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}`, { method: 'DELETE', headers: authHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось удалить бота');
      setDeleteConfirmId('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState label="Загружаем AI-модуль…" />
      </AppShell>
    );
  }

  if (!overview || !botsData) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">
          <div className="space-y-2">
            <p>{error || 'Данные AI-модуля не загрузились.'}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError('');
                void load();
              }}
              className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
            >
              Попробовать снова
            </button>
          </div>
        </Alert>
      </AppShell>
    );
  }

  const { products, accounts, traffic, money } = overview;
  const aiBots = (botsData.bots || []).filter((b) => b.botType === 'ai_tg');
  const tgPrice = botsData.aiBotPriceMonthly ?? PRICING.AI_TELEGRAM_MONTHLY;
  const maxConn =
    botsData.maxBusinessConnections ??
    products.aiBusiness.includedSlots ??
    PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS;

  const balance = money.aiWalletRub;
  const spent30 = money.aiSpent30dRub;
  const requests30 = money.aiRequests30d;
  const dailyBurn = spent30 / 30;
  const daysLeft = dailyBurn > 0 ? Math.floor(balance / dailyBurn) : null;
  const avgPerReply = requests30 > 0 ? spent30 / requests30 : 0;
  const repliesLeft = avgPerReply > 0 ? Math.floor(balance / avgPerReply) : null;
  const balanceTone: 'ok' | 'low' | 'empty' =
    balance <= 0 ? 'empty' : daysLeft !== null && daysLeft <= 7 ? 'low' : balance < 200 ? 'low' : 'ok';

  const channelRows = [...(usage?.byChannel || [])]
    .filter((row) => row.requests > 0)
    .sort((a, b) => b.chargedRub - a.chargedRub);
  const channelTotalRub = channelRows.reduce((sum, row) => sum + row.chargedRub, 0);
  const hasUnknownChannel = channelRows.some((row) => !row.channel);

  const connectedChannels =
    (accounts.aiBusinessBots > 0 ? 1 : 0) +
    (accounts.whatsapp > 0 ? 1 : 0) +
    (accounts.gramjs > 0 ? 1 : 0);
  const anyChannel = accounts.aiBusinessBots + accounts.whatsapp + accounts.gramjs > 0;

  const balanceHint =
    balance <= 0
      ? 'Баланс на нуле — AI не отвечает клиентам. Пополните, чтобы включить ответы.'
      : daysLeft !== null
        ? `При текущем расходе хватит примерно на ${daysLeft} ${plural(daysLeft, ['день', 'дня', 'дней'])}.`
        : 'Расхода за последние 30 дней не было — прогноз появится после первых ответов AI.';

  const heroTitle = !anyChannel
    ? 'Подключите первый канал'
    : accounts.agents === 0
      ? 'Каналы есть — нужен AI-агент'
      : balance <= 0
        ? 'AI остановлен: баланс на нуле'
        : 'AI отвечает клиентам';

  const channels: Array<{
    key: string;
    name: string;
    href: string;
    state: AddonState;
    priceMonthly: number;
    connected: number;
    detail: string;
    productCode: 'ai_tg' | 'ai_wa' | 'ai_gramjs';
  }> = [
    {
      key: 'ai_tg',
      name: 'Telegram Business',
      href: '#telegram-business',
      state: products.aiBusiness,
      priceMonthly: tgPrice,
      connected: accounts.aiBusinessBots,
      detail: `Бот-секретарь отвечает в личных чатах вашего Telegram. До ${maxConn} ${plural(maxConn, ['аккаунта', 'аккаунтов', 'аккаунтов'])} в тарифе, сейчас подключено ${products.aiBusiness.activeAccounts}.`,
      productCode: 'ai_tg',
    },
    {
      key: 'ai_wa',
      name: 'WhatsApp',
      href: '/dashboard/ai/whatsapp',
      state: products.whatsapp,
      priceMonthly: PRICING.AI_WHATSAPP_MONTHLY,
      connected: accounts.whatsapp,
      detail: 'Ваш обычный номер WhatsApp подключается сканированием QR-кода — как «Связанные устройства».',
      productCode: 'ai_wa',
    },
    {
      key: 'ai_gramjs',
      name: 'Личный Telegram',
      href: '/dashboard/ai/gramjs',
      state: products.gramjs,
      priceMonthly: PRICING.AI_GRAMJS_MONTHLY,
      connected: accounts.gramjs,
      detail: 'AI отвечает от вашего личного аккаунта Telegram, без бота. Вход по QR-коду.',
      productCode: 'ai_gramjs',
    },
  ];

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
        <AiOverviewHero
          title={heroTitle}
          subtitle="AI-агент читает входящие в ваших мессенджерах, отвечает клиенту и заводит сделку в CRM. Канал оплачивается подпиской, а сами ответы списываются с баланса AI."
          facts={[
            {
              label: 'Каналов подключено',
              value: `${connectedChannels} из 3`,
            },
            {
              label: 'AI-агентов',
              value: formatInt(accounts.agents),
            },
            {
              label: 'Открытых диалогов',
              value: formatInt(traffic.conversationsOpen),
            },
          ]}
          balanceValue={formatRub(balance)}
          balanceTone={balanceTone}
          balanceHint={balanceHint}
          topUpLabel={balance <= 0 ? 'Пополнить и включить AI' : 'Пополнить баланс'}
          onTopUp={() => {
            document.getElementById('balans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            window.setTimeout(() => document.getElementById('topup-amount')?.focus(), 400);
          }}
          footerLabel="Списано за 30 дней"
          footerValue={`${formatRub(spent30)} ₽`}
        />

        {error ? <Alert variant="error">{error}</Alert> : null}
        {info ? <Alert variant="info">{info}</Alert> : null}

        {balance <= 0 && anyChannel ? (
          <Alert variant="error">
            <div className="space-y-1">
              <p className="font-semibold">Баланс AI закончился — агенты молчат</p>
              <p>
                Каналы остаются подключёнными и сообщения клиентов сохраняются в CRM, но
                автоматических ответов не будет, пока на балансе 0 ₽.
              </p>
              <p className="text-sm opacity-90">
                <a href="#balans" className="font-semibold underline underline-offset-2">
                  Пополнить баланс
                </a>{' '}
                — ответы возобновятся сразу после зачисления платежа.
              </p>
            </div>
          </Alert>
        ) : null}

        {anyChannel && accounts.agents === 0 ? (
          <Alert variant="info">
            <div className="space-y-1">
              <p className="font-semibold">Канал подключён, но AI-агента нет</p>
              <p>
                Пока агент не создан и не назначен на канал, AI ничего не отвечает — переписка просто
                копится в CRM.{' '}
                <Link
                  href="/dashboard/ai/agents"
                  className="font-semibold underline underline-offset-2"
                >
                  Создать агента
                </Link>
                .
              </p>
            </div>
          </Alert>
        ) : null}

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <SectionHead
            index="01"
            kicker="основа"
            title="Как это работает"
            description="Три вещи должны совпасть, чтобы клиент получил ответ. Если не работает — почти всегда не хватает одной из них."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              {
                n: '1',
                title: 'Канал',
                text: 'Telegram Business, WhatsApp или личный Telegram. У каждого своя месячная подписка — она даёт право принимать сообщения.',
                done: anyChannel,
              },
              {
                n: '2',
                title: 'AI-агент',
                text: 'Инструкция для нейросети: кто она, что продаёт, как отвечает. Агент назначается на канал — без назначения AI молчит.',
                done: accounts.agents > 0,
              },
              {
                n: '3',
                title: 'Баланс AI',
                text: 'С него списывается каждый ответ нейросети. Подписка за канал баланс не пополняет — это отдельные деньги.',
                done: balance > 0,
              },
            ].map((step) => (
              <div key={step.n} className="flex gap-3">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs font-bold ${
                    step.done ? 'bg-[#f5a623] text-black' : 'bg-black/10 text-black/50'
                  }`}
                >
                  {step.n}
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-black">
                    {step.title}{' '}
                    <span
                      className={`ml-1 align-middle text-[11px] font-semibold uppercase tracking-[0.08em] ${
                        step.done ? 'text-[#166534]' : 'text-black/45'
                      }`}
                    >
                      {step.done ? 'готово' : 'не готово'}
                    </span>
                  </p>
                  <p className="mt-1 text-sm leading-snug text-black/55">{step.text}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          id="balans"
          className="scroll-mt-6 rounded-2xl border border-black/10 bg-white p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHead
              index="02"
              kicker="деньги"
              title="Баланс AI"
              description="Общий кошелёк на все каналы. Списание происходит в момент, когда нейросеть формирует ответ клиенту."
            />
            <Badge
              variant={
                balanceTone === 'empty' ? 'destructive' : balanceTone === 'low' ? 'warning' : 'success'
              }
            >
              {balanceTone === 'empty'
                ? 'Баланс на нуле'
                : balanceTone === 'low'
                  ? 'Скоро закончится'
                  : 'Баланса хватает'}
            </Badge>
          </div>

          <div className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="land-display text-[28px] tabular-nums tracking-[-0.03em] text-black">
                {formatRub(balance)} ₽ на балансе
              </p>
              {daysLeft !== null ? (
                <p className="text-sm tabular-nums text-black/55">
                  хватит примерно на {daysLeft} {plural(daysLeft, ['день', 'дня', 'дней'])}
                </p>
              ) : null}
            </div>
            <p className="mt-3 max-w-[70ch] text-sm leading-snug text-black/65">
              {balance <= 0
                ? 'Пока баланс нулевой, AI не отвечает: входящие сообщения сохраняются в CRM, но клиент не получает автоответа. Подписки за каналы при этом продолжают действовать.'
                : `За последние 30 дней AI сформировал ${formatInt(requests30)} ${plural(requests30, ['ответ', 'ответа', 'ответов'])} на ${formatRub(spent30)} ₽. Это ${formatRub(dailyBurn)} ₽ в день${
                    repliesLeft !== null
                      ? ` — при такой же нагрузке текущего баланса хватит ещё примерно на ${formatInt(repliesLeft)} ${plural(repliesLeft, ['ответ', 'ответа', 'ответов'])}.`
                      : '.'
                  }`}
            </p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              accent={balanceTone !== 'ok'}
              label="Сейчас на балансе"
              value={`${formatRub(balance)} ₽`}
              hint={
                balance <= 0 ? 'AI не отвечает' : 'Общий кошелёк на Telegram, WhatsApp и GramJS'
              }
            />
            <Stat
              label="Списано за 30 дней"
              value={`${formatRub(spent30)} ₽`}
              hint={`${formatInt(requests30)} ${plural(requests30, ['ответ AI', 'ответа AI', 'ответов AI'])}`}
            />
            <Stat
              label="Средний ответ"
              value={avgPerReply > 0 ? `${formatRub(avgPerReply)} ₽` : '—'}
              hint={
                avgPerReply > 0
                  ? 'Списано за 30 дней ÷ количество ответов'
                  : 'Появится после первых ответов AI'
              }
            />
            <Stat
              label="Сообщений за 30 дней"
              value={formatInt(traffic.messages30d)}
              hint={`${formatInt(traffic.conversationsTotal)} ${plural(traffic.conversationsTotal, ['диалог всего', 'диалога всего', 'диалогов всего'])}`}
            />
          </div>

          <div className="mt-4 rounded-xl border border-black/10 bg-white px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                Куда ушли деньги — по каналам
              </p>
              <p className="text-xs text-black/45">за 30 дней</p>
            </div>
            {channelRows.length === 0 ? (
              <p className="mt-2 max-w-[70ch] text-sm text-black/55">
                Списаний за 30 дней ещё не было — разбивка появится после первых ответов AI.
              </p>
            ) : (
              <>
                <ul className="mt-3 space-y-3">
                  {channelRows.map((row) => {
                    const share =
                      channelTotalRub > 0 ? (row.chargedRub / channelTotalRub) * 100 : 0;
                    return (
                      <li key={row.channel || 'unknown'}>
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <p className="text-sm font-semibold text-black">
                            {row.label}
                            {!row.channel ? (
                              <span className="ml-2 align-middle text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                                старые списания
                              </span>
                            ) : null}
                          </p>
                          <p className="text-sm tabular-nums text-black/70">
                            {formatRub(row.chargedRub)} ₽{' '}
                            <span className="text-black/45">
                              · {formatInt(row.requests)}{' '}
                              {plural(row.requests, ['списание', 'списания', 'списаний'])} ·{' '}
                              {Math.round(share)}%
                            </span>
                          </p>
                        </div>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/10">
                          <div
                            className={`h-full rounded-full ${
                              row.channel ? 'bg-[#f5a623]' : 'bg-black/25'
                            }`}
                            style={{ width: `${Math.max(share, 1.5)}%` }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {hasUnknownChannel ? (
                  <p className="mt-3 max-w-[70ch] text-xs leading-snug text-black/55">
                    «Не определён» — списания, сделанные до того, как мы начали помечать канал.
                    Деньги учтены, но привязать их к Telegram, WhatsApp или Gift-боту задним
                    числом нельзя. Новые списания попадают в свой канал.
                  </p>
                ) : null}
              </>
            )}
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_minmax(280px,340px)]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                Что списывает баланс
              </p>
              <ul className="mt-2 space-y-2 text-sm text-black/70">
                <li>
                  Каждый ответ нейросети клиенту — цена зависит от длины переписки и выбранной
                  модели агента.
                </li>
                <li>
                  Расшифровка голосовых, кружочков и видео, распознавание картинок и чтение
                  PDF/DOCX из входящих.
                </li>
                <li>
                  Не списывают баланс: входящие сообщения клиентов, ваши ручные ответы из CRM и
                  рассылки.
                </li>
              </ul>
              <p className="mt-3 max-w-[70ch] text-sm text-black/55">
                Разбивку по агентам и последние списания видно на странице{' '}
                <Link
                  href="/dashboard/ai/agents"
                  className="font-semibold underline underline-offset-2"
                >
                  AI-агенты
                </Link>
                .
              </p>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void topUp();
              }}
              className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                Пополнить баланс
              </p>
              <div
                role="group"
                aria-label="Готовые суммы пополнения"
                className="mt-2 flex flex-wrap gap-2"
              >
                {TOPUP_PRESETS.map((preset) => {
                  const active = topUpAmount === String(preset);
                  return (
                    <button
                      key={preset}
                      type="button"
                      aria-pressed={active}
                      disabled={busy === 'topup'}
                      onClick={() => setTopUpAmount(String(preset))}
                      className={`min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                        active ? 'land-btn-amber' : 'land-btn-ghost'
                      }`}
                    >
                      {formatInt(preset)} ₽
                    </button>
                  );
                })}
              </div>
              <label
                htmlFor="topup-amount"
                className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
              >
                Своя сумма, ₽
              </label>
              <input
                id="topup-amount"
                type="number"
                inputMode="decimal"
                min={PRICING.AI_TOPUP_MIN_RUB}
                step={100}
                value={topUpAmount}
                onChange={(e) => setTopUpAmount(e.target.value)}
                placeholder="2000"
                aria-describedby="topup-hint"
                disabled={busy === 'topup'}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm tabular-nums outline-none transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/10 pt-3">
                <span className="text-sm font-semibold">Зачислим на баланс</span>
                <span className="land-display text-xl tabular-nums tracking-[-0.03em]">
                  {formatRub(Number(topUpAmount.replace(',', '.')) || 0)} ₽
                </span>
              </div>
              <button
                type="submit"
                disabled={
                  busy === 'topup' ||
                  !(Number(topUpAmount.replace(',', '.')) >= PRICING.AI_TOPUP_MIN_RUB)
                }
                className="land-btn-amber mt-3 min-h-11 w-full cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'topup' ? 'Переходим к оплате…' : 'Пополнить через Robokassa'}
              </button>
              <p id="topup-hint" className="mt-2 text-xs leading-snug text-black/55">
                Сколько оплатили — столько и зачислится на баланс, без комиссии сверху. Минимум{' '}
                {formatInt(PRICING.AI_TOPUP_MIN_RUB)} ₽, поэтому кнопка неактивна при меньшей сумме.
                Деньги не сгорают и переносятся на следующий месяц.
              </p>
            </form>
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <SectionHead
            index="03"
            kicker="подключения"
            title="Каналы"
            description="Каждый канал — отдельная месячная подписка. Она не включает ответы нейросети: их оплачивает баланс AI."
          />

          <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
            <table className="w-full min-w-[760px] border-collapse text-left">
              <thead className="bg-[#faf8f5]">
                <tr>
                  <th className={TH}>Канал</th>
                  <th className={TH}>Подписка</th>
                  <th className={TH}>Стоимость</th>
                  <th className={TH}>Подключено</th>
                  <th className={`${TH} text-right`}>Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {channels.map((channel) => {
                  const badge = addonBadge(channel.state);
                  const isInternal = channel.href.startsWith('#');
                  return (
                    <tr
                      key={channel.key}
                      className="align-top transition-colors duration-200 hover:bg-[#faf8f5]"
                    >
                      <td className="px-3 py-3">
                        <p className="font-medium text-black">{channel.name}</p>
                        <p className="mt-0.5 max-w-[42ch] text-xs leading-snug text-black/55">
                          {channel.detail}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        <Badge variant={badge.variant}>{badge.text}</Badge>
                        {channel.state.activeUntil ? (
                          <p className="mt-1 text-xs text-black/55">
                            {channel.state.isActive ? 'до ' : 'закончилась '}
                            {formatDate(channel.state.activeUntil)}
                          </p>
                        ) : channel.state.trialAvailable ? (
                          <p className="mt-1 text-xs text-black/55">
                            есть {TRIAL_PERIOD_DAYS} бесплатных дней
                          </p>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-sm text-black/70">
                        {formatInt(channel.priceMonthly)} ₽/мес
                      </td>
                      <td className="px-3 py-3 tabular-nums text-sm text-black/70">
                        {channel.connected > 0
                          ? `${channel.connected} ${plural(channel.connected, ['аккаунт', 'аккаунта', 'аккаунтов'])}`
                          : '—'}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {!channel.state.isActive && !channel.state.trialAvailable ? (
                            <button
                              type="button"
                              disabled={busy === `pay:${channel.productCode}`}
                              onClick={() => void payChannel(channel.productCode)}
                              className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#f5a623] bg-[#f5a623] px-3 text-xs font-semibold text-black transition-colors duration-200 hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy === `pay:${channel.productCode}`
                                ? 'Открываем оплату…'
                                : `Оплатить ${formatInt(channel.priceMonthly)} ₽`}
                            </button>
                          ) : null}
                          {isInternal ? (
                            <a
                              href={channel.href}
                              className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                            >
                              Настроить
                            </a>
                          ) : (
                            <Link
                              href={channel.href}
                              className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                            >
                              Открыть
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!anyChannel ? (
            <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="font-semibold text-black">Ни одного канала пока не подключено</p>
              <p className="mx-auto mt-1 max-w-[56ch] text-sm text-black/55">
                Канал — это мессенджер, в котором AI будет отвечать вашим клиентам. Начать проще
                всего с Telegram Business: бот создаётся в @BotFather за пару минут, первые{' '}
                {TRIAL_PERIOD_DAYS} дней бесплатно.
              </p>
              <a
                href="#telegram-business"
                className="land-btn-amber mt-4 inline-flex min-h-11 cursor-pointer px-4 text-sm"
              >
                Подключить Telegram Business
              </a>
            </div>
          ) : null}
        </section>

        <section
          id="telegram-business"
          className="scroll-mt-6 rounded-2xl border border-black/10 bg-white p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHead
              index="04"
              kicker="канал"
              title="Telegram Business"
              description={`Бот-секретарь отвечает в личных чатах вашего Telegram через режим «Автоматизация чатов». ${formatInt(tgPrice)} ₽/мес за канал, до ${maxConn} ${plural(maxConn, ['аккаунта', 'аккаунтов', 'аккаунтов'])} в тарифе.`}
            />
            <Badge variant={addonBadge(products.aiBusiness).variant}>
              {addonBadge(products.aiBusiness).text}
            </Badge>
          </div>

          {!products.aiBusiness.isActive ? (
            <div className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
              <p className="land-display text-[20px] tracking-[-0.03em] text-black">
                {products.aiBusiness.trialAvailable
                  ? `${TRIAL_PERIOD_DAYS} дней бесплатно, потом ${formatInt(tgPrice)} ₽/мес`
                  : 'Подписка на Telegram Business не активна'}
              </p>
              <p className="mt-2 max-w-[70ch] text-sm leading-snug text-black/65">
                {products.aiBusiness.trialAvailable
                  ? 'Пробный период включается сразу и автоматически активируется при подключении бота — платить на этом шаге не нужно.'
                  : 'Бот остаётся сохранённым, но новые сообщения AI не обрабатывает. Оплата возвращает канал в работу.'}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {products.aiBusiness.trialAvailable ? (
                  <button
                    type="button"
                    disabled={busy === 'trial'}
                    onClick={() => void startTrial()}
                    className="land-btn-amber min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === 'trial' ? 'Включаем…' : `Включить ${TRIAL_PERIOD_DAYS} бесплатных дней`}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy === 'pay:ai_tg'}
                  onClick={() => void payChannel('ai_tg')}
                  className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'pay:ai_tg'
                    ? 'Переходим к оплате…'
                    : `Оплатить ${formatInt(tgPrice)} ₽/мес`}
                </button>
              </div>
            </div>
          ) : null}

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                Что сделать в Telegram
              </p>
              <p className="mt-1 text-sm text-black/55">
                Бота нужно создать самому: режим секретаря включается только в @BotFather.
              </p>
              <ol className="mt-3 space-y-2.5">
                {[
                  <>
                    Откройте{' '}
                    <a
                      className="font-semibold underline underline-offset-2"
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noreferrer"
                    >
                      @BotFather
                    </a>{' '}
                    и отправьте /newbot — задайте имя и @username.
                  </>,
                  <>
                    Там же: Bot Settings → <strong>Business Mode</strong> → Turn on. Без этого
                    Telegram не отдаст боту сообщения.
                  </>,
                  <>Отправьте /token и скопируйте строку вида 123456:AA…</>,
                  <>Вставьте токен в форму справа и сохраните.</>,
                  <>
                    В Telegram: Настройки → Бизнес → Автоматизация чатов → добавьте своего бота.
                  </>,
                ].map((text, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-[11px] font-bold text-black">
                      {i + 1}
                    </span>
                    <span className="text-sm leading-snug text-black/70">{text}</span>
                  </li>
                ))}
              </ol>
              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="land-btn-ghost mt-4 inline-flex min-h-11 cursor-pointer px-4 text-sm"
              >
                Открыть @BotFather
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </div>

            {showTokenForm || aiBots.length === 0 ? (
              <form
                onSubmit={(e) => void connectBot(e)}
                className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Подключение бота
                </p>
                <label
                  htmlFor="bot-token"
                  className="mt-3 block text-sm font-medium text-black"
                >
                  Токен бота
                </label>
                <input
                  id="bot-token"
                  ref={tokenInputRef}
                  type="password"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="123456789:AAH..."
                  autoComplete="off"
                  aria-describedby="bot-token-hint"
                  disabled={busy === 'connect'}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 font-mono text-sm outline-none transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p id="bot-token-hint" className="mt-1.5 text-xs leading-snug text-black/55">
                  Токен выдаёт @BotFather по команде /token. Мы храним его в зашифрованном виде.
                </p>

                <label
                  htmlFor="bot-username"
                  className="mt-4 block text-sm font-medium text-black"
                >
                  @username бота — необязательно
                </label>
                <input
                  id="bot-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="my_secretary_bot"
                  autoComplete="off"
                  aria-describedby="bot-username-hint"
                  disabled={busy === 'connect'}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 font-mono text-sm outline-none transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p id="bot-username-hint" className="mt-1.5 text-xs leading-snug text-black/55">
                  Если оставить пустым, возьмём username из Telegram по токену.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={busy === 'connect' || !token.trim()}
                    className="land-btn min-h-11 cursor-pointer px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === 'connect' ? 'Подключаем…' : 'Сохранить бота'}
                    <Plus className="h-4 w-4" aria-hidden />
                  </button>
                  {aiBots.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowTokenForm(false)}
                      className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
                    >
                      Отмена
                    </button>
                  ) : null}
                </div>
                {!token.trim() ? (
                  <p className="mt-2 text-xs text-black/55">
                    Кнопка включится, когда вы вставите токен.
                  </p>
                ) : null}
              </form>
            ) : (
              <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Ещё один бот
                </p>
                <p className="mt-2 text-sm leading-snug text-black/65">
                  Один бот обслуживает до {maxConn}{' '}
                  {plural(maxConn, ['Telegram-аккаунта', 'Telegram-аккаунтов', 'Telegram-аккаунтов'])}.
                  Второй бот нужен, только если хотите разделить бизнесы между разными
                  ботами-секретарями.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowTokenForm(true);
                    setError('');
                    window.setTimeout(() => tokenInputRef.current?.focus(), 50);
                  }}
                  className="land-btn-ghost mt-3 min-h-11 cursor-pointer px-4 text-sm"
                >
                  Подключить ещё бота
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}
          </div>

          <h3 className="land-display mt-6 text-base tracking-[-0.03em]">Подключённые боты</h3>
          {aiBots.length === 0 ? (
            <div className="mt-3 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="font-semibold text-black">Бот-секретарь ещё не подключён</p>
              <p className="mx-auto mt-1 max-w-[56ch] text-sm text-black/55">
                Это обычный Telegram-бот с включённым Business Mode. Он не пишет в каналы и не
                рассылает — он отвечает тем, кто написал вам в личку.
              </p>
            </div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-xl border border-black/10">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead className="bg-[#faf8f5]">
                  <tr>
                    <th className={TH}>Бот</th>
                    <th className={TH}>Состояние</th>
                    <th className={TH}>Диалоги</th>
                    <th className={TH}>Аккаунты Business</th>
                    <th className={`${TH} text-right`}>Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {aiBots.map((bot) => (
                    <tr key={bot.id} className="transition-colors duration-200 hover:bg-[#faf8f5]">
                      <td className="px-3 py-3">
                        <Link
                          href={`/dashboard/ai/${bot.id}`}
                          className="font-medium text-black underline-offset-2 hover:underline"
                        >
                          @{bot.botUsername || 'бот без username'}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        {bot.status === 'active' ? (
                          <Badge variant="success">Работает</Badge>
                        ) : (
                          <Badge variant="warning">Остановлен</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 tabular-nums text-sm text-black/70">
                        <span className="inline-flex items-center gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5 text-black/40" aria-hidden />
                          {formatInt(bot.conversationCount ?? 0)}
                        </span>
                      </td>
                      <td className="px-3 py-3 tabular-nums text-sm text-black/70">
                        {formatInt(bot.businessConnectionCount ?? 0)} из {maxConn}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {deleteConfirmId === bot.id ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className="text-xs text-black/55">
                              Снять webhook и отвязать диалоги?
                            </span>
                            <button
                              type="button"
                              disabled={busy === `del:${bot.id}`}
                              onClick={() => void deleteBot(bot.id)}
                              className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#c2410c]/40 bg-[#fff5f0] px-3 text-xs font-semibold text-[#c2410c] transition-colors duration-200 hover:border-[#c2410c] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy === `del:${bot.id}` ? 'Удаляем…' : 'Да, удалить'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId('')}
                              className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                            >
                              Отмена
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <Link
                              href={`/dashboard/ai/${bot.id}`}
                              className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                            >
                              Диалоги и агент
                            </Link>
                            <button
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() => setDeleteConfirmId(bot.id)}
                              aria-label={`Удалить бота @${bot.botUsername || bot.id}`}
                              className="inline-flex h-9 w-9 min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-full border border-black/15 text-black/55 transition-colors duration-200 hover:border-[#c2410c]/50 hover:text-[#c2410c] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <SectionHead
            index="05"
            kicker="настройка"
            title="AI-агенты"
            description="Агент — это инструкция для нейросети и её база знаний. Один агент можно назначить сразу на несколько каналов."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat
              accent={accounts.agents === 0}
              label="Агентов создано"
              value={formatInt(accounts.agents)}
              hint={
                accounts.agents === 0
                  ? 'Без агента AI не отвечает ни в одном канале'
                  : 'Назначаются на каналы и отдельные диалоги'
              }
            />
            <Stat
              label="Открытых диалогов"
              value={formatInt(traffic.conversationsOpen)}
              hint={`из ${formatInt(traffic.conversationsTotal)} за всё время`}
            />
            <Stat
              label="Сообщений за 30 дней"
              value={formatInt(traffic.messages30d)}
              hint="Входящие и исходящие по всем каналам"
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/dashboard/ai/agents" className="land-btn min-h-11 cursor-pointer px-4 text-sm">
              {accounts.agents === 0 ? 'Создать первого агента' : 'Настроить агентов'}
            </Link>
            <Link
              href="/dashboard/crm"
              className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
            >
              Переписка в CRM
            </Link>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
