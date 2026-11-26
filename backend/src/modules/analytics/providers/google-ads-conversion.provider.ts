import type { IConversionProvider } from "../conversion-provider.interface.js";
import type { ConversionEventPayload, ConversionResult } from "../analytics.types.js";
import { hashEmail, hashPhone } from "../conversion-hash.utils.js";

/**
 * Форматирование даты строго по спецификации Google Ads API offline conversions:
 * yyyy-mm-dd hh:mm:ss+|-hh:mm (например: "2026-11-26 13:00:00+00:00")
 */
function formatGoogleAdsDateTime(dateInput?: Date | string | null): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  const validDate = isNaN(d.getTime()) ? new Date() : d;

  const pad = (n: number) => String(n).padStart(2, "0");
  const year = validDate.getUTCFullYear();
  const month = pad(validDate.getUTCMonth() + 1);
  const day = pad(validDate.getUTCDate());
  const hours = pad(validDate.getUTCHours());
  const minutes = pad(validDate.getUTCMinutes());
  const seconds = pad(validDate.getUTCSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}+00:00`;
}

/**
 * Получение свежего access_token по refresh_token через официальный Google OAuth2 endpoint
 */
async function refreshGoogleOAuthToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(6000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google OAuth error ${response.status}: ${errorText.slice(0, 150)}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("Google OAuth did not return access_token");
  }
  return data.access_token;
}

/**
 * Провайдер серверных конверсий Google Ads.
 *
 * Поддерживает 2 официальных метода доставки офлайн-конверсий:
 * 1. Google Ads API v17 (uploadClickConversions):
 *    - Прямой вызов API с developer-token и OAuth2 токеном
 *    - Передача gclid, gbraid, wbraid и Enhanced Conversions (хэшированные SHA-256 email/телефон)
 * 2. Мост Google Analytics 4 (Measurement Protocol):
 *    - Если настроен связанный поток GA4 (measurementId + apiSecret), конверсия передается с gclid
 *    - Google Ads автоматически импортирует события из связанного ресурса GA4
 *
 * Если API-учетные данные отсутствуют (например, указан только браузерный gtag conversionId/label),
 * провайдер честно возвращает статус 400 с понятной инструкцией в UI, исключая ложные 200 статусы.
 */
export class GoogleAdsConversionProvider implements IConversionProvider {
  readonly provider = "google_ads" as const;

  async sendEvent(
    payload: ConversionEventPayload,
    config: Record<string, unknown>,
  ): Promise<ConversionResult> {
    const eventName = payload.eventName || (payload.isWon ? "Purchase" : "Lead");

    // 1. Проверяем наличие идентификаторов клика или контакта
    const gclid = payload.gclid?.trim() || null;
    const gbraid = payload.gbraid?.trim() || null;
    const wbraid = payload.wbraid?.trim() || null;
    const email = payload.email?.trim() || null;
    const phone = payload.phone?.trim() || null;

    const hasClickId = Boolean(gclid || gbraid || wbraid);
    const hasUserIdentifier = Boolean(email || phone);

    if (!hasClickId && !hasUserIdentifier) {
      return {
        provider: this.provider,
        success: false,
        eventName,
        status: 422,
        error:
          "Отсутствуют идентификаторы клика Google Ads (gclid, gbraid, wbraid) и контактные данные (email, телефон) для атрибуции конверсии.",
        responseSnippet: "Unattributable: missing clickId and contact info",
      };
    }

    // 2. Извлекаем учетные данные
    const rawCustomerId = String(config.customerId || config.counterId || "").trim();
    const customerId = rawCustomerId.replace(/[^0-9]/g, "");
    const conversionActionId = String(config.conversionActionId || config.conversionLabel || "").trim();
    const developerToken = String(config.developerToken || "").trim();
    let accessToken = String(config.accessToken || config.oauthToken || "").trim();
    const refreshToken = String(config.refreshToken || "").trim();
    const clientId = String(config.clientId || "").trim();
    const clientSecret = String(config.clientSecret || "").trim();

    const ga4MeasurementId = String(config.ga4MeasurementId || config.measurementId || "").trim();
    const ga4ApiSecret = String(config.ga4ApiSecret || config.apiSecret || "").trim();

    // -------------------------------------------------------------------------
    // Вариант 1: Прямая отправка через Google Ads API (uploadClickConversions)
    // -------------------------------------------------------------------------
    if (developerToken && customerId && (accessToken || (refreshToken && clientId && clientSecret))) {
      try {
        if (!accessToken && refreshToken && clientId && clientSecret) {
          accessToken = await refreshGoogleOAuthToken(clientId, clientSecret, refreshToken);
        }

        const conversionDateTime = formatGoogleAdsDateTime(payload.createdAt);

        // Формирование ресурса действия конверсии: customers/{customerId}/conversionActions/{conversionActionId}
        const conversionAction = conversionActionId.startsWith("customers/")
          ? conversionActionId
          : conversionActionId
            ? `customers/${customerId}/conversionActions/${conversionActionId}`
            : undefined;

        if (!conversionAction) {
          return {
            provider: this.provider,
            success: false,
            eventName,
            status: 400,
            error: "Google Ads conversionActionId (или conversionLabel) не указан в настройках.",
          };
        }

        // Подготовка Enhanced Conversions (хэшированные SHA-256 контакты)
        const userIdentifiers: Array<Record<string, unknown>> = [];
        const hashedEmail = hashEmail(email);
        if (hashedEmail) {
          userIdentifiers.push({ hashedEmail });
        }
        const hashedPhone = hashPhone(phone);
        if (hashedPhone) {
          userIdentifiers.push({ hashedPhoneNumber: hashedPhone });
        }

        const conversionItem: Record<string, unknown> = {
          conversionAction,
          conversionDateTime,
          conversionValue: Math.max(0, Number(payload.budget) || 0),
          currencyCode: payload.currency || "RUB",
          orderId: payload.dealId || undefined,
        };

        if (gclid) conversionItem.gclid = gclid;
        if (gbraid) conversionItem.gbraid = gbraid;
        if (wbraid) conversionItem.wbraid = wbraid;
        if (userIdentifiers.length > 0) {
          conversionItem.userIdentifiers = userIdentifiers;
        }

        const uploadUrl = `https://googleads.googleapis.com/v17/customers/${customerId}:uploadClickConversions`;
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${accessToken}`,
            "developer-token": developerToken,
            "Content-Type": "application/json",
            "User-Agent": "GetVoxly-Server-Converter/1.0",
          },
          body: JSON.stringify({
            conversions: [conversionItem],
            partialFailure: true,
          }),
          signal: AbortSignal.timeout(10000),
        });

        const resText = await response.text();
        let resJson: {
          partialFailureError?: { message?: string; details?: unknown[] };
          results?: unknown[];
        } = {};

        try {
          resJson = JSON.parse(resText);
        } catch {
          // ignore json parse error
        }

        if (!response.ok) {
          return {
            provider: this.provider,
            success: false,
            eventName,
            status: response.status,
            error: `Google Ads API error (${response.status}): ${resText.slice(0, 200)}`,
            responseSnippet: resText.slice(0, 200),
          };
        }

        // Проверяем partialFailureError в теле успешного ответа
        if (resJson.partialFailureError?.message) {
          return {
            provider: this.provider,
            success: false,
            eventName,
            status: 400,
            error: `Google Ads API validation: ${resJson.partialFailureError.message}`,
            responseSnippet: JSON.stringify(resJson.partialFailureError).slice(0, 200),
          };
        }

        return {
          provider: this.provider,
          success: true,
          eventName,
          status: 200,
          responseSnippet: `Google Ads API OK (GCLID: ${gclid ? "да" : "нет"}, ID: ${payload.dealId})`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          provider: this.provider,
          success: false,
          eventName,
          status: 500,
          error: `Google Ads API upload failed: ${message}`,
        };
      }
    }

    // -------------------------------------------------------------------------
    // Вариант 2: Передача через связанный поток Google Analytics 4 (Measurement Protocol)
    // -------------------------------------------------------------------------
    if (ga4MeasurementId && ga4ApiSecret) {
      try {
        const gaClientId = payload.gaId || payload.clientId || payload.ymUid || "anonymous_lead";
        const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(ga4MeasurementId)}&api_secret=${encodeURIComponent(ga4ApiSecret)}`;

        const gaEventName = payload.isWon
          ? "purchase"
          : eventName.toLowerCase().includes("lead") || eventName.toLowerCase().includes("заявка")
            ? "generate_lead"
            : eventName.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 40) || "conversion";

        const params: Record<string, unknown> = {
          transaction_id: payload.dealId,
          value: Math.round(payload.budget || 0),
          currency: payload.currency || "RUB",
          deal_stage: payload.stageName,
          engagement_time_msec: 100,
        };

        if (gclid) params.gclid = gclid;
        if (gbraid) params.gbraid = gbraid;
        if (wbraid) params.wbraid = wbraid;

        const body = {
          client_id: gaClientId,
          user_id: payload.contactId || undefined,
          events: [
            {
              name: gaEventName,
              params,
            },
          ],
        };

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "GetVoxly-Server-Converter/1.0",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(6000),
        });

        const isSuccess = response.status === 204 || response.ok;
        return {
          provider: this.provider,
          success: isSuccess,
          eventName,
          status: response.status,
          responseSnippet: isSuccess
            ? `GA4 MP Bridge OK (GCLID: ${gclid ? "привязан" : "нет"}, статус ${response.status})`
            : `GA4 MP Bridge status: ${response.status}`,
          error: isSuccess ? undefined : `GA4 MP returned status ${response.status}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          provider: this.provider,
          success: false,
          eventName,
          status: 500,
          error: `GA4 MP Bridge failed: ${message}`,
        };
      }
    }

    // -------------------------------------------------------------------------
    // Вариант 3: Недостаточно данных для серверной отправки (gtag AW-...)
    // -------------------------------------------------------------------------
    return {
      provider: this.provider,
      success: false,
      eventName,
      status: 400,
      error:
        "Для серверной передачи конверсий в Google Ads требуется указать Developer Token и OAuth2-токен Google Ads API либо подключить связанный поток Google Analytics 4 (Measurement Protocol). Браузерные теги AW-... не поддерживают прямую серверную отправку.",
      responseSnippet: "Google Ads API / GA4 credentials required",
    };
  }
}
