'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { authHeaders } from '@/lib/auth';
import { Alert } from '@/components/portal/alert';
import { CopyButton } from '@/components/portal/copy-button';
import { formatRub } from '@/components/portal/admin-partners-rule';
import { Badge } from '@/components/ui/badge';

export type WithdrawalStatus = 'pending' | 'paid' | 'rejected' | 'cancelled';

/** Ответ бэкенда: все поля опциональные — раздел выкатывается позже самого портала. */
export type AdminWithdrawalRaw = {
  id?: string;
  tenantId?: string;
  slug?: string | null;
  ownerEmail?: string | null;
  amountRub?: number;
  status?: string;
  payoutDetails?: string | null;
  comment?: string | null;
  decisionNote?: string | null;
  decidedAt?: string | null;
  createdAt?: string;
  balanceRub?: number;
};

export type Withdrawal = {
  id: string;
  tenantId: string;
  slug: string;
  ownerEmail: string;
  amountRub: number;
  status: WithdrawalStatus;
  payoutDetails: string;
  comment: string;
  decisionNote: string;
  decidedAt: string;
  createdAt: string;
  balanceRub: number;
};

const STATUSES: WithdrawalStatus[] = ['pending', 'paid', 'rejected', 'cancelled'];

export function normalizeWithdrawal(raw: AdminWithdrawalRaw): Withdrawal {
  const status = raw.status as WithdrawalStatus | undefined;
  return {
    id: raw.id ?? '',
    tenantId: raw.tenantId ?? '',
    slug: raw.slug ?? '',
    ownerEmail: raw.ownerEmail ?? '',
    amountRub: raw.amountRub ?? 0,
    status: status && STATUSES.includes(status) ? status : 'pending',
    payoutDetails: raw.payoutDetails ?? '',
    comment: raw.comment ?? '',
    decisionNote: raw.decisionNote ?? '',
    decidedAt: raw.decidedAt ?? '',
    createdAt: raw.createdAt ?? '',
    balanceRub: raw.balanceRub ?? 0,
  };
}

export function withdrawalStatusMeta(status: WithdrawalStatus): {
  label: string;
  variant: 'success' | 'warning' | 'secondary' | 'destructive';
} {
  if (status === 'paid') return { label: 'Выплачено', variant: 'success' };
  if (status === 'rejected') return { label: 'Отклонено', variant: 'destructive' };
  if (status === 'cancelled') return { label: 'Отменена', variant: 'secondary' };
  return { label: 'На проверке', variant: 'warning' };
}

export function formatWithdrawalDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

function formatWithdrawalDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString(
    'ru-RU',
    { hour: '2-digit', minute: '2-digit' },
  )}`;
}

const TH = 'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';
const TD = 'px-3 py-3 text-sm';

const CHIPS: Array<{ id: WithdrawalStatus; label: string }> = [
  { id: 'pending', label: 'Ожидают' },
  { id: 'paid', label: 'Выплачены' },
  { id: 'rejected', label: 'Отклонены' },
  { id: 'cancelled', label: 'Отменённые' },
];

type Confirm = { id: string; action: 'paid' | 'rejected' };

export function AdminWithdrawalsQueue({ onMutated }: { onMutated: () => void }) {
  const [items, setItems] = useState<Withdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<WithdrawalStatus>('pending');
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/admin/referrals/withdrawals', { headers: authHeaders() });
      if (res.status === 404) {
        setUnavailable(true);
        setItems([]);
        return;
      }
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        withdrawals?: AdminWithdrawalRaw[];
      };
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить заявки на вывод');
      setUnavailable(false);
      setItems((json.withdrawals ?? []).map(normalizeWithdrawal));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить заявки на вывод');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (w: Withdrawal, action: 'paid' | 'rejected') => {
    setBusyId(w.id);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`/api/admin/referrals/withdrawals/${w.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ action, note: note.trim() || undefined }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || 'Не удалось обработать заявку');
      setNotice(
        action === 'paid'
          ? `${w.slug || 'Партнёр'}: заявка на ${formatRub(w.amountRub)} ₽ отмечена выплаченной. Баланс партнёра не изменился — эта сумма ушла с него ещё при подаче заявки.`
          : `${w.slug || 'Партнёр'}: заявка отклонена, ${formatRub(w.amountRub)} ₽ вернулись на баланс партнёра.`,
      );
      setConfirm(null);
      setNote('');
      await load();
      onMutated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusyId('');
    }
  };

  const counts = STATUSES.reduce<Record<WithdrawalStatus, number>>(
    (acc, s) => {
      acc[s] = items.filter((w) => w.status === s).length;
      return acc;
    },
    { pending: 0, paid: 0, rejected: 0, cancelled: 0 },
  );

  const pendingRub = items
    .filter((w) => w.status === 'pending')
    .reduce((sum, w) => sum + w.amountRub, 0);

  const rows = items.filter((w) => w.status === filter);
  const chips = CHIPS.filter((c) => c.id !== 'cancelled' || counts.cancelled > 0);
  const fallback = STATUSES.find((s) => counts[s] > 0);

  return (
    <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            03 · Заявки на вывод
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Кто просит деньги</h2>
          <p className="mt-1 max-w-[74ch] text-sm text-black/55">
            Сумма заявки уже зарезервирована: она списалась с баланса партнёра в момент подачи.
            «Выплачено» баланс не меняет — вы просто фиксируете, что перевели деньги по реквизитам.
            Отказ вернёт сумму обратно на баланс партнёра.
          </p>
        </div>
        <p
          aria-live="polite"
          className="text-sm tabular-nums text-black/55"
        >
          {refreshing
            ? 'Обновляем…'
            : counts.pending > 0
              ? `Ждут решения: ${counts.pending} на ${formatRub(pendingRub)} ₽`
              : 'Нерешённых заявок нет'}
        </p>
      </div>

      {error ? (
        <Alert variant="error" className="mt-3">
          {error}
        </Alert>
      ) : null}
      {notice ? (
        <Alert variant="success" className="mt-3">
          {notice}
        </Alert>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {chips.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              setFilter(c.id);
              setConfirm(null);
              setNote('');
            }}
            aria-pressed={filter === c.id}
            className={`min-h-9 cursor-pointer rounded-full border px-3 text-xs font-semibold transition-colors duration-200 ${
              filter === c.id
                ? 'border-black bg-black text-white'
                : 'border-black/15 text-black/65 hover:border-black/35'
            }`}
          >
            {c.label} · {counts[c.id]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-[#faf8f5]" aria-hidden />
      ) : unavailable ? (
        <Alert variant="info" className="mt-4">
          Заявки на вывод ещё не подключены на сервере. Остальные разделы работают как обычно.
        </Alert>
      ) : items.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
          <p className="font-semibold text-black">Заявок на вывод пока нет</p>
          <p className="mx-auto mt-1 max-w-[52ch] text-sm text-black/55">
            Партнёр может либо зачесть баланс в счёт своего счёта Voxly, либо попросить перевод —
            тогда заявка появится здесь.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
          <p className="font-semibold text-black">
            В статусе «{CHIPS.find((c) => c.id === filter)?.label}» заявок нет
          </p>
          <p className="mx-auto mt-1 max-w-[52ch] text-sm text-black/55">
            Всего заявок: {items.length}. Переключите фильтр, чтобы их увидеть.
          </p>
          {fallback ? (
            <button
              type="button"
              onClick={() => setFilter(fallback)}
              className="land-btn-ghost mt-4 min-h-10 cursor-pointer px-4 text-sm"
            >
              Показать «{CHIPS.find((c) => c.id === fallback)?.label}»
            </button>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
          <table className="w-full min-w-[980px] text-left">
            <thead className="bg-[#faf8f5]">
              <tr>
                <th className={TH}>Дата</th>
                <th className={TH}>Партнёр</th>
                <th className={`${TH} text-right`}>Сумма</th>
                <th className={TH}>Реквизиты</th>
                <th className={TH}>Комментарий партнёра</th>
                <th className={`${TH} text-right`}>Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {rows.map((w) => {
                const meta = withdrawalStatusMeta(w.status);
                const open = confirm?.id === w.id;
                const busy = busyId === w.id;
                return (
                  <Fragment key={w.id}>
                    <tr className="align-top transition-colors duration-200 hover:bg-[#faf8f5]">
                      <td className={TD}>
                        <p className="whitespace-nowrap text-black/75">
                          {formatWithdrawalDateTime(w.createdAt)}
                        </p>
                        <Badge variant={meta.variant} className="mt-1">
                          {meta.label}
                        </Badge>
                      </td>
                      <td className={TD}>
                        <p className="font-medium text-black">{w.slug || '—'}</p>
                        <p className="text-xs text-black/55">{w.ownerEmail || '—'}</p>
                        <p className="mt-1 text-xs tabular-nums text-black/45">
                          баланс сейчас {formatRub(w.balanceRub)} ₽
                        </p>
                      </td>
                      <td className={`${TD} text-right tabular-nums`}>
                        <span className="font-semibold text-[#c2410c]">
                          {formatRub(w.amountRub)} ₽
                        </span>
                        <span className="block text-xs text-black/45">уже списано с баланса</span>
                      </td>
                      <td className={TD}>
                        {w.payoutDetails ? (
                          <div className="flex items-start gap-1.5">
                            <code className="min-w-0 flex-1 whitespace-pre-wrap break-words rounded bg-[#faf8f5] px-1.5 py-1 font-mono text-xs text-black/75">
                              {w.payoutDetails}
                            </code>
                            <CopyButton
                              value={w.payoutDetails}
                              size="icon"
                              label={`Скопировать реквизиты ${w.slug || 'партнёра'}`}
                              className="h-9 w-9 min-h-9 min-w-9 shrink-0"
                            />
                          </div>
                        ) : (
                          <span className="text-xs text-black/45">реквизиты не указаны</span>
                        )}
                      </td>
                      <td className={TD}>
                        <p className="max-w-[28ch] text-xs leading-snug text-black/65">
                          {w.comment || '—'}
                        </p>
                      </td>
                      <td className={`${TD} text-right`}>
                        {w.status === 'pending' ? (
                          <div className="flex flex-wrap items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirm({ id: w.id, action: 'paid' });
                                setNote('');
                              }}
                              disabled={busy}
                              aria-expanded={open && confirm?.action === 'paid'}
                              aria-controls={`withdrawal-confirm-${w.id}`}
                              className="land-btn-amber min-h-9 min-w-9 cursor-pointer whitespace-nowrap px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Выплачено
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirm({ id: w.id, action: 'rejected' });
                                setNote('');
                              }}
                              disabled={busy}
                              aria-expanded={open && confirm?.action === 'rejected'}
                              aria-controls={`withdrawal-confirm-${w.id}`}
                              className="land-btn-ghost min-h-9 min-w-9 cursor-pointer whitespace-nowrap px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Отклонить
                            </button>
                          </div>
                        ) : (
                          <div className="text-xs leading-snug text-black/55">
                            <p>решение {formatWithdrawalDate(w.decidedAt)}</p>
                            {w.decisionNote ? (
                              <p className="mt-1 max-w-[26ch] text-black/75">
                                Причина: {w.decisionNote}
                              </p>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                    {open ? (
                      <tr className="bg-[#faf8f5]">
                        <td colSpan={6} className="px-3 pb-4 pt-1" id={`withdrawal-confirm-${w.id}`}>
                          {confirm?.action === 'paid' ? (
                            <div className="rounded-xl border border-[#f5a623]/50 bg-[#fffaf0] px-3.5 py-3">
                              <p className="text-sm font-semibold text-black">
                                Подтвердите: {formatRub(w.amountRub)} ₽ действительно переведены
                                партнёру {w.slug || '—'}
                              </p>
                              <p className="mt-1 max-w-[74ch] text-xs leading-snug text-black/65">
                                Баланс партнёра от этого не изменится — сумма ушла с него ещё при
                                подаче заявки. Вы фиксируете факт перевода по реквизитам, сделанного
                                вне Voxly.
                              </p>
                              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void decide(w, 'paid')}
                                  disabled={busy}
                                  className="land-btn-amber min-h-11 cursor-pointer px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {busy ? 'Отмечаем…' : 'Да, деньги переведены'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirm(null)}
                                  disabled={busy}
                                  className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Отмена
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-black/10 bg-white px-3.5 py-3">
                              <label
                                htmlFor={`withdrawal-note-${w.id}`}
                                className="block text-sm font-semibold text-black"
                              >
                                Причина отказа
                              </label>
                              <p className="mt-1 max-w-[74ch] text-xs leading-snug text-black/55">
                                Партнёр увидит этот текст. После отказа {formatRub(w.amountRub)} ₽
                                вернутся на его баланс, и он сможет подать заявку заново.
                              </p>
                              <textarea
                                id={`withdrawal-note-${w.id}`}
                                value={note}
                                onChange={(e) => setNote(e.target.value)}
                                disabled={busy}
                                rows={2}
                                placeholder="Например: реквизиты не совпадают с данными компании"
                                className="mt-2 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm outline-none transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                              />
                              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => void decide(w, 'rejected')}
                                  disabled={busy || note.trim().length === 0}
                                  className="land-btn-amber min-h-11 cursor-pointer px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {busy ? 'Отклоняем…' : 'Отклонить и вернуть деньги'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirm(null)}
                                  disabled={busy}
                                  className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  Отмена
                                </button>
                                {note.trim().length === 0 ? (
                                  <span className="text-xs text-black/55">
                                    Кнопка включится, когда напишете причину — без неё сервер откажет.
                                  </span>
                                ) : null}
                              </div>
                            </div>
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

      <p className="mt-3 max-w-[86ch] text-xs leading-snug text-black/55">
        Ручная выплата в карточке партнёра — отдельный инструмент: она списывает баланс сама и не
        закрывает заявку. Если по заявке уже переведены деньги, обработайте её здесь, иначе один и
        тот же долг легко перевести дважды.
      </p>
    </section>
  );
}
