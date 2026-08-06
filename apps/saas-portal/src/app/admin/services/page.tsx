'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { Badge } from '@/components/ui/badge';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

type AddonRow = {
  id: string;
  type: string;
  status: string;
  activeUntil: string;
  expired: boolean;
};

type BotRow = {
  id: string;
  botType: string;
  status: string;
  label: string;
};

type TenantServices = {
  id: string;
  slug: string;
  status: string;
  ownerEmail: string | null;
  aiWalletRub: number;
  agentCount: number;
  botsByType: Record<string, number>;
  bots: BotRow[];
  addons: AddonRow[];
  deepLinks: Record<string, string>;
};

const TH = 'px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';
const TD = 'px-3 py-3 text-sm';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export default function AdminServicesPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tenants, setTenants] = useState<TenantServices[]>([]);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const qs = search ? `?search=${encodeURIComponent(search)}` : '';
      const res = await fetch(`${API}/api/admin/services/tenants${qs}`, {
        headers: authHeaders(),
      });
      if (res.status === 403) {
        setError('Нужна роль superadmin');
        return;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить');
      setTenants(json.tenants || []);
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

  const patchAddon = async (addonId: string, action: 'expire' | 'extend_days' | 'activate') => {
    setBusy(`a-${addonId}-${action}`);
    setError('');
    setNotice('');
    try {
      const res = await fetch(`${API}/api/admin/services/addons/${addonId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'extend_days' ? { action, days: 30 } : { action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось обновить addon');
      setNotice(`Addon ${json.type}: ${json.status} до ${formatDate(json.activeUntil)}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const patchBot = async (botId: string, action: 'suspend' | 'activate') => {
    setBusy(`b-${botId}`);
    setError('');
    try {
      const res = await fetch(`${API}/api/admin/services/bots/${botId}`, {
        method: 'PATCH',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось обновить бота');
      setNotice(`Бот ${json.botType}: ${json.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const impersonate = async (tenantId: string, next: string) => {
    setBusy(`imp-${tenantId}`);
    setError('');
    try {
      const res = await fetch(`${API}/api/admin/tenants/${tenantId}/impersonate`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ next }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.token) throw new Error(json.error || 'Не удалось войти');
      localStorage.setItem('voxly_token', json.token);
      window.location.href = json.redirectUrl || next;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка impersonate');
      setBusy('');
    }
  };

  if (loading) {
    return (
      <AppShell>
        <LoadingState label="Загружаем сервисы клиентов…" />
      </AppShell>
    );
  }

  return (
    <AppShell maxWidth="6xl" className="space-y-8">
      <header className="rounded-2xl border border-amber-200/80 bg-gradient-to-br from-amber-50 via-white to-orange-50/40 px-5 py-6 sm:px-8">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-800/70">
          Админ · сервисы
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-black sm:text-3xl">
          Add-on и боты клиентов
        </h1>
        <p className="mt-2 max-w-[60ch] text-sm text-black/60">
          Надзор без клиентского CRUD: expire/extend addon, suspend бота, вход в кабинет в нужный
          раздел. Цены — на странице «Тарифы».
        </p>
      </header>

      {error ? <Alert variant="error">{error}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
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
          <table className="w-full min-w-[800px] border-collapse text-left">
            <thead>
              <tr className="border-b border-black/10">
                <th className={TH}>Клиент</th>
                <th className={TH}>AI ₽</th>
                <th className={TH}>Боты</th>
                <th className={TH}>Addons</th>
                <th className={TH} />
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <Fragment key={t.id}>
                  <tr className="border-b border-black/5">
                    <td className={TD}>
                      <div className="font-medium">{t.slug}</div>
                      <div className="text-xs text-black/45">{t.ownerEmail || '—'}</div>
                    </td>
                    <td className={`${TD} tabular-nums`}>
                      {t.aiWalletRub.toLocaleString('ru-RU')}
                      <div className="text-xs text-black/40">{t.agentCount} агент.</div>
                    </td>
                    <td className={TD}>
                      <div className="text-xs text-black/60">
                        {Object.entries(t.botsByType)
                          .map(([k, v]) => `${k}:${v}`)
                          .join(' · ') || '—'}
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="flex flex-wrap gap-1">
                        {t.addons.slice(0, 4).map((a) => (
                          <Badge
                            key={a.id}
                            variant={a.expired ? 'secondary' : 'success'}
                          >
                            {a.type}
                          </Badge>
                        ))}
                        {t.addons.length > 4 ? (
                          <span className="text-xs text-black/40">+{t.addons.length - 4}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className={`${TD} text-right`}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-sm text-amber-800"
                        onClick={() =>
                          setExpandedId((id) => (id === t.id ? '' : t.id))
                        }
                      >
                        Детали
                        {expandedId === t.id ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    </td>
                  </tr>
                  {expandedId === t.id ? (
                    <tr className="border-b border-black/10 bg-amber-50/40">
                      <td colSpan={5} className="px-3 py-4">
                        <div className="mb-3 flex flex-wrap gap-2">
                          {Object.entries(t.deepLinks).map(([key, href]) => (
                            <button
                              key={key}
                              type="button"
                              disabled={busy.startsWith('imp-')}
                              onClick={() => void impersonate(t.id, href)}
                              className="rounded-md border border-black/15 bg-white px-2.5 py-1.5 text-xs font-medium"
                            >
                              Войти → {key}
                            </button>
                          ))}
                        </div>

                        <h3 className="text-sm font-semibold">Addons</h3>
                        <ul className="mt-2 space-y-2">
                          {t.addons.map((a) => (
                            <li
                              key={a.id}
                              className="flex flex-wrap items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm"
                            >
                              <span className="font-mono text-xs">{a.type}</span>
                              <Badge variant={a.expired ? 'secondary' : 'success'}>
                                {a.status}
                              </Badge>
                              <span className="text-xs text-black/50">
                                до {formatDate(a.activeUntil)}
                              </span>
                              <span className="ml-auto flex flex-wrap gap-1">
                                <button
                                  type="button"
                                  className="text-xs underline"
                                  disabled={busy.startsWith(`a-${a.id}`)}
                                  onClick={() => void patchAddon(a.id, 'extend_days')}
                                >
                                  +30д
                                </button>
                                <button
                                  type="button"
                                  className="text-xs underline"
                                  disabled={busy.startsWith(`a-${a.id}`)}
                                  onClick={() => void patchAddon(a.id, 'activate')}
                                >
                                  activate
                                </button>
                                <button
                                  type="button"
                                  className="text-xs text-red-700 underline"
                                  disabled={busy.startsWith(`a-${a.id}`)}
                                  onClick={() => void patchAddon(a.id, 'expire')}
                                >
                                  expire
                                </button>
                              </span>
                            </li>
                          ))}
                          {t.addons.length === 0 ? (
                            <li className="text-xs text-black/40">Нет addons</li>
                          ) : null}
                        </ul>

                        <h3 className="mt-4 text-sm font-semibold">Боты</h3>
                        <ul className="mt-2 space-y-2">
                          {t.bots.map((b) => (
                            <li
                              key={b.id}
                              className="flex flex-wrap items-center gap-2 rounded-md border border-black/10 bg-white px-3 py-2 text-sm"
                            >
                              <span className="font-mono text-xs">{b.botType}</span>
                              <span>{b.label}</span>
                              <Badge
                                variant={
                                  b.status === 'active'
                                    ? 'success'
                                    : b.status === 'suspended'
                                      ? 'destructive'
                                      : 'secondary'
                                }
                              >
                                {b.status}
                              </Badge>
                              <span className="ml-auto flex gap-2">
                                {b.status === 'suspended' ? (
                                  <button
                                    type="button"
                                    className="text-xs underline"
                                    disabled={busy === `b-${b.id}`}
                                    onClick={() => void patchBot(b.id, 'activate')}
                                  >
                                    activate
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="text-xs text-red-700 underline"
                                    disabled={busy === `b-${b.id}`}
                                    onClick={() => void patchBot(b.id, 'suspend')}
                                  >
                                    suspend
                                  </button>
                                )}
                              </span>
                            </li>
                          ))}
                          {t.bots.length === 0 ? (
                            <li className="text-xs text-black/40">Нет ботов</li>
                          ) : null}
                        </ul>
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
