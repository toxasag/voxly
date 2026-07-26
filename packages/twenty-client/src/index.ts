// Voxly Twenty CRM GraphQL Client
// Handles workspace provisioning, user creation, and API calls to Twenty

import { GraphQLClient, gql } from 'graphql-request';

export interface TwentyClientConfig {
  apiUrl: string; // http://twenty-server:3000/graphql
  apiKey?: string; // service token
}

export interface EnsureCrmChatAppOptions {
  /** Browser origin of this workspace CRM (e.g. https://slug-crm.getvoxly.ru). */
  workspaceOrigin: string;
  /** saas-api URL as seen from Twenty logic functions (docker: http://saas-api:3002). */
  voxlyApiUrl?: string;
  /** Pre-built `yarn twenty dev:build --tarball` bytes (.tgz). */
  tarball?: Uint8Array;
  /** Path hint for callers; saas-api reads the file and passes `tarball`. */
  tarballPath?: string;
  /**
   * Uninstall then reinstall so front-components pick up a new tarball.
   * Private apps have no upgradeApplication — required after registry refresh.
   */
  forceReinstall?: boolean;
}

function formatTelegramHandle(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const cleaned = String(raw).trim().replace(/^@+/, '');
  if (!cleaned) return undefined;
  return `@${cleaned}`;
}

/** Normalize WhatsApp to +E.164 digits for Person.whatsapp TEXT field. */
function formatWhatsappHandle(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const digits = String(raw).replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (!digits || digits.length < 10 || digits.length > 15) return undefined;
  return `+${digits}`;
}

/**
 * Normalize a phone to +E.164 when possible (RU 8… / 9… heuristics).
 * Returns undefined for empty / LID-like / too-short values.
 */
export function normalizePhoneToE164(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  let digits = String(raw).replace(/\D/g, '');
  if (!digits) return undefined;
  // Skip WA Linked IDs / device ids (14+ digits).
  if (digits.length >= 14) return undefined;
  if (digits.length < 10 || digits.length > 13) return undefined;
  // RU local trunk 8XXXXXXXXXX → 7XXXXXXXXXX
  if (digits.length === 11 && digits.startsWith('8')) {
    digits = `7${digits.slice(1)}`;
  }
  // RU national 9XXXXXXXXX → +7…
  if (digits.length === 10 && digits.startsWith('9')) {
    digits = `7${digits}`;
  }
  return `+${digits}`;
}

/** Search variants for Twenty phones / whatsapp eq filters. */
export function phoneSearchVariants(raw?: string | null): string[] {
  const e164 = normalizePhoneToE164(raw);
  if (!e164) return [];
  const digits = e164.replace(/\D/g, '');
  const variants = new Set<string>();
  variants.add(e164);
  variants.add(digits);
  if (digits.length === 11 && digits.startsWith('7')) {
    variants.add(digits.slice(1));
    variants.add(`+7${digits.slice(1)}`);
  }
  return [...variants];
}

/** Twenty stores/looks up emails case-sensitively; always normalize before auth. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface ProvisionWorkspaceParams {
  workspaceName: string;
  subdomain: string;
  ownerEmail: string;
  ownerFirstName?: string;
  ownerLastName?: string;
  ownerPassword: string;
  /** Public CRM host, e.g. `antontest-crm.getvoxly.ru` (prod Traefik `*-crm`). */
  customDomain?: string;
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

const GET_OPPORTUNITY_STAGE_FIELD = gql`
  query GetOpportunityStageField {
    objects(paging: { first: 200 }, filter: { nameSingular: { eq: "opportunity" } }) {
      edges {
        node {
          id
          nameSingular
          fieldsList {
            id
            name
            options
          }
        }
      }
    }
  }
`;

/** Twenty seed option id for the first Opportunity stage (label/value may be renamed). */
export const OPPORTUNITY_NEW_STAGE_OPTION_ID =
  '20202020-8e01-4afd-9c39-d2063097587a';

const DELETE_CURRENT_WORKSPACE = gql`
  mutation DeleteCurrentWorkspace {
    deleteCurrentWorkspace {
      id
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
      name
      type
      key
      mainGroupByFieldMetadataId
      kanbanColumnWidth
    }
  }
`;

/** Default Opportunity INDEX board name in the view selector. */
const OPPORTUNITY_KANBAN_VIEW_NAME = 'Канбан';

/** Secondary Opportunity table/list view name. */
const OPPORTUNITY_LIST_VIEW_NAME = 'Списком';

/** Seeded / localized names we replace with OPPORTUNITY_KANBAN_VIEW_NAME. */
const OPPORTUNITY_DEFAULT_VIEW_NAME_RE =
  /^(all(\s+opportunit(y|ies)|(\s+сделк[аи]))?|все(\s+возможност(ь|и))?|by\s+stage|по\s+этапа?м?|этапы|all\s*\{objectLabelPlural\}|\{objectLabelPlural\})$/i;

/** Seeded names we rename to OPPORTUNITY_LIST_VIEW_NAME on non-INDEX views. */
const OPPORTUNITY_LIST_VIEW_NAME_RE =
  /^(all(\s+opportunit(y|ies)|(\s+сделк[аи]))?|все(\s+возможност(ь|и))?|список|списком|list|table|all\s*\{objectLabelPlural\}|\{objectLabelPlural\})$/i;

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
  { name: 'noteTargets', position: 6, size: 280 },
];

const DEFAULT_KANBAN_COLUMN_WIDTH = 320;

/** Person «Социальные сети» custom TEXT fields (LinkedIn is built-in LINKS). */
const PERSON_SOCIAL_TEXT_FIELDS: Array<{
  name: string;
  label: string;
  icon: string;
}> = [
  { name: 'telegram', label: 'Telegram', icon: 'IconBrandTelegram' },
  { name: 'whatsapp', label: 'WhatsApp', icon: 'IconBrandWhatsapp' },
  { name: 'odnoklassniki', label: 'Одноклассники', icon: 'IconUsers' },
  { name: 'vkontakte', label: 'ВКонтакте', icon: 'IconBrandVk' },
  { name: 'instagram', label: 'Instagram', icon: 'IconBrandInstagram' },
  { name: 'facebook', label: 'Facebook', icon: 'IconBrandFacebook' },
  { name: 'threads', label: 'Threads', icon: 'IconBrandThreads' },
];
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

