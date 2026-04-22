export interface UserProfile {
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

export interface ProfileRepo {
  id: string;
  name: string;
  description: string | null;
  visibility: "public" | "private";
  default_branch: string;
  stars: number;
  forks: number;
  is_starred: boolean;
  updated_at: string;
}

export interface StarredRepo extends ProfileRepo {
  starred_at: string;
}

export interface FollowUser {
  username: string;
  name: string;
  picture: string | null;
  bio: string | null;
  is_following: boolean;
}

export interface FollowRequest {
  id: string;
  requester: FollowUser;
  created_at: string;
}

export type ActivityEventType =
  | "commit"
  | "release"
  | "pull_request"
  | "deployment";

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  created_at: string;
  title: string;
  repo?: { owner_username: string; name: string } | null;
  data?: Record<string, unknown>;
}

export type ProfileTab =
  | "repositories"
  | "stars"
  | "activity"
  | "followers"
  | "following"
  | "requests";

export interface UserProfilePageProps {
  username: string;
  onBack?: () => void;
  onNavigateToProfile?: (username: string) => void;
  onNavigateToRepo?: (username: string, repoName: string) => void;
}
