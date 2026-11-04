import { query, queryOne, runWithPlatformScope, runWithTenantContext } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { AgentPipelineService } from "../ai/agent-pipeline.service.js";
import { CrmPipelineService } from "../crm/crm-pipeline.service.js";
import { extractPhoneNumber, extractEmailAddress } from "../crm/channel-identity.js";
import { preChatModalService } from "../analytics/prechat-modal.service.js";

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

export type WebchatAttentionEffect = "none" | "shimmer" | "pulse" | "glow" | "bounce";

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
  launcherStyle?: "circle" | "pill";
  statusText?: string;
  badgeEnabled?: boolean;
  badgeText?: string;
  badgeTexts?: string[];
  badgeRotateIntervalSec?: number;
  badgeIntervalSeconds?: number;
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
  attentionEnabled?: boolean;
  attentionEffect?: WebchatAttentionEffect;
  attentionInterval?: number;
  prechatModal?: {
    enabled: boolean;
    abMode: string;
    greetingTemplate: string;
    whatsappNumber?: string | null;
    telegramUsername?: string | null;
  };
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
  sessionId?: string;
  text: string;
  senderName?: string;
  senderPhone?: string;
  senderEmail?: string;
  attachment?: string;
  attachmentType?: string;
  pageUrl?: string;
  pageTitle?: string;
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

function extractUtmAndClickIdsFromUrl(urlStr?: string | null): {
  utmTags: Record<string, string>;
  clickIds: Record<string, string>;
} {
  const utmTags: Record<string, string> = {};
  const clickIds: Record<string, string> = {};
  if (!urlStr || typeof urlStr !== "string") return { utmTags, clickIds };

  try {
    const url = new URL(urlStr);
    const searchParams = url.searchParams;

    const utmKeys = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      "utm_creative_format",
      "utm_marketing_tactic",
    ];
    for (const key of utmKeys) {
      const val = searchParams.get(key) || searchParams.get(key.toUpperCase());
      if (val) utmTags[key] = val;
    }

    const clickKeys = ["yclid", "gclid", "fbclid", "vkclid", "ttclid", "msclkid", "_openstat", "wbraid", "gbraid"];
    for (const key of clickKeys) {
      const val = searchParams.get(key) || searchParams.get(key.toUpperCase());
      if (val) clickIds[key] = val;
    }

    if (url.hash && url.hash.includes("?")) {
      const hashParams = new URLSearchParams(url.hash.substring(url.hash.indexOf("?")));
      for (const key of utmKeys) {
        if (!utmTags[key]) {
          const val = hashParams.get(key) || hashParams.get(key.toUpperCase());
          if (val) utmTags[key] = val;
        }
      }
      for (const key of clickKeys) {
        if (!clickIds[key]) {
          const val = hashParams.get(key) || hashParams.get(key.toUpperCase());
          if (val) clickIds[key] = val;
        }
      }
    }
  } catch {}

  return { utmTags, clickIds };
}

export class WebchatService {
  private static readonly sessionLocks = new Map<string, Promise<void>>();
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

    let resolvedMax = rawMax;
    const maxAccId = typeof creds.maxAccountId === "string" ? creds.maxAccountId : "";
    if (maxAccId || !resolvedMax || resolvedMax === "id505030516451_bot" || /^\d+$/.test(resolvedMax)) {
      const maxAccount = await runWithPlatformScope(() =>
        queryOne<ChannelAccountRow>(
          `SELECT id, tenant_id, label, status, external_id, credentials
           FROM channel_accounts
           WHERE tenant_id = $1
             AND channel = 'max'
             AND deleted_at IS NULL
             AND (
               id = $2::uuid
               OR external_id = $3
             )
           LIMIT 1`,
          [account.tenant_id, maxAccId && maxAccId.length === 36 ? maxAccId : "00000000-0000-0000-0000-000000000000", resolvedMax || ""],
        ),
      );
      if (maxAccount) {
        const mCreds = (maxAccount.credentials ?? {}) as Record<string, unknown>;
        const cand = typeof mCreds.maxLink === "string" ? mCreds.maxLink.trim() : "";
        if (cand) {
          resolvedMax = cand;
        }
      }
    }

