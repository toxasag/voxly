import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { Response } from 'twenty-sdk/logic-function';

import { CREATE_MAILING_BROADCAST_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const handler = async (event: RoutePayload) => {
  const params = ((event as any).pathParameters ||
    (event as any).params ||
    {}) as Record<string, string | undefined>;
  const botId = String(params.botId || '').trim();
  if (!botId) {
    return new Response({ error: 'botId required' }, { status: 400 });
  }
  const body =
    (event as any).body ??
    (event as any).parsedBody ??
    {};
  return proxyToVoxlyApi({
    method: 'POST',
    path: `/api/bots/${encodeURIComponent(botId)}/broadcasts`,
    body,
  });
};

export default defineLogicFunction({
  universalIdentifier: CREATE_MAILING_BROADCAST_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'create-mailing-broadcast',
  description: 'Create gift-bot broadcast from in-CRM Рассылка',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/mailing/bots/:botId/broadcasts',
    httpMethod: HTTPMethod.POST,
    isAuthRequired: true,
  },
  handler,
});
