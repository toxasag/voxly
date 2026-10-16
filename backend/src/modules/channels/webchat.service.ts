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
}

interface ChannelAccountRow {
  id: string;
  tenant_id: string;
  label: string;
  status: string;
  external_id: string;
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
        `SELECT id, tenant_id, label, status, external_id
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

    return {
      id: account.id,
      tenantId: account.tenant_id,
      label: account.label,
      tenantName: tenant?.name ?? "Онлайн-консультант",
      botName: agent?.name ?? "AI-ассистент",
      isAiEnabled: agent !== null && agent.status === "active",
      status: account.status,
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
        text: input.pageUrl ? `[Страница: ${input.pageUrl}]\n${text}` : text,
        senderName: senderDisplayName,
        senderPhone: input.senderPhone?.trim() || undefined,
      }),
    );

    // 2. Вызываем AI-агента для генерации ответа.
    const outcome = await runWithTenantContext(account.tenantId, () =>
      this.agentPipeline.prepareReply({
        tenantId: account.tenantId,
        channelAccountId: account.id,
        chatId: input.visitorId,
        text,
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
