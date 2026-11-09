// ---------------------------------------------------------------------------
// Сервис интеграции с Битрикс24 (исходящие лиды / crm.lead.add).
//
// Выполняет нормализацию webhook URL, защиту от SSRF, формирование структуры полей,
// асинхронную отправку лидов с жесткими параметрами (SOURCE_ID, UF_CRM_YA_CID)
// и фиксацию статуса синхронизации в tenant_bitrix24_configs под RLS.
// ---------------------------------------------------------------------------

import { query, queryOne } from "../../../db/client.js";
import { AppError } from "../../../plugins/errorHandler.js";
import type {
  Bitrix24ConfigDTO,
  Bitrix24ConfigRow,
  Bitrix24LeadAddRequest,
  Bitrix24LeadAddResponse,
  Bitrix24TestResult,
  UpdateBitrix24ConfigPayload,
} from "./bitrix24.types.js";

export const BITRIX24_SOURCE_ID = "UC_VWN1ZK";
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Валидация и нормализация входящего вебхука Битрикс24.
 * Поддерживает форматы:
 * - https://domain.bitrix24.ru/rest/1/token/
 * - https://domain.bitrix24.ru/rest/1/token
 * - https://domain.bitrix24.ru/rest/1/token/crm.lead.add.json
 */
export function normalizeBitrixWebhookUrl(rawUrl: string, method = "crm.lead.add.json"): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new AppError(400, "INVALID_URL", "URL вебхука Битрикс24 не может быть пустым");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new AppError(400, "INVALID_URL", "Некорректный формат URL вебхука");
  }

  // 1. Протокол строго HTTPS
  if (parsed.protocol !== "https:") {
    throw new AppError(400, "INSECURE_PROTOCOL", "Вебхук Битрикс24 обязан использовать безопасный протокол HTTPS");
  }

  // 2. Защита от SSRF (запрет localhost и приватных IP)
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "0.0.0.0" ||
    hostname.startsWith("10.") ||
    hostname.startsWith("192.168.") ||
    hostname.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  ) {
    throw new AppError(400, "SSRF_FORBIDDEN", "Указание внутренних адресов и localhost запрещено политикой безопасности");
  }

  let cleanPath = parsed.pathname.replace(/\/+$/, "");
  // Убираем уже указанный метод, если пользователь вставил полную ссылку
  cleanPath = cleanPath.replace(/\/(crm\.lead\.add(\.json)?|profile(\.json)?)$/i, "");

  return `${parsed.origin}${cleanPath}/${method}`;
}

export class Bitrix24Service {
  /**
   * Получение текущей конфигурации Битрикс24 для арендатора.
   */
  async getConfig(tenantId: string): Promise<Bitrix24ConfigDTO> {
    const row = await queryOne<Bitrix24ConfigRow>(
      `SELECT tenant_id, webhook_url, is_enabled, last_lead_id, last_sync_at, last_error, created_at, updated_at
       FROM tenant_bitrix24_configs
       WHERE tenant_id = $1`,
      [tenantId],
    );

    if (!row) {
      return {
        webhook_url: "",
        is_enabled: false,
        last_lead_id: null,
        last_sync_at: null,
        last_error: null,
      };
    }

    return {
      webhook_url: row.webhook_url,
      is_enabled: row.is_enabled,
      last_lead_id: row.last_lead_id,
      last_sync_at:
        row.last_sync_at instanceof Date
          ? row.last_sync_at.toISOString()
          : row.last_sync_at
            ? String(row.last_sync_at)
            : null,
      last_error: row.last_error,
    };
  }

