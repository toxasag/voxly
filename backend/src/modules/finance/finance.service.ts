import type {
  AccountDTO,
  AccountType,
  BatchPaymentPayload,
  CreateCategoryPayload,
  CreateTransactionPayload,
  FinanceCategoryDTO,
  PnlDTO,
  TransactionDTO,
  TransferPayload,
  UpdateCategoryPayload,
  UpdateTransactionPayload,
} from "./finance.types.js";
import { query, queryOne, withTenant, type SqlParam, type TransactionClient } from "../../db/client.js";
import { AppError, NotFoundError, ValidationError } from "../../plugins/errorHandler.js";

interface AccountRow { id: string; name: string; account_type?: string; currency: string; balance: string; is_default: boolean }
interface TxRow {
  id: string;
  direction: "income" | "expense";
  amount: string;
  currency: string;
  category_id: string | null;
  category_name: string;
  description: string;
  cash_account_id: string;
  account_name: string;
  deal_id: string | null;
  repair_order_id: string | null;
  invoice_id: string | null;
  counterparty_name: string;
  counterparty_inn: string;
  occurred_at: Date | string;
}
const iso = (value: Date | string) => value instanceof Date ? value.toISOString() : value;
const blank = (v: string | undefined) => v === undefined || v === "" ? null : v;

export class FinanceService {
  /**
   * Пересчитывает и фиксирует баланс счёта строго как сумму активных операций
   * (SUM(income) - SUM(expense) WHERE deleted_at IS NULL).
   */
  private async recalculateAccountBalanceInTx(
    tx: TransactionClient,
    tenantId: string,
    accountId: string,
  ): Promise<number> {
    const row = await tx.queryOne<{ balance: string }>(
      `UPDATE cash_accounts
       SET balance = COALESCE((
         SELECT SUM(CASE WHEN direction = 'income' THEN amount ELSE -amount END)
         FROM transactions
         WHERE tenant_id = $1 AND cash_account_id = $2 AND deleted_at IS NULL
       ), 0)
       WHERE tenant_id = $1 AND id = $2
       RETURNING balance::text`,
      [tenantId, accountId],
    );
    return Number(row?.balance ?? 0);
  }

  async createAccount(
    tenantId: string,
    p: { name: string; account_type?: AccountType; currency: string; opening_balance: number; is_default: boolean },
  ): Promise<AccountDTO> {
    const accType = p.account_type ?? "cash";
    const opening = Number(p.opening_balance ?? 0);

    return withTenant(tenantId, async (tx) => {
      const row = await tx.queryOne<AccountRow>(
        `INSERT INTO cash_accounts (tenant_id, name, account_type, currency, balance, is_default)
         VALUES ($1, $2, $3, $4, 0, $5)
         RETURNING id, name, account_type, currency, balance, is_default`,
        [tenantId, p.name, accType, p.currency, p.is_default],
      );
      if (!row) throw new Error("Account creation failed");

      let balance = 0;
      if (opening > 0) {
        await tx.query(
          `INSERT INTO transactions
             (tenant_id, cash_account_id, category_id, category_name, amount, currency, direction, description, occurred_at)
           VALUES ($1, $2, NULL, 'Начальный остаток', $3, $4, 'income', $5, now())`,
          [tenantId, row.id, opening, p.currency, `Начальный остаток при открытии счёта «${p.name}»`],
        );
        balance = await this.recalculateAccountBalanceInTx(tx, tenantId, row.id);
      }

      return {
        id: row.id,
        name: row.name,
        accountType: (row.account_type as AccountType) || "cash",
        currency: row.currency,
        balance,
        isDefault: row.is_default,
      };
    });
  }

