'use client';

import { ChannelBroadcastsPage } from '@/components/portal/channel-broadcasts-page';

export default function MailingWhatsappPage() {
  return (
    <ChannelBroadcastsPage
      channel="wa"
      title="Рассылка в WhatsApp"
      description="Аккаунты Evolution → диалоги Conversation; медиа по HTTPS URL"
      accountsHref="/dashboard/ai/whatsapp"
      accountsLabel="Подключить WhatsApp"
    />
  );
}