  /**
   * Сохранение конфигурации вебхука Битрикс24.
   */
  async saveConfig(tenantId: string, payload: UpdateBitrix24ConfigPayload): Promise<Bitrix24ConfigDTO> {
    const rawUrl = payload.webhook_url ? payload.webhook_url.trim() : "";
    const isEnabled = payload.is_enabled ?? false;

    // Если включено, URL обязан быть валидным
    if (isEnabled && !rawUrl) {
      throw new AppError(400, "VALIDATION_ERROR", "Для активации интеграции укажите URL вебхука Битрикс24");
    }

    if (rawUrl) {
      // Валидируем базовый URL
      normalizeBitrixWebhookUrl(rawUrl);
    }

    const row = await queryOne<Bitrix24ConfigRow>(
      `INSERT INTO tenant_bitrix24_configs (
         tenant_id, webhook_url, is_enabled, updated_at
       )
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
       SET webhook_url = EXCLUDED.webhook_url,
           is_enabled = EXCLUDED.is_enabled,
           updated_at = NOW()
       RETURNING *`,
      [tenantId, rawUrl, isEnabled],
    );

    if (!row) {
      throw new AppError(500, "DB_ERROR", "Не удалось сохранить конфигурацию Битрикс24");
    }

    return {
      webhook_url: row.webhook_url,
      is_enabled: row.is_enabled,
      last_lead_id: row.last_lead_id,
      last_sync_at:
        row.last_sync_at instanceof Date
          ? row.last_sync_at.toISOString()
          : row.last_sync_at
            ? String(row.last_sync_at)
            : null,
      last_error: row.last_error,
    };
  }

