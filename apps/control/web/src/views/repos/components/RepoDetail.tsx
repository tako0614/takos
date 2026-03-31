import { createSignal, createEffect, on, Show, For } from 'solid-js';
import type { JSX } from 'solid-js';
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

interface SelectedFile {
  path: string | null;
  line: number | null;
}

interface StarState {
  starred: boolean;
  count: number;
}

type ReadmeState =
  | { status: 'idle'; content: null }
  | { status: 'loading'; content: string | null }
  | { status: 'done'; content: string | null };

const README_CANDIDATES = ['README.md', 'readme.md', 'README', 'readme.txt'] as const;

const NON_RETRYABLE_ERRORS = new Set([
  'Ref not found',
  'Commit object missing',
  'Commit tree missing',
  'Repository not found',
]);

async function resolveReadmeContent(repoId: string, branch: string): Promise<string | null> {
  for (const filename of README_CANDIDATES) {
    try {
      const res = await repoBlob(repoId, branch, { path: filename });

      if (res.ok) {
        const data = await rpcJson<{ content?: string }>(res);
        if (data.content) return data.content;
      }

      const apiError = await res.json().then(
        (body) => (body as { error?: string })?.error || '',
        () => '',
      );

      if (res.status === 404 && (apiError === 'File not found' || apiError === 'Path not found')) {
        continue;
      }

      if (res.status >= 500 || res.status === 409 || NON_RETRYABLE_ERRORS.has(apiError)) {
        break;
      }
    } catch {
      // network error - try next candidate
    }
  }
  return null;
}

interface RepoDetailProps {
  spaceId: string;
  repo: Repository;
  onBack: () => void;
  isAuthenticated?: boolean;
  onRequireLogin?: () => void;
}

