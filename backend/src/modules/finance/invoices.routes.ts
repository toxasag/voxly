import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InvoicesService } from "./invoices.service.js";
import { createInvoiceSchema, markInvoicePaidSchema, updateInvoiceSchema } from "./finance.types.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";
const page=z.object({limit:z.coerce.number().int().positive().max(100).default(25),offset:z.coerce.number().int().nonnegative().default(0),company_id:z.string().uuid().optional()});
const id=z.object({id:z.string().uuid()});

/** Invoice route group, mounted at /api/v1/invoices. Auth first, then guards. */
export default async function invoiceRoutes(app:FastifyInstance):Promise<void>{await app.register(authenticatePlugin);const s=new InvoicesService();const mod=app.requireModule("finance"),read=[mod,app.requirePermission("finance:read")],write=[mod,app.requirePermission("finance:write")];app.get("",{onRequest:read},async(r,rep)=>{const p=page.parse(r.query),x=await s.list(r.tenant_id,p.limit,p.offset,p.company_id);return rep.send({data:x.items,meta:{limit:p.limit,offset:p.offset,total:x.total}})});app.post("",{onRequest:write},async(r,rep)=>rep.status(201).send({data:await s.create(r.tenant_id,r.authUser.id,createInvoiceSchema.parse(r.body))}));app.post("/from-repair/:repairId",{onRequest:write},async(r,rep)=>{const repairId=z.string().uuid().parse((r.params as {repairId:string}).repairId);const body=createInvoiceSchema.omit({repair_order_id:true,line_items:true}).parse(r.body);return rep.status(201).send({data:await s.fromRepair(r.tenant_id,r.authUser.id,repairId,body)})});app.patch("/:id",{onRequest:write},async(r,rep)=>rep.send({data:await s.update(r.tenant_id,id.parse(r.params).id,updateInvoiceSchema.parse(r.body))}));app.post("/:id/pay",{onRequest:write},async(r,rep)=>rep.send({data:await s.markPaid(r.tenant_id,r.authUser.id,id.parse(r.params).id,markInvoicePaidSchema.parse(r.body))}));}
