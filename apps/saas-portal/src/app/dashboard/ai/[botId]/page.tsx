'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Pause, Play, Power, PowerOff, ExternalLink } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { PageHeader } from '@/components/portal/page-header';
import { CopyButton } from '@/components/portal/copy-button';
import { cn } from '@/lib/utils';

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  botLink: string | null;
  conversationCount?: number;
  businessConnectionCount?: number;
  defaultAiAgentId?: string | null;
}

interface AgentRef {
  id: string;
  name: string;
  status: string;
}

interface ConversationRow {
  id: string;
  platformUserId: string;
  platformUsername: string | null;
  platformFirstName: string | null;
  status: string;
  mode: string;
  aiDisabled: boolean;
  pausedUntil: string | null;
  channel: string | null;
  businessConnectionId: string | null;
  aiAgentId: string | null;
  aiAgent: AgentRef | null;
  effectiveAiAgent: AgentRef | null;
  twentyPersonId: string | null;
  twentyOpportunityId: string | null;
  needsReview: boolean;
  updatedAt: string;
  lastMessage: { role: string; content: string; sentAt: string } | null;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  sentAt: string;
}

function aiStatusLabel(c: ConversationRow): { label: string; variant: 'success' | 'warning' | 'secondary' } {
  if (!c.effectiveAiAgent) return { label: 'Нет агента', variant: 'secondary' };
  if (c.aiDisabled) return { label: 'AI выкл', variant: 'secondary' };
  if (c.pausedUntil && new Date(c.pausedUntil).getTime() > Date.now()) {
    return { label: 'Пауза', variant: 'warning' };
  }
  if (c.mode === 'human') return { label: 'Оператор', variant: 'warning' };
  return { label: 'AI вкл', variant: 'success' };
}

function displayName(c: ConversationRow): string {
  if (c.platformUsername) return `@${c.platformUsername.replace(/^@/, '')}`;
  if (c.platformFirstName) return c.platformFirstName;
  return c.platformUserId;
}

interface BusinessAccountRow {
  id: string;
  ownerTelegramId: string;
  ownerUsername: string | null;
  ownerFirstName: string | null;
  businessConnectionId: string | null;
  status: string;
  connected: boolean;
  updatedAt: string;
}

