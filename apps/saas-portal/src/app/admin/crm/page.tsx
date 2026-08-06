'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  LogIn,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { Badge } from '@/components/ui/badge';

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
    access: {
      locked: boolean;
      reason: string;
      inGrace: boolean;
      graceEndsAt: string | null;
    };
  }>;
};

type Tenant = CrmAdminPayload['tenants'][0];

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

type Preset = 'month' | 'days30' | 'year' | 'all' | 'custom';

function presetRange(preset: Exclude<Preset, 'custom'>): { from: string; to: string } {
  const now = new Date();
  const to = toDateInput(now);
  if (preset === 'days30') {
    const d = new Date(now);
    d.setDate(d.getDate() - 29);
    return { from: toDateInput(d), to };
  }
  if (preset === 'year') return { from: toDateInput(new Date(now.getFullYear(), 0, 1)), to };
  if (preset === 'all') return { from: '2020-01-01', to };
  return { from: toDateInput(new Date(now.getFullYear(), now.getMonth(), 1)), to };
}

function accessState(t: Tenant): {
  label: string;
  variant: 'success' | 'warning' | 'secondary' | 'destructive';
  hint: string;
} {
  if (t.access.locked) {
    return {
      label: 'Заблокирован',
      variant: 'destructive',
      hint: t.access.reason || 'доступ к CRM закрыт',
    };
  }
  if (t.access.inGrace) {
    return {
      label: 'Льготный период',
      variant: 'warning',
      hint: t.access.graceEndsAt
        ? `доступ до ${formatDate(t.access.graceEndsAt)}`
        : 'подписка истекла, доступ пока открыт',
    };
  }
  if (t.isTrial) {
    return {
      label: 'Trial',
      variant: 'secondary',
      hint: t.subscription?.endsAt ? `до ${formatDate(t.subscription.endsAt)}` : 'пробный доступ',
    };
  }
  if (t.isPaid) {
    return {
      label: 'Активен',
      variant: 'success',
      hint: t.subscription?.endsAt ? `оплачен до ${formatDate(t.subscription.endsAt)}` : 'оплачен',
    };
  }
  return { label: t.status, variant: 'secondary', hint: 'нет активной подписки' };
}

function hasCustomPricing(t: Tenant): boolean {
  return t.pricing.customBase || t.pricing.customExtraSeat || t.pricing.customSeatsIncluded;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">{label}</p>
      <p className="land-display mt-1.5 text-[28px] tabular-nums tracking-[-0.03em] text-black">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-black/55">{hint}</p> : null}
    </div>
  );
}

