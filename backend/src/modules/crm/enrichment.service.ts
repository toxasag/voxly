import { query, queryOne, transaction, runWithPlatformScope } from "../../db/client.js";
import type { ContactSocialJson } from "./contacts/contacts.types.js";
import { WhatsappEvolutionService } from "../channels/whatsapp-evolution.service.js";
import { resolveTelegramPhone } from "../channels/outbound-registry.js";
import { isPlaceholderName, parseNameFromTelegramUsername, cleanContactDisplayName } from "./identity-resolution.js";
import { isFakeOrDummyPhone } from "./channel-identity.js";

// ---------------------------------------------------------------------------
// Автоматическое кросс-канальное обогащение контактов по номеру телефона (4.2).
//
// Источник: CRM-PLUS enrich-person-by-phone.ts.
// Принцип «Never invent»: никогда не генерировать синтетические ссылки вида
// `t.me/+7900...` или `wa.me/...` без подтверждения существования аккаунта
// провайдером (Telegram MTProto, MAX API, Evolution WhatsApp).
// ---------------------------------------------------------------------------

export interface TelegramProfileResolved {
  exists: boolean;
  userId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  error?: string;
}

export interface MaxProfileResolved {
  exists: boolean;
  userId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  link?: string;
  error?: string;
}

export interface WhatsAppProfileResolved {
  exists: boolean;
  jid?: string;
  phone?: string;
  error?: string;
}

export interface CrossChannelProviders {
  checkTelegram: (phone: string, tenantId: string) => Promise<TelegramProfileResolved>;
  checkMax: (phone: string, tenantId: string) => Promise<MaxProfileResolved>;
  checkWhatsApp: (phone: string, tenantId: string) => Promise<WhatsAppProfileResolved>;
}

export interface MessengerSourceInfo {
  channel: "telegram" | "whatsapp" | "max" | "crm";
  name: string;
  username?: string;
  avatarUrl?: string;
  phone?: string;
  isVerified?: boolean;
}

export interface ClientPhoneLookupResult {
  phone: string;
  found: boolean;
  suggestedName: string | null;
  sources: MessengerSourceInfo[];
  channelsChecked: string[];
  existingClient: {
    id: string;
    firstName: string;
    lastName: string | null;
    middleName: string | null;
    phone: string | null;
    email: string | null;
    companyId: string | null;
    companyName: string | null;
  } | null;
}

export interface EnrichContactResult {
  contactId: string;
  phone: string;
  ok: boolean;
  enrichedFields: string[];
  channelsChecked: string[];
  error?: string;
}

function normalizePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) {
    return `7${digits.slice(1)}`;
  }
  return digits;
}

// isPlaceholderName импортирован из identity-resolution.js со строгой проверкой шаблонов («Клиент +7...», «Посетитель сайта...»)

export class CrmEnrichmentService {
  private providers: CrossChannelProviders;

  constructor(customProviders?: Partial<CrossChannelProviders>) {
    this.providers = {
      checkTelegram: customProviders?.checkTelegram ?? this.defaultTelegramProvider.bind(this),
      checkMax: customProviders?.checkMax ?? this.defaultMaxProvider.bind(this),
      checkWhatsApp: customProviders?.checkWhatsApp ?? this.defaultWhatsAppProvider.bind(this),
    };
  }

