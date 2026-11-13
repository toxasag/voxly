import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InvoicesService } from "./invoices.service.js";
import {
  createInvoiceFromActsSchema,
  createInvoiceSchema,
  markInvoicePaidSchema,
  sendInvoiceSchema,
  updateInvoiceSchema,
} from "./finance.types.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";

const page = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
  company_id: z.string().uuid().optional(),
});
const id = z.object({ id: z.string().uuid() });

/** Invoice route group, mounted at /api/v1/invoices. Auth first, then guards. */
export default async function invoiceRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);
  const s = new InvoicesService();
  const mod = app.requireModule("finance");
  const read = [mod, app.requirePermission("finance:read")];
  const write = [mod, app.requirePermission("finance:write")];

  app.get("", { onRequest: read }, async (r, rep) => {
    const p = page.parse(r.query);
    const x = await s.list(r.tenant_id, p.limit, p.offset, p.company_id);
    return rep.send({ data: x.items, meta: { limit: p.limit, offset: p.offset, total: x.total } });
  });

  app.get("/:id", { onRequest: read }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    const invoice = await s.get(r.tenant_id, invoiceId);
    return rep.send({ data: invoice });
  });

  app.get("/:id/pdf", { onRequest: read }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    const { buffer, filename } = await s.getPdf(r.tenant_id, invoiceId);
    return rep
      .header("Content-Type", "application/pdf")
      .header("Content-Disposition", `attachment; filename="${filename}"`)
      .send(buffer);
  });

  app.post("", { onRequest: write }, async (r, rep) => {
    const body = createInvoiceSchema.parse(r.body);
    return rep.status(201).send({ data: await s.create(r.tenant_id, r.authUser.id, body) });
  });

  app.post("/from-repair/:repairId", { onRequest: write }, async (r, rep) => {
    const repairId = z.string().uuid().parse((r.params as { repairId: string }).repairId);
    const body = createInvoiceSchema.omit({ repair_order_id: true, line_items: true }).parse(r.body);
    return rep.status(201).send({ data: await s.fromRepair(r.tenant_id, r.authUser.id, repairId, body) });
  });

  app.post("/from-repairs", { onRequest: write }, async (r, rep) => {
    const body = createInvoiceFromActsSchema.parse(r.body);
    return rep.status(201).send({ data: await s.fromRepairOrders(r.tenant_id, r.authUser.id, body) });
  });

  app.patch("/:id", { onRequest: write }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    return rep.send({ data: await s.update(r.tenant_id, invoiceId, updateInvoiceSchema.parse(r.body)) });
  });

  app.post("/:id/pay", { onRequest: write }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    return rep.send({ data: await s.markPaid(r.tenant_id, r.authUser.id, invoiceId, markInvoicePaidSchema.parse(r.body)) });
  });

  app.post("/:id/send", { onRequest: write }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    const { channel_type } = sendInvoiceSchema.parse(r.body);
    return rep.send({ data: await s.sendToMessenger(r.tenant_id, invoiceId, channel_type) });
  });
}
