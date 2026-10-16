export type AuthStep = "phone" | "otp" | "email";

export type OtpChannel = "telegram" | "whatsapp" | "rumax" | "sms";

export interface OtpState {
  phone: string;
  channel: OtpChannel;
  expiresAt: number;
}

const CHANNEL_LABELS: Record<OtpChannel, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  rumax: "RuMAX",
  sms: "SMS",
};

export function getChannelLabel(channel: OtpChannel): string {
  return CHANNEL_LABELS[channel];
}