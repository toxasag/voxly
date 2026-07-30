'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, ExternalLink, LogIn, RefreshCw, Trash2 } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

type TenantPricing = {
  baseMonthly: number;
  extraSeatMonthly: number;
  seatsIncluded: number;
  customBase: boolean;
  customExtraSeat: boolean;
  customSeatsIncluded: boolean;
};

type CrmAdminPayload = {
  pricing: {
    baseMonthly: number;
    extraSeatMonthly: number;
    seatsIncluded: number;
  };
  tenants: Array<{
    id: string;
    slug: string;
    status: string;
    portalHost: string | null;
    crmHost: string;
    crmUrl: string;
    seatsUsed: number;
    seatsIncluded: number;
    isTrial: boolean;
    isPaid: boolean;
    pricing: TenantPricing;
    subscription: {
      endsAt: string;
      periodMonths: number;
      seatsIncluded: number;
      extraSeats: number;
    } | null;
    owner: { email: string; name: string } | null;
    createdAt: string;
  }>;
};

type CrmReport = {
  period: { from: string; to: string };
  summary: {
    totalCrmTenants: number;
    onTrial: number;
    paidActive: number;
    expiredOrSuspended: number;
  };
  revenue: {
    crmBase: { count: number; totalRub: number };
    extraSeat: { count: number; totalRub: number; seatsPurchased: number };
    totalRub: number;
  };
  payments: Array<{
    id: string;
    paidAt: string;
    tenantSlug: string;
    productCode: string;
    amountRub: number;
    periodMonths: number | null;
    description: string;
  }>;
};

type TenantResourcesPayload = {
  platform: {
    collectedAt: string;
    memory: { totalBytes: number; usedBytes: number; availableBytes: number };
    disk: { mountPath: string; totalBytes: number; usedBytes: number; freeBytes: number };
  };
  tenants: Array<{
    tenantId: string;
    slug: string;
    diskBytes: number;
    diskBreakdown: {
      twentySchemaBytes: number;
      controlPlaneBytes: number;
      knowledgeFilesBytes: number;
    };
    diskPercentOfPlatform: number;
  }>;
  totals: { tenantsDiskBytes: number };
};

const REFRESH_MS = 60_000;

function formatRub(n: number): string {
  return n.toLocaleString('ru-RU');
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

function pctUsed(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((used / total) * 1000) / 10);
}

function ResourceBar({
  label,
  used,
  total,
  hint,
}: {
  label: string;
  used: number;
  total: number;
  hint?: string;
}) {
  const pct = pctUsed(used, total);
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-1 text-xs">
        <span className="font-medium text-black/70">{label}</span>
        <span className="font-medium tabular-nums text-black/80">
          {formatBytes(used)} / {formatBytes(total)}
          <span className="ml-1 font-normal text-black/45">· {pct}%</span>
        </span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/[0.06]">
        <div
          className="h-full rounded-full bg-black/70 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      {hint ? <p className="mt-1 text-[11px] text-black/45">{hint}</p> : null}
    </div>
  );
}

function TenantDiskCell({
  diskBytes,
  platformTotalBytes,
  breakdown,
}: {
  diskBytes: number;
  platformTotalBytes: number;
  breakdown: TenantResourcesPayload['tenants'][0]['diskBreakdown'];
}) {
  return (
    <div>
      <p className="font-medium tabular-nums text-black/85">
        {formatBytes(diskBytes)} / {formatBytes(platformTotalBytes)}
      </p>
      <p className="mt-0.5 text-[10px] leading-snug text-black/45">
        Twenty {formatBytes(breakdown.twentySchemaBytes)} · CP{' '}
        {formatBytes(breakdown.controlPlaneBytes)} · AI{' '}
        {formatBytes(breakdown.knowledgeFilesBytes)}
      </p>
    </div>
  );
}

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">{label}</p>
      <p className="land-display mt-1.5 text-[28px] tracking-[-0.03em] text-black">{value}</p>
      {hint ? <p className="mt-1 text-xs text-black/55">{hint}</p> : null}
    </div>
  );
}

