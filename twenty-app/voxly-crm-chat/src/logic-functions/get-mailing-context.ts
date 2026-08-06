import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { GET_MAILING_CONTEXT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { fetchVoxlyApiJson } from 'src/logic-functions/voxly-proxy';

type BotRow = {
  id: string;
  botUsername?: string | null;
  displayName?: string | null;
  name?: string | null;
  botType?: string;
  status?: string;
  hasGiftCampaign?: boolean;
  subscriberCount?: number;
};

function mapBot(b: BotRow) {
  return {
    id: b.id,
    botUsername: b.botUsername || null,
    name: b.displayName || b.name || null,
    displayName: b.displayName || b.name || null,
    status: b.status || null,
    hasGiftCampaign: Boolean(b.hasGiftCampaign),
    subscriberCount: Number(b.subscriberCount) || 0,
    botType: b.botType || null,
  };
}

const handler = async () => {
  const [botsRes, billingRes, stagesRes] = await Promise.all([
    fetchVoxlyApiJson({ method: 'GET', path: '/api/bots' }),
    fetchVoxlyApiJson({ method: 'GET', path: '/api/bots/mailing/billing' }),
    fetchVoxlyApiJson({ method: 'GET', path: '/api/bots/mailing/stage-rules' }),
  ]);

  if (botsRes.status >= 400) {
    return new Response(botsRes.data, { status: botsRes.status });
  }
  if (billingRes.status >= 400) {
    return new Response(billingRes.data, { status: billingRes.status });
  }

  const botsPayload = (botsRes.data || {}) as { bots?: BotRow[] };
  const bots = botsPayload.bots || [];
  const stagesPayload = (stagesRes.data || {}) as {
    stages?: { value: string; label: string }[];
  };

  return new Response(
    {
      giftBots: bots.filter((b) => b.botType === 'gift').map(mapBot),
      gramjsAccounts: bots.filter((b) => b.botType === 'ai_gramjs').map(mapBot),
      waAccounts: bots.filter((b) => b.botType === 'ai_wa').map(mapBot),
      /** @deprecated use giftBots */
      bots: bots.filter((b) => b.botType === 'gift').map(mapBot),
      billing: billingRes.data,
      stages: stagesPayload.stages || [],
    },
    { status: 200 },
  );
};

export default defineLogicFunction({
  universalIdentifier: GET_MAILING_CONTEXT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-mailing-context',
  description: 'Bots/accounts + mailing billing + stages for in-CRM Рассылка',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/mailing/context',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
