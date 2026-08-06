'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { Badge } from '@/components/ui/badge';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

type SkuRow = { productCode: string; label: string; priceMonthly: number };

type TenantPriceRow = {
  productCode: string;
  label: string;
  platform: number;
  override: number | null;
  effective: number;
  custom: boolean;
};

type TenantView = {
  tenantId: string;
  slug: string;
  status: string;
  ownerEmail: string | null;
  seatsIncluded: number;
  customSeatsIncluded: boolean;
  prices: TenantPriceRow[];
  hasAnyCustom: boolean;
};

const TH = 'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';
const TD = 'px-3 py-3 text-sm';

function formatRub(n: number): string {
  return n.toLocaleString('ru-RU');
}

export default function AdminPricingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [platformDraft, setPlatformDraft] = useState<Record<string, string>>({});
  const [tenants, setTenants] = useState<TenantView[]>([]);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [tenantDraft, setTenantDraft] = useState<Record<string, string>>({});
  const [seatsDraft, setSeatsDraft] = useState('');
  const [compMonths, setCompMonths] = useState<1 | 3 | 6 | 12>(12);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const [pRes, tRes] = await Promise.all([
        fetch(`${API}/api/admin/pricing`, { headers: authHeaders() }),
        fetch(
          `${API}/api/admin/pricing/tenants${search ? `?search=${encodeURIComponent(search)}` : ''}`,
          { headers: authHeaders() },
        ),
      ]);
      if (pRes.status === 403 || tRes.status === 403) {
        setError('Нужна роль superadmin');
        return;
      }
      const pJson = await pRes.json().catch(() => ({}));
      const tJson = await tRes.json().catch(() => ({}));
      if (!pRes.ok) throw new Error(pJson.error || 'Не удалось загрузить тарифы');
      if (!tRes.ok) throw new Error(tJson.error || 'Не удалось загрузить клиентов');
      setSkus(pJson.skus || []);
      const draft: Record<string, string> = {};
      for (const s of pJson.skus || []) {
        draft[s.productCode] = String(s.priceMonthly);
      }
      setPlatformDraft(draft);
      setTenants(tJson.tenants || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.replace('/login');
      return;
    }
    void load();
  }, [load, router]);

  const savePlatform = async () => {
    setBusy('platform');
    setError('');
    setNotice('');
    try {
      const body: Record<string, number> = {};
      for (const s of skus) {
        const n = Math.round(Number(platformDraft[s.productCode]));
        if (!Number.isFinite(n) || n < 1) {
          throw new Error(`${s.label}: укажите цену от 1 ₽`);
        }
        body[s.productCode] = n;
      }
      const res = await fetch(`${API}/api/admin/pricing`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось сохранить');
      setNotice('Платформенные цены сохранены. Действуют на следующую оплату.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy('');
    }
  };

  const openTenant = (t: TenantView) => {
    if (expandedId === t.tenantId) {
      setExpandedId('');
      return;
    }
    setExpandedId(t.tenantId);
    const d: Record<string, string> = {};
    for (const p of t.prices) {
      d[p.productCode] = p.custom ? String(p.override) : '';
    }
    setTenantDraft(d);
    setSeatsDraft(t.customSeatsIncluded ? String(t.seatsIncluded) : '');
  };

  const grantCompAccess = async (tenantId: string, slug: string) => {
    setBusy(`comp-${tenantId}`);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${API}/api/admin/pricing/tenants/${tenantId}/comp-access`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: compMonths }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось выдать доступ');
      const ends = json.endsAt
        ? new Date(json.endsAt).toLocaleDateString('ru-RU')
        : '';
      setNotice(
        `Бесплатный доступ для ${slug}: CRM открыта до ${ends}. Цены 0 ₽. AI-баланс не пополнялся.`,
      );
      await load();
      const view = json.pricing as TenantView | undefined;
      if (view?.prices) {
        const d: Record<string, string> = {};
        for (const p of view.prices) {
          d[p.productCode] = p.custom ? String(p.override) : '';
        }
        setTenantDraft(d);
        setSeatsDraft(view.customSeatsIncluded ? String(view.seatsIncluded) : '');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка выдачи доступа');
    } finally {
      setBusy('');
    }
  };

  const saveTenant = async (tenantId: string) => {
    setBusy(`t-${tenantId}`);
    setError('');
    setNotice('');
    try {
      const body: Record<string, number | null> = {};
      for (const s of skus) {
        const raw = (tenantDraft[s.productCode] || '').trim();
        if (raw === '') {
          body[s.productCode] = null;
        } else {
          const n = Math.round(Number(raw));
          if (!Number.isFinite(n) || n < 0) {
            throw new Error(`${s.label}: пусто = сброс на платформу, иначе от 0 ₽`);
          }
          body[s.productCode] = n;
        }
      }
      const payload: Record<string, number | null> = { ...body };
      const seatsRaw = seatsDraft.trim();
      if (seatsRaw === '') {
        payload.seatsIncluded = null;
      } else {
        const seats = Math.round(Number(seatsRaw));
        if (!Number.isFinite(seats) || seats < 1 || seats > 500) {
          throw new Error('Мест в CRM: 1…500 или пусто для сброса');
        }
        payload.seatsIncluded = seats;
      }

      const res = await fetch(`${API}/api/admin/pricing/tenants/${tenantId}`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось сохранить');
      setNotice('Индивидуальные цены сохранены. Действуют на следующую оплату.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <AppShell>
        <LoadingState label="Загружаем тарифы…" />
      </AppShell>
    );
  }

  return (
    <AppShell maxWidth="6xl" className="space-y-8">
      <header className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50/40 px-5 py-6 sm:px-8">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-800/70">
          Админ · тарифы
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-black sm:text-3xl">
          Цены платформы и клиентов
        </h1>
        <p className="mt-2 max-w-[60ch] text-sm text-black/60">
          Изменение действует на следующую оплату (pending-счета и уже оплаченные периоды не
          пересчитываются). У клиента: пустое поле = цена платформы, <strong>0</strong> = бесплатно.
        </p>
      </header>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
          01 · Платформа
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Цены по умолчанию</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-black/10">
                <th className={TH}>Продукт</th>
                <th className={TH}>Код</th>
                <th className={TH}>₽ / мес</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.productCode} className="border-b border-black/5">
                  <td className={TD}>{s.label}</td>
                  <td className={`${TD} font-mono text-xs text-black/50`}>{s.productCode}</td>
                  <td className={TD}>
                    <input
                      type="number"
                      min={1}
                      max={1_000_000}
                      className="w-28 rounded-md border border-black/15 px-2 py-1.5 text-sm tabular-nums"
                      value={platformDraft[s.productCode] ?? ''}
                      onChange={(e) =>
                        setPlatformDraft((d) => ({ ...d, [s.productCode]: e.target.value }))
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          type="button"
          disabled={busy === 'platform'}
          onClick={() => void savePlatform()}
          className="mt-4 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
        >
          {busy === 'platform' ? 'Сохраняем…' : 'Сохранить платформенные цены'}
        </button>
      </section>

      <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
          02 · Клиенты
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">Индивидуальные цены</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-black/35" />
            <input
              className="w-full rounded-md border border-black/15 py-2 pl-9 pr-3 text-sm"
              placeholder="slug или email"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-black/15 px-3 py-2 text-sm"
          >
            Обновить
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-black/10">
                <th className={TH}>Клиент</th>
                <th className={TH}>Статус</th>
                <th className={TH}>Override</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <Fragment key={t.tenantId}>
                  <tr className="border-b border-black/5">
                    <td className={TD}>
                      <div className="font-medium">{t.slug}</div>
                      <div className="text-xs text-black/45">{t.ownerEmail || '—'}</div>
                    </td>
                    <td className={TD}>
                      <Badge variant={t.status === 'active' ? 'success' : 'secondary'}>
                        {t.status}
                      </Badge>
                    </td>
                    <td className={TD}>
                      {t.hasAnyCustom ? (
                        <Badge variant="warning">custom</Badge>
                      ) : (
                        <span className="text-xs text-black/40">платформа</span>
                      )}
                    </td>
                    <td className={`${TD} text-right`}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm text-amber-800"
                        onClick={() => openTenant(t)}
                      >
                        Цены
                        {expandedId === t.tenantId ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                  {expandedId === t.tenantId ? (
                    <tr className="border-b border-black/10 bg-amber-50/40">
                      <td colSpan={4} className="px-3 py-4">
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {t.prices.map((p) => (
                            <label key={p.productCode} className="block text-xs">
                              <span className="font-medium text-black/70">{p.label}</span>
                              <span className="ml-1 text-black/40">
                                (сейчас {formatRub(p.effective)} ₽
                                {p.custom ? ', custom' : ''})
                              </span>
                              <input
                                type="number"
                                min={0}
                                max={1_000_000}
                                placeholder={`платформа ${p.platform}`}
                                className="mt-1 w-full rounded-md border border-black/15 px-2 py-1.5 text-sm tabular-nums"
                                value={tenantDraft[p.productCode] ?? ''}
                                onChange={(e) =>
                                  setTenantDraft((d) => ({
                                    ...d,
                                    [p.productCode]: e.target.value,
                                  }))
                                }
                              />
                            </label>
                          ))}
                          <label className="block text-xs">
                            <span className="font-medium text-black/70">CRM мест включено</span>
                            <span className="ml-1 text-black/40">
                              (сейчас {t.seatsIncluded}
                              {t.customSeatsIncluded ? ', custom' : ''})
                            </span>
                            <input
                              type="number"
                              min={1}
                              max={500}
                              placeholder="платформа / сброс"
                              className="mt-1 w-full rounded-md border border-black/15 px-2 py-1.5 text-sm tabular-nums"
                              value={seatsDraft}
                              onChange={(e) => setSeatsDraft(e.target.value)}
                            />
                          </label>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={busy === `t-${t.tenantId}` || busy.startsWith('comp-')}
                            onClick={() => void saveTenant(t.tenantId)}
                            className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                          >
                            {busy === `t-${t.tenantId}` ? 'Сохраняем…' : 'Сохранить для клиента'}
                          </button>
                          <select
                            className="rounded-md border border-black/15 bg-white px-2 py-2 text-sm"
                            value={compMonths}
                            onChange={(e) =>
                              setCompMonths(Number(e.target.value) as 1 | 3 | 6 | 12)
                            }
                            aria-label="Срок бесплатного доступа"
                          >
                            <option value={1}>1 мес</option>
                            <option value={3}>3 мес</option>
                            <option value={6}>6 мес</option>
                            <option value={12}>12 мес</option>
                          </select>
                          <button
                            type="button"
                            disabled={busy === `comp-${t.tenantId}` || busy === `t-${t.tenantId}`}
                            onClick={() => void grantCompAccess(t.tenantId, t.slug)}
                            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
                          >
                            {busy === `comp-${t.tenantId}` ? 'Выдаём…' : 'Выдать бесплатно'}
                          </button>
                        </div>
                        <p className="mt-2 text-xs text-black/50">
                          «Выдать бесплатно» — откроет CRM сразу, обнулит цены SKU, продлит
                          существующие аддоны. AI-баланс не пополняется.
                        </p>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
