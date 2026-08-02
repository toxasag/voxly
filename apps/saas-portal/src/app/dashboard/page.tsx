'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { HeroBanner } from '@/components/portal/hero-banner';

interface DashboardOverview {
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    crmReady: boolean;
    crmAccessLocked?: boolean;
    crmAccessReason?: string;
    crmAccessError?: string | null;
  };
  subscription: {
    productCode: string;
    status: string;
    endsAt: string;
    seatsIncluded: number;
    extraSeats: number;
  } | null;
  products: {
    crm: { isActive: boolean; activeUntil: string | null };
    gift: { isActive: boolean; isTrial: boolean; trialAvailable?: boolean; activeUntil: string | null };
    aiBusiness: {
      isActive: boolean;
      isTrial: boolean;
      trialAvailable?: boolean;
      activeUntil: string | null;
      includedSlots: number;
      extraSlots?: number;
      activeAccounts: number;
      limitedAccounts: number;
    };
    gramjs: {
      isActive: boolean;
      isTrial: boolean;
      trialAvailable?: boolean;
      activeUntil: string | null;
    };
    whatsapp: {
      isActive: boolean;
      isTrial: boolean;
      trialAvailable?: boolean;
      activeUntil: string | null;
    };
    mailingBot: {
      isActive: boolean;
      isTrial: boolean;
      trialAvailable?: boolean;
      activeUntil: string | null;
    };
    mailingAccounts: {
      isActive: boolean;
      isTrial: boolean;
      trialAvailable?: boolean;
      activeUntil: string | null;
    };
    mailingStories: {
      isActive: boolean;
      isTrial: boolean;
      trialAvailable?: boolean;
      activeUntil: string | null;
    };
  };
  accounts: {
    giftBots: number;
    aiBusinessBots: number;
    gramjs: number;
    whatsapp: number;
    agents: number;
  };
  traffic: {
    messages7d: number;
    messages30d: number;
    inbound7d: number;
    conversationsOpen: number;
    conversationsTotal: number;
    giftSubscribers: number;
    giftPhases: Record<string, number>;
    opportunitiesApprox: number;
  };
  money: {
    aiWalletRub: number;
    aiSpent30dRub: number;
    aiProviderCost30dRub?: number;
    aiTokens30d?: number;
    aiRequests30d: number;
    referralBalanceRub: number;
    referralEarnedRub: number;
    referralCode: string | null;
  };
}

function formatRub(n: number | undefined | null): string {
  const v = Number(n) || 0;
  return v.toLocaleString('ru-RU', {
    minimumFractionDigits: v > 0 && v < 1 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function formatTokens(n: number | undefined | null): string {
  return Math.round(Number(n) || 0).toLocaleString('ru-RU');
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-subtle)]">
      <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[30px] font-semibold tracking-[-0.025em] text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ProductRow({
  title,
  href,
  active,
  trial,
  until,
  detail,
}: {
  title: string;
  href: string;
  active: boolean;
  trial?: boolean;
  until?: string | null;
  detail?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-muted"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        {detail ? <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {until && active ? (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            до {new Date(until).toLocaleDateString('ru-RU')}
          </span>
        ) : null}
        <Badge variant={active ? 'default' : 'secondary'}>
          {!active ? 'выкл' : trial ? 'trial' : 'активен'}
        </Badge>
      </div>
    </Link>
  );
}

