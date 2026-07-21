// Voxly Twenty CRM GraphQL Client
// Handles workspace provisioning, user creation, and API calls to Twenty

import { GraphQLClient, gql } from 'graphql-request';

export interface TwentyClientConfig {
  apiUrl: string; // http://twenty-server:3000/graphql
  apiKey?: string; // service token
}

function formatTelegramHandle(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = String(raw).trim().replace(/^@+/, '');
  if (!cleaned) return undefined;
  return `@${cleaned}`;
}

export interface ProvisionWorkspaceParams {
  workspaceName: string;
  subdomain: string;
  ownerEmail: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerPassword: string;
}

export interface ProvisionedWorkspace {
  workspaceId: string;
  subdomain: string;
  workspaceUrl: string;
  loginToken: string;
  authTokens: {
    accessToken: string;
    refreshToken?: string;
  };
}

// Twenty 2.21 auth flow: create a workspace-agnostic user, then create a
// workspace while authenticated with that token.
const SIGN_UP = gql`
  mutation SignUp($email: String!, $password: String!, $locale: String) {
    signUp(email: $email, password: $password, locale: $locale) {
      tokens {
        accessOrWorkspaceAgnosticToken {
          token
        }
        refreshToken {
          token
        }
      }
    }
  }
`;

const GET_WORKSPACE_DEFAULTS_CONTEXT = gql`
  query GetWorkspaceDefaultsContext {
    currentUser {
      workspaceMember {
        id
      }
    }
    objects(paging: { first: 1000 }) {
      edges {
        node {
          id
          nameSingular
          fieldsList {
            id
            name
          }
        }
      }
    }
  }
`;

const UPDATE_WORKSPACE_MEMBER_SETTINGS = gql`
  mutation UpdateWorkspaceMemberSettings($input: UpdateWorkspaceMemberSettingsInput!) {
    updateWorkspaceMemberSettings(input: $input)
  }
`;

const UPDATE_ONE_OBJECT_METADATA = gql`
  mutation UpdateOneObject($input: UpdateOneObjectInput!) {
    updateOneObject(input: $input) {
      id
      labelSingular
      labelPlural
    }
  }
`;

const CREATE_ONE_FIELD = gql`
  mutation CreateOneField($input: CreateOneFieldMetadataInput!) {
    createOneField(input: $input) {
      id
      name
    }
  }
`;

const GET_PERSON_FIELD_WIDGET_VIEWS = gql`
  query GetPersonFieldWidgetViews($objectMetadataId: String!) {
    getViews(objectMetadataId: $objectMetadataId, viewTypes: [FIELDS_WIDGET]) {
      id
      name
      type
    }
  }
`;

const GET_OBJECT_VIEWS = gql`
  query GetObjectViews($objectMetadataId: String!) {
    getViews(objectMetadataId: $objectMetadataId) {
      id
      name
      type
      key
      icon
      mainGroupByFieldMetadataId
      kanbanColumnWidth
    }
  }
`;

const GET_VIEW_GROUPS = gql`
  query GetViewGroups($viewId: String!) {
    getViewGroups(viewId: $viewId) {
      id
      fieldValue
      position
      isVisible
    }
  }
`;

const UPDATE_VIEW = gql`
  mutation UpdateView($id: String!, $input: UpdateViewInput!) {
    updateView(id: $id, input: $input) {
      id
      type
      key
      mainGroupByFieldMetadataId
      kanbanColumnWidth
    }
  }
`;

const CREATE_VIEW_GROUP = gql`
  mutation CreateViewGroup($input: CreateViewGroupInput!) {
    createViewGroup(input: $input) {
      id
      fieldValue
    }
  }
`;

const GET_VIEW_FIELDS = gql`
  query GetViewFields($viewId: String!) {
    getViewFields(viewId: $viewId) {
      id
      fieldMetadataId
      viewFieldGroupId
      position
      isVisible
      size
    }
  }
`;

const UPDATE_VIEW_FIELD = gql`
  mutation UpdateViewField($input: UpdateViewFieldInput!) {
    updateViewField(input: $input) {
      id
      viewFieldGroupId
      position
      isVisible
      size
    }
  }
`;

const CREATE_VIEW_FIELD = gql`
  mutation CreateViewField($input: CreateViewFieldInput!) {
    createViewField(input: $input) {
      id
      fieldMetadataId
      position
      isVisible
      size
    }
  }
`;

