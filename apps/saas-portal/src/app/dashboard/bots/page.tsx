'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Loader2, Megaphone, Plus } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { GiftBotsHero } from '@/components/portal/gift-bots-hero';

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  botLink: string | null;
  hasGiftCampaign: boolean;
  subscriberCount?: number;
  campaign: {
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
  const totalSubscribers = giftBots.reduce((n, b) => n + (b.subscriberCount ?? 0), 0);

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

  const pay = async () => {
    setBusy('pay');
    setError('');
    try {
      await startCheckout({ productCode: 'gift_bot', periodMonths: 1 });
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
      if (!res.ok) throw new Error(json.error || 'Не удалось создать ссылку');
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
    'Пробный период уже использован. Оформите тариф, чтобы снова подключать ботов и принимать лидов.';
  let stateLabel = 'Тариф выключен';
  let stateTone: 'connected' | 'pending' | 'off' = 'off';
  let stateHint = `${price} ₽/мес · можно списать партнёрский баланс на шаге оплаты.`;
  let actionLabel = busy === 'pay' ? 'Переходим…' : `Оплатить ${price} ₽`;
  let onHeroAction = () => void pay();
  let secondaryActionLabel: string | undefined;
  let onSecondaryAction: (() => void) | undefined;
  let footerLabel = 'Тариф';
  let footerValue = `${price} ₽/мес`;

  if (!subActive && trialAvailable) {
    heroTitle = 'Подарок за подписку на канал';
    heroSubtitle =
      'Подключите бота к каналу: пост с кнопкой → проверка подписки → выдача материала. Старт — 7 дней бесплатно.';
    stateLabel = 'Пробный период доступен';
    stateTone = 'pending';
    stateHint = `7 дней бесплатно, дальше ${price} ₽/мес за продукт (не за каждый канал).`;
    actionLabel = busy === 'trial' ? 'Активируем…' : 'Активировать 7 дней';
    onHeroAction = () => void startTrial();
    secondaryActionLabel = `Или оплатить ${price} ₽`;
    onSecondaryAction = () => void pay();
  } else if (isTrial) {
    heroTitle = 'Пробный период активен';
    heroSubtitle =
      'Настройте канал, стартовое сообщение и пост в канале, пока trial не закончился. После оплаты воронка продолжит работать.';
    stateLabel = daysLeft != null ? `Пробный период · ${daysLeft} дн.` : 'Пробный период';
    stateTone = 'pending';
    stateHint = `До ${formatUntil(addon?.activeUntil)}. Когда trial закончится, бот перестанет принимать лидов — переписка в CRM сохранится.`;
    actionLabel = busy === 'pay' ? 'Переходим…' : `Оплатить ${price} ₽`;
    onHeroAction = () => void pay();
    footerLabel = 'До';
    footerValue = formatUntil(addon?.activeUntil);
  } else if (subActive) {
    heroTitle = 'Воронка подарков работает';
    heroSubtitle =
      'Один бот = один канал. Несколько проектов на боте — активен только один. Тариф покрывает gift-ботов аккаунта.';
    stateLabel = 'Подписка активна';
    stateTone = 'connected';
    stateHint = `Оплачено до ${formatUntil(addon?.activeUntil)}.`;
    actionLabel = busy === 'pay' ? 'Переходим…' : 'Продлить на месяц';
    onHeroAction = () => void pay();
    footerLabel = 'До';
    footerValue = formatUntil(addon?.activeUntil);
  }

  if (loading) {
    return (
      <AppShell maxWidth="3xl">
        <LoadingState />
      </AppShell>
    );
  }

  return (
    <AppShell maxWidth="3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          ← Кабинет
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" asChild>
            <Link href="/dashboard/mailing/bot">
              <Megaphone className="h-4 w-4" /> Рассылки
            </Link>
          </Button>
          <Button
            variant="solid"
            onClick={() => void createBot()}
            disabled={Boolean(busy) || (!subActive && !trialAvailable)}
          >
            {busy === 'provision' ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            Подключить канал
          </Button>
        </div>
      </div>

      <GiftBotsHero
        title={heroTitle}
        subtitle={heroSubtitle}
        facts={[
          { label: 'Боты', value: String(giftBots.length) },
          { label: 'Подписчики', value: String(totalSubscribers) },
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

      {error && (
        <Alert className="mt-4" variant="error">
          {error}
        </Alert>
      )}

      {provision && (
        <section className="mt-6 space-y-3 rounded-2xl border border-border px-5 py-5">
          <h2 className="land-display text-xl tracking-[-0.03em]">Создание бота в Telegram</h2>
          <p className="text-sm text-muted-foreground">
            Откройте ссылку внутри Telegram (не в Safari/Chrome). Username: @
            {provision.suggestedUsername}
          </p>
          {!provision.telegramLinked && !data?.telegramLinked && (
            <Button asChild variant="secondary">
              <a href={provision.linkManager} target="_blank" rel="noreferrer">
                1. Привязать Telegram
              </a>
            </Button>
          )}
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="solid">
              <a href={provision.deepLink} target="_blank" rel="noreferrer">
                Создать бота <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
            <CopyButton value={provision.deepLink} label="Скопировать ссылку" />
            {provision.deepLinkSimple && (
              <Button asChild variant="ghost">
                <a href={provision.deepLinkSimple} target="_blank" rel="noreferrer">
                  Запасная ссылка
                </a>
              </Button>
            )}
          </div>
          <Input readOnly value={provision.deepLink} className="font-mono text-xs" />
          <p className="text-xs text-muted-foreground">
            После подтверждения в Telegram бот появится в списке ниже.
          </p>
        </section>
      )}

      {giftBots.length === 0 ? (
        <section className="mt-8 space-y-4">
          <h2 className="land-display text-xl tracking-[-0.03em]">С чего начать</h2>
          <ol className="space-y-3 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <span className="land-display w-6 shrink-0 text-foreground">1</span>
              <span>
                Активируйте пробный период или оплатите тариф ({price} ₽/мес на аккаунт).
              </span>
            </li>
            <li className="flex gap-3">
              <span className="land-display w-6 shrink-0 text-foreground">2</span>
              <span>Нажмите «Подключить канал» и создайте бота через Manager в Telegram.</span>
            </li>
            <li className="flex gap-3">
              <span className="land-display w-6 shrink-0 text-foreground">3</span>
              <span>В карточке бота привяжите канал и настройте стартовое сообщение + подарок.</span>
            </li>
            <li className="flex gap-3">
              <span className="land-display w-6 shrink-0 text-foreground">4</span>
              <span>Опубликуйте пост в канале с кнопкой — лиды появятся в CRM.</span>
            </li>
          </ol>
          <Button
            variant="solid"
            onClick={() => void createBot()}
            disabled={Boolean(busy) || (!subActive && !trialAvailable)}
          >
            <Plus className="h-4 w-4" /> Подключить первый канал
          </Button>
        </section>
      ) : (
        <section className="mt-8 space-y-3">
          <div className="flex items-end justify-between gap-3">
            <h2 className="land-display text-xl tracking-[-0.03em]">Ваши боты</h2>
            <p className="text-xs text-muted-foreground">
              Manager: {data?.managerBot || '@VoxlyGiftbot'}
            </p>
          </div>
          <ul className="stagger divide-y divide-border rounded-2xl border border-border">
            {giftBots.map((bot) => {
              const channel = bot.campaign?.channelUsername
                ? `@${bot.campaign.channelUsername.replace(/^@/, '')}`
                : 'Канал не настроен';
              const clicks = bot.campaign?.promoPost?.clickCount ?? 0;
              const published = Boolean(bot.campaign?.promoPost?.publishedAt);
              return (
                <li key={bot.id}>
                  <Link
                    href={`/dashboard/bots/${bot.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-secondary/40"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold tracking-tight">{channel}</p>
                        <Badge variant={bot.status === 'active' ? 'success' : 'warning'}>
                          {bot.status}
                        </Badge>
                        {bot.hasGiftCampaign && <Badge variant="secondary">воронка</Badge>}
                        {published && <Badge variant="outline">пост</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Бот: @{bot.botUsername || '…'} · подписчики {bot.subscriberCount ?? 0}
                        {published ? ` · клики ${clicks}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-medium text-foreground">Настроить →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
