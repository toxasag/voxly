'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { cn } from '@/lib/utils';

interface UserData {
  id: string;
  email: string;
  firstName: string;
  role: string;
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    twentyWorkspaceId: string | null;
    subscription: {
      status: string;
      plan: string;
      isTrial: boolean;
      startsAt: string;
      expiresAt: string | null;
      seatsUsed: number;
      seatsIncluded: number;
    } | null;
    aiWallet: { balanceRub: number } | null;
    referralCode: { code: string } | null;
  } | null;
}

interface ReferralStats {
  code: string;
  link: string;
  referrals: unknown[];
  totalEarnings: string;
  balance: string;
}

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  subscriberCount?: number;
  conversationCount?: number;
  campaign: { channelUsername: string | null } | null;
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'sage' | 'blue' | 'peach' | 'pink' | 'neutral';
}) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/80 px-4 py-3 transition-colors duration-[var(--duration-fast)]',
        accent === 'sage' && 'bg-[#f3f7f2]',
        accent === 'blue' && 'bg-[#f0f4fb]',
        accent === 'peach' && 'bg-[#fbf3ee]',
        accent === 'pink' && 'bg-[#faf0f3]',
        (!accent || accent === 'neutral') && 'bg-secondary/50',
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [referral, setReferral] = useState<ReferralStats | null>(null);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [aiBots, setAiBots] = useState<BotRow[]>([]);
  const [gramjsBots, setGramjsBots] = useState<BotRow[]>([]);
  const [waBots, setWaBots] = useState<BotRow[]>([]);
  const [giftPrice, setGiftPrice] = useState(500);
  const [aiPrice, setAiPrice] = useState(1000);
  const [gramjsPrice, setGramjsPrice] = useState(500);
  const [waPrice, setWaPrice] = useState(500);
  const [loading, setLoading] = useState(true);
  const [crmOpening, setCrmOpening] = useState(false);
  const [crmError, setCrmError] = useState('');
  const [crmFallbackUrl, setCrmFallbackUrl] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }

    try {
      const [meRes, refRes, botsRes] = await Promise.all([
        fetch('/api/auth/me', { headers: authHeaders() }),
        fetch('/api/referrals', { headers: authHeaders() }),
        fetch('/api/bots', { headers: authHeaders() }),
      ]);

      if (!meRes.ok) throw new Error('Unauthorized');
      const me = (await meRes.json()) as UserData;
      setUser(me);

      if (refRes.ok) setReferral(await refRes.json());

      if (botsRes.ok) {
        const botsJson = await botsRes.json();
        const all = (botsJson.bots || []) as BotRow[];
        setBots(all.filter((b) => b.botType === 'gift'));
        setAiBots(all.filter((b) => b.botType === 'ai_tg'));
        setGramjsBots(all.filter((b) => b.botType === 'ai_gramjs'));
        setWaBots(all.filter((b) => b.botType === 'ai_wa'));
        if (typeof botsJson.giftBotPriceMonthly === 'number') {
          setGiftPrice(botsJson.giftBotPriceMonthly);
        }
        if (typeof botsJson.aiBotPriceMonthly === 'number') {
          setAiPrice(botsJson.aiBotPriceMonthly);
        }
        if (typeof botsJson.gramjsPriceMonthly === 'number') {
          setGramjsPrice(botsJson.gramjsPriceMonthly);
        }
        if (typeof botsJson.waPriceMonthly === 'number') {
          setWaPrice(botsJson.waPriceMonthly);
        }
      }

      if (me.tenant && !me.tenant.twentyWorkspaceId) {
        setTimeout(() => load(), 3000);
      }
    } catch {
      localStorage.removeItem('voxly_token');
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const openCrm = async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) return router.push('/login');

    setCrmOpening(true);
    setCrmError('');
    setCrmFallbackUrl('');

    // Named window keeps a reference (Chrome `_blank` + noopener often returns null).
    const popup = window.open('about:blank', 'voxly_crm');
    if (popup) {
      try {
        popup.document.write(
          '<!doctype html><title>Voxly CRM</title><body style="font:14px system-ui;padding:24px;color:#333">Открываем CRM…</body>',
        );
        popup.document.close();
      } catch {
        /* ignore */
      }
    }

    try {
      const res = await fetch('/api/tenant/crm-login', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Не удалось открыть CRM');
      const crmUrl =
        data.chatToken && typeof data.chatToken === 'string'
          ? `${data.url}${data.url.includes('#') ? '&' : '#'}voxlyChatToken=${encodeURIComponent(data.chatToken)}`
          : data.url;

      setCrmFallbackUrl(crmUrl);

      // Re-open same named window with the real SSO URL (more reliable than location.replace).
      const navigated = window.open(crmUrl, 'voxly_crm');
      if (!navigated && !(popup && !popup.closed)) {
        setCrmError('Нажмите ссылку ниже, чтобы открыть CRM.');
      } else if (popup && !popup.closed && !navigated) {
        try {
          popup.location.replace(crmUrl);
        } catch {
          setCrmError('Нажмите ссылку ниже, чтобы открыть CRM.');
        }
      }
    } catch (error) {
      try {
        popup?.close();
      } catch {
        /* ignore */
      }
      setCrmError(error instanceof Error ? error.message : 'Не удалось открыть CRM');
    } finally {
      setCrmOpening(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  if (!user) return null;

  if (!user.tenant) {
    if (user.role === 'superadmin') {
      return (
        <AppShell showNav={false} maxWidth="2xl">
          <div className="py-16 text-center">
            <h1 className="text-xl font-semibold">Супер-админ</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              У платформенного админа нет клиентского воркспейса — откройте админку.
            </p>
            <Button asChild variant="solid" className="mt-6">
              <Link href="/admin">Открыть /admin</Link>
            </Button>
          </div>
        </AppShell>
      );
    }
    return (
      <AppShell showNav={false} maxWidth="2xl">
        <div className="py-16 text-center">
          <h1 className="text-xl font-semibold">Нет воркспейса</h1>
          <p className="mt-2 text-sm text-muted-foreground">Аккаунт есть, но tenant ещё не привязан.</p>
          <Button asChild variant="outline" className="mt-6">
            <Link href="/register">Создать воркспейс</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const tenant = user.tenant;
  const sub = tenant.subscription;
  const isTrial = sub?.isTrial === true;
  const isSuperadmin = user.role === 'superadmin';
  const crmReady = Boolean(tenant.twentyWorkspaceId);
  const referralCount = referral?.referrals?.length ?? 0;
  const earnedRub = Number(referral?.totalEarnings ?? 0);
  const refCode = referral?.code || tenant.referralCode?.code || '—';
  const refLink =
    referral?.link ||
    (tenant.referralCode?.code ? `https://getvoxly.ru/r/${tenant.referralCode.code}` : null);
  const totalSubscribers = bots.reduce((sum, b) => sum + (b.subscriberCount ?? 0), 0);

  return (
    <AppShell>
      <header className="mb-10 flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Кабинет
          </p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight text-foreground">
            {tenant.name || tenant.slug}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
        </div>
        <div className="flex gap-2">
          {isSuperadmin && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/admin">Админка</Link>
            </Button>
          )}
        </div>
      </header>

      <div className="stagger grid gap-4 md:grid-cols-2">
        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">Подписка</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {sub?.status === 'active'
                  ? isTrial
                    ? 'Пробный период CRM'
                    : sub.plan
                  : 'Подписка не активна'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm">
                {isTrial || sub?.status !== 'active' ? 'Выбрать тариф' : 'Продлить'}
              </Button>
              <Button variant="solid" size="sm" onClick={openCrm} disabled={!crmReady || crmOpening}>
                {crmOpening ? 'Открываем…' : crmReady ? 'Открыть CRM' : 'CRM создаётся…'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">
              CRM открывается в новой вкладке. Кабинет остаётся открытым — вернитесь к нему в браузере.
            </p>
            {crmError && (
              <Alert className="mb-3" variant="error">
                <div className="space-y-2">
                  <p>{crmError}</p>
                  {crmFallbackUrl ? (
                    <a
                      href={crmFallbackUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex text-sm font-semibold underline underline-offset-2"
                    >
                      Открыть CRM в новой вкладке →
                    </a>
                  ) : null}
                </div>
              </Alert>
            )}
            {!crmError && crmFallbackUrl ? (
              <p className="mb-3 text-xs text-muted-foreground">
                Если вкладка пустая —{' '}
                <a
                  href={crmFallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold underline underline-offset-2"
                >
                  откройте CRM по ссылке
                </a>
                .
              </p>
            ) : null}
            {sub?.status === 'active' ? (
              <div className="grid gap-3 sm:grid-cols-3">
                <Kpi label="Статус" value={isTrial ? 'Пробный' : 'Активна'} accent="sage" />
                <Kpi
                  label="Действует до"
                  value={sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString('ru-RU') : '—'}
                  accent="blue"
                />
                <Kpi
                  label="Пользователи"
                  value={`${sub.seatsUsed} / ${sub.seatsIncluded}`}
                  accent="peach"
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Оформите подписку, чтобы пользоваться CRM.</p>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Реферальная программа</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">Код и ссылка для приглашений</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Kpi label="Рефералов" value={String(referralCount)} accent="blue" />
              <Kpi
                label="Заработано"
                value={`${earnedRub.toLocaleString('ru-RU')} ₽`}
                accent="sage"
              />
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Код
                  </p>
                  <p className="mt-0.5 text-sm font-medium">{refCode}</p>
                </div>
                {refCode !== '—' && <CopyButton value={refCode} label="Код" />}
              </div>
              <div className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Ссылка
                  </p>
                  {refLink ? (
                    <a
                      href={refLink}
                      className="mt-0.5 block truncate text-sm font-medium text-foreground hover:underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {refLink.replace(/^https?:\/\//, '')}
                    </a>
                  ) : (
                    <p className="mt-0.5 text-sm">—</p>
                  )}
                </div>
                {refLink && <CopyButton value={refLink} label="Ссылку" />}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">Бот выдачи подарков</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                {giftPrice.toLocaleString('ru-RU')} ₽/мес за канал
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/bots">Создать бота</Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link href="/dashboard/bots/broadcasts">Рассылка</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Kpi label="Ботов" value={String(bots.length)} accent="peach" />
              <Kpi label="Подписчиков" value={String(totalSubscribers)} accent="pink" />
            </div>

            {bots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Пока нет подключённых ботов. Создайте бота и привяжите канал.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-border">
                {bots.map((bot, i) => {
                  const channel = bot.campaign?.channelUsername
                    ? `@${bot.campaign.channelUsername.replace(/^@/, '')}`
                    : 'Канал не настроен';
                  return (
                    <li key={bot.id} className={cn(i > 0 && 'border-t border-border')}>
                      <Link
                        href={`/dashboard/bots/${bot.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors duration-[var(--duration-fast)] hover:bg-secondary/70"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">{channel}</p>
                          <p className="truncate text-sm text-muted-foreground">
                            @{bot.botUsername || '…'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                          <span className="text-sm text-muted-foreground">
                            {bot.subscriberCount ?? 0} подп.
                          </span>
                          <Badge variant={bot.status === 'active' ? 'success' : 'warning'}>
                            {bot.status}
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">Автоматизация чатов</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Business-бот · до 10 аккаунтов Telegram Business ·{' '}
                {aiPrice.toLocaleString('ru-RU')} ₽/мес. AI подключается отдельно через агентов.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/ai">Настроить</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Kpi label="Business-ботов" value={String(aiBots.length)} accent="peach" />
              <Kpi
                label="Диалогов"
                value={String(aiBots.reduce((s, b) => s + (b.conversationCount ?? 0), 0))}
                accent="sage"
              />
            </div>
            {aiBots.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Создайте managed-бота и добавьте его в Telegram → Бизнес → Автоматизация чатов.
              </p>
            ) : (
              <ul className="overflow-hidden rounded-lg border border-border">
                {aiBots.map((bot, i) => (
                  <li key={bot.id} className={cn(i > 0 && 'border-t border-border')}>
                    <Link
                      href={`/dashboard/ai/${bot.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3.5 transition-colors duration-[var(--duration-fast)] hover:bg-secondary/70"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          @{bot.botUsername || '…'}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">Business-бот</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <Badge variant={bot.status === 'active' ? 'success' : 'warning'}>
                          {bot.status}
                        </Badge>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">Подключение аккаунтов</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Личный Telegram и WhatsApp в CRM. Без AI, пока не назначите агента.
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/ai/gramjs">Telegram</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link
              href="/dashboard/ai/gramjs"
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3.5 transition-colors hover:bg-secondary/70"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">Telegram</p>
                <p className="text-sm text-muted-foreground">
                  {gramjsBots.length > 0
                    ? `${gramjsBots.length} акк. · ${gramjsPrice.toLocaleString('ru-RU')} ₽/мес`
                    : `QR-вход · ${gramjsPrice.toLocaleString('ru-RU')} ₽/мес`}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
            <Link
              href="/dashboard/ai/whatsapp"
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3.5 transition-colors hover:bg-secondary/70"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium">WhatsApp</p>
                <p className="text-sm text-muted-foreground">
                  {waBots.length > 0
                    ? `${waBots.length} акк. · ${waPrice.toLocaleString('ru-RU')} ₽/мес`
                    : `QR-вход · ${waPrice.toLocaleString('ru-RU')} ₽/мес`}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
            <div>
              <CardTitle className="text-lg">AI-агенты</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Промпты, назначение на аккаунт/чат и баланс ответов. Без агента AI молчит.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard/ai/agents">Открыть</Link>
              </Button>
              <Button variant="secondary" size="sm">
                Пополнить
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Kpi
              label="Баланс AI"
              value={`${(tenant.aiWallet?.balanceRub || 0).toLocaleString('ru-RU')} ₽`}
              accent="blue"
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
