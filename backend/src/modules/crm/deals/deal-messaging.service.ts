import { query, queryOne } from "../../../db/client.js";
import { DealsService } from "./deals.service.js";
import {
  resolveOutboundSender,
  resolveTelegramHistorySyncer,
  type OutboundSendResult,
} from "../../channels/outbound-registry.js";
import type { CreateDealMessagePayload, DealMessageDTO } from "./deals.types.js";
import type { ContactSocialJson } from "../contacts/contacts.types.js";
import {
  GatewayChatProvider,
  type ChatProvider,
  type ChatMessage as LlmChatMessage,
} from "../../../services/chat.service.js";
import { KnowledgeBaseService } from "../../ai/knowledge.service.js";

// ---------------------------------------------------------------------------
// Отправка ответа менеджера в канал клиента.
//
// До этого `POST /crm/deals/:id/messages` только писал строку в `deal_messages`:
// менеджер печатал в карточке, сообщение появлялось в таймлайне, клиент в
// Telegram не получал ничего. Чат работал как журнал, а не как переписка.
//
// Порядок шагов важен и выбран сознательно: сначала запись, потом отправка.
// Обратный порядок терял бы текст ответа при отказе сети — сообщение ушло бы
// клиенту, а в CRM его не осталось бы, или наоборот, менеджер переписал бы его
// заново. Поэтому строка появляется всегда, а результат доставки приезжает
// статусом на ней же.
//
// Статус на строке, а не тостом: тост исчезнет, а неотправленное сообщение
// осталось бы висеть в таймлайне как отправленное.
// ---------------------------------------------------------------------------

/** Куда отправлять: адрес получателя в терминах канала плюс аккаунт-отправитель. */
interface OutboundRoute {
  channelAccountId: string;
  recipient: string;
  username?: string;
  phone?: string;
}

export interface SendFromOptionDTO {
  channelAccountId: string;
  channel: string;
  label: string;
  accountName: string;
  available: boolean;
  unavailableReason?: string;
  isDefault: boolean;
}

interface Logger {
  warn: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

export class DealMessagingService {
  constructor(
    private readonly deals: DealsService = new DealsService(),
    private readonly log: Logger | null = null,
    private readonly chat: ChatProvider = new GatewayChatProvider(),
    private readonly knowledge: KnowledgeBaseService = new KnowledgeBaseService(),
  ) {}

  /**
   * Возвращает список доступных аккаунтов («Пишем от:») для сделки с учетом контактных данных клиента.
   */
  async getSendFromOptions(tenantId: string, dealId: string): Promise<SendFromOptionDTO[]> {
    const contactRows = await query<{
      telegram_chat_id: string | null;
      telegram_username: string | null;
      whatsapp: string | null;
      phone: string;
      socials?: ContactSocialJson[];
    }>(
      `SELECT c.telegram_chat_id::text AS telegram_chat_id,
              c.telegram_username,
              c.whatsapp,
              c.phone,
              c.socials
       FROM deals d
       LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id AND c.deleted_at IS NULL
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [tenantId, dealId],
    );

    const contact = contactRows[0] ?? {
      telegram_chat_id: null,
      telegram_username: null,
      whatsapp: null,
      phone: "",
      socials: [],
    };

    const accounts = await query<{ id: string; channel: string; label?: string; name?: string }>(
      `SELECT id, channel, label
       FROM channel_accounts
       WHERE tenant_id = $1 AND status = 'connected' AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenantId],
    );

