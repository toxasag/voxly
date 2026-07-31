'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { normalizeReferralProductScope } from '@voxly/shared';
import { authHeaders } from '@/lib/auth';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { AdminPartnerDetail } from '@/components/portal/admin-partners-detail';
import { AdminWithdrawalsQueue } from '@/components/portal/admin-withdrawals-queue';
import {
  RuleFields,
  ScopeField,
  formatRub,
  rewardLabel,
  scopeLabel,
  type RuleDraft,
} from '@/components/portal/admin-partners-rule';
import { Badge } from '@/components/ui/badge';

type AdminReferralsPayload = {
  period: { from: string; to: string };
  defaultRule: {
    id: string;
    type: string;
    value: number;
    durationMonths: number | null;
    productScope: string;
    isActive: boolean;
  } | null;
  summary: {
    partnersTotal: number;
    partnersActive: number;
    referralsTotal: number;
    paidTotal: number;
    earnedRub: number;
    paidOutRub: number;
    balanceOwedRub: number;
    clicksTotal: number;
    pendingWithdrawalsCount?: number;
    pendingWithdrawalsRub?: number;
  };
  partners: Array<{
    tenantId: string;
    slug: string;
    ownerEmail: string | null;
    code: string | null;
    codeActive: boolean;
    campaignsCount: number;
    campaignsActive: number;
    clicks: number;
    referrals: number;
    paid: number;
    pending: number;
    earnedPeriodRub: number;
    earnedAllTimeRub: number;
    balanceRub: number;
    paidOutRub: number;
    rule: { type: string; value: number; durationMonths: number | null; isOverride: boolean };
    blocked: boolean;
    pendingWithdrawalRub?: number;
  }>;
};

type Partner = AdminReferralsPayload['partners'][number];

type Preset = 'month' | 'days30' | 'year' | 'all' | 'custom';

type StatusFilter = 'all' | 'active' | 'override' | 'blocked';

type RuleForm = { draft: RuleDraft; productScope: string; isActive: boolean };

const TH = 'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';
const TD = 'px-3 py-3 text-sm';

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

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

function partnerState(p: Partner): {
  label: string;
  variant: 'success' | 'warning' | 'secondary' | 'destructive';
  hint: string;
} {
  if (p.blocked) return { label: 'Заблокирован', variant: 'destructive', hint: 'ссылки не работают' };
  if (!p.code) return { label: 'Без ссылки', variant: 'secondary', hint: 'код ещё не создан' };
  if (!p.codeActive) return { label: 'Ссылка выключена', variant: 'warning', hint: 'новых регистраций не будет' };
  return { label: 'Активен', variant: 'success', hint: `${p.campaignsActive} из ${p.campaignsCount} проектов` };
}

function Stat({
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
        accent ? 'border-[#f5a623]/50 bg-[#fffaf0]' : 'border-black/10 bg-white'
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">{label}</p>
      <p className="land-display mt-1.5 text-[28px] tabular-nums tracking-[-0.03em] text-black">
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs leading-snug text-black/55">{hint}</p> : null}
    </div>
  );
}