const ACTIVATE_WORKSPACE = gql`
  mutation ActivateWorkspace($data: ActivateWorkspaceInput!) {
    activateWorkspace(data: $data) {
      id
      activationStatus
      databaseSchema
    }
  }
`;

const UPDATE_WORKSPACE = gql`
  mutation UpdateWorkspace($input: UpdateWorkspaceInput!) {
    updateWorkspace(data: $input) {
      id
      customDomain
      workspaceUrls {
        subdomainUrl
        customUrl
      }
    }
  }
`;

/** Twenty 2.22+ marketplace / private-registry install (legacy installApp is gone — INC-006). */
const INSTALL_APPLICATION = gql`
  mutation InstallApplication($universalIdentifier: String!) {
    installApplication(universalIdentifier: $universalIdentifier) {
      id
    }
  }
`;

const UNINSTALL_APPLICATION = gql`
  mutation UninstallApplication($universalIdentifier: String!) {
    uninstallApplication(universalIdentifier: $universalIdentifier)
  }
`;

const FIND_MANY_APPLICATIONS = gql`
  query FindManyApplications {
    findManyApplications {
      id
      name
      universalIdentifier
    }
  }
`;

const UPDATE_ONE_APPLICATION_VARIABLE = gql`
  mutation UpdateOneApplicationVariable(
    $key: String!
    $value: String!
    $applicationId: UUID!
  ) {
    updateOneApplicationVariable(
      key: $key
      value: $value
      applicationId: $applicationId
    )
  }
`;

const TRIGGER_INSTALL_APPS_ONBOARDING = gql`
  mutation TriggerInstallAppsOnboardingStep($universalIdentifiers: [String!]!) {
    triggerInstallAppsOnboardingStep(universalIdentifiers: $universalIdentifiers) {
      success
    }
  }
`;

/** Published / CLI-applied universal id of twenty-app/voxly-crm-chat */
export const VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER =
  'b5c92442-f0ae-4090-8a31-88fd51785c25';

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isAlreadyInstalledError(err: unknown): boolean {
  return /already installed|already exists|APP_ALREADY_INSTALLED/i.test(errorMessage(err));
}

function isNotInstalledError(err: unknown): boolean {
  return /not installed|not found|APP_NOT_INSTALLED|does not exist/i.test(errorMessage(err));
}

/** Browser origin from a Twenty workspace URL (custom or subdomain). */
export function workspaceUrlToOrigin(workspaceUrl: string): string {
  try {
    return new URL(workspaceUrl).origin;
  } catch {
    return workspaceUrl.replace(/\/+$/, '');
  }
}

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

