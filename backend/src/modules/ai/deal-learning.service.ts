import { query, queryOne } from "../../db/client.js";
import { KnowledgeBaseService } from "./knowledge.service.js";

// ---------------------------------------------------------------------------
// Сервис самообучения AI-агентов на успешных сделках (Closed-Won Harvester).
//
// Когда менеджер или агент переводит сделку на этап «Успешно реализовано»
// (is_won = true), сервис извлекает переписку из deal_messages, выделяет
// успешные паттерны переговоров, векторизует их и сохраняет в базу знаний
// агентов тенанта. При последующих обращениях других клиентов эти примеры
// автоматически подмешиваются в системный промпт через RAG (Few-shot learning).
// ---------------------------------------------------------------------------

interface DealRow {
  id: string;
  title: string;
  budget: number | null;
  contact_id: string | null;
  stage_id: string;
}

interface MessageRow {
  source: string;
  sender_name: string;
  content: string;
  created_at: Date | string;
}

interface AgentRow {
  id: string;
  name: string;
}

export class DealLearningService {
  constructor(
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
   * Сбор опыта успешной сделки и пополнение базы знаний агентов.
   */
  async harvestWonDeal(input: { tenantId: string; dealId: string }): Promise<void> {
    try {
      // 1. Проверяем, не обучались ли мы на этой сделке ранее (защита от дублей)
      const filename = `deal-won-${input.dealId.slice(0, 8)}.md`;

      const existingDoc = await queryOne<{ id: string }>(
        `SELECT id FROM knowledge_base_documents
         WHERE tenant_id = $1 AND filename = $2
         LIMIT 1`,
        [input.tenantId, filename],
      );

      if (existingDoc !== null) {
        return;
      }

      const deal = await queryOne<DealRow>(
        `SELECT id, title, budget, contact_id, stage_id
         FROM deals
         WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [input.tenantId, input.dealId],
      );

      if (deal === null) return;

      // 2. Достаем историю сообщений
      const messages = await query<MessageRow>(
        `SELECT source, sender_name, content, created_at
         FROM deal_messages
         WHERE tenant_id = $1 AND deal_id = $2
         ORDER BY created_at ASC`,
        [input.tenantId, input.dealId],
      );

      // Учимся только если был реальный диалог с клиентом (минимум 2 сообщения)
      const hasCustomerMessage = messages.some((m) => m.source === "customer");
      if (messages.length < 2 || !hasCustomerMessage) {
        return;
      }

      // 3. Форматируем успешный кейс
      const transcript = messages
        .map((m) => {
          const role = m.source === "customer" ? "Клиент" : "Менеджер / Агент";
          return `${role} (${m.sender_name}): ${m.content.trim()}`;
        })
        .join("\n\n");

      const experienceText = `
# Успешный опыт продажи: ${deal.title}
Бюджет сделки: ${deal.budget ? `${deal.budget} руб.` : "согласован"}
Результат: Успешно реализовано

## Успешный диалог:
${transcript}

## Инструкция для AI:
При аналогичных вопросах или возражениях клиентов используй подход, аргументы и формулировки из этого успешного кейса.
`.trim();

      // 4. Находим активных агентов тенанта и добавляем им этот опыт в базу знаний
      const agents = await query<AgentRow>(
        `SELECT id, name FROM ai_agents
         WHERE tenant_id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [input.tenantId],
      );

      if (agents.length === 0) {
        return;
      }

      for (const agent of agents) {
        await this.knowledge
          .addDocument({
            tenantId: input.tenantId,
            agentId: agent.id,
            filename,
            mimeType: "text/markdown",
            text: experienceText,
          })
          .catch((err: unknown) => {
            this.log.warn({ err, agentId: agent.id }, "Failed to auto-add won deal knowledge chunk");
          });
      }

      this.log.info(
        { tenantId: input.tenantId, dealId: input.dealId, agentsCount: agents.length },
        "Harvested won deal experience into agent knowledge base",
      );
    } catch (error) {
      this.log.warn({ error, dealId: input.dealId }, "Deal learning harvester error (skipped)");
    }
  }
}
