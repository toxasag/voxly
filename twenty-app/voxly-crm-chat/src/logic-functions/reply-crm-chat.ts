import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response, type RoutePayload } from 'twenty-sdk/logic-function';

import { REPLY_CRM_CHAT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi, recordIdFromEvent } from 'src/logic-functions/voxly-proxy';

type ReplyBody = {
  text?: string;
  conversationId?: string;
  giftSubscriberId?: string;
  /** Base64 file payload (SDK front → logic; forwarded as multipart to saas-api). */
  fileBase64?: string;
  fileName?: string;
  mimeType?: string;
};

const MAX_FILE_BYTES = 12 * 1024 * 1024;

const handler = async (event: RoutePayload<ReplyBody>) => {
  const recordId = recordIdFromEvent(event);
  if (!recordId) {
    return new Response({ error: 'Invalid CRM record id' }, { status: 400 });
  }
  const text = typeof event.body?.text === 'string' ? event.body.text.trim() : '';
  const conversationId =
    typeof event.body?.conversationId === 'string' ? event.body.conversationId.trim() : '';
  const giftSubscriberId =
    typeof event.body?.giftSubscriberId === 'string'
      ? event.body.giftSubscriberId.trim()
      : '';
  const fileBase64 =
    typeof event.body?.fileBase64 === 'string' ? event.body.fileBase64.trim() : '';
  const fileName =
    typeof event.body?.fileName === 'string' && event.body.fileName.trim()
      ? event.body.fileName.trim()
      : 'upload.bin';
  const mimeType =
    typeof event.body?.mimeType === 'string' && event.body.mimeType.trim()
      ? event.body.mimeType.trim()
      : 'application/octet-stream';

  if (!text && !fileBase64) {
    return new Response({ error: 'Нужен текст или файл' }, { status: 400 });
  }

  if (fileBase64) {
    let buffer: Buffer;
    try {
      buffer = Buffer.from(fileBase64, 'base64');
    } catch {
      return new Response({ error: 'Invalid file payload' }, { status: 400 });
    }
    if (!buffer.length) {
      return new Response({ error: 'Пустой файл' }, { status: 400 });
    }
    if (buffer.length > MAX_FILE_BYTES) {
      return new Response(
        { error: `Файл слишком большой (макс. ${MAX_FILE_BYTES / (1024 * 1024)} МБ)` },
        { status: 400 },
      );
    }
    const form = new FormData();
    if (text) form.append('text', text);
    if (conversationId) form.append('conversationId', conversationId);
    if (giftSubscriberId) form.append('giftSubscriberId', giftSubscriberId);
    form.append('file', new Blob([new Uint8Array(buffer)], { type: mimeType }), fileName);
    return proxyToVoxlyApi({
      method: 'POST',
      path: `/api/crm/chat/${encodeURIComponent(recordId)}/reply`,
      formData: form,
    });
  }

  const body: Record<string, string> = { text };
  if (conversationId) body.conversationId = conversationId;
  if (giftSubscriberId) body.giftSubscriberId = giftSubscriberId;
  return proxyToVoxlyApi({
    method: 'POST',
    path: `/api/crm/chat/${encodeURIComponent(recordId)}/reply`,
    body,
  });
};

export default defineLogicFunction({
  universalIdentifier: REPLY_CRM_CHAT_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'reply-crm-chat',
  description: 'Send a Telegram reply (text and/or file) for a Person or Opportunity record',
  timeoutSeconds: 60,
  httpRouteTriggerSettings: {
    path: '/crm-chat/:recordId/reply',
    httpMethod: HTTPMethod.POST,
    isAuthRequired: true,
  },
  handler,
});
