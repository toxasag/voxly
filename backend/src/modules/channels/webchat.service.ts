import { getEnv } from "../../config/env.js";
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

export interface WebchatMessengerButton {
  type: "telegram" | "whatsapp" | "max";
  label: string;
  url: string;
  handle?: string;
}

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
  showMessengerBanner?: boolean;
  messengerBannerMode?: "single" | "multi";
  singleTarget?: "telegram" | "whatsapp" | "max";
  messengerButtons?: WebchatMessengerButton[];
  telegramBot?: string;
  showTelegramBanner?: boolean;
  whatsappPhone?: string;
  maxLink?: string;
  consultantName?: string;
  consultantAvatar?: string;
  avatarType?: "icon" | "photo" | "mascot";
  mascotId?: string;
  customMascotDirections?: string;
  customMascotReactions?: string;
  proactiveEnabled?: boolean;
  proactiveDelaySeconds?: number;
  proactiveMessage?: string;
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
  senderEmail?: string;
  attachment?: string;
  attachmentType?: string;
  pageUrl?: string;
  referrer?: string;
  utmTags?: Record<string, string>;
  clickIds?: Record<string, string>;
  analytics?: Record<string, string | null>;
  deviceFingerprint?: string;
  deviceInfo?: Record<string, unknown>;
  clientIp?: string;
  userAgent?: string;
  ymUid?: string;
  gaId?: string;
  fbId?: string;
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
  attachment?: string | null;
  attachmentType?: string | null;
  createdAt: string;
}

