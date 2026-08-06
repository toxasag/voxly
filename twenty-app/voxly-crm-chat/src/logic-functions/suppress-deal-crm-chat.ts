import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';

import { SUPPRESS_DEAL_CRM_CHAT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi, recordIdFromEvent } from 'src/logic-functions/voxly-proxy';

type SuppressBody = {
  conversationId?: string;
  giftSubscriberId?: string;
  suppress?: boolean;
};

const handler = async (event: RoutePayload<SuppressBody>) => {
  const recordId = recordIdFromEvent(event);
  if (!recordId) {
    return new Response({ error: 'Invalid CRM record id' }, { status: 400 });
  }
  if (typeof event.body?.suppress !== 'boolean') {
    return new Response({ error: 'suppress boolean required' }, { status: 400 });
  }
  const conversationId =
    typeof event.body?.conversationId === 'string'
      ? event.body.conversationId.trim()
      : '';
  const giftSubscriberId =
    typeof event.body?.giftSubscriberId === 'string'
      ? event.body.giftSubscriberId.trim()
      : '';
  return proxyToVoxlyApi({
    method: 'POST',
    path: `/api/crm/chat/${encodeURIComponent(recordId)}/suppress-deal`,
    body: {
      suppress: event.body.suppress,
      ...(conversationId ? { conversationId } : {}),
      ...(giftSubscriberId ? { giftSubscriberId } : {}),
    },
  });
};

export default defineLogicFunction({
  universalIdentifier: SUPPRESS_DEAL_CRM_CHAT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'suppress-deal-crm-chat',
  description:
    'Toggle suppressDealCreation — do not auto-create Opportunity on new inbound',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/crm-chat/:recordId/suppress-deal',
    httpMethod: HTTPMethod.POST,
    isAuthRequired: true,
  },
  handler,
});