  /**
   * Тестовая отправка лида в Битрикс24 для проверки подключения.
   */
  async testConnection(tenantId: string, customWebhookUrl?: string): Promise<Bitrix24TestResult> {
    let webhookUrl = customWebhookUrl ? customWebhookUrl.trim() : "";
    if (!webhookUrl) {
      const cfg = await this.getConfig(tenantId);
      webhookUrl = cfg.webhook_url;
    }

    if (!webhookUrl) {
      return {
        success: false,
        message: "Не указан URL входящего вебхука Битрикс24",
      };
    }

    const targetUrl = normalizeBitrixWebhookUrl(webhookUrl);

    // Получаем имя арендатора
    const tenantRow = await queryOne<{ name: string; slug: string }>(
      `SELECT name, slug FROM tenants WHERE id = $1`,
      [tenantId],
    );
    const tenantIdentifier = tenantRow?.slug || tenantRow?.name || "тест";

    const testPayload: Bitrix24LeadAddRequest = {
      fields: {
        TITLE: `[ТЕСТ] Проверка интеграции GetVoxly — [${tenantIdentifier}]`,
        NAME: "Тестовый Лид",
        PHONE: [{ VALUE: "+79990000000", VALUE_TYPE: "WORK" }],
        SOURCE_ID: BITRIX24_SOURCE_ID,
        UF_CRM_YA_CID: "1234567890123456789",
        COMMENTS: "Тестовая проверка связи с Битрикс24 из настроек каналов GetVoxly",
        STATUS_ID: "NEW",
      },
      params: {
        REGISTER_SONET_EVENT: "Y",
      },
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(testPayload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = (await response.json()) as Bitrix24LeadAddResponse;

      if (!response.ok || data.error) {
        const errorText = data.error_description || data.error || `HTTP ${response.status}`;
        await this.updateSyncStatus(tenantId, null, errorText);
        return {
          success: false,
          message: `Ошибка Битрикс24: ${errorText}`,
          error: errorText,
        };
      }

      if (data.result) {
        await this.updateSyncStatus(tenantId, String(data.result), null);
        return {
          success: true,
          leadId: data.result,
          message: `Подключение успешно! Создан тестовый лид ID: ${data.result}`,
        };
      }

      return {
        success: false,
        message: "Неожиданный ответ от API Битрикс24",
      };
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Таймаут соединения (Битрикс24 не ответил за 20с)"
            : err.message
          : String(err);

      await this.updateSyncStatus(tenantId, null, errorMsg);

      return {
        success: false,
        message: `Сбой отправки: ${errorMsg}`,
        error: errorMsg,
      };
    }
  }

  /**
   * Отправка реального лида в Битрикс24 при поступлении заявки.
   * Отказоустойчива: никогда не выбрасывает наружу необработанные исключения.
   */
  async sendLead(
    tenantId: string,
    leadData: {
      leadId: string;
      title: string;
      contactName?: string | null;
      phone?: string | null;
      email?: string | null;
      yaClientId?: string | null;
      comments?: string | null;
      budget?: number | null;
      currency?: string | null;
      utmTags?: Record<string, string> | null;
      tenantIdentifier?: string;
    },
  ): Promise<{ success: boolean; leadId?: number | string; skipped?: boolean; error?: string }> {
    try {
      const cfg = await this.getConfig(tenantId);
      if (!cfg.is_enabled || !cfg.webhook_url) {
        return { success: false, skipped: true };
      }

      const targetUrl = normalizeBitrixWebhookUrl(cfg.webhook_url);

      const phoneList = leadData.phone && leadData.phone.trim()
        ? [{ VALUE: leadData.phone.trim(), VALUE_TYPE: "WORK" as const }]
        : undefined;

      const emailList = leadData.email && leadData.email.trim()
        ? [{ VALUE: leadData.email.trim(), VALUE_TYPE: "WORK" as const }]
        : undefined;

      const payload: Bitrix24LeadAddRequest = {
        fields: {
          TITLE: `Заявка с сайта [${leadData.tenantIdentifier || "getvoxly"}] — ${leadData.contactName || "Клиент"}`,
          NAME: leadData.contactName || "Клиент",
          PHONE: phoneList,
          EMAIL: emailList,
          SOURCE_ID: BITRIX24_SOURCE_ID,
          UF_CRM_YA_CID: leadData.yaClientId ? String(leadData.yaClientId).trim() : "",
          COMMENTS: leadData.comments || "",
          STATUS_ID: "NEW",
          OPPORTUNITY: leadData.budget ?? undefined,
          CURRENCY_ID: leadData.currency ?? "RUB",
          UTM_SOURCE: leadData.utmTags?.utm_source,
          UTM_MEDIUM: leadData.utmTags?.utm_medium,
          UTM_CAMPAIGN: leadData.utmTags?.utm_campaign,
          UTM_CONTENT: leadData.utmTags?.utm_content,
          UTM_TERM: leadData.utmTags?.utm_term,
        },
        params: {
          REGISTER_SONET_EVENT: "Y",
        },
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const data = (await response.json()) as Bitrix24LeadAddResponse;

      if (!response.ok || data.error) {
        const errorText = data.error_description || data.error || `HTTP ${response.status}`;
        console.warn(`[Bitrix24] Failed to send lead ${leadData.leadId}: ${errorText}`);
        await this.updateSyncStatus(tenantId, null, errorText);
        return { success: false, error: errorText };
      }

      if (data.result) {
        console.log(`[Bitrix24] Lead ${leadData.leadId} successfully exported to Bitrix24 with ID: ${data.result}`);
        await this.updateSyncStatus(tenantId, String(data.result), null);
        return { success: true, leadId: data.result };
      }

      return { success: false, error: "Ответ без ID лида" };
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Таймаут соединения (20с)"
            : err.message
          : String(err);

      console.warn(`[Bitrix24] Exception dispatching lead ${leadData.leadId}: ${errorMsg}`);
      await this.updateSyncStatus(tenantId, null, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  private async updateSyncStatus(
    tenantId: string,
    lastLeadId: string | null,
    lastError: string | null,
  ): Promise<void> {
    try {
      if (lastLeadId) {
        await query(
          `UPDATE tenant_bitrix24_configs
           SET last_lead_id = $2,
               last_sync_at = NOW(),
               last_error = NULL,
               updated_at = NOW()
           WHERE tenant_id = $1`,
          [tenantId, lastLeadId],
        );
      } else if (lastError) {
        await query(
          `UPDATE tenant_bitrix24_configs
           SET last_error = $2,
               last_sync_at = NOW(),
               updated_at = NOW()
           WHERE tenant_id = $1`,
          [tenantId, lastError],
        );
      }
    } catch (err) {
      console.warn(`[Bitrix24] Failed to update sync status:`, err);
    }
  }
}

export const bitrix24Service = new Bitrix24Service();
