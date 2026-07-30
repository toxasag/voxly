'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Minus, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { computeCrmCheckoutTotals } from '@/lib/crm-pricing';
import { openCrmWorkspace } from '@/lib/open-crm';
import { Button } from '@/components/ui/button';
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
    endsAt: string | null;
    seatsIncluded: number;
    extraSeats: number;
  };
  seats: { limit: number; used: number; remaining: number };
  pricing: { baseMonthly: number; extraSeatMonthly: number; seatsIncluded: number };
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

function formatRub(n: number): string {
  return n.toLocaleString('ru-RU');
}

function roleLabel(role: string): string {
  const map: Record<string, string> = {
    owner: 'Владелец',
    admin: 'Админ',
    member: 'Участник',
  };
  return map[role] || role;
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
  const [credsBusy, setCredsBusy] = useState('');
  const [passwordDraft, setPasswordDraft] = useState('');
  const [payPeriodMonths, setPayPeriodMonths] = useState<1 | 3 | 12>(1);
  const [extraSeatsToBuy, setExtraSeatsToBuy] = useState(0);

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

  const checkoutTotals = useMemo(
    () => computeCrmCheckoutTotals(payPeriodMonths, extraSeatsToBuy),
    [payPeriodMonths, extraSeatsToBuy],
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
        });
      } else {
        await startCheckout({
          productCode: 'extra_seat',
          periodMonths,
          quantity: Math.max(1, extraSeats),
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
        data.crmAccessError ||
          'Нельзя приглашать сотрудников, пока подписка на CRM не активна.',
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
  const endsAt = sub.endsAt;
  const daysLeft = endsAt
    ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86400000))
    : 0;
  const subLabel = accessLocked
    ? 'Не активна'
    : sub.isTrial
      ? 'Trial'
      : sub.isActive
        ? 'Активная'
        : data.crmInGrace
          ? 'Льготный период'
          : 'Не активна';
  const subHint = accessLocked
    ? data.crmAccessError || 'Оформите оплату, чтобы открыть CRM'
    : endsAt
      ? `до ${new Date(endsAt).toLocaleDateString('ru-RU')}${
          sub.isTrial || sub.isActive
            ? ` · ${daysLeft} дн.`
            : data.crmInGrace && data.crmGraceEndsAt
              ? ` · льготный до ${new Date(data.crmGraceEndsAt).toLocaleDateString('ru-RU')}`
              : ''
        }`
      : `после trial — ${formatRub(pricing.baseMonthly)} ₽/мес`;
  const seatLimitHint =
    sub.extraSeats > 0
      ? `${seats.used} из ${seats.limit} · ${sub.extraSeats} доп. до ${endsAt ? new Date(endsAt).toLocaleDateString('ru-RU') : '—'}`
      : `${seats.used} из ${seats.limit} занято`;

  const periodLabel = payPeriodMonths === 1 ? '1 мес' : `${payPeriodMonths} мес`;
  const combinedBusy = checkoutBusy === `combined-${payPeriodMonths}-${extraSeatsToBuy}`;
  const seatsOnlyBusy = checkoutBusy === `seats-${payPeriodMonths}-${extraSeatsToBuy}`;

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
        <CrmPortalHero
          badge={
            accessLocked
              ? 'Оплата закончилась'
              : sub.isTrial
                ? `Trial · ${daysLeft} дн.`
                : tenant.crmReady
                  ? 'CRM готов'
                  : 'Создаётся'
          }
          subtitle={
            accessLocked
              ? data.crmAccessError ||
                'CRM закрыта до оплаты. Оформите подписку ниже — доступ восстановится автоматически.'
              : isOwner
                ? 'Адрес воркспейса, тариф и команда.'
                : `Войдите в CRM напрямую: ${tenant.crmHost}`
          }
          crmReady={tenant.crmReady}
          accessLocked={accessLocked}
          opening={crmOpening}
          onOpenCrm={() => void openCrm()}
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
                <p className="text-sm opacity-90">Оформите оплату в блоке ниже — доступ откроется сразу после успешного платежа.</p>
              ) : (
                <p className="text-sm opacity-90">Обратитесь к владельцу аккаунта для продления подписки.</p>
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

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Подписка" value={subLabel} hint={subHint} />
          <Stat
            label="Осталось мест в CRM"
            value={String(seats.remaining)}
            hint={seatLimitHint}
          />
          <Stat
            label="Тариф"
            value={`${formatRub(pricing.baseMonthly)} ₽`}
            hint={`+ ${formatRub(pricing.extraSeatMonthly)} ₽ за доп. место`}
          />
          <Stat
            label="Осталось дней"
            value={sub.isActive || sub.isTrial ? String(daysLeft) : '—'}
            hint={tenant.crmReady ? 'воркспейс готов' : 'создаётся…'}
          />
        </section>

        <div className={`grid gap-4 ${isOwner ? 'lg:grid-cols-2' : ''}`}>
          <div className="rounded-2xl border border-black/10 bg-white p-5">
            <h2 className="land-display text-lg tracking-[-0.03em]">Адрес CRM</h2>
            <p className="mt-1 text-sm text-black/55">
              Сотрудники входят напрямую на этот адрес (email + пароль из приглашения).
            </p>
            <div className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                URL
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-md bg-white px-2 py-1 text-sm">{tenant.crmHost}</code>
                <CopyButton value={tenant.crmUrl} label="URL" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-black/10 px-4 py-3 text-sm">
              <span className="text-black/55">Статус</span>
              <Badge variant={tenant.crmReady ? 'default' : 'secondary'}>
                {tenant.crmReady ? 'готов' : 'создаётся'}
              </Badge>
            </div>
          </div>

          {isOwner ? (
            <div className="rounded-2xl border border-black/10 bg-white p-5">
              <h2 className="land-display text-lg tracking-[-0.03em]">Тариф и оплата</h2>
              <p className="mt-1 text-sm text-black/55">
                {sub.isTrial
                  ? `Trial до ${endsAt ? new Date(endsAt).toLocaleDateString('ru-RU') : '—'}. После — ${formatRub(pricing.baseMonthly)} ₽/мес, ${pricing.seatsIncluded} мест.`
                  : `Активна до ${endsAt ? new Date(endsAt).toLocaleDateString('ru-RU') : '—'} · ${pricing.seatsIncluded} мест${sub.extraSeats > 0 ? ` + ${sub.extraSeats} доп.` : ''} (всего ${seats.limit}).`}
              </p>

              <div className="mt-5 space-y-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                    Срок подписки
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {([1, 3, 12] as const).map((months) => {
                      const active = payPeriodMonths === months;
                      const discount = months === 12 ? 10 : 0;
                      return (
                        <button
                          key={months}
                          type="button"
                          disabled={Boolean(checkoutBusy)}
                          onClick={() => setPayPeriodMonths(months)}
                          className={
                            active
                              ? 'land-btn-amber min-h-10 px-4 text-sm'
                              : 'land-btn-ghost min-h-10 px-4 text-sm'
                          }
                        >
                          {months} мес.{discount > 0 ? ` −${discount}%` : ''}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                    Дополнительные места
                  </p>
                  <p className="mt-1 text-xs text-black/55">
                    Базово {pricing.seatsIncluded} мест. Сейчас {sub.extraSeats} доп. · всего{' '}
                    {seats.limit} мест.
                  </p>
                  <div className="mt-2 flex items-center gap-3">
                    <button
                      type="button"
                      disabled={Boolean(checkoutBusy) || extraSeatsToBuy <= 0}
                      onClick={() => setExtraSeatsToBuy((n) => Math.max(0, n - 1))}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-black/15 bg-white text-black/70 disabled:opacity-40"
                      aria-label="Меньше мест"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <span className="land-display min-w-[2ch] text-center text-xl tracking-[-0.03em]">
                      {extraSeatsToBuy}
                    </span>
                    <button
                      type="button"
                      disabled={Boolean(checkoutBusy) || extraSeatsToBuy >= 50}
                      onClick={() => setExtraSeatsToBuy((n) => Math.min(50, n + 1))}
                      className="flex h-10 w-10 items-center justify-center rounded-full border border-black/15 bg-white text-black/70 disabled:opacity-40"
                      aria-label="Больше мест"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                    <span className="text-sm text-black/55">
                      × {formatRub(pricing.extraSeatMonthly)} ₽/мес за место
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-black/55">
                      CRM Base · {periodLabel}
                    </span>
                    <span className="font-medium">{formatRub(checkoutTotals.baseTotal)} ₽</span>
                  </div>
                  {extraSeatsToBuy > 0 ? (
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-black/55">
                        Доп. места · {extraSeatsToBuy} × {periodLabel}
                      </span>
                      <span className="font-medium">{formatRub(checkoutTotals.extraTotal)} ₽</span>
                    </div>
                  ) : null}
                  {checkoutTotals.discount > 0 ? (
                    <p className="mt-2 text-xs text-black/45">
                      Скидка {checkoutTotals.discount}% за длительный период
                    </p>
                  ) : null}
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-black/10 pt-3">
                    <span className="font-semibold">Итого к оплате</span>
                    <span className="land-display text-xl tracking-[-0.03em]">
                      {formatRub(checkoutTotals.combinedTotal)} ₽
                    </span>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={Boolean(checkoutBusy)}
                    onClick={() =>
                      void pay('combined', payPeriodMonths, extraSeatsToBuy)
                    }
                    className="land-btn-amber min-h-11 w-full text-sm"
                  >
                    {combinedBusy
                      ? 'Переходим к оплате…'
                      : `Оплатить ${formatRub(checkoutTotals.combinedTotal)} ₽`}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(checkoutBusy) || extraSeatsToBuy <= 0}
                    onClick={() =>
                      void pay('seats_only', payPeriodMonths, extraSeatsToBuy)
                    }
                    className="land-btn-ghost min-h-11 w-full text-sm disabled:opacity-50"
                  >
                    {seatsOnlyBusy
                      ? 'Переходим к оплате…'
                      : extraSeatsToBuy > 0
                        ? `Только докупить места · ${formatRub(checkoutTotals.extraTotal)} ₽`
                        : 'Только докупить места'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-black/10 bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="land-display text-lg tracking-[-0.03em]">Команда CRM</h2>
            <div className="flex items-center gap-2 text-sm text-black/55">
              <Users className="h-4 w-4" />
              {seats.used} / {seats.limit} · осталось {seats.remaining}
            </div>
          </div>

          {isOwner ? (
            <form onSubmit={(e) => void invite(e)} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="email@company.ru"
                disabled={inviteBusy || seats.remaining <= 0 || accessLocked}
                className="min-h-11 flex-1 rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-black/40"
              />
              <button
                type="submit"
                disabled={inviteBusy || seats.remaining <= 0 || accessLocked}
                className="land-btn min-h-11 px-5 text-sm disabled:opacity-50"
              >
                {inviteBusy ? 'Приглашаем…' : 'Пригласить'}
              </button>
            </form>
          ) : null}

          {accessLocked && isOwner ? (
            <p className="mt-3 text-xs text-black/55">
              Приглашения недоступны, пока подписка на CRM не активна.
            </p>
          ) : null}

          {seats.remaining <= 0 && isOwner && !accessLocked ? (
            <p className="mt-3 text-xs text-black/55">
              Лимит мест исчерпан — докупите дополнительные места выше.
            </p>
          ) : null}

          <div className="mt-4 divide-y divide-black/8 rounded-xl border border-black/10">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {[m.firstName, m.lastName].filter(Boolean).join(' ') || m.email}
                  </p>
                  <p className="truncate text-xs text-black/55">{m.email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant="secondary">{roleLabel(m.role)}</Badge>
                  <Badge variant={m.hasCrmAccess ? 'default' : 'secondary'}>
                    {m.hasCrmAccess ? 'В CRM' : 'Только кабинет'}
                  </Badge>
                  {isOwner && m.role !== 'owner' ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={credsBusy === m.id || removeBusy === m.id}
                        onClick={() => void openMemberCredentials(m.id)}
                        className="h-8 gap-1.5 px-2 text-xs"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Редактировать</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={removeBusy === m.id || Boolean(credsBusy)}
                        onClick={() => void removeMember(m.id)}
                        aria-label="Удалить участника"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {inviteCreds ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invite-modal-title"
        >
          <div className="landing-root w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 id="invite-modal-title" className="land-display text-xl tracking-[-0.03em]">
              {inviteCredsMode === 'reissue'
                ? 'Пароль обновлён'
                : inviteCredsMode === 'view'
                  ? 'Доступ сотрудника'
                  : 'Доступ для сотрудника'}
            </h3>
            <p className="mt-2 text-sm text-black/55">
              {inviteCredsMode === 'view'
                ? 'Текущие данные для входа в CRM. Пароль меняется только если вы сохраните новый.'
                : inviteCredsMode === 'reissue'
                  ? 'Новый пароль сохранён. Скопируйте и передайте сотруднику — вход на CRM-адрес (не getvoxly.ru).'
                  : 'Передайте эти данные сотруднику. Вход — напрямую на CRM-адрес (не getvoxly.ru).'}
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
                  CRM URL
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="truncate">{inviteCreds.crmUrl}</code>
                  <CopyButton value={inviteCreds.crmUrl} size="icon" label="URL" />
                </div>
              </div>
              <div className="rounded-xl border border-black/10 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Email
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="truncate">{inviteCreds.email}</code>
                  <CopyButton value={inviteCreds.email} size="icon" label="Email" />
                </div>
              </div>
              <div className="rounded-xl border border-black/10 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Пароль
                </p>
                {inviteCreds.memberId ? (
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="text"
                      value={passwordDraft}
                      onChange={(e) => setPasswordDraft(e.target.value)}
                      className="min-h-9 flex-1 truncate rounded-lg border border-black/15 bg-white px-2 font-mono text-sm outline-none focus:border-black/40"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <CopyButton
                      value={passwordDraft || inviteCreds.tempPassword}
                      size="icon"
                      label="Пароль"
                    />
                  </div>
                ) : (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <code className="truncate">{inviteCreds.tempPassword}</code>
                    <CopyButton value={inviteCreds.tempPassword} size="icon" label="Пароль" />
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              {inviteCreds.memberId ? (
                <button
                  type="button"
                  className="land-btn w-full disabled:opacity-50"
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
                    ? 'min-h-11 w-full rounded-xl border border-black/15 text-sm font-medium text-black/70'
                    : 'land-btn w-full'
                }
                onClick={() => {
                  setInviteCreds(null);
                  setPasswordDraft('');
                }}
              >
                {inviteCreds.memberId ? 'Закрыть' : 'Готово'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