export default function AiBotDetailPage() {
  const { botId } = useParams<{ botId: string }>();
  const router = useRouter();
  const [bot, setBot] = useState<BotRow | null>(null);
  const [maxConn, setMaxConn] = useState(10);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);
  const [agents, setAgents] = useState<AgentRef[]>([]);
  const [defaultAiAgentId, setDefaultAiAgentId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const [botsRes, convRes, agentsRes] = await Promise.all([
        fetch('/api/bots', { headers: authHeaders() }),
        fetch(`/api/bots/${botId}/conversations`, { headers: authHeaders() }),
        fetch('/api/ai/agents', { headers: authHeaders() }),
      ]);
      if (!botsRes.ok) throw new Error('Не удалось загрузить бота');
      const botsJson = await botsRes.json();
      const row = (botsJson.bots as BotRow[]).find((b) => b.id === botId && b.botType === 'ai_tg');
      if (!row) throw new Error('AI-бот не найден');
      setBot(row);
      setMaxConn(botsJson.maxBusinessConnections ?? 10);
      setDefaultAiAgentId(row.defaultAiAgentId ?? null);

      if (convRes.ok) {
        const convJson = await convRes.json();
        setConversations(convJson.conversations || []);
        setBusinessAccounts(convJson.businessAccounts || []);
        if (convJson.defaultAiAgentId !== undefined) {
          setDefaultAiAgentId(convJson.defaultAiAgentId);
        }
      }
      if (agentsRes.ok) {
        const agentsJson = await agentsRes.json();
        setAgents(
          ((agentsJson.agents || []) as AgentRef[]).map((a) => ({
            id: a.id,
            name: a.name,
            status: a.status,
          })),
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [botId, router]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      const res = await fetch(`/api/bots/${botId}/conversations/${conversationId}/messages`, {
        headers: authHeaders(),
      });
      if (!res.ok) return;
      const json = await res.json();
      setMessages(json.messages || []);
      if (json.conversation) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId
              ? {
                  ...c,
                  mode: json.conversation.mode,
                  aiDisabled: json.conversation.aiDisabled,
                  pausedUntil: json.conversation.pausedUntil,
                  status: json.conversation.status,
                  needsReview: json.conversation.needsReview,
                }
              : c,
          ),
        );
      }
    },
    [botId],
  );

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeId);
    const t = setInterval(() => void loadMessages(activeId), 5000);
    return () => clearInterval(t);
  }, [activeId, loadMessages]);

  const patchHandoff = async (
    conversationId: string,
    body: Record<string, unknown>,
    busyKey: string,
  ) => {
    setBusy(busyKey);
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}/conversations/${conversationId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось обновить');
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                mode: json.mode ?? c.mode,
                aiDisabled: json.aiDisabled ?? c.aiDisabled,
                pausedUntil: json.pausedUntil ?? c.pausedUntil,
                status: json.status ?? c.status,
                needsReview: json.needsReview ?? c.needsReview,
                aiAgentId: json.aiAgentId !== undefined ? json.aiAgentId : c.aiAgentId,
                aiAgent: json.aiAgent !== undefined ? json.aiAgent : c.aiAgent,
                effectiveAiAgent:
                  json.aiAgent !== undefined
                    ? json.aiAgent ||
                      (defaultAiAgentId
                        ? agents.find((a) => a.id === defaultAiAgentId) || null
                        : null)
                    : c.effectiveAiAgent,
              }
            : c,
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <AppShell maxWidth="3xl">
        <LoadingState />
      </AppShell>
    );
  }

  if (!bot) {
    return (
      <AppShell maxWidth="3xl">
        <Alert variant="error">{error || 'Бот не найден'}</Alert>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/dashboard/ai">К списку</Link>
        </Button>
      </AppShell>
    );
  }

  const active = conversations.find((c) => c.id === activeId) || null;
  const needsReviewCount = conversations.filter((c) => c.needsReview).length;

  return (
    <AppShell maxWidth="3xl">
      <PageHeader
        title={`@${bot.botUsername || '…'}`}
        description="Telegram Business · AI отвечает только с назначенным агентом"
        backHref="/dashboard/ai"
        backLabel="Telegram Business"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard/ai/agents">AI-агенты</Link>
            </Button>
            {bot.botLink ? (
              <Button asChild variant="outline" size="sm">
                <a href={bot.botLink} target="_blank" rel="noreferrer">
                  Открыть в Telegram <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            ) : null}
          </div>
        }
      />

      {error && (
        <Alert className="mb-4" variant="error">
          {error}
        </Alert>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Статус
            </p>
            <div className="mt-2">
              <Badge variant={bot.status === 'active' ? 'success' : 'warning'}>{bot.status}</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Business-аккаунты
            </p>
            <p className="mt-2 text-xl font-semibold">
              {businessAccounts.filter((a) => a.connected).length ||
                bot.businessConnectionCount ||
                0}
              /{maxConn}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Диалоги
            </p>
            <p className="mt-2 text-xl font-semibold">{conversations.length}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Агент на этого бота</CardTitle>
          <CardDescription>
            Один агент на бота — работает на всех Business-аккаунтах (до {maxConn} в тарифе). Без
            агента входящие пишутся в CRM, но AI не отвечает. Чат может переопределить ниже.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <select
            className="w-full max-w-md rounded-md border border-border bg-background px-2 py-2 text-sm"
            value={defaultAiAgentId || ''}
            disabled={busy === 'default-agent' || agents.length === 0}
            onChange={async (e) => {
              const aiAgentId = e.target.value || null;
              setBusy('default-agent');
              setError('');
              try {
                const res = await fetch(`/api/ai/agents/assign/bot/${botId}`, {
                  method: 'PATCH',
                  headers: authHeaders(),
                  body: JSON.stringify({ aiAgentId }),
                });
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || 'Не удалось назначить');
                setDefaultAiAgentId(aiAgentId);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Ошибка');
              } finally {
                setBusy('');
              }
            }}
          >
            <option value="">AI выкл (нет агента)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {agents.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              Сначала создайте агента на{' '}
              <Link href="/dashboard/ai/agents" className="underline underline-offset-2">
                /dashboard/ai/agents
              </Link>
              , затем выберите его здесь.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Подключённые Business-аккаунты</CardTitle>
          <CardDescription>
            Аккаунты, где бот добавлен в «Автоматизация чатов». При бане подключайте бота к другому
            аккаунту — он появится здесь.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {businessAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Пока нет. Telegram → Настройки → Бизнес → Автоматизация чатов → @{bot.botUsername}.
              После подключения список обновится сам.
            </p>
          ) : (
            businessAccounts.map((a) => {
              const label = a.ownerUsername
                ? `@${a.ownerUsername}`
                : a.ownerFirstName || `id ${a.ownerTelegramId}`;
              return (
                <div
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      tg {a.ownerTelegramId}
                      {a.businessConnectionId
                        ? ` · conn ${a.businessConnectionId.slice(0, 12)}…`
                        : ''}
                    </p>
                    {a.status === 'limited' && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        В Telegram → Бизнес → Автоматизация чатов выдайте боту права читать и
                        отвечать — иначе входящие и сделки в CRM не появятся.
                      </p>
                    )}
                  </div>
                  <Badge
                    variant={
                      a.status === 'closed'
                        ? 'secondary'
                        : a.status === 'limited'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {a.status === 'closed'
                      ? 'отключён'
                      : a.status === 'limited'
                        ? 'нет прав ответа'
                        : 'подключён'}
                  </Badge>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Подключение Business</CardTitle>
          <CardDescription>
            Без Business Mode в BotFather Telegram пишет «бот не поддерживает режим секретаря».
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <ol className="list-decimal space-y-2 pl-5 text-muted-foreground">
            <li>
              @BotFather → бот → Bot Settings →{' '}
              <strong className="text-foreground">Business Mode</strong> → Turn on
            </li>
            <li>
              Telegram → Настройки → Бизнес → Автоматизация чатов → @{bot.botUsername || '…'}
            </li>
          </ol>
          {bot.botUsername && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded-md border border-border bg-secondary/50 px-2 py-1 text-xs">
                @{bot.botUsername}
              </code>
              <CopyButton value={`@${bot.botUsername}`} label="Username" />
            </div>
          )}
        </CardContent>
      </Card>

      {needsReviewCount > 0 && (
        <Alert className="mb-4" variant="info">
          {needsReviewCount} диалог(ов) с неоднозначным контактом в CRM — проверьте вручную.
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Диалоги</CardTitle>
            <CardDescription>Вкл / выкл / пауза AI для каждого чата</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {conversations.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">
                Пока нет диалогов. Подключите бота в Автоматизации чатов и напишите с Business-аккаунта.
              </p>
            ) : (
              <ul className="max-h-[28rem] overflow-y-auto">
                {conversations.map((c, i) => {
                  const st = aiStatusLabel(c);
                  return (
                    <li key={c.id} className={cn(i > 0 && 'border-t border-border')}>
                      <button
                        type="button"
                        onClick={() => setActiveId(c.id)}
                        className={cn(
                          'flex w-full items-start justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-secondary/70',
                          activeId === c.id && 'bg-secondary/80',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate text-sm font-medium">{displayName(c)}</p>
                            <Badge variant={st.variant}>{st.label}</Badge>
                            {c.needsReview && <Badge variant="warning">дубль?</Badge>}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-muted-foreground">
                            {c.lastMessage?.content || 'Нет сообщений'}
                          </p>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {active ? displayName(active) : 'Чат'}
            </CardTitle>
            <CardDescription>
              {active
                ? active.channel === 'telegram_business'
                  ? 'Telegram Business'
                  : active.channel || 'Telegram'
                : 'Выберите диалог слева'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!active ? (
              <p className="text-sm text-muted-foreground">Выберите диалог, чтобы управлять AI.</p>
            ) : (
              <>
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Агент для этого чата</p>
                  <select
                    className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    value={active.aiAgentId || ''}
                    disabled={busy !== '' || agents.length === 0}
                    onChange={(e) =>
                      patchHandoff(
                        active.id,
                        { aiAgentId: e.target.value || null },
                        'agent',
                      )
                    }
                  >
                    <option value="">
                      {defaultAiAgentId
                        ? `Как у аккаунта (${agents.find((a) => a.id === defaultAiAgentId)?.name || '…'})`
                        : 'Нет агента (AI выкл)'}
                    </option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  {active.effectiveAiAgent && (
                    <p className="text-xs text-muted-foreground">
                      Эффективный: {active.effectiveAiAgent.name}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="solid"
                    disabled={busy !== '' || (!active.aiDisabled && active.mode !== 'human' && !(active.pausedUntil && new Date(active.pausedUntil) > new Date()))}
                    onClick={() =>
                      patchHandoff(active.id, { aiDisabled: false, pause: false, mode: 'ai' }, 'on')
                    }
                  >
                    {busy === 'on' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    Вкл AI
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== '' || active.aiDisabled}
                    onClick={() => patchHandoff(active.id, { pause: true }, 'pause')}
                  >
                    {busy === 'pause' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Pause className="h-4 w-4" />
                    )}
                    Пауза 1ч
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== '' || active.aiDisabled}
                    onClick={() => patchHandoff(active.id, { aiDisabled: true }, 'off')}
                  >
                    {busy === 'off' ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <PowerOff className="h-4 w-4" />
                    )}
                    Выкл
                  </Button>
                  {active.needsReview && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy !== ''}
                      onClick={() => patchHandoff(active.id, { needsReview: false }, 'review')}
                    >
                      {busy === 'review' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Power className="h-4 w-4" />
                      )}
                      Снять флаг дубля
                    </Button>
                  )}
                </div>

                {active.pausedUntil && new Date(active.pausedUntil).getTime() > Date.now() && (
                  <p className="text-xs text-muted-foreground">
                    Пауза до {new Date(active.pausedUntil).toLocaleString('ru-RU')}
                  </p>
                )}

                {active.twentyPersonId && (
                  <p className="text-xs text-muted-foreground">
                    CRM Person привязан · полный чат — во вкладке «Чат» в CRM
                  </p>
                )}

                <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border border-border p-3">
                  {messages.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Нет сообщений</p>
                  ) : (
                    messages.map((m) => (
                      <div
                        key={m.id}
                        className={cn(
                          'rounded-md px-3 py-2 text-sm',
                          m.role === 'user' && 'bg-secondary/70',
                          m.role === 'assistant' && 'bg-[#f0f4fb]',
                          m.role === 'operator' && 'bg-[#f3f7f2]',
                          m.role === 'system' && 'bg-muted text-muted-foreground',
                        )}
                      >
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {m.role === 'user'
                            ? 'Клиент'
                            : m.role === 'assistant'
                              ? 'AI'
                              : m.role === 'operator'
                                ? 'Оператор'
                                : m.role}
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap">{m.content}</p>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
