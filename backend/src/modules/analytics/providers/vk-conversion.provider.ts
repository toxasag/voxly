import type { IConversionProvider } from "../conversion-provider.interface.js";
import type { ConversionEventPayload, ConversionResult } from "../analytics.types.js";
import { hashEmail, hashPhone } from "../conversion-hash.utils.js";

/**
 * Провайдер серверных конверсий ВКонтакте (VK Ads / Pixel Events API).
 */
export class VkConversionProvider implements IConversionProvider {
  readonly provider = "vk" as const;

  async sendEvent(
    payload: ConversionEventPayload,
    config: Record<string, unknown>,
  ): Promise<ConversionResult> {
    const pixelId = String(config.pixelId || "").trim();
    if (!pixelId) {
      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: 400,
        error: "VK pixelId is missing",
      };
    }

    const hashedEmail = hashEmail(payload.email);
    const hashedPhone = hashPhone(payload.phone);
    const eventName = payload.eventName || (payload.isWon ? "purchase" : "lead");

    // Формируем вызов VK RTRG / Events API
    const url = `https://vk.com/rtrg?p=${encodeURIComponent(pixelId)}&event=${encodeURIComponent(eventName)}&value=${Math.round(payload.budget || 0)}&currency=${encodeURIComponent(payload.currency || "RUB")}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "GetVoxly-Server-Converter/1.0" },
        signal: AbortSignal.timeout(6000),
      });

      return {
        provider: this.provider,
        success: response.ok,
        eventName,
        status: response.status,
        responseSnippet: `Status: ${response.status} (em=${Boolean(hashedEmail)}, ph=${Boolean(hashedPhone)})`,
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
