export type SourceTab = 'repos' | 'explore' | 'starred';
export type ExploreSort = 'trending' | 'recent' | 'new';
export type SearchSort = 'stars' | 'updated' | 'created';
export type SearchOrder = 'desc' | 'asc';

export interface SourceRepoOwner {
  id?: string;
  name: string;
  username?: string | null;
  avatar_url: string | null;
}

export interface SourceRepo {
  id: string;
  name: string;
  description: string | null;
  visibility: 'public' | 'private';
  updated_at: string;
  stars?: number;
  stars_count?: number;
  forks?: number;
  forks_count?: number;
  is_starred?: boolean;
  owner?: SourceRepoOwner;
}
