'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { authHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

type Stats = {
  subscribers: number;
  linked: number;
  unreadSupport: number;
  broadcasts: number;
};

type SupportMsg = {
  id: string;
  telegramUserId: string;
  chatId: string;
  direction: string;
  text: string;
  username?: string | null;
  readAt?: string | null;
  createdAt: string;
};

type Broadcast = {
  id: string;
  text: string;
  status: string;
  sentCount: number;
  failCount: number;
  scheduledAt?: string | null;
  sentAt?: string | null;
};

export default function AdminBotPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [support, setSupport] = useState<SupportMsg[]>([]);
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [broadcastText, setBroadcastText] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const [s, sup, br] = await Promise.all([
        fetch('/api/admin/platform-bot/stats', { headers: authHeaders() }),
        fetch('/api/admin/platform-bot/support?take=40', { headers: authHeaders() }),
        fetch('/api/admin/platform-bot/broadcasts', { headers: authHeaders() }),
      ]);
      if (!s.ok) throw new Error('Не удалось загрузить статистику');
      setStats(await s.json());
      if (sup.ok) {
        const d = await sup.json();
        setSupport(d.items || []);
      }
      if (br.ok) {
        const d = await br.json();
        setBroadcasts(d.items || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sendBroadcast = async () => {
    if (!broadcastText.trim()) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/platform-bot/broadcasts', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text: broadcastText.trim(), sendNow: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось отправить');
      setBroadcastText('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка рассылки');
    } finally {
      setBusy(false);
    }
  };

  const notifyExpiring = async (kind: 'trial' | 'paid' | 'both') => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/admin/platform-bot/notify-expiring', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ days: 3, kind }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось уведомить');
      alert(`Отправлено: ${data.notified}, пропущено: ${data.skipped}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка уведомлений');
    } finally {
      setBusy(false);
    }
  };

  const reply = async (id: string) => {
    const text = replyDrafts[id]?.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/platform-bot/support/${id}/reply`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось ответить');
      setReplyDrafts((d) => ({ ...d, [id]: '' }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка ответа');
    } finally {
      setBusy(false);
    }
  };

  if (!stats && !error) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  return (
    <AppShell maxWidth="6xl">
      <div className="space-y-8">
        <header>
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-black/45">
            Супер-админ
          </p>
          <h1 className="mt-2 text-3xl tracking-[-0.03em]">@GetVoxlybot</h1>
          <p className="mt-2 max-w-2xl text-sm text-black/60">
            OTP для входа/регистрации, техподдержка и рассылки подписчикам бота.
          </p>
        </header>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {stats ? (
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ['Подписчики', stats.subscribers],
              ['С аккаунтом', stats.linked],
              ['Непрочитанные', stats.unreadSupport],
              ['Рассылки', stats.broadcasts],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-black/10 bg-white px-4 py-4">
                <p className="text-xs uppercase tracking-wide text-black/45">{label}</p>
                <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </div>
        ) : null}

        <section className="space-y-3 rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-semibold">Уведомления об окончании срока</h2>
          <p className="text-sm text-black/55">
            Сообщение владельцам с привязанным Telegram за 3 дня до конца trial/оплаты.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void notifyExpiring('trial')}>
              Trial (3 дня)
            </Button>
            <Button disabled={busy} variant="outline" onClick={() => void notifyExpiring('paid')}>
              Оплаченные (3 дня)
            </Button>
            <Button disabled={busy} variant="secondary" onClick={() => void notifyExpiring('both')}>
              Все
            </Button>
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-semibold">Рассылка</h2>
          <Textarea
            value={broadcastText}
            onChange={(e) => setBroadcastText(e.target.value)}
            placeholder="Текст всем подписчикам @GetVoxlybot"
            rows={4}
          />
          <Button disabled={busy || !broadcastText.trim()} onClick={() => void sendBroadcast()}>
            Отправить сейчас
          </Button>
          <div className="space-y-2 pt-2">
            {broadcasts.slice(0, 8).map((b) => (
              <div key={b.id} className="rounded-xl border border-black/8 px-3 py-2 text-sm">
                <div className="flex justify-between gap-2 text-xs text-black/45">
                  <span>{b.status}</span>
                  <span>
                    ok {b.sentCount} / fail {b.failCount}
                  </span>
                </div>
                <p className="mt-1 whitespace-pre-wrap">{b.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3 rounded-2xl border border-black/10 bg-white p-5">
          <h2 className="text-lg font-semibold">Поддержка</h2>
          <div className="space-y-4">
            {support.length === 0 ? (
              <p className="text-sm text-black/45">Сообщений пока нет.</p>
            ) : (
              support.map((m) => (
                <div
                  key={m.id}
                  className={`rounded-xl border px-3 py-3 ${
                    m.direction === 'inbound' && !m.readAt
                      ? 'border-amber-300 bg-amber-50/60'
                      : 'border-black/8'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-black/45">
                    <span>
                      {m.direction === 'inbound' ? '←' : '→'} @{m.username || m.telegramUserId}
                    </span>
                    <span>{new Date(m.createdAt).toLocaleString('ru-RU')}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{m.text}</p>
                  {m.direction === 'inbound' ? (
                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <Input
                        value={replyDrafts[m.id] || ''}
                        onChange={(e) =>
                          setReplyDrafts((d) => ({ ...d, [m.id]: e.target.value }))
                        }
                        placeholder="Ответ клиенту"
                      />
                      <Button disabled={busy} onClick={() => void reply(m.id)}>
                        Ответить
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
