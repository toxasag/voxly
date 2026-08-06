import { defineLogicFunction, HTTPMethod } from 'twenty-sdk/define';
import { Response } from 'twenty-sdk/logic-function';

import { GET_MAILING_STAGE_RULES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { proxyToVoxlyApi } from 'src/logic-functions/voxly-proxy';

const handler = async () => {
  return proxyToVoxlyApi({
    method: 'GET',
    path: '/api/bots/mailing/stage-rules',
  });
};

export default defineLogicFunction({
  universalIdentifier: GET_MAILING_STAGE_RULES_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-mailing-stage-rules',
  description: 'List Opportunity-stage mailing rules',
  timeoutSeconds: 30,
  httpRouteTriggerSettings: {
    path: '/mailing/stage-rules',
    httpMethod: HTTPMethod.GET,
    isAuthRequired: true,
  },
  handler,
});
