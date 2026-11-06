import { query, queryOne, withTenant } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import {
  estimateRemainingTokens,
  isAiModelId,
  rublesToKopecks,
  type AiModelId,
} from "./ai-pricing.js";
import type {
  AgentMode,
  AgentStatus,
  AiAgentDTO,
  AiBalanceDTO,
  ConsultantSource,
  CreateAgentPayload,
  UpdateAgentPayload,
} from "./ai.types.js";

// ---------------------------------------------------------------------------
// AI-агенты и баланс ИИ.
//
// Заменяет моки фронтенда: до этого агенты жили в `lib/ai-bots/mock-ai-bots.ts`,
// были одинаковы у всех арендаторов и исчезали при перезагрузке страницы.
// ---------------------------------------------------------------------------

/** Модель, по которой оценивается остаток токенов в подписи баланса. */
const REFERENCE_MODEL: AiModelId = "gpt-4o-mini";

interface AgentRow {
  id: string;
  name: string;
  description: string;
  accent: AiAgentDTO["accent"];
  model: string;
  status: AgentStatus;
  mode: AgentMode;
  temperature: string;
  max_tokens: number;
  system_prompt: string;
  context_entities: string[];
  company_name_override: string | null;
  consultant_source: ConsultantSource;
  consultant_name: string | null;
  consultant_role: string | null;
  fallback_models: string[];
  wizard_config: AiAgentDTO["wizardConfig"];
  tokens_used: string;
  requests_count: string;
  avg_latency_ms: string;
  spent_kopecks: string;
  last_used_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toDTO(row: AgentRow): AiAgentDTO {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    accent: row.accent,
    model: row.model,
    status: row.status,
    mode: row.mode,
    // NUMERIC приходит строкой: pg не приводит его к number, чтобы не терять
    // точность на больших значениях.
    temperature: Number(row.temperature),
    maxTokens: row.max_tokens,
    systemPrompt: row.system_prompt,
    contextEntities: row.context_entities,
    companyNameOverride: row.company_name_override,
    consultantSource: row.consultant_source ?? "manual",
    consultantName: row.consultant_name,
    consultantRole: row.consultant_role,
    fallbackModels: row.fallback_models ?? [],
    wizardConfig: row.wizard_config ?? null,
    tokensUsed: Number(row.tokens_used),
    requestsCount: Number(row.requests_count),
    avgLatencyMs: Math.round(Number(row.avg_latency_ms)),
    spentKopecks: Number(row.spent_kopecks),
    lastUsedAt: toIso(row.last_used_at),
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
  };
}

/**
 * Агрегаты расхода подтягиваются в тот же запрос через LATERAL.
 *
 * Отдельным запросом на каждого агента это была бы задача N+1: список из 20
 * агентов давал бы 21 обращение к БД.
 */
const AGENT_SELECT = `
  SELECT a.id, a.name, a.description, a.accent, a.model, a.status, a.mode,
         a.temperature, a.max_tokens, a.system_prompt, a.context_entities,
         a.company_name_override, a.consultant_source, a.consultant_name, a.consultant_role, a.fallback_models,
         a.wizard_config,
         COALESCE(u.tokens_used, 0)::text AS tokens_used,
         COALESCE(u.requests_count, 0)::text AS requests_count,
         COALESCE(u.avg_latency_ms, 0)::text AS avg_latency_ms,
         COALESCE(u.spent_kopecks, 0)::text AS spent_kopecks,
         u.last_used_at,
         a.created_at, a.updated_at
  FROM ai_agents a
  LEFT JOIN LATERAL (
    SELECT SUM(l.tokens_in + l.tokens_out) AS tokens_used,
           COUNT(*) AS requests_count,
           AVG(l.latency_ms) AS avg_latency_ms,
           SUM(l.charged_kopecks) AS spent_kopecks,
           MAX(l.created_at) AS last_used_at
    FROM ai_usage_log l
    WHERE l.agent_id = a.id
  ) u ON true
`;

export class AiService {
  async listAgents(tenantId: string): Promise<AiAgentDTO[]> {
    const rows = await query<AgentRow>(
      `${AGENT_SELECT}
       WHERE a.tenant_id = $1 AND a.deleted_at IS NULL
       ORDER BY a.created_at DESC`,
      [tenantId],
    );

    return rows.map(toDTO);
  }

  async getAgent(tenantId: string, id: string): Promise<AiAgentDTO> {
    const row = await queryOne<AgentRow>(
      `${AGENT_SELECT}
       WHERE a.tenant_id = $1 AND a.id = $2 AND a.deleted_at IS NULL`,
      [tenantId, id],
    );

    if (row === null) throw new NotFoundError("AI-агент не найден");

    return toDTO(row);
  }

