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
  channel?: string;
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
   * Считает только активные (неудалённые) сделки и их реальные сообщения переписок из мессенджеров.
   */
  async getCrmStats(tenantId: string, agentId?: string): Promise<CrmKnowledgeStats> {
    let boundIds: string[] = [];
    if (agentId) {
      const boundChannels = await query<{ channel_account_id: string }>(
        `SELECT b.channel_account_id
         FROM ai_agent_channel_bindings b
         JOIN channel_accounts ca ON ca.id = b.channel_account_id
         WHERE b.tenant_id = $1 AND b.agent_id = $2 AND b.is_enabled = true AND ca.deleted_at IS NULL`,
        [tenantId, agentId],
      );
      boundIds = boundChannels.map((b) => b.channel_account_id);
    }

    let totalDealsRow: { count: string } | null = null;
    let wonDealsRow: { count: string } | null = null;
    let totalMessagesRow: { count: string } | null = null;
    let dealsWithMessagesRow: { count: string } | null = null;

    if (boundIds.length > 0) {
      totalDealsRow = await queryOne<{ count: string }>(
        `SELECT COUNT(DISTINCT d.id)::text AS count
         FROM deals d
         JOIN deal_messages dm ON dm.deal_id = d.id
         WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
           AND dm.channel != 'system'
           AND dm.channel_account_id = ANY($2::uuid[])`,
        [tenantId, boundIds],
      );

      wonDealsRow = await queryOne<{ count: string }>(
        `SELECT COUNT(DISTINCT d.id)::text AS count
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         JOIN deal_messages dm ON dm.deal_id = d.id
         WHERE d.tenant_id = $1 AND s.is_won = true AND d.deleted_at IS NULL
           AND dm.channel != 'system'
           AND dm.channel_account_id = ANY($2::uuid[])`,
        [tenantId, boundIds],
      );

      totalMessagesRow = await queryOne<{ count: string }>(
        `SELECT COUNT(dm.id)::text AS count
         FROM deal_messages dm
         JOIN deals d ON d.id = dm.deal_id
         WHERE dm.tenant_id = $1 AND d.deleted_at IS NULL
           AND dm.channel != 'system'
           AND dm.channel_account_id = ANY($2::uuid[])`,
        [tenantId, boundIds],
      );

      dealsWithMessagesRow = await queryOne<{ count: string }>(
        `SELECT COUNT(DISTINCT dm.deal_id)::text AS count
         FROM deal_messages dm
         JOIN deals d ON d.id = dm.deal_id
         WHERE dm.tenant_id = $1 AND d.deleted_at IS NULL
           AND dm.channel != 'system'
           AND dm.channel_account_id = ANY($2::uuid[])`,
        [tenantId, boundIds],
      );
    } else {
      totalDealsRow = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM deals
         WHERE tenant_id = $1 AND deleted_at IS NULL`,
        [tenantId],
      );

      wonDealsRow = await queryOne<{ count: string }>(
        `SELECT COUNT(d.id)::text AS count
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE d.tenant_id = $1 AND s.is_won = true AND d.deleted_at IS NULL`,
        [tenantId],
      );

      totalMessagesRow = await queryOne<{ count: string }>(
        `SELECT COUNT(dm.id)::text AS count
         FROM deal_messages dm
         JOIN deals d ON d.id = dm.deal_id
         WHERE dm.tenant_id = $1 AND d.deleted_at IS NULL
           AND dm.channel != 'system'`,
        [tenantId],
      );

      dealsWithMessagesRow = await queryOne<{ count: string }>(
        `SELECT COUNT(DISTINCT dm.deal_id)::text AS count
         FROM deal_messages dm
         JOIN deals d ON d.id = dm.deal_id
         WHERE dm.tenant_id = $1 AND d.deleted_at IS NULL
           AND dm.channel != 'system'`,
        [tenantId],
      );
    }

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
    // 0. Проверяем привязанные активные каналы агента для изоляции обучения (Phuket vs Bali)
    const boundChannels = await query<{ channel_account_id: string }>(
      `SELECT b.channel_account_id
       FROM ai_agent_channel_bindings b
       JOIN channel_accounts ca ON ca.id = b.channel_account_id
       WHERE b.tenant_id = $1 AND b.agent_id = $2 AND b.is_enabled = true AND ca.deleted_at IS NULL`,
      [tenantId, agentId],
    );
    const boundIds = boundChannels.map((b) => b.channel_account_id);

    // 1. Извлекаем до 30 успешных сделок (с приоритетом по привязанным каналам)
    let wonDeals: DealRow[] = [];
    if (boundIds.length > 0) {
      wonDeals = await query<DealRow>(
        `SELECT DISTINCT d.id, d.title, d.budget, s.name AS stage_name, d.created_at
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         JOIN deal_messages dm ON dm.deal_id = d.id
         WHERE d.tenant_id = $1 AND s.is_won = true AND d.deleted_at IS NULL
           AND dm.channel_account_id = ANY($2::uuid[])
         ORDER BY d.created_at DESC
         LIMIT 30`,
        [tenantId, boundIds],
      );
    }

    if (wonDeals.length === 0) {
      wonDeals = await query<DealRow>(
        `SELECT d.id, d.title, d.budget, s.name AS stage_name, d.created_at
         FROM deals d
         JOIN stages s ON s.id = d.stage_id
         WHERE d.tenant_id = $1 AND s.is_won = true AND d.deleted_at IS NULL
         ORDER BY d.created_at DESC
         LIMIT 30`,
        [tenantId],
      );
    }

    let dealsToAnalyze = wonDeals;
    if (dealsToAnalyze.length === 0) {
      // Фолбэк: если прямо отмеченных won нет, берем сделки, где есть переписка
      if (boundIds.length > 0) {
        dealsToAnalyze = await query<DealRow>(
          `SELECT DISTINCT d.id, d.title, d.budget, s.name AS stage_name, d.created_at
           FROM deals d
           JOIN stages s ON s.id = d.stage_id
           JOIN deal_messages dm ON dm.deal_id = d.id
           WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
             AND dm.channel_account_id = ANY($2::uuid[])
           ORDER BY d.created_at DESC
           LIMIT 20`,
          [tenantId, boundIds],
        );
      }

      if (dealsToAnalyze.length === 0) {
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
    }

    if (dealsToAnalyze.length === 0) {
      throw new Error("В CRM пока нет сделок с историей сообщений для анализа");
    }

    const dealIds = dealsToAnalyze.map((d) => d.id);
    let messages: MessageRow[] = [];
    if (boundIds.length > 0) {
      messages = await query<MessageRow>(
        `SELECT deal_id, source, sender_name, content, created_at, channel
         FROM deal_messages
         WHERE tenant_id = $1 AND deal_id = ANY($2::uuid[])
           AND channel != 'system'
           AND (channel_account_id = ANY($3::uuid[]) OR channel_account_id IS NULL)
         ORDER BY deal_id, created_at ASC`,
        [tenantId, dealIds, boundIds],
      );
      if (messages.length === 0) {
        messages = await query<MessageRow>(
          `SELECT deal_id, source, sender_name, content, created_at, channel
           FROM deal_messages
           WHERE tenant_id = $1 AND deal_id = ANY($2::uuid[])
             AND channel != 'system'
           ORDER BY deal_id, created_at ASC`,
          [tenantId, dealIds],
        );
      }
    } else {
      messages = await query<MessageRow>(
        `SELECT deal_id, source, sender_name, content, created_at, channel
         FROM deal_messages
         WHERE tenant_id = $1 AND deal_id = ANY($2::uuid[])
           AND channel != 'system'
         ORDER BY deal_id, created_at ASC`,
        [tenantId, dealIds],
      );
    }

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
        const ch = m.channel ? `[${m.channel.toUpperCase()}] ` : "";
        contextText += `${ch}${role} (${m.sender_name}): ${m.content.trim()}\n`;
      }
    }

    // Ограничиваем объём контекста (до 80 000 символов)
    const truncated = contextText.slice(0, 80_000);

    // 2. Отправляем в LLM через GatewayChatProvider
    const systemPrompt = `Ты — ведущий AI-аналитик продаж и бизнес-процессов CRM платформы GETVOXLY.
Твоя задача: детально проанализировать реальные успешные диалоги и сделки компании из всех подключенных каналов (Telegram, WhatsApp, MAX, онлайн-чат на сайте) и сгенерировать 3 структурированных документа для базы знаний AI-консультанта.

Требования:
1. Выдели все упомянутые услуги, товары, цены, тарифы, стоимость работ и скидки.
2. Собери частые вопросы клиентов и лучшие ответы менеджеров (FAQ), приведшие к покупке.
3. Извлеки скрипты продаж: как менеджеры здороваются, выявляют потребность, отрабатывают возражения (дорого, подумаю, нет времени) и дожимают до сделки в переписках (Telegram, WhatsApp, MAX, онлайн-чат).

ФОРМАТ ОТВЕТА — СТРОГО ВАЛИДНЫЙ JSON БЕЗ РАЗМЕТКИ И БЕЗ \`\`\`json:
{
  "priceList": "Подробный Markdown-документ: Прайс и услуги компании...",
  "faq": "Подробный Markdown-документ: Частые вопросы и ответы (FAQ)...",
  "salesScripts": "Подробный Markdown-документ: Золотые скрипты и фразы-крючки менеджеров..."
}`;

    const completion = await this.chatProvider.complete({
      model: "glm-4.5",
      fallbackModels: ["qwen3.8-27b", "gemini-3.5-flash", "gemini-3.5-flash-lite"],
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
      tenantId,
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

  /**
   * Синтез структурированного паспорта компании (Company Summary) из документов базы знаний.
   * Анализирует все загруженные материалы агента и готовит черновик паспорта компании для утверждения.
   */
  async synthesizeCompanyProfile(input: {
    tenantId: string;
    agentId: string;
    customText?: string;
  }): Promise<{
    summary: string;
    isApproved: boolean;
    documentsCount: number;
  }> {
    const { tenantId, agentId, customText } = input;

    // 1. Получаем данные агента и тенанта
    const agent = await queryOne<{
      id: string;
      name: string;
      company_name_override: string | null;
      target_page_url: string | null;
      company_profile_summary: string | null;
      company_profile_approved: boolean;
      wizard_config: Record<string, unknown> | null;
    }>(
      `SELECT id, name, company_name_override, target_page_url, company_profile_summary, company_profile_approved, wizard_config
       FROM ai_agents
       WHERE id = $1 AND tenant_id = $2`,
      [agentId, tenantId],
    );

    if (!agent) {
      throw new Error("Агент не найден");
    }

    const tenant = await queryOne<{ name: string }>(
      `SELECT name FROM tenants WHERE id = $1`,
      [tenantId],
    );

    const fallbackCompanyName =
      agent.company_name_override?.trim() ||
      tenant?.name?.trim() ||
      "Компания";

    // 2. Собираем тексты документов агента
    const docs = await query<{ id: string; filename: string; content_text: string }>(
      `SELECT id, filename, content_text
       FROM knowledge_base_documents
       WHERE tenant_id = $1 AND agent_id = $2 AND status != 'failed'
       ORDER BY created_at DESC
       LIMIT 15`,
      [tenantId, agentId],
    );

    let aggregatedText = "";
    if (customText && customText.trim().length > 0) {
      aggregatedText += `\n\n=== ПОЛЬЗОВАТЕЛЬСКИЕ МАТЕРИАЛЫ / САЙТ ===\n${customText.trim()}`;
    }

    for (const doc of docs) {
      if (doc.content_text && doc.content_text.trim().length > 0) {
        aggregatedText += `\n\n=== ДОКУМЕНТ: ${doc.filename} ===\n${doc.content_text.trim().slice(0, 15_000)}`;
      }
    }

    // Ограничиваем общий контекст до 60 000 символов
    const contextSlice = aggregatedText.trim().slice(0, 60_000);

    const systemPrompt = `Ты — ведущий AI-архитектор баз знаний платформы GETVOXLY.
Твоя задача — проанализировать все предоставленные материалы компании (документы, прайсы, регламенты, КП, сайт) и составить единый структурированный «Паспорт компании» в формате Markdown.

ВАЖНЕЙШЕЕ ТРЕБОВАНИЕ БЕЗОПАСНОСТИ:
Если в документах встречаются несколько названий юрлиц (например, старые КП на бланках субподрядчиков или прошлые ИП), выдели ОСНОВНОЙ бренд компании («${fallbackCompanyName}»), а сторонние реквизиты либо исключи, либо четко укажи.

СТРОГАЯ СТРУКТУРА ПАСПОРТА В MARKDOWN:
# Паспорт компании: [Основное название / Бренд]

## 1. О компании и специализация
- Официальное и разговорное название бренда
- Сфера деятельности и ключевое позиционирование
- Основные направления работы

## 2. Услуги и продуктовая линейка
- Список основных услуг и товаров с понятным описанием

## 3. Прайс-лист, тарифы и порядок оплаты
- Базовые цены, вилки стоимостей или порядок расчета сметы
- Условия оплаты, предоплаты или рассрочки (если есть)

## 4. График работы, география и адреса
- Города обслуживания, адреса офисов / филиалов
- Часы и дни работы

## 5. Контакты и каналы связи
- Телефоны, мессенджеры, способы связи

## 6. Юридические реквизиты
- ИНН, ОГРН, форма юрлица (если указаны в документах)

## 7. Регламент и ограничения консультанта
- Что консультант ОБЯЗАН предлагать (целевое действие)
- Чего консультант КАТЕГОРИЧЕСКИ НЕ ИМЕЕТ ПРАВА обещать или называть

Ответ верни СТРОГО чистым Markdown без преамбул и без разметки кодовых блоков.`;

    const userPrompt = contextSlice.length > 50
      ? `Вот материалы компании:\n${contextSlice}\n\nСформируй полный Паспорт компании по указанной структуре.`
      : `Компания: ${fallbackCompanyName}. Материалы пока не загружены. Сформируй базовый шаблон Паспорта компании с плейсхолдерами для заполнения.`;

    const completion = await this.chatProvider.complete({
      model: "glm-4.5",
      fallbackModels: ["qwen3.8-27b", "gemini-3.5-flash", "gemini-3.5-flash-lite"],
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      maxTokens: 4000,
      tenantId,
    });

    const summary = completion.content
      .replace(/^```[a-z]*\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    // Сохраняем черновик паспорта (не утвержденный)
    await query(
      `UPDATE ai_agents
       SET company_profile_summary = $1,
           company_profile_approved = false,
           updated_at = now()
       WHERE id = $2 AND tenant_id = $3`,
      [summary, agentId, tenantId],
    );

    return {
      summary,
      isApproved: false,
      documentsCount: docs.length,
    };
  }

  /**
   * Утверждение паспорта компании пользователем (Human-in-the-loop).
   */
  async approveCompanyProfile(input: {
    tenantId: string;
    agentId: string;
    summary: string;
  }): Promise<{
    success: boolean;
    summary: string;
    approvedAt: Date;
  }> {
    const { tenantId, agentId, summary } = input;
    const now = new Date();

    await query(
      `UPDATE ai_agents
       SET company_profile_summary = $1,
           company_profile_approved = true,
           company_profile_approved_at = $2,
           updated_at = now()
       WHERE id = $3 AND tenant_id = $4`,
      [summary.trim(), now, agentId, tenantId],
    );

    return {
      success: true,
      summary: summary.trim(),
      approvedAt: now,
    };
  }
}

export const knowledgeSynthesizerService = new KnowledgeSynthesizerService();
