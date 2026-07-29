import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { Response } from 'twenty-sdk/logic-function';

import { DELETE_MAILING_BROADCAST_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const handler = async (event: RoutePayload) => {
  const params = ((event as any).pathParameters ||
    (event as any).params ||
    {}) as Record<string, string | undefined>;
  const botId = String(params.botId || '').trim();
  const broadcastId = String(params.broadcastId || '').trim();
  if (!botId || !broadcastId) {
    return new Response({ error: 'botId and broadcastId required' }, { status: 400 });
  }
  return proxyToVoxlyApi({
    method: 'DELETE',
    path: `/api/bots/${encodeURIComponent(botId)}/broadcasts/${encodeURIComponent(broadcastId)}`,
  });
};

export default defineLogicFunction({
  universalIdentifier: DELETE_MAILING_BROADCAST_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'delete-mailing-broadcast',
  description: 'Delete scheduled/draft mailing broadcast',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/mailing/bots/:botId/broadcasts/:broadcastId',
    httpMethod: HTTPMethod.DELETE,
    isAuthRequired: true,
  },
  handler,
});
