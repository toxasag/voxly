import type { IConversionProvider } from "../conversion-provider.interface.js";
import type { ConversionEventPayload, ConversionResult } from "../analytics.types.js";

/**
 * Провайдер серверных конверсий Яндекс.Метрики.
 * Поддерживает:
 * 1. Проверку подключения и прав доступа к счётчику через Yandex Metrika Management API v1.
 * 2. Офлайн-конверсии Яндекс.Метрики (POST /management/v1/counter/{id}/offline_conversions/upload)
 *    с передачей целей (lead, purchase, chat), сумм и валюты.
 * 3. Резервный канал Яндекс Measurement Protocol.
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
        error: "Не указан номер счётчика Яндекс Метрики",
      };
    }

    const oauthToken = typeof config.oauthToken === "string" ? config.oauthToken.trim() : "";

    // 1. Проверочный режим (Тест соединения / валидация токена)
    if (payload.isTest) {
      return this.testConnection(counterId, oauthToken, payload.eventName);
    }

    // 2. Боевая отправка конверсии
    return this.sendLiveConversion(counterId, oauthToken, payload);
  }

  /**
   * Проверка соединения и прав доступа к счётчику через официальный Management API Яндекс Метрики
   */
  private async testConnection(
    counterId: string,
    oauthToken: string,
    eventName: string,
  ): Promise<ConversionResult> {
    if (oauthToken) {
      try {
        const url = `https://api-metrika.yandex.net/management/v1/counter/${encodeURIComponent(counterId)}`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: `OAuth ${oauthToken}`,
            "User-Agent": "GetVoxly-Server-Converter/1.0",
          },
          signal: AbortSignal.timeout(7000),
        });

        if (response.ok) {
          const data = (await response.json()) as {
            counter?: {
              id?: number;
              name?: string;
              site?: string;
              status?: string;
            };
          };
          const counterName = data.counter?.name
            ? `Счётчик подключён: «${data.counter.name}» (ID: ${counterId})`
            : `Счётчик №${counterId} подключён`;
          return {
            provider: this.provider,
            success: true,
            eventName,
            status: response.status,
            responseSnippet: counterName,
          };
        }

        const errText = await response.text();
        if (response.status === 401 || response.status === 403) {
          return {
            provider: this.provider,
            success: false,
            eventName,
            status: response.status,
            error: `Неверный OAuth-токен или нет прав доступа к счётчику №${counterId}`,
            responseSnippet: errText.slice(0, 300),
          };
        }

        if (response.status === 404) {
          return {
            provider: this.provider,
            success: false,
            eventName,
            status: 404,
            error: `Счётчик №${counterId} не найден в аккаунте Яндекс Метрики`,
            responseSnippet: errText.slice(0, 300),
          };
        }

        return {
          provider: this.provider,
          success: false,
          eventName,
          status: response.status,
          error: `Ошибка Яндекс Метрики (HTTP ${response.status})`,
          responseSnippet: errText.slice(0, 300),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          provider: this.provider,
          success: false,
          eventName,
          status: 500,
          error: `Таймаут или сбой соединения с API Яндекс Метрики: ${message}`,
        };
      }
    }

    // Если OAuth-токен не указан, проверяем доступность через Measurement Protocol
    try {
      const mpUrl = `https://mc.yandex.ru/collect?tid=${encodeURIComponent(counterId)}&cid=test_lead_client_id&t=event&ec=crm&ea=test&el=GetVoxly`;
      const response = await fetch(mpUrl, {
        method: "GET",
        headers: { "User-Agent": "GetVoxly-Server-Converter/1.0" },
        signal: AbortSignal.timeout(6000),
      });

      if (response.ok) {
        return {
          provider: this.provider,
          success: true,
          eventName,
          status: response.status,
          responseSnippet: `Счётчик №${counterId}: Measurement Protocol активен`,
        };
      }

      return {
        provider: this.provider,
        success: false,
        eventName,
        status: 400,
        error: "Укажите OAuth-токен Яндекс Метрики для проверки прав доступа и серверных конверсий",
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

  /**
   * Отправка боевой конверсии: приоритетно через Offline Conversions API, с фоллбэком на Measurement Protocol
   */
  private async sendLiveConversion(
    counterId: string,
    oauthToken: string,
    payload: ConversionEventPayload,
  ): Promise<ConversionResult> {
    const rawTarget = payload.eventName || "lead";
    let target = rawTarget;
    if (rawTarget === "Purchase" || payload.isWon) {
      target = "purchase";
    } else if (rawTarget === "Lead") {
      target = "lead";
    } else if (rawTarget === "Chat") {
      target = "chat";
    }

    const clientId = payload.ymUid || payload.clientId || payload.yandexuid || "anonymous_lead";
    const price = Math.round((payload.budget || 0) * 100) / 100;
    const currency = (payload.currency || "RUB").toUpperCase();
    const timestamp = Math.floor(Date.now() / 1000);

    // 1. Приоритетный путь: загрузка офлайн-конверсии через официальный API Яндекс Метрики
    if (oauthToken) {
      try {
        const csvHeaders = "ClientId,Target,DateTime,Price,Currency";
        const csvRow = [
          `"${String(clientId).replace(/"/g, '""')}"`,
          `"${String(target).replace(/"/g, '""')}"`,
          String(timestamp),
          price > 0 ? String(price) : "",
          currency,
        ].join(",");
        const csvContent = `${csvHeaders}\n${csvRow}\n`;

        const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2)}`;
        const multipartBody = Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="conversions.csv"\r\nContent-Type: text/csv\r\n\r\n`,
          ),
          Buffer.from(csvContent, "utf-8"),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);

        const uploadUrl = `https://api-metrika.yandex.net/management/v1/counter/${encodeURIComponent(counterId)}/offline_conversions/upload?client_id_type=CLIENT_ID`;
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `OAuth ${oauthToken}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "User-Agent": "GetVoxly-Server-Converter/1.0",
          },
          body: multipartBody,
          signal: AbortSignal.timeout(8000),
        });

        if (response.ok) {
          return {
            provider: this.provider,
            success: true,
            eventName: payload.eventName,
            status: response.status,
            responseSnippet: `Цель «${target}» успешно загружена в Яндекс Метрику`,
          };
        }
      } catch (err) {
        console.warn(`[YandexConversionProvider] Offline conversion upload error:`, err);
        // Продолжаем к фоллбэку Measurement Protocol
      }
    }

    // 2. Фоллбэк: Яндекс Measurement Protocol
    const mpUrl = `https://mc.yandex.ru/collect?tid=${encodeURIComponent(counterId)}&cid=${encodeURIComponent(clientId)}&t=event&ec=crm&ea=${encodeURIComponent(target)}&el=${price}`;

    try {
      const response = await fetch(mpUrl, {
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
        responseSnippet: response.ok
          ? `Measurement Protocol: статус ${response.status}`
          : `Measurement Protocol вернул ${response.status}`,
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
