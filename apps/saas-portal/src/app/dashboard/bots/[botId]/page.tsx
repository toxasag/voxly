'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { selectClassName } from '@/lib/utils';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, Megaphone, Trash2, Upload } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { uploadBotMedia } from '@/lib/upload-bot-media';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { ProjectPicker } from '@/components/portal/project-picker';
import { GiftBotDetailHero } from '@/components/portal/gift-bot-detail-hero';
import { PartnerBalanceApply } from '@/components/portal/partner-balance-apply';
import { usePartnerBalanceApply } from '@/hooks/use-partner-balance-apply';
import {
  GIFT_MEDIA_FILE_ACCEPT,
  TELEGRAM_CLIENT_MD_RMB_HINT,
  detectStoredMediaKind,
  normalizeGiftMediaType,
  type GiftPromoMediaType,
} from '@voxly/shared';
import { TelegramPreview } from '@/components/telegram-preview';
import { BotGreetingPreview } from '@/components/portal/bot-greeting-preview';
import { TG_PREVIEW_LABEL } from '@/components/portal/telegram-preview-chrome';
import { TelegramMdTextarea } from '@/components/portal/telegram-md-textarea';
import { InputWithEmoji } from '@/components/portal/input-with-emoji';
import { EmojiPickerPanel } from '@/components/portal/emoji-picker';
import { fileToJpegFile } from '@/lib/to-jpeg';

const LAND_SECTION =
  'rounded-2xl border border-black/10 bg-white p-5 sm:p-6 shadow-none';
const LAND_SECTION_CREAM =
  'rounded-2xl border border-black/10 bg-[#faf8f5] p-5 sm:p-6 shadow-none';
const LAND_TITLE = 'land-display text-xl tracking-[-0.03em] text-black';
const LAND_DESC = 'text-sm leading-snug text-black/55';
const BTN_PRIMARY =
  'land-btn inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50';
const BTN_GHOST =
  'land-btn-ghost inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50';
const BTN_AMBER =
  'land-btn-amber inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50';
const BTN_GHOST_SM =
  'land-btn-ghost inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50';

function botDescCardStorageKey(id: string) {
  return `voxly_bot_desc_card_${id}`;
}

type GiftAddonState = {
  isActive: boolean;
  isTrial: boolean;
  trialAvailable?: boolean;
  activeUntil: string | null;
};

interface GiftExtraButton {
  text: string;
  url: string;
}

interface GiftFunnelMessage {
  delayMinutes: number;
  text: string;
  imageUrl?: string;
  telegramFileId?: string;
  mediaType?: GiftPromoMediaType;
  extraButtons?: GiftExtraButton[];
}

interface GiftFunnelConfig {
  start: {
    text: string;
    imageUrl?: string;
    telegramFileId?: string;
    mediaType?: GiftPromoMediaType;
    extraButtons?: GiftExtraButton[];
  };
  notSubscribed: GiftFunnelMessage[];
  gift: {
    type: 'file' | 'link' | 'video';
    url: string;
    telegramFileId?: string;
    mediaType?: GiftPromoMediaType;
    caption?: string;
    extraButtons?: GiftExtraButton[];
  };
  afterGift: GiftFunnelMessage[];
  notGifted: GiftFunnelMessage[];
  subscribeButton?: { confirmLabel?: string };
}

interface GiftPromoPost {
  text: string;
  mediaType?: GiftPromoMediaType;
  telegramFileId?: string;
  telegramFileUniqueId?: string;
  mediaUrl?: string;
  imageUrl?: string;
  buttonText: string;
  clickCount: number;
  /** Default true — omit « · N» when false */
  showClickCounter?: boolean;
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
  displayName?: string | null;
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
  showClickCounter: true,
};

