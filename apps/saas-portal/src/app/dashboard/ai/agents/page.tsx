'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bot, Loader2, Plus, Trash2, Upload, RefreshCw } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { PageHeader } from '@/components/portal/page-header';

interface AgentRow {
  id: string;
  name: string;
  systemPrompt: string | null;
  status: string;
  conversationCount?: number;
  botDefaultCount?: number;
  knowledgeFileCount?: number;
  salesExampleCount?: number;
  learnFromWonDeals?: boolean;
  wonStages?: string[];
  updatedAt: string;
}

interface KnowledgeFile {
  id: string;
  filename: string;
  sizeBytes: number;
  status: string;
  error: string | null;
  chunkCount: number;
  createdAt: string;
}

interface SalesExample {
  id: string;
  userText: string;
  operatorText: string;
  opportunityId: string | null;
  createdAt: string;
}

interface BotRow {
  id: string;
  botUsername: string | null;
  displayName?: string | null;
  botType: string;
  defaultAiAgentId?: string | null;
}

interface UsageByAgent {
  aiAgentId: string | null;
  name: string;
  requests: number;
  tokens: number;
  chargedRub: number;
}

interface UsageResponse {
  days: number;
  balanceRub: number;
  byAgent: UsageByAgent[];
}

export default function AiAgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filesByAgent, setFilesByAgent] = useState<Record<string, KnowledgeFile[]>>({});
  const [examplesByAgent, setExamplesByAgent] = useState<Record<string, SalesExample[]>>({});

  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const [agentsRes, botsRes, usageRes] = await Promise.all([
        fetch('/api/ai/agents', { headers: authHeaders() }),
        fetch('/api/bots', { headers: authHeaders() }),
        fetch('/api/ai/agents/usage?days=30', { headers: authHeaders() }),
      ]);
      if (!agentsRes.ok) throw new Error('Не удалось загрузить агентов');
      const agentsJson = await agentsRes.json();
      setAgents(agentsJson.agents || []);
      if (botsRes.ok) {
        const botsJson = await botsRes.json();
        setBots(
          ((botsJson.bots || []) as BotRow[]).filter(
            (b) =>
              b.botType === 'ai_tg' || b.botType === 'ai_gramjs' || b.botType === 'ai_wa',
          ),
        );
      }
      if (usageRes.ok) {
        setUsage((await usageRes.json()) as UsageResponse);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const createAgent = async () => {
    if (!name.trim()) {
      setError('Укажите имя агента');
      return;
    }
    setBusy('create');
    setError('');
    try {
      const res = await fetch('/api/ai/agents', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name: name.trim(),
          systemPrompt: prompt.trim() || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось создать');
      setName('');
      setPrompt('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const assignToBot = async (botId: string, aiAgentId: string | null) => {
    setBusy(`bot-${botId}`);
    setError('');
    try {
      const res = await fetch(`/api/ai/agents/assign/bot/${botId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ aiAgentId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось назначить');
      setBots((prev) =>
        prev.map((b) => (b.id === botId ? { ...b, defaultAiAgentId: aiAgentId } : b)),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };


  const loadAgentExtras = async (agentId: string) => {
    const [kRes, sRes] = await Promise.all([
      fetch(`/api/ai/agents/${agentId}/knowledge`, { headers: authHeaders() }),
      fetch(`/api/ai/agents/${agentId}/sales-examples?limit=20`, { headers: authHeaders() }),
    ]);
    if (kRes.ok) {
      const j = await kRes.json();
      setFilesByAgent((prev) => ({ ...prev, [agentId]: j.files || [] }));
    }
    if (sRes.ok) {
      const j = await sRes.json();
      setExamplesByAgent((prev) => ({ ...prev, [agentId]: j.examples || [] }));
    }
  };

  const toggleExpand = async (agentId: string) => {
    if (expandedId === agentId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(agentId);
    await loadAgentExtras(agentId);
  };

  const uploadKnowledge = async (agentId: string, file: File) => {
    setBusy(`kb-${agentId}`);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = localStorage.getItem('voxly_token');
      const res = await fetch(`/api/ai/agents/${agentId}/knowledge`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить');
      await loadAgentExtras(agentId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const deleteKnowledge = async (agentId: string, fileId: string) => {
    setBusy(`kbd-${fileId}`);
    try {
      const res = await fetch(`/api/ai/agents/${agentId}/knowledge/${fileId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Не удалось удалить');
      await loadAgentExtras(agentId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const syncSales = async (agentId: string) => {
    setBusy(`sync-${agentId}`);
    setError('');
    try {
      const res = await fetch(`/api/ai/agents/${agentId}/sales-examples/sync`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sync failed');
      await loadAgentExtras(agentId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const toggleLearn = async (agent: AgentRow, value: boolean) => {
    setBusy(`learn-${agent.id}`);
    try {
      const res = await fetch(`/api/ai/agents/${agent.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ learnFromWonDeals: value }),
      });
      if (!res.ok) throw new Error('Не удалось сохранить');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const deleteExample = async (agentId: string, exampleId: string) => {
    setBusy(`ex-${exampleId}`);
    try {
      const res = await fetch(`/api/ai/agents/${agentId}/sales-examples/${exampleId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Не удалось удалить');
      await loadAgentExtras(agentId);
      await load();
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

  return (
    <AppShell maxWidth="3xl">
      <PageHeader
        title="AI-агенты"
        description="Prompt, база знаний (файлы) и обучение на успешных CRM-сделках. Без назначения AI не отвечает."
        backHref="/dashboard"
        backLabel="Кабинет"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const raw = window.prompt('Сумма пополнения AI-баланса (₽, мин. 500)', '1000');
                if (!raw) return;
                const amountRub = Math.round(Number(raw.replace(/\s/g, '').replace(',', '.')));
                if (!Number.isFinite(amountRub) || amountRub < 500) {
                  setError('Минимум пополнения — 500 ₽');
                  return;
                }
                setBusy('topup');
                void startCheckout({ productCode: 'ai_topup', amountRub }).catch((e) => {
                  setError(e instanceof Error ? e.message : 'Ошибка оплаты');
                  setBusy('');
                });
              }}
              disabled={busy === 'topup'}
            >
              Пополнить баланс
            </Button>
            <Button asChild variant="secondary" size="sm">
              <Link href="/dashboard/ai">Telegram Business</Link>
            </Button>
          </div>
        }
      />

      {error && (
        <Alert className="mb-4" variant="error">
          {error}
        </Alert>
      )}

      {usage && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Расход AI за {usage.days} дн.</CardTitle>
            <CardDescription>
              Баланс: {usage.balanceRub.toLocaleString('ru-RU')} ₽ · списание с кошелька по
              агентам
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {usage.byAgent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Пока нет списаний</p>
            ) : (
              usage.byAgent.map((row) => (
                <div
                  key={row.aiAgentId || 'none'}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                >
                  <span className="font-medium">{row.name}</span>
                  <span className="text-muted-foreground">
                    {row.requests} запр. · {row.chargedRub.toLocaleString('ru-RU')} ₽
                  </span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Новый агент</CardTitle>
          <CardDescription>Имя и system prompt. Можно назначить на бота ниже.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Имя (например, Продавец)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className="min-h-[120px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="System prompt (необязательно)"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <Button variant="solid" onClick={createAgent} disabled={busy === 'create'}>
            {busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Создать
          </Button>
        </CardContent>
      </Card>

      {agents.length === 0 ? (
        <Card className="mb-6">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Bot className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">Пока нет агентов</p>
          </CardContent>
        </Card>
      ) : (
        <div className="mb-6 space-y-3">
          {agents.map((a) => {
            const open = expandedId === a.id;
            const files = filesByAgent[a.id] || [];
            const examples = examplesByAgent[a.id] || [];
            return (
              <Card key={a.id}>
                <CardContent className="space-y-4 p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{a.name}</p>
                        <Badge variant={a.status === 'active' ? 'success' : 'secondary'}>
                          {a.status}
                        </Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                        {a.systemPrompt || 'Без своего prompt · platform default'}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Дефолт на {a.botDefaultCount ?? 0} акк. · {a.conversationCount ?? 0}{' '}
                        чатов · файлов {a.knowledgeFileCount ?? 0} · примеров продаж{' '}
                        {a.salesExampleCount ?? 0}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={() => void toggleExpand(a.id)}>
                      {open ? 'Свернуть' : 'База знаний'}
                    </Button>
                  </div>

                  {open && (
                    <div className="space-y-4 border-t border-border pt-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={a.learnFromWonDeals !== false}
                          disabled={busy === `learn-${a.id}`}
                          onChange={(e) => void toggleLearn(a, e.target.checked)}
                        />
                        Учиться на успешных сделках (этап CUSTOMER)
                      </label>

                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">Файлы базы знаний</p>
                          <label className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                            <Upload className="h-3.5 w-3.5" />
                            .txt / .md / .pdf
                            <input
                              type="file"
                              accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = '';
                                if (f) void uploadKnowledge(a.id, f);
                              }}
                            />
                          </label>
                        </div>
                        {files.length === 0 ? (
                          <p className="text-xs text-muted-foreground">Пока нет файлов</p>
                        ) : (
                          <ul className="space-y-2">
                            {files.map((f) => (
                              <li
                                key={f.id}
                                className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-medium">{f.filename}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {f.status}
                                    {f.chunkCount ? ` · ${f.chunkCount} чанков` : ''}
                                    {f.error ? ` · ${f.error}` : ''}
                                  </p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy === `kbd-${f.id}`}
                                  onClick={() => void deleteKnowledge(a.id, f.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <p className="text-sm font-medium">Примеры с успешных сделок</p>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy === `sync-${a.id}`}
                            onClick={() => void syncSales(a.id)}
                          >
                            <RefreshCw className="mr-1 h-3.5 w-3.5" />
                            Обновить обучение
                          </Button>
                        </div>
                        {examples.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Пока нет примеров. Закройте сделку в CRM на этап CUSTOMER и
                            нажмите «Обновить обучение».
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {examples.map((ex) => (
                              <li
                                key={ex.id}
                                className="rounded-md border border-border px-3 py-2 text-sm"
                              >
                                <div className="flex justify-between gap-2">
                                  <p className="text-xs text-muted-foreground">Клиент</p>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    disabled={busy === `ex-${ex.id}`}
                                    onClick={() => void deleteExample(a.id, ex.id)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                                <p className="line-clamp-2">{ex.userText}</p>
                                <p className="mt-1 text-xs text-muted-foreground">Продавец</p>
                                <p className="line-clamp-2">{ex.operatorText}</p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Назначение на аккаунт</CardTitle>
          <CardDescription>
            Дефолт для всех чатов аккаунта. Чат может переопределить агента в карточке диалога.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {bots.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Нет подключённых аккаунтов.{' '}
              <Link href="/dashboard/ai" className="underline underline-offset-2">
                Business
              </Link>
              ,{' '}
              <Link href="/dashboard/ai/gramjs" className="underline underline-offset-2">
                GramJS
              </Link>{' '}
              или{' '}
              <Link href="/dashboard/ai/whatsapp" className="underline underline-offset-2">
                WhatsApp
              </Link>
              .
            </p>
          ) : (
            bots.map((b) => (
              <div
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {b.botType === 'ai_gramjs'
                      ? 'GramJS'
                      : b.botType === 'ai_wa'
                        ? 'WhatsApp'
                        : 'Business'}{' '}
                    ·{' '}
                    {b.botType === 'ai_wa'
                      ? b.displayName || b.botUsername || '…'
                      : `@${b.botUsername || '…'}`}
                  </p>
                </div>
                <select
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                  value={b.defaultAiAgentId || ''}
                  disabled={busy === `bot-${b.id}` || agents.length === 0}
                  onChange={(e) =>
                    void assignToBot(b.id, e.target.value ? e.target.value : null)
                  }
                >
                  <option value="">AI выкл (нет агента)</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
