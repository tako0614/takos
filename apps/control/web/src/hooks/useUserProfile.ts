import { type Accessor, createEffect, createSignal, on } from "solid-js";
import type {
  FollowUser,
  ProfileRepo,
  ProfileTab,
  UserProfile,
} from "../types/profile.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useUserRepos } from "./useUserRepos.ts";
import { useUserStars } from "./useUserStars.ts";
import { useUserFollowers } from "./useUserFollowers.ts";
import { useUserFollowing } from "./useUserFollowing.ts";
import { useUserActivity } from "./useUserActivity.ts";
import { useUserFollowRequests } from "./useUserFollowRequests.ts";
import { useI18n } from "../store/i18n.ts";

// API Response types kept here for profile-level actions
interface UserProfileResponse {
  user: UserProfile;
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

interface BlockMuteResponse {
  success: boolean;
  blocked?: boolean;
  muted?: boolean;
}

export function useUserProfile(username: Accessor<string>) {
  const { t } = useI18n();
  const [profile, setProfile] = createSignal<UserProfile | null>(null);
  const [activeTab, setActiveTab] = createSignal<ProfileTab>("repositories");
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [followLoading, setFollowLoading] = createSignal(false);
  const [starringRepo, setStarringRepo] = createSignal<string | null>(null);
  const [blockLoading, setBlockLoading] = createSignal(false);
  const [muteLoading, setMuteLoading] = createSignal(false);
  let profileRequestVersion = 0;
  const currentUsername = () => username();

  // Compose sub-hooks
  const reposHook = useUserRepos(currentUsername);
  const starsHook = useUserStars(currentUsername);
  const followersHook = useUserFollowers(currentUsername);
  const followingHook = useUserFollowing(currentUsername);
  const activityHook = useUserActivity(currentUsername);
  const followRequestsHook = useUserFollowRequests(currentUsername, (count) => {
    setProfile((prev) => (prev ? { ...prev, followers_count: count } : null));
  });

  // Derive tabLoading from the active sub-hook
  const tabLoading = () =>
    reposHook.loading() ||
    starsHook.loading() ||
    followersHook.loading() ||
    followingHook.loading() ||
    activityHook.loading() ||
    followRequestsHook.loading();

  const fetchProfile = async () => {
    const requestedUsername = currentUsername();
    if (!requestedUsername) {
      setProfile(null);
      setLoading(false);
      return;
    }
    const requestVersion = ++profileRequestVersion;
    setLoading(true);
    setError(null);
    try {
      const res = await rpc.users[":username"].$get({
        param: { username: requestedUsername },
      });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error(t("userNotFound"));
        }
        throw new Error(t("failedToLoadProfile"));
      }
      const data = await rpcJson<UserProfileResponse>(res);
      if (
        requestVersion !== profileRequestVersion ||
        requestedUsername !== currentUsername()
      ) return;
      setProfile(data.user);
    } catch (err) {
      if (
        requestVersion !== profileRequestVersion ||
        requestedUsername !== currentUsername()
      ) return;
      setError(err instanceof Error ? err.message : t("unknownError"));
    } finally {
      if (
        requestVersion === profileRequestVersion &&
        requestedUsername === currentUsername()
      ) {
        setLoading(false);
      }
    }
  };

  createEffect(on(
    currentUsername,
    () => {
      ++profileRequestVersion;
      setProfile(null);
      setError(null);
      setActiveTab("repositories");
      setFollowLoading(false);
      setStarringRepo(null);
      setBlockLoading(false);
      setMuteLoading(false);
      void fetchProfile();
    },
  ));

  createEffect(() => {
    const current = currentUsername();
    if (!current) return;
    const tab = activeTab();
    switch (tab) {
      case "repositories":
        if (reposHook.repos().length === 0) reposHook.fetch(true);
        break;
      case "stars":
        if (starsHook.starredRepos().length === 0) starsHook.fetch(true);
        break;
      case "activity":
        if (activityHook.events().length === 0 && !activityHook.error()) {
          activityHook.fetch(true);
        }
        break;
      case "followers":
        if (followersHook.followers().length === 0) followersHook.fetch(true);
        break;
      case "following":
        if (followingHook.following().length === 0) followingHook.fetch(true);
        break;
      case "requests":
        if (followRequestsHook.requests().length === 0) {
          followRequestsHook.fetch(true);
        }
        break;
    }
  });

  const toggleFollow = async () => {
    const p = profile();
    const current = currentUsername();
    if (!p || followLoading() || !current) return;

    setFollowLoading(true);
    try {
      let res;
      if (p.is_following || p.follow_requested) {
        res = await rpc.users[":username"].follow.$delete({
          param: { username: current },
        });
      } else {
        res = await rpc.users[":username"].follow.$post({
          param: { username: current },
        });
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
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToToggleFollow"));
    } finally {
      setFollowLoading(false);
    }
  };

  const toggleRepoStar = async (repo: ProfileRepo) => {
    if (starringRepo()) return;

    setStarringRepo(repo.id);
    try {
      let res;
      if (repo.is_starred) {
        res = await rpc.repos[":repoId"].star.$delete({
          param: { repoId: repo.id },
        });
      } else {
        res = await rpc.repos[":repoId"].star.$post({
          param: { repoId: repo.id },
        });
      }

      if (res.ok) {
        const updateRepo = (r: ProfileRepo) =>
          r.id === repo.id
            ? {
              ...r,
              is_starred: !r.is_starred,
              stars: r.stars + (r.is_starred ? -1 : 1),
            }
            : r;

        reposHook.updateRepo(updateRepo);
        starsHook.updateRepo((r) => ({
          ...updateRepo(r),
          starred_at: r.starred_at,
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToToggleStar"));
    } finally {
      setStarringRepo(null);
    }
  };

  const toggleUserFollow = async (user: FollowUser) => {
    try {
      let res;
      if (user.is_following) {
        res = await rpc.users[":username"].follow.$delete({
          param: { username: user.username },
        });
      } else {
        res = await rpc.users[":username"].follow.$post({
          param: { username: user.username },
        });
      }

      if (res.ok) {
        const data = await rpcJson<ToggleUserFollowResponse>(res);
        const updater = (u: FollowUser) =>
          u.username === user.username
            ? { ...u, is_following: data.following }
            : u;

        followersHook.updateUser(updater);
        followingHook.updateUser(updater);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("failedToToggleUserFollow"),
      );
    }
  };

  const toggleBlock = async () => {
    const p = profile();
    const current = currentUsername();
    if (!p || p.is_self || blockLoading() || !current) return;

    setBlockLoading(true);
    try {
      const res = p.is_blocking
        ? await rpc.users[":username"].block.$delete({
          param: { username: current },
        })
        : await rpc.users[":username"].block.$post({
          param: { username: current },
        });

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
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToToggleBlock"));
    } finally {
      setBlockLoading(false);
    }
  };

  const toggleMute = async () => {
    const p = profile();
    const current = currentUsername();
    if (!p || p.is_self || muteLoading() || !current) return;

    setMuteLoading(true);
    try {
      const res = p.is_muted
        ? await rpc.users[":username"].mute.$delete({
          param: { username: current },
        })
        : await rpc.users[":username"].mute.$post({
          param: { username: current },
        });

      if (res.ok) {
        const data = await rpcJson<BlockMuteResponse>(res);
        const muted = !!data.muted;
        setProfile((prev) => (prev ? { ...prev, is_muted: muted } : null));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failedToToggleMute"));
    } finally {
      setMuteLoading(false);
    }
  };

  const loadMore = () => {
    switch (activeTab()) {
      case "repositories":
        reposHook.fetch(false);
        break;
      case "stars":
        starsHook.fetch(false);
        break;
      case "activity":
        activityHook.fetch(false);
        break;
      case "followers":
        followersHook.fetch(false);
        break;
      case "following":
        followingHook.fetch(false);
        break;
      case "requests":
        followRequestsHook.fetch(false);
        break;
    }
  };

  const hasMore = () => ({
    repositories: reposHook.hasMore(),
    stars: starsHook.hasMore(),
    activity: activityHook.hasMore() && !activityHook.error(),
    followers: followersHook.hasMore(),
    following: followingHook.hasMore(),
    requests: followRequestsHook.hasMore(),
  }[activeTab()]);

  return {
    profile,
    repos: reposHook.repos,
    starredRepos: starsHook.starredRepos,
    activityEvents: activityHook.events,
    activityError: activityHook.error,
    followers: followersHook.followers,
    following: followingHook.following,
    followRequests: followRequestsHook.requests,
    requestActionLoadingId: followRequestsHook.actionLoadingId,
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
    acceptFollowRequest: followRequestsHook.accept,
    rejectFollowRequest: followRequestsHook.reject,
    followersSort: followersHook.sort,
    followersOrder: followersHook.order,
    followingSort: followingHook.sort,
    followingOrder: followingHook.order,
    setFollowersSortKey: followersHook.setSortKey,
    setFollowingSortKey: followingHook.setSortKey,
    loadMore,
    hasMore,
  };
}
