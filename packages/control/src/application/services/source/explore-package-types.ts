// ---------------------------------------------------------------------------
// Shared types for the explore-packages module
// ---------------------------------------------------------------------------

export interface ReleaseAsset {
  id: string;
  name: string;
  content_type: string;
  size: number;
  r2_key: string;
  download_count: number;
  bundle_format?: string;
  bundle_meta?: {
    name?: string;
    app_id?: string;
    version: string;
    description?: string;
    icon?: string;
    category?: 'app' | 'service' | 'library' | 'template' | 'social';
    tags?: string[];
    dependencies?: Array<{ repo: string; version: string }>;
  };
  created_at: string;
}

export type TakopackRatingStats = {
  rating_avg: number | null;
  rating_count: number;
};

/** Internal type for a release with its takopack assets. */
export interface PackageWithTakopack {
  release: {
    id: string;
    publishedAt: string | Date | null;
    description: string | null;
    tag: string;
    repository: {
      id: string;
      name: string;
      description: string | null;
      stars: number;
      account: {
        id: string;
        slug: string;
        name: string;
        picture: string | null;
      };
    };
  };
  primaryAsset: ReleaseAsset;
  totalDownloads: number;
}

export interface PackageDto {
  id: string;
  name: string;
  app_id: string;
  version: string;
  description: string | null;
  icon: string | undefined;
  category: string | undefined;
  tags: string[] | undefined;
  repository: {
    id: string;
    name: string;
    description: string | null;
    stars: number;
  };
  owner: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
  } | null;
  release: {
    id: string;
    tag: string;
    published_at: string | null;
  };
  asset: {
    id: string;
    name: string;
    size: number;
    download_count: number;
  };
  total_downloads: number;
  published_at: string | null;
  rating_avg: number | null;
  rating_count: number;
  publish_status: string;
  certified: boolean;
}

export interface SearchPackagesParams {
  searchQuery: string;
  sortParamRaw: string;
  limit: number;
  offset: number;
  category: string | undefined;
  tags: string[];
  certifiedOnly: boolean;
}

export interface SearchPackagesResult {
  packages: PackageDto[];
  has_more: boolean;
}

export interface SuggestPackageDto {
  id: string;
  name: string;
  app_id: string;
  version: string;
  description: string | null;
  icon: string | undefined;
  category: string | undefined;
  tags: string[] | undefined;
  repository: {
    id: string;
    name: string;
    description: string | null;
    stars: number;
  };
  owner: {
    id: string;
    name: string;
    username: string;
    avatar_url: string | null;
  } | null;
  release: {
    id: string;
    tag: string;
    published_at: string | null;
  };
  asset: {
    id: string;
    name: string;
    size: number;
    download_count: number;
  };
  total_downloads: number;
  published_at: string | null;
}

export interface SuggestPackagesParams {
  query: string;
  limit: number;
  category: string | undefined;
  tags: string[];
}

export interface ReleaseRow {
  id: string;
  tag: string;
  description: string | null;
  publishedAt: string | null;
  repoId: string;
  repoName: string;
  repoDescription: string | null;
  repoStars: number;
  accountId: string;
  accountSlug: string;
  accountName: string;
  accountPicture: string | null;
}
