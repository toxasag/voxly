'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, QrCode, Smartphone, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { PageHeader } from '@/components/portal/page-header';

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

const STATUS_LABEL: Record<string, string> = {
  preparing: 'Подготовка…',
  qr_ready: 'Отсканируйте QR в Telegram',
  waiting_password: 'Введите пароль 2FA',
  processing_password: 'Проверяем пароль…',
  authorized: 'Подключено',
  error: 'Ошибка',
  unknown: 'Нет активного входа',
};

export default function GramjsPage() {
  const router = useRouter();
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [accountName, setAccountName] = useState('');
  const [qrStatus, setQrStatus] = useState<QrStatus | null>(null);
  const [qrPngUrl, setQrPngUrl] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollNameRef = useRef('default');
  const pngUrlRef = useRef<string | null>(null);

  const clearPng = () => {
    if (pngUrlRef.current) {
      URL.revokeObjectURL(pngUrlRef.current);
      pngUrlRef.current = null;
    }
    setQrPngUrl(null);
  };

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
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadAccounts();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      clearPng();
    };
  }, [loadAccounts]);

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

  const pollStatus = async (name: string) => {
    try {
      const res = await fetch(
        `/api/bots/gramjs/auth/qr/status?name=${encodeURIComponent(name)}`,
        { headers: authHeaders() },
      );
      const json = (await res.json()) as QrStatus;
      if (!res.ok) {
        setError(json.error || 'Ошибка статуса QR');
        return json;
      }
      setQrStatus(json);
      if (json.status === 'qr_ready') {
        await fetchPng(name);
      }
      if (json.status === 'authorized') {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        clearPng();
        await loadAccounts();
      }
      if (json.status === 'error' && json.error) {
        setError(json.error);
      }
      return json;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка опроса');
      return null;
    }
  };

  const startQr = async () => {
    setBusy('qr');
    setError('');
    setQrStatus(null);
    clearPng();
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
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
    } finally {
      setBusy('');
    }
  };

  const submitPassword = async () => {
    setBusy('password');
    setError('');
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
    if (
      !window.confirm(
        `Удалить аккаунт «${account.name}»? Сессия Telegram будет отключена.`,
      )
    ) {
      return;
    }
    setBusy(`del:${account.id}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/gramjs/accounts/${account.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось удалить');
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <AppShell>
        <LoadingState label="Загрузка Telegram…" />
      </AppShell>
    );
  }

  const price = data?.priceMonthly ?? 500;
  const statusKey = qrStatus?.status || 'unknown';

  return (
    <AppShell>
      <PageHeader
        title="Личный Telegram"
        description={
          <>
            Подключение аккаунта через QR (GramJS) · {price.toLocaleString('ru-RU')} ₽/мес + баланс
            {data?.gramjsAddon?.isActive
              ? ` · активно до ${new Date(data.gramjsAddon.activeUntil).toLocaleDateString('ru-RU')}${data.gramjsAddon.isTrial ? ' (trial)' : ''}`
              : ''}
          </>
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard">Назад</Link>
          </Button>
        }
      />

      {error && <Alert variant="error" className="mb-4">{error}</Alert>}
      {data?.billingWarning && <Alert className="mb-4">{data.billingWarning}</Alert>}

      {!data?.gramjsAddon?.isActive && data?.trialAvailable !== false && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Старт за 14 дней бесплатно</CardTitle>
            <CardDescription>
              Подключите личный Telegram через QR. Потом —{' '}
              {price.toLocaleString('ru-RU')} ₽/мес + баланс AI.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="solid" disabled={busy === 'trial'} onClick={() => void startTrial()}>
              {busy === 'trial' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Активировать trial
            </Button>
            <Button variant="outline" disabled={busy === 'pay'} onClick={() => void paySubscription()}>
              {busy === 'pay' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Оплатить {price.toLocaleString('ru-RU')} ₽/мес
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="h-4 w-4" />
              Подключить аккаунт
            </CardTitle>
            <CardDescription>
              Telegram → Настройки → Устройства → Подключить устройство. AI молчит, пока не
              назначите агента.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!data?.gramjsAddon?.isActive && data?.trialAvailable === false && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="solid"
                  disabled={busy === 'pay'}
                  onClick={() => void paySubscription()}
                >
                  {busy === 'pay' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Оплатить {price.toLocaleString('ru-RU')} ₽/мес
                </Button>
              </div>
            )}
            {data?.requiresPayment && (
              <Alert variant="error">
                {data.trialAvailable
                  ? 'Сначала активируйте trial выше — или оплатите тариф.'
                  : 'Подписка неактивна — QR недоступен. Оплатите тариф.'}
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Имя аккаунта (напр. default)"
                className="max-w-[240px]"
              />
              <Button
                disabled={busy === 'qr' || Boolean(data?.requiresPayment)}
                onClick={() => void startQr()}
              >
                {busy === 'qr' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Smartphone className="mr-2 h-4 w-4" />
                )}
                Показать QR
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void pollStatus(pollNameRef.current || 'default')}
                title="Обновить статус"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {qrStatus && (
              <div className="space-y-3 rounded-lg border border-border p-4">
                <div className="flex items-center gap-2">
                  <Badge variant={statusKey === 'authorized' ? 'default' : 'secondary'}>
                    {STATUS_LABEL[statusKey] || statusKey}
                  </Badge>
                  {statusKey === 'authorized' && (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  )}
                </div>
                {qrStatus.user && (
                  <p className="text-sm text-muted-foreground">
                    Аккаунт:{' '}
                    <span className="font-medium text-foreground">
                      {qrStatus.user.username
                        ? `@${qrStatus.user.username}`
                        : qrStatus.user.firstName || qrStatus.user.id}
                    </span>
                  </p>
                )}
                {qrStatus.error && (
                  <p className="text-sm text-destructive">{qrStatus.error}</p>
                )}
                {qrPngUrl && statusKey === 'qr_ready' && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrPngUrl}
                    alt="Telegram QR"
                    className="mx-auto h-64 w-64 rounded-md border bg-white p-2"
                  />
                )}
                {statusKey === 'waiting_password' && (
                  <div className="flex flex-wrap gap-2">
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Облачный пароль 2FA"
                      autoComplete="one-time-code"
                      className="max-w-[240px]"
                    />
                    <Button
                      disabled={busy === 'password' || !password}
                      onClick={() => void submitPassword()}
                    >
                      {busy === 'password' ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Отправить
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Подключённые аккаунты</CardTitle>
            <CardDescription>Канал telegram_gramjs · botType ai_gramjs</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.accounts || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет аккаунтов.</p>
            ) : (
              data!.accounts.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {a.telegramUserId ? `id ${a.telegramUserId}` : 'id появится после скана'} ·{' '}
                      {a.status}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={a.connected ? 'default' : 'secondary'}>
                      {a.connected ? 'online' : 'offline'}
                    </Badge>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      disabled={busy === `del:${a.id}`}
                      title="Удалить аккаунт"
                      onClick={() => void deleteAccount(a)}
                    >
                      {busy === `del:${a.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))
            )}
            <p className="text-xs text-muted-foreground">
              Назначить AI-агента:{' '}
              <Link href="/dashboard/ai/agents" className="underline underline-offset-2">
                /dashboard/ai/agents
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