function TenantPricingPanel({
  tenant,
  platform,
  onSaved,
  onError,
  onClose,
}: {
  tenant: Tenant;
  platform: CrmAdminPayload['pricing'];
  onSaved: () => void;
  onError: (msg: string) => void;
  onClose: () => void;
}) {
  const [baseMonthly, setBaseMonthly] = useState(tenant.pricing.baseMonthly);
  const [extraSeatMonthly, setExtraSeatMonthly] = useState(tenant.pricing.extraSeatMonthly);
  const [seatsIncluded, setSeatsIncluded] = useState(tenant.pricing.seatsIncluded);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBaseMonthly(tenant.pricing.baseMonthly);
    setExtraSeatMonthly(tenant.pricing.extraSeatMonthly);
    setSeatsIncluded(tenant.pricing.seatsIncluded);
  }, [tenant.pricing]);

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
      onClose();
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

  const inherits = (custom: boolean) => (custom ? 'индивидуально' : 'как у платформы');

  return (
    <div className="rounded-xl border border-black/15 bg-[#faf8f5] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-black">
          Индивидуальная цена · {tenant.slug}
        </p>
        <p className="text-xs text-black/55">
          Затрагивает только этого клиента. Пустое значение = цена платформы.
        </p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
            CRM ₽/мес
          </span>
          <input
            type="number"
            min={0}
            value={baseMonthly}
            onChange={(e) => setBaseMonthly(Number(e.target.value))}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm tabular-nums outline-none focus:border-black/40"
          />
          <span className="mt-1 block text-[11px] text-black/45">
            Платформа: {formatRub(platform.baseMonthly)} ₽ · {inherits(tenant.pricing.customBase)}
            {' · 0 = бесплатно'}
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
            Доп. место ₽/мес
          </span>
          <input
            type="number"
            min={0}
            value={extraSeatMonthly}
            onChange={(e) => setExtraSeatMonthly(Number(e.target.value))}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm tabular-nums outline-none focus:border-black/40"
          />
          <span className="mt-1 block text-[11px] text-black/45">
            Платформа: {formatRub(platform.extraSeatMonthly)} ₽ ·{' '}
            {inherits(tenant.pricing.customExtraSeat)}
          </span>
        </label>
        <label className="block text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
            Мест в тарифе
          </span>
          <input
            type="number"
            min={1}
            max={500}
            value={seatsIncluded}
            onChange={(e) => setSeatsIncluded(Number(e.target.value))}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm tabular-nums outline-none focus:border-black/40"
          />
          <span className="mt-1 block text-[11px] leading-snug text-black/45">
            Платформа: {platform.seatsIncluded} · {inherits(tenant.pricing.customSeatsIncluded)}
            {tenant.subscription?.seatsIncluded != null &&
            tenant.subscription.seatsIncluded !== tenant.pricing.seatsIncluded
              ? ` · в подписке сейчас ${tenant.subscription.seatsIncluded}`
              : null}
          </span>
        </label>
        <div className="flex flex-wrap items-start gap-2 sm:items-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="land-btn min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button
            type="button"
            onClick={reset}
            className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
          >
            Вернуть платформу
          </button>
        </div>
      </div>
    </div>
  );
}

