'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AppShell, LoadingState } from '@/components/portal/app-shell';

export default function AiBotDetailRedirect() {
  const { botId } = useParams<{ botId: string }>();
  const router = useRouter();

  useEffect(() => {
    if (botId) router.replace(`/dashboard/ai?bot=${encodeURIComponent(botId)}`);
  }, [botId, router]);

  return (
    <AppShell maxWidth="6xl">
      <LoadingState label="Открываем Телеграм Секретарь…" />
    </AppShell>
  );
}
