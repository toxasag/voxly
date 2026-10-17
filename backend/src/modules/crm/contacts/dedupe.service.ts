import { query, queryOne, withTenant } from "../../../db/client.js";
import { NotFoundError } from "../../../plugins/errorHandler.js";
import type { ContactPhoneJson, ContactRow, ContactSocialJson } from "./contacts.types.js";

/**
 * Нормализация телефонного номера к каноническому формату E.164.
 * Поддерживает российские форматы (8999..., 7999..., 999...),
 * пробелы, дефисы, скобки.
 */
export function normalizePhoneToE164(raw: string | null | undefined): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Извлекаем только цифры и знак плюс
  const cleaned = trimmed.replace(/[^\d+]/g, "");
  if (cleaned.length === 0) return null;

  // Если строка начинается с плюса
  if (cleaned.startsWith("+")) {
    const digitsOnly = cleaned.slice(1);
    if (/^\d{10,15}$/.test(digitsOnly)) {
      // Для номеров СНГ (+78... или +79...)
      return `+${digitsOnly}`;
    }
    return null;
  }

  const digits = cleaned;

  // РФ/Казахстан: 11 цифр, начинающихся с 8 или 7
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) {
    return `+7${digits.slice(1)}`;
  }

  // 10 цифр (номер без кода страны, например 9991234567) -> считаем российским
  if (digits.length === 10 && digits.startsWith("9")) {
    return `+7${digits}`;
  }

  // Общий международный формат от 10 до 15 цифр
  if (/^\d{10,15}$/.test(digits)) {
    return `+${digits}`;
  }

  return null;
}

export interface MergeContactsResult {
  primaryContactId: string;
  mergedContactIds: string[];
  dealsRetargeted: number;
  tasksRetargeted: number;
  phonesAdded: number;
  socialsAdded: number;
}

export class ContactDedupeService {
  /**
   * Поиск дубликатов контактов по номеру телефона в основном номере,
   * whatsapp или массиве additional_phones.
   */
  async findDuplicatesByPhone(
    tenantId: string,
    phone: string,
    excludeContactId?: string,
  ): Promise<ContactRow[]> {
    const canonical = normalizePhoneToE164(phone);
    if (!canonical) return [];

    // Извлекаем последние 10 цифр для надёжного сопоставления
    const last10Digits = canonical.slice(-10);

    const rows = await query<ContactRow>(
      `SELECT * FROM contacts
       WHERE tenant_id = $1
         AND deleted_at IS NULL
         AND ($2::uuid IS NULL OR id != $2)
         AND (
           phone = $3
           OR phone LIKE '%' || $4
           OR whatsapp = $3
           OR whatsapp LIKE '%' || $4
           OR EXISTS (
             SELECT 1 FROM jsonb_array_elements(additional_phones) AS p
             WHERE (p->>'number') LIKE '%' || $4
           )
         )
       ORDER BY created_at ASC`,
      [tenantId, excludeContactId ?? null, canonical, last10Digits],
    );

    return rows;
  }