/** Default Opportunity kanban card fields (Voxly CRM board). */
const OPPORTUNITY_KANBAN_CARD_FIELDS: Array<{
  name: string;
  position: number;
  size: number;
}> = [
  { name: 'name', position: 0, size: 150 },
  { name: 'createdAt', position: 0.125, size: 100 },
  { name: 'amount', position: 1, size: 150 },
  { name: 'createdBy', position: 2, size: 150 },
  { name: 'closeDate', position: 3, size: 150 },
  { name: 'company', position: 4, size: 150 },
  { name: 'pointOfContact', position: 5, size: 150 },
  { name: 'taskTargets', position: 5.5, size: 100 },
  { name: 'noteTargets', position: 6, size: 100 },
];

const DEFAULT_KANBAN_COLUMN_WIDTH = 320;
const UPDATE_PERSON = gql`
  mutation UpdatePerson($id: UUID!, $data: PersonUpdateInput!) {
    updatePerson(id: $id, data: $data) {
      id
    }
  }
`;

const SIGN_UP_IN_NEW_WORKSPACE = gql`
  mutation SignUpInNewWorkspace($input: SignUpInNewWorkspaceInput) {
    signUpInNewWorkspace(input: $input) {
      loginToken {
        token
      }
      workspace {
        id
        workspaceUrls {
          subdomainUrl
          customUrl
        }
      }
    }
  }
`;

const SIGN_IN = gql`
  mutation SignIn($email: String!, $password: String!) {
    signIn(email: $email, password: $password) {
      tokens {
        accessOrWorkspaceAgnosticToken {
          token
        }
        refreshToken {
          token
        }
      }
      availableWorkspaces {
        availableWorkspacesForSignIn {
          id
          loginToken
          workspaceUrls {
            subdomainUrl
            customUrl
          }
        }
      }
    }
  }
`;

const GET_AUTH_TOKENS_FROM_LOGIN_TOKEN = gql`
  mutation GetAuthTokensFromLoginToken($loginToken: String!, $origin: String!) {
    getAuthTokensFromLoginToken(loginToken: $loginToken, origin: $origin) {
      tokens {
        accessOrWorkspaceAgnosticToken {
          token
        }
        refreshToken {
          token
        }
      }
    }
  }
`;

const INSTALL_APP = gql`
  mutation InstallApp($appId: String!) {
    installApp(input: { appId: $appId }) {
      id
      status
    }
  }
`;

const CREATE_PERSON = gql`
  mutation CreatePerson($data: PersonCreateInput!) {
    createPerson(data: $data) {
      id
    }
  }
`;

const CREATE_PERSON_NAME = gql`
  mutation CreatePersonName($data: PersonCreateInput!) {
    createPerson(data: $data) {
      id
    }
  }
`;

const CREATE_OPPORTUNITY = gql`
  mutation CreateOpportunity($data: OpportunityCreateInput!) {
    createOpportunity(data: $data) {
      id
      name
    }
  }
`;

const FIND_PEOPLE = gql`
  query FindPeople($filter: PersonFilterInput) {
    people(filter: $filter, first: 5) {
      edges {
        node {
          id
        }
      }
    }
  }
`;

// Twenty 2.x note create — bodyV2 + nested noteTargets (best-effort; schema varies by version)
const CREATE_NOTE = gql`
  mutation CreateNote($data: NoteCreateInput!) {
    createNote(data: $data) {
      id
    }
  }
`;

export class TwentyClient {
  private client: GraphQLClient;
  private authClient: GraphQLClient;
  private authTokens: { accessToken: string; refreshToken?: string } | null = null;

  constructor(config: TwentyClientConfig) {
    const headers = config.apiKey
      ? { Authorization: `Bearer ${config.apiKey}` }
      : {};
    this.client = new GraphQLClient(config.apiUrl, { headers });
    const authUrl = config.apiUrl.replace(/\/graphql\/?$/, '/metadata');
    // Public auth mutations must not inherit a service API key. Twenty treats
    // an invalid/placeholder Authorization header as an auth failure.
    this.authClient = new GraphQLClient(authUrl);
  }

