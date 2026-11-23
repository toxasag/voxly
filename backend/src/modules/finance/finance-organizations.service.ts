import { withTenant, type SqlParam, type TransactionClient } from "../../db/client.js";
import { NotFoundError, ValidationError } from "../../plugins/errorHandler.js";
import { decryptSecret, encryptSecret } from "../../services/credentials-cipher.js";
import { elbaClient, type ElbaBankAccount, type ElbaOrganization } from "./elba.client.js";
import {
  normalizeInvoiceFormConfig,
  vatModeToRate,
  type CreateOrganizationPayload,
  type FinanceOrganizationDTO,
  type InvoiceIssuerSnapshot,
  type OrgType,
  type UpdateOrganizationPayload,
  type VatMode,
} from "./finance-organizations.types.js";

interface OrgRow {
  id: string;
  tenant_id: string;
  is_default: boolean;
  org_type: OrgType;
  name: string;
  short_name: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legal_address: string;
  actual_address: string;
  phone: string;
  email: string;
  website: string;
  edo_info: string;
  bank_name: string;
  bik: string;
  corr_account: string;
  settlement_account: string;
  director_title: string;
  director_name: string;
  accountant_name: string;
  vat_mode: VatMode;
  logo_url: string;
  logo_width: number;
  stamp_url: string;
  signature_url: string;
  invoice_config: unknown;
  elba_enabled: boolean;
  elba_api_key_enc: string;
  elba_api_key_hint: string;
  elba_organization_id: string;
  elba_organization_name: string;
  elba_bank_account_id: string;
  elba_auto_sync_invoices: boolean;
  elba_last_sync_at: Date | string | null;
  elba_last_error: string;
  created_at: Date | string;
  updated_at: Date | string;
}

const ORG_COLS = `
  id, tenant_id, is_default, org_type, name, short_name, inn, kpp, ogrn,
  legal_address, actual_address, phone, email, website, edo_info,
  bank_name, bik, corr_account, settlement_account,
  director_title, director_name, accountant_name, vat_mode,
  logo_url, logo_width, stamp_url, signature_url, invoice_config,
  elba_enabled, elba_api_key_enc, elba_api_key_hint,
  elba_organization_id, elba_organization_name, elba_bank_account_id,
  elba_auto_sync_invoices, elba_last_sync_at, elba_last_error,
  created_at, updated_at
`;

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : v);

function makeKeyHint(rawKey: string): string {
  const clean = rawKey.trim();
  if (clean.length <= 4) return "••••";
  return `••••${clean.slice(-4)}`;
}

