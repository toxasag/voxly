'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, Minus, Plus, Trash2, UserPlus, X } from 'lucide-react';
import { GRACE_PERIOD_DAYS, PERIOD_DISCOUNTS } from '@voxly/shared';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { computeCrmCheckoutTotals } from '@/lib/crm-pricing';
import { openCrmWorkspace } from '@/lib/open-crm';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { CrmPortalHero } from '@/components/portal/crm-portal-hero';

interface CrmPayload {
  tenantRole: string;
  tenant: {
    slug: string;
    status: string;
    crmReady: boolean;
    crmSubdomain: string | null;
    crmUrl: string;
    crmHost: string;
  };
  crmAccessLocked?: boolean;
  crmAccessReason?: string;
  crmAccessError?: string | null;
  crmInGrace?: boolean;
  crmGraceEndsAt?: string | null;
  subscription: {
    isTrial: boolean;
    isActive: boolean;
    periodMonths: number;
    startsAt?: string | null;
    endsAt: string | null;
    seatsIncluded: number;
    extraSeats: number;
  };
  seats: { limit: number; used: number; remaining: number };
  pricing: {
    baseMonthly: number;
    extraSeatMonthly: number;
    seatsIncluded: number;
  };
  /** Free partner-referral remainder, holds already subtracted. */
  partnerBalanceRub?: number;
  members: Array<{
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    role: string;
    hasCrmAccess: boolean;
  }>;
}

interface InviteCreds {
  memberId?: string;
  crmUrl: string;
  email: string;
  tempPassword: string;
  twentyProvisioned: boolean;
  warning?: string;
}

type SubState = 'locked' | 'grace' | 'trial' | 'active' | 'none';

function formatRub(n: number): string {
  return n.toLocaleString('ru-RU');
}

