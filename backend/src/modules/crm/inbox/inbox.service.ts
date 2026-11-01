import { query } from "../../../db/client.js";
import type { InboxQueryParams, InboxThreadDTO } from "./inbox.types.js";

interface RawInboxRow {
  deal_id: string;
  deal_title: string;
  deal_budget: string | number;
  stage_name: string | null;
  contact_id: string | null;
  contact_name: string;
  contact_phone: string;
  telegram_username: string;
  last_channel: string;
  last_message: string;
  last_message_at: string;
  last_sender_name: string;
  last_direction: "inbound" | "outbound" | "neutral";
  unread_count: number | string;
}

export class InboxService {
  async listThreads(
    tenantId: string,
    params: InboxQueryParams,
  ): Promise<{ items: InboxThreadDTO[]; total: number }> {
    const channelFilter =
      params.channel && params.channel !== "all" ? params.channel.toLowerCase() : null;
    const unreadOnly = params.unread_only ?? false;
    const search = params.search ? params.search.trim() : null;
    const limit = params.limit ?? 50;
    const offset = params.offset ?? 0;

    const rows = await query<RawInboxRow>(
      `SELECT 
         d.id AS deal_id,
         d.title AS deal_title,
         d.budget AS deal_budget,
         COALESCE(s.name, 'Новый лид') AS stage_name,
         c.id AS contact_id,
         COALESCE(NULLIF(TRIM(CONCAT(c.first_name, ' ', c.last_name)), ''), c.phone, c.telegram_username, 'Клиент') AS contact_name,
         COALESCE(c.phone, '') AS contact_phone,
         COALESCE(c.telegram_username, '') AS telegram_username,
         COALESCE(last_msg.channel, 'chat') AS last_channel,
         COALESCE(last_msg.content, 'Нет сообщений') AS last_message,
         COALESCE(last_msg.created_at, d.created_at)::text AS last_message_at,
         COALESCE(last_msg.sender_name, '') AS last_sender_name,
         COALESCE(last_msg.direction, 'neutral') AS last_direction,
         CASE WHEN last_msg.direction = 'inbound' THEN 1 ELSE 0 END AS unread_count
       FROM deals d
       LEFT JOIN LATERAL (
         SELECT dm.channel, dm.content, dm.created_at, dm.sender_name, dm.direction
         FROM deal_messages dm
         WHERE dm.deal_id = d.id AND dm.tenant_id = d.tenant_id
         ORDER BY dm.created_at DESC
         LIMIT 1
       ) last_msg ON true
       LEFT JOIN stages s ON s.id = d.stage_id
       LEFT JOIN contacts c ON c.id = d.contact_id AND c.tenant_id = d.tenant_id
       WHERE d.tenant_id = $1 AND d.deleted_at IS NULL
         AND ($2::text IS NULL OR last_msg.channel = $2)
         AND ($3::boolean IS NOT TRUE OR last_msg.direction = 'inbound')
         AND ($4::text IS NULL OR (
           d.title ILIKE '%' || $4 || '%' OR
           c.first_name ILIKE '%' || $4 || '%' OR
           c.last_name ILIKE '%' || $4 || '%' OR
           c.phone ILIKE '%' || $4 || '%' OR
           last_msg.content ILIKE '%' || $4 || '%'
         ))
       ORDER BY COALESCE(last_msg.created_at, d.created_at) DESC
       LIMIT $5 OFFSET $6`,
      [tenantId, channelFilter, unreadOnly, search, limit, offset],
    );

    const items: InboxThreadDTO[] = rows.map((r) => ({
      id: r.deal_id,
      dealId: r.deal_id,
      dealTitle: r.deal_title,
      dealBudget: Number(r.deal_budget ?? 0),
      stageName: r.stage_name ?? "Новый лид",
      contactId: r.contact_id,
      contactName: r.contact_name,
      contactPhone: r.contact_phone,
      telegramUsername: r.telegram_username,
      channel: r.last_channel,
      lastMessage: r.last_message,
      lastMessageAt: r.last_message_at,
      lastSenderName: r.last_sender_name,
      lastDirection: r.last_direction,
      unreadCount: Number(r.unread_count ?? 0),
    }));

    return { items, total: items.length };
  }
}
