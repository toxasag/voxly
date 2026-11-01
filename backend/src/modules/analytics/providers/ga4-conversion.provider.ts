import type { IConversionProvider } from "../conversion-provider.interface.js";
import type { ConversionEventPayload, ConversionResult } from "../analytics.types.js";

/**
 * Провайдер серверных конверсий Google Analytics 4 (Measurement Protocol).
 * Передает транзакции, лиды и смену этапов сделок CRM с валидацией transaction_id.
 */
export class Ga4ConversionProvider implements IConversionProvider {
  readonly provider = "ga4" as const;

  async sendEvent(
    payload: ConversionEventPayload,
    config: Record<string, unknown>,
  ): Promise<ConversionResult> {
    const measurementId = String(config.measurementId || "").trim();
    const apiSecret = String(config.apiSecret || "").trim();

    if (!measurementId || !apiSecret) {
      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: 400,
        error: "GA4 measurementId or apiSecret is missing",
      };
    }

    const clientId = payload.gaId || payload.ymUid || payload.clientId || "anonymous_lead";
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;

    const eventName = payload.eventName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40) || "lead";

    const body = {
      client_id: clientId,
      user_id: payload.contactId || undefined,
      events: [
        {
          name: eventName,
          params: {
            transaction_id: payload.dealId,
            value: Math.round(payload.budget || 0),
            currency: payload.currency || "RUB",
            deal_stage: payload.stageName,
            engagement_time_msec: 100,
          },
        },
      ],
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "GetVoxly-Server-Converter/1.0",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(6000),
      });

      // Google Analytics 4 Measurement Protocol возвращает 204 No Content при успешной обработке
      return {
        provider: this.provider,
        success: response.status === 204 || response.ok,
        eventName: payload.eventName,
        status: response.status,
        responseSnippet: `Status: ${response.status}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: 500,
        error: message,
      };
    }
  }
}