  /**
   * Provision a new workspace + owner user
   */
  async provisionWorkspace(params: ProvisionWorkspaceParams): Promise<ProvisionedWorkspace> {
    let workspaceAgnosticToken: string;
    try {
      const signUpResult = await this.authClient.request(SIGN_UP, {
        email: params.ownerEmail,
        password: params.ownerPassword,
        locale: 'ru-RU',
      });
      workspaceAgnosticToken =
        (signUpResult as any).signUp.tokens.accessOrWorkspaceAgnosticToken.token;
    } catch (signUpError) {
      // A previous provisioning attempt may have created the Twenty user
      // before failing to create its workspace. Resume with its credentials.
      try {
        const signInResult = await this.authClient.request(SIGN_IN, {
          email: params.ownerEmail,
          password: params.ownerPassword,
        });
        workspaceAgnosticToken =
          (signInResult as any).signIn.tokens.accessOrWorkspaceAgnosticToken.token;
      } catch {
        throw signUpError;
      }
    }

    const workspaceResult = await this.authClient.request(
      SIGN_UP_IN_NEW_WORKSPACE,
      {
        input: {
          displayName: params.workspaceName,
          subdomain: params.subdomain,
        },
      },
      { Authorization: `Bearer ${workspaceAgnosticToken}` },
    );
    const workspaceData = (workspaceResult as any).signUpInNewWorkspace;
    const workspaceUrl =
      workspaceData.workspace.workspaceUrls.customUrl ??
      workspaceData.workspace.workspaceUrls.subdomainUrl;
    const loginToken = workspaceData.loginToken.token;

    const tokenResult = await this.authClient.request(GET_AUTH_TOKENS_FROM_LOGIN_TOKEN, {
      loginToken,
      origin: workspaceUrl,
    });
    const tokens = (tokenResult as any).getAuthTokensFromLoginToken.tokens;
    this.authTokens = {
      accessToken: tokens.accessOrWorkspaceAgnosticToken.token,
      refreshToken: tokens.refreshToken?.token,
    };

    try {
      await this.applyWorkspaceDefaults();
    } catch {
      // Workspace provisioning must remain successful even if optional
      // localization metadata is temporarily unavailable.
    }

    return {
      workspaceId: workspaceData.workspace.id,
      subdomain: params.subdomain,
      workspaceUrl,
      loginToken,
      authTokens: this.authTokens,
    };
  }

  async createWorkspaceLoginUrl(
    email: string,
    password: string,
    workspaceId: string,
  ): Promise<string> {
    const result = await this.authClient.request(SIGN_IN, { email, password });
    const workspaces =
      (result as any).signIn.availableWorkspaces.availableWorkspacesForSignIn ?? [];
    const workspace = workspaces.find((item: any) => item.id === workspaceId);
    if (!workspace) {
      throw new Error('Twenty workspace is not available for this user');
    }
    const workspaceUrl =
      workspace.workspaceUrls.customUrl ?? workspace.workspaceUrls.subdomainUrl;
    return `${workspaceUrl.replace(/\/+$/, '')}/verify?loginToken=${encodeURIComponent(workspace.loginToken)}`;
  }

  async applyWorkspaceDefaultsWithCredentials(
    email: string,
    password: string,
    workspaceId: string,
  ): Promise<void> {
    await this.authenticateWorkspace(email, password, workspaceId);
    await this.applyWorkspaceDefaults();
  }

  /** Sign in and switch auth tokens to a specific workspace (no defaults). */
  async authenticateWorkspace(
    email: string,
    password: string,
    workspaceId: string,
  ): Promise<void> {
    const result = await this.authClient.request(SIGN_IN, { email, password });
    const workspaces =
      (result as any).signIn.availableWorkspaces.availableWorkspacesForSignIn ?? [];
    const workspace = workspaces.find((item: any) => item.id === workspaceId);
    if (!workspace) {
      throw new Error('Twenty workspace is not available for this user');
    }
    const workspaceUrl =
      workspace.workspaceUrls.customUrl ?? workspace.workspaceUrls.subdomainUrl;
    const tokenResult = await this.authClient.request(GET_AUTH_TOKENS_FROM_LOGIN_TOKEN, {
      loginToken: workspace.loginToken,
      origin: workspaceUrl,
    });
    const tokens = (tokenResult as any).getAuthTokensFromLoginToken.tokens;
    this.authTokens = {
      accessToken: tokens.accessOrWorkspaceAgnosticToken.token,
      refreshToken: tokens.refreshToken?.token,
    };
  }

