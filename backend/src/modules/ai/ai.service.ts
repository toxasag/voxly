import { query, queryOne, withTenant } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { GatewayChatProvider } from "../../services/chat.service.js";
import { validateUrl, htmlToText } from "./site-crawler.js";
import {
  estimateRemainingTokens,
  isAiModelId,
  rublesToKopecks,
  type AiModelId,
} from "./ai-pricing.js";
import type {
  AgentDialogueFeedbackDTO,
  AgentMode,
  AgentStatus,
  AiAgentDTO,
  AiBalanceDTO,
  ConsultantSource,
  CreateAgentPayload,
  CreateDialogueFeedbackPayload,
  GeneratePromptPayload,
  GeneratedPromptResult,
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
  target_page_url: string | null;
  generated_system_prompt: string | null;
  knowledge_base_md: string;
  feedback_learning_enabled: boolean;
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
    targetPageUrl: row.target_page_url,
    generatedSystemPrompt: row.generated_system_prompt,
    knowledgeBaseMd: row.knowledge_base_md ?? "",
    feedbackLearningEnabled: row.feedback_learning_enabled ?? true,
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
         a.target_page_url, a.generated_system_prompt, a.knowledge_base_md, a.feedback_learning_enabled,
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
      const targetPageUrl = payload.target_page_url ?? payload.targetPageUrl ?? null;
      const generatedSystemPrompt = payload.generated_system_prompt ?? payload.generatedSystemPrompt ?? null;
      const knowledgeBaseMd = payload.knowledge_base_md ?? payload.knowledgeBaseMd ?? "";
      const feedbackLearningEnabled = payload.feedback_learning_enabled !== undefined
        ? payload.feedback_learning_enabled
        : payload.feedbackLearningEnabled !== undefined
          ? payload.feedbackLearningEnabled
          : true;

      return tx.queryOneOrThrow<{ id: string }>(
        `INSERT INTO ai_agents
           (tenant_id, name, description, accent, model, status, mode,
            temperature, max_tokens, system_prompt, context_entities,
            company_name_override, consultant_source, consultant_name, consultant_role, fallback_models,
            target_page_url, generated_system_prompt, knowledge_base_md, feedback_learning_enabled,
            wizard_config)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb)
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
          targetPageUrl,
          generatedSystemPrompt,
          knowledgeBaseMd,
          feedbackLearningEnabled,
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
    const targetPageUrl = payload.target_page_url !== undefined
      ? payload.target_page_url
      : payload.targetPageUrl !== undefined
        ? payload.targetPageUrl
        : undefined;
    const generatedSystemPrompt = payload.generated_system_prompt !== undefined
      ? payload.generated_system_prompt
      : payload.generatedSystemPrompt !== undefined
        ? payload.generatedSystemPrompt
        : undefined;
    const knowledgeBaseMd = payload.knowledge_base_md !== undefined
      ? payload.knowledge_base_md
      : payload.knowledgeBaseMd !== undefined
        ? payload.knowledgeBaseMd
        : undefined;
    const feedbackLearningEnabled = payload.feedback_learning_enabled !== undefined
      ? payload.feedback_learning_enabled
      : payload.feedbackLearningEnabled !== undefined
        ? payload.feedbackLearningEnabled
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
         target_page_url = CASE WHEN $22::boolean THEN $23::text ELSE target_page_url END,
         generated_system_prompt = CASE WHEN $24::boolean THEN $25::text ELSE generated_system_prompt END,
         knowledge_base_md = CASE WHEN $26::boolean THEN $27::text ELSE knowledge_base_md END,
         feedback_learning_enabled = CASE WHEN $28::boolean THEN $29::boolean ELSE feedback_learning_enabled END,
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
        targetPageUrl !== undefined,
        targetPageUrl ?? null,
        generatedSystemPrompt !== undefined,
        generatedSystemPrompt ?? null,
        knowledgeBaseMd !== undefined,
        knowledgeBaseMd ?? "",
        feedbackLearningEnabled !== undefined,
        feedbackLearningEnabled ?? true,
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

  // ---------------------------------------------------------------------------
  // Генеративный синтез системного промпта из контекста и URL целевой страницы
  // ---------------------------------------------------------------------------

  async generatePrompt(
    payload: GeneratePromptPayload,
    tenantId?: string,
  ): Promise<GeneratedPromptResult> {
    const rawUrl = (payload.target_page_url || payload.targetPageUrl)?.trim();
    let scrapedTitle = "";
    let scrapedText = "";

    if (rawUrl) {
      try {
        const parsedUrl = validateUrl(rawUrl);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const response = await fetch(parsedUrl.toString(), {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 GETVOXLY-Bot/1.0",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
          },
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) {
          const html = await response.text();
          const parsed = htmlToText(html);
          scrapedTitle = parsed.title;
          scrapedText = parsed.text.slice(0, 10_000);
        }
      } catch {
        // Игнорируем ошибку парсинга страницы, генерируем из контекста
      }
    }

    const companyName = payload.company_name || payload.companyName || "";
    const businessNiche = payload.business_niche || payload.businessNiche || "";
    const clientProfile = payload.client_profile || payload.clientProfile || "";
    const targetAction = payload.target_action || payload.targetAction || "";
    const constraints = payload.constraints || "";
    const consultantName = payload.consultant_name || payload.consultantName || "";
    const consultantRole = payload.consultant_role || payload.consultantRole || "";
    const handoffSpecialist = payload.handoff_specialist || payload.handoffSpecialist || "";

    const userPromptContent = `
ПРОАНАЛИЗИРУЙ КОНТЕКСТ КОМПАНИИ И ВЕБ-СТРАНИЦУ (ЕСЛИ ЕСТЬ):
URL целевой страницы: ${rawUrl || "Не указан"}
Заголовок страницы: ${scrapedTitle || "Не определен"}
Текст страницы (выжимка): ${scrapedText ? scrapedText.slice(0, 4000) : "Отсутствует"}
Указанная компания: ${companyName || "Не указана (определи из страницы/контекста)"}
Ниша / сфера: ${businessNiche || "Не указана (определи из страницы/контекста)"}
Профиль клиента: ${clientProfile || "Не указан (определи из страницы/контекста)"}
Целевое действие: ${targetAction || "Не указано (определи логичное конверсионное действие)"}
Ограничения: ${constraints || "Не указаны"}
Желаемое имя консультанта: ${consultantName || "Предложи подходящее имя (например, Алексей, Мария, Дмитрий)"}
Желаемая должность консультанта: ${consultantRole || "Предложи экспертную должность (например, ведущий специалист, специалист клиентского сервиса)"}
Специалист для эскалации: ${handoffSpecialist || "Старший профильный специалист"}

СФОРМИРУЙ СТРОГИЙ JSON со следующими полями:
{
  "systemPrompt": "...", // Полный, профессиональный, подробный системный промпт (300-600 слов), построенный на 6 ключевых навыках продаж (sales-discovery, sales-product-match, sales-objections, sales-lead-capture, sales-human-handoff, sales-quality-check). Без нейрослопа! Используй плейсхолдеры {{consultant.name}}, {{tenant.name}}, {{knowledge_base_context}}.
  "businessNiche": "...", // Четко и емко сформулированная сфера деятельности компании
  "clientProfile": "...", // Портрет целевого клиента и его ключевые боли/задачи
  "targetAction": "...", // Ключевое конверсионное действие в диалоге (например, «согласование бесплатного 15-минутного аудита и получение номера телефона»)
  "constraints": "...", // Стоп-факторы и ограничения (не выдумывать цены, строго опираться на базу знаний, не давать ложных гарантий)
  "consultantName": "...", // Имя консультанта
  "consultantRole": "...", // Должность консультанта
  "handoffSpecialist": "...", // Специалист для передачи сложных вопросов
  "knowledgeBaseDraftMd": "..." // Структурированный черновик базы знаний компании в Markdown (# О компании, ## Услуги и регламент, ## Преимущества)
}
`.trim();

    try {
      const chatProvider = new GatewayChatProvider();
      const completion = await chatProvider.complete({
        model: "gemini-3.5-flash-lite",
        messages: [
          {
            role: "system",
            content:
              "Ты — ведущий эксперт по проектированию высококонверсионных AI-ассистентов и системных промптов для B2B SaaS. Твоя задача — извлечь суть бизнеса из сайта или контекста и создать идеальный системный промпт и параметры агента. Ответ ТОЛЬКО строгий JSON без markdown-обёрток ```.",
          },
          { role: "user", content: userPromptContent },
        ],
        temperature: 0.4,
        maxTokens: 3000,
        jsonMode: true,
        tenantId,
      });

      const parsedJson = JSON.parse(completion.content) as Partial<GeneratedPromptResult>;
      if (parsedJson.systemPrompt && parsedJson.businessNiche) {
        return {
          systemPrompt: parsedJson.systemPrompt,
          businessNiche: parsedJson.businessNiche,
          clientProfile: parsedJson.clientProfile || "Клиенты, заинтересованные в услугах компании",
          targetAction: parsedJson.targetAction || "Квалификация потребности и согласование экспертной консультации с запросом номера телефона",
          constraints: parsedJson.constraints || "Не называть вымышленные цены, строго опираться на базу знаний компании, не давать необоснованных гарантий.",
          consultantName: parsedJson.consultantName || consultantName || "Алексей",
          consultantRole: parsedJson.consultantRole || consultantRole || "ведущий эксперт",
          handoffSpecialist: parsedJson.handoffSpecialist || handoffSpecialist || "руководитель профильного направления",
          knowledgeBaseDraftMd: parsedJson.knowledgeBaseDraftMd || `# База знаний: ${companyName || scrapedTitle || "Компания"}\n\n## Основные направления\n- Качественное предоставление профильных услуг.\n\n## Регламент консультации\n- Уточнять детали запроса перед расчетом.`,
        };
      }
    } catch {
      // При сбое LLM генерируем детерминированный fallback
    }

    // Детерминированный fallback
    const resolvedNiche = businessNiche || (scrapedTitle ? `Услуги в сфере ${scrapedTitle}` : "Продажи и экспертное обслуживание клиентов");
    const resolvedName = consultantName || "Алексей";
    const resolvedRole = consultantRole || "ведущий консультант";
    const resolvedAction = targetAction || "Квалификация запроса, выявление потребности и запрос номера телефона для детального разбора со специалистом";
    const resolvedConstraints = constraints || "Строго опираться на факты компании, не называть точные цены без базы знаний, не обещать невыполнимого.";
    const resolvedHandoff = handoffSpecialist || "старший специалист профильного отдела";

    const systemPromptFallback = `Ты — {{consultant.name}}, ${resolvedRole} компании {{tenant.name}}.
Твоя сфера деятельности: ${resolvedNiche}.

КЛЮЧЕВЫЕ НАВЫКИ И ЭТАПЫ ДИАЛОГА:
1. Выявление потребности (Sales Discovery): задавай открытые и квалифицирующие вопросы, узнавай детали ситуации клиента.
2. Подбор решения (Product Match): предлагай точные услуги и решения строго по фактам из базы знаний {{knowledge_base_context}}.
3. Работа с возражениями (Sales Objections): если клиент сомневается или говорит «дорого/подумаю», аргументируй ценность, приводи примеры и предлагай предварительный аудит.
4. Целевое действие (Lead Capture): твоя главная цель — ${resolvedAction}.
5. Передача человеку (Human Handoff): при сложных, конфликтных или нестандартных вопросах вежливо передай диалог на ${resolvedHandoff}.
6. Контроль качества (Quality Check): говори живо, уважительно и по делу. Абсолютный запрет на нейрослоп («рад помочь», «чем могу помочь сегодня»).

ОГРАНИЧЕНИЯ:
${resolvedConstraints}`.trim();

    return {
      systemPrompt: systemPromptFallback,
      businessNiche: resolvedNiche,
      clientProfile: clientProfile || "Клиенты, нуждающиеся в профессиональном решении задач",
      targetAction: resolvedAction,
      constraints: resolvedConstraints,
      consultantName: resolvedName,
      consultantRole: resolvedRole,
      handoffSpecialist: resolvedHandoff,
      knowledgeBaseDraftMd: `# База знаний компании {{tenant.name}}\n\n## Общие сведения\n- Сфера: ${resolvedNiche}\n- Экспертная поддержка клиентов.\n\n## Регламент работы\n- Оперативная квалификация и перевод на профильных специалистов.`,
    };
  }

  // ---------------------------------------------------------------------------
  // Синхронизация активной Markdown-базы знаний агента
  // ---------------------------------------------------------------------------

  async syncKnowledgeBaseMd(
    tenantId: string,
    agentId: string,
    knowledgeBaseMd: string,
  ): Promise<AiAgentDTO> {
    const row = await queryOne<{ id: string }>(
      `UPDATE ai_agents
       SET knowledge_base_md = $3, updated_at = now()
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, agentId, knowledgeBaseMd ?? ""],
    );

    if (row === null) {
      throw new NotFoundError("AI-агент не найден");
    }

    return this.getAgent(tenantId, agentId);
  }

  // ---------------------------------------------------------------------------
  // Петля обучения через обратную связь диалогов (Dialogue Feedback Loop)
  // ---------------------------------------------------------------------------

  async createFeedback(
    tenantId: string,
    agentId: string,
    payload: CreateDialogueFeedbackPayload,
  ): Promise<AgentDialogueFeedbackDTO> {
    const comment = (payload.user_comment || payload.userComment || "").trim();
    const dealId = payload.deal_id ?? payload.dealId ?? null;
    const conversationId = payload.conversation_id ?? payload.conversationId ?? null;
    const rating = payload.rating;
    const clarificationAnswer = (payload.clarification_answer ?? payload.clarificationAnswer)?.trim() || null;

    let clarificationQa: Array<{ question: string; answer?: string | null }> = [];
    let compiledRule: string | null = null;

    if (comment.length < 15 && !clarificationAnswer) {
      clarificationQa = [
        {
          question:
            "Уточните, пожалуйста, что именно агент сформулировал некорректно и какой ответ был бы правильным по стандартам компании?",
          answer: null,
        },
      ];
    } else {
      const ruleText = clarificationAnswer ? `${comment}. Пояснение: ${clarificationAnswer}` : comment;
      compiledRule = `- **[Правило диалога]**: ${ruleText.replace(/^[\s\-*]+/, "")}`;
    }

    const row = await queryOne<{
      id: string;
      agent_id: string;
      deal_id: string | null;
      conversation_id: string | null;
      rating: number;
      user_comment: string;
      clarification_qa: Array<{ question: string; answer?: string | null }>;
      compiled_rule: string | null;
      status: "pending" | "approved" | "rejected";
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `INSERT INTO agent_dialogue_feedbacks
         (tenant_id, agent_id, deal_id, conversation_id, rating, user_comment, clarification_qa, compiled_rule, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, 'pending')
       RETURNING id, agent_id, deal_id, conversation_id, rating, user_comment, clarification_qa, compiled_rule, status, created_at, updated_at`,
      [
        tenantId,
        agentId,
        dealId,
        conversationId,
        rating,
        comment,
        JSON.stringify(clarificationQa),
        compiledRule,
      ],
    );

    if (row === null) {
      throw new AppError(500, "FEEDBACK_CREATE_FAILED", "Не удалось сохранить обратную связь");
    }

    return {
      id: row.id,
      agentId: row.agent_id,
      dealId: row.deal_id,
      conversationId: row.conversation_id,
      rating: row.rating,
      userComment: row.user_comment,
      clarificationQa: row.clarification_qa || [],
      compiledRule: row.compiled_rule,
      status: row.status,
      createdAt: toIso(row.created_at) ?? "",
      updatedAt: toIso(row.updated_at) ?? "",
    };
  }

  async listFeedbacks(tenantId: string, agentId: string): Promise<AgentDialogueFeedbackDTO[]> {
    const rows = await query<{
      id: string;
      agent_id: string;
      deal_id: string | null;
      conversation_id: string | null;
      rating: number;
      user_comment: string;
      clarification_qa: Array<{ question: string; answer?: string | null }>;
      compiled_rule: string | null;
      status: "pending" | "approved" | "rejected";
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `SELECT id, agent_id, deal_id, conversation_id, rating, user_comment, clarification_qa, compiled_rule, status, created_at, updated_at
       FROM agent_dialogue_feedbacks
       WHERE tenant_id = $1 AND agent_id = $2
       ORDER BY created_at DESC
       LIMIT 100`,
      [tenantId, agentId],
    );

    return rows.map((r) => ({
      id: r.id,
      agentId: r.agent_id,
      dealId: r.deal_id,
      conversationId: r.conversation_id,
      rating: r.rating,
      userComment: r.user_comment,
      clarificationQa: r.clarification_qa || [],
      compiledRule: r.compiled_rule,
      status: r.status,
      createdAt: toIso(r.created_at) ?? "",
      updatedAt: toIso(r.updated_at) ?? "",
    }));
  }

  async approveFeedback(
    tenantId: string,
    agentId: string,
    feedbackId: string,
  ): Promise<{ feedback: AgentDialogueFeedbackDTO; knowledgeBaseMd: string }> {
    const fb = await queryOne<{
      id: string;
      user_comment: string;
      compiled_rule: string | null;
      status: string;
    }>(
      `SELECT id, user_comment, compiled_rule, status
       FROM agent_dialogue_feedbacks
       WHERE tenant_id = $1 AND agent_id = $2 AND id = $3`,
      [tenantId, agentId, feedbackId],
    );

    if (fb === null) {
      throw new NotFoundError("Запись обратной связи не найдена");
    }

    const rule =
      fb.compiled_rule ||
      `- **[Утвержденное правило]**: ${fb.user_comment.replace(/^[\s\-*]+/, "")}`;

    // Добавляем правило в knowledge_base_md агента
    const agent = await queryOne<{ knowledge_base_md: string }>(
      `SELECT knowledge_base_md FROM ai_agents WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, agentId],
    );

    if (agent === null) {
      throw new NotFoundError("AI-агент не найден");
    }

    let updatedMd = agent.knowledge_base_md || "";
    const sectionHeader = "## Обучение на диалогах (Утвержденные правила)";
    if (!updatedMd.includes(sectionHeader)) {
      updatedMd = updatedMd.trim()
        ? `${updatedMd.trim()}\n\n${sectionHeader}\n${rule}`
        : `${sectionHeader}\n${rule}`;
    } else {
      updatedMd = `${updatedMd.trim()}\n${rule}`;
    }

    await query(
      `UPDATE ai_agents SET knowledge_base_md = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
      [tenantId, agentId, updatedMd],
    );

    const updatedFb = await queryOne<{
      id: string;
      agent_id: string;
      deal_id: string | null;
      conversation_id: string | null;
      rating: number;
      user_comment: string;
      clarification_qa: Array<{ question: string; answer?: string | null }>;
      compiled_rule: string | null;
      status: "pending" | "approved" | "rejected";
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `UPDATE agent_dialogue_feedbacks
       SET status = 'approved', compiled_rule = $4, updated_at = now()
       WHERE tenant_id = $1 AND agent_id = $2 AND id = $3
       RETURNING id, agent_id, deal_id, conversation_id, rating, user_comment, clarification_qa, compiled_rule, status, created_at, updated_at`,
      [tenantId, agentId, feedbackId, rule],
    );

    return {
      feedback: {
        id: updatedFb!.id,
        agentId: updatedFb!.agent_id,
        dealId: updatedFb!.deal_id,
        conversationId: updatedFb!.conversation_id,
        rating: updatedFb!.rating,
        userComment: updatedFb!.user_comment,
        clarificationQa: updatedFb!.clarification_qa || [],
        compiledRule: updatedFb!.compiled_rule,
        status: updatedFb!.status,
        createdAt: toIso(updatedFb!.created_at) ?? "",
        updatedAt: toIso(updatedFb!.updated_at) ?? "",
      },
      knowledgeBaseMd: updatedMd,
    };
  }

  async rejectFeedback(
    tenantId: string,
    agentId: string,
    feedbackId: string,
  ): Promise<AgentDialogueFeedbackDTO> {
    const updated = await queryOne<{
      id: string;
      agent_id: string;
      deal_id: string | null;
      conversation_id: string | null;
      rating: number;
      user_comment: string;
      clarification_qa: Array<{ question: string; answer?: string | null }>;
      compiled_rule: string | null;
      status: "pending" | "approved" | "rejected";
      created_at: Date | string;
      updated_at: Date | string;
    }>(
      `UPDATE agent_dialogue_feedbacks
       SET status = 'rejected', updated_at = now()
       WHERE tenant_id = $1 AND agent_id = $2 AND id = $3
       RETURNING id, agent_id, deal_id, conversation_id, rating, user_comment, clarification_qa, compiled_rule, status, created_at, updated_at`,
      [tenantId, agentId, feedbackId],
    );

    if (updated === null) {
      throw new NotFoundError("Запись обратной связи не найдена");
    }

    return {
      id: updated.id,
      agentId: updated.agent_id,
      dealId: updated.deal_id,
      conversationId: updated.conversation_id,
      rating: updated.rating,
      userComment: updated.user_comment,
      clarificationQa: updated.clarification_qa || [],
      compiledRule: updated.compiled_rule,
      status: updated.status,
      createdAt: toIso(updated.created_at) ?? "",
      updatedAt: toIso(updated.updated_at) ?? "",
    };
  }
}
