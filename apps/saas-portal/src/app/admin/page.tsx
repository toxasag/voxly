'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { PageHeader } from '@/components/portal/page-header';
import { cn } from '@/lib/utils';

interface AdminStats {
  tenants: {
    total: number;
    active: number;
    suspended: number;
  };
  totalRevenue: string;
  mrrByProduct: Record<string, number>;
  ai: {
    totalProviderCost: string;
    totalCharged: string;
    margin: string;
    currentMarkup: string;
  };
}

interface AdminTenant {
  id: string;
  slug: string;
  status: string;
  createdAt: string;
  twentyWorkspaceId: string | null;
  owner: { email: string; name: string } | null;
  activeSubscription: { productCode: string; endsAt: string } | null;
  aiBalanceRub: number;
}

interface FunnelRates {
  promoToStart: number | null;
  startToSubscribed: number | null;
  startToGift: number | null;
  subscribedToGift: number | null;
}

interface FunnelCampaign {
  tenantId: string;
  tenantSlug: string;
  tenantStatus: string;
  botId: string;
  botUsername: string | null;
  botStatus: string;
  campaignId: string;
  channelUsername: string | null;
  isActive: boolean;
  metrics: {
    promoClicks: number;
    starts: number;
    subscriptionRequested: number;
    subscribed: number;
    gifted: number;
    rates: FunnelRates;
  };
}

interface FunnelResponse {
  campaigns: FunnelCampaign[];
  totals: {
    promoClicks: number;
    starts: number;
    subscriptionRequested: number;
    subscribed: number;
    gifted: number;
    rates: FunnelRates;
  };
}

