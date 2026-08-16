'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Wallet } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { Badge } from '@/components/ui/badge';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

type Overview = {
  markup: {
    globalPercent: number;
    defaultPercent: number;
    tenantsWithOverride: number;
    note: string;
  };
  period: { from: string; to: string };
  stats: {
    usageEvents: number;
    providerCostRub: number;
    chargedRub: number;
    marginRub: number;
    uncollectedRub: number;
    topupPaidRub: number;
    topupPayments: number;
    walletsTotalRub: number;
    walletsCount: number;
    byChannel: {
      channel: string;
      events: number;
      providerCostRub: number;
      chargedRub: number;
      marginRub: number;
    }[];
  };
};

type TenantRow = {
  tenantId: string;
  slug: string;
  status: string;
  ownerEmail: string | null;
  balanceRub: number;
  markupOverridePercent: number | null;
  effectiveMarkupPercent: number;
  custom: boolean;
  usage: {
    events: number;
    providerCostRub: number;
    chargedRub: number;
    uncollectedRub: number;
    marginRub: number;
  };
};

const TH = 'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';
const TD = 'px-3 py-3 text-sm';

const CHANNEL_LABELS: Record<string, string> = {
  ai_tg: 'Telegram Секретарь',
  ai_gramjs: 'Telegram (личный)',
  ai_wa: 'WhatsApp',
  gift_bot: 'Подарки Telegram',
  gift_bot_max: 'Подарки MAX',
  system: 'Система',
  unknown: 'Без канала',
};

