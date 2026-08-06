import { defineLogicFunction } from 'twenty-sdk/define';
import {
  ObjectRecordUpdateEvent,
  type RoutePayload,
} from 'twenty-sdk/logic-function';
import { Response } from 'twenty-sdk/logic-function';

import { DEDUPE_ON_OPPORTUNITY_SAVE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

/**
 * Every Opportunity save (incl. pointOfContact / company changes) →
 * saas-api soft-merge People by filled phone / WhatsApp.
 */
const handler = async (event: RoutePayload | ObjectRecordUpdateEvent) => {
  const update = event as ObjectRecordUpdateEvent<Record<string, unknown>>;
  const opportunityId = String(update.recordId || '').trim();
  if (!opportunityId) {
    return new Response({ error: 'No opportunity id' }, { status: 400 });
  }
  return proxyToVoxlyApi({
    method: 'POST',
    path: '/api/crm/chat/dedupe',
    body: { opportunityId },
  });
};

export default defineLogicFunction({
  universalIdentifier: DEDUPE_ON_OPPORTUNITY_SAVE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'dedupe-on-opportunity-save',
  description:
    'On Opportunity save → duplicate check / soft-merge People by phone or WhatsApp',
  timeoutSeconds: 30,
  databaseEventTriggerSettings: {
    eventName: 'opportunity.updated',
  },
  handler,
});