function formatDate(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('ru-RU');
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function daysBetween(target: Date): number {
  return Math.max(0, Math.ceil((target.getTime() - Date.now()) / 86400000));
}

function addMonths(from: Date, months: number): Date {
  const next = new Date(from);
  next.setMonth(next.getMonth() + months);
  return next;
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    owner: 'Владелец',
    admin: 'Админ',
    member: 'Сотрудник',
  };
  return map[role] || role;
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

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';

export default function CrmPortalPage() {
  const router = useRouter();
  const [data, setData] = useState<CrmPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [paidNotice, setPaidNotice] = useState<'ok' | 'fail' | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState('');
  const [crmOpening, setCrmOpening] = useState(false);
  const [crmError, setCrmError] = useState('');
  const [crmFallbackUrl, setCrmFallbackUrl] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteCreds, setInviteCreds] = useState<InviteCreds | null>(null);
  const [inviteCredsMode, setInviteCredsMode] = useState<'invite' | 'view' | 'reissue'>('invite');
  const [removeBusy, setRemoveBusy] = useState('');
  const [removeConfirmId, setRemoveConfirmId] = useState('');
  const [credsBusy, setCredsBusy] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [payPeriodMonths, setPayPeriodMonths] = useState<1 | 3 | 12>(1);
  const [extraSeatsToBuy, setExtraSeatsToBuy] = useState(0);
  const [useBalance, setUseBalance] = useState(false);
  const [balanceInput, setBalanceInput] = useState('');
  const inviteInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/tenant/crm', { headers: authHeaders() });
      if (!res.ok) throw new Error('Не удалось загрузить данные CRM');
      setData((await res.json()) as CrmPayload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const paid = new URLSearchParams(window.location.search).get('paid');
    if (paid === 'ok' || paid === 'fail') {
      setPaidNotice(paid);
      router.replace('/dashboard/crm', { scroll: false });
      if (paid === 'ok') {
        // ResultURL may land slightly after Success redirect — refresh a few times.
        void (async () => {
          for (let i = 0; i < 5; i += 1) {
            await new Promise((r) => setTimeout(r, i === 0 ? 400 : 1200));
            await load();
          }
        })();
      }
    }
  }, [router, load]);

  const closeCredsModal = useCallback(() => {
    setInviteCreds(null);
    setPasswordDraft('');
  }, []);

  useEffect(() => {
    if (!inviteCreds) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeCredsModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inviteCreds, closeCredsModal]);

  const checkoutTotals = useMemo(
    () =>
      computeCrmCheckoutTotals(payPeriodMonths, extraSeatsToBuy, {
        baseMonthly: data?.pricing.baseMonthly ?? 0,
        extraSeatMonthly: data?.pricing.extraSeatMonthly ?? 0,
      }),
    [payPeriodMonths, extraSeatsToBuy, data?.pricing.baseMonthly, data?.pricing.extraSeatMonthly],
  );

  const isOwner = data?.tenantRole === 'owner';

  const openCrm = async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) return router.push('/login');
    if (data?.crmAccessLocked) {
      setCrmError(
        data.crmAccessError ||
          'Подписка на CRM закончилась. Оформите оплату ниже, чтобы снова открыть CRM.',
      );
      return;
    }
    setCrmOpening(true);
    setCrmError('');
    setCrmFallbackUrl('');
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

  const pay = async (
    mode: 'combined' | 'seats_only',
    periodMonths: number,
    extraSeats: number,
    applyBalanceRub = 0,
  ) => {
    const busyKey =
      mode === 'combined'
        ? `combined-${periodMonths}-${extraSeats}`
        : `seats-${periodMonths}-${extraSeats}`;
    setCheckoutBusy(busyKey);
    setError('');
    try {
      if (mode === 'combined') {
        await startCheckout({
          productCode: 'crm_base',
          periodMonths,
          extraSeats,
          ...(applyBalanceRub > 0 ? { applyBalanceRub } : {}),
        });
      } else {
        await startCheckout({
          productCode: 'extra_seat',
          periodMonths,
          quantity: Math.max(1, extraSeats),
          ...(applyBalanceRub > 0 ? { applyBalanceRub } : {}),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setCheckoutBusy('');
    }
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    if (data?.crmAccessLocked) {
      setError(
        data.crmAccessError || 'Нельзя приглашать сотрудников, пока подписка на CRM не активна.',
      );
      return;
    }
    setInviteBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/invite', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ email: inviteEmail.trim(), role: 'member' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || json.error || 'Не удалось пригласить');
      setInviteCreds({
        memberId: typeof json.memberId === 'string' ? json.memberId : undefined,
        crmUrl: json.crmUrl,
        email: json.email,
        tempPassword: json.tempPassword,
        twentyProvisioned: Boolean(json.twentyProvisioned),
        warning: json.warning,
      });
      setPasswordDraft(json.tempPassword || '');
      setInviteCredsMode('invite');
      setInviteEmail('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка приглашения');
    } finally {
      setInviteBusy(false);
    }
  };

  const openMemberCredentials = async (memberId: string) => {
    setCredsBusy(memberId);
    setError('');
    try {
      const res = await fetch(`/api/tenant/members/${memberId}/credentials`, {
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Не удалось открыть доступ');
      setInviteCreds({
        memberId,
        crmUrl: json.crmUrl,
        email: json.email,
        tempPassword: json.password || '',
        twentyProvisioned: Boolean(json.twentyProvisioned),
        warning: json.warning,
      });
      setPasswordDraft(json.password || '');
      setInviteCredsMode('view');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки доступа');
    } finally {
      setCredsBusy('');
    }
  };

  const saveMemberPassword = async () => {
    if (!inviteCreds?.memberId) return;
    const next = passwordDraft.trim();
    if (next.length < 8) {
      setError('Пароль: минимум 8 символов');
      return;
    }
    setCredsBusy(inviteCreds.memberId);
    setError('');
    try {
      const res = await fetch(`/api/tenant/members/${inviteCreds.memberId}/reissue-credentials`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ password: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || json.message || 'Не удалось сменить пароль');
      setInviteCreds({
        memberId: inviteCreds.memberId,
        crmUrl: json.crmUrl,
        email: json.email,
        tempPassword: json.tempPassword,
        twentyProvisioned: Boolean(json.twentyProvisioned),
        warning: json.warning,
      });
      setPasswordDraft(json.tempPassword);
      setInviteCredsMode('reissue');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка смены пароля');
    } finally {
      setCredsBusy('');
    }
  };

  const removeMember = async (memberId: string) => {
    setRemoveBusy(memberId);
    setError('');
    try {
      const res = await fetch(`/api/tenant/members/${memberId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Не удалось удалить');
      }
      setRemoveConfirmId('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setRemoveBusy('');
    }
  };

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState />
      </AppShell>
    );
  }

  if (error && !data) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">{error}</Alert>
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">Нет данных</Alert>
      </AppShell>
    );
  }

  const { tenant, subscription: sub, seats, pricing, members } = data;
  const accessLocked = Boolean(data.crmAccessLocked);
  const inGrace = Boolean(data.crmInGrace);
  const endsAtDate = sub.endsAt ? new Date(sub.endsAt) : null;
  const startsAtDate = sub.startsAt ? new Date(sub.startsAt) : null;
  const graceEndsAtDate = data.crmGraceEndsAt ? new Date(data.crmGraceEndsAt) : null;
  const daysLeft = endsAtDate ? daysBetween(endsAtDate) : 0;
  const graceDaysLeft = graceEndsAtDate ? daysBetween(graceEndsAtDate) : 0;

  const subState: SubState = accessLocked
    ? 'locked'
    : inGrace
      ? 'grace'
      : sub.isTrial && endsAtDate
        ? 'trial'
        : sub.isActive
          ? 'active'
          : 'none';

  const stateLabel: Record<SubState, string> = {
    locked: 'Доступ закрыт',
    grace: 'Льготный период',
    trial: 'Пробный период',
    active: 'Подписка активна',
    none: 'Подписки нет',
  };
  const stateBadge: Record<SubState, 'success' | 'warning' | 'destructive' | 'secondary'> = {
    locked: 'destructive',
    grace: 'warning',
    trial: 'warning',
    active: 'success',
    none: 'secondary',
  };

  const renewMonthly = pricing.baseMonthly + sub.extraSeats * pricing.extraSeatMonthly;

  const whatsNext: string = (() => {
    if (subState === 'locked') {
      return isOwner
        ? `${data.crmAccessError || 'Подписка на CRM не активна.'} Данные в CRM сохранены — доступ вернётся сразу после оплаты.`
        : `${data.crmAccessError || 'Подписка на CRM не активна.'} Данные сохранены, но открыть CRM сможет только владелец после оплаты.`;
    }
    if (subState === 'grace') {
      return `Срок подписки истёк${endsAtDate ? ` ${formatDate(endsAtDate)}` : ''}, но CRM ещё работает — это льготные ${graceDaysLeft} ${plural(graceDaysLeft, ['день', 'дня', 'дней'])}${graceEndsAtDate ? ` до ${formatDate(graceEndsAtDate)}` : ''}. Без оплаты доступ закроется.`;
    }
    if (subState === 'trial') {
      return `Пробный период бесплатный и закончится ${endsAtDate ? formatDate(endsAtDate) : '—'}. Дальше CRM стоит ${formatRub(pricing.baseMonthly)} ₽/мес за ${pricing.seatsIncluded} ${plural(pricing.seatsIncluded, ['место', 'места', 'мест'])}. ${
        isOwner
          ? 'Оплатите до конца пробного периода — CRM не закроется ни на день.'
          : 'Оплату оформляет владелец аккаунта.'
      }`;
    }
    if (subState === 'active') {
      return `Оплачено до ${endsAtDate ? formatDate(endsAtDate) : '—'}. Продление добавляет срок к этой дате, так что платить заранее безопасно. После окончания есть ещё ${GRACE_PERIOD_DAYS} ${plural(GRACE_PERIOD_DAYS, ['льготный день', 'льготных дня', 'льготных дней'])}, потом доступ закрывается.`;
    }
    return isOwner
      ? 'Активной подписки на CRM нет. Оформите оплату — воркспейс откроется сразу после успешного платежа.'
      : 'Активной подписки на CRM нет. Обратитесь к владельцу аккаунта.';
  })();

  const heroStatusValue =
    subState === 'locked'
      ? 'закрыта'
      : subState === 'grace'
        ? `льготные ${graceDaysLeft} ${plural(graceDaysLeft, ['день', 'дня', 'дней'])}`
        : subState === 'none'
          ? 'не оплачена'
          : `${daysLeft} ${plural(daysLeft, ['день', 'дня', 'дней'])}`;

  const periodTotalMs =
    startsAtDate && endsAtDate ? endsAtDate.getTime() - startsAtDate.getTime() : 0;
  const periodProgress =
    periodTotalMs > 0 && startsAtDate
      ? Math.min(100, Math.max(0, ((Date.now() - startsAtDate.getTime()) / periodTotalMs) * 100))
      : null;

  const seatsUsedPercent = seats.limit > 0 ? Math.min(100, (seats.used / seats.limit) * 100) : 0;
  const seatsFull = seats.remaining <= 0;

  const periodDiscount = PERIOD_DISCOUNTS[payPeriodMonths] ?? 0;
  const grossBase = pricing.baseMonthly * payPeriodMonths;
  const grossExtra = pricing.extraSeatMonthly * extraSeatsToBuy * payPeriodMonths;
  const discountRub =
    Math.round((grossBase + grossExtra - checkoutTotals.combinedTotal) * 100) / 100;
  const extendsTo =
    endsAtDate && endsAtDate.getTime() > Date.now() ? addMonths(endsAtDate, payPeriodMonths) : null;

  const partnerBalance = data.partnerBalanceRub ?? 0;
  const balanceCap = Math.min(partnerBalance, checkoutTotals.combinedTotal);
  const appliedBalance = useBalance
    ? Math.max(0, Math.min(balanceCap, Math.round((Number(balanceInput) || 0) * 100) / 100))
    : 0;
  const appliedToSeats = Math.min(appliedBalance, checkoutTotals.extraTotal);
  const netTotal = Math.round((checkoutTotals.combinedTotal - appliedBalance) * 100) / 100;
  const netSeatsTotal = Math.round((checkoutTotals.extraTotal - appliedToSeats) * 100) / 100;
  const balanceCoversAll = appliedBalance > 0 && netTotal <= 0;

  const periodLabel = `${payPeriodMonths} мес.`;
  const combinedBusy = checkoutBusy === `combined-${payPeriodMonths}-${extraSeatsToBuy}`;
  const seatsOnlyBusy = checkoutBusy === `seats-${payPeriodMonths}-${extraSeatsToBuy}`;
  const staff = members.filter((m) => m.role !== 'owner');

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
        <CrmPortalHero
          badge={stateLabel[subState]}
          subtitle={
            accessLocked
              ? 'CRM закрыта до оплаты. Данные сохранены — доступ восстановится сразу после платежа.'
              : isOwner
                ? 'Ваша CRM живёт на отдельном адресе. Здесь — подписка, места и доступы сотрудников.'
                : 'Вы входите в CRM по её адресу — своим email и паролем от CRM, а не от кабинета.'
          }
          crmHost={tenant.crmHost}
          crmUrl={tenant.crmUrl}
          crmReady={tenant.crmReady}
          accessLocked={accessLocked}
          opening={crmOpening}
          onOpenCrm={() => void openCrm()}
          statusLabel={subState === 'active' || subState === 'trial' ? 'Осталось' : 'Подписка'}
          statusValue={heroStatusValue}
        />

        {accessLocked ? (
          <Alert variant="error">
            <div className="space-y-1">
              <p className="font-semibold">CRM закрыта — подписка не активна</p>
              <p>
                {data.crmAccessError ||
                  'Открыть CRM и приглашать сотрудников нельзя, пока не будет оплачена подписка.'}
              </p>
              {isOwner ? (
                <p className="text-sm opacity-90">
                  Данные не удалены.{' '}
                  <a href="#oplata" className="font-semibold underline underline-offset-2">
                    Перейти к оплате
                  </a>{' '}
                  — доступ откроется сразу после успешного платежа.
                </p>
              ) : (
                <p className="text-sm opacity-90">
                  Данные не удалены. Продлить подписку может владелец аккаунта.
                </p>
              )}
            </div>
          </Alert>
        ) : null}
        {paidNotice === 'ok' ? (
          <Alert variant="success">Оплата прошла успешно. Подписка обновлена.</Alert>
        ) : null}
        {paidNotice === 'fail' ? (
          <Alert variant="error">Оплата не завершена. Можно попробовать снова ниже.</Alert>
        ) : null}
        {error ? <Alert variant="error">{error}</Alert> : null}
        {crmError ? (
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
        ) : null}

        {isOwner ? (
          <section className="grid gap-3 rounded-2xl border border-black/10 bg-white p-5 sm:grid-cols-3">
            {[
              {
                n: '1',
                title: 'У CRM свой адрес',
                text: `Воркспейс открывается на ${tenant.crmHost}. Из кабинета вы входите одной кнопкой, без пароля.`,
              },
              {
                n: '2',
                title: 'Вы приглашаете сотрудника',
                text: 'Достаточно email — мы заведём ему аккаунт в CRM и покажем логин с паролем, которые вы передадите.',
              },
              {
                n: '3',
                title: 'Сотрудник входит сам',
                text: 'Он открывает адрес CRM и вводит выданные данные. Кабинет getvoxly.ru ему не нужен.',
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
        ) : (
          <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
            <h2 className="land-display text-xl tracking-[-0.03em]">Как вы работаете с CRM</h2>
            <p className="mt-1 text-sm text-black/55">
              Вы сотрудник этого аккаунта — подписку и состав команды настраивает владелец.
            </p>
            <ul className="mt-4 space-y-2 text-sm text-black/70">
              <li>
                Вход в CRM — по адресу{' '}
                <code className="rounded bg-[#faf8f5] px-1.5 py-0.5 font-mono text-xs">
                  {tenant.crmHost}
                </code>{' '}
                с вашим email и паролем от CRM (он отличается от пароля к кабинету).
              </li>
              <li>Кнопка «Открыть CRM» выше пускает вас в воркспейс без ввода пароля.</li>
              <li>
                Забыли пароль от CRM — попросите владельца аккаунта выдать новый на этой странице.
              </li>
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="land-display text-xl tracking-[-0.03em]">Подписка на CRM</h2>
              <p className="mt-1 text-sm text-black/55">
                Один тариф на весь аккаунт: воркспейс, места для сотрудников и чат в карточках.
              </p>
            </div>
            <Badge variant={stateBadge[subState]}>{stateLabel[subState]}</Badge>
          </div>

          <div className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="land-display text-[20px] tracking-[-0.03em] text-black">
                {subState === 'locked' || subState === 'none'
                  ? 'CRM недоступна'
                  : `Действует до ${endsAtDate ? formatDate(endsAtDate) : '—'}`}
              </p>
              {subState === 'trial' || subState === 'active' ? (
                <p className="text-sm tabular-nums text-black/55">
                  осталось {daysLeft} {plural(daysLeft, ['день', 'дня', 'дней'])}
                </p>
              ) : null}
            </div>

            {periodProgress !== null && (subState === 'trial' || subState === 'active') ? (
              <div
                role="progressbar"
                aria-valuenow={Math.round(periodProgress)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Сколько периода подписки уже прошло"
                className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/10"
              >
                <div
                  className="h-full rounded-full bg-black transition-[width] duration-300"
                  style={{ width: `${periodProgress}%` }}
                />
              </div>
            ) : null}

            <p className="mt-3 max-w-[70ch] text-sm leading-snug text-black/65">{whatsNext}</p>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat
              label="Тариф"
              value={`${formatRub(pricing.baseMonthly)} ₽/мес`}
              hint={`Включено ${pricing.seatsIncluded} ${plural(pricing.seatsIncluded, ['место', 'места', 'мест'])} в CRM`}
            />
            <Stat
              label="Продление"
              value={`${formatRub(renewMonthly)} ₽/мес`}
              hint={
                sub.extraSeats > 0
                  ? `${formatRub(pricing.baseMonthly)} ₽ тариф + ${sub.extraSeats} × ${formatRub(pricing.extraSeatMonthly)} ₽ за доп. места`
                  : 'Столько стоит каждый следующий месяц'
              }
            />
            <Stat
              accent={subState === 'trial' || subState === 'grace' || subState === 'locked'}
              label={subState === 'grace' ? 'Льготных дней' : 'Осталось дней'}
              value={
                subState === 'grace'
                  ? String(graceDaysLeft)
                  : subState === 'trial' || subState === 'active'
                    ? String(daysLeft)
                    : '0'
              }
              hint={
                subState === 'grace'
                  ? 'CRM работает, но подписка уже просрочена'
                  : subState === 'locked' || subState === 'none'
                    ? 'Доступ закрыт до оплаты'
                    : `Дата окончания — ${endsAtDate ? formatDate(endsAtDate) : '—'}`
              }
            />
          </div>

          {!isOwner ? (
            <p className="mt-3 text-sm text-black/55">
              Оплатой управляет владелец аккаунта — у вас этот блок только для информации.
            </p>
          ) : null}
        </section>

        {isOwner ? (
          <section
            id="oplata"
            className="scroll-mt-6 rounded-2xl border border-black/10 bg-white p-5 sm:p-6"
          >
            <h2 className="land-display text-xl tracking-[-0.03em]">Оплата и продление</h2>
            <p className="mt-1 max-w-[70ch] text-sm text-black/55">
              Выберите срок и, если нужно, добавьте места сверх тарифа. Ниже видно, из чего
              складывается сумма.
            </p>

            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_minmax(280px,340px)]">
              <div className="space-y-5">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                    Шаг 1 · срок подписки
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {([1, 3, 12] as const).map((months) => {
                      const active = payPeriodMonths === months;
                      const discount = PERIOD_DISCOUNTS[months] ?? 0;
                      return (
                        <button
                          key={months}
                          type="button"
                          aria-pressed={active}
                          disabled={Boolean(checkoutBusy)}
                          onClick={() => setPayPeriodMonths(months)}
                          className={`min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                            active ? 'land-btn-amber' : 'land-btn-ghost'
                          }`}
                        >
                          {months} мес.{discount > 0 ? ` · −${discount}%` : ''}
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-black/55">
                    Срок добавляется к текущей дате окончания — платить заранее не значит потерять
                    оплаченные дни.
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                    Шаг 2 · дополнительные места
                  </p>
                  <p className="mt-1 text-xs text-black/55">
                    В тариф входит {pricing.seatsIncluded}{' '}
                    {plural(pricing.seatsIncluded, ['место', 'места', 'мест'])}. Сейчас куплено{' '}
                    {sub.extraSeats} доп. — всего {seats.limit}, занято {seats.used}.
                  </p>
                  <div
                    role="group"
                    aria-label="Сколько дополнительных мест купить"
                    className="mt-2 flex flex-wrap items-center gap-3"
                  >
                    <button
                      type="button"
                      disabled={Boolean(checkoutBusy) || extraSeatsToBuy <= 0}
                      onClick={() => setExtraSeatsToBuy((n) => Math.max(0, n - 1))}
                      className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-black/15 bg-white text-black/70 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Убрать одно дополнительное место"
                    >
                      <Minus className="h-4 w-4" aria-hidden />
                    </button>
                    <span
                      aria-live="polite"
                      className="land-display min-w-[2ch] text-center text-xl tabular-nums tracking-[-0.03em]"
                    >
                      {extraSeatsToBuy}
                    </span>
                    <button
                      type="button"
                      disabled={Boolean(checkoutBusy) || extraSeatsToBuy >= 50}
                      onClick={() => setExtraSeatsToBuy((n) => Math.min(50, n + 1))}
                      className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-black/15 bg-white text-black/70 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-40"
                      aria-label="Добавить одно дополнительное место"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                    </button>
                    <span className="text-sm text-black/55">
                      × {formatRub(pricing.extraSeatMonthly)} ₽/мес за место
                    </span>
                  </div>
                  {extraSeatsToBuy > 0 ? (
                    <p className="mt-2 text-xs text-black/55">
                      После оплаты в CRM станет {seats.limit + extraSeatsToBuy}{' '}
                      {plural(seats.limit + extraSeatsToBuy, ['место', 'места', 'мест'])}.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4 text-sm">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Шаг 3 · счёт
                </p>
                <div className="mt-3 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-black/55">
                      Тариф CRM
                      <br />
                      <span className="text-xs">
                        {formatRub(pricing.baseMonthly)} ₽ × {periodLabel}
                      </span>
                    </span>
                    <span className="tabular-nums font-medium">{formatRub(grossBase)} ₽</span>
                  </div>
                  {extraSeatsToBuy > 0 ? (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-black/55">
                        Дополнительные места
                        <br />
                        <span className="text-xs">
                          {extraSeatsToBuy} × {formatRub(pricing.extraSeatMonthly)} ₽ ×{' '}
                          {periodLabel}
                        </span>
                      </span>
                      <span className="tabular-nums font-medium">{formatRub(grossExtra)} ₽</span>
                    </div>
                  ) : null}
                  {discountRub > 0 ? (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-black/55">
                        Скидка за {periodLabel}
                        <br />
                        <span className="text-xs">−{periodDiscount}% от суммы</span>
                      </span>
                      <span className="tabular-nums font-medium text-[#166534]">
                        −{formatRub(discountRub)} ₽
                      </span>
                    </div>
                  ) : null}
                  {appliedBalance > 0 ? (
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-black/55">
                        Партнёрский баланс
                        <br />
                        <span className="text-xs">доступно {formatRub(partnerBalance)} ₽</span>
                      </span>
                      <span className="tabular-nums font-medium text-[#166534]">
                        −{formatRub(appliedBalance)} ₽
                      </span>
                    </div>
                  ) : null}
                </div>

                {partnerBalance > 0 ? (
                  <div className="mt-3 rounded-lg border border-black/10 bg-white px-3 py-2.5">
                    <label
                      htmlFor="use-partner-balance"
                      className="flex cursor-pointer items-start gap-2 text-sm text-black"
                    >
                      <input
                        id="use-partner-balance"
                        type="checkbox"
                        checked={useBalance}
                        disabled={Boolean(checkoutBusy)}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setUseBalance(on);
                          setBalanceInput(on ? String(balanceCap) : '');
                        }}
                        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#f5a623] disabled:cursor-not-allowed disabled:opacity-50"
                      />
                      <span className="leading-snug">
                        Зачесть партнёрский баланс
                        <span className="block text-xs text-black/50">
                          доступно {formatRub(partnerBalance)} ₽ · по умолчанию не тратится
                        </span>
                      </span>
                    </label>

                    {useBalance ? (
                      <div className="mt-2 flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <label htmlFor="apply-balance-rub" className="text-xs text-black/45">
                            Сколько зачесть, ₽
                          </label>
                          <input
                            id="apply-balance-rub"
                            type="number"
                            inputMode="numeric"
                            min={0}
                            max={balanceCap}
                            step={1}
                            value={balanceInput}
                            disabled={Boolean(checkoutBusy)}
                            onChange={(e) => setBalanceInput(e.target.value)}
                            className="mt-1 min-h-11 w-full rounded-md border border-black/15 bg-white px-3 text-sm tabular-nums text-black shadow-sm transition-colors duration-200 focus:border-black/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setBalanceInput(String(balanceCap))}
                          disabled={Boolean(checkoutBusy)}
                          className="land-btn-ghost min-h-11 min-w-9 cursor-pointer px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Всё
                        </button>
                      </div>
                    ) : null}
                    {useBalance ? (
                      <p aria-live="polite" className="mt-2 text-xs leading-snug text-black/55">
                        {(Number(balanceInput) || 0) > balanceCap
                          ? `Зачтём только ${formatRub(balanceCap)} ₽ — больше по этому счёту нельзя. `
                          : `Максимум по этому счёту — ${formatRub(balanceCap)} ₽${
                              partnerBalance > checkoutTotals.combinedTotal
                                ? ' (вся его сумма). '
                                : ' (весь свободный баланс). '
                            }`}
                        Зачтённое сразу уходит в резерв и пропадает из «Доступно» на странице
                        партнёрской программы, пока счёт не оплачен.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/10 pt-3">
                  <span className="font-semibold">Итого к оплате</span>
                  <span className="land-display text-xl tabular-nums tracking-[-0.03em]">
                    {formatRub(netTotal)} ₽
                  </span>
                </div>
                {appliedBalance > 0 ? (
                  <p className="mt-1 text-xs leading-snug text-[#166534]">
                    {balanceCoversAll
                      ? 'Счёт полностью закрывается балансом — платить картой не нужно.'
                      : `С баланса спишется ${formatRub(appliedBalance)} ₽, картой — ${formatRub(netTotal)} ₽.`}
                  </p>
                ) : null}
                {extendsTo ? (
                  <p className="mt-2 text-xs text-black/55">
                    Подписка продлится до {formatDate(extendsTo)}.
                  </p>
                ) : null}

                <div className="mt-4 flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={Boolean(checkoutBusy)}
                    onClick={() =>
                      void pay('combined', payPeriodMonths, extraSeatsToBuy, appliedBalance)
                    }
                    className="land-btn-amber min-h-11 w-full cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {combinedBusy
                      ? balanceCoversAll
                        ? 'Оформляем…'
                        : 'Переходим к оплате…'
                      : balanceCoversAll
                        ? 'Оформить за 0 ₽ — с баланса'
                        : `Оплатить ${formatRub(netTotal)} ₽`}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(checkoutBusy) || extraSeatsToBuy <= 0}
                    onClick={() =>
                      void pay('seats_only', payPeriodMonths, extraSeatsToBuy, appliedToSeats)
                    }
                    className="land-btn-ghost min-h-11 w-full cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {seatsOnlyBusy
                      ? 'Переходим к оплате…'
                      : extraSeatsToBuy > 0
                        ? `Только места · ${formatRub(netSeatsTotal)} ₽`
                        : 'Только места'}
                  </button>
                  <p className="text-xs text-black/55">
                    «Только места» докупает места на выбранный срок, не продлевая сам тариф —
                    пригодится, когда подписка ещё действует, а команда выросла.
                  </p>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <h2 className="land-display text-xl tracking-[-0.03em]">Команда CRM</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-black/55">
            Место занимает каждый, кто есть в аккаунте, включая владельца. «Доступ в CRM» значит,
            что у человека есть логин и пароль от воркспейса.
          </p>

          <div className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="land-display text-[20px] tabular-nums tracking-[-0.03em] text-black">
                Занято {seats.used} из {seats.limit}{' '}
                {plural(seats.limit, ['места', 'мест', 'мест'])}
              </p>
              <p
                className={`text-sm ${seatsFull ? 'font-semibold text-[#c2410c]' : 'text-black/55'}`}
              >
                {seatsFull
                  ? 'свободных мест нет'
                  : `свободно ${seats.remaining} ${plural(seats.remaining, ['место', 'места', 'мест'])}`}
              </p>
            </div>
            <div
              role="progressbar"
              aria-valuenow={seats.used}
              aria-valuemin={0}
              aria-valuemax={seats.limit}
              aria-label="Занято мест в CRM"
              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/10"
            >
              <div
                className={`h-full rounded-full transition-[width] duration-300 ${
                  seatsFull ? 'bg-[#c2410c]' : 'bg-black'
                }`}
                style={{ width: `${seatsUsedPercent}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-black/55">
              {pricing.seatsIncluded} {plural(pricing.seatsIncluded, ['место', 'места', 'мест'])}{' '}
              входит в тариф
              {sub.extraSeats > 0
                ? `, ещё ${sub.extraSeats} ${plural(sub.extraSeats, ['место', 'места', 'мест'])} докуплено${endsAtDate ? ` до ${formatDate(endsAtDate)}` : ''}.`
                : '. Дополнительные места покупаются отдельно.'}
            </p>
          </div>

          {isOwner ? (
            <form onSubmit={(e) => void invite(e)} className="mt-4">
              <label
                htmlFor="invite-email"
                className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
              >
                Пригласить сотрудника
              </label>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <input
                  id="invite-email"
                  ref={inviteInputRef}
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="email@company.ru"
                  disabled={inviteBusy || seatsFull || accessLocked}
                  aria-describedby="invite-hint"
                  className="min-h-11 flex-1 rounded-xl border border-black/15 bg-white px-3 text-sm outline-none transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={inviteBusy || seatsFull || accessLocked}
                  className="land-btn min-h-11 cursor-pointer px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {inviteBusy ? 'Приглашаем…' : 'Пригласить'}
                  <UserPlus className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <p id="invite-hint" className="mt-2 text-xs text-black/55">
                {accessLocked
                  ? 'Приглашения недоступны, пока подписка на CRM не активна.'
                  : seatsFull
                    ? 'Мест не осталось — докупите дополнительные места в блоке «Оплата и продление».'
                    : 'Мы создадим сотруднику аккаунт в CRM и покажем логин с паролем — передайте их лично, письма пока не отправляются.'}
              </p>
            </form>
          ) : null}

          <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead className="bg-[#faf8f5]">
                <tr>
                  <th className={TH}>Сотрудник</th>
                  <th className={TH}>Роль</th>
                  <th className={TH}>Доступ в CRM</th>
                  {isOwner ? <th className={`${TH} text-right`}>Действия</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {members.map((m) => (
                  <tr key={m.id} className="transition-colors duration-200 hover:bg-[#faf8f5]">
                    <td className="px-3 py-3">
                      <p className="font-medium text-black">
                        {[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-black/55">{m.email}</p>
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant="secondary">{roleLabel(m.role)}</Badge>
                    </td>
                    <td className="px-3 py-3">
                      {m.hasCrmAccess ? (
                        <Badge variant="success">Есть вход</Badge>
                      ) : (
                        <Badge variant="warning">Только кабинет</Badge>
                      )}
                    </td>
                    {isOwner ? (
                      <td className="px-3 py-3 text-right">
                        {m.role !== 'owner' ? (
                          removeConfirmId === m.id ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <span className="text-xs text-black/55">Удалить из CRM?</span>
                              <button
                                type="button"
                                disabled={removeBusy === m.id}
                                onClick={() => void removeMember(m.id)}
                                className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-[#c2410c]/40 bg-[#fff5f0] px-3 text-xs font-semibold text-[#c2410c] transition-colors duration-200 hover:border-[#c2410c] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {removeBusy === m.id ? 'Удаляем…' : 'Да, удалить'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setRemoveConfirmId('')}
                                className="inline-flex min-h-11 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                              >
                                Отмена
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <button
                                type="button"
                                disabled={credsBusy === m.id || removeBusy === m.id}
                                onClick={() => void openMemberCredentials(m.id)}
                                className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <KeyRound className="h-3.5 w-3.5" aria-hidden />
                                {credsBusy === m.id ? 'Открываем…' : 'Доступ и пароль'}
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(credsBusy) || Boolean(removeBusy)}
                                onClick={() => setRemoveConfirmId(m.id)}
                                aria-label={`Удалить сотрудника ${m.email}`}
                                className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-black/15 text-black/55 transition-colors duration-200 hover:border-[#c2410c]/50 hover:text-[#c2410c] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </div>
                          )
                        ) : (
                          <span className="text-xs text-black/45">—</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {staff.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="font-semibold text-black">Сотрудников пока нет</p>
              <p className="mx-auto mt-1 max-w-[52ch] text-sm text-black/55">
                {isOwner
                  ? 'В CRM работаете только вы. Добавьте коллегу — он получит собственный вход, свои сделки и переписку в карточках.'
                  : 'Кроме владельца в CRM пока никого нет.'}
              </p>
              {isOwner ? (
                <button
                  type="button"
                  disabled={seatsFull || accessLocked}
                  onClick={() => inviteInputRef.current?.focus()}
                  className="land-btn-ghost mt-4 min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Пригласить первого сотрудника
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      {inviteCreds ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="presentation"
          onClick={closeCredsModal}
        >
          <div
            className="landing-root max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="invite-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="invite-modal-title" className="land-display text-xl tracking-[-0.03em]">
              {inviteCredsMode === 'reissue'
                ? 'Пароль обновлён'
                : inviteCredsMode === 'view'
                  ? 'Доступ сотрудника'
                  : 'Доступ для сотрудника'}
            </h3>
            <p className="mt-2 text-sm text-black/55">
              {inviteCredsMode === 'view'
                ? 'Текущие данные для входа в CRM. Пароль меняется, только если вы сохраните новый.'
                : inviteCredsMode === 'reissue'
                  ? 'Новый пароль сохранён. Скопируйте и передайте сотруднику — вход на CRM-адрес, не на getvoxly.ru.'
                  : 'Передайте эти данные сотруднику. Вход — напрямую на CRM-адрес, не на getvoxly.ru.'}
            </p>
            {!inviteCreds.twentyProvisioned ? (
              <Alert className="mt-3" variant="error">
                {inviteCreds.warning || 'Пользователь в CRM не создан. Попробуйте снова.'}
              </Alert>
            ) : inviteCreds.warning ? (
              <Alert className="mt-3" variant="error">
                {inviteCreds.warning}
              </Alert>
            ) : inviteCredsMode === 'reissue' ? (
              <Alert className="mt-3" variant="success">
                Пароль обновлён. Аккаунт в CRM готов.
              </Alert>
            ) : inviteCredsMode === 'invite' ? (
              <Alert className="mt-3" variant="success">
                Аккаунт в CRM создан.
              </Alert>
            ) : null}
            <div className="mt-4 space-y-3 text-sm">
              <div className="rounded-xl border border-black/10 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Адрес входа
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="truncate">{inviteCreds.crmUrl}</code>
                  <CopyButton
                    value={inviteCreds.crmUrl}
                    size="icon"
                    label="Скопировать адрес"
                    className="h-11 w-11 shrink-0 cursor-pointer"
                  />
                </div>
              </div>
              <div className="rounded-xl border border-black/10 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Email
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="truncate">{inviteCreds.email}</code>
                  <CopyButton
                    value={inviteCreds.email}
                    size="icon"
                    label="Скопировать email"
                    className="h-11 w-11 shrink-0 cursor-pointer"
                  />
                </div>
              </div>
              <div className="rounded-xl border border-black/10 px-3 py-2">
                <label
                  htmlFor="member-password"
                  className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
                >
                  Пароль от CRM
                </label>
                {inviteCreds.memberId ? (
                  <>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        id="member-password"
                        type="text"
                        value={passwordDraft}
                        onChange={(e) => setPasswordDraft(e.target.value)}
                        className="min-h-11 flex-1 truncate rounded-lg border border-black/15 bg-white px-2 font-mono text-sm outline-none transition-colors duration-200 focus:border-black/40"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <CopyButton
                        value={passwordDraft || inviteCreds.tempPassword}
                        size="icon"
                        label="Скопировать пароль"
                        className="h-11 w-11 shrink-0 cursor-pointer"
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-black/55">
                      Минимум 8 символов. Пароль применится только после «Сохранить новый пароль».
                    </p>
                  </>
                ) : (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code className="truncate">{inviteCreds.tempPassword}</code>
                    <CopyButton
                      value={inviteCreds.tempPassword}
                      size="icon"
                      label="Скопировать пароль"
                      className="h-11 w-11 shrink-0 cursor-pointer"
                    />
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              {inviteCreds.memberId ? (
                <button
                  type="button"
                  className="land-btn w-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={
                    Boolean(credsBusy) ||
                    passwordDraft.trim().length < 8 ||
                    passwordDraft.trim() === inviteCreds.tempPassword
                  }
                  onClick={() => void saveMemberPassword()}
                >
                  {credsBusy === inviteCreds.memberId ? 'Сохраняем…' : 'Сохранить новый пароль'}
                </button>
              ) : null}
              <button
                type="button"
                className={
                  inviteCreds.memberId
                    ? 'inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-black/15 text-sm font-medium text-black/70 transition-colors duration-200 hover:border-black/35 hover:text-black'
                    : 'land-btn w-full cursor-pointer'
                }
                onClick={closeCredsModal}
              >
                {inviteCreds.memberId ? (
                  <>
                    Закрыть
                    <X className="h-4 w-4" aria-hidden />
                  </>
                ) : (
                  'Готово'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
