import { query, queryOne, transaction } from "../../db/client.js";
import {
  GatewayChatProvider,
  type ChatProvider,
} from "../../services/chat.service.js";
import { calculateAiCharge, isAiModelId, type AiModelId } from "./ai-pricing.js";
import { buildSystemPrompt, parseAgentReply, type AgentReply } from "./agent-reply.js";
import { KnowledgeBaseService } from "./knowledge.service.js";
import { SalesLearnService } from "./sales-learn.service.js";
import type { WizardConfig } from "./ai.types.js";

// ---------------------------------------------------------------------------
// Пайплайн ответа агента на входящее сообщение клиента.
//
// Шаги: найти контекст в базе знаний → спросить модель → списать деньги →
// вернуть набор сообщений вызывающему, который отправит их в канал.
//
// Отправка сознательно НЕ здесь: она зависит от транспорта (MTProto, Bot API,
// WhatsApp), а решение «что ответить» от него не зависит. Разделение позволяет
// тестировать пайплайн без живого Telegram и переиспользовать его для остальных
// каналов.
// ---------------------------------------------------------------------------

/**
 * Минимальный остаток для запуска вызова, копейки.
 *
 * Ноль не годится: стоимость известна только после ответа модели, поэтому при
 * нулевом балансе арендатор мог бы уходить в минус на каждом сообщении. 100
 * копеек — примерно 30 вызовов gpt-4o-mini, то есть запас на завершение
 * начатых диалогов.
 */
const MIN_BALANCE_KOPECKS = 100;

/** Модель по умолчанию, если у агента указана незнакомая. */
const FALLBACK_MODEL: AiModelId = "gpt-4o-mini";

/**
 * Соответствие моделей каталога идентификаторам шлюза.
 *
 * Каталог `ai-pricing.ts` хранит «продуктовые» имена (`gpt-4o-mini`), по которым
 * считается цена, а шлюз требует полные идентификаторы с провайдером. Держать в
 * каталоге сразу идентификаторы шлюза нельзя: смена шлюза тогда меняла бы и цены,
 * и историю расхода в журнале.
 */
const GATEWAY_MODEL: Record<string, string> = {
  "gpt-4o": "openrouter/openai/gpt-4o",
  "gpt-4o-mini": "openrouter/openai/gpt-4o-mini",
  "claude-sonnet-4": "openrouter/anthropic/claude-sonnet-4",
  "claude-opus-4": "openrouter/anthropic/claude-opus-4",
  "deepseek-v3": "openrouter/deepseek/deepseek-chat",
  "gemini-1.5-pro": "gemini/gemini-1.5-pro",
  "gemini-3.5-flash": "gemini/gemini-3.5-flash",
  "gemini-3.5-flash-lite": "gemini/gemini-3.5-flash-lite",
  "gemini-2.5-flash": "gemini/gemini-2.5-flash",
  "gemini-2.5-pro": "gemini/gemini-2.5-pro",
};

export type PipelineOutcome =
  | { kind: "replied"; reply: AgentReply; chargedKopecks: number; model: string }
  | { kind: "no_agent" }
  | { kind: "agent_paused" }
  | { kind: "insufficient_balance"; balanceKopecks: number }
  | { kind: "llm_unavailable" }
  | { kind: "llm_failed"; reason: string }
  | { kind: "unparsable"; raw: string };

interface AgentRow {
  id: string;
  name: string;
  model: string;
  status: string;
  mode: string;
  temperature: string;
  max_tokens: number;
  system_prompt: string;
  wizard_config: WizardConfig | null;
}

interface Logger {
  info: (obj: object, message: string) => void;
  warn: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

export class AgentPipelineService {
  constructor(
    private readonly log: Logger,
    private readonly knowledge: KnowledgeBaseService = new KnowledgeBaseService(),
    private readonly chat: ChatProvider = new GatewayChatProvider(),
    private readonly salesLearn: SalesLearnService = new SalesLearnService(),
  ) {}