function toDto(r: OrgRow): FinanceOrganizationDTO {
  const vatMode: VatMode = r.vat_mode || "none";
  return {
    id: r.id,
    isDefault: r.is_default,
    orgType: r.org_type || "ip",
    name: r.name,
    shortName: r.short_name || "",
    inn: r.inn || "",
    kpp: r.kpp || "",
    ogrn: r.ogrn || "",
    legalAddress: r.legal_address || "",
    actualAddress: r.actual_address || "",
    phone: r.phone || "",
    email: r.email || "",
    website: r.website || "",
    edoInfo: r.edo_info || "",
    bankName: r.bank_name || "",
    bik: r.bik || "",
    corrAccount: r.corr_account || "",
    settlementAccount: r.settlement_account || "",
    directorTitle: r.director_title || "Индивидуальный предприниматель",
    directorName: r.director_name || "",
    accountantName: r.accountant_name || "",
    vatMode,
    vatRate: vatModeToRate(vatMode),
    logoUrl: r.logo_url || "",
    logoWidth: Number(r.logo_width || 140),
    stampUrl: r.stamp_url || "",
    signatureUrl: r.signature_url || "",
    invoiceConfig: normalizeInvoiceFormConfig(r.invoice_config),
    elbaEnabled: Boolean(r.elba_enabled),
    elbaHasApiKey: Boolean(r.elba_api_key_enc),
    elbaApiKeyHint: r.elba_api_key_hint || "",
    elbaOrganizationId: r.elba_organization_id || "",
    elbaOrganizationName: r.elba_organization_name || "",
    elbaBankAccountId: r.elba_bank_account_id || "",
    elbaAutoSyncInvoices: Boolean(r.elba_auto_sync_invoices),
    elbaLastSyncAt: r.elba_last_sync_at ? iso(r.elba_last_sync_at) : null,
    elbaLastError: r.elba_last_error || "",
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function buildIssuerSnapshot(org: FinanceOrganizationDTO): InvoiceIssuerSnapshot {
  return {
    organizationId: org.id,
    orgType: org.orgType,
    name: org.name,
    shortName: org.shortName,
    inn: org.inn,
    kpp: org.kpp,
    ogrn: org.ogrn,
    legalAddress: org.legalAddress,
    actualAddress: org.actualAddress,
    phone: org.phone,
    email: org.email,
    website: org.website,
    edoInfo: org.edoInfo,
    bankName: org.bankName,
    bik: org.bik,
    corrAccount: org.corrAccount,
    settlementAccount: org.settlementAccount,
    directorTitle: org.directorTitle,
    directorName: org.directorName,
    accountantName: org.accountantName,
    logoUrl: org.logoUrl,
    logoWidth: org.logoWidth,
    stampUrl: org.stampUrl,
    signatureUrl: org.signatureUrl,
    invoiceConfig: org.invoiceConfig,
  };
}

export class FinanceOrganizationsService {
  /** Ensures at least one organization exists (seeded from print_template_settings if available). */
  private async ensureSeededInTx(tx: TransactionClient, tenantId: string): Promise<void> {
    const existing = await tx.queryOne<{ id: string }>(
      `SELECT id FROM finance_organizations WHERE tenant_id = $1 AND deleted_at IS NULL LIMIT 1`,
      [tenantId],
    );
    if (existing) return;

    const pts = await tx.queryOne<{
      company_name: string;
      company_address: string;
      company_phone: string;
      company_email: string;
      company_website: string;
      company_inn: string;
      company_ogrn: string;
      company_kpp: string;
      bank_name: string;
      bik: string;
      corr_account: string;
      settlement_account: string;
      director_name: string;
      accountant_name: string;
      logo_url: string;
    }>(
      `SELECT company_name, company_address, company_phone, company_email, company_website,
              company_inn, company_ogrn, company_kpp, bank_name, bik, corr_account,
              settlement_account, director_name, accountant_name, logo_url
       FROM print_template_settings WHERE tenant_id = $1`,
      [tenantId],
    );

    const inn = (pts?.company_inn ?? "").trim();
    const orgType: OrgType = inn.length === 10 ? "ooo" : "ip";
    const name = pts?.company_name?.trim() || "Моя организация";
    const directorTitle =
      orgType === "ooo" ? "Генеральный директор" : "Индивидуальный предприниматель";

    await tx.query(
      `INSERT INTO finance_organizations (
         tenant_id, is_default, org_type, name, inn, kpp, ogrn,
         legal_address, phone, email, website,
         bank_name, bik, corr_account, settlement_account,
         director_title, director_name, accountant_name, vat_mode, logo_url
       )
       VALUES ($1, true, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, 'none', $18)`,
      [
        tenantId,
        orgType,
        name,
        inn,
        pts?.company_kpp ?? "",
        pts?.company_ogrn ?? "",
        pts?.company_address ?? "",
        pts?.company_phone ?? "",
        pts?.company_email ?? "",
        pts?.company_website ?? "",
        pts?.bank_name ?? "",
        pts?.bik ?? "",
        pts?.corr_account ?? "",
        pts?.settlement_account ?? "",
        directorTitle,
        pts?.director_name ?? "",
        pts?.accountant_name ?? "",
        pts?.logo_url ?? "",
      ],
    );
  }

  async list(tenantId: string): Promise<FinanceOrganizationDTO[]> {
    return withTenant(tenantId, async (tx) => {
      await this.ensureSeededInTx(tx, tenantId);
      const rows = await tx.query<OrgRow>(
        `SELECT ${ORG_COLS}
         FROM finance_organizations
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY is_default DESC, created_at ASC`,
        [tenantId],
      );
      return rows.map(toDto);
    });
  }

  async getById(tenantId: string, id: string): Promise<FinanceOrganizationDTO> {
    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOne<OrgRow>(
        `SELECT ${ORG_COLS}
         FROM finance_organizations
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      if (!row) throw new NotFoundError("Organization not found");
      return toDto(row);
    });
  }

  async getDefaultOrByIdInTx(
    tx: TransactionClient,
    tenantId: string,
    orgId?: string | null,
  ): Promise<FinanceOrganizationDTO | null> {
    await this.ensureSeededInTx(tx, tenantId);
    if (orgId) {
      const explicit = await tx.queryOne<OrgRow>(
        `SELECT ${ORG_COLS}
         FROM finance_organizations
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, orgId],
      );
      if (explicit) return toDto(explicit);
    }
    const def = await tx.queryOne<OrgRow>(
      `SELECT ${ORG_COLS}
       FROM finance_organizations
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY is_default DESC, created_at ASC
       LIMIT 1`,
      [tenantId],
    );
    return def ? toDto(def) : null;
  }

  async getDecryptedElbaCredentials(
    tenantId: string,
    orgId: string,
  ): Promise<{
    apiKey: string;
    organizationId: string;
    bankAccountId: string;
    enabled: boolean;
    autoSync: boolean;
  } | null> {
    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOne<OrgRow>(
        `SELECT ${ORG_COLS}
         FROM finance_organizations
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, orgId],
      );
      if (!row || !row.elba_api_key_enc) return null;
      return {
        apiKey: decryptSecret(row.elba_api_key_enc),
        organizationId: row.elba_organization_id,
        bankAccountId: row.elba_bank_account_id,
        enabled: row.elba_enabled,
        autoSync: row.elba_auto_sync_invoices,
      };
    });
  }

  /**
   * Синхронизирует расчётный счёт организации (`bank_name` + `settlement_account`)
   * с безналичным счётом (`account_type = 'bank'`) в `cash_accounts`, чтобы
   * карточка расчётного счёта автоматически появлялась на главной странице «Финансы».
   */
  private async syncOrganizationBankAccountInTx(
    tx: TransactionClient,
    tenantId: string,
    org: OrgRow,
  ): Promise<void> {
    const cleanBank = (org.bank_name || "").trim();
    const cleanSettlement = (org.settlement_account || "").trim();
    if (!cleanBank && !cleanSettlement) return;

    const displayName = cleanBank ? `Расчётный счёт (${cleanBank})` : "Расчётный счёт";

    const existingByOrg = await tx.queryOne<{ id: string }>(
      `SELECT id
       FROM cash_accounts
       WHERE tenant_id = $1 AND organization_id = $2 AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId, org.id],
    );

    if (existingByOrg) {
      await tx.query(
        `UPDATE cash_accounts
         SET name = $3, account_number = $4, updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [tenantId, existingByOrg.id, displayName, cleanSettlement],
      );
      return;
    }

    if (cleanSettlement) {
      const existingByNumber = await tx.queryOne<{ id: string }>(
        `SELECT id
         FROM cash_accounts
         WHERE tenant_id = $1
           AND account_type = 'bank'
           AND organization_id IS NULL
           AND trim(account_number) = $2
           AND deleted_at IS NULL
         LIMIT 1`,
        [tenantId, cleanSettlement],
      );
      if (existingByNumber) {
        await tx.query(
          `UPDATE cash_accounts
           SET organization_id = $3, name = $4, account_number = $5, updated_at = now()
           WHERE tenant_id = $1 AND id = $2`,
          [tenantId, existingByNumber.id, org.id, displayName, cleanSettlement],
        );
        return;
      }
    }

    await tx.query(
      `INSERT INTO cash_accounts (tenant_id, organization_id, name, account_type, account_number, currency, balance, is_default)
       VALUES ($1, $2, $3, 'bank', $4, 'RUB', 0, false)`,
      [tenantId, org.id, displayName, cleanSettlement],
    );
  }

  async create(
    tenantId: string,
    payload: CreateOrganizationPayload,
  ): Promise<FinanceOrganizationDTO> {
    return withTenant(tenantId, async (tx) => {
      const existingCount = await tx.queryOne<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM finance_organizations WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId],
      );
      const isFirst = Number(existingCount?.cnt ?? 0) === 0;
      const shouldBeDefault = isFirst || Boolean(payload.is_default);

      if (shouldBeDefault) {
        await tx.query(
          `UPDATE finance_organizations SET is_default = false WHERE tenant_id = $1 AND is_default = true`,
          [tenantId],
        );
      }

      const config = normalizeInvoiceFormConfig(payload.invoice_config);
      let elbaEnc = "";
      let elbaHint = "";
      if (payload.elba_api_key && payload.elba_api_key.trim()) {
        elbaEnc = encryptSecret(payload.elba_api_key.trim());
        elbaHint = makeKeyHint(payload.elba_api_key.trim());
      }

      const row = await tx.queryOneOrThrow<OrgRow>(
        `INSERT INTO finance_organizations (
           tenant_id, is_default, org_type, name, short_name, inn, kpp, ogrn,
           legal_address, actual_address, phone, email, website, edo_info,
           bank_name, bik, corr_account, settlement_account,
           director_title, director_name, accountant_name, vat_mode,
           logo_url, logo_width, stamp_url, signature_url, invoice_config,
           elba_enabled, elba_api_key_enc, elba_api_key_hint,
           elba_organization_id, elba_organization_name, elba_bank_account_id,
           elba_auto_sync_invoices
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,
           $9,$10,$11,$12,$13,$14,
           $15,$16,$17,$18,
           $19,$20,$21,$22,
           $23,$24,$25,$26,$27::jsonb,
           $28,$29,$30,
           $31,$32,$33,$34
         )
         RETURNING ${ORG_COLS}`,
        [
          tenantId,
          shouldBeDefault,
          payload.org_type ?? "ip",
          payload.name,
          payload.short_name ?? "",
          payload.inn ?? "",
          payload.kpp ?? "",
          payload.ogrn ?? "",
          payload.legal_address ?? "",
          payload.actual_address ?? "",
          payload.phone ?? "",
          payload.email ?? "",
          payload.website ?? "",
          payload.edo_info ?? "",
          payload.bank_name ?? "",
          payload.bik ?? "",
          payload.corr_account ?? "",
          payload.settlement_account ?? "",
          payload.director_title ?? "Индивидуальный предприниматель",
          payload.director_name ?? "",
          payload.accountant_name ?? "",
          payload.vat_mode ?? "none",
          payload.logo_url ?? "",
          payload.logo_width ?? 140,
          payload.stamp_url ?? "",
          payload.signature_url ?? "",
          JSON.stringify(config),
          payload.elba_enabled ?? false,
          elbaEnc,
          elbaHint,
          payload.elba_organization_id ?? "",
          payload.elba_organization_name ?? "",
          payload.elba_bank_account_id ?? "",
          payload.elba_auto_sync_invoices ?? false,
        ],
      );

      await this.syncOrganizationBankAccountInTx(tx, tenantId, row);

      return toDto(row);
    });
  }

  async update(
    tenantId: string,
    id: string,
    payload: UpdateOrganizationPayload,
  ): Promise<FinanceOrganizationDTO> {
    return withTenant(tenantId, async (tx) => {
      const current = await tx.queryOne<OrgRow>(
        `SELECT ${ORG_COLS} FROM finance_organizations WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      if (!current) throw new NotFoundError("Organization not found");

      if (payload.is_default === true) {
        await tx.query(
          `UPDATE finance_organizations SET is_default = false WHERE tenant_id = $1 AND id <> $2 AND is_default = true`,
          [tenantId, id],
        );
      }

      const sets: string[] = [];
      const params: SqlParam[] = [tenantId, id];
      const push = (col: string, val: SqlParam, cast = ""): void => {
        params.push(val);
        sets.push(`${col} = $${params.length}${cast}`);
      };

      if (payload.is_default !== undefined) push("is_default", payload.is_default);
      if (payload.org_type !== undefined) push("org_type", payload.org_type);
      if (payload.name !== undefined) push("name", payload.name);
      if (payload.short_name !== undefined) push("short_name", payload.short_name);
      if (payload.inn !== undefined) push("inn", payload.inn);
      if (payload.kpp !== undefined) push("kpp", payload.kpp);
      if (payload.ogrn !== undefined) push("ogrn", payload.ogrn);
      if (payload.legal_address !== undefined) push("legal_address", payload.legal_address);
      if (payload.actual_address !== undefined) push("actual_address", payload.actual_address);
      if (payload.phone !== undefined) push("phone", payload.phone);
      if (payload.email !== undefined) push("email", payload.email);
      if (payload.website !== undefined) push("website", payload.website);
      if (payload.edo_info !== undefined) push("edo_info", payload.edo_info);
      if (payload.bank_name !== undefined) push("bank_name", payload.bank_name);
      if (payload.bik !== undefined) push("bik", payload.bik);
      if (payload.corr_account !== undefined) push("corr_account", payload.corr_account);
      if (payload.settlement_account !== undefined)
        push("settlement_account", payload.settlement_account);
      if (payload.director_title !== undefined) push("director_title", payload.director_title);
      if (payload.director_name !== undefined) push("director_name", payload.director_name);
      if (payload.accountant_name !== undefined) push("accountant_name", payload.accountant_name);
      if (payload.vat_mode !== undefined) push("vat_mode", payload.vat_mode);
      if (payload.logo_url !== undefined) push("logo_url", payload.logo_url);
      if (payload.logo_width !== undefined) push("logo_width", payload.logo_width);
      if (payload.stamp_url !== undefined) push("stamp_url", payload.stamp_url);
      if (payload.signature_url !== undefined) push("signature_url", payload.signature_url);

      if (payload.invoice_config !== undefined) {
        const mergedConfig = normalizeInvoiceFormConfig({
          ...normalizeInvoiceFormConfig(current.invoice_config),
          ...payload.invoice_config,
        });
        push("invoice_config", JSON.stringify(mergedConfig), "::jsonb");
      }

      if (payload.elba_enabled !== undefined) push("elba_enabled", payload.elba_enabled);
      if (payload.clear_elba_api_key) {
        push("elba_api_key_enc", "");
        push("elba_api_key_hint", "");
      } else if (payload.elba_api_key !== undefined && payload.elba_api_key.trim().length > 0) {
        push("elba_api_key_enc", encryptSecret(payload.elba_api_key.trim()));
        push("elba_api_key_hint", makeKeyHint(payload.elba_api_key.trim()));
      }
      if (payload.elba_organization_id !== undefined)
        push("elba_organization_id", payload.elba_organization_id);
      if (payload.elba_organization_name !== undefined)
        push("elba_organization_name", payload.elba_organization_name);
      if (payload.elba_bank_account_id !== undefined)
        push("elba_bank_account_id", payload.elba_bank_account_id);
      if (payload.elba_auto_sync_invoices !== undefined)
        push("elba_auto_sync_invoices", payload.elba_auto_sync_invoices);

      if (sets.length === 0) {
        await this.syncOrganizationBankAccountInTx(tx, tenantId, current);
        return toDto(current);
      }
      sets.push("updated_at = now()");

      const row = await tx.queryOneOrThrow<OrgRow>(
        `UPDATE finance_organizations
         SET ${sets.join(", ")}
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING ${ORG_COLS}`,
        params,
      );

      await this.syncOrganizationBankAccountInTx(tx, tenantId, row);

      return toDto(row);
    });
  }

  async setDefault(tenantId: string, id: string): Promise<FinanceOrganizationDTO> {
    return this.update(tenantId, id, { is_default: true });
  }

  async remove(tenantId: string, id: string): Promise<{ success: boolean }> {
    return withTenant(tenantId, async (tx) => {
      const target = await tx.queryOne<OrgRow>(
        `SELECT ${ORG_COLS} FROM finance_organizations WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      if (!target) throw new NotFoundError("Organization not found");

      const remainingCount = await tx.queryOne<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt FROM finance_organizations WHERE tenant_id = $1 AND id <> $2 AND deleted_at IS NULL`,
        [tenantId, id],
      );
      if (Number(remainingCount?.cnt ?? 0) === 0) {
        throw new ValidationError("Нельзя удалить единственную организацию");
      }

      await tx.query(
        `UPDATE finance_organizations SET deleted_at = now(), is_default = false WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id],
      );

      if (target.is_default) {
        await tx.query(
          `UPDATE finance_organizations
           SET is_default = true
           WHERE id = (
             SELECT id FROM finance_organizations
             WHERE tenant_id = $1 AND deleted_at IS NULL
             ORDER BY created_at ASC LIMIT 1
           )`,
          [tenantId],
        );
      }

      return { success: true };
    });
  }

  async testElbaConnection(
    tenantId: string,
    orgId: string,
    overrideApiKey?: string,
  ): Promise<{
    connected: boolean;
    organizations: ElbaOrganization[];
    bankAccounts: ElbaBankAccount[];
  }> {
    let apiKey = overrideApiKey?.trim() || "";
    let savedElbaOrgId = "";

    await withTenant(tenantId, async (tx) => {
      const row = await tx.queryOne<OrgRow>(
        `SELECT ${ORG_COLS} FROM finance_organizations WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [tenantId, orgId],
      );
      if (!row) throw new NotFoundError("Organization not found");
      if (!apiKey && row.elba_api_key_enc) {
        apiKey = decryptSecret(row.elba_api_key_enc);
      }
      savedElbaOrgId = row.elba_organization_id || "";
    });

    if (!apiKey) {
      throw new ValidationError("Укажите API-ключ Контур.Эльбы (X-Kontur-ApiKey)");
    }

    const organizations = await elbaClient.getOrganizations(apiKey);
    const targetOrgId =
      (savedElbaOrgId && organizations.some((o) => o.id === savedElbaOrgId)
        ? savedElbaOrgId
        : organizations[0]?.id) ?? "";

    let bankAccounts: ElbaBankAccount[] = [];
    if (targetOrgId) {
      try {
        bankAccounts = await elbaClient.getBankAccounts(apiKey, targetOrgId);
      } catch {
        bankAccounts = [];
      }
    }

    await withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE finance_organizations SET elba_last_error = '', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
        [tenantId, orgId],
      );
    });

    return { connected: true, organizations, bankAccounts };
  }

  async listElbaBankAccounts(
    tenantId: string,
    orgId: string,
    elbaOrgId: string,
    overrideApiKey?: string,
  ): Promise<ElbaBankAccount[]> {
    let apiKey = overrideApiKey?.trim() || "";
    if (!apiKey) {
      const creds = await this.getDecryptedElbaCredentials(tenantId, orgId);
      apiKey = creds?.apiKey ?? "";
    }
    if (!apiKey) {
      throw new ValidationError("API-ключ Контур.Эльбы не задан");
    }
    return elbaClient.getBankAccounts(apiKey, elbaOrgId);
  }

  async markElbaSyncStatus(
    tenantId: string,
    orgId: string,
    errorMessage?: string,
  ): Promise<void> {
    await withTenant(tenantId, async (tx) => {
      if (errorMessage) {
        await tx.query(
          `UPDATE finance_organizations SET elba_last_error = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, orgId, errorMessage.slice(0, 500)],
        );
      } else {
        await tx.query(
          `UPDATE finance_organizations SET elba_last_sync_at = now(), elba_last_error = '', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, orgId],
        );
      }
    });
  }
}

export const financeOrganizationsService = new FinanceOrganizationsService();