function formatPct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${value}%`;
}

function StatCard({ label, value }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 shadow-[var(--shadow-subtle)]">
      <p className="text-[12px] font-medium uppercase tracking-[0.05em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-[30px] font-semibold tracking-[-0.025em] text-foreground">{value}</p>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [funnels, setFunnels] = useState<FunnelResponse | null>(null);
  const [health, setHealth] = useState<{
    overall: string;
    checkedAt: string;
    summary: { ok: number; warn: number; fail: number };
    checks: { id: string; name: string; status: string; detail: string; latencyMs?: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [aiCreditDraft, setAiCreditDraft] = useState<Record<string, string>>({});
  const [aiCreditBusy, setAiCreditBusy] = useState<string | null>(null);
  const [aiCreditMsg, setAiCreditMsg] = useState('');
  const [purgeBusy, setPurgeBusy] = useState<string | null>(null);

  const purgeTenant = async (tenantId: string, slug: string) => {
    const token = localStorage.getItem('voxly_token');
    if (!token) return;
    const typed = window.prompt(
      `Удалить аккаунт «${slug}» ПОЛНОСТЬЮ (ЛК, CRM, боты, чаты)?\n\nВведите slug для подтверждения:`,
      '',
    );
    if (typed == null) return;
    if (typed.trim() !== slug) {
      setAiCreditMsg('Удаление отменено: slug не совпал');
      return;
    }
    if (!window.confirm(`Точно удалить ${slug}? Это необратимо.`)) return;
    setPurgeBusy(tenantId);
    setAiCreditMsg('');
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirmSlug: slug }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Не удалось удалить');
      setTenants((prev) => prev.filter((t) => t.id !== tenantId));
      setAiCreditMsg(`Удалён аккаунт ${slug}`);
    } catch (e) {
      setAiCreditMsg(e instanceof Error ? e.message : 'Ошибка удаления');
    } finally {
      setPurgeBusy(null);
    }
  };

  const creditAiWallet = async (tenantId: string, slug: string) => {
    const token = localStorage.getItem('voxly_token');
    if (!token) return;
    const amountRub = Number(aiCreditDraft[tenantId] || '100');
    if (!Number.isFinite(amountRub) || amountRub <= 0) {
      setAiCreditMsg('Укажите сумму > 0');
      return;
    }
    setAiCreditBusy(tenantId);
    setAiCreditMsg('');
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/ai-credit`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amountRub,
          note: `manual admin top-up for ${slug}`,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось начислить');
      }
      setTenants((prev) =>
        prev.map((t) =>
          t.id === tenantId ? { ...t, aiBalanceRub: Number(data.balanceRub) } : t,
        ),
      );
      setAiCreditDraft((prev) => ({ ...prev, [tenantId]: '' }));
      setAiCreditMsg(`Начислено ${amountRub} ₽ → ${slug}, баланс ${data.balanceRub} ₽`);
    } catch (e) {
      setAiCreditMsg(e instanceof Error ? e.message : 'Ошибка начисления');
    } finally {
      setAiCreditBusy(null);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }

    const getJson = async (url: string) => {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(response.status === 403 ? 'Нужна роль superadmin' : 'Ошибка загрузки');
      }
      return response.json();
    };

    Promise.all([
      getJson('/api/admin/stats'),
      getJson('/api/admin/tenants'),
      getJson('/api/admin/funnels'),
      getJson('/api/admin/health'),
    ])
      .then(([s, t, f, h]) => {
        setStats(s);
        setTenants(t.tenants || []);
        setFunnels(f);
        setHealth(h);
      })
      .catch((requestError) =>
        setError(requestError instanceof Error ? requestError.message : 'Ошибка загрузки'),
      )
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState />
      </AppShell>
    );
  }

  if (error || !stats) {
    return (
      <AppShell maxWidth="6xl">
        <PageHeader title="Супер-админка" backHref="/dashboard" backLabel="Кабинет" />
        <Alert variant="error">{error || 'Доступ запрещён'}</Alert>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/dashboard">В кабинет</Link>
        </Button>
      </AppShell>
    );
  }

  const mrr = Object.values(stats.mrrByProduct).reduce((sum, value) => sum + value, 0);
  const totals = funnels?.totals;

  return (
    <AppShell maxWidth="6xl" className="space-y-8">
      <PageHeader
        title="Супер-админка"
        description="Клиенты, MRR, здоровье системы и gift-воронки"
        backHref="/dashboard"
        backLabel="Кабинет"
      />

      {health && (
        <Card id="health" className="scroll-mt-24">
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>Работоспособность системы</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Проверено {new Date(health.checkedAt).toLocaleString('ru-RU')} · ok{' '}
                {health.summary.ok} · warn {health.summary.warn} · fail {health.summary.fail}
              </p>
            </div>
            <Badge
              variant={
                health.overall === 'fail'
                  ? 'warning'
                  : health.overall === 'warn'
                    ? 'secondary'
                    : 'success'
              }
            >
              {health.overall === 'fail'
                ? 'Есть сбои'
                : health.overall === 'warn'
                  ? 'Есть предупреждения'
                  : 'Всё стабильно'}
            </Badge>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {health.checks.map((c) => (
              <div
                key={c.id}
                className={cn(
                  'rounded-md border px-3 py-2 text-sm',
                  c.status === 'fail' && 'border-destructive/40 bg-card',
                  c.status === 'warn' && 'border-border bg-muted',
                  c.status === 'ok' && 'border-border bg-card',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {c.status}
                    {c.latencyMs != null ? ` · ${c.latencyMs}ms` : ''}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{c.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div
        id="overview"
        className="stagger grid scroll-mt-24 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        <StatCard label="Клиентов" value={String(stats.tenants.total)} />
        <StatCard label="Активных" value={String(stats.tenants.active)} accent="sage" />
        <StatCard label="Приостановлено" value={String(stats.tenants.suspended)} accent="peach" />
        <StatCard label="MRR" value={`${mrr} ₽`} accent="blue" />
        <StatCard label="Выручка" value={`${stats.totalRevenue} ₽`} />
        <StatCard label="AI маржа" value={`${stats.ai.margin} ₽`} accent="sage" />
      </div>

      <Card id="clients" className="scroll-mt-24">
        <CardHeader>
          <CardTitle>Клиенты</CardTitle>
          {aiCreditMsg ? (
            <p className="mt-1 text-sm text-muted-foreground">{aiCreditMsg}</p>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              AI-баланс — сумма и «+». «Удалить» — полный wipe ЛК+CRM (необратимо).
            </p>
          )}
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[780px] text-sm">
            <thead>
              <tr className="border-y border-border bg-secondary/40 text-left text-muted-foreground">
                <th className="px-5 py-3 font-medium">Клиент</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Подписка</th>
                <th className="px-5 py-3 font-medium">CRM</th>
                <th className="px-5 py-3 font-medium">AI баланс</th>
                <th className="px-5 py-3 font-medium">Начислить AI</th>
                <th className="px-5 py-3 font-medium">Создан</th>
                <th className="px-5 py-3 font-medium">Удалить</th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0 hover:bg-secondary/30">
                  <td className="px-5 py-3">
                    <div className="font-medium">{t.slug}</div>
                    <div className="text-xs text-muted-foreground">{t.owner?.email || '—'}</div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge variant={t.status === 'active' ? 'success' : 'warning'}>{t.status}</Badge>
                  </td>
                  <td className="px-5 py-3">{t.activeSubscription?.productCode || '—'}</td>
                  <td className="px-5 py-3">
                    {t.twentyWorkspaceId ? (
                      <Badge variant="success">Создан</Badge>
                    ) : (
                      <Badge variant="secondary">Ожидает</Badge>
                    )}
                  </td>
                  <td className="px-5 py-3 font-medium tabular-nums">
                    {Number(t.aiBalanceRub || 0).toFixed(2)} ₽
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        placeholder="100"
                        className="h-8 w-24"
                        value={aiCreditDraft[t.id] ?? ''}
                        onChange={(e) =>
                          setAiCreditDraft((prev) => ({ ...prev, [t.id]: e.target.value }))
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={aiCreditBusy === t.id}
                        onClick={() => void creditAiWallet(t.id, t.slug)}
                      >
                        {aiCreditBusy === t.id ? '…' : '+'}
                      </Button>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-5 py-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-destructive/40 text-destructive hover:bg-destructive/10"
                      disabled={purgeBusy === t.id}
                      onClick={() => void purgeTenant(t.id, t.slug)}
                    >
                      {purgeBusy === t.id ? '…' : 'Удалить'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div id="funnels" className="scroll-mt-24">
        <h2 className="text-lg font-semibold tracking-tight">Воронки gift-ботов</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Результативность по всем клиентам. Старты / подписки / подарки — из подписчиков; клики —
          из поста и событий.
        </p>
      </div>

      {totals && (
        <div className="stagger grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Клики" value={String(totals.promoClicks)} />
          <StatCard label="Старты" value={String(totals.starts)} accent="blue" />
          <StatCard label="Подписались" value={String(totals.subscribed)} accent="sage" />
          <StatCard label="Подарки" value={String(totals.gifted)} accent="peach" />
          <StatCard label="Старт → подп." value={formatPct(totals.rates.startToSubscribed)} />
          <StatCard label="Старт → подарок" value={formatPct(totals.rates.startToGift)} />
        </div>
      )}

      <Card>
        <CardContent className="overflow-x-auto p-0 pt-0">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-y border-border bg-secondary/40 text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Клиент</th>
                <th className="px-4 py-3 font-medium">Бот / канал</th>
                <th className="px-4 py-3 font-medium">Клики</th>
                <th className="px-4 py-3 font-medium">Старты</th>
                <th className="px-4 py-3 font-medium">Проверки</th>
                <th className="px-4 py-3 font-medium">Подписки</th>
                <th className="px-4 py-3 font-medium">Подарки</th>
                <th className="px-4 py-3 font-medium">Пост → старт</th>
                <th className="px-4 py-3 font-medium">Старт → подп.</th>
                <th className="px-4 py-3 font-medium">Старт → подарок</th>
              </tr>
            </thead>
            <tbody>
              {(funnels?.campaigns || []).length === 0 ? (
                <tr>
                  <td className="px-4 py-8 text-center text-muted-foreground" colSpan={10}>
                    Пока нет gift-кампаний
                  </td>
                </tr>
              ) : (
                funnels!.campaigns.map((row) => (
                  <tr
                    key={row.campaignId}
                    className="border-b border-border last:border-0 hover:bg-secondary/30"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{row.tenantSlug}</div>
                      <div className="text-xs text-muted-foreground">{row.tenantStatus}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{row.botUsername ? `@${row.botUsername}` : '—'}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.channelUsername ? `@${row.channelUsername}` : 'канал не задан'}
                        {row.isActive ? '' : ' · выкл.'}
                      </div>
                    </td>
                    <td className="px-4 py-3">{row.metrics.promoClicks}</td>
                    <td className="px-4 py-3">{row.metrics.starts}</td>
                    <td className="px-4 py-3">{row.metrics.subscriptionRequested}</td>
                    <td className="px-4 py-3">{row.metrics.subscribed}</td>
                    <td className="px-4 py-3">{row.metrics.gifted}</td>
                    <td className="px-4 py-3">{formatPct(row.metrics.rates.promoToStart)}</td>
                    <td className="px-4 py-3">{formatPct(row.metrics.rates.startToSubscribed)}</td>
                    <td className="px-4 py-3">{formatPct(row.metrics.rates.startToGift)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </AppShell>
  );
}