    if (resolvedMax && (messengerBannerMode === "multi" ? maxEnabled : singleTarget === "max")) {
      const trimmed = resolvedMax.trim();
      let maxUrl: string | null = null;
      if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
        maxUrl = trimmed;
      } else if (trimmed.startsWith("max.ru/")) {
        maxUrl = `https://${trimmed}`;
      } else if (trimmed.startsWith("u/") || trimmed.startsWith("/u/")) {
        const path = trimmed.replace(/^\/+/, "");
        maxUrl = `https://max.ru/${path}`;
      } else {
        const clean = trimmed.replace(/^@/, "");
        if (!/^\d+$/.test(clean) && clean !== "id505030516451_bot") {
          maxUrl = `https://max.ru/${clean}`;
        }
      }

      if (maxUrl) {
        messengerButtons.push({
          type: "max",
          label: "MAX",
          url: maxUrl,
          handle: resolvedMax,
        });
      }
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

    const badgeEnabled = creds.badgeEnabled !== undefined ? Boolean(creds.badgeEnabled) : true;

    let badgeTexts: string[] = [];
    if (Array.isArray(creds.badgeTexts)) {
      badgeTexts = creds.badgeTexts
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0);
    } else if (typeof creds.badgeTexts === "string" && creds.badgeTexts.trim().length > 0) {
      badgeTexts = creds.badgeTexts
        .split("\n")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    } else if (typeof creds.badgeText === "string" && creds.badgeText.trim().length > 0) {
      badgeTexts = [creds.badgeText.trim()];
    }

    if (badgeTexts.length === 0) {
      badgeTexts = ["Задайте вопрос"];
    }

    const badgeRotateIntervalSec =
      typeof creds.badgeRotateIntervalSec === "number" && creds.badgeRotateIntervalSec >= 2
        ? creds.badgeRotateIntervalSec
        : (typeof creds.badgeRotateIntervalSec === "string" && parseInt(creds.badgeRotateIntervalSec, 10) >= 2
            ? parseInt(creds.badgeRotateIntervalSec, 10)
            : 5);

    // Эффект привлечения внимания (Attention Grabber)
    const attentionEnabled = creds.attentionEnabled !== undefined
      ? Boolean(creds.attentionEnabled)
      : (creds.attentionEffect !== "none");

    let attentionEffect: WebchatAttentionEffect = "shimmer";
    if (
      creds.attentionEffect === "none" ||
      creds.attentionEffect === "shimmer" ||
      creds.attentionEffect === "pulse" ||
      creds.attentionEffect === "glow" ||
      creds.attentionEffect === "bounce"
    ) {
      attentionEffect = creds.attentionEffect as WebchatAttentionEffect;
    }
    if (!attentionEnabled) {
      attentionEffect = "none";
    }

    const attentionInterval =
      typeof creds.attentionInterval === "number" && creds.attentionInterval >= 0
        ? creds.attentionInterval
        : (typeof creds.attentionInterval === "string" && !isNaN(parseInt(creds.attentionInterval, 10))
            ? Math.max(0, parseInt(creds.attentionInterval, 10))
            : 5);

    const prechatConfig = await preChatModalService.getConfig(account.tenant_id).catch(() => null);

    const normalizeAssetUrl = (url: string | undefined): string | undefined => {
      if (!url || typeof url !== "string") return undefined;
      const trimmed = url.trim();
      if (!trimmed) return undefined;
      if (
        trimmed.startsWith("data:") ||
        trimmed.startsWith("blob:") ||
        trimmed.startsWith("http://") ||
        trimmed.startsWith("https://")
      ) {
        return trimmed;
      }
      if (trimmed.startsWith("//")) {
        return `https:${trimmed}`;
      }
      if (trimmed.startsWith("/uploads/") || trimmed.startsWith("uploads/")) {
        return `https://api.getvoxly.ru/${trimmed.replace(/^\/+/, "")}`;
      }
      return `https://getvoxly.ru/${trimmed.replace(/^\/+/, "")}`;
    };

    const consultantAvatar = normalizeAssetUrl(
      typeof creds.consultantAvatar === "string" && creds.consultantAvatar.trim().length > 0
        ? creds.consultantAvatar.trim()
        : undefined,
    );
    const customMascotDirections = normalizeAssetUrl(
      typeof creds.customMascotDirections === "string" && creds.customMascotDirections.trim().length > 0
        ? creds.customMascotDirections.trim()
        : undefined,
    );
    const customMascotReactions = normalizeAssetUrl(
      typeof creds.customMascotReactions === "string" && creds.customMascotReactions.trim().length > 0
        ? creds.customMascotReactions.trim()
        : undefined,
    );

    let avatarType: "icon" | "photo" | "mascot";
    if (creds.avatarType === "icon" || creds.avatarType === "photo" || creds.avatarType === "mascot") {
      avatarType = creds.avatarType;
    } else if (consultantAvatar) {
      avatarType = "photo";
    } else if (customMascotDirections || creds.mascotId) {
      avatarType = "mascot";
    } else {
      avatarType = "icon";
    }

    const mascotId =
      typeof creds.mascotId === "string" && creds.mascotId.trim().length > 0
        ? creds.mascotId
        : customMascotDirections
          ? "custom"
          : "drone";

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
      launcherStyle: creds.launcherStyle === "pill" ? "pill" : "circle",
      statusText:
        typeof creds.statusText === "string" && creds.statusText.trim().length > 0
          ? creds.statusText.trim()
          : "Онлайн",
      showMessengerBanner,
      messengerBannerMode,
      singleTarget,
      messengerButtons,
      telegramBot: rawTg ? rawTg.replace(/^@/, "") : undefined,
      showTelegramBanner: showMessengerBanner && messengerButtons.some((b) => b.type === "telegram"),
      whatsappPhone: rawWa || undefined,
      maxLink: rawMax || undefined,
      consultantName: typeof creds.consultantName === "string" && creds.consultantName.trim().length > 0 ? creds.consultantName.trim() : undefined,
      consultantAvatar,
      avatarType,
      mascotId,
      customMascotDirections,
      customMascotReactions,
      proactiveEnabled,
      proactiveDelaySeconds,
      proactiveMessage,
      badgeEnabled,
      badgeText: badgeTexts[0] || "Задайте вопрос",
      badgeTexts,
      badgeRotateIntervalSec,
      badgeIntervalSeconds: badgeRotateIntervalSec,
      attentionEnabled,
      attentionEffect,
      attentionInterval,
      prechatModal: prechatConfig
        ? {
            enabled: prechatConfig.isEnabled,
            abMode: prechatConfig.abMode,
            greetingTemplate: prechatConfig.greetingTemplate,
            whatsappNumber: prechatConfig.whatsappNumber,
            telegramUsername: prechatConfig.telegramUsername,
          }
        : undefined,
    };
  }

  /**
   * Обработка входящего сообщения от посетителя сайта с гарантией очередности (Session Lock).
   */
  async processIncomingMessage(input: WebchatMessageInput): Promise<WebchatMessageResult> {
    const sessionKey = `${input.channelAccountId}:${input.visitorId}`;
    const previousLock = WebchatService.sessionLocks.get(sessionKey) || Promise.resolve();

    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    WebchatService.sessionLocks.set(sessionKey, currentLock);

    // Ожидаем завершения предыдущего обращения по этой же сессии (с защитой от зависания и ошибок)
    await Promise.race([
      previousLock.catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 20000)),
    ]);

    try {
      return await this.executeProcessIncomingMessage(input);
    } finally {
      releaseLock();
      if (WebchatService.sessionLocks.get(sessionKey) === currentLock) {
        WebchatService.sessionLocks.delete(sessionKey);
      }
    }
  }

  private async executeProcessIncomingMessage(input: WebchatMessageInput): Promise<WebchatMessageResult> {
    const account = await this.resolveAccount(input.channelAccountId);

    const text = input.text ? input.text.trim() : "";
    if (text.length === 0 && !input.attachment) {
      throw new AppError(400, "EMPTY_MESSAGE", "Текст сообщения или вложение не могут быть пустыми");
    }

    // Автоматическое определение номера телефона из текста, если не был передан явно
    let detectedPhone = input.senderPhone?.trim();
    if (detectedPhone) {
      detectedPhone = extractPhoneNumber(detectedPhone) ?? detectedPhone;
    } else if (text) {
      detectedPhone = extractPhoneNumber(text) ?? undefined;
    }

    // Автоматическое определение email из текста, если не был передан явно
    let detectedEmail = input.senderEmail?.trim();
    if (!detectedEmail && text) {
      detectedEmail = extractEmailAddress(text) ?? undefined;
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
    const enrichedDeviceInfo: Record<string, unknown> = {
      ...(input.deviceInfo || {}),
      ...(parsedUa ? { os: parsedUa.os, browser: parsedUa.browser, deviceType: parsedUa.deviceType } : {}),
      ...(input.clientIp ? { ip: input.clientIp } : {}),
    };

    // Извлекаем UTM и рекламные Click ID (с поддержкой URL страницы и реферера)
    const fromPage = extractUtmAndClickIdsFromUrl(input.pageUrl);
    const fromReferrer = extractUtmAndClickIdsFromUrl(input.referrer);
    const effectiveUtmTags: Record<string, string> = {
      ...fromReferrer.utmTags,
      ...fromPage.utmTags,
      ...(input.utmTags || {}),
    };
    const effectiveClickIds: Record<string, string> = {
      ...fromReferrer.clickIds,
      ...fromPage.clickIds,
      ...(input.clickIds || {}),
    };

    let pageDomain = "";
    if (input.pageUrl) {
      try {
        pageDomain = new URL(input.pageUrl).hostname;
      } catch {
        pageDomain = "";
      }
    }

    const sourceMetadata: Record<string, unknown> = {
      device: {
        deviceType: (enrichedDeviceInfo.deviceType as string | undefined) || (parsedUa ? parsedUa.deviceType : "desktop"),
        os: (enrichedDeviceInfo.os as string | undefined) || (parsedUa ? parsedUa.os : "Неизвестно"),
        browser: (enrichedDeviceInfo.browser as string | undefined) || (parsedUa ? parsedUa.browser : "Неизвестно"),
        screen: enrichedDeviceInfo.screen,
        platform: enrichedDeviceInfo.platform,
        rawUserAgent: input.userAgent,
      },
      page: {
        url: input.pageUrl || "",
        title: input.pageTitle || "",
        domain: pageDomain,
      },
      utm: effectiveUtmTags,
      clickIds: effectiveClickIds,
      referrer: input.referrer || "",
      network: {
        ip: input.clientIp || (enrichedDeviceInfo.ip as string | undefined),
        city: enrichedDeviceInfo.city as string | undefined,
        country: enrichedDeviceInfo.country as string | undefined,
      },
      analytics: {
        yandexuid,
        ymUid,
        gaId,
        fbId,
        tmrLvid,
      },
      firstSeenAt: new Date().toISOString(),
      visitCount: input.visitCount || 1,
      pageHistory: input.pageHistory || [],
    };

    // Чат содержит ТОЛЬКО живой текст диалога между клиентом и оператором/ботом.
    // Метаданные источника сохраняются непосредственно в source_metadata контакта и сделки.
    const crmInboundText = effectiveText;

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
        clickIds: effectiveClickIds,
        referrer: input.referrer,
        pageUrl: input.pageUrl,
        pageTitle: input.pageTitle,
        pageHistory: input.pageHistory,
        visitCount: input.visitCount,
        utmTags: effectiveUtmTags,
        sourceMetadata,
      }),
    );

    // Фиксация этапов воронки в widget_analytics_events:
    // - CHAT_START при первом отправленном сообщении
    // - LEAD_CAPTURED при обнаружении телефона или email
    const effectiveSessionId = input.sessionId?.trim() || input.visitorId;
    if (!input.isDraft) {
      void runWithTenantContext(account.tenantId, async () => {
        try {
          await query(
            `INSERT INTO widget_analytics_events
               (tenant_id, widget_id, session_id, visitor_id, event_type, metadata, created_at)
             VALUES ($1, $2, $3, $4, 'CHAT_START', $5::jsonb, now())
             ON CONFLICT (widget_id, session_id, event_type) DO NOTHING`,
            [
              account.tenantId,
              account.id,
              effectiveSessionId,
              input.visitorId,
              JSON.stringify({ textPreview: crmInboundText.slice(0, 100) }),
            ],
          );

          if (detectedPhone || detectedEmail) {
            await query(
              `INSERT INTO widget_analytics_events
                 (tenant_id, widget_id, session_id, visitor_id, event_type, metadata, created_at)
               VALUES ($1, $2, $3, $4, 'LEAD_CAPTURED', $5::jsonb, now())
               ON CONFLICT (widget_id, session_id, event_type) DO NOTHING`,
              [
                account.tenantId,
                account.id,
                effectiveSessionId,
                input.visitorId,
                JSON.stringify({ phone: Boolean(detectedPhone), email: Boolean(detectedEmail) }),
              ],
            );
          }
        } catch {
          // Игнорируем ошибки аналитики, не блокируя доставку сообщений
        }
      });
    }

    // Если контакт помечен как личный или отправитель распознан как бот — CRM не обрабатывает переписку
    if (crmResult.isPersonal || crmResult.isBot) {
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

    // 2. Проверяем AI Handoff (если оператор перехватил диалог, бот временно на паузе или выключен)
    if (crmResult.dealId || crmResult.contactId) {
      const isAiPaused = await runWithTenantContext(account.tenantId, async () => {
        if (crmResult.dealId) {
          const row = await queryOne<{ id: string }>(
            `SELECT id FROM deals
             WHERE tenant_id = $1 AND id = $2 AND ai_paused_until > now()
             LIMIT 1`,
            [account.tenantId, crmResult.dealId],
          );
          if (row !== null) return true;
        }
        if (crmResult.contactId) {
          const contactDeal = await queryOne<{ id: string }>(
            `SELECT id FROM deals
             WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL AND ai_paused_until > now()
             LIMIT 1`,
            [account.tenantId, crmResult.contactId],
          );
          if (contactDeal !== null) return true;
        }
        return false;
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
    // Если для этого виджета чата AI-агент не привязан — диалог остаётся в CRM
    // для операторов без генерации автоответов.
    if (!account.isAiEnabled) {
      return {
        dealId: crmResult.dealId,
        contactId: crmResult.contactId,
        replies: [],
        status: "operator_needed",
      };
    }

    // Передаем агенту чистый вопрос и контекст текущей страницы для релевантного ответа
    const promptText = input.pageUrl ? `[Пользователь на странице: ${input.pageUrl}]\n${text}` : text;
    const outcome = await runWithTenantContext(account.tenantId, () =>
      this.agentPipeline.prepareReply({
        tenantId: account.tenantId,
        channelAccountId: account.id,
        chatId: input.visitorId,
        text: promptText,
        channelType: "онлайн-чат на сайте",
        dealId: crmResult.dealId,
      }),
    );

    const botSenderName = account.consultantName || account.botName || "Онлайн-консультант";

    // Если канал не привязан к агенту (no_agent) — передаем операторам без заглушки
    if (outcome.kind === "no_agent") {
      return {
        dealId: crmResult.dealId,
        contactId: crmResult.contactId,
        replies: [],
        status: "operator_needed",
      };
    }

    // 4. Если агент сформировал ответ — сохраняем его в deal_messages.
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
      status: outcome.kind === "agent_paused" ? "operator_needed" : "agent_unavailable",
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
           AND m.direction IN ('inbound', 'outbound')
           AND m.source NOT IN ('system', 'internal_note', 'audit')
           AND m.sender_name != 'Система'
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

    return rows
      .filter((r) => {
        // Защита от утечки системных логов/событий CRM в публичный чат посетителя
        if (r.direction !== "inbound" && r.direction !== "outbound") return false;
        if (r.source === "system" || r.source === "internal_note" || r.source === "audit") return false;
        if (r.sender_name === "Система") return false;
        const text = r.content || "";
        if (
          text.includes("Сделка автоматически переведена") ||
          text.includes("Получены контактные данные клиента") ||
          text.includes("Создан лид") ||
          text.includes("Лид создан") ||
          text.startsWith("Лид №") ||
          text.includes("Сделка автоматически закрыта")
        ) {
          return false;
        }
        return true;
      })
      .map((r) => {
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
