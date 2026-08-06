'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Pencil, RefreshCw, Smartphone, Trash2 } from 'lucide-react';
import { PRICING, TRIAL_PERIOD_DAYS } from '@voxly/shared';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { Badge } from '@/components/ui/badge';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { AiWhatsappHero } from '@/components/portal/ai-whatsapp-hero';
import { PartnerBalanceApply } from '@/components/portal/partner-balance-apply';
import { usePartnerBalanceApply } from '@/hooks/use-partner-balance-apply';

interface WaAccount {
  id: string;
  name: string;
  displayName?: string;
  slug?: string;
  phoneNumberId: string | null;
  status: string;
  connected: boolean;
  updatedAt: string;
}

interface AccountsResponse {
  priceMonthly?: number;
  trialDays?: number;
  billingWarning?: string | null;
  requiresPayment?: boolean;
  trialAvailable?: boolean;
  evolutionConfigured?: boolean;
  evolutionHint?: string | null;
  waAddon?: { isActive: boolean; activeUntil: string; isTrial: boolean } | null;
  accounts: WaAccount[];
  error?: string;
  hint?: string;
}

interface QrStatus {
  status?: string;
  qr?: string | null;
  error?: string | null;
  hint?: string;
  phoneNumberId?: string | null;
  displayName?: string;
  name?: string;
}

interface AiContext {
  agents: number;
  walletRub: number;
}

type ConnectPhase = 'idle' | 'preparing' | 'qr_ready' | 'authorized' | 'expired' | 'failed';

const POLL_INTERVAL_MS = 2500;
const QR_WINDOW_MS = 3 * 60 * 1000;
const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';

const PHASE_UI: Record<ConnectPhase, { label: string; hint: string }> = {
  idle: {
    label: 'Активного подключения нет',
    hint: 'Нажмите «Показать QR» — код появится здесь и будет обновляться, пока вы его не отсканируете.',
  },
  preparing: {
    label: 'Готовим подключение',
    hint: 'Создаём сессию на сервере WhatsApp. Обычно это 5–15 секунд, QR появится сам — страницу перезагружать не нужно.',
  },
  qr_ready: {
    label: 'Ждём скан QR-кода',
    hint: 'Откройте WhatsApp на телефоне и отсканируйте код. Код живёт около минуты и обновляется автоматически.',
  },
  authorized: {
    label: 'Номер подключён',
    hint: 'WhatsApp связан с Voxly. Входящие сообщения уже попадают в CRM.',
  },
  expired: {
    label: 'QR-код устарел',
    hint: 'За 3 минуты код никто не отсканировал, и мы перестали его обновлять. Нажмите «Показать новый QR» и отсканируйте заново.',
  },
  failed: {
    label: 'Подключить не получилось',
    hint: 'Сессия не поднялась. Попробуйте показать новый QR — если ошибка повторяется, напишите в поддержку.',
  },
};

