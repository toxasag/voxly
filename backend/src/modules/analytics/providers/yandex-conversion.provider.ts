import type { IConversionProvider } from "../conversion-provider.interface.js";
import type { ConversionEventPayload, ConversionResult } from "../analytics.types.js";

/**
 * Провайдер серверных конверсий Яндекс.Метрики.
 * Поддерживает Яндекс Measurement Protocol (отправка достижения целей и сумм заказов).
 */
export class YandexConversionProvider implements IConversionProvider {
  readonly provider = "yandex" as const;

  async sendEvent(
    payload: ConversionEventPayload,
    config: Record<string, unknown>,
  ): Promise<ConversionResult> {
    const counterId = String(config.counterId || "").trim();
    if (!counterId) {
      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: 400,
        error: "Yandex counterId is not configured",
      };
    }

    const clientId = payload.ymUid || payload.clientId || payload.yandexuid || "anonymous_lead";
    const target = encodeURIComponent(payload.eventName || "crm_conversion");
    const price = Math.round(payload.budget || 0);
    const currency = encodeURIComponent(payload.currency || "RUB");

    // Формируем URL Measurement Protocol Яндекс Метрики
    const url = `https://mc.yandex.ru/collect/${counterId}?client_id=${encodeURIComponent(clientId)}&target=${target}&price=${price}&currency=${currency}`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          "User-Agent": "GetVoxly-Server-Converter/1.0",
        },
        signal: AbortSignal.timeout(6000),
      });

      return {
        provider: this.provider,
        success: response.ok,
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