    const lastMsgAccountRow = await query<{ channel_account_id: string | null; channel: string }>(
      `SELECT channel_account_id, channel FROM deal_messages
       WHERE tenant_id = $1 AND deal_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [tenantId, dealId],
    );
    const lastAccId = lastMsgAccountRow[0]?.channel_account_id;
    const lastChannel = lastMsgAccountRow[0]?.channel;

    const matchedByAccount = lastAccId ? accounts.find((a) => a.id === lastAccId) : undefined;
    const matchedByChannel = lastChannel ? accounts.find((a) => a.channel === lastChannel) : undefined;
    const defaultAccountId = matchedByAccount?.id ?? matchedByChannel?.id ?? accounts[0]?.id;

    return accounts.map((acc) => {
      let available = false;
      let unavailableReason: string | undefined;

      if (acc.channel === "telegram") {
        if (contact.telegram_chat_id || contact.telegram_username || contact.phone) {
          available = true;
        } else {
          unavailableReason = "У контакта не указан Telegram или номер телефона";
        }
      } else if (acc.channel === "whatsapp") {
        if (contact.whatsapp || contact.phone) {
          available = true;
        } else {
          unavailableReason = "У контакта не указан телефон для WhatsApp";
        }
      } else if (acc.channel === "rumax" || acc.channel === "max") {
        const hasMaxSocial = contact.socials?.some((s) => s.kind === "max" && s.value);
        if (contact.phone || hasMaxSocial) {
          available = true;
        } else {
          unavailableReason = "У контакта не указан телефон для MAX";
        }
      } else {
        available = true;
      }

      let channelPrefix = acc.channel.toUpperCase();
      if (acc.channel === "max" || acc.channel === "rumax") channelPrefix = "MAX";
      else if (acc.channel === "telegram") channelPrefix = "Telegram";
      else if (acc.channel === "whatsapp") channelPrefix = "WhatsApp";
      else if (acc.channel === "webchat") channelPrefix = "Онлайн-чат";

      const cleanLabel = (acc.label || acc.name || "")
        .replace(/\s*\((telegram|whatsapp|max|rumax|webchat)\)/gi, "")
        .trim();
      const accountLabel = cleanLabel || acc.label || acc.name || channelPrefix;

      return {
        channelAccountId: acc.id,
        channel: acc.channel,
        label: `${channelPrefix} — ${accountLabel}`,
        accountName: accountLabel,
        available,
        unavailableReason,
        isDefault: acc.id === defaultAccountId,
      };
    });
  }

  /**
   * Записывает ответ менеджера и отправляет его в канал.
   *
   * Возвращает строку таймлайна с итоговым статусом доставки. Отказ канала не
   * бросает исключение: сообщение записано, и ответ 201 с `delivery_status =
   * failed` честнее ошибки 5xx, после которой клиент не знает, сохранён ли текст.
   */
  async sendManagerMessage(input: {
    tenantId: string;
    dealId: string;
    senderName: string;
    payload: CreateDealMessagePayload;
  }): Promise<DealMessageDTO> {
    const { tenantId, dealId, senderName, payload } = input;

    // Внутренние заметки и системные записи доставлять некуда: у них
    // `direction` не `outbound`, и статус остаётся `neutral`.
    const deliverable = payload.direction === "outbound" && payload.source !== "system";

    const message = await this.deals.createMessage(
      tenantId,
      dealId,
      senderName,
      payload,
      deliverable ? "pending" : "neutral",
    );

    if (!deliverable) return message;

    // AI Handoff: ответ менеджера ставит AI-автопилот на паузу на 1 час (ручной перехват), если он не выключен
    await query(
      `UPDATE deals
       SET ai_paused_until = CASE
         WHEN ai_paused_until IS NOT NULL AND ai_paused_until > '9000-01-01'::timestamptz THEN ai_paused_until
         ELSE now() + interval '1 hour'
       END
       WHERE tenant_id = $1 AND id = $2`,
      [tenantId, dealId],
    ).catch(() => {});

    const result = await this.deliver(tenantId, dealId, payload);

    const updated = await this.deals.markMessageDelivery(
      tenantId,
      message.id,
      result.ok ? "sent" : "failed",
      result.ok ? null : result.reason,
    );

    return updated ?? message;
  }

  /**
   * Отправка через транспорт канала.
   *
   * Все отказы возвращаются значением, а не исключением: «канал не подключён» и
   * «Telegram отклонил» для менеджера одинаковы по смыслу — сообщение не ушло, и
   * причина должна оказаться в таймлайне, а не в логе сервера.
   */
  private async deliver(
    tenantId: string,
    dealId: string,
    payload: CreateDealMessagePayload,
  ): Promise<OutboundSendResult> {
    const sender = resolveOutboundSender(payload.channel);

    if (sender === null) {
      return {
        ok: false,
        reason: `Канал ${payload.channel} не отправляет сообщения: подключение не активно`,
      };
    }

    let route: OutboundRoute | null;

    try {
      route = await this.resolveRoute(tenantId, dealId, payload);
    } catch (error) {
      this.log?.error({ error, dealId }, "Failed to resolve outbound route for deal message");
      return { ok: false, reason: "Не удалось определить получателя в канале" };
    }

    if (route === null) {
      return {
        ok: false,
        reason: "У сделки нет контакта с адресом в этом канале",
      };
    }

    const outboundPayload: Parameters<typeof sender>[0] = {
      tenantId,
      channelAccountId: route.channelAccountId,
      recipient: route.recipient,
      text: payload.content,
    };
    if (route.username !== undefined) outboundPayload.username = route.username;
    if (route.phone !== undefined) outboundPayload.phone = route.phone;
    if (payload.attachment) outboundPayload.attachment = payload.attachment;
    if (payload.attachment_type) outboundPayload.attachmentType = payload.attachment_type;

    try {
      return await sender(outboundPayload);
    } catch (error) {
      this.log?.error({ error, dealId }, "Outbound sender threw while sending deal message");
      return { ok: false, reason: "Транспорт канала недоступен" };
    }
  }

  /**
   * Кому и от какого аккаунта отправлять.
   *
   * Аккаунт берётся из последнего сообщения этой переписки, а не из первого
   * подключённого: у арендатора может быть несколько аккаунтов одного канала, и
   * ответ обязан уйти с того, на который клиент писал. Явно переданный
   * `channel_account_id` имеет приоритет — оператор выбрал аккаунт сам.
   *
   * Получатель — `telegram_chat_id` контакта: именно по нему транспорт нашёл или
   * создал контакт на входящем сообщении, поэтому обратный путь тот же.
   */
  private async resolveRoute(
    tenantId: string,
    dealId: string,
    payload: CreateDealMessagePayload,
  ): Promise<OutboundRoute | null> {
    const rows = await query<{
      channel_account_id: string | null;
      telegram_chat_id: string | null;
      telegram_username: string | null;
      whatsapp: string | null;
      phone: string;
      socials?: ContactSocialJson[];
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
         ) AS channel_account_id,
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
      [tenantId, dealId, payload.channel],
    );

    const row = rows[0];
    if (row === undefined) return null;

    let channelAccountId =
      payload.channel_account_id !== undefined && payload.channel_account_id.length > 0
        ? payload.channel_account_id
        : row.channel_account_id;

    // Write-First fallback: если переписка ещё не велась, берём первый активный аккаунт этого канала
    if (!channelAccountId) {
      const fallbackAccount = await query<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = $2 AND status = 'connected' AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
        [tenantId, payload.channel],
      );
      channelAccountId = fallbackAccount[0]?.id ?? null;
    }

    if (channelAccountId === null || channelAccountId.length === 0) return null;

    const recipient = this.recipientFor(payload.channel, row);
    if (recipient === null) return null;

    return {
      channelAccountId,
      recipient,
      username: row.telegram_username ?? undefined,
      phone: row.phone && row.phone.length > 0 ? row.phone : undefined,
    };
  }

  /** Адрес получателя зависит от канала: у Telegram это numeric id, не username. */
  private recipientFor(
    channel: string,
    contact: {
      telegram_chat_id: string | null;
      telegram_username: string | null;
      whatsapp: string | null;
      phone: string;
      socials?: ContactSocialJson[];
    },
  ): string | null {
    if (channel === "telegram") {
      // Числовой id, а не username: транспорт обращается к peer по нему, и
      // username мог измениться после первого сообщения.
      return contact.telegram_chat_id ?? contact.telegram_username ?? (contact.phone && contact.phone.length > 0 ? contact.phone : null);
    }

    if (channel === "whatsapp") {
      const value = contact.whatsapp ?? contact.phone;
      return value && value.length > 0 ? value : null;
    }

    if (channel === "max" || channel === "rumax") {
      const maxSocial = contact.socials?.find((s) => s.kind === "max")?.value;
      if (maxSocial && maxSocial.length > 0) return maxSocial;
      return contact.phone && contact.phone.length > 0 ? contact.phone : null;
    }

    if (channel === "webchat") {
      const visitorSocial = contact.socials?.find((s) => s.kind === "other")?.value;
      if (visitorSocial && visitorSocial.length > 0) return visitorSocial;
      return "webchat_visitor";
    }

    return contact.phone && contact.phone.length > 0 ? contact.phone : null;
  }

  /**
   * Возвращает текущий статус автопилота AI для сделки.
   */
  async getAiStatus(
    tenantId: string,
    dealId: string,
  ): Promise<{
    aiControl: "enabled" | "paused" | "disabled";
    isPaused: boolean;
    pausedUntil: string | null;
    pausedReason: string | null;
    status: "enabled" | "paused" | "disabled";
  }> {
    const row = await queryOne<{ ai_paused_until: string | null }>(
      `SELECT ai_paused_until FROM deals WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, dealId],
    );
    if (!row || !row.ai_paused_until) {
      return {
        aiControl: "enabled",
        isPaused: false,
        pausedUntil: null,
        pausedReason: null,
        status: "enabled",
      };
    }
    const pausedUntilDate = new Date(row.ai_paused_until);
    const now = new Date();
    if (pausedUntilDate.getFullYear() >= 2090) {
      return {
        aiControl: "disabled",
        isPaused: false,
        pausedUntil: null,
        pausedReason: null,
        status: "disabled",
      };
    }
    if (pausedUntilDate > now) {
      return {
        aiControl: "paused",
        isPaused: true,
        pausedUntil: row.ai_paused_until,
        pausedReason: "manual_takeover",
        status: "paused",
      };
    }
    return {
      aiControl: "enabled",
      isPaused: false,
      pausedUntil: null,
      pausedReason: null,
      status: "enabled",
    };
  }

  /**
   * Переключает режим AI для сделки: включить, пауза на 1 час, выключить.
   */
  async setAiControl(
    tenantId: string,
    dealId: string,
    action: "enable" | "pause" | "disable",
  ): Promise<{
    aiControl: "enabled" | "paused" | "disabled";
    isPaused: boolean;
    pausedUntil: string | null;
    pausedReason: string | null;
    status: "enabled" | "paused" | "disabled";
  }> {
    const deal = await queryOne<{ contact_id: string | null }>(
      `SELECT contact_id FROM deals WHERE tenant_id = $1 AND id = $2`,
      [tenantId, dealId],
    );

    let targetDate: string | null = null;
    if (action === "pause") {
      targetDate = "now() + interval '1 hour'";
    } else if (action === "disable") {
      targetDate = "'9999-12-31 23:59:59+00'::timestamptz";
    }

    if (targetDate) {
      await query(
        `UPDATE deals SET ai_paused_until = ${targetDate}
         WHERE tenant_id = $1 AND (id = $2 OR ($3::uuid IS NOT NULL AND contact_id = $3::uuid AND deleted_at IS NULL))`,
        [tenantId, dealId, deal?.contact_id ?? null],
      );
    } else {
      await query(
        `UPDATE deals SET ai_paused_until = NULL
         WHERE tenant_id = $1 AND (id = $2 OR ($3::uuid IS NOT NULL AND contact_id = $3::uuid AND deleted_at IS NULL))`,
        [tenantId, dealId, deal?.contact_id ?? null],
      );
    }

    return this.getAiStatus(tenantId, dealId);
  }

  /**
   * AI Copilot: генерирует черновик ответа оператора по контексту переписки и базе знаний.
   */
  async generateAiDraft(tenantId: string, dealId: string): Promise<{ draft: string }> {
    const recentMessages = await query<{
      direction: string;
      source: string;
      content: string;
      sender_name: string;
    }>(
      `SELECT direction, source, content, sender_name
       FROM deal_messages
       WHERE tenant_id = $1 AND deal_id = $2
       ORDER BY created_at DESC LIMIT 8`,
      [tenantId, dealId],
    );

    const reversed = [...recentMessages].reverse();
    const lastClientMsg = [...reversed]
      .reverse()
      .find((m) => m.direction === "inbound" || m.source === "client");
    const queryText = lastClientMsg?.content || "";

    let knowledgeContext = "";
    try {
      const agent = await queryOne<{ id: string; system_prompt: string }>(
        `SELECT id, system_prompt FROM ai_agents WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
        [tenantId],
      );
      if (agent && queryText) {
        const hits = await this.knowledge.search({
          tenantId,
          agentId: agent.id,
          question: queryText,
          limit: 3,
        });
        if (hits.length > 0) {
          knowledgeContext =
            "\n\nИнформация из базы знаний:\n" +
            hits.map((h, i) => `${i + 1}. ${h.content}`).join("\n");
        }
      }
    } catch {
      // Игнорируем сбои поиска по базе знаний
    }

    if (!this.chat.isConfigured) {
      return {
        draft: "Здравствуйте! Подскажите, пожалуйста, какой вопрос вас интересует?",
      };
    }

    const dialogueHistory = reversed
      .map((m) => `${m.direction === "inbound" ? "Клиент" : "Менеджер"}: ${m.content}`)
      .join("\n");

    const promptMessages: LlmChatMessage[] = [
      {
        role: "system",
        content: `Ты — AI-ассистент оператора CRM. Твоя задача — составить один профессиональный, лаконичный и доброжелательный черновик ответа клиенту от лица компании на русском языке. Пиши кратко (1-3 предложения), по существу, без вступительных фраз вида "Вот ответ:" и без кавычек.${knowledgeContext}`,
      },
      {
        role: "user",
        content: dialogueHistory
          ? `История переписки:\n${dialogueHistory}\n\nНапиши следующий ответ менеджера:`
          : "Напиши приветственное сообщение новому клиенту:",
      },
    ];

    try {
      const res = await this.chat.complete({
        model: "openrouter/openai/gpt-4o-mini",
        messages: promptMessages,
        temperature: 0.7,
        maxTokens: 300,
      });
      return { draft: res.content.trim() };
    } catch (err) {
      this.log?.warn({ err, dealId }, "Failed to generate AI draft");
      return { draft: "Здравствуйте! Чем я могу вам помочь?" };
    }
  }

  /**
   * Возвращает хронологию сообщений для контакта по всем его сделкам.
   */
  async listContactMessages(tenantId: string, contactId: string): Promise<DealMessageDTO[]> {
    const rows = await query<any>(
      `SELECT m.id, m.tenant_id, m.deal_id, m.channel_account_id, m.source, m.direction, m.sender_name, m.content, m.channel,
              m.attachment, m.attachment_type, m.delivery_status, m.delivery_error, m.created_at
       FROM deal_messages m
       JOIN deals d ON d.id = m.deal_id AND d.tenant_id = m.tenant_id
       WHERE m.tenant_id = $1 AND d.contact_id = $2 AND d.deleted_at IS NULL
       ORDER BY m.created_at ASC`,
      [tenantId, contactId],
    );
    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenant_id,
      dealId: r.deal_id,
      channelAccountId: r.channel_account_id,
      source: r.source,
      direction: r.direction,
      senderName: r.sender_name,
      content: r.content,
      channel: r.channel,
      attachment: r.attachment,
      attachmentType: r.attachment_type,
      deliveryStatus: r.delivery_status,
      deliveryError: r.delivery_error,
      createdAt: r.created_at,
    }));
  }

  /**
   * Возвращает список доступных каналов для контакта.
   */
  async getContactSendFromOptions(tenantId: string, contactId: string): Promise<SendFromOptionDTO[]> {
    const contactRows = await query<{
      telegram_chat_id: string | null;
      telegram_username: string | null;
      whatsapp: string | null;
      phone: string;
      socials?: ContactSocialJson[];
    }>(
      `SELECT c.telegram_chat_id::text AS telegram_chat_id,
              c.telegram_username,
              c.whatsapp,
              c.phone,
              c.socials
       FROM contacts c
       WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [tenantId, contactId],
    );

    const contact = contactRows[0] ?? {
      telegram_chat_id: null,
      telegram_username: null,
      whatsapp: null,
      phone: "",
      socials: [],
    };

    const accounts = await query<{ id: string; channel: string; label?: string; name?: string }>(
      `SELECT id, channel, label
       FROM channel_accounts
       WHERE tenant_id = $1 AND status = 'connected' AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenantId],
    );

    const lastMsgAccountRow = await query<{ channel_account_id: string | null; channel: string }>(
      `SELECT dm.channel_account_id, dm.channel
       FROM deal_messages dm
       JOIN deals d ON d.id = dm.deal_id AND d.tenant_id = dm.tenant_id
       WHERE dm.tenant_id = $1 AND d.contact_id = $2
       ORDER BY dm.created_at DESC LIMIT 1`,
      [tenantId, contactId],
    );
    const lastAccId = lastMsgAccountRow[0]?.channel_account_id;
    const lastChannel = lastMsgAccountRow[0]?.channel;

    const matchedByAccount = lastAccId ? accounts.find((a) => a.id === lastAccId) : undefined;
    const matchedByChannel = lastChannel ? accounts.find((a) => a.channel === lastChannel) : undefined;
    const defaultAccountId = matchedByAccount?.id ?? matchedByChannel?.id ?? accounts[0]?.id;

    return accounts.map((acc) => {
      let available = false;
      let unavailableReason: string | undefined;

      if (acc.channel === "telegram") {
        if (contact.telegram_chat_id || contact.telegram_username || contact.phone) {
          available = true;
        } else {
          unavailableReason = "У контакта не указан Telegram или номер телефона";
        }
      } else if (acc.channel === "whatsapp") {
        if (contact.whatsapp || contact.phone) {
          available = true;
        } else {
          unavailableReason = "У контакта не указан телефон для WhatsApp";
        }
      } else if (acc.channel === "rumax" || acc.channel === "max") {
        const hasMaxSocial = contact.socials?.some((s) => s.kind === "max" && s.value);
        if (contact.phone || hasMaxSocial) {
          available = true;
        } else {
          unavailableReason = "У контакта не указан телефон для MAX";
        }
      } else {
        available = true;
      }

      let channelPrefix = acc.channel.toUpperCase();
      if (acc.channel === "max" || acc.channel === "rumax") channelPrefix = "MAX";
      else if (acc.channel === "telegram") channelPrefix = "Telegram";
      else if (acc.channel === "whatsapp") channelPrefix = "WhatsApp";
      else if (acc.channel === "webchat") channelPrefix = "Онлайн-чат";

      const cleanLabel = (acc.label || acc.name || "")
        .replace(/\s*\((telegram|whatsapp|max|rumax|webchat)\)/gi, "")
        .trim();
      const accountLabel = cleanLabel || acc.label || acc.name || channelPrefix;

      return {
        channelAccountId: acc.id,
        channel: acc.channel,
        label: `${channelPrefix} — ${accountLabel}`,
        accountName: accountLabel,
        available,
        unavailableReason,
        isDefault: acc.id === defaultAccountId,
      };
    });
  }

  /**
   * Отправляет сообщение от оператора контакту (в активную сделку контакта или создаёт новую).
   */
  async sendContactMessage(input: {
    tenantId: string;
    contactId: string;
    senderName: string;
    userId: string;
    payload: CreateDealMessagePayload;
  }): Promise<DealMessageDTO> {
    const { tenantId, contactId, senderName, userId, payload } = input;

    let activeDeal = await queryOne<{ id: string }>(
      `SELECT id FROM deals
       WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL AND closed_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, contactId],
    );

    if (!activeDeal) {
      activeDeal = await queryOne<{ id: string }>(
        `SELECT id FROM deals
         WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL
         ORDER BY updated_at DESC LIMIT 1`,
        [tenantId, contactId],
      );
    }

    let dealId: string;
    if (activeDeal) {
      dealId = activeDeal.id;
    } else {
      const contact = await queryOne<{ first_name: string; last_name: string | null }>(
        `SELECT first_name, last_name FROM contacts WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, contactId],
      );
      const name = contact ? `${contact.first_name} ${contact.last_name || ""}`.trim() : "Клиент";
      const pipelines = await this.deals.listPipelines(tenantId);
      const pipelineId = pipelines[0]?.id;
      const stage = pipelineId
        ? await queryOne<{ id: string }>(
            `SELECT s.id FROM stages s
             JOIN pipelines p ON p.id = s.pipeline_id
             WHERE s.pipeline_id = $1 AND p.tenant_id = $2
             ORDER BY s.sort_order ASC LIMIT 1`,
            [pipelineId, tenantId],
          )
        : null;
      const stageId = stage?.id;

      if (!pipelineId || !stageId) {
        throw new Error("No pipeline or stage configured for tenant");
      }

      const createdDeal = await this.deals.create(
        tenantId,
        userId,
        {
          title: `Диалог с ${name}`,
          pipeline_id: pipelineId,
          stage_id: stageId,
          contact_id: contactId,
          budget: 0,
          currency: "RUB",
          custom_fields: {},
        },
      );
      dealId = createdDeal.id;
    }

    return this.sendManagerMessage({
      tenantId,
      dealId,
      senderName,
      payload,
    });
  }

  /**
   * Возвращает статус AI для контакта (по его активной сделке).
   */
  async getContactAiStatus(
    tenantId: string,
    contactId: string,
  ): Promise<{
    aiControl: "enabled" | "paused" | "disabled";
    isPaused: boolean;
    pausedUntil: string | null;
    pausedReason: string | null;
    status: "enabled" | "paused" | "disabled";
  }> {
    const deal = await queryOne<{ id: string }>(
      `SELECT id FROM deals
       WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, contactId],
    );
    if (!deal) {
      return {
        aiControl: "enabled",
        isPaused: false,
        pausedUntil: null,
        pausedReason: null,
        status: "enabled",
      };
    }
    return this.getAiStatus(tenantId, deal.id);
  }

  /**
   * Переключает режим AI для всех сделок контакта.
   */
  async setContactAiControl(
    tenantId: string,
    contactId: string,
    action: "enable" | "pause" | "disable",
  ): Promise<{
    aiControl: "enabled" | "paused" | "disabled";
    isPaused: boolean;
    pausedUntil: string | null;
    pausedReason: string | null;
    status: "enabled" | "paused" | "disabled";
  }> {
    let updateSql = `UPDATE deals SET ai_paused_until = NULL WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL`;
    if (action === "pause") {
      updateSql = `UPDATE deals SET ai_paused_until = now() + interval '1 hour' WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL`;
    } else if (action === "disable") {
      updateSql = `UPDATE deals SET ai_paused_until = '9999-12-31 23:59:59+00' WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL`;
    }
    await query(updateSql, [tenantId, contactId]);
    return this.getContactAiStatus(tenantId, contactId);
  }

  /**
   * Генерирует черновик ответа для контакта.
   */
  async generateContactAiDraft(tenantId: string, contactId: string): Promise<{ draft: string }> {
    const deal = await queryOne<{ id: string }>(
      `SELECT id FROM deals
       WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, contactId],
    );
    if (!deal) {
      return { draft: "Здравствуйте! Чем я могу вам помочь?" };
    }
    return this.generateAiDraft(tenantId, deal.id);
  }

  /**
   * Синхронизирует историю сообщений сделки из внешних подключенных каналов (MAX, Telegram).
   */
  async syncDealChatHistory(tenantId: string, dealId: string): Promise<{ ok: boolean; synced: number }> {
    const dealRows = await query<{
      contact_id: string | null;
      channel: string | null;
    }>(
      `SELECT d.contact_id,
              (SELECT m.channel FROM deal_messages m WHERE m.deal_id = d.id AND m.tenant_id = d.tenant_id ORDER BY m.created_at DESC LIMIT 1) AS channel
       FROM deals d
       WHERE d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`,
      [tenantId, dealId],
    );

    const deal = dealRows[0];
    if (!deal || !deal.contact_id) return { ok: true, synced: 0 };

    let totalSynced = 0;

    // Синхронизация истории диалогов MAX
    const maxAccount = await queryOne<{ id: string }>(
      `SELECT id FROM channel_accounts
       WHERE tenant_id = $1 AND channel = 'max' AND status = 'connected' AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId],
    );

    if (maxAccount) {
      const contact = await queryOne<{
        first_name: string;
        last_name: string;
        phone: string;
        socials?: ContactSocialJson[];
      }>(
        `SELECT first_name, last_name, phone, socials FROM contacts
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, deal.contact_id],
      );

      if (contact) {
        const { syncMaxDialogHistory } = await import("../../channels/max-integration.routes.js");
        const maxSocial = contact.socials?.find((s) => s.kind === "max")?.value;
        const count = await syncMaxDialogHistory({
          tenantId,
          dealId,
          channelAccountId: maxAccount.id,
          peerId: maxSocial || contact.phone,
          peerPhone: contact.phone,
          peerUserId: maxSocial,
          senderName: `${contact.first_name} ${contact.last_name}`.trim(),
        });
        totalSynced += count;
      }
    }

    // Синхронизация истории диалогов Telegram
    const telegramAccount = await queryOne<{ id: string }>(
      `SELECT id FROM channel_accounts
       WHERE tenant_id = $1 AND channel = 'telegram' AND status = 'connected' AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId],
    );

    if (telegramAccount && deal.contact_id) {
      const contact = await queryOne<{
        first_name: string;
        last_name: string;
        phone: string;
        telegram_chat_id?: string | number | null;
        socials?: ContactSocialJson[];
      }>(
        `SELECT first_name, last_name, phone, telegram_chat_id, socials FROM contacts
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, deal.contact_id],
      );

      if (contact) {
        const tgChatId = contact.telegram_chat_id ? String(contact.telegram_chat_id) : null;
        const tgSocial = contact.socials?.find((s) => s.kind === "telegram")?.value?.replace(/^@/, "");
        const cleanPhone = contact.phone ? contact.phone.replace(/\D/g, "") : null;
        const peer = tgChatId || tgSocial || cleanPhone;

        if (peer) {
          const syncer = resolveTelegramHistorySyncer();
          if (syncer) {
            const count = await syncer({
              tenantId,
              dealId,
              channelAccountId: telegramAccount.id,
              peerId: peer,
              username: tgSocial ?? undefined,
              phone: contact.phone ?? undefined,
              limit: 50,
            });
            totalSynced += count;
          }
        }
      }
    }

    return { ok: true, synced: totalSynced };
  }

  /**
   * Синхронизирует историю сообщений контакта из внешних подключенных каналов.
   */
  async syncContactChatHistory(tenantId: string, contactId: string): Promise<{ ok: boolean; synced: number }> {
    const deal = await queryOne<{ id: string }>(
      `SELECT id FROM deals
       WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 1`,
      [tenantId, contactId],
    );

    if (!deal) return { ok: true, synced: 0 };
    return this.syncDealChatHistory(tenantId, deal.id);
  }
}