  /**
   * Агент, отвечающий в этом аккаунте канала.
   *
   * `ORDER BY created_at LIMIT 1`: схема допускает несколько агентов на один
   * аккаунт (например, для будущего расписания), но отвечать одновременно они не
   * могут — клиент получил бы два разных ответа на одно сообщение. Берётся
   * старейший как детерминированный выбор.
   */
  private async resolveAgent(input: {
    tenantId: string;
    channelAccountId: string;
  }): Promise<AgentRow | null> {
    const bound = await queryOne<AgentRow>(
      `SELECT a.id, a.name, a.model, a.status, a.mode, a.temperature,
              a.max_tokens, a.system_prompt, a.wizard_config
       FROM ai_agent_channel_bindings b
       JOIN ai_agents a ON a.id = b.agent_id
       WHERE b.tenant_id = $1
         AND b.channel_account_id = $2
         AND b.is_enabled
         AND a.deleted_at IS NULL
       ORDER BY a.created_at
       LIMIT 1`,
      [input.tenantId, input.channelAccountId],
    );

    if (bound !== null) return bound;

    // Fallback: если нет персональной привязки к каналу, но в тенанте есть активный бот
    return queryOne<AgentRow>(
      `SELECT a.id, a.name, a.model, a.status, a.mode, a.temperature,
              a.max_tokens, a.system_prompt, a.wizard_config
       FROM ai_agents a
       WHERE a.tenant_id = $1
         AND a.status = 'active'
         AND a.mode = 'autoreply'
         AND a.deleted_at IS NULL
       ORDER BY a.created_at ASC
       LIMIT 1`,
      [input.tenantId],
    );
  }

