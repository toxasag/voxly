import { queryOne, transaction } from "../../db/client.js";
import {
  GatewayChatProvider,
  type ChatProvider,
} from "../../services/chat.service.js";
import { calculateAiCharge, isAiModelId, type AiModelId } from "./ai-pricing.js";
import { buildSystemPrompt, parseAgentReply, type AgentReply } from "./agent-reply.js";
import { KnowledgeBaseService } from "./knowledge.service.js";

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
const GATEWAY_MODEL: Record<AiModelId, string> = {
  "gpt-4o": "openrouter/openai/gpt-4o",
  "gpt-4o-mini": "openrouter/openai/gpt-4o-mini",
  "claude-sonnet-4": "openrouter/anthropic/claude-sonnet-4",
  "claude-opus-4": "openrouter/anthropic/claude-opus-4",
  "deepseek-v3": "openrouter/deepseek/deepseek-chat",
  "gemini-1.5-pro": "gemini/gemini-1.5-pro",
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
    return queryOne<AgentRow>(
      `SELECT a.id, a.name, a.model, a.status, a.mode, a.temperature,
              a.max_tokens, a.system_prompt
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
  }): Promise<PipelineOutcome> {
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

    // Поиск не должен ронять ответ: при недоступных эмбеддингах агент отвечает
    // без контекста, а не молчит.
    const contextChunks = await this.knowledge
      .search({
        tenantId: input.tenantId,
        agentId: agent.id,
        question: input.text,
      })
      .catch((error: unknown) => {
        this.log.warn(
          { error, agentId: agent.id },
          "Knowledge search failed, answering without context",
        );
        return [];
      });

    const model = isAiModelId(agent.model) ? agent.model : FALLBACK_MODEL;

    if (!isAiModelId(agent.model)) {
      this.log.warn(
        { agentId: agent.id, model: agent.model, fallback: FALLBACK_MODEL },
        "Agent references an unknown model, falling back",
      );
    }

    const systemPrompt = buildSystemPrompt({
      agentPrompt: agent.system_prompt,
      contextChunks: contextChunks.map((hit) => ({
        content: hit.content,
        filename: hit.filename,
      })),
    });

    try {
      const completion = await this.chat.complete({
        model: GATEWAY_MODEL[model],
        messages: [
          { role: "system", content: systemPrompt },
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

}
