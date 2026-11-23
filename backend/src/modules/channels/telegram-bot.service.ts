import { getEnv } from "../../config/env.js";
import { queryOne, withTenant } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { toIsoOrNull as toIso } from "../../lib/date.utils.js";
import { pluralRu } from "../../lib/string.utils.js";
import type { ChannelSlug } from "../../types/index.js";
import { quotaService } from "../quotas/quota.service.js";
import { channelLinksService } from "./channel-links.service.js";
import { TelegramService } from "../auth/telegram.service.js";
import type { OutboundMessage, OutboundSendResult } from "./outbound-registry.js";
import type {
  ChannelAccountDTO,
  ChannelStatus,
} from "./channels.types.js";
import type {
  BotConfigDTO,
  BotCreateInput,
  TelegramBotCompleteManagedInput,
  TelegramBotConnectInput,
  TelegramBotCreateManagedInput,
  TelegramBotCreateManagedResultDTO,
  TelegramBotInfoDTO,
  TelegramBotManagerInfoDTO,
} from "./telegram-bot.types.js";

interface ChannelAccountRow {
  id: string;
  channel: ChannelSlug;
  label: string;
  external_id: string;
  status: ChannelStatus;
  status_message: string;
  has_credentials: boolean;
  credentials?: Record<string, unknown>;
  remote_user_id: string | null;
  last_sync_at: Date | string | null;
  connected_at: Date | string | null;
  created_at: Date | string;
  bound_agent_id?: string | null;
  bound_agent_name?: string | null;
  cred_username?: string | null;
  cred_phone?: string | null;
  cred_bot?: string | null;
  has_session?: boolean;
}

const TELEGRAM_API_BASE = "https://api.telegram.org";

interface TelegramApiResponse<T = unknown> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
}

interface TelegramUserResponse {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
  can_join_groups?: boolean;
  can_read_all_group_messages?: boolean;
  supports_inline_queries?: boolean;
}

function pluralConnections(count: number): string {
  return pluralRu(count, ["подключение", "подключения", "подключений"]);
}

function rowToAccountDTO(row: ChannelAccountRow): ChannelAccountDTO {
  const links = channelLinksService.resolveAccountLinks(row);

  return {
    id: row.id,
    channel: row.channel,
    label: row.label,
    externalId: row.external_id,
    status: row.status,
    statusMessage: row.status_message ?? "",
    is_enabled: row.status === "connected",
    isEnabled: row.status === "connected",
    hasCredentials: row.has_credentials,
    credentials: row.credentials,
    remoteUserId: row.remote_user_id,
    lastSyncAt: toIso(row.last_sync_at),
    connectedAt: toIso(row.connected_at),
    createdAt: toIso(row.created_at) ?? "",
    boundAgentId: row.bound_agent_id ?? null,
    boundAgentName: row.bound_agent_name ?? null,
    links,
  };
}

/**
 * Транслитерация кириллических символов в латиницу для безопасной генерации username Telegram.
 */