export default function AdminPartnersPage() {
  const router = useRouter();
  const [data, setData] = useState<AdminReferralsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(() => presetRange('month').from);
  const [to, setTo] = useState(() => presetRange('month').to);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [expandedId, setExpandedId] = useState('');

  const [ruleForm, setRuleForm] = useState<RuleForm | null>(null);
  const [ruleBusy, setRuleBusy] = useState(false);

  const load = useCallback(
    async (fromDate: string, toDate: string) => {
      const token = localStorage.getItem('voxly_token');
      if (!token) {
        router.push('/login');
        return;
      }
      setRefreshing(true);
      try {
        const qs = new URLSearchParams({ from: fromDate, to: toDate });
        const res = await fetch(`/api/admin/referrals?${qs}`, { headers: authHeaders() });
        if (res.status === 403) throw new Error('Нужна роль superadmin');
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || 'Не удалось загрузить партнёрскую программу');
        const payload = json as AdminReferralsPayload;
        setData(payload);
        setRuleForm(
          (prev) =>
            prev ?? {
              draft: {
                type: payload.defaultRule?.type ?? 'percent_recurring',
                value: payload.defaultRule?.value ?? 20,
                durationMonths: payload.defaultRule?.durationMonths ?? null,
              },
              productScope: normalizeReferralProductScope(payload.defaultRule?.productScope),
              isActive: payload.defaultRule?.isActive ?? true,
            },
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void load(from, to);
  }, [load, from, to]);

  const reload = useCallback(() => {
    void load(from, to);
  }, [load, from, to]);

  const applyPreset = (next: Exclude<Preset, 'custom'>) => {
    const range = presetRange(next);
    setPreset(next);
    setFrom(range.from);
    setTo(range.to);
  };

  const saveRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ruleForm) return;
    setRuleBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/admin/referrals/rule', {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          type: ruleForm.draft.type,
          value: ruleForm.draft.value,
          durationMonths: ruleForm.draft.durationMonths ?? undefined,
          productScope: ruleForm.productScope,
          isActive: ruleForm.isActive,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось сохранить условия');
      setNotice(
        ruleForm.isActive
          ? `Общие условия: ${rewardLabel(ruleForm.draft)}`
          : 'Общие условия сохранены, начисления выключены',
      );
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setRuleBusy(false);
    }
  };

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState />
      </AppShell>
    );
  }

  if (!data || !ruleForm) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">{error || 'Нет данных'}</Alert>
      </AppShell>
    );
  }

  const { summary } = data;
  const globalRuleLabel = rewardLabel(data.defaultRule);
  const overrides = data.partners.filter((p) => p.rule.isOverride);
  const blockedCount = data.partners.filter((p) => p.blocked).length;

  const query = search.trim().toLowerCase();
  const partners = data.partners.filter((p) => {
    if (statusFilter === 'blocked' && !p.blocked) return false;
    if (statusFilter === 'active' && (p.blocked || !p.codeActive)) return false;
    if (statusFilter === 'override' && !p.rule.isOverride) return false;
    if (!query) return true;
    return (
      p.slug.toLowerCase().includes(query) ||
      (p.ownerEmail ?? '').toLowerCase().includes(query) ||
      (p.code ?? '').toLowerCase().includes(query)
    );
  });

  const presets: Array<{ id: Exclude<Preset, 'custom'>; label: string }> = [
    { id: 'month', label: 'Этот месяц' },
    { id: 'days30', label: '30 дней' },
    { id: 'year', label: 'Этот год' },
    { id: 'all', label: 'Всё время' },
  ];

  const filters: Array<{ id: StatusFilter; label: string }> = [
    { id: 'all', label: `Все · ${data.partners.length}` },
    { id: 'active', label: 'Активные' },
    { id: 'override', label: `Персональная ставка · ${overrides.length}` },
    { id: 'blocked', label: `Заблокированные · ${blockedCount}` },
  ];

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
              Партнёрская программа
            </h1>
            <p className="mt-2 max-w-[54ch] text-sm text-black/65 sm:text-base">
              {data.defaultRule
                ? `Общие условия: ${globalRuleLabel}.`
                : 'Общие условия ещё не заданы — партнёрам ничего не начисляется.'}{' '}
              Здесь вы меняете ставки, платите партнёрам и разбираетесь со спорными привязками.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs text-black/65">
              <span>
                <strong className="font-semibold tabular-nums text-black">
                  {formatRub(summary.balanceOwedRub)} ₽
                </strong>{' '}
                должны партнёрам
              </span>
              <span>
                <strong className="font-semibold tabular-nums text-black">
                  {formatRub(summary.pendingWithdrawalsRub ?? 0)} ₽
                </strong>{' '}
                к выплате по заявкам
                {(summary.pendingWithdrawalsCount ?? 0) > 0
                  ? ` (${summary.pendingWithdrawalsCount})`
                  : ''}
              </span>
              <span>
                <strong className="font-semibold tabular-nums text-black">
                  {summary.partnersTotal}
                </strong>{' '}
                партнёров, из них{' '}
                <strong className="font-semibold tabular-nums text-black">
                  {summary.partnersActive}
                </strong>{' '}
                активных
              </span>
              <span>
                <strong className="font-semibold tabular-nums text-black">{overrides.length}</strong>{' '}
                с персональной ставкой
              </span>
              {blockedCount > 0 ? (
                <span>
                  <strong className="font-semibold tabular-nums text-black">{blockedCount}</strong>{' '}
                  заблокировано
                </span>
              ) : null}
            </div>
          </div>
        </section>

        {error ? <Alert variant="error">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}
        {data.defaultRule && !data.defaultRule.isActive ? (
          <Alert variant="info">
            Начисления по общим условиям выключены: новые вознаграждения не создаются. Балансы и
            выплаты при этом работают как обычно.
          </Alert>
        ) : null}

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
                01 · Отчётность
              </p>
              <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Итоги за период</h2>
              <p className="mt-1 text-sm text-black/55">
                {formatDate(data.period.from)} — {formatDate(data.period.to)}
                {refreshing ? ' · обновляем…' : ''}
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

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs text-black/45">
              С
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => {
                  setPreset('custom');
                  setFrom(e.target.value);
                }}
                className="ml-1.5 cursor-pointer rounded-lg border border-black/15 px-2 py-1.5 text-sm text-black"
              />
            </label>
            <label className="text-xs text-black/45">
              По
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => {
                  setPreset('custom');
                  setTo(e.target.value);
                }}
                className="ml-1.5 cursor-pointer rounded-lg border border-black/15 px-2 py-1.5 text-sm text-black"
              />
            </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              accent
              label="Начислено за период"
              value={`${formatRub(summary.earnedRub)} ₽`}
              hint="вознаграждения партнёрам по оплатам клиентов"
            />
            <Stat
              label="Выплачено за период"
              value={`${formatRub(summary.paidOutRub)} ₽`}
              hint="деньги, ушедшие партнёрам"
            />
            <Stat
              label="Долг платформы"
              value={`${formatRub(summary.balanceOwedRub)} ₽`}
              hint="суммарный баланс всех партнёров, не зависит от периода"
            />
            <Stat
              label="Партнёров"
              value={`${summary.partnersTotal}`}
              hint={`${summary.partnersActive} с работающей ссылкой`}
            />
            <Stat
              label="Регистраций"
              value={`${summary.referralsTotal}`}
              hint={`${summary.clicksTotal} переходов по ссылкам`}
            />
            <Stat
              label="Оплат"
              value={`${summary.paidTotal}`}
              hint="приведённые клиенты, которые заплатили"
            />
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            02 · Условия
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Общая ставка платформы</h2>
          <p className="mt-1 max-w-[74ch] text-sm text-black/55">
            Действует для всех партнёров, у которых нет персональной ставки. Сейчас персональная
            стоит у {overrides.length} из {data.partners.length} — их эта форма не затронет.
          </p>

          <form onSubmit={(e) => void saveRule(e)} className="mt-4">
            <RuleFields
              draft={ruleForm.draft}
              onChange={(draft) => setRuleForm({ ...ruleForm, draft })}
              disabled={ruleBusy}
              idPrefix="global-rule"
            />

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <ScopeField
                value={ruleForm.productScope}
                onChange={(productScope) => setRuleForm({ ...ruleForm, productScope })}
                disabled={ruleBusy}
                idPrefix="global-rule"
              />
              <label className="flex cursor-pointer items-start gap-2.5 self-end rounded-xl border border-black/10 bg-[#faf8f5] px-3.5 py-3 text-sm">
                <input
                  type="checkbox"
                  checked={ruleForm.isActive}
                  disabled={ruleBusy}
                  onChange={(e) => setRuleForm({ ...ruleForm, isActive: e.target.checked })}
                  className="mt-0.5 h-4 w-4 cursor-pointer accent-[#f5a623]"
                />
                <span className="min-w-0">
                  <span className="font-semibold text-black">Начислять вознаграждение</span>
                  <span className="mt-0.5 block text-xs leading-snug text-black/55">
                    Снимите галочку, чтобы приостановить новые начисления по общей ставке.
                  </span>
                </span>
              </label>
            </div>

            <div className="mt-3 rounded-xl border border-black/10 bg-[#faf8f5] px-3.5 py-3">
              <p className="text-sm text-black/75">
                Партнёр получит: <strong>{rewardLabel(ruleForm.draft)}</strong>
                <span className="text-black/55"> · {scopeLabel(ruleForm.productScope)}</span>
              </p>
              <p className="mt-1 max-w-[74ch] text-xs leading-snug text-black/55">
                Изменение действует только на будущие начисления — то, что уже начислено партнёрам,
                не пересчитывается и с балансов не пропадает.
              </p>
            </div>

            <button
              type="submit"
              disabled={ruleBusy || !(ruleForm.draft.value >= 0)}
              className="land-btn-amber mt-3 min-h-11 cursor-pointer px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {ruleBusy ? 'Сохраняем…' : 'Сохранить общие условия'}
            </button>
          </form>
        </section>

        <AdminWithdrawalsQueue onMutated={reload} />

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
                04 · Партнёры
              </p>
              <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Кто и сколько привёл</h2>
              <p className="mt-1 max-w-[68ch] text-sm text-black/55">
                Раскройте партнёра, чтобы увидеть его ссылки, клиентов и историю денег — там же
                выплаты, персональная ставка и блокировка.
              </p>
            </div>
            <label className="relative w-full sm:w-72" htmlFor="partner-search">
              <span className="sr-only">Поиск партнёра</span>
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-black/35"
              />
              <input
                id="partner-search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="slug, email или код"
                className="min-h-11 w-full rounded-xl border border-black/15 bg-white pl-9 pr-3 text-sm outline-none focus:border-black/40"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {filters.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                aria-pressed={statusFilter === f.id}
                className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs font-semibold transition-colors duration-200 ${
                  statusFilter === f.id
                    ? 'border-black bg-black text-white'
                    : 'border-black/15 text-black/65 hover:border-black/35'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {data.partners.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="font-semibold text-black">Партнёров пока нет</p>
              <p className="mx-auto mt-1 max-w-[52ch] text-sm text-black/55">
                Партнёром становится любой клиент, который взял ссылку в своём кабинете. Как только
                это произойдёт, он появится здесь.
              </p>
            </div>
          ) : partners.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="font-semibold text-black">Под фильтр никто не подошёл</p>
              <p className="mx-auto mt-1 max-w-[52ch] text-sm text-black/55">
                Проверьте запрос «{search || '—'}» или снимите фильтр по статусу — партнёров всего{' '}
                {data.partners.length}.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setStatusFilter('all');
                }}
                className="land-btn-ghost mt-4 min-h-10 cursor-pointer px-4 text-sm"
              >
                Показать всех
              </button>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
              <table className="w-full min-w-[1080px] text-left">
                <thead className="bg-[#faf8f5]">
                  <tr>
                    <th className={TH}>Партнёр</th>
                    <th className={TH}>Ссылка</th>
                    <th className={TH}>Статус</th>
                    <th className={`${TH} text-right`}>Переходы</th>
                    <th className={`${TH} text-right`}>Рег.</th>
                    <th className={`${TH} text-right`}>Оплаты</th>
                    <th className={`${TH} text-right`}>Начислено</th>
                    <th className={`${TH} text-right`}>Баланс</th>
                    <th className={TH}>Ставка</th>
                    <th className={`${TH} text-right`} aria-label="Детали" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {partners.map((p) => {
                    const state = partnerState(p);
                    const open = expandedId === p.tenantId;
                    return (
                      <Fragment key={p.tenantId}>
                        <tr className="align-top transition-colors duration-200 hover:bg-[#faf8f5]">
                          <td className={TD}>
                            <p className="font-medium text-black">{p.slug}</p>
                            <p className="text-xs text-black/55">{p.ownerEmail || '—'}</p>
                          </td>
                          <td className={TD}>
                            {p.code ? (
                              <code className="rounded bg-[#faf8f5] px-1.5 py-0.5 font-mono text-xs text-black/70">
                                {p.code}
                              </code>
                            ) : (
                              <span className="text-xs text-black/45">нет кода</span>
                            )}
                            <p className="mt-1 text-xs text-black/45">
                              {p.campaignsCount > 0
                                ? `+${p.campaignsCount} проектов`
                                : 'без проектов'}
                            </p>
                          </td>
                          <td className={TD}>
                            <Badge variant={state.variant}>{state.label}</Badge>
                            <p className="mt-1 max-w-[20ch] text-xs leading-snug text-black/55">
                              {state.hint}
                            </p>
                          </td>
                          <td className={`${TD} text-right tabular-nums text-black/65`}>
                            {p.clicks}
                          </td>
                          <td className={`${TD} text-right tabular-nums text-black`}>
                            {p.referrals}
                            {p.pending > 0 ? (
                              <span className="block text-xs text-black/45">
                                {p.pending} ждут оплаты
                              </span>
                            ) : null}
                          </td>
                          <td className={`${TD} text-right tabular-nums text-black`}>{p.paid}</td>
                          <td className={`${TD} text-right tabular-nums`}>
                            <span className="font-semibold text-black">
                              {formatRub(p.earnedPeriodRub)} ₽
                            </span>
                            <span className="block text-xs text-black/45">
                              всего {formatRub(p.earnedAllTimeRub)} ₽
                            </span>
                          </td>
                          <td className={`${TD} text-right tabular-nums`}>
                            <span className="font-semibold text-black">
                              {formatRub(p.balanceRub)} ₽
                            </span>
                            <span className="block text-xs text-black/45">
                              выплачено {formatRub(p.paidOutRub)} ₽
                            </span>
                          </td>
                          <td className={TD}>
                            <p className="max-w-[26ch] text-xs leading-snug text-black/75">
                              {rewardLabel(p.rule)}
                            </p>
                            {p.rule.isOverride ? (
                              <Badge variant="warning" className="mt-1">
                                Персональная
                              </Badge>
                            ) : null}
                          </td>
                          <td className={`${TD} text-right`}>
                            <button
                              type="button"
                              onClick={() => setExpandedId(open ? '' : p.tenantId)}
                              aria-expanded={open}
                              aria-label={
                                open
                                  ? `Свернуть детали партнёра ${p.slug}`
                                  : `Открыть детали партнёра ${p.slug}`
                              }
                              className="inline-flex min-h-9 min-w-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                            >
                              {open ? (
                                <ChevronUp aria-hidden className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown aria-hidden className="h-3.5 w-3.5" />
                              )}
                              {open ? 'Свернуть' : 'Детали'}
                            </button>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="bg-white">
                            <td colSpan={10} className="px-3 pb-4">
                              <AdminPartnerDetail
                                tenantId={p.tenantId}
                                blocked={p.blocked}
                                globalRuleLabel={globalRuleLabel}
                                onError={setError}
                                onNotice={setNotice}
                                onMutated={reload}
                              />
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
      </div>
    </AppShell>
  );
}
