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
  type Bitrix24SyncLogDTO,
  type Bitrix24SyncStatus,
  type Bitrix24TestResult,
  type LeadSource,
  type SimpleWidgetDTO,
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
  // Убираем уже указанный метод, если пользователь вставил полную ссылку с методом
  cleanPath = cleanPath.replace(/\/(crm\.lead\.(add|fields)(\.json)?|profile(\.json)?)$/i, "");

  // Проверка структуры REST пути Битрикс24: /rest/<userId>/<token>
  const restIdx = cleanPath.toLowerCase().indexOf("/rest/");
  if (restIdx === -1) {
    throw new AppError(
      400,
      "INVALID_REST_PATH",
      "URL вебхука должен содержать путь /rest/<ID_пользователя>/<код_вебхука>/ (скопируйте ссылку из Битрикс24: Разработчикам → Другое → Входящий вебхук)",
    );
  }

  const subPath = cleanPath.slice(restIdx + 6).split("/").filter(Boolean);
  if (subPath.length < 2) {
    throw new AppError(
      400,
      "INVALID_REST_PATH",
      "Неполный URL вебхука: в адресе пропущен ID пользователя или секретный код. Ожидается: https://домен/rest/<ID_пользователя>/<код_вебхука>/ (например: https://bankirromsk.ru/rest/261/x8ci14yw7f8xzi39/)",
    );
  }

  return `${parsed.origin}${cleanPath}/${method}`;
}

function safeUuidOrNull(val?: string | null): string | null {
  if (!val) return null;
  const trimmed = val.trim();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(trimmed) ? trimmed : null;
}