  async createAgent(tenantId: string, payload: CreateAgentPayload): Promise<AiAgentDTO> {
    if (!isAiModelId(payload.model)) {
      throw new AppError(400, "VALIDATION_ERROR", "Неизвестная модель", {
        model: ["Неизвестная модель"],
      });
    }

    const created = await withTenant(tenantId, async (tx) => {
      // Дубликат имени отклоняется частичным уникальным индексом; переводим в
      // понятную ошибку вместо 500.
      const duplicate = await tx.queryOne<{ id: string }>(
        `SELECT id FROM ai_agents
         WHERE tenant_id = $1 AND lower(name) = lower($2) AND deleted_at IS NULL`,
        [tenantId, payload.name],
      );

      if (duplicate !== null) {
        throw new AppError(409, "AGENT_NAME_TAKEN", "Агент с таким названием уже есть");
      }

      const companyOverride = payload.company_name_override ?? payload.companyNameOverride ?? null;
      const consultantSource = payload.consultant_source ?? payload.consultantSource ?? "manual";
      const consultantName = payload.consultant_name ?? payload.consultantName ?? null;
      const consultantRole = payload.consultant_role ?? payload.consultantRole ?? null;
      const fallbackModels = payload.fallback_models ?? payload.fallbackModels ?? [];

      return tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO ai_agents
           (tenant_id, name, description, accent, model, status, mode,
            temperature, max_tokens, system_prompt, context_entities,
            company_name_override, consultant_source, consultant_name, consultant_role, fallback_models,
            wizard_config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
         RETURNING id`,
        [
          tenantId,
          payload.name,
          payload.description ?? "",
          payload.accent,
          payload.model,
          payload.status,
          payload.mode,
          payload.temperature,
          payload.max_tokens,
          payload.system_prompt,
          payload.context_entities,
          companyOverride,
          consultantSource,
          consultantName,
          consultantRole,
          fallbackModels,
          payload.wizard_config ? JSON.stringify(payload.wizard_config) : null,
        ],
      );
    });

    // Чтение ВНЕ транзакции: `getAgent` берёт из пула другое соединение, и внутри
    // `withTenant` он не видел бы ещё не зафиксированную строку — запрос на
    // создание отвечал 404 на только что созданного агента (проверено на сервере).
    return this.getAgent(tenantId, created.id);
  }

  async updateAgent(
    tenantId: string,
    id: string,
    payload: UpdateAgentPayload,
  ): Promise<AiAgentDTO> {
    if (payload.model !== undefined && !isAiModelId(payload.model)) {
      throw new AppError(400, "VALIDATION_ERROR", "Неизвестная модель", {
        model: ["Неизвестная модель"],
      });
    }

    const companyOverride = payload.company_name_override !== undefined
      ? payload.company_name_override
      : payload.companyNameOverride !== undefined
        ? payload.companyNameOverride
        : undefined;
    const consultantSource = payload.consultant_source !== undefined
      ? payload.consultant_source
      : payload.consultantSource !== undefined
        ? payload.consultantSource
        : undefined;
    const consultantName = payload.consultant_name !== undefined
      ? payload.consultant_name
      : payload.consultantName !== undefined
        ? payload.consultantName
        : undefined;
    const consultantRole = payload.consultant_role !== undefined
      ? payload.consultant_role
      : payload.consultantRole !== undefined
        ? payload.consultantRole
        : undefined;
    const fallbackModels = payload.fallback_models !== undefined
      ? payload.fallback_models
      : payload.fallbackModels !== undefined
        ? payload.fallbackModels
        : undefined;

    const row = await queryOne<{ id: string }>(
      `UPDATE ai_agents SET
         name = COALESCE($3, name),
         description = COALESCE($4, description),
         accent = COALESCE($5, accent),
         model = COALESCE($6, model),
         status = COALESCE($7, status),
         mode = COALESCE($8, mode),
         temperature = COALESCE($9, temperature),
         max_tokens = COALESCE($10, max_tokens),
         system_prompt = COALESCE($11, system_prompt),
         context_entities = COALESCE($12, context_entities),
         company_name_override = CASE WHEN $14::boolean THEN $15::text ELSE company_name_override END,
         consultant_source = COALESCE($16, consultant_source),
         consultant_name = CASE WHEN $17::boolean THEN $18::text ELSE consultant_name END,
         consultant_role = CASE WHEN $19::boolean THEN $20::text ELSE consultant_role END,
         fallback_models = COALESCE($21, fallback_models),
         wizard_config = CASE WHEN $13::text IS NOT NULL THEN $13::jsonb ELSE wizard_config END
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [
        tenantId,
        id,
        payload.name ?? null,
        payload.description ?? null,
        payload.accent ?? null,
        payload.model ?? null,
        payload.status ?? null,
        payload.mode ?? null,
        payload.temperature ?? null,
        payload.max_tokens ?? null,
        payload.system_prompt ?? null,
        payload.context_entities ?? null,
        payload.wizard_config !== undefined ? (payload.wizard_config ? JSON.stringify(payload.wizard_config) : null) : null,
        companyOverride !== undefined,
        companyOverride ?? null,
        consultantSource ?? null,
        consultantName !== undefined,
        consultantName ?? null,
        consultantRole !== undefined,
        consultantRole ?? null,
        fallbackModels ?? null,
      ],
    );

    if (row === null) throw new NotFoundError("AI-агент не найден");

    return this.getAgent(tenantId, id);
  }

  /** Мягкое удаление: журнал вызовов ссылается на агента и должен остаться читаемым. */
  async deleteAgent(tenantId: string, id: string): Promise<void> {
    const row = await queryOne<{ id: string }>(
      `UPDATE ai_agents SET deleted_at = now(), status = 'paused'
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, id],
    );

    if (row === null) throw new NotFoundError("AI-агент не найден");

    // Отвязываем каналы связи от удалённого агента, чтобы диалоги больше не маршрутизировались
    await query(
      `DELETE FROM ai_agent_channel_bindings WHERE tenant_id = $1 AND agent_id = $2`,
      [tenantId, id],
    );
  }

  // -------------------------------------------------------------------------
  // Баланс ИИ
  // -------------------------------------------------------------------------

  async getBalance(tenantId: string): Promise<AiBalanceDTO> {
    const row = await queryOne<{
      balance_kopecks: string;
      markup_percent: string;
      spent_month: string;
      spent_total: string;
      requests_month: string;
      last_topup_at: Date | string | null;
    }>(
      `SELECT t.ai_balance_kopecks::text AS balance_kopecks,
              t.ai_markup_percent::text AS markup_percent,
              COALESCE(m.spent, 0)::text AS spent_month,
              COALESCE(a.spent, 0)::text AS spent_total,
              COALESCE(m.requests, 0)::text AS requests_month,
              p.last_topup_at
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT SUM(charged_kopecks) AS spent, COUNT(*) AS requests
         FROM ai_usage_log
         WHERE tenant_id = t.id
           AND created_at >= date_trunc('month', now())
       ) m ON true
       LEFT JOIN LATERAL (
         SELECT SUM(charged_kopecks) AS spent FROM ai_usage_log WHERE tenant_id = t.id
       ) a ON true
       LEFT JOIN LATERAL (
         SELECT MAX(created_at) AS last_topup_at FROM ai_balance_topups WHERE tenant_id = t.id
       ) p ON true
       WHERE t.id = $1`,
      [tenantId],
    );

    if (row === null) throw new NotFoundError("Арендатор не найден");

    const balanceKopecks = Number(row.balance_kopecks);
    const markupPercent = Number(row.markup_percent);

    return {
      balanceKopecks,
      spentThisMonthKopecks: Number(row.spent_month),
      spentTotalKopecks: Number(row.spent_total),
      requestsThisMonth: Number(row.requests_month),
      markupPercent,
      estimatedTokensLeft: estimateRemainingTokens({
        balanceKopecks,
        model: REFERENCE_MODEL,
        markupPercent,
      }),
      lastTopupAt: toIso(row.last_topup_at),
    };
  }

  /**
   * Пополнение баланса.
   *
   * Платёжного провайдера в проекте нет, поэтому операция начисляет сумму напрямую
   * и помечается `manual`. Это осознанное ограничение, а не имитация оплаты:
   * интерфейс говорит прямо, что счёт выставляется вручную.
   *
   * Инкремент выполняется в БД (`ai_balance_kopecks + $2`), а не чтением и
   * записью в приложении: два одновременных пополнения при чтении-записи
   * потеряли бы одно из них.
   */
  async topupBalance(input: {
    tenantId: string;
    actorId: string;
    amountRubles: number;
  }): Promise<AiBalanceDTO> {
    const amountKopecks = rublesToKopecks(input.amountRubles);

    await withTenant(input.tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO ai_balance_topups (tenant_id, created_by, amount_kopecks, source, comment)
         VALUES ($1, $2, $3, 'manual', 'Пополнение из интерфейса биллинга')`,
        [input.tenantId, input.actorId, amountKopecks],
      );

      // tenants не под RLS (платформенная таблица), поэтому обновляется явным
      // условием по id.
      await tx.query(
        `UPDATE tenants SET ai_balance_kopecks = ai_balance_kopecks + $2 WHERE id = $1`,
        [input.tenantId, amountKopecks],
      );

      // Один и тот же id передаётся отдельными параметрами: `tenant_id` — uuid,
      // `entity_id` — text. Повторное использование `$1` в обеих колонках даёт
      // `inconsistent types deduced for parameter $1` (42P08), причём каст на
      // одной из позиций не помогает — конфликт остаётся. Проверено на сервере.
      await tx.query(
        `INSERT INTO tenant_audit_log
           (tenant_id, actor_user_id, action, entity_type, entity_id, details)
         VALUES ($1, $2, 'ai_balance.topup', 'tenant', $3, $4::jsonb)`,
        [
          input.tenantId,
          input.actorId,
          input.tenantId,
          JSON.stringify({ amount_kopecks: amountKopecks }),
        ],
      );
    });

    return this.getBalance(input.tenantId);
  }
}
