'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { PageHeader } from '@/components/portal/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type CampaignRow = {
  id: string;
  name: string;
  code: string;
  link: string;
  isActive: boolean;
  clicksCount: number;
  registrations: number;
  paid: number;
  pending: number;
  earnedRub: number;
  expensesRub: number;
  netRub: number;
};

type DashboardPayload = {
  period: { from: string; to: string };
  mainCode: CampaignRow & { code: string; link: string };
  balanceRub: number;
  totalEarnedAllTime: number;
  summary: {
    clicksNote: string;
    clicksTotal: number;
    registrations: number;
    paid: number;
    pending: number;
    earnedRub: number;
    expensesRub: number;
    netRub: number;
  };
  campaigns: CampaignRow[];
  referrals: Array<{
    id: string;
    referredSlug: string;
    campaignName: string;
    attributedAt: string;
    firstPaymentAt: string | null;
    earnedRub: number;
  }>;
};

function formatRub(n: number): string {
  return n.toLocaleString('ru-RU');
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export default function PartnersPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return toDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [projectName, setProjectName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [expenseCampaignId, setExpenseCampaignId] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [expenseBusy, setExpenseBusy] = useState(false);

  const load = useCallback(async (fromDate = from, toDate = to) => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const qs = new URLSearchParams({ from: fromDate, to: toDate });
      const res = await fetch(`/api/referrals/dashboard?${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Не удалось загрузить партнёрскую программу');
      setData((await res.json()) as DashboardPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [from, to, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const createCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    setCreateBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/referrals/campaigns', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: projectName.trim(),
          code: customCode.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось создать ссылку');
      setProjectName('');
      setCustomCode('');
      setNotice(`Ссылка «${json.name}» создана: ${json.code}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setCreateBusy(false);
    }
  };

  const addExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseCampaignId || !expenseAmount) return;
    setExpenseBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/referrals/campaigns/${expenseCampaignId}/expenses`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          amountRub: Number(expenseAmount),
          note: expenseNote.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось добавить расход');
      setExpenseAmount('');
      setExpenseNote('');
      setNotice(`Расход ${formatRub(Number(expenseAmount))} ₽ учтён`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setExpenseBusy(false);
    }
  };

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState />
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">{error || 'Нет данных'}</Alert>
      </AppShell>
    );
  }

  return (
    <AppShell maxWidth="6xl">
      <PageHeader
        title="Партнёрская программа"
        description="Реферальные ссылки и коды по проектам · статистика переходов, регистраций и оплат"
        backHref="/dashboard"
        backLabel="Кабинет"
      />

      {error ? <Alert variant="error" className="mb-4">{error}</Alert> : null}
      {notice ? <Alert variant="success" className="mb-4">{notice}</Alert> : null}

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs">
          <span className="text-muted-foreground">С</span>
          <Input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="ml-1 mt-1 w-auto"
          />
        </label>
        <label className="text-xs">
          <span className="text-muted-foreground">По</span>
          <Input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="ml-1 mt-1 w-auto"
          />
        </label>
        <Button type="button" size="sm" variant="outline" onClick={() => void load(from, to)}>
          Показать
        </Button>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Заработано за период"
          value={`${formatRub(data.summary.earnedRub)} ₽`}
          hint={`Чистыми ${formatRub(data.summary.netRub)} ₽ после расходов`}
        />
        <Stat
          label="Ждём оплат"
          value={String(data.summary.pending)}
          hint="Зарегистрировались, ещё не оплатили CRM"
        />
        <Stat
          label="Регистрации · оплаты"
          value={`${data.summary.registrations} · ${data.summary.paid}`}
          hint={data.summary.clicksNote}
        />
        <Stat
          label="Баланс · всего"
          value={`${formatRub(data.balanceRub)} ₽`}
          hint={`Заработано за всё время ${formatRub(Math.round(data.totalEarnedAllTime))} ₽`}
        />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Основная ссылка</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-muted px-2 py-1 text-sm">{data.mainCode.code}</code>
            <CopyButton value={data.mainCode.link} label="Ссылка" />
            <Badge variant="secondary">{data.mainCode.clicksCount} переходов</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            За период: {data.mainCode.registrations} рег. · {data.mainCode.paid} оплат ·{' '}
            {data.mainCode.pending} ждут · {formatRub(data.mainCode.earnedRub)} ₽
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Новая ссылка / проект</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void createCampaign(e)} className="grid gap-3 sm:grid-cols-3">
            <Input
              placeholder="Название проекта (канал @…)"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
            />
            <Input
              placeholder="Свой код (необяз.)"
              value={customCode}
              onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
            />
            <Button type="submit" disabled={createBusy} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {createBusy ? 'Создаём…' : 'Создать'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Расход по проекту</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void addExpense(e)} className="grid gap-3 sm:grid-cols-4">
            <select
              value={expenseCampaignId}
              onChange={(e) => setExpenseCampaignId(e.target.value)}
              className="min-h-10 rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              <option value="">Проект…</option>
              {data.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <Input
              type="number"
              min={1}
              placeholder="Сумма ₽"
              value={expenseAmount}
              onChange={(e) => setExpenseAmount(e.target.value)}
              required
            />
            <Input
              placeholder="Комментарий (пост в канале…)"
              value={expenseNote}
              onChange={(e) => setExpenseNote(e.target.value)}
            />
            <Button type="submit" disabled={expenseBusy || data.campaigns.length === 0}>
              {expenseBusy ? '…' : 'Добавить расход'}
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Расход уменьшает «заработано» в статистике проекта (например, 5000 ₽ за пост).
          </p>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Проекты и ссылки</CardTitle>
        </CardHeader>
        <CardContent>
          {data.campaigns.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока только основная ссылка. Создайте проект для отдельного канала.
            </p>
          ) : (
            <div className="divide-y divide-border rounded-lg border border-border">
              {data.campaigns.map((c) => (
                <div key={c.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <code className="rounded bg-muted px-1.5 py-0.5">{c.code}</code>
                      <CopyButton value={c.link} size="icon" label="URL" />
                      <span>{c.clicksCount} переходов</span>
                    </div>
                  </div>
                  <div className="text-right text-xs sm:text-sm">
                    <p>
                      {c.registrations} рег. · {c.paid} оплат · {c.pending} ждут
                    </p>
                    <p className="text-muted-foreground">
                      +{formatRub(c.earnedRub)} ₽ · −{formatRub(c.expensesRub)} ₽ ={' '}
                      <span className="font-medium text-foreground">{formatRub(c.netRub)} ₽</span>
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {data.referrals.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Регистрации за период</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border rounded-lg border border-border">
              {data.referrals.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
                >
                  <span>
                    {r.referredSlug}{' '}
                    <span className="text-muted-foreground">· {r.campaignName}</span>
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(r.attributedAt).toLocaleDateString('ru-RU')}
                    {r.firstPaymentAt
                      ? ` · оплата ${new Date(r.firstPaymentAt).toLocaleDateString('ru-RU')}`
                      : ' · ждём оплату'}
                    {r.earnedRub > 0 ? ` · +${formatRub(r.earnedRub)} ₽` : ''}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </AppShell>
  );
}
