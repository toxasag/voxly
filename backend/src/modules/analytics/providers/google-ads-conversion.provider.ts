import type { IConversionProvider } from "../conversion-provider.interface.js";
import type { ConversionEventPayload, ConversionResult } from "../analytics.types.js";

/**
 * Провайдер серверных конверсий Google Ads.
 */
export class GoogleAdsConversionProvider implements IConversionProvider {
  readonly provider = "google_ads" as const;

  async sendEvent(
    payload: ConversionEventPayload,
    config: Record<string, unknown>,
  ): Promise<ConversionResult> {
    const conversionId = String(config.conversionId || "").trim();
    const conversionLabel = String(config.conversionLabel || "").trim();

    if (!conversionId) {
      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: 400,
        error: "Google Ads conversionId is missing",
      };
    }

    const eventName = payload.eventName || (payload.isWon ? "Purchase" : "Lead");

    // Формируем вызов Google Ads Click/Offline Conversion URL
    const url = `https://www.googleadservices.com/pagead/conversion/${encodeURIComponent(conversionId)}/?label=${encodeURIComponent(conversionLabel)}&value=${payload.budget}&currency_code=${encodeURIComponent(payload.currency || "RUB")}&guid=ON&script=0`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: { "User-Agent": "GetVoxly-Server-Converter/1.0" },
        signal: AbortSignal.timeout(6000),
      });

      return {
        provider: this.provider,
        success: response.ok || response.status === 200 || response.status === 302,
        eventName,
        status: response.status,
        responseSnippet: `Status: ${response.status}`,
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
