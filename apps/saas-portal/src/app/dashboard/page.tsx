'use client';

import { useCallback, useEffect, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bot,
  BrainCircuit,
  Building2,
  ChevronDown,
  Gift,
  MessageSquareText,
  Send,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { DashboardPortalHero } from '@/components/portal/dashboard-portal-hero';

const LAND_SECTION =
  'rounded-2xl border border-black/10 bg-white shadow-none';

interface AddonState {
  isActive: boolean;
  isTrial: boolean;
  trialAvailable?: boolean;
  activeUntil: string | null;
}

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
    isTrial?: boolean;
    endsAt: string;
    seatsIncluded: number;
    extraSeats: number;
  } | null;
  products: {
    crm: { isActive: boolean; activeUntil: string | null };
    gift: AddonState;
    giftMax?: AddonState;
    aiBusiness: AddonState & {
      includedSlots: number;
      extraSlots?: number;
      activeAccounts: number;
      limitedAccounts: number;
    };
    gramjs: AddonState;
    max?: AddonState;
    whatsapp: AddonState;
    mailingBot: AddonState;
    mailingAccounts: AddonState;
    mailingStories: AddonState;
  };
  accounts: {
    giftBots: number;
    giftMaxBots?: number;
    aiBusinessBots: number;
    gramjs: number;
    max?: number;
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

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function statusLabel(active: boolean, trial?: boolean): string {
  if (!active) return 'выкл';
  return trial ? 'trial' : 'активен';
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

type AlertItem = {
  id: string;
  tone: 'warn' | 'info' | 'ok';
  title: string;
  body: string;
  href: string;
  cta: string;
};

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className={`${LAND_SECTION} px-4 py-4`}>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-black/40">
        {label}
      </p>
      <p className="land-display mt-2 text-[1.75rem] leading-none tracking-[-0.04em] text-black">
        {value}
      </p>
      {hint ? <p className="mt-2 text-xs text-black/50">{hint}</p> : null}
    </div>
  );
}

