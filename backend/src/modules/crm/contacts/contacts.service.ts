import type {
  CallerIdLookupDTO,
  ContactDTO,
  ContactDealItemDTO,
  ContactDealsHistoryDTO,
  ContactRow,
  ContactSocialJson,
  ContactType,
  CreateContactPayload,
  UpdateContactPayload,
} from "./contacts.types.js";
import {
  normalizeSocials,
  socialValue,
  splitPhones,
  toContactDTO,
} from "./contacts.types.js";
import {
  query,
  queryOne,
  transaction,
  type SqlParam,
  type TransactionClient,
} from "../../../db/client.js";
import { CrmEnrichmentService } from "../enrichment.service.js";
import type { BulkActionPayload } from "../shared/bulk-action.types.js";
import { ContactDedupeService } from "./dedupe.service.js";

/**
 * Те же колонки с префиксом плюс счётчики связей и имя создателя.
 *
 * LATERAL вместо GROUP BY: группировка по всем колонкам контакта ради двух
 * COUNT заставила бы БД сортировать весь набор, а подзапросы считают по
 * индексам `deals.contact_id` и `crm_tasks.contact_id`.
 */
const CONTACT_COLUMNS_WITH_COUNTS = `
  c.id, c.tenant_id, c.first_name, c.last_name, c.middle_name, c.phone,
  c.phone_country_code, c.phone_calling_code, c.additional_phones,
  c.email, c.telegram_username, c.telegram_chat_id, c.whatsapp, c.socials,
  c.job_title, c.company_name, c.company_id, c.company_inn, c.birth_date, c.channel,
  c.linkedin_link, c.city, c.address, c.custom_fields, c.source_metadata, c.notes, c.is_personal, c.suppress_deal_creation, c.contact_type, c.created_by, c.created_at, c.updated_at,
  COALESCE(d.deals_count, 0)::text AS deals_count,
  COALESCE(t.tasks_count, 0)::text AS tasks_count,
  u.name AS created_by_name
`;

const CONTACT_COUNT_JOIN = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS deals_count
    FROM deals
    WHERE deals.contact_id = c.id
      AND deals.tenant_id = c.tenant_id
      AND deals.deleted_at IS NULL
  ) d ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS tasks_count
    FROM crm_tasks
    WHERE crm_tasks.contact_id = c.id
      AND crm_tasks.tenant_id = c.tenant_id
      AND crm_tasks.deleted_at IS NULL
  ) t ON true
  -- Автор ограничен арендатором записи: таблица users не входит в список под RLS,
  -- поэтому JOIN только по id подставил бы имя пользователя чужого арендатора,
  -- окажись его идентификатор в created_by.
  LEFT JOIN users u ON u.id = c.created_by AND u.tenant_id = c.tenant_id
