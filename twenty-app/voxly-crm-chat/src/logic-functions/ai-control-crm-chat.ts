import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';

import { AI_CONTROL_CRM_CHAT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi, recordIdFromEvent } from 'src/logic-functions/voxly-proxy';

type AiControlBody = {
  conversationId?: string;
  action?: 'enable' | 'pause' | 'disable';
};

const handler = async (event: RoutePayload<AiControlBody>) => {
  const recordId = recordIdFromEvent(event);
  if (!recordId) {
    return new Response({ error: 'Invalid CRM record id' }, { status: 400 });
  }
  const conversationId =
    typeof event.body?.conversationId === 'string'
      ? event.body.conversationId.trim()
      : '';
  const action = event.body?.action;
  if (!conversationId || !action || !['enable', 'pause', 'disable'].includes(action)) {
    return new Response(
      { error: 'conversationId and action (enable|pause|disable) required' },
      { status: 400 },
    );
  }
  return proxyToVoxlyApi({
    method: 'POST',
    path: `/api/crm/chat/${encodeURIComponent(recordId)}/ai`,
    body: { conversationId, action },
  });
};

export default defineLogicFunction({
  universalIdentifier: AI_CONTROL_CRM_CHAT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'ai-control-crm-chat',
  description: 'Enable, pause (~1h), or disable AI for a CRM chat conversation',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/crm-chat/:recordId/ai',
    httpMethod: HTTPMethod.POST,
    isAuthRequired: true,
  },
  handler,
});
