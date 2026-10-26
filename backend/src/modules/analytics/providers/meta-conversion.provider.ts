import type { IConversionProvider } from "../conversion-provider.interface.js";
import type { ConversionEventPayload, ConversionResult } from "../analytics.types.js";
import { hashEmail, hashPhone } from "../conversion-hash.utils.js";

/**
 * Провайдер серверных конверсий Meta Conversions API (CAPI).
 * Передает события воронки с SHA-256 хэшированными контактами (phone, email)
 * и параметрами транзакции (value, currency).
 */
export class MetaConversionProvider implements IConversionProvider {
  readonly provider = "meta" as const;

  async sendEvent(
    payload: ConversionEventPayload,
    config: Record<string, unknown>,
  ): Promise<ConversionResult> {
    const pixelId = String(config.pixelId || "").trim();
    const accessToken = String(config.accessToken || "").trim();

    if (!pixelId || !accessToken) {
      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: 400,
        error: "Meta pixelId or accessToken is missing",
      };
    }

    const hashedEmail = hashEmail(payload.email);
    const hashedPhone = hashPhone(payload.phone);

    const eventName = payload.eventName || (payload.isWon ? "Purchase" : "Lead");
    const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;

    const eventData = {
      event_name: eventName,
      event_time: Math.floor(Date.now() / 1000),
      event_id: `${payload.dealId}-${payload.stageId}`,
      action_source: "system_generated",
      user_data: {
        ...(hashedEmail ? { em: [hashedEmail] } : {}),
        ...(hashedPhone ? { ph: [hashedPhone] } : {}),
        ...(payload.fbId ? { fbp: payload.fbId } : {}),
        client_user_agent: "GetVoxly-Server-Converter/1.0",
      },
      custom_data: {
        currency: payload.currency || "RUB",
        value: payload.budget || 0,
        order_id: payload.dealId,
      },
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: [eventData] }),
        signal: AbortSignal.timeout(6000),
      });

      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      return {
        provider: this.provider,
        success: response.ok,
        eventName,
        status: response.status,
        responseSnippet: JSON.stringify(json).slice(0, 150),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        provider: this.provider,
        success: false,
        eventName,
        status: 500,
        error: message,
      };
    }
  }
}
