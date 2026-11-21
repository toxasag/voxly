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
  async createAccount(
    tenantId: string,
    p: { name: string; account_type?: AccountType; currency: string; opening_balance: number; is_default: boolean },
  ): Promise<AccountDTO> {
    const accType = p.account_type ?? "cash";
    const row = await queryOne<AccountRow>(
      `INSERT INTO cash_accounts (tenant_id, name, account_type, currency, balance, is_default)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, account_type, currency, balance, is_default`,
      [tenantId, p.name, accType, p.currency, p.opening_balance, p.is_default],
    );
    if (!row) throw new Error("Account creation failed");
    return {
      id: row.id,
      name: row.name,
      accountType: (row.account_type as AccountType) || "cash",
      currency: row.currency,
      balance: Number(row.balance),
      isDefault: row.is_default,
    };
  }

  async accounts(tenantId: string): Promise<AccountDTO[]> {
    const rows = await query<AccountRow>(
      `SELECT id, name, COALESCE(account_type, 'cash') AS account_type, currency, balance, is_default
       FROM cash_accounts
       WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY is_default DESC, name`,
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

      for (const row of deleted) {
        const sign = row.direction === "income" ? -1 : 1;
        await tx.query(
          `UPDATE cash_accounts SET balance = balance + $3 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, row.cash_account_id, sign * Number(row.amount)],
        );
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
        const sign = src.direction === "income" ? 1 : -1;
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

        await tx.query(
          `UPDATE cash_accounts SET balance = balance + $3 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, src.cash_account_id, sign * Number(src.amount)],
        );

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
      await tx.query(`UPDATE cash_accounts SET balance = balance + $3 WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        p.account_id,
        sign * p.amount,
      ]);
      return this.toTx(row);
    });
  }

  async transfer(tenantId: string, p: TransferPayload): Promise<{ from: AccountDTO; to: AccountDTO }> {
    return withTenant(tenantId, async (tx) => {
      const from = await this.account(tx, tenantId, p.from_account_id);
      const to = await this.account(tx, tenantId, p.to_account_id);
      if (from.currency !== to.currency) throw new ValidationError("Cross-currency transfers are not supported");
      if (Number(from.balance) < p.amount) throw new AppError(409, "INSUFFICIENT_FUNDS", "Insufficient account balance");
      await tx.query(`UPDATE cash_accounts SET balance = balance - $3 WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        from.id,
        p.amount,
      ]);
      await tx.query(`UPDATE cash_accounts SET balance = balance + $3 WHERE tenant_id = $1 AND id = $2`, [
        tenantId,
        to.id,
        p.amount,
      ]);
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
      return {
        from: {
          id: from.id,
          name: from.name,
          accountType: (from.account_type as AccountType) || "cash",
          currency: from.currency,
          balance: Number(from.balance) - p.amount,
          isDefault: from.is_default,
        },
        to: {
          id: to.id,
          name: to.name,
          accountType: (to.account_type as AccountType) || "cash",
          currency: to.currency,
          balance: Number(to.balance) + p.amount,
          isDefault: to.is_default,
        },
      };
    });
  }
 async pnl(tenantId:string,from:string,to:string):Promise<PnlDTO>{const rows=await query<{direction:"income"|"expense";category_name:string;amount:string}>(`SELECT direction,category_name,SUM(amount)::text amount FROM transactions WHERE tenant_id=$1 AND deleted_at IS NULL AND occurred_at >= $2 AND occurred_at <= $3 GROUP BY direction,category_name`,[tenantId,from,to]);const incomeRows=rows.filter(r=>r.direction==="income"), expenseRows=rows.filter(r=>r.direction==="expense");const income=incomeRows.reduce((s,r)=>s+Number(r.amount),0),expenses=expenseRows.reduce((s,r)=>s+Number(r.amount),0);const map=(items:typeof rows,total:number)=>items.map(r=>({categoryName:r.category_name,amount:Number(r.amount),percentage:total===0?0:Math.round(Number(r.amount)/total*1000)/10}));return {from,to,income,expenses,netProfit:income-expenses,incomeByCategory:map(incomeRows,income),expensesByCategory:map(expenseRows,expenses)};}
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
        } else {
          const fallbackAmount = Number(order.final_cost ?? order.estimated_cost ?? 0);
          if (fallbackAmount > 0) {
            const desc = userNote || `Оплата по акту ${order.ticket_number}`;
            await insertIncomeTx(fallbackAmount, worksCat, desc, order);
          }
        }

        await tx.query(
          `UPDATE repair_orders SET payment_status = 'paid', updated_at = now() WHERE tenant_id = $1 AND id = $2`,
          [tenantId, order.id],
        );
      }

      if (totalPaid > 0) {
        await tx.query(
          `UPDATE cash_accounts SET balance = balance + $3 WHERE tenant_id = $1 AND id = $2`,
          [tenantId, account.id, totalPaid],
        );
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

