import { transaction, queryOne } from "../../db/client.js";
import { calculateAiCharge, type AiModelId } from "./ai-pricing.js";

// ---------------------------------------------------------------------------
// Очередь списания токенов и защита от двойных списаний (Durable AI Usage Queue).
//
// Идемпотентность обеспечивается уникальным ключом `usage_charge_key` на уровне БД.
// При повторной доставке вебхука или повторном вызове с тем же ключом
// списание не дублируется, а возвращается статус duplicate с ранее списанной суммой.
// ---------------------------------------------------------------------------

export interface UsageChargeKeyParts {
  channel: string;
  tenantId: string;
  requestType: string;
  externalId?: string;
}

/**
 * Детерминированный ключ идемпотентности для списания AI токенов.
 */
export function buildUsageChargeKey(parts: UsageChargeKeyParts): string {
  if (parts.externalId !== undefined && parts.externalId.trim().length > 0) {
    return `${parts.channel}:${parts.tenantId}:${parts.requestType}:${parts.externalId.trim()}`;
  }
  const suffix = `r${Math.random().toString(36).slice(2)}${Date.now()}`;
  return `${parts.channel}:${parts.tenantId}:${parts.requestType}:${suffix}`;
}

export interface ChargeAiUsageParams {
  tenantId: string;
  agentId: string;
  model: AiModelId;
  tokensIn: number;
  tokensOut: number;
  latencyMs?: number;
  status?: "success" | "error";
  errorMessage?: string;
  usageChargeKey?: string;
  noDebt?: boolean;
}

export interface ChargeResult {
  chargedKopecks: number;
  providerCostKopecks: number;
  duplicate: boolean;
  skippedInsufficientBalance?: boolean;
}

/**
 * Атомарное списание баланса с защитой от дублей и поддержкой noDebt.
 */
export async function chargeAiUsage(params: ChargeAiUsageParams): Promise<ChargeResult> {
  const {
    tenantId,
    agentId,
    model,
    tokensIn,
    tokensOut,
    latencyMs = 0,
    status = "success",
    errorMessage = "",
    usageChargeKey,
    noDebt = true,
  } = params;

  // 1. Быстрая проверка на дубликат по ключу, если он передан
  if (usageChargeKey !== undefined && usageChargeKey.length > 0) {
    const existing = await queryOne<{ charged_kopecks: string; provider_cost_kopecks: string }>(
      `SELECT charged_kopecks::text, provider_cost_kopecks::text
       FROM ai_usage_log
       WHERE usage_charge_key = $1
       LIMIT 1`,
      [usageChargeKey],
    );

    if (existing !== null) {
      return {
        chargedKopecks: Number(existing.charged_kopecks),
        providerCostKopecks: Number(existing.provider_cost_kopecks),
        duplicate: true,
      };
    }
  }

  // 2. Транзакционное списание с блокировкой строки тенанта FOR UPDATE
  return transaction(async (tx) => {
    // Если передан usageChargeKey, проверяем еще раз под транзакцией
    if (usageChargeKey !== undefined && usageChargeKey.length > 0) {
      const existingInTx = await tx.queryOne<{ charged_kopecks: string; provider_cost_kopecks: string }>(
        `SELECT charged_kopecks::text, provider_cost_kopecks::text
         FROM ai_usage_log
         WHERE usage_charge_key = $1
         LIMIT 1`,
        [usageChargeKey],
      );

      if (existingInTx !== null) {
        return {
          chargedKopecks: Number(existingInTx.charged_kopecks),
          providerCostKopecks: Number(existingInTx.provider_cost_kopecks),
          duplicate: true,
        };
      }
    }

    const tenant = await tx.queryOne<{ markup: string; balance: string }>(
      `SELECT ai_markup_percent::text AS markup, ai_balance_kopecks::text AS balance
       FROM tenants
       WHERE id = $1
       FOR UPDATE`,
      [tenantId],
    );

    const currentBalance = Number(tenant?.balance ?? 0);
    const markupPercent = Number(tenant?.markup ?? 0);

    // Режим noDebt: если баланс 0 и включен noDebt, списание не производится
    if (noDebt && currentBalance <= 0) {
      return {
        chargedKopecks: 0,
        providerCostKopecks: 0,
        duplicate: false,
        skippedInsufficientBalance: true,
      };
    }

    const charge = calculateAiCharge({
      model,
      tokensIn,
      tokensOut,
      markupPercent,
    });

    // Запись в журнал с сохранением usage_charge_key
    await tx.query(
      `INSERT INTO ai_usage_log
         (tenant_id, agent_id, user_id, model, tokens_in, tokens_out, latency_ms,
          provider_cost_kopecks, charged_kopecks, status, error_message, usage_charge_key)
       VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        tenantId,
        agentId,
        model,
        tokensIn,
        tokensOut,
        latencyMs,
        charge.providerCostKopecks,
        charge.chargedKopecks,
        status,
        errorMessage,
        usageChargeKey ?? null,
      ],
    );

    if (charge.chargedKopecks > 0) {
      // Баланс не уходит в минус при noDebt
      await tx.query(
        `UPDATE tenants
         SET ai_balance_kopecks = GREATEST(ai_balance_kopecks - $2, 0)
         WHERE id = $1`,
        [tenantId, charge.chargedKopecks],
      );
    }

    return {
      chargedKopecks: charge.chargedKopecks,
      providerCostKopecks: charge.providerCostKopecks,
      duplicate: false,
    };
  });
}
