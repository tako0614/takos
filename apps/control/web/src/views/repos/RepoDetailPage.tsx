import { createSignal, createEffect, on } from 'solid-js';
import { RepoDetail } from './components/RepoDetail.tsx';
import { Icons } from '../../lib/Icons.tsx';
import type { Repository } from '../../types/index.ts';
import { rpc, rpcJson } from '../../lib/rpc.ts';

interface RepoDetailPageProps {
  spaceId?: string;
  repoId?: string;
  username?: string;
  repoName?: string;
  onBack: () => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

export function RepoDetailPage(props: RepoDetailPageProps) {
  const [repo, setRepo] = createSignal<Repository | null>(null);
  const [resolvedSpaceId, setResolvedSpaceId] = createSignal<string | null>(props.spaceId || null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  const fetchRepo = async () => {
    try {
      setLoading(true);
      setError(null);

      if (props.username && props.repoName) {
        type ByNameRepo = Omit<Repository, 'id' | 'name' | 'description' | 'visibility' | 'default_branch' | 'stars' | 'forks' | 'created_at' | 'updated_at' | 'space_id' | 'owner_username' | 'owner_name'>;
        const res = await rpc.explore.repos['by-name'][':username'][':repoName'].$get({
          param: {
            username: props.username,
            repoName: props.repoName,
          },
        });
        const data = await rpcJson<{
          repository: {
            id: string;
            name: string;
            description: string | null;
            visibility: Repository['visibility'];
            default_branch: string;
            stars: number;
            forks: number;
            created_at: string;
            updated_at: string;
            space_id?: string;
          } & ByNameRepo;
          owner?: {
            id?: string;
            name: string;
            username: string;
            avatar_url?: string | null;
          };
          space?: {
            id: string;
            name?: string;
          };
        }>(res);

        setRepo({
          ...data.repository,
          space_id: data.repository.space_id || data.space?.id || '',
          owner_username: data.owner?.username,
          owner_name: data.owner?.name,
        });
        setResolvedSpaceId(data.space?.id || null);
        return;
      }

      if (props.repoId) {
        const res = await rpc.repos[':repoId'].$get({
          param: { repoId: props.repoId },
        });
        const data = await rpcJson<{
          repository: Repository;
          space?: { name?: string } | null;
          owner?: { name?: string | null; picture?: string | null } | null;
        }>(res);

        setRepo(data.repository);
        setResolvedSpaceId(data.repository.space_id || props.spaceId || null);
        return;
      }

      throw new Error('No repository identifier provided');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  createEffect(on(
    () => [props.spaceId, props.repoId, props.username, props.repoName],
    () => { void fetchRepo(); },
  ));

  return (
    <>
      {loading() ? (
        <div class="flex flex-col items-center justify-center h-full bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">
          <div class="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
        </div>
      ) : error() || !repo() ? (
        <div class="flex flex-col items-center justify-center h-full bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 gap-3">
          <Icons.AlertTriangle class="w-6 h-6" />
          <span class="text-sm">{error() || 'Repository not found'}</span>
          <button
            class="px-3 py-1.5 text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={props.onBack}
          >
            Go Back
          </button>
        </div>
      ) : (
        <RepoDetail
          spaceId={resolvedSpaceId() || ''}
          repo={repo()!}
          onBack={props.onBack}
          isAuthenticated={props.isAuthenticated}
          onRequireLogin={props.onRequireLogin}
        />
      )}
    </>
  );
}