  async accounts(tenantId: string): Promise<AccountDTO[]> {
    const rows = await query<AccountRow>(
      `SELECT a.id,
              a.name,
              COALESCE(a.account_type, 'cash') AS account_type,
              a.currency,
              COALESCE((
                SELECT SUM(CASE WHEN t.direction = 'income' THEN t.amount ELSE -t.amount END)
                FROM transactions t
                WHERE t.tenant_id = a.tenant_id AND t.cash_account_id = a.id AND t.deleted_at IS NULL
              ), 0)::text AS balance,
              a.is_default
       FROM cash_accounts a
       WHERE a.tenant_id = $1 AND a.deleted_at IS NULL
       ORDER BY a.is_default DESC, a.name`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      accountType: (r.account_type as AccountType) || "cash",
      currency: r.currency,
      balance: Number(r.balance),
      isDefault: r.is_default,
    }));
  }

  async transactions(
    tenantId: string,
    limit: number,
    offset: number,
    options?: { search?: string; type?: "income" | "expense" },
  ): Promise<{ items: TransactionDTO[]; total: number }> {
    const conditions: string[] = ["t.tenant_id = $1", "t.deleted_at IS NULL"];
    const params: SqlParam[] = [tenantId];

    if (options?.type) {
      params.push(options.type);
      conditions.push(`t.direction = $${params.length}`);
    }

    if (options?.search && options.search.trim()) {
      params.push(`%${options.search.trim()}%`);
      conditions.push(
        `(t.description ILIKE $${params.length} OR t.counterparty_name ILIKE $${params.length} OR t.category_name ILIKE $${params.length} OR a.name ILIKE $${params.length})`,
      );
    }

    const whereSql = conditions.join(" AND ");

    const countSql = `SELECT COUNT(*)::text AS total FROM transactions t JOIN cash_accounts a ON a.id = t.cash_account_id AND a.tenant_id = t.tenant_id WHERE ${whereSql}`;
    const total = await queryOne<{ total: string }>(countSql, params);

    const selectParams: SqlParam[] = [...params, limit, offset];
    const rowsSql = `SELECT t.id, t.direction, t.amount, t.currency, t.category_id, t.category_name, t.description,
                            COALESCE(t.counterparty_name, '') AS counterparty_name,
                            COALESCE(t.counterparty_inn, '') AS counterparty_inn,
                            t.cash_account_id, a.name AS account_name,
                            t.deal_id, t.repair_order_id, t.invoice_id, t.occurred_at
                     FROM transactions t
                     JOIN cash_accounts a ON a.id = t.cash_account_id AND a.tenant_id = t.tenant_id
                     WHERE ${whereSql}
                     ORDER BY t.occurred_at DESC
                     LIMIT $${selectParams.length - 1} OFFSET $${selectParams.length}`;

    const rows = await query<TxRow>(rowsSql, selectParams);
    return { items: rows.map(this.toTx), total: Number(total?.total ?? 0) };
  }

  private toTx(row: TxRow): TransactionDTO {
    return {
      id: row.id,
      type: row.direction,
      amount: Number(row.amount),
      currency: row.currency,
      categoryId: row.category_id,
      categoryName: row.category_name,
      description: row.description,
      accountId: row.cash_account_id,
      accountName: row.account_name,
      dealId: row.deal_id,
      repairOrderId: row.repair_order_id,
      invoiceId: row.invoice_id,
      counterpartyName: row.counterparty_name || "",
      counterpartyInn: row.counterparty_inn || "",
      occurredAt: iso(row.occurred_at),
    };
  }

  async bulkDeleteTransactions(tenantId: string, ids: string[]): Promise<{ count: number }> {
    if (ids.length === 0) return { count: 0 };
    return withTenant(tenantId, async (tx) => {
      const deleted = await tx.query<{ id: string; cash_account_id: string; direction: "income" | "expense"; amount: string }>(
        `UPDATE transactions
         SET deleted_at = now()
         WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL
         RETURNING id, cash_account_id, direction, amount`,
        [tenantId, ids],
      );

      const affectedAccountIds = Array.from(new Set(deleted.map((r) => r.cash_account_id)));
      for (const accId of affectedAccountIds) {
        await this.recalculateAccountBalanceInTx(tx, tenantId, accId);
      }

      return { count: deleted.length };
    });
  }

  async bulkDuplicateTransactions(tenantId: string, ids: string[]): Promise<TransactionDTO[]> {
    if (ids.length === 0) return [];
    return withTenant(tenantId, async (tx) => {
      const sources = await tx.query<TxRow>(
        `SELECT t.id, t.direction, t.amount, t.currency, t.category_id, t.category_name, t.description,
                COALESCE(t.counterparty_name, '') AS counterparty_name,
                COALESCE(t.counterparty_inn, '') AS counterparty_inn,
                t.cash_account_id, a.name AS account_name,
                t.deal_id, t.repair_order_id, t.invoice_id, t.occurred_at
         FROM transactions t
         JOIN cash_accounts a ON a.id = t.cash_account_id AND a.tenant_id = t.tenant_id
         WHERE t.tenant_id = $1 AND t.id = ANY($2) AND t.deleted_at IS NULL`,
        [tenantId, ids],
      );

      const results: TransactionDTO[] = [];
      for (const src of sources) {
        const row = await tx.queryOneOrThrow<TxRow>(
          `INSERT INTO transactions
             (tenant_id, cash_account_id, category_id, category_name, amount, currency, direction,
              description, counterparty_name, counterparty_inn, deal_id, repair_order_id, invoice_id, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
           RETURNING id, direction, amount, currency, category_id, category_name, description,
                     counterparty_name, counterparty_inn, cash_account_id,
                     (SELECT name FROM cash_accounts WHERE id = $2) AS account_name,
                     deal_id, repair_order_id, invoice_id, occurred_at`,
          [
            tenantId,
            src.cash_account_id,
            src.category_id,
            src.category_name,
            src.amount,
            src.currency,
            src.direction,
            src.description,
            src.counterparty_name,
            src.counterparty_inn,
            src.deal_id,
            src.repair_order_id,
            src.invoice_id,
          ],
        );

        await this.recalculateAccountBalanceInTx(tx, tenantId, src.cash_account_id);

        results.push(this.toTx(row));
      }

      return results;
    });
  }

  async counterparties(tenantId: string, search?: string, limit = 20): Promise<{
    contacts: Array<{ id: string; name: string; phone: string; email: string }>;
    companies: Array<{ id: string; name: string; inn: string; phone: string }>;
  }> {
    const q = search?.trim() ? `%${search.trim()}%` : null;

    const contactsQuery = q
      ? `SELECT id, first_name, last_name, middle_name, phone, email
         FROM contacts
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND (first_name ILIKE $2 OR last_name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)
         ORDER BY last_name, first_name
         LIMIT $3`
      : `SELECT id, first_name, last_name, middle_name, phone, email
         FROM contacts
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT $2`;

    const contactsParams = q ? [tenantId, q, limit] : [tenantId, limit];
    const contactsRows = await query<{
      id: string;
      first_name: string;
      last_name: string;
      middle_name: string;
      phone: string;
      email: string;
    }>(contactsQuery, contactsParams);

    const companiesQuery = q
      ? `SELECT id, name, inn, phone
         FROM companies
         WHERE tenant_id = $1 AND deleted_at IS NULL
           AND (name ILIKE $2 OR inn ILIKE $2 OR phone ILIKE $2)
         ORDER BY name
         LIMIT $3`
      : `SELECT id, name, inn, phone
         FROM companies
         WHERE tenant_id = $1 AND deleted_at IS NULL
         ORDER BY updated_at DESC
         LIMIT $2`;

    const companiesParams = q ? [tenantId, q, limit] : [tenantId, limit];
    const companiesRows = await query<{
      id: string;
      name: string;
      inn: string;
      phone: string;
    }>(companiesQuery, companiesParams);

    return {
      contacts: contactsRows.map((c) => ({
        id: c.id,
        name: [c.last_name, c.first_name, c.middle_name].filter(Boolean).join(" ").trim() || "Без имени",
        phone: c.phone || "",
        email: c.email || "",
      })),
      companies: companiesRows.map((co) => ({
        id: co.id,
        name: co.name || "Без названия",
        inn: co.inn || "",
        phone: co.phone || "",
      })),
    };
  }
  private async account(tx: TransactionClient, tenantId: string, id: string): Promise<AccountRow> {
    const row = await tx.queryOne<AccountRow>(
      `SELECT id, name, COALESCE(account_type, 'cash') AS account_type, currency, balance, is_default
       FROM cash_accounts
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [tenantId, id],
    );
    if (!row) throw new NotFoundError("Cash account not found");
    return row;
  }

  async createTransaction(tenantId: string, p: CreateTransactionPayload): Promise<TransactionDTO> {
    return withTenant(tenantId, async (tx) => {
      const a = await this.account(tx, tenantId, p.account_id);
      if (a.currency !== p.currency) throw new ValidationError("Account currency differs from transaction currency");
      const sign = p.type === "income" ? 1 : -1;
      if (sign < 0 && Number(a.balance) < p.amount) throw new AppError(409, "INSUFFICIENT_FUNDS", "Insufficient account balance");
      const row = await tx.queryOneOrThrow<TxRow>(
        `INSERT INTO transactions
           (tenant_id, cash_account_id, category_id, category_name, amount, currency, direction,
            description, counterparty_name, counterparty_inn, deal_id, repair_order_id, invoice_id, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, COALESCE($14::timestamptz, now()))
         RETURNING id, direction, amount, currency, category_id, category_name, description,
                   COALESCE(counterparty_name, '') AS counterparty_name,
                   COALESCE(counterparty_inn, '') AS counterparty_inn,
                   cash_account_id, (SELECT name FROM cash_accounts WHERE id = $2) AS account_name,
                   deal_id, repair_order_id, invoice_id, occurred_at`,
        [
          tenantId,
          p.account_id,
          blank(p.category_id),
          p.category_name,
          p.amount,
          p.currency,
          p.type,
          p.description ?? "",
          p.counterparty_name ?? "",
          p.counterparty_inn ?? "",
          blank(p.deal_id),
          blank(p.repair_order_id),
          blank(p.invoice_id),
          p.occurred_at ?? null,
        ],
      );
      await this.recalculateAccountBalanceInTx(tx, tenantId, p.account_id);
      return this.toTx(row);
    });
  }

  async updateTransaction(tenantId: string, id: string, p: UpdateTransactionPayload): Promise<TransactionDTO> {
    return withTenant(tenantId, async (tx) => {
      const current = await tx.queryOne<TxRow>(
        `SELECT t.id, t.direction, t.amount, t.currency, t.category_id, t.category_name, t.description,
                COALESCE(t.counterparty_name, '') AS counterparty_name,
                COALESCE(t.counterparty_inn, '') AS counterparty_inn,
                t.cash_account_id, a.name AS account_name,
                t.deal_id, t.repair_order_id, t.invoice_id, t.occurred_at
         FROM transactions t
         JOIN cash_accounts a ON a.id = t.cash_account_id AND a.tenant_id = t.tenant_id
         WHERE t.tenant_id = $1 AND t.id = $2 AND t.deleted_at IS NULL
         FOR UPDATE`,
        [tenantId, id],
      );
      if (!current) throw new NotFoundError("Transaction not found");

      const newAccountId = p.account_id ?? current.cash_account_id;

      if (newAccountId !== current.cash_account_id) {
        const targetAcc = await this.account(tx, tenantId, newAccountId);
        if (targetAcc.currency !== (p.currency ?? current.currency)) {
          throw new ValidationError("Account currency differs from transaction currency");
        }
      }

      const updated = await tx.queryOneOrThrow<TxRow>(
        `UPDATE transactions
         SET cash_account_id = COALESCE($3, cash_account_id),
             direction = COALESCE($4, direction),
             amount = COALESCE($5, amount),
             currency = COALESCE($6, currency),
             category_id = CASE WHEN $7::boolean THEN $8 ELSE category_id END,
             category_name = COALESCE($9, category_name),
             description = CASE WHEN $10::boolean THEN $11 ELSE description END,
             counterparty_name = CASE WHEN $12::boolean THEN $13 ELSE counterparty_name END,
             counterparty_inn = CASE WHEN $14::boolean THEN $15 ELSE counterparty_inn END,
             deal_id = CASE WHEN $16::boolean THEN $17 ELSE deal_id END,
             repair_order_id = CASE WHEN $18::boolean THEN $19 ELSE repair_order_id END,
             invoice_id = CASE WHEN $20::boolean THEN $21 ELSE invoice_id END,
             occurred_at = COALESCE($22::timestamptz, occurred_at)
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
         RETURNING id, direction, amount, currency, category_id, category_name, description,
                   COALESCE(counterparty_name, '') AS counterparty_name,
                   COALESCE(counterparty_inn, '') AS counterparty_inn,
                   cash_account_id, (SELECT name FROM cash_accounts WHERE id = cash_account_id) AS account_name,
                   deal_id, repair_order_id, invoice_id, occurred_at`,
        [
          tenantId,
          id,
          p.account_id ?? null,
          p.type ?? null,
          p.amount !== undefined ? p.amount : null,
          p.currency ?? null,
          p.category_id !== undefined,
          blank(p.category_id),
          p.category_name ?? null,
          p.description !== undefined,
          p.description ?? "",
          p.counterparty_name !== undefined,
          p.counterparty_name ?? "",
          p.counterparty_inn !== undefined,
          p.counterparty_inn ?? "",
          p.deal_id !== undefined,
          blank(p.deal_id),
          p.repair_order_id !== undefined,
          blank(p.repair_order_id),
          p.invoice_id !== undefined,
          blank(p.invoice_id),
          p.occurred_at ?? null,
        ],
      );

      await this.recalculateAccountBalanceInTx(tx, tenantId, current.cash_account_id);
      if (newAccountId !== current.cash_account_id) {
        await this.recalculateAccountBalanceInTx(tx, tenantId, newAccountId);
      }

      return this.toTx(updated);
    });
  }

  async transfer(tenantId: string, p: TransferPayload): Promise<{ from: AccountDTO; to: AccountDTO }> {
    return withTenant(tenantId, async (tx) => {
      const from = await this.account(tx, tenantId, p.from_account_id);
      const to = await this.account(tx, tenantId, p.to_account_id);
      if (from.currency !== to.currency) throw new ValidationError("Cross-currency transfers are not supported");
      if (Number(from.balance) < p.amount) throw new AppError(409, "INSUFFICIENT_FUNDS", "Insufficient account balance");
      const occurred = new Date().toISOString();
      for (const [accountId, direction, description] of [
        [from.id, "expense", `Transfer to ${to.name}`],
        [to.id, "income", `Transfer from ${from.name}`],
      ] as const) {
        await tx.query(
          `INSERT INTO transactions (tenant_id, cash_account_id, category_id, category_name, amount, currency, direction, description, occurred_at)
           VALUES ($1, $2, NULL, 'Internal transfer', $3, $4, $5, $6, $7)`,
          [tenantId, accountId, p.amount, from.currency, direction, p.description || description, occurred],
        );
      }
      const fromBalance = await this.recalculateAccountBalanceInTx(tx, tenantId, from.id);
      const toBalance = await this.recalculateAccountBalanceInTx(tx, tenantId, to.id);
      return {
        from: {
          id: from.id,
          name: from.name,
          accountType: (from.account_type as AccountType) || "cash",
          currency: from.currency,
          balance: fromBalance,
          isDefault: from.is_default,
        },
        to: {
          id: to.id,
          name: to.name,
          accountType: (to.account_type as AccountType) || "cash",
          currency: to.currency,
          balance: toBalance,
          isDefault: to.is_default,
        },
      };
    });
  }
  async pnl(tenantId: string, from: string, to: string): Promise<PnlDTO> {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx.query<{ direction: "income" | "expense"; category_name: string; amount: string }>(
        `SELECT direction, category_name, SUM(amount)::text AS amount
         FROM transactions
         WHERE tenant_id = $1 AND deleted_at IS NULL AND occurred_at >= $2 AND occurred_at <= $3
         GROUP BY direction, category_name`,
        [tenantId, from, to],
      );
      const incomeRows = rows.filter((r) => r.direction === "income");
      const expenseRows = rows.filter((r) => r.direction === "expense");
      const income = incomeRows.reduce((s, r) => s + Number(r.amount), 0);
      const expenses = expenseRows.reduce((s, r) => s + Number(r.amount), 0);
      const map = (items: typeof rows, total: number) =>
        items.map((r) => ({
          categoryName: r.category_name,
          amount: Number(r.amount),
          percentage: total === 0 ? 0 : Math.round((Number(r.amount) / total) * 1000) / 10,
        }));

      // Партионная себестоимость списания (FIFO COGS) за период
      const cogsTotals = await tx.queryOne<{ parts_cogs: string; write_offs_count: string }>(
        `SELECT
           COALESCE(SUM(m.quantity * m.cost_price), 0)::numeric(14,2)::text AS parts_cogs,
           COUNT(*)::text AS write_offs_count
         FROM warehouse_movements m
         WHERE m.tenant_id = $1
           AND m.type = 'write_off'
           AND m.created_at >= $2
           AND m.created_at <= $3`,
        [tenantId, from, to],
      );

      // Выручка по запчастям (наряды СЦ) и прямым продажам товаров (сделки CRM) за период
      const repairPartsRevRow = await tx.queryOne<{ parts_revenue: string }>(
        `SELECT COALESCE(SUM(rp.quantity * rp.retail_price), 0)::numeric(14,2)::text AS parts_revenue
         FROM repair_parts rp
         JOIN repair_orders ro ON ro.id = rp.repair_order_id AND ro.tenant_id = rp.tenant_id
         WHERE rp.tenant_id = $1
           AND ro.deleted_at IS NULL
           AND (
             (rp.consumed_at IS NOT NULL AND rp.consumed_at >= $2 AND rp.consumed_at <= $3)
             OR (rp.consumed_at IS NULL AND ro.status = 'issued' AND ro.delivered_at >= $2 AND ro.delivered_at <= $3)
           )`,
        [tenantId, from, to],
      );

      const dealProductsRevRow = await tx.queryOne<{ deal_products_revenue: string }>(
        `SELECT COALESCE(SUM(di.total_amount), 0)::numeric(14,2)::text AS deal_products_revenue
         FROM deal_items di
         JOIN deals d ON d.id = di.deal_id AND d.tenant_id = di.tenant_id
         JOIN stages s ON s.id = d.stage_id
         WHERE di.tenant_id = $1
           AND di.item_type = 'product'
           AND d.deleted_at IS NULL
           AND (
             (di.consumed_at IS NOT NULL AND di.consumed_at >= $2 AND di.consumed_at <= $3)
             OR (di.consumed_at IS NULL AND s.is_won = true AND d.closed_at >= $2 AND d.closed_at <= $3)
           )`,
        [tenantId, from, to],
      );

      const worksRevRow = await tx.queryOne<{ works_revenue: string }>(
        `SELECT COALESCE(SUM(rw.cost), 0)::numeric(14,2)::text AS works_revenue
         FROM repair_works rw
         JOIN repair_orders ro ON ro.id = rw.repair_order_id AND ro.tenant_id = rw.tenant_id
         WHERE rw.tenant_id = $1
           AND ro.deleted_at IS NULL
           AND ro.status = 'issued'
           AND ro.delivered_at >= $2
           AND ro.delivered_at <= $3`,
        [tenantId, from, to],
      );

      const stockValRow = await tx.queryOne<{ stock_valuation: string }>(
        `SELECT COALESCE(SUM(b.remaining_quantity * b.purchase_price), 0)::numeric(14,2)::text AS stock_valuation
         FROM warehouse_batches b
         JOIN warehouse_items wi ON wi.id = b.item_id AND wi.tenant_id = b.tenant_id AND wi.deleted_at IS NULL
         WHERE b.tenant_id = $1 AND b.remaining_quantity > 0`,
        [tenantId],
      );

      const breakdownRows = await tx.query<{
        movement_id: string;
        item_name: string;
        batch_number: string | null;
        supplier_name: string | null;
        ticket_number: string | null;
        deal_id: string | null;
        deal_title: string | null;
        quantity: string;
        unit_cost: string;
        total_cost: string;
        occurred_at: Date | string;
      }>(
        `SELECT m.id AS movement_id,
                COALESCE(wi.name, m.description) AS item_name,
                b.batch_number,
                b.supplier_name,
                ro.ticket_number,
                m.deal_id,
                d.title AS deal_title,
                m.quantity::text AS quantity,
                m.cost_price::text AS unit_cost,
                (m.quantity * m.cost_price)::numeric(14,2)::text AS total_cost,
                m.created_at AS occurred_at
         FROM warehouse_movements m
         LEFT JOIN warehouse_items wi ON wi.id = m.item_id AND wi.tenant_id = m.tenant_id
         LEFT JOIN warehouse_batches b ON b.id = m.batch_id AND b.tenant_id = m.tenant_id
         LEFT JOIN repair_orders ro ON ro.id = m.repair_order_id AND ro.tenant_id = m.tenant_id
         LEFT JOIN deals d ON d.id = m.deal_id AND d.tenant_id = m.tenant_id
         WHERE m.tenant_id = $1
           AND m.type = 'write_off'
           AND m.created_at >= $2
           AND m.created_at <= $3
         ORDER BY m.created_at DESC
         LIMIT 50`,
        [tenantId, from, to],
      );

      const partsCogs = Math.round(Number(cogsTotals?.parts_cogs ?? 0) * 100) / 100;
      const repairPartsRevenue = Math.round(Number(repairPartsRevRow?.parts_revenue ?? 0) * 100) / 100;
      const dealProductsRevenue = Math.round(Number(dealProductsRevRow?.deal_products_revenue ?? 0) * 100) / 100;
      const partsRevenue = Math.round((repairPartsRevenue + dealProductsRevenue) * 100) / 100;
      const worksRevenue = Math.round(Number(worksRevRow?.works_revenue ?? 0) * 100) / 100;
      const partsGrossProfit = Math.round((partsRevenue - partsCogs) * 100) / 100;
      const partsMarkupPercent =
        partsCogs > 0 ? Math.round((partsGrossProfit / partsCogs) * 1000) / 10 : 0;
      const partsMarginPercent =
        partsRevenue > 0 ? Math.round((partsGrossProfit / partsRevenue) * 1000) / 10 : 0;
      const accrualGrossProfit = Math.round((partsRevenue + worksRevenue - partsCogs) * 100) / 100;
      const stockValuation = Math.round(Number(stockValRow?.stock_valuation ?? 0) * 100) / 100;

      return {
        from,
        to,
        income,
        expenses,
        netProfit: income - expenses,
        incomeByCategory: map(incomeRows, income),
        expensesByCategory: map(expenseRows, expenses),
        cogs: {
          partsRevenue,
          repairPartsRevenue,
          dealProductsRevenue,
          worksRevenue,
          partsCogs,
          partsGrossProfit,
          partsMarkupPercent,
          partsMarginPercent,
          accrualGrossProfit,
          stockValuation,
          writeOffsCount: Number(cogsTotals?.write_offs_count ?? 0),
          breakdown: breakdownRows.map((b) => ({
            movementId: b.movement_id,
            itemName: b.item_name,
            batchNumber: b.batch_number ?? "",
            supplierName: b.supplier_name ?? "",
            ticketNumber: b.ticket_number ?? null,
            dealId: b.deal_id ?? null,
            dealTitle: b.deal_title ?? null,
            quantity: Number(b.quantity),
            unitCost: Number(b.unit_cost),
            totalCost: Number(b.total_cost),
            occurredAt: iso(b.occurred_at),
          })),
        },
      };
    });
  }
 async recordRepairOrderPayment(tenantId:string,repairOrderId:string,ticketNumber:string,customerName:string,worksAmount:number,partsAmount:number,accountId?:string):Promise<void>{
  const total=worksAmount+partsAmount;
  if(total<=0)return;
  let targetAccount=accountId;
  if(!targetAccount){
    const defaultAcc=await queryOne<{id:string}>(`SELECT id FROM cash_accounts WHERE tenant_id=$1 AND is_default=true LIMIT 1`,[tenantId]);
    if(defaultAcc){targetAccount=defaultAcc.id;}else{
      const anyAcc=await queryOne<{id:string}>(`SELECT id FROM cash_accounts WHERE tenant_id=$1 LIMIT 1`,[tenantId]);
      if(anyAcc)targetAccount=anyAcc.id;
    }
  }
  if(!targetAccount)return;
  if(worksAmount>0){
    await this.createTransaction(tenantId,{
      account_id:targetAccount,
      type:"income",
      amount:worksAmount,
      currency:"RUB",
      category_name:"Оплата выполненных работ",
      description:`Оплата работ по наряду №${ticketNumber}`,
      counterparty_name:customerName,
      repair_order_id:repairOrderId,
    });
  }
  if(partsAmount>0){
    await this.createTransaction(tenantId,{
      account_id:targetAccount,
      type:"income",
      amount:partsAmount,
      currency:"RUB",
      category_name:"Оплата запчастей клиентом",
      description:`Оплата запчастей по наряду №${ticketNumber}`,
      counterparty_name:customerName,
      repair_order_id:repairOrderId,
    });
  }
 }

  async batchPayment(
    tenantId: string,
    _user: string,
    payload: BatchPaymentPayload,
  ): Promise<{ success: boolean; totalPaid: number; count: number; transactionsCount: number }> {
    return withTenant(tenantId, async (tx) => {
      const account = await this.account(tx, tenantId, payload.cash_account_id);

      const resolveCategory = async (
        catId: string | undefined,
        fallbackName: string,
      ): Promise<{ id: string | null; name: string }> => {
        if (catId && catId.trim().length > 0) {
          const cat = await tx.queryOne<{ id: string; name: string }>(
            `SELECT id, name FROM finance_categories WHERE tenant_id = $1 AND id = $2`,
            [tenantId, catId],
          );
          if (cat) return { id: cat.id, name: cat.name };
        }
        return { id: null, name: fallbackName };
      };

      const defaultCat = await resolveCategory(payload.category_id, "Оплата по наряд-заказу");
      const worksCat = payload.works_category_id
        ? await resolveCategory(payload.works_category_id, "Оплата выполненных работ")
        : defaultCat;
      const partsCat = payload.parts_category_id
        ? await resolveCategory(payload.parts_category_id, "Продажа запчастей")
        : defaultCat;

      const splitMode = payload.split_works_and_parts !== false;

      const orders = await tx.query<{
        id: string;
        ticket_number: string;
        deal_id: string | null;
        customer_name: string;
        customer_phone: string;
        estimated_cost: string | number;
        final_cost: string | number | null;
      }>(
        `SELECT id, ticket_number, deal_id, customer_name, customer_phone, estimated_cost, final_cost
         FROM repair_orders
         WHERE tenant_id = $1 AND id = ANY($2) AND deleted_at IS NULL`,
        [tenantId, payload.repair_order_ids],
      );

      if (orders.length === 0) {
        throw new ValidationError("No valid repair orders found for payment");
      }

      let totalPaid = 0;
      let transactionsCount = 0;
      const userNote = payload.description?.trim() ?? "";

      const insertIncomeTx = async (
        amount: number,
        cat: { id: string | null; name: string },
        desc: string,
        order: { id: string; deal_id: string | null; customer_name: string },
      ): Promise<void> => {
        if (amount <= 0) return;
        totalPaid += amount;
        transactionsCount += 1;
        await tx.query(
          `INSERT INTO transactions (tenant_id, cash_account_id, category_id, category_name, amount, currency, direction, description, counterparty_name, deal_id, repair_order_id)
           VALUES ($1, $2, $3, $4, $5, $6, 'income', $7, $8, $9, $10)`,
          [
            tenantId,
            account.id,
            cat.id,
            cat.name,
            amount,
            account.currency,
            desc,
            order.customer_name || "",
            order.deal_id,
            order.id,
          ],
        );
      };

      const orderCalcs: {
        order: (typeof orders)[number];
        worksTotal: number;
        partsTotal: number;
        fallbackAmount: number;
      }[] = [];
      const zeroOrders: string[] = [];

      for (const order of orders) {
        const worksTotalRow = await tx.queryOne<{ total: string }>(
          `SELECT COALESCE(SUM(cost), 0)::text AS total FROM repair_works WHERE tenant_id = $1 AND repair_order_id = $2`,
          [tenantId, order.id],
        );
        const partsTotalRow = await tx.queryOne<{ total: string }>(
          `SELECT COALESCE(SUM(retail_price * quantity), 0)::text AS total FROM repair_parts WHERE tenant_id = $1 AND repair_order_id = $2`,
          [tenantId, order.id],
        );

        const worksTotal = Math.round(Number(worksTotalRow?.total ?? 0) * 100) / 100;
        const partsTotal = Math.round(Number(partsTotalRow?.total ?? 0) * 100) / 100;
        const fallbackAmount =
          worksTotal + partsTotal > 0
            ? 0
            : Math.round(Number(order.final_cost ?? order.estimated_cost ?? 0) * 100) / 100;

        if (worksTotal + partsTotal + fallbackAmount <= 0) {
          zeroOrders.push(order.ticket_number);
        } else {
          orderCalcs.push({ order, worksTotal, partsTotal, fallbackAmount });
        }
      }

      if (zeroOrders.length > 0) {
        throw new ValidationError(
          `Нельзя принять оплату по актам без указанной стоимости (0 ₽): ${zeroOrders.join(", ")}`,
        );
      }

      for (const { order, worksTotal, partsTotal, fallbackAmount } of orderCalcs) {
        if (splitMode && worksTotal > 0 && partsTotal > 0) {
          const worksDesc = userNote
            ? `${userNote} — работы (${order.ticket_number})`
            : `Оплата работ по акту ${order.ticket_number}`;
          const partsDesc = userNote
            ? `${userNote} — запчасти (${order.ticket_number})`
            : `Оплата запчастей по акту ${order.ticket_number}`;
          await insertIncomeTx(worksTotal, worksCat, worksDesc, order);
          await insertIncomeTx(partsTotal, partsCat, partsDesc, order);
        } else if (worksTotal > 0 || partsTotal > 0) {
          const amount = Math.round((worksTotal + partsTotal) * 100) / 100;
          const cat = splitMode
            ? worksTotal > 0
              ? worksCat
              : partsCat
            : defaultCat;
          const desc = userNote || `Оплата по акту ${order.ticket_number}`;
          await insertIncomeTx(amount, cat, desc, order);
        } else if (fallbackAmount > 0) {
          const desc = userNote || `Оплата по акту ${order.ticket_number}`;
          await insertIncomeTx(fallbackAmount, worksCat, desc, order);
        }

        await tx.query(
          `UPDATE repair_orders SET payment_status = 'paid', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, order.id],
        );
      }

      if (totalPaid > 0) {
        await this.recalculateAccountBalanceInTx(tx, tenantId, account.id);
      }

      return { success: true, totalPaid, count: orders.length, transactionsCount };
    });
  }

  // ---------------------------------------------------------------------------
  // Categories CRUD
  // ---------------------------------------------------------------------------

  async categories(tenantId: string, type?: "income" | "expense"): Promise<FinanceCategoryDTO[]> {
    return withTenant(tenantId, async (tx) => {
      interface CatRow {
        id: string;
        name: string;
        type: "income" | "expense";
        parent_id: string | null;
        created_at: Date | string;
      }
      const rows = await tx.query<CatRow>(
        `SELECT id, name, type, parent_id, created_at
         FROM finance_categories
         WHERE tenant_id = $1 AND ($2::text IS NULL OR type = $2)
         ORDER BY name ASC`,
        [tenantId, type ?? null],
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type,
        parentId: r.parent_id,
        createdAt: iso(r.created_at),
      }));
    });
  }

  async createCategory(tenantId: string, p: CreateCategoryPayload): Promise<FinanceCategoryDTO> {
    return withTenant(tenantId, async (tx) => {
      interface CatRow {
        id: string;
        name: string;
        type: "income" | "expense";
        parent_id: string | null;
        created_at: Date | string;
      }
      const parentId = p.parent_id && p.parent_id.trim().length > 0 ? p.parent_id : null;
      const row = await tx.queryOne<CatRow>(
        `INSERT INTO finance_categories (tenant_id, name, type, parent_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, type, parent_id, created_at`,
        [tenantId, p.name.trim(), p.type, parentId],
      );
      if (!row) throw new Error("Category creation failed");
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        parentId: row.parent_id,
        createdAt: iso(row.created_at),
      };
    });
  }

  async updateCategory(tenantId: string, id: string, p: UpdateCategoryPayload): Promise<FinanceCategoryDTO> {
    return withTenant(tenantId, async (tx) => {
      interface CatRow {
        id: string;
        name: string;
        type: "income" | "expense";
        parent_id: string | null;
        created_at: Date | string;
      }
      const assignments: string[] = [];
      const params: (string | null)[] = [tenantId, id];

      if (p.name !== undefined) {
        params.push(p.name.trim());
        assignments.push(`name = $${params.length}`);
      }
      if (p.type !== undefined) {
        params.push(p.type);
        assignments.push(`type = $${params.length}`);
      }
      if (p.parent_id !== undefined) {
        const parentId = p.parent_id && p.parent_id.trim().length > 0 ? p.parent_id : null;
        params.push(parentId);
        assignments.push(`parent_id = $${params.length}`);
      }

      if (assignments.length === 0) {
        const existing = await tx.queryOne<CatRow>(
          `SELECT id, name, type, parent_id, created_at FROM finance_categories WHERE tenant_id = $1 AND id = $2`,
          [tenantId, id],
        );
        if (!existing) throw new NotFoundError("Category not found");
        return {
          id: existing.id,
          name: existing.name,
          type: existing.type,
          parentId: existing.parent_id,
          createdAt: iso(existing.created_at),
        };
      }

      const row = await tx.queryOne<CatRow>(
        `UPDATE finance_categories
         SET ${assignments.join(", ")}
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, name, type, parent_id, created_at`,
        params,
      );
      if (!row) throw new NotFoundError("Category not found");
      return {
        id: row.id,
        name: row.name,
        type: row.type,
        parentId: row.parent_id,
        createdAt: iso(row.created_at),
      };
    });
  }

  async deleteCategory(tenantId: string, id: string): Promise<boolean> {
    return withTenant(tenantId, async (tx) => {
      await tx.query(
        `UPDATE transactions SET category_id = NULL WHERE tenant_id = $1 AND category_id = $2`,
        [tenantId, id],
      );
      const row = await tx.queryOne<{ id: string }>(
        `DELETE FROM finance_categories WHERE tenant_id = $1 AND id = $2 RETURNING id`,
        [tenantId, id],
      );
      return row !== null;
    });
  }
}

export const financeService = new FinanceService();

