'use client';

import { useCallback, useEffect, useState } from 'react';
import { selectClassName } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { handleMailingBillingGate } from '@/lib/checkout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { PageHeader } from '@/components/portal/page-header';
import { TelegramPreview } from '@/components/telegram-preview';
import { TG_PREVIEW_LABEL } from '@/components/portal/telegram-preview-chrome';
import { MailingBillingBanner } from '@/components/portal/mailing-billing-banner';

type Channel = 'gramjs' | 'wa';
type MediaType = 'photo' | 'video';

interface AccountRow {
  id: string;
  botUsername?: string | null;
  name?: string | null;
  displayName?: string | null;
  phoneNumberId?: string | null;
  status: string;
}

interface BroadcastRow {
  id: string;
  status: string;
  scheduledAt: string | null;
  sentCount: number;
  totalCount: number;
  text?: string;
  mediaUrl?: string | null;
  mediaType?: MediaType | null;
  createdAt: string;
}

function toLocalInputValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function accountLabel(a: AccountRow): string {
  return (
    a.displayName ||
    a.name ||
    (a.botUsername ? `@${a.botUsername}` : null) ||
    a.phoneNumberId ||
    a.id
  );
}

export function ChannelBroadcastsPage({
  channel,
  title,
  description,
  accountsHref,
  accountsLabel,
}: {
  channel: Channel;
  title: string;
  description: string;
  accountsHref: string;
  accountsLabel: string;
}) {
  const router = useRouter();
  const accountsApi =
    channel === 'gramjs' ? '/api/bots/gramjs/accounts' : '/api/bots/whatsapp/accounts';

  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [botId, setBotId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<MediaType | ''>('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [billingOk, setBillingOk] = useState(false);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setText('');
    setMediaUrl('');
    setMediaType('');
    setScheduledAt('');
  }, []);

  const loadAccounts = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    const res = await fetch(accountsApi, { headers: authHeaders() });
    if (!res.ok) throw new Error('Не удалось загрузить аккаунты');
    const json = await res.json();
    const list = (json.accounts || json.bots || []) as AccountRow[];
    const active = list.filter((a) => a.status === 'active');
    setAccounts(active.length ? active : list);
    if (!botId && (active[0] || list[0])) setBotId((active[0] || list[0]).id);
  }, [accountsApi, router, botId]);

  const loadHistory = useCallback(async (id: string) => {
    if (!id) return;
    const res = await fetch(`/api/bots/${id}/broadcasts`, { headers: authHeaders() });
    if (!res.ok) return;
    const json = await res.json();
    setHistory(json.broadcasts || []);
  }, []);

  useEffect(() => {
    loadAccounts()
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [loadAccounts]);

  useEffect(() => {
    if (botId) {
      resetForm();
      void loadHistory(botId);
    }
  }, [botId, loadHistory, resetForm]);

  const startEdit = (row: BroadcastRow) => {
    if (row.status !== 'scheduled') return;
    setEditingId(row.id);
    setText(row.text || '');
    setMediaUrl(row.mediaUrl || '');
    setMediaType(row.mediaType || '');
    setScheduledAt(toLocalInputValue(row.scheduledAt));
    setOk('Редактирование запланированной рассылки');
    setError('');
  };

  const submit = async () => {
    if (!botId || !text.trim()) return;
    setBusy(true);
    setError('');
    setOk('');
    try {
      const body: Record<string, unknown> = { text: text.trim() };
      if (mediaUrl.trim()) {
        body.mediaUrl = mediaUrl.trim();
        if (mediaType) body.mediaType = mediaType;
      }
      if (scheduledAt) body.scheduledAt = new Date(scheduledAt).toISOString();

      const url = editingId
        ? `/api/bots/${botId}/broadcasts/${editingId}`
        : `/api/bots/${botId}/broadcasts`;
      const res = await fetch(url, {
        method: editingId ? 'PATCH' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify(
          editingId
            ? {
                text: text.trim(),
                mediaUrl: mediaUrl.trim() || null,
                mediaType: mediaType || null,
                scheduledAt: scheduledAt
                  ? new Date(scheduledAt).toISOString()
                  : undefined,
              }
            : body,
        ),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 402) {
          const mode = await handleMailingBillingGate(json);
          if (mode === 'checkout') return;
        }
        throw new Error(typeof json.error === 'string' ? json.error : 'Не сохранено');
      }
      resetForm();
      setOk(
        editingId
          ? `Обновлено (${json.queued} диалогов)`
          : scheduledAt
            ? `Запланировано (${json.queued})`
            : `В очереди: ${json.queued} диалогов`,
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

  const selected = accounts.find((a) => a.id === botId);

  return (
    <AppShell maxWidth="2xl" className="space-y-5">
      <PageHeader
        title={title}
        description={description}
        backHref="/dashboard/mailing"
        backLabel="Рассылка"
      />

      {error && <Alert variant="error">{error}</Alert>}
      {ok && <Alert variant="success">{ok}</Alert>}

      <MailingBillingBanner product="mailing_accounts" onActiveChange={setBillingOk} />

      {!accounts.length ? (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
            <p>Нет подключённых аккаунтов.</p>
            <Link
              href={accountsHref}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {accountsLabel}
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
              <CardTitle>{editingId ? 'Редактировать рассылку' : 'Новая рассылка'}</CardTitle>
              {editingId ? (
                <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                  Отмена
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="account">Аккаунт</Label>
                <select
                  id="account"
                  className={selectClassName}
                  value={botId}
                  disabled={Boolean(editingId)}
                  onChange={(e) => setBotId(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {accountLabel(a)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Аудитория: открытые диалоги (Conversation) этого аккаунта
                </p>
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
              {channel === 'wa' ? (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="media">Медиа URL (HTTPS)</Label>
                    <Input
                      id="media"
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      placeholder="https://..."
                      inputMode="url"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mediaType">Тип медиа</Label>
                    <select
                      id="mediaType"
                      className={selectClassName}
                      value={mediaType}
                      onChange={(e) => setMediaType(e.target.value as MediaType | '')}
                    >
                      <option value="">Авто</option>
                      <option value="photo">Фото</option>
                      <option value="video">Видео</option>
                    </select>
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  GramJS: пока только текст (outbound media в bridge ещё нет).
                </p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="when">Отложить</Label>
                <Input
                  id="when"
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
              <Button variant="solid" onClick={submit} disabled={busy || !billingOk || !text.trim()}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {editingId
                  ? 'Сохранить'
                  : scheduledAt
                    ? 'Запланировать'
                    : 'Отправить сейчас'}
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-2">
            <p className={TG_PREVIEW_LABEL}>Превью</p>
            <TelegramPreview
              text={text || 'Текст рассылки…'}
              mediaUrl={channel === 'wa' ? mediaUrl || undefined : undefined}
              mediaType={mediaType === 'video' ? 'video' : 'photo'}
              botName={selected ? accountLabel(selected) : undefined}
            />
          </div>
        </div>
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
                  <th className="pb-2 font-medium">Статус</th>
                  <th className="pb-2 font-medium">Отправлено</th>
                  <th className="pb-2 font-medium" />
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
                    <td className="py-2.5">
                      <Badge variant="secondary">{b.status}</Badge>
                    </td>
                    <td className="py-2.5">
                      {b.sentCount}/{b.totalCount}
                    </td>
                    <td className="py-2.5 text-right">
                      {b.status === 'scheduled' ? (
                        <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(b)}>
                          Изменить
                        </Button>
                      ) : null}
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
