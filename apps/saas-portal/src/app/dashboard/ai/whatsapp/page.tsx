'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, QrCode, Smartphone, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { PageHeader } from '@/components/portal/page-header';

interface WaAccount {
  id: string;
  name: string;
  displayName?: string;
  slug?: string;
  phoneNumberId: string | null;
  status: string;
  connected: boolean;
  updatedAt: string;
}

interface AccountsResponse {
  ok?: boolean;
  priceMonthly?: number;
  billingWarning?: string | null;
  evolutionConfigured?: boolean;
  evolutionHint?: string | null;
  waAddon?: { isActive: boolean; activeUntil: string; isTrial: boolean } | null;
  accounts: WaAccount[];
  pruned?: number;
  error?: string;
  hint?: string;
}

interface QrStatus {
  ok?: boolean;
  status?: string;
  botId?: string;
  qr?: string | null;
  error?: string | null;
  hint?: string;
  phoneNumberId?: string | null;
  billingWarning?: string | null;
  displayName?: string;
  name?: string;
}

const STATUS_LABEL: Record<string, string> = {
  preparing: 'Подготовка…',
  qr_ready: 'Отсканируйте QR в WhatsApp',
  authorized: 'Подключено',
  error: 'Ошибка',
  unknown: 'Нет активного входа',
};

export default function WhatsappConnectPage() {
  const router = useRouter();
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [accountName, setAccountName] = useState('');
  const [qrStatus, setQrStatus] = useState<QrStatus | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollNameRef = useRef('default');

  const loadAccounts = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/bots/whatsapp/accounts', { headers: authHeaders() });
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
    };
  }, [loadAccounts]);

  const pollStatus = async (name: string) => {
    try {
      const res = await fetch(
        `/api/bots/whatsapp/auth/qr/status?name=${encodeURIComponent(name)}`,
        { headers: authHeaders() },
      );
      const json = (await res.json()) as QrStatus;
      setQrStatus(json);
      if (json.status === 'authorized') {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = null;
        await loadAccounts();
      }
    } catch {
      /* ignore */
    }
  };

  const startQr = async () => {
    setBusy('qr');
    setError('');
    setQrStatus(null);
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const label = accountName.trim() || 'default';
      const res = await fetch('/api/bots/whatsapp/auth/qr/start', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: label }),
      });
      const json = (await res.json()) as QrStatus & { hint?: string; name?: string };
      if (!res.ok) {
        throw new Error(
          [json.error, json.hint].filter(Boolean).join(' — ') || 'Не удалось начать QR',
        );
      }
      // Worker returns sanitized ascii slug — poll with that, not raw Cyrillic input.
      const pollName = json.name || label;
      pollNameRef.current = pollName;
      setQrStatus(json);
      if (json.status !== 'authorized') {
        pollRef.current = setInterval(() => void pollStatus(pollName), 2500);
      } else {
        await loadAccounts();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка QR');
    } finally {
      setBusy('');
    }
  };

  const startTrial = async () => {
    setBusy('trial');
    setError('');
    try {
      const res = await fetch('/api/bots/whatsapp/start-trial', {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось стартовать trial');
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка trial');
    } finally {
      setBusy('');
    }
  };

  const deleteAccount = async (account: WaAccount) => {
    const label = account.displayName || account.name;
    if (!window.confirm(`Удалить аккаунт «${label}»? Сессия WhatsApp будет отключена.`)) {
      return;
    }
    setBusy(`del:${account.id}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/whatsapp/accounts/${account.id}`, {
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
        <LoadingState label="Загрузка WhatsApp…" />
      </AppShell>
    );
  }

  const price = data?.priceMonthly ?? 500;

  return (
    <AppShell>
      <PageHeader
        title="WhatsApp"
        description={
          <>
            Подключение аккаунта через QR (Evolution) · {price.toLocaleString('ru-RU')} ₽/мес + баланс
            {data?.waAddon?.isActive
              ? ` · активно до ${new Date(data.waAddon.activeUntil).toLocaleDateString('ru-RU')}${data.waAddon.isTrial ? ' (trial)' : ''}`
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
      {data?.billingWarning && (
        <Alert className="mb-4">{data.billingWarning}</Alert>
      )}
      {data && data.evolutionConfigured === false && (
        <Alert variant="error" className="mb-4">
          Evolution API не настроен на сервере.
          {data.evolutionHint ? ` ${data.evolutionHint}` : ''}
          Нужны переменные EVOLUTION_API_URL и EVOLUTION_API_KEY.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="h-4 w-4" />
              Подключить номер
            </CardTitle>
            <CardDescription>
              WhatsApp → Связанные устройства → Сканировать QR. Имя может быть на русском. AI молчит,
              пока не назначите агента.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!data?.waAddon?.isActive && (
              <Button
                variant="secondary"
                disabled={busy === 'trial'}
                onClick={() => void startTrial()}
              >
                {busy === 'trial' ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Пробный период 14 дней
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Input
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Имя аккаунта (напр. ремонт тоя)"
                className="max-w-[240px]"
              />
              <Button disabled={busy === 'qr'} onClick={() => void startQr()}>
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
                  <Badge variant={qrStatus.status === 'authorized' ? 'default' : 'secondary'}>
                    {STATUS_LABEL[qrStatus.status || 'unknown'] || qrStatus.status}
                  </Badge>
                  {qrStatus.status === 'authorized' && (
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                  )}
                </div>
                {qrStatus.displayName && (
                  <p className="text-sm text-muted-foreground">
                    Аккаунт: <span className="font-medium text-foreground">{qrStatus.displayName}</span>
                  </p>
                )}
                {qrStatus.error && (
                  <p className="text-sm text-destructive">
                    {qrStatus.error}
                    {qrStatus.hint ? ` — ${qrStatus.hint}` : ''}
                  </p>
                )}
                {!qrStatus.error && qrStatus.hint && qrStatus.status === 'preparing' && (
                  <p className="text-sm text-muted-foreground">{qrStatus.hint}</p>
                )}
                {qrStatus.qr && qrStatus.status !== 'authorized' && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qrStatus.qr}
                    alt="WhatsApp QR"
                    className="mx-auto h-64 w-64 rounded-md border bg-white p-2"
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Подключённые аккаунты</CardTitle>
            <CardDescription>Канал whatsapp · botType ai_wa</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(data?.accounts || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет аккаунтов.</p>
            ) : (
              data!.accounts.map((a) => {
                const label = a.displayName || a.name;
                const slug = a.slug || a.name;
                const showSlug = slug && slug !== label;
                return (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{label}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {a.phoneNumberId || 'номер появится после скана'} · {a.status}
                        {showSlug ? ` · ${slug}` : ''}
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
                );
              })
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
