'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import { PRICING, TRIAL_PERIOD_DAYS } from '@voxly/shared';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { AiGramjsHero } from '@/components/portal/ai-gramjs-hero';

interface GramjsAccount {
  id: string;
  name: string;
  telegramUserId: string | null;
  status: string;
  connected: boolean;
  updatedAt: string;
}

interface AccountsResponse {
  ok?: boolean;
  priceMonthly?: number;
  trialDays?: number;
  billingWarning?: string | null;
  requiresPayment?: boolean;
  trialAvailable?: boolean;
  gramjsAddon?: { isActive: boolean; activeUntil: string; isTrial: boolean } | null;
  accounts: GramjsAccount[];
  error?: string;
  hint?: string;
}

interface QrStatus {
  ok?: boolean;
  status?: string;
  botId?: string;
  qr?: string | null;
  error?: string | null;
  user?: { id: string; username?: string; firstName?: string } | null;
  billingWarning?: string | null;
}

interface AiContext {
  agents: number;
  walletRub: number;
}

type ConnectPhase =
  | 'idle'
  | 'preparing'
  | 'qr_ready'
  | 'waiting_password'
  | 'processing_password'
  | 'authorized'
  | 'failed';

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';

const STATUS_LABEL: Record<string, string> = {
  preparing: 'Подготовка…',
  qr_ready: 'Отсканируйте QR в Telegram',
  waiting_password: 'Введите пароль 2FA',
  processing_password: 'Проверяем пароль…',
  authorized: 'Подключено',
  error: 'Ошибка',
  unknown: 'Нет активного входа',
};

