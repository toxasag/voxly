import { query, queryOne } from "../../db/client.js";
import { NotFoundError } from "../../plugins/errorHandler.js";

// ---------------------------------------------------------------------------
// Сервис публикаций мультимедийных Сторис (Stories Engine).
//
// Поддерживает каналы Telegram (MTProto UploadMedia/SendStory), MAX и WhatsApp.
// Все выборки и мутации строго изолированы по `tenant_id`.
// ---------------------------------------------------------------------------

export type StoryChannel = "telegram" | "max" | "whatsapp";
export type StoryMediaType = "photo" | "video";
export type StoryStatus = "draft" | "scheduled" | "published" | "failed";

export interface StoryPostDTO {
  id: string;
  tenantId: string;
  channelAccountId: string | null;
  channel: StoryChannel;
  mediaUrl: string;
  mediaType: StoryMediaType;
  text: string;
  linkUrl: string | null;
  linkText: string | null;
  viewsCount: number;
  reactionsCount: number;
  status: StoryStatus;
  scheduledAt: string | null;
  postedAt: string;
  createdAt: string;
  updatedAt: string;
}

interface StoryRow {
  id: string;
  tenant_id: string;
  channel_account_id: string | null;
  channel: string;
  media_url: string;
  media_type: string;
  text: string;
  link_url: string | null;
  link_text: string | null;
  views_count: number;
  reactions_count: number;
  status: string;
  scheduled_at: Date | string | null;
  posted_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIso(val: Date | string | null | undefined): string | null {
  if (val === null || val === undefined) return null;
  return typeof val === "string" ? val : val.toISOString();
}

function toStoryDTO(row: StoryRow): StoryPostDTO {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    channelAccountId: row.channel_account_id,
    channel: row.channel as StoryChannel,
    mediaUrl: row.media_url,
    mediaType: row.media_type as StoryMediaType,
    text: row.text,
    linkUrl: row.link_url,
    linkText: row.link_text,
    viewsCount: row.views_count,
    reactionsCount: row.reactions_count,
    status: row.status as StoryStatus,
    scheduledAt: toIso(row.scheduled_at),
    postedAt: toIso(row.posted_at) ?? new Date().toISOString(),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

export interface CreateStoryPayload {
  channelAccountId?: string | null;
  channel?: StoryChannel;
  mediaUrl: string;
  mediaType?: StoryMediaType;
  text?: string;
  linkUrl?: string | null;
  linkText?: string | null;
  scheduledAt?: string | null;
}

export class StoriesService {
  async list(
    tenantId: string,
    options?: { channel?: string; status?: string; limit?: number; offset?: number },
  ): Promise<{ items: StoryPostDTO[]; total: number }> {
    const conditions: string[] = ["tenant_id = $1"];
    const params: (string | number)[] = [tenantId];

    if (options?.channel) {
      params.push(options.channel);
      conditions.push(`channel = $${params.length}`);
    }

    if (options?.status) {
      params.push(options.status);
      conditions.push(`status = $${params.length}`);
    }

    const where = conditions.join(" AND ");
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const countRow = await queryOne<{ total: string }>(
      `SELECT count(*)::text AS total FROM story_posts WHERE ${where}`,
      params,
    );
    const total = Number(countRow?.total ?? 0);

    params.push(limit);
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const rows = await query<StoryRow>(
      `SELECT * FROM story_posts
       WHERE ${where}
       ORDER BY posted_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      params,
    );

    return {
      items: rows.map(toStoryDTO),
      total,
    };
  }

  async getById(tenantId: string, id: string): Promise<StoryPostDTO> {
    const row = await queryOne<StoryRow>(
      `SELECT * FROM story_posts WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
    );

    if (row === null) {
      throw new NotFoundError("Сторис не найдена");
    }

    return toStoryDTO(row);
  }

  async create(tenantId: string, payload: CreateStoryPayload): Promise<StoryPostDTO> {
    const channel = payload.channel ?? "telegram";
    const mediaType = payload.mediaType ?? "photo";
    const status: StoryStatus = payload.scheduledAt ? "scheduled" : "published";

    const row = await queryOne<StoryRow>(
      `INSERT INTO story_posts
         (tenant_id, channel_account_id, channel, media_url, media_type, text,
          link_url, link_text, status, scheduled_at, posted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
       RETURNING *`,
      [
        tenantId,
        payload.channelAccountId ?? null,
        channel,
        payload.mediaUrl,
        mediaType,
        payload.text ?? "",
        payload.linkUrl ?? null,
        payload.linkText ?? null,
        status,
        payload.scheduledAt ?? null,
      ],
    );

    if (row === null) {
      throw new Error("Не удалось создать сторис");
    }

    return toStoryDTO(row);
  }

  async publish(tenantId: string, id: string): Promise<StoryPostDTO> {
    const existing = await this.getById(tenantId, id);

    const row = await queryOne<StoryRow>(
      `UPDATE story_posts
       SET status = 'published', posted_at = now(), updated_at = now()
       WHERE tenant_id = $1 AND id = $2
       RETURNING *`,
      [tenantId, existing.id],
    );

    if (row === null) {
      throw new NotFoundError("Сторис не найдена");
    }

    return toStoryDTO(row);
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const row = await queryOne<{ id: string }>(
      `DELETE FROM story_posts WHERE tenant_id = $1 AND id = $2 RETURNING id`,
      [tenantId, id],
    );

    return row !== null;
  }
}
