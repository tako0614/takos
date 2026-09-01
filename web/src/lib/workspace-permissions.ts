import type { Space, Thread } from "../types/index.ts";

export interface ThreadLifecyclePermissions {
  canArchive: boolean;
  canDelete: boolean;
}

export function getThreadLifecyclePermissions(
  spaces: readonly Pick<Space, "id">[],
  thread: Pick<Thread, "space_id">,
): ThreadLifecyclePermissions {
  const ownsWorkspace = spaces.some((space) => space.id === thread.space_id);
  return {
    canArchive: ownsWorkspace,
    canDelete: ownsWorkspace,
  };
}