`;

function nullIfBlank(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

export interface ListContactsOptions {
  search?: string;
  companyId?: string;
  channel?: string;
  contactType?: string;
  limit: number;
  offset: number;
}

/**
 * Компания, к которой привязывается контакт.
 *
 * Причина существования этого шага: раньше название компании лежало у контакта
 * строкой и записи в `companies` не создавало — список компаний оставался пуст,
 * хотя в контактах компании были указаны. Теперь название всегда приводит либо к
 * существующей компании тенанта, либо к новой.
 *
 * Сопоставление по нормализованному названию (trim + lower): одну организацию
 * пишут с разным регистром и пробелами, и точное сравнение дало бы дубли.
 */
async function resolveCompany(
  tx: TransactionClient,
  tenantId: string,
  companyId: string | null,
  companyName: string,
  companyInn?: string | null,
  legalAddress?: string | null,
  ogrn?: string | null,
  kpp?: string | null,
): Promise<{ companyId: string | null; companyName: string }> {
  if (companyId !== null) {
    // Название берётся из самой компании: источник правды один, иначе строка у
    // контакта и запись в companies снова расходятся.
    const company = await tx.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM companies
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, companyId],
    );

    if (company !== null) return { companyId: company.id, companyName: company.name };

    // Ссылка на удалённую или чужую компанию. Раньше здесь связь просто
    // снималась, и название оставалось у контакта строкой без записи в
    // `companies` — тот самый дефект, из-за которого список компаний был пуст.
    // Поэтому дальше идёт обычный разбор по названию: у своего арендатора
    // появится своя компания с тем же именем.
  }

  const cleanInn = companyInn ? companyInn.replace(/\D/g, "").trim() : "";
  if (cleanInn) {
    const byInn = await tx.queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM companies
       WHERE tenant_id = $1 AND inn = $2 AND deleted_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [tenantId, cleanInn],
    );
    if (byInn !== null) {
      return { companyId: byInn.id, companyName: byInn.name };
    }
  }

  const name = companyName.trim();
  if (name === "" && !cleanInn) return { companyId: null, companyName: "" };
  const effectiveName = name || (cleanInn ? `Компания ИНН ${cleanInn}` : "");

  const existing = await tx.queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM companies
     WHERE tenant_id = $1 AND lower(btrim(name)) = lower($2) AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    [tenantId, effectiveName],
  );

  if (existing !== null) {
    if (cleanInn || legalAddress || ogrn || kpp) {
      await tx.query(
        `UPDATE companies SET
           inn = CASE WHEN inn = '' THEN COALESCE($3, '') ELSE inn END,
           legal_address = CASE WHEN legal_address = '' THEN COALESCE($4, '') ELSE legal_address END,
           ogrn = CASE WHEN ogrn = '' THEN COALESCE($5, '') ELSE ogrn END,
           kpp = CASE WHEN kpp = '' THEN COALESCE($6, '') ELSE kpp END
         WHERE id = $1 AND tenant_id = $2`,
        [existing.id, tenantId, cleanInn || null, legalAddress ?? null, ogrn ?? null, kpp ?? null],
      );
    }
    return { companyId: existing.id, companyName: existing.name };
  }

  const created = await tx.queryOneOrThrow<{ id: string; name: string }>(
    `INSERT INTO companies (tenant_id, name, inn, legal_address, ogrn, kpp, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name`,
    [
      tenantId,
      effectiveName,
      cleanInn,
      legalAddress ?? "",
      ogrn ?? "",
      kpp ?? "",
      "Создана автоматически при указании компании у контакта",
    ],
  );

  return { companyId: created.id, companyName: created.name };
}

export class ContactsService {
  /** Paginated list. Search covers name, phones, email and company name. */
  async list(
    tenantId: string,
    options: ListContactsOptions,
  ): Promise<{ items: ContactDTO[]; total: number }> {
    const conditions: string[] = ["c.tenant_id = $1", "c.deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    if (options.search !== undefined && options.search.length > 0) {
      params.push(`%${options.search}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(c.first_name ILIKE ${placeholder}
          OR c.last_name ILIKE ${placeholder}
          OR c.middle_name ILIKE ${placeholder}
          OR c.city ILIKE ${placeholder}
          OR c.address ILIKE ${placeholder}
          OR c.phone ILIKE ${placeholder}
          OR c.email ILIKE ${placeholder}
          OR c.job_title ILIKE ${placeholder}
          OR c.company_name ILIKE ${placeholder}
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(c.additional_phones) AS extra
            WHERE extra ->> 'number' ILIKE ${placeholder}
          )
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(c.socials) AS social
            WHERE social ->> 'value' ILIKE ${placeholder}
          ))`,
      );
    }

    if (options.companyId !== undefined) {
      params.push(options.companyId);
      conditions.push(`c.company_id = $${params.length}`);
    }

    if (options.channel !== undefined) {
      params.push(options.channel);
      conditions.push(`c.channel = $${params.length}`);
    }

    if (options.contactType !== undefined) {
      params.push(options.contactType);
      conditions.push(`c.contact_type = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM contacts c WHERE ${where}`,
      params,
    );

    params.push(options.limit, options.offset);

    const rows = await query<ContactRow>(
      `SELECT ${CONTACT_COLUMNS_WITH_COUNTS}
       FROM contacts c
       ${CONTACT_COUNT_JOIN}
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: rows.map(toContactDTO), total: Number(countRow?.total ?? 0) };
  }

  /**
   * Одна запись со счётчиками и именем создателя.
   *
   * Берётся тот же набор колонок, что и в списке: карточка показывает и число
   * сделок, и автора записи, а отдельный «лёгкий» SELECT заставлял бы её делать
   * второй запрос ровно за теми же данными.
   */
  async get(tenantId: string, id: string): Promise<ContactDTO | null> {
    const row = await queryOne<ContactRow>(
      `SELECT ${CONTACT_COLUMNS_WITH_COUNTS}
       FROM contacts c
       ${CONTACT_COUNT_JOIN}
       WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [tenantId, id],
    );

    return row === null ? null : toContactDTO(row);
  }

  /**
   * Создание контакта.
   *
   * `createdBy` приходит параметром из токена, а не из тела запроса: клиент не
   * должен уметь назначать автора записи. Он необязателен — контакт может
   * появиться от AI-агента или импорта, и тогда автора нет.
   *
   * Транзакция нужна из-за компании: она может создаваться здесь же, и при
   * падении вставки контакта осталась бы висеть пустая организация.
   */
  async create(
    tenantId: string,
    payload: CreateContactPayload,
    createdBy?: string,
  ): Promise<ContactDTO> {
    const primaryPhone = payload.phones?.[0]?.number;

    // Дедупликация при флаге merge_if_duplicate: если дубликат найден, объединяем в него
    if (payload.merge_if_duplicate && primaryPhone) {
      const dedupe = new ContactDedupeService();
      const duplicates = await dedupe.findDuplicatesByPhone(tenantId, primaryPhone);
      if (duplicates.length > 0 && duplicates[0]) {
        const existingId = duplicates[0].id;
        await this.update(tenantId, existingId, {
          email: payload.email || undefined,
          job_title: payload.job_title || undefined,
          company_name: payload.company_name || undefined,
          company_id: payload.company_id || undefined,
          city: payload.city || undefined,
          address: payload.address || undefined,
        });

        // Запуск обогащения
        const enrichment = new CrmEnrichmentService();
        void enrichment
          .enrichContact(tenantId, existingId, {
            phoneOverride: primaryPhone,
            channels: ["telegram", "max", "whatsapp"],
          })
          .catch(() => {});

        const updated = await this.get(tenantId, existingId);
        if (updated) return updated;
      }
    }

    const id = await transaction((tx) => this.createInTx(tx, tenantId, payload, createdBy));

    // Перечитываем ради имени создателя и счётчиков: RETURNING не отдаёт
    // значения JOIN-ов, и карточка сразу после создания показывала бы автора
    // как «Система».
    const contact = await this.get(tenantId, id);
    if (contact === null) throw new Error(`Contact ${id} disappeared right after insert`);

    // Автоматический запуск кросс-канального обогащения при наличии телефона (Single Ingestion Pipeline)
    const phoneToEnrich = contact.phone || primaryPhone;
    if (phoneToEnrich && phoneToEnrich.replace(/\D/g, "").length >= 10) {
      const enrichment = new CrmEnrichmentService();
      void enrichment
        .enrichContact(tenantId, id, {
          phoneOverride: phoneToEnrich,
          channels: ["telegram", "max", "whatsapp"],
        })
        .catch(() => {});
    }

    return contact;
  }

  /**
   * Вставка внутри чужой транзакции; возвращает идентификатор.
   *
   * Нужна каналам: `CrmPipelineService.processIncoming` создаёт контакт и сделку
   * одной транзакцией, а вложенный `transaction()` взял бы из пула второе
   * соединение — контакт зафиксировался бы даже при откате сделки.
   */
  async createInTx(
    tx: TransactionClient,
    tenantId: string,
    payload: CreateContactPayload,
    createdBy?: string,
  ): Promise<string> {
    const company = await resolveCompany(
      tx,
      tenantId,
      nullIfBlank(payload.company_id),
      payload.company_name ?? "",
      payload.company_inn,
    );

    const phones = splitPhones(payload.phones ?? []);
    const socials = normalizeSocials(payload.socials ?? []);

    if (phones.phone) {
      const activeChannels = await tx.query<{ channel: string }>(
        `SELECT channel FROM channel_accounts WHERE tenant_id = $1 AND status = 'connected' AND deleted_at IS NULL`,
        [tenantId],
      );
      const hasMaxAcc = activeChannels.some((c) => c.channel === "max" || c.channel === "max_bot");
      const hasWaAcc = activeChannels.some((c) => c.channel === "whatsapp");

      if (hasMaxAcc && !socials.some((s) => s.kind === "max")) {
        socials.push({ kind: "max", value: phones.phone });
      }
      if (hasWaAcc && !socials.some((s) => s.kind === "whatsapp")) {
        socials.push({ kind: "whatsapp", value: phones.phone });
      }
    }

    const effectiveChannel =
      payload.channel && payload.channel !== "phone"
        ? payload.channel
        : socials.some((s) => s.kind === "max")
          ? "max"
          : payload.channel ?? "phone";

    const row = await tx.queryOneOrThrow<{ id: string }>(
      `INSERT INTO contacts
         (tenant_id, first_name, last_name, middle_name,
          phone, phone_country_code, phone_calling_code, additional_phones,
          email, telegram_username, telegram_chat_id, whatsapp, socials,
          job_title, company_name, company_id, company_inn, birth_date, channel, linkedin_link,
          city, address,
          custom_fields, source_metadata, notes, contact_type, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb,
               $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, $24::jsonb, $25, $26, $27)
       RETURNING id`,
      [
        tenantId,
        payload.first_name,
        payload.last_name ?? "",
        payload.middle_name ?? "",
        phones.phone,
        phones.countryCode,
        phones.callingCode,
        JSON.stringify(phones.additional),
        nullIfBlank(payload.email),
        socialValue(socials, "telegram"),
        nullIfBlank(payload.telegram_chat_id),
        socialValue(socials, "whatsapp"),
        JSON.stringify(socials),
        payload.job_title ?? "",
        company.companyName,
        company.companyId,
        nullIfBlank(payload.company_inn),
        nullIfBlank(payload.birth_date ?? undefined),
        effectiveChannel,
        payload.linkedin_link ?? "",
        payload.city ?? "",
        payload.address ?? "",
        JSON.stringify(payload.custom_fields ?? {}),
        JSON.stringify(payload.source_metadata ?? {}),
        payload.notes ?? "",
        payload.contact_type ?? "customer",
        createdBy ?? null,
      ],
    );

    return row.id;
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdateContactPayload,
  ): Promise<ContactDTO | null> {
    const updatedId = await transaction(async (tx) => {
      const assignments: string[] = [];
      const params: SqlParam[] = [tenantId, id];

      const push = (column: string, value: SqlParam): void => {
        params.push(value);
        assignments.push(`${column} = $${params.length}`);
      };

      const pushJson = (column: string, value: unknown): void => {
        params.push(JSON.stringify(value));
        assignments.push(`${column} = $${params.length}::jsonb`);
      };

      if (payload.first_name !== undefined) push("first_name", payload.first_name);
      if (payload.last_name !== undefined) push("last_name", payload.last_name ?? "");
      if (payload.middle_name !== undefined) push("middle_name", payload.middle_name ?? "");

      // Список номеров приходит целиком: частичного обновления одного номера
      // нет намеренно — у Twenty PhonesFieldInput тоже отдаёт весь composite,
      // а патч по индексу ломался бы при одновременной правке из двух вкладок.
      if (payload.phones !== undefined) {
        const phones = splitPhones(payload.phones);
        push("phone", phones.phone);
        push("phone_country_code", phones.countryCode);
        push("phone_calling_code", phones.callingCode);
        pushJson("additional_phones", phones.additional);
      }

      if (payload.email !== undefined) push("email", nullIfBlank(payload.email));

      // Соцсети тоже приходят списком, и вместе с ними синхронизируются колонки
      // telegram_username / whatsapp: по ним ищет транспорт каналов.
      let socials: ContactSocialJson[] | null = null;
      if (payload.socials !== undefined) {
        socials = normalizeSocials(payload.socials);
        pushJson("socials", socials);
        push("telegram_username", socialValue(socials, "telegram"));
        push("whatsapp", socialValue(socials, "whatsapp"));
      }

      if (payload.telegram_chat_id !== undefined) {
        push("telegram_chat_id", nullIfBlank(payload.telegram_chat_id));
      }
      if (payload.job_title !== undefined) push("job_title", payload.job_title ?? "");

      // Компания: и переданный id, и переданное название приводят к одной
      // записи в companies, создавая её при необходимости.
      if (payload.company_id !== undefined || payload.company_name !== undefined) {
        const current = await tx.queryOne<{ company_id: string | null; company_name: string }>(
          `SELECT company_id, company_name FROM contacts
           WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenantId, id],
        );

        if (current === null) return null;

        // Явно переданное название важнее прежней связи: пользователь, стерев
        // название в карточке, ожидает, что компания отвяжется.
        const nextId = payload.company_name !== undefined
          ? nullIfBlank(payload.company_id)
          : nullIfBlank(payload.company_id) ?? current.company_id;

        const nextName = payload.company_name ?? current.company_name;

        const company = await resolveCompany(
          tx,
          tenantId,
          nextId,
          nextName,
          payload.company_inn,
        );
        push("company_name", company.companyName);
        push("company_id", company.companyId);
      }

      if (payload.company_inn !== undefined) {
        push("company_inn", nullIfBlank(payload.company_inn));
      }
      if (payload.birth_date !== undefined) {
        push("birth_date", nullIfBlank(payload.birth_date ?? undefined));
      }

      if (payload.channel !== undefined) push("channel", payload.channel);
      if (payload.contact_type !== undefined) push("contact_type", payload.contact_type);
      if (payload.linkedin_link !== undefined) push("linkedin_link", payload.linkedin_link ?? "");
      if (payload.city !== undefined) push("city", payload.city ?? "");
      if (payload.address !== undefined) push("address", payload.address ?? "");
      if (payload.notes !== undefined) push("notes", payload.notes);

      if (payload.created_at !== undefined) {
        const createdAt = nullIfBlank(payload.created_at);
        if (createdAt) {
          push("created_at", new Date(createdAt).toISOString());
        }
      }

      // custom_fields is merged, not replaced, so a partial PATCH cannot silently
      // drop keys the client did not send.
      if (payload.custom_fields !== undefined) {
        params.push(JSON.stringify(payload.custom_fields));
        assignments.push(`custom_fields = custom_fields || $${params.length}::jsonb`);
      }

      if (assignments.length === 0) return id;

      const updated = await tx.queryOne<{ id: string }>(
        `UPDATE contacts SET ${assignments.join(", ")}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id`,
        params,
      );

      return updated?.id ?? null;
    });

    if (updatedId === null) return null;

    // Перечитываем через get(): RETURNING не умеет отдать имя создателя и число
    // сделок — они приходят JOIN-ами. Без этого inline-правка одного поля
    // возвращала бы DTO без автора, и группа «Система» на карточке очищалась бы.
    const contact = await this.get(tenantId, updatedId);

    if (payload.phones !== undefined && contact?.phone && contact.phone.replace(/\D/g, "").length >= 10) {
      const enrichment = new CrmEnrichmentService();
      void enrichment
        .enrichContact(tenantId, updatedId, {
          phoneOverride: contact.phone,
          channels: ["telegram", "max", "whatsapp"],
        })
        .catch(() => {});
    }

    return contact;
  }

  /** Replaces custom_fields wholesale (PUT semantics for the JSONB bag). */
  async replaceCustomFields(
    tenantId: string,
    id: string,
    customFields: Record<string, unknown>,
  ): Promise<ContactDTO | null> {
    const updated = await queryOne<{ id: string }>(
      `UPDATE contacts SET custom_fields = $3::jsonb
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, id, JSON.stringify(customFields)],
    );

    return updated === null ? null : this.get(tenantId, id);
  }

  /** Number of non-deleted deals linked to this contact (cascade warning). */
  async countLinkedDeals(tenantId: string, id: string): Promise<number> {
    const row = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM deals
       WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL`,
      [tenantId, id],
    );

    return Number(row?.total ?? 0);
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `UPDATE contacts SET deleted_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, id],
    );

    return row !== null;
  }

  async bulkDelete(tenantId: string, payload: BulkActionPayload): Promise<{ count: number }> {
    if (payload.mode === "ids") {
      const ids = payload.ids ?? [];
      if (ids.length === 0) return { count: 0 };
      const rows = await query<{ id: string }>(
        `UPDATE contacts
         SET deleted_at = now()
         WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL
         RETURNING id`,
        [tenantId, ids],
      );
      return { count: rows.length };
    }

    const conditions: string[] = ["c.tenant_id = $1", "c.deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    const filters = payload.filters ?? {};
    if (typeof filters.search === "string" && filters.search.trim().length > 0) {
      params.push(`%${filters.search.trim()}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(c.first_name ILIKE ${placeholder}
          OR c.last_name ILIKE ${placeholder}
          OR c.email ILIKE ${placeholder}
          OR c.phone ILIKE ${placeholder}
          OR c.company_name ILIKE ${placeholder})`,
      );
    }

    if (typeof filters.company_id === "string" && filters.company_id.trim().length > 0) {
      params.push(filters.company_id.trim());
      conditions.push(`c.company_id = $${params.length}`);
    }

    if (typeof filters.channel === "string" && filters.channel.trim().length > 0 && filters.channel !== "all") {
      params.push(filters.channel.trim());
      conditions.push(`c.channel = $${params.length}`);
    }

    if (typeof filters.contact_type === "string" && filters.contact_type.trim().length > 0 && filters.contact_type !== "all") {
      params.push(filters.contact_type.trim());
      conditions.push(`c.contact_type = $${params.length}`);
    }

    if (Array.isArray(payload.excluded_ids) && payload.excluded_ids.length > 0) {
      params.push(payload.excluded_ids);
      conditions.push(`NOT (c.id = ANY($${params.length}::uuid[]))`);
    }

    const where = conditions.join(" AND ");
    const rows = await query<{ id: string }>(
      `UPDATE contacts c
       SET deleted_at = now()
       WHERE ${where}
       RETURNING c.id`,
      params,
    );

    return { count: rows.length };
  }

  /**
   * Устанавливает или снимает пометку личного контакта.
   * При установке isPersonal = true автоматически выставляет suppress_deal_creation = true.
   */
  async setPersonal(
    tenantId: string,
    id: string,
    isPersonal: boolean,
  ): Promise<ContactDTO | null> {
    await query(
      `UPDATE contacts
       SET is_personal = $3,
           suppress_deal_creation = CASE WHEN $3 THEN true ELSE suppress_deal_creation END,
           updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, id, isPersonal],
    );

    return this.get(tenantId, id);
  }

  /**
   * История обращений и сделок контакта с расчетом метрик LTV и повторных продаж.
   */
  async getDealsHistory(
    tenantId: string,
    contactId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<ContactDealsHistoryDTO> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    interface DealHistoryRow {
      id: string;
      title: string;
      budget: string;
      currency: string;
      stage_id: string;
      stage_name: string;
      stage_color: string;
      is_won: boolean;
      is_lost: boolean;
      pipeline_id: string;
      pipeline_name: string;
      owner_id: string | null;
      owner_name: string | null;
      created_at: Date | string;
      closed_at: Date | string | null;
    }

    const rows = await query<DealHistoryRow>(
      `SELECT d.id, d.title, d.budget::text, d.currency, d.stage_id, d.pipeline_id,
              d.owner_id, d.created_at, d.closed_at,
              s.name AS stage_name, COALESCE(s.color, 'slate') AS stage_color, s.is_won, s.is_lost,
              p.name AS pipeline_name,
              u.name AS owner_name
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       JOIN pipelines p ON p.id = d.pipeline_id
       LEFT JOIN users u ON u.id = d.owner_id AND u.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1 AND d.contact_id = $2 AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC`,
      [tenantId, contactId],
    );

    const total = rows.length;
    let wonDeals = 0;
    let lostDeals = 0;
    let totalBudget = 0;
    let wonRevenue = 0;
    let firstDealAt: string | null = null;
    let lastDealAt: string | null = null;

    const deals: ContactDealItemDTO[] = rows.slice(offset, offset + limit).map((r) => {
      const budgetNum = Number(r.budget || 0);
      const createdAtDate = new Date(r.created_at);
      const closedAtDate = r.closed_at ? new Date(r.closed_at) : null;
      const daysInPipeline = closedAtDate
        ? Math.max(0, Math.round((closedAtDate.getTime() - createdAtDate.getTime()) / (1000 * 60 * 60 * 24)))
        : Math.max(0, Math.round((Date.now() - createdAtDate.getTime()) / (1000 * 60 * 60 * 24)));

      return {
        id: r.id,
        title: r.title,
        budget: budgetNum,
        currency: r.currency,
        stageId: r.stage_id,
        stageName: r.stage_name,
        stageColorKey: r.stage_color,
        isWon: r.is_won,
        isLost: r.is_lost,
        pipelineId: r.pipeline_id,
        pipelineName: r.pipeline_name,
        ownerId: r.owner_id,
        ownerName: r.owner_name,
        createdAt: createdAtDate.toISOString(),
        closedAt: closedAtDate ? closedAtDate.toISOString() : null,
        daysInPipeline,
      };
    });

    for (const r of rows) {
      const b = Number(r.budget || 0);
      totalBudget += b;
      if (r.is_won) {
        wonDeals += 1;
        wonRevenue += b;
      } else if (r.is_lost) {
        lostDeals += 1;
      }
      const cAt = new Date(r.created_at).toISOString();
      if (!lastDealAt) lastDealAt = cAt;
      firstDealAt = cAt;
    }

    const openDeals = Math.max(0, total - (wonDeals + lostDeals));
    const avgCheck = wonDeals > 0 ? Math.round(wonRevenue / wonDeals) : (total > 0 ? Math.round(totalBudget / total) : 0);

    return {
      deals,
      metrics: {
        totalDeals: total,
        wonDeals,
        lostDeals,
        openDeals,
        totalBudget,
        wonRevenue,
        ltv: wonRevenue,
        avgCheck,
        firstDealAt,
        lastDealAt,
        repeatCustomer: total > 1,
      },
      total,
      limit,
      offset,
    };
  }

  /**
   * Высокоскоростной поиск контакта для определения номера (Caller ID / входящие звонки).
   * Выполняется за < 10 мс с использованием функционального индекса по цифрам телефона.
   */
  async lookupByPhone(tenantId: string, inputPhone: string): Promise<CallerIdLookupDTO> {
    const rawDigits = inputPhone.replace(/\D/g, "");
    if (!rawDigits || rawDigits.length < 3) {
      return {
        found: false,
        phone: inputPhone,
        normalizedPhone: rawDigits,
        contact: null,
      };
    }

    // Для российских/СНГ номеров берём последние 10 цифр (без префикса +7/8)
    const lookupSuffix = rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
    const normalizedE164 =
      rawDigits.length === 11 && (rawDigits.startsWith("7") || rawDigits.startsWith("8"))
        ? `+7${rawDigits.slice(1)}`
        : rawDigits.startsWith("+")
          ? rawDigits
          : `+${rawDigits}`;

    const row = await queryOne<{
      id: string;
      first_name: string;
      last_name: string;
      middle_name: string;
      phone: string;
      job_title: string;
      company_name: string;
      company_id: string | null;
      company_title: string | null;
      contact_type: string | null;
      active_deal_id: string | null;
      active_deal_title: string | null;
      active_deal_budget: string | number | null;
      active_deal_currency: string | null;
      active_deal_stage_name: string | null;
    }>(
      `SELECT
         c.id, c.first_name, c.last_name, c.middle_name, c.phone, c.contact_type,
         c.job_title, c.company_name, c.company_id,
         comp.name AS company_title,
         d.id AS active_deal_id,
         d.title AS active_deal_title,
         d.budget AS active_deal_budget,
         d.currency AS active_deal_currency,
         st.name AS active_deal_stage_name
       FROM contacts c
       LEFT JOIN companies comp
         ON comp.id = c.company_id AND comp.tenant_id = c.tenant_id
       LEFT JOIN LATERAL (
         SELECT d.id, d.title, d.budget, d.currency, d.stage_id
         FROM deals d
         LEFT JOIN stages s ON s.id = d.stage_id
         WHERE d.contact_id = c.id
           AND d.tenant_id = c.tenant_id
           AND d.deleted_at IS NULL
           AND COALESCE(s.is_won, false) = false
           AND COALESCE(s.is_lost, false) = false
         ORDER BY d.created_at DESC
         LIMIT 1
       ) d ON true
       LEFT JOIN stages st
         ON st.id = d.stage_id
       WHERE c.tenant_id = $1
         AND c.deleted_at IS NULL
         AND (
           regexp_replace(c.phone, '\\D', '', 'g') LIKE '%' || $2
           OR c.additional_phones::text LIKE '%' || $2 || '%'
         )
       LIMIT 1`,
      [tenantId, lookupSuffix],
    );

    if (!row) {
      return {
        found: false,
        phone: inputPhone,
        normalizedPhone: normalizedE164,
        contact: null,
      };
    }

    const resolvedCompany = row.company_name || row.company_title || undefined;
    const fullName =
      [row.last_name, row.first_name, row.middle_name].filter(Boolean).join(" ").trim() ||
      "Без имени";

    return {
      found: true,
      phone: inputPhone,
      normalizedPhone: normalizedE164,
      contact: {
        id: row.id,
        contactType: (row.contact_type as ContactType) === "vendor" ? "vendor" : "customer",
        fullName,
        firstName: row.first_name,
        lastName: row.last_name,
        middleName: row.middle_name || undefined,
        phone: row.phone,
        jobTitle: row.job_title || undefined,
        companyName: resolvedCompany,
        companyId: row.company_id || undefined,
        crmUrl: `https://voxly.getvoxly.ru/crm/contacts/${row.id}`,
        activeDeal: row.active_deal_id
          ? {
              id: row.active_deal_id,
              title: row.active_deal_title || "Сделка",
              budget: Number(row.active_deal_budget) || 0,
              currency: row.active_deal_currency || "RUB",
              stageName: row.active_deal_stage_name || "В работе",
            }
          : null,
      },
    };
  }
}
