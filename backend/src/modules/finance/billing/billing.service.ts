import crypto from "node:crypto";
import { getEnv } from "../../../config/env.js";
import {
  query,
  queryOne,
  runWithPlatformScope,
  withTenant,
} from "../../../db/client.js";
import { AppError, NotFoundError } from "../../../plugins/errorHandler.js";
import {
  paymentAmountMatchesOutSum,
  RobokassaClient,
  type CheckoutItem,
} from "./robokassa.client.js";
import {
  PRODUCT_CODES,
  type BillingPaymentRow,
  type CheckoutResultDTO,
  type CreateCheckoutPayload,
  type SubscriptionRow,
} from "./billing.types.js";

import { platformConfigService } from "../../admin/platform-config.service.js";

export class BillingService {
  private readonly customClient: RobokassaClient | null = null;

  constructor(client?: RobokassaClient | null) {
    if (client !== undefined) {
      this.customClient = client;
    }
  }

  async getRobokassaClient(): Promise<RobokassaClient | null> {
    if (this.customClient !== undefined) {
      return this.customClient;
    }

    const integrations = await platformConfigService.getEffectiveIntegrations();
    const robo = integrations.robokassa;

    if (!robo.isConfigured || !robo.merchantLogin || !robo.password1 || !robo.password2) {
      return null;
    }

    return new RobokassaClient({
      merchantLogin: robo.merchantLogin,
      password1: robo.password1,
      password2: robo.password2,
      isTest: robo.isTest,
      hashAlgorithm: robo.hashAlgo === "MD5" ? "md5" : "sha256",
    });
  }

  async isConfigured(): Promise<boolean> {
    const client = await this.getRobokassaClient();
    return client !== null;
  }

  /**
   * Создание платежа и генерация платёжной ссылки Robokassa.
   */
  async createCheckout(input: {
    tenantId: string;
    actorId?: string;
    payload: CreateCheckoutPayload;
  }): Promise<CheckoutResultDTO> {
    const robokassaClient = await this.getRobokassaClient();
    if (!robokassaClient) {
      throw new AppError(
        503,
        "ROBOKASSA_NOT_CONFIGURED",
        "Платежный шлюз Robokassa не настроен в конфигурации платформы",
      );
    }

    const { tenantId, payload } = input;
    const env = getEnv();

    // 1. Атомарно получаем уникальный номер счета через PostgreSQL sequence
    const seqRow = await queryOne<{ inv_id: number }>(
      "SELECT nextval('robokassa_inv_id_seq')::int AS inv_id",
    );
    if (!seqRow?.inv_id) {
      throw new Error("Не удалось сгенерировать номер счёта Robokassa");
    }
    const invId = seqRow.inv_id;

    // 2. Идемпотентность и описание
    const idempotencyKey = payload.idempotency_key ?? crypto.randomUUID();
    const description =
      payload.description ??
      (payload.product_code === PRODUCT_CODES.AI_TOPUP
        ? `Пополнение AI-баланса Voxly (${payload.amount_rubles} руб.)`
        : `Подписка на тариф Voxly (${payload.period_months ?? 1} мес.)`);

    const periodMonths =
      payload.product_code === PRODUCT_CODES.AI_TOPUP ? null : (payload.period_months ?? 1);

    // 3. Формируем позицию чека по 54-ФЗ
    const checkoutItems: CheckoutItem[] = [
      {
        name: description.slice(0, 100),
        quantity: 1,
        price: payload.amount_rubles,
        tax: env.ROBOKASSA_TAX,
        paymentMethod: "full_payment",
        paymentObject: "service",
      },
    ];

    // 4. Сохраняем черновик платежа в статусе 'pending'
    const payment = await withTenant(tenantId, async (tx) => {
      return tx.queryOneOrThrow<BillingPaymentRow>(
        `INSERT INTO billing_payments (
          tenant_id,
          robokassa_inv_id,
          amount,
          balance_applied_rub,
          status,
          product_code,
          period_months,
          description,
          idempotency_key,
          fiscal_receipt
        ) VALUES ($1, $2, $3, 0, 'pending', $4, $5, $6, $7, $8::jsonb)
        RETURNING *`,
        [
          tenantId,
          invId,
          payload.amount_rubles,
          payload.product_code,
          periodMonths,
          description,
          idempotencyKey,
          JSON.stringify({ items: checkoutItems }),
        ],
      );
    });

    // 5. Генерируем платёжный URL Robokassa
    const customData: Record<string, string> = {
      tenant_id: tenantId,
      product_code: payload.product_code,
    };

    const paymentUrl = robokassaClient.generatePaymentUrl({
      invId,
      amount: payload.amount_rubles,
      description,
      email: payload.customer_email,
      items: checkoutItems,
      customData,
    });

    return {
      paymentId: payment.id,
      invId,
      paymentUrl,
      amountRubles: payload.amount_rubles,
      status: payment.status,
      productCode: payment.product_code,
    };
  }