function TenantPricingEditor({
  tenant,
  platform,
  onSaved,
  onError,
}: {
  tenant: CrmAdminPayload['tenants'][0];
  platform: CrmAdminPayload['pricing'];
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [baseMonthly, setBaseMonthly] = useState(tenant.pricing.baseMonthly);
  const [extraSeatMonthly, setExtraSeatMonthly] = useState(tenant.pricing.extraSeatMonthly);
  const [seatsIncluded, setSeatsIncluded] = useState(tenant.pricing.seatsIncluded);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBaseMonthly(tenant.pricing.baseMonthly);
    setExtraSeatMonthly(tenant.pricing.extraSeatMonthly);
    setSeatsIncluded(tenant.pricing.seatsIncluded);
  }, [tenant.pricing]);

  const hasCustom =
    tenant.pricing.customBase ||
    tenant.pricing.customExtraSeat ||
    tenant.pricing.customSeatsIncluded;

  const save = async () => {
    const seats = Math.round(Number(seatsIncluded));
    if (!Number.isFinite(seats) || seats < 1 || seats > 500) {
      onError('Мест в тарифе: от 1 до 500');
      return;
    }

    setBusy(true);
    onError('');
    try {
      const res = await fetch(`/api/admin/crm/tenants/${tenant.id}/pricing`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          baseMonthly: baseMonthly === platform.baseMonthly ? null : baseMonthly,
          extraSeatMonthly:
            extraSeatMonthly === platform.extraSeatMonthly ? null : extraSeatMonthly,
          // null = platform default (backend resets override + subscription seats)
          seatsIncluded: seats === platform.seatsIncluded ? null : seats,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось сохранить');
      onSaved();
      setOpen(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setBaseMonthly(platform.baseMonthly);
    setExtraSeatMonthly(platform.extraSeatMonthly);
    setSeatsIncluded(platform.seatsIncluded);
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-medium text-black/55 hover:text-black"
      >
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        Тариф {hasCustom ? '(индивидуальный)' : '(платформа)'}
        {hasCustom ? (
          <Badge variant="secondary" className="ml-1 text-[10px]">
            custom
          </Badge>
        ) : null}
      </button>
      {open ? (
        <div className="mt-2 grid gap-2 rounded-xl border border-black/8 bg-black/[0.02] p-3 sm:grid-cols-4">
          <label className="block text-xs">
            <span className="text-black/45">CRM ₽/мес</span>
            <input
              type="number"
              min={0}
              value={baseMonthly}
              onChange={(e) => setBaseMonthly(Number(e.target.value))}
              className="mt-1 min-h-9 w-full rounded-lg border border-black/15 bg-white px-2 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-black/45">Доп. место ₽</span>
            <input
              type="number"
              min={0}
              value={extraSeatMonthly}
              onChange={(e) => setExtraSeatMonthly(Number(e.target.value))}
              className="mt-1 min-h-9 w-full rounded-lg border border-black/15 bg-white px-2 text-sm"
            />
          </label>
          <label className="block text-xs">
            <span className="text-black/45">Мест в тарифе</span>
            <input
              type="number"
              min={1}
              max={500}
              value={seatsIncluded}
              onChange={(e) => setSeatsIncluded(Number(e.target.value))}
              className="mt-1 min-h-9 w-full rounded-lg border border-black/15 bg-white px-2 text-sm"
            />
            <span className="mt-1 block text-[10px] leading-snug text-black/45">
              Платформа: {platform.seatsIncluded}
              {tenant.subscription?.seatsIncluded != null &&
              tenant.subscription.seatsIncluded !== tenant.pricing.seatsIncluded
                ? ` · в подписке сейчас: ${tenant.subscription.seatsIncluded}`
                : null}
              {tenant.pricing.customSeatsIncluded ? ' · индивидуально' : ' · по умолчанию'}
            </span>
          </label>
          <div className="flex items-end gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
              {busy ? '…' : 'Сохранить'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={reset}>
              Сброс
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminCrmPage() {
  const router = useRouter();
  const [data, setData] = useState<CrmAdminPayload | null>(null);
  const [report, setReport] = useState<CrmReport | null>(null);
  const [resources, setResources] = useState<TenantResourcesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState<Date | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [baseMonthly, setBaseMonthly] = useState(500);
  const [extraSeatMonthly, setExtraSeatMonthly] = useState(300);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [reportFrom, setReportFrom] = useState(() => {
    const d = new Date();
    return toDateInput(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [reportTo, setReportTo] = useState(() => toDateInput(new Date()));

  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/admin/crm', { headers: authHeaders() });
      if (res.status === 403) throw new Error('Нужна роль superadmin');
      if (!res.ok) throw new Error('Не удалось загрузить CRM админку');
      const json = (await res.json()) as CrmAdminPayload;
      setData(json);
      setBaseMonthly(json.pricing.baseMonthly);
      setExtraSeatMonthly(json.pricing.extraSeatMonthly);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const loadReport = useCallback(async (from = reportFrom, to = reportTo) => {
    setReportLoading(true);
    try {
      const qs = new URLSearchParams({ from, to });
      const res = await fetch(`/api/admin/crm/report?${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Не удалось загрузить отчёт');
      setReport((await res.json()) as CrmReport);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка отчёта');
    } finally {
      setReportLoading(false);
    }
  }, [reportFrom, reportTo]);

  const loadResources = useCallback(async () => {
    setResourcesLoading(true);
    try {
      const res = await fetch('/api/admin/crm/resources', { headers: authHeaders() });
      if (!res.ok) throw new Error('Не удалось загрузить ресурсы');
      setResources((await res.json()) as TenantResourcesPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка ресурсов');
    } finally {
      setResourcesLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadReport();
    void loadResources().then(() => setLastRefreshAt(new Date()));
  }, [load, loadReport, loadResources]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void loadResources().then(() => setLastRefreshAt(new Date()));
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [loadResources]);

  const resourceByTenantId = new Map(
    (resources?.tenants ?? []).map((r) => [r.tenantId, r]),
  );

  const savePricing = async (e: React.FormEvent) => {
    e.preventDefault();
    setPricingBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/crm/pricing', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          baseMonthly: Number(baseMonthly),
          extraSeatMonthly: Number(extraSeatMonthly),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось сохранить тариф');
      setNotice(
        `Тариф платформы: CRM ${formatRub(json.pricing.baseMonthly)} ₽ · место ${formatRub(json.pricing.extraSeatMonthly)} ₽`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setPricingBusy(false);
    }
  };

  const openCrmAsOwner = async (tenantId: string) => {
    setBusyId(`crm-${tenantId}`);
    setError('');
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/crm-login`, {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json.error || 'Не удалось открыть CRM');
      window.open(json.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка CRM login');
    } finally {
      setBusyId('');
    }
  };

  const impersonateOwner = async (tenantId: string) => {
    setBusyId(`imp-${tenantId}`);
    setError('');
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/impersonate`, {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.token) throw new Error(json.error || 'Не удалось войти');
      localStorage.setItem('voxly_token', json.token);
      window.location.href = json.redirectUrl || '/dashboard/crm';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка impersonate');
      setBusyId('');
    }
  };

  const purgeTenant = async (tenantId: string, slug: string) => {
    const msg =
      `ПОЛНОЕ удаление «${slug}» — необратимо!\n\n` +
      `Будет удалено:\n` +
      `• Кабинет Voxly (аккаунт, боты, чаты, биллинг)\n` +
      `• CRM-портал {slug}-crm.getvoxly.ru\n` +
      `• База данных клиента в Twenty (сделки, контакты, workspace)\n` +
      `• AI-файлы и WhatsApp-инстансы\n\n` +
      `Введите slug для подтверждения:`;
    const typed = window.prompt(msg, '');
    if (typed == null) return;
    if (typed.trim() !== slug) {
      setError('Удаление отменено: slug не совпал');
      return;
    }
    if (!window.confirm(`Точно удалить ${slug}? Данные восстановить нельзя.`)) return;

    setBusyId(`del-${tenantId}`);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}`, {
        method: 'DELETE',
        headers: authHeaders(),
        body: JSON.stringify({ confirmSlug: slug }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось удалить');
      setNotice(`Портал ${slug} полностью удалён`);
      await load();
      await loadReport();
      await loadResources();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setBusyId('');
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
      <div className="landing-root space-y-6">
        <section className="relative isolate overflow-hidden rounded-2xl bg-[#f5a623] px-5 py-6 sm:px-8 sm:py-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(10,10,10,.45) 1px, transparent 1px), linear-gradient(90deg, rgba(10,10,10,.45) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
          <div className="relative z-10">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
              Superadmin
            </p>
            <h1 className="land-display mt-2 text-[clamp(1.75rem,3.5vw,2.5rem)] leading-[1.1] tracking-[-0.04em]">
              CRM портал
            </h1>
            <p className="mt-2 max-w-[48ch] text-sm text-black/65 sm:text-base">
              Тарифы платформы, индивидуальные цены клиентов, отчёты по оплатам и управление
              порталами.
            </p>
          </div>
        </section>

        {error ? <Alert variant="error">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}

        {/* Report block */}
        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="land-display text-xl tracking-[-0.03em]">Отчёт CRM</h2>
              <p className="mt-1 text-sm text-black/55">
                Клиенты, trial/оплата, выручка и история платежей за период.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs">
                <span className="text-black/45">С</span>
                <input
                  type="date"
                  value={reportFrom}
                  onChange={(e) => setReportFrom(e.target.value)}
                  className="ml-1 rounded-lg border border-black/15 px-2 py-1.5 text-sm"
                />
              </label>
              <label className="text-xs">
                <span className="text-black/45">По</span>
                <input
                  type="date"
                  value={reportTo}
                  onChange={(e) => setReportTo(e.target.value)}
                  className="ml-1 rounded-lg border border-black/15 px-2 py-1.5 text-sm"
                />
              </label>
              <Button
                type="button"
                size="sm"
                disabled={reportLoading}
                onClick={() => void loadReport(reportFrom, reportTo)}
              >
                {reportLoading ? 'Загрузка…' : 'Показать'}
              </Button>
            </div>
          </div>

          {report ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="CRM клиентов" value={String(report.summary.totalCrmTenants)} />
                <Stat label="На trial" value={String(report.summary.onTrial)} />
                <Stat label="Оплатили (актив)" value={String(report.summary.paidActive)} />
                <Stat
                  label="Истекли / suspend"
                  value={String(report.summary.expiredOrSuspended)}
                />
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <Stat
                  label="Оплаты CRM за период"
                  value={`${formatRub(report.revenue.crmBase.totalRub)} ₽`}
                  hint={`${report.revenue.crmBase.count} платежей`}
                />
                <Stat
                  label="Доп. места за период"
                  value={`${formatRub(report.revenue.extraSeat.totalRub)} ₽`}
                  hint={`${report.revenue.extraSeat.count} платежей · ${report.revenue.extraSeat.seatsPurchased} мест`}
                />
                <Stat
                  label="Итого за период"
                  value={`${formatRub(report.revenue.totalRub)} ₽`}
                  hint={`${new Date(report.period.from).toLocaleDateString('ru-RU')} — ${new Date(report.period.to).toLocaleDateString('ru-RU')}`}
                />
              </div>

              {report.payments.length > 0 ? (
                <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-black/10">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white/95 text-black/45">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Дата</th>
                        <th className="px-3 py-2 font-semibold">Клиент</th>
                        <th className="px-3 py-2 font-semibold">Продукт</th>
                        <th className="px-3 py-2 font-semibold text-right">Сумма</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/6">
                      {report.payments.map((p) => (
                        <tr key={p.id}>
                          <td className="px-3 py-2 whitespace-nowrap">
                            {new Date(p.paidAt).toLocaleString('ru-RU')}
                          </td>
                          <td className="px-3 py-2">{p.tenantSlug}</td>
                          <td className="px-3 py-2 text-black/55">
                            {p.productCode === 'crm_base' ? 'CRM тариф' : 'Доп. место'}
                            {p.periodMonths ? ` · ${p.periodMonths} мес` : ''}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {formatRub(p.amountRub)} ₽
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-black/55">За выбранный период платежей нет.</p>
              )}
            </>
          ) : reportLoading ? (
            <p className="mt-4 text-sm text-black/55">Загрузка отчёта…</p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="land-display text-xl tracking-[-0.03em]">Ресурсы платформы</h2>
              <p className="mt-1 text-sm text-black/55">
                <strong className="font-medium text-black/70">Диск</strong> — фактический размер данных
                клиента (Twenty + control plane + AI-файлы).{' '}
                <strong className="font-medium text-black/70">RAM</strong> на клиента не измеряется
                (общий Docker/Postgres). Обновление каждые 60 с.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-black/45">
              {lastRefreshAt ? (
                <span>{lastRefreshAt.toLocaleTimeString('ru-RU')}</span>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={resourcesLoading}
                className="gap-1.5"
                onClick={() => void loadResources().then(() => setLastRefreshAt(new Date()))}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${resourcesLoading ? 'animate-spin' : ''}`} />
                Обновить
              </Button>
            </div>
          </div>

          {resources ? (
            <>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <ResourceBar
                  label="RAM сервера"
                  used={resources.platform.memory.usedBytes}
                  total={resources.platform.memory.totalBytes}
                  hint={`Свободно ${formatBytes(resources.platform.memory.availableBytes)}. Общая память хоста — не делится по клиентам.`}
                />
                <ResourceBar
                  label={`Диск (${resources.platform.disk.mountPath})`}
                  used={resources.platform.disk.usedBytes}
                  total={resources.platform.disk.totalBytes}
                  hint={`Свободно ${formatBytes(resources.platform.disk.freeBytes)}. Сумма данных клиентов: ${formatBytes(resources.totals.tenantsDiskBytes)} (остальное — ОС, Docker, логи).`}
                />
              </div>

              {resources.tenants.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="bg-black/[0.02] text-black/45">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Клиент</th>
                        <th className="px-3 py-2 font-semibold">Диск (факт / объём сервера)</th>
                        <th className="px-3 py-2 font-semibold">RAM</th>
                        <th className="px-3 py-2 font-semibold text-right">% диска сервера</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/6">
                      {resources.tenants.map((t) => (
                        <tr key={t.tenantId}>
                          <td className="px-3 py-2 font-medium">{t.slug}</td>
                          <td className="px-3 py-2">
                            <TenantDiskCell
                              diskBytes={t.diskBytes}
                              platformTotalBytes={resources.platform.disk.totalBytes}
                              breakdown={t.diskBreakdown}
                            />
                          </td>
                          <td className="px-3 py-2 text-black/45" title="RAM не измеряется per-tenant">
                            н/д (общий стек)
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {t.diskPercentOfPlatform < 0.01 && t.diskBytes > 0
                              ? '<0.01%'
                              : `${t.diskPercentOfPlatform}%`}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-black/55">Нет CRM-клиентов для учёта ресурсов.</p>
              )}
            </>
          ) : resourcesLoading ? (
            <p className="mt-4 text-sm text-black/55">Загрузка ресурсов…</p>
          ) : null}
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Тариф CRM (дефолт)" value={`${formatRub(data.pricing.baseMonthly)} ₽`} hint="в месяц" />
          <Stat
            label="Доп. пользователь (дефолт)"
            value={`${formatRub(data.pricing.extraSeatMonthly)} ₽`}
            hint="в месяц"
          />
          <Stat
            label="CRM подключено"
            value={String(data.tenants.length)}
            hint={`${data.pricing.seatsIncluded} мест в базе`}
          />
        </div>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <h2 className="land-display text-xl tracking-[-0.03em]">Стоимость по умолчанию</h2>
          <p className="mt-1 text-sm text-black/55">
            Для новых клиентов без индивидуального тарифа. Robokassa checkout берёт эти или
            персональные цены.
          </p>
          <form onSubmit={(e) => void savePricing(e)} className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                CRM ₽/мес
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={baseMonthly}
                onChange={(e) => setBaseMonthly(Number(e.target.value))}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-black/40"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                Доп. место ₽/мес
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={extraSeatMonthly}
                onChange={(e) => setExtraSeatMonthly(Number(e.target.value))}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-black/40"
              />
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={pricingBusy} className="land-btn min-h-11 w-full px-5 text-sm disabled:opacity-50">
                {pricingBusy ? 'Сохраняем…' : 'Сохранить дефолт'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="land-display text-xl tracking-[-0.03em]">Клиентские CRM</h2>
              <p className="mt-1 text-sm text-black/55">
                Индивидуальный тариф — раскрой «Тариф» у клиента. Удаление снимает кабинет Voxly,
                CRM-портал и базу Twenty целиком.
              </p>
            </div>
            <Badge variant="secondary">{data.tenants.length} порталов</Badge>
          </div>

          <div className="mt-4 divide-y divide-black/8 rounded-xl border border-black/10">
            {data.tenants.length === 0 ? (
              <p className="px-4 py-6 text-sm text-black/55">Пока нет подключённых CRM.</p>
            ) : (
              data.tenants.map((t) => (
                <div key={t.id} className="px-4 py-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {t.owner?.name || t.slug}{' '}
                        <span className="text-black/45">· {t.slug}</span>
                      </p>
                      <p className="truncate text-xs text-black/55">{t.owner?.email || '—'}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-black/55">
                        <code className="rounded bg-black/[0.04] px-1.5 py-0.5">{t.crmHost}</code>
                        <CopyButton value={t.crmUrl} size="icon" label="URL" />
                        <span>
                          {t.seatsUsed}/{t.seatsIncluded} мест
                        </span>
                        {t.subscription?.endsAt ? (
                          <span>до {new Date(t.subscription.endsAt).toLocaleDateString('ru-RU')}</span>
                        ) : null}
                        {resourceByTenantId.get(t.id) ? (
                          <span title="Фактический объём данных клиента на диске">
                            · диск {formatBytes(resourceByTenantId.get(t.id)!.diskBytes)} /{' '}
                            {formatBytes(resources?.platform.disk.totalBytes ?? 0)}
                          </span>
                        ) : null}
                      </div>
                      <TenantPricingEditor
                        tenant={t}
                        platform={data.pricing}
                        onSaved={() => void load()}
                        onError={setError}
                      />
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {t.isTrial ? (
                        <Badge variant="secondary">trial</Badge>
                      ) : t.isPaid ? (
                        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">paid</Badge>
                      ) : (
                        <Badge variant="secondary">{t.status}</Badge>
                      )}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={busyId === `crm-${t.id}`}
                        onClick={() => void openCrmAsOwner(t.id)}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        В CRM
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={busyId === `imp-${t.id}`}
                        onClick={() => void impersonateOwner(t.id)}
                      >
                        <LogIn className="h-3.5 w-3.5" />
                        Кабинет
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={busyId === `del-${t.id}`}
                        onClick={() => void purgeTenant(t.id, t.slug)}
                        aria-label={`Удалить ${t.slug}`}
                        title="Полное удаление: кабинет + CRM + база"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
