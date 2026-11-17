import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { authenticatePlugin } from "../../plugins/authenticate.js";
import { TeamService } from "./team.service.js";

const roleSchema = z.enum(["admin", "manager", "technician", "viewer"]);

const inviteBody = z
  .object({
    name: z.string().trim().min(2, "Укажите имя сотрудника").max(120),
    email: z.string().trim().toLowerCase().email("Некорректный e-mail").optional().nullable(),
    phone: z.string().trim().optional().nullable(),
    role: roleSchema,
    confirm_extra_seat: z.boolean().default(false),
  })
  .refine(
    (data) => Boolean((data.email && data.email.length > 0) || (data.phone && data.phone.replace(/\D/g, "").length >= 10)),
    {
      message: "Укажите e-mail или номер телефона сотрудника (от 10 цифр)",
      path: ["email"],
    },
  );

const userParams = z.object({ id: z.string().uuid() });

/**
 * Маршруты рабочих пространств (/api/v1/workspaces), зеркалирующие функционал tenant
 * для прозрачного аудита и совместимости API омниканальных приглашений.
 */
export default async function workspacesRoutes(app: FastifyInstance): Promise<void> {
  await app.register(authenticatePlugin);
  const team = new TeamService();
  const admin = app.requirePermission("tenant:admin");

  // GET /workspaces/current/invites — список ожидающих приглашений текущего пространства
  app.get("/current/invites", { onRequest: admin }, async (request, reply) => {
    const data = await team.listPendingInvites(request.tenant_id);
    return reply.send({ data });
  });

  // POST /workspaces/current/invites — создание нового приглашения
  app.post("/current/invites", { onRequest: admin }, async (request, reply) => {
    const body = inviteBody.parse(request.body);
    const result = await team.invite({
      tenantId: request.tenant_id,
      actorId: request.authUser.id,
      name: body.name,
      email: body.email,
      phone: body.phone,
      role: body.role,
      confirmExtraSeat: body.confirm_extra_seat,
    });
    return reply.status(201).send({ data: result });
  });

  // DELETE /workspaces/current/invites/:id — отзыв приглашения
  app.delete("/current/invites/:id", { onRequest: admin }, async (request, reply) => {
    const { id } = userParams.parse(request.params);
    const result = await team.revokeInvite({ tenantId: request.tenant_id, userId: id });
    return reply.send({ data: result });
  });

  // POST /workspaces/current/invites/:id/resend — повторная отправка приглашения
  app.post("/current/invites/:id/resend", { onRequest: admin }, async (request, reply) => {
    const { id } = userParams.parse(request.params);
    const result = await team.resendInvite({ tenantId: request.tenant_id, userId: id });
    return reply.send({ data: result });
  });
}