export function RepoDetail(props: RepoDetailProps) {
  const { t } = useI18n();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();
  const safeHomepage = () => toSafeHref(props.repo.homepage);
  const [activeTab, setActiveTab] = createSignal<TabType>('code');
  const [branches, setBranches] = createSignal<Branch[]>([]);
  const [currentBranch, setCurrentBranch] = createSignal<string>(props.repo.default_branch);
  const [selectedFile, setSelectedFile] = createSignal<SelectedFile>({ path: null, line: null });
  const [star, setStar] = createSignal<StarState>({ starred: props.repo.is_starred ?? false, count: props.repo.stars });
  const [forksCount, setForksCount] = createSignal(props.repo.forks);
  const [showForkModal, setShowForkModal] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [readmeState, setReadmeState] = createSignal<ReadmeState>({ status: 'idle', content: null });

  const isAuthenticated = () => props.isAuthenticated ?? true;

  const fetchReadme = async () => {
    setReadmeState(prev => ({ status: 'loading', content: prev.content }));
    try {
      const content = await resolveReadmeContent(props.repo.id, currentBranch());
      setReadmeState({ status: 'done', content });
    } catch {
      setReadmeState({ status: 'done', content: null });
    }
  };

  const fetchBranches = async () => {
    try {
      const res = await rpc.repos[':repoId'].branches.$get({
        param: { repoId: props.repo.id },
        query: {},
      });
      const data = await rpcJson<{ branches?: Branch[] }>(res);
      setBranches(data.branches || []);
    } catch {
      // Branch fetch is optional, silently ignore errors
    }
  };

  createEffect(on(
    () => [props.repo.id],
    () => {
      fetchBranches();
      fetchReadme();
    },
  ));

  createEffect(on(
    () => currentBranch(),
    () => { fetchReadme(); },
  ));

  createEffect(on(
    () => [branches(), currentBranch()],
    () => {
      const br = branches();
      if (br.length === 0) return;
      if (br.some((branch) => branch.name === currentBranch())) return;

      const fallbackBranch = br.find((branch) => branch.is_default)?.name || br[0].name;
      if (!fallbackBranch) return;

      setCurrentBranch(fallbackBranch);
      setSelectedFile({ path: null, line: null });
    },
  ));

  const toggleStar = async () => {
    if (!isAuthenticated()) {
      props.onRequireLogin?.();
      return;
    }
    const prev = star();
    setStar({ starred: !prev.starred, count: prev.count + (prev.starred ? -1 : 1) });

    try {
      if (prev.starred) {
        await rpc.repos[':repoId'].star.$delete({ param: { repoId: props.repo.id } });
      } else {
        await rpc.repos[':repoId'].star.$post({ param: { repoId: props.repo.id } });
      }
    } catch {
      setStar(prev);
    }
  };

  const handleForkSuccess = (_forkedRepo: Repository) => {
    setShowForkModal(false);
    setForksCount(prev => prev + 1);
  };

  const handleDelete = async () => {
    if (!isAuthenticated()) {
      props.onRequireLogin?.();
      return;
    }
    const confirmed = await confirm({
      title: t('deleteRepo'),
      message: t('deleteRepoConfirm', { name: props.repo.name }),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      const res = await rpc.repos[':repoId'].$delete({ param: { repoId: props.repo.id } });
      await rpcJson(res);
      showToast('success', t('repoDeleted'));
      props.onBack();
    } catch (err) {
      showToast('error', `${t('deleteFailed')}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleFileSelect = (path: string) => {
    setSelectedFile({ path, line: null });
  };

  const handleBackToTree = () => {
    setSelectedFile({ path: null, line: null });
  };

  const tabs: { id: TabType; label: string; icon: JSX.Element }[] = [
    { id: 'code', label: t('code'), icon: <Icons.Code class="w-4 h-4" /> },
    { id: 'search', label: t('search'), icon: <Icons.Search class="w-4 h-4" /> },
    { id: 'commits', label: t('commits'), icon: <Icons.Clock class="w-4 h-4" /> },
    { id: 'branches', label: t('branches'), icon: <Icons.GitMerge class="w-4 h-4" /> },
    { id: 'pull-requests', label: t('pullRequests'), icon: <Icons.GitMerge class="w-4 h-4" /> },
    { id: 'releases', label: t('releases'), icon: <Icons.Tag class="w-4 h-4" /> },
    { id: 'actions', label: t('actions'), icon: <Icons.Terminal class="w-4 h-4" /> },
  ];

  const ownerName = () => props.repo.owner_username || props.repo.owner_name;

  return (
    <div class="flex flex-col h-full bg-zinc-50 dark:bg-zinc-900">
      <div class="max-w-3xl w-full mx-auto flex flex-col flex-1 min-h-0">

      {/* Header */}
      <div class="border-b border-zinc-200 dark:border-zinc-800">
        <div class="px-4 py-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 text-base">
              <button onClick={props.onBack} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                <Icons.ChevronLeft class="w-5 h-5" />
              </button>
              <Show when={ownerName()}>
                <span class="text-zinc-500 dark:text-zinc-400">{ownerName()}</span>
                <span class="text-zinc-400 dark:text-zinc-600">/</span>
              </Show>
              <span class="font-semibold text-zinc-900 dark:text-zinc-100">{props.repo.name}</span>
              <span class={`px-1.5 py-0.5 text-[10px] rounded-full ${
                props.repo.visibility === 'private'
                  ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20'
                  : 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'
              }`}>
                {props.repo.visibility}
              </span>
            </div>

            <div class="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
              <button
                class={`flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors ${
                  star().starred ? 'text-amber-500' : ''
                }`}
                onClick={toggleStar}
              >
                <Icons.Sparkles class="w-3.5 h-3.5" />
                <span>{star().count}</span>
              </button>
              <button
                class="flex items-center gap-1 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                onClick={() => {
                  if (!isAuthenticated()) { props.onRequireLogin?.(); return; }
                  setShowForkModal(true);
                }}
              >
                <Icons.GitMerge class="w-3.5 h-3.5" />
                <span>{forksCount()}</span>
              </button>
            </div>
          </div>

          <Show when={props.repo.description}>
            <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{props.repo.description}</p>
          </Show>

          <Show when={props.repo.forked_from}>
            <div class="mt-1 flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500">
              <Icons.GitMerge class="w-3 h-3" />
              <span>{t('forkedFrom')}</span>
              <button
                class="text-blue-500 dark:text-blue-400 hover:underline"
                onClick={() => showToast('info', `Upstream: ${props.repo.forked_from?.owner_username || 'unknown'}/${props.repo.forked_from?.name}`)}
              >
                {props.repo.forked_from!.owner_username || props.repo.forked_from!.owner_name || 'unknown'}/{props.repo.forked_from!.name}
              </button>
            </div>
          </Show>
        </div>

        <div class="flex items-center gap-0 px-4 -mb-px overflow-x-auto scrollbar-none">
          <For each={tabs}>{(tab) => (
            <button
              class={`flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors whitespace-nowrap ${
                activeTab() === tab.id
                  ? 'border-orange-500 text-zinc-900 dark:text-zinc-100 font-medium'
                  : 'border-transparent text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100'
              }`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          )}</For>
        </div>
      </div>

      <Show when={activeTab() === 'code'}>
        <div class="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <RepoDetailBranches
            branches={branches()}
            currentBranch={currentBranch()}
            onBranchChange={(branch) => {
              setCurrentBranch(branch);
              setSelectedFile({ path: null, line: null });
            }}
          />

          <div class="flex items-center gap-2">
            <Show when={isAuthenticated()}>
              <button
                class="p-1 text-zinc-400 hover:text-red-500 transition-colors disabled:opacity-50"
                onClick={handleDelete}
                disabled={deleting()}
              >
                <Icons.Trash class="w-3.5 h-3.5" />
              </button>
            </Show>
          </div>
        </div>
      </Show>

      <div class="flex-1 overflow-auto">
        <Show when={activeTab() === 'code'}>
          <RepoDetailFiles
            repo={props.repo}
            currentBranch={currentBranch()}
            selectedFilePath={selectedFile().path}
            selectedFileLine={selectedFile().line}
            readme={readmeState().content}
            readmeLoading={readmeState().status === 'loading'}
            safeHomepage={safeHomepage()}
            starsCount={star().count}
            forksCount={forksCount()}
            branches={branches()}
            isAuthenticated={isAuthenticated()}
            onFileSelect={handleFileSelect}
            onBackToTree={handleBackToTree}
            onSyncComplete={() => {
              fetchBranches();
              fetchReadme();
            }}
          />
        </Show>

        <Show when={activeTab() === 'search'}>
          <RepoCodeSearch
            repoId={props.repo.id}
            branch={currentBranch()}
            onOpenFile={(path, line) => {
              setSelectedFile({ path, line: typeof line === 'number' ? line : null });
              setActiveTab('code');
            }}
          />
        </Show>

        <Show when={activeTab() === 'commits'}>
          <CommitList
            repoId={props.repo.id}
            branch={currentBranch()}
          />
        </Show>

        <Show when={activeTab() === 'branches'}>
          <BranchesTab
            repoId={props.repo.id}
          />
        </Show>

        <Show when={activeTab() === 'pull-requests'}>
          <PRList
            repoId={props.repo.id}
          />
        </Show>

        <Show when={activeTab() === 'releases'}>
          <ReleaseList
            repoId={props.repo.id}
          />
        </Show>

        <Show when={activeTab() === 'actions'}>
          <ActionsTab
            repoId={props.repo.id}
          />
        </Show>
      </div>

      </div>

      <Show when={showForkModal()}>
        <ForkModal
          repo={props.repo}
          onClose={() => setShowForkModal(false)}
          onSuccess={handleForkSuccess}
        />
      </Show>
    </div>
  );
}
