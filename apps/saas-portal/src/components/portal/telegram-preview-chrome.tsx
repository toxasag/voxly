'use client';

import { Camera } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Outer frame shared by BotGreetingPreview + TelegramPreview */
export const TG_PREVIEW_FRAME =
  'overflow-hidden rounded-xl border border-[#c8d4c4] bg-white shadow-sm';

/** Label above every gift-bot preview column */
export const TG_PREVIEW_LABEL =
  'mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground';

/** Soft mint TG wallpaper + sparse doodle icons (default chat pattern). */
export const TG_CHAT_WALLPAPER =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 160 160'%3E%3Cg fill='none' stroke='%235f8a58' stroke-width='1.15' stroke-linecap='round' stroke-linejoin='round' opacity='0.32'%3E%3Cpath d='M28 34c4-8 14-8 18 0'/%3E%3Ccircle cx='37' cy='42' r='3'/%3E%3Cpath d='M78 22l4 10 10 2-8 7 2 10-8-5-8 5 2-10-8-7 10-2z'/%3E%3Cpath d='M128 38c6 0 10 5 10 11s-4 11-10 11c-2 0-4-.5-5.5-1.5'/%3E%3Cpath d='M122.5 58.5c-1.5 1-3.5 1.5-5.5 1.5-6 0-10-5-10-11 0-2 .5-4 1.5-5.5'/%3E%3Cpath d='M22 88c0-6 5-10 10-10h8v20h-8c-5 0-10-4-10-10z'/%3E%3Cpath d='M40 78v20'/%3E%3Cpath d='M68 96c8-2 14-10 14-18 0-8-6-12-12-12s-12 4-12 12c0 8 6 16 14 18z'/%3E%3Cpath d='M110 78c8 0 14 6 14 14v6h-28v-6c0-8 6-14 14-14z'/%3E%3Ccircle cx='104' cy='72' r='5'/%3E%3Ccircle cx='116' cy='72' r='5'/%3E%3Cpath d='M30 128c6-8 18-8 24 0'/%3E%3Cpath d='M42 120v16'/%3E%3Cpath d='M78 122h18l-3 14h-12z'/%3E%3Cpath d='M84 122v-6c0-4 3-6 6-6s6 2 6 6v6'/%3E%3Cpath d='M122 118l8 8M130 118l-8 8M126 114v16'/%3E%3C/g%3E%3C/svg%3E\")";

/** Sampled from real Telegram light wallpaper (~rgb 136,172,125). */
export const TG_CHAT_BG = '#88ac7d';

/** Soft blue empty-chat wash used on the before-Start greeting screen */
export const TG_GREETING_BG =
  'radial-gradient(circle at 12% 18%, rgba(255,255,255,0.35) 0, transparent 22%), radial-gradient(circle at 88% 12%, rgba(255,255,255,0.28) 0, transparent 20%), linear-gradient(180deg, #c0d4e4 0%, #a9c3d7 100%)';

/** Inline keyboard fill (translucent green over wallpaper). */
export const TG_INLINE_BTN =
  'bg-[rgba(90,140,75,0.78)] hover:bg-[rgba(90,140,75,0.9)]';

/** Telegram «Старт» blue (sampled ~rgb 74,141,232). */
export const TG_START_BTN = '#4a8de8';

export function TgPreviewHeader({
  name,
  avatarUrl,
  subtitle = 'бот',
  className,
}: {
  name: string;
  avatarUrl?: string | null;
  subtitle?: string;
  className?: string;
}) {
  const label = name.replace(/^@/, '').trim() || 'Бот';
  const initial = label.slice(0, 1).toUpperCase();

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 border-b border-black/[0.06] bg-[#f0f2f5] px-3 py-2',
        className,
      )}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-[#6bb3e0] to-[#3a8fc9] text-[11px] font-semibold text-white">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
        ) : initial ? (
          initial
        ) : (
          <Camera className="h-3.5 w-3.5" aria-hidden />
        )}
      </div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[13px] font-semibold text-[#111]">{label}</p>
        <p className="text-[11px] text-[#8a8a8a]">{subtitle}</p>
      </div>
    </div>
  );
}
