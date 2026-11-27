import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InvoicesService } from "./invoices.service.js";
import {
  bulkDeleteInvoicesSchema,
  bulkUpdateInvoicesSchema,
  createInvoiceFromActsSchema,
  createInvoiceSchema,
  markInvoicePaidSchema,
  sendInvoiceSchema,
  updateInvoiceSchema,
} from "./finance.types.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { sortDirSchema } from "../../lib/table-query.js";

const page = z.object({
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
  company_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  document_type: z.enum(["invoice", "proposal", "all"]).optional(),
  status: z.string().max(40).optional(),
  search: z.string().max(200).optional(),
  sort: z.string().max(64).optional(),
  order: sortDirSchema.optional(),
  sort_by: z.string().max(64).optional(),
  sort_dir: sortDirSchema.optional(),
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
    const x = await s.list(r.tenant_id, p.limit, p.offset, {
      companyId: p.company_id,
      dealId: p.deal_id,
      documentType: p.document_type,
      status: p.status,
      search: p.search,
      sortBy: p.sort_by ?? p.sort,
      sortDir: p.sort_dir ?? p.order,
    });
    return rep.send({ data: x.items, meta: { limit: p.limit, offset: p.offset, total: x.total } });
  });

  app.get("/:id", { onRequest: read }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    const invoice = await s.get(r.tenant_id, invoiceId);
    return rep.send({ data: invoice });
  });

  app.get("/:id/html", { onRequest: read }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    const q = z.object({ print: z.string().optional() }).parse(r.query);
    const html = await s.getHtml(r.tenant_id, invoiceId, { autoPrint: q.print === "1" });
    return rep.header("Content-Type", "text/html; charset=utf-8").send(html);
  });

  app.get("/:id/pdf", { onRequest: read }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    const { buffer, filename } = await s.getPdf(r.tenant_id, invoiceId);
    const asciiFallback =
      filename
        .replace(/[^\x20-\x7E]/g, "_")
        .replace(/["\\]/g, "")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "") || "invoice.pdf";
    const safeAscii = asciiFallback.endsWith(".pdf") ? asciiFallback : `${asciiFallback}.pdf`;
    const encodedUtf8 = encodeURIComponent(filename);
    return rep
      .header("Content-Type", "application/pdf")
      .header(
        "Content-Disposition",
        `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodedUtf8}`,
      )
      .send(buffer);
  });

  app.post("/:id/sync-elba", { onRequest: write }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    const result = await s.syncToElba(r.tenant_id, invoiceId);
    return rep.send({ data: result });
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

  app.post("/bulk-update", { onRequest: write }, async (r, rep) => {
    const body = bulkUpdateInvoicesSchema.parse(r.body);
    return rep.send({ data: await s.bulkUpdate(r.tenant_id, body) });
  });

  app.post("/bulk-delete", { onRequest: write }, async (r, rep) => {
    const body = bulkDeleteInvoicesSchema.parse(r.body);
    return rep.send({ data: await s.bulkRemove(r.tenant_id, body) });
  });

  app.patch("/:id", { onRequest: write }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    return rep.send({ data: await s.update(r.tenant_id, invoiceId, updateInvoiceSchema.parse(r.body)) });
  });

  app.delete("/:id", { onRequest: write }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    return rep.send({ data: await s.remove(r.tenant_id, invoiceId) });
  });

  app.post("/:id/pay", { onRequest: write }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    return rep.send({
      data: await s.markPaid(
        r.tenant_id,
        r.authUser.id,
        invoiceId,
        markInvoicePaidSchema.parse(r.body ?? {}),
      ),
    });
  });

  app.post("/:id/send", { onRequest: write }, async (r, rep) => {
    const { id: invoiceId } = id.parse(r.params);
    const { channel_type, recipient_email } = sendInvoiceSchema.parse(r.body);
    return rep.send({
      data: await s.sendToMessenger(r.tenant_id, invoiceId, channel_type, recipient_email || undefined),
    });
  });
}
