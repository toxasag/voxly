'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bot, Loader2, Plus } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
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
  updatedAt: string;
}

interface BotRow {
  id: string;
  botUsername: string | null;
  displayName?: string | null;
  botType: string;
  defaultAiAgentId?: string | null;
}

export default function AiAgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [bots, setBots] = useState<BotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const [agentsRes, botsRes] = await Promise.all([
        fetch('/api/ai/agents', { headers: authHeaders() }),
        fetch('/api/bots', { headers: authHeaders() }),
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
        description="Создайте агента и назначьте на аккаунт или чат. Без назначения AI не отвечает."
        backHref="/dashboard"
        backLabel="Кабинет"
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/dashboard/ai">Telegram Business</Link>
          </Button>
        }
      />

      {error && (
        <Alert className="mb-4" variant="error">
          {error}
        </Alert>
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
          {agents.map((a) => (
            <Card key={a.id}>
              <CardContent className="flex items-start justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{a.name}</p>
                    <Badge variant={a.status === 'active' ? 'success' : 'secondary'}>{a.status}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {a.systemPrompt || 'Без своего prompt · platform default'}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Дефолт на {a.botDefaultCount ?? 0} акк. · {a.conversationCount ?? 0} чатов
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
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
