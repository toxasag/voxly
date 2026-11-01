import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { query, queryOne, runWithPlatformScope } from "../../db/client.js";
import type { ChannelSlug } from "../../types/index.js";
import { channelLinksService } from "./channel-links.service.js";

const accountParamSchema = z.object({
  accountId: z.string().uuid("accountId must be a valid UUID"),
});

function stringParam(val: unknown, maxLen = 255): string | null {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

interface ChannelAccountRow {
  id: string;
  tenant_id: string;
  channel: ChannelSlug;
  label: string;
  external_id: string;
  credentials?: Record<string, unknown>;
  remote_user_id: string | null;
  status: string;
}

export default async function trackingRedirectRoutes(app: FastifyInstance): Promise<void> {
  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = accountParamSchema.safeParse(request.params);
    if (!parseResult.success) {
      return reply.redirect("https://getvoxly.ru", 302);
    }

    const { accountId } = parseResult.data;
    const queryParams = (request.query as Record<string, unknown>) || {};

    const utmSource = stringParam(queryParams.utm_source);
    const utmMedium = stringParam(queryParams.utm_medium);
    const utmCampaign = stringParam(queryParams.utm_campaign);
    const utmTerm = stringParam(queryParams.utm_term);
    const btnTag = stringParam(queryParams.btn || queryParams.tag, 100);
    const customText = stringParam(queryParams.text || queryParams.msg, 1000);
    const visitorName = stringParam(queryParams.name, 120);

    const utmContent = stringParam(queryParams.utm_content) || (btnTag ? `btn_${btnTag}` : null);

    const ymClientId = stringParam(queryParams.ym_client_id || queryParams.ym_uid || queryParams._ym_uid, 64);
    const gaClientId = stringParam(queryParams.ga_client_id || queryParams.ga_uid || queryParams._ga, 64);
    const yandexuid = stringParam(queryParams.yandexuid, 64);
    const yclid = stringParam(queryParams.yclid, 128);
    const gclid = stringParam(queryParams.gclid, 128);
    const fbclid = stringParam(queryParams.fbclid, 128);
    const vkclid = stringParam(queryParams.vkclid, 128);

    const rawReferrer = stringParam(queryParams.referrer, 2048) || stringParam(request.headers.referer, 2048);
    const rawPageUrl = stringParam(queryParams.page_url, 2048) || rawReferrer;

    // Читаем аккаунт в platform_scope (публичный редиректор внешнего трафика)
    let account: ChannelAccountRow | null = null;
    try {
      account = await runWithPlatformScope(async () => {
        return queryOne<ChannelAccountRow>(
          `SELECT id, tenant_id, channel, label, external_id, credentials, remote_user_id, status
           FROM channel_accounts
           WHERE id = $1 AND deleted_at IS NULL`,
          [accountId],
        );
      });
    } catch (err) {
      app.log.warn({ err, accountId }, "Smart tracking redirect: DB query failure, falling back to homepage");
      return reply.redirect("https://getvoxly.ru", 302);
    }

    if (!account) {
      app.log.warn({ accountId }, "Smart tracking redirect: channel account not found");
      return reply.redirect("https://getvoxly.ru", 302);
    }

    const sessionToken = `ref_${randomBytes(8).toString("hex")}`;
    const prechatLeadCode = `vx-${randomBytes(2).toString("hex")}`;

    // Формируем целевую deep link ссылку
    const destinationUrl = channelLinksService.buildDestinationDeepLink(account, {
      sessionToken,
      prechatLeadCode,
      text: customText,
      btn: btnTag,
    });

    const messengerType =
      account.channel === "telegram_bot"
        ? "telegram"
        : account.channel === "max_bot"
          ? "max"
          : account.channel;

    const initialMessage = customText
      ? `${customText} (код: ${prechatLeadCode})`
      : `Здравствуйте! (код: ${prechatLeadCode})`;

    // Сохраняем сессию в analytics_sessions
    try {
      await runWithPlatformScope(async () => {
        await query(
          `INSERT INTO analytics_sessions (
             tenant_id, session_token, ga_client_id, ym_client_id, yandexuid,
             gclid, yclid, fbclid, vkclid, utm_source, utm_medium, utm_campaign,
             utm_content, utm_term, referrer, page_url, channel_account_id,
             messenger_type, status, prechat_lead_code, prechat_name, prechat_message, ab_variant
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'clicked', $19, $20, $21, 'direct')`,
          [
            account.tenant_id,
            sessionToken,
            gaClientId,
            ymClientId,
            yandexuid,
            gclid,
            yclid,
            fbclid,
            vkclid,
            utmSource,
            utmMedium,
            utmCampaign,
            utmContent,
            utmTerm,
            rawReferrer,
            rawPageUrl,
            account.id,
            messengerType,
            prechatLeadCode,
            visitorName,
            initialMessage,
          ],
        );
      });
    } catch (err) {
      app.log.error(
        { err, accountId, sessionToken },
        "Failed to persist analytics session for smart tracking redirect",
      );
    }

    return reply
      .header("Cache-Control", "no-cache, no-store, must-revalidate")
      .header("Pragma", "no-cache")
      .header("Expires", "0")
      .redirect(destinationUrl, 302);
  };

  app.get("/:accountId", handler);
  app.get("/", async (_req, reply) => reply.redirect("https://getvoxly.ru", 302));
}
