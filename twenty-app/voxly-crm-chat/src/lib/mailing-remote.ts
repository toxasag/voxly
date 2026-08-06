import { getApplicationVariable } from 'twenty-sdk/front-component';
import { RestApiClient } from 'twenty-client-sdk/rest';
import type { CSSProperties } from 'react';

export type BillingProduct = {
  isActive?: boolean;
  isTrial?: boolean;
  trialAvailable?: boolean;
  price?: number;
  activeUntil?: string | null;
};

export type AccountRow = {
  id: string;
  botUsername?: string | null;
  name?: string | null;
  displayName?: string | null;
  status?: string | null;
  hasGiftCampaign?: boolean;
  subscriberCount?: number;
  botType?: string;
};

export type BroadcastRow = {
  id: string;
  status: string;
  scheduledAt: string | null;
  sentCount: number;
  totalCount: number;
  deliveredCount?: number;
  readCount?: number;
  failedCount?: number;
  segment?: string;
  funnelPhase?: string | null;
  opportunityStage?: string | null;
  giftStarted?: string | null;
  readStatus?: string | null;
  text?: string;
  mediaUrl?: string | null;
  telegramFileId?: string | null;
  mediaType?: string | null;
  channel?: string;
  createdAt: string;
};

export type StageOpt = { value: string; label: string };

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
    // ignore
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

export function workspaceAwareFetch(
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

export const mailingApi = new RestApiClient({ fetch: workspaceAwareFetch });

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function formatWhen(iso: string | null | undefined): string {
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

export function accountLabel(a: AccountRow): string {
  return (
    a.displayName ||
    a.name ||
    (a.botUsername ? `@${a.botUsername}` : null) ||
    a.id
  );
}

export function useMailingTheme(dark: boolean) {
  return {
    ink: dark ? '#f5f5f5' : '#1a1a1a',
    muted: dark ? '#9ca3af' : '#6b7280',
    panel: dark ? '#1f1f23' : '#ffffff',
    border: dark ? '#333' : '#e5e7eb',
    soft: dark ? '#2a2a2e' : '#f3f4f6',
    accent: dark ? '#818cf8' : '#4f46e5',
    danger: dark ? '#fca5a5' : '#b91c1c',
    ok: dark ? '#86efac' : '#166534',
  };
}

export function fieldStyle(
  t: ReturnType<typeof useMailingTheme>,
): CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    border: `1px solid ${t.border}`,
    background: t.soft,
    color: t.ink,
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 13,
  };
}

export function labelStyle(
  t: ReturnType<typeof useMailingTheme>,
): CSSProperties {
  return {
    display: 'block',
    fontSize: 12,
    color: t.muted,
    marginBottom: 4,
  };
}

/** Open portal mailing page with ?pay=1 → Robokassa when trial already used. */
export function openMailingPayment(
  product: 'mailing_bot' | 'mailing_accounts' | 'mailing_stories',
): void {
  const path =
    product === 'mailing_bot'
      ? 'mailing/bot'
      : product === 'mailing_accounts'
        ? 'mailing/gramjs'
        : 'mailing/stories';
  let cabinet =
    (typeof process !== 'undefined' && process.env?.VOXLY_CABINET_URL?.trim()) ||
    'https://getvoxly.ru/dashboard';
  cabinet = cabinet.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(cabinet)) {
    cabinet = 'https://getvoxly.ru/dashboard';
  }
  const url = `${cabinet}/${path}?pay=1`;
  try {
    window.open(url, '_blank', 'noopener,noreferrer');
  } catch {
    // ignore
  }
}
