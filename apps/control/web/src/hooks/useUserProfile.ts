import { useCallback, useEffect, useState } from 'react';
import type { ActivityEvent, FollowRequest, FollowUser, ProfileRepo, ProfileTab, StarredRepo, UserProfile } from '../types/profile';
import { rpc, rpcJson } from '../lib/rpc';

// API Response types
interface UserProfileResponse {
  user: UserProfile;
}

interface ReposResponse {
  repos: ProfileRepo[];
  has_more: boolean;
}

interface StarsResponse {
  repos: StarredRepo[];
  has_more: boolean;
}

interface FollowersResponse {
  followers: FollowUser[];
  has_more: boolean;
}

interface FollowingResponse {
  following: FollowUser[];
  has_more: boolean;
}

interface ToggleFollowResponse {
  following: boolean;
  requested?: boolean;
  followers_count: number;
}

interface ToggleUserFollowResponse {
  following: boolean;
  requested?: boolean;
}

interface ActivityResponse {
  events: ActivityEvent[];
  has_more: boolean;
}

interface FollowRequestsResponse {
  requests: FollowRequest[];
  has_more: boolean;
  total?: number;
}

interface FollowRequestAcceptResponse {
  success: boolean;
  followers_count?: number;
}

interface BlockMuteResponse {
  success: boolean;
  blocked?: boolean;
  muted?: boolean;
}

const ITEMS_PER_PAGE = 20;

