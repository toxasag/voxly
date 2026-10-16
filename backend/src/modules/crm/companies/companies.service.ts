import type {
  CompanyDTO,
  CompanyRow,
  CompanyStatsDTO,
  CreateCompanyPayload,
  UpdateCompanyPayload,
} from "./companies.types.js";
import { toCompanyDTO } from "./companies.types.js";
import { query, queryOne, queryOneOrThrow, type SqlParam } from "../../../db/client.js";

/**
 * Колонки списка вместе с агрегатами связей.
 *
 * Два LATERAL-подзапроса вместо GROUP BY: группировка по всем полям компании
 * ради двух COUNT заставила бы БД сортировать весь набор, а подзапросы идут по
 * индексам `contacts.company_id` и `deals.company_id`.
 */
const COMPANY_COLUMNS_WITH_COUNTS = `
  c.id, c.tenant_id, c.name, c.domain_name, c.phone, c.email, c.inn, c.ogrn, c.bik,
  c.account_number, c.legal_address, c.manager_name, c.manager_id, c.annual_revenue,
  c.linkedin_link, c.address_city, c.address_street, c.address_country, c.address_postcode,
  c.notes, c.custom_fields, c.created_by, c.created_at, c.updated_at,
  COALESCE(ct.contacts_count, 0)::text AS contacts_count,
  COALESCE(d.deals_count, 0)::text AS deals_count,
  COALESCE(d.deals_budget_total, 0)::text AS deals_budget_total,
  u.name AS created_by_name
`;

const COMPANY_COUNT_JOINS = `
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS contacts_count
    FROM contacts
    WHERE contacts.company_id = c.id
      AND contacts.tenant_id = c.tenant_id
      AND contacts.deleted_at IS NULL
  ) ct ON true
  LEFT JOIN LATERAL (
    SELECT COUNT(*) AS deals_count, COALESCE(SUM(budget), 0) AS deals_budget_total
    FROM deals
    WHERE deals.company_id = c.id
      AND deals.tenant_id = c.tenant_id
      AND deals.deleted_at IS NULL
  ) d ON true
  -- Автор ограничен арендатором записи: users вне RLS, и JOIN только по id
  -- подставил бы имя пользователя чужого арендатора.
  LEFT JOIN users u ON u.id = c.created_by AND u.tenant_id = c.tenant_id
`;

function nullIfBlank(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  return value;
}

export interface ListCompaniesOptions {
  search?: string;
  managerId?: string;
  limit: number;
  offset: number;
}

export class CompaniesService {
  async list(
    tenantId: string,
    options: ListCompaniesOptions,
  ): Promise<{ items: CompanyDTO[]; total: number }> {
    const conditions: string[] = ["c.tenant_id = $1", "c.deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    if (options.search !== undefined && options.search.length > 0) {
      params.push(`%${options.search}%`);
      const placeholder = `$${params.length}`;
      conditions.push(
        `(c.name ILIKE ${placeholder}
          OR c.domain_name ILIKE ${placeholder}
          OR c.inn ILIKE ${placeholder}
          OR c.phone ILIKE ${placeholder}
          OR c.manager_name ILIKE ${placeholder})`,
      );
    }

    if (options.managerId !== undefined) {
      params.push(options.managerId);
      conditions.push(`c.manager_id = $${params.length}`);
    }

    const where = conditions.join(" AND ");

    const countRow = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM companies c WHERE ${where}`,
      params,
    );

    params.push(options.limit, options.offset);

    const rows = await query<CompanyRow>(
      `SELECT ${COMPANY_COLUMNS_WITH_COUNTS}
       FROM companies c
       ${COMPANY_COUNT_JOINS}
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return { items: rows.map(toCompanyDTO), total: Number(countRow?.total ?? 0) };
  }

  /**
   * Одна компания вместе с агрегатами и именем создателя: карточка показывает
   * и счётчики связей, и автора записи, поэтому «лёгкий» SELECT заставлял бы её
   * делать второй запрос за теми же данными.
   */
  async get(tenantId: string, id: string): Promise<CompanyDTO | null> {
    const row = await queryOne<CompanyRow>(
      `SELECT ${COMPANY_COLUMNS_WITH_COUNTS}
       FROM companies c
       ${COMPANY_COUNT_JOINS}
       WHERE c.tenant_id = $1 AND c.id = $2 AND c.deleted_at IS NULL`,
      [tenantId, id],
    );

    return row === null ? null : toCompanyDTO(row);
  }