/** Keep complete http(s) rows only — incomplete drafts are ignored on save */
function sanitizeExtraButtons(buttons?: GiftExtraButton[]): GiftExtraButton[] | undefined {
  if (!buttons?.length) return undefined;
  const cleaned = buttons
    .map((b) => ({ text: (b.text || '').trim(), url: (b.url || '').trim() }))
    .filter((b) => b.text.length > 0 && /^https?:\/\//i.test(b.url));
  return cleaned.length ? cleaned : undefined;
}

function sanitizeFunnelExtraButtons(funnel: GiftFunnelConfig): GiftFunnelConfig {
  const mapMsg = (m: GiftFunnelMessage): GiftFunnelMessage => {
    const extraButtons = sanitizeExtraButtons(m.extraButtons);
    if (extraButtons) return { ...m, extraButtons };
    const { extraButtons: _drop, ...rest } = m;
    return rest;
  };
  const startExtra = sanitizeExtraButtons(funnel.start.extraButtons);
  const giftExtra = sanitizeExtraButtons(funnel.gift.extraButtons);
  const start = startExtra
    ? { ...funnel.start, extraButtons: startExtra }
    : (() => {
        const { extraButtons: _drop, ...rest } = funnel.start;
        return rest;
      })();
  const gift = giftExtra
    ? { ...funnel.gift, extraButtons: giftExtra }
    : (() => {
        const { extraButtons: _drop, ...rest } = funnel.gift;
        return rest;
      })();
  return {
    ...funnel,
    start,
    gift,
    notSubscribed: funnel.notSubscribed.map(mapMsg),
    afterGift: funnel.afterGift.map(mapMsg),
    notGifted: funnel.notGifted.map(mapMsg),
  };
}

function extraButtonsToLinkPreview(
  buttons?: GiftExtraButton[],
): Array<{ label: string; href?: string }> {
  return (sanitizeExtraButtons(buttons) || []).map((b) => ({ label: b.text, href: b.url }));
}

function normalizePromo(p?: GiftPromoPost | null): GiftPromoPost {
  const base = p || DEFAULT_PROMO;
  return {
    ...DEFAULT_PROMO,
    ...base,
    mediaType: normalizeGiftMediaType(base.mediaType) || 'photo',
    telegramFileId: base.telegramFileId || undefined,
    telegramFileUniqueId: base.telegramFileUniqueId || undefined,
    mediaUrl: base.telegramFileId ? undefined : base.mediaUrl || base.imageUrl || undefined,
    showClickCounter: base.showClickCounter !== false,
  };
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
  const [promoAsVideoNote, setPromoAsVideoNote] = useState(false);
  const [botDescription, setBotDescription] = useState('');
  const [botShortDescription, setBotShortDescription] = useState('');
  const [botDisplayName, setBotDisplayName] = useState('');
  const [botAvatarUrl, setBotAvatarUrl] = useState<string | null>(null);
  const [botAvatarObjectUrl, setBotAvatarObjectUrl] = useState<string | null>(null);
  /** Description-card media (before Start) — separate from profile photo; BotFather-only in TG. */
  const [botCardPhotoObjectUrl, setBotCardPhotoObjectUrl] = useState<string | null>(null);
  const [greetingEmojiTarget, setGreetingEmojiTarget] = useState<'name' | 'description' | 'short'>(
    'description',
  );
  const [funnelLocalPreviews, setFunnelLocalPreviews] = useState<Record<string, string>>({});
  const [funnelPreviewKey, setFunnelPreviewKey] = useState<FunnelPreviewKey>('start');
  const [subscribers, setSubscribers] = useState<any[]>([]);
  const [giftAddon, setGiftAddon] = useState<GiftAddonState | null>(null);
  const [giftPrice, setGiftPrice] = useState(500);
  const [giftBotSlots, setGiftBotSlots] = useState(1);
  const [giftProductCode, setGiftProductCode] = useState<'gift_bot' | 'gift_bot_max'>(
    'gift_bot',
  );
  const renewTotal = Math.max(1, giftBotSlots) * giftPrice;
  const balanceApply = usePartnerBalanceApply(renewTotal);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<
    { id: string; role: string; content: string; sentAt: string }[]
  >([]);
  const [replyText, setReplyText] = useState('');
  /** Live upload bar: which busy-key + percent/phase */
  const [uploadProgress, setUploadProgress] = useState<{
    key: string;
    percent: number;
    phase: 'upload' | 'processing';
  } | null>(null);
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
      const isMaxRow = row.botType === 'gift_max';
      setGiftProductCode(isMaxRow ? 'gift_bot_max' : 'gift_bot');
      setGiftAddon(
        isMaxRow ? (json.giftMaxAddon ?? null) : (json.giftAddon ?? null),
      );
      if (isMaxRow) {
        if (typeof json.giftMaxBotPriceMonthly === 'number') {
          setGiftPrice(json.giftMaxBotPriceMonthly);
        }
        if (typeof json.giftMaxBotSlots === 'number' && json.giftMaxBotSlots > 0) {
          setGiftBotSlots(json.giftMaxBotSlots);
        }
      } else {
        if (typeof json.giftBotPriceMonthly === 'number') {
          setGiftPrice(json.giftBotPriceMonthly);
        }
        if (typeof json.giftBotSlots === 'number' && json.giftBotSlots > 0) {
          setGiftBotSlots(json.giftBotSlots);
        }
      }
      if (refreshForm) {
        setBotDescription(row.telegramDescription || '');
        setBotShortDescription(row.telegramShortDescription || '');
        setBotDisplayName(row.displayName || '');
        if (row.botType !== 'gift_max') {
          void (async () => {
            try {
              const profileRes = await fetch(`/api/bots/${botId}/telegram-profile`, {
                headers: authHeaders(),
              });
              if (!profileRes.ok) return;
              const profile = (await profileRes.json()) as {
                name?: string;
                description?: string;
                shortDescription?: string;
                hasProfilePhoto?: boolean;
                avatarUrl?: string | null;
              };
              if (profile.name != null) setBotDisplayName(profile.name);
              if (profile.description != null) setBotDescription(profile.description);
              if (profile.shortDescription != null) {
                setBotShortDescription(profile.shortDescription);
              }
              if (profile.hasProfilePhoto && profile.avatarUrl) {
                const token = localStorage.getItem('voxly_token');
                if (!token) return;
                const imgRes = await fetch(profile.avatarUrl, {
                  headers: { Authorization: `Bearer ${token}` },
                });
                if (!imgRes.ok) return;
                const blob = await imgRes.blob();
                setBotAvatarObjectUrl((prev) => {
                  if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
                  return URL.createObjectURL(blob);
                });
                setBotAvatarUrl(profile.avatarUrl);
              } else {
                setBotAvatarUrl(null);
                setBotAvatarObjectUrl((prev) => {
                  if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
                  return null;
                });
              }
            } catch {
              /* keep DB fields */
            }
          })();
        }
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

  useEffect(() => {
    try {
      const stored = localStorage.getItem(botDescCardStorageKey(botId));
      setBotCardPhotoObjectUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return stored?.startsWith('data:image/') ? stored : null;
      });
    } catch {
      setBotCardPhotoObjectUrl(null);
    }
  }, [botId]);

  const promoButtonLabel = useMemo(() => {
    const base = promo.buttonText || 'Получить подарок';
    if (promo.showClickCounter === false) return base;
    return `${base} · ${promo.clickCount || 0}`;
  }, [promo.buttonText, promo.clickCount, promo.showClickCounter]);

  const subscribeLabel = funnel?.subscribeButton?.confirmLabel || 'Я подписался ✅';
  const botPreviewName = bot?.botUsername ? `@${bot.botUsername}` : undefined;
  const isMaxGift = bot?.botType === 'gift_max';

  const channelReady =
    isMaxGift || Boolean(channelId && channelId !== 'pending');
  const startReady = Boolean(funnel?.start?.text?.trim());
  const giftReady = Boolean(
    funnel &&
      (funnel.gift.telegramFileId ||
        (funnel.gift.type === 'link' && funnel.gift.url) ||
        (funnel.gift.url && /^https?:\/\//i.test(funnel.gift.url))),
  );
  const promoPublished = isMaxGift || Boolean(promo.publishedAt);
  const hasSubscribers = subscribers.length > 0;
  const setupSteps: { id: string; label: string; done: boolean }[] = isMaxGift
    ? [
        { id: 'section-start', label: 'Пост после старта', done: startReady },
        { id: 'section-funnel', label: 'Подарок задан', done: giftReady },
        { id: 'section-subs', label: 'Есть диалоги', done: hasSubscribers },
      ]
    : [
        { id: 'section-channel', label: 'Бот в канале', done: channelReady },
        { id: 'section-promo', label: 'Пост об акции', done: promoPublished },
        { id: 'section-start', label: 'Пост после старта', done: startReady },
        { id: 'section-funnel', label: 'Подарок задан', done: giftReady },
        { id: 'section-subs', label: 'Есть подписчики', done: hasSubscribers },
      ];
  const nextStep = setupSteps.find((s) => !s.done) ?? null;
  const trialAvailable = giftAddon?.trialAvailable ?? giftAddon == null;
  const subActive = Boolean(giftAddon?.isActive);
  const isTrial = Boolean(subActive && giftAddon?.isTrial);

  const payGift = async () => {
    setBusy('pay');
    setError('');
    try {
      const active = Boolean(giftAddon?.isActive);
      await startCheckout({
        productCode: giftProductCode,
        periodMonths: 1,
        quantity: active ? Math.max(1, giftBotSlots) : 1,
        intent: active ? 'renew' : 'add',
        ...balanceApply.applyBalancePayload,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setBusy('');
    }
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const setFunnelLocal = (key: string, url?: string) => {
    setFunnelLocalPreviews((prev) => {
      const next = { ...prev };
      if (prev[key]?.startsWith('blob:')) URL.revokeObjectURL(prev[key]);
      if (url) next[key] = url;
      else delete next[key];
      return next;
    });
  };

  const uploadMedia = async (
    file: File,
    progressKey: string,
    opts?: { asVideoNote?: boolean },
  ) => {
    setUploadProgress({ key: progressKey, percent: 0, phase: 'upload' });
    try {
      return await uploadBotMedia({
        botId,
        file,
        campaignId: campaignId || undefined,
        asVideoNote: opts?.asVideoNote,
        token: typeof window !== 'undefined' ? localStorage.getItem('voxly_token') : null,
        onProgress: (p) =>
          setUploadProgress({ key: progressKey, percent: p.percent, phase: p.phase }),
      });
    } finally {
      setUploadProgress((prev) => (prev?.key === progressKey ? null : prev));
    }
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
      const funnelToSave = sanitizeFunnelExtraButtons(funnel);
      const res = await fetch(`/api/bots/${botId}/campaign`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          campaignId: campaignId || undefined,
          name: projectName.trim() || 'Проект',
          channelUsername,
          channelId: channelId || undefined,
          giftFileUrl: funnelToSave.gift.url || undefined,
          funnel: funnelToSave,
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
      setFunnel(funnelToSave);
      const giftReady = Boolean(
        funnelToSave.gift.telegramFileId
        || (funnelToSave.gift.type === 'link' && funnelToSave.gift.url)
        || (funnelToSave.gift.url && /^https?:\/\//i.test(funnelToSave.gift.url)),
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
          name: botDisplayName.trim(),
          description: botDescription,
          shortDescription: botShortDescription || botDescription.slice(0, 120),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(formatApiError(json.error) || 'Не сохранено');
      setBotDescription(json.telegramDescription || botDescription);
      setBotShortDescription(json.telegramShortDescription || botShortDescription);
      setBotDisplayName(json.name || json.displayName || botDisplayName);
      setBot((prev) =>
        prev
          ? {
              ...prev,
              displayName: json.name || json.displayName || prev.displayName,
              telegramDescription: json.telegramDescription,
              telegramShortDescription: json.telegramShortDescription,
            }
          : prev,
      );
      setOk('Приветствие сохранено в Telegram');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const uploadBotAvatar = async (file: File) => {
    setBusy('bot-avatar');
    setError('');
    setOk('');
    const localUrl = URL.createObjectURL(file);
    setBotAvatarObjectUrl((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return localUrl;
    });
    try {
      const token = localStorage.getItem('voxly_token');
      if (!token) throw new Error('Войдите заново');
      // Telegram static profile photo = JPG only; convert PNG/WebP in browser.
      const jpeg = await fileToJpegFile(file);
      const fd = new FormData();
      fd.append('file', jpeg);
      const res = await fetch(`/api/bots/${botId}/telegram-profile/photo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(json.error) || 'Не удалось загрузить фото');
      setBotAvatarUrl(json.avatarUrl || null);
      setOk('Фото профиля обновлено в Telegram');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки фото');
      setBotAvatarObjectUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
    } finally {
      setBusy('');
    }
  };

  const removeBotAvatar = async () => {
    setBusy('bot-avatar');
    setError('');
    setOk('');
    try {
      const res = await fetch(`/api/bots/${botId}/telegram-profile/photo`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatApiError(json.error) || 'Не удалось удалить фото');
      setBotAvatarUrl(null);
      setBotAvatarObjectUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
      setOk('Фото профиля удалено');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const setBotCardPhotoFile = async (file: File) => {
    setError('');
    setOk('');
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.readAsDataURL(file);
      });
      if (!dataUrl.startsWith('data:image/')) throw new Error('Нужен файл изображения');
      try {
        localStorage.setItem(botDescCardStorageKey(botId), dataUrl);
      } catch {
        /* quota — preview still works this session */
      }
      setBotCardPhotoObjectUrl((prev) => {
        if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
        return dataUrl;
      });
      setOk('Фото карточки обновлено в превью');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    }
  };

  const removeBotCardPhoto = () => {
    try {
      localStorage.removeItem(botDescCardStorageKey(botId));
    } catch {
      /* ignore */
    }
    setBotCardPhotoObjectUrl((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
      return null;
    });
    setOk('Фото карточки убрано из превью');
  };

  const insertGreetingEmoji = (emoji: string) => {
    if (greetingEmojiTarget === 'name') {
      setBotDisplayName((prev) => (prev + emoji).slice(0, 64));
      return;
    }
    if (greetingEmojiTarget === 'short') {
      setBotShortDescription((prev) => (prev + emoji).slice(0, 120));
      return;
    }
    setBotDescription((prev) => (prev + emoji).slice(0, 512));
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
          mediaType: normalizeGiftMediaType(promo.mediaType) || 'photo',
          telegramFileId: promo.telegramFileId || '',
          telegramFileUniqueId: promo.telegramFileUniqueId || '',
          mediaUrl: promo.telegramFileId ? '' : promo.mediaUrl || '',
          buttonText: promo.buttonText,
          showClickCounter: promo.showClickCounter !== false,
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
          mediaType: normalizeGiftMediaType(promo.mediaType) || 'photo',
          telegramFileId: promo.telegramFileId || '',
          telegramFileUniqueId: promo.telegramFileUniqueId || '',
          mediaUrl: promo.telegramFileId ? '' : promo.mediaUrl || '',
          buttonText: promo.buttonText,
          showClickCounter: promo.showClickCounter !== false,
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

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState />
      </AppShell>
    );
  }

  if (!bot || !funnel) {
    return (
      <AppShell maxWidth="3xl">
        <Alert variant="error">{error || 'Бот не найден'}</Alert>
        <Link
          href={isMaxGift ? '/dashboard/bots/max' : '/dashboard/bots'}
          className={`${BTN_GHOST} mt-4`}
        >
          ← К списку
        </Link>
      </AppShell>
    );
  }

  const giftedCount = subscribers.filter((s) => s.giftDelivered).length;
  const promoClicks = promo.clickCount || 0;
  const channelLabel = isMaxGift
    ? bot.botUsername
      ? `MAX · @${bot.botUsername}`
      : 'MAX · бот подарков'
    : channelUsername
      ? `Канал @${channelUsername.replace(/^@/, '')}`
      : 'Канал ещё не привязан';

  let heroStateLabel = nextStep?.label ?? 'Воронка готова';
  let heroStateTone: 'connected' | 'pending' | 'off' = nextStep ? 'pending' : 'connected';
  let heroStateHint = nextStep
    ? isMaxGift
      ? 'Настройте шаг ниже — затем напишите боту в MAX (/start).'
      : 'Настройте шаг ниже — после этого можно вести трафик в пост канала.'
    : isMaxGift
      ? 'Воронка готова. Пользователь жмёт «Продолжить» в MAX — подарок уходит без жёсткой проверки канала.'
      : 'Пост в канале и бот настроены. Ведите аудиторию на кнопку «Получить подарок».';
  let heroActionLabel = nextStep ? 'Перейти к шагу' : isMaxGift ? 'К подписчикам' : 'Открыть пост';
  let heroOnAction = () => {
    if (nextStep) scrollToSection(nextStep.id);
    else scrollToSection(isMaxGift ? 'section-subs' : 'section-promo');
  };
  let heroSecondary: string | undefined;
  let heroSecondaryAction: (() => void) | undefined;
  let heroFooterLabel = 'Тариф';
  let heroFooterValue = subActive
    ? isTrial
      ? `trial · ${giftAddon?.activeUntil ? new Date(giftAddon.activeUntil).toLocaleDateString('ru-RU') : '—'}`
      : `до ${giftAddon?.activeUntil ? new Date(giftAddon.activeUntil).toLocaleDateString('ru-RU') : '—'}`
    : 'выкл';

  if (!subActive) {
    heroStateLabel = trialAvailable ? 'Нужен тариф или trial' : 'Тариф выключен';
    heroStateTone = 'off';
    heroStateHint = trialAvailable
      ? 'Активируйте пробный период на странице списка ботов или оплатите 1 бота.'
      : `Оформите ${giftPrice} ₽/мес за бота — на оплате можно списать партнёрский баланс.`;
    heroActionLabel = busy === 'pay' ? 'Переходим…' : `Оплатить ${giftPrice} ₽`;
    heroOnAction = () => void payGift();
    heroSecondary = 'К списку ботов';
    heroSecondaryAction = () =>
      router.push(isMaxGift ? '/dashboard/bots/max' : '/dashboard/bots');
  } else if (isTrial) {
    heroSecondary = busy === 'pay' ? 'Переходим…' : `Оплатить ${renewTotal} ₽`;
    heroSecondaryAction = () => void payGift();
    if (!nextStep) {
      heroStateHint =
        'Воронка готова. Пробный период ограничен — оплатите, чтобы не потерять приём лидов.';
    }
  }

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
      <GiftBotDetailHero
        botUsername={bot.botUsername || 'бот'}
        channelLabel={channelLabel}
        projectName={projectName}
        facts={[
          { label: 'Подписчики', value: String(subscribers.length) },
          { label: 'Получили подарок', value: String(giftedCount) },
          { label: 'Клики по посту', value: String(promoClicks) },
        ]}
        stateLabel={heroStateLabel}
        stateTone={heroStateTone}
        stateHint={heroStateHint}
        actionLabel={heroActionLabel}
        onAction={heroOnAction}
        actionDisabled={busy === 'pay'}
        secondaryActionLabel={heroSecondary}
        onSecondaryAction={heroSecondaryAction}
        botLink={bot.botLink}
        footerLabel={heroFooterLabel}
        footerValue={heroFooterValue}
      />

      {error ? (
        <Alert
          variant="error"
          className="border-[#c2410c]/35 bg-[#fff8ec] text-[#9a3412] animate-error"
        >
          {error}
        </Alert>
      ) : null}
      {ok ? (
        <Alert variant="success" className="border-[#166534]/25 bg-[#f0fdf4] text-[#166534]">
          {ok}
        </Alert>
      ) : null}

      {!subActive && balanceApply.availableRub > 0 ? (
        <section className={LAND_SECTION}>
          <h2 className={LAND_TITLE}>Оплата тарифа</h2>
          <p className={`mt-1 ${LAND_DESC}`}>
            Отметьте «Зачесть партнёрский баланс» перед оплатой — по умолчанию выключено.
          </p>
          <div className="mt-4 max-w-md">
            <PartnerBalanceApply
              availableRub={balanceApply.availableRub}
              invoiceRub={giftPrice}
              useBalance={balanceApply.useBalance}
              onUseBalanceChange={balanceApply.setUseBalance}
              balanceInput={balanceApply.balanceInput}
              onBalanceInputChange={balanceApply.setBalanceInput}
              appliedRub={balanceApply.appliedRub}
              netRub={balanceApply.netRub}
              disabled={busy === 'pay'}
              idPrefix="gift-bot-detail-balance"
            />
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 rounded-2xl border border-[#f5a623]/35 bg-[#fff8ec] p-5 sm:grid-cols-3">
        {(isMaxGift
          ? [
              {
                n: '1',
                title: 'Стартовое сообщение',
                text: 'Текст после bot_started в MAX и кнопка «Продолжить» (без жёсткой проверки канала).',
              },
              {
                n: '2',
                title: 'Подарок и follow-up',
                text: 'Сам подарок, напоминания и сообщения после выдачи. Превью ориентировочное.',
              },
              {
                n: '3',
                title: 'Диалоги',
                text: 'Пользователи пишут боту в MAX — список и чат CRM появятся в блоке ниже.',
              },
            ]
          : [
              {
                n: '1',
                title: 'Привяжите канал',
                text: 'Добавьте бота админом канала и проверьте @username — без этого подарок не выдаётся.',
              },
              {
                n: '2',
                title: 'Настройте сообщения',
                text: 'Старт после /start, сам подарок и напоминания. Справа всегда видно превью Telegram.',
              },
              {
                n: '3',
                title: 'Опубликуйте пост',
                text: 'Кнопка в канале ведёт в бота. Клики и подписчики появятся в блоке ниже.',
              },
            ]
        ).map((step) => (
          <div key={step.n} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-xs font-bold text-black">
              {step.n}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-black">{step.title}</p>
              <p className="mt-1 text-sm leading-snug text-black/55">{step.text}</p>
            </div>
          </div>
        ))}
      </section>

      <section className={LAND_SECTION_CREAM}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className={LAND_TITLE}>Готовность воронки</h2>
            <p className="mt-1 text-sm text-black/55">
              {nextStep
                ? `Сейчас важно: ${nextStep.label.toLowerCase()}`
                : 'Все шаги закрыты — можно гнать трафик'}
            </p>
          </div>
          <Link
            href="/dashboard/mailing/bot"
            className="land-btn-ghost inline-flex min-h-10 items-center gap-2 px-4 text-sm"
          >
            <Megaphone className="h-4 w-4" aria-hidden /> Рассылки
          </Link>
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {setupSteps.map((step, i) => (
            <li key={step.id}>
              <button
                type="button"
                onClick={() => scrollToSection(step.id)}
                className={`flex min-h-[72px] w-full cursor-pointer flex-col rounded-xl border px-3 py-3 text-left transition-colors ${
                  step.done
                    ? 'border-black/10 bg-[#faf8f5]'
                    : nextStep?.id === step.id
                      ? 'border-[#f5a623] bg-[#fff8ec]'
                      : 'border-black/10 bg-white hover:border-black/25'
                }`}
              >
                <span className="font-mono text-[11px] font-semibold text-black/40">
                  {step.done ? '✓' : i + 1}
                </span>
                <span className="mt-1 text-sm font-semibold text-black">{step.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      {/* Projects / campaigns — only one active at a time */}
      <section id="section-projects" className={LAND_SECTION}>
        <h2 className={LAND_TITLE}>Проекты</h2>
        <p className={`mt-1 ${LAND_DESC}`}>
          Несколько акций на одном боте. Одновременно активен только один. Можно задать расписание
            старта/стопа (день 1 / день 2…). Клик по карточке — редактирование; переключатель —
            вручную вкл/выкл.
        </p>
        <div className="mt-4">
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
        </div>
      </section>

      {/* 1. Channel — Telegram only; MAX uses soft membership (ADR-025 gap) */}
      {isMaxGift ? (
        <section id="section-channel" className={LAND_SECTION}>
          <h2 className={LAND_TITLE}>Платформа · MAX</h2>
          <p className={`mt-1 ${LAND_DESC}`}>
            Официальный Bot API (`platform-api2.max.ru`). Проверка подписки на канал как в Telegram
              пока недоступна: после старта пользователь жмёт «Продолжить» и получает подарок.
          </p>
          <div className="mt-4 space-y-2 text-sm text-black/65">
            <p>
              Бот: <span className="font-semibold text-black">@{bot.botUsername || '…'}</span>
            </p>
            <p>
              Настройте стартовый текст и подарок ниже. Локально нужен{' '}
              <code className="font-mono text-xs">GIFT_MAX_USE_POLLING=true</code>; на prod —
              HTTPS webhook <code className="font-mono text-xs">/max/…</code>.
            </p>
          </div>
        </section>
      ) : (
        <section id="section-channel" className={LAND_SECTION}>
          <h2 className={LAND_TITLE}>1 шаг: Добавьте бота в канал</h2>
          <p className={`mt-1 ${LAND_DESC}`}>
            Добавьте @{bot.botUsername} админом канала или супергруппы (права: видеть участников и
              публиковать сообщения). Укажите публичный @username — не название чата и не invite-ссылку
              t.me/+…
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <Label>Username канала</Label>
              <Input
                className="mt-1.5"
                value={channelUsername}
                onChange={(e) => setChannelUsername(e.target.value)}
                placeholder="@my_channel"
              />
            </div>
            <button
              type="button"
              className={BTN_GHOST}
              onClick={verifyChannel}
              disabled={busy === 'verify' || !channelUsername}
            >
              {busy === 'verify' ? '…' : 'Проверить админа'}
            </button>
            {channelId ? (
              <p className="text-sm font-semibold text-[#166534]">
                Канал привязан · id {channelId}
                {channelUsername ? ` · ${channelUsername}` : ''}
              </p>
            ) : (
              <p className="text-xs text-black/45">
                После проверки канал сохранится в выбранный проект автоматически.
              </p>
            )}
          </div>
        </section>
      )}

      {/* 2. Greeting — Telegram bot profile before /start */}
      {!isMaxGift ? (
      <section className={LAND_SECTION}>
        <h2 className={LAND_TITLE}>2 шаг: Настройте бота</h2>
        <p className={`mt-1 ${LAND_DESC}`}>
          Экран до «Старт»: фото профиля, фото в карточке описания, название (не @ник) и текст.
            Это не сообщение в чате — пост после старта — в шаге 4.
        </p>
        <div className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4">
              <div>
                <Label>Фото профиля</Label>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-black/10 bg-[#eef2f5]">
                    {botAvatarObjectUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={botAvatarObjectUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Upload className="h-4 w-4 text-black/35" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="land-btn-ghost inline-flex min-h-10 cursor-pointer items-center gap-2 px-3 text-sm">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                        className="hidden"
                        disabled={busy === 'bot-avatar'}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) void uploadBotAvatar(file);
                        }}
                      />
                      {busy === 'bot-avatar' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Загрузить PNG/JPG
                    </label>
                    {botAvatarObjectUrl || botAvatarUrl ? (
                      <button
                        type="button"
                        className={BTN_GHOST_SM}
                        disabled={busy === 'bot-avatar'}
                        onClick={() => void removeBotAvatar()}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Убрать
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-xs text-black/45">
                  Круглый аватар · PNG или JPG · для Telegram PNG→JPG · смена не чаще раза в сутки
                </p>
              </div>

              <div>
                <Label>Фото в карточке до «Старт»</Label>
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <div className="flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-black/10 bg-[#eef2f5]">
                    {botCardPhotoObjectUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={botCardPhotoObjectUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Upload className="h-4 w-4 text-black/35" aria-hidden />
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <label className="land-btn-ghost inline-flex min-h-10 cursor-pointer items-center gap-2 px-3 text-sm">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file) void setBotCardPhotoFile(file);
                        }}
                      />
                      <Upload className="h-4 w-4" />
                      Загрузить для превью
                    </label>
                    {botCardPhotoObjectUrl ? (
                      <button
                        type="button"
                        className={BTN_GHOST_SM}
                        onClick={removeBotCardPhoto}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Убрать
                      </button>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-xs text-black/45">
                  Отдельное фото блока «Что умеет бот» · в Telegram задаётся только через @BotFather
                  (Bot API не умеет). Здесь — превью, не путайте с аватаром.
                </p>
              </div>

              <div>
                <Label>Название бота</Label>
                <InputWithEmoji
                  showEmoji={false}
                  maxLength={64}
                  value={botDisplayName}
                  onChange={setBotDisplayName}
                  onFocus={() => setGreetingEmojiTarget('name')}
                  placeholder="Voxly Gift Bot"
                />
                <p className="mt-1 text-xs text-black/45">
                  До 64 символов · ник @{bot.botUsername || '…'} не меняется
                </p>
              </div>

              <div>
                <Label>Описание (до 512 символов)</Label>
                <TelegramMdTextarea
                  showEmoji={false}
                  rows={5}
                  value={botDescription}
                  onFocus={() => setGreetingEmojiTarget('description')}
                  onChange={(text) => {
                    if (text.length <= 512) setBotDescription(text);
                    else setBotDescription(text.slice(0, 512));
                  }}
                  placeholder={`${botDisplayName || bot.botUsername || 'Бот'} готов!\n\nНажмите Старт, чтобы получить подарок.`}
                />
                <p className="mt-1 text-xs text-black/45">{botDescription.length}/512</p>
              </div>

              <div>
                <Label>Короткое описание (до 120, опционально)</Label>
                <InputWithEmoji
                  showEmoji={false}
                  maxLength={120}
                  value={botShortDescription}
                  onChange={setBotShortDescription}
                  onFocus={() => setGreetingEmojiTarget('short')}
                  placeholder="Кратко в профиле и при шаринге"
                />
                <p className="mt-1 text-xs text-black/45">
                  {botShortDescription.length}/120 · если пусто — начало длинного текста
                </p>
              </div>

              <button
                type="button"
                className={BTN_PRIMARY}
                onClick={() => void saveBotDescription()}
                disabled={busy === 'bot-desc'}
              >
                {busy === 'bot-desc' ? '…' : 'Сохранить настройки бота'}
              </button>
            </div>

            <div>
              <p className={TG_PREVIEW_LABEL}>Превью экрана до «Старт»</p>
              <BotGreetingPreview
                name={botDisplayName || bot.displayName || 'Voxly Gift Bot'}
                description={botDescription}
                username={bot.botUsername}
                profilePhotoUrl={botAvatarObjectUrl || botAvatarUrl}
                cardPhotoUrl={botCardPhotoObjectUrl}
              />
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-medium text-black/45">Эмодзи в поле:</p>
                  {(
                    [
                      ['name', 'Название'],
                      ['description', 'Описание'],
                      ['short', 'Короткое'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      className={
                        greetingEmojiTarget === key
                          ? 'rounded-md bg-black/8 px-2 py-1 text-[11px] font-medium text-black'
                          : 'rounded-md px-2 py-1 text-[11px] font-medium text-black/45 hover:bg-black/[0.04]'
                      }
                      onClick={() => setGreetingEmojiTarget(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <EmojiPickerPanel onPick={insertGreetingEmoji} />
              </div>
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {/* 3. Promo post (Telegram only) */}
      {!isMaxGift ? (
      <section id="section-promo" className={LAND_SECTION}>
        <h2 className={LAND_TITLE}>3 шаг: Опубликуйте пост об акции в канал</h2>
        <p className={`mt-1 ${LAND_DESC}`}>
          Картинка или видео + текст + кнопка. Файл загружается в Telegram (file_id), хостинг не нужен.
        </p>
        <div className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <div>
                <Label>Текст</Label>
                <p className="mt-0.5 text-xs text-black/45">{TELEGRAM_CLIENT_MD_RMB_HINT}</p>
                <TelegramMdTextarea
                  rows={6}
                  value={promo.text}
                  onChange={(text) => setPromo({ ...promo, text })}
                />
              </div>
              <MediaPicker
                label="Медиа"
                accept={GIFT_MEDIA_FILE_ACCEPT}
                busy={busy === 'promo-media'}
                progressPercent={uploadProgress?.key === 'promo-media' ? uploadProgress.percent : null}
                progressPhase={uploadProgress?.key === 'promo-media' ? uploadProgress.phase : null}
                hasFile={Boolean(promo.telegramFileId || promoLocalPreview || promo.mediaUrl)}
                fileHint={
                  promo.telegramFileId
                    ? `Файл сохранён в Telegram · ${normalizeGiftMediaType(promo.mediaType) || 'файл'}`
                    : promo.mediaUrl
                      ? 'Старый URL (лучше загрузить файл)'
                      : 'Фото, видео, PDF/DOC/XLS, голосовые (OGG), аудио. Кружочек — галочка ниже.'
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
                    const uploaded = await uploadMedia(file, 'promo-media', {
                      asVideoNote: promoAsVideoNote,
                    });
                    setPromo((prev) => ({
                      ...prev,
                      mediaType: uploaded.mediaType,
                      telegramFileId: uploaded.fileId,
                      telegramFileUniqueId: uploaded.fileUniqueId,
                      mediaUrl: undefined,
                    }));
                    setOk('Медиа загружено в Telegram');
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                    setPromoLocalPreview((prev) => {
                      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
                      return undefined;
                    });
                  } finally {
                    setBusy('');
                  }
                }}
                onClear={() => {
                  setPromoLocalPreview((prev) => {
                    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
                    return undefined;
                  });
                  setPromo((prev) => ({
                    ...prev,
                    telegramFileId: undefined,
                    telegramFileUniqueId: undefined,
                    mediaUrl: undefined,
                    mediaType: 'photo',
                  }));
                }}
              />
              <label className="flex items-start gap-2 text-sm text-black/70">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={promoAsVideoNote}
                  onChange={(e) => setPromoAsVideoNote(e.target.checked)}
                />
                <span>
                  Загрузить видео как кружочек (video note). MP4 до 60 сек, лучше квадрат. Текст поста
                  уйдёт отдельным сообщением.
                </span>
              </label>
              <div>
                <Label>Текст кнопки</Label>
                <InputWithEmoji
                  maxLength={64}
                  value={promo.buttonText}
                  onChange={(buttonText) => setPromo({ ...promo, buttonText })}
                  placeholder="Получить подарок"
                />
                <label className="mt-2 flex items-start gap-2 text-sm text-black/70">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={promo.showClickCounter !== false}
                    onChange={(e) =>
                      setPromo({ ...promo, showClickCounter: e.target.checked })
                    }
                  />
                  <span>Показывать счётчик нажатий на кнопке</span>
                </label>
                <p className="mt-1 text-xs text-black/45">
                  {promo.showClickCounter === false
                    ? `В Telegram будет: «${promoButtonLabel}».`
                    : `В Telegram будет: «${promoButtonLabel}». Счётчик растёт при Start по кнопке.`}
                </p>
              </div>
              {promo.publishedAt && (
                <p className="text-xs text-black/45">
                  Опубликован: {new Date(promo.publishedAt).toLocaleString('ru-RU')} · нажатий:{' '}
                  {promo.clickCount}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={BTN_GHOST}
                  onClick={savePromo}
                  disabled={busy === 'promo-save'}
                >
                  {busy === 'promo-save' ? '…' : 'Сохранить черновик'}
                </button>
                <button
                  type="button"
                  className={BTN_AMBER}
                  onClick={publishPromo}
                  disabled={busy === 'promo-publish' || !channelId}
                >
                  {busy === 'promo-publish' ? '…' : 'Опубликовать в канале'}
                </button>
              </div>
              {!channelId ? (
                <div className="rounded-lg border border-[#f5a623]/50 bg-[#fffaf0] px-3 py-2">
                  <p className="text-xs font-semibold text-[#c2410c]">
                    Сначала проверьте канал в шаге 1.
                  </p>
                </div>
              ) : null}
            </div>
            <div>
              <p className={TG_PREVIEW_LABEL}>Превью в Telegram</p>
              <TelegramPreview
                botId={botId}
                botName={bot.campaign?.channelUsername ? `@${bot.campaign.channelUsername.replace(/^@/, '')}` : 'Канал'}
                botAvatarUrl={botAvatarObjectUrl || botAvatarUrl}
                text={promo.text}
                mediaType={normalizeGiftMediaType(promo.mediaType) || 'photo'}
                mediaUrl={promoLocalPreview || promo.mediaUrl}
                telegramFileId={promo.telegramFileId}
                mediaPlaceholder={Boolean(promo.telegramFileId) && !promoLocalPreview && !promo.mediaUrl}
                buttonLabel={promoButtonLabel}
              />
            </div>
          </div>
        </div>
      </section>
      ) : null}

      {/* 4. Post after /start */}
      <section id="section-start" className={LAND_SECTION}>
        <h2 className={LAND_TITLE}>{isMaxGift
              ? '1 шаг: Оформите пост после запуска бота'
              : '4 шаг: Оформите пост после запуска бота'}</h2>
        <p className={`mt-1 ${LAND_DESC}`}>
          {isMaxGift
              ? 'Текст после bot_started /start в MAX. Обычно просят подписаться (если канал есть) и нажать «Продолжить».'
              : 'Сообщение в чат сразу после /start: проверка подписки, кнопки «Перейти в канал» и подтверждения. Настройте до массового запуска.'}
        </p>
        <div className="mt-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <div
              className="space-y-3"
              onFocusCapture={() => setFunnelPreviewKey('start')}
              onClick={() => setFunnelPreviewKey('start')}
            >
              <div>
                <Label>Текст</Label>
                <p className="mt-0.5 text-xs text-black/45">{TELEGRAM_CLIENT_MD_RMB_HINT}</p>
                <TelegramMdTextarea
                  rows={5}
                  value={funnel.start.text}
                  onChange={(text) =>
                    setFunnel({ ...funnel, start: { ...funnel.start, text } })
                  }
                />
              </div>
              <MediaPicker
                label="Медиа"
                accept={GIFT_MEDIA_FILE_ACCEPT}
                busy={busy === 'funnel-start-media'}
                progressPercent={
                  uploadProgress?.key === 'funnel-start-media' ? uploadProgress.percent : null
                }
                progressPhase={
                  uploadProgress?.key === 'funnel-start-media' ? uploadProgress.phase : null
                }
                hasFile={Boolean(
                  funnel.start.telegramFileId || funnelLocalPreviews.start || funnel.start.imageUrl,
                )}
                fileHint={funnel.start.telegramFileId ? 'Файл в Telegram' : undefined}
                onPick={async (file) => {
                  setBusy('funnel-start-media');
                  setError('');
                  setOk('');
                  setFunnelLocal('start', URL.createObjectURL(file));
                  try {
                    const uploaded = await uploadMedia(file, 'funnel-start-media');
                    setFunnel((prev) =>
                      prev
                        ? {
                            ...prev,
                            start: {
                              ...prev.start,
                              telegramFileId: uploaded.fileId,
                              mediaType: uploaded.mediaType,
                              imageUrl: undefined,
                            },
                          }
                        : prev,
                    );
                    setOk(`Медиа загружено (${uploaded.mediaType})`);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                    setFunnelLocal('start');
                  } finally {
                    setBusy('');
                  }
                }}
                onClear={() => {
                  setFunnelLocal('start');
                  setFunnel((prev) =>
                    prev
                      ? {
                          ...prev,
                          start: {
                            ...prev.start,
                            telegramFileId: undefined,
                            mediaType: undefined,
                            imageUrl: undefined,
                          },
                        }
                      : prev,
                  );
                }}
              />
              <div>
                <Label>Текст на кнопке</Label>
                <p className="mt-0.5 text-xs text-black/45">
                  Эту кнопку человек нажимает, когда уже подписался на канал. Кнопка «Перейти в
                  канал» добавляется автоматически, если канал привязан.
                </p>
                <InputWithEmoji
                  maxLength={64}
                  value={funnel.subscribeButton?.confirmLabel || 'Я подписался ✅'}
                  onChange={(confirmLabel) =>
                    setFunnel({
                      ...funnel,
                      subscribeButton: { confirmLabel: confirmLabel || 'Я подписался ✅' },
                    })
                  }
                />
              </div>
              <ExtraUrlButtonsEditor
                buttons={funnel.start.extraButtons || []}
                onChange={(extraButtons) =>
                  setFunnel({
                    ...funnel,
                    start: { ...funnel.start, extraButtons },
                  })
                }
              />
              <button type="button" className={BTN_PRIMARY} onClick={saveCampaign} disabled={busy === 'save'}>
                      {busy === 'save' ? '…' : 'Сохранить'}
                    </button>
            </div>
            <div>
              <p className={TG_PREVIEW_LABEL}>Превью в чате после /start</p>
              <TelegramPreview
                botId={botId}
                botName={bot.displayName || botDisplayName || `@${bot.botUsername || 'bot'}`}
                botAvatarUrl={botAvatarObjectUrl || botAvatarUrl}
                text={funnel.start.text}
                mediaType={normalizeGiftMediaType(funnel.start.mediaType) || 'photo'}
                mediaUrl={funnelLocalPreviews.start || funnel.start.imageUrl}
                telegramFileId={funnel.start.telegramFileId}
                mediaPlaceholder={
                  Boolean(funnel.start.telegramFileId) &&
                  !funnelLocalPreviews.start &&
                  !funnel.start.imageUrl
                }
                linkButtons={[
                  ...(!isMaxGift && channelUsername
                    ? [
                        {
                          label: 'Перейти в канал',
                          href: `https://t.me/${channelUsername.replace(/^@/, '')}`,
                        },
                      ]
                    : []),
                  ...extraButtonsToLinkPreview(funnel.start.extraButtons),
                ]}
                buttonLabel={subscribeLabel}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Funnel: gift → afterGift, then Дожим nudges (notGifted / notSubscribed) */}
      {(() => {
        const channelHref = channelUsername
          ? `https://t.me/${channelUsername.replace(/^@/, '')}`
          : undefined;
        const channelBtns =
          !isMaxGift && channelHref
            ? [{ label: 'Перейти в канал', href: channelHref }]
            : undefined;
        const previewName =
          bot.displayName || botDisplayName || botPreviewName || 'Voxly Gift Bot';
        const nsIdx = Math.max(
          0,
          funnelPreviewKey.startsWith('notSubscribed:')
            ? Number(funnelPreviewKey.split(':')[1]) || 0
            : 0,
        );
        const agIdx = Math.max(
          0,
          funnelPreviewKey.startsWith('afterGift:')
            ? Number(funnelPreviewKey.split(':')[1]) || 0
            : 0,
        );
        const ngIdx = Math.max(
          0,
          funnelPreviewKey.startsWith('notGifted:')
            ? Number(funnelPreviewKey.split(':')[1]) || 0
            : 0,
        );
        const ns = funnel.notSubscribed[nsIdx] || funnel.notSubscribed[0];
        const ag = funnel.afterGift[agIdx] || funnel.afterGift[0];
        const ng = funnel.notGifted[ngIdx] || funnel.notGifted[0];
        const nsKey = `notSubscribed:${nsIdx}` as FunnelPreviewKey;
        const agKey = `afterGift:${agIdx}` as FunnelPreviewKey;
        const ngKey = `notGifted:${ngIdx}` as FunnelPreviewKey;

        return (
          <>
            <section id="section-funnel" className={LAND_SECTION}>
              <h2 className={LAND_TITLE}>{isMaxGift
                    ? '2 шаг: Оформите пост выдачи подарка'
                    : '5 шаг: Оформите пост выдачи подарка'}</h2>
              <p className={`mt-1 ${LAND_DESC}`}>
                Бот отправит это, когда человек реально подписался и нажал кнопку. Файл, картинка,
                  видео или ссылка.
              </p>
              <div className="mt-4">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div
                    className="space-y-3"
                    onFocusCapture={() => setFunnelPreviewKey('gift')}
                    onClick={() => setFunnelPreviewKey('gift')}
                  >
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
                        onChange={(e) =>
                          setFunnel({ ...funnel, gift: { ...funnel.gift, url: e.target.value } })
                        }
                        placeholder="https://..."
                      />
                    ) : (
                      <MediaPicker
                        accept={
                          funnel.gift.type === 'video' ? 'video/*' : GIFT_MEDIA_FILE_ACCEPT
                        }
                        busy={busy === 'funnel-gift-media'}
                        progressPercent={
                          uploadProgress?.key === 'funnel-gift-media'
                            ? uploadProgress.percent
                            : null
                        }
                        progressPhase={
                          uploadProgress?.key === 'funnel-gift-media'
                            ? uploadProgress.phase
                            : null
                        }
                        hasFile={Boolean(
                          funnel.gift.telegramFileId ||
                            funnelLocalPreviews.gift ||
                            funnel.gift.url,
                        )}
                        fileHint={funnel.gift.telegramFileId ? 'Файл в Telegram' : undefined}
                        onPick={async (file) => {
                          setBusy('funnel-gift-media');
                          setError('');
                          setFunnelLocal('gift', URL.createObjectURL(file));
                          try {
                            const uploaded = await uploadMedia(file, 'funnel-gift-media');
                            setFunnel((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    gift: {
                                      ...prev.gift,
                                      telegramFileId: uploaded.fileId,
                                      url: '',
                                      mediaType: uploaded.mediaType,
                                      type: uploaded.kind === 'video' ? 'video' : 'file',
                                    },
                                  }
                                : prev,
                            );
                            setOk('Подарок загружен в Telegram');
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                            setFunnelLocal('gift');
                          } finally {
                            setBusy('');
                          }
                        }}
                        onClear={() => {
                          setFunnelLocal('gift');
                          setFunnel((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  gift: { ...prev.gift, telegramFileId: undefined, url: '' },
                                }
                              : prev,
                          );
                        }}
                      />
                    )}
                    <div>
                      <Label>Текст рядом с подарком</Label>
                      <p className="mt-0.5 text-xs text-black/45">
                        {TELEGRAM_CLIENT_MD_RMB_HINT}
                      </p>
                      <TelegramMdTextarea
                        rows={3}
                        value={funnel.gift.caption || ''}
                        onChange={(caption) =>
                          setFunnel({ ...funnel, gift: { ...funnel.gift, caption } })
                        }
                        placeholder="Вот твой подарок 🎁"
                      />
                    </div>
                    <ExtraUrlButtonsEditor
                      buttons={funnel.gift.extraButtons || []}
                      onChange={(extraButtons) =>
                        setFunnel({
                          ...funnel,
                          gift: { ...funnel.gift, extraButtons },
                        })
                      }
                    />
                    <button type="button" className={BTN_PRIMARY} onClick={saveCampaign} disabled={busy === 'save'}>
                      {busy === 'save' ? '…' : 'Сохранить блок'}
                    </button>
                  </div>
                  <div>
                    <p className={TG_PREVIEW_LABEL}>Превью в Telegram</p>
                    <TelegramPreview
                      botId={botId}
                      botName={previewName}
                      botAvatarUrl={botAvatarObjectUrl || botAvatarUrl}
                      text={
                        funnel.gift.type === 'link' && funnel.gift.url
                          ? `${funnel.gift.caption || 'Вот твой подарок 🎁'}\n\n${funnel.gift.url}`
                          : funnel.gift.caption || 'Вот твой подарок 🎁'
                      }
                      mediaType={
                        funnel.gift.telegramFileId
                          ? detectStoredMediaKind(
                              funnel.gift.telegramFileId,
                              normalizeGiftMediaType(funnel.gift.mediaType) ||
                                (funnel.gift.type === 'video' ? 'video' : undefined),
                            )
                          : normalizeGiftMediaType(funnel.gift.mediaType) ||
                            (funnel.gift.type === 'video' ? 'video' : 'photo')
                      }
                      mediaUrl={
                        funnelLocalPreviews.gift ||
                        (funnel.gift.type === 'link' ? undefined : funnel.gift.url || undefined)
                      }
                      telegramFileId={funnel.gift.telegramFileId}
                      mediaPlaceholder={
                        Boolean(funnel.gift.telegramFileId) &&
                        !funnelLocalPreviews.gift &&
                        !(funnel.gift.type !== 'link' && funnel.gift.url)
                      }
                      linkButtons={extraButtonsToLinkPreview(funnel.gift.extraButtons)}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section id="section-funnel-ag" className={LAND_SECTION}>
              <h2 className={LAND_TITLE}>{isMaxGift
                    ? '3 шаг: Оформите посты которые отправятся после выдачи подарка'
                    : '6 шаг: Оформите посты которые отправятся после выдачи подарка'}</h2>
              <p className={`mt-1 ${LAND_DESC}`}>
                Follow-up после выдачи подарка. {TELEGRAM_CLIENT_MD_RMB_HINT}
              </p>
              <div className="mt-4">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-3">
                    <MessageList
                      title="Сообщения"
                      messages={funnel.afterGift}
                      previewBucket="afterGift"
                      activeKey={funnelPreviewKey}
                      localPreviews={funnelLocalPreviews}
                      uploadingKey={busy}
                      busyPrefix="funnel-ag"
                      uploadProgress={uploadProgress}
                      onSelect={(i) => setFunnelPreviewKey(`afterGift:${i}`)}
                      onChange={(afterGift) => setFunnel({ ...funnel, afterGift })}
                      onUpload={async (i, file) => {
                        const key = `afterGift:${i}`;
                        const busyKey = `funnel-ag-${i}`;
                        setBusy(busyKey);
                        setError('');
                        setFunnelLocal(key, URL.createObjectURL(file));
                        try {
                          const uploaded = await uploadMedia(file, busyKey);
                          setFunnel((prev) => {
                            if (!prev) return prev;
                            const next = [...prev.afterGift];
                            next[i] = {
                              ...next[i],
                              telegramFileId: uploaded.fileId,
                              mediaType: uploaded.mediaType,
                              imageUrl: undefined,
                            };
                            return { ...prev, afterGift: next };
                          });
                          setOk('Медиа загружено');
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                          setFunnelLocal(key);
                        } finally {
                          setBusy('');
                        }
                      }}
                      onClearMedia={(i) => {
                        setFunnelLocal(`afterGift:${i}`);
                        setFunnel((prev) => {
                          if (!prev) return prev;
                          const next = [...prev.afterGift];
                          next[i] = {
                            ...next[i],
                            telegramFileId: undefined,
                            mediaType: undefined,
                            imageUrl: undefined,
                          };
                          return { ...prev, afterGift: next };
                        });
                      }}
                    />
                    <button type="button" className={BTN_PRIMARY} onClick={saveCampaign} disabled={busy === 'save'}>
                      {busy === 'save' ? '…' : 'Сохранить блок'}
                    </button>
                  </div>
                  <div>
                    <p className={TG_PREVIEW_LABEL}>Превью в Telegram</p>
                    <TelegramPreview
                      botId={botId}
                      botName={previewName}
                      botAvatarUrl={botAvatarObjectUrl || botAvatarUrl}
                      text={ag?.text || ''}
                      mediaType={normalizeGiftMediaType(ag?.mediaType) || 'photo'}
                      mediaUrl={funnelLocalPreviews[agKey] || ag?.imageUrl}
                      telegramFileId={ag?.telegramFileId}
                      mediaPlaceholder={Boolean(ag?.telegramFileId) && !funnelLocalPreviews[agKey] && !ag?.imageUrl}
                      linkButtons={extraButtonsToLinkPreview(ag?.extraButtons)}
                    />
                  </div>
                </div>
              </div>
            </section>

            <div className="mt-2 border-t border-black/10 pt-6">
              <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-black/40">
                Дожим
              </h2>
              <p className="mt-1 text-sm text-black/55">
                Напоминания, если пользователь застрял — не продвигаются в основной воронке.
              </p>
            </div>

            <section id="section-funnel-ng" className={LAND_SECTION}>
              <h2 className={LAND_TITLE}>Если ничего не делает после запуска бота</h2>
              <p className={`mt-1 ${LAND_DESC}`}>
                Нажал Start и ничего не сделал — не жал «Я подписался». Бот напомнит забрать
                  подарок. {TELEGRAM_CLIENT_MD_RMB_HINT}
              </p>
              <div className="mt-4">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-3">
                    <MessageList
                      title="Напоминания"
                      messages={funnel.notGifted}
                      previewBucket="notGifted"
                      activeKey={funnelPreviewKey}
                      localPreviews={funnelLocalPreviews}
                      uploadingKey={busy}
                      busyPrefix="funnel-ng"
                      uploadProgress={uploadProgress}
                      onSelect={(i) => setFunnelPreviewKey(`notGifted:${i}`)}
                      onChange={(notGifted) => setFunnel({ ...funnel, notGifted })}
                      onUpload={async (i, file) => {
                        const key = `notGifted:${i}`;
                        const busyKey = `funnel-ng-${i}`;
                        setBusy(busyKey);
                        setError('');
                        setFunnelLocal(key, URL.createObjectURL(file));
                        try {
                          const uploaded = await uploadMedia(file, busyKey);
                          setFunnel((prev) => {
                            if (!prev) return prev;
                            const next = [...prev.notGifted];
                            next[i] = {
                              ...next[i],
                              telegramFileId: uploaded.fileId,
                              mediaType: uploaded.mediaType,
                              imageUrl: undefined,
                            };
                            return { ...prev, notGifted: next };
                          });
                          setOk('Медиа загружено');
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                          setFunnelLocal(key);
                        } finally {
                          setBusy('');
                        }
                      }}
                      onClearMedia={(i) => {
                        setFunnelLocal(`notGifted:${i}`);
                        setFunnel((prev) => {
                          if (!prev) return prev;
                          const next = [...prev.notGifted];
                          next[i] = {
                            ...next[i],
                            telegramFileId: undefined,
                            mediaType: undefined,
                            imageUrl: undefined,
                          };
                          return { ...prev, notGifted: next };
                        });
                      }}
                    />
                    <button type="button" className={BTN_PRIMARY} onClick={saveCampaign} disabled={busy === 'save'}>
                      {busy === 'save' ? '…' : 'Сохранить блок'}
                    </button>
                  </div>
                  <div>
                    <p className={TG_PREVIEW_LABEL}>Превью в Telegram</p>
                    <TelegramPreview
                      botId={botId}
                      botName={previewName}
                      botAvatarUrl={botAvatarObjectUrl || botAvatarUrl}
                      text={ng?.text || ''}
                      mediaType={normalizeGiftMediaType(ng?.mediaType) || 'photo'}
                      mediaUrl={funnelLocalPreviews[ngKey] || ng?.imageUrl}
                      telegramFileId={ng?.telegramFileId}
                      mediaPlaceholder={Boolean(ng?.telegramFileId) && !funnelLocalPreviews[ngKey] && !ng?.imageUrl}
                      linkButtons={[
                        ...(channelBtns || []),
                        ...extraButtonsToLinkPreview(ng?.extraButtons),
                      ]}
                      buttonLabel={subscribeLabel}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section id="section-funnel-ns" className={LAND_SECTION}>
              <h2 className={LAND_TITLE}>Если не подписан на канал</h2>
              <p className={`mt-1 ${LAND_DESC}`}>
                Человек нажал «Я подписался», а в канале его нет. Через время бот напомнит
                  подписаться. {TELEGRAM_CLIENT_MD_RMB_HINT}
              </p>
              <div className="mt-4">
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-3">
                    <MessageList
                      title="Напоминания"
                      messages={funnel.notSubscribed}
                      previewBucket="notSubscribed"
                      activeKey={funnelPreviewKey}
                      localPreviews={funnelLocalPreviews}
                      uploadingKey={busy}
                      busyPrefix="funnel-ns"
                      uploadProgress={uploadProgress}
                      onSelect={(i) => setFunnelPreviewKey(`notSubscribed:${i}`)}
                      onChange={(notSubscribed) => setFunnel({ ...funnel, notSubscribed })}
                      onUpload={async (i, file) => {
                        const key = `notSubscribed:${i}`;
                        const busyKey = `funnel-ns-${i}`;
                        setBusy(busyKey);
                        setError('');
                        setFunnelLocal(key, URL.createObjectURL(file));
                        try {
                          const uploaded = await uploadMedia(file, busyKey);
                          setFunnel((prev) => {
                            if (!prev) return prev;
                            const next = [...prev.notSubscribed];
                            next[i] = {
                              ...next[i],
                              telegramFileId: uploaded.fileId,
                              mediaType: uploaded.mediaType,
                              imageUrl: undefined,
                            };
                            return { ...prev, notSubscribed: next };
                          });
                          setOk('Медиа загружено');
                        } catch (e) {
                          setError(e instanceof Error ? e.message : 'Ошибка загрузки');
                          setFunnelLocal(key);
                        } finally {
                          setBusy('');
                        }
                      }}
                      onClearMedia={(i) => {
                        setFunnelLocal(`notSubscribed:${i}`);
                        setFunnel((prev) => {
                          if (!prev) return prev;
                          const next = [...prev.notSubscribed];
                          next[i] = {
                            ...next[i],
                            telegramFileId: undefined,
                            mediaType: undefined,
                            imageUrl: undefined,
                          };
                          return { ...prev, notSubscribed: next };
                        });
                      }}
                    />
                    <button type="button" className={BTN_PRIMARY} onClick={saveCampaign} disabled={busy === 'save'}>
                      {busy === 'save' ? '…' : 'Сохранить блок'}
                    </button>
                  </div>
                  <div>
                    <p className={TG_PREVIEW_LABEL}>Превью в Telegram</p>
                    <TelegramPreview
                      botId={botId}
                      botName={previewName}
                      botAvatarUrl={botAvatarObjectUrl || botAvatarUrl}
                      text={ns?.text || ''}
                      mediaType={normalizeGiftMediaType(ns?.mediaType) || 'photo'}
                      mediaUrl={funnelLocalPreviews[nsKey] || ns?.imageUrl}
                      telegramFileId={ns?.telegramFileId}
                      mediaPlaceholder={Boolean(ns?.telegramFileId) && !funnelLocalPreviews[nsKey] && !ns?.imageUrl}
                      linkButtons={[
                        ...(channelBtns || []),
                        ...extraButtonsToLinkPreview(ns?.extraButtons),
                      ]}
                      buttonLabel={subscribeLabel}
                    />
                  </div>
                </div>
              </div>
            </section>
          </>
        );
      })()}

      {/* Subscribers */}
      <section id="section-subs" className={LAND_SECTION}>
        <h2 className={LAND_TITLE}>Подписчики и переписка</h2>
        <p className={`mt-1 ${LAND_DESC}`}>
          Кто запустил бота и получил подарок. Отсюда можно открыть переписку.
        </p>
        <div className="mt-4">
          {subscribers.length === 0 ? (
            <p className="text-sm text-black/55">Пока никто не запускал бота.</p>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                        Имя
                      </th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                        Username
                      </th>
                      <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                        Подарок
                      </th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {subscribers.map((s) => (
                      <tr key={s.id} className="border-t border-black/10">
                        <td className="py-2.5 pr-3">{s.firstName || '—'}</td>
                        <td className="py-2.5 pr-3">{s.username ? `@${s.username}` : s.telegramId}</td>
                        <td className="py-2.5 pr-3">{s.giftDelivered ? 'да' : 'нет'}</td>
                        <td className="py-2.5">
                          <button
                            type="button"
                            className={BTN_GHOST_SM}
                            onClick={() => openChat(s.id)}
                          >
                            Чат
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {activeChatId && (
                <div className="space-y-3">
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-black/10 bg-[#faf8f5] p-3">
                    {chatMessages.length === 0 ? (
                      <p className="text-sm text-black/55">Сообщений нет</p>
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
                  <TelegramMdTextarea
                    rows={3}
                    value={replyText}
                    onChange={setReplyText}
                    placeholder="Ответ через gift-бота"
                  />
                  <button
                    type="button"
                    className={BTN_PRIMARY}
                    onClick={sendReply}
                    disabled={busy === 'reply' || !replyText.trim()}
                  >
                    {busy === 'reply' ? '…' : 'Отправить'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
      </div>
    </AppShell>
  );
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
  /** 0–100 while uploading */
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
        <button
          type="button"
          className={BTN_GHOST_SM}
          disabled={Boolean(busy)}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {busy ? statusLabel : 'Выбрать файл'}
        </button>
        {hasFile ? (
          <button
            type="button"
            className={BTN_GHOST_SM}
            onClick={onClear}
            disabled={Boolean(busy)}
          >
            <Trash2 className="h-4 w-4" /> Убрать
          </button>
        ) : null}
      </div>
      {busy && (
        <div className="space-y-1" aria-live="polite">
          <div className="h-2 overflow-hidden rounded-full bg-black/10">
            <div
              className={`h-full rounded-full bg-[#f5a623] transition-[width] duration-200 ease-out ${
                progressPhase === 'processing' && (pct == null || pct >= 90)
                  ? 'animate-pulse'
                  : ''
              }`}
              style={{ width: `${pct != null ? Math.max(pct, 4) : 40}%` }}
            />
          </div>
          <p className="text-xs text-black/45">
            {progressPhase === 'processing'
              ? 'Файл на сервере — бот получает file_id в Telegram (это может занять минуту для видео).'
              : pct != null
                ? `Загружено ${pct}%`
                : 'Готовим загрузку…'}
          </p>
        </div>
      )}
      {fileHint && !busy && <p className="text-xs text-black/45">{fileHint}</p>}
      {!fileHint && !hasFile && !busy && (
        <p className="text-xs text-black/45">
          Фото (PNG/JPG), видео (MP4), PDF/DOC/XLS, голос (OGG) или файл до 48 МБ → Telegram.
          Нужен привязанный Telegram или проверенный канал.
        </p>
      )}
    </div>
  );
}

function MessageList({
  title,
  messages,
  onChange,
  previewBucket,
  activeKey,
  localPreviews,
  uploadingKey,
  busyPrefix,
  uploadProgress,
  onSelect,
  onUpload,
  onClearMedia,
}: {
  title: string;
  messages: GiftFunnelMessage[];
  onChange: (m: GiftFunnelMessage[]) => void;
  previewBucket: 'notSubscribed' | 'afterGift' | 'notGifted';
  activeKey: FunnelPreviewKey;
  localPreviews: Record<string, string>;
  uploadingKey: string;
  busyPrefix: string;
  uploadProgress: { key: string; percent: number; phase: 'upload' | 'processing' } | null;
  onSelect: (index: number) => void;
  onUpload: (index: number, file: File) => void | Promise<void>;
  onClearMedia: (index: number) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label>{title}</Label>
        <button
          type="button"
          className={BTN_AMBER}
          onClick={() => onChange([...messages, { delayMinutes: 10, text: 'Новое сообщение' }])}
        >
          Добавить сообщение
        </button>
      </div>
      {messages.map((m, i) => {
        const key = `${previewBucket}:${i}` as FunnelPreviewKey;
        const active = activeKey === key;
        return (
          <div
            key={i}
            className={`space-y-2 rounded-xl border p-3 ${
              active ? 'border-[#f5a623] bg-[#fff8ec]' : 'border-black/10 bg-[#faf8f5]'
            }`}
            onFocusCapture={() => onSelect(i)}
            onClick={() => onSelect(i)}
          >
            <div className="grid grid-cols-[auto_1fr_auto] items-start gap-2">
              <div className="w-[92px]">
                <p className="mb-1 text-[11px] text-black/45">Через мин.</p>
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
                <p className="mb-1 text-[11px] text-black/45">
                  Текст · ПКМ для оформления
                </p>
                <TelegramMdTextarea
                  rows={2}
                  className="mt-0"
                  value={m.text}
                  onChange={(text) => {
                    const next = [...messages];
                    next[i] = { ...m, text };
                    onChange(next);
                  }}
                />
              </div>
              <button
                type="button"
                className={`${BTN_GHOST_SM} mt-5 min-w-9 px-2`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(messages.filter((_, idx) => idx !== i));
                }}
                title="Удалить"
              >
                ✕
              </button>
            </div>
            <MediaPicker
              accept={GIFT_MEDIA_FILE_ACCEPT}
              busy={uploadingKey === `${busyPrefix}-${i}`}
              progressPercent={
                uploadProgress?.key === `${busyPrefix}-${i}` ? uploadProgress.percent : null
              }
              progressPhase={
                uploadProgress?.key === `${busyPrefix}-${i}` ? uploadProgress.phase : null
              }
              hasFile={Boolean(m.telegramFileId || localPreviews[key] || m.imageUrl)}
              fileHint={m.telegramFileId ? 'Файл в Telegram' : undefined}
              onPick={(file) => onUpload(i, file)}
              onClear={() => onClearMedia(i)}
            />
            <ExtraUrlButtonsEditor
              buttons={m.extraButtons || []}
              onChange={(extraButtons) => {
                const next = [...messages];
                next[i] = { ...m, extraButtons };
                onChange(next);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function ExtraUrlButtonsEditor({
  buttons,
  onChange,
}: {
  buttons: GiftExtraButton[];
  onChange: (buttons: GiftExtraButton[]) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label>Доп. кнопки-ссылки</Label>
          <p className="mt-0.5 text-[11px] text-black/45">
            Под постом в Telegram. Пустые строки не сохранятся.
          </p>
        </div>
        <button
          type="button"
          className={BTN_AMBER}
          disabled={buttons.length >= 8}
          onClick={(e) => {
            e.stopPropagation();
            onChange([...buttons, { text: '', url: '' }]);
          }}
        >
          Добавить кнопку
        </button>
      </div>
      {buttons.map((b, i) => (
        <div
          key={i}
          className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto]"
          onClick={(e) => e.stopPropagation()}
        >
          <Input
            maxLength={64}
            placeholder="Текст кнопки"
            value={b.text}
            onChange={(e) => {
              const next = [...buttons];
              next[i] = { ...b, text: e.target.value };
              onChange(next);
            }}
          />
          <Input
            maxLength={2000}
            placeholder="https://…"
            value={b.url}
            onChange={(e) => {
              const next = [...buttons];
              next[i] = { ...b, url: e.target.value };
              onChange(next);
            }}
          />
          <button
            type="button"
            className={`${BTN_GHOST_SM} min-w-9 px-2`}
            onClick={() => onChange(buttons.filter((_, idx) => idx !== i))}
            title="Удалить кнопку"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
