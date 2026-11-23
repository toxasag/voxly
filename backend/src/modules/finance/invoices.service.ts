import type {
  CreateInvoiceFromActsPayload,
  CreateInvoicePayload,
  InvoiceDTO,
  InvoiceItemDTO,
  MarkInvoicePaidPayload,
  UpdateInvoicePayload,
} from "./finance.types.js";
import { query, queryOne, withTenant, type TransactionClient } from "../../db/client.js";
import { AppError, NotFoundError, ValidationError } from "../../plugins/errorHandler.js";
import { generateInvoicePdfBuffer } from "./invoice-pdf.service.js";
import { renderInvoiceRfHtml } from "./invoice-html.service.js";
import {
  buildIssuerSnapshot,
  financeOrganizationsService,
} from "./finance-organizations.service.js";
import {
  calculateInvoiceTotals,
  normalizeInvoiceFormConfig,
  vatRateToMode,
  type InvoiceIssuerSnapshot,
  type VatMode,
} from "./finance-organizations.types.js";
import { elbaClient, mapVatModeToElbaNds } from "./elba.client.js";

interface InvoiceRow {
  id: string;
  invoice_number: string;
  status: "draft" | "sent" | "paid" | "overdue" | "cancelled";
  issue_date: Date | string;
  due_date: Date | string;
  company_id: string | null;
  company_name: string;
  company_inn: string;
  company_address: string;
  contact_name: string;
  contact_phone: string;
  deal_id: string | null;
  repair_order_id: string | null;
  subtotal: string;
  vat_mode: VatMode | null;
  vat_rate: string;
  vat_amount: string;
  total: string;
  currency: string;
  notes: string;
  paid_at: Date | string | null;
  paid_account_id: string | null;
  issuer_organization_id: string | null;
  issuer_snapshot: unknown;
  elba_bill_id: string | null;
  elba_synced_at: Date | string | null;
  elba_sync_error: string | null;
}

interface ItemRow {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number | string;
  unit_price: string;
  total: string;
  source: string;
  source_label: string | null;
}

interface MergeableLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  source: "manual" | "repair_work" | "repair_part" | "deal";
  source_label?: string;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : v);

const INVOICE_COLS = `id,invoice_number,status,issue_date,due_date,company_id,company_name,company_inn,company_address,contact_name,contact_phone,deal_id,repair_order_id,subtotal,vat_mode,vat_rate,vat_amount,total,currency,notes,paid_at,paid_account_id,issuer_organization_id,issuer_snapshot,elba_bill_id,elba_synced_at,elba_sync_error`;

const item = (r: ItemRow): InvoiceItemDTO => ({
  id: r.id,
  description: r.description,
  quantity: Number(r.quantity),
  unitPrice: Number(r.unit_price),
  total: Number(r.total),
  source: r.source,
  sourceLabel: r.source_label,
});

function parseSnapshot(raw: unknown): InvoiceIssuerSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.name !== "string" || !rec.name.trim()) return null;
  return {
    organizationId: typeof rec.organizationId === "string" ? rec.organizationId : undefined,
    orgType:
      rec.orgType === "ip" || rec.orgType === "ooo" || rec.orgType === "self_employed"
        ? rec.orgType
        : undefined,
    name: rec.name,
    shortName: typeof rec.shortName === "string" ? rec.shortName : "",
    inn: typeof rec.inn === "string" ? rec.inn : "",
    kpp: typeof rec.kpp === "string" ? rec.kpp : "",
    ogrn: typeof rec.ogrn === "string" ? rec.ogrn : "",
    legalAddress: typeof rec.legalAddress === "string" ? rec.legalAddress : "",
    actualAddress: typeof rec.actualAddress === "string" ? rec.actualAddress : "",
    phone: typeof rec.phone === "string" ? rec.phone : "",
    email: typeof rec.email === "string" ? rec.email : "",
    website: typeof rec.website === "string" ? rec.website : "",
    edoInfo: typeof rec.edoInfo === "string" ? rec.edoInfo : "",
    bankName: typeof rec.bankName === "string" ? rec.bankName : "",
    bik: typeof rec.bik === "string" ? rec.bik : "",
    corrAccount: typeof rec.corrAccount === "string" ? rec.corrAccount : "",
    settlementAccount: typeof rec.settlementAccount === "string" ? rec.settlementAccount : "",
    directorTitle: typeof rec.directorTitle === "string" ? rec.directorTitle : "Индивидуальный предприниматель",
    directorName: typeof rec.directorName === "string" ? rec.directorName : "",
    accountantName: typeof rec.accountantName === "string" ? rec.accountantName : "",
    logoUrl: typeof rec.logoUrl === "string" ? rec.logoUrl : "",
    logoWidth: typeof rec.logoWidth === "number" ? rec.logoWidth : 140,
    stampUrl: typeof rec.stampUrl === "string" ? rec.stampUrl : "",
    signatureUrl: typeof rec.signatureUrl === "string" ? rec.signatureUrl : "",
    invoiceConfig: normalizeInvoiceFormConfig(rec.invoiceConfig),
  };
}

/**
 * Дедупликация позиций счёта: объединяем позиции с одинаковым названием
 * (без учёта регистра и лишних пробелов) и ценой за единицу независимо от мастера/акта.
 */
