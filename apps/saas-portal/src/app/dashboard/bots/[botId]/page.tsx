'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectClassName } from '@/lib/utils';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Megaphone, Trash2, Upload } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { ProjectPicker } from '@/components/portal/project-picker';
import { TELEGRAM_CLIENT_MD_HINT } from '@voxly/shared';
import { TelegramPreview } from '@/components/telegram-preview';

interface GiftFunnelMessage {
  delayMinutes: number;
  text: string;
  imageUrl?: string;
  telegramFileId?: string;
  mediaType?: 'photo' | 'video';
}

interface GiftFunnelConfig {
  start: {
    text: string;
    imageUrl?: string;
    telegramFileId?: string;
    mediaType?: 'photo' | 'video';
  };
  notSubscribed: GiftFunnelMessage[];
  gift: {
    type: 'file' | 'link' | 'video';
    url: string;
    telegramFileId?: string;
    mediaType?: 'photo' | 'video';
    caption?: string;
  };
  afterGift: GiftFunnelMessage[];
  notGifted: GiftFunnelMessage[];
  subscribeButton?: { confirmLabel?: string };
}

interface GiftPromoPost {
  text: string;
  mediaType?: 'photo' | 'video';
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  mediaUrl?: string;
  imageUrl?: string;
  buttonText: string;
  clickCount: number;
  telegramMessageId?: number;
  publishedAt?: string;
}

interface CampaignRow {
  id: string;
  name: string;
  channelId: string;
  channelUsername: string | null;
  giftFileUrl: string | null;
  funnelJson: GiftFunnelConfig;
  promoPost?: GiftPromoPost;
  isActive: boolean;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  botLink: string | null;
  hasGiftCampaign: boolean;
  telegramDescription?: string | null;
  telegramShortDescription?: string | null;
  campaigns?: CampaignRow[];
  campaign: CampaignRow | null;
}

type FunnelPreviewKey =
  | 'start'
  | 'gift'
  | `notSubscribed:${number}`
  | `afterGift:${number}`
  | `notGifted:${number}`;

const DEFAULT_PROMO: GiftPromoPost = {
  text: '🎁 Забери подарок бесплатно!\n\nПодпишись на канал и нажми кнопку ниже — бот сразу отправит материал.',
  mediaType: 'photo',
  buttonText: 'Получить подарок',
  clickCount: 0,
};

function normalizePromo(p?: GiftPromoPost | null): GiftPromoPost {
  const base = p || DEFAULT_PROMO;
  return {
    ...DEFAULT_PROMO,
    ...base,
    mediaType: base.mediaType === 'video' ? 'video' : 'photo',
    telegramFileId: base.telegramFileId || undefined,
    telegramFileUniqueId: base.telegramFileUniqueId || undefined,
    mediaUrl: base.telegramFileId ? undefined : base.mediaUrl || base.imageUrl || undefined,
  };
}

function authTokenOnly(): HeadersInit {
  const token = typeof window !== 'undefined' ? localStorage.getItem('voxly_token') : null;
  return { Authorization: `Bearer ${token}` };
}

/** Flatten Zod / Fastify error payloads into a short Russian message. */
function formatApiError(error: unknown): string {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error !== 'object') return String(error);
  const e = error as {
    formErrors?: string[];
    fieldErrors?: Record<string, string[] | undefined>;
    message?: string;
  };
  const fieldMsgs = e.fieldErrors
    ? Object.entries(e.fieldErrors).flatMap(([field, msgs]) =>
        (msgs || []).map((m) => (field === 'funnel' ? m : `${field}: ${m}`)),
      )
    : [];
  const parts = [...(e.formErrors || []), ...fieldMsgs].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  if (e.message) return e.message;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Ошибка запроса';
  }
}