  /**
   * Готовит ответ на пачку сообщений.
   *
   * Не отправляет ничего сам: возвращает исход, по которому вызывающий решает,
   * писать ли клиенту. Все ветви отказа различимы — «нет агента» и «модель не
   * ответила» требуют разных действий от оператора.
   */
  async prepareReply(input: {
    tenantId: string;
    channelAccountId: string;
    chatId: string;
    text: string;
    channelType?: string;
    dealId?: string;
  }): Promise<PipelineOutcome> {
    // 0. Защита от автоответов личным контактам и при выключенном/приостановленном AI
    if (input.dealId) {
      const dealRow = await queryOne<{ id: string }>(
        `SELECT id FROM deals
         WHERE tenant_id = $1 AND id = $2 AND ai_paused_until IS NOT NULL AND ai_paused_until > now()
         LIMIT 1`,
        [input.tenantId, input.dealId],
      );
      if (dealRow !== null) {
        return { kind: "agent_paused" };
      }
    }

    const cleanDigits = input.chatId.replace(/\D/g, "");
    if (cleanDigits.length >= 10 || /^\d+$/.test(input.chatId)) {
      const contactCheck = await queryOne<{ id: string; is_personal: boolean; paused_deals: number }>(
        `SELECT c.id, c.is_personal,
                (SELECT COUNT(*)::int FROM deals d WHERE d.contact_id = c.id AND d.tenant_id = c.tenant_id AND d.deleted_at IS NULL AND d.ai_paused_until > now()) AS paused_deals
         FROM contacts c
         WHERE c.tenant_id = $1 AND c.deleted_at IS NULL
           AND (
             c.phone = $2
             OR c.phone = '+' || $2
             OR c.additional_phones @> jsonb_build_array(jsonb_build_object('number', $2::text))
             OR c.additional_phones @> jsonb_build_array(jsonb_build_object('number', ('+' || $2)::text))
             OR c.telegram_chat_id = CASE WHEN $2 ~ '^\\d+$' THEN $2::bigint ELSE NULL END
           )
         LIMIT 1`,
        [input.tenantId, cleanDigits],
      );
      if (contactCheck !== null && (contactCheck.is_personal || contactCheck.paused_deals > 0)) {
        return { kind: "agent_paused" };
      }
    }

    const agent = await this.resolveAgent(input);

    if (agent === null) return { kind: "no_agent" };

    // Отвечает только `autoreply`. `suggester` готовит черновики оператору, и
    // отправлять их клиенту напрямую означало бы игнорировать выбор настройки.
    if (agent.status !== "active" || agent.mode !== "autoreply") {
      return { kind: "agent_paused" };
    }

    if (!this.chat.isConfigured) return { kind: "llm_unavailable" };

    const balance = await this.readBalance(input.tenantId);

    // Проверка ДО вызова: списание возможно только после ответа, поэтому без
    // предварительной проверки арендатор уходил бы в минус.
    if (balance.balanceKopecks < MIN_BALANCE_KOPECKS) {
      return { kind: "insufficient_balance", balanceKopecks: balance.balanceKopecks };
    }

    // Загружаем предыдущую историю сообщений диалога для поддержания целостного контекста
    let conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
    let contactProfileContext = "";
    if (input.dealId) {
      try {
        interface HistoryMessageRow {
          direction: string;
          content: string;
          channel?: string;
        }

        // 1. Находим contact_id сделки для сквозной памяти по всем каналам (Webchat -> Telegram -> WhatsApp)
        const dealInfo = await queryOne<{ contact_id: string | null }>(
          `SELECT contact_id FROM deals WHERE id = $1 AND tenant_id = $2`,
          [input.dealId, input.tenantId],
        );
        const contactId = dealInfo?.contact_id;

        let rows: HistoryMessageRow[] = [];
        if (contactId) {
          // Сквозная выборка истории: все сообщения контакта по всем каналам и сделкам
          rows = await query<HistoryMessageRow>(
            `SELECT m.direction, m.content, m.channel
             FROM deal_messages m
             JOIN deals d ON d.id = m.deal_id
             WHERE d.tenant_id = $1 AND d.contact_id = $2 AND d.deleted_at IS NULL
             ORDER BY m.created_at DESC
             LIMIT 16`,
            [input.tenantId, contactId],
          );

          // Профиль контакта (имя, телефон, ниша, заметки) для постоянной памяти агента
          const contactRow = await queryOne<{
            first_name: string;
            last_name: string;
            phone: string;
            notes: string;
            custom_fields: Record<string, unknown> | null;
          }>(
            `SELECT first_name, last_name, phone, notes, custom_fields
             FROM contacts
             WHERE id = $1 AND tenant_id = $2`,
            [contactId, input.tenantId],
          );

          if (contactRow) {
            const profileParts: string[] = [];
            const fullName = `${contactRow.first_name || ""} ${contactRow.last_name || ""}`.trim();
            if (fullName && !fullName.startsWith("Посетитель сайта")) profileParts.push(`Имя клиента: ${fullName}`);
            if (contactRow.phone) profileParts.push(`Телефон: ${contactRow.phone}`);
            if (contactRow.notes && contactRow.notes.trim()) profileParts.push(`Заметки менеджера: ${contactRow.notes.trim()}`);
            if (contactRow.custom_fields && typeof contactRow.custom_fields === "object") {
              const cf = contactRow.custom_fields;
              if (cf.business_niche) profileParts.push(`Сфера деятельности клиента: ${cf.business_niche}`);
            }
            if (profileParts.length > 0) {
              contactProfileContext = `ПРОФИЛЬ И КОНТЕКСТ КЛИЕНТА В CRM:\n${profileParts.join("\n")}`;
            }
          }
        } else {
          rows = await query<HistoryMessageRow>(
            `SELECT direction, content, channel
             FROM deal_messages
             WHERE tenant_id = $1 AND deal_id = $2
             ORDER BY created_at DESC
             LIMIT 16`,
            [input.tenantId, input.dealId],
          );
        }

        const chronological: HistoryMessageRow[] = [...rows].reverse();
        // Убираем последнее сообщение, если оно дублирует текущий входящий input.text
        if (
          chronological.length > 0 &&
          chronological[chronological.length - 1]?.direction === "inbound"
        ) {
          chronological.pop();
        }

        conversationHistory = chronological
          .map((m: HistoryMessageRow) => {
            let content = m.content.trim();
            if (m.direction === "inbound") {
              content = content.replace(/^(\[[^\]]+\]\s*)+\n*/g, "").trim();
            }
            return {
              role: (m.direction === "inbound" ? "user" : "assistant") as "user" | "assistant",
              content,
            };
          })
          .filter((m: { role: "user" | "assistant"; content: string }) => m.content.length > 0);
      } catch (err) {
        this.log.warn({ err, dealId: input.dealId }, "Failed to fetch deal message history for agent");
      }
    }