function phaseLabel(key: string): string {
  const map: Record<string, string> = {
    started: 'Старт',
    awaiting_sub: 'Ждут подписку',
    gifted: 'Получили подарок',
    not_gifted: 'Без подарка',
  };
  return map[key] || key;
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [trialBusy, setTrialBusy] = useState('');
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
      const [meRes, dashRes] = await Promise.all([
        fetch('/api/auth/me', { headers: authHeaders() }),
        fetch('/api/tenant/dashboard', { headers: authHeaders() }),
      ]);
      if (!meRes.ok) throw new Error('Unauthorized');
      const me = await meRes.json();
      setRole(me.role || '');

      if (!me.tenant) {
        if (me.role === 'superadmin') {
          setData(null);
          setLoading(false);
          return;
        }
        throw new Error('Нет воркспейса');
      }

      if (!dashRes.ok) throw new Error('Не удалось загрузить дашборд');
      setData((await dashRes.json()) as DashboardOverview);
    } catch (e) {
      if (e instanceof Error && e.message === 'Unauthorized') {
        localStorage.removeItem('voxly_token');
        router.push('/login');
        return;
      }
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const startChannelTrial = async (channel: 'gramjs' | 'whatsapp') => {
    setTrialBusy(channel);
    setError('');
    try {
      const path =
        channel === 'gramjs' ? '/api/bots/gramjs/start-trial' : '/api/bots/whatsapp/start-trial';
      const res = await fetch(path, {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось активировать trial');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка trial');
    } finally {
      setTrialBusy('');
    }
  };

  const startMailingTrial = async (
    type: 'mailing_bot' | 'mailing_accounts' | 'mailing_stories',
  ) => {
    setTrialBusy(type);
    setError('');
    try {
      const res = await fetch('/api/bots/mailing/start-trial', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ type }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось активировать trial');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка trial');
    } finally {
      setTrialBusy('');
    }
  };

  const openCrm = async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) return router.push('/login');
    if (data?.tenant.crmAccessLocked) {
      setCrmError(
        data.tenant.crmAccessError ||
          'Подписка на CRM закончилась. Оформите оплату в разделе CRM.',
      );
      return;
    }
    setCrmOpening(true);
    setCrmError('');
    setCrmFallbackUrl('');
    const { openCrmWorkspace } = await import('@/lib/open-crm');
    const result = await openCrmWorkspace();
    if (result.error === 'not_authenticated') {
      router.push('/login');
    } else if (result.error) {
      setCrmError(result.error);
      if (result.url) setCrmFallbackUrl(result.url);
    } else if (result.url) {
      setCrmFallbackUrl(result.url);
    }
    setCrmOpening(false);
  };

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState />
      </AppShell>
    );
  }

  if (!data && role === 'superadmin') {
    return (
      <AppShell showNav={false} maxWidth="2xl">
        <div className="py-16 text-center">
          <h1 className="text-[30px] font-semibold tracking-[-0.025em]">Супер-админ</h1>
          <p className="mt-2 text-sm text-muted-foreground">Платформенная админка, без клиентского воркспейса.</p>
          <Button asChild variant="solid" className="mt-6">
            <Link href="/admin">Открыть /admin</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">{error || 'Нет данных'}</Alert>
      </AppShell>
    );
  }

  const p = data.products;
  const bizCap =
    (p.aiBusiness.includedSlots || 10) + (p.aiBusiness.extraSlots || 0);
  const phaseEntries = Object.entries(data.traffic.giftPhases || {});
  const refLink = data.money.referralCode
    ? `https://getvoxly.ru/?ref=${encodeURIComponent(data.money.referralCode)}`
    : null;

  return (
    <AppShell maxWidth="6xl">
      <HeroBanner
        greeting={`Добрый день, ${data.tenant.name || 'Антон'}!`}
        date={new Date().toLocaleDateString('ru-RU', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).replace(/^\w/, (c) => c.toUpperCase())}
        actions={
          <Button
            size="sm"
            onClick={() => {
              if (data.tenant.crmAccessLocked) {
                router.push('/dashboard/crm');
                return;
              }
              void openCrm();
            }}
            disabled={
              (!data.tenant.crmReady && !data.tenant.crmAccessLocked) || crmOpening
            }
            className="bg-white text-blue-700 shadow-sm hover:bg-blue-50 hover:text-blue-800 disabled:bg-white/70 disabled:text-blue-700/60"
          >
            {crmOpening
              ? 'Открываем…'
              : data.tenant.crmAccessLocked
                ? 'CRM закрыта — оплатить'
                : data.tenant.crmReady
                  ? 'Открыть CRM'
                  : 'CRM создаётся…'}
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        }
      />

      {role === 'superadmin' && (
        <div className="mb-6 flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin">Админка</Link>
          </Button>
        </div>
      )}

      {crmError && (
        <Alert className="mb-4" variant="error">
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

      <Alert className="mb-6" variant="info">
        <p>
          Техподдержка — напишите боту{' '}
          <a
            href="https://t.me/GetVoxlybot"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline underline-offset-2"
          >
            @GetVoxlybot
          </a>
          . Ответим в Telegram.
        </p>
      </Alert>

      <section className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Сообщения · 7 дн."
          value={String(data.traffic.messages7d)}
          hint={`входящих ${data.traffic.inbound7d}`}
        />
        <Stat
          label="Открытые диалоги"
          value={String(data.traffic.conversationsOpen)}
          hint={`всего ${data.traffic.conversationsTotal}`}
        />
        <Stat
          label="Заявки / лиды"
          value={String(data.traffic.opportunitiesApprox)}
          hint={`gift-подписчики ${data.traffic.giftSubscribers}`}
        />
        <Stat
          label="AI расход · 30 дн."
          value={`${formatRub(data.money.aiSpent30dRub)} ₽`}
          hint={`${data.money.aiRequests30d} запр. · ${formatTokens(data.money.aiTokens30d)} ток. · баланс ${formatRub(data.money.aiWalletRub)} ₽`}
        />
      </section>

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Тарифы и статусы</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ProductRow
              title="CRM Base"
              href="/dashboard/crm"
              active={p.crm.isActive}
              until={p.crm.activeUntil}
              detail={
                data.subscription
                  ? `${data.subscription.seatsIncluded + data.subscription.extraSeats} мест`
                  : undefined
              }
            />
            <ProductRow
              title="AI-агенты"
              href="/dashboard/ai/agents"
              active={data.accounts.agents > 0}
              detail={`${data.accounts.agents} активных · 500 ₽/мес за агента`}
            />
            <ProductRow
              title="WhatsApp"
              href="/dashboard/ai/whatsapp"
              active={p.whatsapp.isActive}
              trial={p.whatsapp.isTrial}
              until={p.whatsapp.activeUntil}
              detail={`${data.accounts.whatsapp} акк.`}
            />
            <ProductRow
              title="Telegram"
              href="/dashboard/ai/gramjs"
              active={p.gramjs.isActive}
              trial={p.gramjs.isTrial}
              until={p.gramjs.activeUntil}
              detail={`${data.accounts.gramjs} акк.`}
            />
            <ProductRow
              title="Телеграм Секретарь"
              href="/dashboard/ai"
              active={p.aiBusiness.isActive}
              trial={p.aiBusiness.isTrial}
              until={p.aiBusiness.activeUntil}
              detail={`${p.aiBusiness.activeAccounts}/${bizCap} аккаунтов${
                p.aiBusiness.limitedAccounts
                  ? ` · ${p.aiBusiness.limitedAccounts} без прав`
                  : ''
              }`}
            />
            <ProductRow
              title="Бот выдачи подарков"
              href="/dashboard/bots"
              active={p.gift.isActive}
              trial={p.gift.isTrial}
              until={p.gift.activeUntil}
              detail={`${data.accounts.giftBots} бот.`}
            />
            <ProductRow
              title="Рассылка ботом"
              href="/dashboard/mailing/bot"
              active={p.mailingBot?.isActive ?? false}
              trial={p.mailingBot?.isTrial}
              until={p.mailingBot?.activeUntil}
              detail="500 ₽/мес"
            />
            <ProductRow
              title="Рассылка с аккаунтов"
              href="/dashboard/mailing"
              active={p.mailingAccounts?.isActive ?? false}
              trial={p.mailingAccounts?.isTrial}
              until={p.mailingAccounts?.activeUntil}
              detail="GramJS + WhatsApp · 500 ₽/мес"
            />
            <ProductRow
              title="Постинг сторис"
              href="/dashboard/mailing/stories"
              active={p.mailingStories?.isActive ?? false}
              trial={p.mailingStories?.isTrial}
              until={p.mailingStories?.activeUntil}
              detail="1000 ₽/мес"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <CardTitle className="text-base">Деньги</CardTitle>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                const raw = window.prompt('Сумма пополнения AI (₽, мин. 500)', '1000');
                if (!raw) return;
                const amountRub = Math.round(Number(raw.replace(/\s/g, '').replace(',', '.')));
                if (!Number.isFinite(amountRub) || amountRub < 500) {
                  window.alert('Минимум 500 ₽');
                  return;
                }
                void startCheckout({ productCode: 'ai_topup', amountRub }).catch((e) => {
                  window.alert(e instanceof Error ? e.message : 'Ошибка оплаты');
                });
              }}
            >
              Пополнить AI
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Баланс AI" value={`${formatRub(data.money.aiWalletRub)} ₽`} />
              <Stat
                label="Списано · 30 дн."
                value={`${formatRub(data.money.aiSpent30dRub)} ₽`}
                hint={`${data.money.aiRequests30d} запр. · ${formatTokens(data.money.aiTokens30d)} ток.${
                  data.money.aiProviderCost30dRub != null
                    ? ` · себест. ${formatRub(data.money.aiProviderCost30dRub)} ₽`
                    : ''
                }`}
              />
            </div>
            <div className="rounded-lg border border-border bg-muted px-4 py-3">
              <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted-foreground">
                Рефералка
              </p>
              <p className="mt-1 text-sm text-foreground">
                Баланс {Math.round(data.money.referralBalanceRub).toLocaleString('ru-RU')} ₽ · заработано{' '}
                {Math.round(data.money.referralEarnedRub).toLocaleString('ru-RU')} ₽
              </p>
              {data.money.referralCode && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                  <code className="rounded-md bg-card px-2 py-1 text-xs">{data.money.referralCode}</code>
                  {refLink && <CopyButton value={refLink} label="Ссылка" />}
                </div>
              )}
              <Button asChild variant="link" size="sm" className="mt-2 h-auto p-0">
                <Link href="/dashboard/partners">Партнерская →</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Воронка Gift</CardTitle>
        </CardHeader>
        <CardContent>
          {phaseEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока нет подписчиков в gift-ботах.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {phaseEntries.map(([phase, count]) => (
                <Stat key={phase} label={phaseLabel(phase)} value={String(count)} />
              ))}
            </div>
          )}
          <div className="mt-4">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/bots">Открыть бота выдачи подарков</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Быстрые действия</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {!p.gramjs.isActive && p.gramjs.trialAvailable !== false && (
            <Button
              variant="solid"
              size="sm"
              disabled={trialBusy === 'gramjs'}
              onClick={() => void startChannelTrial('gramjs')}
            >
              Trial · Telegram
            </Button>
          )}
          {!p.whatsapp.isActive && p.whatsapp.trialAvailable !== false && (
            <Button
              variant="solid"
              size="sm"
              disabled={trialBusy === 'whatsapp'}
              onClick={() => void startChannelTrial('whatsapp')}
            >
              Trial · WhatsApp
            </Button>
          )}
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/bots">Настроить подарок</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/mailing">Открыть рассылки</Link>
          </Button>
          {!p.mailingBot?.isActive && p.mailingBot?.trialAvailable !== false && (
            <Button
              variant="solid"
              size="sm"
              disabled={trialBusy === 'mailing_bot'}
              onClick={() => void startMailingTrial('mailing_bot')}
            >
              Trial · Рассылка ботом
            </Button>
          )}
          {!p.mailingAccounts?.isActive && p.mailingAccounts?.trialAvailable !== false && (
            <Button
              variant="solid"
              size="sm"
              disabled={trialBusy === 'mailing_accounts'}
              onClick={() => void startMailingTrial('mailing_accounts')}
            >
              Trial · Рассылка с аккаунтов
            </Button>
          )}
          {!p.mailingStories?.isActive && p.mailingStories?.trialAvailable !== false && (
            <Button
              variant="solid"
              size="sm"
              disabled={trialBusy === 'mailing_stories'}
              onClick={() => void startMailingTrial('mailing_stories')}
            >
              Trial · Сторис
            </Button>
          )}
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/ai">Подключить Business</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/ai/whatsapp">Подключить WhatsApp</Link>
          </Button>
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/ai/agents">Настроить AI-агента</Link>
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
