import { ProfileHeader } from "../../components/profile/ProfileHeader.tsx";
import { ProfileLoadMoreButton } from "../../components/profile/ProfileLoadMoreButton.tsx";
import { ProfileActivityTab } from "../../components/profile/ProfileActivityTab.tsx";
import { ProfileReposTab } from "../../components/profile/ProfileReposTab.tsx";
import { ProfileRequestsTab } from "../../components/profile/ProfileRequestsTab.tsx";
import { ProfileStarsTab } from "../../components/profile/ProfileStarsTab.tsx";
import { ProfileTabs } from "../../components/profile/ProfileTabs.tsx";
import {
  ProfileErrorState,
  ProfileLoadingState,
} from "../../components/profile/ProfileStates.tsx";
import {
  ProfileEmptyIcon,
  ProfileUserList,
} from "../../components/profile/ProfileUserList.tsx";
import { useUserProfile } from "../../hooks/useUserProfile.ts";
import type { UserProfilePageProps } from "../../types/profile.ts";

export function UserProfilePage(props: UserProfilePageProps) {
  const {
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
    setFollowersSortKey,
    followingSort,
    setFollowingSortKey,
    loadMore,
    hasMore,
  } = useUserProfile(() => props.username);

  const renderContent = () => {
    if (loading()) {
      return <ProfileLoadingState />;
    }

    const currentError = error();
    if (currentError) {
      return <ProfileErrorState message={currentError} onBack={props.onBack} />;
    }

    if (!profile()) return null;

    return (
      <div class="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900 overflow-auto">
        <ProfileHeader
          profile={profile()!}
          onBack={props.onBack}
          onSelectTab={setActiveTab}
          onToggleFollow={toggleFollow}
          followLoading={followLoading()}
          onToggleBlock={toggleBlock}
          onToggleMute={toggleMute}
          blockLoading={blockLoading()}
          muteLoading={muteLoading()}
        />

        <ProfileTabs
          activeTab={activeTab()}
          profile={profile()!}
          onSelectTab={setActiveTab}
          requestsCount={followRequests().length}
        />

        <div class="flex-1 p-6">
          {activeTab() === "repositories" && (
            <ProfileReposTab
              repos={repos()}
              onSelectRepo={(repoName) =>
                props.onNavigateToRepo?.(props.username, repoName)}
              onStarToggle={toggleRepoStar}
              starringRepo={starringRepo()}
            />
          )}

          {activeTab() === "stars" && (
            <ProfileStarsTab
              starredRepos={starredRepos()}
              onSelectRepo={(repoName) =>
                props.onNavigateToRepo?.(props.username, repoName)}
              onStarToggle={toggleRepoStar}
              starringRepo={starringRepo()}
            />
          )}

          {activeTab() === "activity" && (
            activityError()
              ? (
                <div class="p-4 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300">
                  {activityError()}
                </div>
              )
              : (
                <ProfileActivityTab
                  events={activityEvents()}
                  onNavigateToRepo={(ownerUsername, repoName) =>
                    props.onNavigateToRepo?.(ownerUsername, repoName)}
                />
              )
          )}

          {activeTab() === "followers" && (
            <div class="space-y-4">
              <div class="flex items-center gap-2">
                <span class="text-sm text-zinc-500 dark:text-zinc-400">
                  Sort:
                </span>
                <select
                  class="px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100"
                  value={followersSort()}
                  onChange={(e) => {
                    const nextSort = e.currentTarget.value;
                    setFollowersSortKey(
                      nextSort === "username" ? "username" : "created",
                    );
                  }}
                >
                  <option value="created">Newest</option>
                  <option value="username">Username</option>
                </select>
              </div>
              <ProfileUserList
                users={followers()}
                emptyTitle="No followers yet"
                emptyIcon={<ProfileEmptyIcon />}
                onNavigateToProfile={props.onNavigateToProfile}
                onToggleFollow={toggleUserFollow}
              />
            </div>
          )}

          {activeTab() === "following" && (
            <div class="space-y-4">
              <div class="flex items-center gap-2">
                <span class="text-sm text-zinc-500 dark:text-zinc-400">
                  Sort:
                </span>
                <select
                  class="px-3 py-2 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-900 dark:text-zinc-100"
                  value={followingSort()}
                  onChange={(e) => {
                    const nextSort = e.currentTarget.value;
                    setFollowingSortKey(
                      nextSort === "username" ? "username" : "created",
                    );
                  }}
                >
                  <option value="created">Newest</option>
                  <option value="username">Username</option>
                </select>
              </div>
              <ProfileUserList
                users={following()}
                emptyTitle="Not following anyone yet"
                emptyIcon={<ProfileEmptyIcon />}
                onNavigateToProfile={props.onNavigateToProfile}
                onToggleFollow={toggleUserFollow}
              />
            </div>
          )}

          {activeTab() === "requests" && (
            <ProfileRequestsTab
              requests={followRequests()}
              actionLoadingId={requestActionLoadingId()}
              onAccept={acceptFollowRequest}
              onReject={rejectFollowRequest}
              onNavigateToProfile={props.onNavigateToProfile}
            />
          )}

          {tabLoading() && (
            <div class="flex justify-center py-8">
              <div class="w-6 h-6 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-white rounded-full animate-spin" />
            </div>
          )}

          {hasMore() && !tabLoading() && (
            <ProfileLoadMoreButton onLoadMore={loadMore} />
          )}
        </div>
      </div>
    );
  };

  return <>{renderContent()}</>;
}