const UPDATE_OPPORTUNITY = gql`
  mutation UpdateOpportunity($id: UUID!, $data: OpportunityUpdateInput!) {
    updateOpportunity(id: $id, data: $data) {
      id
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

const FIND_OPPORTUNITIES = gql`
  query FindOpportunities($filter: OpportunityFilterInput) {
    opportunities(filter: $filter, first: 1) {
      edges {
        node {
          id
          stage
          name
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
  private config: TwentyClientConfig;
  private authTokens: { accessToken: string; refreshToken?: string } | null = null;

  constructor(config: TwentyClientConfig) {
    this.config = config;
    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
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
    const ownerEmail = normalizeEmail(params.ownerEmail);
    let workspaceAgnosticToken: string;
    try {
      const signUpResult = await this.authClient.request(SIGN_UP, {
        email: ownerEmail,
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
          email: ownerEmail,
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

    // Finish schema creation (PENDING_CREATION → ACTIVE) before optional branding.
    try {
      await this.authClient.request(
        ACTIVATE_WORKSPACE,
        { data: {} },
        this.getAuthHeaders(),
      );
    } catch {
      // Idempotent if already ACTIVE / concurrent activation.
    }

    // Prod Traefik serves CRM at {slug}-crm.{domain}, not {slug}.app.{domain}.
    let resolvedWorkspaceUrl = workspaceUrl;
    if (params.customDomain) {
      try {
        const updated = (await this.authClient.request(
          UPDATE_WORKSPACE,
          { input: { customDomain: params.customDomain } },
          this.getAuthHeaders(),
        )) as any;
        resolvedWorkspaceUrl =
          updated?.updateWorkspace?.workspaceUrls?.customUrl ??
          updated?.updateWorkspace?.workspaceUrls?.subdomainUrl ??
          workspaceUrl;
      } catch {
        // Local / single-host installs may reject custom domains.
      }
    }

    try {
      await this.applyWorkspaceDefaults();
    } catch {
      // Workspace provisioning must remain successful even if optional
      // localization metadata is temporarily unavailable.
    }

    try {
      await this.skipInstallAppsOnboarding();
    } catch {
      // Optional: owner can still dismiss /install-apps manually.
    }

    return {
      workspaceId: workspaceData.workspace.id,
      subdomain: params.subdomain,
      workspaceUrl: resolvedWorkspaceUrl,
      loginToken,
      authTokens: this.authTokens,
    };
  }

  async createWorkspaceLoginUrl(
    email: string,
    password: string,
    workspaceId: string,
  ): Promise<string> {
    const normalizedEmail = normalizeEmail(email);
    const result = await this.authClient.request(SIGN_IN, {
      email: normalizedEmail,
      password,
    });
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
    const normalizedEmail = normalizeEmail(email);
    const result = await this.authClient.request(SIGN_IN, {
      email: normalizedEmail,
      password,
    });
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

  /**
   * Complete Twenty `/install-apps` onboarding without installing marketplace apps.
   * Empty universalIdentifiers = "skip" (user lands in CRM, not the gallery).
   */
  async skipInstallAppsOnboarding(): Promise<void> {
    const headers = this.getAuthHeaders();
    await this.authClient.request(
      TRIGGER_INSTALL_APPS_ONBOARDING,
      { universalIdentifiers: [] },
      headers,
    );
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

    // isLabelSyncedWithName is NOT editable on standard objects via GraphQL
    // (Twenty: «Cannot edit standard object metadata properties: isLabelSyncedWithName»).
    // Labels alone are allowed; SQL (set-opportunity-kanban-default.sql) also forces
    // isLabelSyncedWithName=false so RU labels stick. Opportunity → Сделка/Сделки drives
    // nav, list header, Person relation widget, and create CTA («Новая Сделка» with ru-RU).
    const ruObjectLabels: Record<string, { singular: string; plural: string }> = {
      opportunity: { singular: 'Сделка', plural: 'Сделки' },
      company: { singular: 'Компания', plural: 'Компании' },
      person: { singular: 'Контакт', plural: 'Люди' },
      note: { singular: 'Заметка', plural: 'Заметки' },
      task: { singular: 'Задача', plural: 'Задачи' },
    };

    for (const [nameSingular, labels] of Object.entries(ruObjectLabels)) {
      const object = objects.find(
        (item: { nameSingular: string }) => item.nameSingular === nameSingular,
      );
      if (!object) continue;
      try {
        await this.authClient.request(
          UPDATE_ONE_OBJECT_METADATA,
          {
            input: {
              id: object.id,
              update: {
                labelSingular: labels.singular,
                labelPlural: labels.plural,
              },
            },
          },
          headers,
        );
      } catch (error) {
        // Opportunity labels are product-critical (Сделки); rethrow so reapply fails loudly.
        if (nameSingular === 'opportunity') {
          throw error;
        }
      }
    }

    const opportunity = objects.find(
      (object: { nameSingular: string }) => object.nameSingular === 'opportunity',
    );
    if (opportunity) {
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
        await this.ensurePersonSocialFields(person.id, person.fieldsList ?? [], headers);
      } catch {
        // Optional: workspace still usable without social custom fields
      }
    }

    const note = objects.find(
      (object: { nameSingular: string }) => object.nameSingular === 'note',
    );
    if (note) {
      try {
        await this.ensureNoteTitleAsLabel(note.id, note.fieldsList ?? [], headers);
      } catch {
        // Optional: kanban may keep a wrong labelIdentifier until SQL re-run
      }
    }
  }

  /**
   * Ensure Person social custom fields exist (idempotent).
   * Safe to call before create/update with telegram / whatsapp handles.
   */
  async ensureTelegramField(): Promise<void> {
    await this.ensureSocialFields();
  }

  /** Ensure Person «Социальные сети» TEXT fields (Telegram, WhatsApp, …). */
  async ensureSocialFields(): Promise<void> {
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
    await this.ensurePersonSocialFields(person.id, person.fieldsList ?? [], headers);
  }

  /**
   * Make Opportunity default INDEX view a stage kanban with Voxly card defaults,
   * and ensure a secondary TABLE view named «Списком».
   *
   * Prefer existing «By Stage» board as INDEX via SQL (GraphQL cannot set key).
   * Do NOT convert the seeded TABLE INDEX to KANBAN when a separate board exists:
   * updateView writes type/icon into overrides and leaves a second fake kanban
   * («All Сделки») after SQL demotes that row. Fallback in-place convert only
   * when no other KANBAN board is present.
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
          view.id !== indexView.id
          && view.type === 'KANBAN'
          && (
            /stage|этап|канбан/i.test(String(view.name || ''))
            || view.mainGroupByFieldMetadataId === stageFieldId
          ),
      )
      ?? views.find(
        (view) => view.id !== indexView.id && view.type === 'KANBAN',
      );

    const groupByFieldId =
      byStage?.mainGroupByFieldMetadataId
      ?? stageFieldId;

    // Separate board exists → SQL promotes it to INDEX. Converting seeded INDEX
    // here poisons overrides and shows «All Сделки» as a second kanban.
    const shouldConvertIndexInPlace = !byStage;

    const needsKanbanType =
      shouldConvertIndexInPlace
      && (indexView.type !== 'KANBAN' || !indexView.mainGroupByFieldMetadataId);

    if (needsKanbanType) {
      await this.authClient.request(
        UPDATE_VIEW,
        {
          id: indexView.id,
          input: {
            type: 'KANBAN',
            icon: 'IconLayoutKanban',
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
        const sourceGroups = [
          { fieldValue: 'NEW', position: 0 },
          { fieldValue: 'SCREENING', position: 1 },
          { fieldValue: 'MEETING', position: 2 },
          { fieldValue: 'PROPOSAL', position: 3 },
          { fieldValue: 'CUSTOMER', position: 4 },
        ];

        for (const group of sourceGroups) {
          await this.authClient.request(
            CREATE_VIEW_GROUP,
            {
              input: {
                viewId: indexView.id,
                fieldValue: group.fieldValue,
                position: group.position ?? 0,
                isVisible: true,
              },
            },
            headers,
          );
        }
      }
    } else if (
      indexView.type === 'KANBAN'
      && (
        !indexView.kanbanColumnWidth
        || indexView.kanbanColumnWidth !== DEFAULT_KANBAN_COLUMN_WIDTH
      )
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

    const indexName = String(indexView.name || '').trim();
    if (
      indexView.type === 'KANBAN'
      && indexName !== OPPORTUNITY_KANBAN_VIEW_NAME
      && (
        !indexName
        || OPPORTUNITY_DEFAULT_VIEW_NAME_RE.test(indexName)
        || /opportunit|возможност|сделк|stage|этап/i.test(indexName)
      )
    ) {
      try {
        await this.authClient.request(
          UPDATE_VIEW,
          {
            id: indexView.id,
            input: {
              name: OPPORTUNITY_KANBAN_VIEW_NAME,
              icon: 'IconLayoutKanban',
            },
          },
          headers,
        );
      } catch {
        // View selector may keep seeded name until SQL rename.
      }
    }

    try {
      await this.ensureOpportunityListView(views, indexView.id, headers);
    } catch {
      // List view rename is best-effort; SQL ensureOpportunityRuDefaults is SoT
    }

    if (indexView.type === 'KANBAN' || needsKanbanType) {
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
  }

  /**
   * Ensure non-INDEX Opportunity views are a real TABLE named «Списком»
   * (not a second kanban labelled All Opportunities / All Сделки).
   * Clearing poisoned overrides still requires SQL (ensureOpportunityRuDefaults).
   */
  private async ensureOpportunityListView(
    views: Array<{
      id: string;
      name?: string | null;
      type?: string | null;
      key?: string | null;
      icon?: string | null;
    }>,
    indexViewId: string,
    headers: Record<string, string>,
  ): Promise<void> {
    const candidates = views.filter(
      (view) =>
        view.id !== indexViewId
        && view.key !== 'INDEX'
        && (view.type === 'TABLE' || view.type === 'KANBAN'),
    );
    if (candidates.length === 0) return;

    const preferred =
      candidates.find((view) => {
        const name = String(view.name || '').trim();
        return (
          name === OPPORTUNITY_LIST_VIEW_NAME
          || OPPORTUNITY_LIST_VIEW_NAME_RE.test(name)
          || /opportunit|возможност|сделк|список|objectLabelPlural/i.test(name)
        );
      })
      ?? candidates[0];

    const name = String(preferred.name || '').trim();
    const needsUpdate =
      preferred.type !== 'TABLE'
      || preferred.icon !== 'IconList'
      || name !== OPPORTUNITY_LIST_VIEW_NAME;

    if (needsUpdate) {
      await this.authClient.request(
        UPDATE_VIEW,
        {
          id: preferred.id,
          input: {
            type: 'TABLE',
            icon: 'IconList',
            name: OPPORTUNITY_LIST_VIEW_NAME,
          },
        },
        headers,
      );
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
   * Kanban/relation chips use labelIdentifier as a string. Note.bodyV2 is RICH_TEXT
   * (object) and becomes "[object Object]" — keep label on TEXT `title`.
   * Body text is mirrored into title by docker/set-opportunity-kanban-card-defaults.sql
   * (trigger + backfill) and by createNoteForPerson below.
   */
  private async ensureNoteTitleAsLabel(
    noteObjectId: string,
    fields: Array<{ id: string; name: string }>,
    headers: Record<string, string>,
  ): Promise<void> {
    const titleField = fields.find((f) => f.name === 'title');
    if (!titleField?.id) return;
    await this.authClient.request(
      UPDATE_ONE_OBJECT_METADATA,
      {
        input: {
          id: noteObjectId,
          update: {
            labelIdentifierFieldMetadataId: titleField.id,
          },
        },
      },
      headers,
    );
  }

  /** Ensure Person social TEXT fields exist and sit in the Social FIELDS_WIDGET group. */
  private async ensurePersonSocialFields(
    personObjectId: string,
    fields: Array<{ id: string; name: string }>,
    headers: Record<string, string>,
  ): Promise<void> {
    let workingFields = [...fields];
    const ensuredIds: string[] = [];

    for (const spec of PERSON_SOCIAL_TEXT_FIELDS) {
      let field = workingFields.find((f) => f.name === spec.name);
      if (!field) {
        try {
          const created = await this.authClient.request(
            CREATE_ONE_FIELD,
            {
              input: {
                field: {
                  objectMetadataId: personObjectId,
                  type: 'TEXT',
                  name: spec.name,
                  label: spec.label,
                  icon: spec.icon,
                  isNullable: true,
                },
              },
            },
            headers,
          ) as { createOneField?: { id: string; name: string } };
          if (created.createOneField?.id) {
            field = created.createOneField;
            workingFields.push(field);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/already exists|duplicate|unique/i.test(msg)) {
            throw err;
          }
        }
        if (!field) {
          const context = await this.authClient.request(
            GET_WORKSPACE_DEFAULTS_CONTEXT,
            undefined,
            headers,
          ) as any;
          const person = context.objects?.edges
            ?.map((e: any) => e.node)
            ?.find((o: any) => o.id === personObjectId);
          const refreshed: Array<{ id: string; name: string }> =
            person?.fieldsList ?? [];
          workingFields = refreshed.length ? refreshed : workingFields;
          field = workingFields.find((f) => f.name === spec.name);
        }
      }
      if (field?.id) ensuredIds.push(field.id);
    }

    if (ensuredIds.length === 0) return;

    const linkedinField = workingFields.find((f) => f.name === 'linkedinLink');
    await this.movePersonFieldsToSocialGroup({
      personObjectId,
      fieldIds: ensuredIds,
      linkedinFieldId: linkedinField?.id,
      headers,
    });
  }

  /** Place Person social view fields into the same FIELDS_WIDGET group as LinkedIn. */
  private async movePersonFieldsToSocialGroup(opts: {
    personObjectId: string;
    fieldIds: string[];
    linkedinFieldId?: string;
    headers: Record<string, string>;
  }): Promise<void> {
    const { personObjectId, fieldIds, linkedinFieldId, headers } = opts;
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
      let viewFields = vfRes.getViewFields ?? [];

      let socialGroupId: string | null | undefined;
      if (linkedinFieldId) {
        socialGroupId = viewFields.find(
          (vf) => vf.fieldMetadataId === linkedinFieldId,
        )?.viewFieldGroupId;
      }
      if (!socialGroupId) {
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

      const linkedinPos = linkedinFieldId
        ? viewFields.find((vf) => vf.fieldMetadataId === linkedinFieldId)?.position
        : undefined;
      let nextPos =
        typeof linkedinPos === 'number' ? linkedinPos + 1 : 1;

      for (const fieldId of fieldIds) {
        let vf = viewFields.find((v) => v.fieldMetadataId === fieldId);
        if (!vf) {
          try {
            const created = await this.authClient.request(
              CREATE_VIEW_FIELD,
              {
                input: {
                  viewId: fieldsView.id,
                  fieldMetadataId: fieldId,
                  isVisible: true,
                  position: nextPos,
                },
              },
              headers,
            ) as { createViewField?: { id: string; fieldMetadataId: string; position?: number } };
            if (created.createViewField?.id) {
              vf = {
                id: created.createViewField.id,
                fieldMetadataId: fieldId,
                viewFieldGroupId: null,
                position: created.createViewField.position ?? nextPos,
              };
              viewFields = [...viewFields, vf];
            }
          } catch {
            // Field may appear after metadata refresh
            continue;
          }
        }
        if (!vf) continue;
        if (vf.viewFieldGroupId === socialGroupId) {
          nextPos = Math.max(nextPos, (vf.position ?? nextPos) + 1);
          continue;
        }
        await this.authClient.request(
          UPDATE_VIEW_FIELD,
          {
            input: {
              id: vf.id,
              update: {
                viewFieldGroupId: socialGroupId,
                position: nextPos,
              },
            },
          },
          headers,
        );
        nextPos += 1;
      }
    } catch {
      // Layout move is best-effort; fields still usable in System group
    }
  }

  /**
   * Install a Twenty App by universal identifier (2.22+ `installApplication`).
   * The app must already be in the server registry (`uploadAppTarball` / private publish).
   * Prefer `ensureCrmChatAppInstalled` for provisioning.
   */
  async installApp(universalIdentifier: string, _version?: string): Promise<void> {
    if (!this.authTokens) {
      throw new Error('Must authenticate before installing apps');
    }
    const id =
      universalIdentifier === 'voxly-platform' || universalIdentifier === 'voxly-crm-chat'
        ? VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER
        : universalIdentifier;
    await this.authClient.request(
      INSTALL_APPLICATION,
      { universalIdentifier: id },
      { Authorization: `Bearer ${this.authTokens.accessToken}` },
    );
  }

  /** Remove CRM chat (or other) app from the current workspace. Idempotent. */
  async uninstallApp(universalIdentifier: string = VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER): Promise<void> {
    if (!this.authTokens) {
      throw new Error('Must authenticate before uninstalling apps');
    }
    const id =
      universalIdentifier === 'voxly-platform' || universalIdentifier === 'voxly-crm-chat'
        ? VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER
        : universalIdentifier;
    try {
      await this.authClient.request(
        UNINSTALL_APPLICATION,
        { universalIdentifier: id },
        { Authorization: `Bearer ${this.authTokens.accessToken}` },
      );
    } catch (err) {
      if (!isNotInstalledError(err)) throw err;
    }
  }

  /**
   * Publish (or refresh) a private app tarball into the Twenty server registry.
   * Built via `yarn twenty dev:build --tarball`.
   */
  async uploadAppTarball(
    tarball: Uint8Array,
    universalIdentifier: string = VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER,
  ): Promise<void> {
    if (!this.authTokens) {
      throw new Error('Must authenticate before uploading apps');
    }
    const metadataUrl = this.config.apiUrl.replace(/\/graphql\/?$/, '/metadata');
    const operations = JSON.stringify({
      query: `
        mutation UploadAppTarball($file: Upload!, $universalIdentifier: String) {
          uploadAppTarball(file: $file, universalIdentifier: $universalIdentifier) {
            id
            universalIdentifier
            name
          }
        }
      `,
      variables: { file: null, universalIdentifier },
    });
    const form = new FormData();
    form.append('operations', operations);
    form.append('map', JSON.stringify({ '0': ['variables.file'] }));
    const bytes = new Uint8Array(tarball.byteLength);
    bytes.set(tarball);
    form.append('0', new Blob([bytes], { type: 'application/gzip' }), 'app.tar.gz');

    const res = await fetch(metadataUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.authTokens.accessToken}` },
      body: form,
    });
    const json = (await res.json()) as {
      data?: { uploadAppTarball?: { id: string } };
      errors?: Array<{ message?: string }>;
    };
    if (!res.ok || json.errors?.length) {
      throw new Error(
        json.errors?.[0]?.message || `uploadAppTarball failed (HTTP ${res.status})`,
      );
    }
    if (!json.data?.uploadAppTarball?.id) {
      throw new Error('uploadAppTarball returned no application id');
    }
  }

  async findCrmChatApplicationId(): Promise<string | null> {
    if (!this.authTokens) {
      throw new Error('Must authenticate before listing applications');
    }
    const result = (await this.authClient.request(
      FIND_MANY_APPLICATIONS,
      {},
      { Authorization: `Bearer ${this.authTokens.accessToken}` },
    )) as {
      findManyApplications?: Array<{
        id: string;
        name?: string;
        universalIdentifier?: string;
      }>;
    };
    const apps = result.findManyApplications ?? [];
    const hit =
      apps.find((a) => a.universalIdentifier === VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER) ||
      apps.find((a) => /voxly.*chat/i.test(a.name || ''));
    return hit?.id ?? null;
  }

  async updateApplicationVariable(
    applicationId: string,
    key: string,
    value: string,
  ): Promise<void> {
    if (!this.authTokens) {
      throw new Error('Must authenticate before updating application variables');
    }
    await this.authClient.request(
      UPDATE_ONE_APPLICATION_VARIABLE,
      { key, value, applicationId },
      { Authorization: `Bearer ${this.authTokens.accessToken}` },
    );
  }

  /**
   * Ensure voxly-crm-chat is installed in the current workspace (marketplace/private registry).
   * Uploads the tarball when provided (refreshes private registry), then installs and sets
   * WORKSPACE_ORIGIN / VOXLY_API_URL.
   */
  async ensureCrmChatAppInstalled(options: EnsureCrmChatAppOptions): Promise<void> {
    if (!this.authTokens) {
      throw new Error('Must authenticate before installing CRM chat');
    }

    const tarball = options.tarball;
    const workspaceOrigin = options.workspaceOrigin.replace(/\/+$/, '');
    const voxlyApiUrl = (options.voxlyApiUrl || 'http://saas-api:3002').replace(/\/+$/, '');
    const forceReinstall = options.forceReinstall === true;

    if (tarball && tarball.byteLength > 0) {
      try {
        await this.uploadAppTarball(tarball, VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER);
      } catch (err) {
        // Registry already has this universalIdentifier from a prior tenant — OK, install into this workspace.
        if (!/duplicate|unique|already exists|already registered/i.test(errorMessage(err))) {
          throw err;
        }
      }
    }

    const existingId = await this.findCrmChatApplicationId();
    if (forceReinstall && existingId) {
      await this.uninstallApp(VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER);
    }

    try {
      await this.installApp(VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER);
    } catch (err) {
      if (!isAlreadyInstalledError(err)) {
        throw err;
      }
      if (forceReinstall) {
        // Already installed after failed uninstall — last resort: try again after uninstall
        await this.uninstallApp(VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER);
        await this.installApp(VOXLY_CRM_CHAT_UNIVERSAL_IDENTIFIER);
      }
    }

    const applicationId = await this.findCrmChatApplicationId();
    if (!applicationId) {
      throw new Error('CRM chat app installed but findManyApplications did not return it');
    }
    await this.updateApplicationVariable(applicationId, 'WORKSPACE_ORIGIN', workspaceOrigin);
    await this.updateApplicationVariable(applicationId, 'VOXLY_API_URL', voxlyApiUrl);
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
    /** WhatsApp E.164 (+digits) — custom Person.whatsapp TEXT field */
    whatsapp?: string;
  }): Promise<{ id: string }> {
    const headers = this.getAuthHeaders();
    const telegram = formatTelegramHandle(input.telegram);
    const whatsapp = formatWhatsappHandle(input.whatsapp);
    const flat: Record<string, unknown> = {};
    if (input.firstName) flat.firstName = input.firstName;
    if (input.lastName) flat.lastName = input.lastName;
    if (input.email) flat.emails = { primaryEmail: input.email };
    if (input.phone) flat.phones = { primaryPhoneNumber: input.phone };
    if (telegram) flat.telegram = telegram;
    if (whatsapp) flat.whatsapp = whatsapp;

    const nestedBase: Record<string, unknown> = {
      name: {
        firstName: input.firstName || '',
        lastName: input.lastName || '',
      },
    };
    if (input.email) nestedBase.emails = { primaryEmail: input.email };
    if (telegram) nestedBase.telegram = telegram;
    if (whatsapp) nestedBase.whatsapp = whatsapp;

    try {
      const result = await this.client.request(CREATE_PERSON, { data: flat }, headers);
      return (result as any).createPerson;
    } catch (flatErr) {
      // Twenty composites: name { firstName, lastName }. Phone alone often fails
      // validation (calling code required / LID not E.164) — retry without phones.
      const withPhone: Record<string, unknown> = { ...nestedBase };
      if (input.phone) withPhone.phones = { primaryPhoneNumber: input.phone };
      try {
        const result = await this.client.request(CREATE_PERSON_NAME, { data: withPhone }, headers);
        return (result as any).createPerson;
      } catch {
        try {
          const result = await this.client.request(CREATE_PERSON_NAME, { data: nestedBase }, headers);
          return (result as any).createPerson;
        } catch {
          if (telegram || whatsapp) {
            delete flat.telegram;
            delete flat.whatsapp;
            const noSocial = { ...nestedBase };
            delete noSocial.telegram;
            delete noSocial.whatsapp;
            try {
              const result = await this.client.request(CREATE_PERSON, { data: flat }, headers);
              return (result as any).createPerson;
            } catch {
              const result = await this.client.request(CREATE_PERSON_NAME, { data: noSocial }, headers);
              return (result as any).createPerson;
            }
          }
          throw flatErr;
        }
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

  /** Set Person primary email. Best-effort. */
  async updatePersonEmail(personId: string, email: string): Promise<void> {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized || !normalized.includes('@')) return;
    const headers = this.getAuthHeaders();
    try {
      await this.client.request(
        UPDATE_PERSON,
        { id: personId, data: { emails: { primaryEmail: normalized } } },
        headers,
      );
    } catch {
      /* ignore — composite / permission */
    }
  }

  /** Set Person.whatsapp (+E.164). Best-effort if custom field missing. */
  async updatePersonWhatsapp(personId: string, whatsapp: string): Promise<void> {
    const handle = formatWhatsappHandle(whatsapp);
    if (!handle) return;
    const headers = this.getAuthHeaders();
    try {
      await this.client.request(
        UPDATE_PERSON,
        { id: personId, data: { whatsapp: handle } },
        headers,
      );
      return;
    } catch {
      /* try alternate */
    }
    try {
      await this.client.request(
        gql`
          mutation UpdateOnePersonWhatsapp($id: UUID!, $data: PersonUpdateInput!) {
            updatePerson(id: $id, data: $data) {
              id
            }
          }
        `,
        { id: personId, data: { whatsapp: handle } },
        headers,
      );
    } catch {
      /* field may not exist yet */
    }
  }

  /** Set Person primary phone (Twenty phones composite). Best-effort. */
  async updatePersonPhone(personId: string, phone: string): Promise<void> {
    const raw = String(phone || '').trim();
    if (!raw) return;
    const digits = raw.replace(/\D/g, '');
    const withPlus = raw.startsWith('+') ? raw : digits ? `+${digits}` : raw;
    const headers = this.getAuthHeaders();
    const attempts = [
      { phones: { primaryPhoneNumber: withPlus } },
      { phones: { primaryPhoneNumber: digits } },
    ];
    // RU mobiles: split calling code for Twenty validators that require it.
    if (digits.length === 11 && digits.startsWith('7')) {
      attempts.unshift({
        phones: {
          primaryPhoneNumber: digits.slice(1),
          primaryPhoneCallingCode: '+7',
          primaryPhoneCountryCode: 'RU',
        } as any,
      });
    }
    for (const data of attempts) {
      try {
        await this.client.request(UPDATE_PERSON, { id: personId, data }, headers);
        return;
      } catch {
        /* try next shape */
      }
    }
  }

  /** Best-effort rename Person (clear LID lastName etc.). */
  async updatePersonName(
    personId: string,
    name: { firstName?: string; lastName?: string },
  ): Promise<void> {
    const headers = this.getAuthHeaders();
    const flat: Record<string, unknown> = {};
    if (typeof name.firstName === 'string') flat.firstName = name.firstName;
    if (typeof name.lastName === 'string') flat.lastName = name.lastName;
    const nested = {
      name: {
        firstName: name.firstName || '',
        lastName: name.lastName || '',
      },
    };
    try {
      await this.client.request(UPDATE_PERSON, { id: personId, data: flat }, headers);
      return;
    } catch {
      /* try nested */
    }
    try {
      await this.client.request(UPDATE_PERSON, { id: personId, data: nested }, headers);
    } catch {
      /* ignore */
    }
  }

  /** True if Person id still exists in Twenty (false after CRM wipe / soft-delete). */
  async personExists(personId: string): Promise<boolean> {
    if (!personId) return false;
    try {
      const result = await this.client.request(
        FIND_PEOPLE,
        { filter: { id: { eq: personId } } },
        this.getAuthHeaders(),
      );
      return Boolean((result as any).people?.edges?.[0]?.node?.id);
    } catch {
      return false;
    }
  }

  /** True if Opportunity id still exists in Twenty. */
  async opportunityExists(opportunityId: string): Promise<boolean> {
    if (!opportunityId) return false;
    try {
      const result = await this.client.request(
        FIND_OPPORTUNITIES,
        { filter: { id: { eq: opportunityId } } },
        this.getAuthHeaders(),
      );
      return Boolean((result as any).opportunities?.edges?.[0]?.node?.id);
    } catch {
      return false;
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
   * Cross-channel Person merge by phone: search phones.primaryPhoneNumber
   * (+digits / digits / RU national) and custom Person.whatsapp TEXT.
   * Multiple distinct Persons → ids.length > 1 (caller sets needsReview).
   */
  async findPersonByPhone(
    e164: string,
  ): Promise<{ id: string; ids: string[] } | null> {
    const variants = phoneSearchVariants(e164);
    if (!variants.length) return null;
    const found = new Set<string>();
    const headers = this.getAuthHeaders();

    for (const value of variants) {
      const waHandle = formatWhatsappHandle(value);
      const filters: Record<string, unknown>[] = [
        { phones: { primaryPhoneNumber: { eq: value } } },
      ];
      if (waHandle) {
        filters.push({ whatsapp: { eq: waHandle } });
      }
      // Also try digits-only whatsapp if stored without +
      const digits = value.replace(/\D/g, '');
      if (digits && digits !== waHandle?.replace(/\D/g, '')) {
        filters.push({ whatsapp: { eq: `+${digits}` } });
      }

      for (const filter of filters) {
        try {
          const result = await this.client.request(
            FIND_PEOPLE,
            { filter },
            headers,
          );
          for (const edge of (result as any).people?.edges || []) {
            const id = edge?.node?.id as string | undefined;
            if (id) found.add(id);
          }
        } catch {
          /* filter shape / field may differ — try next */
        }
      }
    }

    const ids = [...found];
    if (!ids.length) return null;
    return { id: ids[0], ids };
  }

  /** Read Opportunity.stage by id (won = typically CUSTOMER). */
  async getOpportunityStage(opportunityId: string): Promise<string | null> {
    const headers = this.getAuthHeaders();
    const result = await this.client.request(
      FIND_OPPORTUNITIES,
      { filter: { id: { eq: opportunityId } } },
      headers,
    );
    const node = (result as any)?.opportunities?.edges?.[0]?.node;
    return node?.stage ? String(node.stage) : null;
  }

  /**
   * Resolve the current GraphQL enum *value* for the first Opportunity stage.
   * Binds to Twenty's stable seed option id (survives label/value renames by the client).
   */
  async resolveDefaultOpportunityStage(): Promise<string> {
    const headers = this.getAuthHeaders();
    try {
      const result = (await this.authClient.request(
        GET_OPPORTUNITY_STAGE_FIELD,
        {},
        headers,
      )) as {
        objects?: {
          edges?: Array<{
            node?: {
              fieldsList?: Array<{
                name?: string;
                options?: Array<{
                  id?: string;
                  value?: string;
                  position?: number;
                }> | null;
              }>;
            };
          }>;
        };
      };
      const fields =
        result.objects?.edges?.[0]?.node?.fieldsList ||
        result.objects?.edges?.find((e) => e.node?.fieldsList)?.node?.fieldsList ||
        [];
      const stageField = fields.find((f) => f.name === 'stage');
      const options = Array.isArray(stageField?.options) ? stageField!.options! : [];
      const byId = options.find((o) => o.id === OPPORTUNITY_NEW_STAGE_OPTION_ID);
      if (byId?.value) return String(byId.value);
      const sorted = [...options].sort(
        (a, b) => (a.position ?? 999) - (b.position ?? 999),
      );
      if (sorted[0]?.value) return String(sorted[0].value);
    } catch (err) {
      console.warn(
        '[twenty-client] resolveDefaultOpportunityStage failed',
        err instanceof Error ? err.message : err,
      );
    }
    return 'NEW';
  }

  /** Soft-delete current workspace (Settings → Delete). Follow with SQL hard-drop if needed. */
  async deleteCurrentWorkspace(): Promise<void> {
    const headers = this.getAuthHeaders();
    await this.authClient.request(DELETE_CURRENT_WORKSPACE, {}, headers);
  }

  /**
   * Create an Opportunity (deal) in the workspace CRM.
   * Stage is resolved via stable option id when omitted (client may rename labels/values).
   */
  async createOpportunity(input: {
    name: string;
    amount?: number;
    personId?: string;
    stage?: string;
  }): Promise<{ id: string }> {
    const headers = this.getAuthHeaders();
    const preferredStage =
      !input.stage || input.stage === 'NEW'
        ? await this.resolveDefaultOpportunityStage()
        : input.stage;

    const buildData = (stage: string | undefined, useConnect: boolean) => {
      const data: Record<string, unknown> = { name: input.name };
      if (stage) data.stage = stage;
      if (input.amount != null) {
        data.amount = {
          amountMicros: Math.round(input.amount * 1_000_000),
          currencyCode: 'RUB',
        };
      }
      if (input.personId) {
        if (useConnect) {
          data.pointOfContact = { connect: { id: input.personId } };
        } else {
          data.pointOfContactId = input.personId;
        }
      }
      return data;
    };

    const tryCreate = async (stage: string | undefined, useConnect: boolean) => {
      const result = await this.client.request(
        CREATE_OPPORTUNITY,
        { data: buildData(stage, useConnect) },
        headers,
      );
      return (result as any).createOpportunity as { id: string };
    };

    const linkPerson = async (opportunityId: string, personId: string) => {
      const attempts: Array<{ label: string; data: Record<string, unknown> }> = [
        { label: 'connect', data: { pointOfContact: { connect: { id: personId } } } },
        { label: 'pointOfContactId', data: { pointOfContactId: personId } },
        { label: 'nestedId', data: { pointOfContact: { id: personId } } },
      ];
      const mutations: Array<{ label: string; doc: ReturnType<typeof gql>; vars: (d: Record<string, unknown>) => Record<string, unknown> }> = [
        {
          label: 'updateOpportunity(id,data)',
          doc: UPDATE_OPPORTUNITY,
          vars: (data) => ({ id: opportunityId, data }),
        },
        {
          label: 'updateOpportunity UUID alias',
          doc: gql`
            mutation UpdateOpportunityLink($idToUpdate: UUID!, $data: OpportunityUpdateInput!) {
              updateOpportunity(id: $idToUpdate, data: $data) {
                id
              }
            }
          `,
          vars: (data) => ({ idToUpdate: opportunityId, data }),
        },
      ];
      for (const attempt of attempts) {
        for (const mut of mutations) {
          try {
            await this.client.request(mut.doc, mut.vars(attempt.data), headers);
            console.log(
              `[twenty-client] linked opportunity ${opportunityId} → person ${personId} via ${attempt.label}/${mut.label}`,
            );
            return;
          } catch (err) {
            console.warn(
              `[twenty-client] link attempt failed ${attempt.label}/${mut.label}:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      }
      console.warn(
        `[twenty-client] could not link opportunity ${opportunityId} → person ${personId}`,
      );
    };

    const parseValidStages = (err: unknown): string[] => {
      const chunks: string[] = [];
      if (err instanceof Error) chunks.push(err.message);
      chunks.push(String(err || ''));
      try {
        const anyErr = err as {
          response?: { errors?: Array<{ message?: string }>; body?: string };
        };
        for (const e of anyErr?.response?.errors || []) {
          if (e?.message) chunks.push(e.message);
        }
        if (typeof anyErr?.response?.body === 'string') chunks.push(anyErr.response.body);
      } catch {
        /* ignore */
      }
      for (const msg of chunks) {
        const m = msg.match(/Valid values are:\s*([A-Za-z0-9_,\s]+)/i);
        if (!m?.[1]) continue;
        const list = m[1]
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter((s) => /^[A-Z][A-Z0-9_]*$/i.test(s))
          .map((s) => s.toUpperCase());
        if (list.length) return list;
      }
      return [];
    };

    const pickStage = (valid: string[], preferred: string): string => {
      if (valid.includes(preferred)) return preferred;
      const resolvedPreferred = preferred.toUpperCase();
      if (valid.includes(resolvedPreferred)) return resolvedPreferred;
      for (const candidate of [preferred, 'NOVYY_LID', 'NEW', valid[0]]) {
        if (candidate && valid.includes(candidate)) return candidate;
      }
      return valid[0];
    };

    /** Prefer connect; fall back to scalar id; always re-link via update after create. */
    const createAndLink = async (stage: string | undefined) => {
      let created: { id: string };
      if (input.personId) {
        try {
          created = await tryCreate(stage, true);
        } catch {
          try {
            created = await tryCreate(stage, false);
          } catch (errId) {
            const data: Record<string, unknown> = { name: input.name };
            if (stage) data.stage = stage;
            if (input.amount != null) {
              data.amount = {
                amountMicros: Math.round(input.amount * 1_000_000),
                currencyCode: 'RUB',
              };
            }
            try {
              const result = await this.client.request(
                CREATE_OPPORTUNITY,
                { data },
                headers,
              );
              created = (result as any).createOpportunity as { id: string };
            } catch {
              throw errId;
            }
          }
        }
      } else {
        created = await tryCreate(stage, false);
      }
      if (input.personId && created?.id) {
        await linkPerson(created.id, input.personId);
      }
      return created;
    };

    try {
      return await createAndLink(preferredStage);
    } catch (err) {
      const valid = parseValidStages(err);
      const stage =
        valid.length > 0 ? pickStage(valid, preferredStage) : preferredStage;

      if (valid.length > 0 && stage !== preferredStage) {
        return await createAndLink(stage);
      }

      const fresh = await this.resolveDefaultOpportunityStage();
      if (fresh && fresh !== preferredStage && fresh !== stage) {
        return await createAndLink(fresh);
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
    // Chip label = title (TEXT). Prefer body text so kanban shows note content.
    const chipTitle = (input.body || input.title || '').slice(0, 2000);
    try {
      const result = await this.client.request(
        CREATE_NOTE,
        {
          data: {
            title: chipTitle,
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
              title: chipTitle || `${input.title} · person:${input.personId}`,
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
