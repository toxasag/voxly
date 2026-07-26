import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { GET_MAILING_CONTEXT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { fetchVoxlyApiJson } from 'src/logic-functions/voxly-proxy';

type BotRow = {
  id: string;
  botUsername?: string | null;
  name?: string | null;
  botType?: string;
  status?: string;
  hasGiftCampaign?: boolean;
  subscriberCount?: number;
};

const handler = async () => {
  const [botsRes, billingRes] = await Promise.all([
    fetchVoxlyApiJson({ method: 'GET', path: '/api/bots' }),
    fetchVoxlyApiJson({ method: 'GET', path: '/api/bots/mailing/billing' }),
  ]);

  if (botsRes.status >= 400) {
    return new Response(botsRes.data, { status: botsRes.status });
  }
  if (billingRes.status >= 400) {
    return new Response(billingRes.data, { status: billingRes.status });
  }

  const botsPayload = (botsRes.data || {}) as { bots?: BotRow[] };
  const giftBots = (botsPayload.bots || [])
    .filter((b) => b.botType === 'gift')
    .map((b) => ({
      id: b.id,
      botUsername: b.botUsername || null,
      name: (b as { displayName?: string | null }).displayName || b.name || null,
      status: b.status || null,
      hasGiftCampaign: Boolean(b.hasGiftCampaign),
      subscriberCount: Number(b.subscriberCount) || 0,
    }));

  return new Response(
    {
      bots: giftBots,
      billing: billingRes.data,
    },
    { status: 200 },
  );
};

export default defineLogicFunction({
  universalIdentifier: GET_MAILING_CONTEXT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-mailing-context',
  description: 'Gift bots + mailing_bot billing for in-CRM Рассылка panel',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/mailing/context',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