function formatRub(n: number | null | undefined): string {
  const v = Number(n) || 0;
  return v.toLocaleString('ru-RU', {
    minimumFractionDigits: v > 0 && v < 100 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU');
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
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

export default function WhatsappChannelPage() {
  const router = useRouter();
  const [data, setData] = useState<AccountsResponse | null>(null);
  const [context, setContext] = useState<AiContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [accountName, setAccountName] = useState('');
  const [qrStatus, setQrStatus] = useState<QrStatus | null>(null);
  const [phase, setPhase] = useState<ConnectPhase>('idle');
  const [deleteConfirmId, setDeleteConfirmId] = useState('');
  const [renameId, setRenameId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [syncHint, setSyncHint] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollNameRef = useRef('default');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const invoiceRub = data?.priceMonthly ?? PRICING.AI_WHATSAPP_MONTHLY;
  const balanceApply = usePartnerBalanceApply(invoiceRub);

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const loadAccounts = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/bots/whatsapp/accounts', { headers: authHeaders() });
      const json = (await res.json()) as AccountsResponse;
      if (!res.ok) throw new Error(json.error || 'Не удалось загрузить список номеров');
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [router]);

  const loadContext = useCallback(async () => {
    try {
      const res = await fetch('/api/tenant/dashboard', { headers: authHeaders() });
      if (!res.ok) return;
      const json = await res.json();
      setContext({
        agents: Number(json?.accounts?.agents) || 0,
        walletRub: Number(json?.money?.aiWalletRub) || 0,
      });
    } catch {
      /* контекст необязателен — страница работает и без него */
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadContext();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadAccounts, loadContext]);

  const pollStatus = useCallback(
    async (name: string, startedAt: number) => {
      try {
        const res = await fetch(
          `/api/bots/whatsapp/auth/qr/status?name=${encodeURIComponent(name)}`,
          { headers: authHeaders() },
        );
        const json = (await res.json()) as QrStatus;
        setQrStatus(json);
        if (json.status === 'authorized') {
          stopPolling();
          setPhase('authorized');
          await loadAccounts();
          return;
        }
        if (json.error) {
          stopPolling();
          setPhase('failed');
          return;
        }
        setPhase(json.status === 'qr_ready' ? 'qr_ready' : 'preparing');
        if (Date.now() - startedAt > QR_WINDOW_MS) {
          stopPolling();
          setPhase('expired');
        }
      } catch {
        /* сеть могла моргнуть — следующий тик покажет актуальный статус */
      }
    },
    [loadAccounts, stopPolling],
  );

  const startQr = async () => {
    setBusy('qr');
    setError('');
    setQrStatus(null);
    setPhase('preparing');
    stopPolling();
    try {
      const label = accountName.trim() || 'default';
      const res = await fetch('/api/bots/whatsapp/auth/qr/start', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: label }),
      });
      const json = (await res.json()) as QrStatus & { message?: string };
      if (!res.ok) {
        setPhase('failed');
        throw new Error(
          [json.message, json.error, json.hint].filter(Boolean).join(' — ') ||
            'Не удалось начать подключение',
        );
      }
      // Воркер возвращает ascii-slug — опрашиваем именно его, а не кириллицу из формы.
      const pollName = json.name || label;
      pollNameRef.current = pollName;
      setQrStatus(json);
      if (json.status === 'authorized') {
        setPhase('authorized');
        await loadAccounts();
      } else {
        setPhase(json.status === 'qr_ready' ? 'qr_ready' : 'preparing');
        const startedAt = Date.now();
        pollRef.current = setInterval(
          () => void pollStatus(pollName, startedAt),
          POLL_INTERVAL_MS,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка подключения');
    } finally {
      setBusy('');
    }
  };

  const startTrial = async () => {
    setBusy('trial');
    setError('');
    try {
      const res = await fetch('/api/bots/whatsapp/start-trial', {
        method: 'POST',
        headers: authHeaders(),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось включить пробный период');
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка пробного периода');
    } finally {
      setBusy('');
    }
  };

  const paySubscription = async () => {
    setBusy('pay');
    setError('');
    try {
      await startCheckout({
        productCode: 'ai_wa',
        periodMonths: 1,
        ...balanceApply.applyBalancePayload,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось перейти к оплате');
      setBusy('');
    }
  };

  const deleteAccount = async (account: WaAccount) => {
    setBusy(`del:${account.id}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/whatsapp/accounts/${account.id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось отключить номер');
      setDeleteConfirmId('');
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка отключения');
    } finally {
      setBusy('');
    }
  };

  const syncHistory = async (account: WaAccount) => {
    setBusy(`sync:${account.id}`);
    setError('');
    setSyncHint('');
    try {
      const res = await fetch(`/api/bots/whatsapp/accounts/${account.id}/sync-history`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        dialogs?: number;
        messagesUpserted?: number;
        skippedGroups?: number;
        error?: string;
        message?: string;
        note?: string;
      };
      if (!res.ok || json.ok === false) {
        throw new Error(json.message || json.error || 'Не удалось синхронизировать переписку');
      }
      setSyncHint(
        `Импорт: ${json.dialogs ?? 0} личных чатов, ${json.messagesUpserted ?? 0} сообщений` +
          (json.skippedGroups ? ` (групп пропущено: ${json.skippedGroups})` : '') +
          (json.note ? `. ${json.note}` : ''),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка синхронизации');
    } finally {
      setBusy('');
    }
  };

  const startRename = (account: WaAccount) => {
    setDeleteConfirmId('');
    setRenameId(account.id);
    setRenameValue(account.displayName || account.name || '');
  };

  const saveRename = async (account: WaAccount) => {
    setBusy(`rename:${account.id}`);
    setError('');
    try {
      const res = await fetch(`/api/bots/whatsapp/accounts/${account.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ displayName: renameValue }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Не удалось переименовать');
      setRenameId('');
      setRenameValue('');
      await loadAccounts();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка переименования');
    } finally {
      setBusy('');
    }
  };

  const focusConnectForm = () => {
    document
      .getElementById('podklyuchenie')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    window.setTimeout(() => nameInputRef.current?.focus(), 400);
  };

  if (loading) {
    return (
      <AppShell maxWidth="6xl">
        <LoadingState label="Загружаем WhatsApp…" />
      </AppShell>
    );
  }

  if (!data) {
    return (
      <AppShell maxWidth="6xl">
        <Alert variant="error">
          <div className="space-y-2">
            <p>{error || 'Данные канала WhatsApp не загрузились.'}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError('');
                void loadAccounts();
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

  const price = data.priceMonthly ?? PRICING.AI_WHATSAPP_MONTHLY;
  const accounts = data.accounts || [];
  const connectedAccounts = accounts.filter((a) => a.connected);
  const subActive = Boolean(data.waAddon?.isActive);
  const trialAvailable = data.trialAvailable !== false;
  const requiresPayment = Boolean(data.requiresPayment);
  const evolutionDown = data.evolutionConfigured === false;
  const canStartQr = !requiresPayment && !evolutionDown;

  const subBadge: { variant: 'success' | 'warning' | 'secondary'; text: string } = subActive
    ? data.waAddon?.isTrial
      ? { variant: 'warning', text: 'Пробный период' }
      : { variant: 'success', text: 'Подписка активна' }
    : trialAvailable
      ? { variant: 'secondary', text: 'Ещё не подключали' }
      : { variant: 'warning', text: 'Подписка закончилась' };

  const heroState: 'connected' | 'pending' | 'off' = requiresPayment
    ? 'off'
    : connectedAccounts.length > 0
      ? 'connected'
      : phase === 'preparing' || phase === 'qr_ready'
        ? 'pending'
        : 'off';

  const heroStateLabel = requiresPayment
    ? 'Подписка не активна'
    : evolutionDown
      ? 'Сервис подключения недоступен'
      : connectedAccounts.length > 0
        ? `На связи ${connectedAccounts.length} ${plural(connectedAccounts.length, ['номер', 'номера', 'номеров'])}`
        : phase === 'qr_ready' || phase === 'preparing'
          ? PHASE_UI[phase].label
          : accounts.length > 0
            ? 'Номер отключился'
            : 'Номер не подключён';

  const heroStateHint = requiresPayment
    ? trialAvailable
      ? `Включите ${TRIAL_PERIOD_DAYS} бесплатных дней — QR станет доступен сразу.`
      : `Оплатите тариф ${formatRub(price)} ₽/мес, чтобы снова подключать номера.`
    : evolutionDown
      ? 'На сервере не настроен сервис WhatsApp. Подключение сейчас невозможно — мы уже видим эту ошибку.'
      : connectedAccounts.length > 0
        ? 'Входящие сообщения попадают в CRM. AI ответит, если на канал назначен агент и есть баланс.'
        : accounts.length > 0
          ? 'Номер есть в списке, но сессия оборвалась. Обычно помогает повторный скан QR.'
          : 'Подключение занимает минуту: назовите номер, покажите QR и отсканируйте его в WhatsApp.';

  const heroActionLabel = requiresPayment
    ? trialAvailable
      ? `Включить ${TRIAL_PERIOD_DAYS} бесплатных дней`
      : `Оплатить ${formatRub(price)} ₽/мес`
    : connectedAccounts.length > 0
      ? 'Подключить ещё номер'
      : 'Подключить номер';

  const heroTitle = requiresPayment
    ? 'WhatsApp ждёт подписку'
    : connectedAccounts.length > 0
      ? 'WhatsApp подключён'
      : 'Подключите WhatsApp по QR-коду';

  const currentPhase = phase;
  const phaseUi = PHASE_UI[currentPhase];
  const phaseBadge: 'success' | 'warning' | 'destructive' | 'secondary' =
    currentPhase === 'authorized'
      ? 'success'
      : currentPhase === 'failed' || currentPhase === 'expired'
        ? 'destructive'
        : currentPhase === 'idle'
          ? 'secondary'
          : 'warning';

  return (
    <AppShell maxWidth="6xl">
      <div className="landing-root space-y-6">
        <AiWhatsappHero
          title={heroTitle}
          subtitle="Voxly подключается к обычному WhatsApp так же, как WhatsApp Web: вы сканируете QR-код, и переписка начинает попадать в CRM. Отвечает AI-агент, если он назначен на канал."
          facts={[
            {
              label: 'Номеров на связи',
              value: `${connectedAccounts.length} из ${accounts.length || 0}`,
            },
            {
              label: 'Подписка',
              value: subActive
                ? data.waAddon?.activeUntil
                  ? `до ${formatDate(data.waAddon.activeUntil)}`
                  : 'активна'
                : trialAvailable
                  ? `${TRIAL_PERIOD_DAYS} дней бесплатно`
                  : 'не активна',
            },
            {
              label: 'Баланс AI',
              value: context ? `${formatRub(context.walletRub)} ₽` : '—',
            },
          ]}
          stateLabel={heroStateLabel}
          stateTone={heroState}
          stateHint={heroStateHint}
          actionLabel={heroActionLabel}
          actionDisabled={
            evolutionDown ||
            busy === 'trial' ||
            busy === 'pay' ||
            (requiresPayment && !trialAvailable && busy === 'pay')
          }
          onAction={() => {
            if (requiresPayment) {
              if (trialAvailable) void startTrial();
              else void paySubscription();
              return;
            }
            focusConnectForm();
          }}
          footerLabel="Тариф канала"
          footerValue={`${formatRub(price)} ₽/мес`}
        />

        {error ? <Alert variant="error">{error}</Alert> : null}

        {evolutionDown ? (
          <Alert variant="error">
            <div className="space-y-1">
              <p className="font-semibold">Сервис подключения WhatsApp не настроен на сервере</p>
              <p>
                {data.evolutionHint ||
                  'Нужны переменные окружения EVOLUTION_API_URL и EVOLUTION_API_KEY.'}{' '}
                Пока их нет, QR-код показать невозможно — это проблема на нашей стороне, а не в
                вашем аккаунте.
              </p>
              <p className="text-sm opacity-90">
                Подписка при этом не расходуется впустую: напишите в поддержку, и мы поднимем
                сервис.
              </p>
            </div>
          </Alert>
        ) : null}

        {context && context.agents === 0 && connectedAccounts.length > 0 ? (
          <Alert variant="info">
            <div className="space-y-1">
              <p className="font-semibold">Номер на связи, но отвечать некому</p>
              <p>
                AI-агент не создан, поэтому клиентам никто не отвечает автоматически — сообщения
                просто копятся в CRM.{' '}
                <Link
                  href="/dashboard/ai/agents"
                  className="font-semibold underline underline-offset-2"
                >
                  Создать и назначить агента
                </Link>
                .
              </p>
            </div>
          </Alert>
        ) : null}

        {context && context.walletRub <= 0 && connectedAccounts.length > 0 ? (
          <Alert variant="error">
            <div className="space-y-1">
              <p className="font-semibold">Баланс AI на нуле — ответы не отправляются</p>
              <p>
                Номер остаётся подключённым и входящие сохраняются, но нейросеть не отвечает, пока
                баланс не пополнен.{' '}
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
              title="Тариф канала"
              description="Подписка даёт право принимать сообщения WhatsApp. Ответы нейросети она не включает — их оплачивает общий баланс AI."
            />
            <Badge variant={subBadge.variant}>{subBadge.text}</Badge>
          </div>

          <div className="mt-4 rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="land-display text-[20px] tracking-[-0.03em] text-black">
                {subActive && data.waAddon?.activeUntil
                  ? `Действует до ${formatDate(data.waAddon.activeUntil)}`
                  : trialAvailable
                    ? `${TRIAL_PERIOD_DAYS} дней бесплатно, потом ${formatRub(price)} ₽/мес`
                    : 'Подписка не активна'}
              </p>
              <p className="text-sm tabular-nums text-black/55">{formatRub(price)} ₽/мес за канал</p>
            </div>
            <p className="mt-3 max-w-[70ch] text-sm leading-snug text-black/65">
              {subActive
                ? data.waAddon?.isTrial
                  ? 'Идёт пробный период. Оплатите до его конца — канал не отключится ни на день, а подключённый номер останется на месте.'
                  : 'Канал оплачен. Продление добавляется к текущей дате окончания, так что платить заранее безопасно.'
                : trialAvailable
                  ? `Пробный период включается одной кнопкой и сразу открывает QR. Списаний в эти ${TRIAL_PERIOD_DAYS} дней не будет.`
                  : 'Пока подписки нет, QR-код недоступен, а подключённые номера не принимают сообщения. Данные и переписка сохраняются.'}
            </p>
            <div className="mt-3 space-y-3">
              <PartnerBalanceApply
                availableRub={balanceApply.availableRub}
                invoiceRub={price}
                useBalance={balanceApply.useBalance}
                onUseBalanceChange={balanceApply.setUseBalance}
                balanceInput={balanceApply.balanceInput}
                onBalanceInputChange={balanceApply.setBalanceInput}
                appliedRub={balanceApply.appliedRub}
                netRub={balanceApply.netRub}
                disabled={busy === 'pay' || busy === 'trial'}
                idPrefix="ai-wa-balance"
              />
              <div className="flex flex-wrap gap-2">
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
                  !subActive && !trialAvailable ? 'land-btn-amber' : 'land-btn-ghost'
                }`}
              >
                {busy === 'pay'
                  ? balanceApply.appliedRub > 0 && balanceApply.netRub <= 0
                    ? 'Оформляем…'
                    : 'Переходим к оплате…'
                  : balanceApply.appliedRub > 0 && balanceApply.netRub <= 0
                    ? 'Оформить за 0 ₽ — с баланса'
                    : subActive
                      ? `Продлить на месяц · ${formatRub(balanceApply.netRub || price)} ₽`
                      : `Оплатить ${formatRub(balanceApply.netRub || price)} ₽/мес`}
              </button>
              </div>
            </div>
          </div>

          {data.billingWarning && !subActive ? (
            <p className="mt-3 text-sm text-black/55">{data.billingWarning}</p>
          ) : null}
        </section>

        <section
          id="podklyuchenie"
          className="scroll-mt-6 rounded-2xl border border-black/10 bg-white p-5 sm:p-6"
        >
          <SectionHead
            index="02"
            kicker="подключение"
            title="Как подключить номер"
            description="Телефон должен быть рядом и с интернетом: WhatsApp привязывает Voxly как ещё одно устройство."
          />

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <ol className="space-y-2.5">
                {[
                  'Придумайте название — оно нужно только вам, чтобы отличать номера в списке. Русские буквы можно.',
                  'Нажмите «Показать QR». Мы поднимем сессию и покажем код справа.',
                  'На телефоне: WhatsApp → Настройки → Связанные устройства → Привязка устройства.',
                  'Наведите камеру на QR-код. Статус сменится на «Номер подключён» сам, обновлять страницу не нужно.',
                ].map((text, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#f5a623] font-mono text-[11px] font-bold text-black">
                      {i + 1}
                    </span>
                    <span className="text-sm leading-snug text-black/70">{text}</span>
                  </li>
                ))}
              </ol>

              <div className="mt-5">
                <label htmlFor="wa-account-name" className="block text-sm font-medium text-black">
                  Название номера
                </label>
                <input
                  id="wa-account-name"
                  ref={nameInputRef}
                  type="text"
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="Например: отдел продаж"
                  aria-describedby="wa-account-name-hint"
                  disabled={busy === 'qr' || !canStartQr}
                  className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white px-3 text-sm outline-none transition-colors duration-200 focus:border-black/40 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <p id="wa-account-name-hint" className="mt-1.5 text-xs leading-snug text-black/55">
                  Если оставить пустым, номер будет называться «default».
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy === 'qr' || !canStartQr}
                    onClick={() => void startQr()}
                    className="land-btn min-h-11 cursor-pointer px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy === 'qr'
                      ? 'Готовим QR…'
                      : currentPhase === 'expired' || currentPhase === 'failed'
                        ? 'Показать новый QR'
                        : 'Показать QR'}
                    <Smartphone className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={currentPhase === 'idle' || busy === 'qr'}
                    onClick={() => void pollStatus(pollNameRef.current || 'default', Date.now())}
                    className="land-btn-ghost min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Обновить статус
                    <RefreshCw className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                {!canStartQr ? (
                  <p className="mt-2 text-xs leading-snug text-black/55">
                    {evolutionDown
                      ? 'Кнопка недоступна: сервис подключения WhatsApp не настроен на сервере.'
                      : trialAvailable
                        ? 'Кнопка недоступна: сначала включите пробный период в блоке выше.'
                        : 'Кнопка недоступна: подписка на канал не активна — оплатите тариф в блоке выше.'}
                  </p>
                ) : currentPhase === 'idle' ? (
                  <p className="mt-2 text-xs leading-snug text-black/55">
                    «Обновить статус» пригодится, если код уже показан, а статус завис.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                  Статус подключения
                </p>
                <Badge variant={phaseBadge}>{phaseUi.label}</Badge>
              </div>

              <div aria-live="polite" className="mt-3">
                <p className="land-display text-[18px] leading-tight tracking-[-0.03em] text-black">
                  {phaseUi.label}
                </p>
                <p className="mt-1.5 text-sm leading-snug text-black/60">{phaseUi.hint}</p>
                {qrStatus?.error ? (
                  <p className="mt-2 text-sm leading-snug text-[#b91c1c]">
                    Что пошло не так: {qrStatus.error}
                    {qrStatus.hint ? ` — ${qrStatus.hint}` : ''}
                  </p>
                ) : null}
                {!qrStatus?.error && qrStatus?.hint && currentPhase === 'preparing' ? (
                  <p className="mt-2 text-sm leading-snug text-black/55">{qrStatus.hint}</p>
                ) : null}
                {qrStatus?.displayName && currentPhase === 'authorized' ? (
                  <p className="mt-2 text-sm text-black/65">
                    Номер сохранён как{' '}
                    <span className="font-semibold text-black">{qrStatus.displayName}</span>.
                  </p>
                ) : null}
              </div>

              {qrStatus?.qr && currentPhase === 'qr_ready' ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrStatus.qr}
                    alt="QR-код для привязки WhatsApp"
                    className="mx-auto mt-4 h-56 w-56 rounded-xl border border-black/10 bg-white p-2"
                  />
                  <p className="mt-2 text-center text-xs text-black/55">
                    Код обновляется автоматически, пока открыта эта страница.
                  </p>
                </>
              ) : null}

              {currentPhase === 'authorized' ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href="/dashboard/ai/agents"
                    className="land-btn min-h-11 cursor-pointer px-4 text-sm"
                  >
                    Назначить AI-агента
                  </Link>
                  <p className="w-full text-xs leading-snug text-black/55">
                    Все личные чаты (не группы) подтягиваются в CRM — до 30 последних
                    сообщений в каждом. Если сделок мало — нажмите «Синхронизировать» у
                    номера ниже (повтор безопасен).
                  </p>
                </div>
              ) : null}

              {currentPhase === 'idle' ? (
                <div className="mt-4 rounded-lg border border-dashed border-black/15 bg-white px-3 py-6 text-center">
                  <p className="text-sm font-semibold text-black">QR-кода пока нет</p>
                  <p className="mx-auto mt-1 max-w-[36ch] text-xs leading-snug text-black/55">
                    Он появится здесь после нажатия «Показать QR». Держите телефон под рукой — код
                    живёт около минуты.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <SectionHead
            index="03"
            kicker="номера"
            title="Подключённые номера"
            description="Один номер — одно устройство в WhatsApp. Если вы отвязали Voxly в телефоне, номер здесь станет отключённым."
          />

          {accounts.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-black/15 bg-[#faf8f5] px-4 py-8 text-center">
              <p className="font-semibold text-black">Ни одного номера пока не подключено</p>
              <p className="mx-auto mt-1 max-w-[56ch] text-sm text-black/55">
                Подключённый номер — это ваш обычный WhatsApp, к которому Voxly привязан как
                дополнительное устройство. Сам номер остаётся у вас, переписка дублируется в CRM.
              </p>
              <button
                type="button"
                disabled={!canStartQr}
                onClick={focusConnectForm}
                className="land-btn-amber mt-4 min-h-11 cursor-pointer px-4 text-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                Подключить первый номер
              </button>
              {!canStartQr ? (
                <p className="mx-auto mt-2 max-w-[48ch] text-xs text-black/55">
                  {evolutionDown
                    ? 'Кнопка неактивна: сервис подключения недоступен.'
                    : 'Кнопка неактивна: сначала включите пробный период или оплатите тариф.'}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto rounded-xl border border-black/10">
              {syncHint ? (
                <p className="border-b border-black/10 bg-[#faf8f5] px-3 py-2 text-xs text-black/65">
                  {syncHint}
                </p>
              ) : null}
              <table className="w-full min-w-[720px] border-collapse text-left">
                <thead className="bg-[#faf8f5]">
                  <tr>
                    <th className={TH}>Название</th>
                    <th className={TH}>Номер</th>
                    <th className={TH}>Состояние</th>
                    <th className={TH}>Обновлено</th>
                    <th className={`${TH} text-right`}>Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/10">
                  {accounts.map((account) => {
                    const label = account.displayName || account.name;
                    return (
                      <tr
                        key={account.id}
                        className="transition-colors duration-200 hover:bg-[#faf8f5]"
                      >
                        <td className="px-3 py-3">
                          {renameId === account.id ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                maxLength={80}
                                className="min-h-9 min-w-[10rem] flex-1 rounded-lg border border-black/15 bg-white px-2 text-sm text-black"
                                aria-label="Новое название номера"
                              />
                              <button
                                type="button"
                                disabled={busy === `rename:${account.id}`}
                                onClick={() => void saveRename(account)}
                                className="land-btn-amber inline-flex min-h-9 cursor-pointer items-center px-3 text-xs"
                              >
                                {busy === `rename:${account.id}` ? 'Сохраняем…' : 'Сохранить'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setRenameId('');
                                  setRenameValue('');
                                }}
                                className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65"
                              >
                                Отмена
                              </button>
                            </div>
                          ) : (
                            <>
                              <p className="font-medium text-black">{label}</p>
                              {account.slug && account.slug !== label ? (
                                <p className="mt-0.5 truncate font-mono text-xs text-black/45">
                                  {account.slug}
                                </p>
                              ) : null}
                            </>
                          )}
                        </td>
                        <td className="px-3 py-3 text-sm tabular-nums text-black/70">
                          {account.phoneNumberId || (
                            <span className="text-black/45">появится после скана</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {account.connected ? (
                            <Badge variant="success">На связи</Badge>
                          ) : (
                            <Badge variant="warning">Отключён</Badge>
                          )}
                          {!account.connected ? (
                            <p className="mt-1 max-w-[28ch] text-xs leading-snug text-black/55">
                              Отсканируйте QR ещё раз — сессия оборвалась.
                            </p>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-sm tabular-nums text-black/55">
                          {formatDateTime(account.updatedAt)}
                        </td>
                        <td className="px-3 py-3 text-right">
                          {deleteConfirmId === account.id ? (
                            <div className="flex flex-wrap items-center justify-end gap-2">
                              <span className="text-xs text-black/55">
                                Отключить «{label}» от Voxly?
                              </span>
                              <button
                                type="button"
                                disabled={busy === `del:${account.id}`}
                                onClick={() => void deleteAccount(account)}
                                className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-[#c2410c]/40 bg-[#fff5f0] px-3 text-xs font-semibold text-[#c2410c] transition-colors duration-200 hover:border-[#c2410c] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {busy === `del:${account.id}` ? 'Отключаем…' : 'Да, отключить'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteConfirmId('')}
                                className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-black/15 px-3 text-xs font-semibold text-black/65 transition-colors duration-200 hover:border-black/35 hover:text-black"
                              >
                                Отмена
                              </button>
                            </div>
                          ) : renameId === account.id ? null : (
                            <div className="flex items-center justify-end gap-1.5">
                              {account.connected ? (
                                <button
                                  type="button"
                                  disabled={Boolean(busy)}
                                  onClick={() => void syncHistory(account)}
                                  aria-label={`Синхронизировать чаты ${label}`}
                                  title="Синхронизировать все личные чаты в CRM (до 30 сообщений в каждом)"
                                  className="inline-flex h-9 w-9 min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-full border border-black/15 text-black/55 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <RefreshCw
                                    className={`h-4 w-4 ${busy === `sync:${account.id}` ? 'animate-spin' : ''}`}
                                    aria-hidden
                                  />
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => startRename(account)}
                                aria-label={`Переименовать ${label}`}
                                className="inline-flex h-9 w-9 min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-full border border-black/15 text-black/55 transition-colors duration-200 hover:border-black/35 hover:text-black disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(busy)}
                                onClick={() => setDeleteConfirmId(account.id)}
                                aria-label={`Отключить номер ${label}`}
                                className="inline-flex h-9 w-9 min-h-9 min-w-9 cursor-pointer items-center justify-center rounded-full border border-black/15 text-black/55 transition-colors duration-200 hover:border-[#c2410c]/50 hover:text-[#c2410c] disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {accounts.length > 0 ? (
            <p className="mt-3 max-w-[70ch] text-xs leading-snug text-black/55">
              Отключение снимает связь Voxly с WhatsApp и убирает номер из списка. Переписка,
              которая уже попала в CRM, сохраняется.
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-black/10 bg-white p-5 sm:p-6">
          <SectionHead
            index="04"
            kicker="дальше"
            title="Что нужно, чтобы AI отвечал"
            description="Подключённый номер сам по себе только собирает переписку в CRM. Для автоответов нужны ещё две вещи."
          />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                AI-агент
              </p>
              <p className="land-display mt-1.5 text-[20px] tracking-[-0.03em] text-black">
                {context ? `${context.agents} ${plural(context.agents, ['агент', 'агента', 'агентов'])}` : '—'}
              </p>
              <p className="mt-1 text-sm leading-snug text-black/55">
                Агент задаёт, как нейросеть говорит с клиентом. Без назначенного агента канал молчит.
              </p>
              <Link
                href="/dashboard/ai/agents"
                className="land-btn-ghost mt-3 min-h-11 cursor-pointer px-4 text-sm"
              >
                {context && context.agents === 0 ? 'Создать агента' : 'Настроить агентов'}
              </Link>
            </div>
            <div className="rounded-xl border border-black/10 bg-[#faf8f5] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45">
                Баланс AI
              </p>
              <p className="land-display mt-1.5 text-[20px] tabular-nums tracking-[-0.03em] text-black">
                {context ? `${formatRub(context.walletRub)} ₽` : '—'}
              </p>
              <p className="mt-1 text-sm leading-snug text-black/55">
                Из него оплачивается каждый ответ нейросети. Тариф канала баланс не пополняет.
              </p>
              <Link
                href="/dashboard/ai/agents"
                className="land-btn-ghost mt-3 min-h-11 cursor-pointer px-4 text-sm"
              >
                Пополнить баланс
              </Link>
            </div>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
