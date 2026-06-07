export interface ExploreRepoResponse {
  id: string;
  name: string;
  description: string | null;
  visibility: "public";
  default_branch: string;
  stars: number;
  forks: number;
  space: {
    id: string;
    name: string;
  };
  owner: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
  };
  is_starred: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExploreReposResult {
  repos: ExploreRepoResponse[];
  total: number;
  has_more: boolean;
}

export interface CatalogRepoResponse {
  id: string;
  name: string;
  description: string | null;
  visibility: "public";
  default_branch: string;
  stars: number;
  forks: number;
  category: string | null;
  language: string | null;
  license: string | null;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
  space: {
    id: string;
    name: string;
  };
  owner: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
  };
  catalog_origin: "repository" | "default_app";
}

export interface CatalogPackageResponse {
  available: boolean;
  app_id: string | null;
  latest_version: string | null;
  latest_tag: string | null;
  release_id: string | null;
  release_tag: string | null;
  asset_id: string | null;
  description: string | null;
  icon: string | null;
  category: string | null;
  tags: string[];
  downloads: number;
  rating_avg: number | null;
  rating_count: number;
  publish_status: "none" | "pending" | "approved" | "rejected";
  certified: boolean;
  published_at: string | null;
}

export interface CatalogInstallationResponse {
  installed: boolean;
  installation_id?: string | null;
  app_id?: string | null;
  status?: string | null;
  runtime_mode?: string | null;
  group_id: string | null;
  group_name: string | null;
  installed_version: string | null;
  installed_commit: string | null;
  installed_at?: string | null;
  updated_at?: string | null;
  deployed_at: string | null;
  services?: CatalogWorkloadServiceResponse[];
}

export interface CatalogWorkloadServiceResponse {
  id: string;
  material_kind: string;
  status: "ready" | "not_configured" | "unavailable" | "unknown";
  endpoint: string | null;
  secret_configured: boolean;
  token_expires_at: string | null;
}

export interface CatalogDeploySourceResponse {
  kind: "git_ref";
  repository_url: string;
  ref: string;
  ref_type: "branch" | "tag" | "commit";
  backend: "cloudflare" | "local" | "aws" | "gcp" | "k8s" | null;
  env: string | null;
}

export interface CatalogInstallableAppResponse {
  app_id: string;
  name: string;
  description: string | null;
  publisher: string | null;
  homepage: string | null;
  source_path: string | null;
  runtime_modes: string[];
  bindings: Array<{
    name: string;
    type: string;
    required: boolean;
  }>;
}

export interface CatalogItemResponse {
  repo: CatalogRepoResponse;
  package: CatalogPackageResponse;
  source?: CatalogDeploySourceResponse;
  installable_app?: CatalogInstallableAppResponse;
  installation?: CatalogInstallationResponse;
}

export interface CatalogResult {
  items: CatalogItemResponse[];
  total: number;
  has_more: boolean;
}

export type CatalogSort =
  | "trending"
  | "new"
  | "stars"
  | "updated"
  | "downloads";
export type CatalogType = "all" | "repo" | "deployable-app";

export type RepositoryWithAccount = {
  id: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  primaryLanguage: string | null;
  license: string | null;
  createdAt: string;
  updatedAt: string;
  account: {
    id: string;
    name: string;
    slug: string;
    picture: string | null;
  };
  remoteCloneUrl?: string | null;
};

export interface ReleaseAsset {
  id: string;
  name: string;
  size: number;
  download_count: number;
  bundle_format?: string;
  bundle_meta?: {
    name?: string;
    app_id?: string;
    version?: string;
    description?: string;
    icon?: string;
    category?: string;
    tags?: string[];
  };
}

export interface ParsedCatalogRelease {
  releaseId: string;
  repoId: string;
  appId: string;
  releaseTag: string;
  publishedAt: string | null;
  version: string;
  description: string | null;
  icon: string | null;
  category: string | null;
  tags: string[];
  assetId: string | null;
  downloadCount: number;
  totalDownloads: number;
}

export interface ParsedCatalogTags {
  tags: string[];
  invalid: boolean;
}
