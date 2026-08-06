// Voxly Analytics Dispatchers
// Send conversion events to Yandex Metrika, GA4, Facebook CAPI, VK Pixel
// Each dispatcher checks if the tenant has an active add-on before sending.

import { prisma } from '@voxly/db';
import { encryptJSON, decryptJSON } from '@voxly/crypto';
import type { AnalyticsPlatform } from '@voxly/shared';

export interface FireGoalParams {
  tenantId: string;
  goalName: string;
  subscriberId?: string;
  /** Gift / AI bot that produced the goal (for admin funnel rollups) */
  botInstanceId?: string;
  /** GiftCampaignConfig id when the goal belongs to a gift funnel */
  campaignId?: string;
  /** Link ConversionEvent → AttributionSession when known */
  attributionId?: string;
  attribution?: {
    yclid?: string;
    ymUid?: string;
    fbp?: string;
    fbc?: string;
    gclid?: string;
    rbClickid?: string;
    utmSource?: string;
    utmMedium?: string;
    utmCampaign?: string;
  };
  /** Extra fields stored on ConversionEvent.payload (merged with attribution) */
  payload?: Record<string, unknown>;
  value?: number;
  currency?: string;
}

export interface PlatformResult {
  platform: AnalyticsPlatform;
  status: 'sent' | 'failed' | 'skipped_unpaid' | 'skipped_no_credentials';
  error?: string;
}

/**
 * Main entry point: fire a goal to all configured + paid platforms
 */
