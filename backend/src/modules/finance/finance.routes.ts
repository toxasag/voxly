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
  updateTransactionSchema,
} from "./finance.types.js";
import {
  buildIssuerSnapshot,
  financeOrganizationsService,
} from "./finance-organizations.service.js";
import {
  calculateInvoiceTotals,
  createOrganizationSchema,
  elbaBankAccountsSchema,
  elbaTestSchema,
  normalizeInvoiceFormConfig,
  updateOrganizationSchema,
} from "./finance-organizations.types.js";
import { renderInvoiceRfHtml } from "./invoice-html.service.js";
import { innLookupService } from "../integrations/inn-lookup.service.js";
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
  app.patch("/transactions/:id", { onRequest: write }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const p = updateTransactionSchema.parse(req.body);
    const row = await service.updateTransaction(req.tenant_id, id, p);
    return reply.send({ data: row });
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

  // ---------------------------------------------------------------------------
  // Организации-поставщики, конструктор счёта РФ и Контур.Эльба
  // ---------------------------------------------------------------------------

  app.get("/lookup-inn", { onRequest: read }, async (req, reply) => {
    const { inn } = z
      .object({
        inn: z
          .string()
          .trim()
          .regex(/^\d{10}(\d{2})?$/, "ИНН должен состоять из 10 или 12 цифр"),
      })
      .parse(req.query);
    const result = await innLookupService.lookup(inn);
    if (!result) {
      return reply.status(404).send({
        error: {
          code: "INN_NOT_FOUND",
          message: "Организация по данному ИНН не найдена в реестре ЕГРЮЛ/ФНС",
        },
      });
    }
    return reply.send({ data: result });
  });

  app.get("/organizations", { onRequest: read }, async (req, reply) => {
    const items = await financeOrganizationsService.list(req.tenant_id);
    return reply.send({ data: items });
  });

  app.post("/organizations", { onRequest: write }, async (req, reply) => {
    const payload = createOrganizationSchema.parse(req.body);
    const org = await financeOrganizationsService.create(req.tenant_id, payload);
    return reply.status(201).send({ data: org });
  });

  app.patch("/organizations/:id", { onRequest: write }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const payload = updateOrganizationSchema.parse(req.body);
    const org = await financeOrganizationsService.update(req.tenant_id, id, payload);
    return reply.send({ data: org });
  });

  app.post("/organizations/:id/set-default", { onRequest: write }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const org = await financeOrganizationsService.setDefault(req.tenant_id, id);
    return reply.send({ data: org });
  });

  app.delete("/organizations/:id", { onRequest: write }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await financeOrganizationsService.remove(req.tenant_id, id);
    return reply.send({ data: result });
  });

  app.post("/organizations/:id/elba/test", { onRequest: write }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = elbaTestSchema.parse(req.body ?? {});
    const res = await financeOrganizationsService.testElbaConnection(
      req.tenant_id,
      id,
      body.api_key,
    );
    return reply.send({ data: res });
  });

  app.post("/organizations/:id/elba/bank-accounts", { onRequest: write }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = elbaBankAccountsSchema.parse(req.body);
    const accounts = await financeOrganizationsService.listElbaBankAccounts(
      req.tenant_id,
      id,
      body.elba_organization_id,
      body.api_key,
    );
    return reply.send({ data: accounts });
  });

  app.post("/organizations/:id/invoice-preview", { onRequest: read }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const baseOrg = await financeOrganizationsService.getById(req.tenant_id, id);
    const override = updateOrganizationSchema.safeParse(req.body ?? {});
    const ov = override.success ? override.data : {};

    const previewOrg = {
      ...baseOrg,
      name: ov.name ?? baseOrg.name,
      inn: ov.inn ?? baseOrg.inn,
      kpp: ov.kpp ?? baseOrg.kpp,
      ogrn: ov.ogrn ?? baseOrg.ogrn,
      legalAddress: ov.legal_address ?? baseOrg.legalAddress,
      actualAddress: ov.actual_address ?? baseOrg.actualAddress,
      phone: ov.phone ?? baseOrg.phone,
      email: ov.email ?? baseOrg.email,
      website: ov.website ?? baseOrg.website,
      edoInfo: ov.edo_info ?? baseOrg.edoInfo,
      bankName: ov.bank_name ?? baseOrg.bankName,
      bik: ov.bik ?? baseOrg.bik,
      corrAccount: ov.corr_account ?? baseOrg.corrAccount,
      settlementAccount: ov.settlement_account ?? baseOrg.settlementAccount,
      directorTitle: ov.director_title ?? baseOrg.directorTitle,
      directorName: ov.director_name ?? baseOrg.directorName,
      accountantName: ov.accountant_name ?? baseOrg.accountantName,
      vatMode: ov.vat_mode ?? baseOrg.vatMode,
      logoUrl: ov.logo_url ?? baseOrg.logoUrl,
      logoWidth: ov.logo_width ?? baseOrg.logoWidth,
      stampUrl: ov.stamp_url ?? baseOrg.stampUrl,
      signatureUrl: ov.signature_url ?? baseOrg.signatureUrl,
      invoiceConfig: normalizeInvoiceFormConfig({
        ...baseOrg.invoiceConfig,
        ...(ov.invoice_config ?? {}),
      }),
    };

    const sampleItems = [
      { id: "1", description: "GSN50 поз.123 Основание магазина", quantity: 1, unitPrice: 600, total: 600, source: "repair_part", sourceLabel: "№0016" },
      { id: "2", description: "Сборка/Разборка", quantity: 1, unitPrice: 1000, total: 1000, source: "repair_work", sourceLabel: "№0016" },
      { id: "3", description: "Очистка и смазка деталей", quantity: 2, unitPrice: 1000, total: 2000, source: "repair_work", sourceLabel: "№0016" },
      { id: "4", description: "Промывка деталей в ультразвуковой ванне", quantity: 1, unitPrice: 1600, total: 1600, source: "repair_work", sourceLabel: "№0016" },
    ];
    const itemsSum = sampleItems.reduce((s, i) => s + i.total, 0);
    const totals = calculateInvoiceTotals(itemsSum, previewOrg.vatMode);
    const prefix = previewOrg.invoiceConfig.invoiceNumberPrefix || "СЧ";

    const sampleInvoice = {
      id: "00000000-0000-0000-0000-000000000000",
      invoiceNumber: `${prefix}-${new Date().getFullYear()}-0001`,
      status: "sent" as const,
      issueDate: new Date().toISOString(),
      dueDate: new Date(Date.now() + 3 * 86400 * 1000).toISOString(),
      companyId: null,
      companyName: 'ООО "Мега-Строй"',
      companyInn: "2367016930",
      companyAddress: "",
      contactName: "Иван Петров",
      contactPhone: "+7 999 000 00 00",
      dealId: null,
      repairOrderId: null,
      subtotal: totals.subtotal,
      vatMode: totals.vatMode,
      vatRate: totals.vatRate,
      vatAmount: totals.vatAmount,
      total: totals.total,
      currency: "RUB",
      notes: "",
      paidAt: null,
      paidAccountId: null,
      issuerOrganizationId: previewOrg.id,
      issuerSnapshot: buildIssuerSnapshot(previewOrg),
      elbaBillId: "",
      elbaSyncedAt: null,
      elbaSyncError: "",
      lineItems: sampleItems,
    };

    const html = await renderInvoiceRfHtml(sampleInvoice, buildIssuerSnapshot(previewOrg), {
      autoPrint: false,
    });
    return reply.send({ data: { html } });
  });
}
