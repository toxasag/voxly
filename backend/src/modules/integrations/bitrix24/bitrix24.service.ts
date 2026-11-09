// ---------------------------------------------------------------------------
// Сервис интеграции с Битрикс24 (исходящие лиды / crm.lead.add).
//
// Выполняет нормализацию webhook URL, защиту от SSRF, формирование структуры полей,
// асинхронную отправку лидов с жесткими параметрами (SOURCE_ID, UF_CRM_YA_CID)
// и фиксацию статуса синхронизации в tenant_bitrix24_configs под RLS.
// ---------------------------------------------------------------------------

import { query, queryOne } from "../../../db/client.js";
import { AppError } from "../../../plugins/errorHandler.js";
import {
  type Bitrix24ConfigDTO,
  type Bitrix24ConfigRow,
  type Bitrix24LeadAddRequest,
  type Bitrix24LeadAddResponse,
  type Bitrix24TestResult,
  type LeadSource,
  type UpdateBitrix24ConfigPayload,
} from "./bitrix24.types.js";

export const BITRIX24_SOURCE_ID = "UC_VWN1ZK";
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Нормализация строкового идентификатора источника к каноническому LeadSource.
 */
export function normalizeLeadSource(raw?: string | null): LeadSource | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === "whatsapp" || s === "wa") return "whatsapp";
  if (s === "max" || s === "rumax") return "max";
  if (s === "telegram_bot" || s === "tg_bot" || s === "bot") return "telegram_bot";
  if (s === "telegram_personal" || s === "telegram_user" || s === "tg_personal") return "telegram_personal";
  if (s === "telegram" || s === "tg") return "telegram_personal";
  if (s === "site_widget" || s === "webchat" || s === "widget" || s === "site") return "site_widget";
  if (s === "manual" || s === "direct" || s === "manager" || s === "crm") return "manual";
  return null;
}

/**
 * Определение источника заявки по метаданным сделки и контакта.
 */
