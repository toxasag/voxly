import { defineLogicFunction } from 'twenty-sdk/define';
import {
  ObjectRecordUpdateEvent,
  type RoutePayload,
} from 'twenty-sdk/logic-function';
import { Response } from 'twenty-sdk/logic-function';

import { FIRE_MAILING_STAGE_RULE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

function stageValue(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim();
  if (raw && typeof raw === 'object' && 'value' in (raw as object)) {
    return String((raw as { value?: unknown }).value || '').trim();
  }
  return '';
}

const handler = async (event: RoutePayload | ObjectRecordUpdateEvent) => {
  const update = event as ObjectRecordUpdateEvent<Record<string, unknown>>;
  const props = update.properties || ({} as ObjectRecordUpdateEvent['properties']);
  const updated = props.updatedFields || [];
  if (updated.length && !updated.includes('stage')) {
    return new Response({ ok: true, skipped: true }, { status: 200 });
  }
  const before = stageValue(props.before?.stage);
  const after = stageValue(props.after?.stage);
  if (!after || after === before) {
    return new Response({ ok: true, skipped: true }, { status: 200 });
  }
  const opportunityId = String(update.recordId || '').trim();
  if (!opportunityId) {
    return new Response({ error: 'No opportunity id' }, { status: 400 });
  }
  return proxyToVoxlyApi({
    method: 'POST',
    path: '/api/bots/mailing/stage-rules/fire',
    body: { opportunityId, stage: after },
  });
};

export default defineLogicFunction({
  universalIdentifier: FIRE_MAILING_STAGE_RULE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'fire-mailing-stage-rule',
  description: 'On Opportunity stage change → fire matching mailing stage rules',
  timeoutSeconds: 30,
  databaseEventTriggerSettings: {
    eventName: 'opportunity.updated',
    updatedFields: ['stage'],
  },
  handler,
});
