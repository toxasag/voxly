import { defineFrontComponent } from 'twenty-sdk/define';
import {
  enqueueSnackbar,
  getApplicationVariable,
  useColorScheme,
} from 'twenty-sdk/front-component';
import { RestApiClient } from 'twenty-client-sdk/rest';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';

import { MAILING_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';

type Segment = 'gifted' | 'not_gifted' | 'all';
type FunnelPhase = 'started' | 'awaiting_sub' | 'gifted' | 'not_gifted' | '';

type GiftBot = {
  id: string;
  botUsername: string | null;
  name: string | null;
  status: string | null;
  hasGiftCampaign: boolean;
  subscriberCount: number;
};

type BillingProduct = {
  isActive?: boolean;
  isTrial?: boolean;
  trialAvailable?: boolean;
  price?: number;
  activeUntil?: string | null;
};

type MailingContext = {
  bots?: GiftBot[];
  billing?: {
    trialDays?: number;
    products?: { mailing_bot?: BillingProduct };
  };
  error?: string;
};

type BroadcastRow = {
  id: string;
  status: string;
  scheduledAt: string | null;
  sentCount: number;
  totalCount: number;
  segment?: Segment;
  funnelPhase?: string | null;
  text?: string;
  createdAt: string;
};

function resolveWorkspaceOrigin(): string | null {
  const fromVar = (getApplicationVariable('WORKSPACE_ORIGIN') || '')
    .trim()
    .replace(/\/+$/, '');
  if (fromVar) return fromVar;
  try {
    if (typeof location !== 'undefined' && location?.origin) {
      return location.origin.replace(/\/+$/, '');
    }
  } catch {
    // Worker / sandbox may lack location
  }
  return null;
}

function serverUrlOrigin(): string | null {
  for (const raw of [
    process.env.TWENTY_API_URL,
    process.env.TWENTY_FUNCTIONS_URL,
    process.env.REACT_APP_SERVER_BASE_URL,
  ]) {
    const v = (raw || '').trim();
    if (!v) continue;
    try {
      return new URL(v).origin;
    } catch {
      // ignore
    }
  }
  return null;
}

function workspaceAwareFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const impl = globalThis.fetch.bind(globalThis);
  const href =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  let absolute = href;
  try {
    if (href.startsWith('/')) {
      const origin =
        resolveWorkspaceOrigin() ||
        (process.env.TWENTY_API_URL || 'http://localhost:3007').replace(
          /\/+$/,
          '',
        );
      absolute = `${origin}${href}`;
    }

    const url = new URL(absolute);
    const workspaceOrigin = resolveWorkspaceOrigin();
    if (workspaceOrigin) {
      const ws = new URL(workspaceOrigin);
      const serverOrigin = serverUrlOrigin();
      const isLocalHost =
        url.hostname === 'localhost' || url.hostname === '127.0.0.1';
      const isServerUrlHost =
        Boolean(serverOrigin) &&
        url.origin === serverOrigin &&
        url.origin !== ws.origin;
      const isLogicPath = url.pathname.startsWith('/s/');
      if (isLocalHost || (isLogicPath && isServerUrlHost)) {
        url.protocol = ws.protocol;
        url.hostname = ws.hostname;
        url.port = ws.port;
        absolute = url.toString();
      }
    }
  } catch {
    return impl(input as RequestInfo, init);
  }

  return impl(absolute, init);
}

