import { query, queryOne, runWithPlatformScope, runWithTenantContext } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { AgentPipelineService } from "../ai/agent-pipeline.service.js";
import { CrmPipelineService } from "../crm/crm-pipeline.service.js";

// ---------------------------------------------------------------------------
// Сервис публичного онлайн-чата на сайте (WebChat).
//
// Обслуживает посетителей клиентских сайтов, на которых установлен виджет.
// Посетитель идентифицируется по visitor_id (UUID в localStorage браузера).
// Все входящие сообщения регистрируются в CRM как контакты и сделки, а ответы
// генерируются подключенным AI-агентом или передаются оператору.
// ---------------------------------------------------------------------------

export interface WebchatAccountInfo {
  id: string;
  tenantId: string;
  label: string;
  tenantName: string;
  botName: string;
  isAiEnabled: boolean;
  status: string;
  accentColor?: string;
  theme?: "dark" | "light";
  title?: string;
  greeting?: string;
  placeholder?: string;
  position?: "bottom-right" | "bottom-left";
  telegramBot?: string;
  showTelegramBanner?: boolean;
  consultantName?: string;
  consultantAvatar?: string;
  avatarType?: "icon" | "photo" | "mascot";
  mascotId?: string;
}

interface ChannelAccountRow {
  id: string;
  tenant_id: string;
  label: string;
  status: string;
  external_id: string;
  credentials: Record<string, unknown> | null;
}

interface TenantRow {
  id: string;
  name: string;
}

interface AgentRow {
  id: string;
  name: string;
  status: string;
}

export interface WebchatMessageInput {
  channelAccountId: string;
  visitorId: string;
  text: string;
  senderName?: string;
  senderPhone?: string;
  pageUrl?: string;
  utmTags?: Record<string, string>;
  ymUid?: string;
  gaId?: string;
  visitCount?: number;
  pageHistory?: Array<{ step: number; time: string; url: string }>;
  isDraft?: boolean;
}

export interface WebchatMessageResult {
  dealId: string;
  contactId: string;
  replies: string[];
  status: "replied" | "queued" | "operator_needed" | "agent_unavailable";
}

export interface WebchatHistoryMessage {
  id: string;
  source: string;
  direction: string;
  senderName: string;
  content: string;
  createdAt: string;
}

export class WebchatService {
  private readonly crm = new CrmPipelineService();
  private readonly agentPipeline: AgentPipelineService;