  /** Apply Voxly locale/branding defaults to the currently authenticated workspace. */
  async applyWorkspaceDefaults(): Promise<void> {
    const headers = this.getAuthHeaders();
    const context = await this.authClient.request(
      GET_WORKSPACE_DEFAULTS_CONTEXT,
      undefined,
      headers,
    ) as any;
    const workspaceMemberId = context.currentUser?.workspaceMember?.id;
    if (!workspaceMemberId) {
      throw new Error('Current Twenty workspace member was not found');
    }

    await this.authClient.request(
      UPDATE_WORKSPACE_MEMBER_SETTINGS,
      {
        input: {
          workspaceMemberId,
          update: {
            locale: 'ru-RU',
            timeFormat: 'HOUR_24',
          },
        },
      },
      headers,
    );

    const objects = context.objects?.edges?.map(
      (edge: {
        node: {
          id: string;
          nameSingular: string;
          fieldsList?: Array<{ id: string; name: string }>;
        };
      }) => edge.node,
    ) ?? [];
    const opportunity = objects.find(
      (object: { nameSingular: string }) => object.nameSingular === 'opportunity',
    );
    if (opportunity) {
      const updateResult = await this.authClient.request(
        UPDATE_ONE_OBJECT_METADATA,
        {
          input: {
            id: opportunity.id,
            update: {
              labelSingular: 'Сделка',
              labelPlural: 'Сделки',
            },
          },
        },
        headers,
      ) as { updateOneObject?: { labelSingular?: string; labelPlural?: string } };

      const updated = updateResult.updateOneObject;
      if (
        updated?.labelSingular !== 'Сделка'
        || updated?.labelPlural !== 'Сделки'
      ) {
        throw new Error(
          `Failed to rename opportunity object (got ${updated?.labelSingular}/${updated?.labelPlural})`,
        );
      }

      const stageFieldId = opportunity.fieldsList?.find(
        (field: { name: string }) => field.name === 'stage',
      )?.id;
      if (stageFieldId) {
        try {
          await this.ensureOpportunityKanbanDefault(
            opportunity.id,
            stageFieldId,
            headers,
            opportunity.fieldsList ?? [],
          );
        } catch {
          // Optional: table INDEX remains usable; SQL script can promote By Stage.
        }
      }
    }

    const person = objects.find(
      (object: { nameSingular: string }) => object.nameSingular === 'person',
    );
    if (person) {
      try {
        await this.ensurePersonTelegramField(person.id, person.fieldsList ?? [], headers);
      } catch {
        // Optional: workspace still usable without Telegram field
      }
    }

    const note = objects.find(
      (object: { nameSingular: string }) => object.nameSingular === 'note',
    );
    if (note) {
      try {
        await this.ensureNoteBodyAsLabel(note.id, note.fieldsList ?? [], headers);
      } catch {
        // Optional: kanban may keep showing note title
      }
    }
  }

  /**
   * Ensure Person.telegram custom field exists (idempotent).
   * Safe to call before create/update with telegram handle.
   */
  async ensureTelegramField(): Promise<void> {
    const headers = this.getAuthHeaders();
    const context = await this.authClient.request(
      GET_WORKSPACE_DEFAULTS_CONTEXT,
      undefined,
      headers,
    ) as any;
    const objects = context.objects?.edges?.map(
      (edge: {
        node: {
          id: string;
          nameSingular: string;
          fieldsList?: Array<{ id: string; name: string }>;
        };
      }) => edge.node,
    ) ?? [];
    const person = objects.find(
      (object: { nameSingular: string }) => object.nameSingular === 'person',
    );
    if (!person) return;
    await this.ensurePersonTelegramField(person.id, person.fieldsList ?? [], headers);
  }