  /**
   * Обработка серверного вебхука ResultURL от Robokassa.
   * Возвращает строго строку "OK{invId}" при успешном исполнении.
   */
  async handleResultWebhook(rawParams: Record<string, unknown>): Promise<string> {
    const robokassaClient = await this.getRobokassaClient();
    if (!robokassaClient) {
      throw new AppError(503, "ROBOKASSA_NOT_CONFIGURED", "Шлюз Robokassa не настроен");
    }

    const outSum = String(rawParams.OutSum ?? rawParams.outSum ?? "");
    const invIdStr = String(rawParams.InvId ?? rawParams.invId ?? "");
    const signatureValue = String(
      rawParams.SignatureValue ?? rawParams.signatureValue ?? "",
    );

    if (!outSum || !invIdStr || !signatureValue) {
      throw new AppError(400, "INVALID_WEBHOOK_PARAMS", "Отсутствуют обязательные параметры Robokassa");
    }

    // Собираем пользовательские параметры Shp_*
    const customData: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawParams)) {
      const match = /^shp_(.+)$/i.exec(key);
      const shpKey = match?.[1];
      if (shpKey && value != null) {
        customData[shpKey] = String(value);
      }
    }



    // 1. Проверяем подпись ResultURL (Пароль №2)
    const isSignatureValid = robokassaClient.verifyResultSignature({
      outSum,
      invId: invIdStr,
      signatureValue,
      customData,
    });

    if (!isSignatureValid) {
      throw new AppError(400, "BAD_SIGNATURE", "Некорректная цифровая подпись Robokassa ResultURL");
    }

    const invIdNum = parseInt(invIdStr, 10);
    if (!Number.isFinite(invIdNum)) {
      throw new AppError(400, "INVALID_INV_ID", "Некорректный номер счёта InvId");
    }

    // 2. Ищем платёж по robokassa_inv_id через platform_scope (вебхук публичен)
    const payment = await runWithPlatformScope(async () => {
      return queryOne<BillingPaymentRow>(
        "SELECT * FROM billing_payments WHERE robokassa_inv_id = $1",
        [invIdNum],
      );
    });

    if (!payment) {
      throw new NotFoundError(`Платёж с номером счёта ${invIdNum} не найден`);
    }

    // 3. Идемпотентность: если платёж уже оплачен, подтверждаем Robokassa немедленно
    if (payment.status === "paid") {
      return `OK${invIdNum}`;
    }

    // 4. Сверка суммы с допуском 0.01 руб. (защита от подделки OutSum)
    if (!paymentAmountMatchesOutSum(payment.amount, outSum)) {
      throw new AppError(
        400,
        "AMOUNT_MISMATCH",
        `Сумма Robokassa (${outSum}) не совпадает с суммой платежа (${payment.amount})`,
      );
    }

    // 5. Атомарный перевод статуса в paid и исполнение (fulfillment) в скоупе арендатора
    await withTenant(payment.tenant_id, async (tx) => {
      const claimed = await tx.queryOne<{ id: string }>(
        `UPDATE billing_payments
         SET status = 'paid', paid_at = now(), updated_at = now()
         WHERE id = $1 AND status IN ('pending', 'failed', 'cancelled')
         RETURNING id`,
        [payment.id],
      );

      // Конкурентный вебхук уже успел исполнить
      if (!claimed) return;

      const amountKopecks = Math.round(Number(payment.amount) * 100);

      // Исполнение для AI-баланса
      if (payment.product_code === PRODUCT_CODES.AI_TOPUP) {
        await tx.query(
          `INSERT INTO ai_balance_topups (tenant_id, amount_kopecks, source, comment)
           VALUES ($1, $2, 'robokassa', $3)`,
          [
            payment.tenant_id,
            amountKopecks,
            `Оплата через Robokassa (счет #${invIdNum})`,
          ],
        );

        // Пополняем баланс тенанта в tenants
        await tx.query(
          "UPDATE tenants SET ai_balance_kopecks = ai_balance_kopecks + $2, updated_at = now() WHERE id = $1",
          [payment.tenant_id, amountKopecks],
        );

        await tx.query(
          `INSERT INTO tenant_audit_log
             (tenant_id, action, entity_type, entity_id, details)
           VALUES ($1, 'ai_balance.topup_robokassa', 'tenant', $2, $3::jsonb)`,
          [
            payment.tenant_id,
            payment.tenant_id,
            JSON.stringify({
              payment_id: payment.id,
              inv_id: invIdNum,
              amount_rubles: payment.amount,
              amount_kopecks: amountKopecks,
            }),
          ],
        );
      } else {
        // Исполнение для SaaS-подписки
        const months = payment.period_months ?? 1;

        const activeSub = await tx.queryOne<{ id: string }>(
          `SELECT id FROM subscriptions
           WHERE tenant_id = $1 AND product_code = $2 AND status = 'active'
           ORDER BY ends_at DESC LIMIT 1`,
          [payment.tenant_id, payment.product_code],
        );

        let subId: string;
        if (activeSub) {
          const updated = await tx.queryOneOrThrow<{ id: string }>(
            `UPDATE subscriptions
             SET ends_at = GREATEST(ends_at, now()) + ($2 || ' month')::interval, updated_at = now()
             WHERE id = $1
             RETURNING id`,
            [activeSub.id, months],
          );
          subId = updated.id;
        } else {
          const inserted = await tx.queryOneOrThrow<{ id: string }>(
            `INSERT INTO subscriptions (tenant_id, product_code, period_months, starts_at, ends_at, status)
             VALUES ($1, $2, $3, now(), now() + ($3 || ' month')::interval, 'active')
             RETURNING id`,
            [payment.tenant_id, payment.product_code, months],
          );
          subId = inserted.id;
        }

        await tx.query(
          "UPDATE billing_payments SET subscription_id = $2 WHERE id = $1",
          [payment.id, subId],
        );

        await tx.query(
          `INSERT INTO tenant_audit_log
             (tenant_id, action, entity_type, entity_id, details)
           VALUES ($1, 'subscription.activated', 'subscription', $2, $3::jsonb)`,
          [
            payment.tenant_id,
            subId,
            JSON.stringify({
              payment_id: payment.id,
              inv_id: invIdNum,
              product_code: payment.product_code,
              months,
            }),
          ],
        );
      }
    });

    return `OK${invIdNum}`;
  }

  /**
   * Проверка подписи страницы возврата SuccessURL (Пароль №1).
   */
  async verifySuccessRedirect(rawParams: Record<string, unknown>): Promise<{
    valid: boolean;
    invId: string;
    outSum: string;
  }> {
    const robokassaClient = await this.getRobokassaClient();
    if (!robokassaClient) {
      throw new AppError(503, "ROBOKASSA_NOT_CONFIGURED", "Шлюз Robokassa не настроен в конфигурации платформы");
    }

    const outSum = String(rawParams.OutSum ?? rawParams.outSum ?? "");
    const invId = String(rawParams.InvId ?? rawParams.invId ?? "");
    const signatureValue = String(
      rawParams.SignatureValue ?? rawParams.signatureValue ?? "",
    );

    const customData: Record<string, string> = {};
    for (const [key, value] of Object.entries(rawParams)) {
      const match = /^shp_(.+)$/i.exec(key);
      const shpKey = match?.[1];
      if (shpKey && value != null) {
        customData[shpKey] = String(value);
      }
    }

    const valid = robokassaClient.verifySuccessSignature({
      outSum,
      invId,
      signatureValue,
      customData,
    });

    return { valid, invId, outSum };
  }

  /**
   * Получение списка платежей арендатора.
   */
  async listPayments(tenantId: string): Promise<BillingPaymentRow[]> {
    return query<BillingPaymentRow>(
      `SELECT * FROM billing_payments
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [tenantId],
    );
  }

  /**
   * Получение активных подписок арендатора.
   */
  async listSubscriptions(tenantId: string): Promise<SubscriptionRow[]> {
    return query<SubscriptionRow>(
      `SELECT * FROM subscriptions
       WHERE tenant_id = $1
       ORDER BY ends_at DESC`,
      [tenantId],
    );
  }
}
