import type { PrismaClient } from '@voxly/db';
import { sendPlatformTelegramMessage } from './platform-telegram.js';

export async function processDuePlatformBroadcasts(prisma: PrismaClient): Promise<number> {
  const now = new Date();
  const due = await prisma.platformBroadcast.findMany({
    where: {
      status: 'scheduled',
      scheduledAt: { lte: now },
    },
    take: 5,
  });
  let processed = 0;
  for (const b of due) {
    const claimed = await prisma.platformBroadcast.updateMany({
      where: { id: b.id, status: 'scheduled' },
      data: { status: 'sending', updatedAt: now },
    });
    if (claimed.count === 0) continue;

    const subs = await prisma.platformBotSubscriber.findMany({
      where: { blocked: false },
      select: { chatId: true },
    });
    let sent = 0;
    let fail = 0;
    for (const sub of subs) {
      const ok = await sendPlatformTelegramMessage(sub.chatId, b.text);
      if (ok) sent += 1;
      else fail += 1;
      await new Promise((r) => setTimeout(r, 40));
    }
    await prisma.platformBroadcast.update({
      where: { id: b.id },
      data: {
        status: 'sent',
        sentCount: sent,
        failCount: fail,
        sentAt: new Date(),
        updatedAt: new Date(),
      },
    });
    processed += 1;
  }
  return processed;
}