  /**
   * Make Opportunity default INDEX view a stage kanban with Voxly card defaults.
   * Prefer existing «By Stage» board; GraphQL cannot set view.key, so we convert
   * the seeded TABLE INDEX to KANBAN when needed. For promoting By Stage itself
   * to key=INDEX, run docker/set-opportunity-kanban-default.sql.
   */
  private async ensureOpportunityKanbanDefault(
    opportunityObjectId: string,
    stageFieldId: string,
    headers: Record<string, string>,
    fieldsList: Array<{ id: string; name: string }> = [],
  ): Promise<void> {
    const viewsRes = await this.authClient.request(
      GET_OBJECT_VIEWS,
      { objectMetadataId: opportunityObjectId },
      headers,
    ) as {
      getViews?: Array<{
        id: string;
        name?: string | null;
        type?: string | null;
        key?: string | null;
        icon?: string | null;
        mainGroupByFieldMetadataId?: string | null;
        kanbanColumnWidth?: number | null;
      }>;
    };
    const views = (viewsRes.getViews ?? []).filter(
      (view) => view.type !== 'FIELDS_WIDGET' && view.type !== 'TABLE_WIDGET',
    );
    const indexView = views.find((view) => view.key === 'INDEX');
    if (!indexView) return;

    const byStage =
      views.find(
        (view) =>
          view.type === 'KANBAN'
          && (
            /stage|этап/i.test(String(view.name || ''))
            || view.mainGroupByFieldMetadataId === stageFieldId
          ),
      )
      ?? views.find((view) => view.type === 'KANBAN');

    const groupByFieldId =
      byStage?.mainGroupByFieldMetadataId
      ?? stageFieldId;

    const needsKanbanType =
      indexView.type !== 'KANBAN' || !indexView.mainGroupByFieldMetadataId;

    if (needsKanbanType) {
      await this.authClient.request(
        UPDATE_VIEW,
        {
          id: indexView.id,
          input: {
            type: 'KANBAN',
            icon: byStage?.icon || 'IconLayoutKanban',
            mainGroupByFieldMetadataId: groupByFieldId,
            kanbanColumnWidth: DEFAULT_KANBAN_COLUMN_WIDTH,
          },
        },
        headers,
      );

      const existingGroupsRes = await this.authClient.request(
        GET_VIEW_GROUPS,
        { viewId: indexView.id },
        headers,
      ) as {
        getViewGroups?: Array<{ fieldValue: string }>;
      };
      if ((existingGroupsRes.getViewGroups ?? []).length === 0) {
        let sourceGroups: Array<{
          fieldValue: string;
          position?: number;
          isVisible?: boolean;
        }> = [];
        if (byStage && byStage.id !== indexView.id) {
          const sourceRes = await this.authClient.request(
            GET_VIEW_GROUPS,
            { viewId: byStage.id },
            headers,
          ) as {
            getViewGroups?: Array<{
              fieldValue: string;
              position?: number;
              isVisible?: boolean;
            }>;
          };
          sourceGroups = sourceRes.getViewGroups ?? [];
        }
        if (sourceGroups.length === 0) {
          sourceGroups = [
            { fieldValue: 'NEW', position: 0 },
            { fieldValue: 'SCREENING', position: 1 },
            { fieldValue: 'MEETING', position: 2 },
            { fieldValue: 'PROPOSAL', position: 3 },
            { fieldValue: 'CUSTOMER', position: 4 },
          ];
        }

        for (const group of sourceGroups) {
          await this.authClient.request(
            CREATE_VIEW_GROUP,
            {
              input: {
                viewId: indexView.id,
                fieldValue: group.fieldValue,
                position: group.position ?? 0,
                isVisible: group.isVisible ?? true,
              },
            },
            headers,
          );
        }
      }
    } else if (
      !indexView.kanbanColumnWidth
      || indexView.kanbanColumnWidth !== DEFAULT_KANBAN_COLUMN_WIDTH
    ) {
      try {
        await this.authClient.request(
          UPDATE_VIEW,
          {
            id: indexView.id,
            input: { kanbanColumnWidth: DEFAULT_KANBAN_COLUMN_WIDTH },
          },
          headers,
        );
      } catch {
        // overrides may already hold width via SQL
      }
    }

    try {
      await this.ensureOpportunityKanbanCardFields(
        indexView.id,
        fieldsList,
        headers,
      );
    } catch {
      // Card field layout is best-effort
    }
  }

