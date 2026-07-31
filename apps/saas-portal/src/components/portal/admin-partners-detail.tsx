'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, ShieldOff, ShieldCheck } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { Badge } from '@/components/ui/badge';
import {
  REFERRAL_PRODUCT_SCOPES,
  normalizeReferralProductScope,
  type ReferralProductScope,
} from '@voxly/shared';
import {
  RuleFields,
  ScopeField,
  formatRub,
  rewardLabel,
  type RuleDraft,
} from '@/components/portal/admin-partners-rule';
import {
  formatWithdrawalDate,
  normalizeWithdrawal,
  withdrawalStatusMeta,
  type AdminWithdrawalRaw,
} from '@/components/portal/admin-withdrawals-queue';

type TxKind = 'payout' | 'manual_credit' | 'manual_debit';

type PartnerDetail = {
  tenant: { id: string; slug: string; ownerEmail: string | null; status: string };
  rule: {
    type: string;
    value: number;
    durationMonths: number | null;
    productScope: string;
    isOverride: boolean;
  };
  balanceRub: number;
  earnedAllTimeRub: number;
  paidOutRub: number;
  mainCode: { id: string; code: string; isActive: boolean; clicksCount: number } | null;
  campaigns: Array<{
    id: string;
    name: string;
    code: string;
    isActive: boolean;
    clicksCount: number;
    referrals: number;
    paid: number;
    earnedRub: number;
  }>;
  referrals: Array<{
    id: string;
    referredTenantId: string;
    referredSlug: string;
    campaignId: string | null;
    campaignName: string;
    attributedAt: string;
    firstPaymentAt: string | null;
    status: string;
    earnedRub: number;
  }>;
  transactions: Array<{
    id: string;
    kind: TxKind;
    amountRub: number;
    note: string | null;
    createdAt: string;
  }>;
  withdrawals?: AdminWithdrawalRaw[];
};

const TX_KINDS: Array<{ value: TxKind; label: string; hint: string }> = [
  {
    value: 'payout',
    label: 'Выплата партнёру',
    hint: 'Деньги ушли партнёру — баланс уменьшается. Больше баланса выплатить нельзя.',
  },
  {
    value: 'manual_credit',
    label: 'Начисление вручную',
    hint: 'Баланс увеличивается: компенсация, бонус, исправление недочёта.',
  },
  {
    value: 'manual_debit',
    label: 'Списание вручную',
    hint: 'Баланс уменьшается без выплаты — так забирают ошибочно начисленное.',
  },
];

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';
const TD = 'px-3 py-2.5 text-sm';
const FIELD =
  'mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-black/40';
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: '2-digit' });
}

function referralStatus(status: string): { label: string; variant: 'success' | 'warning' | 'secondary' } {
  if (status === 'earned') return { label: 'Начислено', variant: 'success' };
  if (status === 'cancelled') return { label: 'Привязка отменена', variant: 'secondary' };
  return { label: 'Ждёт оплаты', variant: 'warning' };
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-black/10 bg-white px-3.5 py-2.5">
      <p className={LABEL}>{label}</p>
      <p className="land-display mt-1 text-[22px] tabular-nums tracking-[-0.03em] text-black">
        {value}
      </p>
      {hint ? <p className="mt-0.5 text-xs leading-snug text-black/55">{hint}</p> : null}
    </div>
  );
}

function SubHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-black">{title}</h4>
      {note ? <p className="mt-1 max-w-[74ch] text-xs leading-snug text-black/55">{note}</p> : null}
    </div>
  );
}

