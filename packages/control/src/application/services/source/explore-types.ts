export interface ExploreRepoResponse {
  id: string;
  name: string;
  description: string | null;
  visibility: 'public';
  default_branch: string;
  stars: number;
  forks: number;
  workspace: {
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
  visibility: 'public';
  default_branch: string;
  stars: number;
  forks: number;
  category: string | null;
  language: string | null;
  license: string | null;
  is_starred: boolean;
  created_at: string;
  updated_at: string;
  workspace: {
    id: string;
    name: string;
  };
  owner: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
  };
}

export interface CatalogTakopackResponse {
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
  publish_status: 'none' | 'pending' | 'approved' | 'rejected';
  certified: boolean;
  published_at: string | null;
}

export interface CatalogInstallationResponse {
  installed: boolean;
  bundle_deployment_id: string | null;
  installed_version: string | null;
  deployed_at: string | null;
}

export interface CatalogItemResponse {
  repo: CatalogRepoResponse;
  takopack: CatalogTakopackResponse;
  installation?: CatalogInstallationResponse;
  official?: boolean;
}

export interface CatalogResult {
  items: CatalogItemResponse[];
  total: number;
  has_more: boolean;
}

export type CatalogSort = 'trending' | 'new' | 'stars' | 'updated' | 'downloads';
export type CatalogType = 'all' | 'repo' | 'deployable-app' | 'official';

export type RepositoryWithAccount = {
  id: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  forks: number;
  officialCategory: string | null;
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

export interface ParsedTakopackRelease {
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
  assetId: string;
  downloadCount: number;
  totalDownloads: number;
}

export interface ParsedCatalogTags {
  tags: string[];
  invalid: boolean;
}
