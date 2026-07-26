'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bot, Plus, Megaphone, ExternalLink, Loader2 } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';
import { PageHeader } from '@/components/portal/page-header';
import { CopyButton } from '@/components/portal/copy-button';

interface BotRow {
  id: string;
  botUsername: string | null;
  botType: string;
  status: string;
  botLink: string | null;
  hasGiftCampaign: boolean;
  campaign: {
    channelUsername: string | null;
    isActive: boolean;
  } | null;
}

interface BotsResponse {
  telegramLinked?: boolean;
  managerBot?: string;
  giftAddon: {
    activeUntil: string;
    isTrial: boolean;
    isActive: boolean;
  } | null;
  bots: BotRow[];
}

export default function GiftBotsListPage() {
  const router = useRouter();
  const [data, setData] = useState<BotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [provision, setProvision] = useState<{
    deepLink: string;
    deepLinkSimple?: string;
    linkManager: string;
    suggestedUsername?: string;
    telegramLinked?: boolean;
  } | null>(null);

  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/bots', { headers: authHeaders() });
      if (!res.ok) throw new Error('Не удалось загрузить ботов');
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const giftBots = (data?.bots || []).filter((b) => b.botType === 'gift');

  const startTrial = async () => {
    setBusy('trial');
    setError('');
    try {
      const res = await fetch('/api/bots/gift/start-trial', {
        method: 'POST',
        headers: authHeaders(),
        body: '{}',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось активировать trial');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  const createBot = async () => {
    setBusy('provision');
    setError('');
    try {
      if (!data?.giftAddon?.isActive) {
        const trialRes = await fetch('/api/bots/gift/start-trial', {
          method: 'POST',
          headers: authHeaders(),
          body: '{}',
        });
        const trialJson = await trialRes.json();
        if (!trialRes.ok) throw new Error(trialJson.error || 'Не удалось активировать trial');
      }
      const res = await fetch('/api/bots/provision-link', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ botType: 'gift', suggestedName: 'Voxly Gift Bot' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Не удалось создать ссылку');
      setProvision({
        deepLink: json.deepLink,
        deepLinkSimple: json.deepLinkSimple,
        linkManager: json.linkManager,
        suggestedUsername: json.suggestedUsername,
        telegramLinked: json.telegramLinked,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setBusy('');
    }
  };

  if (loading) {
    return (
      <AppShell maxWidth="3xl">
        <LoadingState />
      </AppShell>
    );
  }

  return (
    <AppShell maxWidth="3xl">
      <PageHeader
        title="Боты подарков"
        description={
          <>
            Один бот = один канал ·{' '}
            {data?.giftAddon?.isActive
              ? `активно до ${new Date(data.giftAddon.activeUntil).toLocaleDateString('ru-RU')}${data.giftAddon.isTrial ? ' (trial)' : ''}`
              : '500 ₽/мес за канал'}
          </>
        }
        backHref="/dashboard"
        backLabel="Кабинет"
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href="/dashboard/mailing/bot">
                <Megaphone className="h-4 w-4" /> Рассылки
              </Link>
            </Button>
            <Button variant="solid" onClick={createBot} disabled={busy === 'provision'}>
              {busy === 'provision' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Подключить канал
            </Button>
          </>
        }
      />

      {error && (
        <Alert className="mb-4" variant="error">
          {error}
        </Alert>
      )}

      {!data?.giftAddon?.isActive && giftBots.length === 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Старт за 7 дней бесплатно</CardTitle>
            <CardDescription>
              Подключите первый gift-бот к каналу. Дальше — 500 ₽/мес за каждый канал.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="solid" onClick={startTrial} disabled={busy === 'trial'}>
              {busy === 'trial' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Активировать trial
            </Button>
          </CardContent>
        </Card>
      )}

      {provision && (
        <Card className="mb-6 animate-in border-border">
          <CardHeader>
            <CardTitle>Создание бота в Telegram</CardTitle>
            <CardDescription>
              Откройте ссылку внутри Telegram (не в Safari/Chrome). Username: @
              {provision.suggestedUsername}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!provision.telegramLinked && !data?.telegramLinked && (
              <Button asChild variant="secondary">
                <a href={provision.linkManager} target="_blank" rel="noreferrer">
                  1. Привязать Telegram
                </a>
              </Button>
            )}
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="solid">
                <a href={provision.deepLink} target="_blank" rel="noreferrer">
                  Создать бота <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
              <CopyButton value={provision.deepLink} label="Скопировать ссылку" />
              {provision.deepLinkSimple && (
                <Button asChild variant="ghost">
                  <a href={provision.deepLinkSimple} target="_blank" rel="noreferrer">
                    Запасная ссылка
                  </a>
                </Button>
              )}
            </div>
            <Input readOnly value={provision.deepLink} className="font-mono text-xs" />
            <p className="text-xs text-muted-foreground">
              После подтверждения в Telegram бот появится в списке ниже.
            </p>
          </CardContent>
        </Card>
      )}

      {giftBots.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <Bot className="h-10 w-10 text-muted-foreground" />
            <p className="text-muted-foreground">Пока нет подключённых ботов</p>
            <Button variant="solid" onClick={createBot} disabled={busy === 'provision'}>
              <Plus className="h-4 w-4" /> Подключить первый канал
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="stagger grid gap-3">
          {giftBots.map((bot) => (
            <Link key={bot.id} href={`/dashboard/bots/${bot.id}`} className="block">
              <Card className="transition-[border-color,box-shadow,transform] duration-[var(--duration-fast)] hover:border-foreground/20 hover:shadow-[0_2px_8px_rgba(0,0,0,0.04)] active:scale-[0.995]">
                <CardContent className="flex items-center justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold">
                        {bot.campaign?.channelUsername
                          ? `@${bot.campaign.channelUsername.replace(/^@/, '')}`
                          : 'Канал не настроен'}
                      </p>
                      <Badge variant={bot.status === 'active' ? 'success' : 'warning'}>
                        {bot.status}
                      </Badge>
                      {bot.hasGiftCampaign && <Badge variant="secondary">воронка</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Бот: @{bot.botUsername || '…'}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" tabIndex={-1}>
                    Настроить
                  </Button>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <p className="mt-8 text-center text-xs text-muted-foreground">
        Manager: {data?.managerBot || '@VoxlyGiftbot'} · следующий канал — 500 ₽/мес
      </p>
    </AppShell>
  );
}