    const recentUserContext = conversationHistory
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .slice(-2)
      .join(" ");
    const searchQuestion = recentUserContext ? `${recentUserContext} ${input.text}` : input.text;

    // Параллельный 4-слойный поиск: база знаний + закрытые сделки CRM + имя компании
    const [contextChunks, salesExamples, tenantRow] = await Promise.all([
      this.knowledge
        .search({
          tenantId: input.tenantId,
          agentId: agent.id,
          question: searchQuestion,
        })
        .catch((error: unknown) => {
          this.log.warn(
            { error, agentId: agent.id },
            "Knowledge search failed, answering without context",
          );
          return [];
        }),
      this.salesLearn
        .findRelevantSalesExamples({
          tenantId: input.tenantId,
          query: searchQuestion,
          limit: 2,
        })
        .catch((error: unknown) => {
          this.log.warn(
            { error, agentId: agent.id },
            "Sales learn search failed, continuing without crm patterns",
          );
          return [];
        }),
      queryOne<{ name: string }>(
        `SELECT name FROM tenants WHERE id = $1`,
        [input.tenantId],
      ).catch(() => null),
    ]);

    const model = isAiModelId(agent.model) ? agent.model : FALLBACK_MODEL;

    if (!isAiModelId(agent.model)) {
      this.log.warn(
        { agentId: agent.id, model: agent.model, fallback: FALLBACK_MODEL },
        "Agent references an unknown model, falling back",
      );
    }

    const wc = agent.wizard_config;
    const variables: Record<string, string> = {
      "tenant.name": tenantRow?.name ?? "Компания",
      "channel_type": input.channelType ?? "онлайн-чат",
      "current_time": new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    };

    if (wc) {
      if (wc.consultantName) variables["consultant.name"] = wc.consultantName;
      if (wc.consultantRole) variables["consultant.role"] = wc.consultantRole;
      if (wc.businessNiche) variables["business.niche"] = wc.businessNiche;
      if (wc.targetAction) variables["target.action"] = wc.targetAction;
      if (wc.handoffSpecialist) variables["handoff.specialist"] = wc.handoffSpecialist;
    }

    const systemPrompt = buildSystemPrompt({
      agentPrompt: agent.system_prompt,
      contextChunks: contextChunks.map((hit) => ({
        content: hit.content,
        filename: hit.filename,
      })),
      variables,
      crmPatterns: salesExamples.map((ex) => ({
        customerQuery: ex.customerQuery,
        agentReply: ex.agentReply,
      })),
      contactProfile: contactProfileContext,
    });

