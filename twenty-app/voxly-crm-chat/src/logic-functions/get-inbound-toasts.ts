import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';

import { GET_INBOUND_TOASTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const handler = async (event: RoutePayload) => {
  const q = {
    ...((event as any).query || {}),
    ...((event as any).queryParameters || {}),
    ...((event as any).queryStringParameters || {}),
  } as Record<string, string | undefined>;
  const qs = new URLSearchParams();
  if (typeof q.since === 'string' && q.since) {
    qs.set('since', q.since);
  }
  if (typeof q.limit === 'string' && q.limit) {
    qs.set('limit', q.limit);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return proxyToVoxlyApi({
    method: 'GET',
    path: `/api/crm/chat/inbound-toasts${suffix}`,
  });
};

export default defineLogicFunction({
  universalIdentifier: GET_INBOUND_TOASTS_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-inbound-toasts',
  description:
    'Recent inbound ChatMessages for CRM left-snack toasts (shell-ux poll)',
  timeoutSeconds: 15,
  httpRouteTriggerSettings: {
    path: '/crm-chat/inbound-toasts',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
