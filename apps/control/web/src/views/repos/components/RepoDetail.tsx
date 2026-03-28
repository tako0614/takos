import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Icons } from '../../../lib/Icons';
import type { Repository, Branch } from '../../../types';
import { CommitList } from './CommitList';
import { RepoCodeSearch } from './RepoCodeSearch';
import { PRList } from './PRList';
import { ReleaseList } from './ReleaseList';
import { ActionsTab } from './ActionsTab';
import { BranchesTab } from './BranchesTab';
import { ForkModal } from './ForkModal';
import { RepoDetailFiles } from './RepoDetailFiles';
import { RepoDetailBranches } from './RepoDetailBranches';
import { useToast } from '../../../store/toast';
import { useConfirmDialog } from '../../../store/confirm-dialog';
import { useI18n } from '../../../store/i18n';
import { rpc, rpcJson, repoBlob } from '../../../lib/rpc';
import { toSafeHref } from '../../../lib/safeHref';

type TabType = 'code' | 'search' | 'commits' | 'branches' | 'pull-requests' | 'releases' | 'actions';

interface RepoDetailProps {
  spaceId: string;
  repo: Repository;
  onBack: () => void;
  isAuthenticated?: boolean;
  onRequireLogin?: () => void;
}

export function RepoDetail({ spaceId, repo, onBack, isAuthenticated = true, onRequireLogin }: RepoDetailProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const safeHomepage = toSafeHref(repo.homepage);
  const [activeTab, setActiveTab] = useState<TabType>('code');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = useState<string>(repo.default_branch);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileLine, setSelectedFileLine] = useState<number | null>(null);
  const [isStarred, setIsStarred] = useState(repo.is_starred ?? false);
  const [starsCount, setStarsCount] = useState(repo.stars);
  const [forksCount, setForksCount] = useState(repo.forks);
  const [showForkModal, setShowForkModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [readme, setReadme] = useState<string | null>(null);
  const [readmeLoading, setReadmeLoading] = useState(false);

  const fetchReadme = useCallback(async () => {
    setReadmeLoading(true);
    try {
      const nonRetryableErrors = new Set([
        'Ref not found',
        'Commit object missing',
        'Commit tree missing',
        'Repository not found',
      ]);

      for (const filename of ['README.md', 'readme.md', 'README', 'readme.txt']) {
        try {
          const res = await repoBlob(repo.id, currentBranch, { path: filename });
          if (res.ok) {
            const data = await rpcJson<{ content?: string }>(res);
            if (data.content) {
              setReadme(data.content);
              return;
            }
          }

          let apiError = '';
          try {
            const body = await res.json() as { error?: string };
            apiError = body?.error || '';
          } catch {
            apiError = '';
          }

          if (res.status === 404 && (apiError === 'File not found' || apiError === 'Path not found')) {
            continue;
          }

          if (res.status >= 500 || res.status === 409 || nonRetryableErrors.has(apiError)) {
            break;
          }
        } catch {
          // continue to next filename
        }
      }
      setReadme(null);
    } catch {
      setReadme(null);
    } finally {
      setReadmeLoading(false);
    }
  }, [repo.id, currentBranch]);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await rpc.repos[':repoId'].branches.$get({
        param: { repoId: repo.id },
        query: {},
      });
      const data = await rpcJson<{ branches?: Branch[] }>(res);
      setBranches(data.branches || []);
    } catch {
      // Branch fetch is optional, silently ignore errors
    }
  }, [repo.id]);

  useEffect(() => {
    fetchBranches();
    fetchReadme();
  }, [fetchBranches, fetchReadme]);

  useEffect(() => {
    if (branches.length === 0) return;
    if (branches.some((branch) => branch.name === currentBranch)) return;

    const fallbackBranch = branches.find((branch) => branch.is_default)?.name || branches[0].name;
    if (!fallbackBranch) return;

    setCurrentBranch(fallbackBranch);
    setSelectedFilePath(null);
  }, [branches, currentBranch]);

  const toggleStar = async () => {
    if (!isAuthenticated) {
      onRequireLogin?.();
      return;
    }
    const wasStarred = isStarred;
    const previousCount = starsCount;

    setIsStarred(!wasStarred);
    setStarsCount(previousCount + (wasStarred ? -1 : 1));

    try {
      if (wasStarred) {
        await rpc.repos[':repoId'].star.$delete({ param: { repoId: repo.id } });
      } else {
        await rpc.repos[':repoId'].star.$post({ param: { repoId: repo.id } });
      }
    } catch {
      setIsStarred(wasStarred);
      setStarsCount(previousCount);
    }
  };

  const handleForkSuccess = (_forkedRepo: Repository) => {
    setShowForkModal(false);
    setForksCount(prev => prev + 1);
  };

  const handleDelete = async () => {
    if (!isAuthenticated) {
      onRequireLogin?.();
      return;
    }
    const confirmed = await confirm({
      title: t('deleteRepo'),
      message: t('deleteRepoConfirm', { name: repo.name }),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await rpc.repos[':repoId'].$delete({ param: { repoId: repo.id } });
      await rpcJson(res);
      showToast('success', t('repoDeleted'));
      onBack();
    } catch (err) {
      showToast('error', `${t('deleteFailed')}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleFileSelect = (path: string) => {
    setSelectedFilePath(path);
    setSelectedFileLine(null);
  };

  const handleBackToTree = () => {
    setSelectedFilePath(null);
    setSelectedFileLine(null);
  };

  const tabs: { id: TabType; label: string; icon: ReactNode }[] = [
    { id: 'code', label: t('code'), icon: <Icons.Code className="w-4 h-4" /> },
    { id: 'search', label: t('search'), icon: <Icons.Search className="w-4 h-4" /> },
    { id: 'commits', label: t('commits'), icon: <Icons.Clock className="w-4 h-4" /> },
    { id: 'branches', label: t('branches'), icon: <Icons.GitMerge className="w-4 h-4" /> },
    { id: 'pull-requests', label: t('pullRequests'), icon: <Icons.GitMerge className="w-4 h-4" /> },
    { id: 'releases', label: t('releases'), icon: <Icons.Tag className="w-4 h-4" /> },
    { id: 'actions', label: t('actions'), icon: <Icons.Terminal className="w-4 h-4" /> },
  ];

  const ownerName = repo.owner_username || repo.owner_name;

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
      <div className="max-w-3xl w-full mx-auto flex flex-col flex-1 min-h-0">

      {/* Header */}
      <div className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base">
              <button onClick={onBack} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                <Icons.ChevronLeft className="w-5 h-5" />
              </button>
              {ownerName && (
                <>
                  <span className="text-zinc-500 dark:text-zinc-400">{ownerName}</span>
                  <span className="text-zinc-400 dark:text-zinc-600">/</span>
                </>
              )}
              <span className="font-semibold text-zinc-900 dark:text-zinc-100">{repo.name}</span>
              <span className={`px-1.5 py-0.5 text-[10px] rounded-full ${
                repo.visibility === 'private'
                  ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                  : 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
              }`}>
                {repo.visibility}
              </span>
            </div>

            <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
              <button
                className={`flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors ${
                  isStarred ? 'text-amber-500' : ''
                }`}
                onClick={toggleStar}
              >
                <Icons.Sparkles className="w-3.5 h-3.5" />
                <span>{starsCount}</span>
              </button>
              <button
                className="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                onClick={() => {
                  if (!isAuthenticated) { onRequireLogin?.(); return; }
                  setShowForkModal(true);
                }}
              >
                <Icons.GitMerge className="w-3.5 h-3.5" />
                <span>{forksCount}</span>
              </button>
            </div>
          </div>

          {repo.description && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{repo.description}</p>
          )}

          {repo.forked_from && (
            <div className="mt-1 flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
              <Icons.GitMerge className="w-3 h-3" />
              <span>{t('forkedFrom')}</span>
              <button
                className="text-blue-500 dark:text-blue-400 hover:underline"
                onClick={() => showToast('info', `Upstream: ${repo.forked_from?.owner_username || 'unknown'}/${repo.forked_from?.name}`)}
              >
                {repo.forked_from.owner_username || repo.forked_from.owner_name || 'unknown'}/{repo.forked_from.name}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-0 px-4 -mb-px overflow-x-auto scrollbar-none">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-orange-500 text-zinc-900 dark:text-zinc-100 font-medium'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'code' && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <RepoDetailBranches
            branches={branches}
            currentBranch={currentBranch}
            onBranchChange={(branch) => {
              setCurrentBranch(branch);
              setSelectedFilePath(null);
            }}
          />

          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button
                className="p-1 text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-50"
                onClick={handleDelete}
                disabled={deleting}
              >
                <Icons.Trash className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {activeTab === 'code' && (
          <RepoDetailFiles
            repo={repo}
            currentBranch={currentBranch}
            selectedFilePath={selectedFilePath}
            selectedFileLine={selectedFileLine}
            readme={readme}
            readmeLoading={readmeLoading}
            safeHomepage={safeHomepage}
            starsCount={starsCount}
            forksCount={forksCount}
            branches={branches}
            isAuthenticated={isAuthenticated}
            onFileSelect={handleFileSelect}
            onBackToTree={handleBackToTree}
            onSyncComplete={() => {
              fetchBranches();
              fetchReadme();
            }}
          />
        )}

        {activeTab === 'search' && (
          <RepoCodeSearch
            repoId={repo.id}
            branch={currentBranch}
            onOpenFile={(path, line) => {
              setSelectedFilePath(path);
              setSelectedFileLine(typeof line === 'number' ? line : null);
              setActiveTab('code');
            }}
          />
        )}

        {activeTab === 'commits' && (
          <CommitList
            repoId={repo.id}
            branch={currentBranch}
          />
        )}

        {activeTab === 'branches' && (
          <BranchesTab
            repoId={repo.id}
          />
        )}

        {activeTab === 'pull-requests' && (
          <PRList
            repoId={repo.id}
          />
        )}

        {activeTab === 'releases' && (
          <ReleaseList
            repoId={repo.id}
          />
        )}

        {activeTab === 'actions' && (
          <ActionsTab
            repoId={repo.id}
          />
        )}
      </div>

      </div>

      {showForkModal && (
        <ForkModal
          repo={repo}
          onClose={() => setShowForkModal(false)}
          onSuccess={handleForkSuccess}
        />
      )}
    </div>
  );
}
