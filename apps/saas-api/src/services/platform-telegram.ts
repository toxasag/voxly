/**
 * Outbound Telegram helpers for @GetVoxlybot (OTP, support replies, broadcasts).
 */

const PLATFORM_BOT_TOKEN = () => process.env.PLATFORM_BOT_TOKEN?.trim() || '';
const PLATFORM_BOT_USERNAME = () =>
  (process.env.PLATFORM_BOT_USERNAME || 'GetVoxlybot').replace(/^@/, '');

export function platformBotUsername(): string {
  return PLATFORM_BOT_USERNAME();
}

export function platformBotDeepLink(nonce: string): string {
  return `https://t.me/${PLATFORM_BOT_USERNAME()}?start=auth_${nonce}`;
}

export async function sendPlatformTelegramMessage(
  chatId: number | bigint,
  text: string,
): Promise<boolean> {
  const token = PLATFORM_BOT_TOKEN();
  if (!token) {
    console.warn('[platform-telegram] PLATFORM_BOT_TOKEN unset');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: Number(chatId),
        text,
        disable_web_page_preview: true,
      }),
    });
    const data = (await res.json()) as { ok?: boolean; description?: string };
    if (!data.ok) {
      console.warn('[platform-telegram] send failed:', data.description);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[platform-telegram] send error:', err);
    return false;
  }
}

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
