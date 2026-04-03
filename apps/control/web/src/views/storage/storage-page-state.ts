import type { RouteState } from "../../types/index.ts";
import type { FileHandler } from "./storageUtils.tsx";

export function getParentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

export function resolveStorageInitialPath(
  initialPath?: string,
  initialFilePath?: string,
): string {
  if (initialFilePath) {
    return getParentPath(initialFilePath);
  }
  return initialPath ?? "/";
}

export function shouldEmitStoragePathChange(
  currentPath: string,
  initialPath?: string,
  initialFilePath?: string,
  initialLoadComplete = false,
): boolean {
  if (!initialLoadComplete) {
    return false;
  }
  return currentPath !==
    resolveStorageInitialPath(initialPath, initialFilePath);
}

export function buildStorageNavigationState(
  spaceId: string,
  path: string,
): Partial<RouteState> {
  return {
    view: "storage",
    spaceId,
    storagePath: path,
    filePath: undefined,
    fileLine: undefined,
    threadId: undefined,
    runId: undefined,
    messageId: undefined,
    username: undefined,
    repoId: undefined,
    repoName: undefined,
    appId: undefined,
    workerId: undefined,
    deploySection: undefined,
    storeTab: undefined,
    shareToken: undefined,
    legalPage: undefined,
    oauthQuery: undefined,
    spaceSlug: undefined,
    workspaceSlug: undefined,
  };
}

export async function loadStorageFileHandlers(
  spaceId: string,
  isCurrentRequest: () => boolean,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<FileHandler[] | null> {
  try {
    const res = await fetchImpl(
      `/api/spaces/${encodeURIComponent(spaceId)}/storage/file-handlers`,
    );
    if (!res.ok) return null;

    const data = await res.json() as { handlers?: FileHandler[] } | null;
    if (!isCurrentRequest()) return null;

    return data?.handlers ?? null;
  } catch {
    return null;
  }
}
