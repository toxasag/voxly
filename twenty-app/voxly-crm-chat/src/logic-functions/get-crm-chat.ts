import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';

import { GET_CRM_CHAT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi, recordIdFromEvent } from 'src/logic-functions/voxly-proxy';
import { Response } from 'twenty-sdk/logic-function';

const handler = async (event: RoutePayload) => {
  const recordId = recordIdFromEvent(event);
  if (!recordId) {
    return new Response({ error: 'Invalid CRM record id' }, { status: 400 });
  }
  const q = {
    ...((event as any).query || {}),
    ...((event as any).queryParameters || {}),
    ...((event as any).queryStringParameters || {}),
  } as Record<string, string | undefined>;
  const qs = new URLSearchParams();
  if (typeof q.conversationId === 'string' && q.conversationId) {
    qs.set('conversationId', q.conversationId);
  }
  if (typeof q.giftSubscriberId === 'string' && q.giftSubscriberId) {
    qs.set('giftSubscriberId', q.giftSubscriberId);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return proxyToVoxlyApi({
    method: 'GET',
    path: `/api/crm/chat/${encodeURIComponent(recordId)}${suffix}`,
  });
};

export default defineLogicFunction({
  universalIdentifier: GET_CRM_CHAT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-crm-chat',
  description: 'Load Telegram chat history for a Person or Opportunity record',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/crm-chat/:recordId',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
