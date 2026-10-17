import { query, queryOne } from "../../db/client.js";
import {
  GatewayEmbeddingProvider,
  type EmbeddingProvider,
} from "../../services/embeddings.service.js";
import { KnowledgeBaseService } from "./knowledge.service.js";

// ---------------------------------------------------------------------------
// Обучение ИИ на закрытых успешных сделках (Closed-Won Sales Learning).
//
// Извлекает диалоговые пары (вопрос клиента -> успешный ответ менеджера)
// из истории сообщений выигранной сделки, векторизует их и сохраняет в
// `ai_sales_examples`. При последующих диалогах с клиентами релевантные
// примеры извлекаются векторным поиском и подмешиваются в системный контекст.
// ---------------------------------------------------------------------------

export const MAX_EXAMPLES_PER_DEAL = 40;

export interface OperatorPair {
  sourceMessageId?: string;
  userText: string;
  operatorText: string;
}

export interface SalesExampleDTO {
  id: string;
  dealId: string;
  customerQuery: string;
  agentReply: string;
  similarity?: number;
}

interface MessageRow {
  id?: string;
  source: string;
  sender_name?: string;
  content: string;
  created_at: Date | string;
}

interface DealRow {
  id: string;
  title: string;
  budget: number | null;
  contact_id: string | null;
  stage_id: string;
}

/**
 * Извлечение пар вопрос клиента -> ответ оператора из хронологической переписки.
 */
export function extractOperatorPairs(messages: MessageRow[]): OperatorPair[] {
  const pairs: OperatorPair[] = [];
  let lastUser: { text: string } | null = null;

  for (const m of messages) {
    const isCustomer = m.source === "customer" || m.source === "user";
    const isOperator = m.source === "manager" || m.source === "operator" || m.source === "assistant";

    if (isCustomer) {
      if (m.content.trim().length > 0) {
        lastUser = { text: m.content.trim() };
      }
      continue;
    }

    if (isOperator && lastUser !== null && m.content.trim().length > 0) {
      pairs.push({
        sourceMessageId: m.id,
        userText: lastUser.text.slice(0, 2000),
        operatorText: m.content.trim().slice(0, 2000),
      });
      lastUser = null;
    }
  }

  return pairs.slice(0, MAX_EXAMPLES_PER_DEAL);
}

export class SalesLearnService {
  constructor(
    private readonly embeddings: EmbeddingProvider = new GatewayEmbeddingProvider(),
    private readonly knowledge: KnowledgeBaseService = new KnowledgeBaseService(),
    private readonly log: {
      info: (obj: object, msg: string) => void;
      warn: (obj: object, msg: string) => void;
    } = {
      info: () => undefined,
      warn: () => undefined,
    },
  ) {}

  /**
   * Сбор опыта успешной сделки и индексация диалоговых пар.
   */
  async harvestWonDeal(input: {
    tenantId: string;
    dealId: string;
  }): Promise<{ pairsCount: number; examplesSaved: number }> {
    try {
      const deal = await queryOne<DealRow>(
        `SELECT id, title, budget, contact_id, stage_id
         FROM deals
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [input.tenantId, input.dealId],
      );

      if (deal === null) {
        return { pairsCount: 0, examplesSaved: 0 };
      }

      const messages = await query<MessageRow>(
        `SELECT id::text, source, sender_name, content, created_at
         FROM deal_messages
         WHERE tenant_id = $1 AND deal_id = $2
         ORDER BY created_at ASC`,
        [input.tenantId, input.dealId],
      );

      if (messages.length < 2) {
        return { pairsCount: 0, examplesSaved: 0 };
      }

      const pairs = extractOperatorPairs(messages);
      if (pairs.length === 0) {
        return { pairsCount: 0, examplesSaved: 0 };
      }

      // Векторизуем вопросы клиентов
      const queryTexts = pairs.map((p) => p.userText);
      let vectors: number[][] = [];
      try {
        const res = await this.embeddings.embed(queryTexts);
        vectors = res.vectors;
      } catch (err) {
        this.log.warn({ err }, "Embedding batch failed for won deal pairs, saving without vector");
      }

      let examplesSaved = 0;
      for (let i = 0; i < pairs.length; i += 1) {
        const pair = pairs[i];
        if (pair === undefined) continue;

        const vector = vectors[i];
        const vectorParam = vector !== undefined && vector.length > 0 ? `[${vector.join(",")}]` : null;

        await query(
          `INSERT INTO ai_sales_examples
             (tenant_id, deal_id, customer_query, agent_reply, embedding, source_message_id)
           VALUES ($1, $2, $3, $4, $5::vector, $6::uuid)`,
          [
            input.tenantId,
            input.dealId,
            pair.userText,
            pair.operatorText,
            vectorParam,
            pair.sourceMessageId ?? null,
          ],
        );
        examplesSaved += 1;
      }

      // Также регистрируем общий кейс в базе знаний агентов тенанта
      const filename = `deal-won-${input.dealId.slice(0, 8)}.md`;
      const transcript = pairs
        .map((p) => `Клиент: ${p.userText}\nМенеджер: ${p.operatorText}`)
        .join("\n\n");

      const experienceText = `
# Успешный опыт продажи: ${deal.title}
Бюджет сделки: ${deal.budget ? `${deal.budget} руб.` : "согласован"}
Результат: Успешно реализовано

## Успешные диалоговые пары:
${transcript}
`.trim();

      const agents = await query<{ id: string }>(
        `SELECT id FROM ai_agents
         WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [input.tenantId],
      );

      for (const agent of agents) {
        await this.knowledge
          .addDocument({
            tenantId: input.tenantId,
            agentId: agent.id,
            filename,
            mimeType: "text/markdown",
            text: experienceText,
          })
          .catch(() => undefined);
      }

      this.log.info(
        { tenantId: input.tenantId, dealId: input.dealId, examplesSaved },
        "Harvested won deal sales examples into vector store",
      );

      return { pairsCount: pairs.length, examplesSaved };
    } catch (error) {
      this.log.warn({ error, dealId: input.dealId }, "Failed to harvest won deal sales examples");
      return { pairsCount: 0, examplesSaved: 0 };
    }
  }

  /**
   * Поиск релевантных примеров успешных диалогов для подмешивания в системный контекст.
   */
  async findRelevantSalesExamples(input: {
    tenantId: string;
    query: string;
    limit?: number;
  }): Promise<SalesExampleDTO[]> {
    const limit = input.limit ?? 3;
    let vector: number[] = [];

    try {
      const res = await this.embeddings.embed([input.query]);
      vector = res.vectors[0] ?? [];
    } catch {
      return [];
    }

    if (vector.length === 0) return [];

    const vectorParam = `[${vector.join(",")}]`;

    const rows = await query<{
      id: string;
      deal_id: string;
      customer_query: string;
      agent_reply: string;
      distance: number;
    }>(
      `SELECT id, deal_id, customer_query, agent_reply,
              (embedding <=> $2::vector) AS distance
       FROM ai_sales_examples
       WHERE tenant_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding <=> $2::vector ASC
       LIMIT $3`,
      [input.tenantId, vectorParam, limit],
    );

    return rows.map((r) => ({
      id: r.id,
      dealId: r.deal_id,
      customerQuery: r.customer_query,
      agentReply: r.agent_reply,
      similarity: 1 - r.distance,
    }));
  }
}