export function resolveLeadSource(data: {
  source?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
  sourceWidgetId?: string | null;
  contactChannel?: string | null;
  customFields?: Record<string, unknown> | null;
}): LeadSource {
  // 1. Явно переданный источник
  const explicit = normalizeLeadSource(data.source);
  if (explicit) return explicit;

  // 2. Метаданные источника
  const meta = data.sourceMetadata || {};
  const cf = data.customFields || {};

  const metaChannel = String(meta.channel || meta.channel_type || cf.channel || cf.source || "").toLowerCase();
  const isBot = Boolean(meta.is_bot || meta.isBot || meta.type === "bot" || meta.sender_type === "bot");

  if (metaChannel === "telegram_bot" || (metaChannel === "telegram" && isBot)) {
    return "telegram_bot";
  }
  if (metaChannel === "telegram" || metaChannel === "telegram_personal") {
    return "telegram_personal";
  }
  if (metaChannel === "whatsapp" || metaChannel === "wa") {
    return "whatsapp";
  }
  if (metaChannel === "max" || metaChannel === "rumax") {
    return "max";
  }
  if (metaChannel === "webchat" || metaChannel === "site_widget" || metaChannel === "widget") {
    return "site_widget";
  }

  // 3. Наличие виджета на сайте
  if (data.sourceWidgetId || meta.widget_id || meta.site_url || meta.page_url) {
    return "site_widget";
  }

  // 4. Канал контакта
  const ch = String(data.contactChannel || "").toLowerCase();
  if (ch === "whatsapp") return "whatsapp";
  if (ch === "rumax" || ch === "max") return "max";
  if (ch === "webchat") return "site_widget";
  if (ch === "telegram") {
    return isBot ? "telegram_bot" : "telegram_personal";
  }

  // 5. Дефолт: ручное создание
  return "manual";
}

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
      `SELECT tenant_id, webhook_url, is_enabled, allowed_sources, last_lead_id, last_sync_at, last_error, created_at, updated_at
       FROM tenant_bitrix24_configs
       WHERE tenant_id = $1`,
      [tenantId],
    );

    if (!row) {
      return {
        webhook_url: "",
        is_enabled: false,
        allowed_sources: [],
        last_lead_id: null,
        last_sync_at: null,
        last_error: null,
      };
    }

    const allowed = Array.isArray(row.allowed_sources)
      ? (row.allowed_sources as LeadSource[])
      : [];

    return {
      webhook_url: row.webhook_url,
      is_enabled: row.is_enabled,
      allowed_sources: allowed,
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
    const current = await this.getConfig(tenantId);

    const rawUrl = payload.webhook_url !== undefined ? payload.webhook_url.trim() : current.webhook_url;
    const isEnabled = payload.is_enabled !== undefined ? payload.is_enabled : current.is_enabled;

    let cleanAllowedSources: string[] = current.allowed_sources ?? [];
    if (payload.allowed_sources !== undefined) {
      const set = new Set<string>();
      for (const s of payload.allowed_sources) {
        const clean = String(s).trim().toLowerCase();
        if (clean) set.add(clean);
      }
      cleanAllowedSources = Array.from(set);
    }

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
         tenant_id, webhook_url, is_enabled, allowed_sources, updated_at
       )
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
       SET webhook_url = EXCLUDED.webhook_url,
           is_enabled = EXCLUDED.is_enabled,
           allowed_sources = EXCLUDED.allowed_sources,
           updated_at = NOW()
       RETURNING *`,
      [tenantId, rawUrl, isEnabled, cleanAllowedSources],
    );

    if (!row) {
      throw new AppError(500, "DB_ERROR", "Не удалось сохранить конфигурацию Битрикс24");
    }

    return {
      webhook_url: row.webhook_url,
      is_enabled: row.is_enabled,
      allowed_sources: (row.allowed_sources ?? []) as LeadSource[],
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
      source?: string | null;
      sourceMetadata?: Record<string, unknown> | null;
      sourceWidgetId?: string | null;
      contactChannel?: string | null;
      customFields?: Record<string, unknown> | null;
    },
  ): Promise<{ success: boolean; leadId?: number | string; skipped?: boolean; error?: string; reason?: string }> {
    try {
      const cfg = await this.getConfig(tenantId);
      if (!cfg.is_enabled || !cfg.webhook_url) {
        return { success: false, skipped: true, reason: "INTEGRATION_DISABLED" };
      }

      // Проверка фильтрации по источникам заявки (allowed_sources)
      const resolvedSource = resolveLeadSource({
        source: leadData.source,
        sourceMetadata: leadData.sourceMetadata,
        sourceWidgetId: leadData.sourceWidgetId,
        contactChannel: leadData.contactChannel,
        customFields: leadData.customFields,
      });

      if (cfg.allowed_sources && cfg.allowed_sources.length > 0) {
        if (!cfg.allowed_sources.includes(resolvedSource)) {
          console.log(
            `[Bitrix24] Skipping lead ${leadData.leadId} (tenant: ${tenantId}): source "${resolvedSource}" not in allowed_sources [${cfg.allowed_sources.join(", ")}]`,
          );
          try {
            await query(
              `INSERT INTO tenant_audit_log (tenant_id, action, entity_type, entity_id, details)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                tenantId,
                "integration.bitrix24.lead_skipped",
                "deal",
                leadData.leadId,
                JSON.stringify({
                  reason: "SOURCE_NOT_ALLOWED",
                  lead_source: resolvedSource,
                  allowed_sources: cfg.allowed_sources,
                }),
              ],
            );
          } catch (auditErr) {
            console.warn("[Bitrix24] Failed to record skip audit log:", auditErr);
          }
          return {
            success: false,
            skipped: true,
            reason: `SOURCE_NOT_ALLOWED: ${resolvedSource}`,
          };
        }
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
