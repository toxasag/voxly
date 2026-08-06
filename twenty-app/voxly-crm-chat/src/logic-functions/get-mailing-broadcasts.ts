import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { Response } from 'twenty-sdk/logic-function';

import { GET_MAILING_BROADCASTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const handler = async (event: RoutePayload) => {
  const params = ((event as any).pathParameters ||
    (event as any).params ||
    {}) as Record<string, string | undefined>;
  const botId = String(params.botId || '').trim();
  if (!botId) {
    return new Response({ error: 'botId required' }, { status: 400 });
  }
  return proxyToVoxlyApi({
    method: 'GET',
    path: `/api/bots/${encodeURIComponent(botId)}/broadcasts`,
  });
};

export default defineLogicFunction({
  universalIdentifier: GET_MAILING_BROADCASTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-mailing-broadcasts',
  description: 'List gift-bot broadcasts for in-CRM Рассылка',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/mailing/bots/:botId/broadcasts',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
