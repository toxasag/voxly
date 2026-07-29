import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';

import { GET_CRM_CHAT_FILE_URL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import {
  fileIdFromEvent,
  proxyToVoxlyApi,
  recordIdFromEvent,
} from 'src/logic-functions/voxly-proxy';

/**
 * Short-lived signed media URL for video/audio/voice/documents (Twenty /s JSON
 * ~96KB cap cannot carry media bytes as base64).
 */
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
    path: `/api/crm/chat/${encodeURIComponent(recordId)}/file/${encodeURIComponent(fileId)}/signed-url`,
  });
};

export default defineLogicFunction({
  universalIdentifier: GET_CRM_CHAT_FILE_URL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-crm-chat-file-url',
  description:
    'Mint a signed URL for large CRM chat attachments (video, audio, voice, documents)',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/crm-chat/:recordId/file-url/:fileId',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
