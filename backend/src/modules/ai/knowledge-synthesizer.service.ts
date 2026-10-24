import { query, queryOne } from "../../db/client.js";
import { GatewayChatProvider, type ChatProvider } from "../../services/chat.service.js";
import { KnowledgeBaseService } from "./knowledge.service.js";
import { parseWhatsAppChat } from "./whatsapp-parser.js";

export interface CrmKnowledgeStats {
  totalDeals: number;
  wonDeals: number;
  totalMessages: number;
  dealsWithMessages: number;
  isAvailable: boolean;
}

interface DealRow {
  id: string;
  title: string;
  budget: number | null;
  stage_name: string;
  created_at: Date | string;
}

interface MessageRow {
  deal_id: string;
  source: string;
  sender_name: string;
  content: string;
  created_at: Date | string;
}

export class KnowledgeSynthesizerService {
  constructor(
    private readonly chatProvider: ChatProvider = new GatewayChatProvider(),
    private readonly knowledgeService: KnowledgeBaseService = new KnowledgeBaseService(),
    private readonly log: {
      info: (obj: object, msg: string) => void;
      warn: (obj: object, msg: string) => void;
      error: (obj: object, msg: string) => void;
    } = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  ) {}

  /**
   * Получение статистики по CRM для показа виджета «Теплый старт».
   */
  async getCrmStats(tenantId: string): Promise<CrmKnowledgeStats> {
    const totalDealsRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM deals WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantId],
    );

    const wonDealsRow = await queryOne<{ count: string }>(
      `SELECT COUNT(d.id)::text AS count
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1 AND s.is_won = true AND d.deleted_at IS NULL`,
      [tenantId],
    );

    const totalMessagesRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM deal_messages WHERE tenant_id = $1`,
      [tenantId],
    );

    const dealsWithMessagesRow = await queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT deal_id)::text AS count FROM deal_messages WHERE tenant_id = $1`,
      [tenantId],
    );

    const totalDeals = Number(totalDealsRow?.count ?? 0);
    const wonDeals = Number(wonDealsRow?.count ?? 0);
    const totalMessages = Number(totalMessagesRow?.count ?? 0);
    const dealsWithMessages = Number(dealsWithMessagesRow?.count ?? 0);

    return {
      totalDeals,
      wonDeals,
      totalMessages,
      dealsWithMessages,
      isAvailable: wonDeals > 0 || totalMessages > 5,
    };
  }

  /**
   * Синтез базы знаний из успешных сделок и переписок CRM.
   */
  async synthesizeFromCrm(
    tenantId: string,
    agentId: string,
  ): Promise<{
    documentsCreated: number;
    dealsAnalyzed: number;
    messagesAnalyzed: number;
  }> {
    // 1. Извлекаем до 30 успешных сделок (или любых активных, если выигранных мало)
    const wonDeals = await query<DealRow>(
      `SELECT d.id, d.title, d.budget, s.name AS stage_name, d.created_at
       FROM deals d
       JOIN stages s ON s.id = d.stage_id
       WHERE d.tenant_id = $1 AND s.is_won = true AND d.deleted_at IS NULL
       ORDER BY d.created_at DESC
       LIMIT 30`,
      [tenantId],
    );

    let dealsToAnalyze = wonDeals;
    if (dealsToAnalyze.length === 0) {
      // Фолбэк: если прямо отмеченных won нет, берем сделки, где есть переписка
      dealsToAnalyze = await query<DealRow>(
        `SELECT DISTINCT d.id, d.title, d.budget, s.name AS stage_name, d.created_at
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         JOIN deal_messages dm ON dm.deal_id = d.id
         WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
         ORDER BY d.created_at DESC
         LIMIT 20`,
        [tenantId],
      );
    }

    if (dealsToAnalyze.length === 0) {
      throw new Error("В CRM пока нет сделок с историей сообщений для анализа");
    }

    const dealIds = dealsToAnalyze.map((d) => d.id);
    const messages = await query<MessageRow>(
      `SELECT deal_id, source, sender_name, content, created_at
       FROM deal_messages
       WHERE tenant_id = $1 AND deal_id = ANY($2::uuid[])
       ORDER BY deal_id, created_at ASC`,
      [tenantId, dealIds],
    );

    if (messages.length === 0) {
      throw new Error("В сделках CRM не найдено сообщений для обучения");
    }

    // Группируем сообщения по сделкам
    const dealMap = new Map<string, MessageRow[]>();
    for (const msg of messages) {
      const list = dealMap.get(msg.deal_id) ?? [];
      list.push(msg);
      dealMap.set(msg.deal_id, list);
    }

    // Собираем текст транскриптов
    let contextText = "";
    for (const deal of dealsToAnalyze) {
      const msgs = dealMap.get(deal.id);
      if (!msgs || msgs.length === 0) continue;

      contextText += `\n\n=== СДЕЛКА: ${deal.title} (Бюджет: ${deal.budget ? `${deal.budget} руб.` : "не указан"}, Этап: ${deal.stage_name}) ===\n`;
      for (const m of msgs) {
        const role = m.source === "customer" || m.source === "user" ? "Клиент" : "Менеджер";
        contextText += `${role} (${m.sender_name}): ${m.content.trim()}\n`;
      }
    }

    // Ограничиваем объём контекста (до 80 000 символов)
    const truncated = contextText.slice(0, 80_000);

    // 2. Отправляем в LLM через GatewayChatProvider
    const systemPrompt = `Ты — ведущий AI-аналитик продаж и бизнес-процессов CRM платформы GETVOXLY.
Твоя задача: детально проанализировать реальные успешные диалоги и сделки компании и сгенерировать 3 структурированных документа для базы знаний AI-консультанта.

Требования:
1. Выдели все упомянутые услуги, товары, цены, тарифы, стоимость работ и скидки.
2. Собери частые вопросы клиентов и лучшие ответы менеджеров (FAQ), приведшие к покупке.
3. Извлеки скрипты продаж: как менеджеры здороваются, выявляют потребность, отрабатывают возражения (дорого, подумаю, нет времени) и дожимают до сделки.

ФОРМАТ ОТВЕТА — СТРОГО ВАЛИДНЫЙ JSON БЕЗ РАЗМЕТКИ И БЕЗ \`\`\`json:
{
  "priceList": "Подробный Markdown-документ: Прайс и услуги компании...",
  "faq": "Подробный Markdown-документ: Частые вопросы и ответы (FAQ)...",
  "salesScripts": "Подробный Markdown-документ: Золотые скрипты и фразы-крючки менеджеров..."
}`;

    const completion = await this.chatProvider.complete({
      model: "gemini-3.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Вот реальные сделки и диалоги компании:\n${truncated}\n\nСформируй 3 документа базы знаний в формате JSON.`,
        },
      ],
      temperature: 0.3,
      maxTokens: 4000,
      jsonMode: true,
    });

    let parsed: { priceList?: string; faq?: string; salesScripts?: string } = {};
    try {
      const cleaned = completion.content.trim().replace(/^```json/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Не удалось разобрать структурированный ответ от нейросети");
    }

    let documentsCreated = 0;

    // 3. Сохраняем 3 документа в базу знаний
    if (parsed.priceList && parsed.priceList.trim().length > 20) {
      await this.knowledgeService.addDocument({
        tenantId,
        agentId,
        filename: "[CRM] Прайс и услуги из сделок.md",
        mimeType: "text/markdown",
        text: parsed.priceList.trim(),
      });
      documentsCreated++;
    }

    if (parsed.faq && parsed.faq.trim().length > 20) {
      await this.knowledgeService.addDocument({
        tenantId,
        agentId,
        filename: "[CRM] Частые вопросы и ответы (FAQ).md",
        mimeType: "text/markdown",
        text: parsed.faq.trim(),
      });
      documentsCreated++;
    }

    if (parsed.salesScripts && parsed.salesScripts.trim().length > 20) {
      await this.knowledgeService.addDocument({
        tenantId,
        agentId,
        filename: "[CRM] Золотые скрипты продаж.md",
        mimeType: "text/markdown",
        text: parsed.salesScripts.trim(),
      });
      documentsCreated++;
    }

    this.log.info(
      { tenantId, agentId, documentsCreated, deals: dealsToAnalyze.length },
      "Synthesized knowledge from CRM deals",
    );

    return {
      documentsCreated,
      dealsAnalyzed: dealsToAnalyze.length,
      messagesAnalyzed: messages.length,
    };
  }

  /**
   * Синтез базы знаний из текстового экспорта WhatsApp (_chat.txt).
   */
  async synthesizeFromWhatsApp(
    tenantId: string,
    agentId: string,
    rawText: string,
    sourceFileName: string = "WhatsApp-чат.txt",
  ): Promise<{
    documentsCreated: number;
    participants: string[];
    messagesAnalyzed: number;
  }> {
    const parsedChat = parseWhatsAppChat(rawText);

    if (parsedChat.filteredMessages < 2) {
      throw new Error(
        "В загруженном файле не найдено сообщений переписки WhatsApp. Убедитесь, что это текстовый экспорт чата (_chat.txt).",
      );
    }

    const truncated = parsedChat.dialogTranscript.slice(0, 90_000);

    const systemPrompt = `Ты — ведущий бизнес-аналитик GETVOXLY.
Компания предоставила текстовый экспорт переписок из мессенджера WhatsApp (участники: ${parsedChat.participants.join(", ")}).
Твоя задача — извлечь из переписок полную и полезную базу знаний для AI-сотрудника.

Требования:
1. "priceList": все товары, услуги, цены, стоимость доставки, залогов, диагностики и работ.
2. "faq": вопросы клиентов (сроки, гарантия, способы оплаты, как проехать) и реальные ответы.
3. "salesScripts": Tone of Voice (голос бренда — как компания общается с клиентами), удачные фразы, условия работы.

ФОРМАТ ОТВЕТА — СТРОГО ВАЛИДНЫЙ JSON БЕЗ РАЗМЕТКИ И БЕЗ \`\`\`json:
{
  "priceList": "Подробный Markdown: Прайс и услуги из WhatsApp...",
  "faq": "Подробный Markdown: Частые вопросы клиентов (FAQ)...",
  "salesScripts": "Подробный Markdown: Тон общения и скрипты..."
}`;

    const completion = await this.chatProvider.complete({
      model: "gemini-3.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Вот расшифровка диалогов WhatsApp:\n\n${truncated}\n\nСформируй 3 документа базы знаний в формате JSON.`,
        },
      ],
      temperature: 0.3,
      maxTokens: 4000,
      jsonMode: true,
    });

    let parsed: { priceList?: string; faq?: string; salesScripts?: string } = {};
    try {
      const cleaned = completion.content.trim().replace(/^```json/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error("Не удалось разобрать структурированный ответ от нейросети");
    }

    let documentsCreated = 0;
    const baseName = sourceFileName.replace(/\.[^/.]+$/, "").replace(/^_chat/i, "WhatsApp-чат");

    if (parsed.priceList && parsed.priceList.trim().length > 20) {
      await this.knowledgeService.addDocument({
        tenantId,
        agentId,
        filename: `[WhatsApp] ${baseName} — Прайс и услуги.md`,
        mimeType: "text/markdown",
        text: parsed.priceList.trim(),
      });
      documentsCreated++;
    }

    if (parsed.faq && parsed.faq.trim().length > 20) {
      await this.knowledgeService.addDocument({
        tenantId,
        agentId,
        filename: `[WhatsApp] ${baseName} — Вопросы и ответы (FAQ).md`,
        mimeType: "text/markdown",
        text: parsed.faq.trim(),
      });
      documentsCreated++;
    }

    if (parsed.salesScripts && parsed.salesScripts.trim().length > 20) {
      await this.knowledgeService.addDocument({
        tenantId,
        agentId,
        filename: `[WhatsApp] ${baseName} — Тон общения и скрипты.md`,
        mimeType: "text/markdown",
        text: parsed.salesScripts.trim(),
      });
      documentsCreated++;
    }

    return {
      documentsCreated,
      participants: parsedChat.participants,
      messagesAnalyzed: parsedChat.filteredMessages,
    };
  }
}

export const knowledgeSynthesizerService = new KnowledgeSynthesizerService();
