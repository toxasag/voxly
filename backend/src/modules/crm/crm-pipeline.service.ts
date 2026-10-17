import { transaction, type TransactionClient } from "../../db/client.js";
import { DealsService } from "./deals/deals.service.js";
import { ContactsService } from "./contacts/contacts.service.js";
import {
  contactChannelFor,
  contactNameFrom,
  contactPhonesFrom,
  contactSocialsFrom,
  displayNameFrom,
  UNKNOWN_CONTACT_NAME,
  type ChannelProfile,
} from "./channel-identity.js";
import { NotFoundError } from "../../plugins/errorHandler.js";

// Профиль объявлен в `channel-identity.ts` вместе с раскладкой по полям, но
// реэкспортируется здесь: транспорт получает его вместе с типом входящего
// сообщения и не должен знать о внутреннем делении модуля CRM.
export type { ChannelProfile } from "./channel-identity.js";

// ---------------------------------------------------------------------------
// CRM operational core (M7.5.18).
//
// Bridges the channel transport (Telegram MTProto, etc.) with the CRM:
//   1. Finds or creates a contact by phone / telegram_chat_id.
//   2. Finds an active open deal for that contact, or creates a new one
//      ("Заявка от {Имя} ({Канал})") in the first stage of the first pipeline.
//   3. Persists every inbound client message and outbound AI/manager reply
//      into deal_messages with channel and sender.
// ---------------------------------------------------------------------------

export interface InboundMessageInput {
  tenantId: string;
  channel: string;
  channelAccountId: string;
  chatId: string;
  text: string;
  senderName: string;
  senderPhone?: string;
  senderTelegramChatId?: string;
  /** Профиль из канала; без него имя контакта станет «Клиент». */
  profile?: ChannelProfile;
}

/** Найденный контакт: ФИО нужно заголовку сделки, когда профиль недоступен. */
interface ExistingContact {
  id: string;
  first_name: string;
  last_name: string;
}

export interface CrmPipelineResult {
  contactId: string;
  dealId: string;
  isNewContact: boolean;
  isNewDeal: boolean;
}

const DEFAULT_STAGES: ReadonlyArray<{
  name: string;
  isWon: boolean;
  isLost: boolean;
  isSystem: boolean;
  color: string;
}> = [
  // Системные этапы: вход янтарный, успех зелёный предпоследним, провал красный последним.
  { name: "Новый лид", isWon: false, isLost: false, isSystem: true, color: "amber" },
  { name: "Квалификация", isWon: false, isLost: false, isSystem: false, color: "sky" },
  { name: "Согласование", isWon: false, isLost: false, isSystem: false, color: "violet" },
  { name: "В работе", isWon: false, isLost: false, isSystem: false, color: "orange" },
  { name: "Успешно реализовано", isWon: true, isLost: false, isSystem: true, color: "emerald" },
  { name: "Закрыто и не реализовано", isWon: false, isLost: true, isSystem: true, color: "rose" },
];

function nullIfBlank(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  return value;
}

export class CrmPipelineService {
  private readonly deals = new DealsService();
  private readonly contacts = new ContactsService();

