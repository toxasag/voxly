import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { type RoutePayload } from 'twenty-sdk/logic-function';
import { Response } from 'twenty-sdk/logic-function';

import { START_MAILING_TRIAL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const handler = async (event: RoutePayload) => {
  const body =
    (event as any).body ??
    (event as any).parsedBody ??
    {};
  const type = String((body as { type?: string })?.type || 'mailing_bot');
  if (
    type !== 'mailing_bot' &&
    type !== 'mailing_accounts' &&
    type !== 'mailing_stories'
  ) {
    return new Response(
      { error: 'type must be mailing_bot|mailing_accounts|mailing_stories' },
      { status: 400 },
    );
  }
  return proxyToVoxlyApi({
    method: 'POST',
    path: '/api/bots/mailing/start-trial',
    body: { type },
  });
};

export default defineLogicFunction({
  universalIdentifier: START_MAILING_TRIAL_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'start-mailing-trial',
  description: 'Start mailing_* trial from in-CRM Рассылка',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/mailing/start-trial',
    httpMethod: HTTPMethod.POST,
    isAuthRequired: true,
  },
  handler,
});
