'use client';

import { useCallback, useEffect, useState } from 'react';
import { authHeaders } from '@/lib/auth';
import { CopyButton } from '@/components/portal/copy-button';
import { Alert } from '@/components/portal/alert';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

interface FormEndpoint {
  id: string;
  name: string;
  token: string;
  url: string;
  secret?: string;
  hasSecret: boolean;
  dedupeMode: string;
  defaultStage: string | null;
  isActive: boolean;
  headerName: string;
  createdAt: string;
}

interface FormLeadRow {
  id: string;
  endpointId: string;
  source: string;
  externalId: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  error: string | null;
  personId: string | null;
  opportunityId: string | null;
  needsReview: boolean;
  createdAt: string;
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    received: 'В очереди',
    processed: 'В CRM',
    failed: 'Ошибка',
    duplicate: 'Дубль',
    needs_review: 'Проверить',
  };
  return map[status] || status;
}

export function FormLeadsSection() {
  const [endpoints, setEndpoints] = useState<FormEndpoint[]>([]);
  const [leads, setLeads] = useState<FormLeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshSecret, setFreshSecret] = useState<{
    endpointId: string;
    secret: string;
  } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [epRes, leadRes] = await Promise.all([
        fetch(`${API}/api/forms/endpoints`, { headers: authHeaders() }),
        fetch(`${API}/api/forms/leads?limit=20`, { headers: authHeaders() }),
      ]);
      if (!epRes.ok) throw new Error('Не удалось загрузить webhook');
      const epJson = await epRes.json();
      const leadJson = leadRes.ok ? await leadRes.json() : { leads: [] };
      setEndpoints(epJson.endpoints || []);
      setLeads(leadJson.leads || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createEndpoint() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${API}/api/forms/endpoints`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name: 'Сайт', withSecret: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось создать');
      if (json.endpoint?.secret) {
        setFreshSecret({
          endpointId: json.endpoint.id,
          secret: json.endpoint.secret,
        });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(ep: FormEndpoint) {
    setBusy(true);
    try {
      await fetch(`${API}/api/forms/endpoints/${ep.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ isActive: !ep.isActive }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function setDedupe(ep: FormEndpoint, dedupeMode: string) {
    setBusy(true);
    try {
      await fetch(`${API}/api/forms/endpoints/${ep.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ dedupeMode }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function rotateSecret(ep: FormEndpoint) {
    setBusy(true);
    try {
      const res = await fetch(`${API}/api/forms/endpoints/${ep.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ rotateSecret: true }),
      });
      const json = await res.json();
      if (json.endpoint?.secret) {
        setFreshSecret({
          endpointId: json.endpoint.id,
          secret: json.endpoint.secret,
        });
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function retryLead(id: string) {
    setBusy(true);
    try {
      await fetch(`${API}/api/forms/leads/${id}/retry`, {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const primary = endpoints[0];

  return (
    <section
      id="form-leads"
      className="scroll-mt-6 rounded-2xl border border-black/10 bg-white p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="land-display text-xl tracking-[-0.03em]">
            Приём заявок с сайта
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm text-black/55">
            Webhook для Tilda, WordPress и любых форм. Заявка создаёт контакт и
            сделку в CRM, сохраняет UTM и cookies счётчиков для аналитики.
          </p>
        </div>
        <button
          type="button"
          className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
          onClick={() => setShowHelp((v) => !v)}
        >
          {showHelp ? 'Скрыть инструкцию' : 'Как подключить'}
        </button>
      </div>

      {error ? (
        <div className="mt-4">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}

      {showHelp ? (
        <div className="mt-4 space-y-3 rounded-xl border border-black/10 bg-black/[0.02] p-4 text-sm text-black/70">
          <p>
            <strong className="font-semibold text-black">Tilda:</strong> Настройки
            сайта → Формы → Webhook → вставьте URL ниже. Включите «Посылать Cookie»
            (нужен <code className="text-xs">_ym_uid</code> / TILDAUTM). При
            подключении Tilda шлёт <code className="text-xs">test=test</code> — мы
            отвечаем 200. API-ключ = секрет, заголовок{' '}
            <code className="text-xs">X-Voxly-Webhook-Secret</code> или поле в POST.
          </p>
          <p>
            <strong className="font-semibold text-black">WordPress:</strong> Gravity
            Forms Webhooks / Contact Form 7 webhook / n8n — JSON POST на тот же URL.
            Пример тела:{' '}
            <code className="block overflow-x-auto whitespace-pre rounded-lg bg-black/[0.04] p-2 text-xs">{`{
  "name": "Иван",
  "phone": "+79001234567",
  "email": "ivan@example.com",
  "comment": "Хочу консультацию",
  "entry_id": "12345",
  "utm_source": "yandex",
  "_ym_uid": "…"
}`}</code>
          </p>
        </div>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-black/45">Загрузка…</p>
      ) : !primary ? (
        <div className="mt-5">
          <button
            type="button"
            disabled={busy}
            className="land-btn-amber min-h-11 cursor-pointer px-5 text-sm disabled:opacity-50"
            onClick={() => void createEndpoint()}
          >
            Создать webhook
          </button>
        </div>
      ) : (
        <div className="mt-5 space-y-4">
          {endpoints.map((ep) => (
            <div
              key={ep.id}
              className="rounded-xl border border-black/10 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{ep.name}</p>
                <span
                  className={`text-xs font-medium ${
                    ep.isActive ? 'text-emerald-700' : 'text-black/40'
                  }`}
                >
                  {ep.isActive ? 'Активен' : 'Выключен'}
                </span>
              </div>

              <div className="mt-3 rounded-lg border border-black/10 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  URL webhook
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate text-xs sm:text-sm">
                    {ep.url}
                  </code>
                  <CopyButton
                    value={ep.url}
                    size="icon"
                    label="Скопировать URL"
                    className="h-11 w-11 shrink-0 cursor-pointer"
                  />
                </div>
              </div>

              {freshSecret?.endpointId === ep.id ? (
                <div className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50 px-3 py-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-800/70">
                    Секрет (сохраните сейчас)
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs">
                      {freshSecret.secret}
                    </code>
                    <CopyButton
                      value={freshSecret.secret}
                      size="icon"
                      label="Скопировать секрет"
                      className="h-11 w-11 shrink-0 cursor-pointer"
                    />
                  </div>
                  <p className="mt-1 text-xs text-amber-900/60">
                    Заголовок: {ep.headerName}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-xs text-black/45">
                  Секрет: {ep.hasSecret ? 'задан' : 'не задан'} · заголовок{' '}
                  <code className="text-[11px]">{ep.headerName}</code>
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  className="land-btn-ghost min-h-10 cursor-pointer px-3 text-xs disabled:opacity-50"
                  onClick={() => void toggleActive(ep)}
                >
                  {ep.isActive ? 'Выключить' : 'Включить'}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="land-btn-ghost min-h-10 cursor-pointer px-3 text-xs disabled:opacity-50"
                  onClick={() => void rotateSecret(ep)}
                >
                  Новый секрет
                </button>
                <button
                  type="button"
                  disabled={busy}
                  className="land-btn-ghost min-h-10 cursor-pointer px-3 text-xs disabled:opacity-50"
                  onClick={() =>
                    void setDedupe(
                      ep,
                      ep.dedupeMode === 'reuse_open'
                        ? 'always_new'
                        : 'reuse_open',
                    )
                  }
                >
                  {ep.dedupeMode === 'reuse_open'
                    ? 'Сделки: переиспользовать открытую'
                    : 'Сделки: всегда новая'}
                </button>
              </div>
            </div>
          ))}

          {endpoints.length < 3 ? (
            <button
              type="button"
              disabled={busy}
              className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm disabled:opacity-50"
              onClick={() => void createEndpoint()}
            >
              Добавить ещё webhook
            </button>
          ) : null}
        </div>
      )}

      {leads.length > 0 ? (
        <div className="mt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
            Последние заявки
          </p>
          <ul className="mt-2 divide-y divide-black/8 rounded-xl border border-black/10">
            {leads.map((lead) => (
              <li
                key={lead.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {lead.name || lead.phone || lead.email || 'Без имени'}
                  </p>
                  <p className="text-xs text-black/45">
                    {lead.source}
                    {lead.externalId ? ` · ${lead.externalId}` : ''} ·{' '}
                    {new Date(lead.createdAt).toLocaleString('ru-RU')}
                    {lead.error ? ` · ${lead.error}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-black/60">
                    {statusLabel(lead.status)}
                    {lead.needsReview ? ' · review' : ''}
                  </span>
                  {lead.status === 'failed' ? (
                    <button
                      type="button"
                      disabled={busy}
                      className="land-btn-ghost min-h-9 cursor-pointer px-2 text-xs disabled:opacity-50"
                      onClick={() => void retryLead(lead.id)}
                    >
                      Повтор
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
