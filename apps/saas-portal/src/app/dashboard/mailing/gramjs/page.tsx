'use client';

import { ChannelBroadcastsPage } from '@/components/portal/channel-broadcasts-page';

export default function MailingGramjsPage() {
  return (
    <ChannelBroadcastsPage
      channel="gramjs"
      title="Рассылка с GramJS аккаунтов"
      description="Личные Telegram-аккаунты → диалоги Conversation; расписание и превью"
      accountsHref="/dashboard/ai/gramjs"
      accountsLabel="Подключить GramJS"
    />
  );
}