  /** Visible fields + order/size on Opportunity INDEX kanban cards. */
  private async ensureOpportunityKanbanCardFields(
    viewId: string,
    fieldsList: Array<{ id: string; name: string }>,
    headers: Record<string, string>,
  ): Promise<void> {
    const vfRes = await this.authClient.request(
      GET_VIEW_FIELDS,
      { viewId },
      headers,
    ) as {
      getViewFields?: Array<{
        id: string;
        fieldMetadataId: string;
        position?: number;
        isVisible?: boolean;
        size?: number;
      }>;
    };
    const viewFields = vfRes.getViewFields ?? [];
    const byFieldId = new Map(viewFields.map((vf) => [vf.fieldMetadataId, vf]));

    for (const spec of OPPORTUNITY_KANBAN_CARD_FIELDS) {
      const field = fieldsList.find((f) => f.name === spec.name);
      if (!field) continue;
      const existing = byFieldId.get(field.id);
      if (!existing) {
        try {
          await this.authClient.request(
            CREATE_VIEW_FIELD,
            {
              input: {
                viewId,
                fieldMetadataId: field.id,
                isVisible: true,
                position: spec.position,
                size: spec.size,
              },
            },
            headers,
          );
        } catch {
          // may already exist under another id
        }
        continue;
      }
      const needsUpdate =
        existing.isVisible !== true
        || existing.position !== spec.position
        || existing.size !== spec.size;
      if (!needsUpdate) continue;
      await this.authClient.request(
        UPDATE_VIEW_FIELD,
        {
          input: {
            id: existing.id,
            update: {
              isVisible: true,
              position: spec.position,
              size: spec.size,
            },
          },
        },
        headers,
      );
    }
  }

  /**
   * Show note body (not title) as the label in relation chips / kanban cards.
   */
  private async ensureNoteBodyAsLabel(
    noteObjectId: string,
    fields: Array<{ id: string; name: string }>,
    headers: Record<string, string>,
  ): Promise<void> {
    const bodyField = fields.find((f) => f.name === 'bodyV2');
    if (!bodyField?.id) return;
    await this.authClient.request(
      UPDATE_ONE_OBJECT_METADATA,
      {
        input: {
          id: noteObjectId,
          update: {
            labelIdentifierFieldMetadataId: bodyField.id,
          },
        },
      },
      headers,
    );
  }

  /** Ensure Person has custom TEXT field `telegram` (label Telegram) in Social group. */
  private async ensurePersonTelegramField(
    personObjectId: string,
    fields: Array<{ id: string; name: string }>,
    headers: Record<string, string>,
  ): Promise<void> {
    let telegramField = fields.find((f) => f.name === 'telegram');
    if (!telegramField) {
      try {
        const created = await this.authClient.request(
          CREATE_ONE_FIELD,
          {
            input: {
              field: {
                objectMetadataId: personObjectId,
                type: 'TEXT',
                name: 'telegram',
                label: 'Telegram',
                icon: 'IconBrandTelegram',
                isNullable: true,
              },
            },
          },
          headers,
        ) as { createOneField?: { id: string; name: string } };
        if (created.createOneField?.id) {
          telegramField = created.createOneField;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!/already exists|duplicate|unique/i.test(msg)) {
          throw err;
        }
      }
      if (!telegramField) {
        // Re-fetch after race
        const context = await this.authClient.request(
          GET_WORKSPACE_DEFAULTS_CONTEXT,
          undefined,
          headers,
        ) as any;
        const person = context.objects?.edges
          ?.map((e: any) => e.node)
          ?.find((o: any) => o.id === personObjectId);
        telegramField = person?.fieldsList?.find((f: any) => f.name === 'telegram');
      }
    }
    if (!telegramField?.id) return;

    const linkedinField = fields.find((f) => f.name === 'linkedinLink');
    await this.movePersonFieldToSocialGroup({
      personObjectId,
      telegramFieldId: telegramField.id,
      linkedinFieldId: linkedinField?.id,
      headers,
    });
  }