export function AdminPartnerDetail({
  tenantId,
  blocked,
  globalRuleLabel,
  onError,
  onNotice,
  onMutated,
}: {
  tenantId: string;
  blocked: boolean;
  globalRuleLabel: string;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onMutated: () => void;
}) {
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const [ruleDraft, setRuleDraft] = useState<RuleDraft | null>(null);
  const [ruleScope, setRuleScope] = useState<ReferralProductScope>(REFERRAL_PRODUCT_SCOPES.ALL);
  const [txKind, setTxKind] = useState<TxKind>('payout');
  const [txAmount, setTxAmount] = useState('');
  const [txNote, setTxNote] = useState('');
  const [txConfirm, setTxConfirm] = useState(false);
  const [cancelId, setCancelId] = useState('');
  const [blockConfirm, setBlockConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/referrals/partners/${tenantId}`, {
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить партнёра');
      const payload = json as PartnerDetail;
      setDetail(payload);
      const hasRule = payload.rule.type !== 'none';
      setRuleDraft({
        type: hasRule ? payload.rule.type : 'percent_recurring',
        value: hasRule ? payload.rule.value : 20,
        durationMonths: hasRule ? payload.rule.durationMonths : null,
      });
      setRuleScope(normalizeReferralProductScope(payload.rule.productScope));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [tenantId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = async (
    key: string,
    url: string,
    method: 'PUT' | 'POST' | 'PATCH',
    body: unknown,
    notice: string,
  ) => {
    setBusy(key);
    onError('');
    onNotice('');
    try {
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось выполнить операцию');
      onNotice(notice);
      await load();
      onMutated();
      return true;
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Ошибка');
      return false;
    } finally {
      setBusy('');
    }
  };

  if (loading || !detail || !ruleDraft) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-black/15 bg-[#faf8f5] px-4 py-6 text-sm text-black/55">
        <Loader2 aria-hidden className="h-4 w-4 animate-spin" />
        Загружаем данные партнёра…
      </div>
    );
  }

  const amount = Number(txAmount);
  const amountValid = Number.isFinite(amount) && amount > 0;
  const balanceAfter = detail.balanceRub + (txKind === 'manual_credit' ? amount : -amount);
  const exceedsBalance = txKind === 'payout' && amountValid && amount > detail.balanceRub;
  const goesNegative = txKind !== 'manual_credit' && amountValid && balanceAfter < 0;
  const txKindMeta = TX_KINDS.find((k) => k.value === txKind)!;
  const canSubmitTx = amountValid && !exceedsBalance;
  const pendingCancel = detail.referrals.find((r) => r.id === cancelId);
  const mainCode = detail.mainCode;
  const withdrawals = (detail.withdrawals ?? []).map(normalizeWithdrawal);
  const pendingWithdrawals = withdrawals.filter((w) => w.status === 'pending');
  const pendingWithdrawalRub = pendingWithdrawals.reduce((sum, w) => sum + w.amountRub, 0);

  const submitTx = async () => {
    if (!canSubmitTx) return;
    const ok = await mutate(
      'tx',
      `/api/admin/referrals/partners/${tenantId}/transactions`,
      'POST',
      { kind: txKind, amountRub: amount, note: txNote.trim() || undefined },
      `${txKindMeta.label}: ${formatRub(amount)} ₽ · ${detail.tenant.slug}`,
    );
    if (ok) {
      setTxAmount('');
      setTxNote('');
      setTxConfirm(false);
    }
  };

  const prefillDebit = (r: PartnerDetail['referrals'][number]) => {
    setTxKind('manual_debit');
    setTxAmount(String(Math.round(r.earnedRub)));
    setTxNote(`Откат начисления по ${r.referredSlug}`);
    setTxConfirm(false);
  };

  return (
    <div className="space-y-4 rounded-xl border border-black/15 bg-[#faf8f5] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-black">{detail.tenant.slug}</p>
            {blocked ? <Badge variant="destructive">Заблокирован</Badge> : null}
            {detail.rule.isOverride ? (
              <Badge variant="warning">Персональная ставка</Badge>
            ) : (
              <Badge variant="secondary">Общая ставка</Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-black/55">
            {detail.tenant.ownerEmail || 'без email'} · статус кабинета {detail.tenant.status}
          </p>
        </div>
        <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-3">
          <MiniStat label="Баланс" value={`${formatRub(detail.balanceRub)} ₽`} hint="к выплате" />
          <MiniStat
            label="Начислено"
            value={`${formatRub(detail.earnedAllTimeRub)} ₽`}
            hint="за всё время"
          />
          <MiniStat label="Выплачено" value={`${formatRub(detail.paidOutRub)} ₽`} hint="закрыто" />
        </div>
      </div>

      <section className="rounded-xl border border-black/10 bg-white p-4">
        <SubHeading
          title="Ставка этого партнёра"
          note={
            detail.rule.isOverride
              ? `Сейчас действует персональная ставка: ${rewardLabel(detail.rule)}. Общая ставка платформы — ${globalRuleLabel}.`
              : `Партнёр идёт по общей ставке: ${globalRuleLabel}. Задайте персональную, если договорились об особых условиях.`
          }
        />
        <div className="mt-3">
          <RuleFields
            draft={ruleDraft}
            onChange={setRuleDraft}
            disabled={busy === 'rule' || busy === 'rule-reset'}
            idPrefix={`rule-${tenantId}`}
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <ScopeField
            value={ruleScope}
            onChange={setRuleScope}
            disabled={busy === 'rule' || busy === 'rule-reset'}
            idPrefix={`rule-${tenantId}`}
          />
        </div>
        <p className="mt-2 text-xs leading-snug text-black/55">
          Новая ставка применится только к будущим начислениям — уже начисленное не пересчитывается.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy === 'rule' || ruleDraft.value < 0}
            onClick={() =>
              void mutate(
                'rule',
                `/api/admin/referrals/partners/${tenantId}/rule`,
                'PUT',
                {
                  type: ruleDraft.type,
                  value: ruleDraft.value,
                  durationMonths: ruleDraft.durationMonths ?? undefined,
                  productScope: ruleScope,
                },
                `Персональная ставка ${detail.tenant.slug}: ${rewardLabel(ruleDraft)}`,
              )
            }
            className="land-btn min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'rule' ? 'Сохраняем…' : 'Сохранить персональную ставку'}
          </button>
          {detail.rule.isOverride ? (
            <button
              type="button"
              disabled={busy === 'rule-reset'}
              onClick={() =>
                void mutate(
                  'rule-reset',
                  `/api/admin/referrals/partners/${tenantId}/rule`,
                  'PUT',
                  { reset: true },
                  `${detail.tenant.slug} снова на общей ставке`,
                )
              }
              className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'rule-reset' ? 'Сбрасываем…' : 'Вернуть общую ставку'}
            </button>
          ) : null}
        </div>
      </section>

      {withdrawals.length > 0 ? (
        <section className="rounded-xl border border-black/10 bg-white p-4">
          <SubHeading
            title="Заявки на вывод"
            note="Сумма заявки списывается с баланса сразу при подаче. Отметка «Выплачено» баланс не меняет, отказ возвращает деньги партнёру. Решения принимаются в разделе «03 · Заявки на вывод»."
          />
          <ul className="mt-3 divide-y divide-black/10 rounded-xl border border-black/10">
            {withdrawals.map((w) => {
              const meta = withdrawalStatusMeta(w.status);
              return (
                <li key={w.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2.5">
                  <span className="whitespace-nowrap text-xs tabular-nums text-black/55">
                    {formatWithdrawalDate(w.createdAt)}
                  </span>
                  <span className="whitespace-nowrap text-sm font-semibold tabular-nums text-[#c2410c]">
                    {formatRub(w.amountRub)} ₽
                  </span>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  {w.payoutDetails ? (
                    <code className="min-w-0 flex-1 break-words font-mono text-xs text-black/65">
                      {w.payoutDetails}
                    </code>
                  ) : null}
                  {w.decisionNote ? (
                    <p className="w-full text-xs leading-snug text-black/55">
                      Причина: {w.decisionNote}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="rounded-xl border border-black/10 bg-white p-4">
        <SubHeading
          title="Деньги: выплаты и корректировки"
          note="Выплата закрывает долг перед партнёром. Начисление и списание вручную — для исправлений: они меняют баланс, но не трогают историю рефералов."
        />
        {pendingWithdrawals.length > 0 ? (
          <p className="mt-2 flex items-start gap-2 rounded-xl border border-[#f5a623]/50 bg-[#fffaf0] px-3.5 py-2.5 text-xs leading-snug text-black/75">
            <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#c2410c]" />
            <span>
              У партнёра есть{' '}
              {pendingWithdrawals.length > 1
                ? `${pendingWithdrawals.length} заявки на ${formatRub(pendingWithdrawalRub)} ₽`
                : `заявка на ${formatRub(pendingWithdrawalRub)} ₽`}{' '}
              — ручная выплата её не закроет. Эти деньги уже списаны с баланса, так что заплатив
              вручную вы переведёте одну и ту же сумму дважды. Закройте заявку в разделе «03 · Заявки
              на вывод».
            </span>
          </p>
        ) : null}
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block text-sm" htmlFor={`tx-kind-${tenantId}`}>
            <span className={LABEL}>Операция</span>
            <select
              id={`tx-kind-${tenantId}`}
              value={txKind}
              onChange={(e) => {
                setTxKind(e.target.value as TxKind);
                setTxConfirm(false);
              }}
              className={`${FIELD} cursor-pointer`}
            >
              {TX_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm" htmlFor={`tx-amount-${tenantId}`}>
            <span className={LABEL}>Сумма, ₽</span>
            <input
              id={`tx-amount-${tenantId}`}
              type="number"
              min={1}
              step={100}
              inputMode="numeric"
              value={txAmount}
              onChange={(e) => {
                setTxAmount(e.target.value);
                setTxConfirm(false);
              }}
              className={`${FIELD} tabular-nums`}
            />
          </label>
          <label className="block text-sm" htmlFor={`tx-note-${tenantId}`}>
            <span className={LABEL}>Комментарий</span>
            <input
              id={`tx-note-${tenantId}`}
              type="text"
              placeholder="Перевод на карту 14 июля"
              value={txNote}
              onChange={(e) => setTxNote(e.target.value)}
              className={FIELD}
            />
          </label>
        </div>

        <p className="mt-2 text-xs leading-snug text-black/55">{txKindMeta.hint}</p>

        {amountValid ? (
          <div
            className={`mt-3 rounded-xl border px-3.5 py-3 text-sm ${
              exceedsBalance
                ? 'border-destructive/30 bg-destructive/[0.04] text-destructive'
                : 'border-black/10 bg-[#faf8f5] text-black/75'
            }`}
          >
            {exceedsBalance ? (
              <p className="font-semibold">
                Нельзя выплатить {formatRub(amount)} ₽ — на балансе только{' '}
                {formatRub(detail.balanceRub)} ₽.
              </p>
            ) : (
              <p>
                {txKindMeta.label} <strong className="tabular-nums">{formatRub(amount)} ₽</strong> ·
                баланс станет{' '}
                <strong className="tabular-nums">{formatRub(balanceAfter)} ₽</strong> (сейчас{' '}
                {formatRub(detail.balanceRub)} ₽)
              </p>
            )}
            {goesNegative && !exceedsBalance ? (
              <p className="mt-1 text-xs font-medium text-[#c2410c]">
                Баланс уйдёт в минус — списываете больше, чем начислено.
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {txConfirm && canSubmitTx ? (
            <>
              <button
                type="button"
                disabled={busy === 'tx'}
                onClick={() => void submitTx()}
                className="land-btn-amber min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'tx'
                  ? 'Проводим…'
                  : `Подтвердить: ${txKindMeta.label.toLowerCase()} ${formatRub(amount)} ₽`}
              </button>
              <button
                type="button"
                onClick={() => setTxConfirm(false)}
                className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
              >
                Отмена
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!canSubmitTx}
              onClick={() => setTxConfirm(true)}
              title={canSubmitTx ? undefined : 'Укажите сумму в пределах баланса'}
              className="land-btn min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              Провести операцию
            </button>
          )}
        </div>

        {detail.transactions.length > 0 ? (
          <div className="mt-4 divide-y divide-black/10 rounded-xl border border-black/10">
            {detail.transactions.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-sm"
              >
                <span className="min-w-0 text-black">
                  {TX_KINDS.find((k) => k.value === t.kind)?.label ?? t.kind}
                  {t.note ? <span className="text-black/55"> · {t.note}</span> : null}
                </span>
                <span className="tabular-nums text-black/55">
                  {formatDate(t.createdAt)} ·{' '}
                  <strong
                    className={t.kind === 'manual_credit' ? 'text-black' : 'text-[#c2410c]'}
                  >
                    {t.kind === 'manual_credit' ? '+' : '−'}
                    {formatRub(t.amountRub)} ₽
                  </strong>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-xs text-black/45">Операций по этому партнёру ещё не было.</p>
        )}
      </section>

      <section className="rounded-xl border border-black/10 bg-white p-4">
        <SubHeading
          title="Ссылки партнёра"
          note="Выключенная ссылка перестаёт закреплять новые регистрации. Уже привязанные клиенты остаются за партнёром."
        />
        <div className="mt-3 overflow-x-auto rounded-xl border border-black/10">
          <table className="w-full min-w-[640px] text-left">
            <thead className="bg-[#faf8f5]">
              <tr>
                <th className={TH}>Ссылка</th>
                <th className={`${TH} text-right`}>Переходы</th>
                <th className={`${TH} text-right`}>Регистрации</th>
                <th className={`${TH} text-right`}>Оплаты</th>
                <th className={`${TH} text-right`}>Начислено</th>
                <th className={TH}>Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {mainCode ? (
                <tr className="transition-colors duration-200 hover:bg-[#faf8f5]">
                  <td className={TD}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-black">Основная ссылка</span>
                      <code className="rounded bg-[#faf8f5] px-1.5 py-0.5 font-mono text-xs text-black/70">
                        {mainCode.code}
                      </code>
                    </div>
                  </td>
                  <td className={`${TD} text-right tabular-nums text-black/65`}>
                    {mainCode.clicksCount}
                  </td>
                  <td className={`${TD} text-right text-black/35`}>—</td>
                  <td className={`${TD} text-right text-black/35`}>—</td>
                  <td className={`${TD} text-right text-black/35`}>—</td>
                  <td className={TD}>
                    <button
                      type="button"
                      disabled={busy === 'code'}
                      onClick={() =>
                        void mutate(
                          'code',
                          `/api/admin/referrals/codes/${mainCode.id}`,
                          'PATCH',
                          { isActive: !mainCode.isActive },
                          mainCode.isActive
                            ? `Основная ссылка ${mainCode.code} выключена`
                            : `Основная ссылка ${mainCode.code} включена`,
                        )
                      }
                      className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {mainCode.isActive ? 'Активна · выключить' : 'Выключена · включить'}
                    </button>
                  </td>
                </tr>
              ) : null}
              {detail.campaigns.map((c) => (
                <tr key={c.id} className="transition-colors duration-200 hover:bg-[#faf8f5]">
                  <td className={TD}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-black">{c.name}</span>
                      <code className="rounded bg-[#faf8f5] px-1.5 py-0.5 font-mono text-xs text-black/70">
                        {c.code}
                      </code>
                    </div>
                  </td>
                  <td className={`${TD} text-right tabular-nums text-black/65`}>{c.clicksCount}</td>
                  <td className={`${TD} text-right tabular-nums text-black`}>{c.referrals}</td>
                  <td className={`${TD} text-right tabular-nums text-black`}>{c.paid}</td>
                  <td className={`${TD} text-right font-semibold tabular-nums text-black`}>
                    {formatRub(c.earnedRub)} ₽
                  </td>
                  <td className={TD}>
                    <button
                      type="button"
                      disabled={busy === `campaign-${c.id}`}
                      onClick={() =>
                        void mutate(
                          `campaign-${c.id}`,
                          `/api/admin/referrals/campaigns/${c.id}`,
                          'PATCH',
                          { isActive: !c.isActive },
                          c.isActive
                            ? `Проект «${c.name}» выключен`
                            : `Проект «${c.name}» включён`,
                        )
                      }
                      className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {c.isActive ? 'Активен · выключить' : 'Выключен · включить'}
                    </button>
                  </td>
                </tr>
              ))}
              {!mainCode && detail.campaigns.length === 0 ? (
                <tr>
                  <td colSpan={6} className={`${TD} text-black/55`}>
                    Партнёр ещё не создал ни одной ссылки.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border border-black/10 bg-white p-4">
        <SubHeading
          title="Приведённые клиенты"
          note="Отмена привязки убирает клиента из статистики партнёра, но не возвращает уже начисленные деньги — они остаются на балансе. Чтобы забрать начисленное, проведите списание вручную."
        />
        {detail.referrals.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-6 text-center">
            <p className="text-sm font-semibold text-black">Клиентов пока нет</p>
            <p className="mx-auto mt-1 max-w-[48ch] text-xs text-black/55">
              По ссылкам партнёра ещё никто не зарегистрировался.
            </p>
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-xl border border-black/10">
            <table className="w-full min-w-[760px] text-left">
              <thead className="bg-[#faf8f5]">
                <tr>
                  <th className={TH}>Клиент</th>
                  <th className={TH}>Источник</th>
                  <th className={TH}>Регистрация</th>
                  <th className={TH}>Оплата</th>
                  <th className={TH}>Статус</th>
                  <th className={`${TH} text-right`}>Начислено</th>
                  <th className={TH} aria-label="Действия" />
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10">
                {detail.referrals.map((r) => {
                  const status = referralStatus(r.status);
                  const cancelled = r.status === 'cancelled';
                  return (
                    <tr key={r.id} className="transition-colors duration-200 hover:bg-[#faf8f5]">
                      <td className={`${TD} font-medium text-black`}>{r.referredSlug}</td>
                      <td className={`${TD} text-black/65`}>{r.campaignName}</td>
                      <td className={`${TD} tabular-nums text-black/65`}>
                        {formatDate(r.attributedAt)}
                      </td>
                      <td className={`${TD} tabular-nums text-black/65`}>
                        {r.firstPaymentAt ? formatDate(r.firstPaymentAt) : '—'}
                      </td>
                      <td className={TD}>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </td>
                      <td className={`${TD} text-right font-semibold tabular-nums text-black`}>
                        {r.earnedRub > 0 ? `${formatRub(r.earnedRub)} ₽` : '—'}
                      </td>
                      <td className={`${TD} text-right`}>
                        <button
                          type="button"
                          disabled={busy === `ref-${r.id}`}
                          onClick={() => {
                            if (cancelled) {
                              void mutate(
                                `ref-${r.id}`,
                                `/api/admin/referrals/referrals/${r.id}`,
                                'PATCH',
                                { status: 'attributed' },
                                `${r.referredSlug} снова закреплён за партнёром`,
                              );
                              return;
                            }
                            setCancelId(cancelId === r.id ? '' : r.id);
                          }}
                          aria-expanded={cancelled ? undefined : cancelId === r.id}
                          className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {cancelled ? 'Вернуть привязку' : 'Отменить привязку'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pendingCancel ? (
          <div className="mt-3 rounded-xl border border-black/15 bg-[#faf8f5] p-4">
            <p className="text-sm font-semibold text-black">
              Отменить привязку клиента «{pendingCancel.referredSlug}»?
            </p>
            <p className="mt-1 max-w-[74ch] text-xs leading-snug text-black/65">
              Клиент пропадёт из статистики партнёра и новых начислений по нему не будет.
              {pendingCancel.earnedRub > 0
                ? ` Уже начисленные ${formatRub(pendingCancel.earnedRub)} ₽ останутся на балансе — деньги отмена не забирает. Чтобы вернуть их платформе, проведите списание вручную.`
                : ' Начислений по нему ещё не было, так что баланс не изменится.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy === `ref-${pendingCancel.id}`}
                onClick={() =>
                  void mutate(
                    `ref-${pendingCancel.id}`,
                    `/api/admin/referrals/referrals/${pendingCancel.id}`,
                    'PATCH',
                    { status: 'cancelled' },
                    `Привязка ${pendingCancel.referredSlug} отменена`,
                  ).then((ok) => {
                    if (ok) setCancelId('');
                  })
                }
                className="min-h-11 cursor-pointer rounded-xl border border-destructive/30 px-4 text-sm font-semibold text-destructive transition-colors duration-200 hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === `ref-${pendingCancel.id}` ? 'Отменяем…' : 'Отменить привязку'}
              </button>
              {pendingCancel.earnedRub > 0 ? (
                <button
                  type="button"
                  onClick={() => prefillDebit(pendingCancel)}
                  className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
                >
                  Подготовить списание {formatRub(pendingCancel.earnedRub)} ₽
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setCancelId('')}
                className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
              >
                Ничего не менять
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-destructive/25 bg-destructive/[0.03] p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-destructive">
              {blocked ? 'Партнёр заблокирован' : 'Блокировка партнёра'}
            </p>
            <p className="mt-1 max-w-[74ch] text-xs leading-snug text-black/65">
              {blocked
                ? 'Ссылки не работают, новых начислений нет. Баланс и история сохранены — разблокировка вернёт всё как было.'
                : 'Все ссылки партнёра перестанут работать, новые начисления прекратятся. Баланс и история останутся — это не удаление и не списание денег.'}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {blocked ? (
            <button
              type="button"
              disabled={busy === 'block'}
              onClick={() =>
                void mutate(
                  'block',
                  `/api/admin/referrals/partners/${tenantId}/block`,
                  'PATCH',
                  { blocked: false },
                  `${detail.tenant.slug} разблокирован`,
                )
              }
              className="land-btn-ghost min-h-11 cursor-pointer gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ShieldCheck aria-hidden className="h-4 w-4" />
              {busy === 'block' ? 'Снимаем…' : 'Разблокировать'}
            </button>
          ) : blockConfirm ? (
            <>
              <button
                type="button"
                disabled={busy === 'block'}
                onClick={() =>
                  void mutate(
                    'block',
                    `/api/admin/referrals/partners/${tenantId}/block`,
                    'PATCH',
                    { blocked: true },
                    `${detail.tenant.slug} заблокирован в партнёрской программе`,
                  ).then((ok) => {
                    if (ok) setBlockConfirm(false);
                  })
                }
                className="min-h-11 cursor-pointer rounded-xl bg-destructive px-4 text-sm font-semibold text-destructive-foreground transition-colors duration-200 hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'block' ? 'Блокируем…' : `Да, заблокировать ${detail.tenant.slug}`}
              </button>
              <button
                type="button"
                onClick={() => setBlockConfirm(false)}
                className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
              >
                Отмена
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setBlockConfirm(true)}
              aria-label={`Заблокировать партнёра ${detail.tenant.slug}`}
              className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-destructive/30 px-4 text-sm font-semibold text-destructive transition-colors duration-200 hover:bg-destructive/10"
            >
              <ShieldOff aria-hidden className="h-4 w-4" />
              Заблокировать
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
