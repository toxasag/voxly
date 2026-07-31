'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Plus, Wallet, X } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { PartnersPortalHero } from '@/components/portal/partners-portal-hero';
import { Badge } from '@/components/ui/badge';
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

type Hold = {
  paymentId: string;
  invId: number;
  amountRub: number;
  description: string;
  createdAt: string;
};

type WithdrawalStatus = 'pending' | 'paid' | 'rejected' | 'cancelled';

type Withdrawal = {
  id: string;
  amountRub: number;
  status: WithdrawalStatus;
  payoutDetails: string;
  comment: string | null;
  decisionNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

type BalanceTransaction = {
  id: string;
  kind: 'payout' | 'manual_credit' | 'manual_debit' | 'redeem';
  amountRub: number;
  note: string | null;
  createdAt: string;
};

type DashboardPayload = {
  period: { from: string; to: string };
  rule: { type: string; value: number; durationMonths: number | null } | null;
  mainCode: CampaignRow;
  balanceRub: number;
  /** Fields below ship with the balance/withdrawal API; guarded until it is deployed. */
  heldRub?: number;
  minWithdrawalRub?: number;
  paidOutRub?: number;
  holds?: Hold[];
  withdrawals?: Withdrawal[];
  transactions?: BalanceTransaction[];
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
  expenses: Array<{
    id: string;
    campaignId: string;
    amountRub: number;
    note: string | null;
    spentAt: string;
  }>;
  referrals: Array<{
    id: string;
    referredSlug: string;
    campaignName: string;
    attributedAt: string;
    firstPaymentAt: string | null;
    earnedRub: number;
  }>;
};

type Preset = 'month' | 'days30' | 'year' | 'all' | 'custom';

type CodeStatus = 'idle' | 'invalid' | 'checking' | 'free' | 'taken';

function formatRub(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

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

function codeFormatIssue(code: string): string {
  if (code.length < 4) return 'Код должен быть не короче 4 символов';
  if (code.length > 32) return 'Код должен быть не длиннее 32 символов';
  if (!/^[A-Za-z0-9]+$/.test(code)) {
    return 'Код может содержать только латинские буквы и цифры, без пробелов';
  }
  return '';
}

function rewardLabel(rule: DashboardPayload['rule']): string {
  if (!rule) return 'Приводите клиентов — зарабатывайте';
  const v = formatRub(rule.value);
  if (rule.type === 'percent_recurring') {
    return rule.durationMonths
      ? `${rule.value}% с оплат клиента ${rule.durationMonths} мес.`
      : `${rule.value}% со всех оплат клиента`;
  }
  if (rule.type === 'percent_first_payment') return `${rule.value}% с первой оплаты клиента`;
  if (rule.type === 'fixed_first_payment') return `${v} ₽ за каждого платящего клиента`;
  return `${v} ₽ бонусом на баланс`;
}

const WITHDRAWAL_STATUS: Record<
  WithdrawalStatus,
  { label: string; variant: 'warning' | 'success' | 'destructive' | 'secondary' }
> = {
  pending: { label: 'На проверке', variant: 'warning' },
  paid: { label: 'Выплачено', variant: 'success' },
  rejected: { label: 'Отклонено', variant: 'destructive' },
  cancelled: { label: 'Отменена', variant: 'secondary' },
};

const TRANSACTION_KIND: Record<BalanceTransaction['kind'], { label: string; credit: boolean }> = {
  payout: { label: 'Выплата', credit: false },
  manual_credit: { label: 'Начисление', credit: true },
  manual_debit: { label: 'Списание', credit: false },
  redeem: { label: 'Зачёт в счёт Voxly', credit: false },
};

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

function FunnelStep({
  label,
  value,
  conversion,
  note,
}: {
  label: string;
  value: number;
  conversion?: string;
  note?: string;
}) {
  return (
    <div className="flex-1 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="land-display text-[24px] tabular-nums tracking-[-0.03em] text-black">
          {value}
        </span>
        {conversion ? (
          <span className="text-xs font-semibold text-black/45">{conversion}</span>
        ) : null}
      </div>
      {note ? <p className="mt-0.5 text-xs text-black/50">{note}</p> : null}
    </div>
  );
}

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';
const TD = 'px-3 py-3 text-sm tabular-nums';

export default function PartnersPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState(() => presetRange('month').from);
  const [to, setTo] = useState(() => presetRange('month').to);

  const [createOpen, setCreateOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [customCode, setCustomCode] = useState('');
  const [createBusy, setCreateBusy] = useState(false);
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('idle');
  const [codeHint, setCodeHint] = useState('');

  const [wdAmount, setWdAmount] = useState('');
  const [wdDetails, setWdDetails] = useState('');
  const [wdDetailsTouched, setWdDetailsTouched] = useState(false);
  const [wdComment, setWdComment] = useState('');
  const [wdConfirm, setWdConfirm] = useState(false);
  const [wdBusy, setWdBusy] = useState(false);
  const [cancelWdId, setCancelWdId] = useState('');
  const [cancelWdBusy, setCancelWdBusy] = useState('');
  const [releaseHoldId, setReleaseHoldId] = useState('');
  const [releaseHoldBusy, setReleaseHoldBusy] = useState('');

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [expenseCampaignId, setExpenseCampaignId] = useState('');
  const [expenseAmount, setExpenseAmount] = useState('');
  const [expenseNote, setExpenseNote] = useState('');
  const [expenseBusy, setExpenseBusy] = useState(false);

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
        const res = await fetch(`/api/referrals/dashboard?${qs}`, { headers: authHeaders() });
        if (!res.ok) throw new Error('Не удалось загрузить партнёрскую программу');
        setData((await res.json()) as DashboardPayload);
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

  const normalizedCode = customCode.trim();

  useEffect(() => {
    if (!normalizedCode) {
      setCodeStatus('idle');
      setCodeHint('');
      return;
    }
    const formatIssue = codeFormatIssue(normalizedCode);
    if (formatIssue) {
      setCodeStatus('invalid');
      setCodeHint(formatIssue);
      return;
    }

    setCodeStatus('checking');
    setCodeHint('');
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ code: normalizedCode });
        const res = await fetch(`/api/referrals/campaigns/code-available?${qs}`, {
          headers: authHeaders(),
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        if (!res.ok) {
          setCodeStatus('invalid');
          setCodeHint(json.error || 'Не удалось проверить код');
          return;
        }
        setCodeStatus(json.available ? 'free' : 'taken');
        setCodeHint(json.available ? '' : `Код ${normalizedCode} уже занят — выберите другой`);
      } catch {
        if (controller.signal.aborted) return;
        setCodeStatus('idle');
        setCodeHint('');
      }
    }, 450);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedCode]);

  useEffect(() => {
    if (wdDetailsTouched) return;
    const list = data?.withdrawals ?? [];
    if (list.length === 0) return;
    const latest = list.reduce((acc, w) =>
      new Date(w.createdAt) > new Date(acc.createdAt) ? w : acc,
    );
    if (latest.payoutDetails) setWdDetails(latest.payoutDetails);
  }, [data, wdDetailsTouched]);

  const codeInvalid = codeStatus === 'taken' || codeStatus === 'invalid';

  const applyPreset = (next: Exclude<Preset, 'custom'>) => {
    const range = presetRange(next);
    setPreset(next);
    setFrom(range.from);
    setTo(range.to);
  };

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
          code: normalizedCode || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось создать ссылку');
      setProjectName('');
      setCustomCode('');
      setCreateOpen(false);
      setNotice(`Ссылка «${json.name}» создана: ${json.code}`);
      await load(from, to);
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
      setNotice(`Расход ${formatRub(Number(expenseAmount))} ₽ учтён`);
      setExpenseAmount('');
      setExpenseNote('');
      setExpenseCampaignId('');
      setExpenseOpen(false);
      await load(from, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setExpenseBusy(false);
    }
  };

  const submitWithdrawal = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(wdAmount);
    if (!amount || !wdDetails.trim()) return;
    if (!wdConfirm) {
      setWdConfirm(true);
      return;
    }
    setWdBusy(true);
    setError('');
    setNotice('');
    try {
      const res = await fetch('/api/referrals/withdrawals', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          amountRub: amount,
          payoutDetails: wdDetails.trim(),
          comment: wdComment.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось отправить заявку на вывод');
      setWdAmount('');
      setWdComment('');
      setWdConfirm(false);
      setNotice(
        `Заявка на ${formatRub(amount)} ₽ отправлена. Эта сумма уже в резерве — она вычтена из «Доступно», но остаётся вашей.`,
      );
      await load(from, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setWdBusy(false);
    }
  };

  const cancelWithdrawal = async (id: string, amountRub: number) => {
    setCancelWdBusy(id);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/referrals/withdrawals/${id}/cancel`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось отменить заявку');
      setCancelWdId('');
      setNotice(`Заявка отменена — ${formatRub(amountRub)} ₽ вернулись на доступный баланс.`);
      await load(from, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setCancelWdBusy('');
    }
  };

  const releaseHold = async (paymentId: string, amountRub: number) => {
    setReleaseHoldBusy(paymentId);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/referrals/holds/${paymentId}/release`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось снять резерв');
      setReleaseHoldId('');
      setNotice(`Резерв снят — ${formatRub(amountRub)} ₽ снова доступны для оплаты или вывода.`);
      await load(from, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setReleaseHoldBusy('');
    }
  };

  const openExpenseForm = (campaignId: string) => {
    setExpenseCampaignId(campaignId);
    setExpenseOpen(true);
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

  const { summary } = data;
  const rows: Array<CampaignRow & { isMain?: boolean }> = [
    { ...data.mainCode, id: 'main', name: 'Основная ссылка', isMain: true },
    ...data.campaigns,
  ];
  const hasCampaigns = data.campaigns.length > 0;
  const mainExpenseHint =
    'Расходы учитываются по проектам — основная ссылка проектом не является';
  const regConversion =
    summary.clicksTotal > 0
      ? `${Math.round((summary.registrations / summary.clicksTotal) * 100)}%`
      : undefined;
  const payConversion =
    summary.registrations > 0
      ? `${Math.round((summary.paid / summary.registrations) * 100)}%`
      : undefined;

  const heldRub = data.heldRub ?? 0;
  const minWithdrawal = data.minWithdrawalRub ?? 1000;
  const holds = data.holds ?? [];
  const withdrawals = data.withdrawals ?? [];
  const transactions = data.transactions ?? [];
  const pendingWithdrawal = withdrawals.find((w) => w.status === 'pending') ?? null;
  // Server-side all-time aggregate, so the total stays correct even if `transactions` is
  // ever windowed or truncated.
  const paidOutTotal =
    data.paidOutRub ?? transactions.reduce((sum, t) => (t.kind === 'payout' ? sum + t.amountRub : sum), 0);
  const belowMinimum = data.balanceRub < minWithdrawal;
  const withdrawalLocked = Boolean(pendingWithdrawal) || belowMinimum;
  const wdAmountNum = Number(wdAmount);
  const wdAmountIssue =
    !wdAmount || Number.isNaN(wdAmountNum)
      ? ''
      : wdAmountNum < minWithdrawal
        ? `Минимальная сумма вывода — ${formatRub(minWithdrawal)} ₽`
        : wdAmountNum > data.balanceRub
          ? `Сумма больше доступного баланса — сейчас свободно ${formatRub(data.balanceRub)} ₽`
          : '';
  const wdSubmitDisabled =
    withdrawalLocked || wdBusy || !wdAmount || Boolean(wdAmountIssue) || !wdDetails.trim();

  const presets: Array<{ id: Exclude<Preset, 'custom'>; label: string }> = [
    { id: 'month', label: 'Этот месяц' },
    { id: 'days30', label: '30 дней' },
    { id: 'year', label: 'Этот год' },
    { id: 'all', label: 'Всё время' },
  ];

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
        <PartnersPortalHero
          rewardLabel={rewardLabel(data.rule)}
          balanceRub={formatRub(data.balanceRub)}
          mainLink={data.mainCode.link}
          mainCode={data.mainCode.code}
          mainClicks={data.mainCode.clicksCount}
        />

        {error ? <Alert variant="error">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}

        <section className="grid gap-3 rounded-2xl border border-black/10 bg-white p-5 sm:grid-cols-3">
          {[
            {
              n: '1',
              title: 'Поделитесь ссылкой',
              text: 'Отправьте в канал, рассылку или лично. Для каждого источника можно завести отдельный код.',
            },
            {
              n: '2',
              title: 'Клиент регистрируется',
              text: 'Переход по ссылке подставляет ваш код на форме — регистрация закрепляется за вами.',
            },
            {
              n: '3',
              title: 'Вы получаете выплату',
              text: 'После оплаты клиентом CRM вознаграждение зачисляется на партнёрский баланс.',
            },
          ].map((step) => (
            <div key={step.n} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-xs font-bold text-black">
                {step.n}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-black">{step.title}</p>
                <p className="mt-1 text-sm leading-snug text-black/55">{step.text}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="land-display text-xl tracking-[-0.03em]">Итоги за период</h2>
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

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              accent
              label="Заработано за период"
              value={`${formatRub(summary.earnedRub)} ₽`}
              hint={`За всё время ${formatRub(data.totalEarnedAllTime)} ₽`}
            />
            <Stat
              label="Чистыми"
              value={`${formatRub(summary.netRub)} ₽`}
              hint={`Расходы на продвижение ${formatRub(summary.expensesRub)} ₽`}
            />
            <Stat
              label="Ждут оплаты"
              value={String(summary.pending)}
              hint="Зарегистрировались, но ещё не оплатили CRM"
            />
            <Stat
              label="Баланс к выплате"
              value={`${formatRub(data.balanceRub)} ₽`}
              hint={
                heldRub > 0
                  ? `Свободно сейчас. Ещё ${formatRub(heldRub)} ₽ в резерве — подробности ниже`
                  : 'Начисленное вознаграждение'
              }
            />
          </div>

          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
              Воронка
            </p>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <FunnelStep
                label="Переходы"
                value={summary.clicksTotal}
                note="накопительно по всем ссылкам"
              />
              <FunnelStep
                label="Регистрации"
                value={summary.registrations}
                conversion={regConversion}
                note="за выбранный период"
              />
              <FunnelStep
                label="Оплаты"
                value={summary.paid}
                conversion={payConversion}
                note="первая оплата CRM"
              />
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <h2 className="land-display text-xl tracking-[-0.03em]">Баланс: потратить или вывести</h2>
          <p className="mt-1 max-w-[76ch] text-sm leading-snug text-black/55">
            Заработанное лежит на одном счёте. Его можно зачесть в оплату собственной подписки
            Voxly или вывести деньгами. Как только вы отправили заявку на вывод или создали счёт с
            зачётом, сумма уходит в резерв: из «Доступно» она пропадает, но остаётся вашей.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat
              accent
              label="Доступно"
              value={`${formatRub(data.balanceRub)} ₽`}
              hint="Свободно прямо сейчас — на оплату счёта или на вывод"
            />
            <Stat
              label="В резерве"
              value={`${formatRub(heldRub)} ₽`}
              hint={
                heldRub > 0
                  ? 'Удержано под заявку на вывод или неоплаченный счёт. Деньги не потеряны — см. блок ниже'
                  : 'Ничего не удержано'
              }
            />
            <Stat
              label="Выплачено всего"
              value={`${formatRub(paidOutTotal)} ₽`}
              hint={
                paidOutTotal > 0
                  ? 'По заявкам на вывод и переводом напрямую'
                  : 'Выплат ещё не было'
              }
            />
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col rounded-xl border border-black/10 bg-[#faf8f5] p-4">
              <p className="font-semibold text-black">Оплатить свой счёт</p>
              <p className="mt-1 text-sm leading-snug text-black/55">
                Баланс принимается в оплату вашей же подписки Voxly — тарифа CRM, дополнительных
                мест и AI-дополнений. На шаге «счёт» отметьте «Зачесть партнёрский баланс»: сумма
                спишется с баланса, картой останется доплатить только разницу.
              </p>
              <p className="mt-2 text-sm leading-snug text-black/55">
                Зачёт по умолчанию выключен — случайно потратить накопленное не получится.
              </p>
              <Link
                href="/dashboard/crm"
                className="land-btn-ghost mt-4 inline-flex min-h-11 w-fit cursor-pointer items-center px-4 text-sm"
              >
                Перейти к оплате CRM
              </Link>
            </div>

            <form
              onSubmit={(e) => void submitWithdrawal(e)}
              className="rounded-xl border border-black/10 bg-[#faf8f5] p-4"
            >
              <p className="font-semibold text-black">Вывести деньгами</p>
              <p className="mt-1 text-sm leading-snug text-black/55">
                Заявку проверяет администратор. Сумма уходит в резерв сразу — пока заявка на
                проверке, потратить её на оплату счёта нельзя.
              </p>

              <div className="mt-3 space-y-3">
                <div>
                  <label htmlFor="wd-amount" className="text-xs text-black/45">
                    Сумма, ₽ — минимум {formatRub(minWithdrawal)} ₽
                  </label>
                  <Input
                    id="wd-amount"
                    type="number"
                    inputMode="numeric"
                    min={minWithdrawal}
                    step={1}
                    placeholder={String(minWithdrawal)}
                    value={wdAmount}
                    disabled={withdrawalLocked || wdBusy}
                    onChange={(e) => {
                      setWdAmount(e.target.value);
                      setWdConfirm(false);
                    }}
                    aria-invalid={Boolean(wdAmountIssue)}
                    aria-describedby="wd-status"
                    className={`mt-1 min-h-11 bg-white text-black transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                      wdAmountIssue ? 'border-[#c2410c]' : 'border-black/15'
                    }`}
                  />
                </div>

                <div>
                  <label htmlFor="wd-details" className="text-xs text-black/45">
                    Куда перевести
                  </label>
                  <textarea
                    id="wd-details"
                    rows={2}
                    required
                    value={wdDetails}
                    disabled={withdrawalLocked || wdBusy}
                    onChange={(e) => {
                      setWdDetails(e.target.value);
                      setWdDetailsTouched(true);
                      setWdConfirm(false);
                    }}
                    placeholder="СБП +7 900 000-00-00, Тинькофф"
                    className="mt-1 min-h-11 w-full rounded-md border border-black/15 bg-white px-3 py-2 text-sm text-black shadow-sm transition-colors duration-200 focus:border-black/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  <p className="mt-1 text-xs leading-snug text-black/45">
                    Телефон и банк для СБП либо номер карты.
                    {withdrawals.length > 0
                      ? ' Подставили реквизиты прошлой заявки — проверьте их.'
                      : ''}
                  </p>
                </div>

                <div>
                  <label htmlFor="wd-comment" className="text-xs text-black/45">
                    Комментарий — необязательно
                  </label>
                  <Input
                    id="wd-comment"
                    value={wdComment}
                    disabled={withdrawalLocked || wdBusy}
                    onChange={(e) => setWdComment(e.target.value)}
                    placeholder="Выплата за июль"
                    className="mt-1 min-h-11 border-black/15 bg-white text-black transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>

                <p
                  id="wd-status"
                  aria-live="polite"
                  className={`min-h-4 text-xs leading-snug ${
                    wdAmountIssue ? 'text-[#c2410c]' : 'text-black/55'
                  }`}
                >
                  {pendingWithdrawal
                    ? `Заявка на ${formatRub(pendingWithdrawal.amountRub)} ₽ уже на проверке — новую можно создать после решения. Текущую можно отменить в таблице ниже, деньги сразу вернутся на баланс.`
                    : belowMinimum
                      ? `Доступно ${formatRub(data.balanceRub)} ₽, а вывод открывается от ${formatRub(minWithdrawal)} ₽ — не хватает ${formatRub(minWithdrawal - data.balanceRub)} ₽. Баланс можно зачесть в оплату счёта без ограничений по сумме.`
                      : wdBusy
                        ? 'Отправляем заявку…'
                        : wdAmountIssue}
                </p>

                {wdConfirm && !withdrawalLocked ? (
                  <div className="rounded-lg border border-[#f5a623]/50 bg-[#fffaf0] p-3">
                    <p className="text-sm leading-snug text-black">
                      Отправить заявку на{' '}
                      <span className="font-semibold tabular-nums">
                        {formatRub(wdAmountNum)} ₽
                      </span>
                      ? Сумма сразу уйдёт в резерв — на балансе останется{' '}
                      <span className="tabular-nums">
                        {formatRub(Math.max(0, data.balanceRub - wdAmountNum))} ₽
                      </span>
                      . Пока администратор не обработал заявку, её можно отменить.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={wdSubmitDisabled}
                        className="land-btn-amber min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {wdBusy ? 'Отправляем…' : 'Подтвердить вывод'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setWdConfirm(false)}
                        disabled={wdBusy}
                        className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Изменить
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="submit"
                    disabled={wdSubmitDisabled}
                    className="land-btn-amber min-h-11 w-full cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Отправить заявку
                  </button>
                )}
              </div>
            </form>
          </div>

          {holds.length > 0 ? (
            <div className="mt-5 rounded-xl border border-[#f5a623]/40 bg-[#fffaf0] p-4">
              <h3 className="font-semibold text-black">В резерве — {formatRub(heldRub)} ₽</h3>
              <p className="mt-1 max-w-[76ch] text-sm leading-snug text-black/60">
                Если баланс стал меньше — деньги здесь, а не потеряны. Эта сумма вычтена из
                «Доступно», потому что вы зачли её в счёт Voxly. Оплатите счёт — резерв уйдёт в
                оплату; отмените резерв — сумма тут же вернётся на баланс, но счёт придётся
                оплатить полностью.
              </p>
              <div className="mt-3 divide-y divide-black/10 rounded-lg border border-black/10 bg-white">
                {holds.map((h) => (
                  <div
                    key={h.paymentId}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-black">
                        Счёт №{h.invId} · {h.description}
                      </p>
                      <p className="mt-0.5 text-xs text-black/50">
                        Резерв от {formatDate(h.createdAt)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums text-[#c2410c]">
                        −{formatRub(h.amountRub)} ₽
                      </span>
                      {releaseHoldId === h.paymentId ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs leading-snug text-black/60">
                            Вернуть {formatRub(h.amountRub)} ₽ на баланс?
                          </span>
                          <button
                            type="button"
                            onClick={() => void releaseHold(h.paymentId, h.amountRub)}
                            disabled={releaseHoldBusy === h.paymentId}
                            className="inline-flex min-h-9 min-w-9 cursor-pointer items-center rounded-full border border-[#c2410c] px-3 text-xs font-semibold text-[#c2410c] transition-colors duration-200 hover:bg-[#c2410c]/5 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {releaseHoldBusy === h.paymentId ? 'Снимаем…' : 'Да, отменить'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setReleaseHoldId('')}
                            disabled={releaseHoldBusy === h.paymentId}
                            className="inline-flex min-h-9 min-w-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Оставить
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setReleaseHoldId(h.paymentId)}
                          className="inline-flex min-h-9 min-w-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                        >
                          Отменить резерв
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5">
            <h3 className="font-semibold text-black">Заявки на вывод</h3>
            {withdrawals.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-6 text-center text-sm leading-snug text-black/55">
                Заявок ещё не было. Когда на балансе накопится {formatRub(minWithdrawal)} ₽,
                оформите вывод в форме выше — здесь появится история со статусами и решениями
                администратора.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-xl border border-black/10">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <thead className="bg-[#faf8f5]">
                    <tr>
                      <th className={TH}>Дата</th>
                      <th className={`${TH} text-right`}>Сумма</th>
                      <th className={TH}>Статус</th>
                      <th className={TH}>Куда</th>
                      <th className={TH}>Комментарий администратора</th>
                      <th className={TH} aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/10">
                    {withdrawals.map((w) => {
                      const status = WITHDRAWAL_STATUS[w.status];
                      return (
                        <tr
                          key={w.id}
                          className="transition-colors duration-200 hover:bg-[#faf8f5]"
                        >
                          <td className={`${TD} align-top text-black/65`}>
                            {formatDate(w.createdAt)}
                            {w.decidedAt ? (
                              <span className="block text-xs text-black/45">
                                решение {formatDate(w.decidedAt)}
                              </span>
                            ) : null}
                          </td>
                          <td className={`${TD} align-top text-right font-semibold text-black`}>
                            {formatRub(w.amountRub)} ₽
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Badge variant={status.variant}>{status.label}</Badge>
                            {w.status === 'rejected' && w.decisionNote ? (
                              <p className="mt-1 max-w-[32ch] text-xs leading-snug text-[#c2410c]">
                                Причина: {w.decisionNote}
                              </p>
                            ) : null}
                            {w.status === 'pending' ? (
                              <p className="mt-1 max-w-[32ch] text-xs leading-snug text-black/50">
                                Сумма в резерве
                              </p>
                            ) : null}
                          </td>
                          <td className="max-w-[28ch] px-3 py-3 align-top text-sm leading-snug text-black/65">
                            {w.payoutDetails}
                            {w.comment ? (
                              <span className="mt-0.5 block text-xs text-black/45">
                                ваш комментарий: {w.comment}
                              </span>
                            ) : null}
                          </td>
                          <td className="max-w-[28ch] px-3 py-3 align-top text-sm leading-snug text-black/65">
                            {w.status !== 'rejected' && w.decisionNote ? w.decisionNote : '—'}
                          </td>
                          <td className="px-3 py-3 align-top text-right">
                            {w.status !== 'pending' ? (
                              <span className="text-xs text-black/35">—</span>
                            ) : cancelWdId === w.id ? (
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <span className="text-xs leading-snug text-black/60">
                                  Вернуть {formatRub(w.amountRub)} ₽ на баланс?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void cancelWithdrawal(w.id, w.amountRub)}
                                  disabled={cancelWdBusy === w.id}
                                  className="inline-flex min-h-9 min-w-9 cursor-pointer items-center rounded-full border border-[#c2410c] px-3 text-xs font-semibold text-[#c2410c] transition-colors duration-200 hover:bg-[#c2410c]/5 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {cancelWdBusy === w.id ? 'Отменяем…' : 'Да, отменить'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCancelWdId('')}
                                  disabled={cancelWdBusy === w.id}
                                  className="inline-flex min-h-9 min-w-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Оставить
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setCancelWdId(w.id)}
                                className="inline-flex min-h-9 min-w-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                              >
                                Отменить заявку
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-5">
            <h3 className="font-semibold text-black">История баланса</h3>
            <p className="mt-1 text-sm leading-snug text-black/55">
              Все движения по счёту: начисления, зачёты в оплату Voxly и выплаты.
            </p>
            {transactions.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-6 text-center text-sm leading-snug text-black/55">
                Движений по балансу пока нет. Здесь появятся строки, когда вознаграждение будет
                зачтено в счёт Voxly или выплачено деньгами.
              </p>
            ) : (
              <div className="mt-2 divide-y divide-black/10 rounded-xl border border-black/10">
                {transactions.map((t) => {
                  const kind = TRANSACTION_KIND[t.kind];
                  return (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                    >
                      <span className="min-w-0 text-black">
                        {kind.label}
                        {t.note ? <span className="text-black/55"> · {t.note}</span> : null}
                      </span>
                      <span className="tabular-nums text-black/55">
                        {formatDate(t.createdAt)} ·{' '}
                        <span
                          className={`font-semibold ${
                            kind.credit ? 'text-[#166534]' : 'text-[#c2410c]'
                          }`}
                        >
                          {kind.credit ? '+' : '−'}
                          {formatRub(t.amountRub)} ₽
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="land-display text-xl tracking-[-0.03em]">Ссылки и проекты</h2>
              <p className="mt-1 text-sm text-black/55">
                Отдельный код для каждого канала — видно, что реально приносит клиентов.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setExpenseOpen((v) => !v)}
                  disabled={!hasCampaigns}
                  title={hasCampaigns ? undefined : 'Сначала создайте проект'}
                  className="land-btn-ghost min-h-10 cursor-pointer gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {expenseOpen ? (
                    <>
                      Отмена
                      <X className="h-4 w-4" aria-hidden />
                    </>
                  ) : (
                    <>
                      Добавить расход
                      <Wallet className="h-4 w-4" aria-hidden />
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setCreateOpen((v) => !v)}
                  className="land-btn min-h-10 cursor-pointer px-4 text-sm"
                >
                  {createOpen ? (
                    <>
                      Отмена
                      <X className="h-4 w-4" aria-hidden />
                    </>
                  ) : (
                    <>
                      Новая ссылка
                      <Plus className="h-4 w-4" aria-hidden />
                    </>
                  )}
                </button>
              </div>
              {hasCampaigns ? null : (
                <p className="max-w-[44ch] text-xs leading-snug text-black/50 sm:text-right">
                  Расходы считаются отдельно по каждому проекту, поэтому сначала создайте проект.
                </p>
              )}
            </div>
          </div>

          {createOpen ? (
            <form
              onSubmit={(e) => void createCampaign(e)}
              className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] p-4"
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <label className="text-xs text-black/45">
                  Название проекта
                  <Input
                    placeholder="Канал @marketing"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    required
                    autoFocus
                    className="mt-1 border-black/15 bg-white text-black"
                  />
                </label>
                <label className="text-xs text-black/45">
                  Свой код — необязательно
                  <Input
                    placeholder="MARKETING"
                    value={customCode}
                    onChange={(e) => setCustomCode(e.target.value.toUpperCase())}
                    aria-invalid={codeInvalid}
                    aria-describedby="campaign-code-status"
                    className={`mt-1 bg-white font-mono text-black ${
                      codeInvalid ? 'border-[#c2410c]' : 'border-black/15'
                    }`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={createBusy || codeInvalid || codeStatus === 'checking'}
                  className="land-btn min-h-11 cursor-pointer self-end px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {createBusy ? 'Создаём…' : 'Создать'}
                </button>
              </div>
              <p
                id="campaign-code-status"
                aria-live="polite"
                className="mt-2 flex min-h-4 items-center gap-1.5 text-xs leading-4"
              >
                {codeStatus === 'checking' ? (
                  <span className="flex items-center gap-1.5 text-black/50">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                    Проверяем, свободен ли код…
                  </span>
                ) : null}
                {codeStatus === 'free' ? (
                  <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    Код свободен
                  </span>
                ) : null}
                {codeInvalid ? (
                  <span className="flex items-center gap-1.5 font-semibold text-[#c2410c]">
                    <X className="h-3.5 w-3.5" aria-hidden />
                    {codeHint}
                  </span>
                ) : null}
                {codeStatus === 'idle' ? (
                  <span className="text-black/45">
                    Оставьте поле пустым — код придумается сам.
                  </span>
                ) : null}
              </p>
            </form>
          ) : null}

          {expenseOpen ? (
            <form
              onSubmit={(e) => void addExpense(e)}
              className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-black">Расход на продвижение</p>
                <button
                  type="button"
                  onClick={() => setExpenseOpen(false)}
                  className="cursor-pointer text-black/45 transition-colors duration-200 hover:text-black"
                  aria-label="Закрыть форму расхода"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_160px] lg:grid-cols-[1fr_160px_1fr_auto]">
                <label className="text-xs text-black/45">
                  Проект
                  <select
                    value={expenseCampaignId}
                    onChange={(e) => setExpenseCampaignId(e.target.value)}
                    required
                    autoFocus
                    className="mt-1 flex h-9 w-full cursor-pointer rounded-md border border-black/15 bg-white px-2.5 text-sm text-black shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Выберите проект</option>
                    {data.campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-black/45">
                  Сумма, ₽
                  <Input
                    type="number"
                    min={1}
                    placeholder="5000"
                    value={expenseAmount}
                    onChange={(e) => setExpenseAmount(e.target.value)}
                    required
                    className="mt-1 border-black/15 bg-white text-black"
                  />
                </label>
                <label className="text-xs text-black/45">
                  Комментарий
                  <Input
                    placeholder="Пост в канале от 12 июля"
                    value={expenseNote}
                    onChange={(e) => setExpenseNote(e.target.value)}
                    className="mt-1 border-black/15 bg-white text-black"
                  />
                </label>
                <button
                  type="submit"
                  disabled={expenseBusy}
                  className="land-btn min-h-11 cursor-pointer self-end px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {expenseBusy ? 'Сохраняем…' : 'Добавить'}
                </button>
              </div>
              <p className="mt-2 text-xs text-black/50">
                Расход вычитается из заработка проекта — колонка «Чистыми» покажет реальную отдачу
                канала.
              </p>
            </form>
          ) : null}

          <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead className="bg-[#faf8f5]">
                <tr>
                  <th className={TH}>Проект</th>
                  <th className={`${TH} text-right`}>Переходы</th>
                  <th className={`${TH} text-right`}>Рег.</th>
                  <th className={`${TH} text-right`}>Оплаты</th>
                  <th className={`${TH} text-right`}>Ждут</th>
                  <th className={`${TH} text-right`}>Заработано</th>
                  <th className={`${TH} text-right`}>Расходы</th>
                  <th className={`${TH} text-right`}>Чистыми</th>
                  <th className={TH} aria-label="Действия" />
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {rows.map((row) => (
                  <tr key={row.id} className="transition-colors duration-200 hover:bg-[#faf8f5]">
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-black">{row.name}</span>
                        {row.isMain ? <Badge variant="secondary">по умолчанию</Badge> : null}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="rounded bg-[#faf8f5] px-1.5 py-0.5 font-mono text-xs text-black/70">
                          {row.code}
                        </code>
                        <CopyButton value={row.link} size="icon" label="Скопировать ссылку" />
                      </div>
                    </td>
                    <td className={`${TD} text-right text-black/65`}>{row.clicksCount}</td>
                    <td className={`${TD} text-right text-black`}>{row.registrations}</td>
                    <td className={`${TD} text-right text-black`}>{row.paid}</td>
                    <td className={`${TD} text-right text-black/65`}>{row.pending}</td>
                    <td className={`${TD} text-right font-semibold text-black`}>
                      {formatRub(row.earnedRub)} ₽
                    </td>
                    <td className={`${TD} text-right text-black/65`}>
                      {row.expensesRub > 0 ? (
                        `−${formatRub(row.expensesRub)} ₽`
                      ) : row.isMain ? (
                        <span className="text-black/35" title={mainExpenseHint}>
                          —
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td
                      className={`${TD} text-right font-semibold ${
                        row.netRub < 0 ? 'text-[#c2410c]' : 'text-black'
                      }`}
                    >
                      {formatRub(row.netRub)} ₽
                    </td>
                    <td className="px-3 py-3 text-right">
                      {row.isMain ? (
                        <span
                          className="text-xs leading-snug text-black/40"
                          title={mainExpenseHint}
                        >
                          Расходы — по проектам
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openExpenseForm(row.id)}
                          className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                        >
                          <Wallet className="h-3.5 w-3.5" aria-hidden />
                          Расход
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasCampaigns ? null : (
            <p className="mt-3 text-sm text-black/55">
              Пока работает только основная ссылка. Создайте проект под канал — увидите отдельную
              статистику по нему и сможете записывать расходы на продвижение, чтобы считать
              прибыль.
            </p>
          )}

        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <h2 className="land-display text-xl tracking-[-0.03em]">Регистрации за период</h2>
          <p className="mt-1 text-sm text-black/55">
            Кто пришёл по вашим ссылкам и на каком этапе находится.
          </p>

          {data.referrals.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="font-semibold text-black">Регистраций за этот период нет</p>
              <p className="mx-auto mt-1 max-w-[46ch] text-sm text-black/55">
                Скопируйте ссылку из блока выше и разместите её там, где вас читают. Расширьте
                период — возможно, регистрации были раньше.
              </p>
              <button
                type="button"
                onClick={() => applyPreset('all')}
                className="land-btn-ghost mt-4 min-h-10 cursor-pointer px-4 text-sm"
              >
                Показать за всё время
              </button>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
              <table className="w-full min-w-[600px] border-collapse text-left">
                <thead className="bg-[#faf8f5]">
                  <tr>
                    <th className={TH}>Клиент</th>
                    <th className={TH}>Источник</th>
                    <th className={TH}>Регистрация</th>
                    <th className={TH}>Статус</th>
                    <th className={`${TH} text-right`}>Заработано</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {data.referrals.map((r) => (
                    <tr key={r.id} className="transition-colors duration-200 hover:bg-[#faf8f5]">
                      <td className="px-3 py-3 text-sm font-medium text-black">{r.referredSlug}</td>
                      <td className="px-3 py-3 text-sm text-black/65">{r.campaignName}</td>
                      <td className={`${TD} text-black/65`}>{formatDate(r.attributedAt)}</td>
                      <td className="px-3 py-3">
                        {r.firstPaymentAt ? (
                          <Badge variant="success">Оплатил · {formatDate(r.firstPaymentAt)}</Badge>
                        ) : (
                          <Badge variant="warning">Ждём оплату</Badge>
                        )}
                      </td>
                      <td className={`${TD} text-right font-semibold text-black`}>
                        {r.earnedRub > 0 ? `${formatRub(r.earnedRub)} ₽` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {data.expenses.length > 0 ? (
          <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
            <h2 className="land-display text-xl tracking-[-0.03em]">Расходы за период</h2>
            <div className="mt-4 divide-y divide-black/10 rounded-xl border border-black/10">
              {data.expenses.map((e) => {
                const campaign = data.campaigns.find((c) => c.id === e.campaignId);
                return (
                  <div
                    key={e.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                  >
                    <span className="text-black">
                      {campaign?.name ?? 'Проект'}
                      {e.note ? <span className="text-black/55"> · {e.note}</span> : null}
                    </span>
                    <span className="tabular-nums text-black/55">
                      {formatDate(e.spentAt)} · −{formatRub(e.amountRub)} ₽
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
    </AppShell>
  );
}
