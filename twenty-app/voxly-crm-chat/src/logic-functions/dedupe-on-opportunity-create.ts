import { defineLogicFunction } from 'twenty-sdk/define';
import {
  ObjectRecordCreateEvent,
  type RoutePayload,
} from 'twenty-sdk/logic-function';
import { Response } from 'twenty-sdk/logic-function';

import { DEDUPE_ON_OPPORTUNITY_CREATE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const handler = async (event: RoutePayload | ObjectRecordCreateEvent) => {
  const created = event as ObjectRecordCreateEvent<Record<string, unknown>>;
  const opportunityId = String(created.recordId || '').trim();
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
  universalIdentifier: DEDUPE_ON_OPPORTUNITY_CREATE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'dedupe-on-opportunity-create',
  description:
    'On Opportunity create → duplicate check / soft-merge People by phone or WhatsApp',
  timeoutSeconds: 30,
  databaseEventTriggerSettings: {
    eventName: 'opportunity.created',
  },
  handler,
});
