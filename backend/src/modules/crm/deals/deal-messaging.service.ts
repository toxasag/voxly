import { query } from "../../../db/client.js";
import { DealsService } from "./deals.service.js";
import {
  resolveOutboundSender,
  type OutboundSendResult,
} from "../../channels/outbound-registry.js";
import type { CreateDealMessagePayload, DealMessageDTO } from "./deals.types.js";

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
}

interface Logger {
  warn: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

export class DealMessagingService {
  constructor(
    private readonly deals: DealsService = new DealsService(),
    private readonly log: Logger | null = null,
  ) {}

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

    try {
      return await sender({
        tenantId,
        channelAccountId: route.channelAccountId,
        recipient: route.recipient,
        text: payload.content,
      });
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
         c.phone
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

    const channelAccountId =
      payload.channel_account_id !== undefined && payload.channel_account_id.length > 0
        ? payload.channel_account_id
        : row.channel_account_id;

    if (channelAccountId === null || channelAccountId.length === 0) return null;

    const recipient = this.recipientFor(payload.channel, row);
    if (recipient === null) return null;

    return { channelAccountId, recipient };
  }

  /** Адрес получателя зависит от канала: у Telegram это numeric id, не username. */
  private recipientFor(
    channel: string,
    contact: {
      telegram_chat_id: string | null;
      telegram_username: string | null;
      whatsapp: string | null;
      phone: string;
    },
  ): string | null {
    if (channel === "telegram") {
      // Числовой id, а не username: транспорт обращается к peer по нему, и
      // username мог измениться после первого сообщения.
      return contact.telegram_chat_id ?? contact.telegram_username ?? null;
    }

    if (channel === "whatsapp") {
      const value = contact.whatsapp ?? contact.phone;
      return value.length > 0 ? value : null;
    }

    return contact.phone.length > 0 ? contact.phone : null;
  }
}
