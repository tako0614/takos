import { useEffect, useState } from 'react';
import { RepoDetail } from './components/RepoDetail';
import { Icons } from '../../lib/Icons';
import type { Repository } from '../../types';
import { rpc, rpcJson } from '../../lib/rpc';

interface RepoDetailPageProps {
  spaceId?: string;
  repoId?: string;
  username?: string;
  repoName?: string;
  onBack: () => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

export function RepoDetailPage({
  spaceId,
  repoId,
  username,
  repoName,
  onBack,
  isAuthenticated,
  onRequireLogin,
}: RepoDetailPageProps) {
  const [repo, setRepo] = useState<Repository | null>(null);
  const [resolvedWorkspaceId, setResolvedWorkspaceId] = useState<string | null>(spaceId || null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchRepo();
  }, [spaceId, repoId, username, repoName]);

  const fetchRepo = async () => {
    try {
      setLoading(true);
      setError(null);

      if (username && repoName) {
        type ByNameRepo = Omit<Repository, 'id' | 'name' | 'description' | 'visibility' | 'default_branch' | 'stars' | 'forks' | 'created_at' | 'updated_at' | 'space_id' | 'owner_username' | 'owner_name'>;
        const res = await rpc.explore.repos['by-name'][':username'][':repoName'].$get({
          param: {
            username,
            repoName,
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
          workspace?: {
            id: string;
            name?: string;
          };
        }>(res);

        setRepo({
          ...data.repository,
          space_id: data.repository.space_id || data.workspace?.id || '',
          owner_username: data.owner?.username,
          owner_name: data.owner?.name,
        });
        setResolvedWorkspaceId(data.workspace?.id || null);
        return;
      }

      if (repoId) {
        const res = await rpc.repos[':repoId'].$get({
          param: { repoId },
        });
        const data = await rpcJson<{
          repository: Repository;
          workspace?: { name?: string } | null;
          owner?: { name?: string | null; picture?: string | null } | null;
        }>(res);

        setRepo(data.repository);
        setResolvedWorkspaceId(data.repository.space_id || spaceId || null);
        return;
      }

      throw new Error('No repository identifier provided');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400">
        <div className="w-6 h-6 border-2 border-zinc-300 dark:border-zinc-600 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !repo) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 gap-3">
        <Icons.AlertTriangle className="w-6 h-6" />
        <span className="text-sm">{error || 'Repository not found'}</span>
        <button
          className="px-3 py-1.5 text-sm bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
          onClick={onBack}
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <RepoDetail
      spaceId={resolvedWorkspaceId || ''}
      repo={repo}
      onBack={onBack}
      isAuthenticated={isAuthenticated}
      onRequireLogin={onRequireLogin}
    />
  );
}
