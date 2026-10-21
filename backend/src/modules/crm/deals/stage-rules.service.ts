import { query, queryOne } from "../../../db/client.js";
import { NotFoundError } from "../../../plugins/errorHandler.js";
import { resolveOutboundSender } from "../../channels/outbound-registry.js";

// ---------------------------------------------------------------------------
// Автоворонки по этапам сделок (CRM Stage Rules & Bot Broadcasts).
//
// При переходе сделки на целевой этап сервис находит активные правила автоворонки,
// выполняет шаблонизацию текста ({{name}}, {{budget}}, {{deal_title}}) и
// инициирует автоматическую отправку сообщения клиенту.
// ---------------------------------------------------------------------------

export interface StageRuleDTO {
  id: string;
  tenantId: string;
  pipelineId: string | null;
  stageId: string | null;
  channelAccountId: string | null;
  channel: string;
  name: string;
  delaySeconds: number;
  templateText: string;
  mediaUrl: string | null;
  mediaType: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface StageRuleRow {
  id: string;
  tenant_id: string;
  pipeline_id: string | null;
  stage_id: string | null;
  channel_account_id: string | null;
  channel: string;
  name: string;
  delay_seconds: number;
  template_text: string;
  media_url: string | null;
  media_type: string | null;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(val: Date | string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  return typeof val === "string" ? val : val.toISOString();
}

function toRuleDTO(row: StageRuleRow): StageRuleDTO {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    channelAccountId: row.channel_account_id,
    channel: row.channel,
    name: row.name,
    delaySeconds: row.delay_seconds,
    templateText: row.template_text,
    mediaUrl: row.media_url,
    mediaType: row.media_type,
    isActive: row.is_active,
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

export interface CreateStageRulePayload {
  pipelineId?: string | null;
  stageId: string;
  channelAccountId?: string | null;
  channel?: string;
  name: string;
  delaySeconds?: number;
  templateText: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  isActive?: boolean;
}

export class StageRulesService {
  async list(tenantId: string, stageId?: string): Promise<StageRuleDTO[]> {
    const conditions = ["tenant_id = $1"];
    const params: (string | number)[] = [tenantId];

    if (stageId) {
      params.push(stageId);
      conditions.push(`stage_id = $${params.length}`);
    }

    const rows = await query<StageRuleRow>(
      `SELECT * FROM mailing_stage_rules
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC`,
      params,
    );

    return rows.map(toRuleDTO);
  }

  async getById(tenantId: string, id: string): Promise<StageRuleDTO> {
    const row = await queryOne<StageRuleRow>(
      `SELECT * FROM mailing_stage_rules WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );

    if (row === null) throw new NotFoundError("Правило автоворонки не найдено");
    return toRuleDTO(row);
  }

  async create(tenantId: string, payload: CreateStageRulePayload): Promise<StageRuleDTO> {
    const row = await queryOne<StageRuleRow>(
      `INSERT INTO mailing_stage_rules
         (tenant_id, pipeline_id, stage_id, channel_account_id, channel, name,
          delay_seconds, template_text, media_url, media_type, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        tenantId,
        payload.pipelineId ?? null,
        payload.stageId,
        payload.channelAccountId ?? null,
        payload.channel ?? "telegram",
        payload.name,
        payload.delaySeconds ?? 0,
        payload.templateText,
        payload.mediaUrl ?? null,
        payload.mediaType ?? null,
        payload.isActive ?? true,
      ],
    );

    if (row === null) throw new Error("Не удалось создать правило автоворонки");
    return toRuleDTO(row);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `DELETE FROM mailing_stage_rules WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [tenantId, id],
    );

    return row !== null;
  }

  /**
   * Срабатывание правил автоворонки при переходе сделки на стадию.
   */
  async fireStageRules(input: {
    tenantId: string;
    dealId: string;
    stageId: string;
  }): Promise<{ fired: number; rules: string[] }> {
    const rules = await query<StageRuleRow>(
      `SELECT * FROM mailing_stage_rules
       WHERE tenant_id = $1 AND stage_id = $2 AND is_active = true`,
      [input.tenantId, input.stageId],
    );

    if (rules.length === 0) {
      return { fired: 0, rules: [] };
    }

    // Достаем контекст сделки и контакта
    const deal = await queryOne<{
      title: string;
      budget: number | null;
      contact_id: string | null;
      first_name: string | null;
      last_name: string | null;
    }>(
      `SELECT d.title, d.budget, d.contact_id,
              c.first_name, c.last_name
       FROM deals d
       LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [input.tenantId, input.dealId],
    );

    if (deal === null) {
      return { fired: 0, rules: [] };
    }

    const firedNames: string[] = [];
    const clientName = [deal.first_name, deal.last_name].filter(Boolean).join(" ") || "Клиент";
    const dealBudget = deal.budget !== null ? `${deal.budget} руб.` : "";

    for (const rule of rules) {
      // Шаблонизация текста: {{name}}, {{budget}}, {{deal_title}}
      const renderedText = rule.template_text
        .replaceAll("{{name}}", clientName)
        .replaceAll("{{deal_title}}", deal.title)
        .replaceAll("{{budget}}", dealBudget);

      // Записываем автосообщение в таймлайн сделки
      const rows = await query<{ id: string }>(
        `INSERT INTO deal_messages
           (tenant_id, deal_id, channel_account_id, source, direction, sender_name,
            content, channel, delivery_status, attachment, attachment_type)
         VALUES ($1, $2, $3, 'manager', 'outbound', $4, $5, $6, 'sent', $7, $8)
         RETURNING id`,
        [
          input.tenantId,
          input.dealId,
          rule.channel_account_id,
          `Автоворонка: ${rule.name}`,
          renderedText,
          rule.channel,
          rule.media_url,
          rule.media_type,
        ],
      );

      const messageId = rows[0]?.id;

      // Реальная отправка в канал с учетом задержки delay_seconds
      if (messageId) {
        if (rule.delay_seconds > 0) {
          const delayMs = rule.delay_seconds * 1000;
          const timer = setTimeout(() => {
            void this.deliverAutomatedMessage({
              tenantId: input.tenantId,
              dealId: input.dealId,
              messageId,
              channel: rule.channel,
              channelAccountId: rule.channel_account_id,
              renderedText,
            });
          }, delayMs);
          timer.unref?.();
        } else {
          // Отправка немедленно без задержки
          void this.deliverAutomatedMessage({
            tenantId: input.tenantId,
            dealId: input.dealId,
            messageId,
            channel: rule.channel,
            channelAccountId: rule.channel_account_id,
            renderedText,
          });
        }
      }

      firedNames.push(rule.name);
    }

    return { fired: firedNames.length, rules: firedNames };
  }

  /**
   * Отправка сгенерированного сообщения клиенту в подключённый транспорт канала.
   */
  private async deliverAutomatedMessage(input: {
    tenantId: string;
    dealId: string;
    messageId: string;
    channel: string;
    channelAccountId: string | null;
    renderedText: string;
  }): Promise<void> {
    const route = await this.resolveRoute(
      input.tenantId,
      input.dealId,
      input.channel,
      input.channelAccountId,
    );

    if (!route) {
      await query(
        `UPDATE deal_messages
         SET delivery_status = 'failed', delivery_error = $1
         WHERE tenant_id = $2 AND id = $3`,
        ["Не найден адресат у контакта сделки или активный аккаунт канала", input.tenantId, input.messageId],
      );
      return;
    }

    const sender = resolveOutboundSender(input.channel);
    if (!sender) {
      await query(
        `UPDATE deal_messages
         SET delivery_status = 'failed', delivery_error = $1
         WHERE tenant_id = $2 AND id = $3`,
        [`Канал ${input.channel} не отправляет сообщения: подключение не активно`, input.tenantId, input.messageId],
      );
      return;
    }

    try {
      const result = await sender({
        tenantId: input.tenantId,
        channelAccountId: route.channelAccountId,
        recipient: route.recipient,
        text: input.renderedText,
      });

      if (result.ok) {
        await query(
          `UPDATE deal_messages
           SET delivery_status = 'sent', delivery_error = NULL
           WHERE tenant_id = $1 AND id = $2`,
          [input.tenantId, input.messageId],
        );
      } else {
        await query(
          `UPDATE deal_messages
           SET delivery_status = 'failed', delivery_error = $1
           WHERE tenant_id = $2 AND id = $3`,
          [result.reason, input.tenantId, input.messageId],
        );
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Неизвестная ошибка транспорта канала";
      await query(
        `UPDATE deal_messages
         SET delivery_status = 'failed', delivery_error = $1
         WHERE tenant_id = $2 AND id = $3`,
        [reason, input.tenantId, input.messageId],
      );
    }
  }

  /**
   * Определение маршрута доставки: аккаунт канала и адресат контакта.
   */
  private async resolveRoute(
    tenantId: string,
    dealId: string,
    channel: string,
    channelAccountIdOverride: string | null,
  ): Promise<{ channelAccountId: string; recipient: string } | null> {
    const rows = await query<{
      last_channel_account_id: string | null;
      telegram_chat_id: string | null;
      telegram_username: string | null;
      whatsapp: string | null;
      phone: string;
      socials: Array<{ kind: string; value: string }> | null;
    }>(
      `SELECT
         (
           SELECT m.channel_account_id
           FROM deal_messages m
           WHERE m.tenant_id = d.tenant_id
             AND m.deal_id = d.id
             AND m.channel = $3
             AND m.channel_account_id IS NOT NULL
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS last_channel_account_id,
         c.telegram_chat_id::text AS telegram_chat_id,
         c.telegram_username,
         c.whatsapp,
         c.phone,
         c.socials
       FROM deals d
       LEFT JOIN contacts c
         ON c.id = d.contact_id
        AND c.tenant_id = d.tenant_id
        AND c.deleted_at IS NULL
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [tenantId, dealId, channel],
    );

    const row = rows[0];
    if (!row) return null;

    let channelAccountId = channelAccountIdOverride || row.last_channel_account_id;

    if (!channelAccountId) {
      const fallbackAccount = await queryOne<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = $2 AND status = 'connected' AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
        [tenantId, channel],
      );
      channelAccountId = fallbackAccount?.id ?? null;
    }

    if (!channelAccountId) return null;

    let recipient: string | null = null;
    if (channel === "telegram") {
      recipient = row.telegram_chat_id || row.telegram_username || (row.phone ? row.phone : null);
    } else if (channel === "whatsapp") {
      recipient = row.whatsapp || (row.phone ? row.phone : null);
    } else if (channel === "max") {
      const maxSocial = Array.isArray(row.socials)
        ? row.socials.find((s) => s.kind === "max")?.value
        : null;
      recipient = maxSocial || (row.phone ? row.phone : null);
    } else {
      recipient = row.phone ? row.phone : null;
    }

    if (!recipient) return null;

    return { channelAccountId, recipient };
  }
}
