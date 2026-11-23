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
          let counterName = data.counter?.name
            ? `Счётчик подключён: «${data.counter.name}» (ID: ${counterId})`
            : `Счётчик №${counterId} подключён`;

          // Попытка отправки тестовой цели офлайн-загрузкой для валидации канала
          try {
            const testUpload = await this.uploadOfflineConversion(counterId, oauthToken, {
              target: "lead",
              idType: "CLIENT_ID",
              idValue: "1794309270387294568",
              price: 0,
              currency: "RUB",
            });
            if (testUpload.success && testUpload.uploadId) {
              counterName += `. Тестовая цель «lead» загружена (Upload ID: ${testUpload.uploadId})`;
            }
          } catch {
            // non-blocking
          }

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
   * Загрузка файла офлайн-конверсий в официальный Management API Яндекс Метрики
   */
  private async uploadOfflineConversion(
    counterId: string,
    oauthToken: string,
    params: {
      target: string;
      idType: "CLIENT_ID" | "YCLID";
      idValue: string;
      price?: number;
      currency?: string;
      timestampSeconds?: number;
    },
  ): Promise<{ success: boolean; status: number; uploadId?: number; error?: string; rawText?: string }> {
    const timestamp = params.timestampSeconds || (Math.floor(Date.now() / 1000) - 60);
    const idHeader = params.idType === "YCLID" ? "Yclid" : "ClientId";
    const price = params.price && params.price > 0 ? Math.round(params.price * 100) / 100 : 0;
    const currency = (params.currency || "RUB").toUpperCase();

    let csvContent: string;
    if (price > 0) {
      csvContent = `${idHeader},Target,DateTime,Price,Currency\n"${params.idValue.replace(/"/g, '""')}","${params.target.replace(/"/g, '""')}",${timestamp},${price},${currency}\n`;
    } else {
      csvContent = `${idHeader},Target,DateTime\n"${params.idValue.replace(/"/g, '""')}","${params.target.replace(/"/g, '""')}",${timestamp}\n`;
    }

    const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2)}`;
    const multipartBody = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="conversions.csv"\r\nContent-Type: text/csv\r\n\r\n`,
      ),
      Buffer.from(csvContent, "utf-8"),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const uploadUrl = `https://api-metrika.yandex.net/management/v1/counter/${encodeURIComponent(counterId)}/offline_conversions/upload?client_id_type=${params.idType}`;
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${oauthToken}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "User-Agent": "GetVoxly-Server-Converter/1.0",
      },
      body: multipartBody,
      signal: AbortSignal.timeout(10000),
    });

    const text = await response.text();
    if (response.ok) {
      let uploadId: number | undefined;
      try {
        const parsed = JSON.parse(text) as { uploading?: { id?: number } };
        uploadId = parsed.uploading?.id;
      } catch {}
      return { success: true, status: response.status, uploadId, rawText: text };
    }

    let parsedError = text;
    try {
      const errObj = JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> };
      parsedError = errObj.message || errObj.errors?.[0]?.message || text;
    } catch {}

    return { success: false, status: response.status, error: parsedError, rawText: text };
  }

  /**
   * Отправка боевой конверсии: загрузка через Offline Conversions API
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
    } else {
      target = rawTarget.toLowerCase();
    }

    // Определение типа идентификатора: ClientId или Yclid
    let idType: "CLIENT_ID" | "YCLID" = "CLIENT_ID";
    let idValue = payload.ymUid || payload.clientId || payload.yandexuid || "";

    if (!idValue && payload.yclid) {
      idType = "YCLID";
      idValue = payload.yclid;
    }

    if (!idValue) {
      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: 400,
        error: "Отсутствует идентификатор визита (ClientID / ym_uid или YCLID) для атрибуции в Яндекс Метрике",
      };
    }

    const price = Math.round((payload.budget || 0) * 100) / 100;
    const currency = (payload.currency || "RUB").toUpperCase();

    // Безопасный таймстамп строго в прошлом с запасом на дрифт серверного времени
    let timestampSeconds = Math.floor(Date.now() / 1000) - 60;
    if (payload.createdAt) {
      const parsedTime = Math.floor(new Date(payload.createdAt).getTime() / 1000);
      if (!isNaN(parsedTime) && parsedTime < timestampSeconds) {
        timestampSeconds = parsedTime;
      }
    }

    if (!oauthToken) {
      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: 400,
        error: "Не указан OAuth-токен Яндекс Метрики для загрузки офлайн-конверсий",
      };
    }

    try {
      const upload = await this.uploadOfflineConversion(counterId, oauthToken, {
        target,
        idType,
        idValue,
        price,
        currency,
        timestampSeconds,
      });

      if (upload.success) {
        const uploadSuffix = upload.uploadId ? ` (Upload ID: ${upload.uploadId})` : "";
        return {
          provider: this.provider,
          success: true,
          eventName: payload.eventName,
          status: upload.status,
          responseSnippet: `Цель «${target}» успешно загружена в Яндекс Метрику${uploadSuffix}`,
        };
      }

      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: upload.status,
        error: `Ошибка Яндекс Метрики (${upload.status}): ${upload.error || "Некорректный формат данных"}`,
        responseSnippet: upload.rawText?.slice(0, 500),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        provider: this.provider,
        success: false,
        eventName: payload.eventName,
        status: 500,
        error: `Сетевой сбой при загрузке конверсии в Яндекс Метрику: ${message}`,
      };
    }
  }
}