  constructor(logger?: { info: (obj: object, msg: string) => void; warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void }) {
    const log = logger ?? {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    this.agentPipeline = new AgentPipelineService(log);
  }

  /**
   * Разрешает информацию об аккаунте веб-чата и связанном тенанте.
   * Выполняется в platform_scope, поскольку запрос приходит от неавторизованного посетителя сайта.
   */
  async resolveAccount(channelAccountId: string): Promise<WebchatAccountInfo> {
    const account = await runWithPlatformScope(() =>
      queryOne<ChannelAccountRow>(
        `SELECT id, tenant_id, label, status, external_id, credentials
         FROM channel_accounts
         WHERE id = $1
           AND channel = 'webchat'
           AND deleted_at IS NULL`,
        [channelAccountId],
      ),
    );

    if (account === null) {
      throw new NotFoundError("Аккаунт веб-чата не найден");
    }

    if (account.status === "disabled") {
      throw new AppError(403, "CHAT_DISABLED", "Чат временно отключен администратором");
    }

    const tenant = await runWithPlatformScope(() =>
      queryOne<TenantRow>(
        `SELECT id, name FROM tenants WHERE id = $1 AND deleted_at IS NULL`,
        [account.tenant_id],
      ),
    );

    const agent = await runWithPlatformScope(() =>
      queryOne<AgentRow>(
        `SELECT a.id, a.name, a.status
         FROM ai_agent_channel_bindings b
         JOIN ai_agents a ON a.id = b.agent_id
         WHERE b.tenant_id = $1
           AND b.channel_account_id = $2
           AND b.is_enabled = true
           AND a.deleted_at IS NULL
         ORDER BY a.created_at ASC
         LIMIT 1`,
        [account.tenant_id, account.id],
      ),
    );

    const creds = (account.credentials ?? {}) as Record<string, unknown>;

    return {
      id: account.id,
      tenantId: account.tenant_id,
      label: account.label,
      tenantName: tenant?.name ?? "Онлайн-консультант",
      botName: agent?.name ?? "AI-ассистент",
      isAiEnabled: agent !== null && agent.status === "active",
      status: account.status,
      accentColor: typeof creds.accentColor === "string" ? creds.accentColor : "#f59e0b",
      theme: creds.theme === "light" ? "light" : "dark",
      title: typeof creds.title === "string" && creds.title.trim().length > 0 ? creds.title.trim() : (tenant?.name ?? "Онлайн-консультант"),
      greeting: typeof creds.greeting === "string" && creds.greeting.trim().length > 0 ? creds.greeting.trim() : "Здравствуйте! Чем я могу вам помочь? Напишите ваш вопрос, и я сразу отвечу.",
      placeholder: typeof creds.placeholder === "string" ? creds.placeholder : "Введите ваш вопрос...",
      position: creds.position === "bottom-left" ? "bottom-left" : "bottom-right",
      telegramBot: typeof creds.telegramBot === "string" ? creds.telegramBot.replace(/^@/, "").trim() : undefined,
      showTelegramBanner: creds.showTelegramBanner !== false,
      consultantName: typeof creds.consultantName === "string" && creds.consultantName.trim().length > 0 ? creds.consultantName.trim() : undefined,
      consultantAvatar: typeof creds.consultantAvatar === "string" && creds.consultantAvatar.trim().length > 0 ? creds.consultantAvatar.trim() : undefined,
      avatarType: creds.avatarType === "mascot" || creds.avatarType === "photo" || creds.avatarType === "icon" ? creds.avatarType : (creds.consultantAvatar ? "photo" : "icon"),
      mascotId: typeof creds.mascotId === "string" ? creds.mascotId : "voxly_robot",
    };
  }

  /**
   * Обработка входящего сообщения от посетителя сайта.
   */
  async processIncomingMessage(input: WebchatMessageInput): Promise<WebchatMessageResult> {
    const account = await this.resolveAccount(input.channelAccountId);

    const text = input.text.trim();
    if (text.length === 0) {
      throw new AppError(400, "EMPTY_MESSAGE", "Текст сообщения не может быть пустым");
    }

    // Автоматическое определение номера телефона из текста, если не был передан явно
    let detectedPhone = input.senderPhone?.trim();
    if (!detectedPhone) {
      const phoneMatch = text.match(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/);
      if (phoneMatch) {
        const digits = phoneMatch[0].replace(/\D/g, "");
        if (digits.length === 11) {
          detectedPhone = `+7${digits.slice(1)}`;
        }
      }
    }

    // Формируем структурированный контекст для CRM и менеджеров
    const contextLines: string[] = [];
    if (input.isDraft) {
      contextLines.push("[Черновик / Неотправленное обращение]");
    }
    if (input.pageUrl) {
      contextLines.push(`[Страница: ${input.pageUrl}]`);
    }
    if (input.visitCount && input.visitCount > 1) {
      contextLines.push(`[Визит №${input.visitCount}]`);
    }
    if (input.utmTags && Object.keys(input.utmTags).length > 0) {
      const utmStr = Object.entries(input.utmTags)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      contextLines.push(`[UTM: ${utmStr}]`);
    }
    if (input.ymUid) {
      contextLines.push(`[YM ClientID: ${input.ymUid}]`);
    }
    if (input.gaId) {
      contextLines.push(`[GA ClientID: ${input.gaId}]`);
    }
    if (input.pageHistory && input.pageHistory.length > 1) {
      const historyStr = input.pageHistory.map((h) => h.url).join(" -> ");
      contextLines.push(`[История переходов: ${historyStr}]`);
    }

    const crmInboundText = contextLines.length > 0 ? `${contextLines.join("\n")}\n\n${text}` : text;

    const senderDisplayName =
      input.senderName && input.senderName.trim().length > 0
        ? input.senderName.trim()
        : `Посетитель сайта (${input.visitorId.slice(-4)})`;

    // 1. Создаем или находим контакт и сделку в CRM.
    const crmResult = await runWithTenantContext(account.tenantId, () =>
      this.crm.processIncoming({
        tenantId: account.tenantId,
        channel: "webchat",
        channelAccountId: account.id,
        chatId: input.visitorId,
        text: crmInboundText,
        senderName: senderDisplayName,
        senderPhone: detectedPhone || undefined,
      }),
    );

    // Если это неотправленный черновик (lead salvage) — фиксируем в CRM, но не шлем автоответ клиенту
    if (input.isDraft) {
      return {
        dealId: crmResult.dealId,
        contactId: crmResult.contactId,
        replies: [],
        status: "queued",
      };
    }

    // 2. Проверяем AI Handoff (если оператор перехватил диалог, бот временно на паузе)
    if (crmResult.dealId) {
      const isAiPaused = await runWithTenantContext(account.tenantId, async () => {
        const row = await queryOne<{ id: string }>(
          `SELECT id FROM deals
           WHERE tenant_id = $1 AND id = $2 AND ai_paused_until > now()
           LIMIT 1`,
          [account.tenantId, crmResult.dealId],
        );
        return row !== null;
      }).catch(() => false);

      if (isAiPaused) {
        return {
          dealId: crmResult.dealId,
          contactId: crmResult.contactId,
          replies: [],
          status: "operator_needed",
        };
      }
    }

    // 3. Вызываем AI-агента для генерации ответа.
    // Передаем агенту чистый вопрос и контекст текущей страницы для релевантного ответа
    const promptText = input.pageUrl ? `[Пользователь на странице: ${input.pageUrl}]\n${text}` : text;
    const outcome = await runWithTenantContext(account.tenantId, () =>
      this.agentPipeline.prepareReply({
        tenantId: account.tenantId,
        channelAccountId: account.id,
        chatId: input.visitorId,
        text: promptText,
      }),
    );

    // 3. Если агент сформировал ответ — сохраняем его в deal_messages.
    if (outcome.kind === "replied" && crmResult.dealId) {
      await runWithTenantContext(account.tenantId, () =>
        this.crm.saveAgentReply({
          tenantId: account.tenantId,
          dealId: crmResult.dealId,
          reply: outcome.reply,
          channel: "webchat",
          channelAccountId: account.id,
        }),
      );

      return {
        dealId: crmResult.dealId,
        contactId: crmResult.contactId,
        replies: outcome.reply.messages,
        status: "replied",
      };
    }

    return {
      dealId: crmResult.dealId,
      contactId: crmResult.contactId,
      replies: [],
      status: outcome.kind === "no_agent" || outcome.kind === "agent_paused" ? "operator_needed" : "agent_unavailable",
    };
  }

  /**
   * Получение истории переписки посетителя для восстановления чата.
   */
  async getHistory(channelAccountId: string, visitorId: string): Promise<WebchatHistoryMessage[]> {
    const account = await this.resolveAccount(channelAccountId);

    const rows = await runWithTenantContext(account.tenantId, () =>
      query<{
        id: string;
        source: string;
        direction: string;
        sender_name: string;
        content: string;
        created_at: Date | string;
      }>(
        `SELECT m.id, m.source, m.direction, m.sender_name, m.content, m.created_at
         FROM deal_messages m
         JOIN deals d ON d.id = m.deal_id
         JOIN contacts c ON c.id = d.contact_id
         WHERE m.tenant_id = $1
           AND m.channel_account_id = $2
           AND m.channel = 'webchat'
           AND c.socials @> $3::jsonb
           AND d.deleted_at IS NULL
         ORDER BY m.created_at ASC
         LIMIT 100`,
        [account.tenantId, account.id, JSON.stringify([{ kind: "other", value: visitorId }])],
      ),
    );

    return rows.map((r) => ({
      id: r.id,
      source: r.source,
      direction: r.direction,
      senderName: r.sender_name,
      content: r.content,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }
}
