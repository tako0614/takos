import type { Hono } from "hono";
import type {
  DeploymentCreateRequest,
  RetiredDeploymentCreateResponse,
} from "./public-api.ts";

export type ApiVariables = Record<string, unknown>;

type JsonEndpoint<
  Input,
  Output,
  Status extends 200 | 201 | 202 | 410 = 200,
> = {
  input: Input;
  output: Output;
  outputFormat: "json";
  status: Status;
};

type LooseEndpoint = {
  input: Record<string, unknown>;
  output: unknown;
  outputFormat: "json";
  status: 200;
};

type ApiRouteParam<Name extends string> = {
  param: Record<Name, string>;
};

type ApiRouteJson<Body> = {
  json: Body;
};

type ApiRouteQuery<Query> = {
  query: Query;
};

export interface PrivacyAccessSummaryResponse {
  version: string;
  subject: {
    id: string;
    email: string;
    username: string;
    display_name: string;
  };
  request_status: {
    status: "none" | "pending";
    requested_at?: string;
    request_id?: string;
  };
  available_actions: Array<{
    type: "access" | "export" | "deletion";
    method: string;
    path: string;
  }>;
  lawful_basis_url: string;
  privacy_policy_url: string;
}

export interface DataSubjectExportResponse
  extends PrivacyAccessSummaryResponse {
  exported_at: string;
  account: unknown;
  settings: unknown[];
  metadata: unknown[];
  memberships: unknown[];
  auth: {
    identities: unknown[];
    sessions: unknown[];
  };
  app_usage: {
    events: unknown[];
    rollups: unknown[];
  };
  repositories: unknown[];
  threads: unknown[];
  messages: unknown[];
  runs: unknown[];
  memories: unknown[];
  notifications: unknown[];
}

export interface DataSubjectDeletionRequest {
  reason?: string;
}

export interface DataSubjectDeletionResponse {
  request_id: string;
  status: "pending";
  requested_at: string;
  account_status: "pending_deletion";
  revoked: {
    auth_sessions: number;
  };
}

export interface PublicStoreDocument {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  icon_url: string | null;
  repository_count: number;
  inventory_url: string;
  search_url: string;
  feed_url: string;
  created_at: string;
  updated_at: string;
}

export interface PublicStoreRepositoryReference {
  id: string;
  owner: string | null;
  name: string;
  summary: string | null;
  repository_url: string;
  clone_url: string | null;
  browse_url: string | null;
  default_branch: string | null;
  default_branch_hash: string | null;
  package_icon: string | null;
  source: "local" | "remote";
  created_at: string;
  updated_at: string;
}

export interface PublicStoreFeedItem {
  id: string;
  type:
    | "inventory.add"
    | "inventory.remove"
    | "repo.push"
    | "repo.tag"
    | "repo.delete";
  published: string;
  repository: PublicStoreRepositoryReference;
  ref?: string;
  before_hash?: string | null;
  after_hash?: string | null;
  commit_count?: number;
  commits?: Array<{
    hash: string;
    message: string;
    author_name: string;
    author_email: string;
    committed: string;
  }>;
}

export interface PublicStoreResponse {
  store: PublicStoreDocument;
}

export interface PublicStoreInventoryResponse {
  store: PublicStoreDocument;
  total: number;
  limit: number;
  offset: number;
  items: PublicStoreRepositoryReference[];
}

export interface PublicStoreRepositoryResponse {
  repository: PublicStoreRepositoryReference;
}

export interface PublicStoreSearchResponse {
  store: PublicStoreDocument;
  total: number;
  query: string;
  limit: number;
  offset: number;
  repositories: PublicStoreRepositoryReference[];
}

export interface PublicStoreFeedResponse {
  store: PublicStoreDocument;
  total: number;
  limit: number;
  offset: number;
  items: PublicStoreFeedItem[];
}

type PaginationQuery = {
  limit?: string;
  offset?: string;
};

type ApiRouteSchema = {
  "/me/privacy": {
    $get: JsonEndpoint<Record<string, never>, PrivacyAccessSummaryResponse>;
  };
  "/me/privacy/access": {
    $get: JsonEndpoint<Record<string, never>, PrivacyAccessSummaryResponse>;
  };
  "/me/privacy/export": {
    $get: JsonEndpoint<Record<string, never>, DataSubjectExportResponse>;
  };
  "/me/privacy/deletion-requests": {
    $post: JsonEndpoint<
      ApiRouteJson<DataSubjectDeletionRequest>,
      DataSubjectDeletionResponse,
      202
    >;
  };
  "/public/v1/deployments": {
    $post: JsonEndpoint<
      ApiRouteJson<DeploymentCreateRequest>,
      RetiredDeploymentCreateResponse,
      410
    >;
  };
  "/public/stores/:storeSlug": {
    $get: JsonEndpoint<ApiRouteParam<"storeSlug">, PublicStoreResponse>;
  };
  "/public/stores/:storeSlug/inventory": {
    $get: JsonEndpoint<
      ApiRouteParam<"storeSlug"> & ApiRouteQuery<PaginationQuery>,
      PublicStoreInventoryResponse
    >;
  };
  "/public/stores/:storeSlug/inventory/:referenceId": {
    $get: JsonEndpoint<
      ApiRouteParam<"storeSlug" | "referenceId">,
      PublicStoreRepositoryResponse
    >;
  };
  "/public/stores/:storeSlug/search/repositories": {
    $get: JsonEndpoint<
      & ApiRouteParam<"storeSlug">
      & ApiRouteQuery<
        PaginationQuery & {
          q: string;
        }
      >,
      PublicStoreSearchResponse
    >;
  };
  "/public/stores/:storeSlug/feed": {
    $get: JsonEndpoint<
      ApiRouteParam<"storeSlug"> & ApiRouteQuery<PaginationQuery>,
      PublicStoreFeedResponse
    >;
  };
} & {
  [path: string]: {
    [method: `$${Lowercase<string>}`]: LooseEndpoint;
  };
};

// The route implementation is split between src/routes/public and app-local control
// handlers. Known families are typed above; the index signature keeps route
// families available to hono/client while ownership continues to narrow.
export type ApiRoutes = Hono<{ Variables: ApiVariables }, ApiRouteSchema, "/">;