  async create(
    tenantId: string,
    payload: CreateCompanyPayload,
    createdBy?: string,
  ): Promise<CompanyDTO> {
    const row = await queryOneOrThrow<CompanyRow>(
      `INSERT INTO companies
         (tenant_id, name, domain_name, phone, email, inn, ogrn, bik, account_number, legal_address,
          manager_name, manager_id, annual_revenue, linkedin_link, address_city, address_street,
          address_country, address_postcode, notes, custom_fields, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
               $19, $20::jsonb, $21)
       RETURNING id`,
      [
        tenantId,
        payload.name,
        payload.domain_name ?? "",
        payload.phone ?? "",
        payload.email ?? "",
        payload.inn ?? "",
        payload.ogrn ?? "",
        payload.bik ?? "",
        payload.account_number ?? "",
        payload.legal_address ?? "",
        payload.manager_name ?? "",
        nullIfBlank(payload.manager_id),
        payload.annual_revenue ?? null,
        payload.linkedin_link ?? "",
        payload.address_city ?? "",
        payload.address_street ?? "",
        payload.address_country ?? "",
        payload.address_postcode ?? "",
        payload.notes ?? "",
        JSON.stringify(payload.custom_fields ?? {}),
        createdBy ?? null,
      ],
    );

    // Перечитываем через get(): RETURNING не отдаёт имя создателя и агрегаты —
    // они приходят JOIN-ами. Без этого карточка сразу после создания показывала
    // бы автора как «Система», хотя запись создал пользователь.
    const company = await this.get(tenantId, row.id);
    if (company === null) throw new Error(`Company ${row.id} disappeared right after insert`);

    return company;
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdateCompanyPayload,
  ): Promise<CompanyDTO | null> {
    const assignments: string[] = [];
    const params: SqlParam[] = [tenantId, id];

    const push = (column: string, value: SqlParam): void => {
      params.push(value);
      assignments.push(`${column} = $${params.length}`);
    };

    if (payload.name !== undefined) push("name", payload.name);
    if (payload.domain_name !== undefined) push("domain_name", payload.domain_name ?? "");
    if (payload.phone !== undefined) push("phone", payload.phone);
    if (payload.email !== undefined) push("email", payload.email);
    if (payload.inn !== undefined) push("inn", payload.inn);
    if (payload.ogrn !== undefined) push("ogrn", payload.ogrn);
    if (payload.bik !== undefined) push("bik", payload.bik);
    if (payload.account_number !== undefined) push("account_number", payload.account_number);
    if (payload.legal_address !== undefined) push("legal_address", payload.legal_address);
    if (payload.manager_name !== undefined) push("manager_name", payload.manager_name);
    if (payload.manager_id !== undefined) push("manager_id", nullIfBlank(payload.manager_id));
    // null допустим намеренно: так со карточки очищают неизвестный доход,
    // и это отличается от 0 («доход нулевой»).
    if (payload.annual_revenue !== undefined) push("annual_revenue", payload.annual_revenue ?? null);
    if (payload.linkedin_link !== undefined) push("linkedin_link", payload.linkedin_link ?? "");
    if (payload.address_city !== undefined) push("address_city", payload.address_city ?? "");
    if (payload.address_street !== undefined) push("address_street", payload.address_street ?? "");
    if (payload.address_country !== undefined) push("address_country", payload.address_country ?? "");
    if (payload.address_postcode !== undefined) push("address_postcode", payload.address_postcode ?? "");
    if (payload.notes !== undefined) push("notes", payload.notes);

    if (payload.custom_fields !== undefined) {
      params.push(JSON.stringify(payload.custom_fields));
      assignments.push(`custom_fields = custom_fields || $${params.length}::jsonb`);
    }

    if (assignments.length === 0) {
      return this.get(tenantId, id);
    }

    const updated = await queryOne<{ id: string }>(
      `UPDATE companies SET ${assignments.join(", ")}
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      params,
    );

    if (updated === null) return null;

    // Перечитываем: RETURNING не отдаёт агрегаты и имя создателя — они приходят
    // JOIN-ами, и без этого inline-правка обнуляла бы счётчики на карточке.
    return this.get(tenantId, id);
  }

  /** Contact and deal counters for the company detail panel. */
  async stats(tenantId: string, id: string): Promise<CompanyStatsDTO> {
    const row = await queryOne<{
      contacts_count: string;
      deals_count: string;
      deals_budget_total: string;
    }>(
      `SELECT
         (SELECT COUNT(*)::text FROM contacts
           WHERE tenant_id = $1 AND company_id = $2 AND deleted_at IS NULL) AS contacts_count,
         (SELECT COUNT(*)::text FROM deals
           WHERE tenant_id = $1 AND company_id = $2 AND deleted_at IS NULL) AS deals_count,
         (SELECT COALESCE(SUM(budget), 0)::text FROM deals
           WHERE tenant_id = $1 AND company_id = $2 AND deleted_at IS NULL) AS deals_budget_total`,
      [tenantId, id],
    );

    return {
      contactsCount: Number(row?.contacts_count ?? 0),
      dealsCount: Number(row?.deals_count ?? 0),
      dealsBudgetTotal: Number(row?.deals_budget_total ?? 0),
    };
  }

  async softDelete(tenantId: string, id: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `UPDATE companies SET deleted_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, id],
    );

    return row !== null;
  }
}
