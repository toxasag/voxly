import type {
  AccountDTO,
  BatchPaymentPayload,
  CreateTransactionPayload,
  PnlDTO,
  TransactionDTO,
  TransferPayload,
} from "./finance.types.js";
import { query, queryOne, withTenant, type TransactionClient } from "../../db/client.js";
import { AppError, NotFoundError, ValidationError } from "../../plugins/errorHandler.js";

interface AccountRow { id:string; name:string; currency:string; balance:string; is_default:boolean }
interface TxRow { id:string; direction:"income"|"expense"; amount:string; currency:string; category_id:string|null; category_name:string; description:string; cash_account_id:string; account_name:string; deal_id:string|null; repair_order_id:string|null; invoice_id:string|null; occurred_at:Date|string }
const iso=(value:Date|string)=>value instanceof Date?value.toISOString():value;
const blank=(v:string|undefined)=>v===undefined||v===""?null:v;

export class FinanceService {
 async createAccount(tenantId:string,p:{name:string;currency:string;opening_balance:number;is_default:boolean}):Promise<AccountDTO>{const row=await queryOne<AccountRow>(`INSERT INTO cash_accounts (tenant_id,name,currency,balance,is_default) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,currency,balance,is_default`,[tenantId,p.name,p.currency,p.opening_balance,p.is_default]);if(!row)throw new Error("Account creation failed");return {id:row.id,name:row.name,currency:row.currency,balance:Number(row.balance),isDefault:row.is_default};}
 async accounts(tenantId:string):Promise<AccountDTO[]> { const rows=await query<AccountRow>(`SELECT id,name,currency,balance,is_default FROM cash_accounts WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY is_default DESC,name`,[tenantId]); return rows.map(r=>({id:r.id,name:r.name,currency:r.currency,balance:Number(r.balance),isDefault:r.is_default})); }
 async transactions(tenantId:string, limit:number, offset:number):Promise<{items:TransactionDTO[];total:number}>{ const total=await queryOne<{total:string}>(`SELECT COUNT(*)::text total FROM transactions WHERE tenant_id=$1 AND deleted_at IS NULL`,[tenantId]); const rows=await query<TxRow>(`SELECT t.id,t.direction,t.amount,t.currency,t.category_id,t.category_name,t.description,t.cash_account_id,a.name account_name,t.deal_id,t.repair_order_id,t.invoice_id,t.occurred_at FROM transactions t JOIN cash_accounts a ON a.id=t.cash_account_id AND a.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND t.deleted_at IS NULL ORDER BY t.occurred_at DESC LIMIT $2 OFFSET $3`,[tenantId,limit,offset]); return {items:rows.map(this.toTx),total:Number(total?.total??0)}; }
 private toTx(row:TxRow):TransactionDTO{return {id:row.id,type:row.direction,amount:Number(row.amount),currency:row.currency,categoryId:row.category_id,categoryName:row.category_name,description:row.description,accountId:row.cash_account_id,accountName:row.account_name,dealId:row.deal_id,repairOrderId:row.repair_order_id,invoiceId:row.invoice_id,occurredAt:iso(row.occurred_at)};}
 private async account(tx:TransactionClient,tenantId:string,id:string):Promise<AccountRow>{const row=await tx.queryOne<AccountRow>(`SELECT id,name,currency,balance,is_default FROM cash_accounts WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`,[tenantId,id]);if(!row)throw new NotFoundError("Cash account not found");return row;}
 async createTransaction(tenantId:string,p:CreateTransactionPayload):Promise<TransactionDTO>{return withTenant(tenantId,async tx=>{const a=await this.account(tx,tenantId,p.account_id);if(a.currency!==p.currency)throw new ValidationError("Account currency differs from transaction currency");const sign=p.type==="income"?1:-1; if(sign<0&&Number(a.balance)<p.amount)throw new AppError(409,"INSUFFICIENT_FUNDS","Insufficient account balance");const row=await tx.queryOneOrThrow<TxRow>(`INSERT INTO transactions (tenant_id,cash_account_id,category_id,category_name,amount,currency,direction,description,counterparty_name,counterparty_inn,deal_id,repair_order_id,invoice_id,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14::timestamptz,now())) RETURNING id,direction,amount,currency,category_id,category_name,description,cash_account_id,(SELECT name FROM cash_accounts WHERE id=$2) account_name,deal_id,repair_order_id,invoice_id,occurred_at`,[tenantId,p.account_id,blank(p.category_id),p.category_name,p.amount,p.currency,p.type,p.description??"",p.counterparty_name??"",p.counterparty_inn??"",blank(p.deal_id),blank(p.repair_order_id),blank(p.invoice_id),p.occurred_at??null]); await tx.query(`UPDATE cash_accounts SET balance=balance+$3 WHERE tenant_id=$1 AND id=$2`,[tenantId,p.account_id,sign*p.amount]);return this.toTx(row);});}
 async transfer(tenantId:string,p:TransferPayload):Promise<{from:AccountDTO;to:AccountDTO}>{return withTenant(tenantId,async tx=>{const from=await this.account(tx,tenantId,p.from_account_id);const to=await this.account(tx,tenantId,p.to_account_id);if(from.currency!==to.currency)throw new ValidationError("Cross-currency transfers are not supported");if(Number(from.balance)<p.amount)throw new AppError(409,"INSUFFICIENT_FUNDS","Insufficient account balance");await tx.query(`UPDATE cash_accounts SET balance=balance-$3 WHERE tenant_id=$1 AND id=$2`,[tenantId,from.id,p.amount]);await tx.query(`UPDATE cash_accounts SET balance=balance+$3 WHERE tenant_id=$1 AND id=$2`,[tenantId,to.id,p.amount]);const occurred=new Date().toISOString();for(const [accountId,direction,description] of [[from.id,"expense",`Transfer to ${to.name}`],[to.id,"income",`Transfer from ${from.name}`]] as const){await tx.query(`INSERT INTO transactions (tenant_id,cash_account_id,category_id,category_name,amount,currency,direction,description,occurred_at) VALUES ($1,$2,NULL,'Internal transfer',$3,$4,$5,$6,$7)`,[tenantId,accountId,p.amount,from.currency,direction,p.description||description,occurred]);}return {from:{id:from.id,name:from.name,currency:from.currency,balance:Number(from.balance)-p.amount,isDefault:from.is_default},to:{id:to.id,name:to.name,currency:to.currency,balance:Number(to.balance)+p.amount,isDefault:to.is_default}};});}
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
  ): Promise<{ success: boolean; totalPaid: number; count: number }> {
    return withTenant(tenantId, async (tx) => {
      const account = await this.account(tx, tenantId, payload.cash_account_id);

      let categoryName = "Оплата по наряд-заказу";
      if (payload.category_id) {
        const cat = await tx.queryOne<{ name: string }>(
          `SELECT name FROM finance_categories WHERE tenant_id = $1 AND id = $2`,
          [tenantId, payload.category_id],
        );
        if (cat) categoryName = cat.name;
      }

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

      for (const order of orders) {
        const worksTotalRow = await tx.queryOne<{ total: string }>(
          `SELECT COALESCE(SUM(cost), 0)::text AS total FROM repair_works WHERE tenant_id = $1 AND repair_order_id = $2`,
          [tenantId, order.id],
        );
        const partsTotalRow = await tx.queryOne<{ total: string }>(
          `SELECT COALESCE(SUM(retail_price * quantity), 0)::text AS total FROM repair_parts WHERE tenant_id = $1 AND repair_order_id = $2`,
          [tenantId, order.id],
        );

        let amount = Number(worksTotalRow?.total ?? 0) + Number(partsTotalRow?.total ?? 0);
        if (amount <= 0) {
          amount = Number(order.final_cost ?? order.estimated_cost ?? 0);
        }

        if (amount > 0) {
          totalPaid += amount;
          const desc = payload.description || `Оплата по акту ${order.ticket_number}`;
          await tx.query(
            `INSERT INTO transactions (tenant_id, cash_account_id, category_id, category_name, amount, currency, direction, description, counterparty_name, deal_id, repair_order_id)
             VALUES ($1, $2, $3, $4, $5, $6, 'income', $7, $8, $9, $10)`,
            [
              tenantId,
              account.id,
              payload.category_id || null,
              categoryName,
              amount,
              account.currency,
              desc,
              order.customer_name || "",
              order.deal_id,
              order.id,
            ],
          );
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

      return { success: true, totalPaid, count: orders.length };
    });
  }
}

export const financeService = new FinanceService();

