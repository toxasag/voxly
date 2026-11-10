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
  vat_rate: string;
  vat_amount: string;
  total: string;
  currency: string;
  notes: string;
  paid_at: Date | string | null;
  paid_account_id: string | null;
}

interface ItemRow {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: string;
  total: string;
  source: string;
  source_label: string | null;
}

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : v);

const INVOICE_COLS = `id,invoice_number,status,issue_date,due_date,company_id,company_name,company_inn,company_address,contact_name,contact_phone,deal_id,repair_order_id,subtotal,vat_rate,vat_amount,total,currency,notes,paid_at,paid_account_id`;

const item = (r: ItemRow): InvoiceItemDTO => ({
  id: r.id,
  description: r.description,
  quantity: r.quantity,
  unitPrice: Number(r.unit_price),
  total: Number(r.total),
  source: r.source,
  sourceLabel: r.source_label,
});

export class InvoicesService {
  /** Invoice series counter — keyed on counter_type='invoice' so it advances independently of ЗН- repair numbers. */
  private async number(tx: TransactionClient, tenant: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    const r = await tx.queryOneOrThrow<{ last_number: number }>(
      `INSERT INTO repair_counters(tenant_id,counter_type,year,last_number)
       VALUES($1,'invoice',$2,1)
       ON CONFLICT(tenant_id,counter_type,year)
       DO UPDATE SET last_number=repair_counters.last_number+1
       RETURNING last_number`,
      [tenant, year],
    );
    return `СЧ-${year}-${String(r.last_number).padStart(4, "0")}`;
  }