function parseUserAgent(ua: string) {
  let os = "Неизвестно";
  if (/windows/i.test(ua)) os = "Windows";
  else if (/macintosh|mac os x/i.test(ua)) os = "macOS";
  else if (/iphone|ipad|ipod/i.test(ua)) os = "iOS";
  else if (/android/i.test(ua)) os = "Android";
  else if (/linux/i.test(ua)) os = "Linux";

  let browser = "Неизвестно";
  if (/yabrowser/i.test(ua)) browser = "Яндекс.Браузер";
  else if (/edg/i.test(ua)) browser = "Microsoft Edge";
  else if (/chrome|crios/i.test(ua)) browser = "Google Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";
  else if (/opera|opr/i.test(ua)) browser = "Opera";

  let deviceType: "desktop" | "mobile" | "tablet" = "desktop";
  if (/mobile|iphone|ipod|android.*mobile/i.test(ua)) deviceType = "mobile";
  else if (/ipad|tablet|android(?!.*mobile)/i.test(ua)) deviceType = "tablet";

  return { os, browser, deviceType };
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
        `SELECT id, name FROM tenants WHERE id = $1`,
        [account.tenant_id],
      ),
    );

    let agent = await runWithPlatformScope(() =>
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

    // Fallback: если нет привязки в ai_agent_channel_bindings, но в тенанте есть активный бот
    if (!agent) {
      agent = await runWithPlatformScope(() =>
        queryOne<AgentRow>(
          `SELECT a.id, a.name, a.status
           FROM ai_agents a
           WHERE a.tenant_id = $1
             AND a.status = 'active'
             AND a.mode = 'autoreply'
             AND a.deleted_at IS NULL
           ORDER BY a.created_at ASC
           LIMIT 1`,
          [account.tenant_id],
        ),
      );
    }

    const creds = (account.credentials ?? {}) as Record<string, unknown>;

    // Мессенджеры (Telegram, WhatsApp, MAX)
    const showMessengerBanner = creds.showMessengerBanner !== undefined
      ? Boolean(creds.showMessengerBanner)
      : (creds.showTelegramBanner !== undefined ? Boolean(creds.showTelegramBanner) : true);

    const messengerBannerMode = creds.messengerBannerMode === "multi" ? "multi" : "single";
    const singleTarget = creds.singleTarget === "whatsapp" || creds.singleTarget === "max" ? creds.singleTarget : "telegram";

    const rawTg = typeof creds.telegramBot === "string" ? creds.telegramBot.trim() : "";
    const rawWa = typeof creds.whatsappPhone === "string" ? creds.whatsappPhone.trim() : "";
    const rawMax = typeof creds.maxLink === "string" ? creds.maxLink.trim() : "";

    const tgEnabled = creds.telegramEnabled !== undefined
      ? Boolean(creds.telegramEnabled)
      : (Boolean(creds.showTelegramBanner) || Boolean(rawTg));

    const waEnabled = Boolean(creds.whatsappEnabled);
    const maxEnabled = Boolean(creds.maxEnabled);

    const messengerButtons: WebchatMessengerButton[] = [];

    if (rawTg && (messengerBannerMode === "multi" ? tgEnabled : singleTarget === "telegram")) {
      const clean = rawTg.replace(/^https?:\/\/t\.me\//, "").replace(/^@/, "");
      messengerButtons.push({
        type: "telegram",
        label: "Telegram",
        url: `https://t.me/${clean}`,
        handle: `@${clean}`,
      });
    }

    let resolvedWaPhone = rawWa;
    const waAccId = typeof creds.whatsappAccountId === "string" ? creds.whatsappAccountId : "";
    if (waAccId || (rawWa && rawWa.replace(/\D/g, "").length < 10)) {
      const waAccount = await runWithPlatformScope(() =>
        queryOne<ChannelAccountRow>(
          `SELECT id, tenant_id, label, status, external_id, credentials
           FROM channel_accounts
           WHERE tenant_id = $1
             AND channel = 'whatsapp'
             AND deleted_at IS NULL
             AND (
               id = $2::uuid
               OR external_id = $3
               OR credentials->>'instanceName' = $3
             )
           LIMIT 1`,
          [account.tenant_id, waAccId && waAccId.length === 36 ? waAccId : "00000000-0000-0000-0000-000000000000", rawWa],
        ),
      );
      if (waAccount) {
        const waCreds = (waAccount.credentials ?? {}) as Record<string, unknown>;
        const cand = String(waCreds.phone || waCreds.ownerJid || waAccount.external_id || "");
        if (cand.replace(/\D/g, "").length >= 10) {
          resolvedWaPhone = cand;
        }
      }
    }

    if (resolvedWaPhone && (messengerBannerMode === "multi" ? waEnabled : singleTarget === "whatsapp")) {
      let waDigits = resolvedWaPhone.replace(/\D/g, "");
      if (waDigits.length === 11 && waDigits.startsWith("8")) waDigits = "7" + waDigits.slice(1);
      if (waDigits.length >= 10) {
        const waUrl = `https://wa.me/${waDigits}`;
        messengerButtons.push({
          type: "whatsapp",
          label: "WhatsApp",
          url: waUrl,
          handle: resolvedWaPhone.startsWith("+") ? resolvedWaPhone : `+${waDigits}`,
        });
      }
    }

    if (rawMax && (messengerBannerMode === "multi" ? maxEnabled : singleTarget === "max")) {
      let maxUrl = rawMax;
      if (!maxUrl.startsWith("http")) {
        const clean = maxUrl.replace(/^@/, "");
        if (/^\d+$/.test(clean)) {
          const defaultBot = getEnv().MAX_BOT_USERNAME || "id505030516451_bot";
          maxUrl = `https://max.ru/${defaultBot}`;
        } else {
          maxUrl = `https://max.ru/${clean}`;
        }
      }
      messengerButtons.push({
        type: "max",
        label: "MAX",
        url: maxUrl,
        handle: rawMax,
      });
    }

    const proactiveEnabled = Boolean(creds.proactiveEnabled);
    const proactiveDelaySeconds =
      typeof creds.proactiveDelaySeconds === "number" && creds.proactiveDelaySeconds > 0
        ? creds.proactiveDelaySeconds
        : (typeof creds.proactiveDelaySeconds === "string" && parseInt(creds.proactiveDelaySeconds, 10) > 0
            ? parseInt(creds.proactiveDelaySeconds, 10)
            : 10);
    const proactiveMessage =
      typeof creds.proactiveMessage === "string" && creds.proactiveMessage.trim().length > 0
        ? creds.proactiveMessage.trim()
        : "Здравствуйте! Я онлайн, спрашивайте — готов вам помочь.";

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
      showMessengerBanner,
      messengerBannerMode,
      singleTarget,
      messengerButtons,
      telegramBot: rawTg ? rawTg.replace(/^@/, "") : undefined,
      showTelegramBanner: showMessengerBanner && messengerButtons.some((b) => b.type === "telegram"),
      whatsappPhone: rawWa || undefined,
      maxLink: rawMax || undefined,
      consultantName: typeof creds.consultantName === "string" && creds.consultantName.trim().length > 0 ? creds.consultantName.trim() : undefined,
      consultantAvatar: typeof creds.consultantAvatar === "string" && creds.consultantAvatar.trim().length > 0 ? creds.consultantAvatar.trim() : undefined,
      avatarType:
        creds.avatarType === "mascot" || creds.avatarType === "photo" || creds.avatarType === "icon"
          ? (creds.avatarType as "mascot" | "photo" | "icon")
          : (creds.customMascotDirections || creds.mascotId === "custom"
              ? "mascot"
              : (creds.consultantAvatar ? "photo" : "icon")),
      mascotId:
        typeof creds.mascotId === "string" && creds.mascotId.trim().length > 0
          ? creds.mascotId
          : (creds.customMascotDirections ? "custom" : "drone"),
      customMascotDirections: typeof creds.customMascotDirections === "string" && creds.customMascotDirections.trim().length > 0 ? creds.customMascotDirections.trim() : undefined,
      customMascotReactions: typeof creds.customMascotReactions === "string" && creds.customMascotReactions.trim().length > 0 ? creds.customMascotReactions.trim() : undefined,
      proactiveEnabled,
      proactiveDelaySeconds,
      proactiveMessage,
    };
  }

  /**
   * Обработка входящего сообщения от посетителя сайта.
   */
  async processIncomingMessage(input: WebchatMessageInput): Promise<WebchatMessageResult> {
    const account = await this.resolveAccount(input.channelAccountId);

    const text = input.text ? input.text.trim() : "";
    if (text.length === 0 && !input.attachment) {
      throw new AppError(400, "EMPTY_MESSAGE", "Текст сообщения или вложение не могут быть пустыми");
    }

    // Автоматическое определение номера телефона из текста, если не был передан явно
    let detectedPhone = input.senderPhone?.trim();
    if (!detectedPhone && text) {
      const phoneMatch = text.match(/(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}\b/);
      if (phoneMatch) {
        const digits = phoneMatch[0].replace(/\D/g, "");
        if (digits.length === 11) {
          detectedPhone = `+7${digits.slice(1)}`;
        }
      }
    }

    // Автоматическое определение email из текста, если не был передан явно
    let detectedEmail = input.senderEmail?.trim();
    if (!detectedEmail && text) {
      const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
      if (emailMatch) {
        detectedEmail = emailMatch[0];
      }
    }

    const fallbackText = input.attachment
      ? input.attachmentType?.startsWith("image/")
        ? "Фотография"
        : input.attachmentType?.startsWith("video/")
          ? "Видео"
          : "Вложение"
      : "";
    const effectiveText = text || fallbackText;

    const ymUid = input.ymUid || input.analytics?.ymUid || undefined;
    const yandexuid = input.analytics?.yandexuid || undefined;
    const gaId = input.gaId || input.analytics?.gaId || undefined;
    const fbId = input.fbId || input.analytics?.fbId || undefined;
    const tmrLvid = input.analytics?.tmrLvid || undefined;

    const parsedUa = input.userAgent ? parseUserAgent(input.userAgent) : null;
    const enrichedDeviceInfo = {
      ...(input.deviceInfo || {}),
      ...(parsedUa ? { os: parsedUa.os, browser: parsedUa.browser, deviceType: parsedUa.deviceType } : {}),
      ...(input.clientIp ? { ip: input.clientIp } : {}),
    };

    // Формируем структурированный контекст для CRM и менеджеров
    const contextLines: string[] = [];
    if (input.isDraft) {
      contextLines.push("[Черновик / Неотправленное обращение]");
    }
    if (parsedUa || enrichedDeviceInfo.deviceType) {
      const devType = enrichedDeviceInfo.deviceType === "mobile" ? "Мобильный" : enrichedDeviceInfo.deviceType === "tablet" ? "Планшет" : "Десктоп";
      contextLines.push(`[Устройство: ${devType} (${enrichedDeviceInfo.os || "OS"} / ${enrichedDeviceInfo.browser || "Браузер"})]`);
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
    if (input.clickIds && Object.keys(input.clickIds).length > 0) {
      const clickStr = Object.entries(input.clickIds)
        .filter(([_, v]) => Boolean(v))
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      if (clickStr) contextLines.push(`[Реклама ClickID: ${clickStr}]`);
    }
    if (yandexuid) {
      contextLines.push(`[Яндекс ID: ${yandexuid}]`);
    }
    if (ymUid) {
      contextLines.push(`[YM ClientID: ${ymUid}]`);
    }
    if (gaId) {
      contextLines.push(`[GA ClientID: ${gaId}]`);
    }
    if (tmrLvid) {
      contextLines.push(`[Top.Mail.ru: ${tmrLvid}]`);
    }
    if (input.pageHistory && input.pageHistory.length > 1) {
      const historyStr = input.pageHistory.map((h) => h.url).join(" -> ");
      contextLines.push(`[История переходов: ${historyStr}]`);
    }

    const crmInboundText = contextLines.length > 0 ? `${contextLines.join("\n")}\n\n${effectiveText}` : effectiveText;

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
        senderEmail: detectedEmail || undefined,
        attachment: input.attachment || null,
        attachmentType: input.attachmentType || null,
        visitorId: input.visitorId,
        deviceFingerprint: input.deviceFingerprint,
        deviceInfo: enrichedDeviceInfo,
        ymUid: ymUid,
        yandexuid: yandexuid,
        gaId: gaId,
        fbId: fbId,
        tmrLvid: tmrLvid,
        clickIds: input.clickIds,
        referrer: input.referrer,
        pageUrl: input.pageUrl,
        pageHistory: input.pageHistory,
        visitCount: input.visitCount,
        utmTags: input.utmTags,
      }),
    );

    // Если контакт помечен как личный — CRM не обрабатывает переписку
    if (crmResult.isPersonal) {
      return {
        dealId: "",
        contactId: crmResult.contactId,
        replies: [],
        status: "queued",
      };
    }

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
        channelType: "онлайн-чат на сайте",
      }),
    );

    const botSenderName = account.consultantName || account.botName || "Онлайн-консультант";

    // 3. Если агент сформировал ответ — сохраняем его в deal_messages.
    if (outcome.kind === "replied" && crmResult.dealId) {
      await runWithTenantContext(account.tenantId, () =>
        this.crm.saveAgentReply({
          tenantId: account.tenantId,
          dealId: crmResult.dealId,
          reply: outcome.reply,
          channel: "webchat",
          channelAccountId: account.id,
          senderName: account.consultantName || account.botName || "AI-ассистент",
        }),
      );

      return {
        dealId: crmResult.dealId,
        contactId: crmResult.contactId,
        replies: outcome.reply.messages,
        status: "replied",
      };
    }

    // 4. Если AI-агент не ответил (нет агента, агент на паузе, ошибка модели) —
    // отправляем автоответ виджета и ОБЯЗАТЕЛЬНО фиксируем его в CRM в deal_messages.
    if (crmResult.dealId) {
      const hasRecentOutbound = await runWithTenantContext(account.tenantId, async () => {
        const row = await queryOne<{ id: string }>(
          `SELECT id FROM deal_messages
           WHERE tenant_id = $1 AND deal_id = $2 AND direction = 'outbound'
             AND created_at > now() - interval '15 minutes'
           LIMIT 1`,
          [account.tenantId, crmResult.dealId],
        );
        return row !== null;
      }).catch(() => false);

      const autoReplyText = hasRecentOutbound
        ? "Ваш вопрос передан специалисту. Он ответит вам здесь в ближайшее время."
        : "Спасибо за обращение! Мы зафиксировали заявку в CRM. Специалист свяжется с вами в ближайшее время.";

      await runWithTenantContext(account.tenantId, () =>
        this.crm.saveAgentReply({
          tenantId: account.tenantId,
          dealId: crmResult.dealId,
          reply: { messages: [autoReplyText] },
          channel: "webchat",
          channelAccountId: account.id,
          senderName: botSenderName,
        }),
      );

      return {
        dealId: crmResult.dealId,
        contactId: crmResult.contactId,
        replies: [autoReplyText],
        status: "operator_needed",
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

    const rows = await runWithPlatformScope(() =>
      query<{
        id: string;
        source: string;
        direction: string;
        sender_name: string;
        content: string;
        attachment?: string | null;
        attachment_type?: string | null;
        created_at: Date | string;
      }>(
        `SELECT m.id, m.source, m.direction, m.sender_name, m.content, m.attachment, m.attachment_type, m.created_at
         FROM deal_messages m
         JOIN deals d ON d.id = m.deal_id
         JOIN contacts c ON c.id = d.contact_id
         WHERE m.tenant_id = $1
           AND m.channel_account_id = $2
           AND m.channel = 'webchat'
           AND (
             c.socials @> $3::jsonb
             OR c.custom_fields->>'webchat_visitor_id' = $4
             OR c.socials @> $5::jsonb
             OR c.socials @> $6::jsonb
           )
           AND d.deleted_at IS NULL
         ORDER BY m.created_at ASC
         LIMIT 100`,
        [
          account.tenantId,
          account.id,
          JSON.stringify([{ kind: "other", value: visitorId }]),
          visitorId,
          JSON.stringify([{ kind: "other", value: visitorId.slice(-4) }]),
          JSON.stringify([{ kind: "other", value: `site_${visitorId}` }]),
        ],
      ),
    );

    return rows.map((r) => {
      let content = r.content;
      if (r.direction === "inbound") {
        content = content.replace(/^(\[[^\]]+\]\s*)+\n*/g, "").trim();
      }
      return {
        id: r.id,
        source: r.source,
        direction: r.direction,
        senderName: r.sender_name,
        content,
        attachment: r.attachment ?? null,
        attachmentType: r.attachment_type ?? null,
        createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      };
    });
  }
}
