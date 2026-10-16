import type {
  ContactDTO,
  ContactRow,
  ContactSocialJson,
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
  c.job_title, c.company_name, c.company_id, c.channel,
  c.linkedin_link, c.custom_fields, c.notes, c.created_by, c.created_at, c.updated_at,
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

function nullIfBlank(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  return value;
}

export interface ListContactsOptions {
  search?: string;
  companyId?: string;
  channel?: string;
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

  const name = companyName.trim();
  if (name === "") return { companyId: null, companyName: "" };

  const existing = await tx.queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM companies
     WHERE tenant_id = $1 AND lower(btrim(name)) = lower($2) AND deleted_at IS NULL
     ORDER BY created_at ASC
     LIMIT 1`,
    [tenantId, name],
  );

  if (existing !== null) return { companyId: existing.id, companyName: existing.name };

  const created = await tx.queryOneOrThrow<{ id: string; name: string }>(
    `INSERT INTO companies (tenant_id, name, notes)
     VALUES ($1, $2, $3)
     RETURNING id, name`,
    [tenantId, name, "Создана автоматически при указании компании у контакта"],
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
    const id = await transaction((tx) => this.createInTx(tx, tenantId, payload, createdBy));

    // Перечитываем ради имени создателя и счётчиков: RETURNING не отдаёт
    // значения JOIN-ов, и карточка сразу после создания показывала бы автора
    // как «Система».
    const contact = await this.get(tenantId, id);
    if (contact === null) throw new Error(`Contact ${id} disappeared right after insert`);

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
    );

    const phones = splitPhones(payload.phones ?? []);
    const socials = normalizeSocials(payload.socials ?? []);

    const row = await tx.queryOneOrThrow<{ id: string }>(
      `INSERT INTO contacts
         (tenant_id, first_name, last_name, middle_name,
          phone, phone_country_code, phone_calling_code, additional_phones,
          email, telegram_username, telegram_chat_id, whatsapp, socials,
          job_title, company_name, company_id, channel, linkedin_link,
          custom_fields, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13::jsonb,
               $14, $15, $16, $17, $18, $19::jsonb, $20, $21)
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
        payload.channel ?? "phone",
        payload.linkedin_link ?? "",
        JSON.stringify(payload.custom_fields ?? {}),
        payload.notes ?? "",
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

        const company = await resolveCompany(tx, tenantId, nextId, nextName);
        push("company_name", company.companyName);
        push("company_id", company.companyId);
      }

      if (payload.channel !== undefined) push("channel", payload.channel);
      if (payload.linkedin_link !== undefined) push("linkedin_link", payload.linkedin_link ?? "");
      if (payload.notes !== undefined) push("notes", payload.notes);

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
    return this.get(tenantId, updatedId);
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
}
