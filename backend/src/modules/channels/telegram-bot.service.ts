import { getEnv } from "../../config/env.js";
import { withTenant } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import { toIsoOrNull as toIso } from "../../lib/date.utils.js";
import { pluralRu } from "../../lib/string.utils.js";
import type { ChannelSlug } from "../../types/index.js";
import { quotaService } from "../quotas/quota.service.js";
import { channelLinksService } from "./channel-links.service.js";
import type {
  ChannelAccountDTO,
  ChannelStatus,
} from "./channels.types.js";
import type {
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

export class TelegramBotService {
  private readonly managerUsername: string;

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
    const timeout = setTimeout(() => controller.abort(), 10_000);

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
      const message = err instanceof Error ? err.message : "Неизвестная сетевая ошибка";
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

    return withTenant(tenantId, async (tx) => {
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
    const botInfo = await this.getMe(payload.token);
    const cleanUsername = botInfo.username.replace(/^@/, "").trim();
    const externalId = `@${cleanUsername}`;

    return withTenant(tenantId, async (tx) => {
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
        token: payload.token.trim(),
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
  }
}