function TenantDangerPanel({
  tenant,
  busy,
  onPurge,
  onCancel,
}: {
  tenant: Tenant;
  busy: boolean;
  onPurge: (typed: string) => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed.trim() === tenant.slug;

  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/[0.04] p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-destructive">
            Необратимое удаление клиента «{tenant.slug}»
          </p>
          <p className="mt-1 text-xs text-black/65">
            Восстановить данные будет невозможно — резервной копии по клиенту нет. Будет удалено:
          </p>
          <ul className="mt-2 space-y-1 text-xs text-black/65">
            <li>· Кабинет Voxly: аккаунт владельца {tenant.owner?.email || tenant.slug}, боты, чаты, биллинг</li>
            <li>· CRM-портал {tenant.crmHost} и workspace Twenty (сделки, контакты, задачи)</li>
            <li>· Схема базы данных клиента в Twenty — вместе со всей историей</li>
            <li>· AI-файлы базы знаний и WhatsApp-инстансы Evolution</li>
          </ul>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block flex-1 text-sm">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
            Введите slug клиента, чтобы подтвердить
          </span>
          <input
            type="text"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            placeholder={tenant.slug}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 font-mono text-sm outline-none focus:border-destructive/60"
          />
        </label>
        <button
          type="button"
          disabled={busy || !matches}
          onClick={() => onPurge(typed)}
          className="min-h-11 cursor-pointer rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground transition-colors duration-200 hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Удаляем…' : 'Удалить навсегда'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
        >
          Отмена
        </button>
      </div>
      {!matches && typed.length > 0 ? (
        <p className="mt-2 text-xs font-medium text-destructive">
          Slug не совпадает — нужно ровно «{tenant.slug}».
        </p>
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
  const [preset, setPreset] = useState<Preset>('month');
  const [reportFrom, setReportFrom] = useState(() => presetRange('month').from);
  const [reportTo, setReportTo] = useState(() => presetRange('month').to);
  const [expanded, setExpanded] = useState<{ id: string; mode: 'pricing' | 'danger' } | null>(null);

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
    void loadResources().then(() => setLastRefreshAt(new Date()));
  }, [load, loadResources]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

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

  const purgeTenant = async (tenantId: string, slug: string, typed: string) => {
    if (typed.trim() !== slug) {
      setError('Удаление отменено: slug не совпал');
      return;
    }
    if (
      !window.confirm(
        `Последнее предупреждение: «${slug}» будет удалён вместе с кабинетом Voxly, CRM-порталом, базой Twenty, AI-файлами и WhatsApp-инстансами. Восстановить нельзя. Продолжить?`,
      )
    ) {
      return;
    }

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
      setExpanded(null);
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

  const platform = data.pricing;
  const tenants = data.tenants;

  const applyPreset = (next: Exclude<Preset, 'custom'>) => {
    const range = presetRange(next);
    setPreset(next);
    setReportFrom(range.from);
    setReportTo(range.to);
  };

  const presets: Array<{ id: Exclude<Preset, 'custom'>; label: string }> = [
    { id: 'month', label: 'Этот месяц' },
    { id: 'days30', label: '30 дней' },
    { id: 'year', label: 'Этот год' },
    { id: 'all', label: 'Всё время' },
  ];

  const revenueBySlug = new Map<string, number>();
  for (const p of report?.payments ?? []) {
    revenueBySlug.set(p.tenantSlug, (revenueBySlug.get(p.tenantSlug) ?? 0) + p.amountRub);
  }

  const overrideTenants = tenants.filter(hasCustomPricing);
  const lockedCount = tenants.filter((t) => t.access.locked).length;
  const graceCount = tenants.filter((t) => !t.access.locked && t.access.inGrace).length;

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
            <p className="mt-2 max-w-[52ch] text-sm text-black/65 sm:text-base">
              Четыре независимых задачи: отчётность по оплатам, глобальные тарифы платформы,
              индивидуальные цены и операции с клиентскими порталами.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-black/65">
              <span>
                <strong className="font-semibold text-black">{tenants.length}</strong> порталов
              </span>
              <span>
                <strong className="font-semibold text-black">{overrideTenants.length}</strong> с
                индивидуальной ценой
              </span>
              <span>
                <strong className="font-semibold text-black">{graceCount}</strong> в льготном
                периоде
              </span>
              <span>
                <strong className="font-semibold text-black">{lockedCount}</strong> заблокировано
              </span>
            </div>
          </div>
        </section>

        {error ? <Alert variant="error">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}

        {lockedCount > 0 || graceCount > 0 ? (
          <Alert variant="info">
            Требуют внимания: {lockedCount} заблокированных и {graceCount} в льготном периоде.
            Льготный период — CRM ещё работает, но подписка истекла; блокировка — доступ уже закрыт.
          </Alert>
        ) : null}

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
                01 · Отчётность
              </p>
              <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Оплаты и выручка</h2>
              <p className="mt-1 text-sm text-black/55">
                Клиенты, trial/оплата, выручка и история платежей за период.
                {reportLoading ? ' Обновляем…' : ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {presets.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs font-semibold transition-colors duration-200 ${
                    preset === p.id
                      ? 'border-black bg-black text-white'
                      : 'border-black/15 text-black/65 hover:border-black/35'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-3">
            <label className="block text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                С даты
              </span>
              <input
                type="date"
                value={reportFrom}
                onChange={(e) => {
                  setPreset('custom');
                  setReportFrom(e.target.value);
                }}
                className="mt-1.5 block min-h-11 rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-black/40"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                По дату
              </span>
              <input
                type="date"
                value={reportTo}
                onChange={(e) => {
                  setPreset('custom');
                  setReportTo(e.target.value);
                }}
                className="mt-1.5 block min-h-11 rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-black/40"
              />
            </label>
            <p className="pb-1 text-xs text-black/55">
              {preset === 'custom' ? 'Свой период' : 'Готовый период'} — отчёт обновляется сразу
              после изменения.
            </p>
          </div>

          {report ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="CRM клиентов" value={String(report.summary.totalCrmTenants)} />
                <Stat label="На trial" value={String(report.summary.onTrial)} hint="пробный доступ" />
                <Stat
                  label="Оплатили"
                  value={String(report.summary.paidActive)}
                  hint="активная подписка"
                />
                <Stat
                  label="Истекли / отключены"
                  value={String(report.summary.expiredOrSuspended)}
                  hint="подписка не активна"
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
                <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
                  <div className="max-h-80 overflow-y-auto">
                    <table className="w-full min-w-[560px] text-left text-xs">
                      <thead className="sticky top-0 z-10 bg-[#faf8f5] text-black/45">
                        <tr>
                          <th className="px-3 py-2.5 font-semibold">Дата</th>
                          <th className="px-3 py-2.5 font-semibold">Клиент</th>
                          <th className="px-3 py-2.5 font-semibold">Продукт</th>
                          <th className="px-3 py-2.5 text-right font-semibold">Сумма</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-black/10">
                        {report.payments.map((p) => (
                          <tr
                            key={p.id}
                            className="transition-colors duration-200 hover:bg-[#faf8f5]"
                          >
                            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-black/65">
                              {new Date(p.paidAt).toLocaleString('ru-RU')}
                            </td>
                            <td className="px-3 py-2.5 font-medium">{p.tenantSlug}</td>
                            <td className="px-3 py-2.5 text-black/55">
                              {p.productCode === 'crm_base' ? 'CRM тариф' : 'Доп. место'}
                              {p.periodMonths ? ` · ${p.periodMonths} мес` : ''}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">
                              {formatRub(p.amountRub)} ₽
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
                  <p className="text-sm font-medium text-black/70">
                    За выбранный период платежей нет
                  </p>
                  <p className="mt-1 text-xs text-black/55">
                    Попробуйте более широкий период — например, «Всё время».
                  </p>
                  <button
                    type="button"
                    onClick={() => applyPreset('all')}
                    className="land-btn-ghost mt-4 min-h-10 cursor-pointer px-4 text-sm"
                  >
                    Показать за всё время
                  </button>
                </div>
              )}
            </>
          ) : reportLoading ? (
            <p className="mt-4 text-sm text-black/55">Загрузка отчёта…</p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            02 · Глобальные тарифы CRM
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Стоимость по умолчанию</h2>
          <p className="mt-1 text-sm text-black/55">
            CRM base и доп. место. Все продукты (AI, боты, mailing) — на{' '}
            <Link href="/admin/pricing" className="underline underline-offset-2">
              странице Тарифы
            </Link>
            . Действует на следующую оплату.
          </p>

          <div className="mt-4 rounded-xl border border-black/15 bg-[#faf8f5] p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-black/55" />
              <p className="text-sm text-black/70">
                Изменение затронет{' '}
                <strong className="font-semibold text-black">
                  {tenants.length - overrideTenants.length} из {tenants.length}
                </strong>{' '}
                клиентов — всех, кто наследует цену платформы.{' '}
                {overrideTenants.length > 0 ? (
                  <>
                    Ещё {overrideTenants.length} с индивидуальной ценой останутся без изменений:{' '}
                    <span className="font-medium text-black/80">
                      {overrideTenants.map((t) => t.slug).join(', ')}
                    </span>
                    .
                  </>
                ) : (
                  <>Индивидуальных цен сейчас нет — изменение затронет всех.</>
                )}
              </p>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Stat
                label="CRM сейчас"
                value={`${formatRub(platform.baseMonthly)} ₽`}
                hint="в месяц за портал"
              />
              <Stat
                label="Доп. место сейчас"
                value={`${formatRub(platform.extraSeatMonthly)} ₽`}
                hint="в месяц за пользователя"
              />
              <Stat
                label="Мест в базовом тарифе"
                value={String(platform.seatsIncluded)}
                hint="сверх — как доп. места"
              />
            </div>
          </div>

          <form onSubmit={(e) => void savePricing(e)} className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="block text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                CRM ₽/мес
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={baseMonthly}
                onChange={(e) => setBaseMonthly(Number(e.target.value))}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm tabular-nums outline-none focus:border-black/40"
              />
            </label>
            <label className="block text-sm">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                Доп. место ₽/мес
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={extraSeatMonthly}
                onChange={(e) => setExtraSeatMonthly(Number(e.target.value))}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm tabular-nums outline-none focus:border-black/40"
              />
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={pricingBusy}
                className="land-btn-amber min-h-11 w-full cursor-pointer px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pricingBusy ? 'Сохраняем…' : 'Применить ко всей платформе'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
                03 · Клиенты
              </p>
              <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Клиентские CRM</h2>
              <p className="mt-1 max-w-[62ch] text-sm text-black/55">
                «В CRM» открывает портал клиента в новой вкладке от имени владельца. «Кабинет»
                переключает вашу текущую сессию на владельца — чтобы вернуться, войдите заново.
                «Удалить» необратимо стирает клиента целиком.
              </p>
            </div>
            <Badge variant="secondary">{tenants.length} порталов</Badge>
          </div>

          {tenants.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="text-sm font-medium text-black/70">Пока нет подключённых CRM</p>
              <p className="mt-1 text-xs text-black/55">
                Портал появится здесь после первого подключения CRM клиентом.
              </p>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
              <table className="w-full min-w-[1080px] text-left text-sm">
                <thead className="bg-[#faf8f5] text-[11px] uppercase tracking-[0.08em] text-black/45">
                  <tr>
                    <th className="px-3 py-2.5 font-semibold">Клиент</th>
                    <th className="px-3 py-2.5 font-semibold">Статус</th>
                    <th className="px-3 py-2.5 font-semibold">Тариф</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Места</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Выручка</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Диск</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {tenants.map((t) => {
                    const state = accessState(t);
                    const custom = hasCustomPricing(t);
                    const res = resourceByTenantId.get(t.id);
                    const revenue = revenueBySlug.get(t.slug) ?? 0;
                    const open = expanded?.id === t.id ? expanded.mode : null;
                    const overSeats = t.seatsUsed > t.seatsIncluded;

                    return (
                      <Fragment key={t.id}>
                        <tr className="align-top transition-colors duration-200 hover:bg-[#faf8f5]">
                          <td className="px-3 py-3">
                            <p className="font-medium text-black">{t.owner?.name || t.slug}</p>
                            <p className="text-xs text-black/55">{t.owner?.email || '—'}</p>
                            <div className="mt-1 flex items-center gap-1">
                              <code className="rounded bg-black/[0.04] px-1.5 py-0.5 text-[11px] text-black/65">
                                {t.crmHost}
                              </code>
                              <CopyButton value={t.crmUrl} size="icon" label="URL" />
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <Badge variant={state.variant}>{state.label}</Badge>
                            <p className="mt-1 max-w-[22ch] text-xs leading-snug text-black/55">
                              {state.hint}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <p className="tabular-nums text-black/85">
                              {formatRub(t.pricing.baseMonthly)} ₽ +{' '}
                              {formatRub(t.pricing.extraSeatMonthly)} ₽/место
                            </p>
                            <p className="mt-1 text-xs text-black/55">
                              {custom ? 'Индивидуальная цена' : 'Цена платформы'}
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                setExpanded(
                                  open === 'pricing' ? null : { id: t.id, mode: 'pricing' },
                                )
                              }
                              aria-expanded={open === 'pricing'}
                              className="mt-1 flex min-h-9 cursor-pointer items-center gap-1 text-xs font-semibold text-black/65 transition-colors duration-200 hover:text-black"
                            >
                              {open === 'pricing' ? (
                                <ChevronUp aria-hidden className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                              )}
                              {custom ? 'Изменить цену' : 'Задать свою цену'}
                            </button>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <p className="tabular-nums text-black/85">
                              {t.seatsUsed}/{t.seatsIncluded}
                            </p>
                            {overSeats ? (
                              <p className="mt-1 text-xs text-black/55">
                                +{t.seatsUsed - t.seatsIncluded} сверх тарифа
                              </p>
                            ) : null}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <p className="tabular-nums text-black/85">
                              {revenue > 0 ? `${formatRub(revenue)} ₽` : '—'}
                            </p>
                            <p className="mt-1 text-xs text-black/45">за период отчёта</p>
                          </td>
                          <td className="px-3 py-3 text-right">
                            {res ? (
                              <>
                                <p className="tabular-nums text-black/85">
                                  {formatBytes(res.diskBytes)}
                                </p>
                                <p className="mt-1 text-xs text-black/45">
                                  из {formatBytes(resources?.platform.disk.totalBytes ?? 0)}
                                </p>
                              </>
                            ) : (
                              <p className="text-xs text-black/45">—</p>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap items-center justify-end gap-1.5">
                              <button
                                type="button"
                                disabled={busyId === `crm-${t.id}`}
                                onClick={() => void openCrmAsOwner(t.id)}
                                title={`Открыть ${t.crmHost} в новой вкладке от имени владельца`}
                                className="land-btn-ghost min-h-9 cursor-pointer gap-1.5 whitespace-nowrap px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <ExternalLink aria-hidden className="h-3.5 w-3.5" />
                                {busyId === `crm-${t.id}` ? '…' : 'В CRM'}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === `imp-${t.id}`}
                                onClick={() => void impersonateOwner(t.id)}
                                title="Заменить вашу сессию на сессию владельца и перейти в его кабинет Voxly"
                                className="land-btn-ghost min-h-9 cursor-pointer gap-1.5 whitespace-nowrap px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <LogIn aria-hidden className="h-3.5 w-3.5" />
                                {busyId === `imp-${t.id}` ? '…' : 'Кабинет'}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === `del-${t.id}`}
                                onClick={() =>
                                  setExpanded(
                                    open === 'danger' ? null : { id: t.id, mode: 'danger' },
                                  )
                                }
                                aria-expanded={open === 'danger'}
                                aria-label={`Удалить клиента ${t.slug} без возможности восстановления`}
                                title="Необратимое удаление: кабинет Voxly, CRM-портал, база Twenty, AI-файлы"
                                className="ml-1 flex min-h-9 min-w-9 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-destructive/30 px-3 text-xs font-semibold text-destructive transition-colors duration-200 hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Trash2 aria-hidden className="h-3.5 w-3.5" />
                                Удалить
                              </button>
                            </div>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="bg-white">
                            <td colSpan={7} className="px-3 pb-4">
                              {open === 'pricing' ? (
                                <TenantPricingPanel
                                  tenant={t}
                                  platform={platform}
                                  onSaved={() => void load()}
                                  onError={setError}
                                  onClose={() => setExpanded(null)}
                                />
                              ) : (
                                <TenantDangerPanel
                                  tenant={t}
                                  busy={busyId === `del-${t.id}`}
                                  onPurge={(typed) => void purgeTenant(t.id, t.slug, typed)}
                                  onCancel={() => setExpanded(null)}
                                />
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
                04 · Инфраструктура
              </p>
              <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Ресурсы платформы</h2>
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
              <button
                type="button"
                disabled={resourcesLoading}
                onClick={() => void loadResources().then(() => setLastRefreshAt(new Date()))}
                className="land-btn-ghost min-h-10 cursor-pointer gap-1.5 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw
                  aria-hidden
                  className={`h-3.5 w-3.5 ${resourcesLoading ? 'animate-spin' : ''}`}
                />
                Обновить
              </button>
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
                    <thead className="bg-[#faf8f5] text-[11px] uppercase tracking-[0.08em] text-black/45">
                      <tr>
                        <th className="px-3 py-2.5 font-semibold">Клиент</th>
                        <th className="px-3 py-2.5 font-semibold">Диск (факт / объём сервера)</th>
                        <th className="px-3 py-2.5 text-right font-semibold">% диска сервера</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-black/10">
                      {resources.tenants.map((t) => (
                        <tr
                          key={t.tenantId}
                          className="transition-colors duration-200 hover:bg-[#faf8f5]"
                        >
                          <td className="px-3 py-2.5 font-medium">{t.slug}</td>
                          <td className="px-3 py-2.5">
                            <TenantDiskCell
                              diskBytes={t.diskBytes}
                              platformTotalBytes={resources.platform.disk.totalBytes}
                              breakdown={t.diskBreakdown}
                            />
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">
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
                <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
                  <p className="text-sm font-medium text-black/70">
                    Нет CRM-клиентов для учёта ресурсов
                  </p>
                </div>
              )}
            </>
          ) : resourcesLoading ? (
            <p className="mt-4 text-sm text-black/55">Загрузка ресурсов…</p>
          ) : null}
        </section>

      </div>
    </AppShell>
  );
}
