import { defineApplication } from 'twenty-sdk/define';

import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
  VOXLY_API_URL_VARIABLE_UNIVERSAL_IDENTIFIER,
  WORKSPACE_ORIGIN_VARIABLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  applicationVariables: {
    VOXLY_API_URL: {
      universalIdentifier: VOXLY_API_URL_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        'Base URL of Voxly saas-api as reachable from Twenty logic functions (docker: http://saas-api:3002)',
      value: 'http://saas-api:3002',
      isSecret: false,
    },
    WORKSPACE_ORIGIN: {
      universalIdentifier: WORKSPACE_ORIGIN_VARIABLE_UNIVERSAL_IDENTIFIER,
      description:
        'Browser origin of this Twenty workspace (e.g. http://test2.localhost:3007). Required for Chat tab hostFetch allowlist + multiworkspace Host routing.',
      value: 'http://test2.localhost:3007',
      isSecret: false,
    },
  },
  serverVariables: {
    VOXLY_SERVICE_TOKEN: {
      description:
        'Shared bearer token for Twenty → saas-api CRM chat proxy (must match VOXLY_SERVICE_TOKEN on saas-api)',
      isSecret: true,
      isRequired: true,
    },
  },
});