  /**
   * Processes an incoming message from a channel:
   * - finds or creates contact
   * - finds or creates active deal
   * - saves the inbound message to deal_messages
   */
  async processIncoming(input: InboundMessageInput): Promise<CrmPipelineResult> {
    return transaction(async (tx) => {
      const contact = await this.findContact(tx, input.tenantId, input);
      const isNewContact = contact === null;

      // Имя для заголовка сделки: у известного контакта берётся из его записи, а
      // не из профиля. Профиль мог стать недоступным (клиент закрыл приватность)
      // или не запрашиваться вовсе, и тогда у постоянного клиента появилась бы
      // сделка «Заявка от Клиент» при заполненном ФИО в карточке.
      const displayName =
        contact === null ? displayNameFrom(input) : this.contactDisplayName(contact);

      let contactId: string;
      if (contact !== null) {
        contactId = contact.id;
      } else {
        // Компания не подставляется заглушкой «Не указана»: у входящего лида её
        // ещё нет, а строка-заглушка создавала бы фиктивную организацию.
        contactId = await this.contacts.createInTx(tx, input.tenantId, {
          ...contactNameFrom(input),
          phones: contactPhonesFrom(input),
          socials: contactSocialsFrom(input),
          telegram_chat_id: input.senderTelegramChatId ?? undefined,
          channel: contactChannelFor(input.channel),
          notes: `Автоматически создан из ${this.channelLabel(input.channel)}`,
          custom_fields: {},
        });
      }

      const activeDeal = await this.findActiveDeal(tx, input.tenantId, contactId);

      let dealId: string;
      let isNewDeal = false;

      if (activeDeal !== null) {
        dealId = activeDeal.id;
      } else {
        const isSuppressed = await this.shouldSuppressDeal(tx, input.tenantId, contactId);
        const lastDeal = isSuppressed ? await this.findLastDeal(tx, input.tenantId, contactId) : null;

        if (isSuppressed && lastDeal !== null) {
          dealId = lastDeal.id;
          isNewDeal = false;
        } else {
          let pipelineId = await this.getFirstPipelineId(tx, input.tenantId);

          if (pipelineId === null) {
            pipelineId = await this.seedDefaultPipeline(tx, input.tenantId);
          }

          const stage = await tx.queryOne<{ id: string }>(
            `SELECT id FROM stages WHERE pipeline_id = $1 ORDER BY sort_order ASC LIMIT 1`,
            [pipelineId],
          );

          if (stage === null) {
            throw new NotFoundError("No stage found for pipeline");
          }

          const createdBy = await this.findFallbackUserId(tx, input.tenantId);

          const deal = await this.deals.createInTx(tx, input.tenantId, createdBy, {
            title: `Заявка от ${displayName} (${this.channelLabel(input.channel)})`,
            description: input.text.slice(0, 500),
            budget: 0,
            currency: "RUB",
            pipeline_id: pipelineId,
            stage_id: stage.id,
            // Связь обязательна, а не для полноты карточки: `findActiveDeal`
            // ищет открытую сделку по `contact_id`, поэтому сделка без него
            // не находится, и каждое следующее сообщение клиента создавало
            // новую — канал плодил дубли.
            contact_id: contactId,
            custom_fields: {},
          });

          dealId = deal.id;
          isNewDeal = true;
        }
      }

      await tx.query(
        `INSERT INTO deal_messages
           (tenant_id, deal_id, channel_account_id, source, direction, sender_name, content, channel)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          input.tenantId,
          dealId,
          nullIfBlank(input.channelAccountId),
          "client",
          "inbound",
          input.senderName,
          input.text,
          input.channel,
        ],
      );

      return { contactId, dealId, isNewContact, isNewDeal };
    });
  }

  /**
   * Saves AI agent reply messages to the deal timeline.
   */
  async saveAgentReply(input: {
    tenantId: string;
    dealId: string;
    reply: { messages: string[] };
    channel: string;
    channelAccountId: string;
  }): Promise<void> {
    for (const message of input.reply.messages) {
      await this.deals.createMessage(input.tenantId, input.dealId, "AI Agent", {
        source: "ai",
        direction: "outbound",
        content: message,
        channel: input.channel,
        channel_account_id: input.channelAccountId,
      });
    }
  }

  /**
   * Saves a manager reply to the deal timeline.
   */
  async saveManagerReply(input: {
    tenantId: string;
    dealId: string;
    content: string;
    channel: string;
    channelAccountId: string;
    senderName: string;
  }): Promise<void> {
    await this.deals.createMessage(input.tenantId, input.dealId, input.senderName, {
      source: "manager",
      direction: "outbound",
      content: input.content,
      channel: input.channel,
      channel_account_id: input.channelAccountId,
    });
  }

  /** То же для уже существующего контакта — из его записи, а не из профиля. */
  private contactDisplayName(contact: ExistingContact): string {
    const full = `${contact.first_name} ${contact.last_name}`.trim();
    return full === "" ? UNKNOWN_CONTACT_NAME : full;
  }

  private async findContact(
    tx: TransactionClient,
    tenantId: string,
    input: InboundMessageInput,
  ): Promise<ExistingContact | null> {
    if (input.senderTelegramChatId !== undefined && input.senderTelegramChatId.length > 0) {
      const byChatId = await tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name FROM contacts
         WHERE tenant_id = $1 AND telegram_chat_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [tenantId, Number(input.senderTelegramChatId)],
      );
      if (byChatId !== null) return byChatId;
    }

    if (input.senderPhone !== undefined && input.senderPhone.length > 0) {
      const byPhone = await this.findContactByPhone(tx, tenantId, input.senderPhone);
      if (byPhone !== null) return byPhone;
    }

    const byChatIdAsPhone = await this.findContactByPhone(tx, tenantId, input.chatId);
    if (byChatIdAsPhone !== null) return byChatIdAsPhone;

    return null;
  }

  /**
   * Поиск по любому номеру контакта, а не только по основному.
   *
   * Клиент звонит со второго номера так же часто, как с первого. Проверка
   * основной колонки и JSONB-массива дополнительных: у второго индекс GIN
   * (idx_contacts_additional_phones), поэтому запрос не читает таблицу целиком.
   */
  private async findContactByPhone(
    tx: TransactionClient,
    tenantId: string,
    phone: string,
  ): Promise<ExistingContact | null> {
    return tx.queryOne<ExistingContact>(
      `SELECT id, first_name, last_name FROM contacts
       WHERE tenant_id = $1
         AND deleted_at IS NULL
         AND (phone = $2 OR additional_phones @> $3::jsonb)
       LIMIT 1`,
      [tenantId, phone, JSON.stringify([{ number: phone }])],
    );
  }

  private async findActiveDeal(
    tx: TransactionClient,
    tenantId: string,
    contactId: string,
  ): Promise<{ id: string } | null> {
    const row = await tx.queryOne<{ id: string }>(
      `SELECT d.id FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1
         AND d.contact_id = $2
         AND d.deleted_at IS NULL
         AND s.is_won = false
         AND s.is_lost = false
       ORDER BY d.created_at DESC
       LIMIT 1`,
      [tenantId, contactId],
    );
    return row;
  }

  /**
   * Проверяет, включено ли подавление создания сделок для контакта.
   */
  private async shouldSuppressDeal(
    tx: TransactionClient,
    tenantId: string,
    contactId: string,
  ): Promise<boolean> {
    const row = await tx.queryOne<{ suppress_deal_creation: boolean }>(
      `SELECT suppress_deal_creation FROM contacts
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, contactId],
    );
    return row?.suppress_deal_creation ?? false;
  }

  /**
   * Ищет последнюю сделку контакта (включая завершённые), чтобы привязать сообщение
   * без создания новой сделки-спама при активном suppress_deal_creation.
   */
  private async findLastDeal(
    tx: TransactionClient,
    tenantId: string,
    contactId: string,
  ): Promise<{ id: string } | null> {
    const row = await tx.queryOne<{ id: string }>(
      `SELECT id FROM deals
       WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenantId, contactId],
    );
    return row;
  }

  private async getFirstPipelineId(
    tx: TransactionClient,
    tenantId: string,
  ): Promise<string | null> {
    const row = await tx.queryOne<{ id: string }>(
      `SELECT id FROM pipelines WHERE tenant_id = $1 ORDER BY sort_order ASC, created_at ASC LIMIT 1`,
      [tenantId],
    );
    return row?.id ?? null;
  }

  private async seedDefaultPipeline(
    tx: TransactionClient,
    tenantId: string,
  ): Promise<string> {
    const pipeline = await tx.queryOneOrThrow<{ id: string }>(
      `INSERT INTO pipelines (tenant_id, name, sort_order) VALUES ($1, $2, 0) RETURNING id`,
      [tenantId, "Основная"],
    );

    for (let index = 0; index < DEFAULT_STAGES.length; index++) {
      const stage = DEFAULT_STAGES[index];
      if (stage === undefined) continue;
      await tx.query(
        `INSERT INTO stages (pipeline_id, name, sort_order, is_won, is_lost, is_system, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [pipeline.id, stage.name, index, stage.isWon, stage.isLost, stage.isSystem, stage.color],
      );
    }

    return pipeline.id;
  }

  private async findFallbackUserId(tx: TransactionClient, tenantId: string): Promise<string> {
    const row = await tx.queryOne<{ id: string }>(
      `SELECT id FROM users WHERE tenant_id = $1 AND deleted_at IS NULL AND activated_at IS NOT NULL ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    );

    if (row === null) {
      throw new NotFoundError("No active user found in tenant to assign as deal creator");
    }

    return row.id;
  }

  private channelLabel(channel: string): string {
    const labels: Record<string, string> = {
      telegram: "Telegram",
      whatsapp: "WhatsApp",
      max: "MAX",
      avito: "Avito",
      instagram: "Instagram",
      phone: "Телефон",
      email: "Email",
    };
    return labels[channel] ?? channel;
  }
}