export class Bitrix24Service {
  /**
   * Получение списка всех доступных виджетов тенанта.
   */
  async getTenantWidgets(tenantId: string): Promise<SimpleWidgetDTO[]> {
    const rows = await query<{
      id: string;
      label: string;
      external_id: string;
      status: string;
      created_at: Date | string;
    }>(
      `SELECT id, label, external_id, status, created_at
       FROM channel_accounts
       WHERE tenant_id = $1 AND channel = 'webchat' AND deleted_at IS NULL
       ORDER BY label ASC, created_at DESC`,
      [tenantId],
    );

    return rows.map((r) => ({
      id: r.id,
      name: r.label || "Онлайн-чат",
      site_domain: r.external_id || "",
      status: r.status,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  /**
   * Получение текущей конфигурации Битрикс24 для арендатора.
   */
  async getConfig(tenantId: string): Promise<Bitrix24ConfigDTO> {
    const row = await queryOne<Bitrix24ConfigRow>(
      `SELECT tenant_id, webhook_url, is_enabled, allowed_sources, selected_widget_ids,
              custom_source_id, send_utm_marks, send_geo_data,
              last_lead_id, last_sync_at, last_error, created_at, updated_at
       FROM tenant_bitrix24_configs
       WHERE tenant_id = $1`,
      [tenantId],
    );

    if (!row) {
      return {
        webhook_url: "",
        is_enabled: false,
        allowed_sources: [],
        selected_widget_ids: [],
        custom_source_id: BITRIX24_SOURCE_ID,
        send_utm_marks: true,
        send_geo_data: true,
        last_lead_id: null,
        last_sync_at: null,
        last_error: null,
      };
    }

    const allowed = Array.isArray(row.allowed_sources)
      ? (row.allowed_sources as LeadSource[])
      : [];

    const selectedWidgets = Array.isArray(row.selected_widget_ids)
      ? row.selected_widget_ids
      : [];

    return {
      webhook_url: row.webhook_url,
      is_enabled: row.is_enabled,
      allowed_sources: allowed,
      selected_widget_ids: selectedWidgets,
      custom_source_id: (row.custom_source_id && row.custom_source_id.trim()) || BITRIX24_SOURCE_ID,
      send_utm_marks: row.send_utm_marks ?? true,
      send_geo_data: row.send_geo_data ?? true,
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

    let cleanSelectedWidgetIds: string[] = current.selected_widget_ids ?? [];
    if (payload.selected_widget_ids !== undefined) {
      const set = new Set<string>();
      for (const w of payload.selected_widget_ids) {
        const clean = String(w).trim();
        if (clean) set.add(clean);
      }
      cleanSelectedWidgetIds = Array.from(set);
    }

    const customSourceId = payload.custom_source_id !== undefined
      ? (payload.custom_source_id.trim() || BITRIX24_SOURCE_ID)
      : (current.custom_source_id || BITRIX24_SOURCE_ID);

    const sendUtmMarks = payload.send_utm_marks !== undefined
      ? Boolean(payload.send_utm_marks)
      : current.send_utm_marks;

    const sendGeoData = payload.send_geo_data !== undefined
      ? Boolean(payload.send_geo_data)
      : current.send_geo_data;

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
         tenant_id, webhook_url, is_enabled, allowed_sources, selected_widget_ids,
         custom_source_id, send_utm_marks, send_geo_data, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (tenant_id) DO UPDATE
       SET webhook_url = EXCLUDED.webhook_url,
           is_enabled = EXCLUDED.is_enabled,
           allowed_sources = EXCLUDED.allowed_sources,
           selected_widget_ids = EXCLUDED.selected_widget_ids,
           custom_source_id = EXCLUDED.custom_source_id,
           send_utm_marks = EXCLUDED.send_utm_marks,
           send_geo_data = EXCLUDED.send_geo_data,
           updated_at = NOW()
       RETURNING *`,
      [
        tenantId,
        rawUrl,
        isEnabled,
        cleanAllowedSources,
        cleanSelectedWidgetIds,
        customSourceId,
        sendUtmMarks,
        sendGeoData,
      ],
    );

    if (!row) {
      throw new AppError(500, "DB_ERROR", "Не удалось сохранить конфигурацию Битрикс24");
    }

    return {
      webhook_url: row.webhook_url,
      is_enabled: row.is_enabled,
      allowed_sources: (row.allowed_sources ?? []) as LeadSource[],
      selected_widget_ids: row.selected_widget_ids ?? [],
      custom_source_id: (row.custom_source_id && row.custom_source_id.trim()) || BITRIX24_SOURCE_ID,
      send_utm_marks: row.send_utm_marks ?? true,
      send_geo_data: row.send_geo_data ?? true,
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
   * Тестовая проверка соединения с Битрикс24 через вызов crm.lead.fields.json.
   * Безопасна: не создает фиктивных лидов и проверяет наличие прав на CRM-модуль.
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

    let targetUrl: string;
    try {
      targetUrl = normalizeBitrixWebhookUrl(webhookUrl, "crm.lead.fields.json");
    } catch (normErr: unknown) {
      const msg = normErr instanceof AppError ? normErr.message : "Некорректный URL входящего вебхука";
      return { success: false, message: msg, error: msg };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      const response = await fetch(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const rawText = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        const errorText = `Сервер Битрикс24 вернул не-JSON ответ (HTTP ${response.status}): ${rawText.slice(0, 150)}`;
        await this.updateSyncStatus(tenantId, null, errorText);
        return { success: false, message: errorText, error: errorText };
      }

      if (!response.ok || data.error) {
        const errCode = String(data.error || "");
        const errDesc = String(data.error_description || "");
        let errorText: string;

        if (errCode === "ACCESS_DENIED" || response.status === 403) {
          errorText = "Доступ запрещен: вебхук не имеет прав на модуль CRM в Битрикс24 (отметьте CRM в правах вебхука)";
        } else if (errCode === "NO_AUTH_FOUND" || response.status === 401) {
          errorText = "Ошибка авторизации: неверный ключ вебхука или пользователь удален в Битрикс24";
        } else if (errCode === "ERROR_METHOD_NOT_FOUND") {
          errorText = "Ошибка Битрикс24: метод не найден. Проверьте формат URL: в адресе обязательно должен быть указан ID пользователя и секретный ключ вебхука (например: /rest/1/код/)";
        } else if (errDesc) {
          errorText = `Ошибка Битрикс24 (${errCode || response.status}): ${errDesc}`;
        } else if (errCode) {
          errorText = `Ошибка Битрикс24: ${errCode}`;
        } else {
          errorText = `Ошибка HTTP ${response.status} от сервера Битрикс24`;
        }

        await this.updateSyncStatus(tenantId, null, errorText);
        return {
          success: false,
          message: errorText,
          error: errorText,
        };
      }

      if (data.result) {
        // Успешная проверка: сбрасываем предыдущую ошибку синхронизации
        await query(
          `UPDATE tenant_bitrix24_configs
           SET last_error = NULL, updated_at = NOW()
           WHERE tenant_id = $1`,
          [tenantId],
        );

        return {
          success: true,
          message: "Подключение к Битрикс24 успешно установлено! Доступ к CRM подтверждён.",
        };
      }

      const unexpectedMsg = "Неожиданный формат ответа от Битрикс24 (поле result отсутствует)";
      await this.updateSyncStatus(tenantId, null, unexpectedMsg);
      return {
        success: false,
        message: unexpectedMsg,
      };
    } catch (err: unknown) {
      let errorMsg: string;
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          errorMsg = "Таймаут соединения: сервер Битрикс24 не ответил за 20 секунд";
        } else {
          const cause = (err as { cause?: { code?: string; message?: string } }).cause;
          const causeCode = cause?.code || "";
          const causeMsg = cause?.message || "";

          if (causeCode === "ENOTFOUND") {
            errorMsg = "Не удалось разрешить домен Битрикс24 (проверьте адрес портала)";
          } else if (causeCode === "ECONNREFUSED") {
            errorMsg = "Сервер Битрикс24 отклонил соединение (порт закрыт)";
          } else if (
            causeCode === "UND_ERR_CONNECT_TIMEOUT" ||
            causeCode === "ETIMEDOUT" ||
            causeMsg.includes("Connect Timeout")
          ) {
            errorMsg = "Таймаут подключения (10 с): сервер Битрикс24 не ответил на попытку соединения. Проверьте доступность портала и адрес вебхука";
          } else if (
            causeCode === "CERT_HAS_EXPIRED" ||
            causeCode === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
            causeCode === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
          ) {
            errorMsg = `Ошибка SSL-сертификата сервера Битрикс24: ${causeMsg || causeCode}`;
          } else if (err.message === "fetch failed") {
            errorMsg = causeMsg
              ? `Ошибка сетевого подключения к Битрикс24: ${causeMsg}`
              : "Сбой сетевого соединения с Битрикс24 (проверьте доступность портала)";
          } else {
            errorMsg = err.message;
          }
        }
      } else {
        errorMsg = String(err);
      }

      await this.updateSyncStatus(tenantId, null, errorMsg);

      return {
        success: false,
        message:
          errorMsg.startsWith("Сбой") || errorMsg.startsWith("Ошибка") || errorMsg.startsWith("Некорректный") || errorMsg.startsWith("Таймаут")
            ? errorMsg
            : `Сбой проверки вебхука: ${errorMsg}`,
        error: errorMsg,
      };
    }
  }

  /**
   * Запись события исходящей синхронизации в bitrix24_sync_logs (наблюдаемость интеграции).
   * Отказоустойчива: ошибки записи в лог не ломают бизнес-логику отправки лида.
   */
  private async recordSyncLog(params: {
    tenantId: string;
    dealId?: string | null;
    status: Bitrix24SyncStatus;
    bitrixLeadId?: string | null;
    webhookUrl?: string | null;
    requestPayload?: Record<string, unknown> | null;
    responseStatus?: number | null;
    responseBody?: Record<string, unknown> | null;
    errorMessage?: string | null;
    leadSource?: string | null;
    widgetId?: string | null;
  }): Promise<string | null> {
    try {
      const res = await queryOne<{ id: string }>(
        `INSERT INTO bitrix24_sync_logs (
           tenant_id, deal_id, entity_type, direction, status,
           bitrix_lead_id, webhook_url, request_payload, response_status,
           response_body, error_message, lead_source, widget_id, created_at
         )
         VALUES ($1, $2, 'deal', 'outbound', $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
         RETURNING id`,
        [
          params.tenantId,
          safeUuidOrNull(params.dealId),
          params.status,
          params.bitrixLeadId ? String(params.bitrixLeadId) : null,
          params.webhookUrl || null,
          params.requestPayload ? JSON.stringify(params.requestPayload) : null,
          params.responseStatus || null,
          params.responseBody ? JSON.stringify(params.responseBody) : null,
          params.errorMessage || null,
          params.leadSource || null,
          safeUuidOrNull(params.widgetId),
        ],
      );
      return res?.id || null;
    } catch (err) {
      console.warn("[Bitrix24] Failed to record sync log:", err);
      return null;
    }
  }

  /**
   * Отправка реального лида в Битрикс24 при поступлении заявки.
   * Отказоустойчива: никогда не выбрасывает наружу необработанные исключения.
   * Фиксирует подробный аудит-лог в bitrix24_sync_logs на каждом этапе.
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
    let targetUrl: string | null = null;
    let payload: Bitrix24LeadAddRequest | null = null;
    let resolvedSource: LeadSource | "manual" = "manual";
    let effectiveWidgetId: string | null = null;

    try {
      const cfg = await this.getConfig(tenantId);
      if (!cfg.is_enabled || !cfg.webhook_url) {
        return { success: false, skipped: true, reason: "INTEGRATION_DISABLED" };
      }

      // 1. Проверка фильтрации по источникам заявки (allowed_sources)
      resolvedSource = resolveLeadSource({
        source: leadData.source,
        sourceMetadata: leadData.sourceMetadata,
        sourceWidgetId: leadData.sourceWidgetId,
        contactChannel: leadData.contactChannel,
        customFields: leadData.customFields,
      });

      effectiveWidgetId = leadData.sourceWidgetId ||
        (leadData.sourceMetadata?.widget_id as string | undefined) ||
        (leadData.customFields?.widget_id as string | undefined) ||
        null;

      if (cfg.allowed_sources && cfg.allowed_sources.length > 0) {
        if (!cfg.allowed_sources.includes(resolvedSource)) {
          const skipReason = `SOURCE_NOT_ALLOWED: ${resolvedSource}`;
          console.log(
            `[Bitrix24] Skipping lead ${leadData.leadId} (tenant: ${tenantId}): source "${resolvedSource}" not in allowed_sources [${cfg.allowed_sources.join(", ")}]`,
          );
          await this.recordSyncLog({
            tenantId,
            dealId: leadData.leadId,
            status: "skipped",
            webhookUrl: cfg.webhook_url,
            errorMessage: skipReason,
            leadSource: resolvedSource,
            widgetId: effectiveWidgetId,
          });
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
            reason: skipReason,
          };
        }
      }

      // 2. Проверка фильтрации по конкретным виджетам тенанта (selected_widget_ids)
      if (resolvedSource === "site_widget" && cfg.selected_widget_ids && cfg.selected_widget_ids.length > 0) {
        if (!effectiveWidgetId || !cfg.selected_widget_ids.includes(effectiveWidgetId)) {
          const skipReason = `WIDGET_NOT_ALLOWED: ${effectiveWidgetId || "none"}`;
          console.log(
            `[Bitrix24] Skipping lead ${leadData.leadId} (tenant: ${tenantId}): widget "${effectiveWidgetId}" not in selected_widget_ids [${cfg.selected_widget_ids.join(", ")}]`,
          );
          await this.recordSyncLog({
            tenantId,
            dealId: leadData.leadId,
            status: "skipped",
            webhookUrl: cfg.webhook_url,
            errorMessage: skipReason,
            leadSource: resolvedSource,
            widgetId: effectiveWidgetId,
          });
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
                  reason: "WIDGET_NOT_ALLOWED",
                  widget_id: effectiveWidgetId,
                  selected_widget_ids: cfg.selected_widget_ids,
                }),
              ],
            );
          } catch (auditErr) {
            console.warn("[Bitrix24] Failed to record skip audit log:", auditErr);
          }
          return {
            success: false,
            skipped: true,
            reason: skipReason,
          };
        }
      }

      // 3. Получение названия и домена виджета из базы
      let widgetLabel: string | null = null;
      let widgetDomain: string | null = null;
      if (effectiveWidgetId) {
        try {
          const wRow = await queryOne<{ label: string; external_id: string }>(
            `SELECT label, external_id FROM channel_accounts
             WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
            [effectiveWidgetId, tenantId],
          );
          if (wRow) {
            widgetLabel = wRow.label;
            widgetDomain = wRow.external_id;
          }
        } catch {
          // non-blocking
        }
      }

      // 4. Определение SOURCE_ID (кастомный из настроек тенанта или fallback UC_VWN1ZK)
      const effectiveSourceId = (cfg.custom_source_id && cfg.custom_source_id.trim())
        ? cfg.custom_source_id.trim()
        : BITRIX24_SOURCE_ID;

      // 5. Метаданные страницы и источника
      const meta = leadData.sourceMetadata || {};
      const cf = leadData.customFields || {};

      const pageObj = (meta.page as { url?: string; title?: string; domain?: string } | undefined) || {};
      const pageUrl = pageObj.url || (cf.page_url as string | undefined) || "";
      const referrer = (meta.referrer as string | undefined) || "";

      const sourceDescParts: string[] = [];
      if (widgetLabel) sourceDescParts.push(`Виджет: ${widgetLabel}`);
      if (widgetDomain) sourceDescParts.push(`Сайт: ${widgetDomain}`);
      if (pageUrl) sourceDescParts.push(`URL: ${pageUrl}`);
      if (referrer) sourceDescParts.push(`Referrer: ${referrer}`);
      const sourceDescription = sourceDescParts.length > 0 ? sourceDescParts.join(" | ") : undefined;

      // 6. UTM-метки
      const utmObj = (meta.utm as Record<string, string> | undefined) ||
                     leadData.utmTags ||
                     (cf.utm as Record<string, string> | undefined) ||
                     (cf.utm_tags as Record<string, string> | undefined) ||
                     {};

      const utmSource = cfg.send_utm_marks ? (utmObj.utm_source || utmObj.source) : undefined;
      const utmMedium = cfg.send_utm_marks ? (utmObj.utm_medium || utmObj.medium) : undefined;
      const utmCampaign = cfg.send_utm_marks ? (utmObj.utm_campaign || utmObj.campaign) : undefined;
      const utmContent = cfg.send_utm_marks ? (utmObj.utm_content || utmObj.content) : undefined;
      const utmTerm = cfg.send_utm_marks ? (utmObj.utm_term || utmObj.term) : undefined;

      // 7. Гео-данные и технические метки
      const geoObj = (meta.geo as Record<string, unknown> | undefined) ||
                     (cf.geo as Record<string, unknown> | undefined) ||
                     {};
      const networkObj = (meta.network as Record<string, unknown> | undefined) || {};
      const deviceObj = (meta.device as Record<string, unknown> | undefined) ||
                        (cf.device_info as Record<string, unknown> | undefined) ||
                        {};

      const ip = String(geoObj.ip || networkObj.ip || deviceObj.ip || cf.client_ip || "").trim();
      const city = String(geoObj.city || networkObj.city || "").trim();
      const country = String(geoObj.country || networkObj.country || "").trim();
      const region = String(geoObj.region || networkObj.region || "").trim();
      const isp = String(geoObj.isp || networkObj.isp || "").trim();
      const browser = String(deviceObj.browser || "").trim();
      const os = String(deviceObj.os || "").trim();
      const deviceType = String(deviceObj.deviceType || "").trim();
      const visitCount = meta.visitCount || cf.visit_count;

      // 8. Формирование комментариев со структурированным блоком
      let enrichedComments = leadData.comments ? leadData.comments.trim() : "";

      if (cfg.send_geo_data) {
        const visitDetails: string[] = [];
        if (widgetLabel) visitDetails.push(`Виджет: ${widgetLabel}${widgetDomain ? ` (${widgetDomain})` : ""}`);
        if (pageUrl) visitDetails.push(`Страница заявки: ${pageUrl}`);
        if (referrer) visitDetails.push(`Источник перехода (Referrer): ${referrer}`);

        const locParts: string[] = [];
        if (city) locParts.push(city);
        if (region) locParts.push(region);
        if (country) locParts.push(country);
        if (locParts.length > 0) {
          visitDetails.push(`Геолокация: ${locParts.join(", ")}${isp ? ` (Провайдер: ${isp})` : ""}`);
        }

        if (ip) visitDetails.push(`IP-адрес: ${ip}`);

        const devParts: string[] = [];
        if (deviceType) devParts.push(deviceType);
        if (browser && browser !== "Неизвестно") devParts.push(browser);
        if (os && os !== "Неизвестно") devParts.push(os);
        if (devParts.length > 0) {
          visitDetails.push(`Устройство: ${devParts.join(" / ")}`);
        }

        if (visitCount) visitDetails.push(`Визитов на сайте: ${visitCount}`);
        if (leadData.yaClientId) visitDetails.push(`Яндекс Client ID (CID): ${leadData.yaClientId}`);

        const utmSummaryParts: string[] = [];
        if (utmSource) utmSummaryParts.push(`source=${utmSource}`);
        if (utmMedium) utmSummaryParts.push(`medium=${utmMedium}`);
        if (utmCampaign) utmSummaryParts.push(`campaign=${utmCampaign}`);
        if (utmContent) utmSummaryParts.push(`content=${utmContent}`);
        if (utmTerm) utmSummaryParts.push(`term=${utmTerm}`);
        if (utmSummaryParts.length > 0) {
          visitDetails.push(`UTM-метки: ${utmSummaryParts.join(", ")}`);
        }

        if (visitDetails.length > 0) {
          enrichedComments = (enrichedComments ? `${enrichedComments}\n\n` : "") +
            "--- Данные визита и источник (GetVoxly) ---\n" +
            visitDetails.join("\n");
        }
      }

      // 9. Название лида с указанием виджета
      const widgetPart = widgetLabel ? ` [Виджет: ${widgetLabel}]` : "";
      const leadTitle = `Заявка с сайта [${leadData.tenantIdentifier || "getvoxly"}]${widgetPart} — ${leadData.contactName || "Клиент"}`;

      const phoneList = leadData.phone && leadData.phone.trim()
        ? [{ VALUE: leadData.phone.trim(), VALUE_TYPE: "WORK" as const }]
        : undefined;

      const emailList = leadData.email && leadData.email.trim()
        ? [{ VALUE: leadData.email.trim(), VALUE_TYPE: "WORK" as const }]
        : undefined;

      payload = {
        fields: {
          TITLE: leadTitle,
          NAME: leadData.contactName || "Клиент",
          PHONE: phoneList,
          EMAIL: emailList,
          SOURCE_ID: effectiveSourceId,
          SOURCE_DESCRIPTION: sourceDescription,
          UF_CRM_YA_CID: leadData.yaClientId ? String(leadData.yaClientId).trim() : undefined,
          COMMENTS: enrichedComments || undefined,
          STATUS_ID: "NEW",
          OPPORTUNITY: leadData.budget ?? undefined,
          CURRENCY_ID: leadData.currency ?? "RUB",
          UTM_SOURCE: utmSource,
          UTM_MEDIUM: utmMedium,
          UTM_CAMPAIGN: utmCampaign,
          UTM_CONTENT: utmContent,
          UTM_TERM: utmTerm,
        },
        params: {
          REGISTER_SONET_EVENT: "Y",
        },
      };

      targetUrl = normalizeBitrixWebhookUrl(cfg.webhook_url, "crm.lead.add.json");

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
        await this.recordSyncLog({
          tenantId,
          dealId: leadData.leadId,
          status: "error",
          webhookUrl: targetUrl,
          requestPayload: payload as unknown as Record<string, unknown>,
          responseStatus: response.status,
          responseBody: data as unknown as Record<string, unknown>,
          errorMessage: errorText,
          leadSource: resolvedSource,
          widgetId: effectiveWidgetId,
        });
        return { success: false, error: errorText };
      }

      if (data.result) {
        console.log(`[Bitrix24] Lead ${leadData.leadId} successfully exported to Bitrix24 with ID: ${data.result}`);
        await this.updateSyncStatus(tenantId, String(data.result), null);
        await this.recordSyncLog({
          tenantId,
          dealId: leadData.leadId,
          status: "success",
          bitrixLeadId: String(data.result),
          webhookUrl: targetUrl,
          requestPayload: payload as unknown as Record<string, unknown>,
          responseStatus: response.status,
          responseBody: data as unknown as Record<string, unknown>,
          leadSource: resolvedSource,
          widgetId: effectiveWidgetId,
        });
        return { success: true, leadId: data.result };
      }

      await this.recordSyncLog({
        tenantId,
        dealId: leadData.leadId,
        status: "error",
        webhookUrl: targetUrl,
        requestPayload: payload as unknown as Record<string, unknown>,
        responseStatus: response.status,
        responseBody: data as unknown as Record<string, unknown>,
        errorMessage: "Ответ без ID лида",
        leadSource: resolvedSource,
        widgetId: effectiveWidgetId,
      });
      return { success: false, error: "Ответ без ID лида" };
    } catch (err: unknown) {
      let errorMsg: string;
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          errorMsg = "Таймаут соединения (20 с)";
        } else {
          const cause = (err as { cause?: { code?: string; message?: string } }).cause;
          const causeMsg = cause?.message || "";
          if (err.message === "fetch failed") {
            errorMsg = causeMsg
              ? `Ошибка сетевого подключения к Битрикс24: ${causeMsg}`
              : "Сбой сетевого соединения с Битрикс24 (проверьте доступность портала)";
          } else {
            errorMsg = err.message;
          }
        }
      } else {
        errorMsg = String(err);
      }

      console.warn(`[Bitrix24] Exception dispatching lead ${leadData.leadId}: ${errorMsg}`);
      await this.updateSyncStatus(tenantId, null, errorMsg);
      await this.recordSyncLog({
        tenantId,
        dealId: leadData.leadId,
        status: "error",
        webhookUrl: targetUrl,
        requestPayload: payload as unknown as Record<string, unknown>,
        errorMessage: errorMsg,
        leadSource: resolvedSource,
        widgetId: effectiveWidgetId,
      });
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Получение журнала синхронизации сделок с Битрикс24 для тенанта.
   */
  async getSyncLogs(
    tenantId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ logs: Bitrix24SyncLogDTO[]; total: number }> {
    const safeLimit = Math.min(Math.max(1, limit), 100);
    const safeOffset = Math.max(0, offset);

    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM bitrix24_sync_logs WHERE tenant_id = $1`,
      [tenantId],
    );
    const total = parseInt(countRow?.count || "0", 10);

    const rows = await query<{
      id: string;
      deal_id: string | null;
      deal_title: string | null;
      contact_name: string | null;
      contact_phone: string | null;
      status: string;
      bitrix_lead_id: string | null;
      response_status: number | null;
      error_message: string | null;
      lead_source: string | null;
      widget_name: string | null;
      request_payload: Record<string, unknown> | null;
      response_body: Record<string, unknown> | null;
      created_at: Date | string;
    }>(
      `SELECT
         l.id,
         l.deal_id,
         d.title AS deal_title,
         c.first_name AS contact_name,
         c.phone AS contact_phone,
         l.status,
         l.bitrix_lead_id,
         l.response_status,
         l.error_message,
         l.lead_source,
         ca.label AS widget_name,
         l.request_payload,
         l.response_body,
         l.created_at
       FROM bitrix24_sync_logs l
       LEFT JOIN deals d ON d.id = l.deal_id
       LEFT JOIN contacts c ON c.id = d.contact_id
       LEFT JOIN channel_accounts ca ON ca.id = l.widget_id
       WHERE l.tenant_id = $1
       ORDER BY l.created_at DESC
       LIMIT $2 OFFSET $3`,
      [tenantId, safeLimit, safeOffset],
    );

    const logs: Bitrix24SyncLogDTO[] = rows.map((r) => ({
      id: r.id,
      deal_id: r.deal_id,
      deal_title: r.deal_title,
      contact_name: r.contact_name,
      contact_phone: r.contact_phone,
      status: (r.status || "pending") as Bitrix24SyncStatus,
      bitrix_lead_id: r.bitrix_lead_id,
      response_status: r.response_status,
      error_message: r.error_message,
      lead_source: r.lead_source,
      widget_name: r.widget_name,
      request_payload: r.request_payload,
      response_body: r.response_body,
      created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));

    return { logs, total };
  }

  /**
   * Повторная отправка сделки в Битрикс24 по ID лога или сделки.
   */
  async retryLeadSync(
    tenantId: string,
    logOrDealId: string,
  ): Promise<{ success: boolean; leadId?: number | string; error?: string }> {
    let targetDealId = logOrDealId;
    const logRow = await queryOne<{ deal_id: string }>(
      `SELECT deal_id FROM bitrix24_sync_logs WHERE id = $1 AND tenant_id = $2`,
      [logOrDealId, tenantId],
    );
    if (logRow?.deal_id) {
      targetDealId = logRow.deal_id;
    }

    const deal = await queryOne<{
      id: string;
      tenant_id: string;
      title: string;
      description: string | null;
      budget: number | string | null;
      currency: string | null;
      custom_fields: Record<string, unknown> | null;
      source_metadata: Record<string, unknown> | null;
      source_widget_id: string | null;
      contact_id: string | null;
      contact_first_name: string | null;
      contact_last_name: string | null;
      contact_phone: string | null;
      contact_email: string | null;
      contact_channel: string | null;
      tenant_name: string;
      tenant_slug: string;
    }>(
      `SELECT d.id, d.tenant_id, d.title, d.description, d.budget, d.currency,
              d.custom_fields, d.source_metadata, d.source_widget_id,
              c.id AS contact_id, c.first_name AS contact_first_name, c.last_name AS contact_last_name,
              c.phone AS contact_phone, c.email AS contact_email, c.channel AS contact_channel,
              t.name AS tenant_name, t.slug AS tenant_slug
       FROM deals d
       JOIN tenants t ON t.id = d.tenant_id
       LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [tenantId, targetDealId],
    );

    if (!deal) {
      throw new AppError(404, "DEAL_NOT_FOUND", "Сделка не найдена для повторной отправки в Битрикс24");
    }

    const contactNameParts = [deal.contact_first_name, deal.contact_last_name].filter(Boolean);
    const contactName = contactNameParts.length > 0 ? contactNameParts.join(" ") : null;
    const customFields = deal.custom_fields || {};
    const phone = deal.contact_phone || (customFields.phone as string | undefined) || null;
    const email = deal.contact_email || (customFields.email as string | undefined) || null;
    const yaClientId =
      (customFields.ym_uid as string) ||
      (customFields.ym_client_id as string) ||
      (customFields.ya_client_id as string) ||
      (customFields.yandex_client_id as string) ||
      (customFields.ya_cid as string) ||
      null;

    return this.sendLead(tenantId, {
      leadId: deal.id,
      title: deal.title,
      contactName,
      phone,
      email,
      yaClientId,
      comments: deal.description || null,
      budget: deal.budget ? Number(deal.budget) : null,
      currency: deal.currency || "RUB",
      utmTags: (customFields.utm_tags as Record<string, string>) || null,
      tenantIdentifier: deal.tenant_slug || deal.tenant_name || "getvoxly",
      sourceMetadata: deal.source_metadata,
      sourceWidgetId: deal.source_widget_id,
      contactChannel: deal.contact_channel,
      customFields,
    });
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