  /** Place Person.telegram view field into the same FIELDS_WIDGET group as LinkedIn. */
  private async movePersonFieldToSocialGroup(opts: {
    personObjectId: string;
    telegramFieldId: string;
    linkedinFieldId?: string;
    headers: Record<string, string>;
  }): Promise<void> {
    const { personObjectId, telegramFieldId, linkedinFieldId, headers } = opts;
    try {
      const viewsRes = await this.authClient.request(
        GET_PERSON_FIELD_WIDGET_VIEWS,
        { objectMetadataId: personObjectId },
        headers,
      ) as { getViews?: Array<{ id: string; name?: string; type?: string }> };
      const views = viewsRes.getViews ?? [];
      const fieldsView =
        views.find((v) => /record\s*page\s*fields|FIELDS_WIDGET/i.test(String(v.name || ''))) ||
        views.find((v) => v.type === 'FIELDS_WIDGET') ||
        views[0];
      if (!fieldsView?.id) return;

      const vfRes = await this.authClient.request(
        GET_VIEW_FIELDS,
        { viewId: fieldsView.id },
        headers,
      ) as {
        getViewFields?: Array<{
          id: string;
          fieldMetadataId: string;
          viewFieldGroupId?: string | null;
          position?: number;
        }>;
      };
      const viewFields = vfRes.getViewFields ?? [];
      const telegramVf = viewFields.find((vf) => vf.fieldMetadataId === telegramFieldId);
      if (!telegramVf) return;

      let socialGroupId: string | null | undefined;
      if (linkedinFieldId) {
        socialGroupId = viewFields.find(
          (vf) => vf.fieldMetadataId === linkedinFieldId,
        )?.viewFieldGroupId;
      }
      if (!socialGroupId) {
        // Fallback: groups query by name
        const groupsRes = await this.authClient.request(
          gql`
            query GetViewFieldGroups($viewId: String!) {
              getViewFieldGroups(viewId: $viewId) {
                id
                name
                position
              }
            }
          `,
          { viewId: fieldsView.id },
          headers,
        ) as {
          getViewFieldGroups?: Array<{ id: string; name?: string; position?: number }>;
        };
        const groups = groupsRes.getViewFieldGroups ?? [];
        socialGroupId =
          groups.find((g) => /social|социал/i.test(String(g.name || '')))?.id ||
          groups.find((g) => g.position === 2)?.id;
      }
      if (!socialGroupId) return;
      if (telegramVf.viewFieldGroupId === socialGroupId) return;

      const linkedinPos = linkedinFieldId
        ? viewFields.find((vf) => vf.fieldMetadataId === linkedinFieldId)?.position
        : undefined;
      const position =
        typeof linkedinPos === 'number' ? linkedinPos + 1 : (telegramVf.position ?? 1);

      await this.authClient.request(
        UPDATE_VIEW_FIELD,
        {
          input: {
            id: telegramVf.id,
            update: {
              viewFieldGroupId: socialGroupId,
              position,
            },
          },
        },
        headers,
      );
    } catch {
      // Layout move is best-effort; field still usable in System group
    }
  }

  /**
   * Install a Twenty App (e.g. voxly-platform) into a workspace
   */
  async installApp(appId: string): Promise<void> {
    if (!this.authTokens) {
      throw new Error('Must authenticate before installing apps');
    }
    await this.authClient.request(
      INSTALL_APP,
      { appId },
      { Authorization: `Bearer ${this.authTokens.accessToken}` },
    );
  }