  private async dto(tenant: string, r: InvoiceRow): Promise<InvoiceDTO> {
    const items = await query<ItemRow>(
      `SELECT id,invoice_id,description,quantity,unit_price,total,source,source_label
       FROM invoice_items
       WHERE invoice_id=$1 AND EXISTS(SELECT 1 FROM invoices WHERE id=$1 AND tenant_id=$2)
       ORDER BY created_at`,
      [r.id, tenant],
    );
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
      vatRate: Number(r.vat_rate),
      vatAmount: Number(r.vat_amount),
      total: Number(r.total),
      currency: r.currency,
      notes: r.notes,
      paidAt: r.paid_at === null ? null : iso(r.paid_at),
      paidAccountId: r.paid_account_id,
      lineItems: items.map(item),
    };
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
              i.subtotal, i.vat_rate, i.vat_amount, i.total, i.currency, i.notes,
              i.paid_at, i.paid_account_id
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
    return withTenant(tenant, async (tx) => {
      const number = await this.number(tx, tenant);
      const subtotal = p.line_items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const vat = Math.round(subtotal * p.vat_rate) / 100;
      const row = await tx.queryOneOrThrow<InvoiceRow>(
        `INSERT INTO invoices(tenant_id,invoice_number,status,due_date,company_id,company_name,company_inn,company_address,contact_name,contact_phone,deal_id,repair_order_id,subtotal,vat_rate,vat_amount,total,currency,notes,created_by)
         VALUES($1,$2,'sent',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
          subtotal,
          p.vat_rate,
          vat,
          subtotal + vat,
          p.currency,
          p.notes || "",
          user,
        ],
      );
      for (const i of p.line_items) {
        await tx.query(
          `INSERT INTO invoice_items(invoice_id,description,quantity,unit_price,total,source,source_label)
           VALUES($1,$2,$3,$4,$5,$6,$7)`,
          [
            row.id,
            i.description,
            i.quantity,
            i.unit_price,
            i.quantity * i.unit_price,
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
      return this.dtoTx(tenant, tx, row);
    });
  }

  private async dtoTx(_tenant: string, tx: TransactionClient, r: InvoiceRow): Promise<InvoiceDTO> {
    const items = await tx.query<ItemRow>(
      `SELECT id,invoice_id,description,quantity,unit_price,total,source,source_label
       FROM invoice_items
       WHERE invoice_id=$1`,
      [r.id],
    );
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
      vatRate: Number(r.vat_rate),
      vatAmount: Number(r.vat_amount),
      total: Number(r.total),
      currency: r.currency,
      notes: r.notes,
      paidAt: r.paid_at === null ? null : iso(r.paid_at),
      paidAccountId: r.paid_account_id,
      lineItems: items.map(item),
    };
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
    const line_items = [
      ...works.map((w) => ({
        description: w.description,
        quantity: Number(w.quantity || 1),
        unit_price: Number(w.unit_price != null ? w.unit_price : w.cost),
        source: "repair_work" as const,
        source_label: repair.ticket_number,
      })),
      ...parts.map((x) => ({
        description: x.name,
        quantity: x.quantity,
        unit_price: Number(x.retail_price),
        source: "repair_part" as const,
        source_label: repair.ticket_number,
      })),
    ];
    if (line_items.length === 0) {
      line_items.push({
        description: `Repair ${repair.ticket_number}`,
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
        line_items,
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
      customer_name: string;
      customer_phone: string;
      equipment_type: string;
      equipment_brand: string;
      equipment_model: string;
      estimated_cost: string | number;
      final_cost: string | number | null;
      deal_id: string | null;
    }>(
      `SELECT id, ticket_number, customer_name, customer_phone, equipment_type, equipment_brand,
              equipment_model, estimated_cost, final_cost, deal_id
       FROM repair_orders
       WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [tenant, p.repair_order_ids],
    );

    if (repairs.length === 0) {
      throw new NotFoundError("Repair orders not found");
    }

    const firstRepair = repairs[0]!;
    const line_items: {
      description: string;
      quantity: number;
      unit_price: number;
      source: "repair_work" | "repair_part" | "manual";
      source_label: string;
    }[] = [];

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

      for (const w of works) {
        line_items.push({
          description: w.description,
          quantity: Number(w.quantity || 1),
          unit_price: Number(w.unit_price != null ? w.unit_price : w.cost),
          source: "repair_work",
          source_label: repair.ticket_number,
        });
      }

      for (const pt of parts) {
        line_items.push({
          description: pt.name,
          quantity: pt.quantity,
          unit_price: Number(pt.retail_price),
          source: "repair_part",
          source_label: repair.ticket_number,
        });
      }

      if (works.length === 0 && parts.length === 0) {
        const cost = Number(repair.final_cost ?? repair.estimated_cost ?? 0);
        line_items.push({
          description: `Ремонт ${repair.equipment_type} ${repair.equipment_brand} ${repair.equipment_model}`,
          quantity: 1,
          unit_price: cost,
          source: "repair_work",
          source_label: repair.ticket_number,
        });
      }
    }

    return withTenant(tenant, async (tx) => {
      const number = await this.number(tx, tenant);
      const subtotal = line_items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
      const vatRate = p.vat_rate ?? 20;
      const vat = Math.round(subtotal * vatRate) / 100;
      const total = subtotal + vat;

      const companyName = p.company_name || firstRepair.customer_name;
      const contactName = p.contact_name || firstRepair.customer_name;
      const contactPhone = p.contact_phone || firstRepair.customer_phone;
      const dealId = p.deal_id ?? firstRepair.deal_id ?? null;
      const dueDate = p.due_date ?? new Date(Date.now() + 3 * 86400 * 1000).toISOString();

      const row = await tx.queryOneOrThrow<InvoiceRow>(
        `INSERT INTO invoices (
           tenant_id, invoice_number, status, due_date, company_id, company_name,
           company_inn, company_address, contact_name, contact_phone, deal_id,
           repair_order_id, subtotal, vat_rate, vat_amount, total, currency, notes, created_by
         )
         VALUES ($1, $2, 'sent', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING ${INVOICE_COLS}`,
        [
          tenant,
          number,
          dueDate,
          p.company_id || null,
          companyName,
          p.company_inn || "",
          p.company_address || "",
          contactName,
          contactPhone,
          dealId,
          firstRepair.id,
          subtotal,
          vatRate,
          vat,
          total,
          p.currency ?? "RUB",
          p.notes || "",
          user,
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
            i.quantity * i.unit_price,
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

      return this.dtoTx(tenant, tx, row);
    });
  }

  async getPdf(tenant: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const inv = await this.get(tenant, id);
    const settings = await queryOne<{
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
    }>(
      `SELECT company_name, company_address, company_phone, company_email, company_website,
              company_inn, company_ogrn, bank_name, bik, corr_account, settlement_account,
              company_kpp, director_name, accountant_name
       FROM print_template_settings
       WHERE tenant_id = $1`,
      [tenant],
    );

    const buffer = generateInvoicePdfBuffer(inv, settings ?? {});
    return { buffer, filename: `Invoice-${inv.invoiceNumber}.pdf` };
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
    const sets: string[] = [];
    const params: (string | Date)[] = [tenant, id];
    if (p.status) {
      params.push(p.status);
      sets.push(`status=$${params.length}`);
    }
    if (p.due_date) {
      params.push(p.due_date);
      sets.push(`due_date=$${params.length}`);
    }
    if (p.notes !== undefined) {
      params.push(p.notes);
      sets.push(`notes=$${params.length}`);
    }
    if (!sets.length) {
      const r = await queryOne<InvoiceRow>(
        `SELECT ${INVOICE_COLS} FROM invoices WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL`,
        params,
      );
      if (!r) throw new NotFoundError("Invoice not found");
      return this.dto(tenant, r);
    }
    const r = await queryOne<InvoiceRow>(
      `UPDATE invoices SET ${sets.join(",")} WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL RETURNING ${INVOICE_COLS}`,
      params,
    );
    if (!r) throw new NotFoundError("Invoice not found");
    return this.dto(tenant, r);
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
        `INSERT INTO transactions(tenant_id,cash_account_id,category_id,category_name,amount,currency,direction,description,invoice_id,repair_order_id,deal_id) VALUES($1,$2,NULL,'Invoice payment',$3,$4,'income',$5,$6,$7,$8)`,
        [
          tenant,
          p.account_id,
          Number(inv.total),
          inv.currency,
          p.description || `Payment ${inv.invoice_number}`,
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
