import { defineLogicFunction } from 'twenty-sdk/define';
import {
  ObjectRecordUpdateEvent,
  type RoutePayload,
} from 'twenty-sdk/logic-function';
import { Response } from 'twenty-sdk/logic-function';

import { NORMALIZE_PERSON_TELEGRAM_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

/**
 * Manual edits often store a bare handle (`toxasagmsk`, `@toxasagmsk`) instead
 * of the canonical full URL. Rewrite to url=https://t.me/<handle>,
 * label=@<handle> (numeric id only → /open/tg/<id> bridge + id label).
 */
const handler = async (event: RoutePayload | ObjectRecordUpdateEvent) => {
  const update = event as ObjectRecordUpdateEvent<Record<string, unknown>>;
  const personId = String(update.recordId || '').trim();
  if (!personId) {
    return new Response({ error: 'No person id' }, { status: 400 });
  }
  return proxyToVoxlyApi({
    method: 'POST',
    path: '/api/crm/chat/normalize-telegram',
    body: { personId },
  });
};

export default defineLogicFunction({
  universalIdentifier: NORMALIZE_PERSON_TELEGRAM_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'normalize-person-telegram',
  description:
    'On Person.telegram save → rewrite link to canonical t.me URL + @handle label',
  timeoutSeconds: 30,
  databaseEventTriggerSettings: {
    eventName: 'person.updated',
    updatedFields: ['telegram'],
  },
  handler,
});
