import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';

import { SAVE_MAILING_STAGE_RULE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const handler = async (event: RoutePayload) => {
  const body =
    (event as any).body ??
    (event as any).parsedBody ??
    {};
  const id = String((body as { id?: string })?.id || '').trim();
  if (id) {
    const { id: _drop, ...rest } = body as Record<string, unknown>;
    return proxyToVoxlyApi({
      method: 'PATCH',
      path: `/api/bots/mailing/stage-rules/${encodeURIComponent(id)}`,
      body: rest,
    });
  }
  return proxyToVoxlyApi({
    method: 'POST',
    path: '/api/bots/mailing/stage-rules',
    body,
  });
};

export default defineLogicFunction({
  universalIdentifier: SAVE_MAILING_STAGE_RULE_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'save-mailing-stage-rule',
  description: 'Create or update Opportunity-stage mailing rule (body.id = update)',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/mailing/stage-rules',
    httpMethod: HTTPMethod.POST,
    isAuthRequired: true,
  },
  handler,
});
