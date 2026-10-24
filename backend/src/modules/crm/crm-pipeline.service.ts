import { query, transaction, type TransactionClient } from "../../db/client.js";
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
import { CrmEnrichmentService } from "./enrichment.service.js";
import { MaxBridgeService } from "../channels/max-bridge.service.js";

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
  attachment?: string | null;
  attachmentType?: string | null;
  /** Профиль из канала; без него имя контакта станет «Клиент». */
  profile?: ChannelProfile;
  /** Идентификатор и аналитика посетителя сайта */
  visitorId?: string;
  deviceFingerprint?: string;
  deviceInfo?: Record<string, unknown>;
  yandexuid?: string;
  tmrLvid?: string;
  clickIds?: Record<string, string>;
  referrer?: string;
  ymUid?: string;
  gaId?: string;
  fbId?: string;
  pageUrl?: string;
  pageHistory?: Array<{ step: number; time: string; url: string }>;
  visitCount?: number;
  utmTags?: Record<string, string>;
}

/** Найденный контакт: ФИО нужно заголовку сделки, когда профиль недоступен. */
interface ExistingContact {
  id: string;
  first_name: string;
  last_name: string;
  phone?: string | null;
  telegram_chat_id?: string | number | null;
  telegram_username?: string | null;
  whatsapp?: string | null;
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
  // Системные этапы: нулевой этап серый для входящих диалогов без контактов, новый лид янтарный, успех зелёный, провал красный.
  { name: "Первый контакт", isWon: false, isLost: false, isSystem: true, color: "slate" },
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
    const result = await transaction(async (tx) => {
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

        // Обогащение существующего контакта (enrichment):
        // 1. Привязываем telegram_chat_id, если его ещё не было
        if (input.senderTelegramChatId && !contact.telegram_chat_id) {
          await tx.query(
            `UPDATE contacts SET telegram_chat_id = $1 WHERE id = $2 AND telegram_chat_id IS NULL`,
            [Number(input.senderTelegramChatId), contact.id],
          );
        }

        // 1.1. Привязываем телефон, если он появился
        if (input.senderPhone && (!contact.phone || contact.phone.trim().length === 0)) {
          await tx.query(
            `UPDATE contacts SET phone = $1 WHERE id = $2 AND (phone IS NULL OR phone = '')`,
            [input.senderPhone, contact.id],
          );
          contact.phone = input.senderPhone;
        }

        // 1.5. Привязываем max_chat_id для MAX, если его ещё не было
        if (input.channel === "max" && input.chatId) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(
               COALESCE(custom_fields, '{}'::jsonb),
               '{max_chat_id}',
               to_jsonb($1::text),
               true
             )
             WHERE id = $2 AND tenant_id = $3
               AND (custom_fields->>'max_chat_id' IS NULL OR custom_fields->>'max_chat_id' = '')`,
            [input.chatId, contact.id, input.tenantId],
          );
        }

        // 1.6. Обогащаем данными посетителя сайта (webchat_visitor_id, ym_uid, ga_id, fb_id, utm, page)
        const siteVisitorId = input.visitorId || (input.channel === "webchat" ? input.chatId : undefined) || (input.text ? input.text.match(/site_([a-zA-Z0-9_-]+)/)?.[1] : undefined);
        if (siteVisitorId) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(
               jsonb_set(
                 COALESCE(custom_fields, '{}'::jsonb),
                 '{webchat_visitor_id}',
                 to_jsonb($1::text),
                 true
               ),
               '{visitor_ids}',
               CASE 
                 WHEN jsonb_typeof(COALESCE(custom_fields->'visitor_ids', '[]'::jsonb)) = 'array'
                 THEN (COALESCE(custom_fields->'visitor_ids', '[]'::jsonb) || to_jsonb($1::text))
                 ELSE jsonb_build_array($1::text)
               END,
               true
             )
             WHERE id = $2 AND tenant_id = $3`,
            [siteVisitorId, contact.id, input.tenantId],
          );
        }