export function transliterateCyrillic(input: string): string {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return input
    .toLowerCase()
    .split("")
    .map((c) => map[c] ?? c)
    .join("")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export class TelegramBotService {
  private readonly managerUsername: string;
  private readonly telegramService = new TelegramService();

  constructor() {
    const env = getEnv();
    const candidate =
      (env as unknown as Record<string, string | undefined>).TELEGRAM_BOT_MANAGER_USERNAME ||
      env.TELEGRAM_AUTH_BOT_USERNAME ||
      "GetVoxlybot";
    this.managerUsername = candidate.replace(/^@/, "").trim();
  }

  /**
   * Вызов Telegram Bot API getMe для проверки токена и получения метаданных бота.
   */
  async getMe(token: string): Promise<TelegramBotInfoDTO> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const res = await fetch(`${TELEGRAM_API_BASE}/bot${token.trim()}/getMe`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      const body = (await res.json().catch(() => null)) as TelegramApiResponse<TelegramUserResponse> | null;

      if (!res.ok || !body || body.ok !== true || !body.result) {
        const desc = body?.description ?? `HTTP ${res.status}`;
        if (res.status === 401 || body?.error_code === 401) {
          throw new AppError(
            400,
            "INVALID_BOT_TOKEN",
            "Неверный токен бота Telegram. Проверьте правильность токена, полученного от @BotFather или Bot Manager.",
          );
        }
        if (res.status === 429 || body?.error_code === 429) {
          throw new AppError(
            429,
            "TELEGRAM_RATE_LIMITED",
            `Telegram Bot API временно ограничил запросы к боту (${desc}). Подождите полминуты и повторите попытку.`,
          );
        }
        throw new AppError(
          502,
          "TELEGRAM_API_ERROR",
          `Ошибка Telegram Bot API: ${desc}`,
        );
      }

      const bot = body.result;
      if (!bot.is_bot) {
        throw new AppError(
          400,
          "TOKEN_NOT_A_BOT",
          "Указанный токен не принадлежит Telegram-боту.",
        );
      }

      if (!bot.username) {
        throw new AppError(
          400,
          "BOT_HAS_NO_USERNAME",
          "У Telegram-бота отсутствует публичный username (@username). Задайте его в @BotFather.",
        );
      }

      return {
        id: bot.id,
        isBot: true,
        firstName: bot.first_name,
        username: bot.username,
        canJoinGroups: bot.can_join_groups,
        canReadAllGroupMessages: bot.can_read_all_group_messages,
        supportsInlineQueries: bot.supports_inline_queries,
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      let message = err instanceof Error ? err.message : "Неизвестная сетевая ошибка";
      if (err instanceof Error && (err.name === "AbortError" || message.includes("aborted"))) {
        message = "Таймаут соединения с Telegram Bot API (сервер Telegram не ответил вовремя). Повторите попытку.";
      }
      throw new AppError(
        502,
        "TELEGRAM_CONNECTION_ERROR",
        `Не удалось соединиться с Telegram Bot API: ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Информация о платформенном менеджере ботов (Telegram Managed Bots).
   */
  getManagerInfo(): TelegramBotManagerInfoDTO {
    return {
      configured: this.managerUsername.length > 0,
      managerUsername: this.managerUsername,
      deepLinkTemplate: `https://t.me/newbot/${this.managerUsername}/{username}?name={name}`,
      features: {
        managedBots: true,
        directCreation: true,
        tokenRotation: true,
      },
    };
  }

  /**
   * Подключение уже существующего бота по токену.
   */
  async connectExisting(tenantId: string, payload: TelegramBotConnectInput): Promise<ChannelAccountDTO> {
    const botInfo = await this.getMe(payload.token);
    const cleanUsername = botInfo.username.replace(/^@/, "").trim();
    const externalId = `@${cleanUsername}`;

    const result = await withTenant(tenantId, async (tx) => {
      // 1. Проверяем наличие установленного модуля
      const installedModule = await tx.queryOne<{ quantity: number }>(
        `SELECT quantity FROM installed_modules WHERE tenant_id = $1 AND slug = 'telegram_bot'`,
        [tenantId],
      );

      if (installedModule === null) {
        throw new AppError(403, "MODULE_NOT_INSTALLED", "Модуль Telegram-бота не подключен в маркетплейсе");
      }

      // 2. Проверяем дубликаты
      const duplicate = await tx.queryOne<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'telegram_bot'
           AND (external_id = $2 OR remote_user_id = $3)
           AND deleted_at IS NULL`,
        [tenantId, externalId, botInfo.id.toString()],
      );

      if (duplicate !== null) {
        throw new AppError(
          409,
          "CHANNEL_ACCOUNT_EXISTS",
          `Бот ${externalId} уже подключен к этой компании.`,
        );
      }

      // 3. Проверка тарифных квот
      const used = await tx.queryOne<{ total: string }>(
        `SELECT count(*)::text AS total FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'telegram_bot' AND deleted_at IS NULL`,
        [tenantId],
      );

      const quota = await quotaService.checkQuota(tenantId, "telegram_bot_channels");
      if (!quota.isUnlimited) {
        const effectiveLimit = quota.maxLimit ?? installedModule.quantity;
        if (Number(used?.total ?? 0) >= effectiveLimit) {
          throw new AppError(
            403,
            "CHANNEL_LIMIT_REACHED",
            `По тарифу оплачено ${effectiveLimit} ${pluralConnections(effectiveLimit)}. Увеличьте количество в маркетплейсе.`,
          );
        }
      }

      // 4. Подготовка credentials
      const credentials = {
        token: payload.token.trim(),
        bot_id: botInfo.id,
        username: cleanUsername,
        first_name: botInfo.firstName,
        is_managed: false,
        can_join_groups: botInfo.canJoinGroups ?? false,
        can_read_all_group_messages: botInfo.canReadAllGroupMessages ?? false,
      };

      // 5. Создание записи в channel_accounts
      const row = await tx.queryOneOrThrow<ChannelAccountRow>(
        `INSERT INTO channel_accounts (
           tenant_id, channel, label, external_id, status, status_message,
           credentials, remote_user_id, connected_at, created_at, updated_at
         )
         VALUES ($1, 'telegram_bot', $2, $3, 'connected', 'Бот подключен и готов к работе',
                 $4::jsonb, $5, now(), now(), now())
         RETURNING id, channel, label, external_id, status, status_message,
                   (credentials <> '{}'::jsonb) AS has_credentials,
                   credentials,
                   credentials->>'username' AS cred_username,
                   credentials->>'phone' AS cred_phone,
                   credentials->>'telegramBot' AS cred_bot,
                   false AS has_session,
                   remote_user_id, last_sync_at, connected_at, created_at`,
        [tenantId, payload.label.trim(), externalId, JSON.stringify(credentials), botInfo.id.toString()],
      );

      // 6. Опциональная привязка к AI-агенту
      let boundAgentName: string | null = null;
      if (payload.agent_id) {
        const agent = await tx.queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM ai_agents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [payload.agent_id, tenantId],
        );
        if (agent) {
          await tx.query(
            `INSERT INTO ai_agent_channel_bindings (tenant_id, agent_id, channel_account_id, is_enabled)
             VALUES ($1, $2, $3, true)
             ON CONFLICT (tenant_id, agent_id, channel_account_id) DO UPDATE SET is_enabled = true`,
            [tenantId, agent.id, row.id],
          );
          boundAgentName = agent.name;
        }
      }

      return rowToAccountDTO({
        ...row,
        bound_agent_id: payload.agent_id ?? null,
        bound_agent_name: boundAgentName,
      });
    });

    const publicApiUrl = process.env.PUBLIC_API_URL || "https://api.getvoxly.ru";
    const webhookUrl = `${publicApiUrl.replace(/\/+$/, "")}/api/v1/integrations/telegram-bot/webhook/${result.id}`;
    void this.setWebhook(payload.token, webhookUrl);

    return result;
  }

  /**
   * Создание нового бота через Bot Manager (Managed Bots).
   *
   * Если передан готовый токен, бот валидируется и сразу подключается со статусом `connected`.
   * Если токен не передан, создается карточка со статусом `pending` и отдается готовый deep link
   * для создания бота на стороне Telegram.
   */
  async createManaged(
    tenantId: string,
    payload: TelegramBotCreateManagedInput,
  ): Promise<TelegramBotCreateManagedResultDTO> {
    const cleanUsername = payload.username.replace(/^@/, "").trim();
    const externalId = `@${cleanUsername}`;

    // Если токен передан сразу — валидируем через getMe
    let verifiedBot: TelegramBotInfoDTO | null = null;
    if (payload.token) {
      verifiedBot = await this.getMe(payload.token);
    }

    return withTenant(tenantId, async (tx) => {
      // 1. Проверяем установленный модуль
      const installedModule = await tx.queryOne<{ quantity: number }>(
        `SELECT quantity FROM installed_modules WHERE tenant_id = $1 AND slug = 'telegram_bot'`,
        [tenantId],
      );

      if (installedModule === null) {
        throw new AppError(403, "MODULE_NOT_INSTALLED", "Модуль Telegram-бота не подключен в маркетплейсе");
      }

      // 2. Проверяем дубликаты
      const checkUsername = verifiedBot ? `@${verifiedBot.username}` : externalId;
      const duplicate = await tx.queryOne<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'telegram_bot'
           AND (external_id = $2 ${verifiedBot ? "OR remote_user_id = $3" : ""})
           AND deleted_at IS NULL`,
        verifiedBot
          ? [tenantId, checkUsername, verifiedBot.id.toString()]
          : [tenantId, checkUsername],
      );

      if (duplicate !== null) {
        throw new AppError(
          409,
          "CHANNEL_ACCOUNT_EXISTS",
          `Бот ${checkUsername} уже зарегистрирован в системе.`,
        );
      }

      // 3. Проверка квот
      const used = await tx.queryOne<{ total: string }>(
        `SELECT count(*)::text AS total FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'telegram_bot' AND deleted_at IS NULL`,
        [tenantId],
      );

      const quota = await quotaService.checkQuota(tenantId, "telegram_bot_channels");
      if (!quota.isUnlimited) {
        const effectiveLimit = quota.maxLimit ?? installedModule.quantity;
        if (Number(used?.total ?? 0) >= effectiveLimit) {
          throw new AppError(
            403,
            "CHANNEL_LIMIT_REACHED",
            `По тарифу оплачено ${effectiveLimit} ${pluralConnections(effectiveLimit)}. Увеличьте количество в маркетплейсе.`,
          );
        }
      }

      const isConnected = verifiedBot !== null;
      const status: ChannelStatus = isConnected ? "connected" : "pending";
      const statusMessage = isConnected
        ? "Управляемый бот успешно создан и подключен"
        : "Ожидает подтверждения создания в Telegram Bot Manager";

      const credentials = {
        name: payload.name.trim(),
        username: verifiedBot ? verifiedBot.username : cleanUsername,
        is_managed: true,
        manager_username: this.managerUsername,
        token: payload.token ? payload.token.trim() : null,
        bot_id: verifiedBot ? verifiedBot.id : null,
        first_name: verifiedBot ? verifiedBot.firstName : payload.name.trim(),
        can_join_groups: verifiedBot?.canJoinGroups ?? false,
        can_read_all_group_messages: verifiedBot?.canReadAllGroupMessages ?? false,
      };

      const deepLink = `https://t.me/newbot/${this.managerUsername}/${cleanUsername}?name=${encodeURIComponent(payload.name.trim())}`;

      const row = await tx.queryOneOrThrow<ChannelAccountRow>(
        `INSERT INTO channel_accounts (
           tenant_id, channel, label, external_id, status, status_message,
           credentials, remote_user_id, connected_at, created_at, updated_at
         )
         VALUES ($1, 'telegram_bot', $2, $3, $4, $5, $6::jsonb, $7,
                 CASE WHEN $4 = 'connected' THEN now() ELSE NULL END, now(), now())
         RETURNING id, channel, label, external_id, status, status_message,
                   (credentials <> '{}'::jsonb) AS has_credentials,
                   credentials,
                   credentials->>'username' AS cred_username,
                   credentials->>'phone' AS cred_phone,
                   credentials->>'telegramBot' AS cred_bot,
                   false AS has_session,
                   remote_user_id, last_sync_at, connected_at, created_at`,
        [
          tenantId,
          payload.name.trim(),
          checkUsername,
          status,
          statusMessage,
          JSON.stringify(credentials),
          verifiedBot ? verifiedBot.id.toString() : null,
        ],
      );

      // Привязка агента если есть
      let boundAgentName: string | null = null;
      if (payload.agent_id) {
        const agent = await tx.queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM ai_agents WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
          [payload.agent_id, tenantId],
        );
        if (agent) {
          await tx.query(
            `INSERT INTO ai_agent_channel_bindings (tenant_id, agent_id, channel_account_id, is_enabled)
             VALUES ($1, $2, $3, true)
             ON CONFLICT (tenant_id, agent_id, channel_account_id) DO UPDATE SET is_enabled = true`,
            [tenantId, agent.id, row.id],
          );
          boundAgentName = agent.name;
        }
      }

      return {
        account: rowToAccountDTO({
          ...row,
          bound_agent_id: payload.agent_id ?? null,
          bound_agent_name: boundAgentName,
        }),
        deepLink,
        isPending: !isConnected,
        message: isConnected
          ? "Бот успешно зарегистрирован"
          : "Перейдите по ссылке в Telegram для создания управляемого бота или введите полученный токен",
      };
    });
  }

  /**
   * Завершение привязки токена для созданного через Bot Manager бота в статусе pending.
   */
  async completeManaged(
    tenantId: string,
    accountId: string,
    payload: TelegramBotCompleteManagedInput,
  ): Promise<ChannelAccountDTO> {
    const result = await withTenant(tenantId, async (tx) => {
      const existing = await tx.queryOne<ChannelAccountRow>(
        `SELECT id, channel, label, external_id, status, status_message,
                (credentials <> '{}'::jsonb) AS has_credentials,
                credentials, remote_user_id, last_sync_at, connected_at, created_at
         FROM channel_accounts
         WHERE id = $1 AND tenant_id = $2 AND channel = 'telegram_bot' AND deleted_at IS NULL`,
        [accountId, tenantId],
      );

      if (!existing) {
        throw new NotFoundError("Аккаунт Telegram-бота не найден");
      }

      const trimmedToken = payload.token.trim();
      let botInfo: TelegramBotInfoDTO;

      try {
        botInfo = await this.getMe(trimmedToken);
      } catch (err) {
        if (err instanceof AppError && err.code === "INVALID_BOT_TOKEN") {
          throw err;
        }

        const tokenParts = trimmedToken.split(":");
        const tokenBotId = tokenParts[0];
        if (tokenParts.length === 2 && tokenBotId !== undefined && /^\d{8,12}$/.test(tokenBotId)) {
          const cleanUsername = existing.external_id ? existing.external_id.replace(/^@/, "") : "";
          botInfo = {
            id: Number(tokenBotId),
            isBot: true,
            firstName: existing.label || cleanUsername,
            username: cleanUsername,
            canJoinGroups: false,
            canReadAllGroupMessages: false,
            supportsInlineQueries: false,
          };
        } else {
          throw err;
        }
      }

      const cleanUsername = botInfo.username.replace(/^@/, "").trim();
      const externalId = `@${cleanUsername}`;

      // Проверка на конфликт с другим аккаунтом
      const conflict = await tx.queryOne<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = 'telegram_bot'
           AND (external_id = $2 OR remote_user_id = $3)
           AND id <> $4 AND deleted_at IS NULL`,
        [tenantId, externalId, botInfo.id.toString(), accountId],
      );

      if (conflict) {
        throw new AppError(409, "CHANNEL_ACCOUNT_EXISTS", `Бот ${externalId} уже подключен в другом слоте.`);
      }

      const updatedCreds = {
        ...(existing.credentials ?? {}),
        token: trimmedToken,
        bot_id: botInfo.id,
        username: cleanUsername,
        first_name: botInfo.firstName,
        is_managed: true,
        can_join_groups: botInfo.canJoinGroups ?? false,
        can_read_all_group_messages: botInfo.canReadAllGroupMessages ?? false,
      };

      const updated = await tx.queryOneOrThrow<ChannelAccountRow>(
        `UPDATE channel_accounts
         SET status = 'connected',
             status_message = 'Бот успешно активирован',
             external_id = $1,
             remote_user_id = $2,
             credentials = $3::jsonb,
             connected_at = COALESCE(connected_at, now()),
             updated_at = now()
         WHERE id = $4 AND tenant_id = $5
         RETURNING id, channel, label, external_id, status, status_message,
                   (credentials <> '{}'::jsonb) AS has_credentials,
                   credentials,
                   credentials->>'username' AS cred_username,
                   credentials->>'phone' AS cred_phone,
                   credentials->>'telegramBot' AS cred_bot,
                   false AS has_session,
                   remote_user_id, last_sync_at, connected_at, created_at`,
        [externalId, botInfo.id.toString(), JSON.stringify(updatedCreds), accountId, tenantId],
      );

      await tx.query(
        `INSERT INTO bots (tenant_id, name, username, token, status, channel_account_id, config)
         VALUES ($1, $2, $3, $4, 'connected', $5, $6::jsonb)
         ON CONFLICT (LOWER(username)) DO UPDATE
         SET status = 'connected', token = EXCLUDED.token, channel_account_id = EXCLUDED.channel_account_id, updated_at = now()`,
        [
          tenantId,
          existing.label,
          cleanUsername,
          trimmedToken,
          accountId,
          JSON.stringify({ is_managed: true }),
        ],
      ).catch(() => {});

      // Получаем привязанного агента
      const binding = await tx.queryOne<{ agent_id: string; agent_name: string }>(
        `SELECT b.agent_id, a.name AS agent_name
         FROM ai_agent_channel_bindings b
         JOIN ai_agents a ON a.id = b.agent_id
         WHERE b.channel_account_id = $1 AND b.tenant_id = $2 AND b.is_enabled = true
         LIMIT 1`,
        [accountId, tenantId],
      );

      return rowToAccountDTO({
        ...updated,
        bound_agent_id: binding?.agent_id ?? null,
        bound_agent_name: binding?.agent_name ?? null,
      });
    });

    const publicApiUrl = process.env.PUBLIC_API_URL || "https://api.getvoxly.ru";
    const webhookUrl = `${publicApiUrl.replace(/\/+$/, "")}/api/v1/integrations/telegram-bot/webhook/${accountId}`;
    void this.setWebhook(payload.token.trim(), webhookUrl);

    return result;
  }

  /**
   * Подбор гарантированно уникального и доступного имени бота.
   * Если передана база (например "freelancehuntervoxly_bot" или "фриланс хантер"):
   * - транслитерирует кириллицу
   * - нормализует имя и суффикс _bot
   * - проверяет отсутствие коллизий в bots и channel_accounts
   * - при занятости перебирает voxlyN_bot (N = 1..10 и далее).
   */
  async generateUniqueName(baseName?: string): Promise<string> {
    if (baseName) {
      const transliterated = transliterateCyrillic(baseName);
      let clean = transliterated
        .replace(/^@/, "")
        .replace(/[^a-zA-Z0-9_]/g, "")
        .toLowerCase()
        .trim();
      if (clean.length > 0) {
        if (!clean.endsWith("bot")) {
          clean = `${clean}_bot`;
        }
        if (clean.length < 5) clean = `${clean}_bot`;
        clean = clean.slice(0, 32);

        let isTaken = false;
        try {
          const exists = await queryOne<{ count: string }>(
            `SELECT count(*)::text AS count FROM (
               SELECT id FROM bots WHERE LOWER(username) = $1
               UNION ALL
               SELECT id FROM channel_accounts
               WHERE channel = 'telegram_bot'
                 AND (LOWER(external_id) = $2 OR LOWER(credentials->>'username') = $1)
                 AND deleted_at IS NULL
             ) t`,
            [clean, `@${clean}`],
          );
          isTaken = exists !== null && Number(exists.count) > 0;
        } catch {
          isTaken = false;
        }

        if (!isTaken) {
          return clean;
        }
      }
    }

    // Подбор свободной схемы вида voxlyN_bot (где N = 1..10)
    for (let i = 1; i <= 50; i++) {
      const candidate = `voxly${i}_bot`;
      let isTaken = false;
      try {
        const exists = await queryOne<{ count: string }>(
          `SELECT count(*)::text AS count FROM (
             SELECT id FROM bots WHERE LOWER(username) = $1
             UNION ALL
             SELECT id FROM channel_accounts
             WHERE channel = 'telegram_bot'
               AND (LOWER(external_id) = $2 OR LOWER(credentials->>'username') = $1)
               AND deleted_at IS NULL
           ) t`,
          [candidate, `@${candidate}`],
        );
        isTaken = exists !== null && Number(exists.count) > 0;
      } catch {
        isTaken = false;
      }

      if (!isTaken) {
        return candidate;
      }
    }

    // Фолбэк на случай 50+ ботов
    const fallbackRand = Math.floor(100 + Math.random() * 900);
    return `voxly_${Date.now().toString().slice(-4)}_${fallbackRand}_bot`;
  }

  /**
   * Регистрация нового бота через Telegram Bot Manager (POST /api/bots/create).
   * 1. Генерирует уникальный username с поддержкой транслитерации.
   * 2. Создает запись в channel_accounts со статусом 'pending' и официальным deep link.
   * 3. Возвращает конфигурацию бота со ссылкой t.me/newbot для подтверждения в Telegram.
   */
  async autoRegisterBot(tenantId: string, payload: BotCreateInput): Promise<BotConfigDTO> {
    const uniqueUsername = await this.generateUniqueName(payload.desired_username || payload.name);
    const managedResult = await this.createManaged(tenantId, {
      name: payload.name.trim(),
      username: uniqueUsername,
      agent_id: payload.agent_id ?? null,
    });

    return {
      id: managedResult.account.id,
      tenantId,
      name: managedResult.account.label,
      username: uniqueUsername,
      externalId: `@${uniqueUsername}`,
      token: null,
      status: managedResult.account.status,
      channelAccountId: managedResult.account.id,
      channelAccount: managedResult.account,
      agentId: payload.agent_id ?? null,
      deepLink: managedResult.deepLink,
      createdAt: managedResult.account.createdAt ?? new Date().toISOString(),
      updatedAt: managedResult.account.createdAt ?? new Date().toISOString(),
    };
  }

  /**
   * Активация бота в статусе pending (проверка подтверждения в Telegram).
   */
  async autoActivatePending(
    tenantId: string,
    accountId: string,
    customName?: string,
    inputToken?: string,
    inputBotId?: number | string,
  ): Promise<ChannelAccountDTO> {
    const result = await withTenant(tenantId, async (tx) => {
      const existing = await tx.queryOne<ChannelAccountRow>(
        `SELECT id, channel, label, external_id, status, status_message,
                (credentials <> '{}'::jsonb) AS has_credentials,
                credentials, remote_user_id, last_sync_at, connected_at, created_at
         FROM channel_accounts
         WHERE id = $1 AND tenant_id = $2 AND channel = 'telegram_bot' AND deleted_at IS NULL`,
        [accountId, tenantId],
      );

      if (!existing) {
        throw new NotFoundError("Аккаунт Telegram-бота не найден");
      }

      const creds = existing.credentials ?? {};
      const storedBotId = typeof creds.bot_id === "number" || typeof creds.bot_id === "string" ? creds.bot_id : null;
      let botId: number | string | null = inputBotId || storedBotId || existing.remote_user_id || null;

      if (!botId && inputToken) {
        const parts = inputToken.trim().split(":");
        const prefix = parts[0];
        if (parts.length === 2 && prefix !== undefined && /^\d+$/.test(prefix)) {
          botId = prefix;
        }
      }

      if (botId) {
        let realToken = inputToken?.trim() || null;
        if (!realToken) {
          realToken = await this.telegramService.getManagedBotToken(Number(botId));
        }

        if (realToken !== null) {
          const updatedCreds = {
            ...creds,
            token: realToken,
            bot_id: Number(botId),
            status: "connected",
            is_managed: true,
          };

          const label = customName?.trim() || existing.label;
          const updated = await tx.queryOneOrThrow<ChannelAccountRow>(
            `UPDATE channel_accounts
             SET status = 'connected',
                 status_message = 'Бот успешно активирован через Telegram Bot Manager',
                 label = $1,
                 remote_user_id = $2,
                 credentials = $3::jsonb,
                 connected_at = COALESCE(connected_at, now()),
                 updated_at = now()
             WHERE id = $4 AND tenant_id = $5
             RETURNING id, channel, label, external_id, status, status_message,
                       (credentials <> '{}'::jsonb) AS has_credentials,
                       credentials,
                       credentials->>'username' AS cred_username,
                       credentials->>'phone' AS cred_phone,
                       credentials->>'telegramBot' AS cred_bot,
                       false AS has_session,
                       remote_user_id, last_sync_at, connected_at, created_at`,
            [label, botId.toString(), JSON.stringify(updatedCreds), accountId, tenantId],
          );

          await tx.query(
            `INSERT INTO bots (tenant_id, name, username, token, status, channel_account_id, config)
             VALUES ($1, $2, $3, $4, 'connected', $5, $6::jsonb)
             ON CONFLICT (LOWER(username)) DO UPDATE
             SET status = 'connected', token = EXCLUDED.token, channel_account_id = EXCLUDED.channel_account_id, updated_at = now()`,
            [
              tenantId,
              label,
              existing.external_id.replace(/^@/, ""),
              realToken,
              accountId,
              JSON.stringify({ autoActivated: true, is_managed: true }),
            ],
          ).catch(() => {});

          return rowToAccountDTO(updated);
        }
      }

      throw new AppError(
        400,
        "BOT_NOT_CONFIRMED_IN_TELEGRAM",
        "Бот еще не подтвержден в Telegram. Откройте приложение Telegram по ссылке создания бота или укажите токен от @BotFather.",
      );
    });

    if (result.hasCredentials && result.credentials?.token) {
      const publicApiUrl = process.env.PUBLIC_API_URL || "https://api.getvoxly.ru";
      const webhookUrl = `${publicApiUrl.replace(/\/+$/, "")}/api/v1/integrations/telegram-bot/webhook/${accountId}`;
      void this.setWebhook(result.credentials.token as string, webhookUrl);
    }

    return result;
  }

  /**
   * Допустимые типы обновлений, включая Business updates для режима секретаря (Telegram Business).
   */
  static readonly ALLOWED_UPDATES = [
    "message",
    "edited_message",
    "business_connection",
    "business_message",
    "edited_business_message",
    "deleted_business_messages",
  ];

  /**
   * Получение текущей информации о webhook бота.
   */
  async getWebhookInfo(token: string): Promise<TelegramApiResponse<{
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    allowed_updates?: string[];
  }> | null> {
    const url = `${TELEGRAM_API_BASE}/bot${token.trim()}/getWebhookInfo`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      return (await res.json().catch(() => null)) as TelegramApiResponse<{
        url: string;
        has_custom_certificate: boolean;
        pending_update_count: number;
        allowed_updates?: string[];
      }> | null;
    } catch {
      return null;
    }
  }

  /**
   * Регистрация Webhook в Telegram Bot API.
   */
  async setWebhook(token: string, webhookUrl: string, secretToken?: string): Promise<boolean> {
    const url = `${TELEGRAM_API_BASE}/bot${token.trim()}/setWebhook`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: webhookUrl,
          drop_pending_updates: false,
          allowed_updates: TelegramBotService.ALLOWED_UPDATES,
          ...(secretToken ? { secret_token: secretToken } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as TelegramApiResponse<{ url: string }> | null;
      return Boolean(data?.ok);
    } catch {
      return false;
    }
  }

  /**
   * Отправка текстового сообщения в Telegram через Bot API.
   * Поддерживает business_connection_id для ответа от имени подключенного аккаунта (Telegram Business).
   */
  async sendMessage(
    token: string,
    chatId: string | number,
    text: string,
    options?: { parse_mode?: string; business_connection_id?: string },
  ): Promise<{ ok: boolean; messageId?: number; reason?: string }> {
    const url = `${TELEGRAM_API_BASE}/bot${token.trim()}/sendMessage`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          ...(options?.business_connection_id ? { business_connection_id: options.business_connection_id } : {}),
          ...(options?.parse_mode ? { parse_mode: options.parse_mode } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as TelegramApiResponse<{ message_id: number }> | null;
      if (data?.ok && data.result) {
        return { ok: true, messageId: data.result.message_id };
      }
      return { ok: false, reason: data?.description || `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : "Network error" };
    }
  }

  /**
   * Исходящее сообщение через Telegram Bot API (адаптер для OutboundRegistry).
   */
  async sendOutbound(message: OutboundMessage): Promise<OutboundSendResult> {
    const account = await queryOne<{
      credentials: { token?: string; business_connection_id?: string } | null;
    }>(
      `SELECT credentials FROM channel_accounts
       WHERE tenant_id = $1 AND id = $2 AND channel = 'telegram_bot' AND deleted_at IS NULL`,
      [message.tenantId, message.channelAccountId],
    );

    const token = account?.credentials?.token;
    if (!token) {
      return { ok: false, reason: "Бот не найден или не настроен токен" };
    }

    const businessConnectionId = account.credentials?.business_connection_id;

    if (message.attachment) {
      const isImage = message.attachmentType?.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(message.attachment);
      const endpoint = isImage ? "sendPhoto" : "sendDocument";
      const bodyField = isImage ? "photo" : "document";
      try {
        const res = await fetch(`${TELEGRAM_API_BASE}/bot${token.trim()}/${endpoint}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: message.recipient,
            ...(businessConnectionId ? { business_connection_id: businessConnectionId } : {}),
            [bodyField]: message.attachment,
            caption: message.text || undefined,
          }),
        });
        const data = (await res.json().catch(() => null)) as TelegramApiResponse<{ message_id: number }> | null;
        if (data?.ok) return { ok: true };
      } catch {
        // fallback to text
      }
    }

    const result = await this.sendMessage(token, message.recipient, message.text, {
      business_connection_id: businessConnectionId,
    });
    if (result.ok) {
      return { ok: true };
    }
    return { ok: false, reason: result.reason || "Ошибка отправки в Telegram" };
  }

  /**
   * Синхронизация webhook для всех активных подключенных ботов платформы на старте.
   * Сначала проверяет текущее состояние через getWebhookInfo, чтобы не тратить лимит Telegram API.
   */
  static async syncActiveWebhooks(log?: { info: (...args: any[]) => void; warn: (...args: any[]) => void }): Promise<void> {
    try {
      const { runWithPlatformScope, query: dbQuery } = await import("../../db/client.js");
      const accounts = await runWithPlatformScope(() =>
        dbQuery<{ id: string; credentials: { token?: string } | null; external_id: string }>(
          `SELECT id, credentials, external_id FROM channel_accounts
           WHERE channel = 'telegram_bot' AND status = 'connected' AND deleted_at IS NULL`,
        ),
      );

      const publicApiUrl = process.env.PUBLIC_API_URL || "https://api.getvoxly.ru";
      const service = new TelegramBotService();

      for (const acc of accounts) {
        const token = acc.credentials?.token;
        if (!token) continue;
        const webhookUrl = `${publicApiUrl.replace(/\/+$/, "")}/api/v1/integrations/telegram-bot/webhook/${acc.id}`;

        const info = await service.getWebhookInfo(token);
        if (info?.ok && info.result) {
          const isUrlMatching = info.result.url === webhookUrl;
          const allowed = info.result.allowed_updates || [];
          const hasBusinessUpdates =
            allowed.includes("business_message") && allowed.includes("business_connection");

          if (isUrlMatching && hasBusinessUpdates) {
            if (log) {
              log.info(
                { accountId: acc.id, bot: acc.external_id, webhookUrl },
                "Telegram Bot webhook already configured with business updates",
              );
            }
            continue;
          }
        }

        const ok = await service.setWebhook(token, webhookUrl);
        if (log) {
          log.info({ accountId: acc.id, bot: acc.external_id, ok, webhookUrl }, "Telegram Bot webhook synchronized");
        }
      }
    } catch (err) {
      if (log) {
        log.warn({ err }, "Failed to sync Telegram Bot webhooks on startup");
      }
    }
  }
}
