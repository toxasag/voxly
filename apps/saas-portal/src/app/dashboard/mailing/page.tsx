'use client';

import Link from 'next/link';
import { Bot, Image, MessageCircle, Send } from 'lucide-react';
import { AppShell } from '@/components/portal/app-shell';
import { PageHeader } from '@/components/portal/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const ITEMS = [
  {
    href: '/dashboard/mailing/bot',
    title: 'Рассылка сообщений ботом',
    desc: 'Gift-подписчики: сегменты, воронка, медиа, расписание',
    icon: Bot,
    price: '500 ₽/мес',
  },
  {
    href: '/dashboard/mailing/gramjs',
    title: 'Рассылка с GramJS аккаунтов',
    desc: 'Личные Telegram-аккаунты → диалоги Conversation',
    icon: Send,
    price: '500 ₽/мес · вместе с WhatsApp',
  },
  {
    href: '/dashboard/mailing/whatsapp',
    title: 'Рассылка в WhatsApp',
    desc: 'Evolution-аккаунты → диалоги Conversation + медиа URL',
    icon: MessageCircle,
    price: '500 ₽/мес · вместе с GramJS',
  },
  {
    href: '/dashboard/mailing/stories',
    title: 'Постинг сторис по времени',
    desc: 'GramJS (отправка), WhatsApp / Business — расписание',
    icon: Image,
    price: '1000 ₽/мес',
  },
] as const;

export default function MailingHubPage() {
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
          return (
            <Link key={item.href} href={item.href} className="group block">
              <Card className="h-full transition-colors group-hover:border-foreground/25">
                <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                  <div className="rounded-md border border-border bg-muted p-2">
                    <Icon className="h-4 w-4 text-foreground" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base leading-snug">{item.title}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{item.price}</p>
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
