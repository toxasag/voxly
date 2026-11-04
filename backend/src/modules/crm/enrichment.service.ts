import { queryOne, transaction, runWithPlatformScope } from "../../db/client.js";
import type { ContactSocialJson } from "./contacts/contacts.types.js";
import { WhatsappEvolutionService } from "../channels/whatsapp-evolution.service.js";
import { resolveTelegramPhone } from "../channels/outbound-registry.js";
import { isPlaceholderName, parseNameFromTelegramUsername } from "./identity-resolution.js";

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

    // 1. Проверка Telegram (через GramJS bridge/MTProto)
    if (selectedChannels.includes("telegram")) {
      channelsChecked.push("telegram");
      try {
        const tgRes = await this.providers.checkTelegram(phoneDigits, tenantId);
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
          const hasValidTgName = Boolean(
            (tgRes.firstName || tgRes.lastName) &&
            !isPlaceholderName(tgRes.firstName, tgRes.lastName),
          );
          if (shouldUpdateName && hasValidTgName) {
            if (tgRes.firstName) updatedFirstName = tgRes.firstName;
            if (tgRes.lastName) updatedLastName = tgRes.lastName;
            enrichedFields.push("name");
          } else if (shouldUpdateName && (updatedTgUsername || tgRes.username)) {
            const parsedTg = parseNameFromTelegramUsername(updatedTgUsername || tgRes.username);
            if (parsedTg && parsedTg.firstName && !isPlaceholderName(parsedTg.firstName, parsedTg.lastName)) {
              updatedFirstName = parsedTg.firstName;
              if (parsedTg.lastName) updatedLastName = parsedTg.lastName;
              enrichedFields.push("name");
            }
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
        const maxRes = await this.providers.checkMax(phoneDigits, tenantId);
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
          const hasValidMaxName = Boolean(
            (maxRes.firstName || maxRes.lastName) &&
            !isPlaceholderName(maxRes.firstName, maxRes.lastName),
          );
          if (shouldUpdateName && !enrichedFields.includes("name") && hasValidMaxName) {
            if (maxRes.firstName) updatedFirstName = maxRes.firstName;
            if (maxRes.lastName) updatedLastName = maxRes.lastName;
            enrichedFields.push("name");
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
        const waRes = await this.providers.checkWhatsApp(phoneDigits, tenantId);
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
               AND (title ILIKE 'Заявка от Клиент%' OR title ILIKE 'Заявка от Посетитель%' OR title ILIKE 'Заявка от +%' OR title ILIKE 'Заявка от Отладчик%')`,
            [resolvedFullName, contactId, tenantId],
          );
        }
      });
    }

    return {
      contactId,
      phone: rawPhone,
      ok: true,
      enrichedFields,
      channelsChecked,
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
      const account = await runWithPlatformScope(() =>
        queryOne<{ id: string }>(
          `SELECT id FROM channel_accounts
           WHERE tenant_id = $1 AND channel = 'max' AND status = 'connected' AND deleted_at IS NULL
           ORDER BY connected_at DESC NULLS LAST
           LIMIT 1`,
          [tenantId],
        ),
      );
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
