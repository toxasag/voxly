'use client';

import { useCallback, useEffect, useState } from 'react';
import { cn, selectClassName } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bot, Loader2, Plus, Trash2, Upload, RefreshCw } from 'lucide-react';
import { PRICING } from '@voxly/shared';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import {
  AiAgentsPortalHero,
  type AiBalanceState,
} from '@/components/portal/ai-agents-portal-hero';

interface AgentRow {
  id: string;
  name: string;
  systemPrompt: string | null;
  status: string;
  model?: string | null;
  effectiveModel?: string;
  defaultModel?: string;
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
  providerCostRub?: number;
}

interface UsageByChannel {
  channel: string | null;
  label: string;
  requests: number;
  tokens: number;
  chargedRub: number;
  providerCostRub?: number;
}

interface UsageRecentRow {
  id: string;
  aiAgentId: string | null;
  agentName: string;
  model: string;
  tokens: number;
  chargedRub: number;
  requestType: string;
  createdAt: string;
}

interface UsageResponse {
  days: number;
  balanceRub: number;
  byAgent: UsageByAgent[];
  byChannel?: UsageByChannel[];
  recent?: UsageRecentRow[];
}

interface AgentCapacity {
  agentSlots: number;
  activeAgents: number;
  freeSlots: number;
  priceMonthly: number;
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  text: 'Текст',
  transcribe: 'Расшифровка голоса',
  vision: 'Распознавание изображения',
};

const TOPUP_MIN_RUB = 500;
const TOPUP_PRESETS = [500, 1000, 3000, 5000] as const;

