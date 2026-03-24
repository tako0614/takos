import type { Repository, Branch } from '../../../types';
import { Icons } from '../../../lib/Icons';
import { UpstreamSyncWidget } from './UpstreamSyncWidget';
import { useI18n } from '../../../providers/I18nProvider';

interface RepoDetailSidebarProps {
  repo: Repository;
  safeHomepage: string | null;
  starsCount: number;
  forksCount: number;
  branches: Branch[];
  isAuthenticated: boolean;
  onSyncComplete: () => void;
}

export function RepoDetailSidebar({
  repo,
  safeHomepage,
  starsCount,
  forksCount,
  branches,
  isAuthenticated,
  onSyncComplete,
}: RepoDetailSidebarProps) {
  const { t } = useI18n();

  return (
    <div className="w-80 flex-shrink-0 space-y-4">
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">{t('about')}</span>
        </div>
        <div className="p-4 bg-white dark:bg-zinc-900 space-y-4">
          {repo.description ? (
            <p className="text-sm text-zinc-700 dark:text-zinc-300">{repo.description}</p>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400 italic">{t('noDescriptionProvided')}</p>
          )}

          {safeHomepage && (
            <a
              href={safeHomepage}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              <Icons.Link className="w-4 h-4" />
              <span className="truncate">{safeHomepage}</span>
            </a>
          )}

          {repo.topics && repo.topics.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {repo.topics.map(topic => (
                <span
                  key={topic}
                  className="px-2.5 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {repo.forked_from_id && isAuthenticated && (
        <UpstreamSyncWidget
          repoId={repo.id}
          onSyncComplete={onSyncComplete}
        />
      )}

      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-900">
        <div className="grid grid-cols-2 divide-x divide-zinc-200 dark:divide-zinc-700">
          <div className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400 mb-1">
              <Icons.Sparkles className="w-4 h-4" />
              <span className="text-xs">{t('starsLabel')}</span>
            </div>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{starsCount}</span>
          </div>
          <div className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400 mb-1">
              <Icons.GitMerge className="w-4 h-4" />
              <span className="text-xs">{t('forksLabel')}</span>
            </div>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{forksCount}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 divide-x divide-zinc-200 dark:divide-zinc-700 border-t border-zinc-200 dark:border-zinc-700">
          <div className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400 mb-1">
              <Icons.Eye className="w-4 h-4" />
              <span className="text-xs">{t('watchersLabel')}</span>
            </div>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{repo.watchers_count || 0}</span>
          </div>
          <div className="p-4 text-center">
            <div className="flex items-center justify-center gap-1.5 text-zinc-500 dark:text-zinc-400 mb-1">
              <Icons.GitMerge className="w-4 h-4" />
              <span className="text-xs">{t('branchesLabel')}</span>
            </div>
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{branches.length}</span>
          </div>
        </div>
      </div>

      {repo.language && (
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden bg-white dark:bg-zinc-900 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="font-medium text-zinc-900 dark:text-zinc-100 text-sm">{t('languages')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-blue-500"></span>
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{repo.language}</span>
          </div>
        </div>
      )}
    </div>
  );
}
