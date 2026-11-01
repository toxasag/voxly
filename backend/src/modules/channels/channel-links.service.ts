import { getEnv } from "../../config/env.js";
import type { ChannelSlug } from "../../types/index.js";
import type {
  ChannelAccountLinksDTO,
  CustomizeAccountLinksQuery,
} from "./channels.types.js";

export interface AccountLinkResolutionInput {
  id?: string;
  channel: ChannelSlug;
  label?: string;
  external_id: string;
  credentials?: Record<string, unknown> | null;
  remote_user_id?: string | null;
  cred_username?: string | null;
  cred_phone?: string | null;
  cred_bot?: string | null;
  has_session?: boolean;
}

export class ChannelLinksService {
  private getPublicApiUrl(): string {
    const raw = getEnv().PUBLIC_API_URL;
    return raw && raw.trim().length > 0 ? raw.trim().replace(/\/+$/, "") : "https://api.getvoxly.ru";
  }

  /**
   * Очищает и форматирует логин/номер в зависимости от мессенджера.
   */
  extractCleanIdentifier(account: AccountLinkResolutionInput): string {
    const creds = account.credentials ?? {};
    const credUsername = account.cred_username ?? (typeof creds.username === "string" ? creds.username : null);
    const credBot = account.cred_bot ?? (typeof creds.telegramBot === "string" ? creds.telegramBot : null);
    const credPhone = account.cred_phone ?? (typeof creds.phone === "string" ? creds.phone : null);

    if (account.channel === "whatsapp") {
      const rawPhone = credPhone || account.external_id || "";
      let digits = rawPhone.replace(/\D/g, "");
      if (digits.length === 11 && digits.startsWith("8")) {
        digits = `7${digits.slice(1)}`;
      }
      return digits || "79991234567";
    }

    if (account.channel === "telegram" || account.channel === "telegram_bot") {
      const raw = credUsername || credBot || account.external_id || "";
      return raw.replace(/^@/, "").trim();
    }

    if (account.channel === "max" || account.channel === "max_bot") {
      const raw = credUsername || account.external_id || "";
      return raw.replace(/^@/, "").trim();
    }

    return (account.external_id || "").replace(/^@/, "").trim();
  }

  /**
   * Определяет подтип аккаунта:
   * - bot: Telegram Bot API (@BotFather) или MAX бот
   * - user_api: Личный аккаунт Telegram (MTProto сессия)
   * - whatsapp: Номер WhatsApp (WABA или Evolution QR)
   * - max: Личный профиль MAX
   */
  resolveAccountType(account: AccountLinkResolutionInput, cleanId: string): ChannelAccountLinksDTO["accountType"] {
    if (account.channel === "whatsapp") {
      return "whatsapp";
    }

    if (account.channel === "telegram_bot") {
      return "bot";
    }

    if (account.channel === "max_bot") {
      return "bot";
    }

    if (account.channel === "max") {
      return "max";
    }

    if (account.channel === "telegram") {
      const creds = account.credentials ?? {};
      const hasSession = account.has_session ?? (typeof creds.session === "string" && creds.session.length > 0);
      if (hasSession) {
        return "user_api";
      }

      if (creds.telegramBot || creds.botToken) {
        return "bot";
      }

      if (/bot$/i.test(cleanId)) {
        return "bot";
      }

      if (/^\+?\d{10,15}$/.test(cleanId)) {
        return "user_api";
      }

      return "user_api";
    }

    return "default";
  }

  /**
   * Формирует полный набор ссылок для аккаунта.
   */
  resolveAccountLinks(
    account: AccountLinkResolutionInput,
    options?: CustomizeAccountLinksQuery,
  ): ChannelAccountLinksDTO {
    const cleanId = this.extractCleanIdentifier(account);
    const accountType = this.resolveAccountType(account, cleanId);
    const publicApiUrl = this.getPublicApiUrl();

    const defaultText = options?.text?.trim() || "Здравствуйте!";
    const startTag = options?.startTag?.trim();
    const btnTag = options?.btn?.trim();

    let directUrl = "";

    if (accountType === "bot") {
      const base = `https://t.me/${cleanId}`;
      directUrl = startTag ? `${base}?start=${encodeURIComponent(startTag)}` : base;
    } else if (accountType === "user_api") {
      const isDigits = /^\d+$/.test(cleanId);
      const base = isDigits ? `https://t.me/+${cleanId}` : `https://t.me/${cleanId}`;
      directUrl = defaultText ? `${base}?text=${encodeURIComponent(defaultText)}` : base;
    } else if (accountType === "whatsapp") {
      const base = `https://wa.me/${cleanId}`;
      directUrl = defaultText ? `${base}?text=${encodeURIComponent(defaultText)}` : base;
    } else if (accountType === "max") {
      directUrl = `https://max.ru/${cleanId}`;
    } else {
      directUrl = `https://t.me/${cleanId}`;
    }

    // Формирование ссылки умного редиректора
    const trackingParams = new URLSearchParams();
    if (btnTag) {
      trackingParams.set("btn", btnTag);
    }
    if (options?.text?.trim()) {
      trackingParams.set("text", options.text.trim());
    }

    const queryStr = trackingParams.toString();
    const idPart = account.id || cleanId;
    const trackingUrl = queryStr
      ? `${publicApiUrl}/to/${idPart}?${queryStr}`
      : `${publicApiUrl}/to/${idPart}`;

    return {
      directUrl,
      trackingUrl,
      accountType,
      cleanIdentifier: cleanId,
      defaultText: options?.text ?? (accountType === "bot" ? undefined : defaultText),
      startTag: startTag ?? (accountType === "bot" ? "site_lead" : undefined),
      btnTag: btnTag ?? undefined,
    };
  }

  /**
   * Строит глубокую ссылку назначения при срабатывании умного редиректора.
   */
  buildDestinationDeepLink(
    account: AccountLinkResolutionInput,
    context: {
      sessionToken: string;
      prechatLeadCode: string;
      text?: string | null;
      btn?: string | null;
    },
  ): string {
    const cleanId = this.extractCleanIdentifier(account);
    const accountType = this.resolveAccountType(account, cleanId);

    if (accountType === "bot") {
      // Telegram бот получает sessionToken через /start <token>
      return `https://t.me/${cleanId}?start=${context.sessionToken}`;
    }

    const greeting = context.text?.trim() || "Здравствуйте!";
    const codeTag = `(код: ${context.prechatLeadCode})`;
    const fullText = `${greeting} ${codeTag}`.trim();

    if (accountType === "whatsapp") {
      return `https://wa.me/${cleanId}?text=${encodeURIComponent(fullText)}`;
    }

    if (accountType === "user_api") {
      const isDigits = /^\d+$/.test(cleanId);
      const base = isDigits ? `https://t.me/+${cleanId}` : `https://t.me/${cleanId}`;
      return `${base}?text=${encodeURIComponent(fullText)}`;
    }

    if (accountType === "max") {
      return `https://max.ru/${cleanId}?start=${context.sessionToken}`;
    }

    return `https://t.me/${cleanId}?start=${context.sessionToken}`;
  }
}

export const channelLinksService = new ChannelLinksService();