function formatRub(value: number): string {
  return value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const MODEL_OPTIONS = [
  { value: '', label: 'По умолчанию платформы' },
  { value: 'google/gemini-2.5-flash', label: 'google/gemini-2.5-flash (быстрая)' },
  { value: 'google/gemini-2.5-flash-lite', label: 'google/gemini-2.5-flash-lite' },
  { value: 'openai/gpt-4o-mini', label: 'openai/gpt-4o-mini' },
  { value: 'openai/gpt-4o', label: 'openai/gpt-4o (premium)' },
] as const;

function wonStagesLabel(stages?: string[]): string {
  if (!stages?.length) return 'Успешная сделка';
  return stages
    .map((s) =>
      s === 'USPESHNAYA_SDELKA' || s === 'CUSTOMER' ? 'Успешная сделка' : s,
    )
    .join(', ');
}

export default function AiAgentsPage() {
  const router = useRouter();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [defaultChatModel, setDefaultChatModel] = useState('google/gemini-2.5-flash');
  const [bots, setBots] = useState<BotRow[]>([]);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editModel, setEditModel] = useState('');
  const [filesByAgent, setFilesByAgent] = useState<Record<string, KnowledgeFile[]>>({});
  const [examplesByAgent, setExamplesByAgent] = useState<Record<string, SalesExample[]>>({});
  const [topupAmount, setTopupAmount] = useState('1000');
  const [days, setDays] = useState(30);
  const [usageBusy, setUsageBusy] = useState(false);
  const [capacity, setCapacity] = useState<AgentCapacity | null>(null);

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
        fetch(`/api/ai/agents/usage?days=${days}`, { headers: authHeaders() }),
      ]);
      if (!agentsRes.ok) throw new Error('Не удалось загрузить агентов');
      const agentsJson = await agentsRes.json();
      setAgents(agentsJson.agents || []);
      if (agentsJson.capacity) {
        setCapacity(agentsJson.capacity as AgentCapacity);
      }
      if (typeof agentsJson.defaultChatModel === 'string' && agentsJson.defaultChatModel) {
        setDefaultChatModel(agentsJson.defaultChatModel);
      }
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
      setUsageBusy(false);
    }
  }, [router, days]);

  useEffect(() => {
    void load();
  }, [load]);

  const beginEdit = (agent: AgentRow) => {
    setExpandedId(agent.id);
    setEditName(agent.name);
    setEditPrompt(agent.systemPrompt || '');
    setEditModel(agent.model || '');
    void loadAgentExtras(agent.id);
  };

  const saveAgent = async (agentId: string) => {
    if (!editName.trim()) {
      setError('Укажите имя агента');
      return;
    }
    setBusy(`save-${agentId}`);
    setError('');
    try {
      const res = await fetch(`/api/ai/agents/${agentId}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          name: editName.trim(),
          systemPrompt: editPrompt.trim() || null,
          model: editModel.trim() || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось сохранить');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const createAgent = async () => {
    if (!name.trim()) {
      setError('Укажите имя агента');
      return;
    }
    if (capacity && capacity.freeSlots < 1) {
      setError(
        `Нет свободных слотов. Оплатите AI-агента (${capacity.priceMonthly} ₽/мес) и повторите.`,
      );
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
      if (!res.ok) {
        if (json.capacity) setCapacity(json.capacity as AgentCapacity);
        throw new Error(json.error || 'Не удалось создать');
      }
      setName('');
      setPrompt('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const buyAgentSlot = () => {
    setBusy('buy-agent');
    setError('');
    void startCheckout({ productCode: 'ai_agent', quantity: 1, periodMonths: 1 }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setBusy('');
    });
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

  const toggleExpand = async (agent: AgentRow) => {
    if (expandedId === agent.id) {
      setExpandedId(null);
      return;
    }
    beginEdit(agent);
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
      <AppShell maxWidth="6xl">
        <LoadingState />
      </AppShell>
    );
  }

  const usageDays = usage?.days ?? 30;
  const byAgentRows = usage?.byAgent ?? [];
  const byChannelRows = usage?.byChannel ?? [];
  const recentRows = usage?.recent ?? [];
  const spentRub = byAgentRows.reduce((sum, row) => sum + row.chargedRub, 0);
  const channelTotalRub = byChannelRows.reduce((sum, row) => sum + row.chargedRub, 0);
  const balanceRub = usage?.balanceRub ?? 0;
  const dailyBurn = spentRub > 0 ? spentRub / Math.max(usageDays, 1) : 0;

  const balanceState: AiBalanceState =
    spentRub <= 0 ? 'idle' : balanceRub <= 0 ? 'empty' : dailyBurn > 0 && balanceRub < dailyBurn * 7 ? 'low' : 'ok';

  const balanceHint =
    balanceState === 'idle'
      ? `За последние ${usageDays} дн. списаний не было — платите только когда AI реально отвечает.`
      : balanceState === 'empty'
        ? 'Баланс на нуле: AI больше не отвечает клиентам. Пополните, чтобы включить его снова.'
        : balanceState === 'low'
          ? `При текущем расходе (${formatRub(dailyBurn)} ₽ в день) баланса хватит примерно на ${Math.max(1, Math.floor(balanceRub / dailyBurn))} дн.`
          : `При текущем расходе (${formatRub(dailyBurn)} ₽ в день) баланса хватит примерно на ${Math.floor(balanceRub / dailyBurn)} дн.`;

  const topupAmountRub = Math.round(Number(topupAmount.replace(/\s/g, '').replace(',', '.')));
  const topupValid = Number.isFinite(topupAmountRub) && topupAmountRub >= TOPUP_MIN_RUB;

  const submitTopup = () => {
    if (!topupValid) return;
    setBusy('topup');
    setError('');
    void startCheckout({ productCode: 'ai_topup', amountRub: topupAmountRub }).catch((e) => {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setBusy('');
    });
  };

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
        <AiAgentsPortalHero
          headline="AI-агенты, которые отвечают вашим клиентам"
          subtitle="Один агент — 500 ₽/мес. Задайте характер, дайте файлы о бизнесе и обучите на успешных сделках. Пока агент не назначен на канал — он молчит. Ответы списываются с баланса AI."
          facts={[
            {
              label: 'Слоты агентов',
              value: capacity
                ? `${capacity.activeAgents}/${capacity.agentSlots}`
                : String(agents.length),
            },
            { label: `Расход за ${usageDays} дн.`, value: `${formatRub(spentRub)} ₽` },
            {
              label: 'Цена агента',
              value: `${(capacity?.priceMonthly ?? PRICING.AI_AGENT_MONTHLY).toLocaleString('ru-RU')} ₽/мес`,
            },
          ]}
          balanceLabel={formatRub(balanceRub)}
          balanceState={balanceState}
          balanceHint={balanceHint}
        />

        {error && <Alert variant="error">{error}</Alert>}

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            00 · тариф агента
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Слоты AI-агентов</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-black/60">
            Каждый агент занимает один оплаченный слот ({PRICING.AI_AGENT_MONTHLY} ₽/мес). Свободных
            слотов:{' '}
            <span className="font-semibold text-black tabular-nums">
              {capacity?.freeSlots ?? '—'}
            </span>
            . Ответы клиентам по-прежнему списываются с баланса AI ниже.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={buyAgentSlot}
              disabled={busy === 'buy-agent'}
              className="land-btn-amber min-h-11 cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy === 'buy-agent' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Открываем оплату…
                </>
              ) : (
                `Оплатить агента · ${PRICING.AI_AGENT_MONTHLY} ₽/мес`
              )}
            </button>
          </div>
        </section>

        <section id="balance" className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            01 · пополнение
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Пополнить баланс AI</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-black/60">
            Минимальная сумма пополнения — {TOPUP_MIN_RUB} ₽. Деньги лежат на кошельке и
            списываются только за фактические ответы AI.
          </p>

          <div className="mt-4 grid gap-4 sm:max-w-[520px]">
            <div className="flex flex-wrap gap-2">
              {TOPUP_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setTopupAmount(String(preset))}
                  aria-pressed={topupAmountRub === preset}
                  className={cn(
                    'min-h-9 min-w-9 rounded-lg border px-3 text-sm tabular-nums transition-colors duration-200',
                    topupAmountRub === preset
                      ? 'border-black/40 bg-[#faf8f5] font-semibold text-black'
                      : 'border-black/10 text-black/70 hover:border-black/30',
                  )}
                >
                  {preset.toLocaleString('ru-RU')} ₽
                </button>
              ))}
            </div>

            <div>
              <label
                htmlFor="ai-topup-amount"
                className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
              >
                Сумма пополнения, ₽ (минимум {TOPUP_MIN_RUB})
              </label>
              <Input
                id="ai-topup-amount"
                inputMode="numeric"
                value={topupAmount}
                onChange={(e) => setTopupAmount(e.target.value)}
                placeholder="1000"
                className="mt-1 min-h-11 border-black/10 bg-white tabular-nums focus:border-black/40"
              />
            </div>

            <div>
              <button
                type="button"
                onClick={submitTopup}
                disabled={!topupValid || busy === 'topup'}
                className="land-btn-amber min-h-11 w-full cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                {busy === 'topup' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    Открываем оплату…
                  </>
                ) : (
                  'Перейти к оплате'
                )}
              </button>
              <p aria-live="polite" className="mt-2 text-xs text-black/55">
                {busy === 'topup'
                  ? 'Открываем страницу оплаты, не закрывайте вкладку.'
                  : !topupValid
                    ? `Кнопка станет активной, когда сумма будет не меньше ${TOPUP_MIN_RUB} ₽.`
                    : `К оплате: ${formatRub(topupAmountRub)} ₽.`}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            01 · расход
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">
            Куда ушли деньги за {usageDays} дн.
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm text-black/60">
            Списания с кошелька: сначала по агентам, затем по каналам, где агент отвечал.
          </p>

          <div className="mt-4">
            <p
              id="usage-period-label"
              className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
            >
              Период
            </p>
            <div
              role="group"
              aria-labelledby="usage-period-label"
              className="mt-1 flex flex-wrap gap-2"
            >
              {[7, 30, 90].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={days === preset}
                  disabled={usageBusy}
                  onClick={() => {
                    if (days === preset) return;
                    setUsageBusy(true);
                    setDays(preset);
                  }}
                  className={cn(
                    'min-h-9 min-w-9 rounded-lg border px-3 text-sm tabular-nums transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50',
                    days === preset
                      ? 'border-black/40 bg-[#faf8f5] font-semibold text-black'
                      : 'border-black/10 text-black/70 hover:border-black/30',
                  )}
                >
                  {preset} дн.
                </button>
              ))}
            </div>
            <p aria-live="polite" className="mt-2 text-xs text-black/55">
              {usageBusy ? 'Пересчитываем расход за выбранный период…' : `Показан расход за ${usageDays} дн.`}
            </p>
          </div>

          <div className="mt-5">
            <h3 className="text-sm font-semibold text-black">По агентам</h3>
            {byAgentRows.length === 0 ? (
              <p className="mt-2 rounded-xl bg-[#faf8f5] p-4 text-sm text-black/60">
                За этот период списаний не было. Как только агент ответит клиенту, здесь появится
                строка с суммой.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-sm">
                  <thead>
                    <tr className="text-left">
                      <th className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                        Агент
                      </th>
                      <th className="px-3 pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                        Запросов
                      </th>
                      <th className="px-3 pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                        Токенов
                      </th>
                      <th className="px-3 pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                        Списано
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {byAgentRows.map((row) => (
                      <tr key={row.aiAgentId || 'none'}>
                        <td className="border-t border-black/5 px-3 py-2.5 font-medium">
                          {row.name}
                        </td>
                        <td className="border-t border-black/5 px-3 py-2.5 text-right tabular-nums text-black/70">
                          {row.requests.toLocaleString('ru-RU')}
                        </td>
                        <td className="border-t border-black/5 px-3 py-2.5 text-right tabular-nums text-black/70">
                          {row.tokens.toLocaleString('ru-RU')}
                        </td>
                        <td className="border-t border-black/5 px-3 py-2.5 text-right font-semibold tabular-nums text-[#c2410c]">
                          {formatRub(row.chargedRub)} ₽
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-semibold text-black">По каналам</h3>
            {byChannelRows.length === 0 ? (
              <p className="mt-2 rounded-xl bg-[#faf8f5] p-4 text-sm text-black/60">
                Разбивки по каналам за этот период нет.
              </p>
            ) : (
              <>
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr className="text-left">
                        <th className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                          Канал
                        </th>
                        <th className="px-3 pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                          Запросов
                        </th>
                        <th className="px-3 pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                          Списано
                        </th>
                        <th className="px-3 pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                          Доля
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {byChannelRows.map((row) => (
                        <tr key={row.channel || 'unknown'}>
                          <td className="border-t border-black/5 px-3 py-2.5">
                            {row.channel ? (
                              <span className="font-medium">{row.label}</span>
                            ) : (
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">Не определён</span>
                                <Badge variant="secondary">старые списания</Badge>
                              </span>
                            )}
                          </td>
                          <td className="border-t border-black/5 px-3 py-2.5 text-right tabular-nums text-black/70">
                            {row.requests.toLocaleString('ru-RU')}
                          </td>
                          <td className="border-t border-black/5 px-3 py-2.5 text-right font-semibold tabular-nums text-[#c2410c]">
                            {formatRub(row.chargedRub)} ₽
                          </td>
                          <td className="border-t border-black/5 px-3 py-2.5 text-right tabular-nums text-black/70">
                            {channelTotalRub > 0
                              ? `${Math.round((row.chargedRub / channelTotalRub) * 100)}%`
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {byChannelRows.some((row) => !row.channel) && (
                  <p className="mt-2 text-xs leading-snug text-black/55">
                    Строка «Не определён» — списания, сделанные до того, как мы начали записывать
                    канал. Восстановить их канал уже нельзя, поэтому они показаны отдельно и не
                    приписаны ни к одному каналу.
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            02 · история
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Последние списания</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-black/60">
            До 40 последних операций — чтобы можно было сверить конкретный ответ AI с суммой.
          </p>

          {recentRows.length === 0 ? (
            <p className="mt-4 rounded-xl bg-[#faf8f5] p-4 text-sm text-black/60">
              Операций пока нет. Назначьте агента на бота ниже — и здесь появятся списания за
              каждый его ответ.
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead>
                  <tr className="text-left">
                    <th className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                      Когда
                    </th>
                    <th className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                      Агент
                    </th>
                    <th className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                      Модель
                    </th>
                    <th className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                      Тип запроса
                    </th>
                    <th className="px-3 pb-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                      Списано
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recentRows.map((row) => (
                    <tr key={row.id}>
                      <td className="border-t border-black/5 px-3 py-2.5 whitespace-nowrap tabular-nums text-black/70">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="border-t border-black/5 px-3 py-2.5 font-medium">
                        {row.agentName}
                      </td>
                      <td className="border-t border-black/5 px-3 py-2.5 font-mono text-xs text-black/60">
                        {row.model}
                      </td>
                      <td className="border-t border-black/5 px-3 py-2.5 text-black/70">
                        {REQUEST_TYPE_LABEL[row.requestType] ?? row.requestType}
                      </td>
                      <td className="border-t border-black/5 px-3 py-2.5 text-right font-semibold tabular-nums text-[#c2410c]">
                        {formatRub(row.chargedRub)} ₽
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            03 · новый агент
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Создать агента</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-black/60">
            Имя нужно только вам, чтобы отличать агентов. Инструкция — это текст о том, как агент
            должен разговаривать с клиентами; её можно дописать позже.
          </p>

          <div className="mt-4 grid gap-4 sm:max-w-[620px]">
            <div>
              <label
                htmlFor="new-agent-name"
                className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
              >
                Имя агента
              </label>
              <Input
                id="new-agent-name"
                placeholder="Например, Продавец"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 min-h-11 border-black/10 bg-white focus:border-black/40"
              />
            </div>

            <div>
              <label
                htmlFor="new-agent-prompt"
                className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
              >
                Инструкция для агента (необязательно)
              </label>
              <textarea
                id="new-agent-prompt"
                className="mt-1 min-h-[120px] w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm transition-colors duration-200 focus:border-black/40"
                placeholder="Ты вежливый продавец салона. Отвечай коротко, всегда предлагай записаться."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>

            <div>
              <button
                type="button"
                onClick={() => void createAgent()}
                disabled={
                  busy === 'create' ||
                  !name.trim() ||
                  Boolean(capacity && capacity.freeSlots < 1)
                }
                className="land-btn-amber min-h-11 cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === 'create' ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Plus className="h-4 w-4" aria-hidden />
                )}
                Создать агента
              </button>
              <p aria-live="polite" className="mt-2 text-xs text-black/55">
                {busy === 'create'
                  ? 'Создаём агента…'
                  : capacity && capacity.freeSlots < 1
                    ? `Сначала оплатите слот агента (${capacity.priceMonthly} ₽/мес) в блоке «Тариф агента».`
                    : !name.trim()
                      ? 'Кнопка станет активной, когда вы укажете имя агента.'
                      : 'После создания назначьте агента на канал ниже — иначе он не отвечает.'}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            04 · агенты
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">Ваши агенты</h2>
          <p className="mt-1 max-w-[70ch] text-sm text-black/60">
            У каждого агента своя инструкция, модель, файлы базы знаний и примеры удачных
            переписок из CRM.
          </p>

          {agents.length === 0 ? (
            <div className="mt-4 rounded-xl bg-[#faf8f5] p-6 text-center">
              <Bot className="mx-auto h-8 w-8 text-black/30" aria-hidden />
              <p className="mt-2 text-sm font-semibold text-black">Агентов пока нет</p>
              <p className="mx-auto mt-1 max-w-[52ch] text-sm text-black/60">
                Агент — это набор правил, по которым AI отвечает вашим клиентам. Создайте первого
                в блоке «Новый агент» выше: достаточно имени.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              {agents.map((a) => {
                const open = expandedId === a.id;
                const files = filesByAgent[a.id] || [];
                const examples = examplesByAgent[a.id] || [];
                return (
                  <div key={a.id} className="rounded-xl border border-black/10 bg-[#faf8f5] p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-black">{a.name}</p>
                          <Badge variant={a.status === 'active' ? 'success' : 'secondary'}>
                            {a.status === 'active' ? 'Активен' : 'Выключен'}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 max-w-[70ch] text-sm text-black/60">
                          {a.systemPrompt || 'Своей инструкции нет — работает на настройках платформы'}
                        </p>
                        <p className="mt-1 text-xs text-black/55">
                          Модель:{' '}
                          <span className="font-mono text-black/75">
                            {a.effectiveModel || a.model || defaultChatModel}
                          </span>
                          {!a.model ? ' · по умолчанию платформы' : ''}
                        </p>
                        <p className="mt-1 text-xs tabular-nums text-black/55">
                          Назначен на {a.botDefaultCount ?? 0} акк. · {a.conversationCount ?? 0}{' '}
                          чатов · файлов {a.knowledgeFileCount ?? 0} · примеров продаж{' '}
                          {a.salesExampleCount ?? 0}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void toggleExpand(a)}
                        aria-expanded={open}
                        className="land-btn-ghost min-h-9 min-w-9 cursor-pointer text-sm"
                      >
                        {open ? 'Свернуть' : 'Настроить'}
                      </button>
                    </div>

                    {open && (
                      <div className="mt-4 space-y-5 border-t border-black/10 pt-4">
                        <div className="grid gap-3 sm:max-w-[620px]">
                          <div>
                            <label
                              htmlFor={`agent-name-${a.id}`}
                              className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
                            >
                              Имя агента
                            </label>
                            <Input
                              id={`agent-name-${a.id}`}
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Например, Продавец"
                              className="mt-1 min-h-11 border-black/10 bg-white focus:border-black/40"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor={`agent-model-${a.id}`}
                              className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
                            >
                              Модель
                            </label>
                            <select
                              id={`agent-model-${a.id}`}
                              className={cn(selectClassName, 'mt-1 min-h-11 focus:border-black/40')}
                              value={editModel}
                              onChange={(e) => setEditModel(e.target.value)}
                            >
                              {MODEL_OPTIONS.map((opt) => (
                                <option key={opt.value || 'default'} value={opt.value}>
                                  {opt.value === ''
                                    ? `По умолчанию (${defaultChatModel})`
                                    : opt.label}
                                </option>
                              ))}
                            </select>
                            <p className="mt-1 text-xs text-black/55">
                              Сейчас для ответов:{' '}
                              <span className="font-mono text-black/75">
                                {editModel || defaultChatModel}
                              </span>
                            </p>
                          </div>

                          <div>
                            <label
                              htmlFor={`agent-prompt-${a.id}`}
                              className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
                            >
                              Инструкция для агента
                            </label>
                            <textarea
                              id={`agent-prompt-${a.id}`}
                              className="mt-1 min-h-[140px] w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm transition-colors duration-200 focus:border-black/40"
                              placeholder="Ты вежливый продавец салона. Отвечай коротко, всегда предлагай записаться."
                              value={editPrompt}
                              onChange={(e) => setEditPrompt(e.target.value)}
                            />
                          </div>

                          <div>
                            <button
                              type="button"
                              disabled={busy === `save-${a.id}` || !editName.trim()}
                              onClick={() => void saveAgent(a.id)}
                              className="land-btn-amber min-h-11 cursor-pointer text-sm disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy === `save-${a.id}` ? (
                                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                              ) : null}
                              Сохранить
                            </button>
                            <p aria-live="polite" className="mt-2 text-xs text-black/55">
                              {busy === `save-${a.id}`
                                ? 'Сохраняем…'
                                : !editName.trim()
                                  ? 'Кнопка станет активной, когда имя агента не пустое.'
                                  : 'Изменения начнут действовать со следующего ответа агента.'}
                            </p>
                          </div>
                        </div>

                        <label
                          htmlFor={`agent-learn-${a.id}`}
                          className="flex items-start gap-2 text-sm text-black/75"
                        >
                          <input
                            id={`agent-learn-${a.id}`}
                            type="checkbox"
                            className="mt-0.5"
                            checked={a.learnFromWonDeals !== false}
                            disabled={busy === `learn-${a.id}`}
                            onChange={(e) => void toggleLearn(a, e.target.checked)}
                          />
                          Учиться на успешных сделках ({wonStagesLabel(a.wonStages)})
                        </label>

                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-black">Файлы базы знаний</h3>
                            <label className="land-btn-ghost inline-flex min-h-9 cursor-pointer items-center gap-1.5 text-xs">
                              <Upload className="h-3.5 w-3.5" aria-hidden />
                              Загрузить .txt / .md / .pdf
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
                            <p className="mt-2 rounded-lg bg-white p-3 text-sm text-black/60">
                              Файлов пока нет. Загрузите прайс, условия доставки или ответы на
                              частые вопросы — агент будет отвечать по ним.
                            </p>
                          ) : (
                            <ul className="mt-2 space-y-2">
                              {files.map((f) => (
                                <li
                                  key={f.id}
                                  className="flex items-center justify-between gap-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-medium text-black">{f.filename}</p>
                                    <p className="text-xs text-black/55">
                                      {f.status}
                                      {f.chunkCount ? ` · ${f.chunkCount} фрагментов` : ''}
                                      {f.error ? ` · ${f.error}` : ''}
                                    </p>
                                  </div>
                                  <button
                                    type="button"
                                    aria-label={`Удалить файл ${f.filename}`}
                                    disabled={busy === `kbd-${f.id}`}
                                    onClick={() => void deleteKnowledge(a.id, f.id)}
                                    className="min-h-9 min-w-9 shrink-0 rounded-lg border border-black/10 p-2 text-black/60 transition-colors duration-200 hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-50"
                                  >
                                    {busy === `kbd-${f.id}` ? (
                                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                                    ) : (
                                      <Trash2 className="h-4 w-4" aria-hidden />
                                    )}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>

                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-black">
                              Примеры с успешных сделок
                            </h3>
                            <button
                              type="button"
                              disabled={busy === `sync-${a.id}`}
                              onClick={() => void syncSales(a.id)}
                              className="land-btn-ghost min-h-9 cursor-pointer text-xs disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {busy === `sync-${a.id}` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              ) : (
                                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                              )}
                              Обновить обучение
                            </button>
                          </div>
                          {examples.length === 0 ? (
                            <p className="mt-2 rounded-lg bg-white p-3 text-sm text-black/60">
                              Примеров пока нет. Переведите сделку в CRM на этап «Успешная сделка»
                              и нажмите «Обновить обучение» — агент возьмёт оттуда удачные фразы
                              продавца.
                            </p>
                          ) : (
                            <ul className="mt-2 space-y-2">
                              {examples.map((ex) => (
                                <li
                                  key={ex.id}
                                  className="rounded-lg border border-black/10 bg-white px-3 py-2 text-sm"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                                      Клиент
                                    </p>
                                    <button
                                      type="button"
                                      aria-label="Удалить пример"
                                      disabled={busy === `ex-${ex.id}`}
                                      onClick={() => void deleteExample(a.id, ex.id)}
                                      className="min-h-9 min-w-9 shrink-0 rounded-lg border border-black/10 p-2 text-black/60 transition-colors duration-200 hover:border-black/30 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      {busy === `ex-${ex.id}` ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                      )}
                                    </button>
                                  </div>
                                  <p className="line-clamp-2 text-black/75">{ex.userText}</p>
                                  <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                                    Продавец
                                  </p>
                                  <p className="line-clamp-2 text-black/75">{ex.operatorText}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            05 · назначение
          </p>
          <h2 className="land-display mt-1 text-xl tracking-[-0.03em]">
            Кто отвечает в каком аккаунте
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm text-black/60">
            Выбранный агент отвечает во всех чатах этого аккаунта. В отдельном диалоге агента можно
            переопределить в карточке чата.
          </p>

          {bots.length === 0 ? (
            <div className="mt-4 rounded-xl bg-[#faf8f5] p-4 text-sm text-black/60">
              Подключённых аккаунтов нет — агенту негде отвечать. Подключите{' '}
              <Link href="/dashboard/ai" className="underline underline-offset-2">
                Телеграм Секретарь
              </Link>
              ,{' '}
              <Link href="/dashboard/ai/gramjs" className="underline underline-offset-2">
                Telegram
              </Link>{' '}
              или{' '}
              <Link href="/dashboard/ai/whatsapp" className="underline underline-offset-2">
                WhatsApp
              </Link>
              .
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {bots.map((b) => {
                const channelLabel =
                  b.botType === 'ai_gramjs'
                    ? 'Telegram'
                    : b.botType === 'ai_wa'
                      ? 'WhatsApp'
                      : 'Телеграм Секретарь';
                const accountLabel =
                  b.botType === 'ai_wa'
                    ? b.displayName || b.botUsername || '…'
                    : `@${b.botUsername || '…'}`;
                return (
                  <div
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                        {channelLabel}
                      </p>
                      <p className="text-sm font-medium text-black">{accountLabel}</p>
                    </div>
                    <div className="min-w-0">
                      <label
                        htmlFor={`bot-agent-${b.id}`}
                        className="block text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45"
                      >
                        Агент аккаунта
                      </label>
                      <select
                        id={`bot-agent-${b.id}`}
                        className={cn(
                          selectClassName,
                          'mt-1 min-h-11 w-auto bg-white focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50',
                        )}
                        value={b.defaultAiAgentId || ''}
                        disabled={busy === `bot-${b.id}` || agents.length === 0}
                        onChange={(e) =>
                          void assignToBot(b.id, e.target.value ? e.target.value : null)
                        }
                      >
                        <option value="">AI выключен (агент не выбран)</option>
                        {agents.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                      </select>
                      {agents.length === 0 && (
                        <p className="mt-1 text-xs text-black/55">
                          Выбор недоступен: сначала создайте агента выше.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
