import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CompaniesService } from "./companies.service.js";
import { createCompanySchema, updateCompanySchema } from "./companies.types.js";
import { NotFoundError } from "../../../plugins/errorHandler.js";

const listQuerySchema = z.object({
  search: z.string().max(200).optional(),
  manager_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(100).default(25),
  offset: z.coerce.number().int().nonnegative().default(0),
});

const idParamsSchema = z.object({ id: z.string().uuid("id must be a UUID") });

export async function companiesRoutes(app: FastifyInstance): Promise<void> {
  const service = new CompaniesService();

  const canRead = app.requirePermission("companies:read");
  const canWrite = app.requirePermission("companies:write");
  const canDelete = app.requirePermission("companies:delete");

  app.get("", { onRequest: canRead }, async (request, reply) => {
    const { search, manager_id, limit, offset } = listQuerySchema.parse(request.query);

    const { items, total } = await service.list(request.tenant_id, {
      search,
      managerId: manager_id,
      limit,
      offset,
    });

    return reply.send({ data: items, meta: { limit, offset, total } });
  });

  app.get("/:id", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const company = await service.get(request.tenant_id, id);

    if (company === null) throw new NotFoundError("Company not found");

    return reply.send({ data: company });
  });

  app.get("/:id/stats", { onRequest: canRead }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const company = await service.get(request.tenant_id, id);

    if (company === null) throw new NotFoundError("Company not found");

    const stats = await service.stats(request.tenant_id, id);

    return reply.send({ data: stats });
  });

  app.post("", { onRequest: canWrite }, async (request, reply) => {
    const body = createCompanySchema.parse(request.body);
    // Автор из токена, а не из тела запроса.
    const company = await service.create(request.tenant_id, body, request.authUser.id);

    return reply.status(201).send({ data: company });
  });

  app.patch("/:id", { onRequest: canWrite }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);
    const body = updateCompanySchema.parse(request.body);
    const company = await service.update(request.tenant_id, id, body);

    if (company === null) throw new NotFoundError("Company not found");

    return reply.send({ data: company });
  });

  app.delete("/:id", { onRequest: canDelete }, async (request, reply) => {
    const { id } = idParamsSchema.parse(request.params);

    const stats = await service.stats(request.tenant_id, id);
    const deleted = await service.softDelete(request.tenant_id, id);

    if (!deleted) throw new NotFoundError("Company not found");

    if (stats.contactsCount > 0 || stats.dealsCount > 0) {
      return reply.status(200).send({
        data: { id, deleted: true },
        meta: {
          linkedContacts: stats.contactsCount,
          linkedDeals: stats.dealsCount,
          warning: "Company had linked records; they now reference a deleted company",
        },
      });
    }

    return reply.status(204).send();
  });
}
