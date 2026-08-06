import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';

import { GET_UNREAD_BADGES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const handler = async (_event: RoutePayload) => {
  return proxyToVoxlyApi({
    method: 'GET',
    path: '/api/crm/chat/unread-badges',
  });
};

export default defineLogicFunction({
  universalIdentifier: GET_UNREAD_BADGES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-unread-badges',
  description:
    'Unread inbound ChatMessage counts for Opportunity/Person board badges (shell-ux)',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: {
    path: '/crm-chat/unread-badges',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
