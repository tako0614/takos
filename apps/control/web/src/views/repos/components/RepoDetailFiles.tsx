import type { Repository, Branch } from '../../../types';
import { FileTree } from './FileTree';
import { FileViewer } from './FileViewer';
import { RepoDetailReadme } from './RepoDetailReadme';
import { RepoDetailSidebar } from './RepoDetailSidebar';

interface RepoDetailFilesProps {
  repo: Repository;
  currentBranch: string;
  selectedFilePath: string | null;
  selectedFileLine: number | null;
  readme: string | null;
  readmeLoading: boolean;
  safeHomepage: string | null;
  starsCount: number;
  forksCount: number;
  branches: Branch[];
  isAuthenticated: boolean;
  onFileSelect: (path: string) => void;
  onBackToTree: () => void;
  onSyncComplete: () => void;
}

export function RepoDetailFiles({
  repo,
  currentBranch,
  selectedFilePath,
  selectedFileLine,
  readme,
  readmeLoading,
  safeHomepage,
  starsCount,
  forksCount,
  branches,
  isAuthenticated,
  onFileSelect,
  onBackToTree,
  onSyncComplete,
}: RepoDetailFilesProps) {
  if (selectedFilePath) {
    return (
      <FileViewer
        repoId={repo.id}
        branch={currentBranch}
        filePath={selectedFilePath}
        initialLine={selectedFileLine ?? undefined}
        onBack={onBackToTree}
      />
    );
  }

  return (
    <div className="flex gap-6 p-4">
      <div className="flex-1 min-w-0">
        <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
          <FileTree
            repoId={repo.id}
            branch={currentBranch}
            onFileSelect={onFileSelect}
          />
        </div>

        <RepoDetailReadme readme={readme} readmeLoading={readmeLoading} />
      </div>

      <RepoDetailSidebar
        repo={repo}
        safeHomepage={safeHomepage}
        starsCount={starsCount}
        forksCount={forksCount}
        branches={branches}
        isAuthenticated={isAuthenticated}
        onSyncComplete={onSyncComplete}
      />
    </div>
  );
}
