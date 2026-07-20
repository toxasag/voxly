'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg border border-border/80 px-4 py-3',
        accent === 'sage' && 'bg-[#f3f7f2]',
        accent === 'blue' && 'bg-[#f0f4fb]',
        accent === 'peach' && 'bg-[#fbf3ee]',
        !accent && 'bg-secondary/50',
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight">{value}</p>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [funnels, setFunnels] = useState<FunnelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
    ])
      .then(([s, t, f]) => {
        setStats(s);
        setTenants(t.tenants || []);
        setFunnels(f);
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
        description="Клиенты, MRR и эффективность gift-воронок"
        backHref="/dashboard"
        backLabel="Кабинет"
      />

      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Клиентов" value={String(stats.tenants.total)} />
        <StatCard label="Активных" value={String(stats.tenants.active)} accent="sage" />
        <StatCard label="Приостановлено" value={String(stats.tenants.suspended)} accent="peach" />
        <StatCard label="MRR" value={`${mrr} ₽`} accent="blue" />
        <StatCard label="Выручка" value={`${stats.totalRevenue} ₽`} />
        <StatCard label="AI маржа" value={`${stats.ai.margin} ₽`} accent="sage" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Клиенты</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-border bg-secondary/40 text-left text-muted-foreground">
                <th className="px-5 py-3 font-medium">Клиент</th>
                <th className="px-5 py-3 font-medium">Статус</th>
                <th className="px-5 py-3 font-medium">Подписка</th>
                <th className="px-5 py-3 font-medium">CRM</th>
                <th className="px-5 py-3 font-medium">Создан</th>
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
                  <td className="px-5 py-3 text-muted-foreground">
                    {new Date(t.createdAt).toLocaleString('ru-RU')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div>
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