    try {
      const completion = await this.chat.complete({
        model: GATEWAY_MODEL[model] ?? model,
        messages: [
          { role: "system", content: systemPrompt },
          ...conversationHistory,
          { role: "user", content: input.text },
        ],
        temperature: Number(agent.temperature),
        maxTokens: agent.max_tokens,
        jsonMode: true,
      });

      const reply = parseAgentReply(completion.content);

      // Расход списывается и при непригодном ответе: токены провайдер уже
      // потратил, и не записать их означало бы, что платформа платит за них сама.
      const charge = await this.chargeUsage({
        tenantId: input.tenantId,
        agentId: agent.id,
        model,
        tokensIn: completion.tokensIn,
        tokensOut: completion.tokensOut,
        latencyMs: completion.latencyMs,
        status: reply === null ? "error" : "success",
        errorMessage: reply === null ? "Модель вернула ответ вне формата JSON" : "",
      });

      if (reply === null) {
        this.log.warn(
          { agentId: agent.id, raw: completion.content.slice(0, 300) },
          "Agent reply is not valid JSON, nothing will be sent",
        );
        return { kind: "unparsable", raw: completion.content };
      }

      return {
        kind: "replied",
        reply,
        chargedKopecks: charge,
        model: completion.model,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "неизвестная ошибка";

      // Отказ вызова тоже попадает в журнал, но без списания: токенов не было.
      await this.chargeUsage({
        tenantId: input.tenantId,
        agentId: agent.id,
        model,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        status: "error",
        errorMessage: reason.slice(0, 500),
      });

      return { kind: "llm_failed", reason };
    }
  }

  private async readBalance(
    tenantId: string,
  ): Promise<{ balanceKopecks: number; markupPercent: number }> {
    const row = await queryOne<{ balance: string; markup: string }>(
      `SELECT ai_balance_kopecks::text AS balance, ai_markup_percent::text AS markup
       FROM tenants WHERE id = $1`,
      [tenantId],
    );

    return {
      balanceKopecks: Number(row?.balance ?? 0),
      markupPercent: Number(row?.markup ?? 0),
    };
  }

