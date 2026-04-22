import { createSignal } from "solid-js";
import type { Setter } from "solid-js";
import { getSpaceIdentifier } from "../lib/spaces.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import type { Space, Thread } from "../types/index.ts";

const [sidebarSpace, setSidebarSpace] = createSignal<Space | null>(null);
const [showMobileNavDrawer, setShowMobileNavDrawer] = createSignal(false);
const [threadsBySpace, setThreadsBySpace] = createSignal<
  Record<string, Thread[]>
>({});

export const mobileNavDrawerId = "mobile-navigation-drawer";

export async function fetchAllThreads(wsList: Space[]): Promise<void> {
  if (wsList.length === 0) return;

  const entries = await Promise.all(
    wsList.map(async (space) => {
      const identifier = getSpaceIdentifier(space);
      try {
        const res = await rpc.spaces[":spaceId"].threads.$get({
          param: { spaceId: identifier },
          query: { status: "active" },
        });
        const data = await rpcJson<{ threads: Thread[] }>(res);
        return [identifier, data.threads] as const;
      } catch {
        return [identifier, [] as Thread[]] as const;
      }
    }),
  );

  setThreadsBySpace(Object.fromEntries(entries));
}

export function useNavigationState() {
  return {
    sidebarSpace,
    setSidebarSpace: setSidebarSpace as Setter<Space | null>,
    showMobileNavDrawer,
    setShowMobileNavDrawer: setShowMobileNavDrawer as Setter<boolean>,
    threadsBySpace,
    setThreadsBySpace: setThreadsBySpace as Setter<Record<string, Thread[]>>,
    allThreads: () => Object.values(threadsBySpace()).flat(),
  };
}
