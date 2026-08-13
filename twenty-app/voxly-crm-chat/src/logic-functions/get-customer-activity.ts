import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';

import { GET_CUSTOMER_ACTIVITY_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import {
  proxyToVoxlyApi,
  recordIdFromEvent,
  userWorkspaceIdFromEvent,
} from 'src/logic-functions/voxly-proxy';
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
  // The tab lives on Person, so recordId is the Twenty Person id.
  qs.set('personId', recordId);
  if (typeof q.phone === 'string' && q.phone) {
    qs.set('phone', q.phone);
  }
  if (typeof q.limit === 'string' && q.limit) {
    qs.set('limit', q.limit);
  }
  return proxyToVoxlyApi({
    method: 'GET',
    path: `/api/forms/activity?${qs.toString()}`,
    userWorkspaceId: userWorkspaceIdFromEvent(event),
  });
};

export default defineLogicFunction({
  universalIdentifier: GET_CUSTOMER_ACTIVITY_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-customer-activity',
  description:
    'Cross-channel interaction history (CustomerActivity) for one Person record',
  timeoutSeconds: 20,
  httpRouteTriggerSettings: {
    path: '/customer-activity/:recordId',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
