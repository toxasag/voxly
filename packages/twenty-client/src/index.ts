// Voxly Twenty CRM GraphQL Client
// Handles workspace provisioning, user creation, and API calls to Twenty

import { GraphQLClient, gql } from 'graphql-request';

export interface TwentyClientConfig {
  apiUrl: string; // http://twenty-server:3000/graphql
  apiKey?: string; // service token
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
  authTokens: {
    accessToken: string;
    refreshToken?: string;
  };
}

// GraphQL mutations for workspace provisioning
// Based on Twenty's internal GraphQL API (see integration tests for exact sequence)
const CREATE_USER_AND_WORKSPACE = gql`
  mutation CreateUserAndWorkspace(
    $email: String!
    $password: String!
    $firstName: String
    $lastName: String
    $workspaceName: String!
    $subdomain: String!
  ) {
    createUserAndWorkspace(
      input: {
        email: $email
        password: $password
        firstName: $firstName
        lastName: $lastName
        workspaceName: $workspaceName
        workspaceSubdomain: $subdomain
      }
    ) {
      id
      email
      workspace {
        id
        subdomain
        name
      }
    }
  }
`;

const SIGN_IN = gql`
  mutation SignIn($email: String!, $password: String!) {
    signIn(input: { email: $email, password: $password }) {
      tokens {
        accessToken
        refreshToken
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
  mutation CreatePerson($input: CreatePersonInput!) {
    createPerson(input: $input) {
      id
      firstName
      lastName
    }
  }
`;

const CREATE_OPPORTUNITY = gql`
  mutation CreateOpportunity($input: CreateOpportunityInput!) {
    createOpportunity(input: $input) {
      id
      name
      amount
    }
  }
`;

export class TwentyClient {
  private client: GraphQLClient;
  private authTokens: { accessToken: string; refreshToken?: string } | null = null;

  constructor(config: TwentyClientConfig) {
    this.client = new GraphQLClient(config.apiUrl, {
      headers: config.apiKey
        ? { Authorization: `Bearer ${config.apiKey}` }
        : {},
    });
  }

  /**
   * Provision a new workspace + owner user
   */
  async provisionWorkspace(params: ProvisionWorkspaceParams): Promise<ProvisionedWorkspace> {
    const result = await this.client.request(CREATE_USER_AND_WORKSPACE, {
      email: params.ownerEmail,
      password: params.ownerPassword,
      firstName: params.ownerFirstName,
      lastName: params.ownerLastName,
      workspaceName: params.workspaceName,
      subdomain: params.subdomain,
    });

    // Type assertion for the response
    const data = result as any;

    // Sign in to get auth tokens
    const signInResult = await this.client.request(SIGN_IN, {
      email: params.ownerEmail,
      password: params.ownerPassword,
    });

    const signInData = signInResult as any;
    this.authTokens = {
      accessToken: signInData.signIn.tokens.accessToken,
      refreshToken: signInData.signIn.tokens.refreshToken,
    };

    return {
      workspaceId: data.createUserAndWorkspace.workspace.id,
      subdomain: data.createUserAndWorkspace.workspace.subdomain,
      authTokens: this.authTokens,
    };
  }

  /**
   * Install a Twenty App (e.g. voxly-platform) into a workspace
   */
  async installApp(appId: string): Promise<void> {
    if (!this.authTokens) {
      throw new Error('Must authenticate before installing apps');
    }
    await this.client.request(
      INSTALL_APP,
      { appId },
      { Authorization: `Bearer ${this.authTokens.accessToken}` },
    );
  }

  /**
   * Create a Person in the workspace CRM
   */
  async createPerson(input: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
  }): Promise<{ id: string }> {
    const result = await this.client.request(
      CREATE_PERSON,
      { input },
      this.getAuthHeaders(),
    );
    return (result as any).createPerson;
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
    const result = await this.client.request(
      CREATE_OPPORTUNITY,
      { input },
      this.getAuthHeaders(),
    );
    return (result as any).createOpportunity;
  }

  setAuthTokens(tokens: { accessToken: string; refreshToken?: string }): void {
    this.authTokens = tokens;
  }

  private getAuthHeaders(): Record<string, string> {
    if (!this.authTokens) return {};
    return { Authorization: `Bearer ${this.authTokens.accessToken}` };
  }
}
