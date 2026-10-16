import { z } from "zod";

// ---------------------------------------------------------------------------
// Russian legal requisites
//
// INN: 10 digits (legal entity) or 12 (sole trader), BIK: 9 digits,
// OGRN: 13 or 15 digits, settlement account: 20 digits. Fields are optional at
// the API boundary (a lead may be captured before its paperwork), but when a
// value is present it must be well-formed.
// ---------------------------------------------------------------------------

const digitsOnly = (length: number[], label: string) =>
  z
    .string()
    .refine(
      (value) => value === "" || (/^\d+$/.test(value) && length.includes(value.length)),
      `${label} must contain ${length.join(" or ")} digits`,
    );

export const innSchema = digitsOnly([10, 12], "INN");
export const ogrnSchema = digitsOnly([13, 15], "OGRN");
export const bikSchema = digitsOnly([9], "BIK");
export const accountNumberSchema = digitsOnly([20], "Account number");

const optionalUuid = z.string().uuid().optional().or(z.literal(""));

export const createCompanySchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  /** Домен — естественный ключ дедупликации: названия пишут по-разному, домен одинаково. */
  domain_name: z.string().max(200).optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  inn: innSchema.optional(),
  ogrn: ogrnSchema.optional(),
  bik: bikSchema.optional(),
  account_number: accountNumberSchema.optional(),
  legal_address: z.string().max(300).optional().or(z.literal("")),
  manager_name: z.string().max(100).optional().or(z.literal("")),
  manager_id: optionalUuid,
  /** Twenty: company.annualRevenue (CurrencyMetadata), группа business. */
  annual_revenue: z.number().min(0, "Revenue cannot be negative").nullable().optional(),
  /** Twenty: company.linkedinLink, группа contact. */
  linkedin_link: z.string().url("Invalid URL").max(300).optional().or(z.literal("")),
  /**
   * Twenty: company.address (AddressMetadata) — их подполя addressCity,
   * addressStreet1, addressCountry, addressPostcode. Фактический адрес отдельно
   * от legal_address: юридический берётся из реквизитов и часто не совпадает.
   */
  address_city: z.string().max(120).optional().or(z.literal("")),
  address_street: z.string().max(200).optional().or(z.literal("")),
  address_country: z.string().max(120).optional().or(z.literal("")),
  address_postcode: z.string().max(20).optional().or(z.literal("")),
  notes: z.string().max(4000).optional().or(z.literal("")),
  custom_fields: z.record(z.unknown()).optional(),
});

export const updateCompanySchema = createCompanySchema.partial();

export type CreateCompanyPayload = z.infer<typeof createCompanySchema>;
export type UpdateCompanyPayload = z.infer<typeof updateCompanySchema>;

export interface CompanyRow {
  id: string;
  tenant_id: string;
  name: string;
  domain_name: string;
  phone: string;
  email: string;
  inn: string;
  ogrn: string;
  bik: string;
  account_number: string;
  legal_address: string;
  manager_name: string;
  manager_id: string | null;
  annual_revenue: string | null;
  linkedin_link: string;
  address_city: string;
  address_street: string;
  address_country: string;
  address_postcode: string;
  notes: string;
  custom_fields: Record<string, unknown>;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  /** Агрегаты приходят LATERAL-подзапросами в выборке списка. */
  contacts_count?: string | null;
  deals_count?: string | null;
  deals_budget_total?: string | null;
  created_by_name?: string | null;
}

export interface CompanyRequisitesDTO {
  inn: string;
  ogrn: string;
  bik: string;
  accountNumber: string;
  legalAddress: string;
}

/** Twenty: company.address (AddressMetadata) — только используемые подполя. */
export interface CompanyAddressDTO {
  city: string;
  street: string;
  country: string;
  postcode: string;
}

export interface CompanyDTO {
  id: string;
  name: string;
  domainName: string;
  phone: string;
  email: string;
  requisites: CompanyRequisitesDTO;
  managerName: string;
  managerId: string | null;
  /** null, а не 0: «доход неизвестен» и «доход нулевой» — разные факты. */
  annualRevenue: number | null;
  linkedinLink: string;
  address: CompanyAddressDTO;
  notes: string;
  customFields: Record<string, unknown>;
  createdBy: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Счётчики связей для колонок таблицы; 0, если выборка без агрегатов. */
  contactsCount: number;
  dealsCount: number;
  dealsBudgetTotal: number;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

export function toCompanyDTO(row: CompanyRow): CompanyDTO {
  return {
    id: row.id,
    name: row.name,
    domainName: row.domain_name,
    phone: row.phone,
    email: row.email,
    requisites: {
      inn: row.inn,
      ogrn: row.ogrn,
      bik: row.bik,
      accountNumber: row.account_number,
      legalAddress: row.legal_address,
    },
    managerName: row.manager_name,
    managerId: row.manager_id,
    // NUMERIC приходит строкой: pg не приводит его к number, чтобы не терять точность.
    annualRevenue: row.annual_revenue === null ? null : Number(row.annual_revenue),
    linkedinLink: row.linkedin_link,
    address: {
      city: row.address_city,
      street: row.address_street,
      country: row.address_country,
      postcode: row.address_postcode,
    },
    notes: row.notes,
    customFields: row.custom_fields,
    createdBy: row.created_by,
    createdByName: row.created_by_name ?? null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    contactsCount: Number(row.contacts_count ?? 0),
    dealsCount: Number(row.deals_count ?? 0),
    dealsBudgetTotal: Number(row.deals_budget_total ?? 0),
  };
}

/** Aggregated counters shown on the company detail panel. */
export interface CompanyStatsDTO {
  contactsCount: number;
  dealsCount: number;
  dealsBudgetTotal: number;
}