        if (input.deviceFingerprint) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{device_fingerprint}', to_jsonb($1::text), true)
             WHERE id = $2 AND tenant_id = $3`,
            [input.deviceFingerprint, contact.id, input.tenantId],
          );
        }
        if (input.deviceInfo && Object.keys(input.deviceInfo).length > 0) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{device_info}', $1::jsonb, true)
             WHERE id = $2 AND tenant_id = $3`,
            [JSON.stringify(input.deviceInfo), contact.id, input.tenantId],
          );
        }
        if (input.yandexuid) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{yandexuid}', to_jsonb($1::text), true)
             WHERE id = $2 AND tenant_id = $3`,
            [input.yandexuid, contact.id, input.tenantId],
          );
        }
        if (input.tmrLvid) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{tmr_lvid}', to_jsonb($1::text), true)
             WHERE id = $2 AND tenant_id = $3`,
            [input.tmrLvid, contact.id, input.tenantId],
          );
        }
        if (input.clickIds && Object.keys(input.clickIds).length > 0) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{click_ids}', $1::jsonb, true)
             WHERE id = $2 AND tenant_id = $3`,
            [JSON.stringify(input.clickIds), contact.id, input.tenantId],
          );
        }
        if (input.referrer) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{referrer}', to_jsonb($1::text), true)
             WHERE id = $2 AND tenant_id = $3`,
            [input.referrer, contact.id, input.tenantId],
          );
        }
        if (input.ymUid) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{ym_uid}', to_jsonb($1::text), true)
             WHERE id = $2 AND tenant_id = $3 AND (custom_fields->>'ym_uid' IS NULL OR custom_fields->>'ym_uid' = '')`,
            [input.ymUid, contact.id, input.tenantId],
          );
        }
        if (input.gaId) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{ga_id}', to_jsonb($1::text), true)
             WHERE id = $2 AND tenant_id = $3 AND (custom_fields->>'ga_id' IS NULL OR custom_fields->>'ga_id' = '')`,
            [input.gaId, contact.id, input.tenantId],
          );
        }
        if (input.fbId) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{fb_id}', to_jsonb($1::text), true)
             WHERE id = $2 AND tenant_id = $3 AND (custom_fields->>'fb_id' IS NULL OR custom_fields->>'fb_id' = '')`,
            [input.fbId, contact.id, input.tenantId],
          );
        }
        if (input.utmTags && Object.keys(input.utmTags).length > 0) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{utm_tags}', $1::jsonb, true)
             WHERE id = $2 AND tenant_id = $3`,
            [JSON.stringify(input.utmTags), contact.id, input.tenantId],
          );
        }
        if (input.pageUrl) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{last_page_url}', to_jsonb($1::text), true)
             WHERE id = $2 AND tenant_id = $3`,
            [input.pageUrl, contact.id, input.tenantId],
          );
        }
        if (input.visitCount) {
          await tx.query(
            `UPDATE contacts
             SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{visit_count}', to_jsonb($1::int), true)
             WHERE id = $2 AND tenant_id = $3`,
            [input.visitCount, contact.id, input.tenantId],
          );
        }

        // 2. Если имя контакта было заглушкой «Клиент», а в профиле пришло нормальное имя — обновляем
        const newName = contactNameFrom(input);
        if (contact.first_name === UNKNOWN_CONTACT_NAME && newName.first_name !== UNKNOWN_CONTACT_NAME) {
          await tx.query(
            `UPDATE contacts SET first_name = $1, last_name = $2 WHERE id = $3`,
            [newName.first_name, newName.last_name, contact.id],
          );
          contact.first_name = newName.first_name;
          contact.last_name = newName.last_name;
        }
      } else {
        const customFields: Record<string, unknown> = {};
        if (input.channel === "max" && input.chatId) {
          customFields.max_chat_id = input.chatId;
        }
        const siteVisitorId = input.visitorId || (input.channel === "webchat" ? input.chatId : undefined) || (input.text ? input.text.match(/site_([a-zA-Z0-9_-]+)/)?.[1] : undefined);
        if (siteVisitorId) {
          customFields.webchat_visitor_id = siteVisitorId;
          customFields.visitor_ids = [siteVisitorId];
        }
        if (input.deviceFingerprint) customFields.device_fingerprint = input.deviceFingerprint;
        if (input.deviceInfo) customFields.device_info = input.deviceInfo;
        if (input.yandexuid) customFields.yandexuid = input.yandexuid;
        if (input.tmrLvid) customFields.tmr_lvid = input.tmrLvid;
        if (input.clickIds) customFields.click_ids = input.clickIds;
        if (input.referrer) customFields.referrer = input.referrer;
        if (input.ymUid) customFields.ym_uid = input.ymUid;
        if (input.gaId) customFields.ga_id = input.gaId;
        if (input.fbId) customFields.fb_id = input.fbId;
        if (input.utmTags) customFields.utm_tags = input.utmTags;
        if (input.pageUrl) customFields.page_url = input.pageUrl;
        if (input.visitCount) customFields.visit_count = input.visitCount;
        if (input.pageHistory) customFields.page_history = input.pageHistory;

        // Компания не подставляется заглушкой «Не указана»: у входящего лида её
        // ещё нет, а строка-заглушка создавала бы фиктивную организацию.
        contactId = await this.contacts.createInTx(tx, input.tenantId, {
          ...contactNameFrom(input),
          phones: contactPhonesFrom(input),
          socials: contactSocialsFrom(input),
          telegram_chat_id: input.senderTelegramChatId ?? undefined,
          channel: contactChannelFor(input.channel),
          notes: `Автоматически создан из ${this.channelLabel(input.channel)}`,
          custom_fields: customFields,
        });
      }

      const activeDeal = await this.findActiveDeal(tx, input.tenantId, contactId);

      let dealId: string;
      let isNewDeal = false;

      const siteVisitorId = input.visitorId || (input.channel === "webchat" ? input.chatId : undefined) || (input.text ? input.text.match(/site_([a-zA-Z0-9_-]+)/)?.[1] : undefined);
      const dealCustomFields: Record<string, unknown> = {};
      if (siteVisitorId) dealCustomFields.webchat_visitor_id = siteVisitorId;
      if (input.deviceFingerprint) dealCustomFields.device_fingerprint = input.deviceFingerprint;
      if (input.deviceInfo) dealCustomFields.device_info = input.deviceInfo;
      if (input.yandexuid) dealCustomFields.yandexuid = input.yandexuid;
      if (input.ymUid) dealCustomFields.ym_uid = input.ymUid;
      if (input.gaId) dealCustomFields.ga_id = input.gaId;
      if (input.fbId) dealCustomFields.fb_id = input.fbId;
      if (input.tmrLvid) dealCustomFields.tmr_lvid = input.tmrLvid;
      if (input.utmTags) dealCustomFields.utm_tags = input.utmTags;
      if (input.clickIds) dealCustomFields.click_ids = input.clickIds;
      if (input.pageUrl) dealCustomFields.page_url = input.pageUrl;
      if (input.referrer) dealCustomFields.referrer = input.referrer;
      if (input.visitCount) dealCustomFields.visit_count = input.visitCount;
      if (input.pageHistory) dealCustomFields.page_history = input.pageHistory;

      if (activeDeal !== null) {
        dealId = activeDeal.id;

        if (Object.keys(dealCustomFields).length > 0) {
          await tx.query(
            `UPDATE deals
             SET custom_fields = COALESCE(custom_fields, '{}'::jsonb) || $1::jsonb,
                 updated_at = now()
             WHERE id = $2 AND tenant_id = $3`,
            [JSON.stringify(dealCustomFields), activeDeal.id, input.tenantId],
          );
        }

        // Эскалация «Первый контакт» -> «Новый лид», если у контакта появились контактные данные
        const hasRealContact = Boolean(
          input.senderPhone ||
          (contact && contact.phone && contact.phone.trim().length > 0) ||
          (contact && contact.telegram_chat_id) ||
          input.senderTelegramChatId ||
          (input.channel !== "webchat")
        );

        if (hasRealContact) {
          const currentStage = await tx.queryOne<{ id: string; name: string }>(
            `SELECT s.id, s.name FROM stages s
             JOIN deals d ON d.stage_id = s.id
             WHERE d.id = $1 AND d.tenant_id = $2`,
            [activeDeal.id, input.tenantId],
          );

          if (currentStage && currentStage.name === "Первый контакт") {
            const newLeadStage = await tx.queryOne<{ id: string }>(
              `SELECT id FROM stages
               WHERE pipeline_id = (SELECT pipeline_id FROM deals WHERE id = $1)
                 AND name = 'Новый лид'
               LIMIT 1`,
              [activeDeal.id],
            );

            if (newLeadStage) {
              await tx.query(
                `UPDATE deals SET stage_id = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3`,
                [newLeadStage.id, activeDeal.id, input.tenantId],
              );

              const contactIdentifier =
                input.senderPhone ||
                (contact && contact.phone) ||
                (input.channel === "telegram" ? "Telegram" : input.channel === "whatsapp" ? "WhatsApp" : input.channel === "max" ? "MAX" : "мессенджер");

              await this.deals.createMessage(
                input.tenantId,
                activeDeal.id,
                "Система",
                {
                  source: "system",
                  direction: "neutral",
                  content: `Получены контактные данные клиента (${contactIdentifier}). Сделка автоматически переведена из этапа «Первый контакт» в «Новый лид».`,
                  channel: input.channel,
                  channel_account_id: input.channelAccountId,
                },
                "neutral",
              );
            }
          }
        }
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

          // Анонимный веб-чат без контактов идёт в «Первый контакт»,
          // заявки с подтвержденными контактами (мессенджеры, телефон) — в «Новый лид»
          const isAnonymousWebchat =
            input.channel === "webchat" &&
            !input.senderPhone &&
            (!contact || !contact.phone || contact.phone.trim().length === 0);

          const targetStageName = isAnonymousWebchat ? "Первый контакт" : "Новый лид";

          let stage = await tx.queryOne<{ id: string }>(
            `SELECT id FROM stages
             WHERE pipeline_id = $1 AND name = $2
             LIMIT 1`,
            [pipelineId, targetStageName],
          );

          // Fallback, если этап не найден
          if (!stage) {
            stage = await tx.queryOne<{ id: string }>(
              `SELECT id FROM stages
               WHERE pipeline_id = $1 AND is_won = false AND is_lost = false
               ORDER BY sort_order ASC
               LIMIT 1`,
              [pipelineId],
            );
          }

          if (stage === null) {
            throw new NotFoundError("No stage found for pipeline");
          }

          const createdBy = await this.findFallbackUserId(tx, input.tenantId);

          const deal = await this.deals.createInTx(tx, input.tenantId, createdBy, {
            title: `Заявка от ${displayName} (${this.channelLabel(input.channel)})`,
            description: "",
            budget: 0,
            currency: "RUB",
            pipeline_id: pipelineId,
            stage_id: stage.id,
            // Связь обязательна, а не для полноты карточки: `findActiveDeal`
            // ищет открытую сделку по `contact_id`, поэтому сделка без него
            // не находится, и каждое следующее сообщение клиента создавало
            // новую — канал плодил дубли.
            contact_id: contactId,
            custom_fields: dealCustomFields,
          });

          dealId = deal.id;
          isNewDeal = true;
        }
      }

      // Защита от дублирования сообщений при параллельной доставке вебхуков
      const existingMsg = await tx.queryOne<{ id: string }>(
        `SELECT id FROM deal_messages
         WHERE tenant_id = $1 AND deal_id = $2
           AND direction = 'inbound' AND content = $3 AND channel = $4
           AND created_at > now() - interval '15 seconds'
         LIMIT 1`,
        [input.tenantId, dealId, input.text, input.channel],
      );

      if (!existingMsg) {
        await tx.query(
          `INSERT INTO deal_messages
             (tenant_id, deal_id, channel_account_id, source, direction, sender_name, content, channel, attachment, attachment_type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            input.tenantId,
            dealId,
            nullIfBlank(input.channelAccountId),
            "client",
            "inbound",
            input.senderName,
            input.text,
            input.channel,
            input.attachment ?? null,
            input.attachmentType ?? null,
          ],
        );
      }

      // Обновляем таймстамп активности сделки для поднятия в канбане/списке
      await tx.query(
        `UPDATE deals SET updated_at = now() WHERE id = $1 AND tenant_id = $2`,
        [dealId, input.tenantId],
      );

      return { contactId, dealId, isNewContact, isNewDeal };
    });

    // Автоматическое кросс-канальное обогащение контакта по номеру телефона (Never invent)
    const phoneCandidates = [input.senderPhone, contactPhonesFrom(input)[0]?.number];
    const validPhone = phoneCandidates.find((p) => p && p.replace(/\D/g, "").length >= 10);
    if (validPhone) {
      const enrichService = new CrmEnrichmentService();
      void enrichService
        .enrichContact(input.tenantId, result.contactId, {
          phoneOverride: validPhone,
          channels: ["telegram", "max", "whatsapp"],
        })
        .catch(() => {
          // Ошибки провайдеров не влияют на создание сделки
        });
    }

    return result;
  }

  /**
   * Saves AI agent reply messages to the deal timeline and sets pause if requested.
   */
  async saveAgentReply(input: {
    tenantId: string;
    dealId: string;
    reply: { messages: string[]; handoff_required?: boolean; session_pause?: boolean };
    channel: string;
    channelAccountId: string;
    senderName?: string;
  }): Promise<void> {
    for (const message of input.reply.messages) {
      await this.deals.createMessage(
        input.tenantId,
        input.dealId,
        input.senderName ?? "AI-ассистент",
        {
          source: "ai",
          direction: "outbound",
          content: message,
          channel: input.channel,
          channel_account_id: input.channelAccountId,
        },
        "sent",
      );
    }

    // Если запрошена пауза сессии (троллинг / спам) — замораживаем бота на 60 минут
    if (input.reply.session_pause) {
      await query(
        `UPDATE deals
         SET ai_paused_until = now() + INTERVAL '60 minutes'
         WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.dealId],
      );
    } else if (input.reply.handoff_required) {
      // При эскалации на человека замораживаем бота на 24 часа для работы оператора
      await query(
        `UPDATE deals
         SET ai_paused_until = now() + INTERVAL '24 hours'
         WHERE tenant_id = $1 AND id = $2`,
        [input.tenantId, input.dealId],
      );
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

  /**
   * M5.3: Обработка исходящего сообщения оператора из нативного мессенджера (fromMe).
   * Сохраняет сообщение в таймлайне как sender: 'manager', direction: 'outbound'
   * и активирует AI Handoff на 30 минут (пауза бота).
   */
  async processNativeOutbound(input: {
    tenantId: string;
    channel: string;
    channelAccountId: string;
    chatId: string;
    text: string;
    senderName?: string;
    senderPhone?: string | null;
    peerUserId?: string | null;
    username?: string | null;
    pauseMinutes?: number;
    attachment?: string | null;
    attachmentType?: string | null;
  }): Promise<{ dealId: string | null; messageId: string | null; pausedUntil: string | null }> {
    return transaction(async (tx) => {
      let contact = await this.findContact(tx, input.tenantId, {
        tenantId: input.tenantId,
        channel: input.channel,
        channelAccountId: input.channelAccountId,
        chatId: input.chatId,
        text: input.text,
        senderName: input.senderName ?? "Менеджер",
        senderPhone: input.senderPhone ?? undefined,
        senderTelegramChatId: input.channel === "telegram" ? input.chatId : undefined,
        profile: {
          username: input.username ?? undefined,
          phone: input.senderPhone ?? undefined,
        },
      });

      // Специфичный поиск контакта для MAX: по custom_fields (max_chat_id, max_user_id) и по socials
      if (!contact && input.channel === "max") {
        contact = await tx.queryOne<ExistingContact>(
          `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
           WHERE tenant_id = $1 AND deleted_at IS NULL
             AND (
               custom_fields->>'max_chat_id' = $2
               OR ($3::text IS NOT NULL AND custom_fields->>'max_user_id' = $3)
               OR socials @> $4::jsonb
               OR ($3::text IS NOT NULL AND socials @> $5::jsonb)
             )
           LIMIT 1`,
          [
            input.tenantId,
            input.chatId,
            input.peerUserId ?? null,
            JSON.stringify([{ kind: "max", value: input.chatId }]),
            JSON.stringify([{ kind: "max", value: input.peerUserId ?? "" }]),
          ],
        );
      }

      // Fallback через bridge для MAX: если телефон не пришел в вебхуке, берем его из диалогов моста
      if (!contact && input.channel === "max" && input.channelAccountId) {
        try {
          const bridge = new MaxBridgeService();
          const dialogsResp = await bridge.getPrivateDialogs({
            botId: input.channelAccountId,
            dialogLimit: 30,
            messageLimit: 1,
          });
          if (dialogsResp.ok && Array.isArray(dialogsResp.dialogs)) {
            const foundDialog = dialogsResp.dialogs.find(
              (d) => d.chatId === input.chatId || (input.peerUserId && d.userId === input.peerUserId),
            );
            if (foundDialog?.phone) {
              contact = await this.findContactByPhone(tx, input.tenantId, foundDialog.phone);
              if (contact) {
                await tx.query(
                  `UPDATE contacts
                   SET custom_fields = jsonb_set(
                     jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{max_chat_id}', to_jsonb($1::text), true),
                     '{max_user_id}', to_jsonb($2::text), true
                   )
                   WHERE id = $3 AND tenant_id = $4`,
                  [input.chatId, foundDialog.userId || input.peerUserId || "", contact.id, input.tenantId],
                );
              }
            }
          }
        } catch {
          // best-effort lookup
        }
      }

      if (contact === null) {
        return { dealId: null, messageId: null, pausedUntil: null };
      }

      // Привязываем max_chat_id к контакту, если его еще не было
      if (input.channel === "max" && input.chatId) {
        await tx.query(
          `UPDATE contacts
           SET custom_fields = jsonb_set(
             COALESCE(custom_fields, '{}'::jsonb),
             '{max_chat_id}',
             to_jsonb($1::text),
             true
           )
           WHERE id = $2 AND tenant_id = $3
             AND (custom_fields->>'max_chat_id' IS NULL OR custom_fields->>'max_chat_id' = '')`,
          [input.chatId, contact.id, input.tenantId],
        );
      }

      const activeDeal =
        (await this.findActiveDeal(tx, input.tenantId, contact.id)) ??
        (await this.findLastDeal(tx, input.tenantId, contact.id));

      if (activeDeal === null) {
        return { dealId: null, messageId: null, pausedUntil: null };
      }

      // Дедупликация исходящих сообщений в пределах 20 секунд (исключает дублирование при отправке из веб-CRM)
      const existingOutbound = await tx.queryOne<{ id: string }>(
        `SELECT id FROM deal_messages
         WHERE tenant_id = $1 AND deal_id = $2
           AND direction = 'outbound'
           AND content = $3
           AND channel = $4
           AND created_at >= now() - interval '20 seconds'
         ORDER BY created_at DESC LIMIT 1`,
        [input.tenantId, activeDeal.id, input.text, input.channel],
      );

      if (existingOutbound) {
        return {
          dealId: activeDeal.id,
          messageId: existingOutbound.id,
          pausedUntil: null,
        };
      }

      const pauseMins = input.pauseMinutes ?? 30;
      const pauseRes = await tx.queryOne<{ paused_until: string }>(
        `UPDATE deals
         SET ai_paused_until = now() + ($1 || ' minutes')::interval,
             updated_at = now()
         WHERE id = $2 AND tenant_id = $3
         RETURNING ai_paused_until::text AS paused_until`,
        [pauseMins.toString(), activeDeal.id, input.tenantId],
      );

      const msgRes = await tx.queryOne<{ id: string }>(
        `INSERT INTO deal_messages
           (tenant_id, deal_id, channel_account_id, source, direction, sender_name, content, channel, delivery_status, attachment, attachment_type)
         VALUES ($1, $2, $3, 'manager', 'outbound', $4, $5, $6, 'sent', $7, $8)
         RETURNING id`,
        [
          input.tenantId,
          activeDeal.id,
          nullIfBlank(input.channelAccountId),
          input.senderName ?? "Менеджер",
          input.text,
          input.channel,
          input.attachment ?? null,
          input.attachmentType ?? null,
        ],
      );

      return {
        dealId: activeDeal.id,
        messageId: msgRes?.id ?? null,
        pausedUntil: pauseRes?.paused_until ?? null,
      };
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
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1 AND telegram_chat_id = $2 AND deleted_at IS NULL LIMIT 1`,
        [tenantId, Number(input.senderTelegramChatId)],
      );
      if (byChatId !== null) return byChatId;
    }

    // Дедупликация по telegram_username и соцсетям
    if (input.profile?.username !== undefined && input.profile.username.length > 0) {
      const clean = input.profile.username.replace(/^@/, "").trim();
      const byUsername = await tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND (
             telegram_username ILIKE $2
             OR socials @> $3::jsonb
             OR socials @> $4::jsonb
           )
         LIMIT 1`,
        [tenantId, clean, JSON.stringify([{ value: `@${clean}` }]), JSON.stringify([{ value: clean }])],
      );
      if (byUsername !== null) return byUsername;
    }

    if (input.senderPhone !== undefined && input.senderPhone.length > 0) {
      const byPhone = await this.findContactByPhone(tx, tenantId, input.senderPhone);
      if (byPhone !== null) return byPhone;
    }

    // Идентификатор чата проверяется как номер телефона только для WhatsApp (где chatId — реальный номер)
    if (input.channel === "whatsapp" || input.chatId.startsWith("+")) {
      const byChatIdAsPhone = await this.findContactByPhone(tx, tenantId, input.chatId);
      if (byChatIdAsPhone !== null) return byChatIdAsPhone;
    }

    // Идентификация посетителя веб-чата и связывание сессий при переходе в Telegram/WhatsApp
    let siteVisitorIdFromText: string | undefined;
    if (input.text) {
      const match = input.text.match(/site_([a-zA-Z0-9_-]+)/);
      if (match) {
        siteVisitorIdFromText = match[1];
      }
    }

    const effectiveVisitorId =
      input.visitorId ||
      (input.channel === "webchat" ? input.chatId : undefined) ||
      siteVisitorIdFromText;

    if (effectiveVisitorId !== undefined && effectiveVisitorId.length > 0) {
      const byVisitorId = await tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND (
             custom_fields->>'webchat_visitor_id' = $2
             OR (jsonb_typeof(custom_fields->'visitor_ids') = 'array' AND custom_fields->'visitor_ids' @> $4::jsonb)
             OR socials @> $3::jsonb
           )
         LIMIT 1`,
        [tenantId, effectiveVisitorId, JSON.stringify([{ kind: "other", value: effectiveVisitorId }]), JSON.stringify([effectiveVisitorId])],
      );
      if (byVisitorId !== null) return byVisitorId;
    }

    // Поиск по Яндекс ID (yandexuid — общая авторизационная кука сервисов Яндекса)
    if (input.yandexuid !== undefined && input.yandexuid.length > 0) {
      const byYandex = await tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND (
             custom_fields->>'yandexuid' = $2
             OR custom_fields->'analytics'->>'yandexuid' = $2
           )
         LIMIT 1`,
        [tenantId, input.yandexuid],
      );
      if (byYandex !== null) return byYandex;
    }

    // Поиск по сквозным идентификаторам веб-аналитики (Яндекс.Метрика, GA4, Meta, Top.Mail.ru)
    if (input.ymUid !== undefined && input.ymUid.length > 0) {
      const byYm = await tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND custom_fields->>'ym_uid' = $2
         LIMIT 1`,
        [tenantId, input.ymUid],
      );
      if (byYm !== null) return byYm;
    }

    if (input.gaId !== undefined && input.gaId.length > 0) {
      const byGa = await tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND custom_fields->>'ga_id' = $2
         LIMIT 1`,
        [tenantId, input.gaId],
      );
      if (byGa !== null) return byGa;
    }

    if (input.fbId !== undefined && input.fbId.length > 0) {
      const byFb = await tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND custom_fields->>'fb_id' = $2
         LIMIT 1`,
        [tenantId, input.fbId],
      );
      if (byFb !== null) return byFb;
    }

    if (input.tmrLvid !== undefined && input.tmrLvid.length > 0) {
      const byTmr = await tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND (
             custom_fields->>'tmr_lvid' = $2
             OR custom_fields->'analytics'->>'tmr_lvid' = $2
           )
         LIMIT 1`,
        [tenantId, input.tmrLvid],
      );
      if (byTmr !== null) return byTmr;
    }

    // Поиск по рекламным Click ID (yclid, gclid, vkclid)
    if (input.clickIds && Object.keys(input.clickIds).length > 0) {
      for (const [key, val] of Object.entries(input.clickIds)) {
        if (val && typeof val === "string" && val.length > 0) {
          const byClick = await tx.queryOne<ExistingContact>(
            `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
             WHERE tenant_id = $1
               AND deleted_at IS NULL
               AND (
                 custom_fields->'click_ids'->>$2 = $3
                 OR custom_fields->>$2 = $3
               )
             LIMIT 1`,
            [tenantId, key, val],
          );
          if (byClick !== null) return byClick;
        }
      }
    }

    // Поиск по аппаратному цифровому отпечатку устройства (device_fingerprint)
    if (input.deviceFingerprint !== undefined && input.deviceFingerprint.length > 0 && input.deviceFingerprint !== "dfp_fallback") {
      const byFp = await tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND custom_fields->>'device_fingerprint' = $2
         LIMIT 1`,
        [tenantId, input.deviceFingerprint],
      );
      if (byFp !== null) return byFp;
    }

    return null;
  }

  /**
   * Поиск по любому номеру контакта, а не только по основному.
   *
   * Клиент звонит со второго номера так же часто, как с первого. Поддерживает
   * сопоставление номеров с кодом страны (+7/8/7), без знака плюса и по последним 10 цифрам.
   */
  private async findContactByPhone(
    tx: TransactionClient,
    tenantId: string,
    phone: string,
  ): Promise<ExistingContact | null> {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) {
      return tx.queryOne<ExistingContact>(
        `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
         WHERE tenant_id = $1
           AND deleted_at IS NULL
           AND (phone = $2 OR additional_phones @> $3::jsonb)
         LIMIT 1`,
        [tenantId, phone, JSON.stringify([{ number: phone }])],
      );
    }

    const last10 = digits.slice(-10);
    const withPlus = `+${digits}`;
    const altWith8 = digits.length === 11 && digits.startsWith("7") ? `8${digits.slice(1)}` : digits;
    const altWith7 = digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;

    return tx.queryOne<ExistingContact>(
      `SELECT id, first_name, last_name, phone, telegram_chat_id FROM contacts
       WHERE tenant_id = $1
         AND deleted_at IS NULL
         AND (
           phone IN ($2, $3, $4, $5)
           OR additional_phones @> $6::jsonb
           OR additional_phones @> $7::jsonb
           OR additional_phones @> $8::jsonb
           OR right(regexp_replace(phone, '\\D', '', 'g'), 10) = $9
         )
       LIMIT 1`,
      [
        tenantId,
        withPlus,
        digits,
        altWith8,
        altWith7,
        JSON.stringify([{ number: withPlus }]),
        JSON.stringify([{ number: digits }]),
        JSON.stringify([{ number: altWith8 }]),
        last10,
      ],
    );
  }

  private async findActiveDeal(
    tx: TransactionClient,
    tenantId: string,
    contactId: string,
  ): Promise<{ id: string } | null> {
    const row = await tx.queryOne<{
      id: string;
      stage_name: string;
      pipeline_id: string;
      is_stale_first_contact: boolean;
    }>(
      `SELECT d.id, s.name as stage_name, d.pipeline_id,
              (s.name = 'Первый контакт' AND d.updated_at < now() - INTERVAL '5 days') as is_stale_first_contact
       FROM deals d
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

    if (row && row.is_stale_first_contact) {
      // Истёк 5-дневный срок ожидания контакта для анонимной сделки веб-чата:
      // закрываем сделку как нереализованную и не возвращаем её как активную.
      const lostStage = await tx.queryOne<{ id: string }>(
        `SELECT id FROM stages
         WHERE pipeline_id = $1 AND is_lost = true
         ORDER BY sort_order DESC
         LIMIT 1`,
        [row.pipeline_id],
      );

      if (lostStage) {
        await tx.query(
          `UPDATE deals
           SET stage_id = $1, closed_at = now(), updated_at = now()
           WHERE id = $2 AND tenant_id = $3`,
          [lostStage.id, row.id, tenantId],
        );

        await this.deals.createMessage(
          tenantId,
          row.id,
          "Система",
          {
            source: "system",
            direction: "neutral",
            content: "Сделка автоматически закрыта: истёк срок ожидания контакта (5 суток без активности).",
            channel: "system",
          },
          "neutral",
        );
      }

      return null;
    }

    if (row) {
      // Продлеваем активность сделки при любом повторном обращении
      await tx.query(
        `UPDATE deals SET updated_at = now() WHERE id = $1 AND tenant_id = $2`,
        [row.id, tenantId],
      );
    }

    return row ? { id: row.id } : null;
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
