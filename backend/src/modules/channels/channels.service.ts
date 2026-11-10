import { query, queryOne, withTenant } from "../../db/client.js";
import { AppError, NotFoundError } from "../../plugins/errorHandler.js";
import type { ChannelSlug } from "../../types/index.js";
import { channelLinksService } from "./channel-links.service.js";
import { quotaService } from "../quotas/quota.service.js";
import {
  isValidDomain,
  normalizeDomain,
  type ChannelAccountDTO,
  type ChannelAccountLinksDTO,
  type ChannelStatus,
  type ChannelSummaryDTO,
  type CloneChannelAccountPayload,
  type CreateChannelAccountPayload,
  type CustomizeAccountLinksQuery,
  type UpdateChannelAccountPayload,
} from "./channels.types.js";

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

function toIso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

/** Склонение в тексте ошибки: «оплачено 1 подключение», а не «1 подключений». */
function pluralConnections(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "подключение";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "подключения";
  return "подключений";
}

function toDTO(row: ChannelAccountRow): ChannelAccountDTO {
  const links =
    row.channel !== "webchat"
      ? channelLinksService.resolveAccountLinks(row)
      : undefined;

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
 * `credentials` в выборках заменяется на булев признак: колонка содержит токены
 * доступа к чужим аккаунтам, и попадание их в ответ API означало бы утечку при
 * первом же логировании запроса на клиенте.
 */
const SELECT_COLUMNS = `id, channel, label, external_id, status, status_message,
        (credentials <> '{}'::jsonb) AS has_credentials,
        CASE WHEN channel = 'webchat' THEN credentials ELSE '{}'::jsonb END AS credentials,
        credentials->>'username' AS cred_username,
        credentials->>'phone' AS cred_phone,
        credentials->>'telegramBot' AS cred_bot,
        (credentials ? 'session') AS has_session,
        remote_user_id, last_sync_at, connected_at, created_at`;

/**
 * Каналы, у которых подключение идёт своим маршрутом авторизации.
 *
 * Telegram подключается только через MTProto (`/integrations/telegram/auth/*`):
 * аккаунт невозможно создать, просто записав строку — нужна сессия, полученная по
 * коду из приложения. Ручное создание оставило бы в списке запись без сессии,
 * которая выглядит подключённой, но не работает и занимает место по тарифу.
 */
const AUTH_MANAGED_CHANNELS: ReadonlySet<string> = new Set<ChannelSlug>(["telegram"]);

export class ChannelsService {
  /** Подключения одного канала. Удалённые скрыты: их вернёт только реактивация модуля. */
  async list(tenantId: string, channel: ChannelSlug): Promise<ChannelAccountDTO[]> {
    const rows = await query<ChannelAccountRow>(
      `SELECT c.id, c.channel, c.label, c.external_id, c.status, c.status_message,
              (c.credentials <> '{}'::jsonb) AS has_credentials,
              CASE WHEN c.channel = 'webchat' THEN c.credentials ELSE '{}'::jsonb END AS credentials,
              c.credentials->>'username' AS cred_username,
              c.credentials->>'phone' AS cred_phone,
              c.credentials->>'telegramBot' AS cred_bot,
              (c.credentials ? 'session') AS has_session,
              c.remote_user_id, c.last_sync_at, c.connected_at, c.created_at,
              b.agent_id AS bound_agent_id,
              a.name AS bound_agent_name
       FROM channel_accounts c
       LEFT JOIN LATERAL (
         SELECT agent_id FROM ai_agent_channel_bindings
         WHERE channel_account_id = c.id AND tenant_id = c.tenant_id AND is_enabled = true
         LIMIT 1
       ) b ON true
       LEFT JOIN ai_agents a ON a.id = b.agent_id AND a.deleted_at IS NULL
       WHERE c.tenant_id = $1 AND c.channel = $2 AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC`,
      [tenantId, channel],
    );

    return rows.map(toDTO);
  }

  /**
   * Получение и кастомизация ссылок подключения (Direct Link & Smart Tracking Link).
   */
  async getLinks(
    tenantId: string,
    channel: ChannelSlug,
    id: string,
    options?: CustomizeAccountLinksQuery,
  ): Promise<ChannelAccountLinksDTO> {
    const row = await queryOne<ChannelAccountRow>(
      `SELECT c.id, c.channel, c.label, c.external_id, c.status, c.status_message,
              (c.credentials <> '{}'::jsonb) AS has_credentials,
              CASE WHEN c.channel = 'webchat' THEN c.credentials ELSE '{}'::jsonb END AS credentials,
              c.credentials->>'username' AS cred_username,
              c.credentials->>'phone' AS cred_phone,
              c.credentials->>'telegramBot' AS cred_bot,
              (c.credentials ? 'session') AS has_session,
              c.remote_user_id, c.last_sync_at, c.connected_at, c.created_at
       FROM channel_accounts c
       WHERE c.tenant_id = $1 AND c.channel = $2 AND c.id = $3 AND c.deleted_at IS NULL`,
      [tenantId, channel, id],
    );

    if (row === null) throw new NotFoundError("Подключение не найдено");

    return channelLinksService.resolveAccountLinks(row, options);
  }

  /**
   * Сводка для шапки страницы.
   *
   * `quantity` берётся из `installed_modules`, а не считается по факту: это
   * оплаченное число аккаунтов, и расхождение с фактическим — то, что страница
   * обязана показать («2 из 3 оплаченных»).
   */
  async summary(tenantId: string, channel: ChannelSlug): Promise<ChannelSummaryDTO> {
    const row = await queryOne<{
      quantity: number | null;
      trial_ends_at: Date | string | null;
      included_units: number;
      connected_count: string;
      total: string;
    }>(
      `SELECT i.quantity,
              i.trial_ends_at,
              COALESCE(m.included_units, 0) AS included_units,
              (SELECT count(*)::text FROM channel_accounts c
                WHERE c.tenant_id = $1 AND c.channel = $2
                  AND c.deleted_at IS NULL AND c.status = 'connected') AS connected_count,
              (SELECT count(*)::text FROM channel_accounts c
                WHERE c.tenant_id = $1 AND c.channel = $2
                  AND c.deleted_at IS NULL) AS total
       FROM installed_modules i
       LEFT JOIN marketplace_modules m ON m.slug = i.slug
       WHERE i.tenant_id = $1 AND i.slug = $2`,
      [tenantId, channel],
    );

    const isFreeInPlan = (row?.included_units ?? 0) > 0;
    const trialEndsAt = isFreeInPlan ? null : toIso(row?.trial_ends_at ?? null);

    const featureKey = channel === "webchat" ? "webchat_widgets" : `${channel}_channels`;
    const quota = await quotaService.checkQuota(tenantId, featureKey);
    const effectiveQuantity = quota.isUnlimited ? 999999 : (quota.maxLimit ?? row?.quantity ?? 0);

    return {
      channel,
      quantity: effectiveQuantity,
      connectedCount: Number(row?.connected_count ?? 0),
      total: Number(row?.total ?? 0),
      trialEndsAt,
      // Модули с постоянными бесплатными квотами входят в базовый тариф навсегда
      trialActive: isFreeInPlan
        ? false
        : trialEndsAt !== null && new Date(trialEndsAt).getTime() > Date.now(),
      is_unlimited: quota.isUnlimited,
      isUnlimited: quota.isUnlimited,
    };
  }

  /**
   * Создание подключения.
   *
   * Лимит проверяется здесь, а не только в интерфейсе: число аккаунтов —
   * тарифная величина, и запрос можно отправить минуя UI, получив канал с пятью
   * подключениями по цене одного.
   */
  async create(
    tenantId: string,
    channel: ChannelSlug,
    payload: CreateChannelAccountPayload,
  ): Promise<ChannelAccountDTO> {
    if (AUTH_MANAGED_CHANNELS.has(channel)) {
      throw new AppError(
        400,
        "CHANNEL_REQUIRES_AUTH_FLOW",
        "Аккаунт Telegram подключается по коду из приложения: используйте мастер подключения.",
      );
    }

    return withTenant(tenantId, async (tx) => {
      const module = await tx.queryOne<{ quantity: number }>(
        `SELECT quantity FROM installed_modules WHERE tenant_id = $1 AND slug = $2`,
        [tenantId, channel],
      );

      // Гейт requireModule уже отклонил бы запрос при отключённом канале; это
      // защита от гонки между отключением и созданием в соседней вкладке.
      if (module === null) {
        throw new AppError(403, "MODULE_NOT_INSTALLED", "Канал не подключён в маркетплейсе");
      }

      // Повтор проверяется ДО лимита: при исчерпанном лимите повторная привязка
      // отдавала ошибку тарифа, хотя настоящая причина — что этот аккаунт уже
      // подключён (и именно он занимает место). Ошибка про тариф в этом случае
      // отправляла бы пользователя доплачивать за то, что у него уже есть.
      const duplicate = await tx.queryOne<{ id: string }>(
        `SELECT id FROM channel_accounts
         WHERE tenant_id = $1 AND channel = $2 AND external_id = $3 AND deleted_at IS NULL`,
        [tenantId, channel, payload.external_id],
      );

      if (duplicate !== null) {
        throw new AppError(
          409,
          "CHANNEL_ACCOUNT_EXISTS",
          "Этот аккаунт уже подключён к каналу",
        );
      }

      const used = await tx.queryOne<{ total: string }>(
        `SELECT count(*)::text AS total FROM channel_accounts
         WHERE tenant_id = $1 AND channel = $2 AND deleted_at IS NULL`,
        [tenantId, channel],
      );

      const featureKey = channel === "webchat" ? "webchat_widgets" : `${channel}_channels`;
      const quota = await quotaService.checkQuota(tenantId, featureKey);

      if (!quota.isUnlimited) {
        const effectiveLimit = quota.maxLimit ?? module.quantity;
        if (Number(used?.total ?? 0) >= effectiveLimit) {
          throw new AppError(
            403,
            "CHANNEL_LIMIT_REACHED",
            channel === "webchat"
              ? `Исчерпан лимит онлайн-виджетов (${effectiveLimit}). Для снятия ограничений обратитесь к администратору платформы.`
              : `По тарифу оплачено ${effectiveLimit} ${pluralConnections(effectiveLimit)}. Увеличьте количество в маркетплейсе или обратитесь к администратору.`,
            {
              limit: [
                `Лимит: ${effectiveLimit}, текущее количество: ${used?.total ?? 0}`,
              ],
            },
          );
        }
      }

      const defaultCredentials = channel === "webchat" ? {
        accentColor: "#F59E0B",
        theme: "auto",
        title: "Онлайн-консультант",
        greeting: "Здравствуйте! Чем я могу вам помочь?",
        placeholder: "Напишите сообщение...",
        position: "bottom-right",
        showTelegramBanner: false,
      } : {};

      const initialCredentials = { ...defaultCredentials, ...(payload.credentials ?? {}) };
      const initialStatus: ChannelStatus = channel === "webchat" ? "connected" : "pending";

      const row = await tx.queryOneOrThrow<ChannelAccountRow>(
        `INSERT INTO channel_accounts (tenant_id, channel, label, external_id, status, credentials, connected_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, CASE WHEN $5 = 'connected' THEN now() ELSE NULL END)
         RETURNING ${SELECT_COLUMNS}`,
        [
          tenantId,
          channel,
          payload.label,
          payload.external_id,
          initialStatus,
          JSON.stringify(initialCredentials),
        ],
      );

      if (payload.agent_id) {
        await tx.query(
          `INSERT INTO ai_agent_channel_bindings (tenant_id, agent_id, channel_account_id, is_enabled)
           VALUES ($1, $2, $3, TRUE)
           ON CONFLICT (agent_id, channel_account_id) DO UPDATE SET is_enabled = TRUE`,
          [tenantId, payload.agent_id, row.id],
        );
        const agentRow = await tx.queryOne<{ name: string }>(
          `SELECT name FROM ai_agents WHERE id = $1 AND tenant_id = $2`,
          [payload.agent_id, tenantId],
        );
        row.bound_agent_id = payload.agent_id;
        row.bound_agent_name = agentRow?.name ?? null;
      }

      return toDTO(row);
    });
  }

  /**
   * Клонирование (дублирование) существующего подключения/виджета.
   *
   * Все параметры дизайна, фраз приветствия, маскота, звуков и сценариев AI
   * копируются 1-в-1 из исходного виджета.
   * Для нового сайта генерируется отдельная изолированная запись с новым UUID.
   *
   * Безопасность:
   * - Запрос выполняется строго в контексте текущего tenantId (защита от IDOR/RLS).
   * - Проверяется лимит сайтов по тарифу / квотам (403/409 CHANNEL_LIMIT_REACHED).
   * - Проверяется отсутствие дубликата домена (409 CHANNEL_ACCOUNT_EXISTS).
   */
  async clone(
    tenantId: string,
    channel: ChannelSlug,
    sourceId: string,
    payload: CloneChannelAccountPayload,
  ): Promise<ChannelAccountDTO> {
    const rawDomain = payload.external_id || payload.site_url || payload.domain;
    if (!rawDomain) {
      throw new AppError(400, "INVALID_DOMAIN", "Укажите адрес сайта или домен для клонированного виджета");
    }

    const domain = normalizeDomain(rawDomain);
    if (!isValidDomain(domain)) {
      throw new AppError(
        400,
        "INVALID_DOMAIN_FORMAT",
        "Некорректный формат адреса сайта (укажите домен, например: new-shop.ru или sub.company.ru)",
      );
    }

    return withTenant(tenantId, async () => {
      // 1. Получаем исходный виджет строго в контексте тенанта (проверка RLS/IDOR)
      const source = await this.get(tenantId, channel, sourceId);
      if (!source) {
        throw new NotFoundError("Исходный виджет не найден");
      }

      // 2. Запрет клонирования на точно такой же домен
      if (normalizeDomain(source.externalId) === domain) {
        throw new AppError(
          400,
          "SAME_DOMAIN_CLONE",
          "Для клонирования укажите новый адрес сайта, отличный от исходного",
        );
      }

      // 3. Формируем название: если не передано, берем "[Название оригинала] (Копия)"
      const newLabel = payload.label?.trim() || `${source.label} (Копия)`;

      // 4. Привязка AI-ассистента: если явно передана в payload — используем ее, иначе копируем из оригинала
      const targetAgentId = payload.agent_id !== undefined ? payload.agent_id : source.boundAgentId;

      // 5. Глубокое клонирование всех настроек внешнего вида и параметров виджета
      const clonedCredentials = source.credentials
        ? (JSON.parse(JSON.stringify(source.credentials)) as Record<string, unknown>)
        : {};

      // 6. Создаем новую изолированную запись с новым UUID через create()
      return this.create(tenantId, channel, {
        label: newLabel,
        external_id: domain,
        credentials: clonedCredentials,
        agent_id: targetAgentId,
      });
    });
  }

  async get(tenantId: string, channel: ChannelSlug, id: string): Promise<ChannelAccountDTO> {
    const row = await queryOne<ChannelAccountRow>(
      `SELECT ${SELECT_COLUMNS}
       FROM channel_accounts
       WHERE tenant_id = $1 AND channel = $2 AND id = $3 AND deleted_at IS NULL`,
      [tenantId, channel, id],
    );

    if (row === null) throw new NotFoundError("Подключение не найдено");

    const bound = await queryOne<{ agent_id: string; name: string }>(
      `SELECT a.id AS agent_id, a.name
       FROM ai_agent_channel_bindings b
       JOIN ai_agents a ON a.id = b.agent_id
       WHERE b.tenant_id = $1 AND b.channel_account_id = $2 AND b.is_enabled = true
       LIMIT 1`,
      [tenantId, id],
    );
    row.bound_agent_id = bound?.agent_id ?? null;
    row.bound_agent_name = bound?.name ?? null;

    return toDTO(row);
  }

  async toggleStatus(tenantId: string, channel: ChannelSlug, id: string): Promise<ChannelAccountDTO> {
    const current = await this.get(tenantId, channel, id);
    const nextStatus: ChannelStatus = current.status === "disabled" ? "connected" : "disabled";
    return this.update(tenantId, channel, id, { status: nextStatus, is_enabled: nextStatus === "connected" });
  }

  /**
   * Изменение подключения.
   *
   * `connected_at` выставляется вместе с переходом в `connected` и только при
   * первом переходе: иначе повторная авторизация переписывала бы дату привязки, а
   * она нужна в таблице как «с какого момента канал работает».
   */
  async update(
    tenantId: string,
    channel: ChannelSlug,
    id: string,
    payload: UpdateChannelAccountPayload,
  ): Promise<ChannelAccountDTO> {
    const statusToSet =
      payload.status ??
      (payload.is_enabled !== undefined
        ? payload.is_enabled
          ? "connected"
          : "disabled"
        : null);

    const row = await queryOne<ChannelAccountRow>(
      `UPDATE channel_accounts SET
         label = COALESCE($4, label),
         status = COALESCE($5, status),
         status_message = COALESCE($6, status_message),
         credentials = CASE
           WHEN $7::jsonb IS NOT NULL THEN credentials || $7::jsonb
           ELSE credentials
         END,
         connected_at = CASE
           WHEN $5 = 'connected' AND connected_at IS NULL THEN now()
           ELSE connected_at
         END
       WHERE tenant_id = $1 AND channel = $2 AND id = $3 AND deleted_at IS NULL
       RETURNING ${SELECT_COLUMNS}`,
      [
        tenantId,
        channel,
        id,
        payload.label ?? null,
        statusToSet,
        payload.status_message ?? null,
        payload.credentials === undefined ? null : JSON.stringify(payload.credentials),
      ],
    );

    if (row === null) throw new NotFoundError("Подключение не найдено");

    if (payload.agent_id !== undefined) {
      await withTenant(tenantId, async (tx) => {
        await tx.query(
          `DELETE FROM ai_agent_channel_bindings WHERE tenant_id = $1 AND channel_account_id = $2`,
          [tenantId, id],
        );
        if (payload.agent_id) {
          await tx.query(
            `INSERT INTO ai_agent_channel_bindings (tenant_id, agent_id, channel_account_id, is_enabled)
             VALUES ($1, $2, $3, TRUE)
             ON CONFLICT (agent_id, channel_account_id) DO UPDATE SET is_enabled = TRUE`,
            [tenantId, payload.agent_id, id],
          );
        }
      });
    }

    const bound = await queryOne<{ agent_id: string; name: string }>(
      `SELECT a.id AS agent_id, a.name
       FROM ai_agent_channel_bindings b
       JOIN ai_agents a ON a.id = b.agent_id
       WHERE b.tenant_id = $1 AND b.channel_account_id = $2 AND b.is_enabled = true
       LIMIT 1`,
      [tenantId, id],
    );
    row.bound_agent_id = bound?.agent_id ?? null;
    row.bound_agent_name = bound?.name ?? null;

    return toDTO(row);
  }

  /**
   * Отключение аккаунта.
   *
   * Мягкое удаление, как у остальных данных: на аккаунт канала со временем будут
   * ссылаться сообщения, и жёсткое удаление оставило бы переписку без источника.
   */
  async remove(tenantId: string, channel: ChannelSlug, id: string): Promise<void> {
    const row = await queryOne<{ id: string }>(
      `UPDATE channel_accounts SET deleted_at = now()
       WHERE tenant_id = $1 AND channel = $2 AND id = $3 AND deleted_at IS NULL
       RETURNING id`,
      [tenantId, channel, id],
    );

    if (row === null) throw new NotFoundError("Подключение не найдено");
  }
}
