'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bot, Image, MessageCircle, Send } from 'lucide-react';
import { PRICING } from '@voxly/shared';
import { authHeaders } from '@/lib/auth';
import { AppShell } from '@/components/portal/app-shell';
import { PageHeader } from '@/components/portal/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

type BillingProducts = {
  mailing_bot?: { price: number };
  mailing_accounts?: { price: number };
  mailing_stories?: { price: number };
};

const ITEMS = [
  {
    href: '/dashboard/mailing/bot',
    title: 'Рассылка сообщений ботом',
    desc: 'Gift-подписчики: сегменты, воронка, медиа, расписание',
    icon: Bot,
    key: 'mailing_bot' as const,
    priceFallback: PRICING.MAILING_BOT_MONTHLY,
    priceSuffix: '',
  },
  {
    href: '/dashboard/mailing/gramjs',
    title: 'Рассылка с GramJS аккаунтов',
    desc: 'Личные Telegram-аккаунты → диалоги Conversation',
    icon: Send,
    key: 'mailing_accounts' as const,
    priceFallback: PRICING.MAILING_ACCOUNTS_MONTHLY,
    priceSuffix: ' · вместе с WhatsApp',
  },
  {
    href: '/dashboard/mailing/whatsapp',
    title: 'Рассылка в WhatsApp',
    desc: 'Evolution-аккаунты → диалоги Conversation + медиа URL',
    icon: MessageCircle,
    key: 'mailing_accounts' as const,
    priceFallback: PRICING.MAILING_ACCOUNTS_MONTHLY,
    priceSuffix: ' · вместе с GramJS',
  },
  {
    href: '/dashboard/mailing/stories',
    title: 'Постинг сторис по времени',
    desc: 'GramJS (отправка), WhatsApp / Business — расписание',
    icon: Image,
    key: 'mailing_stories' as const,
    priceFallback: PRICING.MAILING_STORIES_MONTHLY,
    priceSuffix: '',
  },
] as const;

export default function MailingHubPage() {
  const [products, setProducts] = useState<BillingProducts>({});

  useEffect(() => {
    fetch(`${API}/api/bots/mailing/billing`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.products) setProducts(d.products);
      })
      .catch(() => undefined);
  }, []);

  return (
    <AppShell maxWidth="3xl" className="space-y-5">
      <PageHeader
        title="Рассылка"
        description="Сообщения и сторис из кабинета и сайдбара CRM · trial 7 дней на каждый add-on"
        backHref="/dashboard"
        backLabel="Кабинет"
      />

      <div className="grid gap-3 sm:grid-cols-2">
        {ITEMS.map((item) => {
          const Icon = item.icon;
          const price = products[item.key]?.price ?? item.priceFallback;
          return (
            <Link key={item.href} href={item.href} className="group block">
              <Card className="h-full transition-colors group-hover:border-foreground/25">
                <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                  <div className="rounded-md border border-border bg-muted p-2">
                    <Icon className="h-4 w-4 text-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base leading-snug">{item.title}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {price.toLocaleString('ru-RU')} ₽/мес{item.priceSuffix}
                    </p>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