function ProductTile({
  href,
  title,
  detail,
  active,
  trial,
  icon: Icon,
}: {
  href: string;
  title: string;
  detail: string;
  active: boolean;
  trial?: boolean;
  icon: ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className={`${LAND_SECTION} group flex min-h-[7.5rem] flex-col justify-between p-4 transition-colors hover:border-black/25 hover:bg-[#fffaf0]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="rounded-lg border border-black/10 bg-[#f5a623]/15 p-2">
          <Icon className="h-4 w-4 text-black/80" />
        </div>
        <span
          className={`shrink-0 rounded-md px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${
            active
              ? trial
                ? 'bg-black/5 text-black/55'
                : 'bg-[#f5a623]/25 text-black/70'
              : 'bg-black/[0.04] text-black/40'
          }`}
        >
          {statusLabel(active, trial)}
        </span>
      </div>
      <div className="mt-3">
        <p className="text-sm font-semibold tracking-[-0.02em] text-black">{title}</p>
        <p className="mt-1 text-xs leading-snug text-black/50">{detail}</p>
      </div>
    </Link>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [crmOpening, setCrmOpening] = useState(false);
  const [crmError, setCrmError] = useState('');
  const [crmFallbackUrl, setCrmFallbackUrl] = useState('');
  const [giftOpen, setGiftOpen] = useState(false);

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

  const openCrm = async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) return router.push('/login');
    if (data?.tenant.crmAccessLocked) {
      router.push('/dashboard/crm');
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
          <h1 className="land-display text-[30px] tracking-[-0.025em]">Супер-админ</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Платформенная админка, без клиентского воркспейса.
          </p>
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
  const bizCap = (p.aiBusiness.includedSlots || 10) + (p.aiBusiness.extraSlots || 0);
  const phaseEntries = Object.entries(data.traffic.giftPhases || {});
  const refLink = data.money.referralCode
    ? `https://getvoxly.ru/?ref=${encodeURIComponent(data.money.referralCode)}`
    : null;
  const mailingOn =
    Boolean(p.mailingBot?.isActive) ||
    Boolean(p.mailingAccounts?.isActive) ||
    Boolean(p.mailingStories?.isActive);
  const giftOn = p.gift.isActive || Boolean(p.giftMax?.isActive);
  const giftBots = data.accounts.giftBots + (data.accounts.giftMaxBots || 0);

  const alerts: AlertItem[] = [];
  const crmDays = daysUntil(p.crm.activeUntil);
  if (data.tenant.crmAccessLocked) {
    alerts.push({
      id: 'crm-locked',
      tone: 'warn',
      title: 'CRM недоступна',
      body: data.tenant.crmAccessError || 'Подписка закончилась — продлите доступ.',
      href: '/dashboard/crm',
      cta: 'Оплатить CRM',
    });
  } else if (crmDays != null && crmDays >= 0 && crmDays <= 7) {
    alerts.push({
      id: 'crm-ending',
      tone: 'warn',
      title: data.subscription?.isTrial ? 'Trial CRM скоро закончится' : 'CRM скоро закончится',
      body: `Осталось ${crmDays} дн. · до ${new Date(p.crm.activeUntil!).toLocaleDateString('ru-RU')}`,
      href: '/dashboard/crm',
      cta: 'Продлить',
    });
  }
  const aiChannelOn =
    p.aiBusiness.isActive ||
    p.gramjs.isActive ||
    p.whatsapp.isActive ||
    Boolean(p.max?.isActive) ||
    data.accounts.agents > 0;
  if (aiChannelOn && data.money.aiWalletRub < 50) {
    alerts.push({
      id: 'ai-low',
      tone: 'warn',
      title: 'Низкий баланс AI',
      body: `${formatRub(data.money.aiWalletRub)} ₽ — пополните, чтобы агенты отвечали.`,
      href: '/dashboard/ai/agents#balance',
      cta: 'Пополнить',
    });
  }
  if (data.money.referralBalanceRub >= 1000) {
    alerts.push({
      id: 'partner-withdraw',
      tone: 'ok',
      title: 'Можно вывести партнёрский баланс',
      body: `${Math.round(data.money.referralBalanceRub).toLocaleString('ru-RU')} ₽ доступно к выводу.`,
      href: '/dashboard/partners',
      cta: 'К партнёрке',
    });
  }
  if (!p.gramjs.isActive && p.gramjs.trialAvailable !== false) {
    alerts.push({
      id: 'trial-tg',
      tone: 'info',
      title: 'Попробуйте Telegram-канал',
      body: '7 дней trial на личные аккаунты GramJS.',
      href: '/dashboard/ai/gramjs',
      cta: 'Открыть',
    });
  } else if (!p.whatsapp.isActive && p.whatsapp.trialAvailable !== false) {
    alerts.push({
      id: 'trial-wa',
      tone: 'info',
      title: 'Попробуйте WhatsApp',
      body: '7 дней trial на WhatsApp-аккаунты.',
      href: '/dashboard/ai/whatsapp',
      cta: 'Открыть',
    });
  }
  const topAlerts = alerts.slice(0, 4);

  return (
    <AppShell maxWidth="6xl" className="space-y-6">
      <DashboardPortalHero
        workspaceName={data.tenant.name || data.tenant.slug || 'Воркспейс'}
        crmReady={data.tenant.crmReady}
        crmLocked={Boolean(data.tenant.crmAccessLocked)}
        crmOpening={crmOpening}
        onOpenCrm={() => void openCrm()}
      />

      {role === 'superadmin' && (
        <div className="flex justify-end">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin">Админка</Link>
          </Button>
        </div>
      )}

      {crmError && (
        <Alert variant="error">
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

      {topAlerts.length > 0 && (
        <section className={`${LAND_SECTION} overflow-hidden`}>
          <div className="border-b border-black/8 px-5 py-4">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-black/40">
              01 · Сейчас важно
            </p>
          </div>
          <ul className="divide-y divide-black/8">
            {topAlerts.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        a.tone === 'warn'
                          ? 'bg-[#c45c26]'
                          : a.tone === 'ok'
                            ? 'bg-[#2f6b3a]'
                            : 'bg-[#f5a623]'
                      }`}
                    />
                    <p className="text-sm font-semibold text-black">{a.title}</p>
                  </div>
                  <p className="mt-1 text-sm text-black/55">{a.body}</p>
                </div>
                <Link
                  href={a.href}
                  className="land-btn-ghost inline-flex min-h-10 shrink-0 items-center justify-center px-4 text-sm"
                >
                  {a.cta}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <p className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-black/40">
          02 · Пульс
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Лиды"
            value={String(data.traffic.opportunitiesApprox)}
            hint={`gift · ${data.traffic.giftSubscribers}`}
          />
          <Kpi
            label="Открытые диалоги"
            value={String(data.traffic.conversationsOpen)}
            hint={`всего ${data.traffic.conversationsTotal}`}
          />
          <Kpi
            label="Сообщения · 7 дн."
            value={String(data.traffic.messages7d)}
            hint={`входящих ${data.traffic.inbound7d}`}
          />
          <Kpi
            label="Баланс AI"
            value={`${formatRub(data.money.aiWalletRub)} ₽`}
            hint={`расход 30 дн. · ${formatRub(data.money.aiSpent30dRub)} ₽`}
          />
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-black/40">
            03 · Разделы
          </p>
          <Link
            href="/dashboard/ai/agents#balance"
            className="text-xs font-semibold text-black/55 underline-offset-2 hover:text-black hover:underline"
          >
            Пополнить AI
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ProductTile
            href="/dashboard/crm"
            title="CRM"
            icon={Building2}
            active={p.crm.isActive}
            detail={
              data.subscription
                ? `${data.subscription.seatsIncluded + data.subscription.extraSeats} мест${
                    p.crm.activeUntil
                      ? ` · до ${new Date(p.crm.activeUntil).toLocaleDateString('ru-RU')}`
                      : ''
                  }`
                : 'База и воронка'
            }
          />
          <ProductTile
            href="/dashboard/ai"
            title="AI и каналы"
            icon={BrainCircuit}
            active={
              p.aiBusiness.isActive ||
              p.gramjs.isActive ||
              p.whatsapp.isActive ||
              Boolean(p.max?.isActive) ||
              data.accounts.agents > 0
            }
            trial={p.aiBusiness.isTrial || p.gramjs.isTrial || p.whatsapp.isTrial}
            detail={`${data.accounts.agents} агент. · TG ${data.accounts.gramjs} · WA ${data.accounts.whatsapp}${
              data.accounts.max ? ` · MAX ${data.accounts.max}` : ''
            } · Biz ${p.aiBusiness.activeAccounts}/${bizCap}`}
          />
          <ProductTile
            href="/dashboard/bots"
            title="Gift-боты"
            icon={Gift}
            active={giftOn}
            trial={p.gift.isTrial || p.giftMax?.isTrial}
            detail={`${giftBots} бот. · ${data.traffic.giftSubscribers} подп.`}
          />
          <ProductTile
            href="/dashboard/mailing"
            title="Рассылки"
            icon={Send}
            active={mailingOn}
            trial={
              p.mailingBot?.isTrial ||
              p.mailingAccounts?.isTrial ||
              p.mailingStories?.isTrial
            }
            detail="Бот · аккаунты · сторис"
          />
          <ProductTile
            href="/dashboard/ai/agents"
            title="AI-агенты"
            icon={Sparkles}
            active={data.accounts.agents > 0}
            detail={`${data.accounts.agents} активных · баланс ${formatRub(data.money.aiWalletRub)} ₽`}
          />
          <ProductTile
            href="/dashboard/partners"
            title="Партнёрка"
            icon={Wallet}
            active={Boolean(data.money.referralCode)}
            detail={`баланс ${Math.round(data.money.referralBalanceRub).toLocaleString('ru-RU')} ₽`}
          />
        </div>
      </section>

      <section className={`${LAND_SECTION} px-5 py-5`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-black/40">
              04 · Партнёрский баланс
            </p>
            <p className="land-display mt-2 text-2xl tracking-[-0.03em] text-black">
              {Math.round(data.money.referralBalanceRub).toLocaleString('ru-RU')} ₽
            </p>
            <p className="mt-1 text-sm text-black/50">
              Заработано всего{' '}
              {Math.round(data.money.referralEarnedRub).toLocaleString('ru-RU')} ₽
              {data.money.referralCode ? ` · код ${data.money.referralCode}` : ''}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {refLink ? <CopyButton value={refLink} label="Скопировать ссылку" /> : null}
            <Link
              href="/dashboard/partners"
              className="land-btn inline-flex min-h-10 items-center px-4 text-sm"
            >
              Открыть партнёрку
            </Link>
          </div>
        </div>
      </section>

      <section className={`${LAND_SECTION} overflow-hidden`}>
        <button
          type="button"
          onClick={() => setGiftOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-[#fffaf0]"
        >
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-black/40">
              05 · Воронка Gift
            </p>
            <p className="mt-1 text-sm text-black/55">
              {data.traffic.giftSubscribers > 0
                ? `${data.traffic.giftSubscribers} подписчиков · ${phaseEntries.length} фаз`
                : 'Пока нет подписчиков'}
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-black/40 transition-transform ${giftOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {giftOpen && (
          <div className="border-t border-black/8 px-5 py-4">
            {phaseEntries.length === 0 ? (
              <p className="text-sm text-black/50">Подписчики появятся после запуска gift-бота.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {phaseEntries.map(([phase, count]) => (
                  <Kpi key={phase} label={phaseLabel(phase)} value={String(count)} />
                ))}
              </div>
            )}
            <Link
              href="/dashboard/bots"
              className="land-btn-ghost mt-4 inline-flex min-h-10 items-center gap-2 px-4 text-sm"
            >
              <Bot className="h-4 w-4" />
              Открыть gift-ботов
            </Link>
          </div>
        )}
      </section>

      <section className={`${LAND_SECTION} px-5 py-4`}>
        <div className="flex flex-wrap items-center gap-2">
          <MessageSquareText className="h-4 w-4 text-black/40" />
          <p className="text-sm text-black/55">
            Нужна помощь —{' '}
            <a
              href="https://t.me/GetVoxlybot"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-black underline underline-offset-2"
            >
              @GetVoxlybot
            </a>
          </p>
        </div>
      </section>
    </AppShell>
  );
}
