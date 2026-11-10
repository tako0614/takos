import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { StoragePage } from "../../../../web/src/views/storage/StoragePage.tsx";
import { buildStorageNavigationState } from "../../../../web/src/views/storage/storage-page-state.ts";
import { useToast } from "../../../../web/src/store/toast.ts";

interface FileRoute { spaceId: string; path: string; filePath?: string }
const [route, setRoute] = createSignal<FileRoute>({ spaceId: "space-a", path: "/a", filePath: "/a/alpha.png" });
const [notify, setNotify] = createSignal(true), [mounted, setMounted] = createSignal(true);
const navigations: ReturnType<typeof buildStorageNavigationState>[] = [];
const toast = useToast();
const onPathChange = (path: string) => {
  // Use the same canonical folder transition as the actual AppRoutes caller.
  const next = buildStorageNavigationState(route().spaceId, path);navigations.push(next);
  setRoute(previous => ({ ...previous, path: next.storagePath!, filePath: next.filePath }));
};
const dispose = render(() => <Show when={mounted()}>
  <StoragePage spaceId={route().spaceId} spaces={[]} initialPath={route().path} initialFilePath={route().filePath}
    onPathChange={notify() ? onPathChange : undefined} />
</Show>, document.getElementById("root")!);
Object.assign(window, { storageDirectFileFixture: {
  setRoute, route, setNotify, navigations, dispose,
  remount: () => { setMounted(false);queueMicrotask(() => setMounted(true)); },
  clearToasts: () => { for (const item of toast.toasts) toast.dismissToast(item.id); },
} });
