import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FinanceService } from "./finance.service.js";
import {
  batchPaymentSchema,
  bulkTransactionsSchema,
  createAccountSchema,
  createCategorySchema,
  createTransactionSchema,
  pnlQuerySchema,
  transferSchema,
  updateCategorySchema,
} from "./finance.types.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";

const page = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

/**
 * Finance route group, mounted at /api/v1/finance by app.ts.
 *
 * authenticatePlugin must be registered before the permission hooks run:
 * requireModule/requirePermission read request.authUser, tenant_id and
 * installed_modules, all of which this hook populates.
 */
export default async function financeRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);

  const service = new FinanceService();
  const module = app.requireModule("finance");
  const read = [module, app.requirePermission("finance:read")];
  const write = [module, app.requirePermission("finance:write")];

  app.get("/accounts", { onRequest: read }, async (req, reply) =>
    reply.send({ data: await service.accounts(req.tenant_id) }),
  );
  app.post("/accounts", { onRequest: write }, async (req, reply) => {
    const p = createAccountSchema.parse(req.body);
    const row = await service.createAccount(req.tenant_id, p);
    return reply.status(201).send({ data: row });
  });
  app.post("/accounts/transfer", { onRequest: write }, async (req, reply) =>
    reply.send({ data: await service.transfer(req.tenant_id, transferSchema.parse(req.body)) }),
  );
  app.get("/transactions", { onRequest: read }, async (req, reply) => {
    const p = page.parse(req.query);
    const filterQuery = z.object({
      search: z.string().optional(),
      type: z.enum(["income", "expense"]).optional(),
    }).parse(req.query);
    const r = await service.transactions(req.tenant_id, p.limit, p.offset, filterQuery);
    return reply.send({ data: r.items, meta: { limit: p.limit, offset: p.offset, total: r.total } });
  });
  app.post("/transactions", { onRequest: write }, async (req, reply) =>
    reply.status(201).send({ data: await service.createTransaction(req.tenant_id, createTransactionSchema.parse(req.body)) }),
  );
  app.post("/transactions/bulk-delete", { onRequest: write }, async (req, reply) => {
    const { ids } = bulkTransactionsSchema.parse(req.body);
    const result = await service.bulkDeleteTransactions(req.tenant_id, ids);
    return reply.send({ success: true, count: result.count });
  });
  app.post("/transactions/bulk-duplicate", { onRequest: write }, async (req, reply) => {
    const { ids } = bulkTransactionsSchema.parse(req.body);
    const items = await service.bulkDuplicateTransactions(req.tenant_id, ids);
    return reply.status(201).send({ data: items, count: items.length });
  });
  app.delete("/transactions/:id", { onRequest: write }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await service.bulkDeleteTransactions(req.tenant_id, [id]);
    return reply.send({ success: true, count: result.count });
  });
  app.get("/counterparties", { onRequest: read }, async (req, reply) => {
    const q = z.object({
      search: z.string().optional(),
      limit: z.coerce.number().int().positive().max(50).default(20),
    }).parse(req.query);
    const data = await service.counterparties(req.tenant_id, q.search, q.limit);
    return reply.send({ data });
  });
  app.post("/payments/batch", { onRequest: write }, async (req, reply) => {
    const p = batchPaymentSchema.parse(req.body);
    const r = await service.batchPayment(req.tenant_id, req.authUser.id, p);
    return reply.status(200).send({ data: r });
  });
  app.get("/categories", { onRequest: read }, async (req, reply) => {
    const q = z.object({ type: z.enum(["income", "expense"]).optional() }).parse(req.query);
    return reply.send({ data: await service.categories(req.tenant_id, q.type) });
  });
  app.post("/categories", { onRequest: write }, async (req, reply) => {
    const p = createCategorySchema.parse(req.body);
    const row = await service.createCategory(req.tenant_id, p);
    return reply.status(201).send({ data: row });
  });
  app.patch("/categories/:id", { onRequest: write }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const p = updateCategorySchema.parse(req.body);
    const row = await service.updateCategory(req.tenant_id, id, p);
    return reply.send({ data: row });
  });
  app.delete("/categories/:id", { onRequest: write }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const success = await service.deleteCategory(req.tenant_id, id);
    return reply.send({ success });
  });
  app.get("/pnl", { onRequest: read }, async (req, reply) => {
    const p = pnlQuerySchema.parse(req.query);
    const to = p.to ?? new Date().toISOString(),
      from =
        p.from ??
        new Date(new Date(to).setUTCDate(new Date(to).getUTCDate() - 30)).toISOString();
    return reply.send({ data: await service.pnl(req.tenant_id, from, to) });
  });
}
