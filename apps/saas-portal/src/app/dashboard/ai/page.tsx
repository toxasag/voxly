'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ExternalLink,
  Loader2,
  MessageSquare,
  Pause,
  Play,
  Plus,
  Power,
  PowerOff,
  Trash2,
} from 'lucide-react';
import { PRICING, TRIAL_PERIOD_DAYS } from '@voxly/shared';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { cn, selectClassName } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { AiSecretaryHero } from '@/components/portal/ai-secretary-hero';
import { CopyButton } from '@/components/portal/copy-button';

interface AddonState {
  isActive: boolean;
  isTrial: boolean;
  trialAvailable?: boolean;
  activeUntil: string | null;
  includedSlots?: number;
  extraSlots?: number;
  activeAccounts?: number;
}

interface OverviewPayload {
  products: {
    aiBusiness: AddonState;
  };
  accounts: {
    agents: number;
  };
  money: {
    aiWalletRub: number;
  };
}

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  botLink?: string | null;
  conversationCount?: number;
  businessConnectionCount?: number;
  defaultAiAgentId?: string | null;
}

interface BotsResponse {
  aiBotPriceMonthly?: number;
  maxBusinessConnections?: number;
  bots: BotRow[];
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

const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';

function formatRub(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v.toLocaleString('ru-RU', {
    minimumFractionDigits: v > 0 && v < 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function formatInt(n: number | null | undefined): string {
  return Math.round(Number(n) || 0).toLocaleString('ru-RU');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU');
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

function addonBadge(addon: AddonState): { variant: 'success' | 'warning' | 'secondary'; text: string } {
  if (addon.isActive && addon.isTrial) return { variant: 'warning', text: 'Пробный период' };
  if (addon.isActive) return { variant: 'success', text: 'Подписка активна' };
  if (addon.trialAvailable) return { variant: 'secondary', text: 'Не подключён' };
  return { variant: 'warning', text: 'Подписка закончилась' };
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

function SectionHead({
  index,
  kicker,
  title,
  description,
}: {
  index: string;
  kicker: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/40">
        {index} · {kicker}
      </p>
      <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">{title}</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-black/55">{description}</p>
    </div>
  );
}

export default function TelegramSecretaryPage() {
  return (
    <Suspense
      fallback={
        <AppShell maxWidth="6xl">
          <LoadingState label="Загружаем Телеграм Секретарь…" />
        </AppShell>
      }
    >
      <TelegramSecretaryPageInner />
    </Suspense>
  );
}

function TelegramSecretaryPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const botParam = searchParams.get('bot');

  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [botsData, setBotsData] = useState<BotsResponse | null>(null);
  const [agents, setAgents] = useState<AgentRef[]>([]);
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [businessAccounts, setBusinessAccounts] = useState<BusinessAccountRow[]>([]);
  const [bizCapacity, setBizCapacity] = useState<{
    included: number;
    extraSlots: number;
    capacity: number;
    active: number;
    extraPriceMonthly: number;
  } | null>(null);
  const [defaultAiAgentId, setDefaultAiAgentId] = useState<string | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState('');
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const tokenInputRef = useRef<HTMLInputElement>(null);
  const connectSectionRef = useRef<HTMLElement>(null);

  const aiBots = (botsData?.bots || []).filter((b) => b.botType === 'ai_tg');
  const selectedBot = aiBots.find((b) => b.id === selectedBotId) || null;
  const tgPrice = botsData?.aiBotPriceMonthly ?? PRICING.AI_TELEGRAM_MONTHLY;
  const maxConn =
    bizCapacity?.capacity ??
    botsData?.maxBusinessConnections ??
    overview?.products.aiBusiness.includedSlots ??
    PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS;
  const extraSlotPrice = bizCapacity?.extraPriceMonthly ?? PRICING.AI_TG_EXTRA_CONN_MONTHLY;
  const activeAccounts =
    bizCapacity?.active ??
    overview?.products.aiBusiness.activeAccounts ??
    businessAccounts.filter((a) => a.connected).length;

  const loadCore = useCallback(async () => {
    const session = localStorage.getItem('voxly_token');
    if (!session) {
      router.push('/login');
      return;
    }
    try {
      const [overviewRes, botsRes, agentsRes] = await Promise.all([
        fetch('/api/tenant/dashboard', { headers: authHeaders() }),
        fetch('/api/bots', { headers: authHeaders() }),
        fetch('/api/ai/agents', { headers: authHeaders() }),
      ]);
      if (!overviewRes.ok) throw new Error('Не удалось загрузить состояние Телеграм Секретаря');
      if (!botsRes.ok) throw new Error('Не удалось загрузить список ботов');
      setOverview((await overviewRes.json()) as OverviewPayload);
      setBotsData((await botsRes.json()) as BotsResponse);
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
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const loadBotDetail = useCallback(async (botId: string) => {
    try {
      const convRes = await fetch(`/api/bots/${botId}/conversations`, { headers: authHeaders() });
      if (!convRes.ok) return;
      const convJson = await convRes.json();
      setConversations(convJson.conversations || []);
      setBusinessAccounts(convJson.businessAccounts || []);
      if (convJson.businessCapacity) {
        setBizCapacity(convJson.businessCapacity);
      }
      if (convJson.defaultAiAgentId !== undefined) {
        setDefaultAiAgentId(convJson.defaultAiAgentId);
      }
    } catch {
      /* detail load is supplementary */
    }
  }, []);

  const load = useCallback(async () => {
    await loadCore();
  }, [loadCore]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (aiBots.length === 0) {
      setSelectedBotId(null);
      return;
    }
    if (botParam && aiBots.some((b) => b.id === botParam)) {
      setSelectedBotId(botParam);
      return;
    }
    const fallback = aiBots[0]?.id;
    if (fallback) {
      setSelectedBotId(fallback);
      router.replace(`/dashboard/ai?bot=${encodeURIComponent(fallback)}`, { scroll: false });
    }
  }, [aiBots, botParam, router]);

  useEffect(() => {
    const bot = botsData?.bots.find((b) => b.id === selectedBotId && b.botType === 'ai_tg');
    if (bot) setDefaultAiAgentId(bot.defaultAiAgentId ?? null);
  }, [selectedBotId, botsData]);

  useEffect(() => {
    if (!selectedBotId) {
      setConversations([]);
      setBusinessAccounts([]);
      setActiveConvId(null);
      return;
    }
    void loadBotDetail(selectedBotId);
    const t = setInterval(() => void loadBotDetail(selectedBotId), 10000);
    return () => clearInterval(t);
  }, [selectedBotId, loadBotDetail]);

  const loadMessages = useCallback(
    async (conversationId: string) => {
      if (!selectedBotId) return;
      const res = await fetch(
        `/api/bots/${selectedBotId}/conversations/${conversationId}/messages`,
        { headers: authHeaders() },
      );
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
    [selectedBotId],
  );

  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeConvId);
    const t = setInterval(() => void loadMessages(activeConvId), 5000);
    return () => clearInterval(t);
  }, [activeConvId, loadMessages]);

  const selectBot = (botId: string) => {
    setSelectedBotId(botId);
    setActiveConvId(null);
    router.replace(`/dashboard/ai?bot=${encodeURIComponent(botId)}`, { scroll: false });
  };

  const paySubscription = async () => {
    setBusy('pay');
    setError('');
    try {
      await startCheckout({ productCode: 'ai_tg', periodMonths: 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось перейти к оплате');
      setBusy('');
    }
  };

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
      if (!res.ok) throw new Error(json.error || 'Не удалось активировать пробный период');
      await load();
      setShowTokenForm(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const connectBot = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('connect');
    setError('');
    setInfo('');
    try {
      if (!overview?.products.aiBusiness.isActive) {
        const trialRes = await fetch('/api/bots/ai/start-trial', {
          method: 'POST',
          headers: authHeaders(),
          body: '{}',
        });
        const trialJson = await trialRes.json();
        if (!trialRes.ok) {
          throw new Error(trialJson.error || 'Не удалось активировать пробный период');
        }
      }
      const res = await fetch('/api/bots/ai/connect', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), username: username.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          [json.error, json.hint].filter(Boolean).join(' — ') || 'Не удалось подключить бота',
        );
      }
      setToken('');
      setUsername('');
      setShowTokenForm(false);
      if (json.businessWarning) setInfo(json.businessWarning);
      if (json.webhookOk === false && json.webhookError) {
        setError(
          `Бот сохранён, но Telegram не принял webhook: ${json.webhookError}. Сообщения могут не доходить — попробуйте переподключить бота или напишите в поддержку.`,
        );
      }
      await load();
      if (json.bot?.id) {
        selectBot(json.bot.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка подключения');
    } finally {
      setBusy('');
    }
  };

  const deleteBot = async (botId: string) => {
    setBusy(`del:${botId}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/${botId}`, { method: 'DELETE', headers: authHeaders() });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось удалить бота');
      setDeleteConfirmId('');
      if (selectedBotId === botId) {
        router.replace('/dashboard/ai', { scroll: false });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка удаления');
    } finally {
      setBusy('');
    }
  };

  const patchHandoff = async (
    conversationId: string,
    body: Record<string, unknown>,
    busyKey: string,
  ) => {
    if (!selectedBotId) return;
    setBusy(busyKey);
    setError('');
    try {
      const res = await fetch(`/api/bots/${selectedBotId}/conversations/${conversationId}`, {
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
      <AppShell maxWidth="6xl">
        <LoadingState label="Загружаем Телеграм Секретарь…" />
      </AppShell>
    );
  }

  if (!overview || !botsData) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">
          <div className="space-y-2">
            <p>{error || 'Данные Телеграм Секретаря не загрузились.'}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError('');
                void load();
              }}
              className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
            >
              Попробовать снова
            </button>
          </div>
        </Alert>
      </AppShell>
    );
  }

  const aiBusiness = overview.products.aiBusiness;
  const subBadge = addonBadge(aiBusiness);
  const walletRub = overview.money.aiWalletRub;
  const requiresPayment = !aiBusiness.isActive;
  const trialAvailable = Boolean(aiBusiness.trialAvailable);
  const subActive = aiBusiness.isActive;
  const isTrial = aiBusiness.isActive && aiBusiness.isTrial;
  const daysRemaining = aiBusiness.activeUntil
    ? Math.max(0, Math.ceil((new Date(aiBusiness.activeUntil).getTime() - Date.now()) / 86_400_000))
    : null;
  const needsReviewCount = conversations.filter((c) => c.needsReview).length;
  const activeConv = conversations.find((c) => c.id === activeConvId) || null;

  const heroState: 'connected' | 'pending' | 'off' = subActive
    ? aiBots.length > 0 && activeAccounts > 0
      ? 'connected'
      : aiBots.length > 0
        ? 'pending'
        : 'pending'
    : 'off';

  const heroStateLabel = !subActive
    ? trialAvailable
      ? 'Подписка не включена'
      : 'Подписка закончилась'
    : isTrial
      ? aiBots.length === 0
        ? 'Бот не подключён'
        : activeAccounts === 0
          ? 'Ждём аккаунт Telegram'
          : 'Пробный период активен'
      : aiBots.length === 0
        ? 'Бот не подключён'
        : activeAccounts === 0
          ? 'Ждём аккаунт Telegram'
          : 'Секретарь работает';

  const heroStateHint = !subActive
    ? trialAvailable
      ? `Включите ${TRIAL_PERIOD_DAYS} бесплатных дней или оплатите тариф — без подписки бот не примет сообщения.`
      : 'Пробный период истёк. Оплатите тариф, чтобы снова принимать сообщения. Переписка и контакты в CRM сохранены.'
    : isTrial
      ? aiBots.length === 0
        ? 'Создайте бота в @BotFather и вставьте токен — это займёт пару минут.'
        : activeAccounts === 0
          ? 'Подключите бота в Telegram → Настройки → Бизнес → Автоматизация чатов.'
          : daysRemaining !== null && daysRemaining <= 3
            ? `Через ${daysRemaining} ${plural(daysRemaining, ['день', 'дня', 'дней'])} бот перестанет принимать сообщения. Оплатите, чтобы продолжить.`
            : 'Всё работает. После окончания пробного периода бот остановится — оплатите заранее, чтобы не прерывать приём сообщений.'
      : aiBots.length === 0
        ? 'Создайте бота в @BotFather и вставьте токен — это займёт пару минут.'
        : activeAccounts === 0
          ? 'Подключите бота в Telegram → Настройки → Бизнес → Автоматизация чатов.'
          : 'Входящие в личку попадают в CRM. AI ответит, если назначен агент и есть баланс.';

  const heroTitle = !subActive
    ? trialAvailable
      ? 'Телеграм Секретарь ждёт подписку'
      : 'Пробный период закончился'
    : aiBots.length === 0
      ? 'Подключите бота-секретаря'
      : activeAccounts === 0
        ? 'Бот есть — подключите аккаунт'
        : isTrial
          ? 'Телеграм Секретарь работает'
          : 'Телеграм Секретарь на связи';

  const heroActionLabel = !subActive
    ? trialAvailable
      ? `Включить ${TRIAL_PERIOD_DAYS} бесплатных дней`
      : `Оплатить ${formatInt(tgPrice)} ₽/мес`
    : aiBots.length === 0 || showTokenForm
      ? 'Подключить бота'
      : activeAccounts === 0
        ? 'Добавить аккаунт'
        : isTrial
          ? `Оплатить ${formatInt(tgPrice)} ₽/мес`
          : 'Добавить бота';

  const focusConnect = () => {
    connectSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (aiBots.length === 0 || showTokenForm) {
      window.setTimeout(() => tokenInputRef.current?.focus(), 400);
    } else {
      setShowTokenForm(true);
      window.setTimeout(() => tokenInputRef.current?.focus(), 400);
    }
  };

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
        <AiSecretaryHero
          title={heroTitle}
          subtitle="Бот-секретарь отвечает в личных чатах вашего Telegram через режим «Автоматизация чатов». Подписка даёт право принимать сообщения, ответы нейросети оплачиваются отдельным балансом AI."
          facts={[
            {
              label: 'Аккаунтов',
              value: `${activeAccounts} из ${maxConn}`,
            },
            {
              label: isTrial ? 'Пробный период' : 'Подписка',
              value: isTrial
                ? daysRemaining !== null
                  ? `осталось ${daysRemaining} ${plural(daysRemaining, ['день', 'дня', 'дней'])}`
                  : 'активен'
                : subActive
                  ? aiBusiness.activeUntil
                    ? `до ${formatDate(aiBusiness.activeUntil)}`
                    : 'активна'
                  : trialAvailable
                    ? `${TRIAL_PERIOD_DAYS} дней бесплатно`
                    : 'не активна',
            },
            {
              label: 'Баланс AI',
              value: `${formatRub(walletRub)} ₽`,
            },
          ]}
          stateLabel={heroStateLabel}
          stateTone={heroState}
          stateHint={heroStateHint}
          actionLabel={heroActionLabel}
          actionDisabled={busy === 'trial' || busy === 'pay'}
          onAction={() => {
            if (!subActive) {
              if (trialAvailable) void startTrial();
              else void paySubscription();
              return;
            }
            if (isTrial && aiBots.length > 0 && activeAccounts > 0) {
              void paySubscription();
              return;
            }
            focusConnect();
          }}
          footerLabel="Тариф канала"
          footerValue={`${formatInt(tgPrice)} ₽/мес`}
        />

        {error ? <Alert variant="error">{error}</Alert> : null}
        {info ? <Alert variant="info">{info}</Alert> : null}

        {isTrial && aiBots.length > 0 && activeAccounts > 0 ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-[#f5a623]/30 bg-[#fffaf0] px-5 py-4"
          >
            <p className="text-sm font-semibold text-black">
              Пробный период — {daysRemaining !== null ? `${daysRemaining} ${plural(daysRemaining, ['день', 'дня', 'дней'])} до` : 'до'}{' '}
              {aiBusiness.activeUntil ? formatDate(aiBusiness.activeUntil) : 'окончания'}
            </p>
            <p className="mt-1 text-sm text-black/65">
              После окончания бот перестанет принимать новые сообщения. Переписка и контакты в CRM сохранятся — вы ничего не потеряете.
            </p>
            <button
              type="button"
              disabled={busy === 'pay'}
              onClick={() => void paySubscription()}
              className="land-btn-amber mt-3 min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'pay' ? 'Переходим к оплате…' : `Оплатить ${formatInt(tgPrice)} ₽/мес`}
            </button>
          </div>
        ) : null}

        {!subActive && !trialAvailable ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-black/10 bg-[#faf8f5] px-5 py-4"
          >
            <p className="text-sm font-semibold text-black">Пробный период закончился</p>
            <p className="mt-1 text-sm text-black/65">
              Бот не принимает сообщения. Переписка и контакты в CRM на месте — оплатите, чтобы продолжить.
            </p>
            <button
              type="button"
              disabled={busy === 'pay'}
              onClick={() => void paySubscription()}
              className="land-btn-amber mt-3 min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'pay' ? 'Переходим к оплате…' : `Оплатить ${formatInt(tgPrice)} ₽/мес`}
            </button>
          </div>
        ) : null}

        {subActive && aiBots.length > 0 && activeAccounts === 0 ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-2xl border border-[#f5a623]/30 bg-[#fffaf0] px-5 py-4"
          >
            <p className="text-sm font-semibold text-black">Следующий шаг — подключите аккаунт Telegram</p>
            <p className="mt-1 text-sm text-black/65">
              Бот создан, но пока никому не отвечает. Откройте Telegram → Настройки → Бизнес → Автоматизация чатов и добавьте @{selectedBot?.botUsername || '…'}.
            </p>
          </div>
        ) : null}

        {subActive && aiBots.length > 0 && activeAccounts > 0 && overview.accounts.agents === 0 ? (
          <Alert variant="info">
            <div className="space-y-1">
              <p className="font-semibold">Следующий шаг — создайте AI-агента</p>
              <p>
                Пока агент не создан и не назначен, секретарь не отвечает — переписка копится в CRM.{' '}
                <Link
                  href="/dashboard/ai/agents"
                  className="font-semibold underline underline-offset-2"
                >
                  Создать агента
                </Link>
                .
              </p>
            </div>
          </Alert>
        ) : null}

        {walletRub <= 0 && aiBots.length > 0 && activeAccounts > 0 ? (
          <Alert variant="error">
            <div className="space-y-1">
              <p className="font-semibold">Баланс AI на нуле — ответы не отправляются</p>
              <p>
                Бот остаётся подключённым и входящие сохраняются, но нейросеть не отвечает.{' '}
                <Link
                  href="/dashboard/ai/agents"
                  className="font-semibold underline underline-offset-2"
                >
                  Пополнить баланс
                </Link>
                .
              </p>
            </div>
          </Alert>
        ) : null}

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHead
              index="01"
              kicker="деньги"
              title="Тариф Телеграм Секретарь"
              description="Подписка даёт право принимать сообщения в личных чатах. Ответы нейросети она не включает — их оплачивает общий баланс AI на странице агентов."
            />
            <Badge variant={subBadge.variant}>
              {isTrial && daysRemaining !== null
                ? `Пробный период · ${daysRemaining} ${plural(daysRemaining, ['день', 'дня', 'дней'])}`
                : subBadge.text}
            </Badge>
          </div>

          <div className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="land-display text-[20px] tracking-[-0.03em] text-black">
                {formatInt(tgPrice)} ₽/мес · до {maxConn}{' '}
                {plural(maxConn, ['аккаунт', 'аккаунта', 'аккаунтов'])} в тарифе
              </p>
              <p className="text-sm tabular-nums text-black/55">
                +{formatInt(extraSlotPrice)} ₽/мес за доп. слот
              </p>
            </div>
            <p className="mt-3 max-w-[70ch] text-sm leading-snug text-black/65">
              В тариф входит один бот-секретарь и до {maxConn} подключённых Telegram-аккаунтов.
              Нужен ещё аккаунт сверх лимита — докупите слот. AI-агент (инструкция для нейросети)
              настраивается отдельно на{' '}
              <Link href="/dashboard/ai/agents" className="font-semibold underline underline-offset-2">
                странице агентов
              </Link>
              .
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {!subActive && trialAvailable ? (
                <button
                  type="button"
                  disabled={busy === 'trial'}
                  onClick={() => void startTrial()}
                  className="land-btn-amber min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {busy === 'trial' ? 'Включаем…' : `Включить ${TRIAL_PERIOD_DAYS} бесплатных дней`}
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy === 'pay'}
                onClick={() => void paySubscription()}
                className={`min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${
                  !subActive && !trialAvailable ? 'land-btn-amber' : isTrial ? 'land-btn-amber' : 'land-btn-ghost'
                }`}
              >
                {busy === 'pay'
                  ? 'Переходим к оплате…'
                  : isTrial
                    ? `Оплатить ${formatInt(tgPrice)} ₽/мес`
                    : subActive
                      ? `Продлить на месяц · ${formatInt(tgPrice)} ₽`
                      : `Оплатить ${formatInt(tgPrice)} ₽/мес`}
              </button>
            </div>
          </div>
        </section>

        <section
          ref={connectSectionRef}
          id="podklyuchenie"
          className="scroll-mt-6 rounded-2xl border border-black/10 bg-white p-5 sm:p-6"
        >
          <SectionHead
            index="02"
            kicker="подключение"
            title="Как подключить"
            description="Бота создаёте вы в @BotFather, затем включаете его в настройках Telegram как секретаря для личных чатов."
          />

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                BotFather и токен
              </p>
              <ol className="mt-3 space-y-2.5">
                {[
                  <>
                    Откройте{' '}
                    <a
                      className="font-semibold underline underline-offset-2"
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noreferrer"
                    >
                      @BotFather
                    </a>{' '}
                    и отправьте /newbot — задайте имя и @username.
                  </>,
                  <>
                    Bot Settings → <strong>Business Mode</strong> → Turn on. Без этого Telegram не
                    отдаст боту сообщения.
                  </>,
                  <>Отправьте /token и скопируйте строку вида 123456:AA…</>,
                  <>Вставьте токен в форму справа и сохраните.</>,
                ].map((text, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-[11px] font-bold text-black">
                      {i + 1}
                    </span>
                    <span className="text-sm leading-snug text-black/70">{text}</span>
                  </li>
                ))}
              </ol>

              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                Настройки секретаря в Telegram
              </p>
              <ol className="mt-3 space-y-2.5">
                {[
                  <>
                    Telegram → Настройки → Бизнес → <strong>Автоматизация чатов</strong> → добавьте
                    своего бота.
                  </>,
                  <>
                    Выберите, в каких чатах секретарь работает: <strong>все личные чаты</strong>,
                    только выбранные или с исключениями.
                  </>,
                  <>
                    Выдайте боту <strong>разрешения</strong> читать и отвечать — без них входящие и
                    сделки в CRM не появятся (статус «нет прав ответа»).
                  </>,
                ].map((text, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/10 font-mono text-[11px] font-bold text-black/55">
                      {i + 1}
                    </span>
                    <span className="text-sm leading-snug text-black/70">{text}</span>
                  </li>
                ))}
              </ol>

              <a
                href="https://t.me/BotFather"
                target="_blank"
                rel="noreferrer"
                className="land-btn-ghost mt-4 inline-flex min-h-11 cursor-pointer px-4 text-sm"
              >
                Открыть @BotFather
                <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
            </div>

            {showTokenForm || aiBots.length === 0 ? (
              <form
                onSubmit={(e) => void connectBot(e)}
                className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Подключение бота
                </p>
                <label htmlFor="bot-token" className="mt-3 block text-sm font-medium text-black">
                  Токен бота
                </label>
                <input
                  id="bot-token"
                  ref={tokenInputRef}
                  type="password"
                  required
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="123456789:AAH..."
                  autoComplete="off"
                  disabled={busy === 'connect'}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 font-mono text-sm outline-none transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p className="mt-1.5 text-xs leading-snug text-black/55">
                  Токен выдаёт @BotFather по команде /token. Храним в зашифрованном виде.
                </p>
                <label htmlFor="bot-username" className="mt-4 block text-sm font-medium text-black">
                  @username бота — необязательно
                </label>
                <input
                  id="bot-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="my_secretary_bot"
                  autoComplete="off"
                  disabled={busy === 'connect'}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 font-mono text-sm outline-none transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="submit"
                    disabled={busy === 'connect' || !token.trim()}
                    className="land-btn min-h-11 cursor-pointer px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === 'connect' ? 'Подключаем…' : 'Сохранить бота'}
                    <Plus className="h-4 w-4" aria-hidden />
                  </button>
                  {aiBots.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setShowTokenForm(false)}
                      className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm"
                    >
                      Отмена
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Ещё один бот
                </p>
                <p className="mt-2 text-sm leading-snug text-black/65">
                  Один бот обслуживает до {maxConn} Telegram-аккаунтов. Второй бот нужен только
                  если хотите разделить бизнесы между разными секретарями.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setShowTokenForm(true);
                    setError('');
                    window.setTimeout(() => tokenInputRef.current?.focus(), 50);
                  }}
                  className="land-btn-ghost mt-3 min-h-11 cursor-pointer px-4 text-sm"
                >
                  Подключить ещё бота
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <SectionHead
            index="03"
            kicker="боты"
            title="Боты-секретари"
            description="Выберите бота — ниже появятся его аккаунты, агент и диалоги. Ссылка с ?bot= открывает нужного секретаря сразу."
          />

          {aiBots.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="font-semibold text-black">Бот-секретарь ещё не подключён</p>
              <p className="mx-auto mt-1 max-w-[56ch] text-sm text-black/55">
                Это обычный Telegram-бот с Business Mode. Он отвечает тем, кто написал вам в личку.
              </p>
              <button
                type="button"
                onClick={focusConnect}
                className="land-btn-amber mt-4 min-h-11 cursor-pointer px-4 text-sm"
              >
                Подключить первого бота
              </button>
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
              <table className="w-full min-w-[640px] border-collapse text-left">
                <thead className="bg-[#faf8f5]">
                  <tr>
                    <th className={TH}>Бот</th>
                    <th className={TH}>Состояние</th>
                    <th className={TH}>Диалоги</th>
                    <th className={TH}>Аккаунты</th>
                    <th className={`${TH} text-right`}>Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {aiBots.map((bot) => {
                    const selected = bot.id === selectedBotId;
                    return (
                      <tr
                        key={bot.id}
                        className={cn(
                          'cursor-pointer transition-colors duration-200 hover:bg-[#faf8f5]',
                          selected && 'bg-[#fffaf0]',
                        )}
                        onClick={() => selectBot(bot.id)}
                      >
                        <td className="px-3 py-3">
                          <p className="font-medium text-black">
                            @{bot.botUsername || 'бот без username'}
                            {selected ? (
                              <span className="ml-2 align-middle text-[11px] font-semibold uppercase tracking-[0.08em] text-[#166534]">
                                выбран
                              </span>
                            ) : null}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          {bot.status === 'active' ? (
                            <Badge variant="success">Работает</Badge>
                          ) : (
                            <Badge variant="warning">Остановлен</Badge>
                          )}
                        </td>
                        <td className="px-3 py-3 tabular-nums text-sm text-black/70">
                          <span className="inline-flex items-center gap-1.5">
                            <MessageSquare className="h-3.5 w-3.5 text-black/40" aria-hidden />
                            {formatInt(bot.conversationCount ?? 0)}
                          </span>
                        </td>
                        <td className="px-3 py-3 tabular-nums text-sm text-black/70">
                          {formatInt(bot.businessConnectionCount ?? 0)} из {maxConn}
                        </td>
                        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                          {deleteConfirmId === bot.id ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <span className="text-xs text-black/55">Снять webhook и удалить?</span>
                              <button
                                type="button"
                                disabled={busy === `del:${bot.id}`}
                                onClick={() => void deleteBot(bot.id)}
                                className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#c2410c]/40 bg-[#fff5f0] px-3 text-xs font-semibold text-[#c2410c]"
                              >
                                {busy === `del:${bot.id}` ? 'Удаляем…' : 'Да, удалить'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId('')}
                                className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65"
                              >
                                Отмена
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              disabled={Boolean(busy)}
                              onClick={() => setDeleteConfirmId(bot.id)}
                              aria-label={`Удалить бота @${bot.botUsername || bot.id}`}
                              className="inline-flex h-9 w-9 min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-full border border-black/15 text-black/55 hover:border-[#c2410c]/50 hover:text-[#c2410c] disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {selectedBot ? (
          <>
            <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
              <SectionHead
                index="04"
                kicker="аккаунты"
                title={`Аккаунты @${selectedBot.botUsername || '…'}`}
                description={`В тарифе ${bizCapacity?.included ?? maxConn} слотов. Сверх лимита — ${formatInt(extraSlotPrice)} ₽/мес за аккаунт.`}
              />

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy === 'buy-slot'}
                  onClick={async () => {
                    setBusy('buy-slot');
                    setError('');
                    try {
                      await startCheckout({
                        productCode: 'ai_tg_extra_conn',
                        periodMonths: 1,
                        quantity: 1,
                      });
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
                      setBusy('');
                    }
                  }}
                  className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm disabled:opacity-50"
                >
                  {busy === 'buy-slot'
                    ? 'Открываем оплату…'
                    : `Купить слот +1 · ${formatInt(extraSlotPrice)} ₽/мес`}
                </button>
                {selectedBot.botUsername ? (
                  <>
                    <code className="inline-flex items-center rounded-md border border-black/10 bg-[#faf8f5] px-2 py-1 font-mono text-xs">
                      @{selectedBot.botUsername}
                    </code>
                    <CopyButton value={`@${selectedBot.botUsername}`} label="Username" />
                  </>
                ) : null}
              </div>

              {businessAccounts.length === 0 ? (
                <p className="mt-4 text-sm text-black/55">
                  Пока нет. Telegram → Настройки → Бизнес → Автоматизация чатов → @
                  {selectedBot.botUsername || '…'}. Список обновится сам.
                </p>
              ) : (
                <ul className="mt-4 space-y-2">
                  {businessAccounts.map((a) => {
                    const label = a.ownerUsername
                      ? `@${a.ownerUsername}`
                      : a.ownerFirstName || `id ${a.ownerTelegramId}`;
                    return (
                      <li
                        key={a.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-black">{label}</p>
                          <p className="truncate text-xs text-black/55">tg {a.ownerTelegramId}</p>
                          {a.status === 'limited' ? (
                            <p className="mt-1 text-xs text-black/55">
                              В Telegram выдайте боту права читать и отвечать — иначе CRM не
                              получит входящие.
                            </p>
                          ) : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge
                            variant={
                              a.status === 'closed'
                                ? 'secondary'
                                : a.status === 'limited'
                                  ? 'warning'
                                  : 'success'
                            }
                          >
                            {a.status === 'closed'
                              ? 'отключён'
                              : a.status === 'limited'
                                ? 'нет прав ответа'
                                : 'подключён'}
                          </Badge>
                          {a.status !== 'closed' ? (
                            <button
                              type="button"
                              disabled={busy === `unlink-${a.id}`}
                              onClick={async () => {
                                setBusy(`unlink-${a.id}`);
                                setError('');
                                try {
                                  const res = await fetch(
                                    `/api/bots/${selectedBotId}/business-accounts/${a.id}`,
                                    { method: 'DELETE', headers: authHeaders() },
                                  );
                                  if (!res.ok) {
                                    const j = await res.json().catch(() => ({}));
                                    throw new Error(j.error || 'Не удалось отключить');
                                  }
                                  if (selectedBotId) await loadBotDetail(selectedBotId);
                                } catch (e) {
                                  setError(e instanceof Error ? e.message : 'Ошибка');
                                } finally {
                                  setBusy('');
                                }
                              }}
                              className="land-btn-ghost min-h-9 cursor-pointer px-3 text-xs disabled:opacity-50"
                            >
                              Отключить
                            </button>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
              <SectionHead
                index="05"
                kicker="агент"
                title="Агент по умолчанию"
                description="Один агент на бота — для всех аккаунтов. Без агента входящие пишутся в CRM, но AI не отвечает. Отдельный чат можно переопределить в диалогах ниже."
              />

              <select
                className={cn(selectClassName, 'mt-4 max-w-md')}
                value={defaultAiAgentId || ''}
                disabled={busy === 'default-agent' || agents.length === 0}
                onChange={async (e) => {
                  const aiAgentId = e.target.value || null;
                  setBusy('default-agent');
                  setError('');
                  try {
                    const res = await fetch(`/api/ai/agents/assign/bot/${selectedBotId}`, {
                      method: 'PATCH',
                      headers: authHeaders(),
                      body: JSON.stringify({ aiAgentId }),
                    });
                    const json = await res.json();
                    if (!res.ok) throw new Error(json.error || 'Не удалось назначить');
                    setDefaultAiAgentId(aiAgentId);
                    if (selectedBotId) await loadBotDetail(selectedBotId);
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
              {agents.length === 0 ? (
                <p className="mt-2 text-sm text-black/55">
                  Сначала создайте агента на{' '}
                  <Link href="/dashboard/ai/agents" className="font-semibold underline underline-offset-2">
                    странице агентов
                  </Link>
                  .
                </p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
              <SectionHead
                index="06"
                kicker="диалоги"
                title="Диалоги и handoff"
                description="Включайте, ставьте на паузу или передавайте оператору — для каждого чата отдельно."
              />

              {needsReviewCount > 0 ? (
                <Alert variant="info" className="mt-4">
                  {needsReviewCount} диалог(ов) с неоднозначным контактом в CRM — проверьте вручную.
                </Alert>
              ) : null}

              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="rounded-xl border border-black/10">
                  <p className="border-b border-black/10 px-4 py-3 text-sm font-semibold text-black">
                    Список диалогов
                  </p>
                  {conversations.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-black/55">
                      Пока нет диалогов. Подключите бота в Автоматизации чатов и напишите с аккаунта.
                    </p>
                  ) : (
                    <ul className="max-h-[28rem] overflow-y-auto">
                      {conversations.map((c, i) => {
                        const st = aiStatusLabel(c);
                        return (
                          <li key={c.id} className={cn(i > 0 && 'border-t border-black/10')}>
                            <button
                              type="button"
                              onClick={() => setActiveConvId(c.id)}
                              className={cn(
                                'flex w-full items-start justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-[#faf8f5]',
                                activeConvId === c.id && 'bg-[#fffaf0]',
                              )}
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="truncate text-sm font-medium text-black">
                                    {displayName(c)}
                                  </p>
                                  <Badge variant={st.variant}>{st.label}</Badge>
                                  {c.needsReview ? <Badge variant="warning">дубль?</Badge> : null}
                                </div>
                                <p className="mt-0.5 truncate text-xs text-black/55">
                                  {c.lastMessage?.content || 'Нет сообщений'}
                                </p>
                              </div>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="rounded-xl border border-black/10 px-4 py-4">
                  {!activeConv ? (
                    <p className="text-sm text-black/55">Выберите диалог слева, чтобы управлять AI.</p>
                  ) : (
                    <>
                      <p className="land-display text-base tracking-[-0.03em] text-black">
                        {displayName(activeConv)}
                      </p>
                      <p className="mt-1 text-xs text-black/55">
                        {activeConv.channel === 'telegram_business'
                          ? 'Телеграм Секретарь'
                          : activeConv.channel || 'Telegram'}
                      </p>

                      <div className="mt-4 space-y-1">
                        <p className="text-xs font-medium text-black/55">Агент для этого чата</p>
                        <select
                          className={selectClassName}
                          value={activeConv.aiAgentId || ''}
                          disabled={busy !== '' || agents.length === 0}
                          onChange={(e) =>
                            patchHandoff(
                              activeConv.id,
                              { aiAgentId: e.target.value || null },
                              'agent',
                            )
                          }
                        >
                          <option value="">
                            {defaultAiAgentId
                              ? `Как у бота (${agents.find((a) => a.id === defaultAiAgentId)?.name || '…'})`
                              : 'Нет агента (AI выкл)'}
                          </option>
                          {agents.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={
                            busy !== '' ||
                            (!activeConv.aiDisabled &&
                              activeConv.mode !== 'human' &&
                              !(
                                activeConv.pausedUntil &&
                                new Date(activeConv.pausedUntil) > new Date()
                              ))
                          }
                          onClick={() =>
                            patchHandoff(
                              activeConv.id,
                              { aiDisabled: false, pause: false, mode: 'ai' },
                              'on',
                            )
                          }
                          className="land-btn min-h-9 cursor-pointer px-3 text-xs disabled:opacity-50"
                        >
                          {busy === 'on' ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Play className="h-4 w-4" aria-hidden />
                          )}
                          Вкл AI
                        </button>
                        <button
                          type="button"
                          disabled={busy !== '' || activeConv.aiDisabled}
                          onClick={() => patchHandoff(activeConv.id, { pause: true }, 'pause')}
                          className="land-btn-ghost min-h-9 cursor-pointer px-3 text-xs disabled:opacity-50"
                        >
                          {busy === 'pause' ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <Pause className="h-4 w-4" aria-hidden />
                          )}
                          Пауза 1ч
                        </button>
                        <button
                          type="button"
                          disabled={busy !== '' || activeConv.aiDisabled}
                          onClick={() => patchHandoff(activeConv.id, { aiDisabled: true }, 'off')}
                          className="land-btn-ghost min-h-9 cursor-pointer px-3 text-xs disabled:opacity-50"
                        >
                          {busy === 'off' ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <PowerOff className="h-4 w-4" aria-hidden />
                          )}
                          Выкл
                        </button>
                        {activeConv.needsReview ? (
                          <button
                            type="button"
                            disabled={busy !== ''}
                            onClick={() =>
                              patchHandoff(activeConv.id, { needsReview: false }, 'review')
                            }
                            className="land-btn-ghost min-h-9 cursor-pointer px-3 text-xs disabled:opacity-50"
                          >
                            {busy === 'review' ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                            ) : (
                              <Power className="h-4 w-4" aria-hidden />
                            )}
                            Снять флаг дубля
                          </button>
                        ) : null}
                      </div>

                      {activeConv.pausedUntil &&
                      new Date(activeConv.pausedUntil).getTime() > Date.now() ? (
                        <p className="mt-2 text-xs text-black/55">
                          Пауза до {new Date(activeConv.pausedUntil).toLocaleString('ru-RU')}
                        </p>
                      ) : null}

                      <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-lg border border-black/10 p-3">
                        {messages.length === 0 ? (
                          <p className="text-sm text-black/55">Нет сообщений</p>
                        ) : (
                          messages.map((m) => (
                            <div
                              key={m.id}
                              className={cn(
                                'rounded-md px-3 py-2 text-sm',
                                m.role === 'user' && 'bg-[#faf8f5]',
                                m.role === 'assistant' && 'bg-black/5',
                                m.role === 'operator' && 'bg-[#fffaf0]',
                                m.role === 'system' && 'text-black/55',
                              )}
                            >
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-black/45">
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
                </div>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}
