'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { PageHeader } from '@/components/portal/page-header';

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  hasGiftCampaign: boolean;
}

interface BroadcastRow {
  id: string;
  status: string;
  scheduledAt: string | null;
  sentCount: number;
  totalCount: number;
  segment?: string;
  createdAt: string;
}

export default function BroadcastsPage() {
  const router = useRouter();
  const [bots, setBots] = useState<BotRow[]>([]);
  const [botId, setBotId] = useState('');
  const [segment, setSegment] = useState<'gifted' | 'not_gifted' | 'all'>('not_gifted');
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const res = await fetch('/api/bots', { headers: authHeaders() });
    if (!res.ok) throw new Error('Не удалось загрузить ботов');
    const json = await res.json();
    const giftBots = (json.bots || []).filter(
      (b: BotRow) => b.botType === 'gift' && b.status === 'active' && b.hasGiftCampaign,
    );
    setBots(giftBots);
    if (!botId && giftBots[0]) setBotId(giftBots[0].id);
  }, [router, botId]);

  const loadHistory = useCallback(async (id: string) => {
    if (!id) return;
    const res = await fetch(`/api/bots/${id}/broadcasts`, { headers: authHeaders() });
    if (!res.ok) return;
    const json = await res.json();
    setHistory(json.broadcasts || []);
  }, []);

  useEffect(() => {
    load()
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    if (botId) loadHistory(botId);
  }, [botId, loadHistory]);

  const send = async () => {
    if (!botId || !text.trim()) return;
    setBusy(true);
    setError('');
    setOk('');
    try {
      const body: Record<string, unknown> = { segment, text: text.trim() };
      if (mediaUrl.trim()) body.mediaUrl = mediaUrl.trim();
      if (scheduledAt) body.scheduledAt = new Date(scheduledAt).toISOString();
      const res = await fetch(`/api/bots/${botId}/broadcasts`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не создано');
      setText('');
      setMediaUrl('');
      setScheduledAt('');
      setOk(
        scheduledAt
          ? `Запланировано на ${new Date(scheduledAt).toLocaleString('ru-RU')} (${json.queued})`
          : `В очереди: ${json.queued} чел.`,
      );
      await loadHistory(botId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <AppShell maxWidth="2xl">
        <LoadingState />
      </AppShell>
    );
  }

  return (
    <AppShell maxWidth="2xl" className="space-y-5">
      <PageHeader
        title="Рассылки"
        description="Сообщения сегментам подписчиков gift-бота"
        backHref="/dashboard/bots"
        backLabel="Боты"
      />

      {error && <Alert variant="error">{error}</Alert>}
      {ok && <Alert variant="success">{ok}</Alert>}

      {!bots.length ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Нет активного gift-бота с кампанией.{' '}
            <Link href="/dashboard/bots" className="font-medium text-foreground underline-offset-4 hover:underline">
              Настроить бота
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Новая рассылка</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="bot">Бот</Label>
              <select
                id="bot"
                className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                value={botId}
                onChange={(e) => setBotId(e.target.value)}
              >
                {bots.map((b) => (
                  <option key={b.id} value={b.id}>
                    @{b.botUsername || b.id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="segment">Сегмент</Label>
              <select
                id="segment"
                className="flex h-9 w-full rounded-md border border-input bg-card px-3 text-sm transition-[border-color,box-shadow] duration-[var(--duration-fast)] hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                value={segment}
                onChange={(e) => setSegment(e.target.value as typeof segment)}
              >
                <option value="not_gifted">Не получили подарок</option>
                <option value="gifted">Получили подарок</option>
                <option value="all">Все</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="text">Текст</Label>
              <Textarea
                id="text"
                rows={4}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="media">Медиа URL</Label>
              <Input
                id="media"
                value={mediaUrl}
                onChange={(e) => setMediaUrl(e.target.value)}
                placeholder="https://..."
                inputMode="url"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="when">Отложить</Label>
              <Input
                id="when"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>
            <Button variant="solid" onClick={send} disabled={busy || !text.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {scheduledAt ? 'Запланировать' : 'Отправить сейчас'}
            </Button>
          </CardContent>
        </Card>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>История</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="pb-2 font-medium">Когда</th>
                  <th className="pb-2 font-medium">Сегмент</th>
                  <th className="pb-2 font-medium">Статус</th>
                  <th className="pb-2 font-medium">Отправлено</th>
                </tr>
              </thead>
              <tbody>
                {history.map((b) => (
                  <tr key={b.id} className="border-t border-border transition-colors hover:bg-secondary/40">
                    <td className="py-2.5">
                      {b.scheduledAt
                        ? new Date(b.scheduledAt).toLocaleString('ru-RU')
                        : new Date(b.createdAt).toLocaleString('ru-RU')}
                    </td>
                    <td className="py-2.5">{b.segment || '—'}</td>
                    <td className="py-2.5">
                      <Badge variant="secondary">{b.status}</Badge>
                    </td>
                    <td className="py-2.5">
                      {b.sentCount}/{b.totalCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
