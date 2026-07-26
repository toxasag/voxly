'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Bot,
  Plus,
  ExternalLink,
  Loader2,
  MessageSquare,
  Trash2,
} from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { PageHeader } from '@/components/portal/page-header';

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  botLink: string | null;
  conversationCount?: number;
  businessConnectionCount?: number;
}

interface BotsResponse {
  aiBotPriceMonthly?: number;
  maxBusinessConnections?: number;
  aiAddon: {
    activeUntil: string;
    isTrial: boolean;
    isActive: boolean;
  } | null;
  bots: BotRow[];
}

export default function AiBotsListPage() {
  const router = useRouter();
  const [data, setData] = useState<BotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const session = localStorage.getItem('voxly_token');
    if (!session) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/bots', { headers: authHeaders() });
      if (!res.ok) throw new Error('Не удалось загрузить ботов');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const aiBots = (data?.bots || []).filter((b) => b.botType === 'ai_tg');
  const price = data?.aiBotPriceMonthly ?? 1000;
  const maxConn = data?.maxBusinessConnections ?? 10;
  const formVisible = showForm || aiBots.length === 0;

  const startTrial = async () => {
    setBusy('trial');
    setError('');
    try {
      const res = await fetch('/api/bots/ai/start-trial', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось активировать trial');
      await load();
      setShowForm(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const connectBot = async () => {
    setBusy('connect');
    setError('');
    setInfo('');
    try {
      if (!data?.aiAddon?.isActive) {
        const trialRes = await fetch('/api/bots/ai/start-trial', {
          method: 'POST',
          headers: authHeaders(),
          body: '{}',
        });
        const trialJson = await trialRes.json();
        if (!trialRes.ok) throw new Error(trialJson.error || 'Не удалось активировать trial');
      }
      const res = await fetch('/api/bots/ai/connect', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          username: username.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          [json.error, json.hint].filter(Boolean).join(' — ') || 'Не удалось подключить',
        );
      }
      setToken('');
      setUsername('');
      setShowForm(false);
      if (json.businessWarning) setInfo(json.businessWarning);
      if (json.webhookOk === false && json.webhookError) {
        setError(`Бот сохранён, но webhook: ${json.webhookError}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const deleteBot = async (bot: BotRow) => {
    const label = bot.botUsername ? `@${bot.botUsername}` : bot.id;
    if (!window.confirm(`Удалить бота ${label}? Webhook будет снят, диалоги отвяжутся.`)) {
      return;
    }
    setBusy(`del:${bot.id}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/${bot.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось удалить');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <AppShell>
        <LoadingState label="Загрузка…" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title="Telegram Business"
        description={
          <>
            Бот-секретарь для «Автоматизация чатов» · до {maxConn} аккаунтов ·{' '}
            {data?.aiAddon?.isActive
              ? `активно до ${new Date(data.aiAddon.activeUntil).toLocaleDateString('ru-RU')}${data.aiAddon.isTrial ? ' (trial)' : ''}`
              : `${price.toLocaleString('ru-RU')} ₽/мес`}
            . AI отвечает только после назначения агента.
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">Назад</Link>
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard/ai/agents">
                <Bot className="h-4 w-4" /> AI-агенты
              </Link>
            </Button>
            {!formVisible && (
              <Button
                variant="solid"
                size="sm"
                onClick={() => {
                  setShowForm(true);
                  setError('');
                }}
              >
                <Plus className="h-4 w-4" /> Подключить бота
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <Alert className="mb-4" variant="error">
          {error}
        </Alert>
      )}
      {info && (
        <Alert className="mb-4" variant="info">
          {info}
        </Alert>
      )}

      {!data?.aiAddon?.isActive && aiBots.length === 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Старт за 7 дней бесплатно</CardTitle>
            <CardDescription>
              Бот-секретарь для «Автоматизация чатов». Дальше —{' '}
              {price.toLocaleString('ru-RU')} ₽/мес (до {maxConn} аккаунтов) + баланс AI.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="solid" onClick={startTrial} disabled={busy === 'trial'}>
              {busy === 'trial' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Активировать trial
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Как подключить</CardTitle>
            <CardDescription>
              Создайте бота в @BotFather сами — режим секретаря включается только там.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                Откройте{' '}
                <a
                  className="text-foreground underline underline-offset-2"
                  href="https://t.me/BotFather"
                  target="_blank"
                  rel="noreferrer"
                >
                  @BotFather
                </a>{' '}
                → /newbot → имя и @username
              </li>
              <li>
                Bot Settings → <strong className="text-foreground">Business Mode</strong> → Turn on
              </li>
              <li>/token → скопируйте токен</li>
              <li>Вставьте токен (и при желании @username) в форму → «Сохранить»</li>
              <li>Telegram → Настройки → Бизнес → Автоматизация чатов → добавьте бота</li>
            </ol>
            <Button asChild variant="outline" size="sm">
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">
                Открыть @BotFather <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </CardContent>
        </Card>

        {formVisible ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Токен бота</CardTitle>
              <CardDescription>
                Username необязателен — возьмём из Telegram по токену.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  @username (необязательно)
                </label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="my_secretary_bot"
                  className="font-mono"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Токен</label>
                <Input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="123456:AA…"
                  className="font-mono"
                  type="password"
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="solid"
                  disabled={busy === 'connect' || !token.trim()}
                  onClick={() => void connectBot()}
                >
                  {busy === 'connect' ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="mr-2 h-4 w-4" />
                  )}
                  Сохранить бота
                </Button>
                {aiBots.length > 0 && (
                  <Button variant="ghost" onClick={() => setShowForm(false)}>
                    Отмена
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Подключённые боты</CardTitle>
              <CardDescription>Канал telegram_business · botType ai_tg</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {aiBots.map((bot) => (
                <div
                  key={bot.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                >
                  <Link href={`/dashboard/ai/${bot.id}`} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">@{bot.botUsername || '…'}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {bot.conversationCount ?? 0} диалогов
                      </span>
                      <span>
                        {bot.businessConnectionCount ?? 0}/{maxConn} Business
                      </span>
                    </p>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={bot.status === 'active' ? 'default' : 'secondary'}>
                      {bot.status}
                    </Badge>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      disabled={busy === `del:${bot.id}`}
                      title="Удалить бота"
                      onClick={() => void deleteBot(bot)}
                    >
                      {busy === `del:${bot.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Назначить AI-агента:{' '}
                <Link href="/dashboard/ai/agents" className="underline underline-offset-2">
                  /dashboard/ai/agents
                </Link>
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {formVisible && aiBots.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="text-base">Подключённые боты</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {aiBots.map((bot) => (
              <div
                key={bot.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
              >
                <Link href={`/dashboard/ai/${bot.id}`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">@{bot.botUsername || '…'}</p>
                </Link>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8 text-destructive hover:text-destructive"
                  disabled={busy === `del:${bot.id}`}
                  onClick={() => void deleteBot(bot)}
                >
                  {busy === `del:${bot.id}` ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