function formatRub(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function periodQuery(from: string, to: string): string {
  const f = new Date(`${from}T00:00:00.000Z`);
  const t = new Date(`${to}T23:59:59.999Z`);
  return `from=${encodeURIComponent(f.toISOString())}&to=${encodeURIComponent(t.toISOString())}`;
}

export default function AdminAiBalancePage() {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const defaultFrom = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [from, setFrom] = useState(toDateInputValue(defaultFrom));
  const [to, setTo] = useState(toDateInputValue(today));
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [globalDraft, setGlobalDraft] = useState('');
  const [search, setSearch] = useState('');
  const [tenantDraft, setTenantDraft] = useState<Record<string, string>>({});
  const [creditDraft, setCreditDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const qs = periodQuery(from, to);
      const searchQs = search ? `&search=${encodeURIComponent(search)}` : '';
      const [oRes, tRes] = await Promise.all([
        fetch(`${API}/api/admin/ai-balance?${qs}`, { headers: authHeaders() }),
        fetch(`${API}/api/admin/ai-balance/tenants?${qs}${searchQs}`, {
          headers: authHeaders(),
        }),
      ]);
      if (oRes.status === 403 || tRes.status === 403) {
        setError('Нужна роль superadmin');
        return;
      }
      const oJson = await oRes.json().catch(() => ({}));
      const tJson = await tRes.json().catch(() => ({}));
      if (!oRes.ok) throw new Error(oJson.error || 'Не удалось загрузить сводку');
      if (!tRes.ok) throw new Error(tJson.error || 'Не удалось загрузить клиентов');
      setOverview(oJson as Overview);
      setGlobalDraft(String(oJson.markup?.globalPercent ?? 50));
      setTenants(tJson.tenants || []);
      const drafts: Record<string, string> = {};
      for (const t of tJson.tenants || []) {
        drafts[t.tenantId] = t.custom ? String(t.markupOverridePercent) : '';
      }
      setTenantDraft(drafts);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [from, to, search]);

  useEffect(() => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    void load();
  }, [load, router]);

  const saveGlobal = async () => {
    setBusy('global');
    setError('');
    setNotice('');
    try {
      const percent = Math.round(Number(globalDraft));
      if (!Number.isFinite(percent) || percent < 0 || percent > 500) {
        throw new Error('Наценка: целое число 0…500 %');
      }
      const res = await fetch(`${API}/api/admin/ai-balance/markup`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ percent }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось сохранить');
      setNotice(`Глобальная наценка: ${percent}%. Действует на следующие списания.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy('');
    }
  };

  const saveTenant = async (tenantId: string) => {
    setBusy(`t-${tenantId}`);
    setError('');
    setNotice('');
    try {
      const raw = (tenantDraft[tenantId] || '').trim();
      let percent: number | null = null;
      if (raw !== '') {
        percent = Math.round(Number(raw));
        if (!Number.isFinite(percent) || percent < 0 || percent > 500) {
          throw new Error('Индивидуальная наценка: пусто = сброс, иначе 0…500 %');
        }
      }
      const res = await fetch(`${API}/api/admin/ai-balance/tenants/${tenantId}/markup`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ percent }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось сохранить');
      setNotice(
        percent == null
          ? 'Индивидуальная наценка сброшена (действует глобальная).'
          : `Индивидуальная наценка: ${percent}%.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy('');
    }
  };

  const creditTenant = async (tenantId: string) => {
    setBusy(`c-${tenantId}`);
    setError('');
    setNotice('');
    try {
      const raw = (creditDraft[tenantId] || '').trim();
      if (!raw) {
        throw new Error('Укажите сумму для пополнения');
      }
      const amountRub = Number(raw);
      if (!Number.isFinite(amountRub) || amountRub <= 0) {
        throw new Error('Сумма должна быть положительным числом');
      }
      const res = await fetch(`${API}/api/admin/tenants/${tenantId}/ai-credit`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountRub }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось пополнить баланс');
      setNotice(`Баланс пополнен на ${formatRub(amountRub)} ₽`);
      setCreditDraft((d) => ({ ...d, [tenantId]: '' }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка пополнения');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <AppShell>
        <LoadingState label="Загружаем AI-баланс…" />
      </AppShell>
    );
  }

  const stats = overview?.stats;

  return (
    <AppShell maxWidth="6xl" className="space-y-8">
      <header className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50/40 px-5 py-6 sm:px-8">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-800/70">
          Админ · AI баланс
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-black sm:text-3xl">
          <Wallet className="h-7 w-7 text-amber-800/70" aria-hidden />
          Наценка и статистика AI
        </h1>
        <p className="mt-2 max-w-[70ch] text-sm text-black/60">
          {overview?.markup.note ||
            'Наценка при списании с кошелька. Пополнение зачисляется 1:1.'}
        </p>
      </header>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
          01 · Глобальная наценка
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">
          Markup по умолчанию
        </h2>
        <p className="mt-1 text-sm text-black/55">
          Сейчас {overview?.markup.globalPercent ?? '—'}% · дефолт seed{' '}
          {overview?.markup.defaultPercent ?? 50}% · индивидуальных:{' '}
          {overview?.markup.tenantsWithOverride ?? 0}
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-black/55">Наценка, %</span>
            <input
              type="number"
              min={0}
              max={500}
              step={1}
              className="w-28 rounded-md border border-black/15 px-2 py-1.5 text-sm tabular-nums"
              value={globalDraft}
              onChange={(e) => setGlobalDraft(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy === 'global'}
            onClick={() => void saveGlobal()}
            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === 'global' ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
              02 · Статистика
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Расход и маржа</h2>
            <p className="mt-1 text-sm text-black/55">
              Маржа = chargedRub − providerCostRub (доля наценки в списаниях). Пополнения —
              оплаченные `ai_topup` за период (не маржа).
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-sm">
              <span className="mb-1 block text-black/55">С</span>
              <input
                type="date"
                className="rounded-md border border-black/15 px-2 py-1.5 text-sm"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-black/55">По</span>
              <input
                type="date"
                className="rounded-md border border-black/15 px-2 py-1.5 text-sm"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-medium hover:bg-black/[0.03]"
            >
              Обновить
            </button>
          </div>
        </div>

        {stats ? (
          <>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile label="Списано с кошельков" value={`${formatRub(stats.chargedRub)} ₽`} />
              <StatTile label="Себестоимость" value={`${formatRub(stats.providerCostRub)} ₽`} />
              <StatTile
                label="Маржа платформы"
                value={`${formatRub(stats.marginRub)} ₽`}
                accent
              />
              <StatTile
                label="Пополнения (оплачено)"
                value={`${formatRub(stats.topupPaidRub)} ₽`}
                hint={`${stats.topupPayments} платежей`}
              />
              <StatTile
                label="События usage"
                value={String(stats.usageEvents)}
              />
              <StatTile
                label="Недобрано с кошелька"
                value={`${formatRub(stats.uncollectedRub)} ₽`}
                hint="когда баланс = 0"
              />
              <StatTile
                label="Остатки на кошельках"
                value={`${formatRub(stats.walletsTotalRub)} ₽`}
                hint={`${stats.walletsCount} кошельков · сейчас`}
              />
            </div>

            {stats.byChannel.length > 0 ? (
              <div className="mt-6 overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-black/10">
                      <th className={TH}>Канал</th>
                      <th className={TH}>События</th>
                      <th className={TH}>Себест.</th>
                      <th className={TH}>Списано</th>
                      <th className={TH}>Маржа</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byChannel.map((row) => (
                      <tr key={row.channel} className="border-b border-black/5">
                        <td className={TD}>
                          {CHANNEL_LABELS[row.channel] || row.channel}
                        </td>
                        <td className={`${TD} tabular-nums`}>{row.events}</td>
                        <td className={`${TD} tabular-nums`}>
                          {formatRub(row.providerCostRub)} ₽
                        </td>
                        <td className={`${TD} tabular-nums`}>
                          {formatRub(row.chargedRub)} ₽
                        </td>
                        <td className={`${TD} tabular-nums font-medium`}>
                          {formatRub(row.marginRub)} ₽
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-4 text-sm text-black/50">Нет списаний за выбранный период.</p>
            )}
          </>
        ) : null}
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
              03 · Клиенты
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">
              Индивидуальная наценка
            </h2>
            <p className="mt-1 text-sm text-black/55">
              Пустое поле = глобальная наценка. Usage за выбранный период.
            </p>
          </div>
          <label className="relative block w-full max-w-xs text-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35" />
            <input
              type="search"
              placeholder="slug или email"
              className="w-full rounded-md border border-black/15 py-2 pl-8 pr-3 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-left">
            <thead>
              <tr className="border-b border-black/10">
                <th className={TH}>Клиент</th>
                <th className={TH}>Баланс</th>
                <th className={TH}>Пополнить</th>
                <th className={TH}>Наценка %</th>
                <th className={TH}>Эффект.</th>
                <th className={TH}>Списано</th>
                <th className={TH}>Маржа</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.tenantId} className="border-b border-black/5 align-middle">
                  <td className={TD}>
                    <div className="font-medium">{t.slug}</div>
                    <div className="text-xs text-black/45">{t.ownerEmail || '—'}</div>
                    <Badge
                      variant={t.status === 'active' ? 'success' : 'secondary'}
                      className="mt-1"
                    >
                      {t.status}
                    </Badge>
                  </td>
                  <td className={`${TD} tabular-nums`}>{formatRub(t.balanceRub)} ₽</td>
                  <td className={TD}>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        step={100}
                        placeholder="сумма"
                        className="w-24 rounded-md border border-black/15 px-2 py-1.5 text-sm tabular-nums"
                        value={creditDraft[t.tenantId] ?? ''}
                        onChange={(e) =>
                          setCreditDraft((d) => ({ ...d, [t.tenantId]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        disabled={busy === `c-${t.tenantId}`}
                        onClick={() => void creditTenant(t.tenantId)}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 hover:bg-emerald-700"
                      >
                        {busy === `c-${t.tenantId}` ? '…' : '+'}
                      </button>
                    </div>
                  </td>
                  <td className={TD}>
                    <input
                      type="number"
                      min={0}
                      max={500}
                      placeholder="глоб."
                      className="w-20 rounded-md border border-black/15 px-2 py-1.5 text-sm tabular-nums"
                      value={tenantDraft[t.tenantId] ?? ''}
                      onChange={(e) =>
                        setTenantDraft((d) => ({ ...d, [t.tenantId]: e.target.value }))
                      }
                    />
                  </td>
                  <td className={`${TD} tabular-nums`}>
                    {t.effectiveMarkupPercent}%
                    {t.custom ? (
                      <span className="ml-1 text-xs text-amber-800">своя</span>
                    ) : null}
                  </td>
                  <td className={`${TD} tabular-nums`}>
                    {formatRub(t.usage.chargedRub)} ₽
                    <div className="text-xs text-black/40">{t.usage.events} соб.</div>
                  </td>
                  <td className={`${TD} tabular-nums font-medium`}>
                    {formatRub(t.usage.marginRub)} ₽
                  </td>
                  <td className={TD}>
                    <button
                      type="button"
                      disabled={busy === `t-${t.tenantId}`}
                      onClick={() => void saveTenant(t.tenantId)}
                      className="rounded-md border border-black/15 px-2.5 py-1.5 text-xs font-medium hover:bg-black/[0.03] disabled:opacity-50"
                    >
                      {busy === `t-${t.tenantId}` ? '…' : 'Сохранить'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {tenants.length === 0 ? (
            <p className="mt-4 text-sm text-black/50">Клиенты не найдены.</p>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}

function StatTile({
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
        accent ? 'border-amber-200 bg-amber-50/70' : 'border-black/10 bg-black/[0.02]'
      }`}
    >
      <p className="text-[11px] font-medium uppercase tracking-[0.06em] text-black/45">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tracking-tight tabular-nums text-black">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs text-black/45">{hint}</p> : null}
    </div>
  );
}
