'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { selectClassName } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Trash2, Upload } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { uploadBotMedia } from '@/lib/upload-bot-media';
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

type Segment = 'gifted' | 'not_gifted' | 'all';
type FunnelPhase = 'started' | 'awaiting_sub' | 'gifted' | 'not_gifted';
type MediaType = 'photo' | 'video' | 'document' | 'voice' | 'video_note' | 'audio';

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
  segment?: Segment;
  funnelPhase?: FunnelPhase | null;
  text?: string;
  mediaUrl?: string | null;
  telegramFileId?: string | null;
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

function MediaPicker({
  label,
  accept,
  busy,
  hasFile,
  fileHint,
  progressPercent,
  progressPhase,
  onPick,
  onClear,
}: {
  label?: string;
  accept: string;
  busy?: boolean;
  hasFile: boolean;
  fileHint?: string;
  progressPercent?: number | null;
  progressPhase?: 'upload' | 'processing' | null;
  onPick: (file: File) => void | Promise<void>;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pct = typeof progressPercent === 'number' ? Math.max(0, Math.min(100, progressPercent)) : null;
  const statusLabel =
    progressPhase === 'processing'
      ? 'Сохраняем в Telegram…'
      : pct != null
        ? `Отправка ${pct}%`
        : 'Загрузка…';
  return (
    <div className="space-y-1.5">
      {label && <Label>{label}</Label>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onPick(file);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={Boolean(busy)}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? statusLabel : 'Выбрать файл'}
        </Button>
        {hasFile && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={Boolean(busy)}>
            <Trash2 className="h-4 w-4" /> Убрать
          </Button>
        )}
      </div>
      {busy && (
        <div className="space-y-1" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-black/10">
            <div
              className={`h-full rounded-full bg-orange-500 transition-[width] duration-200 ease-out ${
                progressPhase === 'processing' && (pct == null || pct >= 90) ? 'animate-pulse' : ''
              }`}
              style={{ width: `${pct != null ? Math.max(pct, 4) : 40}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {progressPhase === 'processing'
              ? 'Файл на сервере — бот получает file_id в Telegram.'
              : pct != null
                ? `Загружено ${pct}%`
                : 'Готовим загрузку…'}
          </p>
        </div>
      )}
      {fileHint && !busy && <p className="text-xs text-muted-foreground">{fileHint}</p>}
      {!fileHint && !hasFile && !busy && (
        <p className="text-xs text-muted-foreground">
          С компьютера → Telegram. Фото, видео (MP4) или файл до 48 МБ.
        </p>
      )}
    </div>
  );
}

export default function BroadcastsPage() {
  const router = useRouter();
  const [bots, setBots] = useState<BotRow[]>([]);
  const [botId, setBotId] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [segment, setSegment] = useState<Segment>('not_gifted');
  const [funnelPhase, setFunnelPhase] = useState<FunnelPhase | ''>('');
  const [text, setText] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [telegramFileId, setTelegramFileId] = useState('');
  const [mediaType, setMediaType] = useState<MediaType | ''>('');
  const [localPreview, setLocalPreview] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [history, setHistory] = useState<BroadcastRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    percent: number;
    phase: 'upload' | 'processing';
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [billingOk, setBillingOk] = useState(false);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setSegment('not_gifted');
    setFunnelPhase('');
    setText('');
    setMediaUrl('');
    setTelegramFileId('');
    setMediaType('');
    setScheduledAt('');
    setLocalPreview((prev) => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return '';
    });
  }, []);

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
    if (botId) {
      resetForm();
      void loadHistory(botId);
    }
  }, [botId, loadHistory, resetForm]);

  useEffect(() => {
    return () => {
      if (localPreview.startsWith('blob:')) URL.revokeObjectURL(localPreview);
    };
  }, [localPreview]);

  const selectedBot = bots.find((b) => b.id === botId);

  const uploadMedia = async (file: File) => {
    if (!botId) return;
    setUploading(true);
    setUploadProgress({ percent: 0, phase: 'upload' });
    setError('');
    try {
      const uploaded = await uploadBotMedia({
        botId,
        file,
        token: typeof window !== 'undefined' ? localStorage.getItem('voxly_token') : null,
        onProgress: (p) => setUploadProgress({ percent: p.percent, phase: p.phase }),
      });
      const preview = URL.createObjectURL(file);
      setLocalPreview((prev) => {
        if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return preview;
      });
      setTelegramFileId(uploaded.fileId);
      setMediaType(uploaded.mediaType);
      setMediaUrl('');
      setOk('Медиа загружено в Telegram');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
      setLocalPreview((prev) => {
        if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return '';
      });
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const startEdit = (row: BroadcastRow) => {
    if (row.status !== 'scheduled') return;
    setEditingId(row.id);
    setSegment(row.segment || 'all');
    setFunnelPhase(row.funnelPhase || '');
    setText(row.text || '');
    setTelegramFileId(row.telegramFileId || '');
    setMediaUrl(row.telegramFileId ? '' : row.mediaUrl || '');
    setMediaType(row.mediaType || '');
    setScheduledAt(toLocalInputValue(row.scheduledAt));
    setLocalPreview((prev) => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return '';
    });
    setOk(`Редактирование запланированной рассылки`);
    setError('');
  };

  const submit = async () => {
    if (!botId || !text.trim()) return;
    setBusy(true);
    setError('');
    setOk('');
    try {
      const body: Record<string, unknown> = {
        segment,
        text: text.trim(),
      };
      if (funnelPhase) body.funnelPhase = funnelPhase;
      if (telegramFileId) {
        body.telegramFileId = telegramFileId;
        if (mediaType) body.mediaType = mediaType;
      } else if (mediaUrl.trim()) {
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
                ...body,
                funnelPhase: funnelPhase || null,
                telegramFileId: telegramFileId || null,
                mediaUrl: telegramFileId ? null : mediaUrl.trim() || null,
                mediaType: mediaType || null,
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
          ? `Обновлено (${json.queued} чел.)`
          : scheduledAt
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

  const previewMedia = localPreview || mediaUrl || undefined;
  const hasMedia = Boolean(telegramFileId || mediaUrl || localPreview);

  return (
    <AppShell maxWidth="2xl" className="space-y-5">
      <PageHeader
        title="Рассылка сообщений ботом"
        description="Сегменты gift-подписчиков: подарок, этап воронки, расписание, медиа"
        backHref="/dashboard/mailing"
        backLabel="Рассылка"
      />

      {error && <Alert variant="error">{error}</Alert>}
      {ok && <Alert variant="success">{ok}</Alert>}

      <MailingBillingBanner product="mailing_bot" onActiveChange={setBillingOk} />

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
                <Label htmlFor="bot">Бот</Label>
                <select
                  id="bot"
                  className={selectClassName}
                  value={botId}
                  disabled={Boolean(editingId)}
                  onChange={(e) => setBotId(e.target.value)}
                >
                  {bots.map((b) => (
                    <option key={b.id} value={b.id}>
                      @{b.botUsername || b.id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="segment">Подарок</Label>
                  <select
                    id="segment"
                    className={selectClassName}
                    value={segment}
                    onChange={(e) => setSegment(e.target.value as Segment)}
                  >
                    <option value="not_gifted">Не получили подарок</option>
                    <option value="gifted">Получили подарок</option>
                    <option value="all">Все</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="funnelPhase">Этап воронки</Label>
                  <select
                    id="funnelPhase"
                    className={selectClassName}
                    value={funnelPhase}
                    onChange={(e) => setFunnelPhase(e.target.value as FunnelPhase | '')}
                  >
                    <option value="">Любой</option>
                    <option value="started">Старт (/start)</option>
                    <option value="awaiting_sub">Ждёт подписку</option>
                    <option value="gifted">Получил подарок</option>
                    <option value="not_gifted">Не получил подарок</option>
                  </select>
                </div>
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
              <MediaPicker
                label="Медиа"
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.rar,.ogg,.opus,.mp3,.m4a,application/*"
                busy={uploading}
                progressPercent={uploadProgress?.percent ?? null}
                progressPhase={uploadProgress?.phase ?? null}
                hasFile={hasMedia}
                fileHint={
                  telegramFileId
                    ? 'Файл в Telegram (file_id)'
                    : mediaUrl
                      ? 'HTTPS URL'
                      : undefined
                }
                onPick={uploadMedia}
                onClear={() => {
                  setTelegramFileId('');
                  setMediaUrl('');
                  setMediaType('');
                  setLocalPreview((prev) => {
                    if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                    return '';
                  });
                }}
              />
              {!telegramFileId && (
                <div className="space-y-1.5">
                  <Label htmlFor="media">Или медиа URL</Label>
                  <Input
                    id="media"
                    value={mediaUrl}
                    onChange={(e) => {
                      setMediaUrl(e.target.value);
                      if (e.target.value.trim()) setTelegramFileId('');
                    }}
                    placeholder="https://..."
                    inputMode="url"
                  />
                </div>
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
              <Button variant="solid" onClick={submit} disabled={busy || uploading || !billingOk || !text.trim()}>
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
              botId={botId || undefined}
              text={text || 'Текст рассылки…'}
              mediaUrl={previewMedia}
              mediaType={mediaType || 'photo'}
              telegramFileId={telegramFileId || undefined}
              mediaPlaceholder={Boolean(telegramFileId) && !previewMedia}
              botName={selectedBot?.botUsername ? `@${selectedBot.botUsername}` : undefined}
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
                  <th className="pb-2 font-medium">Сегмент</th>
                  <th className="pb-2 font-medium">Этап</th>
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
                    <td className="py-2.5">{b.segment || '—'}</td>
                    <td className="py-2.5">{b.funnelPhase || '—'}</td>
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