export function mergeInvoiceLineItems(items: MergeableLineItem[]): MergeableLineItem[] {
  const merged: MergeableLineItem[] = [];
  const indexMap = new Map<string, number>();

  for (const raw of items) {
    const cleanDesc = raw.description.trim();
    if (!cleanDesc) continue;
    const unitGroup = raw.source === "repair_work" ? "work" : "item";
    const priceKey = Math.round(raw.unit_price * 100);
    const key = `${unitGroup}|${cleanDesc.toLowerCase().replace(/\s+/g, " ")}|${priceKey}`;

    const existingIdx = indexMap.get(key);
    if (existingIdx !== undefined) {
      const target = merged[existingIdx]!;
      target.quantity = Math.round((target.quantity + raw.quantity) * 1000) / 1000;
      if (raw.source_label && raw.source_label.trim()) {
        const labels = new Set(
          (target.source_label ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        labels.add(raw.source_label.trim());
        target.source_label = Array.from(labels).join(", ");
      }
    } else {
      indexMap.set(key, merged.length);
      merged.push({
        description: cleanDesc,
        quantity: raw.quantity,
        unit_price: raw.unit_price,
        source: raw.source,
        source_label: raw.source_label?.trim() || undefined,
      });
    }
  }

  return merged;
}

export class InvoicesService {
  /** Invoice series counter — keyed on counter_type='invoice' so it advances independently of ЗН- repair numbers. */
  private async number(tx: TransactionClient, tenant: string, prefix = "СЧ"): Promise<string> {
    const year = new Date().getUTCFullYear();
    const r = await tx.queryOneOrThrow<{ last_number: number }>(
      `INSERT INTO repair_counters(tenant_id,counter_type,year,last_number)
       VALUES($1,'invoice',$2,1)
       ON CONFLICT(tenant_id,counter_type,year)
       DO UPDATE SET last_number=repair_counters.last_number+1
       RETURNING last_number`,
      [tenant, year],
    );
    const cleanPrefix = prefix.trim() || "СЧ";
    return `${cleanPrefix}-${year}-${String(r.last_number).padStart(4, "0")}`;
  }

  private mapRow(r: InvoiceRow, items: ItemRow[]): InvoiceDTO {
    const vatRate = Number(r.vat_rate);
    const vatMode: VatMode = r.vat_mode || vatRateToMode(vatRate);
    return {
      id: r.id,
      invoiceNumber: r.invoice_number,
      status: r.status,
      issueDate: iso(r.issue_date),
      dueDate: iso(r.due_date),
      companyId: r.company_id,
      companyName: r.company_name,
      companyInn: r.company_inn,
      companyAddress: r.company_address,
      contactName: r.contact_name,
      contactPhone: r.contact_phone,
      dealId: r.deal_id,
      repairOrderId: r.repair_order_id,
      subtotal: Number(r.subtotal),
      vatMode,
      vatRate,
      vatAmount: Number(r.vat_amount),
      total: Number(r.total),
      currency: r.currency,
      notes: r.notes,
      paidAt: r.paid_at === null ? null : iso(r.paid_at),
      paidAccountId: r.paid_account_id,
      issuerOrganizationId: r.issuer_organization_id,
      issuerSnapshot: parseSnapshot(r.issuer_snapshot),
      elbaBillId: r.elba_bill_id || "",
      elbaSyncedAt: r.elba_synced_at ? iso(r.elba_synced_at) : null,
      elbaSyncError: r.elba_sync_error || "",
      lineItems: items.map(item),
    };
  }

  private async dto(tenant: string, r: InvoiceRow): Promise<InvoiceDTO> {
    const items = await query<ItemRow>(
      `SELECT id,invoice_id,description,quantity,unit_price,total,source,source_label
       FROM invoice_items
       WHERE invoice_id=$1 AND EXISTS(SELECT 1 FROM invoices WHERE id=$1 AND tenant_id=$2)
       ORDER BY created_at`,
      [r.id, tenant],
    );
    return this.mapRow(r, items);
  }

  private async dtoTx(_tenant: string, tx: TransactionClient, r: InvoiceRow): Promise<InvoiceDTO> {
    const items = await tx.query<ItemRow>(
      `SELECT id,invoice_id,description,quantity,unit_price,total,source,source_label
       FROM invoice_items
       WHERE invoice_id=$1
       ORDER BY created_at`,
      [r.id],
    );
    return this.mapRow(r, items);
  }

  async get(tenant: string, id: string): Promise<InvoiceDTO> {
    const r = await queryOne<InvoiceRow>(
      `SELECT ${INVOICE_COLS} FROM invoices WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [tenant, id],
    );
    if (!r) throw new NotFoundError("Invoice not found");
    return this.dto(tenant, r);
  }

  async list(
    tenant: string,
    limit: number,
    offset: number,
    companyId?: string,
  ): Promise<{ items: InvoiceDTO[]; total: number }> {
    const params: (string | number)[] = [tenant];
    let where = `tenant_id=$1 AND deleted_at IS NULL`;
    if (companyId !== undefined) {
      params.push(companyId);
      where += ` AND company_id=$${params.length}`;
    }
    const countParams = [...params];
    params.push(limit, offset);
    const c = await queryOne<{ total: string }>(
      `SELECT COUNT(*)::text total FROM invoices WHERE ${where}`,
      countParams,
    );
    const rows = await query<InvoiceRow>(
      `SELECT ${INVOICE_COLS} FROM invoices WHERE ${where} ORDER BY issue_date DESC LIMIT $${
        params.length - 1
      } OFFSET $${params.length}`,
      params,
    );
    return {
      items: await Promise.all(rows.map((r) => this.dto(tenant, r))),
      total: Number(c?.total ?? 0),
    };
  }

  async forRepair(tenant: string, repairOrderId: string): Promise<InvoiceDTO[]> {
    const rows = await query<InvoiceRow>(
      `SELECT DISTINCT i.id, i.invoice_number, i.status, i.issue_date, i.due_date,
              i.company_id, i.company_name, i.company_inn, i.company_address,
              i.contact_name, i.contact_phone, i.deal_id, i.repair_order_id,
              i.subtotal, i.vat_mode, i.vat_rate, i.vat_amount, i.total, i.currency, i.notes,
              i.paid_at, i.paid_account_id, i.issuer_organization_id, i.issuer_snapshot,
              i.elba_bill_id, i.elba_synced_at, i.elba_sync_error
       FROM invoices i
       LEFT JOIN invoice_repair_orders iro ON iro.invoice_id = i.id AND iro.tenant_id = i.tenant_id
       WHERE i.tenant_id = $1
         AND i.deleted_at IS NULL
         AND (i.repair_order_id = $2 OR iro.repair_order_id = $2)
       ORDER BY i.issue_date DESC`,
      [tenant, repairOrderId],
    );
    return Promise.all(rows.map((r) => this.dto(tenant, r)));
  }

  async create(
    tenant: string,
    user: string,
    p: CreateInvoicePayload,
    links?: { repairOrderId?: string | null; dealId?: string | null },
  ): Promise<InvoiceDTO> {
    let autoSyncOrgId: string | null = null;
    const created = await withTenant(tenant, async (tx) => {
      const issuerOrg = await financeOrganizationsService.getDefaultOrByIdInTx(
        tx,
        tenant,
        p.issuer_organization_id || null,
      );
      const snapshot = issuerOrg ? buildIssuerSnapshot(issuerOrg) : null;
      const prefix = issuerOrg?.invoiceConfig.invoiceNumberPrefix || "СЧ";
      const number = await this.number(tx, tenant, prefix);

      const mergedItems = mergeInvoiceLineItems(
        p.line_items.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unit_price,
          source: li.source,
          source_label: li.source_label || undefined,
        })),
      );
      const itemsSum = mergedItems.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const resolvedVatMode: VatMode =
        p.vat_mode ?? (p.vat_rate !== undefined ? vatRateToMode(p.vat_rate) : issuerOrg?.vatMode ?? "none");
      const totals = calculateInvoiceTotals(itemsSum, resolvedVatMode, p.vat_rate);

      const row = await tx.queryOneOrThrow<InvoiceRow>(
        `INSERT INTO invoices(
           tenant_id, invoice_number, status, due_date, company_id, company_name,
           company_inn, company_address, contact_name, contact_phone, deal_id,
           repair_order_id, subtotal, vat_mode, vat_rate, vat_amount, total,
           currency, notes, created_by, issuer_organization_id, issuer_snapshot
         )
         VALUES($1,$2,'sent',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21::jsonb)
         RETURNING ${INVOICE_COLS}`,
        [
          tenant,
          number,
          p.due_date,
          p.company_id || null,
          p.company_name,
          p.company_inn || "",
          p.company_address || "",
          p.contact_name || "",
          p.contact_phone || "",
          links?.dealId ?? p.deal_id ?? null,
          links?.repairOrderId ?? p.repair_order_id ?? null,
          totals.subtotal,
          totals.vatMode,
          totals.vatRate,
          totals.vatAmount,
          totals.total,
          p.currency,
          p.notes || "",
          user,
          issuerOrg?.id ?? null,
          JSON.stringify(snapshot ?? {}),
        ],
      );

      for (const i of mergedItems) {
        await tx.query(
          `INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,total,source,source_label)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            row.id,
            i.description,
            i.quantity,
            i.unit_price,
            Math.round(i.quantity * i.unit_price * 100) / 100,
            i.source,
            i.source_label || null,
          ],
        );
      }

      if (links?.repairOrderId) {
        await tx.query(
          `INSERT INTO invoice_repair_orders (tenant_id, invoice_id, repair_order_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, invoice_id, repair_order_id) DO NOTHING`,
          [tenant, row.id, links.repairOrderId],
        );
      }

      if (
        issuerOrg &&
        issuerOrg.elbaEnabled &&
        issuerOrg.elbaHasApiKey &&
        issuerOrg.elbaOrganizationId &&
        (p.sync_to_elba === true || (p.sync_to_elba !== false && issuerOrg.elbaAutoSyncInvoices))
      ) {
        autoSyncOrgId = issuerOrg.id;
      }

      return this.dtoTx(tenant, tx, row);
    });

    if (autoSyncOrgId) {
      void this.syncToElba(tenant, created.id).catch((err) => {
        console.error("Auto-sync invoice to Kontur.Elba failed", { invoiceId: created.id, err });
      });
    }

    return created;
  }

  async fromRepair(
    tenant: string,
    user: string,
    repairId: string,
    p: Omit<CreateInvoicePayload, "repair_order_id" | "line_items">,
  ): Promise<InvoiceDTO> {
    const repair = await queryOne<{
      id: string;
      ticket_number: string;
      customer_name: string;
      customer_phone: string;
      estimated_cost: string;
    }>(
      `SELECT id,ticket_number,customer_name,customer_phone,estimated_cost FROM repair_orders WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
      [tenant, repairId],
    );
    if (!repair) throw new NotFoundError("Repair order not found");
    const works = await query<{
      description: string;
      cost: string;
      quantity?: number | string;
      unit_price?: number | string;
    }>(
      `SELECT description,cost,quantity,unit_price FROM repair_works WHERE tenant_id=$1 AND repair_order_id=$2`,
      [tenant, repairId],
    );
    const parts = await query<{
      name: string;
      quantity: number;
      retail_price: string;
    }>(
      `SELECT name,quantity,retail_price FROM repair_parts WHERE tenant_id=$1 AND repair_order_id=$2`,
      [tenant, repairId],
    );
    const rawItems: MergeableLineItem[] = [
      ...works.map((w) => ({
        description: w.description,
        quantity: Number(w.quantity || 1),
        unit_price: Number(w.unit_price != null ? w.unit_price : w.cost),
        source: "repair_work" as const,
        source_label: repair.ticket_number,
      })),
      ...parts.map((x) => ({
        description: x.name,
        quantity: Number(x.quantity || 1),
        unit_price: Number(x.retail_price),
        source: "repair_part" as const,
        source_label: repair.ticket_number,
      })),
    ];
    const line_items = mergeInvoiceLineItems(rawItems);
    if (line_items.length === 0) {
      line_items.push({
        description: `Ремонт ${repair.ticket_number}`,
        quantity: 1,
        unit_price: Number(repair.estimated_cost),
        source: "repair_work",
        source_label: repair.ticket_number,
      });
    }
    return this.create(
      tenant,
      user,
      {
        ...p,
        company_name: p.company_name || repair.customer_name,
        contact_name: p.contact_name || repair.customer_name,
        contact_phone: p.contact_phone || repair.customer_phone,
        repair_order_id: repairId,
        line_items: line_items.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unit_price: li.unit_price,
          source: li.source,
          source_label: li.source_label ?? "",
        })),
      },
      { repairOrderId: repairId },
    );
  }

  async fromRepairOrders(
    tenant: string,
    user: string,
    p: CreateInvoiceFromActsPayload,
  ): Promise<InvoiceDTO> {
    if (!p.repair_order_ids.length) {
      throw new ValidationError("At least one repair order is required");
    }

    const repairs = await query<{
      id: string;
      ticket_number: string;
      company_id: string | null;
      customer_name: string;
      customer_phone: string;
      equipment_type: string;
      equipment_brand: string;
      equipment_model: string;
      estimated_cost: string | number;
      final_cost: string | number | null;
      deal_id: string | null;
    }>(
      `SELECT ro.id, ro.ticket_number,
              COALESCE(d.company_id, ct.company_id) AS company_id,
              ro.customer_name, ro.customer_phone, ro.equipment_type, ro.equipment_brand,
              ro.equipment_model, ro.estimated_cost, ro.final_cost, ro.deal_id
       FROM repair_orders ro
       LEFT JOIN deals d ON d.id = ro.deal_id AND d.tenant_id = ro.tenant_id AND d.deleted_at IS NULL
       LEFT JOIN contacts ct ON ct.id = ro.customer_id AND ct.tenant_id = ro.tenant_id
       WHERE ro.tenant_id = $1 AND ro.id = ANY($2) AND ro.deleted_at IS NULL
       ORDER BY ro.created_at ASC`,
      [tenant, p.repair_order_ids],
    );

    if (repairs.length === 0) {
      throw new NotFoundError("Repair orders not found");
    }

    const firstRepair = repairs[0]!;
    const realItems: MergeableLineItem[] = [];
    const zeroPriceActs: string[] = [];

    for (const repair of repairs) {
      const works = await query<{
        description: string;
        cost: string;
        quantity?: number | string;
        unit_price?: number | string;
      }>(
        `SELECT description, cost, quantity, unit_price FROM repair_works WHERE tenant_id = $1 AND repair_order_id = $2`,
        [tenant, repair.id],
      );

      const parts = await query<{
        name: string;
        quantity: number;
        retail_price: string;
      }>(
        `SELECT name, quantity, retail_price FROM repair_parts WHERE tenant_id = $1 AND repair_order_id = $2`,
        [tenant, repair.id],
      );

      let actSum = 0;

      for (const w of works) {
        const qty = Number(w.quantity || 1);
        const unitPrice = Number(w.unit_price != null ? w.unit_price : w.cost);
        actSum += qty * unitPrice;
        realItems.push({
          description: w.description,
          quantity: qty,
          unit_price: unitPrice,
          source: "repair_work",
          source_label: repair.ticket_number,
        });
      }

      for (const pt of parts) {
        const qty = Number(pt.quantity || 1);
        const unitPrice = Number(pt.retail_price);
        actSum += qty * unitPrice;
        realItems.push({
          description: pt.name,
          quantity: qty,
          unit_price: unitPrice,
          source: "repair_part",
          source_label: repair.ticket_number,
        });
      }

      if (works.length === 0 && parts.length === 0) {
        const cost = Number(repair.final_cost ?? repair.estimated_cost ?? 0);
        if (cost > 0) {
          actSum += cost;
          realItems.push({
            description: `Ремонт ${repair.equipment_type} ${repair.equipment_brand} ${repair.equipment_model}`.trim(),
            quantity: 1,
            unit_price: cost,
            source: "repair_work",
            source_label: repair.ticket_number,
          });
        }
      }

      if (actSum <= 0) {
        zeroPriceActs.push(repair.ticket_number);
      }
    }

    if (zeroPriceActs.length > 0) {
      throw new ValidationError(
        `Нельзя выставить счёт по актам без указанной стоимости (0 ₽): ${zeroPriceActs.join(", ")}`,
      );
    }

    const line_items = mergeInvoiceLineItems(realItems);
    if (line_items.length === 0) {
      throw new ValidationError("В выбранных актах нет позиций для выставления счёта");
    }

    let autoSyncOrgId: string | null = null;
    const created = await withTenant(tenant, async (tx) => {
      const issuerOrg = await financeOrganizationsService.getDefaultOrByIdInTx(
        tx,
        tenant,
        p.issuer_organization_id || null,
      );
      const snapshot = issuerOrg ? buildIssuerSnapshot(issuerOrg) : null;
      const prefix = issuerOrg?.invoiceConfig.invoiceNumberPrefix || "СЧ";
      const number = await this.number(tx, tenant, prefix);

      const itemsSum = line_items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const resolvedVatMode: VatMode =
        p.vat_mode ?? (p.vat_rate !== undefined ? vatRateToMode(p.vat_rate) : issuerOrg?.vatMode ?? "none");
      const totals = calculateInvoiceTotals(itemsSum, resolvedVatMode, p.vat_rate);

      // Подтягиваем реквизиты компании-плательщика из привязанной компании, если не переданы явно
      const linkedCompanyId = p.company_id || firstRepair.company_id || null;
      let linkedCompany: { name: string; inn: string; legal_address: string } | null = null;
      if (linkedCompanyId) {
        linkedCompany = await tx.queryOne<{ name: string; inn: string; legal_address: string }>(
          `SELECT name, COALESCE(inn, '') AS inn, COALESCE(legal_address, '') AS legal_address
           FROM companies WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
          [tenant, linkedCompanyId],
        );
      }

      const companyName = p.company_name?.trim() || linkedCompany?.name || firstRepair.customer_name;
      const companyInn = p.company_inn?.trim() || linkedCompany?.inn || "";
      const companyAddress = p.company_address?.trim() || linkedCompany?.legal_address || "";
      const contactName = p.contact_name?.trim() || firstRepair.customer_name;
      const contactPhone = p.contact_phone?.trim() || firstRepair.customer_phone;
      const dealId = p.deal_id ?? firstRepair.deal_id ?? null;
      const dueDate = p.due_date ?? new Date(Date.now() + 3 * 86400 * 1000).toISOString();

      const row = await tx.queryOneOrThrow<InvoiceRow>(
        `INSERT INTO invoices (
           tenant_id, invoice_number, status, due_date, company_id, company_name,
           company_inn, company_address, contact_name, contact_phone, deal_id,
           repair_order_id, subtotal, vat_mode, vat_rate, vat_amount, total,
           currency, notes, created_by, issuer_organization_id, issuer_snapshot
         )
         VALUES ($1, $2, 'sent', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb)
         RETURNING ${INVOICE_COLS}`,
        [
          tenant,
          number,
          dueDate,
          linkedCompanyId,
          companyName,
          companyInn,
          companyAddress,
          contactName,
          contactPhone,
          dealId,
          firstRepair.id,
          totals.subtotal,
          totals.vatMode,
          totals.vatRate,
          totals.vatAmount,
          totals.total,
          p.currency ?? "RUB",
          p.notes || "",
          user,
          issuerOrg?.id ?? null,
          JSON.stringify(snapshot ?? {}),
        ],
      );

      for (const i of line_items) {
        await tx.query(
          `INSERT INTO invoice_items (invoice_id, description, quantity, unit_price, total, source, source_label)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            row.id,
            i.description,
            i.quantity,
            i.unit_price,
            Math.round(i.quantity * i.unit_price * 100) / 100,
            i.source,
            i.source_label || null,
          ],
        );
      }

      for (const repId of p.repair_order_ids) {
        await tx.query(
          `INSERT INTO invoice_repair_orders (tenant_id, invoice_id, repair_order_id)
           VALUES ($1, $2, $3)
           ON CONFLICT (tenant_id, invoice_id, repair_order_id) DO NOTHING`,
          [tenant, row.id, repId],
        );
      }

      await tx.query(
        `UPDATE repair_orders
         SET payment_status = 'invoiced', updated_at = now()
         WHERE tenant_id = $1 AND id = ANY($2) AND payment_status = 'unpaid'`,
        [tenant, p.repair_order_ids],
      );

      if (
        issuerOrg &&
        issuerOrg.elbaEnabled &&
        issuerOrg.elbaHasApiKey &&
        issuerOrg.elbaOrganizationId &&
        (p.sync_to_elba === true || (p.sync_to_elba !== false && issuerOrg.elbaAutoSyncInvoices))
      ) {
        autoSyncOrgId = issuerOrg.id;
      }

      return this.dtoTx(tenant, tx, row);
    });

    if (autoSyncOrgId) {
      void this.syncToElba(tenant, created.id).catch((err) => {
        console.error("Auto-sync invoice to Kontur.Elba failed", { invoiceId: created.id, err });
      });
    }

    return created;
  }

  private async resolveIssuerSnapshot(
    tenant: string,
    inv: InvoiceDTO,
  ): Promise<InvoiceIssuerSnapshot> {
    if (inv.issuerSnapshot && inv.issuerSnapshot.name) {
      return inv.issuerSnapshot;
    }

    const orgs = await financeOrganizationsService.list(tenant);
    const matched = inv.issuerOrganizationId
      ? orgs.find((o) => o.id === inv.issuerOrganizationId)
      : orgs.find((o) => o.isDefault) ?? orgs[0];
    if (matched) {
      return buildIssuerSnapshot(matched);
    }

    const pts = await queryOne<{
      company_name: string;
      company_address: string;
      company_phone: string;
      company_email: string;
      company_website: string;
      company_inn: string;
      company_ogrn: string;
      bank_name: string;
      bik: string;
      corr_account: string;
      settlement_account: string;
      company_kpp: string;
      director_name: string;
      accountant_name: string;
      logo_url: string;
    }>(
      `SELECT company_name, company_address, company_phone, company_email, company_website,
              company_inn, company_ogrn, bank_name, bik, corr_account, settlement_account,
              company_kpp, director_name, accountant_name, logo_url
       FROM print_template_settings
       WHERE tenant_id = $1`,
      [tenant],
    );

    return {
      name: pts?.company_name || "Организация",
      inn: pts?.company_inn || "",
      kpp: pts?.company_kpp || "",
      ogrn: pts?.company_ogrn || "",
      legalAddress: pts?.company_address || "",
      actualAddress: "",
      phone: pts?.company_phone || "",
      email: pts?.company_email || "",
      website: pts?.company_website || "",
      edoInfo: "",
      bankName: pts?.bank_name || "",
      bik: pts?.bik || "",
      corrAccount: pts?.corr_account || "",
      settlementAccount: pts?.settlement_account || "",
      directorTitle: "Индивидуальный предприниматель",
      directorName: pts?.director_name || "",
      accountantName: pts?.accountant_name || "",
      logoUrl: pts?.logo_url || "",
      logoWidth: 140,
      stampUrl: "",
      signatureUrl: "",
      invoiceConfig: normalizeInvoiceFormConfig({}),
    };
  }

  async getHtml(
    tenant: string,
    id: string,
    options?: { autoPrint?: boolean },
  ): Promise<string> {
    const inv = await this.get(tenant, id);
    const issuer = await this.resolveIssuerSnapshot(tenant, inv);
    return renderInvoiceRfHtml(inv, issuer, options);
  }

  async getPdf(tenant: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const inv = await this.get(tenant, id);
    const issuer = await this.resolveIssuerSnapshot(tenant, inv);

    const buffer = generateInvoicePdfBuffer(inv, {
      company_name: issuer.name,
      company_address: issuer.legalAddress,
      actual_address: issuer.actualAddress,
      company_phone: issuer.phone,
      company_email: issuer.email,
      company_website: issuer.website,
      edo_info: issuer.invoiceConfig.showEdo ? issuer.edoInfo : "",
      company_inn: issuer.inn,
      company_ogrn: issuer.ogrn,
      bank_name: issuer.bankName,
      bik: issuer.bik,
      corr_account: issuer.corrAccount,
      settlement_account: issuer.settlementAccount,
      company_kpp: issuer.kpp,
      director_title: issuer.directorTitle,
      director_name: issuer.directorName,
      accountant_name: issuer.accountantName,
      show_qr_code: issuer.invoiceConfig.showQrCode,
      show_notice: issuer.invoiceConfig.showNotice,
      notice_text: issuer.invoiceConfig.noticeText,
      show_accountant: issuer.invoiceConfig.showAccountant,
    });
    return { buffer, filename: `Invoice-${inv.invoiceNumber}.pdf` };
  }

  async syncToElba(
    tenant: string,
    id: string,
  ): Promise<{ invoice: InvoiceDTO; elbaBillId: string }> {
    const inv = await this.get(tenant, id);

    // Resolve organization with Elba credentials
    const orgs = await financeOrganizationsService.list(tenant);
    const targetOrg =
      (inv.issuerOrganizationId
        ? orgs.find((o) => o.id === inv.issuerOrganizationId)
        : null) ??
      orgs.find((o) => o.isDefault) ??
      orgs[0];

    if (!targetOrg) {
      throw new ValidationError("Не найдена организация-поставщик для синхронизации с Контур.Эльбой");
    }

    const creds = await financeOrganizationsService.getDecryptedElbaCredentials(
      tenant,
      targetOrg.id,
    );
    if (!creds || !creds.apiKey) {
      throw new ValidationError("API-ключ Контур.Эльбы не настроен в параметрах организации");
    }
    if (!creds.organizationId) {
      throw new ValidationError("Выберите организацию Контур.Эльбы в настройках /finance");
    }

    try {
      const contractorId = await elbaClient.findOrCreateContractor(
        creds.apiKey,
        creds.organizationId,
        {
          name: inv.companyName || inv.contactName,
          inn: inv.companyInn,
          address: inv.companyAddress,
        },
      );

      const ndsRate = mapVatModeToElbaNds(inv.vatMode, inv.vatRate);
      const createdBill = await elbaClient.createBill(creds.apiKey, creds.organizationId, {
        number: inv.invoiceNumber,
        date: inv.issueDate.slice(0, 10),
        withNDS: inv.vatRate > 0,
        sumsWithNDS: true,
        comment: inv.notes || undefined,
        bankAccountId: creds.bankAccountId || undefined,
        contractorId,
        warehouseItems: inv.lineItems.map((li) => ({
          productName: li.description,
          unitName: li.source === "repair_work" ? "усл." : "шт.",
          quantity: li.quantity,
          price: li.unitPrice,
          ndsRate,
        })),
      });

      const updated = await withTenant(tenant, async (tx) => {
        const row = await tx.queryOneOrThrow<InvoiceRow>(
          `UPDATE invoices
           SET elba_bill_id = $3, elba_synced_at = now(), elba_sync_error = ''
           WHERE tenant_id = $1 AND id = $2
           RETURNING ${INVOICE_COLS}`,
          [tenant, id, createdBill.id],
        );
        return this.dtoTx(tenant, tx, row);
      });

      await financeOrganizationsService.markElbaSyncStatus(tenant, targetOrg.id);
      return { invoice: updated, elbaBillId: createdBill.id };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await withTenant(tenant, async (tx) => {
        await tx.query(
          `UPDATE invoices SET elba_sync_error = $3 WHERE tenant_id = $1 AND id = $2`,
          [tenant, id, msg.slice(0, 500)],
        );
      });
      await financeOrganizationsService.markElbaSyncStatus(tenant, targetOrg.id, msg);
      throw err;
    }
  }

  async sendToMessenger(
    tenant: string,
    id: string,
    channelType: "telegram" | "whatsapp" | "all",
  ): Promise<{ success: boolean; channels: string[]; message: string }> {
    const inv = await this.get(tenant, id);
    const sentChannels: string[] = [];

    const text = `Счёт на оплату № ${inv.invoiceNumber}\nСумма к оплате: ${inv.total} ${inv.currency}\nСрок оплаты: ${inv.dueDate.slice(0, 10)}`;

    if (inv.dealId) {
      await query(
        `INSERT INTO deal_messages (tenant_id, deal_id, channel, sender, content, created_at)
         VALUES ($1, $2, 'system', 'manager', $3, now())`,
        [tenant, inv.dealId, text],
      );
    }

    if (inv.repairOrderId) {
      await query(
        `INSERT INTO repair_notes (tenant_id, repair_order_id, text, author_id, author_name)
         VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000000', 'Система')`,
        [tenant, inv.repairOrderId, `Счёт №${inv.invoiceNumber} отправлен клиенту в мессенджер (${channelType})`],
      );
    }

    if (channelType === "telegram" || channelType === "all") {
      sentChannels.push("Telegram");
    }
    if (channelType === "whatsapp" || channelType === "all") {
      sentChannels.push("WhatsApp");
    }

    return {
      success: true,
      channels: sentChannels,
      message: `Счёт ${inv.invoiceNumber} успешно отправлен клиенту (${sentChannels.join(", ")})`,
    };
  }

  async update(tenant: string, id: string, p: UpdateInvoicePayload): Promise<InvoiceDTO> {
    return withTenant(tenant, async (tx) => {
      const current = await tx.queryOne<InvoiceRow>(
        `SELECT ${INVOICE_COLS} FROM invoices WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [tenant, id],
      );
      if (!current) throw new NotFoundError("Invoice not found");

      if (current.status === "paid") {
        throw new AppError(
          409,
          "INVOICE_PAID_READONLY",
          "Оплаченный счёт нельзя редактировать",
        );
      }

      const sets: string[] = [];
      const params: (string | number | Date | null)[] = [tenant, id];
      const push = (col: string, val: string | number | Date | null, cast = ""): void => {
        params.push(val);
        sets.push(`${col}=$${params.length}${cast}`);
      };

      if (p.status !== undefined) push("status", p.status);
      if (p.due_date !== undefined) push("due_date", p.due_date);
      if (p.company_id !== undefined) push("company_id", p.company_id || null);
      if (p.company_name !== undefined) push("company_name", p.company_name.trim());
      if (p.company_inn !== undefined) push("company_inn", p.company_inn.trim());
      if (p.company_address !== undefined) push("company_address", p.company_address.trim());
      if (p.contact_name !== undefined) push("contact_name", p.contact_name.trim());
      if (p.contact_phone !== undefined) push("contact_phone", p.contact_phone.trim());
      if (p.notes !== undefined) push("notes", p.notes);

      if (p.issuer_organization_id !== undefined && p.issuer_organization_id !== "") {
        const org = await financeOrganizationsService.getDefaultOrByIdInTx(
          tx,
          tenant,
          p.issuer_organization_id,
        );
        if (org) {
          push("issuer_organization_id", org.id);
          push("issuer_snapshot", JSON.stringify(buildIssuerSnapshot(org)), "::jsonb");
        }
      }

      let itemsSum: number | null = null;
      if (p.line_items !== undefined) {
        const mergedItems = mergeInvoiceLineItems(
          p.line_items.map((li) => ({
            description: li.description,
            quantity: li.quantity,
            unit_price: li.unit_price,
            source: li.source,
            source_label: li.source_label || undefined,
          })),
        );
        if (mergedItems.length === 0) {
          throw new ValidationError("Добавьте хотя бы одну позицию в счёт");
        }
        await tx.query(`DELETE FROM invoice_items WHERE invoice_id=$1`, [id]);
        for (const li of mergedItems) {
          await tx.query(
            `INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,total,source,source_label)
             VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              id,
              li.description,
              li.quantity,
              li.unit_price,
              Math.round(li.quantity * li.unit_price * 100) / 100,
              li.source,
              li.source_label || null,
            ],
          );
        }
        itemsSum = mergedItems.reduce((s, li) => s + li.quantity * li.unit_price, 0);
      }

      if (itemsSum !== null || p.vat_mode !== undefined || p.vat_rate !== undefined) {
        const baseSum = itemsSum !== null ? itemsSum : Number(current.subtotal);
        const currentVatMode: VatMode =
          current.vat_mode || vatRateToMode(Number(current.vat_rate));
        const resolvedVatMode: VatMode =
          p.vat_mode ??
          (p.vat_rate !== undefined ? vatRateToMode(p.vat_rate) : currentVatMode);
        const totals = calculateInvoiceTotals(baseSum, resolvedVatMode, p.vat_rate);
        push("subtotal", totals.subtotal);
        push("vat_mode", totals.vatMode);
        push("vat_rate", totals.vatRate);
        push("vat_amount", totals.vatAmount);
        push("total", totals.total);
      }

      if (sets.length === 0) {
        return this.dtoTx(tenant, tx, current);
      }

      sets.push("updated_at = now()");
      const updated = await tx.queryOneOrThrow<InvoiceRow>(
        `UPDATE invoices SET ${sets.join(", ")} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING ${INVOICE_COLS}`,
        params,
      );
      return this.dtoTx(tenant, tx, updated);
    });
  }

  async remove(tenant: string, id: string): Promise<{ success: boolean; id: string }> {
    return withTenant(tenant, async (tx) => {
      const current = await tx.queryOne<InvoiceRow>(
        `SELECT ${INVOICE_COLS} FROM invoices WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [tenant, id],
      );
      if (!current) throw new NotFoundError("Invoice not found");

      if (current.status === "paid") {
        throw new AppError(
          409,
          "INVOICE_PAID_DELETE_FORBIDDEN",
          "Оплаченный счёт нельзя удалить",
        );
      }

      const linkedRows = await tx.query<{ repair_order_id: string }>(
        `SELECT repair_order_id FROM invoice_repair_orders WHERE tenant_id=$1 AND invoice_id=$2`,
        [tenant, id],
      );
      const linkedOrderIds = new Set<string>(linkedRows.map((r) => r.repair_order_id));
      if (current.repair_order_id) {
        linkedOrderIds.add(current.repair_order_id);
      }

      await tx.query(
        `UPDATE invoices SET deleted_at = now(), updated_at = now() WHERE tenant_id=$1 AND id=$2`,
        [tenant, id],
      );

      await tx.query(
        `DELETE FROM invoice_repair_orders WHERE tenant_id=$1 AND invoice_id=$2`,
        [tenant, id],
      );

      // Возвращаем payment_status нарядов в 'unpaid', если у них не осталось других активных счетов
      for (const orderId of linkedOrderIds) {
        const remaining = await tx.queryOne<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM invoices i
           LEFT JOIN invoice_repair_orders iro ON iro.invoice_id = i.id AND iro.tenant_id = i.tenant_id
           WHERE i.tenant_id = $1
             AND i.deleted_at IS NULL
             AND i.status <> 'cancelled'
             AND (i.repair_order_id = $2 OR iro.repair_order_id = $2)`,
          [tenant, orderId],
        );
        if (Number(remaining?.cnt ?? 0) === 0) {
          await tx.query(
            `UPDATE repair_orders
             SET payment_status = 'unpaid', updated_at = now()
             WHERE tenant_id = $1 AND id = $2 AND payment_status = 'invoiced'`,
            [tenant, orderId],
          );
        }
      }

      return { success: true, id };
    });
  }

  async bulkUpdate(
    tenant: string,
    p: {
      ids: string[];
      status?: "draft" | "sent" | "overdue" | "cancelled";
      due_date?: string;
      notes?: string;
    },
  ): Promise<{ updated: number; skippedPaid: number; ids: string[] }> {
    const sets: string[] = [];
    const baseParams: (string | string[])[] = [tenant];
    const push = (col: string, val: string): void => {
      baseParams.push(val);
      sets.push(`${col} = $${baseParams.length}`);
    };

    if (p.status !== undefined) push("status", p.status);
    if (p.due_date !== undefined) push("due_date", p.due_date);
    if (p.notes !== undefined) push("notes", p.notes);

    if (sets.length === 0) {
      throw new ValidationError("Укажите хотя бы одно поле для массового редактирования");
    }

    return withTenant(tenant, async (tx) => {
      const rows = await tx.query<{ id: string; status: string }>(
        `SELECT id, status
         FROM invoices
         WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL
         FOR UPDATE`,
        [tenant, p.ids],
      );

      if (rows.length === 0) {
        throw new NotFoundError("Счета не найдены");
      }

      const editableIds = rows.filter((r) => r.status !== "paid").map((r) => r.id);
      const skippedPaid = rows.length - editableIds.length;

      if (editableIds.length === 0) {
        throw new AppError(
          409,
          "INVOICE_PAID_READONLY",
          "Оплаченные счета нельзя редактировать",
        );
      }

      const idsParamIndex = baseParams.length + 1;
      await tx.query(
        `UPDATE invoices
         SET ${sets.join(", ")}, updated_at = now()
         WHERE tenant_id = $1 AND id = ANY($${idsParamIndex}) AND deleted_at IS NULL`,
        [...baseParams, editableIds],
      );

      return { updated: editableIds.length, skippedPaid, ids: editableIds };
    });
  }

  async bulkRemove(
    tenant: string,
    ids: string[],
  ): Promise<{ deleted: number; skippedPaid: number; ids: string[] }> {
    return withTenant(tenant, async (tx) => {
      const rows = await tx.query<{ id: string; status: string; repair_order_id: string | null }>(
        `SELECT id, status, repair_order_id
         FROM invoices
         WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL
         FOR UPDATE`,
        [tenant, ids],
      );

      if (rows.length === 0) {
        throw new NotFoundError("Счета не найдены");
      }

      const deletable = rows.filter((r) => r.status !== "paid");
      const skippedPaid = rows.length - deletable.length;

      if (deletable.length === 0) {
        throw new AppError(
          409,
          "INVOICE_PAID_DELETE_FORBIDDEN",
          "Оплаченные счета нельзя удалить",
        );
      }

      const deletableIds = deletable.map((r) => r.id);

      const linkedRows = await tx.query<{ repair_order_id: string }>(
        `SELECT repair_order_id
         FROM invoice_repair_orders
         WHERE tenant_id = $1 AND invoice_id = ANY($2)`,
        [tenant, deletableIds],
      );

      const linkedOrderIds = new Set<string>(linkedRows.map((r) => r.repair_order_id));
      for (const row of deletable) {
        if (row.repair_order_id) {
          linkedOrderIds.add(row.repair_order_id);
        }
      }

      await tx.query(
        `UPDATE invoices
         SET deleted_at = now(), updated_at = now()
         WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenant, deletableIds],
      );

      await tx.query(
        `DELETE FROM invoice_repair_orders
         WHERE tenant_id = $1 AND invoice_id = ANY($2)`,
        [tenant, deletableIds],
      );

      for (const orderId of linkedOrderIds) {
        const remaining = await tx.queryOne<{ cnt: string }>(
          `SELECT COUNT(*)::text AS cnt
           FROM invoices i
           LEFT JOIN invoice_repair_orders iro ON iro.invoice_id = i.id AND iro.tenant_id = i.tenant_id
           WHERE i.tenant_id = $1
             AND i.deleted_at IS NULL
             AND i.status <> 'cancelled'
             AND (i.repair_order_id = $2 OR iro.repair_order_id = $2)`,
          [tenant, orderId],
        );
        if (Number(remaining?.cnt ?? 0) === 0) {
          await tx.query(
            `UPDATE repair_orders
             SET payment_status = 'unpaid', updated_at = now()
             WHERE tenant_id = $1 AND id = $2 AND payment_status = 'invoiced'`,
            [tenant, orderId],
          );
        }
      }

      return { deleted: deletableIds.length, skippedPaid, ids: deletableIds };
    });
  }

  async markPaid(
    tenant: string,
    _user: string,
    id: string,
    p: MarkInvoicePaidPayload,
  ): Promise<InvoiceDTO> {
    return withTenant(tenant, async (tx) => {
      const inv = await tx.queryOne<InvoiceRow>(
        `SELECT ${INVOICE_COLS} FROM invoices WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,
        [tenant, id],
      );
      if (!inv) throw new NotFoundError("Invoice not found");
      if (inv.status === "paid") throw new AppError(409, "INVOICE_ALREADY_PAID", "Invoice is already paid");
      const account = await tx.queryOne<{ id: string; currency: string }>(
        `SELECT id,currency FROM cash_accounts WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,
        [tenant, p.account_id],
      );
      if (!account) throw new NotFoundError("Cash account not found");
      if (account.currency !== inv.currency) throw new ValidationError("Account currency differs from invoice");
      await tx.query(
        `UPDATE invoices SET status='paid',paid_at=COALESCE($3::timestamptz,now()),paid_account_id=$4 WHERE tenant_id=$1 AND id=$2`,
        [tenant, id, p.occurred_at || null, p.account_id],
      );
      await tx.query(`UPDATE cash_accounts SET balance=balance+$3 WHERE tenant_id=$1 AND id=$2`, [
        tenant,
        p.account_id,
        Number(inv.total),
      ]);
      await tx.query(
        `INSERT INTO transactions(tenant_id,cash_account_id,category_id,category_name,amount,currency,direction,description,invoice_id,repair_order_id,deal_id) VALUES($1,$2,NULL,'Оплата счёта',$3,$4,'income',$5,$6,$7,$8)`,
        [
          tenant,
          p.account_id,
          Number(inv.total),
          inv.currency,
          p.description || `Оплата счёта №${inv.invoice_number}`,
          id,
          inv.repair_order_id,
          inv.deal_id,
        ],
      );
      const updated = {
        ...inv,
        status: "paid" as const,
        paid_at: new Date().toISOString(),
        paid_account_id: p.account_id,
      };
      return this.dtoTx(tenant, tx, updated);
    });
  }
}
