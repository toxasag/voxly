'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { startCheckout } from '@/lib/checkout';
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
      await startCheckout({ productCode: product, periodMonths: 1 });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка оплаты');
      setBusy(false);
    }
  }, [product]);

  // ?pay=1 → сразу на Robokassa (из CRM «Оплатить» или после 402)
  useEffect(() => {
    if (autoPayStarted || loading || !meta || meta.isActive) return;
    if (searchParams.get('pay') !== '1') return;
    if (meta.trialAvailable) return;
    setAutoPayStarted(true);
    void pay();
  }, [autoPayStarted, loading, meta, pay, searchParams]);

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

  return (
    <div className="space-y-2">
      {error && <Alert variant="error">{error}</Alert>}
      <Alert variant="info">
        {LABELS[product]} — платный add-on ({meta.price} ₽/мес). Меню видно всем; отправка
        требует trial или оплату.
        <div className="mt-3 flex flex-wrap gap-2">
          {meta.trialAvailable ? (
            <Button type="button" size="sm" variant="solid" disabled={busy} onClick={startTrial}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Пробный период {meta.trialDays} дн.
            </Button>
          ) : null}
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void pay()}>
            Оплатить {meta.price} ₽/мес
          </Button>
        </div>
      </Alert>
    </div>
  );
}
