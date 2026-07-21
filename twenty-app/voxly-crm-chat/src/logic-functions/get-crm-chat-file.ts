import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';

import { GET_CRM_CHAT_FILE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import {
  fileIdFromEvent,
  proxyToVoxlyApi,
  recordIdFromEvent,
} from 'src/logic-functions/voxly-proxy';

const handler = async (event: RoutePayload) => {
  const recordId = recordIdFromEvent(event);
  const fileId = fileIdFromEvent(event);
  if (!recordId) {
    return new Response({ error: 'Invalid CRM record id' }, { status: 400 });
  }
  if (!fileId) {
    return new Response({ error: 'Invalid file id' }, { status: 400 });
  }
  return proxyToVoxlyApi({
    method: 'GET',
    path: `/api/crm/chat/${encodeURIComponent(recordId)}/file/${encodeURIComponent(fileId)}`,
    binaryAsBase64: true,
  });
};

export default defineLogicFunction({
  universalIdentifier: GET_CRM_CHAT_FILE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-crm-chat-file',
  description:
    'Fetch a Telegram chat attachment as base64 for Person/Opportunity chat preview',
  timeoutSeconds: 60,
  httpRouteTriggerSettings: {
    path: '/crm-chat/:recordId/file/:fileId',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