  /**
   * Пишет журнал и списывает деньги в одной транзакции.
   *
   * Иначе возможны обе половины по отдельности: списание без записи в журнал
   * (расход невозможно объяснить) или запись без списания (арендатор пользуется
   * бесплатно). Возвращает списанную сумму в копейках.
   *
   * Наценка читается внутри транзакции: между проверкой баланса и списанием её
   * могли изменить в платформенной панели, и цена вызова должна соответствовать
   * моменту списания.
   */
  private async chargeUsage(input: {
    tenantId: string;
    agentId: string;
    model: AiModelId;
    tokensIn: number;
    tokensOut: number;
    latencyMs: number;
    status: "success" | "error";
    errorMessage: string;
  }): Promise<number> {
    return transaction(async (tx) => {
      const tenant = await tx.queryOne<{ markup: string }>(
        `SELECT ai_markup_percent::text AS markup FROM tenants WHERE id = $1 FOR UPDATE`,
        [input.tenantId],
      );

      const charge = calculateAiCharge({
        model: input.model,
        tokensIn: input.tokensIn,
        tokensOut: input.tokensOut,
        markupPercent: Number(tenant?.markup ?? 0),
      });

      await tx.query(
        `INSERT INTO ai_usage_log
           (tenant_id, agent_id, user_id, model, tokens_in, tokens_out, latency_ms,
            provider_cost_kopecks, charged_kopecks, status, error_message)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          input.tenantId,
          input.agentId,
          input.model,
          input.tokensIn,
          input.tokensOut,
          input.latencyMs,
          charge.providerCostKopecks,
          charge.chargedKopecks,
          input.status,
          input.errorMessage,
        ],
      );

      if (charge.chargedKopecks > 0) {
        // `GREATEST(..., 0)`: баланс не должен уходить в минус даже если
        // единственный вызов оказался дороже остатка. Разница — потеря платформы,
        // и она предпочтительнее отрицательного остатка, который интерфейс
        // показал бы как долг.
        await tx.query(
          `UPDATE tenants
           SET ai_balance_kopecks = GREATEST(ai_balance_kopecks - $2, 0)
           WHERE id = $1`,
          [input.tenantId, charge.chargedKopecks],
        );
      }

      return charge.chargedKopecks;
    });
  }

  /**
   * Тестовый чат с агентом прямо из кабинета платформы.
   *
   * Использует боевой RAG базы знаний агента, подстановку переменных и LLM-провайдер,
   * чтобы администратор видел точный ответ, который получит реальный клиент.
   */
  async generateTestReply(input: {
    tenantId: string;
    agentId: string;
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  }): Promise<{ reply: string; messages: string[]; tokens: number; latencyMs: number }> {
    const agent = await queryOne<AgentRow>(
      `SELECT a.id, a.name, a.model, a.status, a.mode, a.temperature,
              a.max_tokens, a.system_prompt, a.wizard_config
       FROM ai_agents a
       WHERE a.tenant_id = $1
         AND a.id = $2
         AND a.deleted_at IS NULL
       LIMIT 1`,
      [input.tenantId, input.agentId],
    );

    if (agent === null) {
      throw new Error("Агент не найден или удалён");
    }

    const [contextChunks, salesExamples, tenantRow] = await Promise.all([
      this.knowledge
        .search({
          tenantId: input.tenantId,
          agentId: agent.id,
          question: input.message,
        })
        .catch((error: unknown) => {
          this.log.warn({ error, agentId: agent.id }, "Knowledge search failed in test chat");
          return [];
        }),
      this.salesLearn
        .findRelevantSalesExamples({
          tenantId: input.tenantId,
          query: input.message,
          limit: 2,
        })
        .catch(() => []),
      queryOne<{ name: string }>(
        `SELECT name FROM tenants WHERE id = $1`,
        [input.tenantId],
      ).catch(() => null),
    ]);

    const wc = agent.wizard_config;
    const variables: Record<string, string> = {
      "tenant.name": tenantRow?.name || "Компания",
      "channel_type": "тестовый чат",
      "current_time": new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }),
    };

    if (wc) {
      if (wc.consultantName) variables["consultant.name"] = wc.consultantName;
      if (wc.consultantRole) variables["consultant.role"] = wc.consultantRole;
      if (wc.businessNiche) variables["business.niche"] = wc.businessNiche;
      if (wc.targetAction) variables["target.action"] = wc.targetAction;
      if (wc.handoffSpecialist) variables["handoff.specialist"] = wc.handoffSpecialist;
    }

    const systemPrompt = buildSystemPrompt({
      agentPrompt: agent.system_prompt,
      contextChunks: contextChunks.map((hit) => ({
        content: hit.content,
        filename: hit.filename,
      })),
      variables,
      crmPatterns: salesExamples.map((ex) => ({
        customerQuery: ex.customerQuery,
        agentReply: ex.agentReply,
      })),
    });

    const model = isAiModelId(agent.model) ? agent.model : FALLBACK_MODEL;

    const chatMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
      { role: "system", content: systemPrompt },
    ];

    if (input.history && Array.isArray(input.history)) {
      for (const h of input.history.slice(-6)) {
        if (h && (h.role === "user" || h.role === "assistant") && typeof h.content === "string") {
          chatMessages.push({ role: h.role, content: h.content });
        }
      }
    }

    chatMessages.push({ role: "user", content: input.message });

    const completion = await this.chat.complete({
      model: GATEWAY_MODEL[model] ?? model,
      messages: chatMessages,
      temperature: Number(agent.temperature),
      maxTokens: agent.max_tokens,
      jsonMode: true,
    });

    const parsed = parseAgentReply(completion.content);
    const messages = parsed ? parsed.messages : [completion.content];
    const replyText = messages.join("\n\n");

    // Фиксируем использование в журнале
    void this.chargeUsage({
      tenantId: input.tenantId,
      agentId: agent.id,
      model,
      tokensIn: completion.tokensIn ?? 0,
      tokensOut: completion.tokensOut ?? 0,
      latencyMs: completion.latencyMs ?? 0,
      status: "success",
      errorMessage: "",
    }).catch((err) => {
      this.log.warn({ err }, "Не удалось зафиксировать статистику тестового чата");
    });

    return {
      reply: replyText,
      messages,
      tokens: (completion.tokensIn ?? 0) + (completion.tokensOut ?? 0),
      latencyMs: completion.latencyMs ?? 0,
    };
  }

}