const api = new RestApiClient({ fetch: workspaceAwareFetch });

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function MailingPanel() {
  const colorScheme = useColorScheme();
  const dark = colorScheme === 'dark';
  const ink = dark ? '#f5f5f5' : '#1a1a1a';
  const muted = dark ? '#9ca3af' : '#6b7280';
  const panel = dark ? '#1f1f23' : '#ffffff';
  const border = dark ? '#333' : '#e5e7eb';
  const soft = dark ? '#2a2a2e' : '#f3f4f6';
  const accent = dark ? '#818cf8' : '#4f46e5';
  const danger = dark ? '#fca5a5' : '#b91c1c';
  const ok = dark ? '#86efac' : '#166534';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bots, setBots] = useState<GiftBot[]>([]);
  const [botId, setBotId] = useState('');
  const [billing, setBilling] = useState<BillingProduct | null>(null);
  const [trialDays, setTrialDays] = useState(7);
  const [text, setText] = useState('');
  const [segment, setSegment] = useState<Segment>('not_gifted');
  const [funnelPhase, setFunnelPhase] = useState<FunnelPhase>('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [sending, setSending] = useState(false);
  const [trialBusy, setTrialBusy] = useState(false);
  const [rows, setRows] = useState<BroadcastRow[]>([]);
  const [listBusy, setListBusy] = useState(false);

  const loadContext = useCallback(async () => {
    setError('');
    const data = await api.get<MailingContext>('/s/mailing/context');
    if (data?.error) throw new Error(data.error);
    const list = data?.bots || [];
    setBots(list);
    setBilling(data?.billing?.products?.mailing_bot || null);
    setTrialDays(Number(data?.billing?.trialDays) || 7);
    setBotId((prev) => {
      if (prev && list.some((b) => b.id === prev)) return prev;
      return list[0]?.id || '';
    });
  }, []);

  const loadBroadcasts = useCallback(async (id: string) => {
    if (!id) {
      setRows([]);
      return;
    }
    setListBusy(true);
    try {
      const data = await api.get<{ broadcasts?: BroadcastRow[]; error?: string }>(
        `/s/mailing/bots/${encodeURIComponent(id)}/broadcasts`,
      );
      if (data?.error) throw new Error(data.error);
      setRows(data?.broadcasts || []);
    } finally {
      setListBusy(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadContext();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Не удалось загрузить');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadContext]);

  useEffect(() => {
    if (!botId) return;
    void loadBroadcasts(botId).catch((e) => {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить историю');
    });
  }, [botId, loadBroadcasts]);

  const billingOk = Boolean(billing?.isActive);
  const selected = bots.find((b) => b.id === botId) || null;
  const canSend =
    billingOk &&
    Boolean(botId) &&
    Boolean(selected?.hasGiftCampaign) &&
    text.trim().length > 0 &&
    !sending;

  const startTrial = async () => {
    setTrialBusy(true);
    setError('');
    try {
      const data = await api.post<{ error?: string }>('/s/mailing/start-trial', {
        type: 'mailing_bot',
      });
      if (data?.error) throw new Error(data.error);
      await loadContext();
      enqueueSnackbar({
        message: 'Пробный период рассылки включён',
        variant: 'success',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось стартовать trial');
    } finally {
      setTrialBusy(false);
    }
  };

  const send = async () => {
    if (!canSend || !botId) return;
    setSending(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        text: text.trim(),
        segment,
      };
      if (funnelPhase) body.funnelPhase = funnelPhase;
      if (scheduledAt) {
        const d = new Date(scheduledAt);
        if (!Number.isNaN(d.getTime())) body.scheduledAt = d.toISOString();
      }
      const data = await api.post<{
        error?: string;
        queued?: number;
        billing?: unknown;
      }>(`/s/mailing/bots/${encodeURIComponent(botId)}/broadcasts`, body);
      if (data?.error) throw new Error(data.error);
      enqueueSnackbar({
        message:
          typeof data?.queued === 'number'
            ? `Запланировано: ${data.queued} получ.`
            : 'Рассылка создана',
        variant: 'success',
      });
      setText('');
      setScheduledAt('');
      await loadBroadcasts(botId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось создать рассылку');
    } finally {
      setSending(false);
    }
  };

  const fieldStyle: CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${border}`,
    background: soft,
    color: ink,
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
  };

  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 12,
    color: muted,
    marginBottom: 4,
  };

  if (loading) {
    return (
      <div style={{ padding: 24, color: muted, fontSize: 13 }}>Загрузка…</div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        minHeight: 480,
        boxSizing: 'border-box',
        padding: 20,
        background: panel,
        color: ink,
        overflow: 'auto',
        fontFamily:
          'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: '-0.02em' }}>
          Рассылка ботом
        </div>
        <div style={{ fontSize: 13, color: muted, marginTop: 4 }}>
          Сообщение подписчикам gift-бота. Отправка через существующий Broadcast API.
        </div>
      </div>

      {error ? (
        <div
          style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 8,
            border: `1px solid ${danger}`,
            color: danger,
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}

      {!billingOk ? (
        <div
          style={{
            marginBottom: 16,
            padding: '12px 14px',
            borderRadius: 10,
            background: soft,
            border: `1px solid ${border}`,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Нужен доступ к «Рассылка ботом»
          </div>
          <div style={{ fontSize: 12, color: muted, marginBottom: 10 }}>
            {billing?.trialAvailable
              ? `Можно включить пробный период на ${trialDays} дн.`
              : `Оформите подписку в «Кабинет Voxly» (${billing?.price || 500} ₽/мес).`}
          </div>
          {billing?.trialAvailable ? (
            <button
              type="button"
              disabled={trialBusy}
              onClick={() => void startTrial()}
              style={{
                border: 'none',
                background: accent,
                color: '#fff',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: 600,
                cursor: trialBusy ? 'default' : 'pointer',
                opacity: trialBusy ? 0.7 : 1,
              }}
            >
              {trialBusy ? 'Включаем…' : 'Включить пробный период'}
            </button>
          ) : null}
        </div>
      ) : (
        <div
          style={{
            marginBottom: 16,
            padding: '8px 12px',
            borderRadius: 8,
            background: soft,
            color: ok,
            fontSize: 12,
          }}
        >
          {billing?.isTrial
            ? `Пробный период активен${billing.activeUntil ? ` до ${formatWhen(billing.activeUntil)}` : ''}`
            : `Подписка активна${billing?.activeUntil ? ` до ${formatWhen(billing.activeUntil)}` : ''}`}
        </div>
      )}

      {bots.length === 0 ? (
        <div style={{ fontSize: 13, color: muted }}>
          Нет gift-ботов. Создайте бота в кабинете Voxly, затем обновите страницу.
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
            <div>
              <label style={labelStyle} htmlFor="mailing-bot">
                Бот
              </label>
              <select
                id="mailing-bot"
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
                style={fieldStyle}
              >
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    @{b.botUsername || 'без username'}
                    {b.hasGiftCampaign ? '' : ' (нет кампании)'}
                    {` · ${b.subscriberCount} подп.`}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={labelStyle} htmlFor="mailing-segment">
                  Сегмент (подарок)
                </label>
                <select
                  id="mailing-segment"
                  value={segment}
                  onChange={(e) => setSegment(e.target.value as Segment)}
                  style={fieldStyle}
                >
                  <option value="not_gifted">Без подарка</option>
                  <option value="gifted">С подарком</option>
                  <option value="all">Все</option>
                </select>
              </div>
              <div>
                <label style={labelStyle} htmlFor="mailing-phase">
                  Этап воронки
                </label>
                <select
                  id="mailing-phase"
                  value={funnelPhase}
                  onChange={(e) => setFunnelPhase(e.target.value as FunnelPhase)}
                  style={fieldStyle}
                >
                  <option value="">Любой</option>
                  <option value="started">started</option>
                  <option value="awaiting_sub">awaiting_sub</option>
                  <option value="gifted">gifted</option>
                  <option value="not_gifted">not_gifted</option>
                </select>
              </div>
            </div>

            <div>
              <label style={labelStyle} htmlFor="mailing-text">
                Текст сообщения
              </label>
              <textarea
                id="mailing-text"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder="Текст рассылки…"
                style={{ ...fieldStyle, resize: 'vertical', minHeight: 100 }}
              />
            </div>

            <div>
              <label style={labelStyle} htmlFor="mailing-when">
                Отложить (необязательно)
              </label>
              <input
                id="mailing-when"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                style={fieldStyle}
              />
              {scheduledAt ? (
                <div style={{ fontSize: 11, color: muted, marginTop: 4 }}>
                  Локально: {toLocalInputValue(new Date(scheduledAt).toISOString())}
                </div>
              ) : null}
            </div>

            <div>
              <button
                type="button"
                disabled={!canSend}
                onClick={() => void send()}
                style={{
                  border: 'none',
                  background: canSend ? ink : muted,
                  color: panel,
                  borderRadius: 10,
                  padding: '10px 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: canSend ? 'pointer' : 'default',
                  opacity: canSend ? 1 : 0.55,
                }}
              >
                {sending
                  ? 'Создаём…'
                  : scheduledAt
                    ? 'Запланировать'
                    : 'Отправить сейчас'}
              </button>
              {!selected?.hasGiftCampaign && botId ? (
                <span style={{ marginLeft: 10, fontSize: 12, color: danger }}>
                  У бота нет активной кампании
                </span>
              ) : null}
            </div>
          </div>

          <div style={{ marginTop: 28 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>История</div>
              {listBusy ? (
                <span style={{ fontSize: 12, color: muted }}>обновление…</span>
              ) : null}
            </div>
            {rows.length === 0 ? (
              <div style={{ fontSize: 13, color: muted }}>Пока нет рассылок</div>
            ) : (
              <div
                style={{
                  border: `1px solid ${border}`,
                  borderRadius: 10,
                  overflow: 'hidden',
                }}
              >
                {rows.slice(0, 20).map((r, i) => (
                  <div
                    key={r.id}
                    style={{
                      padding: '10px 12px',
                      borderTop: i === 0 ? 'none' : `1px solid ${border}`,
                      fontSize: 12,
                      display: 'grid',
                      gap: 4,
                    }}
                  >
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 600 }}>{r.status}</span>
                      <span style={{ color: muted }}>
                        {r.sentCount}/{r.totalCount}
                      </span>
                      <span style={{ color: muted }}>
                        {formatWhen(r.scheduledAt || r.createdAt)}
                      </span>
                      {r.segment ? (
                        <span style={{ color: muted }}>{r.segment}</span>
                      ) : null}
                    </div>
                    <div style={{ color: ink, whiteSpace: 'pre-wrap' }}>
                      {(r.text || '').slice(0, 160)}
                      {(r.text || '').length > 160 ? '…' : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default defineFrontComponent({
  universalIdentifier: MAILING_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'Voxly Mailing',
  description: 'In-CRM gift-bot mailing compose (Рассылка)',
  component: MailingPanel,
});