export async function fireGoal(params: FireGoalParams): Promise<PlatformResult[]> {
  const integrations = await prisma.analyticsIntegration.findMany({
    where: {
      tenantId: params.tenantId,
      isActive: true,
    },
    include: { addon: true },
  });

  const results: PlatformResult[] = [];

  for (const integration of integrations) {
    // Check if add-on is active (paid)
    if (!integration.addon || integration.addon.status !== 'active') {
      results.push({
        platform: integration.platform,
        status: 'skipped_unpaid',
      });
      continue;
    }

    if (!integration.credentialsEncrypted) {
      results.push({
        platform: integration.platform,
        status: 'skipped_no_credentials',
      });
      continue;
    }

    try {
      const credentials = decryptCredentials(integration.credentialsEncrypted);

      switch (integration.platform) {
        case 'metrika':
          await dispatchMetrika(credentials, params);
          break;
        case 'ga4':
          await dispatchGA4(credentials, params);
          break;
        case 'facebook':
          await dispatchFacebook(credentials, params);
          break;
        case 'vk':
          await dispatchVK(credentials, params);
          break;
      }

      results.push({ platform: integration.platform, status: 'sent' });
    } catch (err) {
      results.push({
        platform: integration.platform,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Log the conversion event
  const platformsStatus: Record<string, string> = {};
  for (const r of results) {
    platformsStatus[r.platform] = r.status;
  }

  await prisma.conversionEvent.create({
    data: {
      tenantId: params.tenantId,
      goalName: params.goalName,
      subscriberId: params.subscriberId,
      botInstanceId: params.botInstanceId,
      campaignId: params.campaignId,
      attributionId: params.attributionId || undefined,
      platformsStatus,
      status: results.every((r) => r.status === 'sent')
        ? 'sent'
        : results.some((r) => r.status === 'sent')
          ? 'partial'
          : 'failed',
      payload: {
        ...(params.attribution || {}),
        ...(params.payload || {}),
      } as any,
    },
  });

  return results;
}

// ============================================================
// Yandex Metrika — Offline Conversions API
// ============================================================

interface MetrikaCredentials {
  counterId: string;
  oauthToken: string;
  goalIds: Record<string, string>; // goalName -> goal_id
}

async function dispatchMetrika(creds: MetrikaCredentials, params: FireGoalParams): Promise<void> {
  const goalId = creds.goalIds[params.goalName];
  if (!goalId) return; // No mapping for this goal

  // Use CHATS type for Telegram (ChatUserID = telegram_id)
  const csvLines: string[] = [];

  if (params.attribution?.yclid) {
    // Offline conversion via yclid
    csvLines.push(`ClientId,Target,DateTime\n${params.attribution.yclid},${goalId},${Math.floor(Date.now() / 1000)}`);
  } else {
    // Chat-based conversion (type=CHATS)
    csvLines.push(`ClientID,DateTime,ChatPlatform,ChatUserID,ChatAnswered,Tag,Price,Currency\n${params.attribution?.ymUid || ''},${Math.floor(Date.now() / 1000)},telegram,${params.subscriberId || ''},1,${params.goalName},${params.value || ''},${params.currency || 'RUB'}`);
  }

  const csv = csvLines.join('\n');
  const type = params.attribution?.yclid ? 'BASIC' : 'CHATS';
  const formData = new FormData();
  formData.append('file', new Blob([csv], { type: 'text/csv' }), 'conversions.csv');

  const response = await fetch(
    `https://api-metrika.yandex.net/management/v1/counter/${creds.counterId}/offline_conversions/upload?type=${type}`,
    {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${creds.oauthToken}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    throw new Error(`Metrika API error: ${response.status} ${await response.text()}`);
  }
}

// ============================================================
// Google Analytics 4 — Measurement Protocol
// ============================================================

interface GA4Credentials {
  measurementId: string;
  apiSecret: string;
  clientId: string; // default or from _ga cookie
}

async function dispatchGA4(creds: GA4Credentials, params: FireGoalParams): Promise<void> {
  const url = `https://www.google-analytics.com/mp/collect?measurement_id=${creds.measurementId}&api_secret=${creds.apiSecret}`;

  const payload = {
    client_id: creds.clientId,
    events: [
      {
        name: params.goalName,
        params: {
          value: params.value || 0,
          currency: params.currency || 'RUB',
          ...(params.attribution?.utmSource ? { source: params.attribution.utmSource } : {}),
          ...(params.attribution?.utmMedium ? { medium: params.attribution.utmMedium } : {}),
          ...(params.attribution?.utmCampaign ? { campaign: params.attribution.utmCampaign } : {}),
        },
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`GA4 MP error: ${response.status}`);
  }
}

// ============================================================
// Facebook / Meta — Conversions API
// ============================================================

interface FacebookCredentials {
  pixelId: string;
  accessToken: string;
  eventMappings: Record<string, string>; // goalName -> FB event name
}

async function dispatchFacebook(creds: FacebookCredentials, params: FireGoalParams): Promise<void> {
  const fbEvent = creds.eventMappings[params.goalName];
  if (!fbEvent) return;

  const url = `https://graph.facebook.com/v20.0/${creds.pixelId}/events?access_token=${creds.accessToken}`;

  const eventData = {
    data: [
      {
        event_name: fbEvent,
        event_time: Math.floor(Date.now() / 1000),
        action_source: 'system',
        event_id: `${params.tenantId}_${params.goalName}_${Date.now()}`,
        user_data: {
          ...(params.attribution?.fbc ? { fbc: params.attribution.fbc } : {}),
          ...(params.attribution?.fbp ? { fbp: params.attribution.fbp } : {}),
          ...(params.subscriberId ? { external_id: hashId(params.subscriberId) } : {}),
        },
        custom_data: {
          value: params.value || 0,
          currency: params.currency || 'RUB',
          source: 'voxly_bot',
          goal: params.goalName,
        },
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventData),
  });

  if (!response.ok) {
    throw new Error(`Facebook CAPI error: ${response.status} ${await response.text()}`);
  }
}

// ============================================================
// VK Pixel — Server-to-Server
// ============================================================

interface VKCredentials {
  pixelId: string;
  goalMappings: Record<string, string>; // goalName -> VK goal name (e.g. "RG:lead")
}

async function dispatchVK(creds: VKCredentials, params: FireGoalParams): Promise<void> {
  const vkGoal = creds.goalMappings[params.goalName];
  if (!vkGoal) return;

  const encodedGoal = encodeURIComponent(`RG:${vkGoal}`);
  const userId = params.attribution?.rbClickid || params.subscriberId || '';

  const url = `https://top-fwz1.mail.ru/tracker?id=${creds.pixelId};e=${encodedGoal};userid=${userId}`;

  const response = await fetch(url, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`VK pixel S2S error: ${response.status}`);
  }
}

// ============================================================
// Helpers
// ============================================================

function decryptCredentials(encrypted: string): any {
  return decryptJSON<any>(encrypted);
}

async function hashId(id: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(id).digest('hex');
}

/**
 * Encrypt credentials before storing in DB
 */
export function encryptCredentials(credentials: any): string {
  return encryptJSON(credentials);
}