export function useUserProfile(username: string) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [repos, setRepos] = useState<ProfileRepo[]>([]);
  const [starredRepos, setStarredRepos] = useState<StarredRepo[]>([]);
  const [followers, setFollowers] = useState<FollowUser[]>([]);
  const [following, setFollowing] = useState<FollowUser[]>([]);
  const [activeTab, setActiveTab] = useState<ProfileTab>('repositories');
  const [loading, setLoading] = useState(true);
  const [tabLoading, setTabLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followLoading, setFollowLoading] = useState(false);
  const [starringRepo, setStarringRepo] = useState<string | null>(null);
  const [blockLoading, setBlockLoading] = useState(false);
  const [muteLoading, setMuteLoading] = useState(false);

  const [reposOffset, setReposOffset] = useState(0);
  const [reposHasMore, setReposHasMore] = useState(true);
  const [starsOffset, setStarsOffset] = useState(0);
  const [starsHasMore, setStarsHasMore] = useState(true);
  const [followersOffset, setFollowersOffset] = useState(0);
  const [followersHasMore, setFollowersHasMore] = useState(true);
  const [followingOffset, setFollowingOffset] = useState(0);
  const [followingHasMore, setFollowingHasMore] = useState(true);

  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [activityHasMore, setActivityHasMore] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  const [followRequests, setFollowRequests] = useState<FollowRequest[]>([]);
  const [requestsOffset, setRequestsOffset] = useState(0);
  const [requestsHasMore, setRequestsHasMore] = useState(true);
  const [requestActionLoadingId, setRequestActionLoadingId] = useState<string | null>(null);

  const [followersSort, setFollowersSort] = useState<'created' | 'username'>('created');
  const [followersOrder, setFollowersOrder] = useState<'desc' | 'asc'>('desc');
  const [followingSort, setFollowingSort] = useState<'created' | 'username'>('created');
  const [followingOrder, setFollowingOrder] = useState<'desc' | 'asc'>('desc');

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.users[':username'].$get({
        param: { username },
      });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('User not found');
        }
        throw new Error('Failed to load profile');
      }
      const data = await rpcJson<UserProfileResponse>(res);
      setProfile(data.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [username]);

  const fetchRepos = useCallback(
    async (reset = false) => {
      if (!reset && !reposHasMore) return;

      setTabLoading(true);
      try {
        const offset = reset ? 0 : reposOffset;
        const res = await rpc.users[':username'].repos.$get({
          param: { username },
          query: { limit: String(ITEMS_PER_PAGE), offset: String(offset) },
        });
        const data = await rpcJson<ReposResponse>(res);
        if (reset) {
          setRepos(data.repos);
          setReposOffset(ITEMS_PER_PAGE);
        } else {
          setRepos((prev) => [...prev, ...data.repos]);
          setReposOffset((prev) => prev + ITEMS_PER_PAGE);
        }
        setReposHasMore(data.has_more);
      } catch {
        // Repos fetch failed, silently ignore
      } finally {
        setTabLoading(false);
      }
    },
    [username, reposOffset, reposHasMore]
  );

  const fetchStars = useCallback(
    async (reset = false) => {
      if (!reset && !starsHasMore) return;

      setTabLoading(true);
      try {
        const offset = reset ? 0 : starsOffset;
        const res = await rpc.users[':username'].stars.$get({
          param: { username },
          query: { limit: String(ITEMS_PER_PAGE), offset: String(offset) },
        });
        const data = await rpcJson<StarsResponse>(res);
        if (reset) {
          setStarredRepos(data.repos);
          setStarsOffset(ITEMS_PER_PAGE);
        } else {
          setStarredRepos((prev) => [...prev, ...data.repos]);
          setStarsOffset((prev) => prev + ITEMS_PER_PAGE);
        }
        setStarsHasMore(data.has_more);
      } catch {
        // Stars fetch failed, silently ignore
      } finally {
        setTabLoading(false);
      }
    },
    [username, starsOffset, starsHasMore]
  );

  const fetchFollowers = useCallback(
    async (reset = false) => {
      if (!reset && !followersHasMore) return;

      setTabLoading(true);
      try {
        const offset = reset ? 0 : followersOffset;
        const res = await rpc.users[':username'].followers.$get({
          param: { username },
          query: {
            limit: String(ITEMS_PER_PAGE),
            offset: String(offset),
            sort: followersSort,
            order: followersOrder,
          },
        });
        const data = await rpcJson<FollowersResponse>(res);
        if (reset) {
          setFollowers(data.followers);
          setFollowersOffset(ITEMS_PER_PAGE);
        } else {
          setFollowers((prev) => [...prev, ...data.followers]);
          setFollowersOffset((prev) => prev + ITEMS_PER_PAGE);
        }
        setFollowersHasMore(data.has_more);
      } catch {
        // Followers fetch failed, silently ignore
      } finally {
        setTabLoading(false);
      }
    },
    [username, followersOffset, followersHasMore, followersOrder, followersSort]
  );

  const fetchFollowing = useCallback(
    async (reset = false) => {
      if (!reset && !followingHasMore) return;

      setTabLoading(true);
      try {
        const offset = reset ? 0 : followingOffset;
        const res = await rpc.users[':username'].following.$get({
          param: { username },
          query: {
            limit: String(ITEMS_PER_PAGE),
            offset: String(offset),
            sort: followingSort,
            order: followingOrder,
          },
        });
        const data = await rpcJson<FollowingResponse>(res);
        if (reset) {
          setFollowing(data.following);
          setFollowingOffset(ITEMS_PER_PAGE);
        } else {
          setFollowing((prev) => [...prev, ...data.following]);
          setFollowingOffset((prev) => prev + ITEMS_PER_PAGE);
        }
        setFollowingHasMore(data.has_more);
      } catch {
        // Following fetch failed, silently ignore
      } finally {
        setTabLoading(false);
      }
    },
    [username, followingOffset, followingHasMore, followingOrder, followingSort]
  );

  const fetchActivity = useCallback(
    async (reset = false) => {
      if (!reset && !activityHasMore) return;

      setTabLoading(true);
      setActivityError(null);
      try {
        const before = reset
          ? null
          : (activityEvents.length > 0 ? activityEvents[activityEvents.length - 1].created_at : null);
        const res = await rpc.users[':username'].activity.$get({
          param: { username },
          query: {
            limit: String(ITEMS_PER_PAGE),
            ...(before ? { before } : {}),
          },
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({})) as { error?: string };
          setActivityError(data.error || 'Failed to load activity');
          setActivityHasMore(false);
          return;
        }

        const data = await rpcJson<ActivityResponse>(res);
        if (reset) {
          setActivityEvents(data.events || []);
        } else {
          setActivityEvents((prev) => [...prev, ...(data.events || [])]);
        }
        setActivityHasMore(!!data.has_more);
      } catch (err) {
        setActivityError(err instanceof Error ? err.message : 'Failed to load activity');
      } finally {
        setTabLoading(false);
      }
    },
    [activityEvents, activityHasMore, username]
  );

  const fetchFollowRequests = useCallback(
    async (reset = false) => {
      if (!reset && !requestsHasMore) return;

      setTabLoading(true);
      try {
        const offset = reset ? 0 : requestsOffset;
        const res = await rpc.users[':username']['follow-requests'].$get({
          param: { username },
          query: { limit: String(ITEMS_PER_PAGE), offset: String(offset) },
        });

        if (!res.ok) {
          // Private endpoint; caller may not be the profile owner.
          setRequestsHasMore(false);
          return;
        }

        const data = await rpcJson<FollowRequestsResponse>(res);
        if (reset) {
          setFollowRequests(data.requests || []);
          setRequestsOffset(ITEMS_PER_PAGE);
        } else {
          setFollowRequests((prev) => [...prev, ...(data.requests || [])]);
          setRequestsOffset((prev) => prev + ITEMS_PER_PAGE);
        }
        setRequestsHasMore(!!data.has_more);
      } catch {
        // ignore
      } finally {
        setTabLoading(false);
      }
    },
    [requestsHasMore, requestsOffset, username]
  );

  useEffect(() => {
    setRepos([]);
    setStarredRepos([]);
    setFollowers([]);
    setFollowing([]);
    setActivityEvents([]);
    setFollowRequests([]);

    setReposOffset(0);
    setReposHasMore(true);
    setStarsOffset(0);
    setStarsHasMore(true);
    setFollowersOffset(0);
    setFollowersHasMore(true);
    setFollowingOffset(0);
    setFollowingHasMore(true);
    setActivityHasMore(true);
    setActivityError(null);
    setRequestsOffset(0);
    setRequestsHasMore(true);
    setRequestActionLoadingId(null);

    setActiveTab('repositories');
  }, [username]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  useEffect(() => {
    setFollowers([]);
    setFollowersOffset(0);
    setFollowersHasMore(true);
  }, [followersOrder, followersSort]);

  useEffect(() => {
    setFollowing([]);
    setFollowingOffset(0);
    setFollowingHasMore(true);
  }, [followingOrder, followingSort]);

  useEffect(() => {
    switch (activeTab) {
      case 'repositories':
        if (repos.length === 0) fetchRepos(true);
        break;
      case 'stars':
        if (starredRepos.length === 0) fetchStars(true);
        break;
      case 'activity':
        if (activityEvents.length === 0 && !activityError) fetchActivity(true);
        break;
      case 'followers':
        if (followers.length === 0) fetchFollowers(true);
        break;
      case 'following':
        if (following.length === 0) fetchFollowing(true);
        break;
      case 'requests':
        if (followRequests.length === 0) fetchFollowRequests(true);
        break;
    }
  }, [
    activeTab,
    repos.length,
    starredRepos.length,
    activityEvents.length,
    activityError,
    followers.length,
    following.length,
    followRequests.length,
    fetchRepos,
    fetchStars,
    fetchActivity,
    fetchFollowers,
    fetchFollowing,
    fetchFollowRequests,
  ]);

  const toggleFollow = async () => {
    if (!profile || followLoading) return;

    setFollowLoading(true);
    try {
      let res;
      if (profile.is_following || profile.follow_requested) {
        res = await rpc.users[':username'].follow.$delete({ param: { username } });
      } else {
        res = await rpc.users[':username'].follow.$post({ param: { username } });
      }

      if (res.ok) {
        const data = await rpcJson<ToggleFollowResponse>(res);
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                is_following: data.following,
                follow_requested: !!data.requested,
                followers_count: data.followers_count,
              }
            : null
        );
      }
    } catch {
      // Follow toggle failed, silently ignore
    } finally {
      setFollowLoading(false);
    }
  };

  const toggleRepoStar = async (repo: ProfileRepo) => {
    if (starringRepo) return;

    setStarringRepo(repo.id);
    try {
      let res;
      if (repo.is_starred) {
        res = await rpc.repos[':repoId'].star.$delete({ param: { repoId: repo.id } });
      } else {
        res = await rpc.repos[':repoId'].star.$post({ param: { repoId: repo.id } });
      }

      if (res.ok) {
        const updateRepo = (r: ProfileRepo) =>
          r.id === repo.id
            ? { ...r, is_starred: !r.is_starred, stars: r.stars + (r.is_starred ? -1 : 1) }
            : r;

        setRepos((prev) => prev.map(updateRepo));
        setStarredRepos((prev) => prev.map((r) => ({ ...updateRepo(r), starred_at: r.starred_at })));
      }
    } catch {
      // Star toggle failed, silently ignore
    } finally {
      setStarringRepo(null);
    }
  };

  const toggleUserFollow = async (user: FollowUser) => {
    try {
      let res;
      if (user.is_following) {
        res = await rpc.users[':username'].follow.$delete({ param: { username: user.username } });
      } else {
        res = await rpc.users[':username'].follow.$post({ param: { username: user.username } });
      }

      if (res.ok) {
        const data = await rpcJson<ToggleUserFollowResponse>(res);
        const updateUser = (u: FollowUser) =>
          u.username === user.username ? { ...u, is_following: data.following } : u;

        setFollowers((prev) => prev.map(updateUser));
        setFollowing((prev) => prev.map(updateUser));
      }
    } catch {
      // User follow toggle failed, silently ignore
    }
  };

  const toggleBlock = async () => {
    if (!profile || profile.is_self || blockLoading) return;

    setBlockLoading(true);
    try {
      const res = profile.is_blocking
        ? await rpc.users[':username'].block.$delete({ param: { username } })
        : await rpc.users[':username'].block.$post({ param: { username } });

      if (res.ok) {
        const data = await rpcJson<BlockMuteResponse>(res);
        const blocked = !!data.blocked;
        setProfile((prev) =>
          prev
            ? {
                ...prev,
                is_blocking: blocked,
                is_following: blocked ? false : prev.is_following,
                follow_requested: blocked ? false : prev.follow_requested,
              }
            : null
        );
      }
    } catch {
      // ignore
    } finally {
      setBlockLoading(false);
    }
  };

  const toggleMute = async () => {
    if (!profile || profile.is_self || muteLoading) return;

    setMuteLoading(true);
    try {
      const res = profile.is_muted
        ? await rpc.users[':username'].mute.$delete({ param: { username } })
        : await rpc.users[':username'].mute.$post({ param: { username } });

      if (res.ok) {
        const data = await rpcJson<BlockMuteResponse>(res);
        const muted = !!data.muted;
        setProfile((prev) => (prev ? { ...prev, is_muted: muted } : null));
      }
    } catch {
      // ignore
    } finally {
      setMuteLoading(false);
    }
  };

  const acceptFollowRequest = async (requestId: string) => {
    if (requestActionLoadingId) return;
    setRequestActionLoadingId(requestId);
    try {
      const res = await rpc.users[':username']['follow-requests'][':id'].accept.$post({
        param: { username, id: requestId },
      });
      if (res.ok) {
        const data = await rpcJson<FollowRequestAcceptResponse>(res);
        setFollowRequests((prev) => prev.filter((r) => r.id !== requestId));
        const followersCount = data.followers_count;
        if (typeof followersCount === 'number') {
          setProfile((prev) => (prev ? { ...prev, followers_count: followersCount } : null));
        }
      }
    } catch {
      // ignore
    } finally {
      setRequestActionLoadingId(null);
    }
  };

  const rejectFollowRequest = async (requestId: string) => {
    if (requestActionLoadingId) return;
    setRequestActionLoadingId(requestId);
    try {
      const res = await rpc.users[':username']['follow-requests'][':id'].reject.$post({
        param: { username, id: requestId },
      });
      if (res.ok) {
        await rpcJson(res);
        setFollowRequests((prev) => prev.filter((r) => r.id !== requestId));
      }
    } catch {
      // ignore
    } finally {
      setRequestActionLoadingId(null);
    }
  };

  const setFollowersSortKey = (sort: 'created' | 'username') => {
    setFollowersSort(sort);
    setFollowersOrder(sort === 'username' ? 'asc' : 'desc');
  };

  const setFollowingSortKey = (sort: 'created' | 'username') => {
    setFollowingSort(sort);
    setFollowingOrder(sort === 'username' ? 'asc' : 'desc');
  };

  const loadMore = () => {
    switch (activeTab) {
      case 'repositories':
        fetchRepos(false);
        break;
      case 'stars':
        fetchStars(false);
        break;
      case 'activity':
        fetchActivity(false);
        break;
      case 'followers':
        fetchFollowers(false);
        break;
      case 'following':
        fetchFollowing(false);
        break;
      case 'requests':
        fetchFollowRequests(false);
        break;
    }
  };

  const hasMore = {
    repositories: reposHasMore,
    stars: starsHasMore,
    activity: activityHasMore && !activityError,
    followers: followersHasMore,
    following: followingHasMore,
    requests: requestsHasMore,
  }[activeTab];

  return {
    profile,
    repos,
    starredRepos,
    activityEvents,
    activityError,
    followers,
    following,
    followRequests,
    requestActionLoadingId,
    activeTab,
    setActiveTab,
    loading,
    tabLoading,
    error,
    followLoading,
    blockLoading,
    muteLoading,
    starringRepo,
    toggleFollow,
    toggleBlock,
    toggleMute,
    toggleRepoStar,
    toggleUserFollow,
    acceptFollowRequest,
    rejectFollowRequest,
    followersSort,
    followersOrder,
    followingSort,
    followingOrder,
    setFollowersSortKey,
    setFollowingSortKey,
    loadMore,
    hasMore,
  };
}
