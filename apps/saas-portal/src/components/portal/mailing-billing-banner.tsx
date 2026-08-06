'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
import { PartnerBalanceApply } from '@/components/portal/partner-balance-apply';
import { usePartnerBalanceApply } from '@/hooks/use-partner-balance-apply';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/portal/alert';

type Product = 'mailing_bot' | 'mailing_accounts' | 'mailing_stories';

const LABELS: Record<Product, string> = {
  mailing_bot: 'Рассылка ботом',
  mailing_accounts: 'Рассылка с аккаунтов',
  mailing_stories: 'Постинг сторис',
};

export function MailingBillingBanner({
  product,
  onActiveChange,
}: {
  product: Product;
  onActiveChange?: (active: boolean) => void;
}) {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [meta, setMeta] = useState<{
    isActive: boolean;
    isTrial: boolean;
    trialAvailable: boolean;
    price: number;
    trialDays: number;
    activeUntil: string | null;
  } | null>(null);
  const [autoPayStarted, setAutoPayStarted] = useState(false);

  const invoiceRub = meta?.price ?? 0;
  const balanceApply = usePartnerBalanceApply(invoiceRub);

  const load = useCallback(async () => {
    const res = await fetch('/api/bots/mailing/billing', { headers: authHeaders() });
    if (!res.ok) throw new Error('Не удалось загрузить биллинг');
    const json = await res.json();
    const p = json.products?.[product];
    const next = {
      isActive: Boolean(p?.isActive),
      isTrial: Boolean(p?.isTrial),
      trialAvailable: Boolean(p?.trialAvailable),
      price: Number(p?.price) || 0,
      trialDays: Number(json.trialDays) || 7,
      activeUntil: p?.activeUntil || null,
    };
    setMeta(next);
    onActiveChange?.(next.isActive);
    return next;
  }, [product, onActiveChange]);

  useEffect(() => {
    load()
      .catch((e) => setError(e instanceof Error ? e.message : 'Ошибка'))
      .finally(() => setLoading(false));
  }, [load]);

  const pay = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      await startCheckout({
        productCode: product,
        periodMonths: 1,
        ...balanceApply.applyBalancePayload,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setBusy(false);
    }
  }, [product, balanceApply.applyBalancePayload]);

  // ?pay=1 → Robokassa only when there is nothing to opt into (no free partner balance).
  // If balance > 0, stay on the page so the user can check «Зачесть партнёрский баланс».
  useEffect(() => {
    if (autoPayStarted || loading || !meta || meta.isActive) return;
    if (searchParams.get('pay') !== '1') return;
    if (meta.trialAvailable) return;
    if (!balanceApply.loaded) return;
    if (balanceApply.availableRub > 0) return;
    setAutoPayStarted(true);
    void pay();
  }, [
    autoPayStarted,
    loading,
    meta,
    pay,
    searchParams,
    balanceApply.loaded,
    balanceApply.availableRub,
  ]);

  const startTrial = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/bots/mailing/start-trial', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ type: product }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось стартовать trial');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  if (loading || !meta) {
    return (
      <Alert variant="info">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Биллинг…
      </Alert>
    );
  }

  if (meta.isActive) {
    return (
      <Alert variant="success">
        {LABELS[product]} активен
        {meta.isTrial ? ' (пробный период)' : ''}
        {meta.activeUntil
          ? ` до ${new Date(meta.activeUntil).toLocaleDateString('ru-RU')}`
          : ''}
        . {meta.price} ₽/мес.
      </Alert>
    );
  }

  const payHint =
    searchParams.get('pay') === '1' && balanceApply.availableRub > 0
      ? 'Есть партнёрский баланс — отметьте зачёт ниже или оплатите картой.'
      : null;

  return (
    <div className="space-y-2">
      {error && <Alert variant="error">{error}</Alert>}
      <Alert variant="info">
        {LABELS[product]} — платный add-on ({meta.price} ₽/мес). Меню видно всем; отправка
        требует trial или оплату.
        {payHint ? <span className="mt-1 block text-sm">{payHint}</span> : null}
        <div className="mt-3 space-y-3">
          <PartnerBalanceApply
            availableRub={balanceApply.availableRub}
            invoiceRub={invoiceRub}
            useBalance={balanceApply.useBalance}
            onUseBalanceChange={balanceApply.setUseBalance}
            balanceInput={balanceApply.balanceInput}
            onBalanceInputChange={balanceApply.setBalanceInput}
            appliedRub={balanceApply.appliedRub}
            netRub={balanceApply.netRub}
            disabled={busy}
            idPrefix={`mailing-${product}-balance`}
          />
          <div className="flex flex-wrap gap-2">
            {meta.trialAvailable ? (
              <Button type="button" size="sm" variant="solid" disabled={busy} onClick={startTrial}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Пробный период {meta.trialDays} дн.
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void pay()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {balanceApply.appliedRub > 0 && balanceApply.netRub <= 0
                ? 'Оплатить с баланса'
                : balanceApply.appliedRub > 0
                  ? `Оплатить ${balanceApply.netRub} ₽ картой`
                  : `Оплатить ${meta.price} ₽/мес`}
            </Button>
          </div>
        </div>
      </Alert>
    </div>
  );
}