function formatRub(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v.toLocaleString('ru-RU', {
    minimumFractionDigits: v > 0 && v < 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU');
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function SectionHead({
  index,
  kicker,
  title,
  description,
}: {
  index: string;
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/40">
        {index} · {kicker}
      </p>
      <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">{title}</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-black/55">{description}</p>
    </div>
  );
}

function phaseFromStatus(status?: string): ConnectPhase {
  if (!status || status === 'unknown') return 'idle';
  if (status === 'preparing') return 'preparing';
  if (status === 'qr_ready') return 'qr_ready';
  if (status === 'waiting_password') return 'waiting_password';
  if (status === 'processing_password') return 'processing_password';
  if (status === 'authorized') return 'authorized';
  if (status === 'error') return 'failed';
  return 'idle';
}

export default function GramjsChannelPage() {
  const router = useRouter();
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [context, setContext] = useState<AiContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [accountName, setAccountName] = useState('');
  const [qrStatus, setQrStatus] = useState<QrStatus | null>(null);
  const [qrPngUrl, setQrPngUrl] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollNameRef = useRef('default');
  const pngUrlRef = useRef<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const connectSectionRef = useRef<HTMLElement>(null);

  const clearPng = () => {
    if (pngUrlRef.current) {
      URL.revokeObjectURL(pngUrlRef.current);
      pngUrlRef.current = null;
    }
    setQrPngUrl(null);
  };

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const loadAccounts = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/bots/gramjs/accounts', { headers: authHeaders() });
      const json = (await res.json()) as AccountsResponse;
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить аккаунты');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const loadContext = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/dashboard', { headers: authHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      setContext({
        agents: Number(json?.accounts?.agents) || 0,
        walletRub: Number(json?.money?.aiWalletRub) || 0,
      });
    } catch {
      /* optional */
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadContext();
    return () => {
      stopPolling();
      clearPng();
    };
  }, [loadAccounts, loadContext, stopPolling]);

  const fetchPng = async (name: string) => {
    try {
      const res = await fetch(
        `/api/bots/gramjs/auth/qr/png?name=${encodeURIComponent(name)}`,
        { headers: authHeaders() },
      );
      if (!res.ok) return;
      const blob = await res.blob();
      clearPng();
      const url = URL.createObjectURL(blob);
      pngUrlRef.current = url;
      setQrPngUrl(url);
    } catch {
      /* ignore */
    }
  };

  const pollStatus = useCallback(
    async (name: string) => {
      try {
        const res = await fetch(
          `/api/bots/gramjs/auth/qr/status?name=${encodeURIComponent(name)}`,
          { headers: authHeaders() },
        );
        const json = (await res.json()) as QrStatus;
        if (!res.ok) {
          setError(json.error || 'Ошибка статуса QR');
          setPhase('failed');
          return json;
        }
        setQrStatus(json);
        const nextPhase = phaseFromStatus(json.status);
        setPhase(nextPhase);
        if (json.status === 'qr_ready') {
          await fetchPng(name);
        }
        if (json.status === 'authorized') {
          stopPolling();
          clearPng();
          await loadAccounts();
        }
        if (json.status === 'error' && json.error) {
          setError(json.error);
          setPhase('failed');
        }
        return json;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Ошибка опроса');
        setPhase('failed');
        return null;
      }
    },
    [loadAccounts, stopPolling],
  );

  const startQr = async () => {
    setBusy('qr');
    setError('');
    setQrStatus(null);
    clearPng();
    stopPolling();
    setPhase('preparing');
    try {
      const name = accountName.trim() || 'default';
      const res = await fetch('/api/bots/gramjs/auth/qr/start', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error ||
            json.detail ||
            (json.hint ? `${json.error || 'Ошибка'}. ${json.hint}` : 'Не удалось начать QR-вход'),
        );
      }
      setQrStatus(json);
      pollNameRef.current = name;
      await pollStatus(name);
      pollRef.current = setInterval(() => {
        void pollStatus(name);
      }, 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      setPhase('failed');
    } finally {
      setBusy('');
    }
  };

  const submitPassword = async () => {
    setBusy('password');
    setError('');
    setPhase('processing_password');
    try {
      const name = pollNameRef.current || accountName.trim() || 'default';
      const res = await fetch('/api/bots/gramjs/auth/qr/password', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ name, password }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Неверный пароль');
      setPassword('');
      await pollStatus(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      setPhase('waiting_password');
    } finally {
      setBusy('');
    }
  };

  const startTrial = async () => {
    setBusy('trial');
    setError('');
    try {
      const res = await fetch('/api/bots/gramjs/start-trial', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось активировать trial');
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const paySubscription = async () => {
    setBusy('pay');
    setError('');
    try {
      await startCheckout({ productCode: 'ai_gramjs', periodMonths: 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setBusy('');
    }
  };

  const deleteAccount = async (account: GramjsAccount) => {
    setBusy(`del:${account.id}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/gramjs/accounts/${account.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось удалить');
      setDeleteConfirmId('');
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления');
    } finally {
      setBusy('');
    }
  };

  const focusConnectForm = () => {
    connectSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => nameInputRef.current?.focus(), 400);
  };

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState label="Загрузка Telegram…" />
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">{error || 'Не удалось загрузить канал Telegram.'}</Alert>
      </AppShell>
    );
  }

  const price = data.priceMonthly ?? PRICING.AI_GRAMJS_MONTHLY;
  const accounts = data.accounts || [];
  const connectedAccounts = accounts.filter((a) => a.connected);
  const subActive = Boolean(data.gramjsAddon?.isActive);
  const trialAvailable = data.trialAvailable !== false;
  const requiresPayment = !subActive;
  const canStartQr = subActive && !data.requiresPayment;

  const subBadge = subActive
    ? data.gramjsAddon?.isTrial
      ? { variant: 'warning' as const, text: 'Пробный период' }
      : { variant: 'success' as const, text: 'Подписка активна' }
    : trialAvailable
      ? { variant: 'secondary' as const, text: 'Не подключён' }
      : { variant: 'warning' as const, text: 'Подписка закончилась' };

  const statusKey = qrStatus?.status || 'unknown';
  const phaseLabel = STATUS_LABEL[statusKey] || STATUS_LABEL.unknown;

  const heroState: 'connected' | 'pending' | 'off' = subActive
    ? connectedAccounts.length > 0
      ? 'connected'
      : phase !== 'idle' && phase !== 'failed'
        ? 'pending'
        : 'pending'
    : 'off';

  const heroStateLabel = !subActive
    ? trialAvailable
      ? 'Подписка не включена'
      : 'Подписка закончилась'
    : connectedAccounts.length > 0
      ? 'Telegram на связи'
      : phase === 'qr_ready' || phase === 'waiting_password'
        ? 'Ждём вход по QR'
        : 'Аккаунт не подключён';

  const heroStateHint = !subActive
    ? trialAvailable
      ? `Включите ${TRIAL_PERIOD_DAYS} бесплатных дней или оплатите тариф — без подписки QR недоступен.`
      : `Оплатите ${formatRub(price)} ₽/мес, чтобы снова подключать аккаунт.`
    : connectedAccounts.length > 0
      ? 'AI отвечает от вашего личного Telegram, если назначен агент и есть баланс.'
      : 'Telegram → Настройки → Устройства → Подключить устройство — отсканируйте QR справа.';

  const heroTitle = requiresPayment
    ? 'Telegram ждёт подписку'
    : connectedAccounts.length > 0
      ? 'Telegram подключён'
      : 'Подключите Telegram по QR-коду';

  const heroActionLabel = requiresPayment
    ? trialAvailable
      ? `Включить ${TRIAL_PERIOD_DAYS} бесплатных дней`
      : `Оплатить ${formatRub(price)} ₽/мес`
    : connectedAccounts.length > 0
      ? 'Подключить ещё аккаунт'
      : 'Подключить аккаунт';

  const phaseBadge: 'success' | 'warning' | 'destructive' | 'secondary' =
    phase === 'authorized'
      ? 'success'
      : phase === 'failed'
        ? 'destructive'
        : phase === 'idle'
          ? 'secondary'
          : 'warning';

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
        <AiGramjsHero
          title={heroTitle}
          subtitle="Voxly подключается к вашему личному Telegram через QR — как «Подключить устройство». Без бота: AI отвечает от вашего имени, если назначен агент."
          facts={[
            {
              label: 'Аккаунтов на связи',
              value: `${connectedAccounts.length} из ${accounts.length || 0}`,
            },
            {
              label: 'Подписка',
              value: subActive
                ? data.gramjsAddon?.activeUntil
                  ? `до ${formatDate(data.gramjsAddon.activeUntil)}`
                  : 'активна'
                : trialAvailable
                  ? `${TRIAL_PERIOD_DAYS} дней бесплатно`
                  : 'не активна',
            },
            {
              label: 'Баланс AI',
              value: context ? `${formatRub(context.walletRub)} ₽` : '—',
            },
          ]}
          stateLabel={heroStateLabel}
          stateTone={heroState}
          stateHint={heroStateHint}
          actionLabel={heroActionLabel}
          actionDisabled={busy === 'trial' || busy === 'pay'}
          onAction={() => {
            if (requiresPayment) {
              if (trialAvailable) void startTrial();
              else void paySubscription();
              return;
            }
            focusConnectForm();
          }}
          footerLabel="Тариф канала"
          footerValue={`${formatRub(price)} ₽/мес`}
        />

        {error ? <Alert variant="error">{error}</Alert> : null}
        {data.billingWarning ? <Alert variant="info">{data.billingWarning}</Alert> : null}

        {context && context.agents === 0 && connectedAccounts.length > 0 ? (
          <Alert variant="info">
            <div className="space-y-1">
              <p className="font-semibold">Telegram на связи, но отвечать некому</p>
              <p>
                AI-агент не создан — клиентам никто не отвечает автоматически.{' '}
                <Link
                  href="/dashboard/ai/agents"
                  className="font-semibold underline underline-offset-2"
                >
                  Создать и назначить агента
                </Link>
                .
              </p>
            </div>
          </Alert>
        ) : null}

        {context && context.walletRub <= 0 && connectedAccounts.length > 0 ? (
          <Alert variant="error">
            <div className="space-y-1">
              <p className="font-semibold">Баланс AI на нуле — ответы не отправляются</p>
              <p>
                Аккаунт остаётся подключённым, но нейросеть не отвечает.{' '}
                <Link
                  href="/dashboard/ai/agents"
                  className="font-semibold underline underline-offset-2"
                >
                  Пополнить баланс
                </Link>
                .
              </p>
            </div>
          </Alert>
        ) : null}

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHead
              index="01"
              kicker="деньги"
              title="Тариф Telegram"
              description="Подписка даёт право принимать сообщения в личном Telegram. Ответы нейросети оплачивает общий баланс AI."
            />
            <Badge variant={subBadge.variant}>{subBadge.text}</Badge>
          </div>

          <div className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="land-display text-[20px] tracking-[-0.03em] text-black">
                {subActive && data.gramjsAddon?.activeUntil
                  ? `Действует до ${formatDate(data.gramjsAddon.activeUntil)}`
                  : trialAvailable
                    ? `${TRIAL_PERIOD_DAYS} дней бесплатно, потом ${formatRub(price)} ₽/мес`
                    : 'Подписка не активна'}
              </p>
              <p className="text-sm tabular-nums text-black/55">{formatRub(price)} ₽/мес за канал</p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {!subActive && trialAvailable ? (
                <button
                  type="button"
                  disabled={busy === 'trial'}
                  onClick={() => void startTrial()}
                  className="land-btn-amber min-h-11 cursor-pointer px-4 text-sm disabled:opacity-50"
                >
                  {busy === 'trial' ? 'Включаем…' : `Включить ${TRIAL_PERIOD_DAYS} бесплатных дней`}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy === 'pay'}
                onClick={() => void paySubscription()}
                className={`min-h-11 cursor-pointer px-4 text-sm disabled:opacity-50 ${
                  !subActive && !trialAvailable ? 'land-btn-amber' : 'land-btn-ghost'
                }`}
              >
                {busy === 'pay'
                  ? 'Переходим к оплате…'
                  : subActive
                    ? `Продлить на месяц · ${formatRub(price)} ₽`
                    : `Оплатить ${formatRub(price)} ₽/мес`}
              </button>
            </div>
          </div>
        </section>

        <section
          ref={connectSectionRef}
          id="podklyuchenie"
          className="scroll-mt-6 rounded-2xl border border-black/10 bg-white p-5 sm:p-6"
        >
          <SectionHead
            index="02"
            kicker="подключение"
            title="Как подключить аккаунт"
            description="Telegram → Настройки → Устройства → Подключить устройство. Если включена 2FA — после QR попросим облачный пароль."
          />

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <ol className="space-y-2.5">
                {[
                  'Придумайте название аккаунта — оно только для списка в Voxly.',
                  'Нажмите «Показать QR». Код появится справа и будет обновляться.',
                  'На телефоне откройте Telegram → Настройки → Устройства → Подключить устройство.',
                  'Если включена двухфакторная защита — введите облачный пароль в форме справа.',
                ].map((text, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-[11px] font-bold text-black">
                      {i + 1}
                    </span>
                    <span className="text-sm leading-snug text-black/70">{text}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-5">
                <label htmlFor="gramjs-account-name" className="block text-sm font-medium text-black">
                  Название аккаунта
                </label>
                <input
                  id="gramjs-account-name"
                  ref={nameInputRef}
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Например: default"
                  disabled={busy === 'qr' || !canStartQr}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-black/40 disabled:opacity-50"
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === 'qr' || !canStartQr}
                    onClick={() => void startQr()}
                    className="land-btn min-h-11 cursor-pointer px-5 text-sm disabled:opacity-50"
                  >
                    {busy === 'qr' ? 'Готовим QR…' : 'Показать QR'}
                    <Smartphone className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={phase === 'idle' || busy === 'qr'}
                    onClick={() => void pollStatus(pollNameRef.current || 'default')}
                    className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm disabled:opacity-50"
                  >
                    Обновить статус
                    <RefreshCw className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                {!canStartQr ? (
                  <p className="mt-2 text-xs text-black/55">
                    {trialAvailable
                      ? 'Сначала включите пробный период или оплатите тариф в блоке выше.'
                      : 'Подписка не активна — оплатите тариф в блоке выше.'}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Статус подключения
                </p>
                <Badge variant={phaseBadge}>{phaseLabel}</Badge>
              </div>

              {qrStatus?.user ? (
                <p className="mt-3 text-sm text-black/65">
                  Аккаунт:{' '}
                  <span className="font-semibold text-black">
                    {qrStatus.user.username
                      ? `@${qrStatus.user.username}`
                      : qrStatus.user.firstName || qrStatus.user.id}
                  </span>
                </p>
              ) : null}

              {qrStatus?.error ? (
                <p className="mt-2 text-sm text-[#b91c1c]">{qrStatus.error}</p>
              ) : null}

              {qrPngUrl && phase === 'qr_ready' ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrPngUrl}
                    alt="Telegram QR"
                    className="mx-auto mt-4 h-64 w-64 rounded-xl border border-black/10 bg-white p-2"
                  />
                  <p className="mt-2 text-center text-xs text-black/55">
                    Код обновляется, пока открыта эта страница.
                  </p>
                </>
              ) : null}

              {phase === 'waiting_password' || phase === 'processing_password' ? (
                <div className="mt-4 space-y-2">
                  <label htmlFor="gramjs-2fa" className="block text-sm font-medium text-black">
                    Облачный пароль 2FA
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="gramjs-2fa"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Пароль двухфакторной защиты"
                      autoComplete="one-time-code"
                      disabled={busy === 'password'}
                      className="min-h-11 w-full max-w-[240px] rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-black/40 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      disabled={busy === 'password' || !password}
                      onClick={() => void submitPassword()}
                      className="land-btn min-h-11 cursor-pointer px-4 text-sm disabled:opacity-50"
                    >
                      {busy === 'password' ? 'Проверяем…' : 'Отправить пароль'}
                    </button>
                  </div>
                </div>
              ) : null}

              {phase === 'authorized' ? (
                <Link
                  href="/dashboard/ai/agents"
                  className="land-btn mt-4 inline-flex min-h-11 cursor-pointer px-4 text-sm"
                >
                  Назначить AI-агента
                </Link>
              ) : null}

              {phase === 'idle' ? (
                <div className="mt-4 rounded-lg border border-dashed border-black/15 bg-white px-3 py-6 text-center">
                  <p className="text-sm font-semibold text-black">QR-кода пока нет</p>
                  <p className="mx-auto mt-1 max-w-[36ch] text-xs text-black/55">
                    Он появится здесь после «Показать QR».
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <SectionHead
            index="03"
            kicker="аккаунты"
            title="Подключённые аккаунты Telegram"
            description="Канал telegram_gramjs · личный аккаунт без бота."
          />

          {accounts.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="font-semibold text-black">Ни одного аккаунта пока не подключено</p>
              <button
                type="button"
                disabled={!canStartQr}
                onClick={focusConnectForm}
                className="land-btn-amber mt-4 min-h-11 cursor-pointer px-4 text-sm disabled:opacity-50"
              >
                Подключить первый аккаунт
              </button>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead className="bg-[#faf8f5]">
                  <tr>
                    <th className={TH}>Название</th>
                    <th className={TH}>Telegram ID</th>
                    <th className={TH}>Состояние</th>
                    <th className={TH}>Обновлено</th>
                    <th className={`${TH} text-right`}>Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {accounts.map((account) => (
                    <tr key={account.id} className="hover:bg-[#faf8f5]">
                      <td className="px-3 py-3 font-medium text-black">{account.name}</td>
                      <td className="px-3 py-3 text-sm text-black/70">
                        {account.telegramUserId || (
                          <span className="text-black/45">появится после скана</span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {account.connected ? (
                          <Badge variant="success">На связи</Badge>
                        ) : (
                          <Badge variant="warning">Отключён</Badge>
                        )}
                      </td>
                      <td className="px-3 py-3 text-sm tabular-nums text-black/55">
                        {formatDateTime(account.updatedAt)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {deleteConfirmId === account.id ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <span className="text-xs text-black/55">
                              Удалить «{account.name}»?
                            </span>
                            <button
                              type="button"
                              disabled={busy === `del:${account.id}`}
                              onClick={() => void deleteAccount(account)}
                              className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#c2410c]/40 bg-[#fff5f0] px-3 text-xs font-semibold text-[#c2410c]"
                            >
                              {busy === `del:${account.id}` ? 'Удаляем…' : 'Да, удалить'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId('')}
                              className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65"
                            >
                              Отмена
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={Boolean(busy)}
                            onClick={() => setDeleteConfirmId(account.id)}
                            className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-black/15 text-black/55 hover:border-[#c2410c]/50 hover:text-[#c2410c] disabled:opacity-50"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <SectionHead
            index="04"
            kicker="дальше"
            title="Что нужно, чтобы AI отвечал"
            description="Подключённый Telegram сам по себе только собирает переписку. Для автоответов нужны агент и баланс."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                AI-агент
              </p>
              <p className="land-display mt-1.5 text-[20px] tracking-[-0.03em] text-black">
                {context
                  ? `${context.agents} ${plural(context.agents, ['агент', 'агента', 'агентов'])}`
                  : '—'}
              </p>
              <Link
                href="/dashboard/ai/agents"
                className="land-btn-ghost mt-3 min-h-11 cursor-pointer px-4 text-sm"
              >
                {context && context.agents === 0 ? 'Создать агента' : 'Настроить агентов'}
              </Link>
            </div>
            <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                Баланс AI
              </p>
              <p className="land-display mt-1.5 text-[20px] tabular-nums tracking-[-0.03em] text-black">
                {context ? `${formatRub(context.walletRub)} ₽` : '—'}
              </p>
              <Link
                href="/dashboard/ai/agents"
                className="land-btn-ghost mt-3 min-h-11 cursor-pointer px-4 text-sm"
              >
                Пополнить баланс
              </Link>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