  /**
   * Create a Person in the workspace CRM (Twenty 2.22: arg is `data`, not `input`)
   */
  async createPerson(input: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    /** Telegram @username (with or without @) */
    telegram?: string;
  }): Promise<{ id: string }> {
    const headers = this.getAuthHeaders();
    const telegram = formatTelegramHandle(input.telegram);
    const flat: Record<string, unknown> = {};
    if (input.firstName) flat.firstName = input.firstName;
    if (input.lastName) flat.lastName = input.lastName;
    if (input.email) flat.emails = { primaryEmail: input.email };
    if (input.phone) flat.phones = { primaryPhoneNumber: input.phone };
    if (telegram) flat.telegram = telegram;

    try {
      const result = await this.client.request(CREATE_PERSON, { data: flat }, headers);
      return (result as any).createPerson;
    } catch (flatErr) {
      // Twenty composites: name { firstName, lastName }
      const nested: Record<string, unknown> = {
        name: {
          firstName: input.firstName || '',
          lastName: input.lastName || '',
        },
      };
      if (input.email) nested.emails = { primaryEmail: input.email };
      if (input.phone) nested.phones = { primaryPhoneNumber: input.phone };
      if (telegram) nested.telegram = telegram;
      try {
        const result = await this.client.request(CREATE_PERSON_NAME, { data: nested }, headers);
        return (result as any).createPerson;
      } catch {
        // Custom telegram field may not exist yet — retry without it
        if (telegram) {
          delete flat.telegram;
          delete nested.telegram;
          try {
            const result = await this.client.request(CREATE_PERSON, { data: flat }, headers);
            return (result as any).createPerson;
          } catch {
            const result = await this.client.request(CREATE_PERSON_NAME, { data: nested }, headers);
            return (result as any).createPerson;
          }
        }
        throw flatErr;
      }
    }
  }

  /** Set Person.telegram (@username). Best-effort if custom field missing. */
  async updatePersonTelegram(personId: string, telegram: string): Promise<void> {
    const handle = formatTelegramHandle(telegram);
    if (!handle) return;
    const headers = this.getAuthHeaders();
    try {
      await this.client.request(
        UPDATE_PERSON,
        { id: personId, data: { telegram: handle } },
        headers,
      );
      return;
    } catch {
      /* try alternate mutation shape */
    }
    try {
      await this.client.request(
        gql`
          mutation UpdateOnePerson($id: UUID!, $data: PersonUpdateInput!) {
            updatePerson(id: $id, data: $data) {
              id
            }
          }
        `,
        { id: personId, data: { telegram: handle } },
        headers,
      );
    } catch {
      /* field may not exist yet */
    }
  }

  /**
   * Find an existing Person by lastName / username hint (dedupe before create)
   */
  async findPersonByHint(hints: {
    username?: string;
    telegramId?: string;
    lastName?: string;
  }): Promise<{ id: string } | null> {
    const candidates = [
      hints.lastName,
      hints.username ? `@${hints.username.replace(/^@/, '')}` : undefined,
      hints.telegramId,
      hints.username,
    ].filter(Boolean) as string[];

    for (const value of candidates) {
      try {
        const result = await this.client.request(
          FIND_PEOPLE,
          { filter: { lastName: { eq: value } } },
          this.getAuthHeaders(),
        );
        const id = (result as any).people?.edges?.[0]?.node?.id;
        if (id) return { id };
      } catch {
        // filter shape may differ; try name.lastName
        try {
          const result = await this.client.request(
            FIND_PEOPLE,
            { filter: { name: { lastName: { eq: value } } } },
            this.getAuthHeaders(),
          );
          const id = (result as any).people?.edges?.[0]?.node?.id;
          if (id) return { id };
        } catch {
          /* continue */
        }
      }
    }
    return null;
  }

  /**
   * Create an Opportunity (deal) in the workspace CRM
   */
  async createOpportunity(input: {
    name: string;
    amount?: number;
    personId?: string;
    stage?: string;
  }): Promise<{ id: string }> {
    const headers = this.getAuthHeaders();
    const data: Record<string, unknown> = {
      name: input.name,
    };
    if (input.stage) data.stage = input.stage;
    if (input.amount != null) data.amount = { amountMicros: Math.round(input.amount * 1_000_000), currencyCode: 'RUB' };
    if (input.personId) data.pointOfContactId = input.personId;

    try {
      const result = await this.client.request(CREATE_OPPORTUNITY, { data }, headers);
      return (result as any).createOpportunity;
    } catch (err) {
      // Relation connect form
      if (input.personId) {
        const alt = { ...data };
        delete alt.pointOfContactId;
        alt.pointOfContact = { connect: { id: input.personId } };
        const result = await this.client.request(CREATE_OPPORTUNITY, { data: alt }, headers);
        return (result as any).createOpportunity;
      }
      throw err;
    }
  }

  /**
   * Attach a note to a Person (timeline). Used when custom ChatMessage objects
   * are not installed (Twenty 2.21 has no installApp for voxly-platform).
   */
  async createNoteForPerson(input: {
    personId: string;
    title: string;
    body: string;
  }): Promise<{ id: string } | null> {
    try {
      const result = await this.client.request(
        CREATE_NOTE,
        {
          data: {
            title: input.title,
            bodyV2: { markdown: input.body },
            noteTargets: [{ personId: input.personId }],
          },
        },
        this.getAuthHeaders(),
      );
      return (result as any).createNote;
    } catch {
      // Fallback without nested targets (note still created in workspace)
      try {
        const result = await this.client.request(
          CREATE_NOTE,
          {
            data: {
              title: `${input.title} · person:${input.personId}`,
              bodyV2: { markdown: input.body },
            },
          },
          this.getAuthHeaders(),
        );
        return (result as any).createNote;
      } catch {
        return null;
      }
    }
  }

  setAuthTokens(tokens: { accessToken: string; refreshToken?: string }): void {
    this.authTokens = tokens;
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.authTokens) return {};
    return { Authorization: `Bearer ${this.authTokens.accessToken}` };
  }
}
