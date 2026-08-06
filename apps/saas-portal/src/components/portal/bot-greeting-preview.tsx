'use client';

import { Camera } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  TG_GREETING_BG,
  TG_PREVIEW_FRAME,
  TG_START_BTN,
  TgPreviewHeader,
} from '@/components/portal/telegram-preview-chrome';

/**
 * Pre-/start Telegram screen: profile card + СТАРТ (not a chat bubble).
 *
 * Profile avatar (header circle) and description-card media are separate assets.
 * Telegram: profile photo via Bot API; description media only via @BotFather.
 * Shares chrome with TelegramPreview (frame + header).
 */
export function BotGreetingPreview({
  name,
  description,
  username,
  profilePhotoUrl,
  cardPhotoUrl,
  className,
}: {
  name: string;
  description: string;
  username?: string | null;
  /** Circle avatar in the chat header */
  profilePhotoUrl?: string | null;
  /** Large image on the before-Start description card */
  cardPhotoUrl?: string | null;
  className?: string;
}) {
  const title = name.trim() || 'Название бота';
  const body =
    description.trim() ||
    'Описание появится здесь — его видят до нажатия «Старт».';

  return (
    <div className={cn(TG_PREVIEW_FRAME, className)}>
      <TgPreviewHeader name={title} avatarUrl={profilePhotoUrl} />

      <div
        className="relative flex min-h-[320px] flex-col items-center justify-center px-4 py-6"
        style={{ backgroundImage: TG_GREETING_BG }}
      >
        <div className="w-full max-w-[260px] overflow-hidden rounded-[14px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08),0_8px_24px_rgba(15,23,42,0.12)]">
          <div className="relative flex h-[140px] items-center justify-center bg-[#e8eef4]">
            {cardPhotoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={cardPhotoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#54a3e7]/20 text-[#2481cc]">
                <Camera className="h-7 w-7" aria-hidden />
              </div>
            )}
          </div>
          <div className="space-y-2 px-4 py-3.5 text-center">
            <p className="text-[16px] font-semibold leading-snug tracking-[-0.02em] text-[#0f0f0f]">
              {title}
            </p>
            <p className="whitespace-pre-wrap text-[13px] leading-[1.4] text-[#4a5562]">{body}</p>
            {username ? (
              <p className="pt-0.5 font-mono text-[11px] text-[#8a96a3]">
                @{username.replace(/^@/, '')}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-auto w-full max-w-[280px] pt-6">
          <div
            className="rounded-[10px] px-4 py-3 text-center text-[15px] font-semibold uppercase tracking-[0.04em] text-white shadow-sm"
            style={{ backgroundColor: TG_START_BTN }}
          >
            Старт
          </div>
        </div>
      </div>
    </div>
  );
}