  /**
   * Слияние дубликатов контактов (Soft Merge).
   * Перепривязывает сделки и задачи к primaryContactId,
   * объединяет телефоны и соцсети без потери информации,
   * помечает дубликаты deleted_at = now() и записывает аудит.
   */
  async mergeContacts(
    tenantId: string,
    primaryContactId: string,
    loserIds: string[],
    actorId?: string,
  ): Promise<MergeContactsResult> {
    const uniqueLosers = [...new Set(loserIds.filter((id) => id !== primaryContactId))];
    if (uniqueLosers.length === 0) {
      return {
        primaryContactId,
        mergedContactIds: [],
        dealsRetargeted: 0,
        tasksRetargeted: 0,
        phonesAdded: 0,
        socialsAdded: 0,
      };
    }

    return withTenant(tenantId, async (tx) => {
      // 1. Читаем основной контакт
      const primary = await tx.queryOne<ContactRow>(
        "SELECT * FROM contacts WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL",
        [tenantId, primaryContactId],
      );

      if (!primary) {
        throw new NotFoundError("Основной контакт для слияния не найден");
      }

      // 2. Читаем контакты-дубликаты
      const losers = await tx.query<ContactRow>(
        `SELECT * FROM contacts
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
        [tenantId, uniqueLosers],
      );

      if (losers.length === 0) {
        return {
          primaryContactId,
          mergedContactIds: [],
          dealsRetargeted: 0,
          tasksRetargeted: 0,
          phonesAdded: 0,
          socialsAdded: 0,
        };
      }

      // 3. Перепривязываем сделки
      const dealsUpdate = await tx.query<{ id: string }>(
        `UPDATE deals
         SET contact_id = $1, updated_at = now()
         WHERE tenant_id = $2 AND contact_id = ANY($3::uuid[])
         RETURNING id`,
        [primaryContactId, tenantId, uniqueLosers],
      );
      const dealsRetargeted = dealsUpdate.length;

      // 4. Перепривязываем задачи CRM
      const tasksUpdate = await tx.query<{ id: string }>(
        `UPDATE crm_tasks
         SET contact_id = $1, updated_at = now()
         WHERE tenant_id = $2 AND contact_id = ANY($3::uuid[])
         RETURNING id`,
        [primaryContactId, tenantId, uniqueLosers],
      );
      const tasksRetargeted = tasksUpdate.length;

      // 5. Объединяем дополнительные телефоны и соцсети
      const existingPhoneNumbers = new Set<string>();
      if (primary.phone) {
        const norm = normalizePhoneToE164(primary.phone) ?? primary.phone;
        existingPhoneNumbers.add(norm);
      }
      for (const p of primary.additional_phones ?? []) {
        const norm = normalizePhoneToE164(p.number) ?? p.number;
        existingPhoneNumbers.add(norm);
      }

      const mergedAdditionalPhones: ContactPhoneJson[] = [...(primary.additional_phones ?? [])];
      let phonesAdded = 0;

      for (const loser of losers) {
        if (loser.phone) {
          const norm = normalizePhoneToE164(loser.phone) ?? loser.phone;
          if (!existingPhoneNumbers.has(norm)) {
            existingPhoneNumbers.add(norm);
            mergedAdditionalPhones.push({
              number: loser.phone,
              countryCode: loser.phone_country_code || "RU",
              callingCode: loser.phone_calling_code || "+7",
            });
            phonesAdded++;
          }
        }

        for (const lp of loser.additional_phones ?? []) {
          const norm = normalizePhoneToE164(lp.number) ?? lp.number;
          if (!existingPhoneNumbers.has(norm)) {
            existingPhoneNumbers.add(norm);
            mergedAdditionalPhones.push(lp);
            phonesAdded++;
          }
        }
      }

      // Объединяем соцсети
      const existingSocialKeys = new Set(
        (primary.socials ?? []).map((s) => `${s.kind}:${s.value.toLowerCase()}`),
      );
      const mergedSocials: ContactSocialJson[] = [...(primary.socials ?? [])];
      let socialsAdded = 0;

      for (const loser of losers) {
        for (const s of loser.socials ?? []) {
          const key = `${s.kind}:${s.value.toLowerCase()}`;
          if (!existingSocialKeys.has(key)) {
            existingSocialKeys.add(key);
            mergedSocials.push(s);
            socialsAdded++;
          }
        }
      }

      // Обогащаем недостающие одиночные поля
      const email = primary.email || (losers.find((l) => l.email)?.email ?? null);
      const telegramUsername =
        primary.telegram_username || (losers.find((l) => l.telegram_username)?.telegram_username ?? null);
      const telegramChatId =
        primary.telegram_chat_id || (losers.find((l) => l.telegram_chat_id)?.telegram_chat_id ?? null);
      const whatsapp =
        primary.whatsapp || (losers.find((l) => l.whatsapp)?.whatsapp ?? null);
      const jobTitle = primary.job_title || (losers.find((l) => l.job_title)?.job_title ?? "");
      const companyName = primary.company_name || (losers.find((l) => l.company_name)?.company_name ?? "");
      const companyId = primary.company_id || (losers.find((l) => l.company_id)?.company_id ?? null);

      // Обновляем primary контакт
      await tx.query(
        `UPDATE contacts
         SET additional_phones = $1::jsonb,
             socials = $2::jsonb,
             email = $3,
             telegram_username = $4,
             telegram_chat_id = $5,
             whatsapp = $6,
             job_title = $7,
             company_name = $8,
             company_id = $9,
             updated_at = now()
         WHERE tenant_id = $10 AND id = $11`,
        [
          JSON.stringify(mergedAdditionalPhones),
          JSON.stringify(mergedSocials),
          email,
          telegramUsername,
          telegramChatId,
          whatsapp,
          jobTitle,
          companyName,
          companyId,
          tenantId,
          primaryContactId,
        ],
      );

      // 6. Мягкое удаление дубликатов
      await tx.query(
        `UPDATE contacts
         SET deleted_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, uniqueLosers],
      );

      // 7. Аудит
      await tx.query(
        `INSERT INTO tenant_audit_log
           (tenant_id, actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'contact.merged', 'contact', $3, $4::jsonb)`,
        [
          tenantId,
          actorId ?? null,
          primaryContactId,
          JSON.stringify({
            primary_id: primaryContactId,
            merged_ids: uniqueLosers,
            deals_retargeted: dealsRetargeted,
            tasks_retargeted: tasksRetargeted,
            phones_added: phonesAdded,
            socials_added: socialsAdded,
          }),
        ],
      );

      return {
        primaryContactId,
        mergedContactIds: uniqueLosers,
        dealsRetargeted,
        tasksRetargeted,
        phonesAdded,
        socialsAdded,
      };
    });
  }

  /**
   * Установка флага подавления создания сделок для контакта.
   */
  async setSuppressDealCreation(
    tenantId: string,
    contactId: string,
    suppress: boolean,
  ): Promise<void> {
    await query(
      `UPDATE contacts
       SET suppress_deal_creation = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, contactId, suppress],
    );
  }

  /**
   * Проверка, нужно ли подавлять создание сделок по входящим сообщениям контакта.
   */
  async shouldSuppressDeal(tenantId: string, contactId: string): Promise<boolean> {
    const row = await queryOne<{ suppress_deal_creation: boolean }>(
      `SELECT suppress_deal_creation FROM contacts
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, contactId],
    );

    return row?.suppress_deal_creation ?? false;
  }
}
