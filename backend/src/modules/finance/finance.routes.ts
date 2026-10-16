import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FinanceService } from "./finance.service.js";
import { createAccountSchema, createTransactionSchema, pnlQuerySchema, transferSchema } from "./finance.types.js";
import { authenticatePlugin } from "../../plugins/authenticate.js";

const page=z.object({limit:z.coerce.number().int().positive().max(100).default(25),offset:z.coerce.number().int().nonnegative().default(0)});

/**
 * Finance route group, mounted at /api/v1/finance by app.ts.
 *
 * authenticatePlugin must be registered before the permission hooks run:
 * requireModule/requirePermission read request.authUser, tenant_id and
 * installed_modules, all of which this hook populates.
 */
export default async function financeRoutes(app:FastifyInstance):Promise<void>{
 await app.register(authenticatePlugin);

 const service=new FinanceService();const module=app.requireModule("finance");const read=[module,app.requirePermission("finance:read")];const write=[module,app.requirePermission("finance:write")];
 app.get("/accounts",{onRequest:read},async(req,reply)=>reply.send({data:await service.accounts(req.tenant_id)}));
 app.post("/accounts",{onRequest:write},async(req,reply)=>{const p=createAccountSchema.parse(req.body);const row=await service.createAccount(req.tenant_id,p);return reply.status(201).send({data:row});});
 app.post("/accounts/transfer",{onRequest:write},async(req,reply)=>reply.send({data:await service.transfer(req.tenant_id,transferSchema.parse(req.body))}));
 app.get("/transactions",{onRequest:read},async(req,reply)=>{const p=page.parse(req.query);const r=await service.transactions(req.tenant_id,p.limit,p.offset);return reply.send({data:r.items,meta:{limit:p.limit,offset:p.offset,total:r.total}});});
 app.post("/transactions",{onRequest:write},async(req,reply)=>reply.status(201).send({data:await service.createTransaction(req.tenant_id,createTransactionSchema.parse(req.body))}));
 app.get("/pnl",{onRequest:read},async(req,reply)=>{const p=pnlQuerySchema.parse(req.query);const to=p.to??new Date().toISOString(),from=p.from??new Date(new Date(to).setUTCDate(new Date(to).getUTCDate()-30)).toISOString();return reply.send({data:await service.pnl(req.tenant_id,from,to)});});
}
