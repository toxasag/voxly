'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Loader2, Plus } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { GiftBotsHero } from '@/components/portal/gift-bots-hero';
import { PartnerBalanceApply } from '@/components/portal/partner-balance-apply';
import { usePartnerBalanceApply } from '@/hooks/use-partner-balance-apply';

const SECTION =
  'rounded-2xl border border-black/10 bg-[#faf8f5] p-5 sm:p-6';
const SECTION_WARM =
  'rounded-2xl border border-[#f5a623]/35 bg-[#fff8ec] p-5 sm:p-6';

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  botLink: string | null;
  hasGiftCampaign: boolean;
  subscriberCount?: number;
  giftedCount?: number;
  campaign: {
    channelId?: string;
    channelUsername: string | null;
    isActive: boolean;
    promoPost?: { clickCount?: number; publishedAt?: string };
  } | null;
}

interface GiftAddon {
  activeUntil: string | null;
  isTrial: boolean;
  isActive: boolean;
  trialAvailable?: boolean;
}

interface BotsResponse {
  telegramLinked?: boolean;
  managerBot?: string;
  giftBotPriceMonthly?: number;
  giftBotSlots?: number;
  giftBotsUsed?: number;
  giftAddon: GiftAddon | null;
  bots: BotRow[];
}

function daysRemaining(until: string | null | undefined): number | null {
  if (!until) return null;
  const ms = new Date(until).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function formatUntil(until: string | null | undefined): string {
  if (!until) return '—';
  return new Date(until).toLocaleDateString('ru-RU');
}

function botStatusRu(status: string): string {
  if (status === 'active') return 'Работает';
  if (status === 'pending') return 'Создаётся';
  if (status === 'error' || status === 'failed') return 'Ошибка';
  if (status === 'disabled' || status === 'inactive') return 'Выключен';
  return status;
}

function botNextHint(bot: BotRow): string {
  if (bot.botType === 'gift_max') {
    if ((bot.subscriberCount ?? 0) === 0) return 'Ждём первых сообщений в MAX';
    return 'Настроить воронку';
  }
  const channelOk =
    Boolean(bot.campaign?.channelUsername) &&
    bot.campaign?.channelId !== 'pending' &&
    Boolean(bot.campaign?.channelId);
  if (!channelOk) return 'Привяжите канал';
  if (!bot.campaign?.promoPost?.publishedAt) return 'Опубликуйте пост';
  if ((bot.subscriberCount ?? 0) === 0) return 'Ждём первых /start';
  return 'Настроить воронку';
}

export default function GiftBotsListPage() {
  const router = useRouter();
  const [data, setData] = useState<BotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [provision, setProvision] = useState<{
    deepLink: string;
    deepLinkSimple?: string;
    linkManager: string;
    suggestedUsername?: string;
    telegramLinked?: boolean;
  } | null>(null);
  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/bots', { headers: authHeaders() });
      if (!res.ok) throw new Error('Не удалось загрузить ботов');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const giftBots = useMemo(
    () => (data?.bots || []).filter((b) => b.botType === 'gift'),
    [data?.bots],
  );

  const price = data?.giftBotPriceMonthly ?? 500;
  const addon = data?.giftAddon ?? null;
  const trialAvailable = addon?.trialAvailable ?? addon == null;
  const subActive = Boolean(addon?.isActive);
  const isTrial = Boolean(subActive && addon?.isTrial);
  const daysLeft = daysRemaining(addon?.activeUntil);
  const botSlots = Math.max(0, data?.giftBotSlots ?? 0);
  const botsUsed = data?.giftBotsUsed ?? 0;
  const renewTotal = Math.max(1, botSlots || 1) * price;
  const slotsFull = subActive && botsUsed >= Math.max(1, botSlots);
  const balanceApply = usePartnerBalanceApply(subActive ? renewTotal : price);

  const totalSubscribers = giftBots.reduce((n, b) => n + (b.subscriberCount ?? 0), 0);
  const totalGifted = giftBots.reduce((n, b) => n + (b.giftedCount ?? 0), 0);
  const totalClicks = giftBots.reduce(
    (n, b) => n + (b.campaign?.promoPost?.clickCount ?? 0),
    0,
  );
  const channelsReady = giftBots.filter((b) => Boolean(b.campaign?.channelUsername)).length;
  const postsPublished = giftBots.filter((b) =>
    Boolean(b.campaign?.promoPost?.publishedAt),
  ).length;
  const botsNeedingAction = giftBots.filter((b) => botNextHint(b) !== 'Настроить воронку').length;

  const startTrial = async () => {
    setBusy('trial');
    setError('');
    try {
      const res = await fetch('/api/bots/gift/start-trial', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось активировать trial');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const payRenew = async () => {
    setBusy('pay');
    setError('');
    try {
      const qty = Math.max(1, botSlots || 1);
      await startCheckout({
        productCode: 'gift_bot',
        periodMonths: 1,
        quantity: qty,
        intent: 'renew',
        ...balanceApply.applyBalancePayload,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setBusy('');
    }
  };

  const payAddSlot = async () => {
    setBusy('pay-add');
    setError('');
    try {
      await startCheckout({
        productCode: 'gift_bot',
        periodMonths: 1,
        quantity: 1,
        intent: 'add',
        ...(balanceApply.useBalance
          ? { applyBalanceRub: Math.min(balanceApply.appliedRub || 0, price) }
          : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setBusy('');
    }
  };

  /** First activation after trial used: buy 1 slot. */
  const payFirst = async () => {
    setBusy('pay');
    setError('');
    try {
      await startCheckout({
        productCode: 'gift_bot',
        periodMonths: 1,
        quantity: 1,
        intent: 'add',
        ...balanceApply.applyBalancePayload,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setBusy('');
    }
  };

  const createBot = async () => {
    setBusy('provision');
    setError('');
    try {
      if (!subActive) {
        if (!trialAvailable) {
          throw new Error('Нужна оплата тарифа, чтобы подключить бота');
        }
        const trialRes = await fetch('/api/bots/gift/start-trial', {
          method: 'POST',
          headers: authHeaders(),
          body: '{}',
        });
        const trialJson = await trialRes.json();
        if (!trialRes.ok) throw new Error(trialJson.error || 'Не удалось активировать trial');
      }
      const res = await fetch('/api/bots/provision-link', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ botType: 'gift', suggestedName: 'Voxly Gift Bot' }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 402 && json.intent === 'add') {
          throw new Error(json.error || 'Нужен ещё один слот — оплатите бота');
        }
        throw new Error(json.error || 'Не удалось создать ссылку');
      }
      setProvision({
        deepLink: json.deepLink,
        deepLinkSimple: json.deepLinkSimple,
        linkManager: json.linkManager,
        suggestedUsername: json.suggestedUsername,
        telegramLinked: json.telegramLinked,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  let heroTitle = 'Нужна оплата';
  let heroSubtitle =
    'Пробный период уже использован. Оформите оплату — 500 ₽/мес за одного Telegram-бота.';
  let stateLabel = 'Тариф выключен';
  let stateTone: 'connected' | 'pending' | 'off' = 'off';
  let stateHint = `${price} ₽/мес за одного Telegram-бота · можно списать партнёрский баланс.`;
  let actionLabel = busy === 'pay' ? 'Переходим…' : `Оплатить ${price} ₽`;
  let onHeroAction = () => void payFirst();
  let secondaryActionLabel: string | undefined;
  let onSecondaryAction: (() => void) | undefined;
  let footerLabel = 'Тариф';
  let footerValue = `${price} ₽/бот`;

  if (!subActive && trialAvailable) {
    heroTitle = 'Бот подарков Telegram';
    heroSubtitle =
      'Пост в канале → бот проверяет подписку → выдаёт материал. Старт бесплатно на 7 дней — один бот.';
    stateLabel = 'Пробный период доступен';
    stateTone = 'pending';
    stateHint = `7 дней бесплатно (1 бот), дальше ${price} ₽/мес за каждого Telegram-бота.`;
    actionLabel = busy === 'trial' ? 'Активируем…' : 'Активировать 7 дней';
    onHeroAction = () => void startTrial();
    secondaryActionLabel = `Или оплатить ${price} ₽`;
    onSecondaryAction = () => void payFirst();
  } else if (isTrial) {
    heroTitle =
      botsNeedingAction > 0 ? 'Донастройте воронку до конца trial' : 'Пробный период активен';
    heroSubtitle =
      botsNeedingAction > 0
        ? `${botsNeedingAction} бот(а) ещё без канала или поста. Закройте шаги, пока trial не закончился.`
        : 'Воронка принимает лидов. После оплаты всё продолжит работать без паузы.';
    stateLabel = daysLeft != null ? `Пробный период · ${daysLeft} дн.` : 'Пробный период';
    stateTone = 'pending';
    stateHint = `Слоты ${botsUsed}/${Math.max(1, botSlots)} · до ${formatUntil(addon?.activeUntil)}. ${price} ₽/мес за бота.`;
    actionLabel = busy === 'pay' ? 'Переходим…' : `Оплатить ${renewTotal} ₽`;
    onHeroAction = () => void payRenew();
    if (slotsFull) {
      secondaryActionLabel = busy === 'pay-add' ? 'Переходим…' : `Ещё бот · ${price} ₽`;
      onSecondaryAction = () => void payAddSlot();
    }
    footerLabel = 'До';
    footerValue = formatUntil(addon?.activeUntil);
  } else if (subActive) {
    heroTitle =
      botsNeedingAction > 0 ? 'Есть боты без полной настройки' : 'Воронка подарков работает';
    heroSubtitle = slotsFull
      ? `Использовано ${botsUsed} из ${botSlots} слотов. Чтобы подключить ещё Telegram-бота — купите слот.`
      : `Слоты ${botsUsed}/${botSlots}. Один слот = один Telegram-бот · ${price} ₽/мес.`;
    stateLabel = 'Подписка активна';
    stateTone = botsNeedingAction > 0 || slotsFull ? 'pending' : 'connected';
    stateHint = `Оплачено до ${formatUntil(addon?.activeUntil)}. Продление: ${renewTotal} ₽ за ${Math.max(1, botSlots)} бот(ов).`;
    actionLabel = busy === 'pay' ? 'Переходим…' : `Продлить · ${renewTotal} ₽`;
    onHeroAction = () => void payRenew();
    secondaryActionLabel = busy === 'pay-add' ? 'Переходим…' : `Ещё бот · ${price} ₽`;
    onSecondaryAction = () => void payAddSlot();
    footerLabel = 'До';
    footerValue = formatUntil(addon?.activeUntil);
  }

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState />
      </AppShell>
    );
  }

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
        <Link
          href="/dashboard"
          className="inline-flex min-h-10 items-center gap-1 rounded-sm text-sm text-black/55 transition-colors hover:text-black"
        >
          ← Кабинет
        </Link>

        <GiftBotsHero
          title={heroTitle}
          subtitle={heroSubtitle}
          facts={[
            { label: 'Боты', value: String(giftBots.length) },
            { label: 'Подписчики', value: String(totalSubscribers) },
            { label: 'Получили подарок', value: String(totalGifted) },
            {
              label: isTrial ? 'Пробный период' : subActive ? 'Подписка' : 'Статус',
              value: subActive
                ? isTrial
                  ? daysLeft != null
                    ? `${daysLeft} дн.`
                    : 'trial'
                  : formatUntil(addon?.activeUntil)
                : trialAvailable
                  ? 'доступен trial'
                  : 'выкл',
            },
          ]}
          stateLabel={stateLabel}
          stateTone={stateTone}
          stateHint={stateHint}
          actionLabel={actionLabel}
          onAction={onHeroAction}
          actionDisabled={Boolean(busy)}
          secondaryActionLabel={secondaryActionLabel}
          onSecondaryAction={onSecondaryAction}
          footerLabel={footerLabel}
          footerValue={footerValue}
          partnerHint
        />

        {error ? (
          <Alert
            variant="error"
            className="border-[#c2410c]/35 bg-[#fff8ec] text-[#9a3412] animate-error"
          >
            {error}
          </Alert>
        ) : null}

        {balanceApply.availableRub > 0 ? (
          <section className={SECTION}>
            <h2 className="land-display text-xl tracking-[-0.03em]">Оплата тарифа</h2>
            <p className="mt-1 text-sm text-black/55">
              Перед оплатой можно зачесть партнёрский баланс — по умолчанию выключено.
            </p>
            <div className="mt-4 max-w-md space-y-3">
              <PartnerBalanceApply
                availableRub={balanceApply.availableRub}
                invoiceRub={price}
                useBalance={balanceApply.useBalance}
                onUseBalanceChange={balanceApply.setUseBalance}
                balanceInput={balanceApply.balanceInput}
                onBalanceInputChange={balanceApply.setBalanceInput}
                appliedRub={balanceApply.appliedRub}
                netRub={balanceApply.netRub}
                disabled={busy === 'pay'}
                idPrefix="gift-bot-balance"
              />
              <button
                type="button"
                disabled={busy === 'pay'}
                onClick={() => void (subActive ? payRenew() : payFirst())}
                className="land-btn min-h-11 cursor-pointer px-4 text-sm disabled:opacity-50"
              >
                {busy === 'pay'
                  ? 'Переходим…'
                  : balanceApply.appliedRub > 0 && balanceApply.netRub <= 0
                    ? 'Оформить за 0 ₽ — с баланса'
                    : `Оплатить ${balanceApply.netRub || (subActive ? renewTotal : price)} ₽`}
              </button>
            </div>
          </section>
        ) : null}

        <section className={`grid gap-3 sm:grid-cols-3 ${SECTION_WARM}`}>
          {[
            {
              n: '1',
              title: 'Подключите бота к каналу',
              text: 'Создайте бота через Manager и сделайте его админом канала с правом видеть участников.',
            },
            {
              n: '2',
              title: 'Настройте выдачу подарка',
              text: 'Стартовое сообщение, проверка подписки и сам подарок — всё в карточке бота.',
            },
            {
              n: '3',
              title: 'Опубликуйте пост с кнопкой',
              text: 'Клики по кнопке ведут в бота. Подписчики и выдача появятся в итогах ниже.',
            },
          ].map((step) => (
            <div key={step.n} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-xs font-bold text-black">
                {step.n}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-black">{step.title}</p>
                <p className="mt-1 text-sm leading-snug text-black/55">{step.text}</p>
              </div>
            </div>
          ))}
        </section>

        <section className={SECTION}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="land-display text-xl tracking-[-0.03em]">Итоги по воронкам</h2>
              <p className="mt-1 text-sm text-black/55">
                Сводка по ботам · слоты {botsUsed}/{Math.max(botSlots, botsUsed || 0) || '—'} ·
                Manager {data?.managerBot || '@VoxlyGiftbot'}
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                label: 'Каналы привязаны',
                value: `${channelsReady}/${giftBots.length || 0}`,
                hint: 'Без канала подарок не выдаётся',
                accent: channelsReady < giftBots.length,
              },
              {
                label: 'Посты опубликованы',
                value: `${postsPublished}/${giftBots.length || 0}`,
                hint: 'Кнопка в канале приводит лидов',
                accent: postsPublished < giftBots.length,
              },
              {
                label: 'Клики по кнопке',
                value: String(totalClicks),
                hint: 'Нажатия «Получить подарок»',
                accent: false,
              },
              {
                label: 'Получили подарок',
                value: `${totalGifted}/${totalSubscribers || 0}`,
                hint: 'Выдача после проверки подписки',
                accent: false,
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className={`rounded-xl border p-4 ${
                  stat.accent
                    ? 'border-[#f5a623]/50 bg-[#fff8ec]'
                    : 'border-black/10 bg-white/70'
                }`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  {stat.label}
                </p>
                <p className="land-display mt-1 text-[28px] tabular-nums tracking-[-0.03em] text-black">
                  {stat.value}
                </p>
                <p className="mt-1 text-xs leading-snug text-black/55">{stat.hint}</p>
              </div>
            ))}
          </div>
        </section>

        <section className={`space-y-3 ${SECTION}`}>
          {provision ? (
            <>
              <h2 className="land-display text-xl tracking-[-0.03em]">Создание бота в Telegram</h2>
              <p className="text-sm text-black/55">
                Один шаг: откройте ссылку внутри Telegram (не в Safari/Chrome). Username: @
                {provision.suggestedUsername}
              </p>
              {!provision.telegramLinked && !data?.telegramLinked ? (
                <Button asChild variant="secondary">
                  <a href={provision.linkManager} target="_blank" rel="noreferrer">
                    1. Привязать Telegram
                  </a>
                </Button>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <a
                  href={provision.deepLink}
                  target="_blank"
                  rel="noreferrer"
                  className="land-btn inline-flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm"
                >
                  Создать бота <ExternalLink className="h-4 w-4" aria-hidden />
                </a>
                <CopyButton value={provision.deepLink} label="Скопировать ссылку" />
                {provision.deepLinkSimple ? (
                  <a
                    href={provision.deepLinkSimple}
                    target="_blank"
                    rel="noreferrer"
                    className="land-btn-ghost inline-flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm"
                  >
                    Запасная ссылка
                  </a>
                ) : null}
                <button
                  type="button"
                  disabled={Boolean(busy) || (!subActive && !trialAvailable)}
                  onClick={() => void createBot()}
                  className="land-btn-ghost inline-flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'provision' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  Новая ссылка
                </button>
              </div>
              <Input readOnly value={provision.deepLink} className="font-mono text-xs" />
              <p className="text-xs text-black/45">
                После подтверждения в Telegram бот появится в списке ниже. Manager → канал → пост →
                подарок · {price} ₽/мес за бота.
              </p>
            </>
          ) : (
            <>
              <h2 className="land-display text-xl tracking-[-0.03em]">Подключить Telegram-бота</h2>
              <p className="text-sm text-black/55">
                Manager Bot создаст бота и выдаст ссылку. Дальше: канал → пост с кнопкой → проверка
                подписки → подарок. Отдельный продукт от MAX · {price} ₽/мес за бота.
              </p>
              <button
                type="button"
                disabled={Boolean(busy) || (!subActive && !trialAvailable)}
                onClick={() => void createBot()}
                className="land-btn inline-flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'provision' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
                Создать через Manager
              </button>
            </>
          )}
        </section>

        {giftBots.length === 0 ? (
          <section className={SECTION}>
            <h2 className="land-display text-xl tracking-[-0.03em]">С чего начать</h2>
            <p className="mt-1 max-w-[70ch] text-sm text-black/55">
              Пока нет Telegram gift-ботов. Каждый бот — {price} ₽/мес. Для MAX откройте отдельный
              продукт «Подарки MAX».
            </p>
            <ol className="mt-4 space-y-3 text-sm text-black/65">
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-xs font-bold text-black">
                  1
                </span>
                <span className="pt-1">
                  Активируйте пробный период (1 бот) или оплатите {price} ₽/мес.
                </span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-xs font-bold text-black">
                  2
                </span>
                <span className="pt-1">Создайте бота через Manager в Telegram.</span>
              </li>
              <li className="flex gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-xs font-bold text-black">
                  3
                </span>
                <span className="pt-1">В карточке привяжите канал, подарок и пост.</span>
              </li>
            </ol>
            <div className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void createBot()}
                disabled={Boolean(busy) || (!subActive && !trialAvailable)}
                className="land-btn inline-flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-4 w-4" aria-hidden /> Подключить бота
              </button>
            </div>
          </section>
        ) : (
          <section className={SECTION}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="land-display text-xl tracking-[-0.03em]">Ваши боты</h2>
                <p className="mt-1 text-sm text-black/55">
                  {botsNeedingAction > 0
                    ? `${botsNeedingAction} нужно донастроить — откройте карточку и закройте шаг`
                    : 'Все боты с каналом и постом — можно вести трафик'}
                </p>
              </div>
            </div>

            <ul className="stagger mt-4 divide-y divide-black/10 overflow-hidden rounded-xl border border-black/10 bg-white/70">
              {giftBots.map((bot) => {
                const channel = bot.campaign?.channelUsername
                  ? `@${bot.campaign.channelUsername.replace(/^@/, '')}`
                  : 'Канал не настроен';
                const clicks = bot.campaign?.promoPost?.clickCount ?? 0;
                const published = Boolean(bot.campaign?.promoPost?.publishedAt);
                const hint = botNextHint(bot);
                const needsWork = hint !== 'Настроить воронку';
                return (
                  <li key={bot.id}>
                    <Link
                      href={`/dashboard/bots/${bot.id}`}
                      className="flex cursor-pointer flex-col gap-3 px-4 py-4 transition-colors duration-200 hover:bg-[#fff8ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold tracking-tight text-black">
                            {channel}
                          </p>
                          <span className="rounded-full bg-[#f5a623]/25 px-2 py-0.5 text-[11px] font-semibold text-black">
                            Telegram
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              bot.status === 'active'
                                ? 'bg-[#ECFDF5] text-[#059669]'
                                : 'bg-[#fff8ec] text-[#c2410c]'
                            }`}
                          >
                            {botStatusRu(bot.status)}
                          </span>
                          {published ? (
                            <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-semibold text-black/55">
                              пост
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-black/55">
                          Бот @{bot.botUsername || '…'} · подписчики {bot.subscriberCount ?? 0} ·
                          подарок {bot.giftedCount ?? 0}
                          {published ? ` · клики ${clicks}` : ''}
                        </p>
                      </div>
                      <span
                        className={`inline-flex min-h-10 shrink-0 items-center justify-center rounded-full border px-4 text-sm font-semibold ${
                          needsWork
                            ? 'border-[#f5a623] bg-[#fff8ec] text-black'
                            : 'border-black/15 bg-white/50 text-black/70'
                        }`}
                      >
                        Настроить бота
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}
