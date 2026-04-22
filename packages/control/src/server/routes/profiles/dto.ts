export interface UserProfileResponse {
  username: string;
  name: string;
  bio: string | null;
  picture: string | null;
  public_repo_count: number;
  followers_count: number;
  following_count: number;
  is_self: boolean;
  private_account: boolean;
  is_following: boolean;
  follow_requested: boolean;
  is_blocking: boolean;
  is_muted: boolean;
  created_at: string;
}

export interface ProfileRepoResponse {
  owner_username: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  default_branch: string;
  stars: number;
  forks: number;
  is_starred: boolean;
  updated_at: string;
}

export interface FollowUserResponse {
  username: string;
  name: string;
  picture: string | null;
  bio: string | null;
  is_following: boolean;
}

export interface FollowRequestResponse {
  id: string;
  requester: FollowUserResponse;
  created_at: string;
}