  /**
   * Обогащает контакт по его основному или дополнительному номеру телефона.
   */
  async enrichContact(
    tenantId: string,
    contactId: string,
    options?: {
      phoneOverride?: string;
      channels?: Array<"telegram" | "max" | "whatsapp">;
      dealId?: string;
    },
  ): Promise<EnrichContactResult> {
    const contact = await queryOne<{
      id: string;
      first_name: string;
      last_name: string | null;
      phone: string;
      telegram_username: string | null;
      telegram_chat_id: string | null;
      whatsapp: string | null;
      socials: ContactSocialJson[];
    }>(
      `SELECT id, first_name, last_name, phone, telegram_username,
              telegram_chat_id::text, whatsapp, socials
       FROM contacts
       WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [contactId, tenantId],
    );

    if (contact === null) {
      return {
        contactId,
        phone: "",
        ok: false,
        enrichedFields: [],
        channelsChecked: [],
        error: "Contact not found",
      };
    }

    const rawPhone = options?.phoneOverride ?? contact.phone;
    const phoneDigits = normalizePhoneDigits(rawPhone);

    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return {
        contactId,
        phone: rawPhone,
        ok: false,
        enrichedFields: [],
        channelsChecked: [],
        error: "Invalid phone number length",
      };
    }

    const selectedChannels = options?.channels ?? ["telegram", "max", "whatsapp"];
    const enrichedFields: string[] = [];
    const channelsChecked: string[] = [];

    const existingSocials = Array.isArray(contact.socials) ? [...contact.socials] : [];
    let updatedFirstName = contact.first_name;
    let updatedLastName = contact.last_name;
    let updatedTgUsername = contact.telegram_username;
    let updatedTgChatId = contact.telegram_chat_id;
    let updatedWhatsapp = contact.whatsapp;

    const shouldUpdateName = isPlaceholderName(contact.first_name, contact.last_name);

    let tgRes: TelegramProfileResolved | null = null;
    let maxRes: MaxProfileResolved | null = null;
    let waRes: WhatsAppProfileResolved | null = null;

    // 1. Проверка Telegram (через GramJS bridge/MTProto)
    if (selectedChannels.includes("telegram")) {
      channelsChecked.push("telegram");
      try {
        tgRes = await this.providers.checkTelegram(phoneDigits, tenantId);
        if (tgRes.exists) {
          if (tgRes.username && !updatedTgUsername) {
            updatedTgUsername = tgRes.username;
            enrichedFields.push("telegram_username");
          }
          if (tgRes.userId && !updatedTgChatId) {
            updatedTgChatId = tgRes.userId;
            enrichedFields.push("telegram_chat_id");
          }
          const hasTgSocial = existingSocials.some((s) => s.kind === "telegram");
          if (!hasTgSocial && (tgRes.username || tgRes.userId)) {
            existingSocials.push({
              kind: "telegram",
              value: tgRes.username ? `@${tgRes.username.replace(/^@/, "")}` : `tg://user?id=${tgRes.userId}`,
            });
            enrichedFields.push("socials:telegram");
          }
        }
      } catch (err) {
        // Ошибка проверки одного канала не должна ломать остальные
      }
    }

    // 2. Проверка MAX
    if (selectedChannels.includes("max")) {
      channelsChecked.push("max");
      try {
        maxRes = await this.providers.checkMax(phoneDigits, tenantId);
        if (maxRes.exists) {
          const maxVal = maxRes.link ?? (maxRes.username ? `@${maxRes.username}` : (phoneDigits ? `+${phoneDigits}` : ""));
          if (maxVal) {
            const existingMax = existingSocials.find((s) => s.kind === "max");
            if (existingMax) {
              if (existingMax.value.startsWith("max://user") && (phoneDigits || maxRes.username || maxRes.link)) {
                existingMax.value = maxVal;
                enrichedFields.push("socials:max");
              }
            } else {
              existingSocials.push({
                kind: "max",
                value: maxVal,
              });
              enrichedFields.push("socials:max");
            }
          }
        }
      } catch (err) {
        // пропускаем ошибку канала
      }
    }

    // 3. Проверка WhatsApp
    if (selectedChannels.includes("whatsapp")) {
      channelsChecked.push("whatsapp");
      try {
        waRes = await this.providers.checkWhatsApp(phoneDigits, tenantId);
        if (waRes.exists) {
          const waValue = `+${phoneDigits}`;
          if (!updatedWhatsapp) {
            updatedWhatsapp = waValue;
            enrichedFields.push("whatsapp");
          }
          const hasWaSocial = existingSocials.some((s) => s.kind === "whatsapp");
          if (!hasWaSocial) {
            existingSocials.push({
              kind: "whatsapp",
              value: waValue,
            });
            enrichedFields.push("socials:whatsapp");
          }
        }
      } catch (err) {
        // пропускаем ошибку канала
      }
    }

    // 3.5. Определение имени с жестким приоритетом источников:
    // Приоритет 1: MAX (официальный мессенджер, прямая привязка к номеру)
    // Приоритет 2: Telegram Display Name (очищенный от суффиксов компаний, доменов и ролей)
    // Приоритет 3: Telegram username (СТРОГО по словарю реальных имен, запрет транслитерации ников вроде toxasagmsk)
    // Фоллбэк: если имя не подтверждено — не выдумывать и не транслитерировать ники
    if (shouldUpdateName) {
      let candidateName: { firstName: string; lastName?: string } | null = null;

      // 1. MAX
      if (maxRes?.exists && (maxRes.firstName || maxRes.lastName)) {
        const rawMax = `${maxRes.firstName || ""} ${maxRes.lastName || ""}`.trim();
        const cleanedMax = cleanContactDisplayName(rawMax);
        if (cleanedMax && !isPlaceholderName(cleanedMax.firstName, cleanedMax.lastName)) {
          candidateName = cleanedMax;
        }
      }

      // 2. Telegram display name
      if (!candidateName && tgRes?.exists && (tgRes.firstName || tgRes.lastName)) {
        const rawTg = `${tgRes.firstName || ""} ${tgRes.lastName || ""}`.trim();
        const cleanedTg = cleanContactDisplayName(rawTg);
        if (cleanedTg && !isPlaceholderName(cleanedTg.firstName, cleanedTg.lastName)) {
          candidateName = cleanedTg;
        }
      }

      // 3. Telegram username (только если совпало со словарем имен)
      if (!candidateName && tgRes?.exists && (updatedTgUsername || tgRes.username)) {
        const parsedTg = parseNameFromTelegramUsername(updatedTgUsername || tgRes.username);
        if (parsedTg && !isPlaceholderName(parsedTg.firstName, parsedTg.lastName)) {
          candidateName = parsedTg;
        }
      }

      if (candidateName) {
        updatedFirstName = candidateName.firstName;
        updatedLastName = candidateName.lastName ?? null;
        enrichedFields.push("name");
      }
    }

    // 3.5. Нормализация legacy socials (если ранее туда попал служебный max://user?id=...)
    if (phoneDigits) {
      for (const social of existingSocials) {
        if (social.kind === "max" && social.value.startsWith("max://user")) {
          social.value = `+${phoneDigits}`;
          if (!enrichedFields.includes("socials:max")) {
            enrichedFields.push("socials:max");
          }
        }
      }
    }

    // 4. Если хотя бы одно поле обогатилось — обновляем контакт в транзакции
    if (enrichedFields.length > 0) {
      await transaction(async (tx) => {
        await tx.query(
          `UPDATE contacts
           SET first_name = $1,
               last_name = $2,
               telegram_username = $3,
               telegram_chat_id = $4,
               whatsapp = $5,
               socials = $6,
               updated_at = now()
           WHERE id = $7 AND tenant_id = $8`,
          [
            updatedFirstName,
            updatedLastName,
            updatedTgUsername,
            updatedTgChatId,
            updatedWhatsapp,
            JSON.stringify(existingSocials),
            contactId,
            tenantId,
          ],
        );

        if (enrichedFields.includes("name")) {
          const resolvedFullName = `${updatedFirstName} ${updatedLastName || ""}`.trim();
          await tx.query(
            `UPDATE deals
             SET title = 'Заявка от ' || $1 || ' (' || 
                 COALESCE(
                   CASE 
                     WHEN title LIKE '%(Онлайн-чат)%' THEN 'Онлайн-чат'
                     WHEN title LIKE '%(Telegram)%' THEN 'Telegram'
                     WHEN title LIKE '%(WhatsApp)%' THEN 'WhatsApp'
                     WHEN title LIKE '%(MAX)%' THEN 'MAX'
                     ELSE 'Прямое обращение'
                   END, 'Прямое обращение'
                 ) || ')',
                 updated_at = now()
             WHERE contact_id = $2 AND tenant_id = $3
               AND (title ILIKE 'Заявка от Клиент%' OR title ILIKE 'Заявка от Посетитель%' OR title ILIKE 'Заявка от +%' OR title ILIKE 'Заявка от Отладчик%' OR title ILIKE 'Заявка от Без имени%')`,
            [resolvedFullName, contactId, tenantId],
          );
        }
      });
    }

    // 4.5. Сохраняем статус и результаты обогащения в custom_fields
    const enrichmentMeta = {
      status: "completed",
      checked_at: new Date().toISOString(),
      channels: {
        telegram: {
          exists: tgRes?.exists ?? false,
          username: tgRes?.username ?? null,
          userId: tgRes?.userId ?? null,
          error: tgRes?.error ?? null,
        },
        max: {
          exists: maxRes?.exists ?? false,
          username: maxRes?.username ?? null,
          userId: maxRes?.userId ?? null,
          error: maxRes?.error ?? null,
        },
        whatsapp: {
          exists: waRes?.exists ?? false,
          phone: waRes?.exists ? `+${phoneDigits}` : null,
          error: waRes?.error ?? null,
        },
      },
      enriched_fields: enrichedFields,
    };

    try {
      await query(
        `UPDATE contacts
         SET custom_fields = jsonb_set(COALESCE(custom_fields, '{}'::jsonb), '{enrichment}', $1::jsonb),
             updated_at = now()
         WHERE id = $2 AND tenant_id = $3`,
        [JSON.stringify(enrichmentMeta), contactId, tenantId],
      );
    } catch {
      // Игнорируем ошибку обновления custom_fields
    }

    // 5. Логируем результаты верификации мессенджеров в таймлайн сделки и активность контакта
    try {
      let targetDealId = options?.dealId;
      if (!targetDealId) {
        const dealRow = await queryOne<{ id: string }>(
          `SELECT id FROM deals
           WHERE contact_id = $1 AND tenant_id = $2 AND deleted_at IS NULL
           ORDER BY created_at DESC LIMIT 1`,
          [contactId, tenantId],
        );
        targetDealId = dealRow?.id;
      }

      if (targetDealId) {
        const isDummy = isFakeOrDummyPhone(phoneDigits);
        const tgLabel = tgRes?.exists
          ? `Telegram: найден (${tgRes.username ? `@${tgRes.username}` : `ID: ${tgRes.userId}`})`
          : "Telegram: не найден";
        const waLabel = waRes?.exists ? `WhatsApp: активен (+${phoneDigits})` : "WhatsApp: не найден";
        const maxLabel = maxRes?.exists ? `MAX: найден (${maxRes.username || maxRes.userId || "активен"})` : "MAX: не найден";

        const dummyHeader = isDummy ? "⚠️ Внимание: номер определен как фиктивный/тестовый!\n" : "";
        const auditMessage = `${dummyHeader}Результат проверки мессенджеров для +${phoneDigits}:\n• ${tgLabel}\n• ${waLabel}\n• ${maxLabel}`;

        const auditMeta = JSON.stringify({
          event: "messenger_verification",
          phone: `+${phoneDigits}`,
          isFake: isDummy,
          telegram: tgRes?.exists ?? false,
          whatsapp: waRes?.exists ?? false,
          max: maxRes?.exists ?? false,
        });

        const existingAudit = await queryOne<{ id: string }>(
          `SELECT id FROM deal_messages
           WHERE tenant_id = $1 AND deal_id = $2
             AND source = 'system'
             AND metadata->>'event' = 'messenger_verification'
             AND metadata->>'phone' = $3
             AND created_at >= now() - interval '24 hours'
           LIMIT 1`,
          [tenantId, targetDealId, `+${phoneDigits}`],
        );

        if (existingAudit) {
          await query(
            `UPDATE deal_messages
             SET content = $1, metadata = $2::jsonb
             WHERE id = $3 AND tenant_id = $4`,
            [auditMessage, auditMeta, existingAudit.id, tenantId],
          );
        } else {
          await query(
            `INSERT INTO deal_messages
               (tenant_id, deal_id, source, direction, sender_name, content, channel, delivery_status, metadata)
             VALUES ($1, $2, 'system', 'neutral', 'Система', $3, 'system', 'neutral', $4::jsonb)`,
            [tenantId, targetDealId, auditMessage, auditMeta],
          );
        }
      }
    } catch {
      // Ошибки логирования аудита не блокируют возврат результата
    }

    return {
      contactId,
      phone: rawPhone,
      ok: true,
      enrichedFields,
      channelsChecked,
    };
  }

  /**
   * Сквозной резолвинг клиента по номеру телефона:
   * 1. Поиск в базе контактов CRM текущего тенанта (прошлые заявки/наряды).
   * 2. Асинхронный опрос подключенных каналов мессенджеров (Telegram, WhatsApp, MAX) с circuit breaker таймаутом <= 2.5 сек.
   * 3. Ранжирование достоверности и формирование агрегированного результата ФИО.
   */
  async lookupClientByPhone(
    tenantId: string,
    rawPhone: string,
    options?: { timeoutMs?: number; skipChannels?: boolean },
  ): Promise<ClientPhoneLookupResult> {
    const phoneDigits = normalizePhoneDigits(rawPhone);
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      return {
        phone: rawPhone,
        found: false,
        suggestedName: null,
        sources: [],
        channelsChecked: [],
        existingClient: null,
      };
    }

    const searchSuffix = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;
    const sources: MessengerSourceInfo[] = [];
    const channelsChecked: string[] = [];

    // 1. Поиск контакта в базе CRM текущего тенанта
    const contactRow = await queryOne<{
      id: string;
      first_name: string;
      last_name: string | null;
      middle_name: string | null;
      phone: string | null;
      email: string | null;
      company_id: string | null;
      company_name: string | null;
      telegram_username: string | null;
      whatsapp: string | null;
      socials: ContactSocialJson[] | null;
      custom_fields: Record<string, unknown> | null;
    }>(
      `SELECT id, first_name, last_name, middle_name, phone, email, company_id, company_name,
              telegram_username, whatsapp, socials, custom_fields
       FROM contacts
       WHERE tenant_id = $1 AND deleted_at IS NULL
         AND (
           regexp_replace(phone, '[^0-9]', '', 'g') LIKE '%' || $2
           OR additional_phones::text LIKE '%' || $2 || '%'
         )
       ORDER BY updated_at DESC
       LIMIT 1`,
      [tenantId, searchSuffix],
    );

    let existingClient: ClientPhoneLookupResult["existingClient"] = null;
    let crmNameValid: string | null = null;

    if (contactRow) {
      existingClient = {
        id: contactRow.id,
        firstName: contactRow.first_name,
        lastName: contactRow.last_name,
        middleName: contactRow.middle_name,
        phone: contactRow.phone,
        email: contactRow.email,
        companyId: contactRow.company_id,
        companyName: contactRow.company_name,
      };

      channelsChecked.push("crm");
      const isPlaceholder = isPlaceholderName(contactRow.first_name, contactRow.last_name);
      if (!isPlaceholder) {
        crmNameValid = [contactRow.last_name, contactRow.first_name, contactRow.middle_name]
          .filter(Boolean)
          .join(" ")
          .trim();
        if (crmNameValid) {
          sources.push({
            channel: "crm",
            name: crmNameValid,
            phone: contactRow.phone ?? `+${phoneDigits}`,
            isVerified: true,
          });
        }
      }

      if (contactRow.telegram_username) {
        sources.push({
          channel: "telegram",
          name: `@${contactRow.telegram_username.replace(/^@/, "")}`,
          username: contactRow.telegram_username.replace(/^@/, ""),
          isVerified: true,
        });
      }
      if (contactRow.whatsapp) {
        sources.push({
          channel: "whatsapp",
          name: contactRow.whatsapp,
          phone: contactRow.whatsapp,
          isVerified: true,
        });
      }
      if (Array.isArray(contactRow.socials)) {
        for (const soc of contactRow.socials) {
          if (soc.kind === "max" && soc.value) {
            sources.push({
              channel: "max",
              name: soc.value,
              username: soc.value.startsWith("@") ? soc.value.slice(1) : undefined,
              isVerified: true,
            });
          }
        }
      }
    }

    if (options?.skipChannels) {
      return {
        phone: `+${phoneDigits}`,
        found: sources.length > 0 || existingClient !== null,
        suggestedName: crmNameValid,
        sources,
        channelsChecked,
        existingClient,
      };
    }

    // 2. Параллельный асинхронный опрос подключенных каналов мессенджеров (с circuit breaker)
    const timeoutMs = options?.timeoutMs ?? 2200;
    let tgRes: TelegramProfileResolved | null = null;
    let maxRes: MaxProfileResolved | null = null;
    let waRes: WhatsAppProfileResolved | null = null;

    try {
      channelsChecked.push("telegram", "max", "whatsapp");

      const checkTg = this.providers.checkTelegram(phoneDigits, tenantId).catch((err) => ({
        exists: false,
        error: String(err),
      }));
      const checkMax = this.providers.checkMax(phoneDigits, tenantId).catch((err) => ({
        exists: false,
        error: String(err),
      }));
      const checkWa = this.providers.checkWhatsApp(phoneDigits, tenantId).catch((err) => ({
        exists: false,
        error: String(err),
      }));

      const timeoutPromise = new Promise<{ timeout: true }>((resolve) =>
        setTimeout(() => resolve({ timeout: true }), timeoutMs),
      );

      const batchResult = await Promise.race([
        Promise.allSettled([checkTg, checkMax, checkWa]),
        timeoutPromise,
      ]);

      if (Array.isArray(batchResult)) {
        const [tgSettled, maxSettled, waSettled] = batchResult;
        if (tgSettled.status === "fulfilled") tgRes = tgSettled.value;
        if (maxSettled.status === "fulfilled") maxRes = maxSettled.value;
        if (waSettled.status === "fulfilled") waRes = waSettled.value;
      }
    } catch {
      // Игнорируем сетевые сбои
    }

    // 3. Обработка профилей мессенджеров
    let maxSuggestedName: string | null = null;
    let tgSuggestedName: string | null = null;

    if (maxRes?.exists) {
      const rawMax = `${maxRes.firstName || ""} ${maxRes.lastName || ""}`.trim();
      const cleaned = cleanContactDisplayName(rawMax);
      if (cleaned && !isPlaceholderName(cleaned.firstName, cleaned.lastName)) {
        maxSuggestedName = [cleaned.lastName, cleaned.firstName].filter(Boolean).join(" ").trim();
      }
      const existingMaxSource = sources.find((s) => s.channel === "max");
      if (!existingMaxSource) {
        sources.push({
          channel: "max",
          name: maxSuggestedName || (maxRes.username ? `@${maxRes.username}` : (maxRes.link || `+${phoneDigits}`)),
          username: maxRes.username,
          isVerified: true,
        });
      }
    }

    if (tgRes?.exists) {
      const rawTg = `${tgRes.firstName || ""} ${tgRes.lastName || ""}`.trim();
      const cleaned = cleanContactDisplayName(rawTg);
      if (cleaned && !isPlaceholderName(cleaned.firstName, cleaned.lastName)) {
        tgSuggestedName = [cleaned.lastName, cleaned.firstName].filter(Boolean).join(" ").trim();
      } else if (tgRes.username) {
        const parsedFromName = parseNameFromTelegramUsername(tgRes.username);
        if (parsedFromName && !isPlaceholderName(parsedFromName.firstName, parsedFromName.lastName)) {
          tgSuggestedName = [parsedFromName.lastName, parsedFromName.firstName].filter(Boolean).join(" ").trim();
        }
      }
      const existingTgSource = sources.find((s) => s.channel === "telegram");
      if (!existingTgSource) {
        sources.push({
          channel: "telegram",
          name: tgSuggestedName || (tgRes.username ? `@${tgRes.username.replace(/^@/, "")}` : `Telegram ID: ${tgRes.userId}`),
          username: tgRes.username ? tgRes.username.replace(/^@/, "") : undefined,
          avatarUrl: tgRes.avatarUrl,
          isVerified: true,
        });
      }
    }

    if (waRes?.exists) {
      const existingWaSource = sources.find((s) => s.channel === "whatsapp");
      if (!existingWaSource) {
        sources.push({
          channel: "whatsapp",
          name: `+${phoneDigits}`,
          phone: `+${phoneDigits}`,
          isVerified: true,
        });
      }
    }

    // 4. Ранжирование достоверности имени (CRM -> MAX -> Telegram Display Name -> Telegram Username)
    let finalSuggestedName: string | null = null;
    if (crmNameValid) {
      finalSuggestedName = crmNameValid;
    } else if (maxSuggestedName) {
      finalSuggestedName = maxSuggestedName;
    } else if (tgSuggestedName) {
      finalSuggestedName = tgSuggestedName;
    }

    return {
      phone: `+${phoneDigits}`,
      found: sources.length > 0 || existingClient !== null,
      suggestedName: finalSuggestedName,
      sources,
      channelsChecked,
      existingClient,
    };
  }

  // --- Реализации провайдеров по умолчанию ---

  private async defaultTelegramProvider(phone: string, tenantId: string): Promise<TelegramProfileResolved> {
    try {
      const resolved = await resolveTelegramPhone(tenantId, phone);
      if (resolved && resolved.exists) {
        return {
          exists: true,
          userId: resolved.userId,
          username: resolved.username,
          firstName: resolved.firstName,
          lastName: resolved.lastName,
        };
      }
    } catch {
      // Игнорируем и пробуем bridge fallback
    }

    const bridgeUrl = process.env.GRAMJS_BRIDGE_URL ?? "http://gramjs-bridge:3008";
    const token = process.env.VOXLY_SERVICE_TOKEN;
    if (!token) return { exists: false, error: "VOXLY_SERVICE_TOKEN unset" };

    try {
      const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}/users/by-phone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phone: `+${phone}` }),
      });
      if (!res.ok) return { exists: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as {
        ok?: boolean;
        exists?: boolean;
        userId?: string;
        username?: string;
        firstName?: string;
        lastName?: string;
        avatarUrl?: string;
      };
      return {
        exists: Boolean(data.ok && data.exists),
        userId: data.userId,
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        avatarUrl: data.avatarUrl,
      };
    } catch (err) {
      return { exists: false, error: String(err) };
    }
  }

  private async defaultMaxProvider(phone: string, tenantId: string): Promise<MaxProfileResolved> {
    const bridgeUrl = process.env.MAX_BRIDGE_URL ?? "http://max-bridge:3010";
    const token = process.env.VOXLY_SERVICE_TOKEN;
    if (!token) return { exists: false, error: "VOXLY_SERVICE_TOKEN unset" };

    try {
      let account = await runWithPlatformScope(() =>
        queryOne<{ id: string }>(
          `SELECT id FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'max' AND status = 'connected' AND deleted_at IS NULL
           ORDER BY connected_at DESC NULLS LAST
           LIMIT 1`,
          [tenantId],
        ),
      );
      if (!account) {
        account = await runWithPlatformScope(() =>
          queryOne<{ id: string }>(
            `SELECT id FROM channel_accounts
             WHERE channel = 'max' AND status = 'connected' AND deleted_at IS NULL
             ORDER BY connected_at DESC NULLS LAST
             LIMIT 1`,
          ),
        );
      }
      if (!account) return { exists: false, error: "No active MAX account" };

      const res = await fetch(`${bridgeUrl.replace(/\/$/, "")}/users/by-phone`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ botId: account.id, phone: `+${phone}` }),
      });
      if (!res.ok) return { exists: false, error: `HTTP ${res.status}` };
      const data = (await res.json()) as {
        ok?: boolean;
        exists?: boolean;
        userId?: string;
        username?: string;
        firstName?: string;
        lastName?: string;
        link?: string;
      };
      return {
        exists: Boolean(data.ok && data.exists),
        userId: data.userId,
        username: data.username,
        firstName: data.firstName,
        lastName: data.lastName,
        link: data.link,
      };
    } catch (err) {
      return { exists: false, error: String(err) };
    }
  }

  private async defaultWhatsAppProvider(phone: string, tenantId: string): Promise<WhatsAppProfileResolved> {
    const evo = new WhatsappEvolutionService();
    if (!evo.isConfigured) return { exists: false, error: "Evolution API not configured" };

    try {
      const account = await runWithPlatformScope(() =>
        queryOne<{ credentials: { instanceName?: string } }>(
          `SELECT credentials FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'whatsapp' AND status = 'connected' AND deleted_at IS NULL
           ORDER BY connected_at DESC NULLS LAST
           LIMIT 1`,
          [tenantId],
        ),
      );
      const instanceName = account?.credentials?.instanceName;
      if (!instanceName) return { exists: false, error: "No connected WhatsApp instance" };

      const cleanDigits = phone.replace(/\D/g, "");
      const res = await evo.checkNumberStatus(instanceName, [cleanDigits]);
      const matched = res.find((r) => r.exists);
      if (matched) {
        return {
          exists: true,
          jid: matched.jid,
          phone: `+${cleanDigits}`,
        };
      }
      return { exists: false, phone: `+${cleanDigits}` };
    } catch (err) {
      return { exists: false, error: String(err) };
    }
  }
}