export default function BotSettingsPage() {
  const { botId } = useParams<{ botId: string }>();
  const router = useRouter();
  const [bot, setBot] = useState<BotRow | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('Проект');
  const [newProjectName, setNewProjectName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [busy, setBusy] = useState('');
  const [channelUsername, setChannelUsername] = useState('');
  const [channelId, setChannelId] = useState('');
  const [funnel, setFunnel] = useState<GiftFunnelConfig | null>(null);
  const [promo, setPromo] = useState<GiftPromoPost>(DEFAULT_PROMO);
  const [promoLocalPreview, setPromoLocalPreview] = useState<string | undefined>();
  const [botDescription, setBotDescription] = useState('');
  const [botShortDescription, setBotShortDescription] = useState('');
  const [funnelLocalPreviews, setFunnelLocalPreviews] = useState<Record<string, string>>({});
  const [funnelPreviewKey, setFunnelPreviewKey] = useState<FunnelPreviewKey>('start');
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<
    { id: string; role: string; content: string; sentAt: string }[]
  >([]);
  const [replyText, setReplyText] = useState('');
  /** Poll must not wipe unsaved funnel/promo edits. */
  const formHydratedRef = useRef(false);
  const campaignIdRef = useRef<string | null>(null);

  const hydrateFromCampaign = (c: CampaignRow | null | undefined, defaultFunnel?: GiftFunnelConfig) => {
    if (c) {
      setCampaignId(c.id);
      campaignIdRef.current = c.id;
      setProjectName(c.name || 'Проект');
      setChannelUsername(c.channelUsername || '');
      setChannelId(c.channelId === 'pending' ? '' : c.channelId || '');
      setFunnel(c.funnelJson);
      setPromo(normalizePromo(c.promoPost));
    } else {
      setCampaignId(null);
      campaignIdRef.current = null;
      setProjectName('Проект');
      setFunnel((prev) => prev || defaultFunnel || null);
      setPromo(DEFAULT_PROMO);
    }
  };

  const load = useCallback(async (opts?: { refreshForm?: boolean }) => {
    const refreshForm = opts?.refreshForm === true || !formHydratedRef.current;
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/bots', { headers: authHeaders() });
      if (!res.ok) throw new Error('Не удалось загрузить');
      const json = await res.json();
      const row = (json.bots as BotRow[]).find((b) => b.id === botId);
      if (!row) throw new Error('Бот не найден');
      setBot(row);
      if (refreshForm) {
        setBotDescription(row.telegramDescription || '');
        setBotShortDescription(row.telegramShortDescription || '');
      }
      const list = row.campaigns?.length
        ? row.campaigns
        : row.campaign
          ? [row.campaign]
          : [];
      setCampaigns(list);

      const preferredId = campaignIdRef.current;
      const selected =
        (preferredId && list.find((c) => c.id === preferredId)) ||
        list.find((c) => c.isActive) ||
        list[0] ||
        null;

      if (refreshForm) {
        hydrateFromCampaign(selected, json.defaultFunnel);
        formHydratedRef.current = true;
      } else if (selected?.promoPost && selected.id === campaignIdRef.current) {
        const remote = normalizePromo(selected.promoPost);
        setPromo((prev) => ({
          ...prev,
          clickCount: remote.clickCount,
          publishedAt: remote.publishedAt,
          telegramMessageId: remote.telegramMessageId,
        }));
      }

      const q = selected?.id ? `?campaignId=${encodeURIComponent(selected.id)}` : '';
      const subRes = await fetch(`/api/bots/${botId}/subscribers${q}`, { headers: authHeaders() });
      if (subRes.ok) {
        const subJson = await subRes.json();
        setSubscribers(subJson.subscribers || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [botId, router]);

  useEffect(() => {
    formHydratedRef.current = false;
    void load({ refreshForm: true });
    const t = setInterval(() => void load({ refreshForm: false }), 15000);
    return () => clearInterval(t);
  }, [load]);

  const promoButtonLabel = useMemo(
    () => `${promo.buttonText || 'Получить подарок'} · ${promo.clickCount || 0}`,
    [promo.buttonText, promo.clickCount],
  );

  const subscribeLabel = funnel?.subscribeButton?.confirmLabel || 'Я подписался ✅';
  const botPreviewName = bot?.botUsername ? `@${bot.botUsername}` : undefined;

  const setFunnelLocal = (key: string, url?: string) => {
    setFunnelLocalPreviews((prev) => {
      const next = { ...prev };
      if (prev[key]?.startsWith('blob:')) URL.revokeObjectURL(prev[key]);
      if (url) next[key] = url;
      else delete next[key];
      return next;
    });
  };

  const uploadMedia = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    if (campaignId) fd.append('campaignId', campaignId);
    const q = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
    const res = await fetch(`/api/bots/${botId}/media${q}`, {
      method: 'POST',
      headers: authTokenOnly(),
      body: fd,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || 'Не удалось загрузить файл');
    return json as {
      fileId: string;
      fileUniqueId?: string;
      mediaType?: 'photo' | 'video';
      kind: 'photo' | 'video' | 'document';
    };
  };

  const verifyChannel = async () => {
    setBusy('verify');
    setOk('');
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}/channel/verify`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          channelUsername,
          campaignId: campaignId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        const errMsg =
          typeof json.error === 'string'
            ? json.error
            : json.message || 'Проверка не прошла';
        setError(errMsg);
        return;
      }
      setChannelId(json.channelId);
      if (json.channelUsername) {
        setChannelUsername(
          /^-?\d+$/.test(json.channelUsername)
            ? json.channelUsername
            : `@${String(json.channelUsername).replace(/^@/, '')}`,
        );
      }
      setOk(json.message || 'Канал подтверждён и сохранён');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const saveCampaign = async () => {
    if (!funnel) return;
    setBusy('save');
    setError('');
    setOk('');
    try {
      const res = await fetch(`/api/bots/${botId}/campaign`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          campaignId: campaignId || undefined,
          name: projectName.trim() || 'Проект',
          channelUsername,
          channelId: channelId || undefined,
          giftFileUrl: funnel.gift.url || undefined,
          funnel,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(formatApiError(json.error) || 'Не сохранено');
      }
      if (json.campaign?.id) {
        setCampaignId(json.campaign.id);
        campaignIdRef.current = json.campaign.id;
      }
      const giftReady = Boolean(
        funnel.gift.telegramFileId
        || (funnel.gift.type === 'link' && funnel.gift.url)
        || (funnel.gift.url && /^https?:\/\//i.test(funnel.gift.url)),
      );
      setOk(
        giftReady
          ? 'Проект и воронка сохранены'
          : 'Сообщения сохранены. Загрузите файл подарка в блоке «Подарок», когда будете готовы.',
      );
      await load({ refreshForm: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const createProject = async () => {
    const name = newProjectName.trim() || `Проект ${campaigns.length + 1}`;
    setBusy('create-project');
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}/campaigns`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          name,
          cloneFromId: campaignId || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не создано');
      setNewProjectName('');
      campaignIdRef.current = json.campaign.id;
      setOk(`Проект «${json.campaign.name}» создан и включён`);
      formHydratedRef.current = false;
      await load({ refreshForm: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const saveBotDescription = async () => {
    setBusy('bot-desc');
    setError('');
    setOk('');
    try {
      const res = await fetch(`/api/bots/${botId}/telegram-profile`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          description: botDescription,
          shortDescription: botShortDescription || botDescription.slice(0, 120),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(formatApiError(json.error) || 'Не сохранено');
      setBotDescription(json.telegramDescription || botDescription);
      setBotShortDescription(json.telegramShortDescription || botShortDescription);
      setBot((prev) =>
        prev
          ? {
              ...prev,
              telegramDescription: json.telegramDescription,
              telegramShortDescription: json.telegramShortDescription,
            }
          : prev,
      );
      setOk('Первое сообщение бота сохранено в Telegram');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const toggleProject = async (id: string, isActive: boolean) => {
    setBusy(`toggle-${id}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}/campaigns/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ isActive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не обновлено');
      setOk(
        isActive
          ? 'Проект активен — остальные на паузе'
          : 'Проект на паузе (активного нет — /start не примет лидов)',
      );
      // Exclusive active: refresh list so only one switch stays on
      setCampaigns((prev) =>
        prev.map((c) => ({
          ...c,
          isActive: isActive ? c.id === id : c.id === id ? false : c.isActive,
        })),
      );
      await load({ refreshForm: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const saveProjectSchedule = async (
    id: string,
    scheduledStartAt: string | null,
    scheduledEndAt: string | null,
  ) => {
    setBusy(`schedule-${id}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}/campaigns/${id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ scheduledStartAt, scheduledEndAt }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Расписание не сохранено');
      setCampaigns((prev) =>
        prev.map((c) =>
          c.id === id
            ? {
                ...c,
                scheduledStartAt: json.campaign?.scheduledStartAt ?? scheduledStartAt,
                scheduledEndAt: json.campaign?.scheduledEndAt ?? scheduledEndAt,
              }
            : c,
        ),
      );
      setOk('Расписание проекта сохранено');
      await load({ refreshForm: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const selectProject = (id: string) => {
    const c = campaigns.find((x) => x.id === id);
    if (!c) return;
    formHydratedRef.current = true;
    hydrateFromCampaign(c);
    setOk(`Редактируете: ${c.name}`);
    void fetch(`/api/bots/${botId}/subscribers?campaignId=${encodeURIComponent(c.id)}`, {
      headers: authHeaders(),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j) setSubscribers(j.subscribers || []);
      });
  };

  const savePromo = async () => {
    setBusy('promo-save');
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}/promo`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          campaignId: campaignId || undefined,
          text: promo.text,
          mediaType: promo.mediaType === 'video' ? 'video' : 'photo',
          telegramFileId: promo.telegramFileId || '',
          telegramFileUniqueId: promo.telegramFileUniqueId || '',
          mediaUrl: promo.telegramFileId ? '' : promo.mediaUrl || '',
          buttonText: promo.buttonText,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не сохранено');
      setPromo(normalizePromo(json.promoPost));
      setOk('Черновик поста сохранён');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const publishPromo = async () => {
    setBusy('promo-publish');
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}/promo/publish`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          campaignId: campaignId || undefined,
          text: promo.text,
          mediaType: promo.mediaType === 'video' ? 'video' : 'photo',
          telegramFileId: promo.telegramFileId || '',
          telegramFileUniqueId: promo.telegramFileUniqueId || '',
          mediaUrl: promo.telegramFileId ? '' : promo.mediaUrl || '',
          buttonText: promo.buttonText,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не опубликовано');
      setPromo(normalizePromo(json.promoPost));
      setOk('Пост опубликован в канале');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const openChat = async (subscriberId: string) => {
    setActiveChatId(subscriberId);
    setReplyText('');
    try {
      const res = await fetch(`/api/bots/${botId}/subscribers/${subscriberId}/messages`, {
        headers: authHeaders(),
      });
      if (!res.ok) throw new Error('Не удалось загрузить переписку');
      const json = await res.json();
      setChatMessages(json.messages || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка чата');
    }
  };

  const sendReply = async () => {
    if (!activeChatId || !replyText.trim()) return;
    setBusy('reply');
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}/subscribers/${activeChatId}/reply`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ text: replyText.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не отправлено');
      setReplyText('');
      await openChat(activeChatId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const activeFunnelPreview = useMemo(() => {
    if (!funnel) return { text: '', mediaUrl: undefined as string | undefined, mediaType: 'photo' as const, buttonLabel: undefined as string | undefined };
    if (funnelPreviewKey === 'start') {
      return {
        text: funnel.start.text,
        mediaUrl: funnelLocalPreviews.start || funnel.start.imageUrl,
        mediaType: (funnel.start.mediaType === 'video' ? 'video' : 'photo') as 'photo' | 'video',
        buttonLabel: subscribeLabel,
        hasFileId: Boolean(funnel.start.telegramFileId),
      };
    }
    if (funnelPreviewKey === 'gift') {
      const local = funnelLocalPreviews.gift;
      return {
        text: funnel.gift.caption || 'Вот твой подарок 🎁',
        mediaUrl: local || (funnel.gift.type === 'link' ? undefined : funnel.gift.url || undefined),
        mediaType: (funnel.gift.type === 'video' ? 'video' : 'photo') as 'photo' | 'video',
        buttonLabel: undefined,
        hasFileId: Boolean(funnel.gift.telegramFileId),
      };
    }
    const [bucket, idxStr] = funnelPreviewKey.split(':') as ['notSubscribed' | 'afterGift' | 'notGifted', string];
    const index = Number(idxStr);
    const list =
      bucket === 'notSubscribed'
        ? funnel.notSubscribed
        : bucket === 'afterGift'
          ? funnel.afterGift
          : funnel.notGifted;
    const m = list[index];
    return {
      text: m?.text || '',
      mediaUrl: funnelLocalPreviews[funnelPreviewKey] || m?.imageUrl,
      mediaType: (m?.mediaType === 'video' ? 'video' : 'photo') as 'photo' | 'video',
      buttonLabel: bucket === 'afterGift' ? undefined : subscribeLabel,
      hasFileId: Boolean(m?.telegramFileId),
    };
  }, [funnel, funnelPreviewKey, funnelLocalPreviews, subscribeLabel]);

  if (loading) {
    return (
      <AppShell>
        <LoadingState />
      </AppShell>
    );
  }

  if (!bot || !funnel) {
    return (
      <AppShell maxWidth="3xl">
        <Alert variant="error">{error || 'Бот не найден'}</Alert>
        <Button asChild className="mt-4" variant="secondary">
          <Link href="/dashboard/bots">← К списку</Link>
        </Button>
      </AppShell>
    );
  }

  return (
    <AppShell className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/bots"
            className="inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground transition-colors duration-[var(--duration-fast)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Все боты
          </Link>
          <h1 className="mt-2 text-[1.65rem] font-semibold tracking-tight">@{bot.botUsername}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge variant={bot.status === 'active' ? 'success' : 'warning'}>{bot.status}</Badge>
            {projectName && <Badge variant="secondary">{projectName}</Badge>}
            {channelUsername && (
              <Badge variant="outline">@{channelUsername.replace(/^@/, '')}</Badge>
            )}
          </div>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/mailing/bot">
            <Megaphone className="h-4 w-4" /> Рассылки
          </Link>
        </Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {ok && <Alert variant="success">{ok}</Alert>}

      {/* Projects / campaigns — only one active at a time */}
      <Card className="overflow-hidden shadow-[var(--elevation-1)]">
        <CardHeader className="border-b border-border/80 bg-secondary/25">
          <CardTitle>Проекты</CardTitle>
          <CardDescription>
            Несколько акций на одном боте. Одновременно активен только один. Можно задать расписание
            старта/стопа (день 1 / день 2…). Клик по карточке — редактирование; переключатель —
            вручную вкл/выкл.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <ProjectPicker
            projects={campaigns}
            selectedId={campaignId}
            projectName={projectName}
            newProjectName={newProjectName}
            busy={busy}
            onSelect={selectProject}
            onToggleActive={toggleProject}
            onProjectNameChange={setProjectName}
            onNewProjectNameChange={setNewProjectName}
            onCreate={createProject}
            onSaveSchedule={saveProjectSchedule}
          />
        </CardContent>
      </Card>

      {/* 1.1 Channel */}
      <Card>
        <CardHeader>
          <CardTitle>1.1 Канал</CardTitle>
          <CardDescription>
            Добавьте @{bot.botUsername} админом канала или супергруппы (права: видеть участников и
            публиковать сообщения). Укажите публичный @username — не название чата и не invite-ссылку
            t.me/+…
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Username канала</Label>
            <Input
              className="mt-1.5"
              value={channelUsername}
              onChange={(e) => setChannelUsername(e.target.value)}
              placeholder="@my_channel"
            />
          </div>
          <Button variant="outline" onClick={verifyChannel} disabled={busy === 'verify' || !channelUsername}>
            {busy === 'verify' ? '…' : 'Проверить админа'}
          </Button>
          {channelId ? (
            <p className="text-sm text-emerald-700">
              Канал привязан · id {channelId}
              {channelUsername ? ` · ${channelUsername}` : ''}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              После проверки канал сохранится в выбранный проект автоматически.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 1.2 First message — Telegram bot description before /start */}
      <Card>
        <CardHeader>
          <CardTitle>1.2 Первое сообщение бота</CardTitle>
          <CardDescription>
            Текст на экране Telegram, когда человек перешёл по ссылке на бота, но ещё не нажал
            «Старт» / «Перезапустить». Это описание профиля бота (не сообщение в чате).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Текст описания (до 512 символов)</Label>
            <Textarea
              className="mt-1.5"
              rows={5}
              maxLength={512}
              value={botDescription}
              onChange={(e) => setBotDescription(e.target.value)}
              placeholder={`${bot.botUsername || 'Бот'} готов!\n\nНажмите Старт, чтобы получить подарок.`}
            />
            <p className="mt-1 text-xs text-muted-foreground">{botDescription.length}/512</p>
          </div>
          <div>
            <Label>Короткое описание (до 120 символов, опционально)</Label>
            <Input
              className="mt-1.5"
              maxLength={120}
              value={botShortDescription}
              onChange={(e) => setBotShortDescription(e.target.value)}
              placeholder="Кратко в профиле и при шаринге"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {botShortDescription.length}/120 · если пусто — возьмём начало длинного текста
            </p>
          </div>
          <Button variant="outline" onClick={saveBotDescription} disabled={busy === 'bot-desc'}>
            {busy === 'bot-desc' ? '…' : 'Сохранить в Telegram'}
          </Button>
        </CardContent>
      </Card>

      {/* 1.3 Start message — after /start in chat */}
      <Card>
        <CardHeader>
          <CardTitle>1.3 Стартовое сообщение бота</CardTitle>
          <CardDescription>
            Что бот напишет в чат сразу после /start. Обычно тут просят подписаться на канал и
            нажать кнопку ниже. Настройте до массового запуска.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-2">
            <div
              className="space-y-3"
              onFocusCapture={() => setFunnelPreviewKey('start')}
              onClick={() => setFunnelPreviewKey('start')}
            >
              <div>
                <Label>Текст (Markdown: {TELEGRAM_CLIENT_MD_HINT})</Label>
                <Textarea
                  className="mt-1.5"
                  rows={5}
                  value={funnel.start.text}
                  onChange={(e) =>
                    setFunnel({ ...funnel, start: { ...funnel.start, text: e.target.value } })
                  }
                />
              </div>
              <MediaPicker
                label="Медиа"
                accept="image/*,video/*"
                busy={busy === 'funnel-start-media'}
                hasFile={Boolean(
                  funnel.start.telegramFileId || funnelLocalPreviews.start || funnel.start.imageUrl,
                )}
                fileHint={funnel.start.telegramFileId ? 'Файл в Telegram' : undefined}
                onPick={async (file) => {
                  setBusy('funnel-start-media');
                  setError('');
                  setFunnelLocal('start', URL.createObjectURL(file));
                  try {
                    const uploaded = await uploadMedia(file);
                    setFunnel({
                      ...funnel,
                      start: {
                        ...funnel.start,
                        telegramFileId: uploaded.fileId,
                        mediaType: uploaded.mediaType,
                        imageUrl: undefined,
                      },
                    });
                    setOk('Медиа /start загружено');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                  } finally {
                    setBusy('');
                  }
                }}
                onClear={() => {
                  setFunnelLocal('start');
                  setFunnel({
                    ...funnel,
                    start: {
                      ...funnel.start,
                      telegramFileId: undefined,
                      mediaType: undefined,
                      imageUrl: undefined,
                    },
                  });
                }}
              />
              <div>
                <Label>Текст на кнопке</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Эту кнопку человек нажимает, когда уже подписался на канал.
                </p>
                <Input
                  className="mt-1.5"
                  value={funnel.subscribeButton?.confirmLabel || 'Я подписался ✅'}
                  onChange={(e) =>
                    setFunnel({
                      ...funnel,
                      subscribeButton: { confirmLabel: e.target.value || 'Я подписался ✅' },
                    })
                  }
                />
              </div>
              <Button variant="outline" onClick={saveCampaign} disabled={busy === 'save'}>
                {busy === 'save' ? '…' : 'Сохранить стартовое сообщение'}
              </Button>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Превью в чате после /start
              </p>
              <TelegramPreview
                botName={`@${bot.botUsername || 'bot'}`}
                text={funnel.start.text}
                mediaType={funnel.start.mediaType === 'video' ? 'video' : 'photo'}
                mediaUrl={funnelLocalPreviews.start || funnel.start.imageUrl}
                mediaPlaceholder={
                  Boolean(funnel.start.telegramFileId) &&
                  !funnelLocalPreviews.start &&
                  !funnel.start.imageUrl
                }
                buttonLabel={subscribeLabel}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. Promo post */}
      <Card>
        <CardHeader>
          <CardTitle>2. Пост в канале об акции</CardTitle>
          <CardDescription>
            Картинка или видео + текст + кнопка. Файл загружается в Telegram (file_id), хостинг не нужен.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Label>Текст (Markdown: {TELEGRAM_CLIENT_MD_HINT})</Label>
                <Textarea
                  className="mt-1.5"
                  rows={6}
                  value={promo.text}
                  onChange={(e) => setPromo({ ...promo, text: e.target.value })}
                />
              </div>
              <MediaPicker
                label="Медиа"
                accept="image/*,video/*"
                busy={busy === 'promo-media'}
                hasFile={Boolean(promo.telegramFileId || promoLocalPreview || promo.mediaUrl)}
                fileHint={
                  promo.telegramFileId
                    ? 'Файл сохранён в Telegram'
                    : promo.mediaUrl
                      ? 'Старый URL (лучше загрузить файл)'
                      : undefined
                }
                onPick={async (file) => {
                  setBusy('promo-media');
                  setError('');
                  const objectUrl = URL.createObjectURL(file);
                  setPromoLocalPreview((prev) => {
                    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
                    return objectUrl;
                  });
                  try {
                    const uploaded = await uploadMedia(file);
                    setPromo({
                      ...promo,
                      mediaType: uploaded.mediaType,
                      telegramFileId: uploaded.fileId,
                      telegramFileUniqueId: uploaded.fileUniqueId,
                      mediaUrl: undefined,
                    });
                    setOk('Медиа загружено в Telegram');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                  } finally {
                    setBusy('');
                  }
                }}
                onClear={() => {
                  setPromoLocalPreview((prev) => {
                    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
                    return undefined;
                  });
                  setPromo({
                    ...promo,
                    telegramFileId: undefined,
                    telegramFileUniqueId: undefined,
                    mediaUrl: undefined,
                  });
                }}
              />
              <div>
                <Label>Текст кнопки</Label>
                <Input
                  className="mt-1.5"
                  value={promo.buttonText}
                  onChange={(e) => setPromo({ ...promo, buttonText: e.target.value })}
                  placeholder="Получить подарок"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  В Telegram будет: «{promoButtonLabel}». Счётчик растёт при Start по кнопке.
                </p>
              </div>
              {promo.publishedAt && (
                <p className="text-xs text-muted-foreground">
                  Опубликован: {new Date(promo.publishedAt).toLocaleString('ru-RU')} · нажатий:{' '}
                  {promo.clickCount}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={savePromo} disabled={busy === 'promo-save'}>
                  {busy === 'promo-save' ? '…' : 'Сохранить черновик'}
                </Button>
                <Button onClick={publishPromo} disabled={busy === 'promo-publish' || !channelId}>
                  {busy === 'promo-publish' ? '…' : 'Опубликовать в канале'}
                </Button>
              </div>
              {!channelId && (
                <p className="text-xs text-amber-700">Сначала проверьте канал в блоке 1.1.</p>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium text-muted-foreground">Превью в Telegram</p>
              <TelegramPreview
                botName={bot.campaign?.channelUsername ? `@${bot.campaign.channelUsername.replace(/^@/, '')}` : 'Канал'}
                text={promo.text}
                mediaType={promo.mediaType === 'video' ? 'video' : 'photo'}
                mediaUrl={promoLocalPreview || promo.mediaUrl}
                mediaPlaceholder={Boolean(promo.telegramFileId) && !promoLocalPreview && !promo.mediaUrl}
                buttonLabel={promoButtonLabel}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. Funnel / warmup — remaining steps (start is in 1.2) */}
      <Card>
        <CardHeader>
          <CardTitle>3. Дальнейшие сообщения бота</CardTitle>
          <CardDescription>
            Что бот пишет после /start: напоминания, подарок, follow-up. Стартовое сообщение — в блоке
            1.2. Справа — превью в Telegram. Текст: {TELEGRAM_CLIENT_MD_HINT}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-5">
              <div className="flex flex-wrap gap-1.5">
                {funnel.notSubscribed.map((_, i) => (
                  <PreviewChip
                    key={`ns-${i}`}
                    active={funnelPreviewKey === `notSubscribed:${i}`}
                    onClick={() => setFunnelPreviewKey(`notSubscribed:${i}`)}
                    label={`Не в канале ${i + 1}`}
                  />
                ))}
                <PreviewChip
                  active={funnelPreviewKey === 'gift'}
                  onClick={() => setFunnelPreviewKey('gift')}
                  label="Подарок"
                />
                {funnel.afterGift.map((_, i) => (
                  <PreviewChip
                    key={`ag-${i}`}
                    active={funnelPreviewKey === `afterGift:${i}`}
                    onClick={() => setFunnelPreviewKey(`afterGift:${i}`)}
                    label={`После подарка ${i + 1}`}
                  />
                ))}
                {funnel.notGifted.map((_, i) => (
                  <PreviewChip
                    key={`ng-${i}`}
                    active={funnelPreviewKey === `notGifted:${i}`}
                    onClick={() => setFunnelPreviewKey(`notGifted:${i}`)}
                    label={`Молчит ${i + 1}`}
                  />
                ))}
              </div>

              <MessageList
                title="3.1 Нажал кнопку, но не в канале"
                hint="Человек нажал «Я подписался», а в канале его нет. Через указанное время бот напомнит подписаться."
                messages={funnel.notSubscribed}
                previewBucket="notSubscribed"
                activeKey={funnelPreviewKey}
                localPreviews={funnelLocalPreviews}
                uploadingKey={busy}
                busyPrefix="funnel-ns"
                onSelect={(i) => setFunnelPreviewKey(`notSubscribed:${i}`)}
                onChange={(notSubscribed) => setFunnel({ ...funnel, notSubscribed })}
                onUpload={async (i, file) => {
                  const key = `notSubscribed:${i}`;
                  setBusy(`funnel-ns-${i}`);
                  setError('');
                  setFunnelLocal(key, URL.createObjectURL(file));
                  try {
                    const uploaded = await uploadMedia(file);
                    const next = [...funnel.notSubscribed];
                    next[i] = {
                      ...next[i],
                      telegramFileId: uploaded.fileId,
                      mediaType: uploaded.mediaType,
                      imageUrl: undefined,
                    };
                    setFunnel({ ...funnel, notSubscribed: next });
                    setOk('Медиа загружено');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                  } finally {
                    setBusy('');
                  }
                }}
                onClearMedia={(i) => {
                  setFunnelLocal(`notSubscribed:${i}`);
                  const next = [...funnel.notSubscribed];
                  next[i] = {
                    ...next[i],
                    telegramFileId: undefined,
                    mediaType: undefined,
                    imageUrl: undefined,
                  };
                  setFunnel({ ...funnel, notSubscribed: next });
                }}
              />

              <div
                className={`space-y-2 rounded-lg border p-3 ${funnelPreviewKey === 'gift' ? 'border-foreground/30' : 'border-border/60'}`}
                onFocusCapture={() => setFunnelPreviewKey('gift')}
                onClick={() => setFunnelPreviewKey('gift')}
              >
                <div>
                  <Label>3.2 Сам подарок</Label>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Это бот отправит, когда человек реально подписался на канал и нажал кнопку.
                    Можно файл, картинку, видео или ссылку.
                  </p>
                </div>
                <select
                  className={selectClassName}
                  value={funnel.gift.type}
                  onChange={(e) =>
                    setFunnel({
                      ...funnel,
                      gift: {
                        ...funnel.gift,
                        type: e.target.value as GiftFunnelConfig['gift']['type'],
                        telegramFileId:
                          e.target.value === 'link' ? undefined : funnel.gift.telegramFileId,
                      },
                    })
                  }
                >
                  <option value="file">Файл или картинка</option>
                  <option value="link">Ссылка на сайт</option>
                  <option value="video">Видео</option>
                </select>
                {funnel.gift.type === 'link' ? (
                  <Input
                    value={funnel.gift.url}
                    onChange={(e) => setFunnel({ ...funnel, gift: { ...funnel.gift, url: e.target.value } })}
                    placeholder="https://..."
                  />
                ) : (
                  <MediaPicker
                    accept={funnel.gift.type === 'video' ? 'video/*' : '*/*'}
                    busy={busy === 'funnel-gift-media'}
                    hasFile={Boolean(
                      funnel.gift.telegramFileId || funnelLocalPreviews.gift || funnel.gift.url,
                    )}
                    fileHint={funnel.gift.telegramFileId ? 'Файл в Telegram' : undefined}
                    onPick={async (file) => {
                      setBusy('funnel-gift-media');
                      setError('');
                      setFunnelLocal('gift', URL.createObjectURL(file));
                      try {
                        const uploaded = await uploadMedia(file);
                        setFunnel({
                          ...funnel,
                          gift: {
                            ...funnel.gift,
                            telegramFileId: uploaded.fileId,
                            url: '',
                            mediaType:
                              uploaded.kind === 'photo'
                                ? 'photo'
                                : uploaded.kind === 'video'
                                  ? 'video'
                                  : undefined,
                            type: uploaded.kind === 'video' ? 'video' : 'file',
                          },
                        });
                        setOk('Подарок загружен в Telegram');
                      } catch (e) {
                        setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                      } finally {
                        setBusy('');
                      }
                    }}
                    onClear={() => {
                      setFunnelLocal('gift');
                      setFunnel({
                        ...funnel,
                        gift: { ...funnel.gift, telegramFileId: undefined, url: '' },
                      });
                    }}
                  />
                )}
                <Input
                  value={funnel.gift.caption || ''}
                  onChange={(e) => setFunnel({ ...funnel, gift: { ...funnel.gift, caption: e.target.value } })}
                  placeholder="Текст рядом с подарком"
                />
              </div>

              <MessageList
                title="3.3 После того как подарок уже отдали"
                hint="Человек получил подарок. Через указанное время бот может написать ещё раз — спросить, как материал, предложить помощь."
                messages={funnel.afterGift}
                previewBucket="afterGift"
                activeKey={funnelPreviewKey}
                localPreviews={funnelLocalPreviews}
                uploadingKey={busy}
                busyPrefix="funnel-ag"
                onSelect={(i) => setFunnelPreviewKey(`afterGift:${i}`)}
                onChange={(afterGift) => setFunnel({ ...funnel, afterGift })}
                onUpload={async (i, file) => {
                  const key = `afterGift:${i}`;
                  setBusy(`funnel-ag-${i}`);
                  setError('');
                  setFunnelLocal(key, URL.createObjectURL(file));
                  try {
                    const uploaded = await uploadMedia(file);
                    const next = [...funnel.afterGift];
                    next[i] = {
                      ...next[i],
                      telegramFileId: uploaded.fileId,
                      mediaType: uploaded.mediaType,
                      imageUrl: undefined,
                    };
                    setFunnel({ ...funnel, afterGift: next });
                    setOk('Медиа загружено');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                  } finally {
                    setBusy('');
                  }
                }}
                onClearMedia={(i) => {
                  setFunnelLocal(`afterGift:${i}`);
                  const next = [...funnel.afterGift];
                  next[i] = {
                    ...next[i],
                    telegramFileId: undefined,
                    mediaType: undefined,
                    imageUrl: undefined,
                  };
                  setFunnel({ ...funnel, afterGift: next });
                }}
              />
              <MessageList
                title="3.4 Запустил бота и молчит"
                hint="Человек нажал Start и больше ничего не сделал — не нажимал «Я подписался». Через время бот напомнит забрать подарок."
                messages={funnel.notGifted}
                previewBucket="notGifted"
                activeKey={funnelPreviewKey}
                localPreviews={funnelLocalPreviews}
                uploadingKey={busy}
                busyPrefix="funnel-ng"
                onSelect={(i) => setFunnelPreviewKey(`notGifted:${i}`)}
                onChange={(notGifted) => setFunnel({ ...funnel, notGifted })}
                onUpload={async (i, file) => {
                  const key = `notGifted:${i}`;
                  setBusy(`funnel-ng-${i}`);
                  setError('');
                  setFunnelLocal(key, URL.createObjectURL(file));
                  try {
                    const uploaded = await uploadMedia(file);
                    const next = [...funnel.notGifted];
                    next[i] = {
                      ...next[i],
                      telegramFileId: uploaded.fileId,
                      mediaType: uploaded.mediaType,
                      imageUrl: undefined,
                    };
                    setFunnel({ ...funnel, notGifted: next });
                    setOk('Медиа загружено');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                  } finally {
                    setBusy('');
                  }
                }}
                onClearMedia={(i) => {
                  setFunnelLocal(`notGifted:${i}`);
                  const next = [...funnel.notGifted];
                  next[i] = {
                    ...next[i],
                    telegramFileId: undefined,
                    mediaType: undefined,
                    imageUrl: undefined,
                  };
                  setFunnel({ ...funnel, notGifted: next });
                }}
              />

              <Button variant="outline" onClick={saveCampaign} disabled={busy === 'save'}>
                {busy === 'save' ? '…' : 'Сохранить сообщения бота'}
              </Button>
            </div>

            <div className="self-start lg:sticky lg:top-4">
              <p className="mb-2 text-xs font-medium text-muted-foreground">
                Как это увидит человек в Telegram
              </p>
              <TelegramPreview
                botName={botPreviewName}
                text={activeFunnelPreview.text}
                mediaType={activeFunnelPreview.mediaType}
                mediaUrl={activeFunnelPreview.mediaUrl}
                mediaPlaceholder={
                  Boolean(activeFunnelPreview.hasFileId) && !activeFunnelPreview.mediaUrl
                }
                buttonLabel={activeFunnelPreview.buttonLabel}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Subscribers */}
      <Card>
        <CardHeader>
          <CardTitle>Подписчики и переписка</CardTitle>
        </CardHeader>
        <CardContent>
          {subscribers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока никто не запускал бота.</p>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Имя</th>
                      <th className="pb-2 pr-3 font-medium">Username</th>
                      <th className="pb-2 pr-3 font-medium">Подарок</th>
                      <th className="pb-2 font-medium" />
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.map((s) => (
                      <tr key={s.id} className="border-t border-border">
                        <td className="py-2.5 pr-3">{s.firstName || '—'}</td>
                        <td className="py-2.5 pr-3">{s.username ? `@${s.username}` : s.telegramId}</td>
                        <td className="py-2.5 pr-3">{s.giftDelivered ? 'да' : 'нет'}</td>
                        <td className="py-2.5">
                          <Button size="sm" variant="outline" onClick={() => openChat(s.id)}>
                            Чат
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {activeChatId && (
                <div className="space-y-3">
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border border-border bg-secondary/50 p-3">
                    {chatMessages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Сообщений нет</p>
                    ) : (
                      chatMessages.map((m) => (
                        <p key={m.id} className="text-sm">
                          <strong>
                            {m.role === 'user' ? 'Клиент' : m.role === 'operator' ? 'Оператор' : 'Бот'}:
                          </strong>{' '}
                          {m.content}
                        </p>
                      ))
                    )}
                  </div>
                  <Textarea
                    rows={3}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Ответ через gift-бота"
                  />
                  <Button variant="outline" onClick={sendReply} disabled={busy === 'reply' || !replyText.trim()}>
                    {busy === 'reply' ? '…' : 'Отправить'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}

function PreviewChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-[color,background-color,border-color,transform] duration-[var(--duration-fast)] active:scale-[0.98] ${
        active
          ? 'border-foreground/40 bg-foreground text-background'
          : 'border-border bg-card text-muted-foreground hover:border-foreground/20 hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

function MediaPicker({
  label,
  accept,
  busy,
  hasFile,
  fileHint,
  onPick,
  onClear,
}: {
  label?: string;
  accept: string;
  busy?: boolean;
  hasFile: boolean;
  fileHint?: string;
  onPick: (file: File) => void | Promise<void>;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5" onClick={(e) => e.stopPropagation()}>
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
          {busy ? 'Загрузка…' : 'Выбрать файл'}
        </Button>
        {hasFile && (
          <Button type="button" variant="ghost" size="sm" onClick={onClear} disabled={Boolean(busy)}>
            <Trash2 className="h-4 w-4" /> Убрать
          </Button>
        )}
      </div>
      {fileHint && <p className="text-xs text-muted-foreground">{fileHint}</p>}
      {!fileHint && !hasFile && (
        <p className="text-xs text-muted-foreground">С компьютера или телефона → Telegram file_id</p>
      )}
    </div>
  );
}

function MessageList({
  title,
  hint,
  messages,
  onChange,
  previewBucket,
  activeKey,
  localPreviews,
  uploadingKey,
  busyPrefix,
  onSelect,
  onUpload,
  onClearMedia,
}: {
  title: string;
  hint?: string;
  messages: GiftFunnelMessage[];
  onChange: (m: GiftFunnelMessage[]) => void;
  previewBucket: 'notSubscribed' | 'afterGift' | 'notGifted';
  activeKey: FunnelPreviewKey;
  localPreviews: Record<string, string>;
  uploadingKey: string;
  busyPrefix: string;
  onSelect: (index: number) => void;
  onUpload: (index: number, file: File) => void | Promise<void>;
  onClearMedia: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label>{title}</Label>
          {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onChange([...messages, { delayMinutes: 10, text: 'Новое сообщение' }])}
        >
          + ещё напоминание
        </Button>
      </div>
      {messages.map((m, i) => {
        const key = `${previewBucket}:${i}` as FunnelPreviewKey;
        const active = activeKey === key;
        return (
          <div
            key={i}
            className={`space-y-2 rounded-lg border p-3 ${active ? 'border-foreground/30' : 'border-border/60'}`}
            onFocusCapture={() => onSelect(i)}
            onClick={() => onSelect(i)}
          >
            <div className="grid grid-cols-[auto_1fr_auto] items-start gap-2">
              <div className="w-[92px]">
                <p className="mb-1 text-[11px] text-muted-foreground">Через мин.</p>
                <Input
                  type="number"
                  min={0}
                  value={m.delayMinutes}
                  onChange={(e) => {
                    const next = [...messages];
                    next[i] = { ...m, delayMinutes: Number(e.target.value) };
                    onChange(next);
                  }}
                  title="Через сколько минут отправить"
                />
              </div>
              <div>
                <p className="mb-1 text-[11px] text-muted-foreground">Текст сообщения</p>
                <Textarea
                  rows={2}
                  value={m.text}
                  onChange={(e) => {
                    const next = [...messages];
                    next[i] = { ...m, text: e.target.value };
                    onChange(next);
                  }}
                />
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="mt-5"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(messages.filter((_, idx) => idx !== i));
                }}
                title="Удалить"
              >
                ✕
              </Button>
            </div>
            <MediaPicker
              accept="image/*,video/*"
              busy={uploadingKey === `${busyPrefix}-${i}`}
              hasFile={Boolean(m.telegramFileId || localPreviews[key] || m.imageUrl)}
              fileHint={m.telegramFileId ? 'Файл в Telegram' : undefined}
              onPick={(file) => onUpload(i, file)}
              onClear={() => onClearMedia(i)}
            />
          </div>
        );
      })}
    </div>
  );
}
