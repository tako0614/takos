import { Show } from "solid-js";
import type { Branch, Repository } from "../../../types/index.ts";
import { FileTree } from "./FileTree.tsx";
import { FileViewer } from "./FileViewer.tsx";
import { RepoDetailReadme } from "./RepoDetailReadme.tsx";
import { RepoDetailSidebar } from "./RepoDetailSidebar.tsx";

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

export function RepoDetailFiles(props: RepoDetailFilesProps) {
  return (
    <>
      <Show when={props.selectedFilePath}>
        <FileViewer
          repoId={props.repo.id}
          branch={props.currentBranch}
          filePath={props.selectedFilePath!}
          initialLine={props.selectedFileLine ?? undefined}
          onBack={props.onBackToTree}
        />
      </Show>

      <Show when={!props.selectedFilePath}>
        <div class="flex gap-6 p-4">
          <div class="flex-1 min-w-0">
            <div class="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
              <FileTree
                repoId={props.repo.id}
                branch={props.currentBranch}
                onFileSelect={props.onFileSelect}
              />
            </div>

            <RepoDetailReadme
              readme={props.readme}
              readmeLoading={props.readmeLoading}
            />
          </div>

          <RepoDetailSidebar
            repo={props.repo}
            safeHomepage={props.safeHomepage}
            starsCount={props.starsCount}
            forksCount={props.forksCount}
            branches={props.branches}
            isAuthenticated={props.isAuthenticated}
            onSyncComplete={props.onSyncComplete}
          />
        </div>
      </Show>
    </>
  );
}
