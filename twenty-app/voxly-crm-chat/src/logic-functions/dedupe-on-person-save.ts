import { defineLogicFunction } from 'twenty-sdk/define';
import {
  ObjectRecordUpdateEvent,
  type RoutePayload,
} from 'twenty-sdk/logic-function';
import { Response } from 'twenty-sdk/logic-function';

import { DEDUPE_ON_PERSON_SAVE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const PHONE_FIELDS = new Set([
  'phones',
  'whatsapp',
  'phonesPrimaryPhoneNumber',
  'phonesPrimaryPhoneCallingCode',
]);

/**
 * When contact phone / WhatsApp is edited (incl. from a deal side panel) →
 * run the same soft-merge path as Opportunity save.
 */
const handler = async (event: RoutePayload | ObjectRecordUpdateEvent) => {
  const update = event as ObjectRecordUpdateEvent<Record<string, unknown>>;
  const props = update.properties || ({} as ObjectRecordUpdateEvent['properties']);
  const updated = props.updatedFields || [];
  if (
    updated.length &&
    !updated.some((f) => PHONE_FIELDS.has(String(f)) || String(f).startsWith('phones'))
  ) {
    return new Response({ ok: true, skipped: true }, { status: 200 });
  }
  const personId = String(update.recordId || '').trim();
  if (!personId) {
    return new Response({ error: 'No person id' }, { status: 400 });
  }
  return proxyToVoxlyApi({
    method: 'POST',
    path: '/api/crm/chat/dedupe',
    body: { personId },
  });
};

export default defineLogicFunction({
  universalIdentifier: DEDUPE_ON_PERSON_SAVE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'dedupe-on-person-save',
  description:
    'On Person phone/WhatsApp save → duplicate check / soft-merge by phone',
  timeoutSeconds: 30,
  databaseEventTriggerSettings: {
    eventName: 'person.updated',
    updatedFields: ['phones', 'whatsapp'],
  },
  handler,
});
