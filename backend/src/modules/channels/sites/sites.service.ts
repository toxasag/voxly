import crypto from "node:crypto";
import { query, queryOne, withTenant, runWithPlatformScope, type SqlParam } from "../../../db/client.js";
import { NotFoundError, ValidationError, AppError } from "../../../plugins/errorHandler.js";
import { normalizePhoneToE164, ContactDedupeService } from "../../crm/contacts/dedupe.service.js";
import { ContactActivityService } from "../../crm/contacts/contact-activity.service.js";
import { leadNotificationQueue } from "../../crm/leads/lead-notification.queue.js";
import { notificationQueue } from "../../notifications/notification.queue.js";
import { conversionDispatcher } from "../../analytics/conversion-dispatcher.service.js";
import type { ContactRow } from "../../crm/contacts/contacts.types.js";
import type { DealRow } from "../../crm/deals/deals.types.js";
import type {
  CreateSitePayload,
  SiteIntegrationDTO,
  SiteIntegrationRow,
  UpdateSitePayload,
} from "./sites.types.js";

const DEFAULT_API_BASE = process.env.API_BASE_URL || "https://api.getvoxly.ru";

export class SitesService {
  private dedupeService = new ContactDedupeService();
  private contactActivityService = new ContactActivityService();

  private toDTO(row: SiteIntegrationRow, apiBase: string = DEFAULT_API_BASE): SiteIntegrationDTO {
    const base = apiBase.replace(/\/+$/, "");
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      name: row.name,
      site_url: row.site_url,
      webhook_token: row.webhook_token,
      webhook_url: `${base}/api/v1/webhooks/sites/${row.webhook_token}`,
      target_pipeline_id: row.target_pipeline_id,
      target_stage_id: row.target_stage_id,
      target_pipeline_name: row.target_pipeline_name ?? null,
      target_stage_name: row.target_stage_name ?? null,
      field_mapping: row.field_mapping ?? {},
      is_active: Boolean(row.is_active),
      leads_count: Number(row.leads_count ?? 0),
      last_lead_at: row.last_lead_at ? new Date(row.last_lead_at).toISOString() : null,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    };
  }

  async listSites(tenantId: string, apiBase?: string): Promise<SiteIntegrationDTO[]> {
    const rows = await query<SiteIntegrationRow>(
      `SELECT s.*,
              p.name AS target_pipeline_name,
              st.name AS target_stage_name
       FROM site_integrations s
       LEFT JOIN pipelines p ON p.id = s.target_pipeline_id AND p.tenant_id = s.tenant_id
       LEFT JOIN stages st ON st.id = s.target_stage_id AND st.pipeline_id = p.id
       WHERE s.tenant_id = $1
       ORDER BY s.created_at DESC`,
      [tenantId],
    );

    return rows.map((r) => this.toDTO(r, apiBase));
  }

  async getSite(tenantId: string, id: string, apiBase?: string): Promise<SiteIntegrationDTO> {
    const row = await queryOne<SiteIntegrationRow>(
      `SELECT s.*,
              p.name AS target_pipeline_name,
              st.name AS target_stage_name
       FROM site_integrations s
       LEFT JOIN pipelines p ON p.id = s.target_pipeline_id AND p.tenant_id = s.tenant_id
       LEFT JOIN stages st ON st.id = s.target_stage_id AND st.pipeline_id = p.id
       WHERE s.tenant_id = $1 AND s.id = $2`,
      [tenantId, id],
    );

    if (!row) {
      throw new NotFoundError("Интеграция сайта не найдена");
    }

    return this.toDTO(row, apiBase);
  }

  async createSite(
    tenantId: string,
    payload: CreateSitePayload,
    apiBase?: string,
  ): Promise<SiteIntegrationDTO> {
    const token = crypto.randomBytes(24).toString("hex");

    let targetPipelineId = payload.target_pipeline_id || null;
    let targetStageId = payload.target_stage_id || null;

    if (targetPipelineId) {
      const p = await queryOne<{ id: string }>(
        `SELECT id FROM pipelines WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetPipelineId],
      );
      if (!p) {
        throw new ValidationError("Указанная воронка не найдена");
      }
    }

    if (targetPipelineId && targetStageId) {
      const s = await queryOne<{ id: string }>(
        `SELECT id FROM stages WHERE pipeline_id = $1 AND id = $2`,
        [targetPipelineId, targetStageId],
      );
      if (!s) {
        throw new ValidationError("Указанный этап не принадлежит воронке");
      }
    }

    const row = await queryOne<SiteIntegrationRow>(
      `INSERT INTO site_integrations
         (tenant_id, name, site_url, webhook_token, target_pipeline_id, target_stage_id, field_mapping, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       RETURNING *`,
      [
        tenantId,
        payload.name.trim(),
        payload.site_url?.trim() || null,
        token,
        targetPipelineId,
        targetStageId,
        JSON.stringify(payload.field_mapping || {}),
        payload.is_active ?? true,
      ],
    );

    if (!row) {
      throw new AppError(500, "SITE_CREATE_FAILED", "Не удалось создать интеграцию сайта");
    }

    return this.toDTO(row, apiBase);
  }

  async updateSite(
    tenantId: string,
    id: string,
    payload: UpdateSitePayload,
    apiBase?: string,
  ): Promise<SiteIntegrationDTO> {
    const existing = await queryOne<SiteIntegrationRow>(
      `SELECT * FROM site_integrations WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );

    if (!existing) {
      throw new NotFoundError("Интеграция сайта не найдена");
    }

    let targetPipelineId =
      payload.target_pipeline_id !== undefined
        ? payload.target_pipeline_id || null
        : existing.target_pipeline_id;
    let targetStageId =
      payload.target_stage_id !== undefined
        ? payload.target_stage_id || null
        : existing.target_stage_id;

    if (targetPipelineId) {
      const p = await queryOne<{ id: string }>(
        `SELECT id FROM pipelines WHERE tenant_id = $1 AND id = $2`,
        [tenantId, targetPipelineId],
      );
      if (!p) {
        throw new ValidationError("Указанная воронка не найдена");
      }
    }

    if (targetPipelineId && targetStageId) {
      const s = await queryOne<{ id: string }>(
        `SELECT id FROM stages WHERE pipeline_id = $1 AND id = $2`,
        [targetPipelineId, targetStageId],
      );
      if (!s) {
        throw new ValidationError("Указанный этап не принадлежит воронке");
      }
    }

    const updated = await queryOne<SiteIntegrationRow>(
      `UPDATE site_integrations
       SET name = COALESCE($3, name),
           site_url = CASE WHEN $4::text IS NOT NULL THEN NULLIF($4, '') ELSE site_url END,
           target_pipeline_id = $5,
           target_stage_id = $6,
           field_mapping = CASE WHEN $7::text IS NOT NULL THEN $7::jsonb ELSE field_mapping END,
           is_active = COALESCE($8, is_active),
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [
        tenantId,
        id,
        payload.name?.trim() ?? null,
        payload.site_url !== undefined ? payload.site_url.trim() : null,
        targetPipelineId,
        targetStageId,
        payload.field_mapping ? JSON.stringify(payload.field_mapping) : null,
        payload.is_active ?? null,
      ],
    );

    if (!updated) {
      throw new NotFoundError("Интеграция сайта не найдена");
    }

    return this.toDTO(updated, apiBase);
  }

  async deleteSite(tenantId: string, id: string): Promise<void> {
    const deleted = await queryOne<{ id: string }>(
      `DELETE FROM site_integrations WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [tenantId, id],
    );

    if (!deleted) {
      throw new NotFoundError("Интеграция сайта не найдена");
    }
  }

  async regenerateToken(tenantId: string, id: string, apiBase?: string): Promise<SiteIntegrationDTO> {
    const newToken = crypto.randomBytes(24).toString("hex");

    const updated = await queryOne<SiteIntegrationRow>(
      `UPDATE site_integrations
       SET webhook_token = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, id, newToken],
    );

    if (!updated) {
      throw new NotFoundError("Интеграция сайта не найдена");
    }

    return this.toDTO(updated, apiBase);
  }

  /**
   * Обработка входящего вебхука с внешнего сайта (Tilda, WordPress, Webflow, HTML-формы).
   * Поддерживает:
   * 1. Tilda handshake (test=test) без создания лишних сделок
   * 2. Извлечение стандартных и кастомных полей
   * 3. Дедупликацию контакта по номеру телефона (E.164) и Email
   * 4. Создание сделки на этапе «Новый лид» с источником «Сайт: <Название сайта>»
   * 5. Фиксацию события в сквозном таймлайне активности клиента
   * 6. Оповещения (Telegram/Push) и отправку конверсий
   */
  async processWebhook(
    token: string,
    rawPayload: Record<string, unknown>,
  ): Promise<{ status: "ok"; message?: string; deal_id?: string; contact_id?: string; is_test?: boolean }> {
    // 1. Проверка тестового пинга (Tilda Handshake / Webhook Verification)
    const isTildaTest =
      rawPayload.test === "test" ||
      rawPayload.test === "1" ||
      rawPayload.test === 1 ||
      rawPayload.test === true ||
      (typeof rawPayload.test === "string" &&
        rawPayload.test.trim().length > 0 &&
        Object.keys(rawPayload).length <= 2);

    if (isTildaTest) {
      return { status: "ok", message: "Handshake successful", is_test: true };
    }

    // 2. Поиск сайта по токену в контексте платформы (так как вебхук публичный и тенант ещё не известен)
    const site = await runWithPlatformScope(() =>
      queryOne<SiteIntegrationRow>(
        `SELECT * FROM site_integrations WHERE webhook_token = $1 AND is_active = true`,
        [token],
      ),
    );

    if (!site) {
      throw new NotFoundError("Интеграция сайта не найдена или отключена");
    }

    // 3. Выполнение логики в RLS-контексте владельца сайта
    return withTenant(site.tenant_id, async (tx) => {
      // Поддержка кастомного маппинга полей
      const mapping = site.field_mapping || {};
      const mapField = (canonical: string): unknown => {
        const mappedKey = mapping[canonical];
        return mappedKey && rawPayload[mappedKey] !== undefined ? rawPayload[mappedKey] : undefined;
      };

      // Извлечение имени
      const rawName = (mapField("name") ||
        rawPayload.Name ||
        rawPayload.name ||
        rawPayload.FIO ||
        rawPayload.fio ||
        rawPayload.first_name ||
        rawPayload["ФИО"] ||
        rawPayload["Имя"] ||
        rawPayload["имя"] ||
        rawPayload.client_name ||
        "") as string;

      // Извлечение телефона
      const rawPhone = (mapField("phone") ||
        rawPayload.Phone ||
        rawPayload.phone ||
        rawPayload.tel ||
        rawPayload.telephone ||
        rawPayload["Телефон"] ||
        rawPayload["телефон"] ||
        rawPayload["Номер"] ||
        rawPayload.client_phone ||
        "") as string;

      // Извлечение email
      const rawEmail = (mapField("email") ||
        rawPayload.Email ||
        rawPayload.email ||
        rawPayload["E-mail"] ||
        rawPayload["e-mail"] ||
        rawPayload.mail ||
        rawPayload["Почта"] ||
        rawPayload["почта"] ||
        "") as string;

      // Извлечение комментария / сообщения
      const rawComment = (mapField("comment") ||
        rawPayload.COMMENT ||
        rawPayload.comment ||
        rawPayload.comments ||
        rawPayload.message ||
        rawPayload.msg ||
        rawPayload["Комментарий"] ||
        rawPayload["комментарий"] ||
        rawPayload["Сообщение"] ||
        "") as string;

      // Извлечение названия формы
      const rawFormName = (rawPayload.formname ||
        rawPayload.form_name ||
        rawPayload.formid ||
        rawPayload.form_id ||
        rawPayload["Форма"] ||
        rawPayload["форма"] ||
        "") as string;

      // Извлечение UTM-меток
      const utmSource = (rawPayload.utm_source || rawPayload.utmSource || "") as string;
      const utmMedium = (rawPayload.utm_medium || rawPayload.utmMedium || "") as string;
      const utmCampaign = (rawPayload.utm_campaign || rawPayload.utmCampaign || "") as string;
      const utmContent = (rawPayload.utm_content || rawPayload.utmContent || "") as string;
      const utmTerm = (rawPayload.utm_term || rawPayload.utmTerm || "") as string;

      // Извлечение идентификаторов счетчиков аналитики
      const ymClientId = (rawPayload.ym_client_id ||
        rawPayload.ymClientId ||
        rawPayload._ym_uid ||
        rawPayload.yandex_client_id ||
        "") as string;
      const gaClientId = (rawPayload.ga_client_id ||
        rawPayload.gaClientId ||
        rawPayload._ga ||
        rawPayload.google_client_id ||
        "") as string;

      // Извлечение URL страницы и реферера
      const pageUrl = (rawPayload.page_url ||
        rawPayload.pageUrl ||
        rawPayload.url ||
        rawPayload.referer ||
        rawPayload.referrer ||
        site.site_url ||
        "") as string;

      // Сумма платежа / заказа, если форма платёжная
      const rawAmount = rawPayload.amount || rawPayload.sum || rawPayload.payment_amount;
      const budget =
        typeof rawAmount === "number"
          ? rawAmount
          : rawAmount && !isNaN(Number(rawAmount))
            ? Number(rawAmount)
            : 0;

      // Нормализация контактных данных
      const canonicalPhone = normalizePhoneToE164(String(rawPhone || "").trim());
      const trimmedEmail = String(rawEmail || "").trim().toLowerCase();
      const canonicalEmail = trimmedEmail.includes("@") ? trimmedEmail : null;

      // 4. Дедупликация контакта
      let contactId: string | null = null;
      let existingContact: ContactRow | null = null;

      if (canonicalPhone) {
        const duplicates = await this.dedupeService.findDuplicatesByPhone(site.tenant_id, canonicalPhone);
        if (duplicates.length > 0 && duplicates[0]) {
          existingContact = duplicates[0];
          contactId = existingContact.id;
        }
      }

      if (!contactId && canonicalEmail) {
        const byEmail = await tx.queryOne<ContactRow>(
          `SELECT * FROM contacts WHERE tenant_id = $1 AND email ILIKE $2 AND deleted_at IS NULL LIMIT 1`,
          [site.tenant_id, canonicalEmail],
        );
        if (byEmail) {
          existingContact = byEmail;
          contactId = byEmail.id;
        }
      }

      if (existingContact) {
        // Обогащаем недостающие поля контакта при необходимости
        const updates: string[] = [];
        const params: SqlParam[] = [site.tenant_id, existingContact.id];

        if ((!existingContact.email || existingContact.email.trim().length === 0) && canonicalEmail) {
          params.push(canonicalEmail);
          updates.push(`email = $${params.length}`);
        }
        if ((!existingContact.phone || existingContact.phone.trim().length === 0) && canonicalPhone) {
          params.push(canonicalPhone);
          updates.push(`phone = $${params.length}`);
        }

        if (updates.length > 0) {
          await tx.query(
            `UPDATE contacts SET ${updates.join(", ")}, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
            params,
          );
        }
      } else {
        // Создание нового контакта
        let firstName = "";
        let lastName = "";
        if (rawName && typeof rawName === "string") {
          const parts = rawName.trim().split(/\s+/);
          firstName = parts[0] || "";
          lastName = parts.slice(1).join(" ");
        }

        if (!firstName) {
          firstName = canonicalPhone
            ? `Клиент ${canonicalPhone}`
            : canonicalEmail
              ? canonicalEmail.split("@")[0] || "Клиент"
              : `Лид с сайта ${site.name}`;
        }

        const sourceMetadata = {
          channel: "site",
          site_id: site.id,
          site_name: site.name,
          site_url: site.site_url,
          form_name: rawFormName || null,
          utm_source: utmSource || null,
          utm_medium: utmMedium || null,
          utm_campaign: utmCampaign || null,
          utm_content: utmContent || null,
          utm_term: utmTerm || null,
          ym_client_id: ymClientId || null,
          ga_client_id: gaClientId || null,
          page_url: pageUrl || null,
        };

        const newContact = await tx.queryOneOrThrow<{ id: string }>(
          `INSERT INTO contacts
             (tenant_id, first_name, last_name, phone, email, channel, source_metadata, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           RETURNING id`,
          [
            site.tenant_id,
            firstName,
            lastName || null,
            canonicalPhone || null,
            canonicalEmail || null,
            "web_form",
            JSON.stringify(sourceMetadata),
            rawComment ? `Комментарий: ${rawComment}` : null,
          ],
        );
        contactId = newContact.id;
      }

      // 5. Определение воронки и этапа сделки
      let pipelineId = site.target_pipeline_id;
      let stageId = site.target_stage_id;

      if (pipelineId) {
        const pCheck = await tx.queryOne<{ id: string }>(
          `SELECT id FROM pipelines WHERE tenant_id = $1 AND id = $2`,
          [site.tenant_id, pipelineId],
        );
        if (!pCheck) pipelineId = null;
      }

      if (!pipelineId) {
        const defaultP = await tx.queryOne<{ id: string }>(
          `SELECT id FROM pipelines WHERE tenant_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
          [site.tenant_id],
        );
        if (defaultP) pipelineId = defaultP.id;
      }

      if (!pipelineId) {
        throw new AppError(500, "PIPELINE_NOT_FOUND", "В системе нет активных воронок для создания сделки");
      }

      if (stageId) {
        const sCheck = await tx.queryOne<{ id: string }>(
          `SELECT id FROM stages WHERE pipeline_id = $1 AND id = $2`,
          [pipelineId, stageId],
        );
        if (!sCheck) stageId = null;
      }

      if (!stageId) {
        const leadStage = await tx.queryOne<{ id: string }>(
          `SELECT id FROM stages
           WHERE pipeline_id = $1
           ORDER BY
             CASE
               WHEN name ILIKE '%новый лид%' THEN 1
               WHEN name ILIKE '%новый%' THEN 2
               WHEN name ILIKE '%лид%' THEN 3
               ELSE 4
             END,
             position ASC
           LIMIT 1`,
          [pipelineId],
        );
        if (leadStage) stageId = leadStage.id;
      }

      if (!stageId) {
        throw new AppError(500, "STAGE_NOT_FOUND", "В воронке нет этапа для размещения нового лида");
      }

      // 6. Подготовка описания и дополнительных полей
      const standardKeys = new Set([
        "name", "Name", "fio", "FIO", "first_name", "last_name", "ФИО", "Имя", "имя",
        "phone", "Phone", "tel", "telephone", "Телефон", "телефон", "Номер",
        "email", "Email", "e-mail", "E-mail", "mail", "Почта", "почта",
        "comment", "COMMENT", "comments", "message", "msg", "Комментарий", "комментарий", "Сообщение",
        "formname", "form_name", "formid", "form_id", "Форма", "форма",
        "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
        "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm",
        "ym_client_id", "ymClientId", "_ym_uid", "yandex_client_id",
        "ga_client_id", "gaClientId", "_ga", "google_client_id",
        "page_url", "pageUrl", "url", "referer", "referrer",
        "test", "amount", "sum", "payment_amount",
      ]);

      const extraFields: Record<string, unknown> = {};
      const extraLines: string[] = [];

      for (const [key, val] of Object.entries(rawPayload)) {
        if (!standardKeys.has(key) && val !== undefined && val !== null && val !== "") {
          extraFields[key] = val;
          extraLines.push(`• ${key}: ${String(val)}`);
        }
      }

      const descriptionParts: string[] = [];
      if (rawComment) descriptionParts.push(`Комментарий: ${rawComment}`);
      if (rawFormName) descriptionParts.push(`Форма: ${rawFormName}`);
      if (pageUrl) descriptionParts.push(`Страница заявки: ${pageUrl}`);
      if (extraLines.length > 0) {
        descriptionParts.push(`Дополнительные поля:\n${extraLines.join("\n")}`);
      }
      const description = descriptionParts.join("\n\n");

      const dealTitle = rawFormName
        ? `Заявка с сайта (${site.name}): ${rawFormName}`
        : `Заявка с сайта: ${site.name}`;

      const first = await tx.queryOne<{ position: number | null }>(
        `SELECT MIN(position) AS position FROM deals
         WHERE tenant_id = $1 AND stage_id = $2 AND deleted_at IS NULL`,
        [site.tenant_id, stageId],
      );

      const dealSourceMetadata = {
        channel: "site",
        site_id: site.id,
        site_name: site.name,
        site_url: site.site_url,
        form_name: rawFormName || null,
        utm_source: utmSource || null,
        utm_medium: utmMedium || null,
        utm_campaign: utmCampaign || null,
        utm_content: utmContent || null,
        utm_term: utmTerm || null,
        ym_client_id: ymClientId || null,
        ga_client_id: gaClientId || null,
        page_url: pageUrl || null,
        form_data: rawPayload,
      };

      // 7. Создание сделки
      const deal = await tx.queryOneOrThrow<DealRow>(
        `INSERT INTO deals
           (tenant_id, pipeline_id, stage_id, contact_id, title, description,
            budget, currency, custom_fields, source_metadata, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11)
         RETURNING *`,
        [
          site.tenant_id,
          pipelineId,
          stageId,
          contactId,
          dealTitle,
          description,
          budget,
          "RUB",
          JSON.stringify(extraFields),
          JSON.stringify(dealSourceMetadata),
          (first?.position ?? 1) - 1,
        ],
      );

      await tx.query(
        `INSERT INTO deal_stage_history (tenant_id, deal_id, from_stage_id, to_stage_id)
         VALUES ($1, $2, NULL, $3)`,
        [site.tenant_id, deal.id, stageId],
      );

      // 8. Фиксация события в таймлайне активности клиента
      if (contactId) {
        await this.contactActivityService.recordActivity({
          tenantId: site.tenant_id,
          contactId,
          dealId: deal.id,
          activityChannel: "web_form",
          activityKind: "form_submission",
          title: rawFormName ? `Заявка с формы «${rawFormName}»` : `Заявка с сайта «${site.name}»`,
          payload: {
            domain: site.site_url || "",
            pageUrl: pageUrl || "",
            formName: rawFormName || "Заявка с сайта",
            formFields: rawPayload,
            touchpoints: {
              referrer: pageUrl || undefined,
              utmSource: utmSource || undefined,
              utmMedium: utmMedium || undefined,
              utmCampaign: utmCampaign || undefined,
              utmContent: utmContent || undefined,
              utmTerm: utmTerm || undefined,
            },
          },
        });
      }

      // 9. Обновление счетчика сайта
      await tx.query(
        `UPDATE site_integrations
         SET leads_count = leads_count + 1,
             last_lead_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [site.id],
      );

      // 10. Асинхронные оповещения и отправка конверсий
      void leadNotificationQueue.checkAndTriggerNotification(site.tenant_id, deal.id);
      void notificationQueue.dispatchLeadCreated({ tenantId: site.tenant_id, dealId: deal.id });
      void conversionDispatcher.handleDealCreated({ tenantId: site.tenant_id, dealId: deal.id });

      return {
        status: "ok",
        deal_id: deal.id,
        contact_id: contactId ?? undefined,
      };
    });
  }
}
