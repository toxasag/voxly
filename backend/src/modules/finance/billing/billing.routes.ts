import type { FastifyInstance, FastifyRequest } from "fastify";
import { getEnv } from "../../../config/env.js";
import { authenticatePlugin } from "../../../plugins/authenticate.js";
import { BillingService } from "./billing.service.js";
import { createCheckoutSchema } from "./billing.types.js";

function extractWebhookParams(request: FastifyRequest): Record<string, unknown> {
  const query = (request.query as Record<string, unknown>) ?? {};
  const body = (request.body as Record<string, unknown>) ?? {};
  return { ...query, ...body };
}

export default async function billingRoutes(app: FastifyInstance): Promise<void> {
  const billingService = new BillingService();
  const env = getEnv();

  // ---------------------------------------------------------------------------
  // Публичные маршруты Robokassa (вебхуки и редиректы)
  // Без authenticate: вызываются платёжным шлюзом Robokassa извне.
  // ---------------------------------------------------------------------------

  /**
   * ResultURL: серверный вебхук Robokassa об успешной оплате счёта.
   * Robokassa ожидает ответ строго в формате text/plain: "OK{invId}".
   */
  const handleResult = async (request: FastifyRequest, reply: any) => {
    const params = extractWebhookParams(request);
    app.log.info({ invId: params.InvId ?? params.invId }, "Robokassa ResultURL received");

    const responseText = await billingService.handleResultWebhook(params);
    return reply.type("text/plain").send(responseText);
  };

  app.post("/robokassa/result", handleResult);
  app.get("/robokassa/result", handleResult);

  /**
   * SuccessURL: страница, на которую возвращается покупатель после успешной оплаты.
   */
  const handleSuccess = async (request: FastifyRequest, reply: any) => {
    const params = extractWebhookParams(request);
    const { valid, invId } = billingService.verifySuccessRedirect(params);

    const redirectBase = env.PUBLIC_APP_URL || "https://app.getvoxly.ru";
    if (valid) {
      return reply.redirect(`${redirectBase}/finance?payment=success&inv_id=${invId}`);
    } else {
      return reply.redirect(`${redirectBase}/finance?payment=invalid_signature`);
    }
  };

  app.get("/robokassa/success", handleSuccess);
  app.post("/robokassa/success", handleSuccess);

  /**
   * FailURL: страница, на которую покупатель попадает при отмене платежа.
   */
  const handleFail = async (_request: FastifyRequest, reply: any) => {
    const redirectBase = env.PUBLIC_APP_URL || "https://app.getvoxly.ru";
    return reply.redirect(`${redirectBase}/finance?payment=cancelled`);
  };

  app.get("/robokassa/fail", handleFail);
  app.post("/robokassa/fail", handleFail);

  // ---------------------------------------------------------------------------
  // Защищённые маршруты биллинга арендатора
  // Требуют авторизации и прав billing:manage
  // ---------------------------------------------------------------------------

  await app.register(async (authedApp) => {
    await authedApp.register(authenticatePlugin);

    const manageBilling = [authedApp.requirePermission("billing:manage")];

    /**
     * Создание платежа Robokassa и получение платёжной ссылки.
     */
    authedApp.post("/checkout", { onRequest: manageBilling }, async (request, reply) => {
      const payload = createCheckoutSchema.parse(request.body);

      const checkout = await billingService.createCheckout({
        tenantId: request.tenant_id,
        actorId: request.authUser.id,
        payload,
      });

      return reply.status(201).send({ data: checkout });
    });

    /**
     * История платежей арендатора.
     */
    authedApp.get("/payments", { onRequest: manageBilling }, async (request, reply) => {
      const items = await billingService.listPayments(request.tenant_id);
      return reply.send({ data: items, meta: { total: items.length } });
    });

    /**
     * Список активных и архивных подписок арендатора.
     */
    authedApp.get("/subscriptions", { onRequest: manageBilling }, async (request, reply) => {
      const items = await billingService.listSubscriptions(request.tenant_id);
      return reply.send({ data: items, meta: { total: items.length } });
    });
  });
}
